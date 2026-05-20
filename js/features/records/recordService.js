// ==========================================
// recordService.js - خدمة السجلات المالية (CRUD الأساسي)
// ==========================================

import { safeNumber, showToast, dateInputAden, timeInputAden, defaultAgentName } from '../../utils.js';
import { persistTable, deleteTableRow, cacheTable } from '../../core/repository.js';
import { appendAuditEntry } from '../../core/audit.js';
import { applyReversalAndSave, isOperationEditable } from '../../core/reversal.js';
import { getDailyCloseSettings } from '../../core/settings.js';

/**
 * دالة مساعدة للحصول على السجلات بأمان تام
 */
function getSafeRecords() {
    if (!window.App) window.App = {};
    if (!window.App.records) window.App.records = [];
    return window.App.records;
}

/**
 * إنشاء سجل مالي جديد (إضافة مباشرة)
 * @param {Object} record - السجل المراد إضافته (بدون id)
 * @returns {Promise<Object>}
 */
export async function createRecord(record) {
    const newRecord = {
        ...record,
        id: crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    const saved = await persistTable('records', newRecord);
    
    // الوصول الآمن
    const records = getSafeRecords();
    records.unshift(saved);
    await cacheTable('records', records);
    
    return saved;
}

/**
 * تحديث سجل مالي (مع دعم القيد العكسي للعمليات القديمة إذا كان المستخدم مديراً)
 * @param {string} id - معرف السجل
 * @param {Object} newData - البيانات الجديدة
 * @returns {Promise<Object|boolean>}
 */
export async function updateRecord(id, newData) {
    const records = getSafeRecords();
    const originalRecord = records.find(r => r.id === id);
    if (!originalRecord) {
        showToast('السجل غير موجود', 'error');
        return false;
    }

    const editable = isOperationEditable(originalRecord);
    const isAdmin = window.App?.currentUser?.role === 'admin';
    const isReversal = originalRecord.is_reversal === true;

    // إذا كان قيد عكسي، يسمح للمدير بتعديله مباشرة (دون قيد عكسي جديد)
    if (isReversal && isAdmin) {
        const updated = { ...originalRecord, ...newData, updated_at: new Date().toISOString() };
        await persistTable('records', updated, id);
        
        const idx = records.findIndex(r => r.id === id);
        if (idx >= 0) records[idx] = updated;
        window.App.records = records; // تحديث المرجع
        await cacheTable('records', records);
        return updated;
    }

    // إذا لم تكن قابلة للتعديل المباشر وكان المستخدم مديراً، نطبق القيد العكسي
    if (!editable && isAdmin && !originalRecord.is_reversed) {
        const confirmMsg = `هذه العملية قديمة (${originalRecord.date}). سيتم وضع علامة "معكوسة" عليها، وإنشاء قيد عكسي في اليوم الحالي، ثم إضافة العملية المعدلة كسجل جديد. هل تريد المتابعة؟`;
        if (!confirm(confirmMsg)) return false;
        const success = await applyReversalAndSave(originalRecord, newData, false);
        if (success) {
            showToast('تم التعديل بإنشاء قيد عكسي لليوم الحالي ✅', 'success');
            return true;
        }
        return false;
    }

    // التعديل العادي (للعمليات القابلة للتعديل مباشرة)
    const updated = { ...originalRecord, ...newData, updated_at: new Date().toISOString() };
    await persistTable('records', updated, id);
    const idx = records.findIndex(r => r.id === id);
    if (idx >= 0) records[idx] = updated;
    window.App.records = records;
    await cacheTable('records', records);
    return updated;
}

/**
 * حذف سجل مالي (مع دعم القيد العكسي للعمليات القديمة)
 * @param {string} id - معرف السجل
 * @returns {Promise<boolean>}
 */
export async function deleteRecord(id) {
    let records = getSafeRecords();
    const record = records.find(r => r.id === id);
    if (!record) {
        showToast('السجل غير موجود', 'error');
        return false;
    }

    const editable = isOperationEditable(record);
    const isAdmin = window.App?.currentUser?.role === 'admin';

    // إذا كان مندوباً والعملية قديمة -> منع
    if (!isAdmin && !editable) {
        showToast('عفواً، يُسمح لك بحذف عمليات اليوم الحالي فقط.', 'error');
        return false;
    }

    // إذا كان مديراً والعملية قديمة/مقفلة ولم تعكس مسبقاً
    if (isAdmin && !editable && !record.is_reversed && !record.is_reversal) {
        const confirmMsg = `هذه العملية قديمة (${record.date}). سيتم إنشاء "قيد عكسي" في اليوم الحالي لتصحيح الرصيد. هل أنت متأكد؟`;
        if (!confirm(confirmMsg)) return false;
        const success = await applyReversalAndSave(record, null, true);
        if (success) {
            showToast('تم إلغاء العملية وإنشاء قيد عكسي لليوم الحالي ✅', 'success');
            return true;
        }
        return false;
    }

    // الحذف العادي (للعمليات القابلة للتعديل المباشر أو القيود العكسية)
    await deleteTableRow('records', id);
    records = records.filter(r => r.id !== id);
    window.App.records = records; // تحديث المرجع الرئيسي
    await cacheTable('records', records);
    showToast('تم الحذف بنجاح ✅', 'success');
    return true;
}

/**
 * الحصول على سجل محدد بواسطة معرفه
 * @param {string} id
 * @returns {Object|null}
 */
export function getRecordById(id) {
    const records = getSafeRecords();
    return records.find(r => r.id === id) || null;
}

/**
 * الحصول على جميع السجلات المالية (بدون حسابات بنكية ومديونين)
 * @returns {Array}
 */
export function getAllOperations() {
    const records = getSafeRecords();
    return records.filter(r => 
        !r.is_bank_account && 
        !r.is_debtor_customer && 
        !r.is_failed_deposit &&
        !r.deleted_at
    );
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.createRecord = createRecord;
    window.updateRecord = updateRecord;
    window.deleteRecord = deleteRecord;
    window.getRecordById = getRecordById;
    window.getAllOperations = getAllOperations;
}
