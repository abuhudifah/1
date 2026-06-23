/**
 * components/LoginComponent.js — v5.2 Phase3 + Offline Card
 * نظام أبو حذيفة
 *
 * تدفق المصادقة المُعاد تصميمه:
 *
 * ── إذا لم يكن Quick Login مُفعَّلاً (أول استخدام):
 *    يُعرض Traditional Login مباشرة (لا Flip)
 *
 * ── إذا كان Quick Login مُفعَّلاً على هذا الجهاز:
 *    يُعرض Calculator أولاً → عند الضغط على = يُجرَّب Quick Login
 *    زر "تسجيل الدخول التقليدي" بارز أسفله
 *
 * ── بعد نجاح Traditional Login:
 *    إذا لم يكن Quick Login مُفعَّلاً → شاشة Setup منفصلة (Modal)
 *    يمكن تخطّيها
 *
 * ── Quick Login مرتبط بهذا الجهاز فقط (offline capable)
 */
'use strict';

// ─── هل يوجد دخول سريع محفوظ على هذا الجهاز؟ ───
function _hasAnyQuickLogin() {
  try {
    // نتحقق من localStorage فقط (sessionStorage تُمسح بين التبويبات)
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      // المسار الجديد: خزنة مشفّرة (معادلة/بصمة/PIN) أو بيانات بصمة محلية
      if (k?.startsWith('ahu_vault_') || k?.startsWith('ahu_bio_')) return true;
      // المسار القديم: توكن خادم بهاش معادلة
      if (k?.startsWith('ahu_quick_') && k !== 'ahu_quick_banner_dismissed') {
        const d = JSON.parse(localStorage.getItem(k) || '{}');
        if (d.hash) return true;
      }
    }
  } catch { /* localStorage may be unavailable */ }
  return false;
}

// ─── أنماط CSS — مُنقَلة إلى assets/css/styles.css (B-4) ───

const LoginComponent = {
  _state: {
    // الآلة الحاسبة
    expression   : '',
    result       : '0',
    justEvaluated: false,
    // حالة UI
    view         : 'login',   // 'calc' | 'login' | 'offline' | 'account-selector'
    menuOpen     : false,
    isLoading    : false,
    showPassword : false,
    quickEnabled : false,
    quickPending : false,
    // الدخول بدون إنترنت
    offlineUser            : null,
    offlineAccounts        : [],   // قائمة الحسابات في account-selector
    pendingPinUserId       : null, // المستخدم المختار لواجهة PIN
    currentPinInput        : '',   // الأرقام المُدخَلة في واجهة PIN
    pinVerifying           : false,// قفل التحقق لمنع التكرار
  },
  _onSuccess : null,
  _container : null,

  // ─────────────────────────────────────────────────────────
  render(container, onSuccess) {
    this._container = container;
    this._onSuccess = onSuccess;

    this._state.quickEnabled   = _hasAnyQuickLogin();
    this._state.quickPending   = false;
    this._state.isLoading      = false;
    this._state.expression     = '';
    this._state.result         = '0';
    this._state.justEvaluated  = false;
    this._state.showPassword   = false;
    this._state.menuOpen       = false;
    // إذا Quick Login مُفعَّل → ابدأ بالآلة، وإلا ابدأ بنموذج التسجيل
    this._state.view = this._state.quickEnabled ? 'calc' : 'login';

    this._injectStyles();
    container.innerHTML = '';
    container.appendChild(this._buildPage());
    // إخفاء الشعار في عرض الآلة الحاسبة + تفعيل زر البصمة بعد إضافة الصفحة للـ DOM
    const brandEl2 = document.getElementById('lp-brand-el');
    if (brandEl2 && this._state.view === 'calc') brandEl2.style.display = 'none';
    this._updateQuickWebAuthnBtnVisibility();

    // ربط keyboard بعد render
    this._kbHandler = (e) => this._handleKeyboard(e);
    document.addEventListener('keydown', this._kbHandler);

    console.log(`[LoginComponent v5] view=${this._state.view}, quickEnabled=${this._state.quickEnabled}`);
  },

  // ─────────────────────────────────────────────────────────
  _injectStyles() {},

  // ─────────────────────────────────────────────────────────
  _buildPage() {
    const page = document.createElement('div');
    page.className = 'lp-wrap';

    // خلفية زخرفية
    page.innerHTML = `
      <div class="lp-bg-orb lp-bg-orb-1" aria-hidden="true"></div>
      <div class="lp-bg-orb lp-bg-orb-2" aria-hidden="true"></div>
      <div class="lp-bg-orb lp-bg-orb-3" aria-hidden="true"></div>`;

    // الشعار
    page.appendChild(this._buildBrand());

    // زر القائمة
    page.appendChild(this._buildMenuBtn());

    // الحاوية الرئيسية
    const scene = document.createElement('div');
    scene.className = 'lp-scene';
    scene.id = 'lp-scene';
    page.appendChild(scene);

    this._renderView(scene);
    return page;
  },

  // ─────────────────────────────────────────────────────────
  _renderView(scene) {
    if (!scene) scene = document.getElementById('lp-scene');
    if (!scene) return;
    scene.innerHTML = '';
    // إخفاء/إظهار الشعار حسب العرض الحالي
    const brandEl = document.getElementById('lp-brand-el');
    if (brandEl) brandEl.style.display = this._state.view === 'calc' ? 'none' : '';
    if (this._state.view === 'calc') {
      scene.appendChild(this._buildCalcCard());
      this._updateQuickWebAuthnBtnVisibility(); // ✅ بعد الإضافة للـ DOM
    } else if (this._state.view === 'pin') {
      scene.appendChild(this._buildPinCard());
    } else if (this._state.view === 'account-selector') {
      scene.appendChild(this._buildAccountSelectorCard());
    } else if (this._state.view === 'offline') {
      scene.appendChild(this._buildOfflineCard());
    } else {
      scene.appendChild(this._buildLoginCard());
    }
  },

  // ─────────────────────────────────────────────────────────
  _buildBrand() {
    const b = document.createElement('div');
    b.id        = 'lp-brand-el';
    b.className = 'lp-brand';
    b.innerHTML = `
      <div class="lp-brand-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2"/>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
      </div>
      <div class="lp-brand-text">
        <span class="lp-brand-name">${escapeHtml(APP_CONFIG?.NAME_SHORT || 'أبو حذيفة')}</span>
        <span class="lp-brand-sub">نظام الصرافة والتحويلات</span>
      </div>`;
    return b;
  },

  // ─────────────────────────────────────────────────────────
  _buildMenuBtn() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;top:20px;right:20px;z-index:100;';

    const btn = document.createElement('button');
    btn.className = 'lp-menu-btn';
    btn.setAttribute('aria-label', 'القائمة');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>`;

    const menu = document.createElement('div');
    menu.className = 'lp-menu-drop';

    const items = [
      { icon: '🔑', label: 'تسجيل الدخول التقليدي', fn: () => this._switchToLogin() },
      { icon: '🌙', label: 'تبديل الوضع المظلم',     fn: () => this._toggleDark() },
      { icon: 'ℹ️', label: 'حول التطبيق',            fn: () => this._showAbout() },
    ];

    items.forEach(item => {
      const li = document.createElement('button');
      li.className = 'lp-menu-item';
      li.innerHTML = `<span>${item.icon}</span><span>${escapeHtml(item.label)}</span>`;
      li.addEventListener('click', () => {
        menu.style.display = 'none';
        this._state.menuOpen = false;
        item.fn();
      });
      menu.appendChild(li);
    });

    btn.addEventListener('click', e => {
      e.stopPropagation();
      this._state.menuOpen = !this._state.menuOpen;
      menu.style.display = this._state.menuOpen ? 'block' : 'none';
    });
    document.addEventListener('click', () => {
      if (this._state.menuOpen) { menu.style.display = 'none'; this._state.menuOpen = false; }
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  },

  // ─────────────────────────────────────────────────────────
  // بطاقة الآلة الحاسبة (Quick Login)
  // ─────────────────────────────────────────────────────────
  _buildCalcCard() {
    const card = document.createElement('div');
    card.className = 'lp-card calc-card';

    // شاشة العرض
    const display = document.createElement('div');
    display.className = 'calc-display';
    display.innerHTML = `
      <div id="calc-expr" class="calc-expr"></div>
      <div id="calc-result" class="calc-result">0</div>`;
    card.appendChild(display);

    // مؤشر حالة Quick Login
    const badge = document.createElement('div');
    badge.className = 'calc-ql-badge';
    badge.innerHTML = `<div class="calc-ql-badge-dot"></div><span>الدخول السريع مفعّل على هذا الجهاز — أدخل معادلتك واضغط =</span>`;
    card.appendChild(badge);

    // أزرار الحاسبة
    card.appendChild(this._buildKeypad());

    // مؤشر حالة المحاولة
    const status = document.createElement('div');
    status.id = 'calc-ql-status';
    status.className = 'calc-ql-status';
    card.appendChild(status);

    // ── صف الأزرار الثلاثة (أيقونات فقط) ──
    const authRow = document.createElement('div');
    authRow.className = 'calc-auth-row';

    // زر 1: الدخول التقليدي 🔑
    const btnTraditional = document.createElement('button');
    btnTraditional.id        = 'btn-traditional-login';
    btnTraditional.className = 'calc-auth-btn';
    btnTraditional.title     = 'تسجيل الدخول بالبريد وكلمة المرور';
    btnTraditional.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/></svg>`;
    btnTraditional.addEventListener('click', () => this._switchToLogin());
    authRow.appendChild(btnTraditional);

    // زر 2: الدخول السريع بالبصمة 👆 — مخفي في البداية، يظهر شرطياً
    const btnWebAuthn = document.createElement('button');
    btnWebAuthn.id           = 'btn-quick-webauthn';
    btnWebAuthn.className    = 'calc-auth-btn calc-auth-btn--webauthn';
    btnWebAuthn.title        = 'الدخول السريع بالبصمة أو Face ID';
    btnWebAuthn.style.display = 'none';
    btnWebAuthn.innerHTML    = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4"/><path d="M14 13.12c0 2.38 0 6.38-1 8.88"/><path d="M17.29 21.02c.12-.6.43-2.3.5-3.02"/><path d="M2 12a10 10 0 0 1 18-6"/><path d="M2 16h.01"/><path d="M21.8 16c.2-2 .131-5.354 0-6"/><path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2"/><path d="M8.65 22c.21-.66.45-1.32.57-2"/><path d="M9 6.8a6 6 0 0 1 9 5.2v2"/></svg>`;
    btnWebAuthn.addEventListener('click', () => this._tryQuickWebAuthnLogin());
    authRow.appendChild(btnWebAuthn);

    // زر 3: الدخول بدون إنترنت 🔌
    const btnOffline = document.createElement('button');
    btnOffline.id        = 'btn-offline-login';
    btnOffline.className = 'calc-auth-btn calc-auth-btn--offline';
    btnOffline.title     = 'الدخول بدون إنترنت';
    btnOffline.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"/><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/><path d="M10.71 5.05A16 16 0 0 1 22.56 9"/><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg>`;
    btnOffline.addEventListener('click', () => this._offlineLogin());
    authRow.appendChild(btnOffline);

    card.appendChild(authRow);

    return card;
  },

  // ─────────────────────────────────────────────────────────
  _buildKeypad() {
    const grid = document.createElement('div');
    grid.className = 'ios-calc-grid';

    const BTNS = [
      { l:'C',  t:'fn', v:'C'    },
      { l:'⌫',  t:'fn', v:'back' },
      { l:'%',  t:'op', v:'%'    },
      { l:'÷',  t:'op', v:'/'    },
      { l:'7',  t:'n',  v:'7'    },
      { l:'8',  t:'n',  v:'8'    },
      { l:'9',  t:'n',  v:'9'    },
      { l:'×',  t:'op', v:'*'    },
      { l:'4',  t:'n',  v:'4'    },
      { l:'5',  t:'n',  v:'5'    },
      { l:'6',  t:'n',  v:'6'    },
      { l:'−',  t:'op', v:'-'    },
      { l:'1',  t:'n',  v:'1'    },
      { l:'2',  t:'n',  v:'2'    },
      { l:'3',  t:'n',  v:'3'    },
      { l:'+',  t:'op', v:'+'    },
      { l:'0',  t:'n',  v:'0', wide:true },
      { l:'.',  t:'n',  v:'.'   },
      { l:'=',  t:'eq', v:'='   },
    ];
    const cls = { fn:'calc-btn-fn', op:'calc-btn-op', eq:'calc-btn-eq', n:'calc-btn-num' };

    BTNS.forEach(b => {
      const el = document.createElement('button');
      el.className = `calc-btn ${cls[b.t] || 'calc-btn-num'}${b.wide ? ' wide' : ''}`;
      el.textContent = b.l;
      el.addEventListener('click', () => this._handleKey(b.v));
      el.addEventListener('mousedown',  () => el.classList.add('pressed'));
      el.addEventListener('mouseup',    () => el.classList.remove('pressed'));
      el.addEventListener('mouseleave', () => el.classList.remove('pressed'));
      el.addEventListener('touchstart', () => el.classList.add('pressed'),    { passive: true });
      el.addEventListener('touchend',   () => el.classList.remove('pressed'), { passive: true });
      grid.appendChild(el);
    });
    return grid;
  },

  // ─────────────────────────────────────────────────────────
  // بطاقة تسجيل الدخول التقليدي
  // ─────────────────────────────────────────────────────────
  _buildLoginCard() {
    const card = document.createElement('div');
    card.className = 'lp-card login-card';

    // شعار + عنوان
    const logoRow = document.createElement('div');
    logoRow.className = 'lp-logo-row';
    logoRow.innerHTML = `
      <div class="lp-logo-circle">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2"/>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
      </div>
      <div class="lp-logo-text">
        <span class="lp-form-title">تسجيل الدخول</span>
        <span class="lp-form-subtitle">${escapeHtml(APP_CONFIG?.NAME_SHORT || 'أبو حذيفة')} — نظام الصرافة</span>
      </div>`;
    card.appendChild(logoRow);

    // حقل البريد
    const emailWrap = document.createElement('div');
    emailWrap.style.marginBottom = '14px';
    const emailLabel = document.createElement('label');
    emailLabel.className = 'lp-label';
    emailLabel.textContent = 'البريد الإلكتروني';
    const emailInput = document.createElement('input');
    emailInput.id = 'lp-email';
    emailInput.type = 'email';
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'name@example.com';
    emailInput.dir = 'ltr';
    emailInput.className = 'lp-input';
    emailWrap.appendChild(emailLabel);
    emailWrap.appendChild(emailInput);
    card.appendChild(emailWrap);

    // حقل كلمة المرور
    const passWrap = document.createElement('div');
    passWrap.style.marginBottom = '4px';
    const passLabel = document.createElement('label');
    passLabel.className = 'lp-label';
    passLabel.textContent = 'كلمة المرور';
    const passRow = document.createElement('div');
    passRow.className = 'lp-pass-wrap';
    const passInput = document.createElement('input');
    passInput.id = 'lp-password';
    passInput.type = 'password';
    passInput.autocomplete = 'current-password';
    passInput.placeholder = '••••••••';
    passInput.className = 'lp-input';
    passInput.style.paddingLeft = '44px';
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.className = 'lp-eye-btn';
    eyeBtn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    eyeBtn.addEventListener('click', () => {
      this._state.showPassword = !this._state.showPassword;
      passInput.type = this._state.showPassword ? 'text' : 'password';
      eyeBtn.innerHTML = this._state.showPassword
        ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`
        : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    });
    passRow.appendChild(passInput);
    passRow.appendChild(eyeBtn);
    passWrap.appendChild(passLabel);
    passWrap.appendChild(passRow);
    card.appendChild(passWrap);

    // رسالة الخطأ
    const errEl = document.createElement('div');
    errEl.id = 'lp-err';
    errEl.className = 'lp-err';
    card.appendChild(errEl);

    // زر الدخول
    const submitBtn = document.createElement('button');
    submitBtn.id = 'lp-submit';
    submitBtn.className = 'lp-submit';
    submitBtn.textContent = 'دخول';
    submitBtn.addEventListener('click', () => this._handleLogin(emailInput, passInput, submitBtn, errEl));
    [emailInput, passInput].forEach(inp =>
      inp.addEventListener('keydown', e => { if (e.key === 'Enter') this._handleLogin(emailInput, passInput, submitBtn, errEl); })
    );
    card.appendChild(submitBtn);

    // إذا كان Quick Login مُفعَّلاً → زر الرجوع
    if (this._state.quickEnabled) {
      const backBtn = document.createElement('button');
      backBtn.className = 'lp-back-ql';
      backBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg><span>⚡ الدخول السريع (هذا الجهاز)</span>`;
      backBtn.addEventListener('click', () => this._switchToCalc());
      card.appendChild(backBtn);
    }

    // زر الدخول بدون إنترنت
    const offlineBtn = document.createElement('button');
    offlineBtn.className = 'lp-offline-btn';
    offlineBtn.innerHTML = '🔌 الدخول بدون إنترنت';
    offlineBtn.addEventListener('click', () => this._offlineLogin());
    card.appendChild(offlineBtn);

    // تذييل بسيط
    const footer = document.createElement('div');
    footer.style.cssText = 'margin-top:18px;text-align:center;font-size:0.68rem;color:#94a3b8;';
    footer.textContent = `v${APP_CONFIG?.VERSION || '1.0.0'} · نظام أبو حذيفة للصرافة والتحويلات`;
    card.appendChild(footer);

    setTimeout(() => emailInput.focus(), 100);
    return card;
  },

  // ─────────────────────────────────────────────────────────
  // الدخول بدون إنترنت — يُبدّل للبطاقة المخصصة
  // ─────────────────────────────────────────────────────────
  async _offlineLogin() {
    if (typeof OfflineAuthService === 'undefined') {
      showToast('خدمة Offline غير محمَّلة', 'error');
      return;
    }

    // ── جمع جلسات hasPin=true من localStorage ──
    const sessions = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('ahu_offline_session_')) continue;
        try {
          const data = JSON.parse(localStorage.getItem(key) || '{}');
          if (data?.hasPin === true && data?.userId) {
            sessions.push({ userId: data.userId });
          }
        } catch { continue; }
      }
    } catch { /* localStorage غير متاح */ }

    // لا توجد جلسات مُفعَّلة → إشعار وبقاء في المكان
    if (sessions.length === 0) {
      showToast(
        'سجّل الدخول بالبريد الإلكتروني أولاً ثم فعّل الدخول بدون إنترنت من إعداداتك',
        'warning',
        6000
      );
      return;
    }

    // حساب واحد → انتقال مباشر لواجهة PIN
    if (sessions.length === 1) {
      this._showPinInterface(sessions[0].userId);
      return;
    }

    // متعدد → جلب أسماء من Dexie ثم عرض قائمة الاختيار
    const accounts = [];
    for (const s of sessions) {
      let displayName   = 'مستخدم غير معروف';
      let accountNumber = '—';
      if (typeof db !== 'undefined' && db.isOpen()) {
        try {
          const user = await db.users.get(s.userId);
          if (user) {
            displayName   = user.display_name   || displayName;
            accountNumber = user.account_number || accountNumber;
          }
        } catch { /* Dexie غير متاحة */ }
      }
      accounts.push({ ...s, displayName, accountNumber });
    }

    this._state.offlineAccounts = accounts;
    this._state.view = 'account-selector';
    this._renderView();
  },

  // ─────────────────────────────────────────────────────────
  // واجهة PIN — نقطة الدخول
  // ─────────────────────────────────────────────────────────
  _showPinInterface(userId) {
    this._state.pendingPinUserId = userId;
    this._state.currentPinInput  = '';
    this._state.pinVerifying     = false;
    this._state.view = 'pin';
    this._renderView();
  },

  // ─────────────────────────────────────────────────────────
  // بناء بطاقة PIN
  // ─────────────────────────────────────────────────────────
  _buildPinCard() {
    const { currentPinInput, pinVerifying } = this._state;
    const MAX_PIN = 6;

    const card = document.createElement('div');
    card.className = 'lp-card offline-card';

    // رأس
    const header = document.createElement('div');
    header.className = 'offline-header';
    header.innerHTML = `
      <div class="offline-icon-wrap">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <div class="offline-title-col">
        <div class="offline-title">الدخول بدون إنترنت</div>
        <div class="offline-subtitle">أدخل رمز PIN</div>
      </div>`;
    card.appendChild(header);

    // 6 نقاط
    const dotsRow = document.createElement('div');
    dotsRow.className = 'pin-dots-row';
    for (let i = 0; i < MAX_PIN; i++) {
      const dot = document.createElement('div');
      dot.className = 'pin-dot' + (i < currentPinInput.length ? ' filled' : '');
      dotsRow.appendChild(dot);
    }
    card.appendChild(dotsRow);

    // منطقة الحالة (خطأ / تحميل)
    const statusEl = document.createElement('div');
    statusEl.id        = 'pin-status';
    statusEl.className = 'pin-status';
    card.appendChild(statusEl);

    // لوحة المفاتيح: 1-9 ثم ⌫ 0 ✓
    const keypad = document.createElement('div');
    keypad.className = 'pin-keypad';
    const keys = [
      { label:'1', cls:'', val:'1' }, { label:'2', cls:'', val:'2' }, { label:'3', cls:'', val:'3' },
      { label:'4', cls:'', val:'4' }, { label:'5', cls:'', val:'5' }, { label:'6', cls:'', val:'6' },
      { label:'7', cls:'', val:'7' }, { label:'8', cls:'', val:'8' }, { label:'9', cls:'', val:'9' },
      { label:'⌫', cls:' pin-key-del', val:'del' },
      { label:'0', cls:'', val:'0' },
      { label:'✓', cls:' pin-key-ok',  val:'ok'  },
    ];
    keys.forEach(({ label, cls, val }) => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'pin-key' + cls;
      btn.textContent = label;
      btn.disabled  = pinVerifying;
      btn.addEventListener('click', () => this._handlePinInput(val));
      keypad.appendChild(btn);
    });
    card.appendChild(keypad);

    // زر الرجوع
    const backBtn = document.createElement('button');
    backBtn.type      = 'button';
    backBtn.className = 'offline-back-btn';
    backBtn.style.marginTop = '12px';
    backBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      <span>العودة</span>`;
    backBtn.addEventListener('click', () => {
      // إذا جاء من قائمة اختيار → ارجع إليها، وإلا ارجع للآلة
      if (this._state.offlineAccounts.length > 0) {
        this._state.view = 'account-selector';
        this._renderView();
      } else {
        this._switchToCalc();
      }
    });
    card.appendChild(backBtn);

    return card;
  },

  // ─────────────────────────────────────────────────────────
  // معالجة إدخال PIN
  // ─────────────────────────────────────────────────────────
  _handlePinInput(val) {
    if (this._state.pinVerifying) return;
    const cur = this._state.currentPinInput;
    const MAX = 6;

    if (val === 'del') {
      this._state.currentPinInput = cur.slice(0, -1);
    } else if (val === 'ok') {
      if (cur.length >= 4) {
        this._verifyPin();
        return; // _verifyPin يستدعي _renderView بنفسه
      } else {
        const el = document.getElementById('pin-status');
        if (el) el.textContent = 'PIN يجب أن يكون 4 أرقام على الأقل';
      }
      return;
    } else {
      if (cur.length < MAX) {
        this._state.currentPinInput = cur + val;
        // تحقق تلقائي عند الوصول لـ 6 أرقام
        if (this._state.currentPinInput.length === MAX) {
          this._state.pinVerifying = true; // ✅ أغلق النافذة قبل setTimeout
          this._renderView();
          setTimeout(() => this._verifyPin(), 250);
          return;
        }
      }
    }
    this._renderView();
  },

  // ─────────────────────────────────────────────────────────
  // التحقق من PIN
  // ─────────────────────────────────────────────────────────
  async _verifyPin() {
    const { pendingPinUserId, currentPinInput } = this._state;
    if (!pendingPinUserId || !currentPinInput) return;

    this._state.pinVerifying = true;
    this._renderView();

    const statusEl = document.getElementById('pin-status');
    if (statusEl) statusEl.textContent = '⏳ جارٍ التحقق...';

    try {
      const result = await OfflineAuthService.verifyOfflineSession(pendingPinUserId, currentPinInput);

      if (isOk(result)) {
        // لقطة الملف من خزنة PIN كاحتياط إن لم يوجد في Dexie
        const vaultProfile = result?.data?.payload?.profile || null;
        await this._enterOfflineMode(pendingPinUserId, vaultProfile);
      } else {
        this._state.currentPinInput = '';
        this._state.pinVerifying    = false;
        this._renderView();
        const el = document.getElementById('pin-status');
        if (el) {
          el.textContent = result.error || 'PIN غير صحيح';
          // رسالة برتقالية: عدد المحاولات المتبقية إن وُجد
        }
      }
    } catch (e) {
      this._state.currentPinInput = '';
      this._state.pinVerifying    = false;
      this._renderView();
      if (window.showToast) showToast('خطأ في التحقق: ' + e.message, 'error');
    }
  },

  // ─────────────────────────────────────────────────────────
  // دخول وضع Offline بعد التحقق الناجح
  // ─────────────────────────────────────────────────────────
  async _enterOfflineMode(userId, fallbackProfile = null) {
    AuthState.isOffline = true; // ✅ يُضبط فوراً قبل أي await لتجنب race condition

    // جلب بروفايل المستخدم من Dexie
    let user = null;
    if (typeof db !== 'undefined' && db.isOpen()) {
      try { user = await db.users.get(userId); } catch { }
    }

    // احتياط: لقطة الملف من خزنة PIN إن تعذّر جلبه من Dexie
    if (!user && fallbackProfile) user = fallbackProfile;

    if (!user) {
      AuthState.isOffline = false; // ✅ تراجع عند الفشل
      showToast('لم يُعثر على بيانات المستخدم محلياً', 'error');
      this._state.pinVerifying = false;
      this._renderView();
      return;
    }
    if (!user.is_active) {
      AuthState.isOffline = false; // ✅ تراجع عند الفشل
      showToast('تم تعطيل هذا الحساب. راجع المدير.', 'error');
      this._state.pinVerifying = false;
      this._renderView();
      return;
    }

    AuthState.isOffline     = true;
    AuthState.currentUser   = user;
    AuthState.authUser      = null;
    AuthState.isInitialized = true;

    saveSession({
      userId       : user.id,
      displayName  : user.display_name,
      username     : user.username,
      isOffline    : true,
      accountNumber: user.account_number,
    });

    showToast(`🔌 مرحباً ${user.display_name} — وضع Offline`, 'success');

    if (this._onSuccess) {
      this._onSuccess(user);
    }
  },

  // ─────────────────────────────────────────────────────────
  // بطاقة اختيار الحساب (عند وجود أكثر من حساب Offline)
  // ─────────────────────────────────────────────────────────
  _buildAccountSelectorCard() {
    const card = document.createElement('div');
    card.className = 'lp-card offline-card';

    // رأس البطاقة
    const header = document.createElement('div');
    header.className = 'offline-header';
    header.innerHTML = `
      <div class="offline-icon-wrap">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
          <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
      </div>
      <div class="offline-title-col">
        <div class="offline-title">الدخول بدون إنترنت</div>
        <div class="offline-subtitle">اختر حساباً للمتابعة</div>
      </div>`;
    card.appendChild(header);

    // قائمة الحسابات
    const list = document.createElement('div');
    list.style.cssText = 'display:flex;flex-direction:column;margin-bottom:14px;';

    (this._state.offlineAccounts || []).forEach(acc => {
      const btn = document.createElement('button');
      btn.type      = 'button';
      btn.className = 'offline-account-item';
      btn.innerHTML = `
        <div class="offline-account-avatar">${escapeHtml((acc.displayName || '؟').charAt(0))}</div>
        <div class="offline-account-info">
          <div class="offline-account-name">${escapeHtml(acc.displayName)}</div>
          <div class="offline-account-num">${escapeHtml(acc.accountNumber)}</div>
        </div>`;
      btn.addEventListener('click', () => this._showPinInterface(acc.userId));
      list.appendChild(btn);
    });
    card.appendChild(list);

    // زر الرجوع
    const backBtn = document.createElement('button');
    backBtn.type      = 'button';
    backBtn.className = 'offline-back-btn';
    backBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      <span>العودة للآلة الحاسبة</span>`;
    backBtn.addEventListener('click', () => this._switchToCalc());
    card.appendChild(backBtn);

    return card;
  },

  // ─────────────────────────────────────────────────────────
  // بناء بطاقة الدخول بدون إنترنت
  // ─────────────────────────────────────────────────────────
  _buildOfflineCard() {
    const card = document.createElement('div');
    card.className = 'lp-card offline-card';

    // ── رأس البطاقة ──
    const header = document.createElement('div');
    header.className = 'offline-header';
    header.innerHTML = `
      <div class="offline-icon-wrap">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <line x1="1" y1="1" x2="23" y2="23"/>
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
          <line x1="12" y1="20" x2="12.01" y2="20"/>
        </svg>
      </div>
      <div class="offline-title-col">
        <div class="offline-title">الدخول بدون إنترنت</div>
        <div class="offline-subtitle">يعمل بالبيانات المحفوظة محلياً</div>
      </div>`;
    card.appendChild(header);

    // ── بنر معلومات ──
    const banner = document.createElement('div');
    banner.className = 'offline-info-banner';
    banner.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <span>يتطلب تسجيل دخول بالإنترنت مرة واحدة مسبقاً. الحسابات المحفوظة محلياً تعمل بدون اتصال.</span>`;
    card.appendChild(banner);

    // ── حقل البحث ──
    const searchLabel = document.createElement('label');
    searchLabel.style.cssText = 'display:block;font-size:0.78rem;font-weight:600;color:#64748b;margin-bottom:6px;';
    searchLabel.textContent = 'اسم المستخدم أو رقم الحساب';
    card.appendChild(searchLabel);

    const searchRow = document.createElement('div');
    searchRow.className = 'offline-search-row';

    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'offline-search-input';
    searchInput.placeholder = 'أدخل اسم المستخدم أو رقم الحساب';
    searchInput.autocomplete = 'off';
    searchInput.autocapitalize = 'off';

    const searchBtn = document.createElement('button');
    searchBtn.type = 'button';
    searchBtn.className = 'offline-search-btn';
    searchBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <span>بحث</span>`;

    searchRow.appendChild(searchInput);
    searchRow.appendChild(searchBtn);
    card.appendChild(searchRow);

    // منطقة الخطأ والنتيجة
    const errEl = document.createElement('div');
    errEl.className = 'offline-err';
    card.appendChild(errEl);

    const resultArea = document.createElement('div');
    resultArea.id = 'offline-result-area';
    card.appendChild(resultArea);

    // زر الدخول (مخفي في البداية)
    const proceedBtn = document.createElement('button');
    proceedBtn.type = 'button';
    proceedBtn.className = 'offline-proceed-btn';
    proceedBtn.disabled = true;
    proceedBtn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span>دخول بـ PIN</span>`;
    proceedBtn.style.display = 'none';
    card.appendChild(proceedBtn);

    // ── زر الرجوع ──
    const backBtn = document.createElement('button');
    backBtn.type = 'button';
    backBtn.className = 'offline-back-btn';
    backBtn.innerHTML = `
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="15 18 9 12 15 6"/>
      </svg>
      <span>العودة لتسجيل الدخول</span>`;
    backBtn.addEventListener('click', () => this._switchToLogin());
    card.appendChild(backBtn);

    // ── ربط أحداث البحث ──
    const doSearch = () => this._offlineSearchUser(searchInput, resultArea, errEl, proceedBtn);
    searchBtn.addEventListener('click', doSearch);
    searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
    proceedBtn.addEventListener('click', () => this._offlineProceed(errEl));

    setTimeout(() => searchInput.focus(), 100);
    return card;
  },

  // ─────────────────────────────────────────────────────────
  // بحث عن المستخدم في Dexie
  // ─────────────────────────────────────────────────────────
  async _offlineSearchUser(searchInput, resultArea, errEl, proceedBtn) {
    const q = searchInput.value.trim();
    errEl.innerHTML = '';
    resultArea.innerHTML = '';
    proceedBtn.style.display = 'none';
    proceedBtn.disabled = true;
    this._state.offlineUser = null;

    if (!q) {
      errEl.innerHTML = '<span>⚠️</span><span>أدخل اسم المستخدم أو رقم الحساب</span>';
      searchInput.focus();
      return;
    }

    // حالة التحميل
    const searchBtn = searchInput.nextElementSibling;
    if (searchBtn) { searchBtn.disabled = true; searchBtn.querySelector('span').textContent = '...'; }

    // ✅ guard للـ db
    if (typeof db === 'undefined' || !db.isOpen()) {
      errEl.innerHTML = '<span>❌</span><span>قاعدة البيانات المحلية غير متاحة</span>';
      if (searchBtn) { searchBtn.disabled = false; searchBtn.querySelector('span').textContent = 'بحث'; }
      return;
    }

    let user = null;
    try {
      const qLow = q.toLowerCase();
      user = await db.users.filter(u =>
        (u.username  && u.username.toLowerCase()  === qLow) ||
        (u.display_name && u.display_name.toLowerCase() === qLow) ||
        (u.account_number && u.account_number.toLowerCase() === qLow)
      ).first();
    } catch (e) {
      errEl.innerHTML = `<span>❌</span><span>خطأ في البحث: ${escapeHtml(e.message)}</span>`;
    } finally {
      if (searchBtn) { searchBtn.disabled = false; searchBtn.querySelector('span').textContent = 'بحث'; }
    }

    if (!user) {
      errEl.innerHTML = '<span>⚠️</span><span>لم يُعثر على هذا المستخدم محلياً. سجّل الدخول بالإنترنت أولاً.</span>';
      return;
    }

    if (!user.is_active) {
      errEl.innerHTML = '<span>🚫</span><span>تم تعطيل هذا الحساب. راجع المدير.</span>';
      return;
    }

    // عرض كرت المستخدم
    this._state.offlineUser = user;
    // ✅ guard للـ OfflineAuthService
    if (typeof OfflineAuthService === 'undefined') {
      errEl.innerHTML = '<span>❌</span><span>خدمة Offline غير محمَّلة</span>';
      return;
    }
    const hasPin   = !!OfflineAuthService.getOfflineSession(user.id)?.hasPin;
    const initials = (user.display_name || '?').charAt(0);

    resultArea.innerHTML = `
      <div class="offline-user-card">
        <div class="offline-user-avatar">${escapeHtml(initials)}</div>
        <div class="offline-user-info">
          <div class="offline-user-name">${escapeHtml(user.display_name || user.username)}</div>
          <div class="offline-user-meta">${escapeHtml(user.account_number || user.username || '')}</div>
        </div>
        <span class="offline-user-badge">${hasPin ? '🔐 PIN محفوظ' : '🆕 جديد'}</span>
      </div>`;

    proceedBtn.style.display = 'flex';
    proceedBtn.disabled = false;
    proceedBtn.querySelector('span').textContent = hasPin ? 'دخول بـ PIN' : 'إعداد PIN والدخول';
  },

  // ─────────────────────────────────────────────────────────
  // إجراء الدخول بعد اختيار المستخدم
  // ─────────────────────────────────────────────────────────
  async _offlineProceed(errEl) {
    const user = this._state.offlineUser;
    if (!user) return;

    errEl.innerHTML = '';

    const session = OfflineAuthService.getOfflineSession(user.id);

    if (!session?.hasPin) {
      // أول مرة: إنشاء PIN
      if (isOfflineMode() || !isOnline()) {
        errEl.innerHTML = '<span>⚠️</span><span>تفعيل الدخول بدون إنترنت يتطلب اتصالاً للمرة الأولى</span>';
        return;
      }

      const pin = await PinDialog.showCreate({ userId: user.id });
      if (!pin) return;

      const createResult = await OfflineAuthService.createOfflineSession(user.id, pin);
      if (!isOk(createResult)) {
        errEl.innerHTML = `<span>❌</span><span>${escapeHtml(createResult.error)}</span>`;
        return;
      }
      showToast('تم تفعيل الدخول بدون إنترنت بنجاح', 'success');

    } else {
      // جلسة موجودة: التحقق من PIN
      const pin = await PinDialog.show({
        title   : 'الدخول بدون إنترنت',
        subtitle: `مرحباً، ${user.display_name}`,
        userId  : user.id,
      });
      if (!pin) return;

      const verifyResult = await OfflineAuthService.verifyOfflineSession(user.id, pin);
      if (!isOk(verifyResult)) {
        PinDialog.showError(
          verifyResult.error,
          verifyResult.details?.remaining
        );
        return;
      }
    }

    // إعداد AuthState وتشغيل التطبيق
    AuthState.isOffline     = true;
    AuthState.currentUser   = user;
    AuthState.authUser      = null;
    AuthState.isInitialized = true;

    saveSession({
      userId       : user.id,
      displayName  : user.display_name,
      username     : user.username,
      isOffline    : true,
      accountNumber: user.account_number,
    });

    if (this._onSuccess) {
      this._onSuccess(user);
    }
  },

  // ─────────────────────────────────────────────────────────
  // تبديل العرض
  // ─────────────────────────────────────────────────────────
  _switchToLogin() {
    if (this._state.view === 'login') return;
    this._state.view = 'login';
    this._state.offlineUser = null;
    this._renderView();
  },

  _switchToCalc() {
    if (this._state.view === 'calc') return;
    this._state.view = 'calc';
    this._state.expression = '';
    this._state.result = '0';
    this._state.justEvaluated = false;
    this._state.offlineUser = null;
    this._renderView();
  },

  // ─────────────────────────────────────────────────────────
  // منطق الآلة الحاسبة
  // ─────────────────────────────────────────────────────────
  _handleKey(v) {
    const s = this._state;
    if (v === 'C') {
      s.expression = ''; s.result = '0'; s.justEvaluated = false;
      this._updateDisplay(); return;
    }
    if (v === 'back') {
      s.expression = s.expression.slice(0, -1);
      this._updateDisplay(s.expression); return;
    }
    if (v === '=') { this._evaluate(); return; }
    if (s.justEvaluated && !'+-*/'.includes(v)) {
      s.expression = ''; s.justEvaluated = false;
    }
    s.expression += v;
    this._updateDisplay(s.expression);
  },

  _handleKeyboard(e) {
    if (this._state.view !== 'calc') return;
    const map = { 'Enter': '=', 'Backspace': 'back', 'Escape': 'C' };
    const key = map[e.key] || (e.key.match(/[\d+\-*.%/]/) ? e.key : null);
    if (!key) return;
    e.preventDefault();
    this._handleKey(key);
  },

  _evaluate() {
    const s = this._state;
    if (!s.expression) return;
    try {
      const parser = new window.exprEval.Parser();
      const val = parser.evaluate(s.expression);
      if (typeof val !== 'number' || !isFinite(val)) { this._flashCalcError('خطأ'); return; }
      const formatted = Number.isInteger(val) ? String(val) : parseFloat(val.toFixed(10)).toString();
      s.result = formatted;
      s.justEvaluated = true;
      this._updateDisplay(s.expression, formatted);

      if (s.quickEnabled && !s.quickPending) {
        this._tryQuickLogin(s.expression);
      }
    } catch {
      this._flashCalcError('خطأ في المعادلة');
    }
  },

  _updateDisplay(expr = '', result = null) {
    const eEl = document.getElementById('calc-expr');
    const rEl = document.getElementById('calc-result');
    if (eEl) eEl.textContent = expr || '';
    const txt = result !== null ? result : (this._state.result || '0');
    if (rEl) {
      rEl.textContent = txt;
      const l = txt.length;
      rEl.style.fontSize = l > 12 ? '1.5rem' : l > 8 ? '2rem' : '2.8rem';
    }
  },

  _flashCalcError(msg) {
    const el = document.getElementById('calc-result');
    if (!el) return;
    el.style.color = '#f87171';
    el.textContent = msg;
    setTimeout(() => {
      el.style.color = '';
      el.textContent = '0';
      this._state.expression = '';
      this._state.result = '0';
      this._state.justEvaluated = false;
    }, 1300);
  },

  // ─────────────────────────────────────────────────────────
  // تحديث ظهور زر البصمة في الآلة الحاسبة
  // المسار الجديد: ahu_bio_* (خزنة بصمة) — مع fallback لـ ahu_quick_*
  // ─────────────────────────────────────────────────────────
  _updateQuickWebAuthnBtnVisibility() {
    const btn = document.getElementById('btn-quick-webauthn');
    if (!btn) return;
    if (!window.PublicKeyCredential) { btn.style.display = 'none'; return; }

    let show = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        // المسار الجديد: بيانات بصمة الخزنة المشفّرة
        if (key?.startsWith('ahu_bio_')) {
          let bio;
          try { bio = JSON.parse(localStorage.getItem(key) || '{}'); } catch { continue; }
          if (bio?.hasWebAuthn === true && bio?.credentialId) { show = true; break; }
          continue;
        }
        // المسار القديم: ahu_quick_* فيه توكن + hasWebAuthn
        if (!key?.startsWith('ahu_quick_')) continue;
        if (key === 'ahu_quick_banner_dismissed') continue;
        let quick;
        try { quick = JSON.parse(localStorage.getItem(key) || '{}'); } catch { continue; }
        if (!quick?.token || !quick?.userId) continue;
        if (quick.expiresAt && new Date().toISOString() > quick.expiresAt) continue;
        if (quick.hasWebAuthn === true) { show = true; break; }
      }
    } catch { /* localStorage غير متاح */ }

    btn.style.display = show ? 'flex' : 'none';
  },

  // ─────────────────────────────────────────────────────────
  // _tryQuickWebAuthnLogin — الدخول السريع بالبصمة (Online)
  // سيُنفَّذ كاملاً في الخطوة 3 — حالياً يستدعي المسار القائم
  // ─────────────────────────────────────────────────────────
  _tryQuickWebAuthnLogin() {
    this._tryWebAuthnLogin();
  },

  async _tryWebAuthnLogin() {
    // البحث عن userId من بيانات البصمة — المسار الجديد (ahu_bio_*) أولاً
    let userId = null;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('ahu_bio_')) continue;
        try {
          const bio = JSON.parse(localStorage.getItem(key) || '{}');
          if (bio?.hasWebAuthn && bio?.credentialId) { userId = key.slice('ahu_bio_'.length); break; }
        } catch { continue; }
      }
    } catch { /* localStorage غير متاح */ }

    // fallback: المسار القديم (ahu_quick_* فيه توكن + بصمة)
    if (!userId) {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (!key?.startsWith('ahu_quick_')) continue;
          if (key === 'ahu_quick_banner_dismissed') continue;
          try {
            const data = JSON.parse(localStorage.getItem(key) || '{}');
            if (data?.hasWebAuthn && data?.token && data?.userId) { userId = data.userId; break; }
          } catch { continue; }
        }
      } catch { /* localStorage غير متاح */ }
    }

    if (!userId) {
      if (window.showToast) showToast('لم يتم العثور على بصمة مُفعَّلة للدخول السريع', 'error');
      return;
    }

    const statusEl = document.getElementById('calc-ql-status');
    const webAuthnBtn = document.getElementById('btn-quick-webauthn');
    if (statusEl) statusEl.textContent = '👆 جارٍ التحقق من البصمة...';
    if (webAuthnBtn) webAuthnBtn.disabled = true;

    try {
      // ✅ البصمة → مصادقة قاعدة البيانات + جلسة Supabase حقيقية
      const result = await AuthService.quickLoginWithWebAuthn(userId);

      if (isOk(result)) {
        if (statusEl) { statusEl.style.color = '#10b981'; statusEl.textContent = '✅ تم التحقق — جاري الدخول...'; }
        if (window.showToast) showToast(`👆 مرحباً ${result.data.profile.display_name}`, 'success');
        setTimeout(() => this._onSuccess?.(result.data.profile), 400);
      } else {
        if (statusEl) { statusEl.style.color = '#f87171'; statusEl.textContent = `❌ ${result.error}`; }
        if (webAuthnBtn) webAuthnBtn.disabled = false;
        setTimeout(() => {
          if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
        }, 2800);
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '';
      if (webAuthnBtn) webAuthnBtn.disabled = false;
      if (window.showToast) showToast('خطأ في التحقق بالبصمة: ' + e.message, 'error');
    }
  },

  // ─────────────────────────────────────────────────────────
  // Quick Login
  // ─────────────────────────────────────────────────────────
  async _tryQuickLogin(equation) {
    const s = this._state;
    if (s.quickPending) return;
    s.quickPending = true;

    const rEl    = document.getElementById('calc-result');
    const statEl = document.getElementById('calc-ql-status');

    if (rEl)    rEl.style.color = '#60a5fa';
    if (statEl) statEl.textContent = '⚡ جاري التحقق...';

    console.log('[LoginComponent v5] _tryQuickLogin: بدء التحقق');

    try {
      const res = await AuthService.quickLogin(equation);
      console.log('[LoginComponent v5] quickLogin result ok:', isOk(res));

      if (isOk(res)) {
        if (rEl)    { rEl.style.color = '#10b981'; rEl.textContent = '✓'; }
        if (res.data?.offlineSession) {
          if (statEl) statEl.textContent = '🔌 لا يوجد إنترنت — جاري الدخول في وضع Offline...';
          if (window.showToast) showToast(`🔌 مرحباً ${res.data.profile.display_name} — وضع Offline`, 'warning');
        } else {
          if (statEl) statEl.textContent = '✅ تم التحقق — جاري الدخول...';
          if (window.showToast) showToast(`⚡ مرحباً ${res.data.profile.display_name}`, 'success');
        }
        setTimeout(() => this._onSuccess?.(res.data.profile), 400);
      } else {
        if (rEl)    { rEl.style.color = '#f87171'; }
        // عرض رسالة خطأ واضحة — رسالة "لا إنترنت" أو "انتهت صلاحية" تُعرض كاملة لتوجيه المستخدم
        const errMsg = res.error?.includes('قفل') || res.error?.includes('محاولات') || res.error?.includes('🔌') || res.error?.includes('انتهت صلاحية')
          ? res.error
          : 'المعادلة غير صحيحة، حاول مرة أخرى';
        if (statEl) {
          statEl.style.color = '#f87171';
          statEl.textContent = `❌ ${errMsg}`;
          setTimeout(() => {
            if (statEl) { statEl.textContent = ''; statEl.style.color = '#60a5fa'; }
            if (rEl) rEl.style.color = '';
          }, 2500);
        }
      }
    } catch (e) {
      console.error('[LoginComponent v5] خطأ في _tryQuickLogin:', e);
      if (rEl)    rEl.style.color = '';
      if (statEl) statEl.textContent = '';
    } finally {
      s.quickPending = false;
    }
  },

  // ─────────────────────────────────────────────────────────
  // Traditional Login
  // ─────────────────────────────────────────────────────────
  async _handleLogin(emailInput, passInput, btn, errEl) {
    if (this._state.isLoading) return;

    const email    = emailInput.value.trim();
    const password = passInput.value;
    errEl.innerHTML = '';

    if (!email) {
      errEl.innerHTML = '<span>⚠️</span><span>أدخل البريد الإلكتروني</span>';
      emailInput.focus(); return;
    }
    if (!password) {
      errEl.innerHTML = '<span>⚠️</span><span>أدخل كلمة المرور</span>';
      passInput.focus(); return;
    }

    this._state.isLoading = true;
    btn.disabled = true;
    btn.innerHTML = `<div class="lp-spinner"></div><span>جاري التحقق...</span>`;

    const result = await AuthService.login(email, password);

    btn.disabled = false;
    btn.innerHTML = 'دخول';
    this._state.isLoading = false;

    if (isOk(result)) {
      const profile = result.data.profile;
      if (window.showToast) showToast(`مرحباً ${profile.display_name} 👋`, 'success');

      // تحقق من تفضيل الجهاز (هل الجلسة دائمة أم مؤقتة؟)
      const devPrefKey = `ahu_device_pref_${profile.id}`;
      const devPref    = localStorage.getItem(devPrefKey);

      if (!devPref) {
        // أول دخول على هذا الجهاز — اعرض مودال تفضيل الجهاز
        this._showDevicePreferenceModal(profile);
      } else {
        // البانر داخل التطبيق يتولى تذكير المستخدم بإعداد الدخول السريع
        setTimeout(() => this._onSuccess?.(profile), 400);
      }
    } else {
      errEl.innerHTML = `<span>❌</span><span>${escapeHtml(result.error)}</span>`;
      passInput.value = '';
      passInput.focus();
      const card = errEl.closest('.login-card');
      if (card) {
        card.style.animation = 'lp-shake 0.4s ease';
        setTimeout(() => { card.style.animation = ''; }, 450);
      }
    }
  },

  // ─────────────────────────────────────────────────────────
  // Modal تفضيل الجهاز (يظهر مرة واحدة عند أول دخول)
  // ─────────────────────────────────────────────────────────
  _showDevicePreferenceModal(profile) {
    const overlay = document.createElement('div');
    overlay.className = 'ql-setup-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'ql-setup-sheet';
    sheet.innerHTML = `
      <div style="text-align:center;font-size:2rem;margin-bottom:10px;">📱</div>
      <div class="ql-setup-title">هل تريد البقاء مسجلاً الدخول؟</div>
      <div class="ql-setup-desc">
        اختر طريقة حفظ جلستك على هذا الجهاز.<br>
        يمكنك تغيير هذا لاحقاً من إعدادات الملف الشخصي.
      </div>
      <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
        <button id="dev-pref-yes" style="
          width:100%;padding:14px 16px;border:none;border-radius:14px;
          background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;
          font-size:.94rem;font-weight:700;cursor:pointer;font-family:inherit;
          display:flex;align-items:center;gap:10px;box-shadow:0 4px 14px rgba(37,99,235,.35);">
          <span style="font-size:1.4rem;">✅</span>
          <div style="text-align:right;">
            <div>نعم — ابقَ مسجلاً الدخول</div>
            <div style="font-size:.75rem;opacity:.8;font-weight:400;">الجلسة تبقى حتى بعد إغلاق المتصفح (8 ساعات)</div>
          </div>
        </button>
        <button id="dev-pref-no" style="
          width:100%;padding:14px 16px;border:1px solid rgba(15,23,42,.15);
          border-radius:14px;background:transparent;
          color:var(--text-secondary,#475569);
          font-size:.94rem;font-weight:600;cursor:pointer;font-family:inherit;
          display:flex;align-items:center;gap:10px;">
          <span style="font-size:1.4rem;">🔒</span>
          <div style="text-align:right;">
            <div>لا — جلسة مؤقتة فقط</div>
            <div style="font-size:.75rem;opacity:.7;font-weight:400;">تُحذف الجلسة عند إغلاق المتصفح</div>
          </div>
        </button>
      </div>`;

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    const uid = profile.id;

    const proceed = (pref) => {
      overlay.remove();
      localStorage.setItem(`ahu_device_pref_${uid}`, pref);
      setTimeout(() => this._onSuccess?.(profile), 300);
    };

    document.getElementById('dev-pref-yes')?.addEventListener('click', () => proceed('persistent'));
    document.getElementById('dev-pref-no')?.addEventListener('click',  () => proceed('temporary'));
  },

  // ─────────────────────────────────────────────────────────
  _toggleDark() {
    if (window.ThemeManager) {
      const isDark = ThemeManager.toggle();
      if (window.showToast) showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
    } else {
      const isDark = document.body.classList.toggle('dark-mode');
      localStorage.setItem('abu_theme', isDark ? 'dark' : 'light');
      if (window.showToast) showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
    }
  },

  _showAbout() {
    const v = APP_CONFIG?.VERSION || '1.0.0';
    if (window.showToast) showToast(`نظام أبو حذيفة v${v} — نظام مالي Offline-First`, 'info', 4000);
  },

  // ─────────────────────────────────────────────────────────
  destroy() {
    if (this._kbHandler) {
      document.removeEventListener('keydown', this._kbHandler);
      this._kbHandler = null;
    }
  },
};

window.LoginComponent = LoginComponent;
console.log('✅ LoginComponent v5.3 — بطاقة الدخول بدون إنترنت + بحث Dexie + PIN Flow');
