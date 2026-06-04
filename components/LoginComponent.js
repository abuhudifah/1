/**
 * components/LoginComponent.js — v3.0
 * إصلاحات:
 * 1. الحاسبة تدعم الوضع الفاتح والمظلم بالكامل (CSS variables)
 * 2. المعادلة السريعة تعمل عند الضغط على = فقط (لا عند كل إدخال)
 * 3. تحسين بصري شامل للحاسبة وبطاقة الدخول
 * 4. إصلاح حفظ جلسة الإدارة
 */
'use strict';

const LoginComponent = {
  _state: {
    expression   : '',
    result       : '0',
    justEvaluated: false,
    menuOpen     : false,
    flipped      : false,
    isLoading    : false,
    quickEnabled : false,
    showPassword : false,
  },
  _onSuccess : null,
  _container : null,

  render(container, onSuccess) {
    this._container = container;
    this._onSuccess = onSuccess;
    this._state.quickEnabled = !!sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY);
    this._state.flipped      = false;
    this._state.expression   = '';
    this._state.result       = '0';
    this._state.justEvaluated= false;
    this._state.showPassword = false;
    container.innerHTML = '';

    // حقن أنماط الحاسبة الخاصة بالوضع النهاري
    this._injectCalcStyles();
    container.appendChild(this._buildPage());
  },

  // ─── حقن أنماط CSS للحاسبة تدعم الوضع الفاتح والمظلم ───
  _injectCalcStyles() {
    if (document.getElementById('calc-theme-styles')) return;
    const style = document.createElement('style');
    style.id = 'calc-theme-styles';
    style.textContent = `
      /* حاسبة — الوضع الفاتح */
      .calc-card {
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid rgba(15,23,42,0.10);
        border-radius: 28px;
        padding: 24px 20px 20px;
        box-shadow: 0 32px 80px rgba(15,23,42,0.18),
                    inset 0 1px 0 rgba(255,255,255,0.6);
        animation: scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      .calc-display {
        background: rgba(15,23,42,0.06);
        border: 1px solid rgba(15,23,42,0.08);
        border-radius: 18px;
        padding: 16px 18px;
        margin-bottom: 18px;
        text-align: left;
        direction: ltr;
        min-height: 90px;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        overflow: hidden;
      }
      .calc-expr {
        color: rgba(15,23,42,0.35);
        font-size: 0.82rem;
        min-height: 18px;
        word-break: break-all;
        margin-bottom: 4px;
        font-family: monospace;
      }
      .calc-result {
        color: #0f172a;
        font-size: 2.4rem;
        font-weight: 700;
        line-height: 1.1;
        word-break: break-all;
        transition: font-size 150ms ease, color 150ms ease;
      }
      .calc-btn-num  { background: rgba(15,23,42,0.07); color: #0f172a; border: 1px solid rgba(15,23,42,0.06); }
      .calc-btn-op   { background: rgba(37,99,235,0.18); color: #1d4ed8; border: 1px solid rgba(37,99,235,0.15); }
      .calc-btn-fn   { background: rgba(100,116,139,0.14); color: #475569; border: 1px solid rgba(100,116,139,0.10); }
      .calc-btn-eq   { background: #2563eb; color: #fff; border: none; box-shadow: 0 4px 12px rgba(37,99,235,0.35); }
      .calc-btn-num:hover  { background: rgba(15,23,42,0.13); }
      .calc-btn-op:hover   { background: rgba(37,99,235,0.30); }
      .calc-btn-fn:hover   { background: rgba(100,116,139,0.22); }
      .calc-btn-eq:hover   { background: #1d4ed8; box-shadow: 0 6px 20px rgba(37,99,235,0.50); }
      .login-card {
        background: rgba(255,255,255,0.92);
        backdrop-filter: blur(28px);
        -webkit-backdrop-filter: blur(28px);
        border: 1px solid rgba(15,23,42,0.10);
        border-radius: 28px;
        padding: 28px 24px 24px;
        box-shadow: 0 32px 80px rgba(15,23,42,0.18),
                    inset 0 1px 0 rgba(255,255,255,0.6);
      }
      .login-input {
        width: 100%; padding: 12px 16px; border-radius: 14px;
        background: rgba(15,23,42,0.05);
        border: 1.5px solid rgba(15,23,42,0.12);
        color: #0f172a; font-size: 0.92rem; font-family: inherit;
        transition: border-color 150ms ease, box-shadow 150ms ease;
        outline: none;
      }
      .login-input:focus {
        border-color: rgba(37,99,235,0.60);
        box-shadow: 0 0 0 3px rgba(37,99,235,0.15);
        background: rgba(255,255,255,0.95);
      }
      .login-submit {
        width: 100%; padding: 13px; border: none; border-radius: 16px;
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #fff; font-size: 0.95rem; font-weight: 700;
        cursor: pointer; font-family: inherit;
        box-shadow: 0 4px 20px rgba(37,99,235,0.35);
        transition: box-shadow 150ms, transform 150ms;
      }
      .login-submit:hover {
        box-shadow: 0 6px 28px rgba(37,99,235,0.50);
        transform: translateY(-1px);
      }
      /* الوضع المظلم */
      body.dark-mode .calc-card {
        background: rgba(30,41,59,0.92);
        border-color: rgba(248,250,252,0.08);
        box-shadow: 0 32px 80px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.05);
      }
      body.dark-mode .calc-display {
        background: rgba(0,0,0,0.30);
        border-color: rgba(248,250,252,0.07);
      }
      body.dark-mode .calc-expr { color: rgba(248,250,252,0.35); }
      body.dark-mode .calc-result { color: #f1f5f9; }
      body.dark-mode .calc-btn-num { background: rgba(248,250,252,0.07); color: #e2e8f0; border-color: rgba(248,250,252,0.05); }
      body.dark-mode .calc-btn-op  { background: rgba(37,99,235,0.35); color: #93c5fd; border-color: rgba(37,99,235,0.20); }
      body.dark-mode .calc-btn-fn  { background: rgba(148,163,184,0.18); color: #94a3b8; border-color: rgba(148,163,184,0.10); }
      body.dark-mode .calc-btn-num:hover { background: rgba(248,250,252,0.13); }
      body.dark-mode .calc-btn-op:hover  { background: rgba(37,99,235,0.50); }
      body.dark-mode .login-card {
        background: rgba(30,41,59,0.94);
        border-color: rgba(248,250,252,0.08);
        box-shadow: 0 32px 80px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.04);
      }
      body.dark-mode .login-input {
        background: rgba(15,23,42,0.50);
        border-color: rgba(248,250,252,0.12);
        color: #f1f5f9;
      }
      body.dark-mode .login-input:focus {
        border-color: rgba(59,130,246,0.60);
        box-shadow: 0 0 0 3px rgba(59,130,246,0.18);
        background: rgba(30,41,59,0.80);
      }

      /* خلفية شاشة الدخول — تتكيف مع الوضع */
      .login-page-wrap {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        position: relative;
        overflow: hidden;
        transition: background 0.4s ease;
      }
      /* الوضع الفاتح */
      body:not(.dark-mode) .login-page-wrap {
        background: linear-gradient(135deg, #dbeafe 0%, #eff6ff 40%, #f0fdf4 70%, #ecfdf5 100%);
      }
      /* الوضع المظلم */
      body.dark-mode .login-page-wrap {
        background: linear-gradient(135deg, #0a0f1e 0%, #0f2044 40%, #0a1628 70%, #0a0f1e 100%);
      }
      .menu-btn {
        width: 44px; height: 44px; border-radius: 14px;
        background: rgba(255,255,255,0.15);
        border: 1px solid rgba(255,255,255,0.20);
        color: #1e293b;
        font-size: 1.3rem; cursor: pointer;
        display: flex; align-items: center; justify-content: center;
        backdrop-filter: blur(8px);
        transition: background 150ms;
      }
      body.dark-mode .menu-btn { color: #fff; background: rgba(255,255,255,0.10); border-color: rgba(255,255,255,0.16); }
      .menu-btn:hover { background: rgba(255,255,255,0.25); }
      .menu-dropdown {
        position: absolute; top: 54px; right: 0;
        background: rgba(255,255,255,0.97);
        border: 1px solid rgba(15,23,42,0.10);
        border-radius: 16px; padding: 8px;
        min-width: 210px; display: none;
        box-shadow: 0 20px 60px rgba(15,23,42,0.18);
        backdrop-filter: blur(24px);
      }
      body.dark-mode .menu-dropdown {
        background: rgba(15,23,42,0.97);
        border-color: rgba(255,255,255,0.10);
        box-shadow: 0 20px 60px rgba(0,0,0,0.50);
      }
      .menu-item {
        display: flex; align-items: center; gap: 10px;
        width: 100%; padding: 11px 14px; border: none;
        background: transparent; color: #334155;
        font-family: inherit; font-size: 0.9rem;
        border-radius: 10px; cursor: pointer; text-align: right;
        transition: background 150ms;
      }
      body.dark-mode .menu-item { color: rgba(255,255,255,0.85); }
      .menu-item:hover { background: rgba(37,99,235,0.08); }
      body.dark-mode .menu-item:hover { background: rgba(255,255,255,0.08); }
      .switch-btn {
        width: 100%; margin-top: 14px; padding: 12px;
        background: rgba(37,99,235,0.10);
        border: 1px solid rgba(37,99,235,0.25);
        border-radius: 14px; color: #1d4ed8;
        font-size: 0.88rem; font-family: inherit; cursor: pointer;
        transition: all 150ms;
        display: flex; align-items: center; justify-content: center; gap: 8px;
      }
      body.dark-mode .switch-btn { color: #93c5fd; background: rgba(37,99,235,0.15); border-color: rgba(37,99,235,0.30); }
      .switch-btn:hover { background: rgba(37,99,235,0.20); transform: translateY(-1px); }
      .back-btn {
        background: rgba(15,23,42,0.07);
        border: 1px solid rgba(15,23,42,0.12);
        border-radius: 10px; color: #475569;
        padding: 6px 12px; font-size: 0.82rem; font-family: inherit;
        cursor: pointer; display: flex; align-items: center; gap: 6px;
        transition: background 150ms;
      }
      body.dark-mode .back-btn { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); color: rgba(255,255,255,0.65); }
      .back-btn:hover { background: rgba(15,23,42,0.12); }
      .quick-hint {
        text-align: center; font-size: 0.75rem; color: #059669;
        margin-bottom: 12px;
        display: flex; align-items: center; justify-content: center; gap: 4px;
      }
      body.dark-mode .quick-hint { color: rgba(16,185,129,0.80); }
      /* تعديل shimmer ليعمل بشكل صحيح */
      @keyframes shimmer-bg {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;
    document.head.appendChild(style);
  },

  // ─── الصفحة الكاملة ───
  _buildPage() {
    const page = document.createElement('div');
    page.className = 'login-page-wrap';

    // خلفية متحركة
    const bgDecor = document.createElement('div');
    bgDecor.setAttribute('aria-hidden','true');
    bgDecor.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    bgDecor.innerHTML = `
      <div style="position:absolute;width:500px;height:500px;border-radius:50%;
        background:radial-gradient(circle,rgba(37,99,235,0.12) 0%,transparent 70%);
        top:-100px;right:-80px;animation:pulse-glow 5s ease-in-out infinite;"></div>
      <div style="position:absolute;width:350px;height:350px;border-radius:50%;
        background:radial-gradient(circle,rgba(5,150,105,0.10) 0%,transparent 70%);
        bottom:-60px;left:-60px;animation:pulse-glow 7s ease-in-out infinite 2s;"></div>`;
    page.appendChild(bgDecor);

    // زر القائمة
    page.appendChild(this._buildMenuBtn());

    // حاوية الـ Flip
    const scene = document.createElement('div');
    scene.style.cssText = 'width:100%;max-width:360px;perspective:1200px;position:relative;z-index:10;';

    const flipper = document.createElement('div');
    flipper.id = 'login-flipper';
    flipper.style.cssText = `
      position:relative;width:100%;
      transform-style:preserve-3d;
      transition:transform 0.6s cubic-bezier(0.4,0.2,0.2,1);`;

    const front = document.createElement('div');
    front.style.cssText = 'width:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;';
    front.appendChild(this._buildCalcCard());

    const back = document.createElement('div');
    back.style.cssText = `
      position:absolute;top:0;left:0;width:100%;
      backface-visibility:hidden;-webkit-backface-visibility:hidden;
      transform:rotateY(180deg);`;
    back.appendChild(this._buildLoginCard());

    flipper.appendChild(front);
    flipper.appendChild(back);
    scene.appendChild(flipper);
    page.appendChild(scene);

    return page;
  },

  // ─── زر القائمة ───
  _buildMenuBtn() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;top:20px;right:20px;z-index:100;';

    const btn = document.createElement('button');
    btn.className = 'menu-btn';
    btn.textContent = '☰';
    btn.setAttribute('aria-label','القائمة');

    const menu = document.createElement('div');
    menu.className = 'menu-dropdown';

    const items = [
      { icon:'🔑', label:'تسجيل الدخول التقليدي', fn:()=>this._flipToLogin()    },
      { icon:'🌙', label:'تبديل الوضع المظلم',     fn:()=>this._toggleDark()     },
      { icon:'ℹ️', label:'حول التطبيق',            fn:()=>this._showAbout()       },
    ];

    items.forEach(item => {
      const li = document.createElement('button');
      li.className = 'menu-item';
      li.innerHTML = `<span>${item.icon}</span><span>${escapeHtml(item.label)}</span>`;
      li.addEventListener('click',()=>{ menu.style.display='none'; this._state.menuOpen=false; item.fn(); });
      menu.appendChild(li);
    });

    btn.addEventListener('click',e=>{
      e.stopPropagation();
      this._state.menuOpen = !this._state.menuOpen;
      menu.style.display = this._state.menuOpen ? 'block' : 'none';
    });
    document.addEventListener('click',()=>{
      if(this._state.menuOpen){ menu.style.display='none'; this._state.menuOpen=false; }
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    return wrap;
  },

  // ─── بطاقة الحاسبة ───
  _buildCalcCard() {
    const card = document.createElement('div');
    card.className = 'calc-card';

    // شاشة العرض
    const display = document.createElement('div');
    display.className = 'calc-display';
    display.innerHTML = `
      <div id="calc-expr" class="calc-expr"></div>
      <div id="calc-result" class="calc-result">0</div>`;
    card.appendChild(display);

    // إشارة الدخول السريع
    if (this._state.quickEnabled) {
      const hint = document.createElement('div');
      hint.className = 'quick-hint';
      hint.innerHTML = `<span>⚡</span><span>الدخول السريع مفعّل — أدخل معادلتك واضغط =</span>`;
      card.appendChild(hint);
    }

    // لوحة المفاتيح
    card.appendChild(this._buildKeypad());

    // زر التبديل
    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch-btn';
    switchBtn.innerHTML = `<span>🔑</span><span>تسجيل الدخول التقليدي</span>`;
    switchBtn.addEventListener('click',()=>this._flipToLogin());
    card.appendChild(switchBtn);

    return card;
  },

  // ─── لوحة المفاتيح ───
  _buildKeypad() {
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:9px;';

    const BTNS = [
      {l:'C',  t:'fn',v:'C'  },{l:'⌫', t:'fn',v:'back'},{l:'%',t:'op',v:'%'},{l:'÷',t:'op',v:'/'},
      {l:'7',  t:'n', v:'7'  },{l:'8', t:'n', v:'8'   },{l:'9',t:'n', v:'9'},{l:'×',t:'op',v:'*'},
      {l:'4',  t:'n', v:'4'  },{l:'5', t:'n', v:'5'   },{l:'6',t:'n', v:'6'},{l:'−',t:'op',v:'-'},
      {l:'1',  t:'n', v:'1'  },{l:'2', t:'n', v:'2'   },{l:'3',t:'n', v:'3'},{l:'+',t:'op',v:'+'},
      {l:'0',  t:'n', v:'0', wide:true},                 {l:'.', t:'n', v:'.'},{l:'=',t:'eq',v:'='},
    ];

    const cls = {fn:'calc-btn-fn', op:'calc-btn-op', eq:'calc-btn-eq', n:'calc-btn-num'};

    BTNS.forEach(b => {
      const el = document.createElement('button');
      if (b.wide) el.style.gridColumn = 'span 2';
      el.className = cls[b.t] || 'calc-btn-num';
      el.style.cssText = `
        padding:17px 0;border-radius:14px;
        font-size:${b.t==='fn'?'1rem':'1.15rem'};font-weight:600;
        cursor:pointer;font-family:inherit;
        transition:filter 150ms,transform 80ms;
        -webkit-tap-highlight-color:transparent;`;
      el.textContent = b.l;
      el.addEventListener('click',()=>this._handleKey(b.v));
      el.addEventListener('mousedown',()=>{ el.style.transform='scale(0.92)'; });
      el.addEventListener('mouseup',()=>{ el.style.transform=''; });
      el.addEventListener('touchstart',()=>{ el.style.transform='scale(0.92)'; },{passive:true});
      el.addEventListener('touchend',()=>{ el.style.transform=''; },{passive:true});
      grid.appendChild(el);
    });

    // أحداث لوحة المفاتيح الفعلية
    document.addEventListener('keydown',e=>this._handleKeyboard(e));
    return grid;
  },

  // ─── بطاقة نموذج الدخول ───
  _buildLoginCard() {
    const card = document.createElement('div');
    card.className = 'login-card';

    // صف الرجوع + العنوان
    const backRow = document.createElement('div');
    backRow.style.cssText = 'display:flex;align-items:center;margin-bottom:20px;gap:12px;';

    const backBtn = document.createElement('button');
    backBtn.className = 'back-btn';
    backBtn.innerHTML = `<span>←</span><span>الحاسبة</span>`;
    backBtn.addEventListener('click',()=>this._flipToCalc());
    backRow.appendChild(backBtn);

    const lTitle = document.createElement('p');
    lTitle.style.cssText = 'font-size:1.05rem;font-weight:700;flex:1;text-align:center;color:var(--text-primary,#0f172a);';
    lTitle.textContent = 'تسجيل الدخول';
    backRow.appendChild(lTitle);
    card.appendChild(backRow);

    // حقل البريد
    const emailWrap = document.createElement('div');
    emailWrap.style.marginBottom = '14px';
    const emailLabel = document.createElement('label');
    emailLabel.style.cssText = 'display:block;font-size:0.82rem;font-weight:600;margin-bottom:6px;color:var(--text-secondary,#475569);';
    emailLabel.textContent = 'البريد الإلكتروني';
    const emailInput = document.createElement('input');
    emailInput.id = 'login-email';
    emailInput.type = 'email';
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'name@example.com';
    emailInput.dir = 'ltr';
    emailInput.className = 'login-input';
    emailWrap.appendChild(emailLabel);
    emailWrap.appendChild(emailInput);
    card.appendChild(emailWrap);

    // حقل كلمة المرور
    const passWrap = document.createElement('div');
    passWrap.style.marginBottom = '8px';
    const passLabel = document.createElement('label');
    passLabel.style.cssText = 'display:block;font-size:0.82rem;font-weight:600;margin-bottom:6px;color:var(--text-secondary,#475569);';
    passLabel.textContent = 'كلمة المرور';
    const passRow = document.createElement('div');
    passRow.style.position = 'relative';
    const passInput = document.createElement('input');
    passInput.id = 'login-password';
    passInput.type = 'password';
    passInput.autocomplete = 'current-password';
    passInput.placeholder = '••••••••';
    passInput.className = 'login-input';
    passInput.style.paddingLeft = '44px';

    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.style.cssText = `
      position:absolute;left:12px;top:50%;transform:translateY(-50%);
      background:none;border:none;cursor:pointer;
      color:var(--text-muted,#94a3b8);padding:4px;font-size:1rem;
      transition:color 150ms;`;
    eyeBtn.innerHTML = '👁';
    eyeBtn.setAttribute('aria-label','إظهار/إخفاء كلمة المرور');
    eyeBtn.addEventListener('click',()=>{
      this._state.showPassword = !this._state.showPassword;
      passInput.type = this._state.showPassword ? 'text' : 'password';
      eyeBtn.innerHTML = this._state.showPassword ? '🙈' : '👁';
    });
    passRow.appendChild(passInput);
    passRow.appendChild(eyeBtn);
    passWrap.appendChild(passLabel);
    passWrap.appendChild(passRow);
    card.appendChild(passWrap);

    // رسالة الخطأ
    const errEl = document.createElement('div');
    errEl.id = 'login-error';
    errEl.style.cssText = `
      color:#dc2626;font-size:0.80rem;min-height:20px;
      margin-bottom:10px;text-align:center;
      display:flex;align-items:center;justify-content:center;gap:6px;`;
    card.appendChild(errEl);

    // زر الدخول
    const submitBtn = document.createElement('button');
    submitBtn.id = 'login-submit-btn';
    submitBtn.className = 'login-submit';
    submitBtn.textContent = 'دخول';
    submitBtn.addEventListener('click',()=>this._handleLogin(emailInput,passInput,submitBtn,errEl));
    [emailInput,passInput].forEach(inp=>
      inp.addEventListener('keydown',e=>{ if(e.key==='Enter') this._handleLogin(emailInput,passInput,submitBtn,errEl); })
    );
    card.appendChild(submitBtn);

    // قسم الدخول السريع
    const quickSetup = document.createElement('div');
    quickSetup.id = 'quick-setup-wrap';
    quickSetup.style.cssText = `
      margin-top:16px;padding:14px;
      background:rgba(5,150,105,0.08);
      border:1px solid rgba(5,150,105,0.22);
      border-radius:14px;display:none;`;
    quickSetup.innerHTML = `
      <p style="color:rgba(5,150,105,0.9);font-size:0.82rem;margin-bottom:10px;text-align:center;">
        ⚡ فعّل الدخول السريع بمعادلة رياضية
      </p>
      <div style="display:flex;gap:8px;">
        <input id="quick-eq-input" type="text" dir="ltr"
          placeholder="مثال: 12+88"
          style="flex:1;padding:9px 12px;border-radius:10px;
                 background:rgba(15,23,42,0.06);
                 border:1.5px solid rgba(15,23,42,0.12);
                 color:var(--text-primary,#0f172a);font-size:0.88rem;font-family:monospace;outline:none;">
        <button id="quick-eq-save"
          style="padding:9px 14px;border-radius:10px;border:none;
                 background:rgba(5,150,105,0.85);color:#fff;
                 font-size:0.82rem;font-family:inherit;cursor:pointer;">
          تفعيل
        </button>
      </div>
      <p id="quick-eq-preview"
        style="font-size:0.75rem;color:var(--text-muted,#94a3b8);margin-top:6px;text-align:center;"></p>`;
    card.appendChild(quickSetup);

    return card;
  },

  // ─── قلب البطاقة ───
  _flipToLogin() {
    const f = document.getElementById('login-flipper');
    if (!f || this._state.flipped) return;
    this._state.flipped = true;
    f.style.transform = 'rotateY(180deg)';
    setTimeout(()=>{ document.getElementById('login-email')?.focus(); },650);
  },

  _flipToCalc() {
    const f = document.getElementById('login-flipper');
    if (!f || !this._state.flipped) return;
    this._state.flipped = false;
    f.style.transform = 'rotateY(0deg)';
  },

  // ─── منطق الحاسبة ───
  _handleKey(v) {
    const s = this._state;
    if (v==='C') {
      s.expression=''; s.result='0'; s.justEvaluated=false;
      this._updateDisplay(); return;
    }
    if (v==='back') {
      s.expression = s.expression.slice(0,-1);
      this._updateDisplay(s.expression); return;
    }
    if (v==='±') {
      if(s.result!=='0'){ s.result=String(parseFloat(s.result)*-1); s.expression=s.result; this._updateDisplay(); }
      return;
    }
    if (v==='=') { this._evaluate(); return; }
    if (s.justEvaluated && !'+-*/'.includes(v)) { s.expression=''; s.justEvaluated=false; }
    s.expression += v;
    this._updateDisplay(s.expression);
  },

  _handleKeyboard(e) {
    if (this._state.flipped) return;
    const map = {'Enter':'=','Backspace':'back','Escape':'C'};
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
      const val    = parser.evaluate(s.expression);
      if (typeof val!=='number'||!isFinite(val)) { this._flashError('خطأ'); return; }
      const formatted = Number.isInteger(val) ? String(val) : parseFloat(val.toFixed(10)).toString();
      s.result = formatted; s.justEvaluated = true;
      this._updateDisplay(s.expression, formatted);
      // الدخول السريع — يُستدعى فقط عند = وليس عند كل ضغطة
      if (s.quickEnabled) this._tryQuickLogin(s.expression);
    } catch { this._flashError('خطأ في المعادلة'); }
  },

  _updateDisplay(expr='', result=null) {
    const eEl = document.getElementById('calc-expr');
    const rEl = document.getElementById('calc-result');
    if (eEl) eEl.textContent = expr||'';
    const txt = result!==null ? result : (this._state.result||'0');
    if (rEl) {
      rEl.textContent = txt;
      const l = txt.length;
      rEl.style.fontSize = l>12 ? '1.4rem' : l>8 ? '1.8rem' : '2.4rem';
    }
  },

  _flashError(msg) {
    const el = document.getElementById('calc-result');
    if (!el) return;
    el.style.color='#dc2626'; el.textContent=msg;
    setTimeout(()=>{
      el.style.color=''; el.textContent='0';
      this._state.expression=''; this._state.result='0'; this._state.justEvaluated=false;
    },1300);
  },

  // ─── الدخول السريع ───
  async _tryQuickLogin(equation) {
    const rEl = document.getElementById('calc-result');
    if (rEl) rEl.style.color='rgba(5,150,105,0.7)';
    const res = await AuthService.quickLogin(equation);
    if (isOk(res)) {
      if(rEl) rEl.style.color='var(--success,#059669)';
      showToast(`⚡ مرحباً ${res.data.profile.display_name}`, 'success');
      setTimeout(()=>this._onSuccess?.(res.data.profile), 400);
    } else {
      if(rEl) rEl.style.color='';
    }
  },

  // ─── تسجيل الدخول التقليدي ───
  async _handleLogin(emailInput, passInput, btn, errEl) {
    if (this._state.isLoading) return;
    const email    = emailInput.value.trim();
    const password = passInput.value;
    errEl.innerHTML = '';

    if (!email)    { errEl.innerHTML='<span>⚠️</span><span>أدخل البريد الإلكتروني</span>'; emailInput.focus(); return; }
    if (!password) { errEl.innerHTML='<span>⚠️</span><span>أدخل كلمة المرور</span>'; passInput.focus(); return; }

    this._state.isLoading = true;
    const origText = btn.textContent;
    btn.innerHTML = '<span style="display:inline-block;animation:spin 0.6s linear infinite;">⟳</span> جاري الدخول...';
    btn.disabled  = true;
    btn.style.opacity = '0.75';

    const result = await AuthService.login(email, password);

    btn.disabled  = false;
    btn.style.opacity = '1';
    btn.textContent = origText;
    this._state.isLoading = false;

    if (isOk(result)) {
      const profile = result.data.profile;
      const qs = document.getElementById('quick-setup-wrap');
      if (qs) { qs.style.display = 'block'; this._bindQuickSetup(profile); }
      showToast(`مرحباً ${profile.display_name} 👋`, 'success');
      setTimeout(()=>this._onSuccess?.(profile), 600);
    } else {
      errEl.innerHTML = `<span>❌</span><span>${escapeHtml(result.error)}</span>`;
      passInput.value = '';
      passInput.focus();
      const card = errEl.closest('.login-card');
      if (card) {
        card.style.animation = 'shake 0.4s ease';
        setTimeout(()=>{ card.style.animation=''; },450);
      }
    }
  },

  _bindQuickSetup(profile) {
    const saveBtn = document.getElementById('quick-eq-save');
    const eqInput = document.getElementById('quick-eq-input');
    const preview = document.getElementById('quick-eq-preview');

    eqInput?.addEventListener('input', ()=>{
      if (!preview) return;
      try {
        const parser = new window.exprEval.Parser();
        const val = parser.evaluate(eqInput.value.trim());
        preview.textContent = `النتيجة: ${val}`;
        preview.style.color = 'rgba(5,150,105,0.8)';
      } catch {
        preview.textContent = eqInput.value ? 'معادلة غير صالحة' : '';
        preview.style.color = 'rgba(220,38,38,0.8)';
      }
    });

    saveBtn?.addEventListener('click', async ()=>{
      const eq = eqInput?.value?.trim();
      if (!eq) { showToast('أدخل معادلة أولاً','warning'); return; }
      const res = await AuthService.enableQuickLogin(eq);
      if (isOk(res)) {
        showToast('⚡ تم تفعيل الدخول السريع!','success');
        document.getElementById('quick-setup-wrap').style.display='none';
        // تحديث DEVICE_TOKEN_KEY لتفعيل الدخول السريع في المرة القادمة
        if (!sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY)) {
          sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, `quick_${profile.id}`);
        }
      } else {
        showToast(res.error,'error');
      }
    });
  },

  // ─── تبديل الوضع المظلم ───
  _toggleDark() {
    if (window.ThemeManager) {
      const isDark = ThemeManager.toggle();
      showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
    } else {
      const isDark = document.body.classList.toggle('dark-mode');
      localStorage.setItem('abu_theme', isDark ? 'dark' : 'light');
      showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
    }
  },

  _showAbout() {
    showToast(`نظام أبو حذيفة v${APP_CONFIG.VERSION} — نظام مالي Offline-First`, 'info', 4000);
  },
};

window.LoginComponent = LoginComponent;
console.log('✅ LoginComponent v3.0 محمّل — بدعم كامل للوضعين النهاري والليلي');
