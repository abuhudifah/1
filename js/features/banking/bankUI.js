// ==========================================
// bankUI.js - عرض الحسابات البنكية في واجهة المستخدم
// ==========================================

import { escapeHtml, money, safeNumber, dateInputAden, showToast, isAdmin } from '../../utils.js';
import { getActiveBankAccounts, getTotalDepositsForBank, getRecentDepositsForBank } from './bankService.js';

/**
 * تحديث قائمة الشركات الديناميكية في فلتر الحسابات البنكية
 */
export function updateDynamicBankFilter() {
    const filterSelect = document.getElementById('bank-company-filter');
    if (!filterSelect) return;
    
    const currentValue = filterSelect.value || 'all';
    const companies = [...new Set((window.App.records || [])
        .filter(r => r.is_bank_account && !r.deleted_at && String(r.owning_company || '').trim())
        .map(r => String(r.owning_company).trim()))].sort();
    
    filterSelect.innerHTML = '<option value="all">عرض جميع الشركات</option>' + 
        companies.map(company => {
            const selected = company === currentValue ? ' selected' : '';
            return `<option value="${escapeHtml(company)}"${selected}>${escapeHtml(company)}</option>`;
        }).join('');
}

/**
 * عرض الحسابات البنكية في الواجهة
 */
export function renderBankAccounts() {
    const target = document.getElementById('bank-accounts-list') || document.getElementById('bank-accounts-body');
    if (!target) return;
    
    const dateFilter = document.getElementById('bank-accounts-date')?.value || dateInputAden();
    const companyFilter = document.getElementById('bank-company-filter')?.value || 'all';
    let banks = getActiveBankAccounts();
    
    if (companyFilter && companyFilter !== 'all') {
        banks = banks.filter(b => String(b.owning_company || '').trim() === companyFilter);
    }
    
    if (banks.length === 0) {
        target.innerHTML = '<p class="text-center text-gray-500 py-12 col-span-full">لا توجد حسابات بنكية</p>';
        return;
    }
    
    // ترتيب الحسابات حسب آخر نشاط (أحدث إيداع أولاً)
    const banksWithActivity = banks.map(bank => {
        const recentDeposits = getRecentDepositsForBank(bank.bank_account, dateFilter, 5);
        const lastActivity = recentDeposits.length > 0 ? recentDeposits[0]?.time || '00:00' : '00:00';
        return { ...bank, lastActivity, recentDeposits };
    }).sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
    
    target.innerHTML = banksWithActivity.map(b => {
        const totalDeposits = getTotalDepositsForBank(b.bank_account, dateFilter);
        const ceiling = safeNumber(b.financial_ceiling, 0);
        const remaining = ceiling - totalDeposits;
        const percentage = ceiling > 0 ? Math.round((totalDeposits / ceiling) * 100) : 0;
        let progressColor = 'bg-blue-500';
        if (percentage < 30) progressColor = 'bg-red-500';
        else if (percentage < 75) progressColor = 'bg-yellow-500';
        
        const hasActivity = b.recentDeposits.length > 0;
        const headerColor = hasActivity ? 'bg-blue-800' : 'bg-gradient-to-r from-gray-500 via-gray-400 to-gray-500';
        
        return `
        <div class="relative rounded-2xl shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-[1.02] bg-gradient-to-br from-gray-100 to-gray-300 border border-gray-400">
            <div class="absolute top-0 left-0 right-0 h-2 ${headerColor} rounded-t-2xl"></div>
            <div class="p-5 text-gray-800">
                <div class="flex justify-between items-start mb-4">
                    <div>
                        <h3 class="text-xl font-bold tracking-wider text-gray-900">${escapeHtml(b.bank_account)}</h3>
                        <p class="text-xs text-gray-600">${isAdmin() ? `الشركة: ${escapeHtml(b.owning_company || 'غير مسجل')}` : 'حساب جاري'}</p>
                    </div>
                    <i class="fas fa-credit-card text-3xl ${hasActivity ? 'text-blue-800' : 'text-gray-600'} opacity-70"></i>
                </div>
                <div class="mb-3">
                    <p class="text-xs text-gray-600 mb-1">رقم البطاقة</p>
                    <p class="text-md font-mono tracking-wider text-gray-900">${b.card_number || '•••• •••• •••• ••••'}</p>
                </div>
                <div class="flex justify-between items-center mb-3">
                    <div>
                        <p class="text-xs text-gray-600 mb-1">رقم الحساب</p>
                        <p class="text-sm font-mono text-gray-900">${b.account_number || 'غير مسجل'}</p>
                    </div>
                    <div class="text-left">
                        <p class="text-xs text-gray-600 mb-1">صاحب البطاقة</p>
                        <p class="text-sm font-bold uppercase text-gray-900">${escapeHtml(b.card_holder || 'غير مسجل')}</p>
                    </div>
                </div>
                <div class="flex justify-between items-center mb-4 pb-3 border-b border-gray-400">
                    <div>
                        <p class="text-xs text-gray-600 mb-1">الرقم السري</p>
                        <div class="flex items-center gap-2">
                            <span id="bank-pin-${b.id}" class="text-sm font-mono text-gray-900">••••</span>
                            <button onclick="window.togglePinVisibility && window.togglePinVisibility('${b.id}', '${escapeHtml(b.card_pin || '')}')" class="text-xs bg-gray-500 hover:bg-gray-600 text-white rounded-full px-2 py-0.5 transition">
                                <i class="fas fa-eye text-xs"></i>
                            </button>
                        </div>
                    </div>
                    <div>
                        <i class="fab fa-cc-mastercard text-3xl ${hasActivity ? 'text-blue-800' : 'text-gray-500'} opacity-60"></i>
                    </div>
                </div>
                <div class="mb-4">
                    <div class="flex justify-between text-xs mb-1 text-gray-700">
                        <span>السقف المالي: ${money(ceiling)}</span>
                        <span>${isAdmin() ? 'الإيداعات اليوم (الكل)' : 'إيداعاتي اليوم'}: ${money(totalDeposits)}</span>
                    </div>
                    <div class="w-full bg-gray-400 rounded-full h-2">
                        <div class="${progressColor} h-2 rounded-full" style="width: ${Math.min(percentage, 100)}%"></div>
                    </div>
                    <p class="text-xs mt-1 text-gray-600 flex justify-between">
                        <span>${percentage}% من السقف</span>
                        ${isAdmin() ? `<span class="text-gray-500" dir="ltr">تجديد: ${b.reset_time || '00:00'}</span>` : ''}
                    </p>
                </div>
                <div class="flex justify-between items-center gap-2 mt-2">
                    <button onclick="window.printBankStatement && window.printBankStatement('${escapeHtml(b.bank_account)}')" class="flex-1 bg-gray-600 hover:bg-gray-700 text-white rounded-lg py-2 text-sm font-bold transition flex items-center justify-center gap-2">
                        <i class="fas fa-print"></i> طباعة
                    </button>
                    <button onclick="window.shareBankStatement && window.shareBankStatement('${escapeHtml(b.bank_account)}')" class="flex-1 bg-green-600 hover:bg-green-700 text-white rounded-lg py-2 text-sm font-bold transition flex items-center justify-center gap-2">
                        <i class="fab fa-whatsapp"></i> مشاركة
                    </button>
                    ${isAdmin() ? `
                    <button onclick="window.editBank && window.editBank('${b.id}')" class="bg-blue-600 hover:bg-blue-700 text-white rounded-lg py-2 px-3 text-sm transition">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button onclick="window.deleteRecord && window.deleteRecord('${b.id}')" class="bg-red-600 hover:bg-red-700 text-white rounded-lg py-2 px-3 text-sm transition">
                        <i class="fas fa-trash"></i>
                    </button>
                    ` : ''}
                </div>
            </div>
            <div class="bg-gray-200/80 backdrop-blur-sm p-3 rounded-b-2xl border-t border-gray-400">
                <p class="text-xs font-bold text-gray-800 mb-2 flex items-center gap-1">
                    <i class="fas fa-history text-xs"></i> ${isAdmin() ? 'آخر 5 إيداعات (جميع المناديب)' : 'آخر 5 إيداعات قمت بها'}
                </p>
                ${b.recentDeposits.length === 0 ? `
                    <p class="text-xs text-gray-600">لا توجد إيداعات في هذا الحساب</p>
                ` : `
                    <div class="space-y-1 max-h-32 overflow-y-auto">
                        ${b.recentDeposits.map(d => `
                            <div class="flex justify-between items-center text-xs border-b border-gray-400 pb-1">
                                <span dir="ltr" class="font-mono text-gray-700">${d.date} ${d.time}</span>
                                <span class="font-bold text-green-700">+${money(d.amount)}</span>
                                ${isAdmin() ? `<span class="text-gray-500 text-[10px]">${escapeHtml(d.agent_name || '')}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `}
            </div>
        </div>`;
    }).join('');
    
    // دالة مساعدة لإظهار/إخفاء الرقم السري
    if (typeof window.togglePinVisibility !== 'function') {
        window.togglePinVisibility = function(bankId, pinValue) {
            const pinSpan = document.getElementById(`bank-pin-${bankId}`);
            if (!pinSpan) return;
            if (pinSpan.textContent === '••••') {
                pinSpan.textContent = pinValue || 'لا يوجد';
                pinSpan.classList.add('tracking-normal');
            } else {
                pinSpan.textContent = '••••';
                pinSpan.classList.remove('tracking-normal');
            }
        };
    }
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.updateDynamicBankFilter = updateDynamicBankFilter;
    window.renderBankAccounts = renderBankAccounts;
}
