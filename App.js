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
// الهيدر — تصميم عمودي مركزي v5.0
// ============================================================
function _buildHeader() {
  const user    = AppStore.getState('currentUser');
  const state   = AppStore.getState();
  const logoUrl = state.logoUrl;

  const header = document.createElement('header');
  header.id        = 'app-header';
  header.className = 'app-header';

  // ════════════════════════════════════════
  // قسم العلامة التجارية: شعار + عناوين
  // ════════════════════════════════════════
  const brandSection = document.createElement('div');
  brandSection.className = 'header-brand-section';

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
      <svg viewBox="0 0 56 56" fill="none" width="56" height="56">
        <rect width="56" height="56" rx="16" fill="url(#hGv5)"/>
        <text x="28" y="38" text-anchor="middle" fill="white" font-size="28" font-weight="800"
          font-family="system-ui,sans-serif">أ</text>
        <defs>
          <linearGradient id="hGv5" x1="0" y1="0" x2="56" y2="56">
            <stop offset="0%" stop-color="#f59e0b"/>
            <stop offset="100%" stop-color="#d97706"/>
          </linearGradient>
        </defs>
      </svg>`;
    logoArea.appendChild(ph);
  }
  brandSection.appendChild(logoArea);

  const titlesDiv = document.createElement('div');
  titlesDiv.className = 'header-titles';
  titlesDiv.innerHTML = `
    <div class="header-main-title">نظام إدارة التحصيلات والإيداعات</div>
    <div class="header-sub-title">${escapeHtml(APP_CONFIG?.NAME || 'أبو حذيفة للصرافة والتحويلات')}</div>`;
  brandSection.appendChild(titlesDiv);
  header.appendChild(brandSection);

  // ════════════════════════════════════════
  // بطاقة المستخدم: صف المعلومات + صف الأزرار
  // ════════════════════════════════════════
  const userCardV2 = document.createElement('div');
  userCardV2.className = 'header-user-card-v2';

  // الصف الأول: اسم المستخدم + أيقونة الثيم + جرس الإشعارات
  const userRow = document.createElement('div');
  userRow.className = 'header-user-row';

  const roleLabel = ROLE_LABELS[user?.role] || user?.role || '';
  const userLabel = document.createElement('div');
  userLabel.className = 'header-user-label';
  userLabel.innerHTML = `<span class="header-role-prefix">${escapeHtml(roleLabel)}:</span> ${escapeHtml(user?.display_name || '')}`;
  userRow.appendChild(userLabel);

  const actionsGroup = document.createElement('div');
  actionsGroup.className = 'header-actions-group';

  // زر تبديل الثيم
  const themeBtn = document.createElement('button');
  themeBtn.id        = 'theme-toggle-btn';
  themeBtn.className = 'header-icon-btn';
  themeBtn.title     = 'تبديل المظهر';
  const isDarkNow = document.body.classList.contains('dark-mode');
  themeBtn.innerHTML = _themeIcon(isDarkNow);
  themeBtn.addEventListener('click', () => {
    const isDark = window.ThemeManager
      ? ThemeManager.toggle()
      : document.body.classList.toggle('dark-mode');
    localStorage.setItem('abu_theme', isDark ? 'dark' : 'light');
    themeBtn.innerHTML = _themeIcon(isDark);
    showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
  });
  actionsGroup.appendChild(themeBtn);

  // زر الإشعارات
  if (AuthService.canAccessTab(TABS.NOTIFICATIONS)) {
    const notifBtn = document.createElement('button');
    notifBtn.id        = 'notif-btn';
    notifBtn.className = 'header-icon-btn';
    notifBtn.title     = 'الإشعارات';
    notifBtn.innerHTML = `
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
      </svg>
      <span id="notif-badge" class="notif-badge" style="display:none;"></span>`;
    notifBtn.addEventListener('click', () => _navigateTo(TABS.NOTIFICATIONS));
    actionsGroup.appendChild(notifBtn);
  } else {
    // الحفاظ على العنصر في DOM لأن كود آخر يرجع إليه
    const hiddenBadge = document.createElement('span');
    hiddenBadge.id = 'notif-badge';
    hiddenBadge.className = 'notif-badge';
    hiddenBadge.style.display = 'none';
    actionsGroup.appendChild(hiddenBadge);
  }

  userRow.appendChild(actionsGroup);
  userCardV2.appendChild(userRow);

  // الصف الثاني: زر الخروج + زر المزامنة
  const btnRow = document.createElement('div');
  btnRow.className = 'header-btn-row';

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'header-logout-btn';
  logoutBtn.title     = 'تسجيل الخروج';
  logoutBtn.innerHTML = `خروج
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-right:4px;">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>`;
  logoutBtn.addEventListener('click', _handleLogout);
  btnRow.appendChild(logoutBtn);

  const syncBtn = document.createElement('button');
  syncBtn.id        = 'sync-indicator';
  syncBtn.className = 'header-sync-btn';
  syncBtn.title     = 'انقر للمزامنة اليدوية';
  syncBtn.innerHTML = `
    <div id="sync-dot" class="sync-dot synced"></div>
    <span id="sync-label" class="sync-label">مزامنة</span>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"
      stroke-linecap="round" style="vertical-align:middle;">
      <path d="M23 4v6h-6"/><path d="M1 20v-6h6"/>
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
    </svg>
    <span id="sync-count" class="sync-count" style="display:none;"></span>`;
  syncBtn.addEventListener('click', () => SyncService?.manualSync?.());
  btnRow.appendChild(syncBtn);

  userCardV2.appendChild(btnRow);
  header.appendChild(userCardV2);

  return header;
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

  // ── انتقال التبويب: fade-in ──
  _contentEl.classList.remove('tab-enter');
  void _contentEl.offsetWidth; // إعادة التدفق لإعادة تشغيل الأنيميشن
  _contentEl.classList.add('tab-enter');

  // ── stagger لأول 8 بطاقات ──
  _contentEl.querySelectorAll('.glass-card').forEach((card, i) => {
    card.style.setProperty('--card-index', Math.min(i, 7));
  });
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

  // تنظيف LoginComponent السابق إذا وُجد
  try { window.LoginComponent?.destroy?.(); } catch {}

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
