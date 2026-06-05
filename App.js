/**
 * App.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * التطبيق الرئيسي — التهيئة والتوجيه وبناء الهيكل
 *
 * المسؤوليات:
 * - تهيئة جميع الخدمات بالترتيب الصحيح
 * - بناء الهيدر وشريط التنقل
 * - إدارة التوجيه بين التبويبات
 * - إظهار/إخفاء الشاشات
 * - الاستماع لأحداث AppStore وتحديث الهيكل
 * - إدارة الوضع المظلم
 * - [المرحلة 3] تشغيل IdleTimer للمندوبين فقط
 */

'use strict';

// ============================================================
// متغيرات الهيكل العام
// ============================================================

let _headerEl   = null;
let _navEl      = null;
let _contentEl  = null;
let _dateTimer  = null;

// خريطة المكونات المحمَّلة (lazy loading)
const _loadedComponents = new Map();

// ============================================================
// نقطة الدخول الرئيسية
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 App.js: بدء تهيئة النظام...');

  try {
    // 1. تهيئة Dexie (قاعدة البيانات المحلية)
    const dexieResult = await initDexie();
    if (!isOk(dexieResult)) {
      _showFatalError('فشل فتح قاعدة البيانات المحلية. أعد تحميل الصفحة.');
      return;
    }

    // 2. تنظيف البيانات القديمة في الخلفية
    runStartupCleanup();

    // 3. تهيئة خدمة المزامنة
    SyncService.init();

    // 4. تهيئة مدير الوضع المظلم (مرة واحدة)
    if (window.ThemeManager) {
      ThemeManager.init();
    } else {
      console.warn('⚠️ ThemeManager غير موجود، استخدم fallback');
      _restoreDarkMode(); // fallback قديم
    }

    // 5. التحقق من جلسة نشطة
    const sessionResult = await AuthService.checkSession();

    if (isOk(sessionResult)) {
      // جلسة نشطة — دخول مباشر للتطبيق
      const { profile } = sessionResult.data;
      await _bootApp(profile);
    } else {
      // لا جلسة — عرض شاشة الدخول
      _showLoginScreen();
    }

  } catch (e) {
    console.error('❌ App.js: خطأ فادح في التهيئة:', e);
    _showFatalError(`خطأ في تهيئة النظام: ${e.message}`);
  }
});

// ============================================================
// تشغيل التطبيق بعد تسجيل الدخول
// ============================================================

/**
 * يُشغّل التطبيق الكامل بعد التحقق من هوية المستخدم
 * @param {object} profile - بيانات المستخدم من جدول users
 */
async function _bootApp(profile) {
  // إخفاء شاشة التحميل
  _hideLoadingScreen();

  // تعيين المستخدم في AppStore
  AppStore.setCurrentUser(profile);

  // ─── [المرحلة 3] إدارة IdleTimer بناءً على الدور ───
  if (window.IdleTimer) {
    if (profile.role === ROLES.AGENT) {
      // المندوب فقط: تشغيل مؤقت الخمول
      IdleTimer.start();
      console.log('⏱️  App.js: IdleTimer مُشغَّل للمندوب:', profile.display_name);
    } else {
      // المدير والمساعد: إيقاف المؤقت (في حال كان يعمل من جلسة سابقة)
      IdleTimer.stop();
    }
  }

  // بناء هيكل التطبيق
  _buildAppShell();

  // تحميل البيانات الأساسية
  await AppStore.refreshData();

  // الاستماع لأحداث AppStore
  _bindStoreEvents();

  // الانتقال للتبويب الأول المسموح
  const firstTab = AuthService.getAllowedTabs()[0];
  if (firstTab) {
    await _navigateTo(firstTab);
  }

  // تحديث التاريخ في الهيدر كل دقيقة
  _startDateClock();

  console.log(`✅ App.js: النظام جاهز — ${profile.display_name} (${profile.role})`);
}

// ============================================================
// بناء هيكل التطبيق (Shell)
// ============================================================

function _buildAppShell() {
  const root = document.getElementById('app-root');
  root.innerHTML = '';

  // --- الهيدر ---
  _headerEl = _buildHeader();
  root.appendChild(_headerEl);

  // --- شريط التنقل ---
  _navEl = _buildNav();
  root.appendChild(_navEl);

  // --- منطقة المحتوى ---
  _contentEl = document.createElement('main');
  _contentEl.id = 'app-content';
  _contentEl.className = 'app-content';
  root.appendChild(_contentEl);

  // تهيئة أيقونات Lucide
  if (window.lucide) lucide.createIcons();
}

// ============================================================
// بناء الهيدر
// ============================================================

function _buildHeader() {
  const user    = AppStore.getState('currentUser');
  const state   = AppStore.getState();
  const logoUrl = state.logoUrl;
  const accNum  = state.accountNumber;

  const header = document.createElement('header');
  header.id = 'app-header';
  header.className = 'app-header';

  // --- الجانب الأيمن: الشعار + العنوان ---
  const right = document.createElement('div');
  right.className = 'header-logo';

  // الشعار
  const logoWrap = document.createElement('div');
  if (logoUrl) {
    const img = document.createElement('img');
    img.src = logoUrl;
    img.alt = 'شعار النظام';
    img.className = 'header-logo img';
    img.onerror = () => { img.replaceWith(_buildLogoPlaceholder(user)); };
    logoWrap.appendChild(img);
  } else {
    logoWrap.appendChild(_buildLogoPlaceholder(user));
  }
  right.appendChild(logoWrap);

  // العنوان
  const title = document.createElement('span');
  title.className = 'header-title';
  title.textContent = APP_CONFIG.NAME_SHORT;
  right.appendChild(title);

  // رقم الحساب مع زر نسخ
  if (accNum) {
    const accBtn = document.createElement('div');
    accBtn.className = 'header-account-num';
    accBtn.title = 'انقر للنسخ';
    accBtn.innerHTML = `<span id="header-acc-num">${escapeHtml(accNum)}</span>
      <i data-lucide="copy" style="width:13px;height:13px"></i>`;
    accBtn.addEventListener('click', () => copyToClipboard(accNum, `رقم الحساب ${accNum} — تم النسخ`));
    right.appendChild(accBtn);
  }

  header.appendChild(right);

  // --- الوسط: معلومات المستخدم ---
  const center = document.createElement('div');
  center.className = 'header-user-info';
  center.innerHTML = `<strong>${escapeHtml(user?.display_name || '')}</strong>
    <span>${escapeHtml(ROLE_LABELS[user?.role] || '')}</span>`;
  header.appendChild(center);

  // --- التاريخ ---
  const dateEl = document.createElement('div');
  dateEl.id = 'header-date';
  dateEl.className = 'header-date';
  dateEl.textContent = formatDateArabic(getCurrentSaudiDate());
  header.appendChild(dateEl);

  // --- الجانب الأيسر: الأزرار ---
  const actions = document.createElement('div');
  actions.className = 'header-actions';

  // زر الإشعارات
  const notifBtn = document.createElement('button');
  notifBtn.id = 'header-notif-btn';
  notifBtn.className = 'header-icon-btn';
  notifBtn.title = 'الإشعارات';
  notifBtn.setAttribute('aria-label', 'الإشعارات');
  notifBtn.innerHTML = '<i data-lucide="bell" style="width:18px;height:18px"></i>';
  const notifBadge = document.createElement('span');
  notifBadge.id = 'notif-badge';
  notifBadge.className = 'notif-badge';
  notifBadge.style.display = 'none';
  notifBtn.appendChild(notifBadge);
  notifBtn.addEventListener('click', () => _navigateTo(TABS.NOTIFICATIONS));

  // زر المزامنة
  const syncBtn = document.createElement('button');
  syncBtn.id = 'header-sync-btn';
  syncBtn.className = 'header-icon-btn';
  syncBtn.title = 'مزامنة يدوية';
  syncBtn.setAttribute('aria-label', 'مزامنة');
  syncBtn.innerHTML = '<i data-lucide="refresh-cw" style="width:18px;height:18px"></i>';
  syncBtn.addEventListener('click', async () => {
    syncBtn.classList.add('animate-spin');
    syncBtn.disabled = true;
    await SyncService.manualSync();
    syncBtn.classList.remove('animate-spin');
    syncBtn.disabled = false;
  });

  // مؤشر حالة الاتصال
  const onlineDot = document.createElement('span');
  onlineDot.id = 'online-dot';
  onlineDot.className = `sync-dot ${navigator.onLine ? 'synced' : 'conflict'}`;
  onlineDot.title = navigator.onLine ? 'متصل' : 'غير متصل';

  // زر تسجيل الخروج
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'header-icon-btn';
  logoutBtn.title = 'تسجيل الخروج';
  logoutBtn.setAttribute('aria-label', 'تسجيل الخروج');
  logoutBtn.innerHTML = '<i data-lucide="log-out" style="width:18px;height:18px"></i>';
  logoutBtn.addEventListener('click', _handleLogout);

  actions.appendChild(onlineDot);
  actions.appendChild(notifBtn);
  actions.appendChild(syncBtn);
  actions.appendChild(logoutBtn);
  header.appendChild(actions);

  return header;
}

function _buildLogoPlaceholder(user) {
  const el = document.createElement('div');
  el.className = 'header-logo-placeholder';
  const initials = (user?.display_name || 'أ').charAt(0);
  el.textContent = initials;
  return el;
}

// ============================================================
// بناء شريط التنقل
// ============================================================

function _buildNav() {
  const nav = document.createElement('nav');
  nav.id = 'app-nav';
  nav.className = 'app-nav';
  nav.setAttribute('role', 'navigation');
  nav.setAttribute('aria-label', 'التبويبات الرئيسية');

  const tabs = AuthService.getAllowedTabs();

  tabs.forEach(tabId => {
    const label = TAB_LABELS[tabId] || tabId;
    const btn = document.createElement('button');
    btn.className = 'nav-tab';
    btn.dataset.tab = tabId;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    btn.textContent = label;
    btn.addEventListener('click', () => _navigateTo(tabId));
    nav.appendChild(btn);
  });

  return nav;
}

// ============================================================
// التوجيه بين التبويبات
// ============================================================

/**
 * ينتقل لتبويب محدد ويُحمّل مكوّنه
 * @param {string} tabId
 */
async function _navigateTo(tabId) {
  if (!AuthService.canAccessTab(tabId)) {
    showToast('لا تملك صلاحية الوصول لهذا التبويب', 'error');
    return;
  }

  // تحديث AppStore
  AppStore.setCurrentTab(tabId);

  // تحديث أزرار النافبار
  _updateNavHighlight(tabId);

  // تفريغ منطقة المحتوى مع أنيميشن
  if (_contentEl) {
    _contentEl.style.opacity = '0';
    _contentEl.style.transform = 'translateY(6px)';
    await sleep(120);
    _contentEl.innerHTML = '';
    _contentEl.style.opacity = '';
    _contentEl.style.transform = '';
    _contentEl.className = 'app-content animate-fade-in';
  }

  // عرض مؤشر تحميل مؤقت
  _showContentLoader();

  // تحميل وعرض المكوّن
  try {
    await _mountComponent(tabId);
  } catch (e) {
    console.error(`❌ App.js: خطأ في تحميل مكوّن ${tabId}:`, e);
    _contentEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <div class="empty-state-text">حدث خطأ في تحميل هذا التبويب</div>
    </div>`;
  }
}

/**
 * يُركّب المكوّن المناسب في منطقة المحتوى
 * @param {string} tabId
 */
async function _mountComponent(tabId) {
  if (!_contentEl) return;

  const componentMap = {
    [TABS.DASHBOARD]          : () => DashboardComponent?.render(_contentEl),
    [TABS.DATA_ENTRY]         : () => DataEntryComponent?.render(_contentEl),
    [TABS.DAILY_SUMMARY]      : () => DailySummaryComponent?.render(_contentEl),
    [TABS.BANK_ACCOUNTS]      : () => BankAccountsComponent?.render(_contentEl),
    [TABS.DEBTORS]            : () => DebtorsComponent?.render(_contentEl),
    [TABS.FAILED_DEPOSITS]    : () => FailedDepositsComponent?.render(_contentEl),
    [TABS.NOTIFICATIONS]      : () => NotificationsComponent?.render(_contentEl),
    [TABS.ALL_OPERATIONS]     : () => AllOperationsComponent?.render(_contentEl),
    [TABS.AUDIT_LOG]          : () => AuditLogComponent?.render(_contentEl),
    [TABS.USERS]              : () => UsersComponent?.render(_contentEl),
    [TABS.ACCOUNT_MANAGEMENT] : () => AccountManagementComponent?.render(_contentEl),
    [TABS.SETTINGS]           : () => SettingsComponent?.render(_contentEl),
  };

  const mountFn = componentMap[tabId];
  if (mountFn) {
    await mountFn();
    // تجديد أيقونات Lucide بعد تحميل المحتوى
    if (window.lucide) lucide.createIcons();
  } else {
    _contentEl.innerHTML = `<div class="empty-state">
      <div class="empty-state-icon">🚧</div>
      <div class="empty-state-text">هذا التبويب قيد التطوير</div>
    </div>`;
  }
}

function _showContentLoader() {
  if (!_contentEl) return;
  _contentEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;padding:60px 20px;">
      <div class="spinner spinner-dark"></div>
    </div>`;
}

function _updateNavHighlight(activeTab) {
  if (!_navEl) return;
  _navEl.querySelectorAll('.nav-tab').forEach(btn => {
    const isActive = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
}

// ============================================================
// الاستماع لأحداث AppStore
// ============================================================

function _bindStoreEvents() {
  // تغيير حالة الاتصال
  AppStore.addEventListener('store:onlineStatusChanged', (e) => {
    const { isOnline: online } = e.detail.state;
    const dot = document.getElementById('online-dot');
    if (dot) {
      dot.className = `sync-dot ${online ? 'synced' : 'conflict'}`;
      dot.title = online ? 'متصل' : 'غير متصل';
    }
  });

  // تغيير عدد الإشعارات
  AppStore.addEventListener('store:notificationsLoaded', (e) => {
    _updateNotifBadge(e.detail.state.unreadNotifCount);
  });

  AppStore.addEventListener('store:notificationAdded', (e) => {
    _updateNotifBadge(e.detail.state.unreadNotifCount);
  });

  // تغيير المستخدم
  AppStore.addEventListener('store:userChanged', (e) => {
    _updateHeaderUserInfo(e.detail.state);
  });

  // تغيير الشعار
  AppStore.addEventListener('store:settingsLoaded', (e) => {
    _updateHeaderLogo(e.detail.state.logoUrl);
  });

  // حالة المزامنة
  AppStore.addEventListener('store:syncStatusChanged', (e) => {
    _updateSyncIndicator(e.detail.state);
  });

  // تغيير التبويب النشط (من المكونات الداخلية)
  AppStore.addEventListener('store:tabChanged', (e) => {
    const { currentTab } = e.detail.state;
    if (currentTab) _updateNavHighlight(currentTab);
  });

  // تسجيل الخروج
  AppStore.addEventListener('store:userCleared', () => {
    _showLoginScreen();
  });
}

// ============================================================
// تحديث عناصر الهيدر ديناميكياً
// ============================================================

function _updateNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

function _updateHeaderUserInfo(state) {
  const userInfoEl = _headerEl?.querySelector('.header-user-info');
  if (userInfoEl && state.currentUser) {
    userInfoEl.innerHTML = `
      <strong>${escapeHtml(state.currentUser.display_name)}</strong>
      <span>${escapeHtml(ROLE_LABELS[state.currentUser.role] || '')}</span>`;
  }
}

function _updateHeaderLogo(logoUrl) {
  const logoWrap = _headerEl?.querySelector('.header-logo');
  if (!logoWrap) return;
  const existing = logoWrap.querySelector('img, .header-logo-placeholder');
  if (!existing) return;

  if (logoUrl) {
    const img = document.createElement('img');
    img.src = logoUrl;
    img.alt = 'شعار النظام';
    img.className = 'header-logo img';
    img.onerror = () => img.replaceWith(_buildLogoPlaceholder(AppStore.getState('currentUser')));
    existing.replaceWith(img);
  }
}

function _updateSyncIndicator(state) {
  const syncBtn = document.getElementById('header-sync-btn');
  if (!syncBtn) return;
  if (state.syncRunning) {
    syncBtn.querySelector('i')?.setAttribute('data-lucide', 'loader');
    syncBtn.title = `مزامنة (${state.syncQueueLength || 0} عملية)`;
  } else {
    syncBtn.querySelector('i')?.setAttribute('data-lucide', 'refresh-cw');
    syncBtn.title = 'مزامنة يدوية';
  }
  if (window.lucide) lucide.createIcons();
}

// ============================================================
// تسجيل الدخول / الخروج
// ============================================================

function _showLoginScreen() {
  // ─── [المرحلة 3] إيقاف IdleTimer عند العودة لشاشة الدخول ───
  if (window.IdleTimer) {
    IdleTimer.stop();
  }

  _hideLoadingScreen();
  _stopDateClock();

  const root = document.getElementById('app-root');
  root.innerHTML = '';

  if (window.LoginComponent) {
    LoginComponent.render(root, _onLoginSuccess);
  } else {
    root.innerHTML = '<div style="padding:40px;text-align:center">جاري التحميل...</div>';
  }
}

async function _onLoginSuccess(profile) {
  await _bootApp(profile);
}

async function _handleLogout() {
  // ─── [المرحلة 3] إيقاف IdleTimer قبل تسجيل الخروج ───
  if (window.IdleTimer) {
    IdleTimer.stop();
  }

  const confirmed = await confirmDialog(
    'هل تريد تسجيل الخروج من النظام؟',
    'خروج',
    'إلغاء',
    'warning'
  );
  if (!confirmed) {
    // إذا ألغى المستخدم الخروج، أعد تشغيل IdleTimer إن كان مندوباً
    const user = AuthService.getCurrentUser();
    if (window.IdleTimer && user?.role === ROLES.AGENT) {
      IdleTimer.start();
    }
    return;
  }

  SyncService.stop();
  _stopDateClock();
  await AuthService.logout();
}

// ============================================================
// شاشة التحميل الأولية
// ============================================================

function _hideLoadingScreen() {
  const loading = document.getElementById('app-loading');
  if (loading) {
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 400);
  }
}

function _showFatalError(msg) {
  _hideLoadingScreen();
  const root = document.getElementById('app-root');
  root.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                min-height:100vh;gap:16px;padding:20px;background:var(--bg-page)">
      <div style="font-size:3rem">⚠️</div>
      <h2 style="color:var(--danger);text-align:center">${escapeHtml(msg)}</h2>
      <button onclick="location.reload()" class="btn btn-primary">إعادة تحميل الصفحة</button>
    </div>`;
}

// ============================================================
// ساعة التاريخ في الهيدر
// ============================================================

function _startDateClock() {
  const update = () => {
    const el = document.getElementById('header-date');
    if (el) el.textContent = formatDateArabic(getCurrentSaudiDate());
  };
  update();
  // تحديث عند بداية كل دقيقة
  const now = new Date();
  const msToNextMin = (60 - now.getSeconds()) * 1000;
  setTimeout(() => {
    update();
    _dateTimer = setInterval(update, 60000);
  }, msToNextMin);
}

function _stopDateClock() {
  if (_dateTimer) {
    clearInterval(_dateTimer);
    _dateTimer = null;
  }
}

// ============================================================
// تصدير
// ============================================================

window.App = {
  navigateTo    : _navigateTo,
  bootApp       : _bootApp,
  onLoginSuccess: _onLoginSuccess,
};

// تصدير للاستخدام الداخلي من المكونات
window._appNavigateTo = _navigateTo;

console.log('✅ App.js محمّل — التطبيق الرئيسي جاهز (مع IdleTimer للمندوبين)');
