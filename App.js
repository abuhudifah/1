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

let _activeComponentId  = null;
let _storeEventsBound   = false;
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
  _buildOfflineBanner();

  // ── تحديث last_login في الخلفية ──
  if (!isOfflineMode() && isOnline()) {
    supabaseClient
      .from(TABLES.USERS)
      .update({ last_login: new Date().toISOString() })
      .eq('id', profile.id)
      .then(() => console.log('✅ last_login محدَّث'))
      .catch(e => console.warn('⚠️ last_login:', e.message));
  }

  await AppStore.refreshData();
  _bindStoreEvents();
  _startCommandsWatcher(); // مراقبة أوامر النظام (RESET_ALL_DATA وغيرها)
  _updateSyncWidget(); // العرض الأولي لـ widget العمليات المعلقة
  _startNotificationsRealtime(profile); // اشتراك Realtime للإشعارات

  const firstTab = AuthService.getAllowedTabs()[0];
  if (firstTab) await _navigateTo(firstTab);

  _startDateClock();

  // ── اختصارات لوحة المفاتيح ──
  initKeyboardShortcuts();

  // ── إشعار الدخول السريع (بعد بناء الواجهة) ──
  if (window.QuickLoginBanner) {
    setTimeout(() => QuickLoginBanner.maybeShow(profile), 900);
  }

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

  // حساب التداخل + التحسينات الآمنة بعد بناء الـ DOM مباشرة
  requestAnimationFrame(() => {
    _fixHeaderOverlap();
    let _resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(_resizeTimer);
      _resizeTimer = setTimeout(_fixHeaderOverlap, 80);
    }, { passive: true });
    _initSafeEnhancements(); // T2–T4 — آمن تماماً
  });

  // ── scroll → .scrolled على الهيدر + زر الرجوع للأعلى ──
  const scrollTopBtn = document.createElement('button');
  scrollTopBtn.id        = 'scroll-to-top';
  scrollTopBtn.title     = 'رجوع للأعلى';
  scrollTopBtn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="18 15 12 9 6 15"/>
  </svg>`;
  scrollTopBtn.addEventListener('click', () =>
    window.scrollTo({ top: 0, behavior: 'smooth' })
  );
  document.body.appendChild(scrollTopBtn);

  const onScroll = () => {
    _headerEl.classList.toggle('scrolled', window.scrollY > 8);
    scrollTopBtn.classList.toggle('visible', window.scrollY > 300);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // ── Ripple Effect على كل الأزرار ──
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('.btn');
    if (!btn || btn.disabled) return;
    const rect   = btn.getBoundingClientRect();
    const size   = Math.max(rect.width, rect.height) * 1.8;
    const ripple = document.createElement('span');
    ripple.className = 'btn-ripple';
    ripple.style.cssText = `
      width:${size}px;height:${size}px;
      top:${e.clientY - rect.top - size/2}px;
      left:${e.clientX - rect.left - size/2}px;`;
    btn.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
  }, { passive: true });
}

// ============================================================
// الهيدر — تصميم أفقي ثلاثي الأقسام v6.0
// ============================================================
function _buildHeader() {
  const user    = AppStore.getState('currentUser');
  const state   = AppStore.getState();
  const logoUrl = state.logoUrl;

  const header = document.createElement('header');
  header.id        = 'app-header';
  header.className = 'app-header';

  // ══════════════════════════════════════
  // اليمين: العلامة التجارية (شعار + اسم)
  // ══════════════════════════════════════
  const brand = document.createElement('div');
  brand.className = 'header-brand';

  const logoArea = document.createElement('div');
  logoArea.className = 'header-logo-area';

  if (logoUrl) {
    const logoImg = document.createElement('img');
    logoImg.id = 'header-logo-img'; logoImg.src = logoUrl;
    logoImg.alt = 'شعار الشركة'; logoImg.className = 'header-logo-img';
    logoArea.appendChild(logoImg);
  } else {
    const ph = document.createElement('div');
    ph.id = 'header-logo-placeholder'; ph.className = 'header-logo-placeholder';
    ph.innerHTML = `
      <svg viewBox="0 0 48 48" fill="none" width="48" height="48">
        <rect width="48" height="48" rx="14" fill="url(#hLg6)"/>
        <text x="24" y="33" text-anchor="middle" fill="white" font-size="24" font-weight="800"
          font-family="system-ui,sans-serif">أ</text>
        <defs>
          <linearGradient id="hLg6" x1="0" y1="0" x2="48" y2="48">
            <stop offset="0%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#d97706"/>
          </linearGradient>
        </defs>
      </svg>`;
    logoArea.appendChild(ph);
  }
  brand.appendChild(logoArea);

  const brandText = document.createElement('div');
  brandText.className = 'header-brand-text';
  brandText.innerHTML = `
    <div class="header-brand-name">${escapeHtml(APP_CONFIG?.NAME || 'أبو حذيفة')}</div>
    <div class="header-brand-sub">للصرافة والتحويلات</div>`;
  brand.appendChild(brandText);
  header.appendChild(brand);

  // ══════════════════════════════════════
  // الوسط: معلومات المستخدم
  // ══════════════════════════════════════
  const userCenter = document.createElement('div');
  userCenter.className = 'header-user-center';

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || '';
  const nameInitial = (user?.display_name || 'U').charAt(0);

  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'header-avatar-wrap';
  avatarWrap.innerHTML = `
    <div class="header-avatar">${escapeHtml(nameInitial)}</div>
    <div class="header-online-dot"></div>`;
  userCenter.appendChild(avatarWrap);

  const userInfo = document.createElement('div');
  userInfo.className = 'header-user-info-center';
  userInfo.innerHTML = `
    <div class="header-user-greeting">مرحباً، ${escapeHtml(user?.display_name || '')}</div>
    <div class="header-user-role-tag">${escapeHtml(roleLabel)}</div>`;
  userCenter.appendChild(userInfo);

  header.appendChild(userCenter);

  // ══════════════════════════════════════
  // اليسار: أزرار الإجراءات
  // ══════════════════════════════════════
  const actions = document.createElement('div');
  actions.className = 'header-actions';

  // زر الإشعارات
  const notifBtn = document.createElement('button');
  notifBtn.id        = 'notif-btn';
  notifBtn.className = 'header-action-btn' + (AuthService.canAccessTab(TABS.NOTIFICATIONS) ? '' : ' header-action-btn--hidden');
  notifBtn.title     = 'الإشعارات';
  notifBtn.setAttribute('aria-label', 'الإشعارات');
  notifBtn.innerHTML = `
    <div class="header-action-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span id="notif-badge" class="notif-badge" style="display:none;"></span>
    </div>
    <span class="header-action-label">الإشعارات</span>`;
  if (AuthService.canAccessTab(TABS.NOTIFICATIONS)) {
    notifBtn.addEventListener('click', () => _navigateTo(TABS.NOTIFICATIONS));
  }
  actions.appendChild(notifBtn);

  // زر الثيم
  const isDarkNow = document.body.classList.contains('dark-mode');
  const themeBtn = document.createElement('button');
  themeBtn.id        = 'theme-toggle-btn';
  themeBtn.className = 'header-action-btn';
  themeBtn.title     = 'تبديل المظهر';
  themeBtn.setAttribute('aria-label', isDarkNow ? 'التبديل إلى الوضع الفاتح' : 'التبديل إلى الوضع الليلي');
  themeBtn.innerHTML = `
    <div class="header-action-icon">${_themeIcon(isDarkNow)}</div>
    <span class="header-action-label">${isDarkNow ? 'الوضع الفاتح' : 'الوضع الليلي'}</span>`;
  themeBtn.addEventListener('click', () => {
    const isDark = window.ThemeManager
      ? ThemeManager.toggle()
      : document.body.classList.toggle('dark-mode');
    localStorage.setItem('abu_theme', isDark ? 'dark' : 'light');
    themeBtn.querySelector('.header-action-icon').innerHTML = _themeIcon(isDark);
    themeBtn.querySelector('.header-action-label').textContent = isDark ? 'الوضع الفاتح' : 'الوضع الليلي';
    showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
  });
  actions.appendChild(themeBtn);

  // زر الخروج
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'header-action-btn header-action-btn--logout';
  logoutBtn.title     = 'تسجيل الخروج';
  logoutBtn.setAttribute('aria-label', 'تسجيل الخروج');
  logoutBtn.innerHTML = `
    <div class="header-action-icon">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
        stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
        <polyline points="16 17 21 12 16 7"/>
        <line x1="21" y1="12" x2="9" y2="12"/>
      </svg>
    </div>
    <span class="header-action-label">تسجيل الخروج</span>`;
  logoutBtn.addEventListener('click', _handleLogout);
  actions.appendChild(logoutBtn);

  // مؤشر حالة الاتصال (Online / Offline)
  const connPill = document.createElement('div');
  connPill.id        = 'conn-status-pill';
  connPill.className = 'header-conn-pill' + (isOfflineMode() ? ' conn-offline' : ' conn-online');
  connPill.title     = isOfflineMode() ? 'وضع Offline نشط' : 'متصل بالخادم';
  connPill.innerHTML = isOfflineMode()
    ? `<span class="conn-dot"></span><span class="conn-label">Offline</span>`
    : `<span class="conn-dot"></span><span class="conn-label">Online</span>`;
  actions.appendChild(connPill);

  // widget العمليات المحلية المعلقة (يتحدث عبر _updateSyncWidget)
  const sqwPill = document.createElement('div');
  sqwPill.id            = 'sqw-pill';
  sqwPill.className     = 'sqw-pill';
  sqwPill.style.display = 'none';
  actions.appendChild(sqwPill);

  // حبة المزامنة
  const syncBtn = document.createElement('button');
  syncBtn.id        = 'sync-indicator';
  syncBtn.className = 'header-sync-pill';
  syncBtn.title     = 'انقر للمزامنة اليدوية';
  syncBtn.setAttribute('aria-label', 'مزامنة يدوية');
  syncBtn.innerHTML = `
    <div id="sync-dot" class="sync-dot synced"></div>
    <span id="sync-label" class="sync-label">مزامنة</span>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
    <span id="sync-count" class="sync-count" style="display:none;"></span>`;
  syncBtn.addEventListener('click', () => SyncService?.manualSync?.());
  actions.appendChild(syncBtn);

  header.appendChild(actions);
  return header;
}

// حساب ارتفاعات الهيدر والنافار والشريط البرتقالي ديناميكياً
function _fixHeaderOverlap() {
  const header  = document.querySelector('.app-header');
  const nav     = document.querySelector('.app-nav');
  const content = document.getElementById('app-content');
  if (!header || !nav || !content) return;
  const hh      = header.offsetHeight;
  const nh      = nav.offsetHeight;
  const bannerH = document.getElementById('offline-banner')?.offsetHeight || 0;
  nav.style.top            = hh + 'px';
  content.style.paddingTop = (hh + nh + bannerH + 8) + 'px';
}

/* أيقونة الثيم SVG */
function _themeIcon(isDark) {
  return isDark
    ? `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="5"/>
        <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
        <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
        <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
        <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
       </svg>`
    : `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
       </svg>`;
}

/* بطاقة معلومات المستخدم المنسدلة */
function _buildUserCard(user, accNum) {
  const card = document.createElement('div');
  card.className = 'user-card-dropdown';

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || '';
  const initial   = (user?.display_name || '?').charAt(0).toUpperCase();

  card.innerHTML = `
    <div class="ucd-header">
      <div class="ucd-avatar">${escapeHtml(initial)}</div>
      <div>
        <div class="ucd-name">${escapeHtml(user?.display_name || '')}</div>
        <div class="ucd-role">${escapeHtml(roleLabel)}</div>
      </div>
    </div>
    <div class="ucd-row">
      <span class="ucd-label">رقم الحساب</span>
      <span class="ucd-val" style="color:#60a5fa;font-size:0.72rem;">
        ${accNum ? escapeHtml(accNum.slice(0,20)) : '—'}
      </span>
    </div>
    <div class="ucd-row">
      <span class="ucd-label">الرصيد الحالي</span>
      <span class="ucd-val green" id="ucd-balance">—</span>
    </div>
    <div class="ucd-row">
      <span class="ucd-label">حالة المزامنة</span>
      <span class="ucd-val" id="ucd-sync-status">● متزامن</span>
    </div>
    <div class="ucd-row">
      <span class="ucd-label">تاريخ اليوم</span>
      <span class="ucd-val">${new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</span>
    </div>`;

  // تحميل الرصيد عند الفتح
  card.addEventListener('transitionend', async () => {
    if (!card.classList.contains('open')) return;
    const balEl = card.querySelector('#ucd-balance');
    if (!balEl || balEl.dataset.loaded) return;
    balEl.dataset.loaded = '1';
    const agentId = user?.id;
    if (agentId && window.AccountingService) {
      const r = await AccountingService.getAccountBalance('AGT_' + agentId);
      if (window.isOk && isOk(r)) {
        balEl.textContent = Math.round(r.data).toLocaleString('en-US') + ' ر.س';
        balEl.style.color = r.data >= 0 ? '#10b981' : '#f87171';
      }
    }
  });

  return card;
}


// ============================================================
// شريط التنقل
// ============================================================
function _buildNav() {
  const tabs = AuthService.getAllowedTabs();
  const nav  = document.createElement('nav');
  nav.id        = 'app-nav';
  nav.className = 'app-nav';
  nav.setAttribute('aria-label', 'التنقل الرئيسي');
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
    btn.setAttribute('role', 'tab');

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
    if (isOfflineMode()) {
      showToast('هذا التبويب غير متاح في وضع Offline — أدخل بياناتك واتصل بالإنترنت لمزامنتها', 'warning');
    } else {
      showToast('لا تملك صلاحية الوصول لهذا التبويب', 'error');
    }
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

  // ── انتقال التبويب: fade-in ──
  _contentEl.classList.remove('tab-enter');
  void _contentEl.offsetWidth; // إعادة التدفق لإعادة تشغيل الأنيميشن
  _contentEl.classList.add('tab-enter');

  // ── stagger لأول 8 بطاقات ──
  _contentEl.querySelectorAll('.glass-card').forEach((card, i) => {
    card.style.setProperty('--card-index', Math.min(i, 7));
  });

  // T2 — تأثير الدخول المتتابع (Safe Enhancement)
  requestAnimationFrame(_applyStaggerAnimation);
}

function _updateNavHighlight(activeTabId) {
  document.querySelectorAll('.nav-tab').forEach(btn => {
    const isActive = btn.dataset.tab === activeTabId;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', String(isActive));
    if (isActive) {
      btn.setAttribute('aria-current', 'page');
      // مرّر للتبويب النشط داخل شريط التنقل
      btn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    } else {
      btn.removeAttribute('aria-current');
    }
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
  if (_storeEventsBound) return;
  _storeEventsBound = true;

  AppStore.addEventListener('store:settingsLoaded', () => {
    _updateHeaderLogo();
    requestAnimationFrame(_fixHeaderOverlap);
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

  const _updateNotifBadge = (e) => {
    const unreadNotifCount = e.detail.state.unreadNotifCount;
    const badge = document.getElementById('notif-badge');
    if (badge) {
      badge.style.display = unreadNotifCount > 0 ? 'flex' : 'none';
      badge.textContent   = unreadNotifCount > 9 ? '9+' : String(unreadNotifCount);
    }
  };
  AppStore.addEventListener('store:notifCountChanged',   _updateNotifBadge);
  AppStore.addEventListener('store:notificationsLoaded', _updateNotifBadge);

  AppStore.addEventListener('store:userCleared', () => {
    _showLoginScreen();
  });

  // مؤشر الاتصال: يتحدث عند تغيير حالة الشبكة
  window.addEventListener('app:onlineStatusChange', (e) => {
    _updateConnStatus(e.detail?.online);
  });

  // Sync Queue Widget: يتحدث عند حفظ عملية محلية جديدة
  window.addEventListener('app:localOpSaved', () => _updateSyncWidget());
}

/** تحديث مؤشر حالة الاتصال في الهيدر */
function _updateConnStatus(isNowOnline) {
  const pill = document.getElementById('conn-status-pill');
  if (!pill) return;

  if (isOfflineMode()) {
    // في وضع Offline: مؤشر الشبكة لا يغيّر الوضع — فقط نُحدّث الشريط
    _buildOfflineBanner();
    _updateSyncWidget();
    return;
  }

  if (isNowOnline) {
    pill.className = 'header-conn-pill conn-online';
    pill.title     = 'متصل بالخادم';
    pill.innerHTML = `<span class="conn-dot"></span><span class="conn-label">Online</span>`;
    // إعادة الاتصال في وضع Online → مزامنة الطابور المعلق
    if (typeof SyncEngine !== 'undefined') {
      SyncEngine.startAutoSync().catch(e => console.warn('[App] SyncEngine:', e.message));
    }
  } else {
    pill.className = 'header-conn-pill conn-degraded';
    pill.title     = 'انقطع الاتصال بالإنترنت';
    pill.innerHTML = `<span class="conn-dot"></span><span class="conn-label">لا اتصال</span>`;
    showToast('انقطع الاتصال. سيُعاد المحاولة عند استعادة الإنترنت.', 'warning', 4000);
  }
  _updateSyncWidget();
}

/** شريط وضع Offline — يظهر أسفل الهيدر مباشرة (position:fixed) */
function _buildOfflineBanner() {
  const old = document.getElementById('offline-banner');
  if (old) old.remove();

  if (!isOfflineMode()) return;

  const banner = document.createElement('div');
  banner.id        = 'offline-banner';
  banner.className = 'offline-banner';
  banner.innerHTML = `<span class="offline-banner-icon">🔌</span>
                      <span class="offline-banner-text">وضع Offline — تعمل بدون اتصال</span>`;

  // position:fixed → نُلحق بـ body مباشرة (لا علاقة للـ DOM hierarchy)
  document.body.appendChild(banner);

  // ضبط top بعد أن يكون الهيدر قابلاً للقياس
  requestAnimationFrame(() => {
    const header = document.getElementById('app-header');
    if (header) banner.style.top = header.offsetHeight + 'px';
    _fixHeaderOverlap(); // إعادة حساب paddingTop للمحتوى
  });
}

// ============================================================
// Sync Queue Widget — لوحة العمليات المحلية المعلقة
// ============================================================

/**
 * يُرجع محتوى HTML للـ widget حسب الحالة
 * @param {number} count - عدد العمليات المعلقة
 * @param {boolean} isSyncing - هل المزامنة جارية الآن
 * @returns {string}
 */
function _renderSyncWidgetHTML(count, isSyncing, failedCount = 0) {
  if (isSyncing) {
    return `<span class="sqw-dot"></span><span>جاري المزامنة...</span>
            <button class="sqw-btn" disabled>🔄</button>`;
  }
  const parts = [];
  if (count > 0)       parts.push(`⏳ ${count} معلقة`);
  if (failedCount > 0) parts.push(`❌ ${failedCount} فاشلة`);
  const label = parts.length ? parts.join(' · ') : '⏳ عملية معلقة';
  return `<span class="sqw-dot"></span><span>${label}</span>
          <button id="sqw-sync-btn" class="sqw-btn">مزامنة الآن</button>`;
}

/** يقرأ عدد العمليات المعلقة ويُعيد رسم الـ widget */
async function _updateSyncWidget() {
  const pill = document.getElementById('sqw-pill');
  if (!pill) return;

  const count = window.LocalOperationsService
    ? await LocalOperationsService.getPendingCount().catch(() => 0)
    : 0;

  // عمليات فاشلة: معلقة ولديها رسالة خطأ مسجّلة
  let failedCount = 0;
  try {
    if (typeof db !== 'undefined' && db.isOpen()) {
      failedCount = await db.transactions
        .where('sync_status').equals(SYNC_STATUS.PENDING)
        .filter(tx => !!tx.error_message)
        .count();
    }
  } catch { /* تجاهل */ }

  if (count === 0 && failedCount === 0) {
    pill.style.display = 'none';
    return;
  }

  pill.className     = 'sqw-pill' + (failedCount > 0 ? ' sqw-pill--has-failed' : '');
  pill.style.display = 'flex';
  pill.innerHTML     = _renderSyncWidgetHTML(count, false, failedCount);

  document.getElementById('sqw-sync-btn')
    ?.addEventListener('click', _handleManualSync, { once: true });
}

/** يُشغّل المزامنة اليدوية ويُظهر النتيجة */
async function _handleManualSync() {
  const pill = document.getElementById('sqw-pill');
  if (!pill) return;

  pill.className     = 'sqw-pill sqw-pill--syncing';
  pill.style.display = 'flex';
  pill.innerHTML     = _renderSyncWidgetHTML(0, true);

  try {
    if (typeof SyncEngine === 'undefined') {
      showToast('محرك المزامنة غير متاح', 'error');
      return;
    }
    const result = await SyncEngine.startAutoSync();
    if (isOk(result)) {
      const { synced, failed } = result.data;
      if (failed === 0) {
        showToast(`✅ تمت المزامنة: ${synced} عملية`, 'success');
      } else {
        showToast(`⚠️ مزامنة جزئية: ${synced} نجحت، ${failed} فشلت`, 'warning');
      }
    } else {
      showToast('فشلت المزامنة: ' + (result.error || ''), 'error');
    }
  } catch (e) {
    console.error('[App] _handleManualSync:', e);
    showToast('حدث خطأ أثناء المزامنة', 'error');
  }

  await _updateSyncWidget();
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
  _stopCommandsWatcher();      // إيقاف مراقبة الأوامر عند الخروج
  _stopNotificationsRealtime(); // إيقاف Realtime الإشعارات
  _hideLoadingScreen();
  _stopDateClock();
  _destroyActiveComponent();

  // تنظيف LoginComponent السابق إذا وُجد
  try { window.LoginComponent?.destroy?.(); } catch { /* non-critical cleanup */ }

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
  } catch { /* localStorage may be unavailable in restricted contexts */ }
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
// مراقب أوامر النظام — System Commands Watcher
// يُستدعى بعد تسجيل الدخول، ويعمل كل 30 ثانية.
// يلتقط RESET_ALL_DATA على الأجهزة غير المتصلة عند عودتها.
// ============================================================

let _cmdWatcherTimer = null;

async function _checkSystemCommands() {
  if (!window.supabaseClient) return;
  if (!AppStore.getState('currentUser')) return; // لم يُسجَّل الدخول بعد

  try {
    const { data: commands, error } = await supabaseClient
      .from('system_commands')
      .select('id, command, issued_at')
      .is('executed_at', null)
      .order('issued_at', { ascending: true });

    if (error) {
      console.warn('⚠️ _checkSystemCommands:', error.message);
      return;
    }
    if (!commands?.length) return;

    for (const cmd of commands) {
      if (cmd.command === 'RESET_ALL_DATA') {
        console.log('📢 App.js: استُلم أمر RESET_ALL_DATA — جاري تنظيف هذا الجهاز...');

        // إيقاف خدمات المزامنة أولاً
        try {
          if (typeof SyncQueue   !== 'undefined') SyncQueue.clearRetryTimers();
          if (typeof SyncService !== 'undefined') SyncService.stop();
        } catch (_e) { /* non-critical */ }

        // مسح Dexie المحلي
        if (window.db) {
          try {
            await db.delete();
            await db.open();
            console.log('✅ App.js: Dexie أُعيدت تهيئتها');
          } catch (dErr) {
            console.warn('⚠️ App.js: Dexie delete/reopen:', dErr.message);
          }
        }

        // مسح كاش localStorage التشغيلي
        try {
          localStorage.removeItem('ahu_stmt_filter_pref');
          localStorage.removeItem('ahu_quick_banner_dismissed');
          const toRemove = [];
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith('favBanks_')) toRemove.push(k);
          }
          toRemove.forEach(k => localStorage.removeItem(k));
        } catch (_e) { /* non-critical */ }

        // تحديث executed_at لمنع إعادة التنفيذ من هذا الجهاز (atomic)
        await supabaseClient
          .from('system_commands')
          .update({ executed_at: new Date().toISOString() })
          .eq('id', cmd.id)
          .is('executed_at', null);

        showToast('📢 تمت إعادة ضبط البيانات من المدير — سيُعاد تحميل النظام...', 'info', 3000);

        // إعادة تحميل الصفحة للحالة النظيفة
        setTimeout(() => window.location.reload(), 2500);
      }
    }
  } catch (err) {
    console.warn('⚠️ _checkSystemCommands (unexpected):', err.message);
  }
}

function _startCommandsWatcher() {
  if (_cmdWatcherTimer) return; // تجنب التكرار
  // فحص فوري عند أول اتصال/تشغيل
  _checkSystemCommands();
  // فحص دوري كل 30 ثانية
  _cmdWatcherTimer = setInterval(_checkSystemCommands, 30_000);
  // فحص فوري عند عودة الاتصال
  window.addEventListener('online', _checkSystemCommands, { passive: true });
}

function _stopCommandsWatcher() {
  if (_cmdWatcherTimer) { clearInterval(_cmdWatcherTimer); _cmdWatcherTimer = null; }
  window.removeEventListener('online', _checkSystemCommands);
}

// ============================================================
// Realtime — اشتراك Supabase لتحديث الإشعارات فورياً
// ============================================================

let _notifsChannel = null;

function _startNotificationsRealtime(profile) {
  if (!window.supabaseClient || !profile?.id) return;

  // إلغاء القناة القديمة إن وُجدت
  if (_notifsChannel) {
    try { supabaseClient.removeChannel(_notifsChannel); } catch { /* non-critical */ }
    _notifsChannel = null;
  }

  try {
    _notifsChannel = supabaseClient
      .channel('notifications-realtime-' + profile.id)
      .on('postgres_changes', {
        event  : '*',
        schema : 'public',
        table  : 'notifications',
      }, () => {
        // إعادة تحميل الإشعارات فور وصول تغيير من Supabase
        window.dispatchEvent(new Event('store:notificationsUpdated'));
      })
      .subscribe();
    console.log('✅ Realtime: مشترك في جدول notifications');
  } catch (e) {
    console.warn('⚠️ _startNotificationsRealtime:', e.message);
  }
}

function _stopNotificationsRealtime() {
  if (_notifsChannel) {
    try { supabaseClient.removeChannel(_notifsChannel); } catch { /* non-critical */ }
    _notifsChannel = null;
  }
}

// ============================================================
// Phase 5 Step 3 — اختصارات لوحة المفاتيح
// ============================================================

let _shortcutsListenerAttached = false;

function initKeyboardShortcuts() {
  if (_shortcutsListenerAttached) return;
  _shortcutsListenerAttached = true;

  document.addEventListener('keydown', (e) => {
    // تجاهل الاختصارات عند الكتابة في حقول النص (ما عدا Escape)
    const tag = document.activeElement?.tagName;
    const isTyping = (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT')
                     && e.key !== 'Escape';

    const isMac = navigator.platform.toUpperCase().includes('MAC');
    const ctrlOrCmd = isMac ? e.metaKey : e.ctrlKey;

    // Ctrl/Cmd + S — حفظ العملية الحالية
    if (ctrlOrCmd && e.key === 's') {
      e.preventDefault();
      const saveBtn = document.querySelector(
        '#app-content button[id$="-save-btn"]:not([disabled])'
      );
      if (saveBtn) {
        saveBtn.click();
      } else {
        showToast('لا توجد عملية لحفظها في هذه الصفحة', 'info', 2000);
      }
      return;
    }

    // Ctrl/Cmd + F — التركيز على حقل البحث
    if (ctrlOrCmd && e.key === 'f') {
      const searchInput = document.querySelector(
        '#app-content input[type="search"], #app-content input[placeholder*="بحث"]'
      );
      if (searchInput) {
        e.preventDefault();
        searchInput.focus();
        searchInput.select();
      }
      return;
    }

    // Ctrl/Cmd + O — مزامنة يدوية فورية
    if (ctrlOrCmd && e.key === 'o') {
      e.preventDefault();
      _handleManualSync();
      return;
    }

    // Ctrl/Cmd + L — تسجيل الخروج
    if (ctrlOrCmd && e.key === 'l') {
      e.preventDefault();
      _handleLogout();
      return;
    }

    // تجاهل باقي الاختصارات عند الكتابة
    if (isTyping) return;

    // Escape — إغلاق النوافذ المنبثقة
    if (e.key === 'Escape') {
      // الاختصارات Help Modal
      const helpModal = document.getElementById('shortcuts-help-modal');
      if (helpModal) { helpModal.remove(); return; }

      // أي dialog مفتوح — انقر على زر الإلغاء أو الإغلاق
      const cancelBtn = document.querySelector(
        '[role="dialog"] button[aria-label="إلغاء"], ' +
        '[role="dialog"] .pw-btn-cancel, ' +
        '[role="dialog"] .pin-cancel-btn'
      );
      if (cancelBtn) cancelBtn.click();
      return;
    }

    // F5 — تحديث البيانات دون إعادة تحميل الصفحة
    if (e.key === 'F5') {
      e.preventDefault();
      AppStore.refreshData()
        .then(() => {
          if (_activeComponentId) _navigateTo(_activeComponentId);
          showToast('تم تحديث البيانات', 'success', 2000);
        })
        .catch(err => showToast('تعذّر تحديث البيانات', 'warning', 2000));
      return;
    }

    // ? — عرض/إخفاء نافذة الاختصارات
    if (e.key === '?') {
      e.preventDefault();
      _toggleShortcutsHelp();
      return;
    }
  });
}

function _toggleShortcutsHelp() {
  const existing = document.getElementById('shortcuts-help-modal');
  if (existing) { existing.remove(); return; }

  const isMac = navigator.platform.toUpperCase().includes('MAC');
  const mod   = isMac ? '⌘' : 'Ctrl';

  const shortcuts = [
    { keys: [`${mod}`, `S`], desc: 'حفظ العملية الحالية'          },
    { keys: [`${mod}`, `F`], desc: 'التركيز على حقل البحث'        },
    { keys: [`${mod}`, `O`], desc: 'مزامنة يدوية فورية'           },
    { keys: [`${mod}`, `L`], desc: 'تسجيل الخروج'                  },
    { keys: [`Esc`],         desc: 'إغلاق النوافذ المنبثقة'        },
    { keys: [`F5`],          desc: 'تحديث البيانات (بدون إعادة تحميل)' },
    { keys: [`?`],           desc: 'عرض/إخفاء هذه المساعدة'       },
  ];

  const itemsHTML = shortcuts.map(s => `
    <div class="shortcut-item">
      <div class="shortcut-keys">
        ${s.keys.map((k, i) =>
          `<kbd>${escapeHtml(k)}</kbd>${i < s.keys.length - 1 ? '<span class="shortcut-sep">+</span>' : ''}`
        ).join('')}
      </div>
      <span class="shortcut-desc">${escapeHtml(s.desc)}</span>
    </div>`).join('');

  const modal = document.createElement('div');
  modal.id = 'shortcuts-help-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'اختصارات لوحة المفاتيح');
  modal.innerHTML = `
    <div class="shortcuts-overlay" id="shortcuts-overlay"></div>
    <div class="shortcuts-content">
      <h3>⌨️ اختصارات لوحة المفاتيح</h3>
      <div class="shortcuts-list">${itemsHTML}</div>
      <button class="shortcuts-close-btn" id="shortcuts-close-btn" aria-label="إغلاق نافذة الاختصارات">إغلاق</button>
    </div>`;

  document.body.appendChild(modal);

  modal.querySelector('#shortcuts-overlay').addEventListener('click', () => modal.remove());
  modal.querySelector('#shortcuts-close-btn').addEventListener('click', () => modal.remove());
  setTimeout(() => modal.querySelector('#shortcuts-close-btn')?.focus(), 80);
}

// ============================================================
// تصدير
// ============================================================
window.App             = { navigateTo: _navigateTo, bootApp: _bootApp, onLoginSuccess: _onLoginSuccess };
window._appNavigateTo  = _navigateTo;
window._updateHeaderLogo = _updateHeaderLogo;
window._startCommandsWatcher = _startCommandsWatcher;

// ============================================================
// تحسينات إضافية آمنة — Safe Enhancements v1.0
// كل دالة هنا مستقلة تماماً عن منطق التطبيق الأساسي.
// لإلغاء أي تحسين: علِّق استدعاءه في _initSafeEnhancements فقط.
// ============================================================

/**
 * T2 — تأثير الدخول المتتابع (Stagger In)
 * يضيف class stagger-item.visible بتأخير تدريجي على عناصر المحتوى.
 * آمن تماماً: لا يمس البيانات، لا يُعيد بناء DOM.
 */
function _applyStaggerAnimation() {
  const content = document.getElementById('app-content');
  if (!content) return;

  // أضف class على الهيدر والنافبار مرة واحدة فقط
  ['.app-header', '.app-nav'].forEach((sel, i) => {
    const el = document.querySelector(sel);
    if (!el || el.dataset.staggerDone) return;
    el.classList.add('stagger-item');
    setTimeout(() => el.classList.add('visible'), i * 60);
    el.dataset.staggerDone = '1';
  });

  // العناصر المباشرة داخل المحتوى
  const children = Array.from(content.children).slice(0, 12); // حد أقصى لتجنب التأثير الزائد
  children.forEach((el, i) => {
    if (el.dataset.staggerDone) return;
    el.classList.add('stagger-item');
    setTimeout(() => el.classList.add('visible'), 80 + i * 55);
    el.dataset.staggerDone = '1';
  });
}

/**
 * T3 — تقلص الهيدر عند التمرير (Shrink on Scroll)
 * يُخفي عناصر النصوص الثانوية فقط — لا يغير ارتفاع الهيدر.
 * يستخدم class header-shrink على .app-header.
 */
let _shrinkActive = false;
function _onScrollEnhancements() {
  const scrollY = window.scrollY;
  const header  = document.querySelector('.app-header');
  const nav     = document.querySelector('.app-nav');
  if (!header) return;

  // تقلص الهيدر
  const shouldShrink = scrollY > 50;
  if (shouldShrink !== _shrinkActive) {
    _shrinkActive = shouldShrink;
    header.classList.toggle('header-shrink', shouldShrink);
    // أعد حساب padding بعد تغيير الـ class (تأخير صغير لانتهاء transition)
    setTimeout(_fixHeaderOverlap, 160);
  }

  // Auto-hide للشريط
  if (nav) {
    const lastScroll = parseInt(nav.dataset.lastScroll || '0', 10);
    const isScrollingDown = scrollY > lastScroll && scrollY > 80;
    nav.classList.toggle('nav-hidden', isScrollingDown);
    nav.dataset.lastScroll = String(scrollY);
  }
}

/**
 * T4 — تحديث بيانات المستخدم الديناميكية في الهيدر
 * يُحدِّث العناصر الموجودة أصلاً في DOM دون إعادة بناء.
 */
function _refreshHeaderUserData() {
  const user = AppStore.getState('currentUser');
  if (!user) return;
  const roleLabel = (typeof ROLE_LABELS !== 'undefined' ? ROLE_LABELS[user.role] : null) || user.role || '';

  const greetEl = document.querySelector('.header-user-greeting');
  const roleEl  = document.querySelector('.header-user-role-tag');
  const avatarEl = document.querySelector('.header-avatar');

  if (greetEl) greetEl.textContent = `مرحباً، ${user.display_name || ''}`;
  if (roleEl)  roleEl.textContent  = roleLabel;
  if (avatarEl) avatarEl.textContent = (user.display_name || 'U').charAt(0);
}

/**
 * _initSafeEnhancements — نقطة الدخول الوحيدة لكل التحسينات
 * يُستدعى من _buildAppShell بعد _fixHeaderOverlap.
 * لإلغاء أي تحسين: علِّق سطره هنا.
 */
function _initSafeEnhancements() {
  // T3 + T4 — مستمع التمرير الموحَّد (أداء أفضل من مستمعات متعددة)
  window.addEventListener('scroll', _onScrollEnhancements, { passive: true });

  // T4 — ربط حدث store لتحديث بيانات المستخدم عند تغييرها
  AppStore.addEventListener('store:settingsLoaded', _refreshHeaderUserData);

  // إعادة حساب padding عند انتهاء transition الـ nav-hidden
  const nav = document.querySelector('.app-nav');
  if (nav) {
    nav.addEventListener('transitionend', () => {
      if (!nav.classList.contains('nav-hidden')) _fixHeaderOverlap();
    }, { passive: true });
  }
}

console.log('✅ App.js v3.0 — هيدر محسَّن + QuickLoginBanner + last_login + Safe Enhancements v1.0');
