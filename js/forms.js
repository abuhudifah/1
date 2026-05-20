// ==========================================
// forms.js - ربط النماذج وإدارة العمليات المالية
// ==========================================

import { showToast, dateInputAden, timeInputAden, defaultAgentName, isAdmin, safeNumber, escapeHtml } from './utils.js';
import { createRecord, updateRecord, deleteRecord } from './features/records/recordService.js';
import { getActiveBankAccounts, getTotalDepositsForBank } from './features/banking/bankService.js';
import { getDebtorRecords, calculateDebtorRemaining } from './features/debtors/debtorService.js';
import { createFailedDeposit, updateFailedDeposit } from './features/failedDeposits/failedService.js';
import { createBankAccount, updateBankAccount } from './features/banking/bankService.js';
import { createDebtor, updateDebtor } from './features/debtors/debtorService.js';

// ==========================================
// متغيرات مساعدة
// ==========================================

let activeEditId = null;
let activeEditType = null;

// ==========================================
// دوال بناء السجلات (مطابقة للقديم)
// ==========================================

function buildRecordBase(type) {
    return {
        type,
        agent_name: defaultAgentName(),
        date: dateInputAden(),
        time: timeInputAden(),
        amount: 0,
        is_bank_account: false,
        is_debtor_customer: false,
        is_failed_deposit: false,
        is_reversal: false,
        is_reversed: false,
        user_id: window.App?.currentUser?.id || null
    };
}

export function buildCollectionRecord() {
    const base = buildRecordBase('collection');
    const collectionType = document.getElementById('collection-type')?.value || 'نقدي';
    base.collection_type = collectionType;
    base.amount = Math.round(safeNumber(document.getElementById('collection-amount')?.value, 0));
    
    if (collectionType === 'سحب من بطاقة') {
        base.bank_account = document.getElementById('collection-bank-card')?.value || '';
        base.customer_name = document.getElementById('customer-name')?.value || '';
    } else {
        base.customer_name = document.getElementById('customer-name')?.value || '';
        const debtorSelect = document.getElementById('debtor-select');
        if (debtorSelect?.value) {
            base.debtor_id = debtorSelect.value;
        }
    }
    return base;
}

export function buildDepositRecord() {
    const base = buildRecordBase('deposit');
    base.bank_account = document.getElementById('deposit-bank')?.value || '';
    base.amount = Math.round(safeNumber(document.getElementById('deposit-amount')?.value, 0));
    return base;
}

export function buildExpenseRecord() {
    const base = buildRecordBase('expense');
    base.expense_type = document.getElementById('expense-type')?.value || '';
    base.expense_details = document.getElementById('expense-details')?.value || '';
    base.amount = Math.round(safeNumber(document.getElementById('expense-amount')?.value, 0));
    return base;
}

export function buildReceiptRecord() {
    const base = buildRecordBase('receipt');
    base.receipt_type = document.getElementById('receipt-type')?.value || 'مندوب';
    base.received_from = base.receipt_type === 'مندوب'
        ? document.getElementById('receipt-agent-name')?.value || ''
        : document.getElementById('receipt-company-name')?.value || '';
    base.amount = Math.round(safeNumber(document.getElementById('receipt-amount')?.value, 0));
    return base;
}

export function buildDeliveryRecord() {
    const base = buildRecordBase('delivery');
    base.delivery_type = document.getElementById('delivery-type')?.value || 'مندوب';
    base.delivered_to = document.getElementById('delivery-recipient')?.value || '';
    base.amount = Math.round(safeNumber(document.getElementById('delivery-amount')?.value, 0));
    return base;
}

// ==========================================
// دوال عامة لتقديم النماذج
// ==========================================

async function submitForm(formId, builder, successMsg, resetForm = true) {
    const editId = activeEditType === formId ? activeEditId : null;
    const btn = document.querySelector(`#${formId} button[type="submit"]`);
    const spinner = btn?.querySelector('.loading-spinner');
    const originalText = btn?.textContent || 'حفظ';

    if (btn) btn.textContent = 'جاري الحفظ...';
    if (spinner) spinner.classList.remove('hidden');

    try {
        const record = builder();
        
        // التحقق من صحة البيانات الأساسية
        if (!record.amount || record.amount <= 0) {
            showToast('المبلغ يجب أن يكون أكبر من صفر', 'warning');
            return false;
        }
        
        let result;
        if (editId) {
            result = await updateRecord(editId, record);
            showToast(editId ? 'تم التعديل بنجاح ✅' : successMsg, 'success');
        } else {
            result = await createRecord(record);
            showToast(successMsg, 'success');
            
            // إشعار السقف المالي للإيداعات
            if (record.type === 'deposit' && record.bank_account) {
                const bank = getActiveBankAccounts().find(b => b.bank_account === record.bank_account);
                if (bank && typeof window.checkBankCeilingAndNotify === 'function') {
                    window.checkBankCeilingAndNotify(bank, record.amount, record.date);
                }
            }
        }
        
        if (resetForm) {
            document.getElementById(formId)?.reset();
            resetEditState();
        }
        
        // تحديث الواجهة
        if (typeof window.refreshUI === 'function') window.refreshUI();
        return true;
    } catch (error) {
        console.error(error);
        showToast('فشل الحفظ: ' + error.message, 'error');
        return false;
    } finally {
        if (btn) btn.textContent = originalText;
        if (spinner) spinner.classList.add('hidden');
    }
}

function resetEditState() {
    activeEditId = null;
    activeEditType = null;
    document.querySelectorAll('[id$="-edit-id"]').forEach(el => el.value = '');
    document.querySelectorAll('[id$="-cancel-edit"]').forEach(btn => btn.classList.add('hidden'));
}

function setEditState(formId, id) {
    activeEditId = id;
    activeEditType = formId;
    const cancelBtn = document.getElementById(`${formId.split('-')[0]}-cancel-edit`);
    if (cancelBtn) cancelBtn.classList.remove('hidden');
}

// ==========================================
// ربط النماذج الفردية
// ==========================================

function bindCollectionForm() {
    const form = document.getElementById('collection-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    
    document.getElementById('collection-type')?.addEventListener('change', function() {
        const isCard = this.value === 'سحب من بطاقة';
        document.getElementById('bank-card-select-div')?.classList.toggle('hidden', !isCard);
        document.getElementById('customer-name-field')?.classList.toggle('hidden', isCard);
        document.getElementById('debtor-select-div')?.classList.toggle('hidden', isCard);
    });
    
    document.getElementById('collection-cancel-edit')?.addEventListener('click', () => {
        form.reset();
        resetEditState();
        document.getElementById('collection-btn-text').innerHTML = '<i class="fas fa-plus-circle ml-2"></i> إضافة تحصيل';
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm('collection-form', buildCollectionRecord, 'تمت إضافة التحصيل ✅');
    });
}

function bindDepositForm() {
    const form = document.getElementById('deposit-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    
    document.getElementById('deposit-cancel-edit')?.addEventListener('click', () => {
        form.reset();
        resetEditState();
        document.getElementById('deposit-btn-text').innerHTML = '<i class="fas fa-plus-circle ml-2"></i> إضافة إيداع';
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm('deposit-form', buildDepositRecord, 'تمت إضافة الإيداع ✅');
    });
}

function bindExpenseForm() {
    const form = document.getElementById('expense-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    
    document.getElementById('expense-cancel-edit')?.addEventListener('click', () => {
        form.reset();
        resetEditState();
        document.getElementById('expense-btn-text').innerHTML = '<i class="fas fa-plus-circle ml-2"></i> إضافة مصروف';
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm('expense-form', buildExpenseRecord, 'تمت إضافة المصروف ✅');
    });
}

function bindReceiptForm() {
    const form = document.getElementById('receipt-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    
    document.getElementById('receipt-type')?.addEventListener('change', function() {
        const isAgent = this.value === 'مندوب';
        document.getElementById('receipt-agent-field')?.classList.toggle('hidden', !isAgent);
        document.getElementById('receipt-company-field')?.classList.toggle('hidden', isAgent);
    });
    
    document.getElementById('receipt-cancel-edit')?.addEventListener('click', () => {
        form.reset();
        resetEditState();
        document.getElementById('receipt-btn-text').innerHTML = '<i class="fas fa-download ml-2"></i> استلام نقدي';
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm('receipt-form', buildReceiptRecord, 'تم تسجيل الاستلام ✅');
    });
}

function bindDeliveryForm() {
    const form = document.getElementById('delivery-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    
    document.getElementById('delivery-cancel-edit')?.addEventListener('click', () => {
        form.reset();
        resetEditState();
        document.getElementById('delivery-btn-text').innerHTML = '<i class="fas fa-upload ml-2"></i> تسليم نقدي';
    });
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await submitForm('delivery-form', buildDeliveryRecord, 'تم تسجيل التسليم ✅');
    });
}

// ==========================================
// تهيئة جميع النماذج
// ==========================================

export function bindOperationForms() {
    bindCollectionForm();
    bindDepositForm();
    bindExpenseForm();
    bindReceiptForm();
    bindDeliveryForm();
    
    // تحديث قوائم الحسابات البنكية
    function refreshBankOptions() {
        const banks = getActiveBankAccounts();
        const depositSelect = document.getElementById('deposit-bank');
        const collectionSelect = document.getElementById('collection-bank-card');
        
        if (depositSelect) {
            const current = depositSelect.value;
            depositSelect.innerHTML = '<option value="">اختر الحساب</option>' + 
                banks.map(b => `<option value="${escapeHtml(b.bank_account)}">${escapeHtml(b.bank_account)}</option>`).join('');
            if (current) depositSelect.value = current;
        }
        if (collectionSelect) {
            const current = collectionSelect.value;
            collectionSelect.innerHTML = '<option value="">اختر البطاقة</option>' + 
                banks.map(b => `<option value="${escapeHtml(b.bank_account)}">${escapeHtml(b.bank_account)}</option>`).join('');
            if (current) collectionSelect.value = current;
        }
    }
    
    refreshBankOptions();
    window.addEventListener('refreshBankOptions', refreshBankOptions);
}

// ==========================================
// دوال تعديل السجلات (للاستدعاء من الخارج)
// ==========================================

export async function editRecordFromUI(id) {
    const record = (window.App.records || []).find(r => r.id === id);
    if (!record) {
        showToast('السجل غير موجود', 'error');
        return;
    }
    
    if (record.type === 'collection') {
        const form = document.getElementById('collection-form');
        if (!form) return;
        document.getElementById('collection-edit-id').value = id;
        document.getElementById('collection-type').value = record.collection_type || 'نقدي';
        document.getElementById('collection-type').dispatchEvent(new Event('change'));
        if (record.collection_type === 'سحب من بطاقة') {
            document.getElementById('collection-bank-card').value = record.bank_account || '';
        } else {
            document.getElementById('customer-name').value = record.customer_name || '';
            if (record.debtor_id) {
                const debtorSelect = document.getElementById('debtor-select');
                if (debtorSelect) debtorSelect.value = record.debtor_id;
            }
        }
        document.getElementById('collection-amount').value = record.amount;
        document.getElementById('collection-btn-text').innerHTML = '<i class="fas fa-edit ml-2"></i> حفظ التعديل';
        setEditState('collection-form', id);
        if (typeof window.switchTab === 'function') window.switchTab('data-entry');
    }
    else if (record.type === 'deposit') {
        document.getElementById('deposit-edit-id').value = id;
        document.getElementById('deposit-bank').value = record.bank_account || '';
        document.getElementById('deposit-amount').value = record.amount;
        document.getElementById('deposit-btn-text').innerHTML = '<i class="fas fa-edit ml-2"></i> حفظ التعديل';
        setEditState('deposit-form', id);
        if (typeof window.switchTab === 'function') window.switchTab('data-entry');
    }
    else if (record.type === 'expense') {
        document.getElementById('expense-edit-id').value = id;
        document.getElementById('expense-type').value = record.expense_type || '';
        document.getElementById('expense-details').value = record.expense_details || '';
        document.getElementById('expense-amount').value = record.amount;
        document.getElementById('expense-btn-text').innerHTML = '<i class="fas fa-edit ml-2"></i> حفظ التعديل';
        setEditState('expense-form', id);
        if (typeof window.switchTab === 'function') window.switchTab('data-entry');
    }
    else if (record.type === 'receipt') {
        document.getElementById('receipt-edit-id').value = id;
        document.getElementById('receipt-type').value = record.receipt_type || 'مندوب';
        document.getElementById('receipt-type').dispatchEvent(new Event('change'));
        if (record.receipt_type === 'مندوب') {
            document.getElementById('receipt-agent-name').value = record.received_from || '';
        } else {
            document.getElementById('receipt-company-name').value = record.received_from || '';
        }
        document.getElementById('receipt-amount').value = record.amount;
        document.getElementById('receipt-btn-text').innerHTML = '<i class="fas fa-edit ml-2"></i> حفظ التعديل';
        setEditState('receipt-form', id);
        if (typeof window.switchTab === 'function') window.switchTab('data-entry');
    }
    else if (record.type === 'delivery') {
        document.getElementById('delivery-edit-id').value = id;
        document.getElementById('delivery-type').value = record.delivery_type || 'مندوب';
        document.getElementById('delivery-recipient').value = record.delivered_to || '';
        document.getElementById('delivery-amount').value = record.amount;
        document.getElementById('delivery-btn-text').innerHTML = '<i class="fas fa-edit ml-2"></i> حفظ التعديل';
        setEditState('delivery-form', id);
        if (typeof window.switchTab === 'function') window.switchTab('data-entry');
    }
}

// تصدير إلى النطاق العام للتوافق
if (typeof window !== 'undefined') {
    window.bindOperationForms = bindOperationForms;
    window.editRecord = editRecordFromUI;
    window.buildCollectionRecord = buildCollectionRecord;
    window.buildDepositRecord = buildDepositRecord;
    window.buildExpenseRecord = buildExpenseRecord;
    window.buildReceiptRecord = buildReceiptRecord;
    window.buildDeliveryRecord = buildDeliveryRecord;
}

// تهيئة تلقائية عند تحميل الصفحة
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindOperationForms);
} else {
    bindOperationForms();
}
