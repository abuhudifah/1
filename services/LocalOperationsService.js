/**
 * services/LocalOperationsService.js
 * نظام أبو حذيفة — المرحلة 2B
 *
 * مسؤولية هذا الملف: حفظ العمليات المالية محلياً (Dexie) في وضع Offline.
 * كل عملية محلية تحصل على:
 *   - idempotency_key فريد → يمنع التكرار عند المزامنة
 *   - local_timestamp → وقت الإنشاء على الجهاز
 *   - sync_status = 'pending' → تتغير لـ 'synced' بعد المزامنة
 *
 * القواعد الصارمة:
 * - لا eval()، لا catch {} فارغة
 * - Validation صارم قبل الحفظ
 * - الكتابة في db.transactions مباشرة (الجدول الموحَّد)
 */

'use strict';

// ============================================================
// LocalOperationsService
// ============================================================

const LocalOperationsService = {

  // ==========================================================
  // Validation — التحقق من صحة العملية
  // ==========================================================

  /**
   * يتحقق من صحة عملية مالية قبل الحفظ.
   * @param {object} operation
   * @returns {{ valid: boolean, error?: string }}
   */
  validateOperation(operation) {
    if (!operation)                              return { valid: false, error: 'بيانات العملية مطلوبة' };
    if (!operation.type)                         return { valid: false, error: 'نوع العملية مطلوب' };
    if (!TRANSACTION_TYPES[operation.type.toUpperCase()] &&
        !Object.values(TRANSACTION_TYPES).includes(operation.type)) {
      return { valid: false, error: `نوع العملية غير معروف: ${operation.type}` };
    }

    const amount = Number(operation.amount);
    if (!operation.amount || isNaN(amount) || amount < AMOUNT_CONFIG.MIN) {
      return { valid: false, error: `المبلغ يجب أن يكون أكبر من ${AMOUNT_CONFIG.MIN}` };
    }
    if (amount > AMOUNT_CONFIG.MAX) {
      return { valid: false, error: `المبلغ يتجاوز الحد الأقصى ${AMOUNT_CONFIG.MAX.toLocaleString()} ر.س` };
    }
    if (!operation.user_id) {
      return { valid: false, error: 'معرف المستخدم مطلوب' };
    }
    if (!operation.date) {
      return { valid: false, error: 'تاريخ العملية مطلوب' };
    }

    // قواعد خاصة بالنوع
    if (operation.type === TRANSACTION_TYPES.COLLECTION && !operation.debtor_id) {
      return { valid: false, error: 'معرف المدين مطلوب لعملية التحصيل' };
    }
    if (operation.type === TRANSACTION_TYPES.DEPOSIT && !operation.bank_account_id) {
      return { valid: false, error: 'الحساب البنكي مطلوب لعملية الإيداع' };
    }
    if (operation.type === TRANSACTION_TYPES.BANK_WITHDRAWAL && !operation.bank_account_id) {
      return { valid: false, error: 'الحساب البنكي مطلوب لعملية السحب' };
    }

    return { valid: true };
  },

  // ==========================================================
  // حفظ عملية محلية
  // ==========================================================

  /**
   * يحفظ عملية مالية في Dexie ويضيفها لطابور المزامنة.
   * يُضيف idempotency_key و local_timestamp تلقائياً.
   *
   * @param {object} operation - بيانات العملية (type, amount, user_id, date, ...)
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  async saveLocalOperation(operation) {
    // 1. Validation
    const validation = this.validateOperation(operation);
    if (!validation.valid) return err(validation.error);

    // 2. التحقق من توفر Dexie
    if (typeof db === 'undefined' || !db.isOpen()) {
      return err('قاعدة البيانات المحلية غير متاحة — تعذّر حفظ العملية');
    }

    // 3. بناء السجل المحلي
    const localOp = {
      ...operation,
      id               : operation.id || crypto.randomUUID(),
      idempotency_key  : crypto.randomUUID(),     // فريد لمنع التكرار
      local_timestamp  : new Date().toISOString(), // وقت الجهاز
      device_id        : getDeviceToken(),
      sync_status      : SYNC_STATUS.PENDING,
      created_at       : operation.created_at || new Date().toISOString(),
    };

    try {
      // 4. الحفظ في Dexie (جدول transactions الموحَّد)
      await db.transactions.add(localOp);

      // 5. إضافة لطابور المزامنة (سيعمل عند عودة الاتصال)
      if (typeof SyncQueue !== 'undefined') {
        await SyncQueue.add(
          SYNC_ACTIONS.CREATE,
          TABLES.TRANSACTIONS,
          localOp.id,
          localOp
        );
      }

      console.log(`✅ LocalOperationsService: عملية محفوظة (id=${localOp.id}, type=${localOp.type})`);
      return ok(localOp);

    } catch (e) {
      if (e.name === 'ConstraintError') {
        return err('العملية موجودة بالفعل في قاعدة البيانات المحلية');
      }
      return err('فشل حفظ العملية محلياً: ' + e.message);
    }
  },

  // ==========================================================
  // جلب العمليات المعلقة
  // ==========================================================

  /**
   * يجلب كل العمليات المحلية غير المتزامنة.
   * @returns {Promise<{ok: boolean, data?: Array, error?: string}>}
   */
  async getLocalOperations() {
    try {
      if (typeof db === 'undefined' || !db.isOpen()) return ok([]);

      const ops = await db.transactions
        .where('sync_status')
        .equals(SYNC_STATUS.PENDING)
        .toArray();

      return ok(ops);
    } catch (e) {
      return err('فشل جلب العمليات المحلية: ' + e.message);
    }
  },

  // ==========================================================
  // حذف عملية محلية
  // ==========================================================

  /**
   * يحذف عملية محلية (للإلغاء قبل المزامنة).
   * @param {string} id - UUID العملية
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async deleteLocalOperation(id) {
    if (!id) return err('معرف العملية مطلوب');

    try {
      if (typeof db === 'undefined' || !db.isOpen()) {
        return err('قاعدة البيانات المحلية غير متاحة');
      }

      await db.transactions.delete(id);

      // حذف من طابور المزامنة أيضاً (إن وُجد)
      if (typeof db.sync_queue !== 'undefined') {
        const queueItems = await db.sync_queue
          .where('record_id')
          .equals(id)
          .toArray();
        if (queueItems.length > 0) {
          await db.sync_queue.bulkDelete(queueItems.map(q => q.id));
        }
      }

      console.log(`✅ LocalOperationsService: عملية محذوفة (id=${id})`);
      return ok(true);

    } catch (e) {
      return err('فشل حذف العملية: ' + e.message);
    }
  },

  // ==========================================================
  // إحصائيات
  // ==========================================================

  /**
   * يُعيد عدد العمليات المعلقة.
   * @returns {Promise<number>}
   */
  async getPendingCount() {
    try {
      if (typeof db === 'undefined' || !db.isOpen()) return 0;
      return await db.transactions
        .where('sync_status')
        .equals(SYNC_STATUS.PENDING)
        .count();
    } catch (e) {
      console.warn('⚠️ getPendingCount:', e.message);
      return 0;
    }
  },

};

// ============================================================
// تصدير
// ============================================================

window.LocalOperationsService = LocalOperationsService;

console.log('✅ LocalOperationsService.js محمّل — نظام العمليات المحلية جاهز');
