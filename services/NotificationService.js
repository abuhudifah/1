'use strict';

/**
 * services/NotificationService.js — v1.0
 * خدمة إرسال الإشعارات الداخلية (جدول notifications)
 *
 * ملاحظة: جدول notifications لا يحتوي عمود metadata؛ لذا تُدمج البيانات
 * الإضافية (إن وُجدت) داخل نص الإشعار فقط، ولا تُرسَل كعمود مستقل.
 */
const NotificationService = (() => {

  /**
   * يُرسل إشعاراً داخلياً لمستخدم محدد
   * @param {string} userId - معرف المستخدم المستهدف
   * @param {string} title  - عنوان الإشعار
   * @param {string} body   - نص الإشعار
   * @param {object} [opts] - { type:'info'|'success'|'warning'|'error', metadata }
   * @returns {Promise<{ok:boolean,data?:any,error?:string}>}
   */
  async function sendNotification(userId, title, body, opts = {}) {
    if (!userId) return err('معرف المستخدم المستهدف مطلوب');
    if (!title)  return err('عنوان الإشعار مطلوب');

    const senderId = (typeof AuthService !== 'undefined') ? AuthService.getCurrentUserId() : null;
    const type = ['info', 'success', 'warning', 'error'].includes(opts.type) ? opts.type : 'info';

    const notif = {
      title : String(title),
      body  : String(body || ''),
      type,
      target: [userId],
      sender_id: senderId,
      read_by  : [],
      hidden_by: [],
    };

    try {
      let result;
      if (typeof repo !== 'undefined' && repo.create) {
        result = await repo.create(TABLES.NOTIFICATIONS, notif);
      } else if (typeof supabaseClient !== 'undefined') {
        const { data, error } = await supabaseClient.from(TABLES.NOTIFICATIONS).insert(notif).select().single();
        result = error ? err(error.message) : ok(data);
      } else {
        return err('لا توجد وسيلة لإرسال الإشعار');
      }

      if (isOk(result)) {
        window.dispatchEvent(new CustomEvent('store:notificationsUpdated'));
      }
      return result;
    } catch (e) {
      return err(`فشل إرسال الإشعار: ${e.message}`);
    }
  }

  /**
   * إشعار مشاركة رقم حساب — يُستخدم من أزرار نسخ رقم الحساب (للمدير/المساعد)
   * @param {string} userId - المستلم
   * @param {string} entityName - اسم الحساب/الشركة/البنك
   * @param {string} accountNumber - رقم الحساب
   */
  async function shareAccountNumber(userId, entityName, accountNumber) {
    const senderName = (typeof AuthService !== 'undefined')
      ? (AuthService.getCurrentUser()?.display_name || 'المدير') : 'المدير';
    return sendNotification(
      userId,
      `رقم حساب ${entityName || ''}`.trim(),
      `تم مشاركة رقم الحساب ${accountNumber} معك بواسطة ${senderName}.`,
      { type: 'info' }
    );
  }

  return { sendNotification, shareAccountNumber };
})();

window.NotificationService = NotificationService;
console.log('✅ NotificationService.js محمّل');
