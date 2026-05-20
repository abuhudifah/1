// ==========================================
// userService.js - خدمة المستخدمين (المنطق والبيانات)
// ==========================================

import { safeNumber, showToast, currentUserName } from '../../utils.js';
import { persistTable, deleteTableRow, cacheTable } from '../../core/repository.js';
import { appendAuditEntry } from '../../core/audit.js';

/**
 * الحصول على قائمة المستخدمين (بدون المحذوفين)
 * @returns {Array}
 */
export function getUsers() {
    return (window.App.users || []).filter(u => !u.deleted_at);
}

/**
 * الحصول على مستخدم محدد بواسطة معرفه
 * @param {string} id
 * @returns {Object|null}
 */
export function getUserById(id) {
    return getUsers().find(u => u.id === id) || null;
}

/**
 * الحصول على مستخدم بواسطة اسم المستخدم
 * @param {string} username
 * @returns {Object|null}
 */
export function getUserByUsername(username) {
    const normalized = String(username || '').trim().toLowerCase();
    return getUsers().find(u => u.username === normalized) || null;
}

/**
 * الحصول على قائمة المندوبين فقط
 * @returns {Array}
 */
export function getAgents() {
    return getUsers().filter(u => u.role === 'agent');
}

/**
 * الحصول على قائمة المدراء فقط
 * @returns {Array}
 */
export function getAdmins() {
    return getUsers().filter(u => u.role === 'admin');
}

/**
 * تشفير كلمة المرور باستخدام SHA-256
 * @param {string} password
 * @returns {Promise<string>}
 */
export async function hashPassword(password) {
    const msgBuffer = new TextEncoder().encode(String(password || ''));
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * التحقق من صحة كلمة المرور (مقارنة مع التشفير أو النص العادي للتوافق القديم)
 * @param {Object} user - كائن المستخدم
 * @param {string} password - كلمة المرور المدخلة
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(user, password) {
    if (!user || !password) return false;
    const entered = String(password).trim();
    const stored = user.password_hash || user.password || '';
    if (!stored) return false;
    
    const enteredHash = await hashPassword(entered);
    return stored === entered || stored === enteredHash;
}

/**
 * إنشاء مستخدم جديد
 * @param {Object} userData - بيانات المستخدم
 * @returns {Promise<Object>}
 */
export async function createUser(userData) {
    const existing = getUserByUsername(userData.username);
    if (existing) {
        throw new Error('اسم المستخدم موجود مسبقاً');
    }
    
    const hashedPassword = userData.password ? await hashPassword(userData.password) : null;
    
    const payload = {
        id: crypto.randomUUID(),
        username: String(userData.username || '').trim().toLowerCase(),
        display_name: userData.display_name || userData.username || 'مستخدم',
        role: userData.role || 'agent',
        quick_eq: userData.quick_eq || null,
        password_hash: hashedPassword,
        email: userData.email || null,
        phone: userData.phone || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    
    const saved = await persistTable('users', payload);
    if (!window.App.users) window.App.users = [];
    window.App.users.unshift(saved);
    await cacheTable('users', window.App.users);
    
    await appendAuditEntry({
        action: 'create_user',
        table_name: 'users',
        record_id: saved.id,
        before_value: null,
        after_value: { username: saved.username, role: saved.role },
        source: 'app'
    });
    
    return saved;
}

/**
 * تحديث مستخدم موجود
 * @param {string} id - معرف المستخدم
 * @param {Object} userData - البيانات الجديدة
 * @returns {Promise<Object>}
 */
export async function updateUser(id, userData) {
    const existing = getUserById(id);
    if (!existing) throw new Error('المستخدم غير موجود');
    
    // التحقق من عدم تكرار اسم المستخدم
    if (userData.username && userData.username !== existing.username) {
        const duplicate = getUserByUsername(userData.username);
        if (duplicate && duplicate.id !== id) {
            throw new Error('اسم المستخدم موجود مسبقاً');
        }
    }
    
    let passwordHash = existing.password_hash;
    if (userData.password && userData.password.trim()) {
        passwordHash = await hashPassword(userData.password);
    }
    
    const updated = {
        ...existing,
        username: userData.username ? String(userData.username).trim().toLowerCase() : existing.username,
        display_name: userData.display_name ?? existing.display_name,
        role: userData.role ?? existing.role,
        quick_eq: userData.quick_eq !== undefined ? userData.quick_eq : existing.quick_eq,
        password_hash: passwordHash,
        email: userData.email !== undefined ? userData.email : existing.email,
        phone: userData.phone !== undefined ? userData.phone : existing.phone,
        updated_at: new Date().toISOString()
    };
    
    await persistTable('users', updated, id);
    const idx = window.App.users.findIndex(u => u.id === id);
    if (idx >= 0) window.App.users[idx] = updated;
    await cacheTable('users', window.App.users);
    
    await appendAuditEntry({
        action: 'update_user',
        table_name: 'users',
        record_id: id,
        before_value: { username: existing.username, role: existing.role },
        after_value: { username: updated.username, role: updated.role },
        source: 'app'
    });
    
    return updated;
}

/**
 * حذف مستخدم (ناعم، بوضع deleted_at)
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteUser(id) {
    const existing = getUserById(id);
    if (!existing) {
        showToast('المستخدم غير موجود', 'error');
        return false;
    }
    
    await deleteTableRow('users', id);
    window.App.users = window.App.users.filter(u => u.id !== id);
    await cacheTable('users', window.App.users);
    
    await appendAuditEntry({
        action: 'delete_user',
        table_name: 'users',
        record_id: id,
        before_value: { username: existing.username, role: existing.role },
        after_value: null,
        source: 'app'
    });
    
    showToast('تم حذف المستخدم بنجاح ✅', 'success');
    return true;
}

/**
 * تسجيل الدخول باستخدام اسم المستخدم وكلمة المرور (التقليدي)
 * @param {string} username
 * @param {string} password
 * @returns {Promise<Object|null>}
 */
export async function loginWithPassword(username, password) {
    const user = getUserByUsername(username);
    if (!user) return null;
    
    const isValid = await verifyPassword(user, password);
    if (!isValid) return null;
    
    return user;
}

/**
 * تسجيل الدخول باستخدام المعادلة السريعة (Quick Login)
 * @param {string} equation - المعادلة الحسابية المدخلة
 * @returns {Promise<Object|null>}
 */
export async function loginWithQuickEquation(equation) {
    if (!equation) return null;
    const cleanEq = String(equation).replace(/\s+/g, '');
    const user = getUsers().find(u => u.quick_eq && String(u.quick_eq).replace(/\s+/g, '') === cleanEq);
    if (!user) return null;
    return user;
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.getUsers = getUsers;
    window.getUserById = getUserById;
    window.getUserByUsername = getUserByUsername;
    window.getAgents = getAgents;
    window.getAdmins = getAdmins;
    window.hashPassword = hashPassword;
    window.verifyPassword = verifyPassword;
    window.createUser = createUser;
    window.updateUser = updateUser;
    window.deleteUser = deleteUser;
    window.loginWithPassword = loginWithPassword;
    window.loginWithQuickEquation = loginWithQuickEquation;
}
