// ==========================================
// notificationUI.js - عرض الإشعارات في واجهة المستخدم
// ==========================================

import { escapeHtml, showToast, isAdmin, currentUserName } from '../../utils.js';
import { 
    getCurrentUserNotifications, 
    getUnreadNotificationCount, 
    markNotificationRead, 
    deleteNotification,
    markAllNotificationsRead,
    createNotification 
} from './notificationService.js';

/**
 * تحديث عرض الإشعارات في الواجهة (القائمة والشارات)
 */
export function renderNotifications() {
    const list = document.getElementById('notifications-list');
    if (!list) return;
    
    const filterUnread = document.getElementById('filter-notif-unread');
    const showUnreadOnly = filterUnread?.classList.contains('bg-blue-100') || filterUnread?.dataset.active === '1';
    
    let visible = getCurrentUserNotifications();
    if (showUnreadOnly) {
        visible = visible.filter(n => {
            const user = window.App?.currentUser;
            if (!user) return false;
            const userId = String(user.id);
            const readBy = n.read_by ? (Array.isArray(n.read_by) ? n.read_by : Object.values(n.read_by)) : [];
            return !readBy.some(id => String(id) === userId);
        });
    }
    
    const unreadCount = getUnreadNotificationCount();
    updateNotificationBadges(unreadCount);
    
    if (visible.length === 0) {
        list.innerHTML = '<div class="text-center text-gray-500 py-10"><i class="fas fa-inbox text-4xl mb-3 opacity-50"></i><p>لا توجد إشعارات حالياً</p></div>';
        return;
    }
    
    list.innerHTML = visible.map(n => {
        const user = window.App?.currentUser;
        const userId = user ? String(user.id) : '';
        const readBy = n.read_by ? (Array.isArray(n.read_by) ? n.read_by : Object.values(n.read_by)) : [];
        const isRead = readBy.some(id => String(id) === userId);
        
        const typeColors = { urgent: 'text-red-600', info: 'text-blue-600', system: 'text-purple-600' };
        const colorClass = typeColors[n.type] || 'text-gray-600';
        const iconClass = n.type === 'urgent' ? 'fa-exclamation-triangle' : (n.type === 'system' ? 'fa-cog' : 'fa-bell');
        
        const adminDeleteBtn = isAdmin() 
            ? `<button onclick="window.adminForceDeleteNotification && window.adminForceDeleteNotification('${escapeHtml(n.id)}')" class="text-xs bg-red-600 hover:bg-red-700 text-white px-2 py-1 rounded-lg transition ml-1" title="حذف دائم من قاعدة البيانات">
                  <i class="fas fa-trash-alt"></i> حذف دائم
               </button>`
            : '';
        
        return `
        <div class="notification-item ${!isRead ? 'unread' : ''} glass-card mb-2 rounded-lg border border-gray-100 shadow-sm transition-all duration-200">
            <div class="flex justify-between items-start">
                <div class="flex gap-3 flex-1">
                    <div class="mt-1 ${colorClass}">
                        <i class="fas ${iconClass} text-xl"></i>
                    </div>
                    <div class="flex-1">
                        <h4 class="font-bold text-gray-800">${escapeHtml(n.title) || 'بدون عنوان'}</h4>
                        <p class="text-sm text-gray-600 mt-1 whitespace-pre-line">${escapeHtml(n.body) || ''}</p>
                        <span class="text-xs text-gray-400 mt-2 block"><i class="fas fa-clock ml-1"></i> ${formatNotificationDate(n.created_at)} - من: ${escapeHtml(n.sender_name) || 'النظام'}</span>
                    </div>
                </div>
                <div class="flex flex-col gap-2 min-w-[110px] text-left">
                    <div class="flex gap-1 justify-end">
                        ${!isRead ? `<button onclick="window.markNotifRead && window.markNotifRead('${escapeHtml(n.id)}')" class="text-xs text-blue-600 font-bold hover:underline border border-blue-200 px-2 py-1 rounded bg-blue-50 transition">كمقروء ✓</button>` : ''}
                        <button onclick="window.deleteNotif && window.deleteNotif('${escapeHtml(n.id)}')" class="text-xs text-gray-500 font-bold hover:underline border border-gray-200 px-2 py-1 rounded bg-gray-50 transition">إخفاء ✗</button>
                        ${adminDeleteBtn}
                    </div>
                </div>
            </div>
        </div>`;
    }).join('');
}

/**
 * تحديث شارات الإشعارات (في زر الجرس وفي القائمة السفلية للجوال)
 * @param {number} count
 */
function updateNotificationBadges(count) {
    const desktopBadge = document.getElementById('notification-badge');
    const mobileBadge = document.getElementById('mobile-notification-badge');
    
    if (desktopBadge && mobileBadge) {
        if (count > 0) {
            desktopBadge.textContent = count > 99 ? '+99' : count;
            desktopBadge.classList.remove('hidden');
            mobileBadge.textContent = count > 99 ? '+99' : count;
            mobileBadge.classList.remove('hidden');
        } else {
            desktopBadge.classList.add('hidden');
            mobileBadge.classList.add('hidden');
        }
    }
}

/**
 * تنسيق تاريخ الإشعار للعرض
 * @param {string} dateStr
 * @returns {string}
 */
function formatNotificationDate(dateStr) {
    if (!dateStr) return 'الآن';
    try {
        return new Date(dateStr).toLocaleString('ar-EG');
    } catch {
        return dateStr;
    }
}

/**
 * فتح نافذة إرسال إشعار جديد (للمدير فقط أو للمندوب للإبلاغ)
 * @param {string} mode - 'admin' أو 'report'
 */
export function openSecureNotificationModal(mode) {
    const modal = document.getElementById('notification-modal');
    const targetGroup = document.getElementById('notif-target-group');
    const titleEl = document.getElementById('notification-modal-title');
    const targetType = document.getElementById('notif-target-type');
    const customUsersList = document.getElementById('custom-users-list');
    
    if (!modal) return;
    
    document.getElementById('notification-form')?.reset();
    if (customUsersList) {
        customUsersList.classList.add('hidden');
        customUsersList.innerHTML = '<p class="text-center py-2 text-blue-500">جاري جلب قائمة المستخدمين...</p>';
    }
    
    if (isAdmin() && mode === 'admin') {
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-paper-plane text-yellow-500 ml-2"></i> إرسال إشعار جديد';
        if (targetGroup) targetGroup.classList.remove('hidden');
        if (targetType) {
            targetType.value = 'all';
            targetType.disabled = false;
        }
        loadUsersForNotificationList();
    } else {
        if (titleEl) titleEl.innerHTML = '<i class="fas fa-headset text-yellow-500 ml-2"></i> إرسال رسالة للإدارة';
        if (targetGroup) targetGroup.classList.add('hidden');
        if (targetType) {
            targetType.value = 'admins';
            targetType.disabled = true;
        }
    }
    
    modal.classList.remove('hidden');
}

/**
 * تحميل قائمة المستخدمين لنافذة الإشعارات (للمدير)
 */
async function loadUsersForNotificationList() {
    const customUsersList = document.getElementById('custom-users-list');
    if (!customUsersList) return;
    
    try {
        let usersToDisplay = [];
        
        if (window.navigator.onLine && window.supabaseClient) {
            const { data, error } = await window.supabaseClient.from('users').select('id, username, display_name, role').is('deleted_at', null);
            if (!error && data) usersToDisplay = data;
        } else if (window.App?.users) {
            usersToDisplay = window.App.users.filter(u => !u.deleted_at);
        }
        
        const currentUserId = window.App?.currentUser?.id;
        const otherUsers = usersToDisplay.filter(u => String(u.id) !== String(currentUserId));
        
        if (otherUsers.length > 0) {
            customUsersList.innerHTML = otherUsers.map(u => `
                <label class="flex items-center gap-3 cursor-pointer p-3 hover:bg-blue-50 rounded-lg transition border border-gray-100 shadow-sm mb-2">
                    <input type="checkbox" value="${escapeHtml(u.id)}" class="custom-user-checkbox w-5 h-5 text-blue-600 rounded">
                    <div class="flex flex-col">
                        <span class="font-bold text-gray-800">${escapeHtml(u.display_name || u.username)}</span>
                        <span class="text-xs ${u.role === 'admin' ? 'text-purple-600 font-bold' : 'text-gray-500'}">${u.role === 'admin' ? 'مدير' : 'مندوب'}</span>
                    </div>
                </label>
            `).join('');
        } else {
            customUsersList.innerHTML = '<p class="text-center py-4 text-gray-500">لا يوجد مستخدمون آخرون.</p>';
        }
    } catch (error) {
        console.error('خطأ في جلب المستخدمين:', error);
        customUsersList.innerHTML = '<p class="text-center py-4 text-red-500">فشل التحميل، حاول مرة أخرى.</p>';
    }
}

/**
 * إرسال إشعار جديد (معالج النموذج)
 * @param {Event} event
 * @returns {Promise<boolean>}
 */
export async function handleSendNotification(event) {
    event.preventDefault();
    
    if (!isAdmin()) {
        showToast('الإشعارات الإدارية متاحة للمدير فقط', 'error');
        return false;
    }
    
    const targetTypeSelect = document.getElementById('notif-target-type');
    let finalTarget = targetTypeSelect?.value || 'all';
    
    if (finalTarget === 'specific') {
        const checkedBoxes = document.querySelectorAll('.custom-user-checkbox:checked');
        finalTarget = Array.from(checkedBoxes).map(cb => cb.value);
        if (finalTarget.length === 0) {
            showToast('الرجاء تحديد مستخدم واحد على الأقل!', 'error');
            return false;
        }
    }
    
    const btn = document.getElementById('notif-btn-text');
    const spinner = document.getElementById('notif-spinner');
    const originalText = btn?.textContent || 'إرسال';
    if (btn) btn.textContent = 'جاري الإرسال...';
    if (spinner) spinner.classList.remove('hidden');
    
    try {
        const notifData = {
            title: document.getElementById('notif-title')?.value || '',
            body: document.getElementById('notif-body')?.value || '',
            type: 'info',
            target: finalTarget,
            sender_name: currentUserName(),
            read_by: [],
            deleted_by: []
        };
        
        if (!notifData.title || !notifData.body) {
            showToast('الرجاء إدخال عنوان ونص الإشعار', 'warning');
            return false;
        }
        
        await createNotification(notifData);
        showToast('تم إرسال الإشعار بنجاح ✅', 'success');
        
        // إغلاق النافذة
        const modal = document.getElementById('notification-modal');
        if (modal) modal.classList.add('hidden');
        document.getElementById('notification-form')?.reset();
        
        // تحديث واجهة الإشعارات
        renderNotifications();
        return true;
    } catch (error) {
        console.error('فشل إرسال الإشعار:', error);
        showToast('فشل إرسال الإشعار: ' + error.message, 'error');
        return false;
    } finally {
        if (btn) btn.textContent = originalText;
        if (spinner) spinner.classList.add('hidden');
    }
}

/**
 * حذف إشعار نهائياً (للمدير فقط)
 * @param {string} notifId
 */
export async function adminForceDeleteNotification(notifId) {
    if (!isAdmin()) {
        showToast('غير مصرح: هذه الخاصية للمدير فقط', 'error');
        return;
    }
    
    const confirmed = confirm('⚠️ هل أنت متأكد من حذف هذا الإشعار بشكل دائم؟ لا يمكن التراجع عن هذا الإجراء.');
    if (!confirmed) return;
    
    try {
        await deleteNotification(notifId, true);
        renderNotifications();
    } catch (error) {
        showToast('فشل الحذف: ' + error.message, 'error');
    }
}

/**
 * حذف جميع الإشعارات نهائياً (للمدير فقط)
 */
export async function adminClearAllNotifications() {
    if (!isAdmin()) {
        showToast('غير مصرح', 'error');
        return;
    }
    
    const notifications = getCurrentUserNotifications();
    const total = notifications.length;
    if (total === 0) {
        showToast('لا توجد إشعارات لحذفها', 'info');
        return;
    }
    
    const confirmed = confirm(`⚠️ هل أنت متأكد من حذف جميع الإشعارات (${total} إشعار) بشكل دائم؟ هذا الإجراء لا يمكن التراجع عنه.`);
    if (!confirmed) return;
    
    let deletedCount = 0;
    for (const n of notifications) {
        try {
            await deleteNotification(n.id, true);
            deletedCount++;
        } catch (e) {
            console.warn('فشل حذف الإشعار:', n.id, e);
        }
    }
    showToast(`✅ تم حذف ${deletedCount} إشعار بشكل دائم`, 'success');
    renderNotifications();
}

// ربط أحداث الفلاتر والأزرار
export function bindNotificationUIEvents() {
    const filterAllBtn = document.getElementById('filter-notif-all');
    const filterUnreadBtn = document.getElementById('filter-notif-unread');
    const markAllReadBtn = document.getElementById('mark-all-read-btn');
    const bellBtn = document.getElementById('notification-bell-btn');
    const sendBtn = document.getElementById('admin-send-notification-btn');
    const reportBtn = document.getElementById('report-issue-btn');
    const closeModalBtn = document.getElementById('close-notification-modal');
    const notificationForm = document.getElementById('notification-form');
    
    if (filterAllBtn) {
        filterAllBtn.addEventListener('click', () => {
            filterAllBtn.classList.replace('bg-white', 'bg-blue-100');
            filterAllBtn.classList.replace('text-gray-600', 'text-blue-800');
            filterAllBtn.classList.remove('border', 'border-gray-200');
            if (filterUnreadBtn) {
                filterUnreadBtn.classList.replace('bg-blue-100', 'bg-white');
                filterUnreadBtn.classList.replace('text-blue-800', 'text-gray-600');
                filterUnreadBtn.classList.add('border', 'border-gray-200');
            }
            renderNotifications();
        });
    }
    
    if (filterUnreadBtn) {
        filterUnreadBtn.addEventListener('click', () => {
            filterUnreadBtn.classList.replace('bg-white', 'bg-blue-100');
            filterUnreadBtn.classList.replace('text-gray-600', 'text-blue-800');
            filterUnreadBtn.classList.remove('border', 'border-gray-200');
            if (filterAllBtn) {
                filterAllBtn.classList.replace('bg-blue-100', 'bg-white');
                filterAllBtn.classList.replace('text-blue-800', 'text-gray-600');
                filterAllBtn.classList.add('border', 'border-gray-200');
            }
            renderNotifications();
        });
    }
    
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', async () => {
            const count = await markAllNotificationsRead();
            if (count > 0) showToast(`تم تحديد ${count} إشعار كمقروء ✅`, 'success');
            renderNotifications();
        });
    }
    
    if (bellBtn) {
        const newBell = bellBtn.cloneNode(true);
        bellBtn.parentNode?.replaceChild(newBell, bellBtn);
        newBell.addEventListener('click', (e) => {
            e.preventDefault();
            if (typeof window.switchTab === 'function') window.switchTab('notifications-view');
            renderNotifications();
        });
    }
    
    if (sendBtn) {
        const newSendBtn = sendBtn.cloneNode(true);
        sendBtn.parentNode?.replaceChild(newSendBtn, sendBtn);
        newSendBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openSecureNotificationModal('admin');
        });
    }
    
    if (reportBtn) {
        const newReportBtn = reportBtn.cloneNode(true);
        reportBtn.parentNode?.replaceChild(newReportBtn, reportBtn);
        newReportBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openSecureNotificationModal('report');
        });
    }
    
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', () => {
            document.getElementById('notification-modal')?.classList.add('hidden');
        });
    }
    
    if (notificationForm) {
        notificationForm.addEventListener('submit', handleSendNotification);
    }
    
    const targetTypeSelect = document.getElementById('notif-target-type');
    if (targetTypeSelect) {
        targetTypeSelect.addEventListener('change', function() {
            const customUsersList = document.getElementById('custom-users-list');
            if (this.value === 'specific') {
                customUsersList?.classList.remove('hidden');
            } else {
                customUsersList?.classList.add('hidden');
                document.querySelectorAll('.custom-user-checkbox').forEach(cb => cb.checked = false);
            }
        });
    }
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.renderNotifications = renderNotifications;
    window.openSecureNotificationModal = openSecureNotificationModal;
    window.adminForceDeleteNotification = adminForceDeleteNotification;
    window.adminClearAllNotifications = adminClearAllNotifications;
    window.markNotifRead = markNotificationRead;
    window.deleteNotif = (id) => deleteNotification(id, false);
    window.bindNotificationUIEvents = bindNotificationUIEvents;
          }
