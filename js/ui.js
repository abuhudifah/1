// ==========================================
// ui.js - العرض العام وإدارة الواجهة (نسخة محسنة ومؤمنة بالكامل)
// ==========================================

import { showToast, setOfflineBanner, dateInputAden, localTime12h, escapeHtml, money, isAdmin, currentUserName } from './utils.js';
import { renderBankAccounts, updateDynamicBankFilter } from './features/banking/bankUI.js';
import { renderDebtors, renderDebtorOptions, populateDebtorRegionsDropdown } from './features/debtors/debtorUI.js';
import { getDebtorRecords } from './features/debtors/debtorService.js';
import { renderFailedDeposits } from './features/failedDeposits/failedUI.js';
import { renderNotifications, bindNotificationUIEvents } from './features/notifications/notificationUI.js';
import { renderUsersTable, bindUserUIEvents } from './features/users/userUI.js';
import { getActiveBankAccounts } from './features/banking/bankService.js';
import { getFailedDeposits } from './features/failedDeposits/failedService.js';
import { getCurrentUserNotifications } from './features/notifications/notificationService.js';
import { getAllOperations } from './features/records/recordService.js';
import { calculatePreviousBalance } from './core/closing.js';

// خارطة ألوان وأصناف Tailwind CSS لضمان عدم حذفها أثناء بناء المشروع (PurgeCSS)
const typeStyles = {
    collection: { border: 'border-green-500', bg: 'bg-green-100', text: 'text-green-800', amount: 'text-green-600' },
    deposit: { border: 'border-blue-500', bg: 'bg-blue-100', text: 'text-blue-800', amount: 'text-blue-600' },
    expense: { border: 'border-red-500', bg: 'bg-red-100', text: 'text-red-800', amount: 'text-red-600' },
    receipt: { border: 'border-purple-500', bg: 'bg-purple-100', text: 'text-purple-800', amount: 'text-purple-600' },
    delivery: { border: 'border-orange-500', bg: 'bg-orange-100', text: 'text-orange-800', amount: 'text-orange-600' }
};
const defaultStyle = { border: 'border-gray-500', bg: 'bg-gray-100', text: 'text-gray-800', amount: 'text-gray-600' };

// ==========================================
// دوال مساعدة
// ==========================================

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '');
}

function formatNumber(num) {
    return Math.round(num || 0).toLocaleString('en-US');
}

// ==========================================
// ملخص اليوم (Daily Summary)
// ==========================================

export async function renderDailySummary() {
    const dateInput = document.getElementById('daily-summary-date');
    const targetDate = dateInput?.value || dateInputAden();
    
    const currentUserId = window?.App?.currentUser?.id;
    const currentAgentName = currentUserName();
    const allOps = getAllOperations() || [];
    
    const dayOps = allOps.filter(r => {
        if (r.date !== targetDate) return false;
        if (currentUserId && r.user_id) return r.user_id === currentUserId;
        return r.agent_name === currentAgentName;
    });
    
    const collections = dayOps.filter(r => r.type === 'collection').reduce((s, r) => s + (r.amount || 0), 0);
    const deposits = dayOps.filter(r => r.type === 'deposit').reduce((s, r) => s + (r.amount || 0), 0);
    const expenses = dayOps.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
    const receipts = dayOps.filter(r => r.type === 'receipt').reduce((s, r) => s + (r.amount || 0), 0);
    const deliveries = dayOps.filter(r => r.type === 'delivery').reduce((s, r) => s + (r.amount || 0), 0);
    
    const previousBalance = await calculatePreviousBalance(targetDate);
    const remaining = previousBalance + collections + receipts - deposits - expenses - deliveries;
    
    setText('previous-balance', formatNumber(previousBalance));
    setText('total-collections', formatNumber(collections));
    setText('total-deposits', formatNumber(deposits));
    setText('total-expenses', formatNumber(expenses));
    setText('total-receipts', formatNumber(receipts));
    setText('total-deliveries', formatNumber(deliveries));
    setText('remaining-balance', formatNumber(remaining));
    
    const list = document.getElementById('operations-list');
    if (!list) return;
    if (dayOps.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-500 py-12 text-lg">لا توجد عمليات لهذا اليوم</p>';
        return;
    }
    
    const sorted = [...dayOps].sort((a, b) => new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`));
    const typeLabels = { collection: 'تحصيل', deposit: 'إيداع', expense: 'مصروف', receipt: 'استلام', delivery: 'تسليم' };
    
    list.innerHTML = sorted.map(r => {
        const style = typeStyles[r.type] || defaultStyle;
        let details = '';
        if (r.type === 'collection') {
            details = `${r.collection_type} ${r.customer_name ? '- ' + r.customer_name : ''} ${r.bank_account ? '(بطاقة: ' + r.bank_account + ')' : ''}`;
        } else if (r.type === 'deposit') {
            details = `إلى حساب: ${r.bank_account}`;
        } else if (r.type === 'expense') {
            details = `${r.expense_type} ${r.expense_details ? '- ' + r.expense_details : ''}`;
        } else if (r.type === 'receipt') {
            details = `من: ${r.received_from}`;
        } else if (r.type === 'delivery') {
            details = `إلى: ${r.delivered_to}`;
        }
        
        let cardClass = `operation-card bg-white border-r-4 ${style.border} rounded-xl p-4 mb-3 shadow-sm hover:shadow-md transition flex flex-col md:flex-row justify-between md:items-center gap-3`;
        let badgeHtml = '';
        if (r.is_reversal) {
            cardClass += ' bg-orange-50 border-orange-300';
            badgeHtml = '<span class="text-[10px] bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full ml-2">قيد عكسي</span>';
        } else if (r.is_reversed) {
            cardClass += ' bg-gray-100 opacity-80 line-through';
            badgeHtml = '<span class="text-[10px] bg-red-200 text-red-800 px-2 py-0.5 rounded-full ml-2">ملغاة (معكوسة)</span>';
        } else if (r.is_correction) {
            badgeHtml = '<span class="text-[10px] bg-blue-200 text-blue-800 px-2 py-0.5 rounded-full ml-2">تعديل</span>';
        }
        
        const recordIdStr = escapeHtml(String(r.id || ''));
        
        return `
        <div class="${cardClass}">
            <div>
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="${style.bg} ${style.text} text-xs px-2 py-1 rounded font-bold">${typeLabels[r.type] || r.type}</span>
                    <span class="text-xs text-gray-500" dir="ltr">${r.date} ${localTime12h(r.time)}</span>
                    ${badgeHtml}
                </div>
                <p class="font-bold text-gray-800 text-lg">${escapeHtml(details)}</p>
                <p class="text-sm text-gray-500"><i class="fas fa-user ml-1"></i> ${escapeHtml(r.agent_name || '')}</p>
            </div>
            <div class="text-right md:text-left flex flex-row md:flex-col justify-between items-center md:items-end w-full md:w-auto">
                <p class="font-bold text-2xl ${style.amount}" dir="ltr">${formatNumber(r.amount)}</p>
                <div class="flex gap-2 mt-2">
                    <button type="button" class="action-btn btn-edit" data-edit-record="${recordIdStr}" title="تعديل"><i class="fas fa-pen"></i></button>
                    <button type="button" class="action-btn btn-delete" data-delete-record="${recordIdStr}" title="حذف"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// لوحة المعلومات (Dashboard)
// ==========================================

export async function renderDashboard() {
    if (!isAdmin()) return;
    const ops = getAllOperations() || [];
    const today = dateInputAden();
    const todayOps = ops.filter(r => r.date === today);
    const totalUsers = (window?.App?.users || []).filter(u => !u.deleted_at).length;
    const totalRecords = ops.length;
    const totalCollections = todayOps.filter(r => r.type === 'collection').reduce((s, r) => s + (r.amount || 0), 0);
    const totalDeposits = todayOps.filter(r => r.type === 'deposit').reduce((s, r) => s + (r.amount || 0), 0);
    const totalExpenses = todayOps.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
    const totalReceipts = todayOps.filter(r => r.type === 'receipt').reduce((s, r) => s + (r.amount || 0), 0);
    const totalDeliveries = todayOps.filter(r => r.type === 'delivery').reduce((s, r) => s + (r.amount || 0), 0);
    const unread = (getCurrentUserNotifications() || []).filter(n => !n.is_read).length;
    const activeBanks = (getActiveBankAccounts() || []).length;
    const debtors = (getDebtorRecords() || []).length;
    const failedDeposits = (getFailedDeposits() || []).length;
    
    setText('dashboard-total-records', totalRecords);
    setText('dashboard-total-users', totalUsers);
    setText('dashboard-total-collections', formatNumber(totalCollections));
    setText('dashboard-total-deposits', formatNumber(totalDeposits));
    setText('dashboard-total-expenses', formatNumber(totalExpenses));
    setText('dashboard-total-receipts', formatNumber(totalReceipts));
    setText('dashboard-total-deliveries', formatNumber(totalDeliveries));
    setText('dashboard-total-unread-notifications', unread);
    setText('dashboard-total-banks', activeBanks);
    setText('dashboard-total-debtors', debtors);
    setText('dashboard-total-failed-deposits', failedDeposits);
    
    const previousBalance = await calculatePreviousBalance(today);
    const remaining = previousBalance + totalCollections + totalReceipts - totalDeposits - totalExpenses - totalDeliveries;
    setText('dashboard-previous-balance', formatNumber(previousBalance));
    setText('dashboard-remaining-balance', formatNumber(remaining));
}

// ==========================================
// جميع العمليات (للمدير)
// ==========================================

export function renderAllOperations() {
    const target = document.getElementById('all-operations-list') || document.getElementById('operations-list');
    if (!target) return;
    
    let filtered = getAllOperations() || [];
    const agentFilter = document.getElementById('filter-agent')?.value || '';
    const typeFilter = document.getElementById('filter-type')?.value || '';
    const dateType = document.getElementById('operations-date-type')?.value || 'day';
    const dayVal = document.getElementById('operations-filter-day')?.value || '';
    const monthVal = document.getElementById('operations-filter-month')?.value || '';
    const startVal = document.getElementById('operations-filter-start')?.value || '';
    const endVal = document.getElementById('operations-filter-end')?.value || '';
    
    if (agentFilter) filtered = filtered.filter(r => r.agent_name === agentFilter);
    if (typeFilter) filtered = filtered.filter(r => r.type === typeFilter);
    if (dateType === 'day' && dayVal) filtered = filtered.filter(r => r.date === dayVal);
    else if (dateType === 'month' && monthVal) filtered = filtered.filter(r => r.date.startsWith(monthVal));
    else if (dateType === 'period') {
        if (startVal) filtered = filtered.filter(r => r.date >= startVal);
        if (endVal) filtered = filtered.filter(r => r.date <= endVal);
    }
    
    filtered.sort((a, b) => new Date(`${b.date}T${b.time || '00:00'}`) - new Date(`${a.date}T${a.time || '00:00'}`));
    if (filtered.length === 0) {
        target.innerHTML = '<p class="text-center text-gray-500 py-12">لا توجد عمليات مطابقة للفلاتر المحددة</p>';
        return;
    }
    
    const typeLabels = { collection: 'تحصيل', deposit: 'إيداع', expense: 'مصروف', receipt: 'استلام', delivery: 'تسليم' };
    target.innerHTML = filtered.map(r => {
        let details = '';
        if (r.type === 'collection') details = `${r.collection_type} ${r.customer_name ? '- ' + r.customer_name : ''}`;
        else if (r.type === 'deposit') details = `إلى حساب: ${r.bank_account}`;
        else if (r.type === 'expense') details = `${r.expense_type} ${r.expense_details ? '- ' + r.expense_details : ''}`;
        else if (r.type === 'receipt') details = `من: ${r.received_from}`;
        else if (r.type === 'delivery') details = `إلى: ${r.delivered_to}`;
        
        let badgeHtml = '';
        if (r.is_reversal) badgeHtml = '<span class="text-[10px] bg-orange-200 text-orange-800 px-2 py-0.5 rounded-full ml-2">قيد عكسي</span>';
        else if (r.is_reversed) badgeHtml = '<span class="text-[10px] bg-red-200 text-red-800 px-2 py-0.5 rounded-full ml-2">ملغاة</span>';
        
        const recordIdStr = escapeHtml(String(r.id || ''));
        
        return `
        <div class="operation-card bg-white border rounded-xl p-4 mb-3 shadow-sm hover:shadow-md transition flex flex-col md:flex-row justify-between md:items-center gap-3">
            <div>
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                    <span class="bg-slate-100 text-slate-800 text-xs px-2 py-1 rounded font-bold">${typeLabels[r.type] || r.type}</span>
                    <span class="text-xs text-gray-500" dir="ltr">${r.date} ${localTime12h(r.time)}</span>
                    ${badgeHtml}
                </div>
                <p class="font-bold text-gray-800 text-lg">${escapeHtml(details)}</p>
                <p class="text-sm text-gray-500"><i class="fas fa-user ml-1"></i> ${escapeHtml(r.agent_name || '')}</p>
            </div>
            <div class="text-right md:text-left flex flex-row md:flex-col justify-between items-center md:items-end w-full md:w-auto">
                <p class="font-bold text-2xl text-slate-700" dir="ltr">${formatNumber(r.amount)}</p>
                <div class="flex gap-2 mt-2">
                    <button type="button" class="action-btn btn-edit" data-edit-record="${recordIdStr}" title="تعديل"><i class="fas fa-pen"></i></button>
                    <button type="button" class="action-btn btn-delete" data-delete-record="${recordIdStr}" title="حذف"><i class="fas fa-trash"></i></button>
                </div>
            </div>
        </div>`;
    }).join('');
}

// ==========================================
// التحديث الشامل
// ==========================================

export async function refreshUI() {
    if (!window?.App?.currentUser) return;
    await renderDailySummary();
    if (isAdmin()) {
        await renderDashboard();
        renderAllOperations();
        renderUsersTable();
        renderAuditTable();
    }
    renderBankAccounts();
    renderDebtors();
    renderFailedDeposits();
    renderNotifications();
    updateDynamicBankFilter();
    updateCurrentDataSize();
    const dateEl = document.getElementById('current-date');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('ar-EG');
}

function updateCurrentDataSize() {
    const el = document.getElementById('current-data-size');
    if (!el) return;
    const size = (window?.App?.records || []).length + (window?.App?.users || []).length +
                 (window?.App?.notifications || []).length + (window?.App?.auditLogs || []).length;
    el.textContent = String(size);
}

function renderAuditTable() {
    const tbody = document.getElementById('audit-table-body');
    const emptyMsg = document.getElementById('audit-empty-msg');
    if (!tbody) return;
    const logs = [...(window?.App?.auditLogs || [])].sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    if (logs.length === 0) {
        tbody.innerHTML = '';
        if (emptyMsg) emptyMsg.classList.remove('hidden');
        return;
    }
    if (emptyMsg) emptyMsg.classList.add('hidden');
    tbody.innerHTML = logs.map(log => `
        <tr class="border-b border-gray-100">
            <td class="p-3 text-sm" dir="ltr">${new Date(log.timestamp || Date.now()).toLocaleString('ar-EG')}</td>
            <td class="p-3 font-bold">${escapeHtml(log.display_name || log.username || 'غير معروف')}</td>
            <td class="p-3"><span class="px-2 py-1 rounded text-xs font-bold ${log.action === 'delete' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">${log.action === 'delete' ? 'حذف' : 'تعديل'}</span></td>
            <td class="p-3">${escapeHtml(log.record_type || '—')}</td>
            <td class="p-3 text-sm max-w-xs break-words">${escapeHtml(log.old_value ? JSON.stringify(log.old_value).substring(0, 60) : '—')}</td>
        </tr>
    `).join('');
}


// ==========================================
// التنقل بين التبويبات (Tab Navigation)
// ==========================================

export async function switchTab(tabId) {
    // 1. إخفاء كافة التبويبات
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden');
    });
    
    // 2. إظهار التبويب المطلوب
    const activeTab = document.getElementById(`${tabId}-tab`);
    if (activeTab) {
        activeTab.classList.remove('hidden');
    } else {
        console.warn(`التبويب ${tabId}-tab غير موجود في الواجهة.`);
    }

    // 3. تحديث مظهر الأزرار (إضافة تأثيرات بصرية للزر النشط إن وجدت)
    document.querySelectorAll('[data-tab]').forEach(btn => {
        if (btn.dataset.tab === tabId) {
            btn.classList.add('bg-blue-50', 'text-blue-600'); // تخصيص حسب ألوان مشروعك
            btn.classList.remove('text-gray-500');
        } else {
            btn.classList.remove('bg-blue-50', 'text-blue-600');
            btn.classList.add('text-gray-500');
        }
    });

    // 4. الاستدعاء الموجه (Lazy Loading) - جلب وعرض البيانات للتبويب المفتوح فقط
    switch (tabId) {
        case 'daily-summary':
            await renderDailySummary();
            break;
        case 'bank-accounts':
            renderBankAccounts();
            break;
        case 'debtor-customers':
            renderDebtors();
            break;
        case 'dashboard':
            if (isAdmin()) await renderDashboard();
            break;
        case 'all-operations':
            if (isAdmin()) renderAllOperations();
            break;
        case 'users-management':
            if (isAdmin()) renderUsersTable();
            break;
        case 'failed-deposits':
            renderFailedDeposits();
            break;
        case 'notifications':
            renderNotifications();
            break;
    }
}

function bindGlobalEvents() {
    document.querySelectorAll('[data-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabId = btn.dataset.tab;
            if (typeof window.switchTab === 'function') window.switchTab(tabId);
        });
    });
    const filterButtons = ['apply-data-entry-filter', 'apply-daily-filter', 'apply-bank-filter', 'apply-all-operations-filter'];
    filterButtons.forEach(id => {
        const btn = document.getElementById(id);
        if (btn) btn.addEventListener('click', refreshUI);
    });
    const filterInputs = ['daily-summary-date', 'bank-accounts-date', 'filter-agent', 'filter-type', 'operations-date-type'];
    filterInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', refreshUI);
    });
    const syncBtn = document.getElementById('manual-sync-btn');
    if (syncBtn) {
        syncBtn.addEventListener('click', async () => {
            if (typeof window.flushOutbox === 'function') {
                try {
                    syncBtn.disabled = true;
                    const originalText = syncBtn.textContent;
                    syncBtn.textContent = 'جاري المزامنة... ⏳';
                    
                    await window.flushOutbox();
                    showToast('تمت المزامنة بنجاح ✅', 'success');
                    await refreshUI();
                    
                    syncBtn.textContent = originalText;
                } catch (error) {
                    console.error('حدث خطأ أثناء المزامنة الشخصية:', error);
                    showToast('فشلت المزامنة ❌ يرجى التحقق من اتصال الشبكة', 'error');
                } finally {
                    syncBtn.disabled = false;
                }
            }
        });
    }
}

export function initUI() {
    bindGlobalEvents();
    bindUserUIEvents();
    bindNotificationUIEvents();
    const today = dateInputAden();
    ['data-entry-date', 'daily-summary-date', 'bank-accounts-date', 'filter-date', 'dashboard-date', 'failed-date'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = today;
    });
    window.addEventListener('online', () => {
        setOfflineBanner(false);
        if (typeof window.flushOutbox === 'function') window.flushOutbox();
        refreshUI();
    });
    window.addEventListener('offline', () => setOfflineBanner(true));
    setOfflineBanner(!navigator.onLine);
}

if (typeof window !== 'undefined') {
    window.switchTab = switchTab;
    window.renderDailySummary = renderDailySummary;
    window.renderDashboard = renderDashboard;
    window.renderAllOperations = renderAllOperations;
    window.refreshUI = refreshUI;
    window.runMasterUpdate = refreshUI;
    window.updateUI = refreshUI;
    window.initUI = initUI;
    window.renderAuditTable = renderAuditTable;
    window.updateCurrentDataSize = updateCurrentDataSize;
}
