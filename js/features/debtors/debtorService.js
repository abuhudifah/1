// ==========================================
// debtorService.js - خدمة العملاء المديونين (المنطق والبيانات)
// ==========================================

import { safeNumber, showToast, dateInputAden, defaultAgentName } from '../../utils.js';
import { persistTable, deleteTableRow, cacheTable } from '../../core/repository.js';
import { appendAuditEntry } from '../../core/audit.js';

/**
 * الحصول على قائمة العملاء المديونين (بدون المحذوفين)
 * @returns {Array}
 */
export function getDebtorRecords() {
    return (window.App.records || []).filter(r => r.is_debtor_customer === true && !r.deleted_at);
}

/**
 * الحصول على عميل مديون محدد بواسطة معرفه
 * @param {string} id
 * @returns {Object|null}
 */
export function getDebtorById(id) {
    return getDebtorRecords().find(d => d.id === id) || null;
}

/**
 * حساب المبلغ المسدد من عميل مديون (من عمليات التحصيل المرتبطة به)
 * @param {Object} debtor - كائن العميل المدين
 * @returns {number}
 */
export function calculateDebtorPaid(debtor) {
    if (!debtor) return 0;
    const name = String(debtor.customer_name || '').trim();
    const id = String(debtor.id || '');
    return (window.App.records || [])
        .filter(r => r && r.type === 'collection')
        .filter(r => String(r.debtor_id || '') === id || 
                    String(r.related_debtor_id || '') === id || 
                    String(r.customer_name || '').trim() === name)
        .reduce((sum, r) => sum + safeNumber(r.amount, 0), 0);
}

/**
 * حساب المبلغ المتبقي على العميل المدين
 * @param {Object} debtor - كائن العميل المدين
 * @returns {number}
 */
export function calculateDebtorRemaining(debtor) {
    if (!debtor) return 0;
    const debtAmount = safeNumber(debtor.debt_amount, 0);
    const paid = calculateDebtorPaid(debtor);
    return Math.max(0, debtAmount - paid);
}

/**
 * إنشاء عميل مديون جديد
 * @param {Object} debtorData - بيانات العميل المدين
 * @returns {Promise<Object>}
 */
export async function createDebtor(debtorData) {
    const record = {
        type: 'debtor_customer',
        is_debtor_customer: true,
        customer_name: debtorData.customer_name,
        debt_amount: Math.round(safeNumber(debtorData.debt_amount, 0)),
        region: debtorData.region || '',
        date: dateInputAden(),
        user_id: window.App?.currentUser?.id || null,
        agent_name: defaultAgentName(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    const saved = await persistTable('records', record);
    if (!window.App.records) window.App.records = [];
    window.App.records.unshift(saved);
    await cacheTable('records', window.App.records);
    return saved;
}

/**
 * تحديث عميل مديون
 * @param {string} id - معرف العميل
 * @param {Object} debtorData - البيانات الجديدة
 * @returns {Promise<Object>}
 */
export async function updateDebtor(id, debtorData) {
    const existing = getDebtorById(id);
    if (!existing) throw new Error('العميل المدين غير موجود');
    
    const updated = {
        ...existing,
        customer_name: debtorData.customer_name ?? existing.customer_name,
        debt_amount: Math.round(safeNumber(debtorData.debt_amount, existing.debt_amount)),
        region: debtorData.region ?? existing.region,
        updated_at: new Date().toISOString()
    };
    await persistTable('records', updated, id);
    const idx = window.App.records.findIndex(r => r.id === id);
    if (idx >= 0) window.App.records[idx] = updated;
    await cacheTable('records', window.App.records);
    return updated;
}

/**
 * حذف عميل مديون (ناعم، بوضع deleted_at)
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteDebtor(id) {
    const existing = getDebtorById(id);
    if (!existing) {
        showToast('العميل غير موجود', 'error');
        return false;
    }
    await deleteTableRow('records', id);
    window.App.records = window.App.records.filter(r => r.id !== id);
    await cacheTable('records', window.App.records);
    showToast('تم حذف العميل المديون ✅', 'success');
    return true;
}

/**
 * الحصول على قائمة المناطق الفريدة للعملاء المديونين
 * @returns {Array}
 */
export function getUniqueDebtorRegions() {
    return [...new Set(getDebtorRecords()
        .filter(d => d.region)
        .map(d => String(d.region).trim()))].sort();
}

/**
 * البحث عن العملاء المديونين حسب الاسم أو المنطقة
 * @param {string} searchTerm - مصطلح البحث
 * @returns {Array}
 */
export function searchDebtors(searchTerm) {
    if (!searchTerm) return getDebtorRecords();
    const term = searchTerm.toLowerCase().trim();
    return getDebtorRecords().filter(d => 
        String(d.customer_name || '').toLowerCase().includes(term) ||
        String(d.region || '').toLowerCase().includes(term)
    );
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.getDebtorRecords = getDebtorRecords;
    window.getDebtorById = getDebtorById;
    window.calculateDebtorPaid = calculateDebtorPaid;
    window.calculateDebtorRemaining = calculateDebtorRemaining;
    window.createDebtor = createDebtor;
    window.updateDebtor = updateDebtor;
    window.deleteDebtor = deleteDebtor;
    window.getUniqueDebtorRegions = getUniqueDebtorRegions;
    window.searchDebtors = searchDebtors;
}
