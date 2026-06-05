/**
 * App.js — v2.0 (Online-First)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * التغييرات وفق التوثيق:
 * ✅ 1. فشل Dexie لا يوقف التطبيق — يُسجَّل فقط ويستمر مع Supabase
 * ✅ 2. runStartupCleanup() محاطة بـ try/catch (Dexie قد تكون غير متاحة)
 * ✅ 3. SyncService.init() لا يُشغَّل إذا كانت Dexie فاشلة
 * ✅ 4. مؤقت المزامنة الدورية 30 ثانية (بدلاً من 5 دقائق) عند وجود عمليات معلقة
 */
'use strict';

let _headerEl  = null;
let _navEl     = null;
let _contentEl = null;
let _dateTimer = null;
let _dexieOk   = false; // هل Dexie متاحة؟

const _loadedComponents = new Map();

// ============================================================
// نقطة الدخول
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  console.log('🚀 App.js: بدء تهيئة النظام (Online-First)...');

  try {
    // ─── 1. تهيئة Dexie (غير حرجة — فشلها لا يوقف التطبيق) ───
    try {
      const dexieResult = await initDexie();
      if (isOk(dexieResult)) {
        _dexieOk = true;
        console.log('✅ App.js: Dexie جاهزة');
        // التنظيف في الخلفية — لا ننتظره
        runStartupCleanup().catch(e =>
          console.warn('⚠️ App.js: تحذير تنظيف Dexie:', e.message)
        );
      } else {
        console.warn('⚠️ App.js: Dexie غير متاحة — سيعمل النظام مع Supabase فقط');
        _scheduleDexieReopen(); // محاولة إعادة الفتح في الخلفية
      }
    } catch (dexieErr) {
      console.warn('⚠️ App.js: خطأ في Dexie:', dexieErr.message, '— النظام يكمل مع Supabase');
      _scheduleDexieReopen();
    }

    // ─── 2. تهيئة خدمة المزامنة (فقط إن كانت Dexie متاحة) ───
    if (_dexieOk && window.SyncService) {
      SyncService.init();
    }

    // ─── 3. الوضع المظلم ───
    if (window.ThemeManager) {
      ThemeManager.init();
    } else {
      _restoreDarkMode();
    }

    // ─── 4. التحقق من الجلسة (من Supabase مباشرة) ───
    const sessionResult = await AuthService.checkSession();

    if (isOk(sessionResult)) {
      await _bootApp(sessionResult.data.profile);
    } else {
      _showLoginScreen();
    }

  } catch (e) {
    console.error('❌ App.js: خطأ فادح في التهيئة:', e);
    _showFatalError(`خطأ في تهيئة النظام: ${e.message}`);
  }
});

// ============================================================
// إعادة فتح Dexie في الخلفية
// ============================================================

function _scheduleDexieReopen() {
  setTimeout(async () => {
    try {
      if (!db.isOpen()) {
        await db.open();
        _dexieOk = true;
        console.log('✅ App.js: أُعيد فتح Dexie في الخلفية');
        if (window.SyncService && !_dexieOk) SyncService.init();
      }
    } catch (e) {
      console.warn('⚠️ App.js: فشل إعادة فتح Dexie:', e.message);
    }
  }, 5000); // بعد 5 ثوانٍ
}

// ============================================================
// تشغيل التطبيق
// ============================================================

async function _bootApp(profile) {
  _hideLoadingScreen();
  AppStore.setCurrentUser(profile);

  if (window.IdleTimer) {
    if (profile.role === ROLES.AGENT) {
      IdleTimer.start();
    } else {
      IdleTimer.stop();
    }
  }

  _buildAppShell();
  await AppStore.refreshData();
  _bindStoreEvents();

  const firstTab = AuthService.getAllowedTabs()[0];
  if (firstTab) await _navigateTo(firstTab);

  _startDateClock();
  console.log(`✅ App.js: جاهز — ${profile.display_name} (${profile.role})`);
}

// ============================================================
// بناء الهيكل
// ============================================================

function _buildAppShell() {
  const root = document.getElementById('app-root');
  root.innerHTML = '';

  _headerEl  = _buildHeader();
  _navEl     = _buildNav();
  _contentEl = document.createElement('main');
  _contentEl.id = 'app-content';
  _contentEl.className = 'app-content';

  root.appendChild(_headerEl);
  root.appendChild(_navEl);
  root.appendChild(_contentEl);

  if (window.lucide) lucide.createIcons();
}

function _buildHeader() {
  const user    = AppStore.getState('currentUser');
  const state   = AppStore.getState();
  const logoUrl = state.logoUrl;
  const accNum  = state.accountNumber;

  const header  = document.createElement('header');
  header.id = 'app-header';
  header.className = 'app-header';

  const right = document.createElement('div');
  right.className = 'header-logo';

  if (logoUrl) {
    const img = document.createElement('img');
    img.src = logoUrl; img.alt = 'شعار النظام';
    img.style.cssText = 'height:32px;width:auto;object-fit:contain;border-radius:6px;';
    right.appendChild(img);
  }

  const titleWrap = document.createElement('div');
  titleWrap.innerHTML = `
    <div style="font-weight:800;font-size:0.95rem;color:var(--text-primary);">
      ${escapeHtml(APP_CONFIG.NAME_SHORT)}
    </div>
    <div style="font-size:0.70rem;color:var(--text-muted);" id="header-date"></div>`;
  right.appendChild(titleWrap);

  const left = document.createElement('div');
  left.className = 'header-actions';

  // مؤشر المزامنة
  const syncDot = document.createElement('div');
  syncDot.id = 'sync-indicator';
  syncDot.style.cssText = `
    display:flex;align-items:center;gap:6px;font-size:0.75rem;
    color:var(--text-muted);padding:4px 8px;border-radius:8px;
    background:var(--bg-input);cursor:pointer;`;
  syncDot.innerHTML = `
    <div id="sync-dot" class="sync-dot synced"
      style="width:7px;height:7px;border-radius:50%;background:var(--success);transition:background 0.3s;"></div>
    <span id="sync-label">متزامن</span>
    <span id="sync-count" style="display:none;background:var(--warning);color:#fff;border-radius:10px;padding:1px 6px;font-size:0.65rem;"></span>`;
  syncDot.addEventListener('click', () => SyncService?.manualSync?.());
  left.appendChild(syncDot);

  // زر الوضع المظلم
  const themeBtn = document.createElement('button');
  themeBtn.id = 'theme-toggle-btn';
  themeBtn.className = 'btn btn-secondary btn-sm header-icon-btn';
  themeBtn.title = 'تبديل الوضع المظلم/الفاتح';
  themeBtn.innerHTML = `<i data-lucide="moon" style="width:16px;height:16px;"></i>`;
  themeBtn.addEventListener('click', () => {
    const isDark = window.ThemeManager ? ThemeManager.toggle()
      : document.body.classList.toggle('dark-mode');
    localStorage.setItem('abu_theme', isDark ? 'dark' : 'light');
  });
  left.appendChild(themeBtn);

  // معلومات المستخدم
  const userChip = document.createElement('div');
  userChip.style.cssText = `
    display:flex;align-items:center;gap:8px;padding:6px 12px;
    background:var(--bg-input);border-radius:12px;
    border:1px solid var(--border-color);`;
  userChip.innerHTML = `
    <div style="width:28px;height:28px;border-radius:50%;
      background:var(--accent);display:flex;align-items:center;
      justify-content:center;color:#fff;font-weight:700;font-size:0.85rem;">
      ${escapeHtml((user?.display_name || '؟').charAt(0))}
    </div>
    <div style="line-height:1.2;">
      <div style="font-size:0.80rem;font-weight:700;color:var(--text-primary);">
        ${escapeHtml(user?.display_name || '—')}
      </div>
      <div style="font-size:0.68rem;color:var(--text-muted);">
        ${escapeHtml(ROLE_LABELS[user?.role] || user?.role || '—')}
        ${accNum ? ` · ${escapeHtml(accNum)}` : ''}
      </div>
    </div>`;
  left.appendChild(userChip);

  // زر الخروج
  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'btn btn-secondary btn-sm header-icon-btn';
  logoutBtn.title = 'تسجيل الخروج';
  logoutBtn.innerHTML = `<i data-lucide="log-out" style="width:16px;height:16px;color:var(--danger);"></i>`;
  logoutBtn.addEventListener('click', _handleLogout);
  left.appendChild(logoutBtn);

  header.appendChild(right);
  header.appendChild(left);
  return header;
}

function _buildNav() {
  const tabs = AuthService.getAllowedTabs();
  const nav  = document.createElement('nav');
  nav.id = 'app-nav';
  nav.className = 'app-nav';
  nav.style.overflowX = 'auto';

  tabs.forEach(tabId => {
    const btn = document.createElement('button');
    btn.id = `nav-tab-${tabId}`;
    btn.className = 'nav-tab';
    btn.dataset.tab = tabId;
    btn.setAttribute('aria-selected', 'false');

    const label = TAB_LABELS[tabId] || tabId;
    const icons = {
      dashboard         : 'layout-dashboard',
      'data-entry'      : 'pencil-line',
      'daily-summary'   : 'file-bar-chart',
      'bank-accounts'   : 'landmark',
      debtors           : 'users',
      'failed-deposits' : 'alert-circle',
      notifications     : 'bell',
      'all-operations'  : 'list',
      'audit-log'       : 'shield-check',
      users             : 'user-cog',
      'account-management': 'book-open',
      settings          : 'settings',
    };
    const icon = icons[tabId] || 'circle';

    btn.innerHTML = `
      <i data-lucide="${icon}" style="width:15px;height:15px;"></i>
      <span style="font-size:0.80rem;">${escapeHtml(label)}</span>`;
    btn.addEventListener('click', () => _navigateTo(tabId));
    nav.appendChild(btn);
  });

  return nav;
}

// ============================================================
// التوجيه
// ============================================================

async function _navigateTo(tabId) {
  if (!AuthService.canAccessTab(tabId)) {
    showToast('لا تملك صلاحية الوصول لهذا التبويب', 'error');
    return;
  }

  AppStore.setCurrentTab(tabId);
  _updateNavHighlight(tabId);

  if (_contentEl) {
    _contentEl.style.opacity = '0';
    _contentEl.style.transform = 'translateY(6px)';
    await sleep(120);
    _contentEl.innerHTML = '';
    _contentEl.style.opacity = '';
    _contentEl.style.transform = '';
    _contentEl.className = 'app-content animate-fade-in';
  }

  _showContentLoader();

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

async function _mountComponent(tabId) {
  if (!_contentEl) return;

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
// الشاشات
// ============================================================

function _showLoginScreen() {
  if (window.IdleTimer) IdleTimer.stop();
  _hideLoadingScreen();
  _stopDateClock();

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
    if (window.IdleTimer && user?.role === ROLES.AGENT) IdleTimer.start();
    return;
  }

  SyncService?.stop?.();
  _stopDateClock();
  await AuthService.logout();
}

// ============================================================
// أحداث AppStore
// ============================================================

function _bindStoreEvents() {
  AppStore.addEventListener('store:syncStatusChanged', (e) => {
    const { running, lastSyncAt } = e.detail.state;
    const dot   = document.getElementById('sync-dot');
    const label = document.getElementById('sync-label');
    if (!dot || !label) return;
    if (running) {
      dot.style.background = 'var(--warning)';
      dot.style.animation  = 'pulse 1s infinite';
      label.textContent    = 'يُزامن...';
    } else {
      dot.style.background = 'var(--success)';
      dot.style.animation  = '';
      label.textContent    = 'متزامن';
    }
  });

  AppStore.addEventListener('store:syncQueueChanged', (e) => {
    const { count } = e.detail.state;
    const countEl = document.getElementById('sync-count');
    const dot     = document.getElementById('sync-dot');
    if (!countEl) return;
    if (count > 0) {
      countEl.style.display = '';
      countEl.textContent   = String(count);
      if (dot) dot.style.background = 'var(--warning)';
    } else {
      countEl.style.display = 'none';
      if (dot) dot.style.background = 'var(--success)';
    }
  });

  AppStore.addEventListener('store:notificationsLoaded', (e) => {
    const { unreadNotifCount } = e.detail.state;
    const badge = document.querySelector('#nav-tab-notifications .notif-badge');
    if (badge) badge.textContent = unreadNotifCount > 0 ? String(unreadNotifCount) : '';
  });

  AppStore.addEventListener('store:userCleared', () => {
    _showLoginScreen();
  });
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
  const now = new Date();
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
  } catch { /* تجاهل */ }
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
      <div style="font-size:3rem">⚠️</div>
      <h2 style="color:var(--danger);text-align:center">${escapeHtml(msg)}</h2>
      <button onclick="location.reload()" class="btn btn-primary">إعادة تحميل الصفحة</button>
    </div>`;
}

// ============================================================
// تصدير
// ============================================================

window.App = { navigateTo: _navigateTo, bootApp: _bootApp, onLoginSuccess: _onLoginSuccess };
window._appNavigateTo = _navigateTo;

console.log('✅ App.js v2.0 — Online-First مع Dexie كطوارئ');
