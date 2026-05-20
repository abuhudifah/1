// ==========================================
// failedUI.js - عرض الإيداعات الفاشلة في واجهة المستخدم
// ==========================================

import { escapeHtml, money, showToast, isAdmin, dateInputAden } from '../../utils.js';
import { getFailedDeposits, copyFailedDetails } from './failedService.js';

/**
 * عرض الإيداعات الفاشلة في الواجهة
 * مع تصفية حسب التاريخ وصلاحيات المستخدم
 */
export function renderFailedDeposits() {
    const list = document.getElementById('failed-deposits-list');
    if (!list) return;
    
    const dateFilter = document.getElementById('failed-date')?.value || dateInputAden();
    let failed = getFailedDeposits(dateFilter);
    
    // إذا كان المستخدم مندوباً، نعرض فقط إيداعاته
    if (!isAdmin()) {
        const currentUserId = window.App?.currentUser?.id;
        const currentAgentName = window.App?.currentUser?.display_name || window.App?.currentUser?.username;
        failed = failed.filter(f => 
            (currentUserId && f.user_id === currentUserId) || 
            f.agent_name === currentAgentName
        );
    }
    
    if (failed.length === 0) {
        list.innerHTML = '<p class="text-center text-gray-500 py-12 text-lg">لا توجد إيداعات فاشلة مسجلة</p>';
        return;
    }
    
    list.innerHTML = failed.map(f => `
        <div class="bg-red-50 border border-red-200 rounded-xl p-4 flex flex-col md:flex-row justify-between md:items-center gap-4 hover:shadow-md transition">
            <div class="flex-1">
                <div class="flex items-center gap-2 mb-2 flex-wrap">
                    <span class="bg-red-600 text-white text-xs px-2 py-1 rounded font-bold">${getStatusBadge(f.status)}</span>
                    <span class="text-gray-500 text-sm" dir="ltr">${escapeHtml(f.date)} ${escapeHtml(f.time || '')}</span>
                    <span class="text-gray-500 text-sm">| المندوب: ${escapeHtml(f.agent_name || '')}</span>
                </div>
                <h4 class="font-bold text-gray-800 text-lg">حساب: ${escapeHtml(f.bank_account || '')} 
                    <span class="text-sm font-normal text-gray-500">(${escapeHtml(f.account_number || '')})</span>
                </h4>
                <div class="grid grid-cols-2 md:grid-cols-4 text-sm text-gray-600 mt-2 gap-2">
                    <p>المبلغ: <span class="font-bold text-red-600">${money(f.amount)}</span></p>
                    <p>جهاز رقم: ${escapeHtml(f.device_number || '-')}</p>
                    <p>فرع: ${escapeHtml(f.branch_address || '-')} (${escapeHtml(f.branch_number || '-')})</p>
                    <p>صاحب البطاقة: ${escapeHtml(f.card_holder || '-')}</p>
                </div>
                ${f.bank_response_text ? `
                <div class="mt-2 text-xs text-gray-500 bg-white p-2 rounded border border-gray-200">
                    <span class="font-bold">رد البنك:</span> ${escapeHtml(f.bank_response_text)}
                </div>` : ''}
                ${f.status === 'refunded' && f.refund_amount ? `
                <div class="mt-1 text-xs text-green-600">
                    <i class="fas fa-check-circle"></i> تم استرداد: ${money(f.refund_amount)}
                </div>` : ''}
                ${f.status === 'rejected' && f.rejection_reason ? `
                <div class="mt-1 text-xs text-red-600">
                    <i class="fas fa-times-circle"></i> سبب الرفض: ${escapeHtml(f.rejection_reason)}
                </div>` : ''}
            </div>
            <div class="flex md:flex-col gap-2 items-end justify-between">
                <button type="button" data-copy-failed="${escapeHtml(f.id)}" class="bg-white text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded-lg text-sm font-bold border border-blue-200 shadow-sm transition flex items-center">
                    <i class="fas fa-copy ml-1"></i> نسخ
                </button>
                ${isAdmin() ? `
                <button type="button" data-edit-record="${escapeHtml(f.id)}" class="bg-amber-500 hover:bg-amber-600 text-white px-3 py-1.5 rounded-lg text-sm font-bold transition flex items-center">
                    <i class="fas fa-edit ml-1"></i> تعديل الحالة
                </button>
                <button type="button" data-delete-record="${escapeHtml(f.id)}" class="text-red-500 hover:text-red-700 text-sm font-bold bg-white px-3 py-1.5 rounded-lg border border-red-200 shadow-sm transition">
                    <i class="fas fa-trash ml-1"></i> حذف
                </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

/**
 * الحصول على نص الشارة (badge) حسب حالة الإيداع الفاشل
 * @param {string} status
 * @returns {string}
 */
function getStatusBadge(status) {
    const statusMap = {
        pending: '⏳ قيد المطالبة',
        claimed: '📤 تم رفع المطالبة',
        refunded: '✅ تم الاسترداد',
        rejected: '❌ تم الرد باعتذار'
    };
    return statusMap[status] || 'قيد المعالجة';
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.renderFailedDeposits = renderFailedDeposits;
}
