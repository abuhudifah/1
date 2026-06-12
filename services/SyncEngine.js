/**
 * services/SyncEngine.js
 * نظام أبو حذيفة — المرحلة 2B
 *
 * مسؤولية هذا الملف: مزامنة العمليات المحلية (Offline) مع Supabase عند عودة الاتصال.
 *
 * الفرق عن SyncQueue.js:
 * - SyncQueue: يُعالج العمليات الموضوعة في طابور sync_queue (عمليات قصيرة المدة)
 * - SyncEngine: يُزامن عمليات Offline كاملة من db.transactions (فترة offline مطوّلة)
 *   مع دعم idempotency_key لمنع التكرار وOptimistic Locking لحل التعارضات.
 *
 * القواعد الصارمة:
 * - كل عملية لها idempotency_key فريد — الخادم يرفض التكرار (constraint 23505)
 * - Optimistic Locking: فحص version قبل الإدراج
 * - لا catch {} فارغة
 */

'use strict';

// ============================================================
// SyncEngine
// ============================================================

const SyncEngine = {

  // ==========================================================
  // syncAll — مزامنة كل العمليات المعلقة
  // ==========================================================

  /**
   * يمزج كل العمليات ذات sync_status='pending' في Dexie مع Supabase.
   * يُشغَّل عند عودة الاتصال أو بطلب يدوي.
   *
   * @returns {Promise<{ok: boolean, data?: {synced, failed, total}, error?: string}>}
   */
  async syncAll() {
    if (!isOnline()) return err('لا يوجد اتصال بالإنترنت');
    if (typeof db === 'undefined' || !db.isOpen()) {
      return err('قاعدة البيانات المحلية غير متاحة');
    }

    let synced = 0;
    let failed = 0;

    try {
      const pending = await db.transactions
        .where('sync_status')
        .equals(SYNC_STATUS.PENDING)
        .toArray();

      if (pending.length === 0) {
        // معالجة طابور المزامنة العادي أيضاً
        if (typeof SyncQueue !== 'undefined') {
          await SyncQueue.processQueue();
        }
        return ok({ synced: 0, failed: 0, total: 0 });
      }

      console.log(`🔄 SyncEngine.syncAll: بدء مزامنة ${pending.length} عملية...`);

      // معالجة بترتيب FIFO (حسب created_at)
      const sorted = pending.sort(
        (a, b) => new Date(a.local_timestamp || a.created_at) - new Date(b.local_timestamp || b.created_at)
      );

      for (const op of sorted) {
        const result = await this.syncOperation(op);
        if (isOk(result)) {
          synced++;
        } else {
          failed++;
          console.error(`[SyncEngine] فشل مزامنة العملية ${op.id}:`, result.error);
        }

        // تأخير صغير لمنع تجميد الشبكة
        await _sleep(SYNC_CONFIG.CHUNK_DELAY_MS);
      }

      // معالجة طابور المزامنة الرئيسي بعد الانتهاء
      if (typeof SyncQueue !== 'undefined') {
        await SyncQueue.processQueue();
      }

      console.log(`✅ SyncEngine.syncAll: ${synced} ناجحة, ${failed} فاشلة من ${sorted.length}`);
      return ok({ synced, failed, total: sorted.length });

    } catch (e) {
      return err(formatErrorMessage(e));
    }
  },

  // ==========================================================
  // syncOperation — مزامنة عملية واحدة
  // ==========================================================

  /**
   * يُزامن عملية واحدة مع Supabase.
   * يستخدم idempotency_key لمنع التكرار.
   *
   * @param {object} localOp - السجل من Dexie
   * @returns {Promise<{ok: boolean, data?: *, error?: string}>}
   */
  async syncOperation(localOp) {
    try {
      // تنظيف الحقول الداخلية قبل الإرسال
      const serverPayload = this._cleanForServer(localOp);

      const { data, error } = await supabaseClient
        .from(TABLES.TRANSACTIONS)
        .insert({
          ...serverPayload,
          sync_status : SYNC_STATUS.SYNCED,
          synced_at   : new Date().toISOString(),
        })
        .select()
        .single();

      if (error) {
        // 23505 = unique_violation → عملية موجودة بالفعل (idempotency_key مكرر)
        if (error.code === '23505') {
          await this._markSynced(localOp.id);
          console.log(`[SyncEngine] عملية ${localOp.id}: موجودة بالفعل على الخادم → تجاهل`);
          return ok({ skipped: true, reason: 'already_synced' });
        }

        // تعارض version
        if (error.message?.toLowerCase().includes('version')) {
          const serverOp = await this._fetchByIdempotencyKey(localOp.idempotency_key);
          if (serverOp) {
            const resolution = this.handleConflict(localOp, serverOp);
            if (resolution.action === 'skip') {
              await this._markSynced(localOp.id);
              return ok({ skipped: true, reason: resolution.reason });
            }
            // retry بـ version محدَّث — محاولة واحدة فقط
            const retryPayload = { ...serverPayload, version: resolution.data.version };
            const retry = await supabaseClient
              .from(TABLES.TRANSACTIONS)
              .insert({ ...retryPayload, sync_status: SYNC_STATUS.SYNCED })
              .select()
              .single();
            if (retry.error) return err(formatErrorMessage(retry.error));
            await this._markSynced(localOp.id);
            return ok(retry.data);
          }
        }

        return err(formatErrorMessage(error));
      }

      // ✅ نجاح: تحديث حالة المزامنة في Dexie
      await this._markSynced(localOp.id);
      return ok(data);

    } catch (e) {
      // تسجيل رسالة الخطأ في Dexie (للتشخيص)
      try {
        if (typeof db !== 'undefined' && db.isOpen()) {
          await db.transactions.update(localOp.id, {
            error_message : e.message,
          });
        }
      } catch (dErr) {
        console.warn('[SyncEngine] فشل تسجيل خطأ المزامنة في Dexie:', dErr.message);
      }
      return err(formatErrorMessage(e));
    }
  },

  // ==========================================================
  // handleConflict — حل التعارض (Optimistic Locking)
  // ==========================================================

  /**
   * يحل تعارض version بين النسخة المحلية ونسخة الخادم.
   * القاعدة: إذا كان version الخادم أحدث → نتخلى عن النسخة المحلية.
   *
   * @param {object} localOp  - سجل Dexie
   * @param {object} serverOp - سجل Supabase
   * @returns {{ action: 'skip'|'retry', reason?: string, data?: object }}
   */
  handleConflict(localOp, serverOp) {
    if ((serverOp.version || 1) > (localOp.version || 1)) {
      return {
        action : 'skip',
        reason : 'server_version_newer',
      };
    }

    return {
      action : 'retry',
      data   : { version: (serverOp.version || 1) + 1 },
    };
  },

  // ==========================================================
  // startAutoSync — بدء المزامنة التلقائية
  // ==========================================================

  /**
   * يُشغَّل عند عودة الاتصال أو بطلب يدوي.
   * يُظهر Toast بنتيجة المزامنة.
   *
   * @returns {Promise<{ok: boolean, data?: *, error?: string}>}
   */
  async startAutoSync() {
    if (!isOnline()) return err('لا يوجد اتصال بالإنترنت');

    console.log('🔄 SyncEngine.startAutoSync: بدء المزامنة التلقائية...');

    const result = await this.syncAll();

    if (isOk(result)) {
      const { synced, failed, total } = result.data;
      if (total === 0) {
        console.log('[SyncEngine] لا توجد عمليات معلقة');
      } else if (synced > 0 && typeof showToast === 'function') {
        showToast(
          `تمت مزامنة ${synced} عملية بنجاح` +
          (failed > 0 ? ` (${failed} فاشلة)` : ''),
          failed > 0 ? 'warning' : 'success'
        );
      }
    } else {
      console.error('[SyncEngine] فشل المزامنة التلقائية:', result.error);
      if (typeof showToast === 'function') {
        showToast('فشل المزامنة التلقائية: ' + result.error, 'error', 5000);
      }
    }

    return result;
  },

  // ==========================================================
  // دوال مساعدة خاصة
  // ==========================================================

  /** تنظيف السجل من الحقول الداخلية قبل إرساله للخادم */
  _cleanForServer(record) {
    const cleaned = { ...record };
    delete cleaned.sync_status;
    delete cleaned.error_message;
    delete cleaned._local_only;
    delete cleaned._preEditUpdatedAt;
    return cleaned;
  },

  /** تعيين sync_status = 'synced' في Dexie */
  async _markSynced(id) {
    try {
      if (typeof db !== 'undefined' && db.isOpen()) {
        await db.transactions.update(id, {
          sync_status : SYNC_STATUS.SYNCED,
          synced_at   : new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('[SyncEngine] _markSynced:', e.message);
    }
  },

  /** يجلب سجلاً من الخادم بـ idempotency_key */
  async _fetchByIdempotencyKey(idempotencyKey) {
    try {
      const { data } = await supabaseClient
        .from(TABLES.TRANSACTIONS)
        .select('id, version, idempotency_key')
        .eq('idempotency_key', idempotencyKey)
        .maybeSingle();
      return data || null;
    } catch {
      return null;
    }
  },

};

// ============================================================
// مساعد: sleep
// ============================================================

function _sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================
// الاستماع لأحداث الاتصال — تشغيل المزامنة تلقائياً
// ============================================================

window.addEventListener('app:onlineStatusChange', async (e) => {
  if (e.detail?.online && window.AuthState?.isInitialized) {
    const pending = typeof LocalOperationsService !== 'undefined'
      ? await LocalOperationsService.getPendingCount()
      : 0;

    if (pending > 0) {
      console.log(`🌐 SyncEngine: الاتصال عاد — ${pending} عملية معلقة → بدء المزامنة`);
      await _sleep(800); // تأخير قصير لاستقرار الاتصال
      SyncEngine.startAutoSync();
    }
  }
});

// ============================================================
// تصدير
// ============================================================

window.SyncEngine = SyncEngine;

console.log('✅ SyncEngine.js محمّل — محرك المزامنة جاهز');
