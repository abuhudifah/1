/**
 * components/LoginComponent.js — v2.0
 * شاشتان منفصلتان: آلة حاسبة ← انتقال 3D ← نموذج الدخول
 * - Flip Card 3D بين الآلة والنموذج
 * - زر إظهار/إخفاء كلمة السر
 * - آلة حاسبة متجاوبة بالكامل
 * - دخول سريع بالمعادلة
 * - لا eval() — expr-eval فقط
 * - navigator.onLine (وليس isOnline)
 */
'use strict';

const LoginComponent = {
  _state: {
    expression   : '',
    result       : '0',
    justEvaluated: false,
    menuOpen     : false,
    flipped      : false,   // هل البطاقة مقلوبة (وجه النموذج)؟
    isLoading    : false,
    quickEnabled : false,
    showPassword : false,
  },
  _onSuccess : null,
  _container : null,

  // ─────────────────────────────────────────────
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
    container.appendChild(this._buildPage());
  },

  // ─────────────────────────────────────────────
  // الصفحة الكاملة
  // ─────────────────────────────────────────────
  _buildPage() {
    const page = document.createElement('div');
    page.id = 'login-page';
    page.style.cssText = `
      min-height:100vh; display:flex; align-items:center;
      justify-content:center; padding:20px; position:relative;
      background: linear-gradient(135deg,#0a0f1e 0%,#0f2044 40%,#0a1628 70%,#0a0f1e 100%);
      overflow:hidden;`;

    /* ── خلفية متحركة ── */
    const bg = document.createElement('div');
    bg.innerHTML = `
      <div style="position:absolute;inset:0;overflow:hidden;pointer-events:none;">
        <div style="
          position:absolute;width:600px;height:600px;
          border-radius:50%;
          background:radial-gradient(circle,rgba(37,99,235,0.18) 0%,transparent 70%);
          top:-100px;right:-100px;
          animation:pulse-glow 4s ease-in-out infinite;"></div>
        <div style="
          position:absolute;width:400px;height:400px;border-radius:50%;
          background:radial-gradient(circle,rgba(16,185,129,0.10) 0%,transparent 70%);
          bottom:-80px;left:-80px;
          animation:pulse-glow 6s ease-in-out infinite 2s;"></div>
        ${Array.from({length:20},(_,i)=>`
          <div style="
            position:absolute;width:2px;height:2px;border-radius:50%;
            background:rgba(255,255,255,${0.05+Math.random()*0.2});
            top:${Math.random()*100}%;left:${Math.random()*100}%;
            animation:twinkle ${2+Math.random()*4}s ease-in-out infinite ${Math.random()*4}s;"></div>`).join('')}
      </div>`;
    page.appendChild(bg.firstElementChild);

    /* ── زر القائمة ── */
    page.appendChild(this._buildMenuBtn());

    /* ── حاوية الـ Flip ── */
    const scene = document.createElement('div');
    scene.style.cssText = `
      width:100%;max-width:360px;
      perspective:1000px;
      position:relative;z-index:10;`;

    const flipper = document.createElement('div');
    flipper.id = 'login-flipper';
    flipper.style.cssText = `
      position:relative;width:100%;
      transform-style:preserve-3d;
      transition:transform 0.6s cubic-bezier(0.4,0.2,0.2,1);`;

    /* الوجه الأمامي: الآلة الحاسبة */
    const front = document.createElement('div');
    front.style.cssText = `
      width:100%;backface-visibility:hidden;
      -webkit-backface-visibility:hidden;`;
    front.appendChild(this._buildCalcCard());

    /* الوجه الخلفي: نموذج الدخول */
    const back = document.createElement('div');
    back.style.cssText = `
      position:absolute;top:0;left:0;width:100%;
      backface-visibility:hidden;
      -webkit-backface-visibility:hidden;
      transform:rotateY(180deg);`;
    back.appendChild(this._buildLoginCard());

    flipper.appendChild(front);
    flipper.appendChild(back);
    scene.appendChild(flipper);
    page.appendChild(scene);

    return page;
  },

  // ─────────────────────────────────────────────
  // زر القائمة ☰
  // ─────────────────────────────────────────────
  _buildMenuBtn() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;top:20px;right:20px;z-index:100;';

    const btn = document.createElement('button');
    btn.style.cssText = `
      width:44px;height:44px;border-radius:14px;
      background:rgba(255,255,255,0.10);
      border:1px solid rgba(255,255,255,0.16);
      color:#fff;font-size:1.3rem;cursor:pointer;
      display:flex;align-items:center;justify-content:center;
      backdrop-filter:blur(8px);
      transition:background var(--transition-fast);`;
    btn.textContent = '☰';
    btn.setAttribute('aria-label','القائمة');

    const menu = document.createElement('div');
    menu.style.cssText = `
      position:absolute;top:54px;right:0;
      background:rgba(10,15,30,0.97);
      border:1px solid rgba(255,255,255,0.10);
      border-radius:16px;padding:8px;
      min-width:210px;display:none;
      box-shadow:0 20px 60px rgba(0,0,0,0.5);
      backdrop-filter:blur(24px);`;

    const items = [
      { icon:'🔑', label:'تسجيل الدخول التقليدي', fn:()=>this._flipToLogin()    },
      { icon:'🌙', label:'الوضع المظلم',           fn:()=>this._toggleDark()      },
      { icon:'ℹ️', label:'حول التطبيق',            fn:()=>this._showAbout()        },
    ];

    items.forEach(item => {
      const li = document.createElement('button');
      li.style.cssText = `
        display:flex;align-items:center;gap:10px;
        width:100%;padding:11px 14px;border:none;
        background:transparent;color:rgba(255,255,255,0.85);
        font-family:inherit;font-size:0.9rem;
        border-radius:10px;cursor:pointer;text-align:right;
        transition:background var(--transition-fast);`;
      li.innerHTML = `<span>${item.icon}</span><span>${escapeHtml(item.label)}</span>`;
      li.addEventListener('click',()=>{ menu.style.display='none'; this._state.menuOpen=false; item.fn(); });
      li.addEventListener('mouseenter',()=>{ li.style.background='rgba(255,255,255,0.08)'; });
      li.addEventListener('mouseleave',()=>{ li.style.background='transparent'; });
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

  // ─────────────────────────────────────────────
  // بطاقة الآلة الحاسبة
  // ─────────────────────────────────────────────
  _buildCalcCard() {
    const card = document.createElement('div');
    card.style.cssText = `
      background:rgba(255,255,255,0.06);
      backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);
      border:1px solid rgba(255,255,255,0.11);
      border-radius:28px;padding:24px 20px 20px;
      box-shadow:0 32px 80px rgba(0,0,0,0.45),
                 inset 0 1px 0 rgba(255,255,255,0.08);
      animation:scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1);`;

    /* شاشة العرض */
    const display = document.createElement('div');
    display.style.cssText = `
      background:rgba(0,0,0,0.4);border-radius:18px;
      padding:16px 18px;margin-bottom:18px;
      text-align:left;direction:ltr;
      min-height:90px;display:flex;flex-direction:column;
      justify-content:flex-end;overflow:hidden;
      border:1px solid rgba(255,255,255,0.06);`;
    display.innerHTML = `
      <div id="calc-expr"
        style="color:rgba(255,255,255,0.4);font-size:0.82rem;min-height:18px;
               word-break:break-all;margin-bottom:4px;font-family:monospace;"></div>
      <div id="calc-result"
        style="color:#fff;font-size:2.4rem;font-weight:700;
               line-height:1.1;word-break:break-all;
               transition:font-size var(--transition-fast),color var(--transition-fast);">0</div>`;
    card.appendChild(display);

    /* إشارة الدخول السريع */
    if (this._state.quickEnabled) {
      const hint = document.createElement('div');
      hint.style.cssText = `
        text-align:center;font-size:0.75rem;
        color:rgba(16,185,129,0.8);margin-bottom:12px;
        display:flex;align-items:center;justify-content:center;gap:4px;`;
      hint.innerHTML = `<span>⚡</span><span>الدخول السريع مفعّل — أدخل معادلتك</span>`;
      card.appendChild(hint);
    }

    /* لوحة المفاتيح */
    card.appendChild(this._buildKeypad());

    /* زر التبديل لنموذج الدخول */
    const switchBtn = document.createElement('button');
    switchBtn.style.cssText = `
      width:100%;margin-top:14px;padding:12px;
      background:linear-gradient(135deg,rgba(37,99,235,0.3),rgba(37,99,235,0.15));
      border:1px solid rgba(37,99,235,0.4);
      border-radius:14px;color:rgba(255,255,255,0.8);
      font-size:0.88rem;font-family:inherit;cursor:pointer;
      transition:all var(--transition-fast);
      display:flex;align-items:center;justify-content:center;gap:8px;`;
    switchBtn.innerHTML = `<span>🔑</span><span>تسجيل الدخول التقليدي</span>`;
    switchBtn.addEventListener('mouseenter',()=>{ switchBtn.style.background='linear-gradient(135deg,rgba(37,99,235,0.5),rgba(37,99,235,0.3))'; });
    switchBtn.addEventListener('mouseleave',()=>{ switchBtn.style.background='linear-gradient(135deg,rgba(37,99,235,0.3),rgba(37,99,235,0.15))'; });
    switchBtn.addEventListener('click',()=>this._flipToLogin());
    card.appendChild(switchBtn);

    return card;
  },

  // ─────────────────────────────────────────────
  // لوحة المفاتيح
  // ─────────────────────────────────────────────
  _buildKeypad() {
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:9px;';

    const BTNS = [
      {l:'C',  t:'fn',v:'C' },{l:'±',t:'fn',v:'±'},{l:'%',t:'op',v:'%'},{l:'÷',t:'op',v:'/'},
      {l:'7',  t:'n', v:'7' },{l:'8',t:'n', v:'8'},{l:'9',t:'n', v:'9'},{l:'×',t:'op',v:'*'},
      {l:'4',  t:'n', v:'4' },{l:'5',t:'n', v:'5'},{l:'6',t:'n', v:'6'},{l:'−',t:'op',v:'-'},
      {l:'1',  t:'n', v:'1' },{l:'2',t:'n', v:'2'},{l:'3',t:'n', v:'3'},{l:'+',t:'op',v:'+'},
      {l:'0',  t:'n', v:'0', wide:true},             {l:'.',t:'n', v:'.'},{l:'=',t:'eq',v:'='},
    ];

    const C = {
      fn :'rgba(148,163,184,0.22)', op:'rgba(37,99,235,0.70)',
      eq :'rgba(37,99,235,1)',      n :'rgba(255,255,255,0.09)',
    };

    BTNS.forEach(b => {
      const el = document.createElement('button');
      if (b.wide) el.style.gridColumn = 'span 2';
      el.style.cssText = `
        padding:17px 0;border:none;border-radius:14px;
        background:${C[b.t]};color:#fff;
        font-size:1.15rem;font-weight:600;
        cursor:pointer;font-family:inherit;
        border:1px solid rgba(255,255,255,0.05);
        transition:filter var(--transition-fast),transform 80ms;
        -webkit-tap-highlight-color:transparent;
        box-shadow:0 2px 8px rgba(0,0,0,0.2);`;
      el.textContent = b.l;
      el.addEventListener('click',      ()=>this._handleKey(b.v));
      el.addEventListener('mouseenter', ()=>{ el.style.filter='brightness(1.18)'; });
      el.addEventListener('mouseleave', ()=>{ el.style.filter=''; });
      el.addEventListener('mousedown',  ()=>{ el.style.transform='scale(0.92)'; });
      el.addEventListener('mouseup',    ()=>{ el.style.transform=''; });
      el.addEventListener('touchstart', ()=>{ el.style.transform='scale(0.92)'; },{passive:true});
      el.addEventListener('touchend',   ()=>{ el.style.transform=''; },{passive:true});
      grid.appendChild(el);
    });

    document.addEventListener('keydown', e=>this._handleKeyboard(e));
    return grid;
  },

  // ─────────────────────────────────────────────
  // بطاقة نموذج الدخول
  // ─────────────────────────────────────────────
  _buildLoginCard() {
    const card = document.createElement('div');
    card.style.cssText = `
      background:rgba(255,255,255,0.06);
      backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);
      border:1px solid rgba(255,255,255,0.11);
      border-radius:28px;padding:28px 24px 24px;
      box-shadow:0 32px 80px rgba(0,0,0,0.45),
                 inset 0 1px 0 rgba(255,255,255,0.08);`;

    /* زر الرجوع */
    const backRow = document.createElement('div');
    backRow.style.cssText = 'display:flex;align-items:center;margin-bottom:20px;';
    const backBtn = document.createElement('button');
    backBtn.style.cssText = `
      background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);
      border-radius:10px;color:rgba(255,255,255,0.7);
      padding:6px 12px;font-size:0.82rem;font-family:inherit;
      cursor:pointer;display:flex;align-items:center;gap:6px;
      transition:background var(--transition-fast);`;
    backBtn.innerHTML = `<span>←</span><span>الآلة الحاسبة</span>`;
    backBtn.addEventListener('click',()=>this._flipToCalc());
    backBtn.addEventListener('mouseenter',()=>{ backBtn.style.background='rgba(255,255,255,0.14)'; });
    backBtn.addEventListener('mouseleave',()=>{ backBtn.style.background='rgba(255,255,255,0.08)'; });
    backRow.appendChild(backBtn);

    const lTitle = document.createElement('p');
    lTitle.style.cssText = 'color:#fff;font-size:1.05rem;font-weight:700;flex:1;text-align:center;';
    lTitle.textContent = 'تسجيل الدخول';
    backRow.appendChild(lTitle);
    card.appendChild(backRow);

    /* حقل البريد */
    const emailWrap = document.createElement('div');
    emailWrap.style.cssText = 'position:relative;margin-bottom:14px;';
    const emailLabel = document.createElement('label');
    emailLabel.style.cssText = 'display:block;color:rgba(255,255,255,0.6);font-size:0.78rem;margin-bottom:6px;';
    emailLabel.textContent = 'البريد الإلكتروني';
    const emailInput = document.createElement('input');
    emailInput.id = 'login-email';
    emailInput.type = 'email';
    emailInput.autocomplete = 'email';
    emailInput.placeholder = 'name@example.com';
    emailInput.dir = 'ltr';
    emailInput.style.cssText = `
      width:100%;padding:12px 16px;border-radius:14px;
      background:rgba(255,255,255,0.09);
      border:1px solid rgba(255,255,255,0.14);
      color:#fff;font-size:0.92rem;font-family:inherit;
      transition:border-color var(--transition-fast),
                 box-shadow var(--transition-fast);
      outline:none;`;
    emailInput.addEventListener('focus',()=>{
      emailInput.style.borderColor='rgba(37,99,235,0.7)';
      emailInput.style.boxShadow='0 0 0 3px rgba(37,99,235,0.20)';
    });
    emailInput.addEventListener('blur',()=>{
      emailInput.style.borderColor='rgba(255,255,255,0.14)';
      emailInput.style.boxShadow='none';
    });
    emailWrap.appendChild(emailLabel);
    emailWrap.appendChild(emailInput);
    card.appendChild(emailWrap);

    /* حقل كلمة المرور + زر الإظهار */
    const passWrap = document.createElement('div');
    passWrap.style.cssText = 'position:relative;margin-bottom:8px;';
    const passLabel = document.createElement('label');
    passLabel.style.cssText = 'display:block;color:rgba(255,255,255,0.6);font-size:0.78rem;margin-bottom:6px;';
    passLabel.textContent = 'كلمة المرور';
    const passRow = document.createElement('div');
    passRow.style.cssText = 'position:relative;';
    const passInput = document.createElement('input');
    passInput.id = 'login-password';
    passInput.type = 'password';
    passInput.autocomplete = 'current-password';
    passInput.placeholder = '••••••••';
    passInput.style.cssText = `
      width:100%;padding:12px 44px 12px 16px;border-radius:14px;
      background:rgba(255,255,255,0.09);
      border:1px solid rgba(255,255,255,0.14);
      color:#fff;font-size:0.92rem;font-family:inherit;
      transition:border-color var(--transition-fast),
                 box-shadow var(--transition-fast);
      outline:none;`;
    passInput.addEventListener('focus',()=>{
      passInput.style.borderColor='rgba(37,99,235,0.7)';
      passInput.style.boxShadow='0 0 0 3px rgba(37,99,235,0.20)';
    });
    passInput.addEventListener('blur',()=>{
      passInput.style.borderColor='rgba(255,255,255,0.14)';
      passInput.style.boxShadow='none';
    });

    /* زر إظهار/إخفاء */
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.style.cssText = `
      position:absolute;left:12px;top:50%;transform:translateY(-50%);
      background:none;border:none;cursor:pointer;
      color:rgba(255,255,255,0.4);padding:4px;
      transition:color var(--transition-fast);font-size:1rem;`;
    eyeBtn.innerHTML = '👁';
    eyeBtn.setAttribute('aria-label','إظهار كلمة المرور');
    eyeBtn.addEventListener('click',()=>{
      this._state.showPassword = !this._state.showPassword;
      passInput.type = this._state.showPassword ? 'text' : 'password';
      eyeBtn.innerHTML = this._state.showPassword ? '🙈' : '👁';
      eyeBtn.style.color = this._state.showPassword ? 'rgba(37,99,235,0.8)' : 'rgba(255,255,255,0.4)';
    });

    passRow.appendChild(passInput);
    passRow.appendChild(eyeBtn);
    passWrap.appendChild(passLabel);
    passWrap.appendChild(passRow);
    card.appendChild(passWrap);

    /* رسالة الخطأ */
    const errEl = document.createElement('div');
    errEl.id = 'login-error';
    errEl.style.cssText = `
      color:#f87171;font-size:0.80rem;min-height:20px;
      margin-bottom:10px;text-align:center;
      display:flex;align-items:center;justify-content:center;gap:6px;`;

    card.appendChild(errEl);

    /* زر الدخول */
    const submitBtn = document.createElement('button');
    submitBtn.id = 'login-submit-btn';
    submitBtn.style.cssText = `
      width:100%;padding:13px;border:none;border-radius:16px;
      background:linear-gradient(135deg,#2563eb,#1d4ed8);
      color:#fff;font-size:0.95rem;font-weight:700;
      cursor:pointer;font-family:inherit;
      box-shadow:0 4px 20px rgba(37,99,235,0.4);
      transition:opacity var(--transition-fast),
                 transform var(--transition-fast),
                 box-shadow var(--transition-fast);`;
    submitBtn.textContent = 'دخول';
    submitBtn.addEventListener('mouseenter',()=>{ submitBtn.style.boxShadow='0 6px 28px rgba(37,99,235,0.55)'; submitBtn.style.transform='translateY(-1px)'; });
    submitBtn.addEventListener('mouseleave',()=>{ submitBtn.style.boxShadow='0 4px 20px rgba(37,99,235,0.4)'; submitBtn.style.transform=''; });
    submitBtn.addEventListener('click',()=>this._handleLogin(emailInput, passInput, submitBtn, errEl));

    [emailInput, passInput].forEach(inp =>
      inp.addEventListener('keydown', e=>{ if(e.key==='Enter') this._handleLogin(emailInput, passInput, submitBtn, errEl); })
    );

    card.appendChild(submitBtn);

    /* خيار تفعيل الدخول السريع (placeholder — يظهر بعد الدخول) */
    const quickSetup = document.createElement('div');
    quickSetup.id = 'quick-setup-wrap';
    quickSetup.style.cssText = `
      margin-top:16px;padding:14px;
      background:rgba(16,185,129,0.10);
      border:1px solid rgba(16,185,129,0.25);
      border-radius:14px;display:none;`;
    quickSetup.innerHTML = `
      <p style="color:rgba(16,185,129,0.9);font-size:0.82rem;margin-bottom:10px;text-align:center;">
        ⚡ فعّل الدخول السريع بمعادلة رياضية
      </p>
      <div style="display:flex;gap:8px;">
        <input id="quick-eq-input" type="text" dir="ltr"
          placeholder="مثال: 12+88"
          style="flex:1;padding:9px 12px;border-radius:10px;
                 background:rgba(255,255,255,0.09);
                 border:1px solid rgba(255,255,255,0.15);
                 color:#fff;font-size:0.88rem;font-family:monospace;outline:none;">
        <button id="quick-eq-save"
          style="padding:9px 14px;border-radius:10px;border:none;
                 background:rgba(16,185,129,0.8);color:#fff;
                 font-size:0.82rem;font-family:inherit;cursor:pointer;">
          تفعيل
        </button>
      </div>
      <p id="quick-eq-preview"
        style="font-size:0.75rem;color:rgba(255,255,255,0.45);margin-top:6px;text-align:center;"></p>`;
    card.appendChild(quickSetup);

    return card;
  },

  // ─────────────────────────────────────────────
  // قلب البطاقة
  // ─────────────────────────────────────────────
  _flipToLogin() {
    const f = document.getElementById('login-flipper');
    if (!f || this._state.flipped) return;
    this._state.flipped = true;
    f.style.transform = 'rotateY(180deg)';
    setTimeout(()=>{ document.getElementById('login-email')?.focus(); },600);
  },

  _flipToCalc() {
    const f = document.getElementById('login-flipper');
    if (!f || !this._state.flipped) return;
    this._state.flipped = false;
    f.style.transform = 'rotateY(0deg)';
  },

  // ─────────────────────────────────────────────
  // منطق الآلة الحاسبة
  // ─────────────────────────────────────────────
  _handleKey(v) {
    const s = this._state;
    if (v==='C') { s.expression=''; s.result='0'; s.justEvaluated=false; this._updateDisplay(); return; }
    if (v==='±') { if(s.result!=='0'){ s.result=String(parseFloat(s.result)*-1); s.expression=s.result; this._updateDisplay(); } return; }
    if (v==='=') { this._evaluate(); return; }
    if (s.justEvaluated && !'+-*/'.includes(v)) { s.expression=''; s.justEvaluated=false; }
    s.expression += v;
    this._updateDisplay(s.expression);
  },

  _handleKeyboard(e) {
    if (this._state.flipped) return; // لا تعمل الآلة وشاشة الدخول مفتوحة
    const map = {'Enter':'=','Backspace':'backspace','Escape':'C'};
    const key = map[e.key] || (e.key.match(/[\d+\-*.%]/) ? e.key : null);
    if (!key) return;
    if (key==='backspace') {
      this._state.expression = this._state.expression.slice(0,-1);
      this._updateDisplay(this._state.expression);
    } else {
      this._handleKey(key);
    }
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
    el.style.color='#f87171'; el.textContent=msg;
    setTimeout(()=>{
      el.style.color='#fff'; el.textContent='0';
      this._state.expression=''; this._state.result='0'; this._state.justEvaluated=false;
    },1300);
  },

  // ─────────────────────────────────────────────
  // الدخول السريع
  // ─────────────────────────────────────────────
  async _tryQuickLogin(equation) {
    const rEl = document.getElementById('calc-result');
    if (rEl) rEl.style.color='rgba(16,185,129,0.7)';
    const res = await AuthService.quickLogin(equation);
    if (isOk(res)) {
      if(rEl) rEl.style.color='#10b981';
      showToast(`⚡ مرحباً ${res.data.profile.display_name}`, 'success');
      setTimeout(()=>this._onSuccess?.(res.data.profile), 400);
    } else {
      if(rEl) rEl.style.color='#fff';
    }
  },

  // ─────────────────────────────────────────────
  // تسجيل الدخول التقليدي
  // ─────────────────────────────────────────────
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
      /* إظهار خيار الدخول السريع */
      const qs = document.getElementById('quick-setup-wrap');
      if (qs) {
        qs.style.display = 'block';
        this._bindQuickSetup(profile);
      }
      showToast(`مرحباً ${profile.display_name} 👋`, 'success');
      setTimeout(()=>this._onSuccess?.(profile), 600);
    } else {
      errEl.innerHTML = `<span>❌</span><span>${escapeHtml(result.error)}</span>`;
      passInput.value = '';
      passInput.focus();
      /* هزّ الكارت */
      const card = errEl.closest('div[style*="border-radius:28px"]');
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
        preview.style.color = 'rgba(16,185,129,0.8)';
      } catch {
        preview.textContent = eqInput.value ? 'معادلة غير صالحة' : '';
        preview.style.color = 'rgba(248,113,113,0.8)';
      }
    });

    saveBtn?.addEventListener('click', async ()=>{
      const eq = eqInput?.value?.trim();
      if (!eq) { showToast('أدخل معادلة أولاً','warning'); return; }
      const res = await AuthService.enableQuickLogin(eq);
      if (isOk(res)) {
        showToast('⚡ تم تفعيل الدخول السريع!','success');
        document.getElementById('quick-setup-wrap').style.display='none';
      } else {
        showToast(res.error,'error');
      }
    });
  },

  // ─────────────────────────────────────────────
  // وضع مظلم / حول
  // ─────────────────────────────────────────────
  _toggleDark() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    showToast(isDark ? '🌙 الوضع المظلم' : '☀️ الوضع الفاتح', 'info', 1500);
  },

  _showAbout() {
    showToast(`نظام أبو حذيفة v${APP_CONFIG.VERSION} — نظام مالي Offline-First`, 'info', 4000);
  },
};

window.LoginComponent = LoginComponent;
console.log('✅ LoginComponent v2.0 محمّل');
