/**
 * store/AppStore.js — v5.0
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * v4.0 — Phase 4: فصل Online/Offline paths
 * v5.0 — Stale-While-Revalidate (SWR):
 * ─────────────────────────────────────────────────────────────
 * المشكلة: عند انتهاء TTL (5 دق)، _fetchOnline ينتظر Supabase
 * قبل عرض أي شيء → شاشة تحميل غير ضرورية.
 *
 * الحل (SWR):
 *   - يوجد بيانات قديمة → اعرضها فوراً + حدّث في الخلفية
 *   - لا يوجد بيانات (أول تحميل) → انتظر عادياً
 *   - _swrRevalidate() → background fetch يستدعي setState عند الانتهاء
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
  beneficiaryCompanies : [],
  beneficiaryBanks     : [],
  beneficiaryUsers     : [],
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
  _loadBeneficiaries();
}

function clearCurrentUser() {
  _state = { ..._initialState, isOnline: navigator.onLine };
  invalidateCache();
  AppStore.dispatchEvent(new CustomEvent('store:userCleared'));
  AppStore.dispatchEvent(new CustomEvent('store:stateChanged', { detail: { state: _state } }));
}

// ============================================================
// المستفيدون (لكل مستخدم — مخزَّنون في localStorage)
// ============================================================
function _benefKey() {
  const uid = AuthService.getCurrentUserId?.();
  return uid ? `beneficiaries_${uid}` : null;
}
function _loadBeneficiaries() {
  const key = _benefKey();
  if (!key) return;
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}');
    setState({
      beneficiaryCompanies: Array.isArray(raw.companies) ? raw.companies : [],
      beneficiaryBanks    : Array.isArray(raw.banks)     ? raw.banks     : [],
      beneficiaryUsers    : Array.isArray(raw.users)     ? raw.users     : [],
    }, 'store:beneficiariesLoaded');
  } catch { /* تجاهل */ }
}
function _persistBeneficiaries() {
  const key = _benefKey();
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify({
      companies: _state.beneficiaryCompanies,
      banks    : _state.beneficiaryBanks,
      users    : _state.beneficiaryUsers,
    }));
  } catch { /* تجاهل */ }
}
function addBeneficiaryCompany(c) {
  if (!c || !c.id) return;
  if (_state.beneficiaryCompanies.some(x => x.id === c.id)) return;
  const item = { id: c.id, name: c.name || c.id, account_number: c.account_number || null };
  setState({ beneficiaryCompanies: [item, ..._state.beneficiaryCompanies] }, 'store:beneficiariesChanged');
  _persistBeneficiaries();
}
function addBeneficiaryBank(b) {
  if (!b || !b.id) return;
  if (_state.beneficiaryBanks.some(x => x.id === b.id)) return;
  const item = { id: b.id, name: b.name || b.id, account_number: b.account_number || null };
  setState({ beneficiaryBanks: [item, ..._state.beneficiaryBanks] }, 'store:beneficiariesChanged');
  _persistBeneficiaries();
}
function addBeneficiaryUser(u) {
  if (!u || !u.id) return;
  if (_state.beneficiaryUsers.some(x => x.id === u.id)) return;
  const item = { id: u.id, display_name: u.display_name || u.id, account_number: u.account_number || null };
  setState({ beneficiaryUsers: [item, ..._state.beneficiaryUsers] }, 'store:beneficiariesChanged');
  _persistBeneficiaries();
}
function getBeneficiaryCompanies() { return _state.beneficiaryCompanies; }
function getBeneficiaryBanks()     { return _state.beneficiaryBanks; }
function getBeneficiaryUsers()     { return _state.beneficiaryUsers; }

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
      tasks.push(_loadUsers()); // المندوب يحتاج قائمة المستخدمين لقائمة المستلمين
    }

    await Promise.allSettled(tasks);
  } catch (e) {
    console.error('❌ AppStore.refreshData():', e);
  }
}

// ============================================================
// دوال تحميل البيانات — Online/Offline منفصلان تماماً
// ============================================================

// TTL cache — يمنع إعادة الاستعلام من Supabase خلال 5 دقائق (Online فقط)
const _cacheTs = {};
const _CACHE_TTL_MS = 5 * 60 * 1000;

function invalidateCache(tableName = null) {
  if (tableName) {
    delete _cacheTs[tableName];
    _swrInFlight.delete(tableName);
  } else {
    Object.keys(_cacheTs).forEach(k => delete _cacheTs[k]);
    _swrInFlight.clear();
  }
}

// ── مشغّل SWR: منع طلبين متزامنين لنفس الجدول ──────────────────
const _swrInFlight = new Set();

/**
 * جلب من Supabase + تحديث cache timestamp + snapshot إلى Dexie (Q2=B).
 * الدالة الأساسية المشتركة بين المسار المتزامن والخلفية.
 */
async function _fetchFromSupabase(tableName, supabaseQuery) {
  const { data, error } = await supabaseQuery();
  if (error) throw new Error(error.message);
  _cacheTs[tableName] = Date.now();
  if (data?.length && typeof db !== 'undefined' && db.isOpen() && db[tableName]) {
    (async () => {
      try { await db[tableName].bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))); } catch { }
    })();
  }
  return data || [];
}

/**
 * إعادة تحقق في الخلفية (SWR):
 * بعد عرض البيانات القديمة فوراً، يُطلق هذا الطلب ويُحدّث الـ state عند الانتهاء.
 * _swrInFlight يمنع طلبين متزامنين لنفس الجدول.
 *
 * @param {Function} [transformer] دالة تحويل اختيارية (مثل بناء Map للإعدادات)
 */
function _swrRevalidate(tableName, supabaseQuery, stateKey, eventName, transformer = null) {
  if (_swrInFlight.has(tableName)) return; // لا تُكرّر الطلب
  _swrInFlight.add(tableName);

  (async () => {
    try {
      const fresh = await _fetchFromSupabase(tableName, supabaseQuery);
      const value = transformer ? transformer(fresh) : fresh;
      setState(typeof value === 'object' && !Array.isArray(value) ? value : { [stateKey]: value }, eventName);
    } catch (e) {
      console.warn(`⚠️ SWR [${tableName}]:`, e.message);
    } finally {
      _swrInFlight.delete(tableName);
    }
  })();
}

/**
 * Online: Stale-While-Revalidate (v5.0)
 *
 * - بيانات طازجة (TTL < 5 دق) → أعدها فوراً
 * - بيانات قديمة موجودة      → أعدها فوراً + حدّث في الخلفية
 * - لا بيانات                → انتظر Supabase (first load)
 *
 * @param {string}   stateKey      مفتاح _state للبيانات (مثل 'companies')
 * @param {string}   eventName     اسم الحدث الذي يُصدره setState عند تحديث الخلفية
 * @param {Function} [transformer] دالة تحويل للبيانات قبل setState (للإعدادات مثلاً)
 */
async function _fetchOnline(tableName, supabaseQuery, stateKey = null, eventName = 'store:stateChanged', transformer = null) {
  const hasData = stateKey && Array.isArray(_state[stateKey]) && _state[stateKey].length > 0;
  const age     = Date.now() - (_cacheTs[tableName] || 0);
  const isFresh = age < _CACHE_TTL_MS;

  if (hasData && isFresh) {
    return _state[stateKey]; // مخزن مؤقت طازج — لا حاجة لأي طلب
  }

  if (hasData) {
    // SWR: أعد البيانات القديمة فوراً + أطلق تحديثاً في الخلفية
    _swrRevalidate(tableName, supabaseQuery, stateKey, eventName, transformer);
    return _state[stateKey];
  }

  // لا بيانات — انتظر الطلب الأول (first load فقط)
  return await _fetchFromSupabase(tableName, supabaseQuery);
}

/**
 * Offline: قراءة من Dexie snapshot فقط — بلا أي Supabase.
 */
async function _fetchOffline(dexieFallback) {
  if (typeof db === 'undefined' || !db.isOpen()) return [];
  return await dexieFallback();
}

/**
 * Q2=B: حفظ snapshot شامل لبيانات المراجع في Dexie عند كل Online login.
 * يُستدعى من AuthService بعد نجاح تسجيل الدخول Online.
 */
async function snapshotReferenceDataToDexie() {
  if (typeof db === 'undefined' || !db.isOpen()) return;
  try {
    await Promise.allSettled([
      supabaseClient.from(TABLES.COMPANIES).select('*').order('name').limit(QUERY_LIMITS.COMPANIES)
        .then(({ data }) => { if (data?.length) db.companies?.bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {}); }),
      supabaseClient.from(TABLES.EXPENSE_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.EXPENSE_ACCOUNTS)
        .then(({ data }) => { if (data?.length) db.expense_accounts?.bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {}); }),
      supabaseClient.from(TABLES.SYSTEM_SETTINGS).select('*').limit(QUERY_LIMITS.SYSTEM_SETTINGS)
        .then(({ data }) => { if (data?.length) db.system_settings?.bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {}); }),
      supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.BANK_ACCOUNTS)
        .then(({ data }) => { if (data?.length) db.bank_accounts?.bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {}); }),
      supabaseClient.from(TABLES.USERS)
        .select('id, username, display_name, role, is_active, allowed_tabs, account_number')
        .eq('is_active', true).order('display_name').limit(QUERY_LIMITS.USERS)
        .then(({ data }) => { if (data?.length) db.users?.bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {}); }),
      supabaseClient.from(TABLES.DEBTORS).select('*').order('name').limit(QUERY_LIMITS.DEBTORS)
        .then(({ data }) => { if (data?.length) db.debtors?.bulkPut(data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {}); }),
    ]);
    console.log('✅ AppStore: snapshot المراجع حُفظ في Dexie (Q2=B)');
  } catch (e) {
    console.warn('⚠️ AppStore.snapshotReferenceDataToDexie():', e.message);
  }
}

async function _loadCompanies() {
  try {
    const data = isOfflineMode()
      ? await _fetchOffline(() => db.companies.toArray().catch(() => []))
      : await _fetchOnline(
          TABLES.COMPANIES,
          () => supabaseClient.from(TABLES.COMPANIES).select('*').order('name').limit(QUERY_LIMITS.COMPANIES),
          'companies', 'store:companiesLoaded');
    setState({ companies: data || [] }, 'store:companiesLoaded');
  } catch (e) { console.warn('⚠️ _loadCompanies():', e.message); }
}

async function _loadExpenseAccounts() {
  try {
    const data = isOfflineMode()
      ? await _fetchOffline(() => db.expense_accounts.toArray().catch(() => []))
      : await _fetchOnline(
          TABLES.EXPENSE_ACCOUNTS,
          () => supabaseClient.from(TABLES.EXPENSE_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.EXPENSE_ACCOUNTS),
          'expenseAccounts', 'store:expenseAccountsLoaded');
    setState({ expenseAccounts: data || [] }, 'store:expenseAccountsLoaded');
  } catch (e) { console.warn('⚠️ _loadExpenseAccounts():', e.message); }
}

// دالة تحويل إعدادات النظام → Map + logoUrl (تُستخدم في SWR background أيضاً)
function _transformSystemSettings(rows) {
  const settingsMap = new Map();
  (rows || []).forEach(s => settingsMap.set(s.key, s.value));
  const logoEntry = settingsMap.get('logo');
  const logoUrl   = typeof logoEntry === 'object' ? logoEntry?.value : logoEntry || null;
  return { systemSettings: settingsMap, logoUrl };
}

async function _loadSystemSettings() {
  try {
    const data = isOfflineMode()
      ? await _fetchOffline(() => db.system_settings.toArray().catch(() => []))
      : await _fetchOnline(
          TABLES.SYSTEM_SETTINGS,
          () => supabaseClient.from(TABLES.SYSTEM_SETTINGS).select('*').limit(QUERY_LIMITS.SYSTEM_SETTINGS),
          'systemSettings', 'store:settingsLoaded', _transformSystemSettings);
    setState(_transformSystemSettings(data), 'store:settingsLoaded');
  } catch (e) { console.warn('⚠️ _loadSystemSettings():', e.message); }
}

async function _loadBankAccounts() {
  try {
    const data = isOfflineMode()
      ? await _fetchOffline(() => db.bank_accounts.toArray().catch(() => []))
      : await _fetchOnline(
          TABLES.BANK_ACCOUNTS,
          () => supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.BANK_ACCOUNTS),
          'bankAccounts', 'store:bankAccountsLoaded');
    setState({ bankAccounts: data || [] }, 'store:bankAccountsLoaded');
  } catch (e) { console.warn('⚠️ _loadBankAccounts():', e.message); }
}

async function _loadDebtors() {
  try {
    const data = isOfflineMode()
      ? await _fetchOffline(() => db.debtors.toArray().catch(() => []))
      : await _fetchOnline(
          TABLES.DEBTORS,
          () => supabaseClient.from(TABLES.DEBTORS).select('*').order('name').limit(QUERY_LIMITS.DEBTORS),
          'debtors', 'store:debtorsLoaded');
    setState({ debtors: data || [] }, 'store:debtorsLoaded');
  } catch (e) { console.warn('⚠️ _loadDebtors():', e.message); }
}

async function _loadUsers() {
  try {
    const data = isOfflineMode()
      ? await _fetchOffline(() => db.users.where('is_active').equals(1).toArray().catch(() => []))
      : await _fetchOnline(
          TABLES.USERS,
          () => supabaseClient.from(TABLES.USERS)
            .select('id, username, display_name, role, is_active, allowed_tabs, account_number')
            .eq('is_active', true).order('display_name').limit(QUERY_LIMITS.USERS),
          'users', 'store:usersLoaded');
    setState({ users: data || [] }, 'store:usersLoaded');
  } catch (e) { console.warn('⚠️ _loadUsers():', e.message); }
}

async function _loadNotifications(user) {
  try {
    let allNotifs = [];

    if (isOfflineMode()) {
      // Offline: من Dexie snapshot فقط
      if (typeof db !== 'undefined' && db.isOpen()) {
        const raw = await db.notifications.orderBy('created_at').reverse().limit(50).toArray().catch(() => []);
        allNotifs = raw.map(_normalizeNotification);
      }
    } else {
      // Online: Supabase مباشر — خطأ صريح
      const { data, error } = await supabaseClient
        .from(TABLES.NOTIFICATIONS)
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (!error && data) {
        allNotifs = data.map(_normalizeNotification);
      } else if (error) {
        console.warn('⚠️ _loadNotifications Supabase:', error.message);
      }
    }

    const visible  = allNotifs.filter(n => { const t = n.target; return t === 'all' || (Array.isArray(t) && t.includes(user.id)); });
    const notHidden = visible.filter(n => !n.hidden_by.includes(user.id));
    const unread    = notHidden.filter(n => !n.read_by.includes(user.id));
    setState({ notifications: notHidden, unreadNotifCount: unread.length }, 'store:notificationsLoaded');
  } catch (e) {
    console.error('❌ AppStore._loadNotifications():', e);
    setState({ notifications: [], unreadNotifCount: 0 }, 'store:notificationsLoaded');
  }
}

// المندوب: يجلب كل البنوك — RLS تضمن صلاحية القراءة
async function _loadAgentBankAccounts(agentId) {
  try {
    const data = isOfflineMode()
      ? await _fetchOffline(() => db.bank_accounts.orderBy('name').toArray().catch(() => []))
      : await _fetchOnline(
          TABLES.BANK_ACCOUNTS,
          () => supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name').limit(QUERY_LIMITS.BANK_ACCOUNTS),
          'bankAccounts', 'store:bankAccountsLoaded');
    setState({ bankAccounts: data || [] }, 'store:bankAccountsLoaded');
  } catch (e) { console.warn('⚠️ _loadAgentBankAccounts():', e.message); }
}

async function _loadAgentDebtors(agentId) {
  try {
    let data = [];
    if (isOfflineMode()) {
      // Offline: فلترة محلية من Dexie snapshot
      if (typeof db !== 'undefined' && db.isOpen()) {
        const all = await db.debtors.toArray().catch(() => []);
        data = all.filter(d => {
          try {
            const agents = Array.isArray(d.assigned_agents) ? d.assigned_agents : JSON.parse(d.assigned_agents || '[]');
            return agents.includes(agentId);
          } catch { return false; }
        });
      }
    } else {
      // Online: Supabase مباشر — خطأ صريح
      const { data: res, error } = await supabaseClient
        .from(TABLES.DEBTORS)
        .select('*')
        .filter('assigned_agents', 'cs', JSON.stringify([agentId]))
        .order('name')
        .limit(QUERY_LIMITS.DEBTORS);
      if (error) throw new Error(error.message);
      data = res || [];
      // Q2=B snapshot
      if (data.length && typeof db !== 'undefined' && db.isOpen()) {
        (async () => { try { await db.debtors.bulkPut(data.map(d => ({ ...d, sync_status: SYNC_STATUS.SYNCED }))); } catch { } })();
      }
    }
    setState({ debtors: data }, 'store:debtorsLoaded');
  } catch (e) { console.warn('⚠️ _loadAgentDebtors():', e.message); }
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
  refreshData, snapshotReferenceDataToDexie,
  setOnlineStatus, updateSyncQueueLength, setSyncRunning,
  addNotification, decrementUnreadCount,
  setKpiData, setKpiLoading,
  addBeneficiaryCompany, addBeneficiaryBank, addBeneficiaryUser,
  getBeneficiaryCompanies, getBeneficiaryBanks, getBeneficiaryUsers,
  invalidateCache,
});

window.AppStore = AppStore;
console.log('✅ AppStore.js v5.0 — SWR: بيانات قديمة فوراً + تحديث خلفي | _swrInFlight يمنع التكرار');
