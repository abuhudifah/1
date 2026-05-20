// ==========================================
// reversal.js - منطق القيد العكسي (Reversal) للعمليات المالية القديمة
// ==========================================

import { safeNumber, showToast, defaultAgentName } from '../utils.js';
import { persistTable, cacheTable } from './repository.js';
import { appendAuditEntry } from './audit.js';
import { getDailyCloseSettings } from './settings.js';

/**
 * التحقق مما إذا كانت العملية قابلة للتعديل/الحذف المباشر (بدون قيد عكسي)
 * @param {Object} record - سجل العملية
 * @returns {boolean}
 */
export function isOperationEditable(record) {
    if (!record) return false;
    // القيود العكسية نفسها قابلة للتعديل/الحذف (للمدير)
    if (record.is_reversal) return true;
    
    const now = new Date();
    const saudiTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    const todayStr = saudiTime.toISOString().split('T')[0];
    const cfg = getDailyCloseSettings();
    const isClosed = cfg.lastClosedDate && record.date <= cfg.lastClosedDate;
    const isOldDay = record.date !== todayStr;
    
    // إذا كانت العملية قديمة أو مقفلة، لا يمكن تعديلها مباشرة
    return !(isClosed || isOldDay);
}

/**
 * إنشاء كائن قيد عكسي (Reversal) من سجل أصلي
 * @param {Object} originalRecord - السجل الأصلي
 * @param {string} targetDate - التاريخ المستهدف (عادة اليوم الحالي)
 * @param {string} userId - معرف المستخدم الحالي
 * @param {string} agentName - اسم المندوب
 * @returns {Object}
 */
export function createReversalRecord(originalRecord, targetDate, userId, agentName) {
    const now = new Date();
    const saudiTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    const timeStr = saudiTime.toISOString().substring(11, 16);
    
    return {
        ...originalRecord,
        id: crypto.randomUUID(),
        type: originalRecord.type,
        amount: -Math.abs(safeNumber(originalRecord.amount, 0)), // قيمة سالبة
        date: targetDate,
        time: timeStr,
        is_reversal: true,
        is_reversed: false,
        original_id: originalRecord.id,
        user_id: userId,
        agent_name: agentName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

/**
 * تطبيق القيد العكسي وحفظ التعديل/الحذف
 * @param {Object} originalRecord - السجل الأصلي
 * @param {Object|null} newRecord - السجل الجديد (في حالة التعديل)
 * @param {boolean} isDelete - هل هي عملية حذف؟
 * @returns {Promise<boolean>}
 */
export async function applyReversalAndSave(originalRecord, newRecord = null, isDelete = false) {
    if (!originalRecord || originalRecord.is_reversed) {
        console.warn('⚠️ العملية الأصلية معكوسة بالفعل، لن يتم تكرار القيد');
        return false;
    }
    
    const now = new Date();
    const saudiTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    const todayStr = saudiTime.toISOString().split('T')[0];
    const userId = window.App?.currentUser?.id;
    const agentName = originalRecord.agent_name || defaultAgentName();
    
    // 1. تحديث السجل الأصلي: وضعه كمعكوس
    const updatedOriginal = { ...originalRecord, is_reversed: true, updated_at: new Date().toISOString() };
    await persistTable('records', updatedOriginal, originalRecord.id);
    const idxOrig = (window.App.records || []).findIndex(r => r.id === originalRecord.id);
    if (idxOrig >= 0) window.App.records[idxOrig].is_reversed = true;
    
    // 2. إنشاء وحفظ القيد العكسي (Reversal)
    const reversalRecord = createReversalRecord(originalRecord, todayStr, userId, agentName);
    await persistTable('records', reversalRecord);
    window.App.records.unshift(reversalRecord);
    
    // 3. إذا كان تعديلاً، نحفظ السجل الجديد
    let savedNew = null;
    if (newRecord && !isDelete) {
        const correctionRecord = {
            ...newRecord,
            id: crypto.randomUUID(),
            date: todayStr,
            time: saudiTime.toISOString().substring(11, 16),
            is_correction: true,
            is_reversed: false,
            is_reversal: false,
            original_id: originalRecord.id,
            user_id: userId,
            agent_name: agentName,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        };
        await persistTable('records', correctionRecord);
        window.App.records.unshift(correctionRecord);
        savedNew = correctionRecord;
    }
    
    // 4. تسجيل في سجل التدقيق
    await appendAuditEntry({
        action: isDelete ? 'delete_with_reversal' : 'edit_with_reversal',
        table_name: 'records',
        record_id: originalRecord.id,
        before_value: { ...originalRecord },
        after_value: { reversal_id: reversalRecord.id, new_record_id: savedNew?.id || null },
        source: 'app'
    });
    
    await cacheTable('records', window.App.records);
    return true;
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.isOperationEditable = isOperationEditable;
    window.createReversalRecord = createReversalRecord;
    window.applyReversalAndSave = applyReversalAndSave;
}
