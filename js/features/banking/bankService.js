// ==========================================
// bankService.js - خدمة الحسابات البنكية (نسخة آمنة تماماً ضد أخطاء undefined)
// ==========================================

import { safeNumber, showToast, dateInputAden, escapeHtml } from '../../utils.js';
import { persistTable, deleteTableRow, cacheTable } from '../../core/repository.js';
import { appendAuditEntry } from '../../core/audit.js';

/**
 * دالة مساعدة للحصول على السجلات بأمان تام لتجنب خطأ undefined
 */
function getSafeRecords() {
    if (!window.App) window.App = {};
    if (!window.App.records) window.App.records = [];
    return window.App.records;
}

/**
 * الحصول على قائمة الحسابات البنكية النشطة
 * @returns {Array}
 */
export function getActiveBankAccounts() {
    const records = getSafeRecords();
    return records.filter(r => r.is_bank_account === true && !r.deleted_at);
}

/**
 * الحصول على حساب بنكي محدد بواسطة اسم الحساب
 * @param {string} bankAccountName
 * @returns {Object|null}
 */
export function getBankAccountByName(bankAccountName) {
    const records = getSafeRecords();
    return records.find(r => r.is_bank_account && r.bank_account === bankAccountName && !r.deleted_at) || null;
}

/**
 * حساب إجمالي الإيداعات الصافية لحساب بنكي في تاريخ معين (الإيداعات - السحوبات من البطاقة)
 * @param {string} bankAccount - اسم الحساب البنكي
 * @param {string|null} date - التاريخ (اختياري، الافتراضي اليوم الحالي)
 * @returns {number}
 */
export function getTotalDepositsForBank(bankAccount, date = null) {
    const targetDate = date || dateInputAden();
    const records = getSafeRecords();
    
    const deposits = records.filter(r => 
        r.type === 'deposit' && 
        r.bank_account === bankAccount && 
        r.date === targetDate &&
        !r.deleted_at
    ).reduce((sum, r) => sum + safeNumber(r.amount, 0), 0);
    
    const withdrawals = records.filter(r => 
        r.type === 'collection' && 
        r.collection_type === 'سحب من بطاقة' && 
        r.bank_account === bankAccount && 
        r.date === targetDate &&
        !r.deleted_at
    ).reduce((sum, r) => sum + safeNumber(r.amount, 0), 0);
    
    return deposits - withdrawals;
}

/**
 * حساب إجمالي الإيداعات الخام (بدون خصم السحوبات) لحساب بنكي في تاريخ معين
 * @param {string} bankAccount
 * @param {string|null} date
 * @returns {number}
 */
export function getRawDepositsForBank(bankAccount, date = null) {
    const targetDate = date || dateInputAden();
    const records = getSafeRecords();
    
    return records.filter(r => 
        r.type === 'deposit' && 
        r.bank_account === bankAccount && 
        r.date === targetDate &&
        !r.deleted_at
    ).reduce((sum, r) => sum + safeNumber(r.amount, 0), 0);
}

/**
 * حساب إجمالي السحوبات من البطاقة لحساب بنكي في تاريخ معين
 * @param {string} bankAccount
 * @param {string|null} date
 * @returns {number}
 */
export function getTotalWithdrawalsForBank(bankAccount, date = null) {
    const targetDate = date || dateInputAden();
    const records = getSafeRecords();
    
    return records.filter(r => 
        r.type === 'collection' && 
        r.collection_type === 'سحب من بطاقة' && 
        r.bank_account === bankAccount && 
        r.date === targetDate &&
        !r.deleted_at
    ).reduce((sum, r) => sum + safeNumber(r.amount, 0), 0);
}

/**
 * الحصول على آخر 5 إيداعات لحساب بنكي في تاريخ معين (مرتبة تنازلياً حسب الوقت)
 * @param {string} bankAccount
 * @param {string|null} date
 * @returns {Array}
 */
export function getRecentDepositsForBank(bankAccount, date = null, limit = 5) {
    const targetDate = date || dateInputAden();
    const records = getSafeRecords();
    
    const deposits = records.filter(r => 
        r.type === 'deposit' && 
        r.bank_account === bankAccount && 
        r.date === targetDate &&
        !r.deleted_at
    ).sort((a, b) => {
        const timeA = a.time || '00:00';
        const timeB = b.time || '00:00';
        return timeB.localeCompare(timeA);
    });
    return deposits.slice(0, limit);
}

/**
 * التحقق من السقف المالي للحساب البنكي وإرسال إشعار إذا تجاوز 90%
 * @param {Object} bankAccount - كائن الحساب البنكي
 * @param {number} newDepositAmount - مبلغ الإيداع الجديد
 * @param {string} targetDate - التاريخ
 */
export async function checkBankCeilingAndNotify(bankAccount, newDepositAmount, targetDate) {
    if (!bankAccount || !bankAccount.financial_ceiling) return;
    
    const totalDepositsBefore = getTotalDepositsForBank(bankAccount.bank_account, targetDate);
    const totalDepositsAfter = totalDepositsBefore + newDepositAmount;
    const ceiling = safeNumber(bankAccount.financial_ceiling, 0);
    const percentage = ceiling > 0 ? (totalDepositsAfter / ceiling) * 100 : 0;
    
    if (percentage >= 90) {
        const title = percentage > 100 ? '🚨 تنبيه حرج: تجاوز السقف المالي' : '⚠️ تحذير: اقتراب اكتمال السقف المالي';
        const allNotifs = window.App?.notifications || window.allNotifications || [];
        const alreadySent = allNotifs.some(n => 
            n.title === title && 
            n.body && n.body.includes(bankAccount.bank_account) && 
            (new Date() - new Date(n.created_at)) < (24 * 60 * 60 * 1000)
        );
        if (alreadySent) return;
        
        const body = percentage > 100 
            ? `لقد تم تجاوز السقف المالي لحساب (${bankAccount.bank_account})!
السقف المحدد: ${ceiling}
إجمالي الإيداعات: ${totalDepositsAfter}
نسبة التجاوز: ${Math.round(percentage - 100)}%`
            : `حساب (${bankAccount.bank_account}) وصل إلى ${Math.round(percentage)}% من السقف المالي.
المبلغ المتبقي للوصول للسقف: ${Math.round(ceiling - totalDepositsAfter)} فقط.`;
        
        const notifData = {
            title: title,
            body: body,
            type: 'urgent',
            target: 'admins',
            sender_name: 'النظام الآلي',
            created_at: new Date().toISOString(),
            read_by: [],
            deleted_by: []
        };
        
        if (typeof window.saveNotification === 'function') {
            await window.saveNotification(notifData);
        } else if (typeof persistTable === 'function') {
            await persistTable('notifications', notifData);
        }
    }
}

/**
 * إنشاء حساب بنكي جديد
 * @param {Object} bankData
 * @returns {Promise<Object>}
 */
export async function createBankAccount(bankData) {
    const record = {
        type: 'bank_account',
        is_bank_account: true,
        bank_account: bankData.bank_account,
        account_number: bankData.account_number || '',
        card_number: bankData.card_number || '',
        card_holder: bankData.card_holder || '',
        card_pin: bankData.card_pin || '',
        financial_ceiling: safeNumber(bankData.financial_ceiling, 0),
        owning_company: bankData.owning_company || '',
        reset_time: bankData.reset_time || '00:00',
        date: dateInputAden(),
        user_id: window.App?.currentUser?.id || null,
        agent_name: window.App?.currentUser?.display_name || ''
    };
    
    const saved = await persistTable('records', record);
    const records = getSafeRecords();
    records.unshift(saved);
    await cacheTable('records', records);
    return saved;
}

/**
 * تحديث حساب بنكي
 * @param {string} id
 * @param {Object} bankData
 * @returns {Promise<Object>}
 */
export async function updateBankAccount(id, bankData) {
    const records = getSafeRecords();
    const existing = records.find(r => r.id === id);
    if (!existing) throw new Error('الحساب البنكي غير موجود');
    
    const updated = {
        ...existing,
        bank_account: bankData.bank_account || existing.bank_account,
        account_number: bankData.account_number ?? existing.account_number,
        card_number: bankData.card_number ?? existing.card_number,
        card_holder: bankData.card_holder ?? existing.card_holder,
        card_pin: bankData.card_pin ?? existing.card_pin,
        financial_ceiling: safeNumber(bankData.financial_ceiling, existing.financial_ceiling),
        owning_company: bankData.owning_company ?? existing.owning_company,
        reset_time: bankData.reset_time ?? existing.reset_time,
        updated_at: new Date().toISOString()
    };
    
    await persistTable('records', updated, id);
    const idx = records.findIndex(r => r.id === id);
    if (idx >= 0) records[idx] = updated;
    await cacheTable('records', records);
    return updated;
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.getActiveBankAccounts = getActiveBankAccounts;
    window.getBankAccountByName = getBankAccountByName;
    window.getTotalDepositsForBank = getTotalDepositsForBank;
    window.getRawDepositsForBank = getRawDepositsForBank;
    window.getTotalWithdrawalsForBank = getTotalWithdrawalsForBank;
    window.getRecentDepositsForBank = getRecentDepositsForBank;
    window.checkBankCeilingAndNotify = checkBankCeilingAndNotify;
    window.createBankAccount = createBankAccount;
    window.updateBankAccount = updateBankAccount;
}
