/**
 * services/OutboxService.js — Phase 3
 * نظام أبو حذيفة — توحيد محرك المزامنة (Outbox Pattern)
 *
 * الضمانات الجوهرية:
 * - id === idempotency_key لكل عملية جديدة (UUID واحد يخدم الغرضين)
 * - خطأ Postgres 23505 (unique_violation) = موجود بالفعل = نجاح
 * - ترتيب FIFO بحسب local_timestamp
 * - Dexie أولاً، ثم محاولة الخادم
 *
 * القواعد الصارمة:
 * - لا TEMP_ID في أي مسار جديد
 * - لا eval() / Function()
 * - جميع عمليات db محاطة بـ typeof db !== 'undefined' && db.isOpen()
 */

'use strict';

// الجداول التي تملك عمودَي sync_status و idempotency_key في Supabase
// (جميع الجداول الأخرى تحتفظ بهذه الحقول في Dexie فقط)
const _TABLES_WITH_SERVER_SYNC = new Set([TABLES.TRANSACTIONS]);

// الجداول التي لا تملك عمود updated_at في Supabase
// يجب إبقاء هذه القائمة متزامنة مع _REPO_TABLES_WITHOUT_UPDATED_AT في Repository.js و SyncQueue.js
const _TABLES_WITHOUT_UPDATED_AT = new Set([
  'account_balances',
  'accounts',
  'audit_logs',
  'companies',
  'daily_closings',
  'notifications',
  'quick_login_rate_limit',
  'user_beneficiaries',
]);

// ============================================================
// OutboxService
// ============================================================

const OutboxService = {

  // ==========================================================
  // addToOutbox — إضافة عملية للصندوق الصادر
  // ==========================================================

  /**
   * يحفظ عملية محلياً ويضيفها لطابور المزامنة.
   *
   * الضمان الجوهري: operation.id === idempotency_key
   * → UUID واحد يُستخدم كـ PK في Dexie وكـ idempotency key على الخادم.
   *
   * @param {object}  operation  - بيانات العملية (يُستخدم operation.id إن وُجد)
   * @param {string}  [action]   - create | update | delete | batch
   * @param {string}  [tableName]- اسم الجدول في Supabase
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  async addToOutbox(
    operation,
    action    = SYNC_ACTIONS.CREATE,
    tableName = TABLES.TRANSACTIONS,
  ) {
    if (typeof db === 'undefined' || !db.isOpen()) {
      return err('قاعدة البيانات المحلية غير متاحة');
    }

    const id              = operation.id || crypto.randomUUID();
    const idempotency_key = id;                          // ← الضمان الجوهري
    const local_timestamp = new Date().toISOString();

    const enriched = {
      ...operation,
      id,
      idempotency_key,
      local_timestamp,
      sync_status : SYNC_STATUS.PENDING,
      created_at  : operation.created_at || local_timestamp,
    };

    // 1. الحفظ في Dexie أولاً (Dexie = مصدر الحقيقة الوحيد)
    //    لا نكتب للـ batch (لا جدول اسمه 'batch')
    if (action !== SYNC_ACTIONS.BATCH) {
      try {
        const dexieRef = db[tableName];
        if (dexieRef) {
          await dexieRef.put(enriched);
        }
      } catch (e) {
        if (e.name !== 'ConstraintError') {
          console.warn(`[OutboxService] Dexie.put(${tableName}):`, e.message);
        }
      }
    }

    // 2. إضافة لطابور المزامنة
    if (typeof SyncQueue !== 'undefined') {
      await SyncQueue.add(
        action,
        tableName,
        id,
        action === SYNC_ACTIONS.BATCH ? operation : enriched,
      );
    }

    window.dispatchEvent(new CustomEvent('app:localOpSaved'));
    return ok(enriched);
  },

  // ==========================================================
  // processOutbox — معالجة الصندوق الصادر
  // ==========================================================

  /**
   * يُعالج العمليات المعلقة من sync_queue بترتيب FIFO.
   *
   * الفوارق عن SyncQueue.processQueue القديم:
   * 1. 23505 = نجاح (لا فشل)
   * 2. ترتيب FIFO صريح بـ local_timestamp
   * 3. لا replaceTempId — كل id حقيقي UUID
   *
   * @returns {Promise<{ok: boolean, data?: {processed, failed, total}, error?: string}>}
   */
  async processOutbox() {
    if (isOfflineMode() || !isOnline()) {
      return ok({ processed: 0, failed: 0, total: 0, reason: 'offline' });
    }
    if (typeof db === 'undefined' || !db.isOpen()) {
      return ok({ processed: 0, failed: 0, total: 0, reason: 'db_unavailable' });
    }

    // تنظيف العمليات العالقة في 'processing' من تعطّل سابق
    try {
      await db.sync_queue
        .where('sync_status').equals('processing')
        .modify({ sync_status: 'pending' });
    } catch { /* تجاهل */ }

    const pending = await db.sync_queue
      .where('sync_status').equals('pending')
      .toArray();

    if (!pending.length) return ok({ processed: 0, failed: 0, total: 0 });

    // FIFO: local_timestamp ثم created_at
    pending.sort((a, b) => {
      const ta = a.local_timestamp || a.created_at || '';
      const tb = b.local_timestamp || b.created_at || '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    let processed = 0, failed = 0;

    for (const item of pending) {
      const result = await this._processItem(item);

      if (isOk(result)) {
        processed++;
        try {
          await db.sync_queue.delete(item.id);
        } catch { /* تجاهل */ }
        await this._updatePendingCount();
      } else {
        failed++;
        if (typeof SyncQueue !== 'undefined') {
          await SyncQueue.handleFailure(item, result.error);
        }
      }

      await _outboxSleep(SYNC_CONFIG?.CHUNK_DELAY_MS ?? 50);
    }

    console.log(`✅ OutboxService.processOutbox: ${processed} ناجحة, ${failed} فاشلة من ${pending.length}`);

    if (processed > 0 && typeof showToast === 'function') {
      showToast(
        `✅ تمت مزامنة ${processed} عملية معلقة — التقارير محدّثة`,
        'success',
        4000
      );
    }

    return ok({ processed, failed, total: pending.length });
  },

  // ==========================================================
  // _processItem — تحديد نوع العملية وتنفيذها
  // ==========================================================

  async _processItem(item) {
    try {
      const data = typeof item.data === 'string'
        ? JSON.parse(item.data || '{}')
        : (item.data || {});

      await db.sync_queue.update(item.id, {
        sync_status   : 'processing',
        last_retry_at : new Date().toISOString(),
      });

      switch (item.action) {
        case SYNC_ACTIONS.CREATE:
          return await this._executeCreate(item.table_name, data);

        case SYNC_ACTIONS.BATCH:
          return await this._executeBatch(data.operations || []);

        case SYNC_ACTIONS.UPDATE:
        case SYNC_ACTIONS.DELETE:
          // تفويض لـ SyncQueue — مسارات موجودة وتعمل
          if (typeof SyncQueue !== 'undefined') {
            return await SyncQueue._processItem(item);
          }
          return err(`نوع عملية غير مدعوم في OutboxService: ${item.action}`);

        default:
          return err(`نوع عملية غير معروف: ${item.action}`);
      }
    } catch (e) {
      return err(e.message);
    }
  },

  // ==========================================================
  // _executeCreate — إرسال CREATE مع معالجة 23505 كنجاح
  // ==========================================================

  async _executeCreate(tableName, data) {
    try {
      const clean = this._cleanForServer(data, tableName);

      // فقط جداول Supabase التي تملك sync_status و idempotency_key تستقبلهما
      const payload = _TABLES_WITH_SERVER_SYNC.has(tableName)
        ? { ...clean, idempotency_key: data.idempotency_key || data.id, sync_status: SYNC_STATUS.SYNCED }
        : clean;

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .insert(payload)
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation = العملية موجودة بالفعل → idempotency → نجاح
        if (error.code === '23505') {
          await this._markSynced(tableName, data.id);
          console.log(`[OutboxService] ${tableName}/${data.id}: موجود بالفعل → نجاح (idempotency)`);
          return ok({ skipped: true, reason: 'already_synced' });
        }
        return err(error.message);
      }

      await this._markSynced(tableName, saved?.id || data.id);
      return ok(saved);

    } catch (e) {
      return err(e.message);
    }
  },

  // ==========================================================
  // _executeBatch — إرسال BATCH (معاملة + قيود) عبر RPC
  // ==========================================================

  async _executeBatch(operations) {
    try {
      const txOp     = operations.find(op => op.table === TABLES.TRANSACTIONS);
      const entryOps = operations.filter(op => op.table === TABLES.ACCOUNT_LEDGER);

      if (txOp && entryOps.length > 0) {
        // استدعاء مباشر للحصول على كود الخطأ (callRPC يفقد الكود)
        const { data: rpcData, error: rpcError } = await supabaseClient.rpc(
          RPC.CREATE_TRANSACTION_WITH_ENTRIES,
          {
            p_transaction : {
              ...this._cleanForServer(txOp.data, TABLES.TRANSACTIONS),
              idempotency_key: txOp.data?.idempotency_key || txOp.data?.id,
            },
            p_entries: entryOps.map(op => this._cleanForServer(op.data, TABLES.ACCOUNT_LEDGER)),
          }
        );

        if (rpcError) {
          const errCode = rpcError.code || '';
          const errMsg  = String(rpcError.message || '');

          // idempotency: العملية موجودة بالفعل = نجاح
          if (
            errCode === '23505' ||
            errMsg.includes('unique_violation') ||
            errMsg.includes('already exists')
          ) {
            await this._markSynced(TABLES.TRANSACTIONS, txOp.data?.id);
            return ok({ skipped: true, reason: 'already_synced' });
          }

          // خطأ دائم لا يُجدي إعادة المحاولة — يُوقف الطابور فوراً
          const _FATAL = new Set(['23502','23514','42703','42501','P0001','22P02','23503','22003']);
          if (_FATAL.has(errCode) || errMsg.includes('does not exist')) {
            console.error(`❌ OutboxService._executeBatch: خطأ دائم (${errCode}): ${errMsg}`);
            return err(`خطأ دائم: ${errMsg}`);
          }

          return err(errMsg);
        }

        const realId = rpcData?.transaction_id || txOp.data?.id;
        await this._markSynced(TABLES.TRANSACTIONS, realId);

        if (typeof db !== 'undefined' && db.isOpen()) {
          for (const op of entryOps) {
            if (op.data?.id) {
              await db.account_ledger?.update(op.data.id, {
                sync_status  : SYNC_STATUS.SYNCED,
                reference_id : realId,
              }).catch(() => {});
            }
          }
        }

        return ok(rpcData);
      }

      // دفعة عامة (بدون معاملة مالية)
      for (const op of operations) {
        if (op.action === SYNC_ACTIONS.CREATE) {
          const res = await this._executeCreate(op.table, op.data);
          if (!isOk(res)) return res;
        }
      }

      return ok(true);

    } catch (e) {
      return err(e.message);
    }
  },

  // ==========================================================
  // دوال مساعدة
  // ==========================================================

  async _markSynced(tableName, id) {
    if (!id || typeof db === 'undefined' || !db.isOpen()) return;
    try {
      await db[tableName]?.update(id, {
        sync_status : SYNC_STATUS.SYNCED,
        synced_at   : new Date().toISOString(),
      });
      if (tableName === TABLES.TRANSACTIONS) {
        window.dispatchEvent(new CustomEvent('accounting:transactionSynced', { detail: { id, tableName } }));
      }
    } catch (e) {
      console.warn(`[OutboxService] _markSynced(${tableName}, ${id}):`, e.message);
    }
  },

  _cleanForServer(record, tableName = null) {
    if (!record) return {};
    const cleaned = { ...record };
    // حقول محلية فقط — لا تُرسل لـ Supabase
    delete cleaned.sync_status;
    delete cleaned.idempotency_key;   // يُعاد إضافته صراحةً للجداول التي تملكه
    delete cleaned.error_message;
    delete cleaned._local_only;
    delete cleaned._preEditUpdatedAt;
    delete cleaned._preEditVersion;
    delete cleaned.local_timestamp;
    delete cleaned.device_id;
    delete cleaned.synced_at;
    // يُحذف updated_at للجداول التي لا تملكه في Supabase لتفادي خطأ 42703
    if (tableName && _TABLES_WITHOUT_UPDATED_AT.has(tableName)) {
      delete cleaned.updated_at;
    }
    return cleaned;
  },

  // ==========================================================
  // syncAndLogout — مزامنة ثم تسجيل خروج (Q4=C)
  // يُستدعى من: زر المزامنة اليدوية في وضع Offline + تسجيل خروج Offline التلقائي
  // ==========================================================

  async syncAndLogout() {
    if (typeof showToast === 'function') {
      showToast('🔄 جارٍ مزامنة البيانات قبل الخروج...', 'info', 6000);
    }

    const result = await this.processOutbox();
    const { failed = 0 } = result?.data || {};

    if (failed > 0) {
      const confirmed = typeof confirmDialog === 'function'
        ? await confirmDialog(
            `تعذّر مزامنة ${failed} عملية. هل تريد الخروج مع الاحتفاظ بها محلياً؟`,
            'خروج', 'البقاء', 'warning'
          )
        : true;
      if (!confirmed) return;
    }

    if (typeof AuthService !== 'undefined' && AuthService.logout) {
      await AuthService.logout(false, true); // _skipOfflineSync=true لمنع حلقة لا نهائية
    } else {
      window.location.reload();
    }
  },

  async _updatePendingCount() {
    try {
      if (typeof db === 'undefined' || !db.isOpen()) return;
      const count = await db.sync_queue
        .where('sync_status').anyOf(['pending', 'processing'])
        .count();
      window.dispatchEvent(new CustomEvent('sync:queueCountChanged', { detail: { count } }));
    } catch { /* تجاهل */ }
  },

};

// ============================================================
// مساعد: sleep
// ============================================================

function _outboxSleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// تصدير
// ============================================================

window.OutboxService = OutboxService;

console.log('✅ OutboxService.js محمّل — id === idempotency_key | 23505 = نجاح | FIFO بـ local_timestamp');
