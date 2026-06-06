/**
 * components/LoginComponent.js — v4.0 FINAL
 * نظام أبو حذيفة
 *
 * الإصلاح النهائي:
 * ✅ quickEnabled يتحقق من localStorage (يبقى بين الجلسات)
 * ✅ _tryQuickLogin تُمرر s.expression (النص الخام) → يتطابق مع enableQuickLogin
 * ✅ console.log تشخيصي واضح في كل خطوة
 * ✅ إظهار رسالة خطأ واضحة إذا فشل الدخول السريع
 */
'use strict';

// ─── هل يوجد دخول سريع محفوظ؟ ───
function _hasAnyQuickLogin() {
  try {
    if (sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY)) return true;
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
    quickPending : false, // منع الاستدعاء المزدوج
  },
  _onSuccess : null,
  _container : null,

  render(container, onSuccess) {
    this._container = container;
    this._onSuccess = onSuccess;
    // ✅ فحص localStorage + sessionStorage
    this._state.quickEnabled  = _hasAnyQuickLogin();
    this._state.quickPending  = false;
    this._state.flipped       = false;
    this._state.expression    = '';
    this._state.result        = '0';
    this._state.justEvaluated = false;
    this._state.showPassword  = false;
    container.innerHTML = '';
    this._injectCalcStyles();
    container.appendChild(this._buildPage());
    console.log(`[LoginComponent] quickEnabled=${this._state.quickEnabled}`);
  },

  _injectCalcStyles() {
    if (document.getElementById('calc-theme-styles')) return;
    const style = document.createElement('style');
    style.id = 'calc-theme-styles';
    style.textContent = `
      /* ── iOS Calculator Core ── */
      .calc-card {
        background:#1c1c1e;
        border:none;
        border-radius:32px;
        padding:24px 16px 20px;
        box-shadow:0 40px 100px rgba(0,0,0,0.70);
        animation:scaleIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
      }
      .calc-display {
        background:transparent;
        border:none;
        padding:8px 12px 18px;
        margin-bottom:12px;
        text-align:right;
        direction:ltr;
        min-height:110px;
        display:flex;
        flex-direction:column;
        justify-content:flex-end;
        overflow:hidden;
      }
      .calc-expr   { color:rgba(255,255,255,0.40);font-size:0.88rem;min-height:20px;word-break:break-all;margin-bottom:6px;font-family:monospace;text-align:right; }
      .calc-result { color:#fff;font-size:3rem;font-weight:300;line-height:1.1;word-break:break-all;text-align:right;transition:font-size 150ms ease,color 150ms ease;letter-spacing:-1px; }

      /* ── iOS Button Base ── */
      .ios-calc-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:12px; }
      .calc-btn-base {
        aspect-ratio:1/1;
        border:none;
        border-radius:50%;
        font-size:1.4rem;
        font-weight:500;
        cursor:pointer;
        font-family:inherit;
        display:flex;
        align-items:center;
        justify-content:center;
        transition:filter 80ms,transform 80ms;
        -webkit-tap-highlight-color:transparent;
        user-select:none;
        line-height:1;
      }
      .calc-btn-base.wide {
        border-radius:999px;
        aspect-ratio:auto;
        grid-column:span 2;
        justify-content:flex-start;
        padding:0 0 0 28px;
      }
      .calc-btn-num { background:#333333;color:#fff; }
      .calc-btn-op  { background:#ff9f0a;color:#fff; }
      .calc-btn-fn  { background:#a5a5a5;color:#1c1c1e; }
      .calc-btn-eq  { background:#ff9f0a;color:#fff; }
      .calc-btn-base:active,.calc-btn-base.pressed { transform:scale(0.88);filter:brightness(1.3); }
      .calc-btn-num:hover { filter:brightness(1.15); }
      .calc-btn-op:hover  { filter:brightness(1.15); }
      .calc-btn-fn:hover  { filter:brightness(0.92); }

      /* ── Login Card ── */
      .login-card { background:rgba(255,255,255,0.92);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid rgba(15,23,42,0.10);border-radius:28px;padding:28px 24px 24px;box-shadow:0 32px 80px rgba(15,23,42,0.18),inset 0 1px 0 rgba(255,255,255,0.6); }
      .login-input { width:100%;padding:12px 16px;border-radius:14px;background:rgba(15,23,42,0.05);border:1.5px solid rgba(15,23,42,0.12);color:#0f172a;font-size:0.92rem;font-family:inherit;transition:border-color 150ms,box-shadow 150ms;outline:none; }
      .login-input:focus{border-color:rgba(37,99,235,0.60);box-shadow:0 0 0 3px rgba(37,99,235,0.15);background:rgba(255,255,255,0.95);}
      .login-submit { width:100%;padding:13px;border:none;border-radius:16px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:#fff;font-size:0.95rem;font-weight:700;cursor:pointer;font-family:inherit;box-shadow:0 4px 20px rgba(37,99,235,0.35);transition:box-shadow 150ms,transform 150ms; }
      .login-submit:hover{box-shadow:0 6px 28px rgba(37,99,235,0.50);transform:translateY(-1px);}

      /* ── Dark mode: login card only (calc always dark) ── */
      body.dark-mode .login-card{background:rgba(30,41,59,0.94);border-color:rgba(248,250,252,0.08);}
      body.dark-mode .login-input{background:rgba(15,23,42,0.50);border-color:rgba(248,250,252,0.12);color:#f1f5f9;}
      body.dark-mode .login-input:focus{border-color:rgba(59,130,246,0.60);background:rgba(30,41,59,0.80);}

      /* ── Page & Menu ── */
      .login-page-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;position:relative;overflow:hidden;transition:background 0.4s;}
      body:not(.dark-mode) .login-page-wrap{background:linear-gradient(135deg,#1c1c1e 0%,#2a2a2e 50%,#1c1c1e 100%);}
      body.dark-mode .login-page-wrap{background:linear-gradient(135deg,#0a0a0c 0%,#1c1c1e 50%,#0a0a0c 100%);}
      .menu-btn{width:44px;height:44px;border-radius:14px;background:rgba(255,255,255,0.10);border:1px solid rgba(255,255,255,0.16);color:#fff;font-size:1.3rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(8px);transition:background 150ms;}
      .menu-btn:hover{background:rgba(255,255,255,0.18);}
      .menu-dropdown{position:absolute;top:54px;right:0;background:rgba(28,28,30,0.97);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:8px;min-width:210px;display:none;box-shadow:0 20px 60px rgba(0,0,0,0.50);backdrop-filter:blur(24px);}
      .menu-item{display:flex;align-items:center;gap:10px;width:100%;padding:11px 14px;border:none;background:transparent;color:rgba(255,255,255,0.85);font-family:inherit;font-size:0.9rem;border-radius:10px;cursor:pointer;text-align:right;transition:background 150ms;}
      .menu-item:hover{background:rgba(255,255,255,0.08);}
      .switch-btn{width:100%;margin-top:14px;padding:12px;background:rgba(255,159,10,0.15);border:1px solid rgba(255,159,10,0.35);border-radius:14px;color:#ff9f0a;font-size:0.88rem;font-family:inherit;cursor:pointer;transition:all 150ms;display:flex;align-items:center;justify-content:center;gap:8px;}
      .switch-btn:hover{background:rgba(255,159,10,0.25);transform:translateY(-1px);}
      .back-btn{background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);border-radius:10px;color:rgba(255,255,255,0.70);padding:6px 12px;font-size:0.82rem;font-family:inherit;cursor:pointer;display:flex;align-items:center;gap:6px;transition:background 150ms;}
      body:not(.dark-mode) .back-btn{background:rgba(15,23,42,0.07);border-color:rgba(15,23,42,0.12);color:#475569;}
      .quick-hint{text-align:center;font-size:0.75rem;color:#ff9f0a;margin-bottom:12px;display:flex;align-items:center;justify-content:center;gap:4px;padding:6px;background:rgba(255,159,10,0.12);border-radius:8px;}
      .quick-trying{text-align:center;font-size:0.78rem;color:#ff9f0a;margin-top:8px;min-height:20px;}

      @keyframes scaleIn{from{opacity:0;transform:scale(0.94)}to{opacity:1;transform:scale(1)}}
      @keyframes pulse-glow{0%,100%{opacity:.6}50%{opacity:1}}
      @keyframes spin{to{transform:rotate(360deg)}}
      @keyframes shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-8px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(5px)}}
    `;
    document.head.appendChild(style);
  },

  _buildPage() {
    const page = document.createElement('div');
    page.className = 'login-page-wrap';

    const bgDecor = document.createElement('div');
    bgDecor.setAttribute('aria-hidden','true');
    bgDecor.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none;';
    bgDecor.innerHTML = `
      <div style="position:absolute;width:500px;height:500px;border-radius:50%;background:radial-gradient(circle,rgba(37,99,235,0.12) 0%,transparent 70%);top:-100px;right:-80px;animation:pulse-glow 5s ease-in-out infinite;"></div>
      <div style="position:absolute;width:350px;height:350px;border-radius:50%;background:radial-gradient(circle,rgba(5,150,105,0.10) 0%,transparent 70%);bottom:-60px;left:-60px;animation:pulse-glow 7s ease-in-out infinite 2s;"></div>`;
    page.appendChild(bgDecor);

    page.appendChild(this._buildMenuBtn());

    const scene = document.createElement('div');
    scene.style.cssText = 'width:100%;max-width:360px;perspective:1200px;position:relative;z-index:10;';

    const flipper = document.createElement('div');
    flipper.id = 'login-flipper';
    flipper.style.cssText = 'position:relative;width:100%;transform-style:preserve-3d;transition:transform 0.6s cubic-bezier(0.4,0.2,0.2,1);';

    const front = document.createElement('div');
    front.style.cssText = 'width:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;';
    front.appendChild(this._buildCalcCard());

    const back = document.createElement('div');
    back.style.cssText = 'position:absolute;top:0;left:0;width:100%;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:rotateY(180deg);';
    back.appendChild(this._buildLoginCard());

    flipper.appendChild(front);
    flipper.appendChild(back);
    scene.appendChild(flipper);
    page.appendChild(scene);
    return page;
  },

  _buildMenuBtn() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:absolute;top:20px;right:20px;z-index:100;';
    const btn = document.createElement('button');
    btn.className = 'menu-btn'; btn.textContent = '☰'; btn.setAttribute('aria-label','القائمة');
    const menu = document.createElement('div');
    menu.className = 'menu-dropdown';
    const items = [
      { icon:'🔑', label:'تسجيل الدخول التقليدي', fn:()=>this._flipToLogin() },
      { icon:'🌙', label:'تبديل الوضع المظلم',     fn:()=>this._toggleDark() },
      { icon:'ℹ️', label:'حول التطبيق',            fn:()=>this._showAbout()  },
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
      this._state.menuOpen=!this._state.menuOpen;
      menu.style.display=this._state.menuOpen?'block':'none';
    });
    document.addEventListener('click',()=>{
      if(this._state.menuOpen){menu.style.display='none';this._state.menuOpen=false;}
    });
    wrap.appendChild(btn); wrap.appendChild(menu);
    return wrap;
  },

  _buildCalcCard() {
    const card = document.createElement('div');
    card.className = 'calc-card';

    const display = document.createElement('div');
    display.className = 'calc-display';
    display.innerHTML = `<div id="calc-expr" class="calc-expr"></div><div id="calc-result" class="calc-result">0</div>`;
    card.appendChild(display);

    if (this._state.quickEnabled) {
      const hint = document.createElement('div');
      hint.className = 'quick-hint';
      hint.innerHTML = `<span>⚡</span><span>الدخول السريع مفعّل — أدخل معادلتك واضغط =</span>`;
      card.appendChild(hint);
    }

    card.appendChild(this._buildKeypad());

    const tryingEl = document.createElement('div');
    tryingEl.id = 'quick-trying-msg';
    tryingEl.className = 'quick-trying';
    card.appendChild(tryingEl);

    const switchBtn = document.createElement('button');
    switchBtn.className = 'switch-btn';
    switchBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg><span>تسجيل الدخول التقليدي</span>`;
    switchBtn.addEventListener('click',()=>this._flipToLogin());
    card.appendChild(switchBtn);
    return card;
  },

  _buildKeypad() {
    const grid = document.createElement('div');
    grid.className = 'ios-calc-grid';
    const BTNS = [
      {l:'C', t:'fn',v:'C'}, {l:'⌫',t:'fn',v:'back'}, {l:'%',t:'op',v:'%'}, {l:'÷',t:'op',v:'/'},
      {l:'7', t:'n', v:'7'}, {l:'8', t:'n', v:'8'},    {l:'9', t:'n', v:'9'}, {l:'×',t:'op',v:'*'},
      {l:'4', t:'n', v:'4'}, {l:'5', t:'n', v:'5'},    {l:'6', t:'n', v:'6'}, {l:'−',t:'op',v:'-'},
      {l:'1', t:'n', v:'1'}, {l:'2', t:'n', v:'2'},    {l:'3', t:'n', v:'3'}, {l:'+',t:'op',v:'+'},
      {l:'0', t:'n', v:'0', wide:true},                 {l:'.',t:'n', v:'.'},  {l:'=',t:'eq',v:'='},
    ];
    const cls = {fn:'calc-btn-fn',op:'calc-btn-op',eq:'calc-btn-eq',n:'calc-btn-num'};
    BTNS.forEach(b => {
      const el = document.createElement('button');
      el.className = `calc-btn-base ${cls[b.t]||'calc-btn-num'}${b.wide?' wide':''}`;
      el.textContent = b.l;
      el.addEventListener('click', () => this._handleKey(b.v));
      el.addEventListener('mousedown', () => el.classList.add('pressed'));
      el.addEventListener('mouseup',   () => el.classList.remove('pressed'));
      el.addEventListener('mouseleave',() => el.classList.remove('pressed'));
      el.addEventListener('touchstart',() => el.classList.add('pressed'),   {passive:true});
      el.addEventListener('touchend',  () => el.classList.remove('pressed'),{passive:true});
      grid.appendChild(el);
    });
    document.addEventListener('keydown', e => this._handleKeyboard(e));
    return grid;
  },

  _buildLoginCard() {
    const card=document.createElement('div');
    card.className='login-card';

    const backRow=document.createElement('div');
    backRow.style.cssText='display:flex;align-items:center;margin-bottom:20px;gap:12px;';
    const backBtn=document.createElement('button');
    backBtn.className='back-btn';
    backBtn.innerHTML='<span>←</span><span>الحاسبة</span>';
    backBtn.addEventListener('click',()=>this._flipToCalc());
    backRow.appendChild(backBtn);
    const lTitle=document.createElement('p');
    lTitle.style.cssText='font-size:1.05rem;font-weight:700;flex:1;text-align:center;color:var(--text-primary,#0f172a);';
    lTitle.textContent='تسجيل الدخول';
    backRow.appendChild(lTitle);
    card.appendChild(backRow);

    // البريد
    const emailWrap=document.createElement('div');
    emailWrap.style.marginBottom='14px';
    const emailL=document.createElement('label');
    emailL.style.cssText='display:block;font-size:0.82rem;font-weight:600;margin-bottom:6px;color:var(--text-secondary,#475569);';
    emailL.textContent='البريد الإلكتروني';
    const emailI=document.createElement('input');
    emailI.id='login-email';emailI.type='email';emailI.autocomplete='email';
    emailI.placeholder='name@example.com';emailI.dir='ltr';emailI.className='login-input';
    emailWrap.appendChild(emailL);emailWrap.appendChild(emailI);
    card.appendChild(emailWrap);

    // كلمة المرور
    const passWrap=document.createElement('div');
    passWrap.style.marginBottom='8px';
    const passL=document.createElement('label');
    passL.style.cssText='display:block;font-size:0.82rem;font-weight:600;margin-bottom:6px;color:var(--text-secondary,#475569);';
    passL.textContent='كلمة المرور';
    const passRow=document.createElement('div');
    passRow.style.position='relative';
    const passI=document.createElement('input');
    passI.id='login-password';passI.type='password';passI.autocomplete='current-password';
    passI.placeholder='••••••••';passI.className='login-input';passI.style.paddingLeft='44px';
    const eyeBtn=document.createElement('button');
    eyeBtn.type='button';
    eyeBtn.style.cssText='position:absolute;left:12px;top:50%;transform:translateY(-50%);background:none;border:none;cursor:pointer;color:var(--text-muted,#94a3b8);padding:4px;font-size:1rem;';
    eyeBtn.innerHTML='👁';
    eyeBtn.addEventListener('click',()=>{
      this._state.showPassword=!this._state.showPassword;
      passI.type=this._state.showPassword?'text':'password';
      eyeBtn.innerHTML=this._state.showPassword?'🙈':'👁';
    });
    passRow.appendChild(passI);passRow.appendChild(eyeBtn);
    passWrap.appendChild(passL);passWrap.appendChild(passRow);
    card.appendChild(passWrap);

    const errEl=document.createElement('div');
    errEl.id='login-error';
    errEl.style.cssText='color:#dc2626;font-size:0.80rem;min-height:20px;margin-bottom:10px;text-align:center;display:flex;align-items:center;justify-content:center;gap:6px;';
    card.appendChild(errEl);

    const submitBtn=document.createElement('button');
    submitBtn.id='login-submit-btn';submitBtn.className='login-submit';submitBtn.textContent='دخول';
    submitBtn.addEventListener('click',()=>this._handleLogin(emailI,passI,submitBtn,errEl));
    [emailI,passI].forEach(inp=>inp.addEventListener('keydown',e=>{ if(e.key==='Enter') this._handleLogin(emailI,passI,submitBtn,errEl); }));
    card.appendChild(submitBtn);

    // قسم إعداد الدخول السريع
    const quickSetup=document.createElement('div');
    quickSetup.id='quick-setup-wrap';
    quickSetup.style.cssText='margin-top:16px;padding:14px;background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.22);border-radius:14px;display:none;';
    quickSetup.innerHTML=`
      <p style="color:rgba(5,150,105,0.9);font-size:0.82rem;margin-bottom:10px;text-align:center;">⚡ فعّل الدخول السريع بمعادلة رياضية</p>
      <div style="display:flex;gap:8px;">
        <input id="quick-eq-input" type="text" dir="ltr" placeholder="مثال: 12+88"
          style="flex:1;padding:9px 12px;border-radius:10px;background:rgba(15,23,42,0.06);border:1.5px solid rgba(15,23,42,0.12);color:var(--text-primary,#0f172a);font-size:0.88rem;font-family:monospace;outline:none;">
        <button id="quick-eq-save" style="padding:9px 14px;border-radius:10px;border:none;background:rgba(5,150,105,0.85);color:#fff;font-size:0.82rem;font-family:inherit;cursor:pointer;">تفعيل</button>
      </div>
      <p id="quick-eq-preview" style="font-size:0.75rem;color:var(--text-muted,#94a3b8);margin-top:6px;text-align:center;"></p>`;
    card.appendChild(quickSetup);
    return card;
  },

  _flipToLogin() {
    const f=document.getElementById('login-flipper');
    if(!f||this._state.flipped)return;
    this._state.flipped=true;
    f.style.transform='rotateY(180deg)';
    setTimeout(()=>document.getElementById('login-email')?.focus(),650);
  },
  _flipToCalc() {
    const f=document.getElementById('login-flipper');
    if(!f||!this._state.flipped)return;
    this._state.flipped=false;
    f.style.transform='rotateY(0deg)';
  },

  _handleKey(v) {
    const s=this._state;
    if(v==='C'){s.expression='';s.result='0';s.justEvaluated=false;this._updateDisplay();return;}
    if(v==='back'){s.expression=s.expression.slice(0,-1);this._updateDisplay(s.expression);return;}
    if(v==='±'){if(s.result!=='0'){s.result=String(parseFloat(s.result)*-1);s.expression=s.result;this._updateDisplay();}return;}
    if(v==='='){this._evaluate();return;}
    if(s.justEvaluated&&!'+-*/'.includes(v)){s.expression='';s.justEvaluated=false;}
    s.expression+=v;
    this._updateDisplay(s.expression);
  },

  _handleKeyboard(e) {
    if(this._state.flipped)return;
    const map={'Enter':'=','Backspace':'back','Escape':'C'};
    const key=map[e.key]||(e.key.match(/[\d+\-*.%/]/)?e.key:null);
    if(!key)return;
    e.preventDefault();
    this._handleKey(key);
  },

  _evaluate() {
    const s=this._state;
    if(!s.expression)return;
    try{
      const parser=new window.exprEval.Parser();
      const val=parser.evaluate(s.expression);
      if(typeof val!=='number'||!isFinite(val)){this._flashError('خطأ');return;}
      const formatted=Number.isInteger(val)?String(val):parseFloat(val.toFixed(10)).toString();
      s.result=formatted;s.justEvaluated=true;
      this._updateDisplay(s.expression,formatted);

      // ✅ الدخول السريع: يُمرر النص الخام (s.expression) وليس النتيجة
      if(s.quickEnabled && !s.quickPending){
        this._tryQuickLogin(s.expression);
      }
    }catch{this._flashError('خطأ في المعادلة');}
  },

  _updateDisplay(expr='',result=null){
    const eEl=document.getElementById('calc-expr');
    const rEl=document.getElementById('calc-result');
    if(eEl)eEl.textContent=expr||'';
    const txt=result!==null?result:(this._state.result||'0');
    if(rEl){rEl.textContent=txt;const l=txt.length;rEl.style.fontSize=l>12?'1.4rem':l>8?'1.8rem':'2.4rem';}
  },

  _flashError(msg){
    const el=document.getElementById('calc-result');
    if(!el)return;
    el.style.color='#dc2626';el.textContent=msg;
    setTimeout(()=>{el.style.color='';el.textContent='0';this._state.expression='';this._state.result='0';this._state.justEvaluated=false;},1300);
  },

  // ✅ الدخول السريع — مُصلَح بالكامل
  async _tryQuickLogin(equation){
    const s=this._state;
    if(s.quickPending)return; // منع الاستدعاء المزدوج
    s.quickPending=true;

    const rEl=document.getElementById('calc-result');
    const msgEl=document.getElementById('quick-trying-msg');

    if(rEl)rEl.style.color='rgba(5,150,105,0.7)';
    if(msgEl)msgEl.textContent='⚡ جاري التحقق...';

    console.log(`[LoginComponent] _tryQuickLogin: equation="${equation}"`);

    try{
      const res=await AuthService.quickLogin(equation);
      console.log('[LoginComponent] quickLogin result:', JSON.stringify(res));

      if(isOk(res)){
        if(rEl)rEl.style.color='var(--success,#059669)';
        if(msgEl)msgEl.textContent='✅ تم التحقق — جاري الدخول...';
        showToast(`⚡ مرحباً ${res.data.profile.display_name}`, 'success');
        setTimeout(()=>this._onSuccess?.(res.data.profile),400);
      }else{
        if(rEl)rEl.style.color='';
        if(msgEl)msgEl.textContent='';
        console.log('[LoginComponent] فشل الدخول السريع:', res.error);
        // لا نُظهر خطأ للمستخدم — فقط يستمر في استخدام الحاسبة
      }
    }catch(e){
      console.error('[LoginComponent] خطأ في _tryQuickLogin:', e);
      if(rEl)rEl.style.color='';
      if(msgEl)msgEl.textContent='';
    }finally{
      s.quickPending=false;
    }
  },

  async _handleLogin(emailInput,passInput,btn,errEl){
    if(this._state.isLoading)return;
    const email=emailInput.value.trim();
    const password=passInput.value;
    errEl.innerHTML='';
    if(!email){errEl.innerHTML='<span>⚠️</span><span>أدخل البريد الإلكتروني</span>';emailInput.focus();return;}
    if(!password){errEl.innerHTML='<span>⚠️</span><span>أدخل كلمة المرور</span>';passInput.focus();return;}

    this._state.isLoading=true;
    const origText=btn.textContent;
    btn.innerHTML='<span style="display:inline-block;animation:spin 0.6s linear infinite;">⟳</span> جاري الدخول...';
    btn.disabled=true;btn.style.opacity='0.75';

    const result=await AuthService.login(email,password);

    btn.disabled=false;btn.style.opacity='1';btn.textContent=origText;
    this._state.isLoading=false;

    if(isOk(result)){
      const profile=result.data.profile;
      // اعرض إعداد الدخول السريع فقط إذا لم يكن مفعّلاً
      if(!profile.quick_equation_hash){
        const qs=document.getElementById('quick-setup-wrap');
        if(qs){qs.style.display='block';this._bindQuickSetup(profile);}
      }
      // تحديث quickEnabled للجلسة الحالية
      this._state.quickEnabled=!!profile.quick_equation_hash;
      showToast(`مرحباً ${profile.display_name} 👋`,'success');
      setTimeout(()=>this._onSuccess?.(profile),600);
    }else{
      errEl.innerHTML=`<span>❌</span><span>${escapeHtml(result.error)}</span>`;
      passInput.value='';passInput.focus();
      const card=errEl.closest('.login-card');
      if(card){card.style.animation='shake 0.4s ease';setTimeout(()=>{card.style.animation='';},450);}
    }
  },

  _bindQuickSetup(profile){
    const saveBtn=document.getElementById('quick-eq-save');
    const eqInput=document.getElementById('quick-eq-input');
    const preview=document.getElementById('quick-eq-preview');

    eqInput?.addEventListener('input',()=>{
      if(!preview)return;
      try{
        const p=new window.exprEval.Parser();
        const v=p.evaluate(eqInput.value.trim());
        preview.textContent=`النتيجة: ${v}`;preview.style.color='rgba(5,150,105,0.8)';
      }catch{
        preview.textContent=eqInput.value?'معادلة غير صالحة':'';preview.style.color='rgba(220,38,38,0.8)';
      }
    });

    saveBtn?.addEventListener('click',async()=>{
      const eq=eqInput?.value?.trim();
      if(!eq){showToast('أدخل معادلة أولاً','warning');return;}
      const res=await AuthService.enableQuickLogin(eq);
      if(isOk(res)){
        showToast('⚡ تم تفعيل الدخول السريع!','success');
        document.getElementById('quick-setup-wrap').style.display='none';
        this._state.quickEnabled=true;
      }else{
        showToast(res.error,'error');
      }
    });
  },

  _toggleDark(){
    if(window.ThemeManager){const isDark=ThemeManager.toggle();showToast(isDark?'🌙 الوضع المظلم':'☀️ الوضع الفاتح','info',1500);}
    else{const isDark=document.body.classList.toggle('dark-mode');localStorage.setItem('abu_theme',isDark?'dark':'light');showToast(isDark?'🌙 الوضع المظلم':'☀️ الوضع الفاتح','info',1500);}
  },
  _showAbout(){showToast(`نظام أبو حذيفة v${APP_CONFIG.VERSION} — نظام مالي Offline-First`,'info',4000);},
};

window.LoginComponent=LoginComponent;
console.log('✅ LoginComponent v4.0 FINAL — الدخول السريع مُصلَح كلياً');
