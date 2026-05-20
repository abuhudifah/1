// ==========================================
// ui.js - العرض العام وإدارة الواجهة
// نسخة محسنة: tab-aware + lazy render + throttled refresh
// ==========================================

import { showToast, setOfflineBanner, dateInputAden, localTime12h, escapeHtml, money, isAdmin, currentUserName } from './utils.js';
import { renderBankAccounts, updateDynamicBankFilter } from './features/banking/bankUI.js';
import { renderDebtors, renderDebtorOptions, populateDebtorRegionsDropdown, renderDebtorSearchResults, applyDebtorSelection } from './features/debtors/debtorUI.js';
import { renderFailedDeposits } from './features/failedDeposits/failedUI.js';
import { renderNotifications } from './features/notifications/notificationUI.js';
import { renderUsersTable } from './features/users/userUI.js';
import { getUnreadNotificationCount } from './features/notifications/notificationService.js';
import { queryOperations, preloadDefaultRecordsWindow, getAllOperations } from './features/records/recordService.js';
import { calculatePreviousBalance } from './core/closing.js';

// خارطة ألوان وأصناف Tailwind CSS لضمان عدم حذفها أثناء البناء
const typeStyles = {
    collection: { border: 'border-green-500', bg: 'bg-green-100', text: 'text-green-800', amount: 'text-green-600' },
    deposit: { border: 'border-blue-500', bg: 'bg-blue-100', text: 'text-blue-800', amount: 'text-blue-600' },
    expense: { border: 'border-red-500', bg: 'bg-red-100', text: 'text-red-800', amount: 'text-red-600' },
    receipt: { border: 'border-purple-500', bg: 'bg-purple-100', text: 'text-purple-800', amount: 'text-purple-600' },
    delivery: { border: 'border-orange-500', bg: 'bg-orange-100', text: 'text-orange-800', amount: 'text-orange-600' }
};
const defaultStyle = { border: 'border-gray-500', bg: 'bg-gray-100', text: 'text-gray-800', amount: 'text-gray-600' };

// ==========================================
// أدوات داخلية
// ==========================================

let refreshQueued = false;

function safeText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = String(value ?? '');
}

function formatNumber(num) {
    return Math.round(num || 0).toLocaleString('en-US');
}

function getCurrentActiveTabId() {
    const activeNavBtn = document.querySelector('#main-nav-tabs .nav-tab.active[data-tab], #bottom-nav .bottom-nav-item.active[data-tab]');
    if (activeNavBtn?.dataset?.tab) return activeNavBtn.dataset.tab;

    const visibleTab = document.querySelector('#tabs-container .tab-content:not(.hidden)');
    if (visibleTab?.id) {
        return visibleTab.id.replace(/-tab$/, '');
    }

    return 'data-entry';
}

function setActiveTabButtons(tabId) {
    document.querySelectorAll('#main-nav-tabs [data-tab], #bottom-nav [data-tab]').forEach(btn => {
        const isActive = btn.dataset.tab === tabId;
        btn.classList.toggle('active', isActive);

        if (btn.classList.contains('nav-tab')) {
            btn.classList.toggle('bg-blue-50', isActive);
            btn.classList.toggle('text-blue-600', isActive);
            if (!isActive) {
                btn.classList.remove('bg-blue-50', 'text-blue-600');
            }
        }

        if (btn.classList.contains('bottom-nav-item')) {
            btn.classList.toggle('active', isActive);
        }
    });
}

function setVisibleTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(el => {
        el.classList.add('hidden');
    });

    const activeTab = document.getElementById(`${tabId}-tab`);
    if (activeTab) {
        activeTab.classList.remove('hidden');
    }
}

function updateNotificationBadges(count) {
    const desktopBadge = document.getElementById('notification-badge');
    const mobileBadge = document.getElementById('mobile-notification-badge');

    const safeCount = Math.max(0, Number(count) || 0);
    const text = safeCount > 99 ? '+99' : String(safeCount);

    if (desktopBadge) {
        if (safeCount > 0) {
            desktopBadge.textContent = text;
            desktopBadge.classList.remove('hidden');
        } else {
            desktopBadge.classList.add('hidden');
        }
    }

    if (mobileBadge) {
        if (safeCount > 0) {
            mobileBadge.textContent = text;
            mobileBadge.classList.remove('hidden');
        } else {
            mobileBadge.classList.add('hidden');
        }
    }
}

function refreshNotificationIndicators() {
    try {
        const unreadCount = getUnreadNotificationCount();
        updateNotificationBadges(unreadCount);
    } catch (error) {
        console.warn('فشل تحديث شارات الإشعارات:', error);
    }
}

function updateCurrentDataSize() {
    const el = document.getElementById('current-data-size');
    if (!el) return;

    const recordCount = (window?.App?.recordView?.rows || window?.App?.records || []).length;
    const usersCount = (window?.App?.users || []).length;
    const notificationsCount = (window?.App?.notifications || []).length;
    const auditCount = (window?.App?.auditLogs || []).length;
    const dailyBalancesCount = (window?.App?.dailyBalances || []).length;

    el.textContent = String(recordCount + usersCount + notificationsCount + auditCount + dailyBalancesCount);
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
            <td class="p-3">
                <span class="px-2 py-1 rounded text-xs font-bold ${log.action === 'delete' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}">
                    ${log.action === 'delete' ? 'حذف' : 'تعديل'}
                </span>
            </td>
            <td class="p-3">${escapeHtml(log.record_type || '—')}</td>
            <td class="p-3 text-sm max-w-xs break-words">${escapeHtml(log.old_value ? JSON.stringify(log.old_value).substring(0, 60) : '—')}</td>
        </tr>
    `).join('');
}

async function getOperationsForSummaryDate(targetDate) {
    const user = window?.App?.currentUser || null;
    const filters = user?.role === 'admin'
        ? { date: targetDate, includeDeleted: false }
        : {
            date: targetDate,
            includeDeleted: false,
            userId: user?.id || undefined,
            agentName: user?.display_name || user?.username || undefined
        };

    try {
        const rows = await queryOperations(filters, { setActive: true });
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.warn('تعذر جلب عمليات الملخص من المصدر المهيأ، استخدام الذاكرة كاحتياط:', error);
        const fallback = getAllOperations() || [];
        return fallback.filter(r => r.date === targetDate);
    }
}

async function getOperationsForDashboardDate(targetDate) {
    const filters = { date: targetDate, includeDeleted: false };

    try {
        const rows = await queryOperations(filters, { setActive: false });
        return Array.isArray(rows) ? rows : [];
    } catch (error) {
        console.warn('تعذر جلب عمليات لوحة المعلومات:', error);
        const fallback = getAllOperations() || [];
        return fallback.filter(r => r.date === targetDate);
    }
}

function getAllOperationsFiltersFromUI() {
    const typeFilter = document.getElementById('filter-type')?.value || '';
    const agentFilter = document.getElementById('filter-agent')?.value || '';
    const dateType = document.getElementById('operations-date-type')?.value || 'day';
    const dayVal = document.getElementById('operations-filter-day')?.value || dateInputAden();
    const monthVal = document.getElementById('operations-filter-month')?.value || '';
    const startVal = document.getElementById('operations-filter-start')?.value || '';
    const endVal = document.getElementById('operations-filter-end')?.value || '';

    const filters = {
        includeDeleted: false,
        type: typeFilter || undefined,
        agentName: agentFilter || undefined
    };

    if (dateType === 'day') {
        filters.date = dayVal;
    } else if (dateType === 'month' && monthVal) {
        filters.dateFrom = `${monthVal}-01`;
        const [year, month] = monthVal.split('-').map(Number);
        const lastDay = new Date(year, month, 0).getDate();
        filters.dateTo = `${monthVal}-${String(lastDay).padStart(2, '0')}`;
    } else if (dateType === 'period') {
        if (startVal) filters.dateFrom = startVal;
        if (endVal) filters.dateTo = endVal;
    }

    return filters;
}

// ==========================================
// ملخص اليوم
// ==========================================

export async function renderDailySummary() {
    const dateInput = document.getElementById('daily-summary-date');
    const targetDate = dateInput?.value || dateInputAden();

    const currentOps = await getOperationsForSummaryDate(targetDate);
    const collections = currentOps.filter(r => r.type === 'collection').reduce((s, r) => s + (r.amount || 0), 0);
    const deposits = currentOps.filter(r => r.type === 'deposit').reduce((s, r) => s + (r.amount || 0), 0);
    const expenses = currentOps.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
    const receipts = currentOps.filter(r => r.type === 'receipt').reduce((s, r) => s + (r.amount || 0), 0);
    const deliveries = currentOps.filter(r => r.type === 'delivery').reduce((s, r) => s + (r.amount || 0), 0);

    const previousBalance = await calculatePreviousBalance(targetDate);
    const remaining = previousBalance + collections + receipts - deposits - expenses - deliveries;

    safeText('previous-balance', formatNumber(previousBalance));
    safeText('total-collections', formatNumber(collections));
    safeText('total-deposits', formatNumber(deposits));
    safeText('total-expenses', formatNumber(expenses));
    safeText('total-receipts', formatNumber(receipts));
    safeText('total-deliveries', formatNumber(deliveries));
    safeText('remaining-balance', formatNumber(remaining));

    const list = document.getElementById('operations-list');
    if (!list) return;

    if (currentOps.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-500 py-12 text-lg">لا توجد عمليات لهذا اليوم</p>';
        return;
    }

    const sorted = [...currentOps].sort((a, b) => {
        const ta = new Date(`${a.date}T${a.time || '00:00'}`).getTime();
        const tb = new Date(`${b.date}T${b.time || '00:00'}`).getTime();
        return tb - ta;
    });

    const typeLabels = {
        collection: 'تحصيل',
        deposit: 'إيداع',
        expense: 'مصروف',
        receipt: 'استلام',
        delivery: 'تسليم'
    };

    list.innerHTML = sorted.map(r => {
        const style = typeStyles[r.type] || defaultStyle;
        let details = '';

        if (r.type === 'collection') {
            details = `${r.collection_type || 'تحصيل'} ${r.customer_name ? '- ' + r.customer_name : ''} ${r.bank_account ? '(بطاقة: ' + r.bank_account + ')' : ''}`;
        } else if (r.type === 'deposit') {
            details = `إلى حساب: ${r.bank_account || ''}`;
        } else if (r.type === 'expense') {
            details = `${r.expense_type || 'مصروف'} ${r.expense_details ? '- ' + r.expense_details : ''}`;
        } else if (r.type === 'receipt') {
            details = `من: ${r.received_from || ''}`;
        } else if (r.type === 'delivery') {
            details = `إلى: ${r.delivered_to || ''}`;
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
// لوحة المعلومات
// ==========================================

export async function renderDashboard() {
    if (!isAdmin()) return;

    const today = dateInputAden();
    const todayOps = await getOperationsForDashboardDate(today);

    const totalUsers = (window?.App?.users || []).filter(u => !u.deleted_at).length;
    const totalRecords = (window?.App?.recordView?.rows || window?.App?.records || []).length;
    const totalCollections = todayOps.filter(r => r.type === 'collection').reduce((s, r) => s + (r.amount || 0), 0);
    const totalDeposits = todayOps.filter(r => r.type === 'deposit').reduce((s, r) => s + (r.amount || 0), 0);
    const totalExpenses = todayOps.filter(r => r.type === 'expense').reduce((s, r) => s + (r.amount || 0), 0);
    const totalReceipts = todayOps.filter(r => r.type === 'receipt').reduce((s, r) => s + (r.amount || 0), 0);
    const totalDeliveries = todayOps.filter(r => r.type === 'delivery').reduce((s, r) => s + (r.amount || 0), 0);
    const unread = getUnreadNotificationCount();
    const activeBanks = (window?.App?.records || []).filter(r => r.is_bank_account && !r.deleted_at).length;
    const debtors = (window?.App?.records || []).filter(r => r.is_debtor_customer && !r.deleted_at).length;
    const failedDeposits = (window?.App?.records || []).filter(r => r.is_failed_deposit && !r.deleted_at).length;

    safeText('dashboard-total-records', totalRecords);
    safeText('dashboard-total-users', totalUsers);
    safeText('dashboard-total-collections', formatNumber(totalCollections));
    safeText('dashboard-total-deposits', formatNumber(totalDeposits));
    safeText('dashboard-total-expenses', formatNumber(totalExpenses));
    safeText('dashboard-total-receipts', formatNumber(totalReceipts));
    safeText('dashboard-total-deliveries', formatNumber(totalDeliveries));
    safeText('dashboard-total-unread-notifications', unread);
    safeText('dashboard-total-banks', activeBanks);
    safeText('dashboard-total-debtors', debtors);
    safeText('dashboard-total-failed-deposits', failedDeposits);

    const previousBalance = await calculatePreviousBalance(today);
    const remaining = previousBalance + totalCollections + totalReceipts - totalDeposits - totalExpenses - totalDeliveries;
    safeText('dashboard-previous-balance', formatNumber(previousBalance));
    safeText('dashboard-remaining-balance', formatNumber(remaining));
}

// ==========================================
// جميع العمليات
// ==========================================

export async function renderAllOperations() {
    const target = document.getElementById('all-operations-list') || document.getElementById('operations-list');
    if (!target) return;

    const filters = getAllOperationsFiltersFromUI();
    let filtered = [];

    try {
        filtered = await queryOperations(filters, { setActive: true });
    } catch (error) {
        console.warn('فشل تحميل جميع العمليات من المصدر:', error);
        filtered = getAllOperations() || [];
    }

    if (filters.agentName) {
        filtered = filtered.filter(r => r.agent_name === filters.agentName);
    }
    if (filters.type) {
        filtered = filtered.filter(r => r.type === filters.type);
    }

    if (filtered.length === 0) {
        target.innerHTML = '<p class="text-center text-gray-500 py-12">لا توجد عمليات مطابقة للفلاتر المحددة</p>';
        return;
    }

    const typeLabels = {
        collection: 'تحصيل',
        deposit: 'إيداع',
        expense: 'مصروف',
        receipt: 'استلام',
        delivery: 'تسليم'
    };

    filtered.sort((a, b) => {
        const ta = new Date(`${a.date}T${a.time || '00:00'}`).getTime();
        const tb = new Date(`${b.date}T${b.time || '00:00'}`).getTime();
        return tb - ta;
    });

    target.innerHTML = filtered.map(r => {
        let details = '';
        if (r.type === 'collection') details = `${r.collection_type || 'تحصيل'} ${r.customer_name ? '- ' + r.customer_name : ''}`;
        else if (r.type === 'deposit') details = `إلى حساب: ${r.bank_account || ''}`;
        else if (r.type === 'expense') details = `${r.expense_type || 'مصروف'} ${r.expense_details ? '- ' + r.expense_details : ''}`;
        else if (r.type === 'receipt') details = `من: ${r.received_from || ''}`;
        else if (r.type === 'delivery') details = `إلى: ${r.delivered_to || ''}`;

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
// تبويب / تبويب-نفسه
// ==========================================

async function renderViewForTab(tabId) {
    switch (tabId) {
        case 'data-entry':
            updateDynamicBankFilter();
            renderDebtorOptions();
            populateDebtorRegionsDropdown();
            renderDebtorSearchResults();
            break;

        case 'daily-summary':
            await renderDailySummary();
            break;

        case 'bank-accounts':
            updateDynamicBankFilter();
            renderBankAccounts();
            break;

        case 'debtor-customers':
            renderDebtors();
            renderDebtorOptions();
            populateDebtorRegionsDropdown();
            break;

        case 'failed-deposits':
            renderFailedDeposits();
            break;

        case 'notifications-view':
            renderNotifications();
            break;

        case 'dashboard':
            if (isAdmin()) await renderDashboard();
            break;

        case 'all-operations':
            if (isAdmin()) await renderAllOperations();
            break;

        case 'users-management':
            if (isAdmin()) renderUsersTable();
            break;

        case 'audit-log':
            if (isAdmin()) renderAuditTable();
            break;

        case 'settings':
            if (typeof window.renderSettings === 'function') {
                window.renderSettings();
            }
            break;

        default:
            updateDynamicBankFilter();
            renderDebtorOptions();
            populateDebtorRegionsDropdown();
            renderDebtorSearchResults();
            break;
    }
}

export async function switchTab(tabId) {
    setVisibleTab(tabId);
    setActiveTabButtons(tabId);
    await renderViewForTab(tabId);
}

function bindTabNavigationOnce() {
    const topNav = document.getElementById('main-nav-tabs');
    const bottomNav = document.getElementById('bottom-nav');

    if (topNav && !topNav.dataset.bound) {
        topNav.dataset.bound = '1';
        topNav.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-tab]');
            if (!btn) return;
            e.preventDefault();
            await switchTab(btn.dataset.tab);
        });
    }

    if (bottomNav && !bottomNav.dataset.bound) {
        bottomNav.dataset.bound = '1';
        bottomNav.addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-tab]');
            if (!btn) return;
            e.preventDefault();
            await switchTab(btn.dataset.tab);
        });
    }
}

function bindFilterAndSearchEventsOnce() {
    const bindings = [
        ['daily-summary-date', 'change', () => queueRefreshUI({ tabId: 'daily-summary' })],
        ['bank-accounts-date', 'change', () => queueRefreshUI({ tabId: 'bank-accounts' })],
        ['bank-company-filter', 'change', () => queueRefreshUI({ tabId: 'bank-accounts' })],
        ['failed-date', 'change', () => queueRefreshUI({ tabId: 'failed-deposits' })],
        ['filter-agent', 'change', () => queueRefreshUI({ tabId: 'all-operations' })],
        ['filter-type', 'change', () => queueRefreshUI({ tabId: 'all-operations' })],
        ['operations-date-type', 'change', () => queueRefreshUI({ tabId: 'all-operations' })],
        ['operations-filter-day', 'change', () => queueRefreshUI({ tabId: 'all-operations' })],
        ['operations-filter-month', 'change', () => queueRefreshUI({ tabId: 'all-operations' })],
        ['operations-filter-start', 'change', () => queueRefreshUI({ tabId: 'all-operations' })],
        ['operations-filter-end', 'change', () => queueRefreshUI({ tabId: 'all-operations' })],
        ['debtor-search-input', 'input', () => renderDebtorSearchResults()],
        ['debtor-search-results', 'click', (e) => {
            const btn = e.target.closest('[data-debtor-id]');
            if (!btn) return;
            e.preventDefault();
            applyDebtorSelection(btn.dataset.debtorId);
        }]
    ];

    bindings.forEach(([id, eventName, handler]) => {
        const el = document.getElementById(id);
        if (!el) return;

        const key = `bound-${eventName}`;
        if (el.dataset[key]) return;
        el.dataset[key] = '1';

        el.addEventListener(eventName, handler);
    });

    const manualSyncBtn = document.getElementById('manual-sync-btn');
    if (manualSyncBtn && !manualSyncBtn.dataset.bound) {
        manualSyncBtn.dataset.bound = '1';
        manualSyncBtn.addEventListener('click', async () => {
            if (typeof window.flushOutbox === 'function') {
                try {
                    manualSyncBtn.disabled = true;
                    const originalText = manualSyncBtn.textContent;
                    manualSyncBtn.textContent = 'جاري المزامنة... ⏳';

                    await window.flushOutbox();
                    refreshNotificationIndicators();
                    await refreshUI({ reason: 'manual-sync' });

                    manualSyncBtn.textContent = originalText;
                } catch (error) {
                    console.error('حدث خطأ أثناء المزامنة:', error);
                    showToast('فشلت المزامنة ❌ يرجى التحقق من اتصال الشبكة', 'error');
                } finally {
                    manualSyncBtn.disabled = false;
                }
            }
        });
    }
}

function bindOnlineOfflineOnce() {
    if (window.__uiOnlineOfflineBound) return;
    window.__uiOnlineOfflineBound = true;

    window.addEventListener('online', async () => {
        setOfflineBanner(false);
        if (typeof window.flushOutbox === 'function') {
            try { await window.flushOutbox(); } catch (error) {
                console.warn('فشل تفريغ outbox بعد عودة الاتصال:', error);
            }
        }
        queueRefreshUI({ reason: 'online' });
    });

    window.addEventListener('offline', () => {
        setOfflineBanner(true);
    });
}

export function initUI() {
    bindTabNavigationOnce();
    bindFilterAndSearchEventsOnce();
    bindOnlineOfflineOnce();

    const today = dateInputAden();
    ['data-entry-date', 'daily-summary-date', 'bank-accounts-date', 'filter-date', 'dashboard-date', 'failed-date', 'operations-filter-day'].forEach(id => {
        const el = document.getElementById(id);
        if (el && !el.value) el.value = today;
    });

    setOfflineBanner(!navigator.onLine);
    refreshNotificationIndicators();
    updateDynamicBankFilter();
    renderDebtorOptions();
    populateDebtorRegionsDropdown();
    renderDebtorSearchResults();

    if (typeof window.refreshUI === 'function') {
        // لا ننتظر هنا حتى لا نضاعف كلفة الإقلاع
        window.refreshUI({ reason: 'init' }).catch?.(() => {});
    }
}

export async function refreshUI(options = {}) {
    if (!window?.App) window.App = {};

    const tabId = options.tabId || getCurrentActiveTabId();

    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        dateEl.textContent = new Date().toLocaleDateString('ar-EG');
    }

    const userEl = document.getElementById('current-username');
    if (userEl) {
        userEl.textContent = window.App?.currentUser
            ? `${window.App.currentUser.role === 'admin' ? 'المدير' : 'المندوب'}: ${currentUserName()}`
            : 'المستخدم: غير مسجل';
    }

    setOfflineBanner(!navigator.onLine);
    refreshNotificationIndicators();
    updateCurrentDataSize();

    try {
        await renderViewForTab(tabId);
    } catch (error) {
        console.warn(`فشل تحديث التبويب ${tabId}:`, error);
    }
}

export function queueRefreshUI(options = {}) {
    if (refreshQueued) return;

    refreshQueued = true;
    requestAnimationFrame(async () => {
        refreshQueued = false;
        try {
            await refreshUI(options);
        } catch (error) {
            console.warn('فشل التحديث المؤجل:', error);
        }
    });
}

// ==========================================
// تصدير للنطاق العام
// ==========================================

if (typeof window !== 'undefined') {
    window.switchTab = switchTab;
    window.renderDailySummary = renderDailySummary;
    window.renderDashboard = renderDashboard;
    window.renderAllOperations = renderAllOperations;
    window.refreshUI = refreshUI;
    window.queueRefreshUI = queueRefreshUI;
    window.runMasterUpdate = queueRefreshUI;
    window.updateUI = queueRefreshUI;
    window.initUI = initUI;
    window.renderAuditTable = renderAuditTable;
    window.updateCurrentDataSize = updateCurrentDataSize;
}

// ==========================================
// ES MODULE BRIDGE
// ==========================================

export async function initializeUI() {

    // النظام الجديد
    if (typeof window.initializeUI === 'function') {
        return await window.initializeUI();
    }

    // توافق مع النظام القديم
    if (typeof window.refreshUI === 'function') {
        await window.refreshUI();
    }

    console.warn&& ('initializeUI fallback bridge used');
                                         }
