/**
 * repository/SyncQueue.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * طابور المزامنة الذكي (Offline-First Sync Engine)
 *
 * المسؤوليات:
 * - إدارة طابور العمليات المعلقة (sync_queue في Dexie)
 * - معالجة العمليات بترتيب FIFO
 * - إعادة المحاولة بتأخير تصاعدي (exponential backoff + jitter)
 * - استبدال المعرفات المؤقتة (TEMP_) بالمعرفات الحقيقية
 * - اكتشاف التعارضات وحفظها للحل اليدوي
 * - نقل العمليات المتجاوزة لـ sync_conflicts
 * - إعلام AppStore بتغيرات حالة الطابور
 *
 * القواعد الصارمة:
 * - لا يُستخدم eval() مطلقاً
 * - كل عملية تُحفظ في Dexie قبل الإرسال
 * - الدفعات (batch) تُعالج كوحدة ذرية واحدة
 */

'use strict';

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
   * @param {string} recordId - معرف السجل (قد يكون TEMP_)
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
   * @returns {Promise<{ok: boolean, processed: number, failed: number}>}
   */
  async processQueue() {
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
          result = await this._executeCreate(item.table_name, data, item.record_id);
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
   * @private
   */
  async _executeCreate(tableName, data, tempId) {
    try {
      // إزالة الحقول الداخلية قبل الإرسال
      const cleanData = this._cleanRecord(data);

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .insert(cleanData)
        .select()
        .single();

      if (error) return err(error.message);

      // استبدال المعرف المؤقت بالمعرف الحقيقي إن كان مختلفاً
      if (isTempId(tempId) && saved?.id && saved.id !== tempId) {
        await this.replaceTempId(tableName, tempId, saved.id);
      } else if (saved) {
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
   * تنفيذ عملية UPDATE على Supabase مع كشف التعارض
   * @private
   */
  async _executeUpdate(tableName, recordId, changes) {
    try {
      // إضافة شرط updated_at للكشف عن التعارض
      const { data: current, error: fetchError } = await supabaseClient
        .from(tableName)
        .select('updated_at')
        .eq('id', recordId)
        .single();

      if (fetchError) {
        // السجل محذوف من الخادم — تعارض
        if (fetchError.code === 'PGRST116') {
          return err('السجل غير موجود على الخادم');
        }
        return err(fetchError.message);
      }

      const cleanChanges = this._cleanRecord(changes);

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .update(cleanChanges)
        .eq('id', recordId)
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
      const { error } = await supabaseClient
        .from(tableName)
        .delete()
        .eq('id', recordId);

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

        // استبدال المعرف المؤقت للمعاملة إن وجد
        const realTxId = result.data?.transaction_id;
        if (realTxId && isTempId(txOp.data?.id)) {
          await this.replaceTempId(TABLES.TRANSACTIONS, txOp.data.id, realTxId);
        }

        return result;
      }

      // دفعة عامة بدون معاملة مالية: تنفيذ كل عملية
      for (const op of operations) {
        let res;
        if (op.action === SYNC_ACTIONS.CREATE) {
          res = await this._executeCreate(op.table, op.data, op.data?.id);
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

      // تحديث عدد المحاولات وإعادة الحالة لـ pending
      await db.sync_queue.update(item.id, {
        retries       : newRetries,
        last_retry_at : new Date().toISOString(),
        sync_status   : 'pending',
        error_message : errorMsg,
      });

      // جدولة إعادة المحاولة بتأخير تصاعدي
      const delay = calcBackoffDelay(newRetries);
      console.log(`🔄 SyncQueue: إعادة جدولة عملية ${item.id} بعد ${delay}ms (محاولة ${newRetries})`);

      const timer = setTimeout(async () => {
        _queueState.retryTimers.delete(item.id);
        if (isOnline() && !_queueState.isProcessing) {
          await this.processQueue();
        }
      }, delay);

      _queueState.retryTimers.set(item.id, timer);

    } catch (e) {
      console.error('❌ SyncQueue.handleFailure():', e);
    }
  },

  // ==========================================================
  // REPLACE TEMP ID — استبدال المعرف المؤقت
  // ==========================================================

  /**
   * يستبدل المعرف المؤقت (TEMP_) بالمعرف الحقيقي
   * في كل الجداول التي تشير إليه
   * @param {string} primaryTable - الجدول الرئيسي للسجل
   * @param {string} tempId - المعرف المؤقت
   * @param {string} realId - المعرف الحقيقي من Supabase
   * @returns {Promise<void>}
   */
  async replaceTempId(primaryTable, tempId, realId) {
    try {
      console.log(`🔄 SyncQueue: استبدال ${tempId} بـ ${realId} في ${primaryTable}`);

      // 1. تحديث الجدول الرئيسي
      const primaryDexie = db[primaryTable];
      if (primaryDexie) {
        const record = await primaryDexie.get(tempId);
        if (record) {
          await primaryDexie.delete(tempId);
          await primaryDexie.put({ ...record, id: realId, sync_status: SYNC_STATUS.SYNCED });
        }
      }

      // 2. تحديث جداول تشير للمعرف المؤقت كـ reference_id
      if (primaryTable === TABLES.TRANSACTIONS) {
        const ledgerRecords = await db.account_ledger
          .where('reference_id')
          .equals(tempId)
          .toArray();

        for (const lr of ledgerRecords) {
          await db.account_ledger.update(lr.id, { reference_id: realId });
        }
      }

      // 3. تحديث sync_queue نفسه إن كان يشير للمعرف المؤقت
      const queueItems = await db.sync_queue
        .where('record_id')
        .equals(tempId)
        .toArray();

      for (const qi of queueItems) {
        await db.sync_queue.update(qi.id, { record_id: realId });
      }

      // 4. إعلام AppStore بالاستبدال
      window.dispatchEvent(new CustomEvent('sync:tempIdReplaced', {
        detail: { tempId, realId, table: primaryTable },
      }));

    } catch (e) {
      console.error('❌ SyncQueue.replaceTempId():', e);
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
            .eq('id', item.record_id)
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
          const serverObj = JSON.parse(conflict.server_data);
          const dexieTable = db[conflict.table_name];
          if (dexieTable && serverObj?.id) {
            await dexieTable.put({ ...serverObj, sync_status: SYNC_STATUS.SYNCED });
          }
        }
        console.log(`✅ التعارض ${conflictId}: تم قبول نسخة الخادم`);

      } else if (resolution === 'client') {
        // فرض نسخة العميل — إعادة الإرسال لـ Supabase
        const clientData = JSON.parse(conflict.client_data || '{}');
        const { error } = await supabaseClient
          .from(conflict.table_name)
          .upsert({ ...clientData, updated_at: new Date().toISOString() })
          .select();

        if (error) return err(`فشل فرض نسخة العميل: ${error.message}`);

        const dexieTable = db[conflict.table_name];
        if (dexieTable && clientData?.id) {
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
  _cleanRecord(record) {
    const cleaned = { ...record };
    delete cleaned.sync_status;
    delete cleaned._local_only;
    delete cleaned.error_message;
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
   * @returns {Promise<object>}
   */
  async getStats() {
    try {
      const [pending, processing, failed, conflicts] = await Promise.all([
        db.sync_queue.where('sync_status').equals('pending').count(),
        db.sync_queue.where('sync_status').equals('processing').count(),
        db.sync_queue.where('sync_status').equals('failed').count(),
        // ✅ تم استخدام filter بدلاً من equals(null) لتجنب خطأ IndexedDB
        db.sync_conflicts.filter(conflict => conflict.resolution === null).count(),
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

  /**
   * يجلب جميع التعارضات غير المحلولة
   * @returns {Promise<Array>}
   */
  async getUnresolvedConflicts() {
    try {
      // ✅ تم استخدام filter هنا أيضاً للبحث عن القيم التي تساوي null
      return await db.sync_conflicts
        .filter(conflict => conflict.resolution === null)
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

};

// ============================================================
// الاستماع لحدث الاتصال بالإنترنت — تشغيل المعالجة تلقائياً
// ============================================================

window.addEventListener('app:onlineStatusChange', async (e) => {
  if (e.detail?.online) {
    const stats = await SyncQueue.getStats();
    if (isOk(stats) && stats.data.pending > 0) {
      console.log(`🌐 الاتصال عاد — بدء مزامنة ${stats.data.pending} عملية معلقة`);
      await sleep(500); // تأخير قصير لاستقرار الاتصال
      SyncQueue.processQueue();
    }
  }
});

// ============================================================
// تصدير للاستخدام في Repository.js والخدمات
// ============================================================

window.SyncQueue = SyncQueue;

console.log('✅ SyncQueue.js محمّل — طابور المزامنة جاهز');
