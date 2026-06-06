/**
 * config.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * ثوابت النظام: مفاتيح Supabase، أسماء الجداول، الإعدادات العامة
 *
 * ⚠️  لا تشارك هذا الملف علناً — يحتوي على مفاتيح الاتصال
 */

'use strict';

// ============================================================
// إعدادات Supabase
// ============================================================

const SUPABASE_CONFIG = Object.freeze({
  URL:     'https://gffyakxcfoeehtapelgd.supabase.co',
  ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdmZnlha3hjZm9lZWh0YXBlbGdkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMzA4MTMsImV4cCI6MjA5NTkwNjgxM30.J7JkrepHTUBapF6L2_WxJuI2ZEcqie-ucNZAdeAreFM',
});

// ============================================================
// أسماء الجداول
// ============================================================

const TABLES = Object.freeze({
  USERS             : 'users',
  TRANSACTIONS      : 'transactions',
  BANK_ACCOUNTS     : 'bank_accounts',
  DEBTORS           : 'debtors',
  FAILED_DEPOSITS   : 'failed_deposits',
  NOTIFICATIONS     : 'notifications',
  AUDIT_LOGS        : 'audit_logs',
  ACCOUNT_LEDGER    : 'account_ledger',
  ACCOUNT_BALANCES  : 'account_balances',
  DAILY_CLOSINGS    : 'daily_closings',
  SYSTEM_SETTINGS   : 'system_settings',
  COMPANIES         : 'companies',
  EXPENSE_ACCOUNTS  : 'expense_accounts',
});

// ============================================================
// أسماء جداول Dexie (IndexedDB) — للعمل دون اتصال
// ============================================================

const DEXIE_TABLES = Object.freeze({
  TRANSACTIONS    : 'transactions',
  USERS           : 'users',
  BANK_ACCOUNTS   : 'bank_accounts',
  DEBTORS         : 'debtors',
  FAILED_DEPOSITS : 'failed_deposits',
  NOTIFICATIONS   : 'notifications',
  AUDIT_LOGS      : 'audit_logs',
  ACCOUNT_LEDGER  : 'account_ledger',
  ACCOUNT_BALANCES: 'account_balances',
  DAILY_CLOSINGS  : 'daily_closings',
  SYNC_QUEUE      : 'sync_queue',
  SYNC_CONFLICTS  : 'sync_conflicts',
  CACHE_META      : 'cache_meta',
});

// ============================================================
// أسماء دوال RPC
// ============================================================

const RPC = Object.freeze({
  // دوال المعاملات المالية
  CREATE_TRANSACTION_WITH_ENTRIES : 'create_transaction_with_entries', // params: {tx_data, entries_data}
  PERFORM_DAILY_CLOSE             : 'perform_daily_close',             // params: {p_date, p_user_id}
  REVERSE_TRANSACTION             : 'reverse_transaction',             // params: {p_transaction_id}
  UPDATE_DEBTOR_BALANCE           : 'update_debtor_balance',           // params: {p_debtor_id, p_amount}
  // دوال المصادقة
  VERIFY_QUICK_LOGIN              : 'verify_quick_login',              // params: {p_hash} → {user_id, valid}
  // دوال التقارير والاستعلامات
  GET_ADMIN_DASHBOARD             : 'get_admin_dashboard',             // params: {p_date} → {kpi, banks, agents}
  GET_DAILY_SUMMARY               : 'get_daily_summary',               // params: {p_date, p_agent_id?}
  GET_CHART_OF_ACCOUNTS           : 'get_chart_of_accounts',           // params: {} → [{account_id, name, balance}]
  GET_ACCOUNT_STATEMENT           : 'get_account_statement',           // params: {p_account_id, p_from, p_to}
  GET_BANK_STATEMENT              : 'get_bank_statement',              // params: {p_bank_id, p_from, p_to}
  GET_AUDIT_LOGS                  : 'get_audit_logs',                  // params: {p_from, p_to, p_user_id?}
});

// ============================================================
// أنواع العمليات المالية
// ============================================================

const TRANSACTION_TYPES = Object.freeze({
  COLLECTION        : 'collection',
  DEPOSIT           : 'deposit',
  EXPENSE           : 'expense',
  RECEIPT           : 'receipt',
  DELIVERY          : 'delivery',
  REFUND_SETTLEMENT : 'refund_settlement',
});

const TRANSACTION_TYPE_LABELS = Object.freeze({
  collection        : 'تحصيل',
  deposit           : 'إيداع',
  expense           : 'مصروف',
  receipt           : 'استلام',
  delivery          : 'تسليم',
  refund_settlement : 'تسوية استرداد',
});

// ============================================================
// أدوار المستخدمين
// ============================================================

const ROLES = Object.freeze({
  ADMIN           : 'admin',
  ADMIN_ASSISTANT : 'admin_assistant',
  AGENT           : 'agent',
});

const ROLE_LABELS = Object.freeze({
  admin           : 'مدير',
  admin_assistant : 'مساعد إداري',
  agent           : 'مندوب',
});

// ============================================================
// التبويبات المتاحة (للمدير عند تعيين صلاحيات المساعد الإداري)
// ============================================================

const TABS = Object.freeze({
  DASHBOARD          : 'dashboard',
  DATA_ENTRY         : 'data-entry',
  DAILY_SUMMARY      : 'daily-summary',
  BANK_ACCOUNTS      : 'bank-accounts',
  DEBTORS            : 'debtors',
  FAILED_DEPOSITS    : 'failed-deposits',
  NOTIFICATIONS      : 'notifications',
  ALL_OPERATIONS     : 'all-operations',
  AUDIT_LOG          : 'audit-log',
  USERS              : 'users',
  ACCOUNT_MANAGEMENT : 'account-management',
  SETTINGS           : 'settings',
});

const TAB_LABELS = Object.freeze({
  'dashboard'          : 'لوحة المعلومات',
  'data-entry'         : 'إدخال البيانات',
  'daily-summary'      : 'الملخص اليومي',
  'bank-accounts'      : 'الحسابات البنكية',
  'debtors'            : 'العملاء المديونين',
  'failed-deposits'    : 'الإيداعات الفاشلة',
  'notifications'      : 'الإشعارات',
  'all-operations'     : 'جميع العمليات',
  'audit-log'          : 'سجل التدقيق',
  'users'              : 'إدارة المستخدمين',
  'account-management' : 'إدارة الحسابات',
  'settings'           : 'الإعدادات',
});

// التبويبات التي تظهر للمندوب فقط
const AGENT_TABS = Object.freeze([
  TABS.DATA_ENTRY,
  TABS.DAILY_SUMMARY,
  TABS.BANK_ACCOUNTS,
  TABS.DEBTORS,
  TABS.NOTIFICATIONS,
  TABS.SETTINGS,        // ✅ إضافة جديدة — لظهور إعدادات الملف الشخصي
]);

// التبويبات الإدارية (للمدير والمساعد الإداري)
const ADMIN_TABS = Object.freeze([
  TABS.DASHBOARD,
  TABS.DATA_ENTRY,
  TABS.DAILY_SUMMARY,
  TABS.BANK_ACCOUNTS,
  TABS.DEBTORS,
  TABS.FAILED_DEPOSITS,
  TABS.NOTIFICATIONS,
  TABS.ALL_OPERATIONS,
  TABS.AUDIT_LOG,
  TABS.USERS,
  TABS.ACCOUNT_MANAGEMENT,
  TABS.SETTINGS,
]);

// ============================================================
// حالات المزامنة
// ============================================================

const SYNC_STATUS = Object.freeze({
  SYNCED   : 'synced',
  PENDING  : 'pending',
  CONFLICT : 'conflict',
});

// أنواع إجراءات طابور المزامنة
const SYNC_ACTIONS = Object.freeze({
  CREATE : 'create',
  UPDATE : 'update',
  DELETE : 'delete',
  BATCH  : 'batch',
});

// ============================================================
// حالات الإيداع الفاشل
// ============================================================

const FAILED_DEPOSIT_STATUS = Object.freeze({
  PENDING  : 'pending',
  CLAIMED  : 'claimed',
  REFUNDED : 'refunded',
  REJECTED : 'rejected',
});

const FAILED_DEPOSIT_STATUS_LABELS = Object.freeze({
  pending  : 'معلق',
  claimed  : 'مطالب به',
  refunded : 'مسترد',
  rejected : 'مرفوض',
});

// ============================================================
// أنواع الإشعارات
// ============================================================

const NOTIFICATION_TYPES = Object.freeze({
  INFO    : 'info',
  WARNING : 'warning',
  SUCCESS : 'success',
  ERROR   : 'error',
});

// ============================================================
// بادئات الحسابات المحاسبية
// ============================================================

const ACCOUNT_PREFIXES = Object.freeze({
  AGENT    : 'AGT_',
  COMPANY  : 'COMP_',
  BANK     : 'BNK_',
  CUSTOMER : 'CUST_',
  EXPENSE  : 'EXP_',
  SUSPENSE : 'SUSP_',
});

// ============================================================
// إعدادات الأداء والمزامنة
// ============================================================

const SYNC_CONFIG = Object.freeze({
  MAX_RETRIES       : 5,           // أقصى عدد محاولات لكل عملية
  CHUNK_SIZE        : 20,          // عدد العمليات في كل دفعة
  CHUNK_DELAY_MS    : 50,          // تأخير بين الدفعات بالمللي ثانية
  BASE_BACKOFF_MS   : 1_000,       // قاعدة التأخير التصاعدي
  MAX_BACKOFF_MS    : 60_000,      // أقصى تأخير بالمللي ثانية
  JITTER_PERCENT    : 0.2,         // نسبة العشوائية في التأخير
  MAX_QUEUE_SIZE    : 5_000,       // أقصى حجم لطابور المزامنة
  STALE_QUEUE_DAYS  : 30,          // حذف العمليات المعلقة القديمة
});

const CACHE_CONFIG = Object.freeze({
  TTL_MINUTES       : 5,           // مدة صلاحية الكاش بالدقائق
  MAX_TRANSACTIONS  : 10_000,      // أقصى عدد معاملات في Dexie
  STALE_DAYS        : 90,          // حذف المعاملات الأقدم من 90 يوم
  MAX_STORAGE_MB    : 50,          // الحد الأقصى للتخزين المحلي بالميجابايت
});

const PAGINATION_CONFIG = Object.freeze({
  DEFAULT_PAGE_SIZE : 20,
  PAGE_SIZE_OPTIONS : [20, 50, 100],
});

// ============================================================
// إعدادات الأمان
// ============================================================

const SECURITY_CONFIG = Object.freeze({
  MAX_LOGIN_ATTEMPTS : 5,          // أقصى محاولات دخول فاشلة
  LOCKOUT_MINUTES    : 15,         // مدة القفل بعد التجاوز
  SESSION_KEY        : 'abu_hudhaifa_session',
  DEVICE_TOKEN_KEY   : 'abu_hudhaifa_device_token',
});

// ============================================================
// إعدادات Dexie (IndexedDB)
// ============================================================

const DEXIE_CONFIG = Object.freeze({
  DB_NAME    : 'AbuHudhaifaDB',
  DB_VERSION : 1,
});

// ============================================================
// الإعدادات العامة للتطبيق
// ============================================================

const APP_CONFIG = Object.freeze({
  NAME             : 'نظام أبو حذيفة للصرافة والتحويلات',
  NAME_SHORT       : 'أبو حذيفة',
  VERSION          : '1.0.0',
  TIMEZONE         : 'Asia/Riyadh',
  CURRENCY         : 'SAR',
  CURRENCY_SYMBOL  : 'ر.س',
  LOCALE           : 'ar-SA',
  DEFAULT_TOAST_MS : 3_000,         // مدة ظهور التنبيهات بالمللي ثانية
  LOGO_BUCKET      : 'logos',       // اسم Bucket في Supabase Storage
});

// ============================================================
// تصدير جميع الثوابت للاستخدام في بقية الملفات
// ============================================================

window.APP_CONFIG            = APP_CONFIG;
window.SUPABASE_CONFIG       = SUPABASE_CONFIG;
window.TABLES                = TABLES;
window.DEXIE_TABLES          = DEXIE_TABLES;
window.RPC                   = RPC;
window.ROLES                 = ROLES;
window.ROLE_LABELS           = ROLE_LABELS;
window.TABS                  = TABS;
window.TAB_LABELS            = TAB_LABELS;
window.AGENT_TABS            = AGENT_TABS;
window.ADMIN_TABS            = ADMIN_TABS;
window.TRANSACTION_TYPES     = TRANSACTION_TYPES;
window.TRANSACTION_TYPE_LABELS = TRANSACTION_TYPE_LABELS;
window.SYNC_STATUS           = SYNC_STATUS;
window.SYNC_ACTIONS          = SYNC_ACTIONS;
window.SYNC_CONFIG           = SYNC_CONFIG;
window.CACHE_CONFIG          = CACHE_CONFIG;
window.PAGINATION_CONFIG     = PAGINATION_CONFIG;
window.SECURITY_CONFIG       = SECURITY_CONFIG;
window.DEXIE_CONFIG          = DEXIE_CONFIG;
window.FAILED_DEPOSIT_STATUS = FAILED_DEPOSIT_STATUS;
window.FAILED_DEPOSIT_STATUS_LABELS = FAILED_DEPOSIT_STATUS_LABELS;
window.NOTIFICATION_TYPES    = NOTIFICATION_TYPES;
window.ACCOUNT_PREFIXES      = ACCOUNT_PREFIXES;

console.log(`✅ config.js محمّل — ${APP_CONFIG.NAME} v${APP_CONFIG.VERSION}`);
