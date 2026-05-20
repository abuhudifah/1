// ==========================================
// debtorUI.js - عرض العملاء المديونين في واجهة المستخدم
// ==========================================

import { escapeHtml, money, showToast, isAdmin } from '../../utils.js';
import { getDebtorRecords, calculateDebtorRemaining, getUniqueDebtorRegions, searchDebtors } from '/js/features/debtors/debtorService.js';

/**
 * عرض العملاء المديونين في الواجهة مع تبويبات المناطق الديناميكية
 */
export function renderDebtors() {
    const tabsContainer = document.getElementById('dynamic-region-tabs');
    const contentContainer = document.getElementById('dynamic-region-content');
    if (!tabsContainer || !contentContainer) return;

    const searchTerm = (document.getElementById('debtor-search')?.value || '').toLowerCase().trim();
    const debtors = searchDebtors(searchTerm);
    const uniqueRegions = getUniqueDebtorRegions();

    const activeTab = tabsContainer.querySelector('.region-tab.active')?.dataset.region || 'all';
    const safeActive = activeTab !== 'all' && !uniqueRegions.includes(activeTab) ? 'all' : activeTab;

    // بناء أزرار التبويبات
    tabsContainer.innerHTML = [
        `<div class="region-tab ${safeActive === 'all' ? 'active' : ''}" data-region="all">الكل</div>`,
        ...uniqueRegions.map(reg => `<div class="region-tab ${safeActive === reg ? 'active' : ''}" data-region="${escapeHtml(reg)}">${escapeHtml(reg)}</div>`)
    ].join('');

    // دالة مساعدة لعرض بطاقات العملاء
    function renderCards(list) {
        if (list.length === 0) return '<p class="text-center text-gray-500 py-6">لا يوجد عملاء مديونين</p>';
        return list.map(d => {
            const remaining = calculateDebtorRemaining(d);
            return `
                <div class="bg-white border border-gray-200 rounded-xl p-4 flex justify-between items-center hover:shadow-md transition mb-4">
                    <div>
                        <h4 class="font-bold text-gray-800 text-lg">${escapeHtml(d.customer_name || '')}</h4>
                        <p class="text-sm text-gray-500"><i class="fas fa-map-marker-alt ml-1 text-red-500"></i> ${escapeHtml(d.region || '')}</p>
                    </div>
                    <div class="flex items-center gap-4">
                        <div class="text-left">
                            <p class="text-xs text-gray-500">المبلغ المستحق</p>
                            <p class="font-bold text-red-600 text-lg" dir="ltr">${money(d.debt_amount)}</p>
                            <p class="text-xs text-green-600">المتبقي: ${money(remaining)}</p>
                        </div>
                        ${isAdmin() ? `
                        <div class="flex flex-col gap-2 border-r pr-4 border-gray-200">
                            <button type="button" data-edit-record="${escapeHtml(d.id)}" class="text-blue-500 hover:text-blue-700 bg-blue-50 p-1.5 rounded"><i class="fas fa-edit"></i></button>
                            <button type="button" data-delete-record="${escapeHtml(d.id)}" class="text-red-500 hover:text-red-700 bg-red-50 p-1.5 rounded"><i class="fas fa-trash"></i></button>
                        </div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // بناء المحتوى لكل تبويب
    let contentHtml = `<div id="debtors-all" class="region-section ${safeActive === 'all' ? 'active' : ''}"><div class="space-y-2">${renderCards(debtors)}</div></div>`;
    uniqueRegions.forEach(reg => {
        const regionDebtors = debtors.filter(d => String(d.region || '').trim() === reg);
        const safeId = 'reg_' + btoa(unescape(encodeURIComponent(reg))).replace(/[^a-zA-Z0-9]/g, '');
        contentHtml += `<div id="${safeId}" class="region-section ${safeActive === reg ? 'active' : ''}"><div class="space-y-2">${renderCards(regionDebtors)}</div></div>`;
    });
    contentContainer.innerHTML = contentHtml;

    // إعادة ربط أحداث النقر على التبويبات
    document.querySelectorAll('#dynamic-region-tabs .region-tab').forEach(tab => {
        tab.removeEventListener('click', handleRegionTabClick);
        tab.addEventListener('click', handleRegionTabClick);
    });
}

function handleRegionTabClick(e) {
    const tab = e.currentTarget;
    const region = tab.dataset.region;
    const tabsContainer = document.getElementById('dynamic-region-tabs');
    const contentContainer = document.getElementById('dynamic-region-content');
    if (!tabsContainer || !contentContainer) return;

    // إزالة التنشيط من جميع التبويبات والمحتويات
    tabsContainer.querySelectorAll('.region-tab').forEach(t => t.classList.remove('active'));
    contentContainer.querySelectorAll('.region-section').forEach(s => s.classList.remove('active'));
    
    // تنشيط التبويب الحالي
    tab.classList.add('active');
    
    // تنشيط المحتوى المطابق
    if (region === 'all') {
        const allSection = document.getElementById('debtors-all');
        if (allSection) allSection.classList.add('active');
    } else {
        const safeId = 'reg_' + btoa(unescape(encodeURIComponent(region))).replace(/[^a-zA-Z0-9]/g, '');
        const section = document.getElementById(safeId);
        if (section) section.classList.add('active');
    }
}

/**
 * تعبئة قائمة العملاء المديونين في عنصر select (للاستخدام في نموذج التحصيل)
 */
export function renderDebtorOptions() {
    const select = document.getElementById('debtor-select');
    if (!select) return;

    const current = select.value;
    const debtors = getDebtorRecords().sort((a, b) => String(a.customer_name || '').localeCompare(String(b.customer_name || ''), 'ar'));
    select.innerHTML = '<option value="">اختر العميل</option>' + debtors.map(d => {
        const remaining = calculateDebtorRemaining(d);
        return `<option value="${escapeHtml(d.id)}">${escapeHtml(d.customer_name || '')} - ${escapeHtml(d.region || '')} (المتبقي ${money(remaining)})</option>`;
    }).join('');
    if (current) select.value = current;
}

/**
 * تعبئة قائمة المناطق في select الخاص بنافذة إضافة/تعديل عميل مديون
 */
export function populateDebtorRegionsDropdown() {
    const select = document.getElementById('debtor-region');
    if (!select) return;
    
    const currentVal = select.value;
    const uniqueRegions = getUniqueDebtorRegions();
    
    let html = '<option value="">اختر المنطقة</option>';
    uniqueRegions.forEach(reg => {
        html += `<option value="${escapeHtml(reg)}">${escapeHtml(reg)}</option>`;
    });
    html += '<option value="new_manual_region" class="font-bold text-blue-600">➕ إضافة منطقة جديدة يدوياً...</option>';
    
    select.innerHTML = html;
    if (currentVal && uniqueRegions.includes(currentVal)) {
        select.value = currentVal;
    }
}

/**
 * عرض نتائج البحث المباشر في حقل البحث بالتحصيل
 */
export function renderDebtorSearchResults() {
    const input = document.getElementById('debtor-search-input');
    const results = document.getElementById('debtor-search-results');
    if (!input || !results) return;
    const query = String(input.value || '').trim().toLowerCase();
    if (!query) {
        results.innerHTML = '';
        results.classList.add('hidden');
        return;
    }

    const matched = getDebtorRecords().filter(d => {
        const name = String(d.customer_name || '').toLowerCase();
        const region = String(d.region || '').toLowerCase();
        return name.includes(query) || region.includes(query);
    }).slice(0, 8);

    if (matched.length === 0) {
        results.innerHTML = '<div class="option text-gray-500">لا توجد نتائج</div>';
        results.classList.remove('hidden');
        return;
    }

    results.innerHTML = matched.map(d => {
        const remaining = calculateDebtorRemaining(d);
        return `
            <button type="button" class="option w-full text-right" data-debtor-id="${escapeHtml(d.id)}">
                <div class="font-bold">${escapeHtml(d.customer_name || '')}</div>
                <div class="text-xs text-gray-500">${escapeHtml(d.region || 'بدون منطقة')} • المتبقي ${money(remaining)}</div>
            </button>
        `;
    }).join('');
    results.classList.remove('hidden');
}

/**
 * تطبيق اختيار عميل مديون على النموذج (عند النقر على نتيجة البحث)
 * @param {string} debtorId
 */
export function applyDebtorSelection(debtorId) {
    const debtor = getDebtorRecords().find(d => String(d.id) === String(debtorId)) || null;
    const select = document.getElementById('debtor-select');
    const input = document.getElementById('debtor-search-input');
    const results = document.getElementById('debtor-search-results');
    const nameField = document.getElementById('customer-name');
    const remainingWrap = document.getElementById('remaining-debt-div');
    const remainingAmount = document.getElementById('remaining-debt-amount');

    if (select) select.value = debtor?.id || '';
    if (input && debtor) input.value = debtor.customer_name || '';
    if (nameField && debtor) nameField.value = debtor.customer_name || '';
    if (remainingWrap && remainingAmount) {
        if (debtor) {
            const remaining = calculateDebtorRemaining(debtor);
            remainingAmount.textContent = money(remaining);
            remainingAmount.dataset.originalDebt = debtor.debt_amount;
            remainingWrap.classList.remove('hidden');
        } else {
            remainingWrap.classList.add('hidden');
            remainingAmount.textContent = '0';
            delete remainingAmount.dataset.originalDebt;
        }
    }
    if (results) results.classList.add('hidden');
}

// إعادة تصدير getDebtorRecords من debtorService.js لاستخدامها من debtorUI.js (لحل مشكلة الاستيراد الخاطئ)
export { getDebtorRecords } from './debtorService.js';

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.renderDebtors = renderDebtors;
    window.renderDebtorOptions = renderDebtorOptions;
    window.populateDebtorRegionsDropdown = populateDebtorRegionsDropdown;
    window.renderDebtorSearchResults = renderDebtorSearchResults;
    window.applyDebtorSelection = applyDebtorSelection;
}
