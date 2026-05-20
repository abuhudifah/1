// ==========================================
// utils.js - دوال مساعدة عامة
// ==========================================

/**
 * تحويل القيمة إلى رقم مع قيمة افتراضية
 * @param {any} value - القيمة المدخلة
 * @param {number} fallback - القيمة الافتراضية (0)
 * @returns {number}
 */
export function safeNumber(value, fallback = 0) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

/**
 * تنسيق التاريخ إلى YYYY-MM-DD (التاريخ المحلي للجهاز)
 * @returns {string}
 */
export function dateInputAden() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * تنسيق الوقت إلى HH:MM (التوقيت المحلي للجهاز)
 * @returns {string}
 */
export function timeInputAden() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * تحويل الوقت من صيغة 24 ساعة إلى 12 ساعة مع ص/م
 * @param {string} timeStr - الوقت بصيغة HH:MM
 * @returns {string}
 */
export function localTime12h(timeStr) {
    if (!timeStr || !timeStr.includes(':')) return timeStr || '';
    let [hours, minutes] = timeStr.split(':');
    let period = 'ص';
    let h12 = parseInt(hours, 10);
    if (h12 >= 12) {
        period = 'م';
        if (h12 > 12) h12 -= 12;
    }
    if (h12 === 0) h12 = 12;
    return `${h12}:${minutes} ${period}`;
}

/**
 * تنقية النص من رموز HTML الضارة
 * @param {string} str - النص المدخل
 * @returns {string}
 */
export function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

/**
 * عرض رسالة منبثقة (Toast)
 * @param {string} message - نص الرسالة
 * @param {string} type - نوع الرسالة (success, error, warning, info)
 * @param {number} timeout - مدة الظهور بالمللي ثانية
 */
export function showToast(message, type = 'info', timeout = 2800) {
    let root = document.getElementById('toast-root');
    if (!root) {
        root = document.createElement('div');
        root.id = 'toast-root';
        document.body.appendChild(root);
    }

    const toast = document.createElement('div');
    const colors = {
        info: 'bg-blue-600',
        success: 'bg-emerald-600',
        warning: 'bg-amber-600',
        error: 'bg-red-600'
    };

    toast.className = `${colors[type] || colors.info} text-white px-4 py-3 rounded-xl shadow-lg mb-2 text-sm font-bold transition-all duration-300`;
    toast.style.transform = 'translateY(12px)';
    toast.style.opacity = '0';
    toast.innerHTML = escapeHtml(message);
    root.appendChild(toast);

    requestAnimationFrame(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    });

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(12px)';
        setTimeout(() => toast.remove(), 220);
    }, timeout);
}

/**
 * تنسيق الأرقام إلى صيغة money (مع فواصل الآلاف)
 * @param {number} value
 * @returns {string}
 */
export function money(value) {
    return Math.round(value || 0).toLocaleString('en-US');
}

/**
 * إظهار أو إخفاء لافتة عدم الاتصال
 * @param {boolean} visible
 */
export function setOfflineBanner(visible) {
    const banner = document.getElementById('offline-status-banner');
    if (banner) banner.style.display = visible ? 'block' : 'none';
}

/**
 * الحصول على اسم المستخدم الحالي (للشاشة)
 * @returns {string}
 */
export function currentUserName() {
    return window.App?.currentUser?.display_name || window.App?.currentUser?.username || 'غير محدد';
}

/**
 * الحصول على اسم المندوب الافتراضي (للتخزين)
 * @returns {string}
 */
export function defaultAgentName() {
    return window.App?.currentUser?.display_name || window.App?.currentUser?.username || '';
}

/**
 * التحقق مما إذا كان المستخدم الحالي مديراً
 * @returns {boolean}
 */
export function isAdmin() {
    return window.App?.currentUser?.role === 'admin';
}


function normalizeTableRow(row = {}) {

    if (!row || typeof row !== 'object') {
        return {};
    }

    const normalized = {};

    Object.keys(row).forEach((key) => {

        const value = row[key];

        if (value === undefined || value === null) {
            normalized[key] = '';
            return;
        }

        if (typeof value === 'string') {
            normalized[key] = value.trim();
            return;
        }

        normalized[key] = value;
    });

    return normalized;
}

if (typeof window !== 'undefined') {
    window.safeNumber = safeNumber;
    window.dateInputAden = dateInputAden;
    window.timeInputAden = timeInputAden;
    window.localTime12h = localTime12h;
    window.escapeHtml = escapeHtml;
    window.showToast = showToast;
    window.setOfflineBanner = setOfflineBanner;
    window.currentUserName = currentUserName;
    window.defaultAgentName = defaultAgentName;
    window.isAdmin = isAdmin;
    window.money = money;
window.normalizeTableRow = normalizeTableRow;
}
