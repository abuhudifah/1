/**
 * store/AppStore.js — v3.0 (Online-First)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * التغييرات v3:
 * ✅ refreshData() تقرأ من Supabase مباشرة (Online-First)
 * ✅ _loadCompanies/_loadBankAccounts/_loadSystemSettings/_loadUsers/_loadDebtors
 *    كلها تستعلم Supabase أولاً وتسقط إلى Dexie عند offline فقط
 * ✅ _loadNotifications تقرأ من Supabase أولاً عند الاتصال
 * ✅ كتابة Dexie تتم في الخلفية بعد نجاح Supabase
 */
'use strict';

// ============================================================
// الحالة المركزية الابتدائية
// ============================================================
const _initialState = {
  currentUser        : null,
  role               : null,
  allowedTabs        : [],
  accountNumber      : null,
  currentTab         : null,
  previousTab        : null,
  isOnline           : navigator.onLine,
  syncQueueLength    : 0,
  syncRunning        : false,
  lastSyncAt         : null,
  conflictsCount     : 0,
  selectedDate       : getCurrentSaudiDate(),
  selectedAgentId    : null,
  transactions       : [],
  transactionsLoading: false,
  notifications      : [],
  unreadNotifCount   : 0,
  bankAccounts       : [],
  debtors            : [],
  companies          : [],
  expenseAccounts    : [],
  users              : [],
  systemSettings     : new Map(),
  logoUrl            : null,
  kpiData            : null,
  kpiLoading         : false,
};

let _state = { ..._initialState };
const AppStore = new EventTarget();

// ============================================================
// setState / getState
// ============================================================
function setState(updater, eventName = 'store:stateChanged') {
  const prev = { ..._state };
  _state = { ..._state, ...(typeof updater === 'function' ? updater(prev) : updater) };
  AppStore.dispatchEvent(new CustomEvent(eventName, { detail: { state: _state, prev } }));
  if (eventName !== 'store:stateChanged') {
    AppStore.dispatchEvent(new CustomEvent('store:stateChanged', { detail: { state: _state, prev } }));
  }
}

function getState(key = null) {
  if (key) return _state[key];
  return { ..._state };
}

// ============================================================
// المصادقة
// ============================================================
function setCurrentUser(profile) {
  if (!profile) return;
  setState({
    currentUser   : profile,
    role          : profile.role,
    allowedTabs   : AuthService.getAllowedTabs(),
    accountNumber : AuthService.generateAccountNumber(profile),
    currentTab    : AuthService.getAllowedTabs()[0] || null,
  }, 'store:userChanged');
}

function clearCurrentUser() {
  _state = { ..._initialState, isOnline: navigator.onLine };
  AppStore.dispatchEvent(new CustomEvent('store:userCleared'));
  AppStore.dispatchEvent(new CustomEvent('store:stateChanged', { detail: { state: _state } }));
}

// ============================================================
// التبويبات
// ============================================================
function setCurrentTab(tabId) {
  if (!AuthService.canAccessTab(tabId)) { showToast('لا تملك صلاحية الوصول لهذا التبويب', 'error'); return false; }
  setState({ previousTab: _state.currentTab, currentTab: tabId }, 'store:tabChanged');
  return true;
}

// ============================================================
// العمليات المالية
// ============================================================
function addTransaction(tx)           { setState({ transactions: [tx, ..._state.transactions] }, 'store:transactionAdded'); }
function updateTransaction(id, chg)   { setState({ transactions: _state.transactions.map(tx => tx.id === id ? { ...tx, ...chg } : tx) }, 'store:transactionUpdated'); }
function deleteTransaction(id)        { setState({ transactions: _state.transactions.filter(tx => tx.id !== id) }, 'store:transactionDeleted'); }
function markTransactionReversed(id)  { updateTransaction(id, { is_reversed: true }); }

async function refreshTransactions(date = null, agentId = null) {
  const targetDate  = date    || _state.selectedDate;
  const targetAgent = agentId || _state.selectedAgentId || AuthService.getCurrentUserId();
  setState({ transactionsLoading: true });
  try {
    const filters = { date: targetDate };
    if (targetAgent) filters.agent_id = targetAgent;
    const result = await repo.query(TABLES.TRANSACTIONS, filters, {
      orderBy: 'created_at', ascending: false, pageSize: 200,
    });
    if (isOk(result)) {
      setState({
        transactions       : result.data.data || [],
        transactionsLoading: false,
        selectedDate       : targetDate,
        selectedAgentId    : targetAgent,
      }, 'store:transactionsRefreshed');
    }
  } catch (e) {
    console.error('❌ AppStore.refreshTransactions():', e);
    setState({ transactionsLoading: false });
  }
}

function setSelectedDate(date)    { setState({ selectedDate: date }, 'store:dateChanged'); refreshTransactions(date, _state.selectedAgentId); }
function setSelectedAgent(agentId){ setState({ selectedAgentId: agentId }, 'store:agentChanged'); }

// ============================================================
// refreshData — Online-First
// ============================================================
async function refreshData() {
  try {
    const user = AuthService.getCurrentUser();
    if (!user) return;

    const tasks = [
      _loadCompanies(),
      _loadExpenseAccounts(),
      _loadSystemSettings(),
      _loadNotifications(user),
    ];

    if (user.role === ROLES.ADMIN || user.role === ROLES.ADMIN_ASSISTANT) {
      tasks.push(_loadBankAccounts());
      tasks.push(_loadDebtors());
      tasks.push(_loadUsers());
    } else if (user.role === ROLES.AGENT) {
      tasks.push(_loadAgentBankAccounts(user.id));
      tasks.push(_loadAgentDebtors(user.id));
    }

    await Promise.allSettled(tasks);
  } catch (e) {
    console.error('❌ AppStore.refreshData():', e);
  }
}

// ============================================================
// دوال تحميل البيانات — Online-First
// ============================================================

/**
 * جلب من Supabase أولاً، Dexie احتياطي عند offline
 * كتابة Dexie في الخلفية بعد نجاح Supabase
 */
async function _fetchFromSupabaseWithFallback(tableName, supabaseQuery, dexieFallback) {
  if (isOnline()) {
    try {
      const { data, error } = await supabaseQuery();
      if (!error && data) {
        // كتابة Dexie في الخلفية
        (async () => {
          try {
            if (db.isOpen()) await db[tableName]?.bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED })));
          } catch { }
        })();
        return data;
      }
      console.warn(`⚠️ AppStore._fetch(${tableName}): Supabase فشل، سقوط إلى Dexie`);
    } catch (e) {
      console.warn(`⚠️ AppStore._fetch(${tableName}): استثناء، سقوط إلى Dexie:`, e.message);
    }
  }
  // Offline أو فشل Supabase → Dexie
  return await dexieFallback();
}

async function _loadCompanies() {
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.COMPANIES,
    () => supabaseClient.from(TABLES.COMPANIES).select('*').order('name').limit(QUERY_LIMITS.COMPANIES),
    () => db.isOpen() ? db.companies.toArray().catch(() => []) : []
  );
  setState({ companies: data || [] }, 'store:companiesLoaded');
}

async function _loadExpenseAccounts() {
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.EXPENSE_ACCOUNTS,
    () => supabaseClient.from(TABLES.EXPENSE_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.EXPENSE_ACCOUNTS),
    () => db.isOpen() ? db.expense_accounts.toArray().catch(() => []) : []
  );
  setState({ expenseAccounts: data || [] }, 'store:expenseAccountsLoaded');
}

async function _loadSystemSettings() {
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.SYSTEM_SETTINGS,
    () => supabaseClient.from(TABLES.SYSTEM_SETTINGS).select('*').limit(QUERY_LIMITS.SYSTEM_SETTINGS),
    () => db.isOpen() ? db.system_settings.toArray().catch(() => []) : []
  );
  const settingsMap = new Map();
  (data || []).forEach(s => settingsMap.set(s.key, s.value));

  const logoEntry = settingsMap.get('logo');
  const logoUrl   = typeof logoEntry === 'object' ? logoEntry?.value : logoEntry || null;

  setState({ systemSettings: settingsMap, logoUrl }, 'store:settingsLoaded');
}

async function _loadBankAccounts() {
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.BANK_ACCOUNTS,
    () => supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.BANK_ACCOUNTS),
    () => db.isOpen() ? db.bank_accounts.toArray().catch(() => []) : []
  );
  setState({ bankAccounts: data || [] }, 'store:bankAccountsLoaded');
}

async function _loadDebtors() {
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.DEBTORS,
    () => supabaseClient.from(TABLES.DEBTORS).select('*').order('name').limit(QUERY_LIMITS.DEBTORS),
    () => db.isOpen() ? db.debtors.toArray().catch(() => []) : []
  );
  setState({ debtors: data || [] }, 'store:debtorsLoaded');
}

async function _loadUsers() {
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.USERS,
    () => supabaseClient.from(TABLES.USERS)
      .select('id, username, display_name, role, is_active, allowed_tabs')
      .eq('is_active', true)
      .order('display_name')
      .limit(QUERY_LIMITS.USERS),
    () => db.isOpen()
      ? db.users.where('is_active').equals(1).toArray().catch(() => [])
      : []
  );
  setState({ users: data || [] }, 'store:usersLoaded');
}

async function _loadNotifications(user) {
  try {
    let allNotifs = [];

    if (isOnline()) {
      try {
        const { data, error } = await supabaseClient
          .from(TABLES.NOTIFICATIONS)
          .select('*')
          .order('created_at', { ascending: false })
          .limit(50);
        if (!error && data) {
          allNotifs = data.map(_normalizeNotification);
          // كتابة Dexie في الخلفية
          (async () => {
            try { if (db.isOpen()) await db.notifications.bulkPut(data); } catch { }
          })();
        }
      } catch { /* سقوط إلى Dexie */ }
    }

    if (!allNotifs.length && db.isOpen()) {
      const raw = await db.notifications.orderBy('created_at').reverse().limit(50).toArray().catch(() => []);
      allNotifs = raw.map(_normalizeNotification);
    }

    const visible = allNotifs.filter(n => {
      const t = n.target;
      if (t === 'all') return true;
      if (Array.isArray(t)) return t.includes(user.id);
      return false;
    });

    const notHidden = visible.filter(n => !n.hidden_by.includes(user.id));
    const unread    = notHidden.filter(n => !n.read_by.includes(user.id));

    setState({ notifications: notHidden, unreadNotifCount: unread.length }, 'store:notificationsLoaded');
  } catch (e) {
    console.error('❌ AppStore._loadNotifications():', e);
    setState({ notifications: [], unreadNotifCount: 0 }, 'store:notificationsLoaded');
  }
}

// المندوب: يجلب كل البنوك — RLS تضمن صلاحية القراءة
// BankAccountsComponent يُصفِّي عرض اليوم محلياً في واجهته
async function _loadAgentBankAccounts(agentId) {
  try {
    const data = await _fetchFromSupabaseWithFallback(
      TABLES.BANK_ACCOUNTS,
      () => supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.BANK_ACCOUNTS),
      () => db.isOpen() ? db.bank_accounts.orderBy('name').toArray().catch(() => []) : []
    );
    setState({ bankAccounts: data || [] }, 'store:bankAccountsLoaded');
  } catch { /* تجاهل */ }
}

async function _loadAgentDebtors(agentId) {
  try {
    let data = [];
    if (isOnline()) {
      // Supabase: يجلب المديونين المعينين لهذا المندوب
      const { data: res } = await supabaseClient
        .from(TABLES.DEBTORS)
        .select('*')
        .contains('assigned_agents', [agentId])
        .order('name')
        .limit(QUERY_LIMITS.DEBTORS);
      data = res || [];
      if (data.length && db.isOpen()) {
        (async () => {
          try { await db.debtors.bulkPut(data.map(d => ({ ...d, sync_status: SYNC_STATUS.SYNCED }))); } catch { }
        })();
      }
    } else if (db.isOpen()) {
      const all = await db.debtors.toArray().catch(() => []);
      data = all.filter(d => {
        try {
          const agents = Array.isArray(d.assigned_agents) ? d.assigned_agents : JSON.parse(d.assigned_agents || '[]');
          return agents.includes(agentId);
        } catch { return false; }
      });
    }
    setState({ debtors: data }, 'store:debtorsLoaded');
  } catch { /* تجاهل */ }
}

// ============================================================
// دالة مساعدة: JSON آمن
// ============================================================
function _safeJsonParse(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value == null) return fallback;
  if (typeof value !== 'string') return fallback;
  try { return JSON.parse(value) ?? fallback; } catch { return fallback; }
}

function _normalizeNotification(n) {
  return {
    ...n,
    read_by   : _safeJsonParse(n.read_by,   []),
    hidden_by : _safeJsonParse(n.hidden_by, []),
    target    : typeof n.target === 'string' ? _safeJsonParse(n.target, n.target) : (n.target ?? null),
  };
}

// ============================================================
// الاتصال والمزامنة
// ============================================================
function setOnlineStatus(online)           { setState({ isOnline: online }, 'store:onlineStatusChanged'); }
function updateSyncQueueLength(count)      { setState({ syncQueueLength: count }, 'store:syncQueueChanged'); }
function setSyncRunning(running, lastSyncAt = null) {
  setState({ syncRunning: running, lastSyncAt: lastSyncAt || _state.lastSyncAt }, 'store:syncStatusChanged');
}

// ============================================================
// الإشعارات
// ============================================================
function addNotification(notification) {
  setState({ notifications: [notification, ..._state.notifications], unreadNotifCount: _state.unreadNotifCount + 1 }, 'store:notificationAdded');
}
function decrementUnreadCount() {
  setState({ unreadNotifCount: Math.max(0, _state.unreadNotifCount - 1) }, 'store:notifCountChanged');
}

// ============================================================
// KPI
// ============================================================
function setKpiData(data)      { setState({ kpiData: data, kpiLoading: false }, 'store:kpiUpdated'); }
function setKpiLoading(loading){ setState({ kpiLoading: loading }); }

// ============================================================
// الاستماع للأحداث الخارجية
// ============================================================
window.addEventListener('store:setOnlineStatus',      (e) => setOnlineStatus(e.detail.online));
window.addEventListener('store:updateSyncQueueLength',(e) => updateSyncQueueLength(e.detail.count));
window.addEventListener('store:syncRunning',          (e) => setSyncRunning(e.detail.running, e.detail.lastSyncAt));

window.addEventListener('store:notificationsUpdated', () => {
  const user = AuthService.getCurrentUser();
  if (user) _loadNotifications(user);
});

window.addEventListener('store:conflictsUpdated', (e) => {
  setState({ conflictsCount: e.detail.count }, 'store:conflictsChanged');
});
window.addEventListener('store:conflictAdded', () => {
  setState({ conflictsCount: _state.conflictsCount + 1 }, 'store:conflictsChanged');
});

window.addEventListener('store:tempIdReplaced', (e) => {
  const { tempId, realId } = e.detail;
  setState({ transactions: _state.transactions.map(tx => tx.id === tempId ? { ...tx, id: realId, sync_status: SYNC_STATUS.SYNCED } : tx) });
});

window.addEventListener('accounting:transactionCreated', (e) => {
  const { transaction: tx } = e.detail;
  if (tx.date === _state.selectedDate && (!_state.selectedAgentId || _state.selectedAgentId === tx.agent_id)) {
    addTransaction(tx);
  }
});

window.addEventListener('accounting:transactionReversed', (e) => markTransactionReversed(e.detail.transactionId));
window.addEventListener('auth:logout', () => clearCurrentUser());

// ============================================================
// تصدير
// ============================================================
Object.assign(AppStore, {
  setState, getState,
  setCurrentUser, clearCurrentUser,
  setCurrentTab,
  addTransaction, updateTransaction, deleteTransaction, markTransactionReversed,
  refreshTransactions, setSelectedDate, setSelectedAgent,
  refreshData,
  setOnlineStatus, updateSyncQueueLength, setSyncRunning,
  addNotification, decrementUnreadCount,
  setKpiData, setKpiLoading,
});

window.AppStore = AppStore;
console.log('✅ AppStore.js v3.0 — Online-First: Supabase مصدر الحقيقة الوحيد');
