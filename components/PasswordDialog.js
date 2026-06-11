/**
 * components/PasswordDialog.js
 * نظام أبو حذيفة — المرحلة 3 / S6
 *
 * مودال احترافي لإدخال كلمة المرور — يحل محل window.prompt().
 * تصميم مشابه لـ PinDialog.js:
 *  - input type="password" لإخفاء الأحرف
 *  - زر إظهار/إخفاء (toggle)
 *  - زر تأكيد + زر إلغاء
 *  - رسالة خطأ داخلية
 *  - Promise-based: show() → Promise<string|null>
 */

'use strict';

// ============================================================
// CSS
// ============================================================

const _PW_CSS = `
  /* ══ PasswordDialog ══ */

  .pw-overlay {
    position: fixed;
    inset: 0;
    background: rgba(4, 10, 25, 0.85);
    backdrop-filter: blur(6px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    animation: pwOverlayIn 0.2s ease;
  }

  @keyframes pwOverlayIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .pw-dialog {
    background: linear-gradient(160deg, #0d1f3c 0%, #0a1628 100%);
    border: 1px solid rgba(59,130,246,0.25);
    border-radius: 20px;
    padding: 32px 28px 28px;
    width: 340px;
    max-width: 94vw;
    box-shadow: 0 24px 64px rgba(0,0,0,0.6), 0 0 0 1px rgba(59,130,246,0.1);
    display: flex;
    flex-direction: column;
    gap: 18px;
    animation: pwDialogIn 0.25s cubic-bezier(0.34,1.56,0.64,1);
    direction: rtl;
  }

  @keyframes pwDialogIn {
    from { transform: scale(0.88) translateY(16px); opacity: 0; }
    to   { transform: scale(1)    translateY(0);    opacity: 1; }
  }

  .pw-icon {
    width: 52px;
    height: 52px;
    border-radius: 50%;
    background: linear-gradient(135deg, #1e40af 0%, #1d4ed8 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 22px;
    margin: 0 auto;
    box-shadow: 0 4px 16px rgba(29,78,216,0.4);
  }

  .pw-title {
    font-size: 17px;
    font-weight: 700;
    color: #f1f5f9;
    text-align: center;
    margin: 0;
  }

  .pw-subtitle {
    font-size: 13px;
    color: #64748b;
    text-align: center;
    margin: -8px 0 0;
    line-height: 1.5;
  }

  /* حقل كلمة المرور */
  .pw-input-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .pw-input {
    width: 100%;
    padding: 12px 44px 12px 14px;
    border-radius: 12px;
    border: 1.5px solid rgba(59,130,246,0.25);
    background: rgba(15,23,42,0.6);
    color: #e2e8f0;
    font-size: 1rem;
    font-family: 'Courier New', monospace;
    letter-spacing: 0.15em;
    outline: none;
    transition: border-color 0.15s, box-shadow 0.15s;
    box-sizing: border-box;
    direction: ltr;
    text-align: left;
  }

  .pw-input:focus {
    border-color: rgba(59,130,246,0.6);
    box-shadow: 0 0 0 3px rgba(59,130,246,0.15);
  }

  .pw-input::placeholder {
    color: #334155;
    letter-spacing: normal;
  }

  /* زر الإظهار/الإخفاء */
  .pw-toggle-btn {
    position: absolute;
    left: 10px;
    background: transparent;
    border: none;
    cursor: pointer;
    color: #475569;
    padding: 4px;
    line-height: 1;
    display: flex;
    align-items: center;
    transition: color 0.15s;
  }
  .pw-toggle-btn:hover { color: #94a3b8; }

  /* رسالة الخطأ */
  .pw-error {
    font-size: 13px;
    color: #f87171;
    text-align: center;
    min-height: 18px;
    font-weight: 500;
  }
  .pw-error:empty { display: none; }

  /* الأزرار */
  .pw-actions {
    display: flex;
    gap: 10px;
  }

  .pw-btn-confirm {
    flex: 1;
    padding: 12px;
    border-radius: 12px;
    border: none;
    background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
    color: #fff;
    font-size: 0.9rem;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.12s;
  }
  .pw-btn-confirm:hover {
    background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
    box-shadow: 0 4px 16px rgba(59,130,246,0.4);
  }
  .pw-btn-confirm:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .pw-btn-cancel {
    padding: 12px 18px;
    border-radius: 12px;
    border: 1px solid rgba(71,85,105,0.4);
    background: transparent;
    color: #64748b;
    font-size: 0.9rem;
    font-family: inherit;
    cursor: pointer;
    transition: all 0.12s;
  }
  .pw-btn-cancel:hover {
    background: rgba(71,85,105,0.1);
    color: #94a3b8;
    border-color: rgba(71,85,105,0.6);
  }
`;

// ============================================================
// State
// ============================================================

let _pwResolve   = null;
let _pwVisible   = false;

// ============================================================
// PasswordDialog
// ============================================================

const PasswordDialog = {

  /**
   * يُظهر مودال إدخال كلمة المرور.
   *
   * @param {object} [opts]
   * @param {string} [opts.title='أدخل كلمة المرور']
   * @param {string} [opts.subtitle]
   * @param {string} [opts.confirmLabel='تأكيد']
   * @returns {Promise<string|null>}  كلمة المرور أو null عند الإلغاء
   */
  show(opts = {}) {
    return new Promise(resolve => {
      _pwResolve = resolve;
      _pwVisible = false;
      this._render(opts);
    });
  },

  _injectCSS() {
    if (document.getElementById('pw-dialog-styles')) return;
    const style = document.createElement('style');
    style.id = 'pw-dialog-styles';
    style.textContent = _PW_CSS;
    document.head.appendChild(style);
  },

  _render(opts) {
    this._injectCSS();
    document.getElementById('pw-overlay')?.remove();

    const title        = opts.title        || 'أدخل كلمة المرور';
    const subtitle     = opts.subtitle     || '';
    const confirmLabel = opts.confirmLabel || 'تأكيد';

    const overlay = document.createElement('div');
    overlay.id = 'pw-overlay';
    overlay.className = 'pw-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', title);

    overlay.innerHTML = `
      <div class="pw-dialog" id="pw-dialog-box">
        <div class="pw-icon">🔑</div>
        <p class="pw-title">${_pwEsc(title)}</p>
        ${subtitle ? `<p class="pw-subtitle">${_pwEsc(subtitle)}</p>` : ''}

        <div class="pw-input-wrap">
          <input
            id="pw-input-field"
            class="pw-input"
            type="password"
            autocomplete="current-password"
            placeholder="••••••••"
            aria-label="كلمة المرور"
          />
          <button
            class="pw-toggle-btn"
            type="button"
            id="pw-toggle-btn"
            aria-label="إظهار/إخفاء كلمة المرور"
            tabindex="-1"
          >
            ${_eyeIcon(false)}
          </button>
        </div>

        <div class="pw-error" id="pw-error-msg" role="alert"></div>

        <div class="pw-actions">
          <button class="pw-btn-confirm" id="pw-btn-confirm">${_pwEsc(confirmLabel)}</button>
          <button class="pw-btn-cancel"  id="pw-btn-cancel">إلغاء</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // ─── ربط الأحداث ──────────────────────────────────────
    const input      = document.getElementById('pw-input-field');
    const confirmBtn = document.getElementById('pw-btn-confirm');
    const cancelBtn  = document.getElementById('pw-btn-cancel');
    const toggleBtn  = document.getElementById('pw-toggle-btn');

    confirmBtn.addEventListener('click', () => this._confirm());
    cancelBtn.addEventListener('click',  () => this._cancel());

    toggleBtn.addEventListener('click', () => {
      _pwVisible = !_pwVisible;
      input.type = _pwVisible ? 'text' : 'password';
      toggleBtn.innerHTML = _eyeIcon(_pwVisible);
    });

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  this._confirm();
      if (e.key === 'Escape') this._cancel();
    });

    input.addEventListener('input', () => {
      document.getElementById('pw-error-msg').textContent = '';
    });

    // لا نسمح بإغلاق الـ overlay بالنقر خارجه عشان لا يُغلق عن طريق الخطأ
    // (يوجد زر إلغاء صريح)

    setTimeout(() => input.focus(), 80);
  },

  _confirm() {
    const input = document.getElementById('pw-input-field');
    const value = input?.value || '';

    if (!value.trim()) {
      this._showError('كلمة المرور لا يمكن أن تكون فارغة');
      input?.focus();
      return;
    }

    this.close();
    if (_pwResolve) _pwResolve(value);
  },

  _cancel() {
    this.close();
    if (_pwResolve) _pwResolve(null);
  },

  /** يُظهر رسالة خطأ داخل الـ Dialog (للأخطاء التي تعود من الخادم) */
  showError(message) {
    this._showError(message);
    document.getElementById('pw-input-field')?.focus();
  },

  _showError(msg) {
    const el = document.getElementById('pw-error-msg');
    if (el) el.textContent = msg;
  },

  close() {
    const overlay = document.getElementById('pw-overlay');
    if (overlay) {
      overlay.style.animation = 'pwOverlayIn 0.15s ease reverse';
      setTimeout(() => overlay.remove(), 150);
    }
    _pwResolve = null;
    _pwVisible = false;
  },
};

// ============================================================
// أيقونة العين (إظهار / إخفاء)
// ============================================================

function _eyeIcon(visible) {
  return visible
    ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
         <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
         <line x1="1" y1="1" x2="23" y2="23"/>
       </svg>`
    : `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
         <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
         <circle cx="12" cy="12" r="3"/>
       </svg>`;
}

function _pwEsc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ============================================================
// تصدير
// ============================================================

window.PasswordDialog = PasswordDialog;

console.log('✅ PasswordDialog.js محمّل — مودال كلمة المرور جاهز');
