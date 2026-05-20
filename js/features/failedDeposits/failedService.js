// ==========================================
// failedService.js - خدمة الإيداعات الفاشلة (المنطق والبيانات)
// ==========================================

import { safeNumber, showToast, dateInputAden, timeInputAden, defaultAgentName } from '../../utils.js';
import { persistTable, deleteTableRow, cacheTable } from '../../core/repository.js';
import { appendAuditEntry } from '../../core/audit.js';

/**
 * الحصول على قائمة الإيداعات الفاشلة (بدون المحذوفين)
 * @param {string|null} dateFilter - تاريخ محدد (اختياري)
 * @returns {Array}
 */
export function getFailedDeposits(dateFilter = null) {
    let failed = (window.App.records || []).filter(r => r.is_failed_deposit === true && !r.deleted_at);
    if (dateFilter) {
        failed = failed.filter(f => f.date === dateFilter);
    }
    // ترتيب من الأحدث للأقدم
    return failed.sort((a, b) => new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`));
}

/**
 * الحصول على إيداع فاشل محدد بواسطة معرفه
 * @param {string} id
 * @returns {Object|null}
 */
export function getFailedDepositById(id) {
    return (window.App.records || []).find(r => r.is_failed_deposit && r.id === id && !r.deleted_at) || null;
}

/**
 * إنشاء سجل إيداع فاشل جديد
 * @param {Object} failedData - بيانات الإيداع الفاشل
 * @returns {Promise<Object>}
 */
export async function createFailedDeposit(failedData) {
    const record = {
        type: 'failed_deposit',
        is_failed_deposit: true,
        bank_account: failedData.bank_account,
        account_number: failedData.account_number || '',
        amount: Math.round(safeNumber(failedData.amount, 0)),
        date: failedData.date || dateInputAden(),
        time: failedData.time || timeInputAden(),
        branch_address: failedData.branch_address || '',
        branch_number: failedData.branch_number || '',
        device_number: failedData.device_number || '',
        card_number: failedData.card_number || '',
        card_holder: failedData.card_holder || '',
        card_code: failedData.card_code || '',
        status: failedData.status || 'pending',
        bank_response_text: failedData.bank_response_text || '',
        refund_amount: failedData.status === 'refunded' ? safeNumber(failedData.refund_amount, 0) : 0,
        rejection_reason: failedData.status === 'rejected' ? (failedData.rejection_reason || '') : '',
        claim_date: failedData.status === 'claimed' ? new Date().toISOString() : null,
        response_date: ['refunded', 'rejected'].includes(failedData.status) ? new Date().toISOString() : null,
        settlement_record_id: null,
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
 * تحديث إيداع فاشل
 * @param {string} id - معرف الإيداع الفاشل
 * @param {Object} failedData - البيانات الجديدة
 * @returns {Promise<Object>}
 */
export async function updateFailedDeposit(id, failedData) {
    const existing = getFailedDepositById(id);
    if (!existing) throw new Error('الإيداع الفاشل غير موجود');
    
    const newStatus = failedData.status || existing.status;
    const updated = {
        ...existing,
        bank_account: failedData.bank_account ?? existing.bank_account,
        account_number: failedData.account_number ?? existing.account_number,
        amount: Math.round(safeNumber(failedData.amount, existing.amount)),
        date: failedData.date ?? existing.date,
        time: failedData.time ?? existing.time,
        branch_address: failedData.branch_address ?? existing.branch_address,
        branch_number: failedData.branch_number ?? existing.branch_number,
        device_number: failedData.device_number ?? existing.device_number,
        card_number: failedData.card_number ?? existing.card_number,
        card_holder: failedData.card_holder ?? existing.card_holder,
        card_code: failedData.card_code ?? existing.card_code,
        status: newStatus,
        bank_response_text: failedData.bank_response_text ?? existing.bank_response_text,
        refund_amount: newStatus === 'refunded' ? safeNumber(failedData.refund_amount, 0) : (newStatus === 'refunded' ? existing.refund_amount : 0),
        rejection_reason: newStatus === 'rejected' ? (failedData.rejection_reason || '') : (newStatus === 'rejected' ? existing.rejection_reason : ''),
        claim_date: newStatus === 'claimed' && existing.status !== 'claimed' ? new Date().toISOString() : existing.claim_date,
        response_date: (newStatus === 'refunded' || newStatus === 'rejected') && existing.status !== newStatus ? new Date().toISOString() : existing.response_date,
        updated_at: new Date().toISOString()
    };
    await persistTable('records', updated, id);
    const idx = window.App.records.findIndex(r => r.id === id);
    if (idx >= 0) window.App.records[idx] = updated;
    await cacheTable('records', window.App.records);
    return updated;
}

/**
 * حذف إيداع فاشل (ناعم، بوضع deleted_at)
 * @param {string} id
 * @returns {Promise<boolean>}
 */
export async function deleteFailedDeposit(id) {
    const existing = getFailedDepositById(id);
    if (!existing) {
        showToast('الإيداع الفاشل غير موجود', 'error');
        return false;
    }
    await deleteTableRow('records', id);
    window.App.records = window.App.records.filter(r => r.id !== id);
    await cacheTable('records', window.App.records);
    showToast('تم حذف الإيداع الفاشل ✅', 'success');
    return true;
}

/**
 * نسخ تفاصيل الإيداع الفاشل إلى الحافظة
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function copyFailedDetails(id) {
    const record = getFailedDepositById(id);
    if (!record) {
        showToast('السجل غير موجود', 'error');
        return;
    }
    const textToCopy = [
        'عملية إيداع فاشلة',
        `التاريخ: ${record.date}`,
        `الوقت: ${record.time}`,
        `الحساب: ${record.bank_account}`,
        `رقم الحساب: ${record.account_number}`,
        `المبلغ: ${safeNumber(record.amount).toLocaleString('en-US')}`,
        `الفرع: ${record.branch_address || '-'} (${record.branch_number || '-'})`,
        `رقم الجهاز: ${record.device_number || '-'}`,
        `رقم البطاقة: ${record.card_number || '-'}`,
        `صاحب البطاقة: ${record.card_holder || '-'}`,
        `رمز البطاقة: ${record.card_code || '-'}`,
        `الحالة: ${record.status || 'pending'}`
    ].join('\n');
    try {
        await navigator.clipboard.writeText(textToCopy);
        showToast('تم نسخ التفاصيل للحافظة ✅', 'success');
    } catch (error) {
        console.warn(error);
        showToast('تعذر النسخ، انسخ النص يدوياً', 'warning');
    }
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.getFailedDeposits = getFailedDeposits;
    window.getFailedDepositById = getFailedDepositById;
    window.createFailedDeposit = createFailedDeposit;
    window.updateFailedDeposit = updateFailedDeposit;
    window.deleteFailedDeposit = deleteFailedDeposit;
    window.copyFailedDetails = copyFailedDetails;
}
