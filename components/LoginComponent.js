/**
 * components/LoginComponent.js — v5.0 Phase1
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
      if (k?.startsWith('ahu_quick_')) {
        const d = JSON.parse(localStorage.getItem(k) || '{}');
        if (d.hash) return true;
      }
    }
  } catch {}
  return false;
}

// ─── أنماط CSS ─────────────────────────────────────────────
const _CSS = `
  /* ── صفحة تسجيل الدخول ── */
  .lp-wrap {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    position: relative;
    overflow: hidden;
    background: linear-gradient(135deg, #0f172a 0%, #1e3a5f 55%, #0f172a 100%);
    transition: background 0.4s;
  }
  body.dark-mode .lp-wrap {
    background: linear-gradient(135deg, #060b14 0%, #0f1e35 55%, #060b14 100%);
  }

  /* ── خلفية زخرفية ── */
  .lp-bg-orb {
    position: absolute;
    border-radius: 50%;
    pointer-events: none;
  }
  .lp-bg-orb-1 {
    width: 480px; height: 480px;
    background: radial-gradient(circle, rgba(37,99,235,0.15) 0%, transparent 70%);
    top: -100px; right: -80px;
    animation: lp-pulse 6s ease-in-out infinite;
  }
  .lp-bg-orb-2 {
    width: 320px; height: 320px;
    background: radial-gradient(circle, rgba(16,185,129,0.10) 0%, transparent 70%);
    bottom: -60px; left: -60px;
    animation: lp-pulse 8s ease-in-out infinite 2.5s;
  }
  @keyframes lp-pulse { 0%,100% { opacity:.5; } 50% { opacity:1; } }

  /* ── شعار أعلى الشاشة ── */
  .lp-brand {
    position: absolute;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 10px;
    z-index: 20;
  }
  .lp-brand-icon {
    width: 36px; height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 14px rgba(37,99,235,0.45);
  }
  .lp-brand-name {
    color: rgba(255,255,255,0.90);
    font-size: 0.88rem;
    font-weight: 600;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  /* ── حاوية البطاقة ── */
  .lp-scene {
    width: 100%;
    max-width: 360px;
    position: relative;
    z-index: 10;
  }

  /* ── بطاقة Base ── */
  .lp-card {
    border-radius: 28px;
    padding: 28px 24px 24px;
    animation: lp-scale-in 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  @keyframes lp-scale-in {
    from { opacity:0; transform:scale(0.94) translateY(8px); }
    to   { opacity:1; transform:scale(1)    translateY(0); }
  }

  /* ── بطاقة الآلة الحاسبة (تفعيل القفلية) ── */
  .calc-card {
    background: #1c1c1e;
    border: none;
    box-shadow: 0 40px 100px rgba(0,0,0,0.70);
  }
  .calc-display {
    background: transparent;
    border: none;
    padding: 8px 12px 18px;
    margin-bottom: 12px;
    text-align: right;
    direction: ltr;
    min-height: 110px;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    overflow: hidden;
  }
  .calc-expr   { color:rgba(255,255,255,0.40); font-size:0.88rem; min-height:20px; word-break:break-all; margin-bottom:6px; font-family:var(--font-mono,monospace); text-align:right; }
  .calc-result { color:#fff; font-size:3rem; font-weight:300; line-height:1.1; word-break:break-all; text-align:right; transition:font-size 150ms,color 150ms; letter-spacing:-1px; }

  /* ── مؤشر Quick Login ── */
  .calc-ql-badge {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(37,99,235,0.18);
    border: 1px solid rgba(37,99,235,0.35);
    border-radius: 10px;
    margin-bottom: 12px;
    color: #93c5fd;
    font-size: 0.78rem;
  }
  .calc-ql-badge-dot {
    width: 7px; height: 7px;
    border-radius: 50%;
    background: #3b82f6;
    flex-shrink: 0;
    box-shadow: 0 0 0 2px rgba(59,130,246,0.3);
    animation: ql-dot-pulse 2s ease-in-out infinite;
  }
  @keyframes ql-dot-pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }

  /* ── شبكة الأزرار ── */
  .ios-calc-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:12px; }
  .calc-btn {
    aspect-ratio: 1/1;
    border: none;
    border-radius: 50%;
    font-size: 1.4rem;
    font-weight: 500;
    cursor: pointer;
    font-family: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: filter 80ms, transform 80ms;
    -webkit-tap-highlight-color: transparent;
    user-select: none;
    line-height: 1;
  }
  .calc-btn.wide {
    border-radius: 999px;
    aspect-ratio: auto;
    grid-column: span 2;
    justify-content: flex-start;
    padding: 0 0 0 28px;
  }
  .calc-btn-num  { background:#333333; color:#fff; }
  .calc-btn-op   { background:#2563eb; color:#fff; }
  .calc-btn-fn   { background:#334155; color:#94a3b8; }
  .calc-btn-eq   { background:#2563eb; color:#fff; }
  .calc-btn:active, .calc-btn.pressed { transform:scale(0.88); filter:brightness(1.3); }
  .calc-btn-num:hover { filter:brightness(1.15); }
  .calc-btn-op:hover  { filter:brightness(1.12); }
  .calc-btn-fn:hover  { filter:brightness(1.12); }

  .calc-ql-status {
    text-align: center;
    font-size: 0.78rem;
    color: #3b82f6;
    margin-top: 8px;
    min-height: 20px;
    transition: color 200ms;
  }

  /* ── زر التبديل للتسجيل التقليدي ── */
  .lp-switch-btn {
    width: 100%;
    margin-top: 14px;
    padding: 12px;
    background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.14);
    border-radius: 14px;
    color: rgba(255,255,255,0.70);
    font-size: 0.88rem;
    font-family: inherit;
    cursor: pointer;
    transition: all 150ms;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .lp-switch-btn:hover {
    background: rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.90);
  }

  /* ── بطاقة التسجيل التقليدي ── */
  .login-card {
    background: rgba(255,255,255,0.94);
    backdrop-filter: blur(28px);
    -webkit-backdrop-filter: blur(28px);
    border: 1px solid rgba(15,23,42,0.08);
    box-shadow: 0 32px 80px rgba(15,23,42,0.20), inset 0 1px 0 rgba(255,255,255,0.6);
  }
  body.dark-mode .login-card {
    background: rgba(15,23,42,0.94);
    border-color: rgba(248,250,252,0.08);
  }

  .lp-logo-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    margin-bottom: 22px;
  }
  .lp-logo-circle {
    width: 44px; height: 44px;
    border-radius: 12px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    display: flex; align-items: center; justify-content: center;
    box-shadow: 0 4px 16px rgba(37,99,235,0.40);
    flex-shrink: 0;
  }
  .lp-form-title {
    font-size: 1.10rem;
    font-weight: 700;
    color: var(--text-primary, #0f172a);
  }
  body.dark-mode .lp-form-title { color: #f1f5f9; }

  .lp-label {
    display: block;
    font-size: 0.80rem;
    font-weight: 600;
    margin-bottom: 6px;
    color: var(--text-secondary, #475569);
  }
  body.dark-mode .lp-label { color: #94a3b8; }

  .lp-input {
    width: 100%;
    padding: 12px 16px;
    border-radius: 12px;
    background: rgba(15,23,42,0.05);
    border: 1.5px solid rgba(15,23,42,0.12);
    color: #0f172a;
    font-size: 0.92rem;
    font-family: inherit;
    transition: border-color 150ms, box-shadow 150ms;
    outline: none;
    box-sizing: border-box;
  }
  .lp-input:focus {
    border-color: rgba(37,99,235,0.60);
    box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
    background: rgba(255,255,255,0.95);
  }
  body.dark-mode .lp-input {
    background: rgba(15,23,42,0.50);
    border-color: rgba(248,250,252,0.12);
    color: #f1f5f9;
  }
  body.dark-mode .lp-input:focus {
    border-color: rgba(59,130,246,0.60);
    background: rgba(30,41,59,0.80);
  }

  .lp-pass-wrap { position: relative; }
  .lp-eye-btn {
    position: absolute;
    left: 12px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-muted, #94a3b8);
    padding: 4px;
    font-size: 1rem;
    line-height: 1;
  }

  .lp-err {
    color: #dc2626;
    font-size: 0.79rem;
    min-height: 18px;
    margin: 8px 0;
    text-align: center;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }

  .lp-submit {
    width: 100%;
    padding: 13px;
    border: none;
    border-radius: 14px;
    background: linear-gradient(135deg, #2563eb, #1d4ed8);
    color: #fff;
    font-size: 0.95rem;
    font-weight: 700;
    cursor: pointer;
    font-family: inherit;
    box-shadow: 0 4px 20px rgba(37,99,235,0.35);
    transition: box-shadow 150ms, transform 150ms, opacity 150ms;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
  }
  .lp-submit:hover {
    box-shadow: 0 6px 28px rgba(37,99,235,0.50);
    transform: translateY(-1px);
  }
  .lp-submit:disabled { opacity: 0.65; cursor: not-allowed; transform: none; }

  /* ── رابط "عودة للدخول السريع" ── */
  .lp-back-ql {
    width: 100%;
    margin-top: 12px;
    padding: 10px;
    background: transparent;
    border: 1px solid rgba(37,99,235,0.25);
    border-radius: 12px;
    color: #2563eb;
    font-size: 0.82rem;
    font-family: inherit;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    transition: background 150ms;
  }
  .lp-back-ql:hover { background: rgba(37,99,235,0.07); }
  body.dark-mode .lp-back-ql { color: #60a5fa; border-color: rgba(96,165,250,0.25); }
  body.dark-mode .lp-back-ql:hover { background: rgba(96,165,250,0.07); }

  /* ── أزرار القائمة ── */
  .lp-menu-btn {
    position: absolute;
    top: 20px;
    right: 20px;
    z-index: 100;
    width: 44px; height: 44px;
    border-radius: 12px;
    background: rgba(255,255,255,0.10);
    border: 1px solid rgba(255,255,255,0.16);
    color: #fff;
    font-size: 1.2rem;
    cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    backdrop-filter: blur(8px);
    transition: background 150ms;
  }
  .lp-menu-btn:hover { background: rgba(255,255,255,0.18); }
  .lp-menu-drop {
    position: absolute;
    top: 52px; right: 0;
    background: rgba(15,20,30,0.97);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 16px;
    padding: 8px;
    min-width: 210px;
    display: none;
    box-shadow: 0 20px 60px rgba(0,0,0,0.50);
    backdrop-filter: blur(24px);
    z-index: 200;
  }
  .lp-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 11px 14px;
    border: none;
    background: transparent;
    color: rgba(255,255,255,0.85);
    font-family: inherit;
    font-size: 0.88rem;
    border-radius: 10px;
    cursor: pointer;
    text-align: right;
    transition: background 150ms;
  }
  .lp-menu-item:hover { background: rgba(255,255,255,0.08); }

  /* ── Modal إعداد الدخول السريع ── */
  .ql-setup-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.60);
    backdrop-filter: blur(4px);
    z-index: 9000;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0;
    animation: lp-fade-in 0.2s ease;
  }
  @keyframes lp-fade-in { from { opacity:0; } to { opacity:1; } }
  .ql-setup-sheet {
    width: 100%;
    max-width: 440px;
    background: var(--bg-card, #fff);
    border-radius: 24px 24px 0 0;
    padding: 24px 24px 32px;
    box-shadow: 0 -20px 60px rgba(0,0,0,0.25);
    animation: lp-slide-up 0.35s cubic-bezier(0.34,1.56,0.64,1);
  }
  body.dark-mode .ql-setup-sheet {
    background: #1e293b;
  }
  @keyframes lp-slide-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }
  .ql-setup-title {
    font-size: 1.05rem;
    font-weight: 700;
    color: var(--text-primary, #0f172a);
    margin-bottom: 6px;
    text-align: center;
  }
  body.dark-mode .ql-setup-title { color: #f1f5f9; }
  .ql-setup-desc {
    font-size: 0.82rem;
    color: var(--text-secondary, #475569);
    text-align: center;
    margin-bottom: 18px;
    line-height: 1.6;
  }
  body.dark-mode .ql-setup-desc { color: #94a3b8; }
  .ql-device-note {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(37,99,235,0.07);
    border: 1px solid rgba(37,99,235,0.18);
    border-radius: 10px;
    margin-bottom: 16px;
    font-size: 0.78rem;
    color: #2563eb;
  }
  body.dark-mode .ql-device-note { color: #60a5fa; background: rgba(96,165,250,0.08); border-color: rgba(96,165,250,0.2); }
  .ql-eq-wrap {
    display: flex;
    gap: 8px;
    margin-bottom: 6px;
  }
  .ql-eq-input {
    flex: 1;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(15,23,42,0.06);
    border: 1.5px solid rgba(15,23,42,0.12);
    color: var(--text-primary, #0f172a);
    font-size: 0.92rem;
    font-family: var(--font-mono, monospace);
    outline: none;
    transition: border-color 150ms;
  }
  .ql-eq-input:focus {
    border-color: rgba(37,99,235,0.50);
    box-shadow: 0 0 0 3px rgba(37,99,235,0.12);
  }
  body.dark-mode .ql-eq-input {
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.12);
    color: #f1f5f9;
  }
  .ql-eq-save {
    padding: 10px 16px;
    border-radius: 10px;
    border: none;
    background: #2563eb;
    color: #fff;
    font-size: 0.85rem;
    font-family: inherit;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: filter 150ms;
  }
  .ql-eq-save:hover { filter: brightness(1.1); }
  .ql-preview {
    font-size: 0.76rem;
    min-height: 18px;
    text-align: center;
    color: var(--text-muted, #94a3b8);
    margin-bottom: 12px;
  }
  .ql-skip-btn {
    width: 100%;
    padding: 10px;
    background: transparent;
    border: 1px solid rgba(15,23,42,0.12);
    border-radius: 12px;
    color: var(--text-muted, #94a3b8);
    font-size: 0.82rem;
    font-family: inherit;
    cursor: pointer;
    transition: background 150ms;
  }
  .ql-skip-btn:hover { background: rgba(15,23,42,0.05); }
  body.dark-mode .ql-skip-btn { border-color: rgba(255,255,255,0.12); }
  body.dark-mode .ql-skip-btn:hover { background: rgba(255,255,255,0.05); }

  /* ── Animations ── */
  @keyframes lp-shake {
    0%,100% { transform:translateX(0); }
    20%     { transform:translateX(-8px); }
    40%     { transform:translateX(8px); }
    60%     { transform:translateX(-5px); }
    80%     { transform:translateX(5px); }
  }
  @keyframes lp-spin {
    to { transform:rotate(360deg); }
  }
  .lp-spinner {
    display: inline-block;
    width: 16px; height: 16px;
    border: 2px solid rgba(255,255,255,0.3);
    border-top-color: #fff;
    border-radius: 50%;
    animation: lp-spin 0.6s linear infinite;
    flex-shrink: 0;
  }
`;

const LoginComponent = {
  _state: {
    // الآلة الحاسبة
    expression   : '',
    result       : '0',
    justEvaluated: false,
    // حالة UI
    view         : 'login',   // 'calc' | 'login'
    menuOpen     : false,
    isLoading    : false,
    showPassword : false,
    quickEnabled : false,
    quickPending : false,
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

    // ربط keyboard بعد render
    this._kbHandler = (e) => this._handleKeyboard(e);
    document.addEventListener('keydown', this._kbHandler);

    console.log(`[LoginComponent v5] view=${this._state.view}, quickEnabled=${this._state.quickEnabled}`);
  },

  // ─────────────────────────────────────────────────────────
  _injectStyles() {
    if (document.getElementById('lp-styles')) return;
    const style = document.createElement('style');
    style.id = 'lp-styles';
    style.textContent = _CSS;
    document.head.appendChild(style);
  },

  // ─────────────────────────────────────────────────────────
  _buildPage() {
    const page = document.createElement('div');
    page.className = 'lp-wrap';

    // خلفية زخرفية
    page.innerHTML = `
      <div class="lp-bg-orb lp-bg-orb-1" aria-hidden="true"></div>
      <div class="lp-bg-orb lp-bg-orb-2" aria-hidden="true"></div>`;

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
    if (this._state.view === 'calc') {
      scene.appendChild(this._buildCalcCard());
    } else {
      scene.appendChild(this._buildLoginCard());
    }
  },

  // ─────────────────────────────────────────────────────────
  _buildBrand() {
    const b = document.createElement('div');
    b.className = 'lp-brand';
    b.innerHTML = `
      <div class="lp-brand-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="7" width="20" height="14" rx="2"/>
          <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
      </div>
      <span class="lp-brand-name">${escapeHtml(APP_CONFIG?.NAME_SHORT || 'أبو حذيفة')}</span>`;
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

    // زر التسجيل التقليدي
    const switchBtn = document.createElement('button');
    switchBtn.className = 'lp-switch-btn';
    switchBtn.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
        <rect x="3" y="11" width="18" height="11" rx="2"/>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
      </svg>
      <span>تسجيل الدخول بالبريد وكلمة المرور</span>`;
    switchBtn.addEventListener('click', () => this._switchToLogin());
    card.appendChild(switchBtn);

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
      <span class="lp-form-title">تسجيل الدخول</span>`;
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

    setTimeout(() => emailInput.focus(), 100);
    return card;
  },

  // ─────────────────────────────────────────────────────────
  // تبديل العرض
  // ─────────────────────────────────────────────────────────
  _switchToLogin() {
    if (this._state.view === 'login') return;
    this._state.view = 'login';
    this._renderView();
  },

  _switchToCalc() {
    if (this._state.view === 'calc') return;
    this._state.view = 'calc';
    this._state.expression = '';
    this._state.result = '0';
    this._state.justEvaluated = false;
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

    console.log(`[LoginComponent v5] _tryQuickLogin: eq="${equation}"`);

    try {
      const res = await AuthService.quickLogin(equation);
      console.log('[LoginComponent v5] quickLogin result:', JSON.stringify(res));

      if (isOk(res)) {
        if (rEl)    { rEl.style.color = '#10b981'; rEl.textContent = '✓'; }
        if (statEl) statEl.textContent = '✅ تم التحقق — جاري الدخول...';
        if (window.showToast) showToast(`⚡ مرحباً ${res.data.profile.display_name}`, 'success');
        setTimeout(() => this._onSuccess?.(res.data.profile), 400);
      } else {
        if (rEl)    rEl.style.color = '';
        if (statEl) statEl.textContent = '';
        // لا نُظهر خطأ — المستخدم يستمر باستخدام الآلة
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

      // إذا لم يكن Quick Login مُفعَّلاً → اعرض Modal الإعداد
      if (!profile.quick_equation_hash) {
        this._showQuickSetupModal(profile);
      } else {
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
  // Modal إعداد Quick Login (يظهر بعد نجاح Traditional Login)
  // ─────────────────────────────────────────────────────────
  _showQuickSetupModal(profile) {
    const overlay = document.createElement('div');
    overlay.className = 'ql-setup-overlay';

    const sheet = document.createElement('div');
    sheet.className = 'ql-setup-sheet';
    sheet.innerHTML = `
      <div style="text-align:center;font-size:2rem;margin-bottom:10px;">⚡</div>
      <div class="ql-setup-title">فعّل الدخول السريع</div>
      <div class="ql-setup-desc">
        ادخل معادلة رياضية بسيطة تحفظها (مثل 12+88).
        في كل مرة تفتح التطبيق، أدخلها في الحاسبة واضغط = للدخول فوراً.
      </div>
      <div class="ql-device-note">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>
        </svg>
        <span>مرتبط بهذا الجهاز فقط — يعمل بدون اتصال</span>
      </div>`;

    const eqWrap = document.createElement('div');
    eqWrap.className = 'ql-eq-wrap';

    const eqInput = document.createElement('input');
    eqInput.type = 'text';
    eqInput.dir = 'ltr';
    eqInput.placeholder = 'مثال: 12+88 أو 5*20';
    eqInput.className = 'ql-eq-input';
    eqInput.autocomplete = 'off';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'ql-eq-save';
    saveBtn.textContent = 'تفعيل';

    eqWrap.appendChild(eqInput);
    eqWrap.appendChild(saveBtn);
    sheet.appendChild(eqWrap);

    const preview = document.createElement('div');
    preview.className = 'ql-preview';
    sheet.appendChild(preview);

    const skipBtn = document.createElement('button');
    skipBtn.className = 'ql-skip-btn';
    skipBtn.textContent = 'تخطّ — سأفعّل لاحقاً من الإعدادات';
    sheet.appendChild(skipBtn);

    overlay.appendChild(sheet);
    document.body.appendChild(overlay);

    // Preview
    eqInput.addEventListener('input', () => {
      if (!preview) return;
      try {
        const p = new window.exprEval.Parser();
        const v = p.evaluate(eqInput.value.trim());
        preview.textContent = `النتيجة: ${v}`;
        preview.style.color = '#10b981';
      } catch {
        preview.textContent = eqInput.value ? 'معادلة غير صالحة' : '';
        preview.style.color = '#f87171';
      }
    });

    // حفظ
    saveBtn.addEventListener('click', async () => {
      const eq = eqInput.value.trim();
      if (!eq) { if (window.showToast) showToast('أدخل معادلة أولاً', 'warning'); return; }
      saveBtn.disabled = true;
      saveBtn.textContent = '...';
      const res = await AuthService.enableQuickLogin(eq);
      if (isOk(res)) {
        if (window.showToast) showToast('⚡ تم تفعيل الدخول السريع!', 'success');
        overlay.remove();
        this._onSuccess?.(profile);
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = 'تفعيل';
        if (window.showToast) showToast(res.error, 'error');
      }
    });

    // Enter في حقل المعادلة
    eqInput.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });

    // تخطّي
    skipBtn.addEventListener('click', () => {
      overlay.remove();
      this._onSuccess?.(profile);
    });

    // إغلاق بالنقر خارج الـ sheet
    overlay.addEventListener('click', e => {
      if (e.target === overlay) {
        overlay.remove();
        this._onSuccess?.(profile);
      }
    });

    setTimeout(() => eqInput.focus(), 300);
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
console.log('✅ LoginComponent v5.0 Phase1 — تدفق Auth مُعاد تصميمه + Quick Login UX محسَّن');
