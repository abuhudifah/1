/**
 * App.js — v3.0
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * التغييرات في v3.0:
 * ✅ هيدر عصري محسَّن: شعار حقيقي من الإعدادات، ارتفاع أكبر، تصميم احترافي
 * ✅ إضافة QuickLoginBanner بعد _buildAppShell() مباشرة
 * ✅ تحديث last_login عند كل دخول
 * ✅ دعم تحديث الشعار في الهيدر فوراً عند حفظه من الإعدادات
 * ✅ تحسين مؤشر المزامنة وأزرار الهيدر
 */
'use strict';

let _headerEl  = null;
let _navEl     = null;
let _contentEl = null;
let _dateTimer = null;
let _dexieOk   = false;

let _activeComponentId = null;
const _loadedComponents = new Map();

// ============================================================
// نقطة الدخول
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 App.js v3.0: بدء تهيئة النظام...');

  try {
    // 1. Dexie
    try {
      if (typeof db === 'undefined') {
        console.warn('⚠️ App.js: db غير معرَّف — سيعمل النظام مع Supabase فقط');
        _scheduleDexieReopen();
      } else {
        const dexieResult = await initDexie();
        if (isOk(dexieResult)) {
          _dexieOk = true;
          console.log('✅ App.js: Dexie جاهزة');
          runStartupCleanup().catch(e => console.warn('⚠️ تنظيف Dexie:', e.message));
        } else {
          console.warn('⚠️ App.js: Dexie غير متاحة');
          _scheduleDexieReopen();
        }
      }
    } catch (dexieErr) {
      console.warn('⚠️ App.js: خطأ Dexie:', dexieErr.message);
      _scheduleDexieReopen();
    }

    // 2. مزامنة
    if (_dexieOk && window.SyncService) SyncService.init();

    // 3. الثيم
    if (window.ThemeManager) ThemeManager.init();
    else _restoreDarkMode();

    // 4. التحقق من الجلسة
    const sessionResult = await AuthService.checkSession();
    if (isOk(sessionResult)) {
      await _bootApp(sessionResult.data.profile);
    } else {
      _showLoginScreen();
    }

  } catch (e) {
    console.error('❌ App.js: خطأ فادح:', e);
    _showFatalError(`خطأ في تهيئة النظام: ${e.message}`);
  }
});

// ============================================================
// إعادة فتح Dexie في الخلفية
// ============================================================
function _scheduleDexieReopen() {
  setTimeout(async () => {
    try {
      if (typeof db === 'undefined') return;
      if (!db.isOpen()) {
        await db.open();
        _dexieOk = true;
        if (window.SyncService) SyncService.init();
      }
    } catch (e) {
      console.warn('⚠️ فشل إعادة فتح Dexie:', e.message);
    }
  }, 5000);
}

// ============================================================
// تشغيل التطبيق — _bootApp
// ============================================================
async function _bootApp(profile) {
  _hideLoadingScreen();
  AppStore.setCurrentUser(profile);

  if (window.IdleTimer) {
    const idleMs = profile.role === ROLES.AGENT
      ? IdleTimer.AGENT_IDLE_TIMEOUT_MS
      : IdleTimer.ADMIN_IDLE_TIMEOUT_MS;
    IdleTimer.start(idleMs);
  }

  // بناء الهيكل
  _buildAppShell();

  // ── تحديث last_login في الخلفية ──
  if (isOnline && isOnline()) {
    supabaseClient
      .from(TABLES.USERS)
      .update({ last_login: new Date().toISOString() })
      .eq('id', profile.id)
      .then(() => console.log('✅ last_login محدَّث'))
      .catch(e => console.warn('⚠️ last_login:', e.message));
  }

  await AppStore.refreshData();
  _bindStoreEvents();

  const firstTab = AuthService.getAllowedTabs()[0];
  if (firstTab) await _navigateTo(firstTab);

  _startDateClock();

  // ── إشعار الدخول السريع (بعد بناء الواجهة) ──
  if (window.QuickLoginBanner) {
    setTimeout(() => QuickLoginBanner.maybeShow(profile), 900);
  }

  console.log(`✅ App.js v3.0: جاهز — ${profile.display_name} (${profile.role})`);
}

// ============================================================
// بناء هيكل التطبيق
// ============================================================
function _buildAppShell() {
  const root = document.getElementById('app-root');
  root.innerHTML = '';

  _headerEl  = _buildHeader();
  _navEl     = _buildNav();
  _contentEl = document.createElement('main');
  _contentEl.id        = 'app-content';
  _contentEl.className = 'app-content';

  root.appendChild(_headerEl);
  root.appendChild(_navEl);
  root.appendChild(_contentEl);

  if (window.lucide) lucide.createIcons();
}

// ============================================================
// الهيدر المُحسَّن — v3.0
// ============================================================
function _buildHeader() {
  const user    = AppStore.getState('currentUser');
  const state   = AppStore.getState();
  const logoUrl = state.logoUrl;
  const accNum  = state.accountNumber;

  const header = document.createElement('header');
  header.id        = 'app-header';
  header.className = 'app-header';

  // ════════════════════════════════════════
  // الجانب الأيمن: الشعار + اسم النظام + التاريخ
  // ════════════════════════════════════════
  const rightSection = document.createElement('div');
  rightSection.className = 'header-right';

  // منطقة الشعار
  const logoArea = document.createElement('div');
  logoArea.className = 'header-logo-area';

  if (logoUrl) {
    const logoImg = document.createElement('img');
    logoImg.id          = 'header-logo-img';
    logoImg.src         = logoUrl;
    logoImg.alt         = 'شعار الشركة';
    logoImg.className   = 'header-logo-img';
    logoArea.appendChild(logoImg);
  } else {
    // شعار افتراضي — أيقونة النظام
    const logoPlaceholder = document.createElement('div');
    logoPlaceholder.id        = 'header-logo-placeholder';
    logoPlaceholder.className = 'header-logo-placeholder';
    logoPlaceholder.innerHTML = `
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
        <rect width="36" height="36" rx="10" fill="url(#logoGrad)"/>
        <text x="18" y="25" text-anchor="middle" fill="white" font-size="18" font-weight="800"
          font-family="system-ui,sans-serif">أ</text>
        <defs>
          <linearGradient id="logoGrad" x1="0" y1="0" x2="36" y2="36">
            <stop offset="0%" stop-color="#6366f1"/>
            <stop offset="100%" stop-color="#4f46e5"/>
          </linearGradient>
        </defs>
      </svg>`;
    logoArea.appendChild(logoPlaceholder);
  }
  rightSection.appendChild(logoArea);

  // اسم النظام + التاريخ
  const titleArea = document.createElement('div');
  titleArea.className = 'header-title-area';
  titleArea.innerHTML = `
    <div class="header-app-name">${escapeHtml(APP_CONFIG.NAME_SHORT || 'أبو حذيفة')}</div>
    <div class="header-date-line" id="header-date"></div>`;
  rightSection.appendChild(titleArea);

  header.appendChild(rightSection);

  // ════════════════════════════════════════
  // الوسط: بيانات المستخدم (الاسم + الدور + رقم الحساب)
  // ════════════════════════════════════════
  const centerSection = document.createElement('div');
  centerSection.className = 'header-center';

  const roleIcons = { admin: '👑', admin_assistant: '🛡️', agent: '👤' };
  const roleIcon  = roleIcons[user?.role] || '👤';
  const roleLabel = ROLE_LABELS[user?.role] || user?.role || '';

  centerSection.innerHTML = `
    <div class="header-user-avatar">
      ${escapeHtml((user?.display_name || '?').charAt(0).toUpperCase())}
    </div>
    <div class="header-user-info">
      <div class="header-user-name">${escapeHtml(user?.display_name || '')}</div>
      <div class="header-user-meta">
        <span class="header-role-badge">${roleIcon} ${escapeHtml(roleLabel)}</span>
        ${accNum ? `<span class="header-acc-num" title="رقم حسابك">${escapeHtml(accNum)}</span>` : ''}
      </div>
    </div>`;
  header.appendChild(centerSection);

  // ════════════════════════════════════════
  // الجانب الأيسر: أدوات (مزامنة + ثيم + إشعارات + خروج)
  // ════════════════════════════════════════
  const leftSection = document.createElement('div');
  leftSection.className = 'header-left';

  // مؤشر المزامنة
  const syncBtn = document.createElement('button');
  syncBtn.id        = 'sync-indicator';
  syncBtn.className = 'header-sync-btn';
  syncBtn.title     = 'حالة المزامنة — انقر للمزامنة اليدوية';
  syncBtn.innerHTML = `
    <div id="sync-dot" class="sync-dot synced"></div>
    <span id="sync-label" class="sync-label">متزامن</span>
    <span id="sync-count" class="sync-count" style="display:none;"></span>`;
  syncBtn.addEventListener('click', () => SyncService?.manualSync?.());
  leftSection.appendChild(syncBtn);

  // زر الثيم
  const themeBtn = document.createElement('button');
  themeBtn.id        = 'theme-toggle-btn';
  themeBtn.className = 'header-icon-btn';
  themeBtn.title     = 'تبديل الوضع المظلم/الفاتح';
  themeBtn.innerHTML = `<i data-lucide="moon" style="width:17px;height:17px;"></i>`;
  themeBtn.addEventListener('click', () => {
    const isDark = window.ThemeManager
      ? ThemeManager.toggle()
      : document.body.classList.toggle('dark-mode');
    localStorage.setItem('abu_theme', isDark ? 'dark' : 'light');
    themeBtn.innerHTML = isDark
      ? `<i data-lucide="sun"  style="width:17px;height:17px;"></i>`
      : `<i data-lucide="moon" style="width:17px;height:17px;"></i>`;
    if (window.lucide) lucide.createIcons();
    showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
  });
  leftSection.appendChild(themeBtn);

  // زر الإشعارات
  if (AuthService.canAccessTab(TABS.NOTIFICATIONS)) {
    const notifBtn = document.createElement('button');
    notifBtn.id        = 'notif-btn';
    notifBtn.className = 'header-icon-btn';
    notifBtn.title     = 'الإشعارات';
    notifBtn.innerHTML = `
      <i data-lucide="bell" style="width:17px;height:17px;"></i>
      <span id="notif-badge" class="notif-badge" style="display:none;"></span>`;
    notifBtn.addEventListener('click', () => _navigateTo(TABS.NOTIFICATIONS));
    leftSection.appendChild(notifBtn);
  }

  // زر تسجيل الخروج
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'header-icon-btn header-logout-btn';
  logoutBtn.title     = 'تسجيل الخروج';
  logoutBtn.innerHTML = `<i data-lucide="log-out" style="width:17px;height:17px;"></i>`;
  logoutBtn.addEventListener('click', _handleLogout);
  leftSection.appendChild(logoutBtn);

  header.appendChild(leftSection);

  // حقن CSS الهيدر
  _injectHeaderStyles();

  return header;
}

// ============================================================
// CSS الهيدر المُحسَّن
// ============================================================
function _injectHeaderStyles() {
  if (document.getElementById('app-header-v3-styles')) return;
  const style = document.createElement('style');
  style.id = 'app-header-v3-styles';
  style.textContent = `
    /* ── الهيدر الرئيسي ── */
    #app-header.app-header {
      position         : fixed;
      top              : 0;
      right            : 0;
      left             : 0;
      height           : 68px;
      display          : flex;
      align-items      : center;
      justify-content  : space-between;
      padding          : 0 20px;
      gap              : 16px;
      z-index          : 1000;
      background       : var(--primary, #2563eb);
      background       : linear-gradient(135deg, var(--primary, #2563eb) 0%, #4f46e5 100%);
      box-shadow       : 0 2px 20px rgba(37,99,235,.35), 0 1px 0 rgba(255,255,255,.08) inset;
      border-bottom    : 1px solid rgba(255,255,255,.10);
    }

    /* ── الجانب الأيمن ── */
    .header-right {
      display    : flex;
      align-items: center;
      gap        : 12px;
      flex-shrink: 0;
    }

    .header-logo-area {
      display    : flex;
      align-items: center;
      flex-shrink: 0;
    }

    .header-logo-img {
      height       : 44px;
      width        : auto;
      max-width    : 120px;
      object-fit   : contain;
      border-radius: 8px;
      filter       : drop-shadow(0 2px 6px rgba(0,0,0,.25));
      transition   : transform .2s;
    }
    .header-logo-img:hover { transform: scale(1.04); }

    .header-logo-placeholder {
      width        : 44px;
      height       : 44px;
      border-radius: 12px;
      display      : flex;
      align-items  : center;
      justify-content: center;
      filter       : drop-shadow(0 2px 8px rgba(0,0,0,.20));
    }

    .header-title-area {
      display       : flex;
      flex-direction: column;
      gap           : 1px;
    }

    .header-app-name {
      font-size  : 1.05rem;
      font-weight: 800;
      color      : #fff;
      line-height: 1.2;
      letter-spacing: -.01em;
    }

    .header-date-line {
      font-size : .72rem;
      color     : rgba(255,255,255,.65);
      white-space: nowrap;
    }

    /* ── الوسط: بيانات المستخدم ── */
    .header-center {
      display    : flex;
      align-items: center;
      gap        : 10px;
      flex       : 1;
      justify-content: center;
    }

    @media (max-width: 600px) {
      .header-center { display: none; }
    }

    .header-user-avatar {
      width          : 38px;
      height         : 38px;
      border-radius  : 50%;
      background     : rgba(255,255,255,.18);
      border         : 2px solid rgba(255,255,255,.35);
      display        : flex;
      align-items    : center;
      justify-content: center;
      font-size      : 1rem;
      font-weight    : 800;
      color          : #fff;
      flex-shrink    : 0;
      letter-spacing : -.02em;
    }

    .header-user-info {
      display       : flex;
      flex-direction: column;
      gap           : 3px;
    }

    .header-user-name {
      font-size  : .9rem;
      font-weight: 700;
      color      : #fff;
      line-height: 1;
    }

    .header-user-meta {
      display    : flex;
      align-items: center;
      gap        : 6px;
    }

    .header-role-badge {
      font-size    : .71rem;
      color        : rgba(255,255,255,.8);
      background   : rgba(255,255,255,.12);
      border       : 1px solid rgba(255,255,255,.18);
      border-radius: 20px;
      padding      : 1px 7px;
      white-space  : nowrap;
    }

    .header-acc-num {
      font-size    : .71rem;
      color        : rgba(255,255,255,.7);
      font-family  : monospace;
      background   : rgba(0,0,0,.15);
      border-radius: 4px;
      padding      : 1px 6px;
      cursor       : default;
    }

    /* ── الجانب الأيسر: أدوات ── */
    .header-left {
      display    : flex;
      align-items: center;
      gap        : 6px;
      flex-shrink: 0;
    }

    .header-icon-btn {
      width           : 40px;
      height          : 40px;
      border-radius   : 11px;
      background      : rgba(255,255,255,.10);
      border          : 1px solid rgba(255,255,255,.14);
      color           : rgba(255,255,255,.85);
      display         : flex;
      align-items     : center;
      justify-content : center;
      cursor          : pointer;
      transition      : all .15s;
      position        : relative;
    }
    .header-icon-btn:hover {
      background : rgba(255,255,255,.20);
      color      : #fff;
      transform  : translateY(-1px);
      box-shadow : 0 4px 12px rgba(0,0,0,.15);
    }
    .header-logout-btn:hover {
      background: rgba(239,68,68,.25) !important;
      border-color: rgba(239,68,68,.4) !important;
    }

    .notif-badge {
      position     : absolute;
      top          : 5px;
      left         : 5px;
      min-width    : 17px;
      height       : 17px;
      border-radius: 9px;
      background   : #ef4444;
      color        : #fff;
      font-size    : .62rem;
      font-weight  : 700;
      display      : flex;
      align-items  : center;
      justify-content: center;
      border       : 2px solid var(--primary, #2563eb);
      padding      : 0 3px;
    }

    /* ── مؤشر المزامنة ── */
    .header-sync-btn {
      display      : flex;
      align-items  : center;
      gap          : 5px;
      padding      : 6px 10px;
      border-radius: 10px;
      background   : rgba(255,255,255,.10);
      border       : 1px solid rgba(255,255,255,.14);
      color        : rgba(255,255,255,.80);
      cursor       : pointer;
      font-size    : .74rem;
      font-family  : inherit;
      transition   : all .15s;
      white-space  : nowrap;
    }
    .header-sync-btn:hover {
      background: rgba(255,255,255,.18);
      color     : #fff;
    }

    .sync-dot {
      width        : 8px;
      height       : 8px;
      border-radius: 50%;
      flex-shrink  : 0;
      transition   : background .3s;
    }
    .sync-dot.synced  { background: #4ade80; }
    .sync-dot.pending { background: #fbbf24; animation: syncPulse 1.2s ease-in-out infinite; }
    .sync-dot.error   { background: #f87171; }

    @keyframes syncPulse {
      0%,100% { opacity:1; transform:scale(1); }
      50%     { opacity:.6; transform:scale(1.3); }
    }

    .sync-label { color: rgba(255,255,255,.80); font-size:.74rem; }
    .sync-count {
      background   : #fbbf24;
      color        : #1e1b4b;
      border-radius: 10px;
      padding      : 1px 6px;
      font-size    : .65rem;
      font-weight  : 700;
    }

    /* ── تعديل ارتفاع Nav ── */
    .app-nav {
      top: 68px !important;
    }

    /* ── تعديل ارتفاع المحتوى ── */
    .app-content {
      margin-top: calc(68px + var(--nav-height, 52px)) !important;
    }
  `;
  document.head.appendChild(style);
}

// ============================================================
// شريط التنقل
// ============================================================
function _buildNav() {
  const tabs = AuthService.getAllowedTabs();
  const nav  = document.createElement('nav');
  nav.id        = 'app-nav';
  nav.className = 'app-nav';
  nav.style.overflowX = 'auto';

  const icons = {
    dashboard           : 'layout-dashboard',
    'data-entry'        : 'pencil-line',
    'daily-summary'     : 'file-bar-chart',
    'bank-accounts'     : 'landmark',
    debtors             : 'users',
    'failed-deposits'   : 'alert-circle',
    notifications       : 'bell',
    'all-operations'    : 'list',
    'audit-log'         : 'shield-check',
    users               : 'user-cog',
    'account-management': 'book-open',
    settings            : 'settings',
  };

  tabs.forEach(tabId => {
    const btn = document.createElement('button');
    btn.id        = `nav-tab-${tabId}`;
    btn.className = 'nav-tab';
    btn.dataset.tab = tabId;
    btn.setAttribute('aria-selected', 'false');

    const label = TAB_LABELS[tabId] || tabId;
    const icon  = icons[tabId] || 'circle';

    btn.innerHTML = `
      <i data-lucide="${icon}" style="width:15px;height:15px;"></i>
      <span style="font-size:0.80rem;">${escapeHtml(label)}</span>`;
    btn.addEventListener('click', () => _navigateTo(tabId));
    nav.appendChild(btn);
  });

  return nav;
}

// ============================================================
// التنقل بين التبويبات
// ============================================================
async function _navigateTo(tabId) {
  const activeResult = await AuthService.verifyIsActive();
  if (!isOk(activeResult)) {
    showToast('تم تعطيل حسابك. يرجى التواصل مع المدير.', 'error');
    await AuthService.logout();
    _showLoginScreen();
    return;
  }

  if (!AuthService.canAccessTab(tabId)) {
    showToast('لا تملك صلاحية الوصول لهذا التبويب', 'error');
    return;
  }

  AppStore.setCurrentTab(tabId);
  _updateNavHighlight(tabId);
  _destroyActiveComponent();
  _activeComponentId = tabId;
  _showContentLoader();

  const componentMap = {
    [TABS.DASHBOARD]           : () => DashboardComponent?.render(_contentEl),
    [TABS.DATA_ENTRY]          : () => DataEntryComponent?.render(_contentEl),
    [TABS.DAILY_SUMMARY]       : () => DailySummaryComponent?.render(_contentEl),
    [TABS.BANK_ACCOUNTS]       : () => BankAccountsComponent?.render(_contentEl),
    [TABS.DEBTORS]             : () => DebtorsComponent?.render(_contentEl),
    [TABS.FAILED_DEPOSITS]     : () => FailedDepositsComponent?.render(_contentEl),
    [TABS.NOTIFICATIONS]       : () => NotificationsComponent?.render(_contentEl),
    [TABS.ALL_OPERATIONS]      : () => AllOperationsComponent?.render(_contentEl),
    [TABS.AUDIT_LOG]           : () => AuditLogComponent?.render(_contentEl),
    [TABS.USERS]               : () => UsersComponent?.render(_contentEl),
    [TABS.ACCOUNT_MANAGEMENT]  : () => AccountManagementComponent?.render(_contentEl),
    [TABS.SETTINGS]            : () => SettingsComponent?.render(_contentEl),
  };

  const renderer = componentMap[tabId];
  if (renderer) await renderer();
  if (window.lucide) lucide.createIcons();
}

function _updateNavHighlight(activeTabId) {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    const isActive = btn.dataset.tab === activeTabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
  });
}

function _showContentLoader() {
  if (!_contentEl) return;
  _contentEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:center;
      min-height:200px;flex-direction:column;gap:12px;">
      <div class="spinner spinner-dark"></div>
      <p style="color:var(--text-muted);font-size:0.82rem;">جاري التحميل...</p>
    </div>`;
}

// ============================================================
// تنظيف المكوّن النشط
// ============================================================
function _destroyActiveComponent() {
  if (!_activeComponentId) return;

  const componentMap = {
    [TABS.DASHBOARD]           : 'DashboardComponent',
    [TABS.DATA_ENTRY]          : 'DataEntryComponent',
    [TABS.DAILY_SUMMARY]       : 'DailySummaryComponent',
    [TABS.BANK_ACCOUNTS]       : 'BankAccountsComponent',
    [TABS.DEBTORS]             : 'DebtorsComponent',
    [TABS.FAILED_DEPOSITS]     : 'FailedDepositsComponent',
    [TABS.NOTIFICATIONS]       : 'NotificationsComponent',
    [TABS.ALL_OPERATIONS]      : 'AllOperationsComponent',
    [TABS.AUDIT_LOG]           : 'AuditLogComponent',
    [TABS.USERS]               : 'UsersComponent',
    [TABS.ACCOUNT_MANAGEMENT]  : 'AccountManagementComponent',
    [TABS.SETTINGS]            : 'SettingsComponent',
  };

  const name = componentMap[_activeComponentId];
  if (name && window[name]?.destroy) {
    try { window[name].destroy(); } catch (e) {
      console.warn(`⚠️ destroy() لـ ${name}:`, e.message);
    }
  }
  _activeComponentId = null;
}

// ============================================================
// ربط أحداث AppStore
// ============================================================
function _bindStoreEvents() {
  AppStore.addEventListener('store:settingsLoaded', () => {
    _updateHeaderLogo();
  });

  AppStore.addEventListener('store:syncStatusChanged', (e) => {
    const { syncRunning, syncQueueLength } = e.detail.state;
    const dot   = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    const count = document.getElementById('sync-count');
    if (!dot) return;

    if (syncRunning) {
      dot.className   = 'sync-dot pending';
      if (label) label.textContent = 'مزامنة...';
    } else if (syncQueueLength > 0) {
      dot.className   = 'sync-dot pending';
      if (label) label.textContent = 'معلق';
      if (count) { count.textContent = String(syncQueueLength); count.style.display = 'flex'; }
    } else {
      dot.className   = 'sync-dot synced';
      if (label) label.textContent = 'متزامن';
      if (count) count.style.display = 'none';
    }
  });

  AppStore.addEventListener('store:syncQueueChanged', (e) => {
    const { syncQueueLength } = e.detail.state;
    const count = document.getElementById('sync-count');
    if (count) {
      count.style.display = syncQueueLength > 0 ? 'flex' : 'none';
      count.textContent   = String(syncQueueLength);
    }
  });

  AppStore.addEventListener('store:notifCountChanged', (e) => {
    const unreadNotifCount = e.detail.state.unreadNotifCount;
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.style.display = unreadNotifCount > 0 ? 'flex' : 'none';
      badge.textContent   = unreadNotifCount > 9 ? '9+' : String(unreadNotifCount);
    }
  });

  AppStore.addEventListener('store:userCleared', () => {
    _showLoginScreen();
  });
}

// ============================================================
// تحديث الشعار في الهيدر (يُستدعى عند تغيير الإعدادات)
// ============================================================
function _updateHeaderLogo() {
  const logoUrl   = AppStore.getState('logoUrl');
  const logoArea  = document.querySelector('.header-logo-area');
  if (!logoArea) return;

  logoArea.innerHTML = '';

  if (logoUrl) {
    const img = document.createElement('img');
    img.id        = 'header-logo-img';
    img.src       = logoUrl;
    img.alt       = 'شعار الشركة';
    img.className = 'header-logo-img';
    logoArea.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.id        = 'header-logo-placeholder';
    placeholder.className = 'header-logo-placeholder';
    placeholder.innerHTML = `
      <svg viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
        <rect width="36" height="36" rx="10" fill="url(#lg2)"/>
        <text x="18" y="25" text-anchor="middle" fill="white" font-size="18" font-weight="800"
          font-family="system-ui,sans-serif">أ</text>
        <defs>
          <linearGradient id="lg2" x1="0" y1="0" x2="36" y2="36">
            <stop offset="0%" stop-color="#6366f1"/>
            <stop offset="100%" stop-color="#4f46e5"/>
          </linearGradient>
        </defs>
      </svg>`;
    logoArea.appendChild(placeholder);
  }
}

// ============================================================
// الشاشات
// ============================================================
function _showLoginScreen() {
  if (window.IdleTimer) IdleTimer.stop();
  _hideLoadingScreen();
  _stopDateClock();
  _destroyActiveComponent();

  const root = document.getElementById('app-root');
  root.innerHTML = '';

  if (window.LoginComponent) {
    LoginComponent.render(root, _onLoginSuccess);
  }
}

async function _onLoginSuccess(profile) {
  await _bootApp(profile);
}

async function _handleLogout() {
  if (window.IdleTimer) IdleTimer.stop();

  const confirmed = await confirmDialog(
    'هل تريد تسجيل الخروج من النظام؟',
    'خروج', 'إلغاء', 'warning'
  );
  if (!confirmed) {
    const user = AuthService.getCurrentUser();
    if (window.IdleTimer && user) {
      const idleMs = user.role === ROLES.AGENT
        ? IdleTimer.AGENT_IDLE_TIMEOUT_MS
        : IdleTimer.ADMIN_IDLE_TIMEOUT_MS;
      IdleTimer.start(idleMs);
    }
    return;
  }

  _destroyActiveComponent();
  SyncService?.stop?.();

  const result = await AuthService.logout();
  if (isOk(result)) {
    _stopDateClock();
    _showLoginScreen();
  } else {
    showToast(`خطأ في تسجيل الخروج: ${result.error}`, 'error');
  }
}

// ============================================================
// ساعة التاريخ
// ============================================================
function _startDateClock() {
  const update = () => {
    const el = document.getElementById('header-date');
    if (el) el.textContent = formatDateArabic(getCurrentSaudiDate());
  };
  update();
  const now         = new Date();
  const msToNextMin = (60 - now.getSeconds()) * 1000;
  setTimeout(() => {
    update();
    _dateTimer = setInterval(update, 60000);
  }, msToNextMin);
}

function _stopDateClock() {
  if (_dateTimer) { clearInterval(_dateTimer); _dateTimer = null; }
}

// ============================================================
// الوضع المظلم (Fallback)
// ============================================================
function _restoreDarkMode() {
  try {
    const saved = localStorage.getItem('abu_theme');
    if (saved === 'dark') document.body.classList.add('dark-mode');
  } catch {}
}

// ============================================================
// الشاشات المساعدة
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
      <div style="font-size:3rem;">⚠️</div>
      <h2 style="color:var(--danger);text-align:center;">${escapeHtml(msg)}</h2>
      <button onclick="location.reload()" class="btn btn-primary">إعادة تحميل الصفحة</button>
    </div>`;
}

// ============================================================
// تصدير
// ============================================================
window.App             = { navigateTo: _navigateTo, bootApp: _bootApp, onLoginSuccess: _onLoginSuccess };
window._appNavigateTo  = _navigateTo;
window._updateHeaderLogo = _updateHeaderLogo;

console.log('✅ App.js v3.0 — هيدر محسَّن + QuickLoginBanner + last_login');
