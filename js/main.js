// ==========================================
// main.js - نقطة الدخول الرئيسية للتطبيق
// يجمع كل الوحدات ويوفر واجهة موحدة للتحميل
// ==========================================

import { initUI } from './ui.js';
import { bindOperationForms, editRecordFromUI } from './forms.js';
import { bindModalButtons } from './modals.js';
import { bindUserUIEvents } from './features/users/userUI.js';
import { bindNotificationUIEvents } from './features/notifications/notificationUI.js';
import { setupSupabaseRealtime, flushOutbox, syncAllTablesFromRemote } from './core/sync.js';
import { startDailyCloseWatcher, runDailyClose, manualCloseToday, closeSpecificDay, calculatePreviousBalance } from './core/closing.js';
import { getDailyCloseSettings, saveDailyCloseSettings } from './core/settings.js';
import { appendAuditEntry, clearAuditLogs } from './core/audit.js';
import { applyReversalAndSave, isOperationEditable, createReversalRecord } from './core/reversal.js';
import { persistTable, deleteTableRow, cacheTable } from './core/repository.js';
import { showToast, setOfflineBanner, dateInputAden, timeInputAden, localTime12h, escapeHtml, safeNumber, currentUserName, defaultAgentName, isAdmin, money } from './utils.js';

import './auth.js';

// ==========================================
// دوال مساعدة للتطابق مع الكود القديم (كاحتياطي)
// ==========================================

if (typeof window !== 'undefined') {
    window.App = window.App || {};
    Object.assign(window.App, {
        records: window.App.records || [],
        users: window.App.users || [],
        notifications: window.App.notifications || [],
        auditLogs: window.App.auditLogs || [],
        settings: window.App.settings || [],
        dailyBalances: window.App.dailyBalances || [],
        backups: window.App.backups || [],
        currentUser: window.App.currentUser || null,
        online: typeof navigator !== 'undefined' ? navigator.onLine : true,
        supabaseHealthy: true,
        db: window.App.db || null,
        dailyCloseSettings: window.App.dailyCloseSettings || { enabled: true, hour: 0, minute: 0, lastClosedDate: null, lastExecution: null }
    });
    
    window.showToast = showToast;
    window.setOfflineBanner = setOfflineBanner;
    window.dateInputAden = dateInputAden;
    window.timeInputAden = timeInputAden;
    window.localTime12h = localTime12h;
    window.escapeHtml = escapeHtml;
    window.safeNumber = safeNumber;
    window.currentUserName = currentUserName;
    window.defaultAgentName = defaultAgentName;
    window.isAdmin = isAdmin;
    window.money = money;
    
    window.startDailyCloseWatcher = startDailyCloseWatcher;
    window.runDailyClose = runDailyClose;
    window.manualCloseToday = manualCloseToday;
    window.closeSpecificDay = closeSpecificDay;
    window.calculatePreviousBalance = calculatePreviousBalance;
    window.getDailyCloseSettings = getDailyCloseSettings;
    window.saveDailyCloseSettings = saveDailyCloseSettings;
    window.appendAuditEntry = appendAuditEntry;
    window.clearAuditLogs = clearAuditLogs;
    window.applyReversalAndSave = applyReversalAndSave;
    window.isOperationEditable = isOperationEditable;
    window.createReversalRecord = createReversalRecord;
    window.persistTable = persistTable;
    window.deleteTableRow = deleteTableRow;
    window.cacheTable = cacheTable;
    window.flushOutbox = flushOutbox;
    window.setupSupabaseRealtime = setupSupabaseRealtime;
    window.syncAllTablesFromRemote = syncAllTablesFromRemote;
    window.editRecord = editRecordFromUI;
}

// ==========================================
// دالة التهيئة الأساسية
// ==========================================

export async function initApp(options = {}) {
    if (window.App?._initialized) {
        console.warn('⚠️ التطبيق مهيأ مسبقاً، تخطي...');
        return;
    }
    
    console.log('🚀 بدء تهيئة النظام...');
    
    if (!window.App?.db && typeof window.initLocalDB === 'function') {
        try {
            await window.initLocalDB();
        } catch(e) {
            console.warn('⚠️ خطأ طفيف أثناء تهيئة قاعدة البيانات:', e);
        }
    } else if (!window.App?.db) {
        console.warn('⚠️ تنبيه: سيتم استخدام Dexie Database داخلياً (window.App.db غير متصل بشكل مباشر)');
    }
    
    try { initUI(); } catch(e) { console.warn("Error in initUI:", e); }
    try { bindOperationForms(); } catch(e) { console.warn("Error in bindOperationForms:", e); }
    try { bindUserUIEvents(); } catch(e) { console.warn("Error in bindUserUIEvents:", e); }
    try { bindNotificationUIEvents(); } catch(e) { console.warn("Error in bindNotificationUIEvents:", e); }
    if (typeof bindModalButtons === 'function') {
        try { bindModalButtons(); } catch(e) { console.warn("Error in bindModalButtons:", e); }
    }
    
    if (!options.skipRealtime) {
        try { await setupSupabaseRealtime(); } catch(e) { console.warn("Error in Realtime:", e); }
    }
    
    try { startDailyCloseWatcher(); } catch(e) { console.warn("Error in CloseWatcher:", e); }
    
    if (typeof window.restoreSession === 'function') {
        try { await window.restoreSession(); } catch(e) { console.warn("Error in restoreSession:", e); }
    }
    
    if (!options.skipSync && navigator.onLine) {
        try { await syncAllTablesFromRemote(); } catch(e) { console.warn("Error in sync:", e); }
    }
    
    if (typeof window.refreshUI === 'function') {
        try { await window.refreshUI(); } catch(e) { console.warn("Error in refreshUI:", e); }
    }
    
    window.App._initialized = true;
    console.log('✅ النظام جاهز للعمل بنجاح');
}

export async function reinitApp() {
    window.App._initialized = false;
    await initApp();
}

// ==========================================
// إصلاح وربط أزرار واجهة الدخول
// ==========================================

// في نهاية main.js، استبدل دالة bindAuthAndCalculatorEvents بالكامل بهذا:
function bindAuthAndCalculatorEvents() {
    // ربط الدالة بالنطاق العام (window) لتعمل مع onclick في HTML
    window.showLogin = function() {
        document.getElementById('smart-calculator')?.classList.add('hidden');
        document.getElementById('traditional-login')?.classList.remove('hidden');
    };

    window.showCalculator = function() {
        document.getElementById('smart-calculator')?.classList.remove('hidden');
        document.getElementById('traditional-login')?.classList.add('hidden');
    };

    // ربط زر القائمة (الذي يظهر القائمة المنسدلة في index.html)
    const secretBtn = document.getElementById('secret-menu-toggle');
    if (secretBtn) {
        // نترك الـ onclick الأصلية تعمل (التي تظهر القائمة)، ونضيف حدثاً للضبط فقط إذا لزم
        console.log("تم تفعيل زر القائمة بنجاح");
    }
}

// ==========================================
// التشغيل التلقائي عند تحميل الصفحة
// ==========================================

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bindAuthAndCalculatorEvents(); 
        initApp(); 
    });
} else {
    bindAuthAndCalculatorEvents();
    initApp();
}

export {
    initUI,
    bindOperationForms,
    bindUserUIEvents,
    bindNotificationUIEvents,
    setupSupabaseRealtime,
    startDailyCloseWatcher,
    runDailyClose,
    manualCloseToday,
    flushOutbox,
    syncAllTablesFromRemote,
    showToast,
    setOfflineBanner,
    escapeHtml,
    safeNumber,
    isAdmin,
    bindAuthAndCalculatorEvents
};
