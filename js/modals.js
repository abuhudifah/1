// ==========================================
// modals.js - إدارة النوافذ المنبثقة (Modals)
// ==========================================

import { showToast, dateInputAden, timeInputAden, escapeHtml, isAdmin } from './utils.js';
import { getActiveBankAccounts } from './features/banking/bankService.js';
import { getDebtorRecords, populateDebtorRegionsDropdown } from './features/debtors/debtorUI.js';
import { createBankAccount, updateBankAccount } from './features/banking/bankService.js';
import { createDebtor, updateDebtor } from './features/debtors/debtorService.js';
import { createFailedDeposit, updateFailedDeposit } from './features/failedDeposits/failedService.js';

// ==========================================
// نافذة الحساب البنكي (Bank Modal)
// ==========================================

export function openBankModal(editId = null) {
    const modal = document.getElementById('bank-modal');
    const title = document.getElementById('bank-modal-title');
    const editIdField = document.getElementById('bank-edit-id');
    const nameField = document.getElementById('bank-name');
    const accNumField = document.getElementById('bank-acc-num');
    const cardNumField = document.getElementById('bank-card-num');
    const cardHolderField = document.getElementById('bank-card-holder');
    const pinField = document.getElementById('bank-pin');
    const ceilingField = document.getElementById('bank-ceiling');
    const companyField = document.getElementById('bank-company-input');
    const resetTimeField = document.getElementById('bank-reset-time-input');

    if (!modal) return;

    // إعادة تعيين النموذج
    const form = document.getElementById('bank-form');
    if (form) form.reset();

    if (editId) {
        const bank = (window.App.records || []).find(r => r.is_bank_account && r.id === editId);
        if (!bank) {
            showToast('الحساب البنكي غير موجود', 'error');
            return;
        }
        if (title) title.textContent = 'تعديل حساب بنكي';
        if (editIdField) editIdField.value = bank.id;
        if (nameField) nameField.value = bank.bank_account || '';
        if (accNumField) accNumField.value = bank.account_number || '';
        if (cardNumField) cardNumField.value = bank.card_number || '';
        if (cardHolderField) cardHolderField.value = bank.card_holder || '';
        if (pinField) pinField.value = bank.card_pin || '';
        if (ceilingField) ceilingField.value = bank.financial_ceiling || '';
        if (companyField) companyField.value = bank.owning_company || '';
        if (resetTimeField) resetTimeField.value = bank.reset_time || '00:00';
    } else {
        if (title) title.textContent = 'إضافة حساب بنكي جديد';
        if (editIdField) editIdField.value = '';
        if (resetTimeField) resetTimeField.value = '00:00';
    }

    modal.classList.remove('hidden');
}

export function closeBankModal() {
    const modal = document.getElementById('bank-modal');
    if (modal) modal.classList.add('hidden');
    const form = document.getElementById('bank-form');
    if (form) form.reset();
    const editIdField = document.getElementById('bank-edit-id');
    if (editIdField) editIdField.value = '';
}

export async function handleBankSubmit(event) {
    event.preventDefault();

    const editId = document.getElementById('bank-edit-id')?.value || '';
    const bankName = document.getElementById('bank-name')?.value.trim() || '';
    const accountNumber = document.getElementById('bank-acc-num')?.value.trim() || '';
    const cardNumber = document.getElementById('bank-card-num')?.value.trim() || '';
    const cardHolder = document.getElementById('bank-card-holder')?.value.trim() || '';
    const cardPin = document.getElementById('bank-pin')?.value || '';
    const financialCeiling = parseFloat(document.getElementById('bank-ceiling')?.value || 0);
    const owningCompany = document.getElementById('bank-company-input')?.value.trim() || '';
    const resetTime = document.getElementById('bank-reset-time-input')?.value || '00:00';

    if (!bankName) {
        showToast('أدخل اسم الحساب البنكي', 'warning');
        return;
    }
    if (!owningCompany) {
        showToast('أدخل الشركة المالكة', 'warning');
        return;
    }
    if (!financialCeiling || financialCeiling <= 0) {
        showToast('أدخل سقفاً مالياً صحيحاً', 'warning');
        return;
    }

    const btn = document.getElementById('bank-btn-text');
    const spinner = document.getElementById('bank-spinner');
    const originalText = btn?.textContent || 'حفظ';

    if (btn) btn.textContent = 'جاري الحفظ...';
    if (spinner) spinner.classList.remove('hidden');

    try {
        const bankData = {
            bank_account: bankName,
            account_number: accountNumber,
            card_number: cardNumber,
            card_holder: cardHolder,
            card_pin: cardPin,
            financial_ceiling: financialCeiling,
            owning_company: owningCompany,
            reset_time: resetTime
        };

        if (editId) {
            await updateBankAccount(editId, bankData);
            showToast('تم تحديث الحساب البنكي ✅', 'success');
        } else {
            await createBankAccount(bankData);
            showToast('تمت إضافة الحساب البنكي ✅', 'success');
        }

        closeBankModal();
        if (typeof window.renderBankAccounts === 'function') window.renderBankAccounts();
        if (typeof window.updateDynamicBankFilter === 'function') window.updateDynamicBankFilter();
    } catch (error) {
        console.error(error);
        showToast('فشل الحفظ: ' + error.message, 'error');
    } finally {
        if (btn) btn.textContent = originalText;
        if (spinner) spinner.classList.add('hidden');
    }
}

// ==========================================
// نافذة العميل المديون (Debtor Modal)
// ==========================================

export function openDebtorModal(editId = null) {
    const modal = document.getElementById('debtor-modal');
    const title = document.getElementById('debtor-modal-title');
    const editIdField = document.getElementById('debtor-edit-id');
    const nameField = document.getElementById('debtor-name');
    const amountField = document.getElementById('debtor-amount');
    const regionSelect = document.getElementById('debtor-region');
    const manualRegion = document.getElementById('debtor-region-manual');

    if (!modal) return;

    const form = document.getElementById('debtor-form');
    if (form) form.reset();

    // تعبئة قائمة المناطق
    populateDebtorRegionsDropdown();

    if (editId) {
        const debtor = (window.App.records || []).find(r => r.is_debtor_customer && r.id === editId);
        if (!debtor) {
            showToast('العميل غير موجود', 'error');
            return;
        }
        if (title) title.textContent = 'تعديل عميل مديون';
        if (editIdField) editIdField.value = debtor.id;
        if (nameField) nameField.value = debtor.customer_name || '';
        if (amountField) amountField.value = debtor.debt_amount || '';

        const region = debtor.region || '';
        const optionExists = regionSelect ? [...regionSelect.options].some(opt => opt.value === region) : false;
        if (optionExists) {
            if (regionSelect) regionSelect.value = region;
            if (manualRegion) {
                manualRegion.classList.add('hidden');
                manualRegion.required = false;
                manualRegion.value = '';
            }
        } else {
            if (regionSelect) regionSelect.value = 'new_manual_region';
            if (manualRegion) {
                manualRegion.classList.remove('hidden');
                manualRegion.required = true;
                manualRegion.value = region;
            }
        }
    } else {
        if (title) title.textContent = 'إضافة عميل مديون';
        if (editIdField) editIdField.value = '';
        if (regionSelect) regionSelect.value = '';
        if (manualRegion) {
            manualRegion.classList.add('hidden');
            manualRegion.required = false;
            manualRegion.value = '';
        }
    }

    modal.classList.remove('hidden');
}

export function closeDebtorModal() {
    const modal = document.getElementById('debtor-modal');
    if (modal) modal.classList.add('hidden');
    const form = document.getElementById('debtor-form');
    if (form) form.reset();
    const editIdField = document.getElementById('debtor-edit-id');
    if (editIdField) editIdField.value = '';
    const manualRegion = document.getElementById('debtor-region-manual');
    if (manualRegion) {
        manualRegion.classList.add('hidden');
        manualRegion.required = false;
    }
}

export async function handleDebtorSubmit(event) {
    event.preventDefault();

    const editId = document.getElementById('debtor-edit-id')?.value || '';
    const customerName = document.getElementById('debtor-name')?.value.trim() || '';
    const debtAmount = parseFloat(document.getElementById('debtor-amount')?.value || 0);
    let region = document.getElementById('debtor-region')?.value || '';
    const manualRegion = document.getElementById('debtor-region-manual')?.value.trim() || '';

    if (region === 'new_manual_region') {
        region = manualRegion;
    }

    if (!customerName) {
        showToast('أدخل اسم العميل', 'warning');
        return;
    }
    if (!region) {
        showToast('اختر المنطقة أو أدخلها يدوياً', 'warning');
        return;
    }
    if (!debtAmount || debtAmount <= 0) {
        showToast('أدخل مبلغاً صحيحاً', 'warning');
        return;
    }

    const btn = document.getElementById('debtor-btn-text');
    const spinner = document.getElementById('debtor-spinner');
    const originalText = btn?.textContent || 'حفظ';

    if (btn) btn.textContent = 'جاري الحفظ...';
    if (spinner) spinner.classList.remove('hidden');

    try {
        const debtorData = {
            customer_name: customerName,
            debt_amount: Math.round(debtAmount),
            region: region
        };

        if (editId) {
            await updateDebtor(editId, debtorData);
            showToast('تم تحديث العميل المديون ✅', 'success');
        } else {
            await createDebtor(debtorData);
            showToast('تم إضافة العميل المديون ✅', 'success');
        }

        closeDebtorModal();
        if (typeof window.renderDebtors === 'function') window.renderDebtors();
        if (typeof window.renderDebtorOptions === 'function') window.renderDebtorOptions();
    } catch (error) {
        console.error(error);
        showToast('فشل الحفظ: ' + error.message, 'error');
    } finally {
        if (btn) btn.textContent = originalText;
        if (spinner) spinner.classList.add('hidden');
    }
}

// ==========================================
// نافذة الإيداع الفاشل (Failed Deposit Modal)
// ==========================================

export function openFailedModal(editId = null) {
    const modal = document.getElementById('failed-modal');
    const title = document.getElementById('failed-modal-title');
    const editIdField = document.getElementById('failed-edit-id');
    const dateField = document.getElementById('failed-date');
    const timeField = document.getElementById('failed-time');
    const bankSelect = document.getElementById('failed-bank-name');
    const accountNumberField = document.getElementById('failed-account-number');
    const amountField = document.getElementById('failed-amount');
    const branchAddressField = document.getElementById('failed-branch-address');
    const branchNumberField = document.getElementById('failed-branch-number');
    const deviceNumberField = document.getElementById('failed-device-number');
    const cardNumberField = document.getElementById('failed-card-number');
    const cardHolderField = document.getElementById('failed-card-holder');
    const cardCodeField = document.getElementById('failed-card-code');
    const statusSelect = document.getElementById('failed-status');
    const bankResponseField = document.getElementById('failed-bank-response-text');
    const refundAmountField = document.getElementById('failed-refund-amount');
    const rejectionReasonField = document.getElementById('failed-rejection-reason');

    if (!modal) return;

    const form = document.getElementById('failed-form');
    if (form) form.reset();

    // تعبئة قائمة الحسابات البنكية
    const banks = getActiveBankAccounts();
    if (bankSelect) {
        const current = bankSelect.value;
        bankSelect.innerHTML = '<option value="">اختر الحساب</option>' +
            banks.map(b => `<option value="${escapeHtml(b.bank_account)}" data-account-number="${escapeHtml(b.account_number || '')}" data-card-number="${escapeHtml(b.card_number || '')}" data-card-holder="${escapeHtml(b.card_holder || '')}">${escapeHtml(b.bank_account)}</option>`).join('');
        if (current) bankSelect.value = current;
    }

    const today = dateInputAden();
    const nowTime = timeInputAden();

    if (editId) {
        const failed = (window.App.records || []).find(r => r.is_failed_deposit && r.id === editId);
        if (!failed) {
            showToast('الإيداع الفاشل غير موجود', 'error');
            return;
        }
        if (title) title.textContent = 'تعديل عملية إيداع فاشل';
        if (editIdField) editIdField.value = failed.id;
        if (dateField) dateField.value = failed.date || today;
        if (timeField) timeField.value = failed.time || nowTime;
        if (bankSelect) bankSelect.value = failed.bank_account || '';
        if (accountNumberField) accountNumberField.value = failed.account_number || '';
        if (amountField) amountField.value = failed.amount || '';
        if (branchAddressField) branchAddressField.value = failed.branch_address || '';
        if (branchNumberField) branchNumberField.value = failed.branch_number || '';
        if (deviceNumberField) deviceNumberField.value = failed.device_number || '';
        if (cardNumberField) cardNumberField.value = failed.card_number || '';
        if (cardHolderField) cardHolderField.value = failed.card_holder || '';
        if (cardCodeField) cardCodeField.value = failed.card_code || '';
        if (statusSelect) statusSelect.value = failed.status || 'pending';
        if (bankResponseField) bankResponseField.value = failed.bank_response_text || '';
        if (refundAmountField) refundAmountField.value = failed.refund_amount || '';
        if (rejectionReasonField) rejectionReasonField.value = failed.rejection_reason || '';

        // إظهار/إخفاء الحقول حسب الحالة
        if (statusSelect) statusSelect.dispatchEvent(new Event('change'));
    } else {
        if (title) title.textContent = 'إضافة عملية إيداع فاشل';
        if (editIdField) editIdField.value = '';
        if (dateField) dateField.value = today;
        if (timeField) timeField.value = nowTime;
        if (statusSelect) statusSelect.value = 'pending';
        if (refundAmountField) refundAmountField.value = '';
        if (rejectionReasonField) rejectionReasonField.value = '';
        if (statusSelect) statusSelect.dispatchEvent(new Event('change'));
    }

    modal.classList.remove('hidden');
}

export function closeFailedModal() {
    const modal = document.getElementById('failed-modal');
    if (modal) modal.classList.add('hidden');
    const form = document.getElementById('failed-form');
    if (form) form.reset();
    const editIdField = document.getElementById('failed-edit-id');
    if (editIdField) editIdField.value = '';
}

export async function handleFailedSubmit(event) {
    event.preventDefault();

    const editId = document.getElementById('failed-edit-id')?.value || '';
    const date = document.getElementById('failed-date')?.value || '';
    const time = document.getElementById('failed-time')?.value || '';
    const bankAccount = document.getElementById('failed-bank-name')?.value || '';
    const accountNumber = document.getElementById('failed-account-number')?.value || '';
    const amount = parseFloat(document.getElementById('failed-amount')?.value || 0);
    const branchAddress = document.getElementById('failed-branch-address')?.value || '';
    const branchNumber = document.getElementById('failed-branch-number')?.value || '';
    const deviceNumber = document.getElementById('failed-device-number')?.value || '';
    const cardNumber = document.getElementById('failed-card-number')?.value || '';
    const cardHolder = document.getElementById('failed-card-holder')?.value || '';
    const cardCode = document.getElementById('failed-card-code')?.value || '';
    const status = document.getElementById('failed-status')?.value || 'pending';
    const bankResponseText = document.getElementById('failed-bank-response-text')?.value || '';
    const refundAmount = status === 'refunded' ? parseFloat(document.getElementById('failed-refund-amount')?.value || 0) : 0;
    const rejectionReason = status === 'rejected' ? (document.getElementById('failed-rejection-reason')?.value || '') : '';

    if (!bankAccount) {
        showToast('اختر الحساب البنكي', 'warning');
        return;
    }
    if (!accountNumber) {
        showToast('أدخل رقم الحساب', 'warning');
        return;
    }
    if (!amount || amount <= 0) {
        showToast('أدخل مبلغاً صحيحاً', 'warning');
        return;
    }

    const btn = document.getElementById('failed-btn-text');
    const spinner = document.getElementById('failed-spinner');
    const originalText = btn?.textContent || 'حفظ';

    if (btn) btn.textContent = 'جاري الحفظ...';
    if (spinner) spinner.classList.remove('hidden');

    try {
        const failedData = {
            date,
            time,
            bank_account: bankAccount,
            account_number: accountNumber,
            amount: Math.round(amount),
            branch_address: branchAddress,
            branch_number: branchNumber,
            device_number: deviceNumber,
            card_number: cardNumber,
            card_holder: cardHolder,
            card_code: cardCode,
            status,
            bank_response_text: bankResponseText,
            refund_amount: refundAmount,
            rejection_reason: rejectionReason
        };

        if (editId) {
            await updateFailedDeposit(editId, failedData);
            showToast('تم تحديث الإيداع الفاشل ✅', 'success');
        } else {
            await createFailedDeposit(failedData);
            showToast('تم تسجيل الإيداع الفاشل ✅', 'success');
        }

        closeFailedModal();
        if (typeof window.renderFailedDeposits === 'function') window.renderFailedDeposits();
    } catch (error) {
        console.error(error);
        showToast('فشل الحفظ: ' + error.message, 'error');
    } finally {
        if (btn) btn.textContent = originalText;
        if (spinner) spinner.classList.add('hidden');
    }
}

// ==========================================
// نافذة التأكيد (Confirm Modal)
// ==========================================

export function openConfirmModal(message, onConfirm, onCancel = null) {
    const modal = document.getElementById('confirm-modal');
    const messageEl = document.getElementById('confirm-message');
    const yesBtn = document.getElementById('confirm-yes-btn');
    const noBtn = document.getElementById('confirm-no-btn');

    if (!modal) return;

    if (messageEl) messageEl.textContent = message || 'هل أنت متأكد؟';

    const handleYes = () => {
        if (onConfirm) onConfirm();
        closeConfirmModal();
        if (yesBtn) yesBtn.removeEventListener('click', handleYes);
        if (noBtn) noBtn.removeEventListener('click', handleNo);
    };

    const handleNo = () => {
        if (onCancel) onCancel();
        closeConfirmModal();
        if (yesBtn) yesBtn.removeEventListener('click', handleYes);
        if (noBtn) noBtn.removeEventListener('click', handleNo);
    };

    if (yesBtn) yesBtn.addEventListener('click', handleYes);
    if (noBtn) noBtn.addEventListener('click', handleNo);

    modal.classList.remove('hidden');
}

export function closeConfirmModal() {
    const modal = document.getElementById('confirm-modal');
    if (modal) modal.classList.add('hidden');
}

// ==========================================
// نافذة المستخدم (User Modal) – تم نقلها إلى userUI.js
// نستخدمها هنا للتوافق
// ==========================================

export function openUserModal() {
    if (typeof window.openUserModal === 'function') {
        window.openUserModal();
    } else {
        console.warn('openUserModal not defined, userUI.js might not be loaded');
    }
}

export function closeUserModal() {
    if (typeof window.closeUserModal === 'function') {
        window.closeUserModal();
    } else {
        const modal = document.getElementById('user-modal');
        if (modal) modal.classList.add('hidden');
    }
}

// ==========================================
// ربط أزرار النوافذ بالأحداث
// ==========================================

export function bindModalButtons() {
    // بنك
    const addBankBtn = document.getElementById('add-bank-btn');
    if (addBankBtn) addBankBtn.addEventListener('click', () => openBankModal());
    const closeBankBtn = document.getElementById('close-bank-modal');
    if (closeBankBtn) closeBankBtn.addEventListener('click', closeBankModal);
    const bankForm = document.getElementById('bank-form');
    if (bankForm) bankForm.addEventListener('submit', handleBankSubmit);

    // عميل مديون
    const addDebtorBtn = document.getElementById('add-debtor-btn');
    if (addDebtorBtn) addDebtorBtn.addEventListener('click', () => openDebtorModal());
    const closeDebtorBtn = document.getElementById('close-debtor-modal');
    if (closeDebtorBtn) closeDebtorBtn.addEventListener('click', closeDebtorModal);
    const debtorForm = document.getElementById('debtor-form');
    if (debtorForm) debtorForm.addEventListener('submit', handleDebtorSubmit);

    // إيداع فاشل
    const addFailedBtn = document.getElementById('add-failed-btn');
    if (addFailedBtn) addFailedBtn.addEventListener('click', () => openFailedModal());
    const closeFailedBtn = document.getElementById('close-failed-modal');
    if (closeFailedBtn) closeFailedBtn.addEventListener('click', closeFailedModal);
    const failedForm = document.getElementById('failed-form');
    if (failedForm) failedForm.addEventListener('submit', handleFailedSubmit);

    // مستخدم – نربط الأزرار الموجودة في الـ HTML
    const addUserBtn = document.getElementById('add-user-btn');
    if (addUserBtn) addUserBtn.addEventListener('click', () => openUserModal());
    const closeUserBtn = document.getElementById('close-user-modal');
    if (closeUserBtn) closeUserBtn.addEventListener('click', closeUserModal);

    // تأكيد
    const confirmCloseBtn = document.getElementById('close-confirm-modal');
    if (confirmCloseBtn) confirmCloseBtn.addEventListener('click', closeConfirmModal);
}

