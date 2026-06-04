/**
 * store/AppStore.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * إدارة الحالة المركزية (EventTarget)
 *
 * يعتمد على نمط EventTarget — بدون مكتبات خارجية
 * كل تغيير في الحالة يُطلق حدثاً يستمع إليه المكوّن المعني
 * مما يتجنب إعادة رسم الواجهة بالكامل عند كل تحديث
 *
 * الحالة المركزية:
 * - currentUser / role / allowedTabs
 * - currentTab (التبويب النشط)
 * - isOnline / syncQueueLength / syncRunning
 * - transactions (اليوم الحالي)
 * - notifications (غير المقروءة)
 * - bankAccounts / debtors / companies / expenseAccounts
 * - systemSettings (الشعار، الإعدادات)
 * - kpiData (لوحة المعلومات)
 * - selectedAgentId (عند إدخال بيانات بالنيابة)
 */

'use strict';

// ============================================================
// الحالة المركزية الابتدائية
// ============================================================

const _initialState = {
  // المصادقة
  currentUser     : null,
  role            : null,
  allowedTabs     : [],
  accountNumber   : null,

  // التنقل
  currentTab      : null,
  previousTab     : null,

  // الاتصال والمزامنة
  isOnline        : navigator.onLine,
  syncQueueLength : 0,
  syncRunning     : false,
  lastSyncAt      : null,
  conflictsCount  : 0,

  // العمليات (التاريخ المحدد حالياً في كل تبويب)
  selectedDate    : getCurrentSaudiDate(),
  selectedAgentId : null,           // المدير يختار مندوباً للإدخال نيابةً
  transactions    : [],             // عمليات اليوم المحدد
  transactionsLoading: false,

  // الإشعارات
  notifications       : [],
  unreadNotifCount    : 0,

  // البيانات الأساسية (تُحمَّل مرة واحدة)
  bankAccounts        : [],
  debtors             : [],
  companies           : [],
  expenseAccounts     : [],
  users               : [],         // للمدير فقط

  // إعدادات النظام
  systemSettings      : new Map(),
  logoUrl             : null,

  // لوحة المعلومات (KPI)
  kpiData             : null,
  kpiLoading          : false,
};

// نسخة العمل (deep copy من الابتدائية)
let _state = { ..._initialState };

// ============================================================
// AppStore — الكائن الرئيسي
// ============================================================

const AppStore = new EventTarget();

// ============================================================
// الدوال الأساسية: setState وgetState
// ============================================================

/**
 * يُحدّث الحالة ويُطلق حدث التغيير
 * @param {object|Function} updater - كائن تحديث أو دالة (prevState => newState)
 * @param {string} [eventName='store:stateChanged'] - اسم الحدث المُطلَق
 */
function setState(updater, eventName = 'store:stateChanged') {
  const prev = { ..._state };

  if (typeof updater === 'function') {
    _state = { ..._state, ...updater(prev) };
  } else {
    _state = { ..._state, ...updater };
  }

  // إطلاق الحدث مع الحالة الجديدة والقديمة
  AppStore.dispatchEvent(new CustomEvent(eventName, {
    detail: { state: _state, prev, changed: updater },
  }));

  // حدث عام لأي مستمع
  if (eventName !== 'store:stateChanged') {
    AppStore.dispatchEvent(new CustomEvent('store:stateChanged', {
      detail: { state: _state, prev },
    }));
  }
}

/**
 * يُعيد نسخة من الحالة الحالية (أو قيمة مفتاح محدد)
 * @param {string} [key] - اختياري: مفتاح محدد
 * @returns {*}
 */
function getState(key = null) {
  if (key) return _state[key];
  return { ..._state };
}

// ============================================================
// المصادقة
// ============================================================

/**
 * يُعيّن بيانات المستخدم بعد تسجيل الدخول
 * @param {object} profile
 */
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

/**
 * يُصفّر بيانات المستخدم عند تسجيل الخروج
 */
function clearCurrentUser() {
  _state = { ..._initialState, isOnline: navigator.onLine };
  AppStore.dispatchEvent(new CustomEvent('store:userCleared'));
  AppStore.dispatchEvent(new CustomEvent('store:stateChanged', {
    detail: { state: _state },
  }));
}

// ============================================================
// التبويبات
// ============================================================

/**
 * يُبدّل التبويب النشط
 * @param {string} tabId
 * @returns {boolean} - هل التبديل مسموح؟
 */
function setCurrentTab(tabId) {
  if (!AuthService.canAccessTab(tabId)) {
    showToast('لا تملك صلاحية الوصول لهذا التبويب', 'error');
    return false;
  }

  setState({
    previousTab : _state.currentTab,
    currentTab  : tabId,
  }, 'store:tabChanged');

  return true;
}

// ============================================================
// العمليات المالية
// ============================================================

/**
 * يُضيف معاملة جديدة لقائمة اليوم الحالي في الحالة
 * (بدون إعادة جلب من قاعدة البيانات)
 * @param {object} transaction
 */
function addTransaction(transaction) {
  const updated = [transaction, ..._state.transactions];
  setState({ transactions: updated }, 'store:transactionAdded');
}

/**
 * يُحدّث معاملة موجودة في الحالة المحلية
 * @param {string} id
 * @param {object} changes
 */
function updateTransaction(id, changes) {
  const updated = _state.transactions.map(tx =>
    tx.id === id ? { ...tx, ...changes } : tx
  );
  setState({ transactions: updated }, 'store:transactionUpdated');
}

/**
 * يحذف معاملة من الحالة المحلية
 * @param {string} id
 */
function deleteTransaction(id) {
  const updated = _state.transactions.filter(tx => tx.id !== id);
  setState({ transactions: updated }, 'store:transactionDeleted');
}

/**
 * يُبدّل العلامة is_reversed لمعاملة (بعد عكسها)
 * @param {string} id
 */
function markTransactionReversed(id) {
  updateTransaction(id, { is_reversed: true });
}

// ============================================================
// تحميل / تحديث البيانات
// ============================================================

/**
 * يجلب عمليات التاريخ والمندوب المحدد
 * @param {string} [date] - افتراضي: اليوم
 * @param {string} [agentId] - افتراضي: المستخدم الحالي
 * @returns {Promise<void>}
 */
async function refreshTransactions(date = null, agentId = null) {
  const targetDate  = date    || _state.selectedDate;
  const targetAgent = agentId || _state.selectedAgentId || AuthService.getCurrentUserId();

  setState({ transactionsLoading: true });

  try {
    const filters = { date: targetDate };
    if (targetAgent) filters.agent_id = targetAgent;

    const result = await repo.query(TABLES.TRANSACTIONS, filters, {
      orderBy  : 'created_at',
      ascending: false,
      pageSize : 200, // عرض جميع عمليات اليوم
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

/**
 * يُحدّث بيانات التاريخ المحدد
 * @param {string} date - YYYY-MM-DD
 */
function setSelectedDate(date) {
  setState({ selectedDate: date }, 'store:dateChanged');
  refreshTransactions(date, _state.selectedAgentId);
}

/**
 * يُحدّث المندوب المختار (للمدير عند الإدخال نيابةً)
 * @param {string|null} agentId
 */
function setSelectedAgent(agentId) {
  setState({ selectedAgentId: agentId }, 'store:agentChanged');
}

/**
 * يجلب ويُحدّث البيانات الأساسية (bankAccounts, debtors, companies...)
 * @returns {Promise<void>}
 */
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
// تحميل كل نوع بيانات
// ============================================================

async function _loadCompanies() {
  const companies = await getLocalCompanies();
  setState({ companies }, 'store:companiesLoaded');
}

async function _loadExpenseAccounts() {
  const expenseAccounts = await getLocalExpenseAccounts();
  setState({ expenseAccounts }, 'store:expenseAccountsLoaded');
}

async function _loadSystemSettings() {
  const settings = await getLocalSettings();
  const logoSetting = settings.get('logo');
  const logoUrl = logoSetting?.value
    ? logoSetting.value
    : (logoSetting?.type === 'upload' ? logoSetting?.value : null);

  setState({ systemSettings: settings, logoUrl }, 'store:settingsLoaded');
}

// ============================================================
// دالة مساعدة: تحليل JSON بأمان
// ============================================================

/**
 * يُحلّل قيمة JSON بأمان بدون إلقاء استثناء
 * ✅ الإصلاح: بديل آمن لـ JSON.parse() المجردة في _loadNotifications
 * @param {*} value - القيمة المُراد تحليلها
 * @param {*} fallback - القيمة الافتراضية عند الفشل
 * @returns {*}
 */
function _safeJsonParse(value, fallback = []) {
  if (Array.isArray(value)) return value;
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    console.warn('⚠️  AppStore._safeJsonParse: بيانات JSON فاسدة:', value);
    return fallback;
  }
}

async function _loadNotifications(user) {
  try {
    const allNotifs = await db.notifications
      .orderBy('created_at')
      .reverse()
      .limit(50)
      .toArray();

    // فلترة بحسب target
    const visible = allNotifs.filter(n => {
      if (n.target === '"all"' || n.target === 'all') return true;
      if (Array.isArray(n.target) && n.target.includes(user.id)) return true;
      if (typeof n.target === 'string') {
        try {
          const parsed = JSON.parse(n.target);
          if (parsed === 'all') return true;
          if (Array.isArray(parsed) && parsed.includes(user.id)) return true;
        } catch { /* تجاهل */ }
      }
      return false;
    });

    // فلترة المُخفية
    // ✅ الإصلاح: استبدال JSON.parse() المجردة بـ _safeJsonParse()
    // لمنع الانهيار عند وجود بيانات فاسدة في hidden_by أو read_by
    const notHidden = visible.filter(n => {
      const hidden = _safeJsonParse(n.hidden_by, []);
      return !hidden.includes(user.id);
    });

    const unread = notHidden.filter(n => {
      const read = _safeJsonParse(n.read_by, []);
      return !read.includes(user.id);
    });

    setState({
      notifications     : notHidden,
      unreadNotifCount  : unread.length,
    }, 'store:notificationsLoaded');

  } catch (e) {
    console.error('❌ AppStore._loadNotifications():', e);
    // عدم انهيار الحالة — إبقاء الإشعارات فارغة
    setState({
      notifications    : [],
      unreadNotifCount : 0,
    }, 'store:notificationsLoaded');
  }
}

async function _loadBankAccounts() {
  const bankAccounts = await getLocalBankAccounts();
  setState({ bankAccounts }, 'store:bankAccountsLoaded');
}

async function _loadDebtors() {
  try {
    const debtors = await db.debtors.toArray();
    setState({ debtors }, 'store:debtorsLoaded');
  } catch { /* تجاهل */ }
}

async function _loadUsers() {
  try {
    const users = await db.users
      .where('is_active')
      .equals(1)
      .toArray();
    setState({ users }, 'store:usersLoaded');
  } catch { /* تجاهل */ }
}

async function _loadAgentBankAccounts(agentId) {
  try {
    const today = getCurrentSaudiDate();
    const deposits = await db.transactions
      .where('[date+agent_id]')
      .equals([today, agentId])
      .filter(tx => tx.type === TRANSACTION_TYPES.DEPOSIT && tx.bank_account_id)
      .toArray();

    const bankIds = [...new Set(deposits.map(d => d.bank_account_id))];
    const bankAccounts = await db.bank_accounts
      .where('id')
      .anyOf(bankIds)
      .toArray();

    setState({ bankAccounts }, 'store:bankAccountsLoaded');
  } catch { /* تجاهل */ }
}

async function _loadAgentDebtors(agentId) {
  try {
    const debtors = await db.debtors
      .filter(d => {
        try {
          const agents = Array.isArray(d.assigned_agents)
            ? d.assigned_agents
            : JSON.parse(d.assigned_agents || '[]');
          return agents.includes(agentId);
        } catch { return false; }
      })
      .toArray();

    setState({ debtors }, 'store:debtorsLoaded');
  } catch { /* تجاهل */ }
}

// ============================================================
// الاتصال والمزامنة
// ============================================================

/**
 * يُحدّث حالة الاتصال بالإنترنت
 * @param {boolean} online
 */
function setOnlineStatus(online) {
  setState({ isOnline: online }, 'store:onlineStatusChanged');
}

/**
 * يُحدّث عدد العمليات المعلقة في الطابور
 * @param {number} count
 */
function updateSyncQueueLength(count) {
  setState({ syncQueueLength: count }, 'store:syncQueueChanged');
}

/**
 * يُحدّث حالة تشغيل المزامنة
 * @param {boolean} running
 * @param {string} [lastSyncAt]
 */
function setSyncRunning(running, lastSyncAt = null) {
  setState({
    syncRunning : running,
    lastSyncAt  : lastSyncAt || _state.lastSyncAt,
  }, 'store:syncStatusChanged');
}

// ============================================================
// الإشعارات
// ============================================================

/**
 * يُضيف إشعاراً للقائمة ويزيد العداد
 * @param {object} notification
 */
function addNotification(notification) {
  const updated = [notification, ..._state.notifications];
  setState({
    notifications    : updated,
    unreadNotifCount : _state.unreadNotifCount + 1,
  }, 'store:notificationAdded');
}

/**
 * يُحدّث عداد الإشعارات غير المقروءة
 */
function decrementUnreadCount() {
  setState({
    unreadNotifCount: Math.max(0, _state.unreadNotifCount - 1),
  }, 'store:notifCountChanged');
}

// ============================================================
// KPI ولوحة المعلومات
// ============================================================

/**
 * يُحدّث بيانات KPI في لوحة المعلومات
 * @param {object} data
 */
function setKpiData(data) {
  setState({ kpiData: data, kpiLoading: false }, 'store:kpiUpdated');
}

function setKpiLoading(loading) {
  setState({ kpiLoading: loading });
}

// ============================================================
// الاستماع للأحداث الخارجية (من SyncService والخدمات)
// ============================================================

window.addEventListener('store:setOnlineStatus', (e) => {
  setOnlineStatus(e.detail.online);
});

window.addEventListener('store:updateSyncQueueLength', (e) => {
  updateSyncQueueLength(e.detail.count);
});

window.addEventListener('store:syncRunning', (e) => {
  setSyncRunning(e.detail.running, e.detail.lastSyncAt);
});

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
  // تحديث المعاملات في الحالة المحلية
  const updated = _state.transactions.map(tx =>
    tx.id === tempId ? { ...tx, id: realId, sync_status: SYNC_STATUS.SYNCED } : tx
  );
  setState({ transactions: updated });
});

window.addEventListener('accounting:transactionCreated', (e) => {
  const { transaction } = e.detail;
  if (transaction.date === _state.selectedDate) {
    if (_state.selectedAgentId === null ||
        _state.selectedAgentId === transaction.agent_id) {
      addTransaction(transaction);
    }
  }
});

window.addEventListener('accounting:transactionReversed', (e) => {
  markTransactionReversed(e.detail.transactionId);
});

window.addEventListener('auth:logout', () => {
  clearCurrentUser();
});

// ============================================================
// تصدير المتجر
// ============================================================

Object.assign(AppStore, {
  setState,
  getState,
  setCurrentUser,
  clearCurrentUser,
  setCurrentTab,
  addTransaction,
  updateTransaction,
  deleteTransaction,
  markTransactionReversed,
  refreshTransactions,
  setSelectedDate,
  setSelectedAgent,
  refreshData,
  setOnlineStatus,
  updateSyncQueueLength,
  setSyncRunning,
  addNotification,
  decrementUnreadCount,
  setKpiData,
  setKpiLoading,
});

window.AppStore = AppStore;

console.log('✅ AppStore.js محمّل — إدارة الحالة المركزية جاهزة');
