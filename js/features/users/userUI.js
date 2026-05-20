// ==========================================
// userUI.js - عرض وإدارة المستخدمين في واجهة المستخدم
// ==========================================

import { escapeHtml, showToast, isAdmin, currentUserName } from '../../utils.js';
import { getUsers, createUser, updateUser, deleteUser, hashPassword } from './userService.js';

/**
 * عرض جدول المستخدمين في واجهة الإدارة
 */
export function renderUsersTable() {
    const tbody = document.getElementById('users-table-body');
    if (!tbody) return;

    if (!isAdmin()) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-500 py-10">غير متاح حالياً (يتطلب دور مدير)</td></tr>';
        return;
    }

    const users = getUsers();
    if (users.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-500 py-10">لا يوجد مستخدمون</td></tr>';
        return;
    }

    tbody.innerHTML = users.map(u => {
        const roleName = u.role === 'admin' ? 'مدير' : 'مندوب';
        const roleClass = u.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700';
        return `
        <tr class="border-b border-gray-100 hover:bg-gray-50 transition">
            <td class="p-3 font-bold text-gray-800">${escapeHtml(u.display_name || 'بدون اسم')}</td>
            <td class="p-3 font-mono text-left text-sm" dir="ltr">${escapeHtml(u.username || '')}</td>
            <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${roleClass}">${escapeHtml(roleName)}</span></td>
            <td class="p-3 font-mono text-left text-xs" dir="ltr">${escapeHtml(u.quick_eq || '—')}</td>
            <td class="p-3 text-center">
                <div class="flex justify-center gap-2">
                    <button type="button" class="text-blue-600 hover:text-blue-800 bg-blue-50 px-2 py-1 rounded text-sm transition" data-edit-user="${escapeHtml(u.id)}">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button type="button" class="text-red-600 hover:text-red-800 bg-red-50 px-2 py-1 rounded text-sm transition" data-delete-user="${escapeHtml(u.id)}">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </td>
        </tr>`;
    }).join('');
}

/**
 * فتح نافذة إضافة/تعديل مستخدم
 * @param {string|null} userId - معرف المستخدم للتعديل، أو null للإضافة
 */
export function openUserModal(userId = null) {
    const modal = document.getElementById('user-modal');
    const title = document.getElementById('user-modal-title');
    const editIdField = document.getElementById('user-edit-id');
    const displayNameField = document.getElementById('user-display-name');
    const usernameField = document.getElementById('user-username');
    const passwordField = document.getElementById('user-password');
    const roleField = document.getElementById('user-role');
    const quickEqField = document.getElementById('user-quick-eq');
    const passwordHint = document.getElementById('user-password-hint');
    const submitBtn = document.getElementById('user-btn-text');

    if (!modal) return;

    // إعادة تعيين النموذج
    const form = document.getElementById('user-form');
    if (form) form.reset();

    if (userId) {
        // وضع التعديل
        const user = getUsers().find(u => u.id === userId);
        if (!user) {
            showToast('المستخدم غير موجود', 'error');
            return;
        }
        if (title) title.textContent = 'تعديل مستخدم';
        if (editIdField) editIdField.value = user.id;
        if (displayNameField) displayNameField.value = user.display_name || '';
        if (usernameField) usernameField.value = user.username || '';
        if (passwordField) passwordField.value = '';
        if (roleField) roleField.value = user.role || 'agent';
        if (quickEqField) quickEqField.value = user.quick_eq || '';
        if (passwordHint) passwordHint.textContent = 'اتركه فارغاً إذا لم ترغب بتغييره.';
        if (submitBtn) submitBtn.textContent = 'تحديث المستخدم';
    } else {
        // وضع الإضافة
        if (title) title.textContent = 'إضافة مستخدم جديد';
        if (editIdField) editIdField.value = '';
        if (passwordHint) passwordHint.textContent = 'كلمة المرور مطلوبة للمستخدم الجديد.';
        if (submitBtn) submitBtn.textContent = 'إضافة المستخدم';
    }

    modal.classList.remove('hidden');
}

/**
 * إغلاق نافذة المستخدم
 */
export function closeUserModal() {
    const modal = document.getElementById('user-modal');
    if (modal) modal.classList.add('hidden');
    const form = document.getElementById('user-form');
    if (form) form.reset();
    const editIdField = document.getElementById('user-edit-id');
    if (editIdField) editIdField.value = '';
}

/**
 * معالج حفظ المستخدم (إضافة أو تعديل)
 * @param {Event} event
 * @returns {Promise<boolean>}
 */
export async function handleUserSave(event) {
    event.preventDefault();

    if (!isAdmin()) {
        showToast('غير مصرح لك بهذه العملية', 'error');
        return false;
    }

    const editId = document.getElementById('user-edit-id')?.value || '';
    const displayName = document.getElementById('user-display-name')?.value.trim() || '';
    const username = (document.getElementById('user-username')?.value || '').trim().toLowerCase();
    const password = document.getElementById('user-password')?.value || '';
    const role = document.getElementById('user-role')?.value || 'agent';
    const quickEq = document.getElementById('user-quick-eq')?.value.trim() || '';

    if (!displayName || !username) {
        showToast('أدخل الاسم واسم المستخدم', 'warning');
        return false;
    }

    // التحقق من عدم تكرار اسم المستخدم
    const existingUsers = getUsers();
    const duplicate = existingUsers.find(u => u.username === username && u.id !== editId);
    if (duplicate) {
        showToast('اسم المستخدم موجود مسبقاً', 'error');
        return false;
    }

    // إذا كانت إضافة جديدة، كلمة المرور مطلوبة
    if (!editId && !password) {
        showToast('كلمة المرور مطلوبة للمستخدم الجديد', 'error');
        return false;
    }

    const btn = document.getElementById('user-btn-text');
    const spinner = document.getElementById('user-spinner');
    const originalText = btn?.textContent || 'حفظ';

    if (btn) btn.textContent = 'جاري الحفظ...';
    if (spinner) spinner.classList.remove('hidden');

    try {
        if (editId) {
            // تحديث مستخدم موجود
            const updateData = {
                display_name: displayName,
                username: username,
                role: role,
                quick_eq: quickEq || null
            };
            if (password) updateData.password = password;
            await updateUser(editId, updateData);
            showToast('تم تعديل المستخدم بنجاح ✅', 'success');
        } else {
            // إضافة مستخدم جديد
            await createUser({
                display_name: displayName,
                username: username,
                password: password,
                role: role,
                quick_eq: quickEq || null
            });
            showToast('تمت إضافة المستخدم بنجاح ✅', 'success');
        }

        closeUserModal();
        renderUsersTable();

        // تحديث قائمة المندوبين في الفلاتر إذا لزم الأمر
        if (typeof window.updateAllOperationsTable === 'function') {
            window.updateAllOperationsTable();
        }
        return true;
    } catch (error) {
        console.error('فشل الحفظ:', error);
        showToast('فشل الحفظ: ' + (error?.message || 'خطأ غير معروف'), 'error');
        return false;
    } finally {
        if (btn) btn.textContent = originalText;
        if (spinner) spinner.classList.add('hidden');
    }
}

/**
 * تحرير مستخدم (فتح النافذة مع تعبئة البيانات)
 * @param {string} id
 */
export function editUser(id) {
    if (!isAdmin()) {
        showToast('غير مصرح', 'error');
        return;
    }
    openUserModal(id);
}

/**
 * حذف مستخدم (مع تأكيد)
 * @param {string} id
 */
export async function deleteUserById(id) {
    if (!isAdmin()) {
        showToast('غير مصرح', 'error');
        return;
    }

    const user = getUsers().find(u => u.id === id);
    if (!user) {
        showToast('المستخدم غير موجود', 'error');
        return;
    }

    const confirmed = confirm(`هل أنت متأكد من حذف المستخدم "${user.display_name || user.username}"؟`);
    if (!confirmed) return;

    await deleteUser(id);
    renderUsersTable();

    // تحديث قائمة المندوبين في الفلاتر
    if (typeof window.updateAllOperationsTable === 'function') {
        window.updateAllOperationsTable();
    }
}

/**
 * ربط أحداث واجهة المستخدمين
 */
export function bindUserUIEvents() {
    const addUserBtn = document.getElementById('add-user-btn');
    const closeModalBtn = document.getElementById('close-user-modal');
    const userForm = document.getElementById('user-form');

    if (addUserBtn) {
        addUserBtn.addEventListener('click', () => openUserModal());
    }
    if (closeModalBtn) {
        closeModalBtn.addEventListener('click', closeUserModal);
    }
    if (userForm) {
        userForm.addEventListener('submit', handleUserSave);
    }
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.renderUsersTable = renderUsersTable;
    window.openUserModal = openUserModal;
    window.closeUserModal = closeUserModal;
    window.handleUserSave = handleUserSave;
    window.editUser = editUser;
    window.deleteUserById = deleteUserById;
    window.bindUserUIEvents = bindUserUIEvents;
}
