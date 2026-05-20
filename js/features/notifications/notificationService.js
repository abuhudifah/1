// ==========================================
// notificationService.js - خدمة الإشعارات (المنطق والبيانات)
// ==========================================

import { safeNumber, showToast, currentUserName } from '../../utils.js';
import { persistTable, deleteTableRow, cacheTable } from '../../core/repository.js';
import { appendAuditEntry } from '../../core/audit.js';

/**
 * الحصول على قائمة الإشعارات (بدون المحذوفة)
 * @returns {Array}
 */
export function getNotifications() {
    return (window.App.notifications || []).filter(n => !n.deleted_at);
}

/**
 * الحصول على إشعار محدد بواسطة معرفه
 * @param {string} id
 * @returns {Object|null}
 */
export function getNotificationById(id) {
    return getNotifications().find(n => n.id === id) || null;
}

/**
 * الحصول على الإشعارات الموجهة للمستخدم الحالي فقط
 * @returns {Array}
 */
export function getCurrentUserNotifications() {
    const user = window.App?.currentUser;
    if (!user) return [];
    const userId = String(user.id);
    const userRole = user.role;
    
    return getNotifications().filter(n => {
        // إذا كان الإشعار محذوفاً من قبل المستخدم
        if (n.deleted_by) {
            const deletedByArray = Array.isArray(n.deleted_by) ? n.deleted_by : Object.values(n.deleted_by);
            if (deletedByArray.some(id => String(id) === userId)) return false;
        }
        
        // تحديد المستهدفين
        if (n.target === 'all') return true;
        if (n.target === 'admins' && userRole === 'admin') return true;
        if (Array.isArray(n.target) && n.target.some(id => String(id) === userId)) return true;
        if (n.target && String(n.target) === userId) return true;
        
        return false;
    }).sort((a, b) => new Date(b.created_at || b.updated_at || 0) - new Date(a.created_at || a.updated_at || 0));
}

/**
 * حساب عدد الإشعارات غير المقروءة للمستخدم الحالي
 * @returns {number}
 */
export function getUnreadNotificationCount() {
    const user = window.App?.currentUser;
    if (!user) return 0;
    const userId = String(user.id);
    
    return getCurrentUserNotifications().filter(n => {
        const readBy = n.read_by ? (Array.isArray(n.read_by) ? n.read_by : Object.values(n.read_by)) : [];
        return !readBy.some(id => String(id) === userId);
    }).length;
}

/**
 * إنشاء إشعار جديد
 * @param {Object} notificationData - بيانات الإشعار
 * @returns {Promise<Object>}
 */
export async function createNotification(notificationData) {
    const payload = {
        id: crypto.randomUUID(),
        title: notificationData.title,
        body: notificationData.body,
        type: notificationData.type || 'info',
        target: notificationData.target || 'all',
        target_role: notificationData.target === 'admins' ? 'admin' : null,
        sender_name: notificationData.sender_name || currentUserName(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        read_by: notificationData.read_by || [],
        deleted_by: notificationData.deleted_by || []
    };
    
    const saved = await persistTable('notifications', payload);
    if (!window.App.notifications) window.App.notifications = [];
    window.App.notifications.unshift(saved);
    await cacheTable('notifications', window.App.notifications);
    return saved;
}

/**
 * تحديث إشعار (مثل تغيير حالة القراءة أو الحذف)
 * @param {string} id - معرف الإشعار
 * @param {Object} updateData - بيانات التحديث
 * @returns {Promise<Object>}
 */
export async function updateNotification(id, updateData) {
    const existing = getNotificationById(id);
    if (!existing) throw new Error('الإشعار غير موجود');
    
    const updated = {
        ...existing,
        ...updateData,
        updated_at: new Date().toISOString()
    };
    await persistTable('notifications', updated, id);
    const idx = window.App.notifications.findIndex(n => n.id === id);
    if (idx >= 0) window.App.notifications[idx] = updated;
    await cacheTable('notifications', window.App.notifications);
    return updated;
}

/**
 * تحديد إشعار كمقروء للمستخدم الحالي
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function markNotificationRead(id) {
    const notif = getNotificationById(id);
    if (!notif) return false;
    
    const user = window.App?.currentUser;
    if (!user) return false;
    
    const userId = String(user.id);
    const readBy = notif.read_by ? (Array.isArray(notif.read_by) ? [...notif.read_by] : Object.values(notif.read_by)) : [];
    
    if (!readBy.some(uid => String(uid) === userId)) {
        readBy.push(userId);
        await updateNotification(id, { read_by: readBy });
    }
    return true;
}

/**
 * حذف إشعار (للمستخدم: إخفاء; للمدير: حذف دائم)
 * @param {string} id
 * @param {boolean} permanent - هل الحذف دائم (للمدير فقط)
 * @returns {Promise<boolean>}
 */
export async function deleteNotification(id, permanent = false) {
    const notif = getNotificationById(id);
    if (!notif) {
        showToast('الإشعار غير موجود', 'error');
        return false;
    }
    
    const isAdmin = window.App?.currentUser?.role === 'admin';
    
    if (permanent && isAdmin) {
        // حذف دائم من قاعدة البيانات
        await deleteTableRow('notifications', id);
        window.App.notifications = window.App.notifications.filter(n => n.id !== id);
        await cacheTable('notifications', window.App.notifications);
        await appendAuditEntry({
            action: 'delete_notification_permanent',
            table_name: 'notifications',
            record_id: id,
            before_value: { ...notif },
            after_value: null,
            source: 'app'
        });
        showToast('تم حذف الإشعار بشكل دائم ✅', 'success');
        return true;
    }
    
    // حذف ناعم: إضافة المستخدم إلى قائمة deleted_by
    const user = window.App?.currentUser;
    if (!user) return false;
    
    const userId = String(user.id);
    const deletedBy = notif.deleted_by ? (Array.isArray(notif.deleted_by) ? [...notif.deleted_by] : Object.values(notif.deleted_by)) : [];
    
    if (!deletedBy.some(uid => String(uid) === userId)) {
        deletedBy.push(userId);
        await updateNotification(id, { deleted_by: deletedBy });
        showToast('تم إخفاء الإشعار ✅', 'success');
    }
    return true;
}

/**
 * تحديد جميع الإشعارات الغير مقروءة كمقروءة للمستخدم الحالي
 * @returns {Promise<number>}
 */
export async function markAllNotificationsRead() {
    const unread = getCurrentUserNotifications().filter(n => {
        const user = window.App?.currentUser;
        if (!user) return false;
        const userId = String(user.id);
        const readBy = n.read_by ? (Array.isArray(n.read_by) ? n.read_by : Object.values(n.read_by)) : [];
        return !readBy.some(id => String(id) === userId);
    });
    
    let count = 0;
    for (const n of unread) {
        await markNotificat.ionRead(n.id);
        count++;
    }
    return count;
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.getNotifications = getNotifications;
    window.getNotificationById = getNotificationById;
    window.getCurrentUserNotifications = getCurrentUserNotifications;
    window.getUnreadNotificationCount = getUnreadNotificationCount;
    window.createNotification = createNotification;
    window.updateNotification = updateNotification;
    window.markNotificationRead = markNotificationRead;
    window.deleteNotification = deleteNotification;
    window.markAllNotificationsRead = markAllNotificationsRead;
}
