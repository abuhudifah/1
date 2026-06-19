/**
 * repository/SyncQueue.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * طابور المزامنة الذكي (Offline-First Sync Engine)
 *
 * المسؤوليات:
 * - إدارة طابور العمليات المعلقة (sync_queue في Dexie): add / handleFailure
 * - اكتشاف التعارضات وحفظها للحل اليدوي + إحصائيات الطابور
 * - إعلام AppStore بتغيرات حالة الطابور
 *
 * Phase 6: محرك المعالجة النشط هو OutboxService.processOutbox. تبقى دوال
 * المعالجة القديمة (processQueue/getPending) مُعلَّمة DEPRECATED للتوافق فقط.
 *
 * القواعد الصارمة:
 * - لا يُستخدم eval() مطلقاً
 * - كل عملية تُحفظ في Dexie قبل الإرسال
 * - الدفعات (batch) تُعالج كوحدة ذرية واحدة
 */

'use strict';

// ============================================================
// خريطة المفاتيح الأساسية للجداول ذات PK غير قياسي
// مطابقة لـ TABLE_PRIMARY_KEYS في Repository.js
// ============================================================

const _SQ_PK_MAP = Object.freeze({
  account_balances : 'account_id',
  system_settings  : 'key',
  cache_meta       : 'key',
});

function _sqGetPKColumn(tableName) {
  return _SQ_PK_MAP[tableName] || 'id';
}

// ============================================================
// حالة داخلية للطابور
// ============================================================

const _queueState = {
  isProcessing : false,    // هل الطابور يعالج حالياً؟
  pendingCount : 0,        // عدد العمليات المعلقة
  retryTimers  : new Map(), // timers إعادة المحاولة المجدولة
};

// ============================================================
// الكائن الرئيسي للطابور
// ============================================================

const SyncQueue = {

  // ==========================================================
  // ADD — إضافة عملية للطابور
  // ==========================================================

  /**
   * يُضيف عملية جديدة لطابور المزامنة
   * @param {string} action - create | update | delete | batch
   * @param {string} tableName - اسم الجدول المستهدف
   * @param {string} recordId - معرف السجل (UUID حقيقي)
   * @param {object} data - البيانات الكاملة
   * @returns {Promise<{ok: boolean, queueId?: number, error?: string}>}
   */
  async add(action, tableName, recordId, data) {
    try {
      // التحقق من حجم الطابور
      const currentSize = await db.sync_queue.count();
      if (currentSize >= SYNC_CONFIG.MAX_QUEUE_SIZE) {
        console.error(`❌ طابور المزامنة ممتلئ (${currentSize} عملية). تجاوز الحد الأقصى.`);
        showToast('تحذير: طابور المزامنة ممتلئ. يُرجى مزامنة البيانات فوراً.', 'warning', 8000);
        return err('طابور المزامنة ممتلئ');
      }

      const queueItem = {
        action,
        table_name      : tableName,
        record_id       : String(recordId),
        data            : JSON.stringify(data),
        sync_status     : 'pending',
        retries         : 0,
        last_retry_at   : null,
        created_at      : new Date().toISOString(),
      };

      const queueId = await db.sync_queue.add(queueItem);

      // تحديث العداد وإعلام AppStore
      await this._updatePendingCount();

      console.log(`📥 SyncQueue: أُضيفت عملية ${action} على ${tableName} (id: ${queueId})`);
      return ok({ queueId });

    } catch (e) {
      console.error('❌ SyncQueue.add():', e);
      return err(`فشل إضافة العملية للطابور: ${e.message}`);
    }
  },

  // ==========================================================
  // REMOVE — حذف عملية من الطابور
  // ==========================================================

  /**
   * يحذف عملية من الطابور بعد نجاح مزامنتها
   * @param {number} queueId
   * @returns {Promise<void>}
   */
  async remove(queueId) {
    try {
      await db.sync_queue.delete(queueId);
      await this._updatePendingCount();
    } catch (e) {
      console.warn(`تحذير: فشل حذف العملية ${queueId} من الطابور:`, e.message);
    }
  },

  // ==========================================================
  // GET PENDING — جلب العمليات المعلقة
  // ==========================================================

  /**
   * يجلب العمليات المعلقة مرتبةً حسب created_at (FIFO)
   * @param {number} [limit=50] - أقصى عدد للجلب
   * @returns {Promise<Array>}
   */
  async getPending(limit = 50) {
    try {
      const items = await db.sync_queue
        .where('sync_status')
        .equals('pending')
        .limit(limit)
        .toArray();

      // ترتيب FIFO حسب created_at
      items.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

      return items;
    } catch (e) {
      console.error('❌ SyncQueue.getPending():', e);
      return [];
    }
  },

  // ==========================================================
  // PROCESS QUEUE — معالجة الطابور
  // ==========================================================

  /**
   * يُشغّل معالجة طابور المزامنة
   * يُعالج العمليات في دفعات (chunks) مع تأخير بينها
   *
   * DEPRECATED: المحرك النشط هو OutboxService.processOutbox منذ المرحلة 3.
   * تبقى هذه الدالة + getPending للتوافق فقط (لا يُستدعَيان في أي مسار نشط).
   *
   * @returns {Promise<{ok: boolean, processed: number, failed: number}>}
   */
  async processQueue() {
    // تنظيف العمليات العالقة في 'processing' من تعطّل أو إعادة تشغيل سابقة
    try {
      await db.sync_queue
        .where('sync_status').equals('processing')
        .modify({ sync_status: 'pending' });
    } catch { /* تجاهل — لا نوقف المعالجة بسببه */ }

    if (_queueState.isProcessing) {
      console.log('ℹ️  SyncQueue: المعالجة جارية بالفعل');
      return ok({ processed: 0, failed: 0, reason: 'already_processing' });
    }

    if (!isOnline()) {
      console.log('ℹ️  SyncQueue: غير متصل — تأجيل المعالجة');
      return ok({ processed: 0, failed: 0, reason: 'offline' });
    }

    _queueState.isProcessing = true;
    let totalProcessed = 0;
    let totalFailed    = 0;

    try {
      console.log('🔄 SyncQueue: بدء معالجة الطابور...');

      // جلب العمليات المعلقة على دفعات
      let pending = await this.getPending(SYNC_CONFIG.CHUNK_SIZE);

      while (pending.length > 0) {
        for (const item of pending) {
          const result = await this._processItem(item);

          if (isOk(result)) {
            totalProcessed++;
            await this.remove(item.id);
          } else {
            totalFailed++;
            await this.handleFailure(item, result.error);
          }

          // تأخير بين العمليات لمنع تجميد المتصفح
          await sleep(SYNC_CONFIG.CHUNK_DELAY_MS);
        }

        // جلب الدفعة التالية
        pending = await this.getPending(SYNC_CONFIG.CHUNK_SIZE);
      }

      await this._updatePendingCount();

      console.log(`✅ SyncQueue: اكتملت المعالجة — ${totalProcessed} ناجحة, ${totalFailed} فاشلة`);
      return ok({ processed: totalProcessed, failed: totalFailed });

    } catch (e) {
      console.error('❌ SyncQueue.processQueue():', e);
      return err(`فشل معالجة الطابور: ${e.message}`);
    } finally {
      _queueState.isProcessing = false;
    }
  },

  // ==========================================================
  // PROCESS ITEM — معالجة عملية واحدة
  // ==========================================================

  /**
   * يُعالج عملية واحدة من الطابور
   * @param {object} item - عنصر من sync_queue
   * @returns {Promise<{ok: boolean, data?: *, error?: string}>}
   * @private
   */
  async _processItem(item) {
    try {
      const data = JSON.parse(item.data || '{}');

      // تحديث حالة العنصر إلى "قيد المعالجة"
      await db.sync_queue.update(item.id, {
        sync_status   : 'processing',
        last_retry_at : new Date().toISOString(),
      });

      let result;

      switch (item.action) {
        case SYNC_ACTIONS.CREATE:
          result = await this._executeCreate(item.table_name, data);
          break;

        case SYNC_ACTIONS.UPDATE:
          result = await this._executeUpdate(item.table_name, item.record_id, data);
          break;

        case SYNC_ACTIONS.DELETE:
          result = await this._executeDelete(item.table_name, item.record_id);
          break;

        case SYNC_ACTIONS.BATCH:
          result = await this._executeBatch(data.operations || []);
          break;

        default:
          return err(`نوع عملية غير معروف: ${item.action}`);
      }

      return result;

    } catch (e) {
      return err(`استثناء غير متوقع: ${e.message}`);
    }
  },

  // ==========================================================
  // تنفيذ كل نوع عملية
  // ==========================================================

  /**
   * تنفيذ عملية CREATE على Supabase
   * Phase 6: لا TEMP_ID — كل id حقيقي UUID منذ المرحلة 3، فلا حاجة لـ replaceTempId
   * @private
   */
  async _executeCreate(tableName, data) {
    try {
      // إزالة الحقول الداخلية قبل الإرسال
      const cleanData = this._cleanRecord(data, tableName);

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .insert(cleanData)
        .select()
        .single();

      if (error) return err(error.message);

      if (saved) {
        const dexieTable = db[tableName];
        if (dexieTable) {
          await dexieTable.put({ ...saved, sync_status: SYNC_STATUS.SYNCED });
        }
      }

      return ok(saved);
    } catch (e) {
      return err(e.message);
    }
  },

  /**
   * تنفيذ عملية UPDATE على Supabase مع كشف التعارض الحقيقي
   * ✅ إصلاح: مقارنة updated_at المحلي بـ updated_at الخادم لكشف التعارض
   * @private
   */
  async _executeUpdate(tableName, recordId, changes) {
    try {
      const pkCol = _sqGetPKColumn(tableName);

      // جلب updated_at الحالي من الخادم
      const { data: current, error: fetchError } = await supabaseClient
        .from(tableName)
        .select('updated_at')
        .eq(pkCol, recordId)
        .single();

      if (fetchError) {
        // السجل محذوف من الخادم — تعارض
        if (fetchError.code === 'PGRST116') {
          return err('السجل غير موجود على الخادم');
        }
        return err(fetchError.message);
      }

      // كشف التعارض الحقيقي: مقارنة لقطة ما قبل التعديل بقيمة الخادم الحالية
      const preEditUpdatedAt = changes?._preEditUpdatedAt;
      if (
        current?.updated_at &&
        preEditUpdatedAt &&
        current.updated_at !== preEditUpdatedAt
      ) {
        return err(
          `تعارض: السجل عُدِّل من مصدر آخر ` +
          `(خادم: ${current.updated_at} | قبل التعديل: ${preEditUpdatedAt})`
        );
      }

      const hasUpdatedAt = !this._TABLES_WITHOUT_UPDATED_AT.has(tableName);
      const cleanChanges = {
        ...this._cleanRecord(changes, tableName),
        ...(hasUpdatedAt ? { updated_at: new Date().toISOString() } : {}),
      };

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .update(cleanChanges)
        .eq(pkCol, recordId)
        .select()
        .single();

      if (error) return err(error.message);

      // تحديث Dexie
      const dexieTable = db[tableName];
      if (dexieTable && saved) {
        await dexieTable.put({ ...saved, sync_status: SYNC_STATUS.SYNCED });
      }

      return ok(saved);
    } catch (e) {
      return err(e.message);
    }
  },

  /**
   * تنفيذ عملية DELETE على Supabase
   * @private
   */
  async _executeDelete(tableName, recordId) {
    try {
      const pkCol = _sqGetPKColumn(tableName);

      const { error } = await supabaseClient
        .from(tableName)
        .delete()
        .eq(pkCol, recordId);

      // إذا كان السجل غير موجود — اعتبره محذوفاً بالفعل
      if (error && error.code !== 'PGRST116') {
        return err(error.message);
      }

      return ok(true);
    } catch (e) {
      return err(e.message);
    }
  },

  /**
   * تنفيذ عملية BATCH (دفعة ذرية) عبر RPC
   * @private
   */
  async _executeBatch(operations) {
    try {
      // فحص هل الدفعة تحتوي معاملة مالية
      const txOp     = operations.find(op => op.table === TABLES.TRANSACTIONS);
      const entryOps = operations.filter(op => op.table === TABLES.ACCOUNT_LEDGER);

      if (txOp && entryOps.length > 0) {
        // استخدام RPC المخصص للمعاملات المالية
        const result = await callRPC(RPC.CREATE_TRANSACTION_WITH_ENTRIES, {
          p_transaction : txOp.data,
          p_entries     : entryOps.map(op => op.data),
        });

        if (!isOk(result)) return result;

        // Phase 6: لا TEMP_ID — المعرف الحقيقي UUID يُرسَل مباشرةً، فلا استبدال
        return result;
      }

      // دفعة عامة بدون معاملة مالية: تنفيذ كل عملية
      for (const op of operations) {
        let res;
        if (op.action === SYNC_ACTIONS.CREATE) {
          res = await this._executeCreate(op.table, op.data);
        } else if (op.action === SYNC_ACTIONS.UPDATE) {
          res = await this._executeUpdate(op.table, op.id || op.data?.id, op.data);
        } else if (op.action === SYNC_ACTIONS.DELETE) {
          res = await this._executeDelete(op.table, op.id || op.data?.id);
        }
        if (res && !isOk(res)) return res;
      }

      return ok(true);
    } catch (e) {
      return err(e.message);
    }
  },

  // ==========================================================
  // HANDLE FAILURE — معالجة الفشل وإعادة الجدولة
  // ==========================================================

  /**
   * يُعالج فشل عملية:
   * - إذا تجاوزت MAX_RETRIES → تُنقل لـ sync_conflicts
   * - وإلا → تُعاد جدولتها بتأخير تصاعدي
   * @param {object} item - عنصر sync_queue
   * @param {string} errorMsg - رسالة الخطأ
   * @returns {Promise<void>}
   */
  async handleFailure(item, errorMsg) {
    try {
      const newRetries = (item.retries || 0) + 1;

      if (newRetries >= SYNC_CONFIG.MAX_RETRIES) {
        // تجاوز الحد الأقصى — نقل للتعارضات
        console.warn(`⚠️  SyncQueue: تجاوز الحد الأقصى للمحاولات (عملية ${item.id}). النقل لـ sync_conflicts.`);
        await this._moveToConflicts(item, errorMsg);
        await this.remove(item.id);
        return;
      }

      // تحديث عدد المحاولات وتعيين الحالة 'failed' لمنع إعادة الجلب الفوري
      await db.sync_queue.update(item.id, {
        retries       : newRetries,
        last_retry_at : new Date().toISOString(),
        sync_status   : 'failed',   // ليس 'pending' — يمنع الحلقة اللانهائية
        error_message : errorMsg,
      });

      // جدولة إعادة المحاولة بتأخير تصاعدي
      const delay = calcBackoffDelay(newRetries);
      console.log(`🔄 SyncQueue: إعادة جدولة عملية ${item.id} بعد ${delay}ms (محاولة ${newRetries})`);

      const savedItemId = item.id;
      const timer = setTimeout(async () => {
        _queueState.retryTimers.delete(savedItemId);
        await db.sync_queue.update(savedItemId, { sync_status: 'pending' }).catch(() => {});
        if (isOnline() && !_queueState.isProcessing && typeof OutboxService !== 'undefined') {
          // OutboxService هو المحرك الوحيد (id===idempotency_key + 23505=نجاح + FIFO)
          await OutboxService.processOutbox();
        }
      }, delay);

      _queueState.retryTimers.set(item.id, timer);

    } catch (e) {
      console.error('❌ SyncQueue.handleFailure():', e);
    }
  },

  // ==========================================================
  // MOVE TO CONFLICTS — نقل للتعارضات
  // ==========================================================

  /**
   * ينقل عملية فاشلة لجدول sync_conflicts لحل يدوي
   * @param {object} item - عنصر sync_queue
   * @param {string} reason - سبب الفشل
   * @returns {Promise<void>}
   * @private
   */
  async _moveToConflicts(item, reason) {
    try {
      // جلب بيانات الخادم الحالية للمقارنة
      let serverData = null;
      try {
        if (item.action !== SYNC_ACTIONS.DELETE && item.table_name !== 'batch') {
          const { data } = await supabaseClient
            .from(item.table_name)
            .select('*')
            .eq(_sqGetPKColumn(item.table_name), item.record_id)
            .single();
          serverData = data;
        }
      } catch { /* تجاهل */ }

      await db.sync_conflicts.add({
        operation_id  : item.id,
        table_name    : item.table_name,
        record_id     : item.record_id,
        client_data   : item.data,
        server_data   : serverData ? JSON.stringify(serverData) : null,
        resolution    : null,
        created_at    : new Date().toISOString(),
        reason,
      });

      // إرسال إشعار للمدير
      window.dispatchEvent(new CustomEvent('sync:conflict', {
        detail: { item, reason, serverData },
      }));

      showToast(
        `تعارض في المزامنة: ${item.table_name} — يحتاج مراجعة المدير`,
        'warning',
        6000
      );

    } catch (e) {
      console.error('❌ SyncQueue._moveToConflicts():', e);
    }
  },

  // ==========================================================
  // RESOLVE CONFLICT — حل التعارض
  // ==========================================================

  /**
   * يحل تعارضاً يدوياً
   * @param {number} conflictId - معرف التعارض في sync_conflicts
   * @param {'server'|'client'} resolution - نسخة الخادم أو العميل
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async resolveConflict(conflictId, resolution) {
    try {
      const conflict = await db.sync_conflicts.get(conflictId);
      if (!conflict) return err('التعارض غير موجود');

      if (resolution === 'server') {
        // قبول نسخة الخادم — تحديث Dexie بالبيانات من الخادم
        if (conflict.server_data) {
          const serverObj  = JSON.parse(conflict.server_data);
          const dexieTable = db[conflict.table_name];
          const pkCol      = _sqGetPKColumn(conflict.table_name);
          if (dexieTable && serverObj?.[pkCol]) {
            await dexieTable.put({ ...serverObj, sync_status: SYNC_STATUS.SYNCED });
          }
        }
        console.log(`✅ التعارض ${conflictId}: تم قبول نسخة الخادم`);

      } else if (resolution === 'client') {
        // فرض نسخة العميل — إعادة الإرسال لـ Supabase
        const clientData = JSON.parse(conflict.client_data || '{}');
        const pkCol = _sqGetPKColumn(conflict.table_name);
        // لا يُضاف updated_at لجداول لا تملكه في Supabase (تتطابق مع _TABLES_WITHOUT_UPDATED_AT)
        const hasUpdatedAt = !this._TABLES_WITHOUT_UPDATED_AT.has(conflict.table_name);
        const upsertPayload = { ...clientData };
        if (hasUpdatedAt) upsertPayload.updated_at = new Date().toISOString();
        else              delete upsertPayload.updated_at;
        const { error } = await supabaseClient
          .from(conflict.table_name)
          .upsert(upsertPayload, { onConflict: pkCol })
          .select();

        if (error) return err(`فشل فرض نسخة العميل: ${error.message}`);

        const dexieTable = db[conflict.table_name];
        const pkVal = clientData?.[pkCol];
        if (dexieTable && pkVal) {
          await dexieTable.put({ ...clientData, sync_status: SYNC_STATUS.SYNCED });
        }
        console.log(`✅ التعارض ${conflictId}: تم فرض نسخة العميل`);
      }

      // تحديث حالة التعارض
      await db.sync_conflicts.update(conflictId, {
        resolution,
        resolved_at: new Date().toISOString(),
      });

      return ok(true);

    } catch (e) {
      console.error('❌ SyncQueue.resolveConflict():', e);
      return err(`فشل حل التعارض: ${e.message}`);
    }
  },

  // ==========================================================
  // دوال مساعدة
  // ==========================================================

  /**
   * يُنظّف السجل من الحقول الداخلية قبل إرساله لـ Supabase
   * @param {object} record
   * @returns {object}
   * @private
   */
  // الجداول التي لا تحتوي على عمود updated_at في Supabase
  // يجب إبقاء هذه القائمة متزامنة مع _REPO_TABLES_WITHOUT_UPDATED_AT في Repository.js و OutboxService.js
  _TABLES_WITHOUT_UPDATED_AT: new Set([
    'account_balances',
    'accounts',
    'audit_logs',
    'companies',              // لا يوجد عمود updated_at في Supabase
    'daily_closings',
    'notifications',          // لا يوجد عمود updated_at في Supabase
    'quick_login_rate_limit',
    'user_beneficiaries',
  ]),

  _cleanRecord(record, tableName) {
    const cleaned = { ...record };
    delete cleaned.sync_status;
    delete cleaned._local_only;
    delete cleaned.error_message;
    delete cleaned._preEditUpdatedAt;
    if (tableName && this._TABLES_WITHOUT_UPDATED_AT.has(tableName)) {
      delete cleaned.updated_at;
    }
    return cleaned;
  },

  /**
   * يُحدّث عداد العمليات المعلقة ويُعلم AppStore
   * @private
   */
  async _updatePendingCount() {
    try {
      const count = await db.sync_queue
        .where('sync_status')
        .anyOf(['pending', 'processing'])
        .count();

      _queueState.pendingCount = count;

      window.dispatchEvent(new CustomEvent('sync:queueCountChanged', {
        detail: { count },
      }));
    } catch { /* تجاهل */ }
  },

  /**
   * يُعيد إحصائيات الطابور الحالية
   * ✅ إصلاح: استبدال filter() بـ where().anyOf() لأداء أفضل
   * @returns {Promise<object>}
   */
  async getStats() {
    try {
      const [pending, processing, failed, conflicts] = await Promise.all([
        db.sync_queue.where('sync_status').equals('pending').count(),
        db.sync_queue.where('sync_status').equals('processing').count(),
        db.sync_queue.where('sync_status').equals('failed').count(),
        // ✅ الإصلاح: بدلاً من filter(c => c.resolution === null) التي تقرأ كل الجدول،
        // نعد الكل ونطرح المحلولة — يستخدم الفهرس بدلاً من المسح الكامل
        (async () => {
          const total    = await db.sync_conflicts.count();
          const resolved = await db.sync_conflicts
            .where('resolution')
            .anyOf(['server', 'client'])
            .count();
          return total - resolved;
        })(),
      ]);

      return ok({
        pending,
        processing,
        failed,
        conflicts,
        isProcessing : _queueState.isProcessing,
        total        : pending + processing + failed,
      });
    } catch (e) {
      return err(e.message);
    }
  },

  /**
   * يجلب جميع التعارضات غير المحلولة
   * ✅ إصلاح: استبدال filter() بنهج أكفأ يستخدم الفهرس
   * @returns {Promise<Array>}
   */
  async getUnresolvedConflicts() {
    try {
      // ✅ الإصلاح: جلب مفاتيح المحلولة عبر الفهرس ثم استبعادها
      // أكفأ بكثير من filter() الذي يقرأ كل السجلات في الذاكرة
      const resolvedKeys = await db.sync_conflicts
        .where('resolution')
        .anyOf(['server', 'client'])
        .primaryKeys();

      const resolvedSet = new Set(resolvedKeys);

      // filter قبل limit لضمان جلب أول CONFLICTS غير محلولة وليس أول CONFLICTS إجمالاً
      return await db.sync_conflicts
        .filter(c => !resolvedSet.has(c.id))
        .limit(QUERY_LIMITS.CONFLICTS)
        .toArray();
    } catch {
      return [];
    }
  },

  /**
   * يحذف جميع عمليات الطابور (للحالات الطارئة فقط)
   * يتطلب تأكيد صريح
   * @param {boolean} confirmed
   * @returns {Promise<{ok: boolean}>}
   */
  async clearAll(confirmed = false) {
    if (!confirmed) {
      return err('يجب تأكيد العملية صراحةً — هذا الإجراء لا يمكن التراجع عنه');
    }
    try {
      this.clearRetryTimers();
      await db.sync_queue.clear();
      await db.sync_conflicts.clear();
      await this._updatePendingCount();
      console.log('🧹 SyncQueue: تم مسح الطابور بالكامل');
      return ok(true);
    } catch (e) {
      return err(`فشل مسح الطابور: ${e.message}`);
    }
  },

  /**
   * يُلغي جميع مؤقتات إعادة المحاولة المجدولة
   * يُستخدم عند تسجيل الخروج
   */
  clearRetryTimers() {
    for (const [, timer] of _queueState.retryTimers) {
      clearTimeout(timer);
    }
    _queueState.retryTimers.clear();
    _queueState.isProcessing = false;
  },

};

// ============================================================
// الاستماع لحدث الاتصال بالإنترنت — تشغيل المعالجة تلقائياً
// ============================================================

window.addEventListener('app:onlineStatusChange', async (e) => {
  if (e.detail?.online) {
    const stats = await SyncQueue.getStats();
    if (isOk(stats) && stats.data.pending > 0) {
      console.log(`🌐 الاتصال عاد — بدء مزامنة ${stats.data.pending} عملية معلقة`);
      await sleep(500);
      // OutboxService هو المحرك الوحيد (id===idempotency_key + 23505=نجاح + FIFO)
      if (typeof OutboxService !== 'undefined') {
        OutboxService.processOutbox();
      }
    }
  }
});

// ============================================================
// تصدير للاستخدام في Repository.js والخدمات
// ============================================================

window.SyncQueue = SyncQueue;

console.log('✅ SyncQueue.js محمّل — طابور المزامنة جاهز');
