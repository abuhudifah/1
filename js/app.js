// ==========================================
// app.js - تهيئة التطبيق (متوافق مع الهيكل الجديد)
// ==========================================

import { initUI, refreshUI } from './ui.js';
import { bindOperationForms, editRecordFromUI } from './forms.js';
import { bindModalButtons } from './modals.js';  // سيتم إنشاؤه لاحقاً
import { setupSupabaseRealtime, flushOutbox } from './core/sync.js';
import { startDailyCloseWatcher, runDailyClose } from './core/closing.js';
import { getDailyCloseSettings, saveDailyCloseSettings } from './core/settings.js';
import { getCurrentUserNotifications, getUnreadNotificationCount } from './features/notifications/notificationService.js';
import { getUsers } from './features/users/userService.js';
import { getAllOperations } from './features/records/recordService.js';

// ==========================================
// متغيرات عامة للتطابق مع الكود القديم
// ==========================================

window.App = window.App || {
    records: [],
    users: [],
    notifications: [],
    auditLogs: [],
    settings: [],
    dailyBalances: [],
    backups: [],
    currentUser: null,
    online: navigator.onLine,
    supabaseHealthy: true,
    db: null,
    dailyCloseSettings: { enabled: true, hour: 0, minute: 0, lastClosedDate: null, lastExecution: null }
};

// ==========================================
// دوال مساعدة للتوافق (قديمة)
// ==========================================

window.dateInputAden = () => new Date().toISOString().slice(0, 10);
window.timeInputAden = () => new Date().toTimeString().slice(0, 5);
window.localTime12h = (timeStr) => {
    if (!timeStr) return '';
    const [hh, mm] = timeStr.split(':');
    let h = parseInt(hh, 10);
    const ampm = h >= 12 ? 'م' : 'ص';
    h = h % 12 || 12;
    return `${h}:${mm} ${ampm}`;
};
window.safeNumber = (val, def = 0) => { const n = Number(val); return isNaN(n) ? def : n; };
window.escapeHtml = (str) => String(str || '').replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));

// ==========================================
// تهيئة قاعدة البيانات المحلية (Dexie)
// ==========================================

async function initLocalDB() {
    if (!window.Dexie) {
        console.error('Dexie library not loaded');
        return;
    }
    const db = new window.Dexie('AbuHudhaifaDB_v2');
    db.version(3).stores({
        records: 'id, type, date, time, user_id, agent_name, updated_at, deleted_at, is_bank_account, is_debtor_customer, is_failed_deposit, is_reversal, is_reversed',
        users: 'id, username, role, display_name, quick_eq, updated_at, deleted_at',
        notifications: 'id, user_id, target_role, is_read, created_at, updated_at',
        audit_logs: 'id, record_type, record_id, user_id, timestamp',
        settings: 'id, scope, key, updated_at',
        daily_balances: 'id, balance_date, user_id, total_balance',
        backups: 'id, exported_at, updated_at',
        outbox: 'op_uuid, table_name, operation_type, status, created_at'
    });
    window.App.db = db;
    return db;
}

// ==========================================
// تحميل البيانات من الخادم (للتكامل مع الكود القديم)
// ==========================================

async function loadServerData() {
    if (!navigator.onLine || !window.App.supabaseHealthy) return;
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (!session) return;
        
        const tables = ['records', 'users', 'notifications', 'audit_logs', 'settings', 'daily_balances', 'backups'];
        for (const table of tables) {
            const { data, error } = await window.supabaseClient.from(table).select('*').is('deleted_at', null);
            if (!error && data) {
                window.App[table] = data;
                if (window.App.db?.[table]) await window.App.db[table].bulkPut(data);
            }
        }
        window.App.dailyCloseSettings = getDailyCloseSettings();
    } catch (e) {
        console.warn('loadServerData failed:', e);
    }
}

// ==========================================
// إدارة الجلسة (للتكامل مع auth.js القديم)
// ==========================================

async function restoreSession() {
    try {
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session?.user) {
            const { data: profile } = await window.supabaseClient.from('users').select('*').eq('auth_user_id', session.user.id).single();
            if (profile) {
                window.App.currentUser = profile;
                document.getElementById('login-section')?.classList.add('hidden');
                document.getElementById('main-content')?.classList.remove('hidden');
                await loadServerData();
                await refreshUI();
                return true;
            }
        }
    } catch (e) {
        console.warn('restoreSession failed:', e);
    }
    document.getElementById('login-section')?.classList.remove('hidden');
    document.getElementById('main-content')?.classList.add('hidden');
    return false;
}

// ==========================================
// boot - نقطة الانطلاق الرئيسية
// ==========================================

async function boot() {
    if (window.App._booted) return;
    window.App._booted = true;
    
    await initLocalDB();
    
    // تهيئة الواجهات
    initUI();
    bindOperationForms();
    if (typeof bindModalButtons === 'function') bindModalButtons();
    
    // إعداد Supabase Realtime والمزامنة
    await setupSupabaseRealtime();
    startDailyCloseWatcher();
    
    // استعادة الجلسة
    await restoreSession();
    
    // ربط أزرار المزامنة اليدوية والإقفال
    const manualSyncBtn = document.getElementById('manual-sync-btn');
    if (manualSyncBtn) {
        manualSyncBtn.addEventListener('click', async () => {
            await flushOutbox();
            await loadServerData();
            await refreshUI();
        });
    }
    
    const manualCloseBtn = document.getElementById('manual-close-settings-btn');
    if (manualCloseBtn) {
        manualCloseBtn.addEventListener('click', async () => {
            await runDailyClose(true);
        });
    }
    
    console.log('✅ Application booted successfully');
}

// ==========================================
// تصدير للاستخدام العالمي (التوافق)
// ==========================================

window.boot = boot;
window.loadServerData = loadServerData;
window.restoreSession = restoreSession;
window.initLocalDB = initLocalDB;
window.refreshUI = refreshUI;
window.editRecord = editRecordFromUI;

// التشغيل التلقائي عند تحميل DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
} else {
    boot();
}
