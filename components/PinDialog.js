/**
 * components/PinDialog.js
 * نظام أبو حذيفة — المرحلة 2B
 *
 * مكوّن واجهة إدخال PIN
 * - لوحة أرقام على الشاشة (مناسبة للموبايل)
 * - 4-6 خانات مع إخفاء الأرقام (dots)
 * - عرض Brute Force countdown
 * - وضعان: verify (تحقق) + create (إنشاء مع تأكيد)
 * - Promise-based API: show() → Promise<string|null>
 */

'use strict';

// ============================================================
// CSS
// ============================================================

const _PIN_CSS = `
  /* ══ PinDialog ══ */

  .pin-overlay {
    position: fixed;
    inset: 0;
    background: rgba(4, 10, 25, 0.85);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: pinOverlayIn 0.2s ease;
  }

  @keyframes pinOverlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  @keyframes pinOverlayOut {
    from { opacity: 1; }
    to   { opacity: 0; }
  }

  @keyframes pinDialogOut {
    from { transform: scale(1)    translateY(0);    opacity: 1; }
    to   { transform: scale(0.92) translateY(12px); opacity: 0; }
  }

  .pin-overlay.is-closing {
    animation: pinOverlayOut 0.18s ease forwards;
    pointer-events: none;
  }

  .pin-overlay.is-closing .pin-dialog {
    animation: pinDialogOut 0.18s cubic-bezier(0.4, 0, 1, 1) forwards;
  }

  .pin-dialog {
    background: linear-gradient(160deg, #0d1f3c 0%, #0a1628 100%);
    border: 1px solid rgba(59, 130, 246, 0.25);
    border-radius: 20px;
    padding: 32px 28px 28px;
    width: 320px;
    max-width: 94vw;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(59,130,246,0.1);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    animation: pinDialogIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
    direction: rtl;
  }

  @keyframes pinDialogIn {
    from { transform: scale(0.88) translateY(16px); opacity: 0; }
    to   { transform: scale(1)    translateY(0);    opacity: 1; }
  }

  .pin-icon {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    box-shadow: 0 4px 16px rgba(29,78,216,0.4);
  }

  .pin-title {
    font-size: 18px;
    font-weight: 700;
    color: #f1f5f9;
    text-align: center;
    letter-spacing: 0.3px;
    margin: 0;
  }

  .pin-subtitle {
    font-size: 13px;
    color: #94a3b8;
    text-align: center;
    margin: -12px 0 0;
    min-height: 18px;
  }

  /* خانات الـ PIN */
  .pin-dots {
    display: flex;
    gap: 12px;
    align-items: center;
    justify-content: center;
    min-height: 44px;
  }

  .pin-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid #334155;
    background: transparent;
    transition: all 0.15s ease;
    position: relative;
  }

  .pin-dot.filled {
    background: #3b82f6;
    border-color: #3b82f6;
    box-shadow: 0 0 10px rgba(59,130,246,0.5);
    transform: scale(1.1);
  }

  .pin-dot.shake {
    animation: pinShake 0.4s ease;
  }

  @keyframes pinShake {
    0%,100% { transform: translateX(0); }
    20%      { transform: translateX(-6px); }
    40%      { transform: translateX(6px); }
    60%      { transform: translateX(-4px); }
    80%      { transform: translateX(4px); }
  }

  /* رسالة الخطأ */
  .pin-error {
    font-size: 13px;
    color: #f87171;
    text-align: center;
    min-height: 18px;
    font-weight: 500;
    animation: pinErrorIn 0.2s ease;
  }

  @keyframes pinErrorIn {
    from { opacity: 0; transform: translateY(-4px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  .pin-attempts {
    font-size: 12px;
    color: #fb923c;
    text-align: center;
    min-height: 16px;
  }

  /* لوحة الأرقام */
  .pin-keypad {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    width: 100%;
  }

  .pin-key {
    height: 56px;
    border-radius: 12px;
    border: 1px solid rgba(59,130,246,0.2);
    background: rgba(30, 58, 100, 0.4);
    color: #e2e8f0;
    font-size: 22px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.12s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    font-family: 'Segoe UI', system-ui, sans-serif;
  }

  .pin-key:hover {
    background: rgba(59,130,246,0.2);
    border-color: rgba(59,130,246,0.5);
  }

  .pin-key:active {
    transform: scale(0.93);
    background: rgba(59,130,246,0.35);
  }

  .pin-key.pin-key--del {
    font-size: 18px;
    background: rgba(71, 85, 105, 0.3);
    border-color: rgba(71,85,105,0.3);
    color: #94a3b8;
  }

  .pin-key.pin-key--del:hover {
    background: rgba(239,68,68,0.15);
    border-color: rgba(239,68,68,0.3);
    color: #f87171;
  }

  .pin-key.pin-key--ok {
    background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
    border-color: #3b82f6;
    color: #fff;
    font-size: 18px;
  }

  .pin-key.pin-key--ok:hover {
    background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
    box-shadow: 0 4px 16px rgba(59,130,246,0.4);
  }

  .pin-key.pin-key--ok:disabled,
  .pin-key.pin-key--ok[data-disabled] {
    opacity: 0.4;
    cursor: not-allowed;
    transform: none;
  }

  /* زر الإلغاء */
  .pin-cancel-btn {
    background: transparent;
    border: none;
    color: #64748b;
    font-size: 13px;
    cursor: pointer;
    padding: 4px 12px;
    border-radius: 6px;
    transition: color 0.15s;
    font-family: inherit;
  }

  .pin-cancel-btn:hover { color: #94a3b8; }

  /* حالة الإغلاق المؤقت */
  .pin-locked {
    color: #fbbf24;
    font-size: 14px;
    text-align: center;
    line-height: 1.5;
    padding: 4px 0;
  }

  .pin-locked-icon {
    font-size: 28px;
    display: block;
    margin-bottom: 6px;
  }
`;

// ============================================================
// State
// ============================================================

let _pinResolve  = null;
let _pinMode     = 'verify';   // 'verify' | 'create'
let _pinFirst    = null;       // PIN الأول في وضع الإنشاء
let _pinValue    = '';
let _pinMin      = 4;
let _pinMax      = 6;
let _pinUserId   = null;
let _pinTitle    = '';
let _pinSubtitle = '';

// ============================================================
// Render
// ============================================================

function _pinInjectCSS() {
  if (document.getElementById('pin-dialog-styles')) return;
  const style = document.createElement('style');
  style.id = 'pin-dialog-styles';
  style.textContent = _PIN_CSS;
  document.head.appendChild(style);
}

function _pinRender() {
  _pinInjectCSS();
  document.getElementById('pin-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'pin-overlay';
  overlay.className = 'pin-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', _pinTitle);
  overlay.setAttribute('tabindex', '-1');

  // الهيكل الثابت بدون أي inline onclick (متوافق مع CSP)
  overlay.innerHTML = `
    <div class="pin-dialog" id="pin-dialog-box">
      <div class="pin-icon">🔐</div>
      <p class="pin-title" id="pin-title-text">${_escHtml(_pinTitle)}</p>
      <p class="pin-subtitle" id="pin-subtitle-text">${_escHtml(_pinSubtitle)}</p>
      <div class="pin-dots" id="pin-dots-row" aria-live="polite" aria-label="خانات PIN">
        ${_renderDots()}
      </div>
      <div class="pin-error"    id="pin-error-msg" role="alert" aria-live="assertive"></div>
      <div class="pin-attempts" id="pin-attempts-msg"></div>
      <div class="pin-keypad"   id="pin-keypad"></div>
      <button class="pin-cancel-btn" id="pin-cancel-btn" type="button">إلغاء</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // ربط لوحة الأرقام بـ addEventListener (يعمل حتى مع CSP الصارم)
  _buildKeypad(overlay.querySelector('#pin-keypad'));

  // ربط زر الإلغاء
  overlay.querySelector('#pin-cancel-btn')
    ?.addEventListener('click', () => PinDialog._cancel());

  // استماع لضغطات لوحة المفاتيح الفعلية
  overlay.addEventListener('keydown', _pinHandleKeyboard);
  overlay.focus();
}

function _renderDots() {
  let html = '';
  for (let i = 0; i < _pinMax; i++) {
    const filled = i < _pinValue.length ? 'filled' : '';
    html += `<div class="pin-dot ${filled}" id="pin-dot-${i}"></div>`;
  }
  return html;
}

// بناء لوحة الأرقام عبر DOM مع addEventListener — لا inline onclick
function _buildKeypad(container) {
  if (!container) return;
  const keys = ['1','2','3','4','5','6','7','8','9','','0','⌫'];
  keys.forEach(k => {
    if (k === '') {
      container.appendChild(document.createElement('div'));
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = k;
    if (k === '⌫') {
      btn.className = 'pin-key pin-key--del';
      btn.setAttribute('aria-label', 'حذف آخر رقم');
      btn.addEventListener('click', () => PinDialog._delete());
    } else {
      btn.className = 'pin-key';
      btn.setAttribute('aria-label', k);
      btn.addEventListener('click', () => PinDialog._press(k));
    }
    container.appendChild(btn);
  });
}

// ============================================================
// دوال التحديث الديناميكي
// ============================================================

function _pinUpdateDots() {
  for (let i = 0; i < _pinMax; i++) {
    const dot = document.getElementById(`pin-dot-${i}`);
    if (!dot) continue;
    dot.classList.toggle('filled', i < _pinValue.length);
  }
  if (_pinMode === 'create') _pinUpdateStrength();
}

function _pinShowError(msg) {
  const el = document.getElementById('pin-error-msg');
  if (el) {
    el.textContent = msg;
    // تأثير الاهتزاز على الخانات
    const dots = document.getElementById('pin-dots-row');
    if (dots) {
      dots.querySelectorAll('.pin-dot').forEach(d => {
        d.classList.remove('shake');
        void d.offsetWidth; // reflow لإعادة تشغيل animation
        d.classList.add('shake');
      });
    }
  }
}

function _pinClearError() {
  const el = document.getElementById('pin-error-msg');
  if (el) el.textContent = '';
}

function _pinShowAttempts(remaining) {
  const el = document.getElementById('pin-attempts-msg');
  if (!el) return;
  if (remaining <= 0 || remaining >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS) {
    el.textContent = '';
  } else {
    el.textContent = `تبقّى ${remaining} ${remaining === 1 ? 'محاولة' : 'محاولات'}`;
  }
}

function _pinSetSubtitle(text) {
  const el = document.getElementById('pin-subtitle-text');
  if (el) el.textContent = text;
}

function _pinSetTitle(text) {
  const el = document.getElementById('pin-title-text');
  if (el) el.textContent = text;
  _pinTitle = text;
}

// ============================================================
// معالجات المدخلات
// ============================================================

function _pinHandleKeyboard(e) {
  if (e.key >= '0' && e.key <= '9') {
    PinDialog._press(e.key);
  } else if (e.key === 'Backspace') {
    PinDialog._delete();
  } else if (e.key === 'Enter') {
    if (_pinValue.length >= _pinMin) PinDialog._confirm();
  } else if (e.key === 'Escape') {
    PinDialog._cancel();
  }
}

// ============================================================
// قوة الـ PIN — كشف الأنماط الضعيفة (تكرار / تسلسل)
// ============================================================

/**
 * يقيّم قوة الـ PIN دون كشف قيمته. لا يطبع الـ PIN إطلاقاً.
 * @param {string} pin
 * @returns {{ weak: boolean, reason?: string }}
 */
function _pinStrength(pin) {
  const s = String(pin || '');
  if (s.length < 4) return { weak: true, reason: 'short' };
  // كل الأرقام متطابقة (1111, 0000)
  if (/^(\d)\1+$/.test(s)) return { weak: true, reason: 'repeated' };
  // تسلسل تصاعدي/تنازلي (1234 / 654321) — فرق ثابت ±1
  let asc = true, desc = true;
  for (let i = 1; i < s.length; i++) {
    const diff = s.charCodeAt(i) - s.charCodeAt(i - 1);
    if (diff !== 1)  asc  = false;
    if (diff !== -1) desc = false;
  }
  if (asc || desc) return { weak: true, reason: 'sequence' };
  return { weak: false };
}

/**
 * يُحدّث تلميح القوة في العنوان الفرعي — غير مانع، وكل قراءات DOM محميّة.
 * يظهر فقط في وضع الإنشاء، الخطوة الأولى، وبعد بلوغ الحد الأدنى للطول.
 */
function _pinUpdateStrength() {
  const el = document.getElementById('pin-subtitle-text');
  if (!el) return;
  if (_pinMode !== 'create' || _pinFirst !== null) return;
  if (_pinValue.length < _pinMin) return; // لا تلميح قبل اكتمال الطول الأدنى
  const st = _pinStrength(_pinValue);
  el.textContent = st.weak
    ? '⚠️ PIN ضعيف — تجنّب التكرار أو التسلسل'
    : '✅ PIN جيّد';
}

// ============================================================
// PinDialog — الكائن العام
// ============================================================

const PinDialog = {

  /**
   * عرض Dialog للتحقق من PIN موجود.
   * @param {object} opts
   * @param {string}  opts.title
   * @param {string}  [opts.subtitle]
   * @param {string}  [opts.userId]
   * @param {number}  [opts.minLength=4]
   * @param {number}  [opts.maxLength=6]
   * @returns {Promise<string|null>}  PIN أو null عند الإلغاء
   */
  show(opts = {}) {
    return new Promise(resolve => {
      _pinResolve  = resolve;
      _pinMode     = 'verify';
      _pinFirst    = null;
      _pinValue    = '';
      _pinMin      = opts.minLength || 4;
      _pinMax      = opts.maxLength || 6;
      _pinUserId   = opts.userId   || null;
      _pinTitle    = opts.title    || 'أدخل PIN';
      _pinSubtitle = opts.subtitle || '';
      _pinRender();
    });
  },

  /**
   * عرض Dialog لإنشاء PIN جديد (مع خطوة تأكيد).
   * @param {object} opts
   * @returns {Promise<string|null>}  PIN أو null عند الإلغاء
   */
  showCreate(opts = {}) {
    return new Promise(resolve => {
      _pinResolve  = resolve;
      _pinMode     = 'create';
      _pinFirst    = null;
      _pinValue    = '';
      _pinMin      = opts.minLength || 6;
      _pinMax      = opts.maxLength || 6;
      _pinUserId   = opts.userId   || null;
      _pinTitle    = 'إنشاء PIN جديد';
      _pinSubtitle = `أدخل PIN (${_pinMin}-${_pinMax} أرقام)`;
      _pinRender();
    });
  },

  /** ضغط رقم */
  _press(digit) {
    if (_pinValue.length >= _pinMax) return;
    _pinValue += digit;
    _pinClearError();
    _pinUpdateDots();

    if (_pinValue.length === _pinMax) {
      // تأكيد تلقائي عند الوصول للحد الأقصى
      setTimeout(() => this._confirm(), 120);
    }
  },

  /** حذف آخر رقم */
  _delete() {
    if (_pinValue.length === 0) return;
    _pinValue = _pinValue.slice(0, -1);
    _pinClearError();
    _pinUpdateDots();
  },

  /** تأكيد PIN */
  _confirm() {
    if (_pinValue.length < _pinMin) {
      _pinShowError(`PIN يجب أن يكون ${_pinMin} أرقام على الأقل`);
      return;
    }

    if (_pinMode === 'create') {
      if (_pinFirst === null) {
        // فحص قوة PIN قبل المتابعة
        const strength = _pinStrength(_pinValue);
        if (strength.weak) {
          _pinShowError('اختر PIN أصعب: تجنّب الأرقام المتشابهة والتسلسلات البسيطة');
          return;
        }
        // الخطوة الأولى: حفظ PIN والطلب بالتأكيد
        _pinFirst    = _pinValue;
        _pinValue    = '';
        _pinUpdateDots();
        _pinSetTitle('تأكيد PIN');
        _pinSetSubtitle('أعِد إدخال نفس الـ PIN للتأكيد');
        _pinClearError();
        return;
      }

      // الخطوة الثانية: مقارنة
      if (_pinValue !== _pinFirst) {
        _pinFirst = null;
        _pinValue = '';
        _pinUpdateDots();
        _pinSetTitle('إنشاء PIN جديد');
        _pinSetSubtitle(`أدخل PIN (${_pinMin}-${_pinMax} أرقام)`);
        _pinShowError('PIN غير متطابق. حاول مرة أخرى.');
        return;
      }
    }

    // ✅ نجح
    const result  = _pinValue;
    const resolve = _pinResolve;
    this.close();
    if (resolve) resolve(result);
  },

  /** إلغاء */
  _cancel() {
    const resolve = _pinResolve;
    this.close();
    if (resolve) resolve(null);
  },

  /** إغلاق الـ Dialog */
  close() {
    const overlay = document.getElementById('pin-overlay');
    if (overlay) {
      overlay.classList.add('is-closing');
      setTimeout(() => overlay.remove(), 200);
    }
    document.body.style.overflow = '';
    _pinResolve = null;
    _pinValue   = '';
    _pinFirst   = null;
  },

  /**
   * عرض رسالة خطأ من خارج الـ Dialog (بعد التحقق من الخادم).
   * @param {string}  message
   * @param {number}  [remaining] - محاولات متبقية
   */
  showError(message, remaining) {
    _pinValue = '';
    _pinUpdateDots();
    _pinShowError(message);
    if (remaining !== undefined) _pinShowAttempts(remaining);
  },

  /**
   * عرض شاشة القفل (Brute Force).
   * @param {number} untilMs - timestamp انتهاء القفل
   */
  showLocked(untilMs) {
    const box = document.getElementById('pin-dialog-box');
    if (!box) return;

    const tick = () => {
      const remaining = Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
      const mins = Math.floor(remaining / 60);
      const secs = remaining % 60;
      const el   = document.getElementById('pin-lock-countdown');
      if (el) {
        el.textContent = `${mins}:${String(secs).padStart(2, '0')}`;
      }
      if (remaining > 0) setTimeout(tick, 1000);
    };

    box.innerHTML = `
      <div class="pin-locked">
        <span class="pin-locked-icon">🔒</span>
        <strong>تم قفل الدخول مؤقتاً</strong><br>
        بسبب محاولات فاشلة متكررة<br>
        <br>
        <span style="font-size:22px;font-weight:700;color:#fbbf24">
          <span id="pin-lock-countdown">--:--</span>
        </span>
        <br><br>
        <button class="pin-cancel-btn" id="pin-lock-close-btn" type="button">إغلاق</button>
      </div>
    `;
    box.querySelector('#pin-lock-close-btn')
      ?.addEventListener('click', () => PinDialog._cancel());

    tick();
  },
};

// ============================================================
// مساعد: escape HTML
// ============================================================

function _escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// تصدير
// ============================================================

window.PinDialog = PinDialog;

console.log('✅ PinDialog.js محمّل — واجهة PIN جاهزة');
