/**
 * tests/setup.js
 * إعداد بيئة الاختبار — يُشغَّل قبل كل ملفات الاختبار
 *
 * يضع جميع الـ globals التي تحتاجها ملفات المصدر، ثم يحمّل helpers.js
 * حتى تكون دوال ok/err/isOk/formatErrorMessage/... متاحةً كـ globals.
 */

import { vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const ROOT = process.cwd(); // /home/user/1

// ── أداة تحميل ملف مصدر في السياق العالمي (jsdom window) ──────────
export function loadScript(relPath) {
  const code = readFileSync(resolve(ROOT, relPath), 'utf8');
  // نمرر globalThis كـ window صراحةً — يضمن أن window.X = X يُعيَّن على globalThis
  new Function('window', code)(globalThis);
}

// ============================================================
// 1. ثوابت الإعدادات (مكررة يدوياً من config.js لتجنب مفاتيح Supabase الحقيقية)
// ============================================================
Object.assign(globalThis, {
  APP_CONFIG: Object.freeze({
    NAME: 'Test System', VERSION: '1.0.0',
    TIMEZONE: 'Asia/Riyadh', CURRENCY: 'SAR',
    CURRENCY_SYMBOL: 'ر.س', LOCALE: 'ar-SA',
    DEFAULT_TOAST_MS: 3000, LOGO_BUCKET: 'logos',
  }),
  SUPABASE_CONFIG: Object.freeze({ URL: 'https://test.supabase.co', ANON_KEY: 'test-key' }),
  TABLES: Object.freeze({
    USERS: 'users', TRANSACTIONS: 'transactions', BANK_ACCOUNTS: 'bank_accounts',
    DEBTORS: 'debtors', FAILED_DEPOSITS: 'failed_deposits', NOTIFICATIONS: 'notifications',
    AUDIT_LOGS: 'audit_logs', ACCOUNT_LEDGER: 'account_ledger',
    ACCOUNT_BALANCES: 'account_balances', DAILY_CLOSINGS: 'daily_closings',
    SYSTEM_SETTINGS: 'system_settings', COMPANIES: 'companies',
    EXPENSE_ACCOUNTS: 'expense_accounts', SYSTEM_COMMANDS: 'system_commands',
    TRANSFER_REQUESTS: 'transfer_requests',
  }),
  DEXIE_TABLES: Object.freeze({
    TRANSACTIONS: 'transactions', USERS: 'users', SYNC_QUEUE: 'sync_queue',
  }),
  ROLES: Object.freeze({ ADMIN: 'admin', ADMIN_ASSISTANT: 'admin_assistant', AGENT: 'agent' }),
  ROLE_LABELS: Object.freeze({ admin: 'مدير', admin_assistant: 'مساعد إداري', agent: 'مندوب' }),
  TABS: Object.freeze({
    DASHBOARD: 'dashboard', DATA_ENTRY: 'data-entry', DAILY_SUMMARY: 'daily-summary',
    BANK_ACCOUNTS: 'bank-accounts', DEBTORS: 'debtors', FAILED_DEPOSITS: 'failed-deposits',
    NOTIFICATIONS: 'notifications', ALL_OPERATIONS: 'all-operations', AUDIT_LOG: 'audit-log',
    USERS: 'users', ACCOUNT_MANAGEMENT: 'account-management', SETTINGS: 'settings',
  }),
  TAB_LABELS: Object.freeze({}),
  AGENT_TABS: Object.freeze([
    'data-entry', 'daily-summary', 'bank-accounts', 'debtors',
    'failed-deposits', 'notifications', 'settings',
  ]),
  ADMIN_TABS: Object.freeze([
    'dashboard', 'data-entry', 'daily-summary', 'bank-accounts', 'debtors',
    'failed-deposits', 'notifications', 'all-operations', 'audit-log',
    'users', 'account-management', 'settings',
  ]),
  TRANSACTION_TYPES: Object.freeze({
    COLLECTION: 'collection', DEPOSIT: 'deposit', BANK_WITHDRAWAL: 'bank_withdrawal',
    EXPENSE: 'expense', RECEIPT: 'receipt', DELIVERY: 'delivery',
    REFUND_SETTLEMENT: 'refund_settlement',
  }),
  TRANSACTION_TYPE_LABELS: Object.freeze({}),
  SYNC_STATUS: Object.freeze({ SYNCED: 'synced', PENDING: 'pending', CONFLICT: 'conflict' }),
  SYNC_ACTIONS: Object.freeze({ CREATE: 'create', UPDATE: 'update', DELETE: 'delete', BATCH: 'batch' }),
  SYNC_CONFIG: Object.freeze({
    MAX_RETRIES: 5, CHUNK_SIZE: 20, CHUNK_DELAY_MS: 50,
    BASE_BACKOFF_MS: 1000, MAX_BACKOFF_MS: 60000,
    JITTER_PERCENT: 0.2, MAX_QUEUE_SIZE: 5000, STALE_QUEUE_DAYS: 30,
  }),
  CACHE_CONFIG: Object.freeze({ TTL_MINUTES: 5, MAX_TRANSACTIONS: 10000, STALE_DAYS: 90, MAX_STORAGE_MB: 50 }),
  PAGINATION_CONFIG: Object.freeze({ DEFAULT_PAGE_SIZE: 20, PAGE_SIZE_OPTIONS: [20, 50, 100] }),
  AMOUNT_CONFIG: Object.freeze({ MIN: 0.01, MAX: 10_000_000 }),
  SECURITY_CONFIG: Object.freeze({
    MAX_LOGIN_ATTEMPTS: 5,
    LOCKOUT_MINUTES: 15,
    SESSION_KEY: 'abu_hudhaifa_session',
    DEVICE_TOKEN_KEY: 'abu_hudhaifa_device_token',
  }),
  DEXIE_CONFIG: Object.freeze({ DB_NAME: 'AbuHudhaifaDB', DB_VERSION: 1 }),
  FAILED_DEPOSIT_STATUS: Object.freeze({ PENDING: 'pending', CLAIMED: 'claimed', REFUNDED: 'refunded', REJECTED: 'rejected' }),
  FAILED_DEPOSIT_STATUS_LABELS: Object.freeze({}),
  NOTIFICATION_TYPES: Object.freeze({ INFO: 'info', WARNING: 'warning', SUCCESS: 'success', ERROR: 'error' }),
  ACCOUNT_PREFIXES: Object.freeze({ AGENT: 'AGT_', COMPANY: 'COMP_', BANK: 'BNK_', CUSTOMER: 'CUST_', EXPENSE: 'EXP_', REVENUE: 'REV_', SUSPENSE: 'SUSP_' }),
  APPROVAL_STATUS: Object.freeze({ APPROVED: 'approved', PENDING: 'pending', REJECTED: 'rejected' }),
  APPROVAL_STATUS_LABELS: Object.freeze({}),
  RPC: Object.freeze({ VERIFY_QUICK_LOGIN: 'verify_quick_login', CREATE_TRANSACTION_WITH_ENTRIES: 'create_transaction_with_entries' }),
});

// ============================================================
// 2. Supabase Mock
// ============================================================
const _makeChain = () => {
  const chain = {
    select: vi.fn(() => chain),
    insert: vi.fn(() => chain),
    update: vi.fn(() => chain),
    delete: vi.fn(() => chain),
    upsert: vi.fn(() => chain),
    eq:     vi.fn(() => chain),
    neq:    vi.fn(() => chain),
    is:     vi.fn(() => chain),
    in:     vi.fn(() => chain),
    gte:    vi.fn(() => chain),
    lte:    vi.fn(() => chain),
    lt:     vi.fn(() => chain),
    gt:     vi.fn(() => chain),
    order:  vi.fn(() => chain),
    limit:  vi.fn(() => chain),
    range:  vi.fn(() => chain),
    single: vi.fn(() => Promise.resolve({ data: null, error: null })),
    then:   (fn) => Promise.resolve({ data: [], error: null }).then(fn),
  };
  return chain;
};

globalThis.supabaseClient = {
  auth: {
    signInWithPassword: vi.fn(() => Promise.resolve({ data: { user: null, session: null }, error: null })),
    signOut:            vi.fn(() => Promise.resolve({ error: null })),
    getSession:         vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    refreshSession:     vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
    updateUser:         vi.fn(() => Promise.resolve({ data: { user: null }, error: null })),
  },
  from:    vi.fn(() => _makeChain()),
  rpc:     vi.fn(() => Promise.resolve({ data: null, error: null })),
  storage: { from: vi.fn(() => ({ upload: vi.fn(), getPublicUrl: vi.fn(() => ({ data: { publicUrl: '' } })) })) },
  channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn() })),
  removeAllChannels: vi.fn(() => Promise.resolve()),
};

// ============================================================
// 3. isOnline mock (متاح كـ global)
// ============================================================
globalThis.isOnline = vi.fn(() => true);

// ============================================================
// 4. Dexie db mock (كائن db الكامل المطلوب من الخدمات)
// ============================================================
const _makeDexieTable = (rows = []) => ({
  toArray:      vi.fn(() => Promise.resolve(rows)),
  get:          vi.fn(() => Promise.resolve(null)),
  put:          vi.fn(() => Promise.resolve()),
  add:          vi.fn(() => Promise.resolve(1)),
  update:       vi.fn(() => Promise.resolve(1)),
  delete:       vi.fn(() => Promise.resolve()),
  where:        vi.fn().mockReturnThis(),
  equals:       vi.fn().mockReturnThis(),
  above:        vi.fn().mockReturnThis(),
  below:        vi.fn().mockReturnThis(),
  anyOf:        vi.fn().mockReturnThis(),
  count:        vi.fn(() => Promise.resolve(0)),
  first:        vi.fn(() => Promise.resolve(null)),
  sortBy:       vi.fn(() => Promise.resolve(rows)),
  filter:       vi.fn().mockReturnThis(),
  limit:        vi.fn().mockReturnThis(),
  reverse:      vi.fn().mockReturnThis(),
  primaryKeys:  vi.fn(() => Promise.resolve([])),
  bulkPut:      vi.fn(() => Promise.resolve()),
  bulkDelete:   vi.fn(() => Promise.resolve()),
});

globalThis.db = {
  isOpen:          vi.fn(() => true),
  open:            vi.fn(() => Promise.resolve()),
  close:           vi.fn(),
  transactions:    _makeDexieTable(),
  users:           _makeDexieTable(),
  bank_accounts:   _makeDexieTable(),
  debtors:         _makeDexieTable(),
  failed_deposits: _makeDexieTable(),
  notifications:   _makeDexieTable(),
  audit_logs:      _makeDexieTable(),
  account_ledger:  _makeDexieTable(),
  account_balances:_makeDexieTable(),
  daily_closings:  _makeDexieTable(),
  system_settings: _makeDexieTable(),
  sync_queue:      _makeDexieTable(),
  sync_conflicts:  _makeDexieTable(),
  cache_meta:      _makeDexieTable(),
  offline_sessions:_makeDexieTable(),
  version:         vi.fn().mockReturnThis(),
  stores:          vi.fn().mockReturnThis(),
  transaction:     vi.fn(async (mode, tables, fn) => fn()),
};

// ============================================================
// 5. دوال UI بسيطة (لا تفعل شيئاً في بيئة الاختبار)
// ============================================================
globalThis.showToast    = vi.fn();
globalThis.confirmDialog = vi.fn(() => Promise.resolve(true));
globalThis.AppStore      = {
  getState:     vi.fn(),
  setState:     vi.fn(),
  setCurrentUser: vi.fn(),
  clearCurrentUser: vi.fn(),
  refreshData:  vi.fn(() => Promise.resolve()),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
};
// getDeviceToken — defined privately in AuthService.js (not window-exported).
// LocalOperationsService.js depends on it being in global scope (script-tag loading).
globalThis.getDeviceToken = vi.fn(() => null);

// getCurrentUserId — exported from AuthService but mocked here for early loads
globalThis.getCurrentUserId = vi.fn(() => 'mock-user-id');

// getCurrentSession — defined in SupabaseClient.js (not loaded in tests)
globalThis.getCurrentSession = vi.fn(() => Promise.resolve({ session: null, error: null }));

globalThis.SyncService   = { init: vi.fn(), manualSync: vi.fn() };
globalThis.ThemeManager  = { init: vi.fn(), toggle: vi.fn(), isDarkMode: vi.fn(() => false) };
globalThis.IdleTimer     = { start: vi.fn(), stop: vi.fn(), reset: vi.fn(), AGENT_IDLE_TIMEOUT_MS: 300000, ADMIN_IDLE_TIMEOUT_MS: 1800000 };
globalThis.OfflineAuthService = undefined; // اختياري
globalThis.PasswordDialog = undefined;    // اختياري
globalThis.PinDialog      = undefined;    // اختياري
globalThis.DataSourceConfig = undefined;  // اختياري

// ============================================================
// 6. تحميل helpers.js (يُعيّن ok, err, isOk, formatErrorMessage, ... كـ globals)
// ============================================================
loadScript('utils/helpers.js');
