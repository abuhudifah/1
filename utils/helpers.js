/**
 * utils/helpers.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * الدوال المساعدة العامة — مستخدمة في جميع أجزاء التطبيق
 *
 * القواعد الصارمة:
 * - لا eval() أو Function() مطلقاً
 * - escapeHtml() على كل مخرجات DOM
 * - Result pattern للأخطاء بدلاً من الاستثناءات غير المعالجة
 */

'use strict';

// ============================================================
// 1. Result Pattern — نمط موحد للنجاح والفشل
// ============================================================

/**
 * ينشئ كائن نجاح
 * @param {*} data - البيانات المُعادة
 * @returns {{ ok: true, data: * }}
 */
function ok(data) {
  return { ok: true, data };
}

/**
 * ينشئ كائن فشل
 * @param {string} error - رسالة الخطأ
 * @param {*} [details] - تفاصيل إضافية اختيارية
 * @returns {{ ok: false, error: string, details: * }}
 */
function err(error, details = null) {
  return { ok: false, error, details };
}

/**
 * يتحقق هل الكائن ناجح
 * @param {{ ok: boolean }} result
 * @returns {boolean}
 */
function isOk(result) {
  return result && result.ok === true;
}

// ============================================================
// 2. أمان DOM — تنظيف جميع المخرجات
// ============================================================

/**
 * يُهرب النص لمنع XSS قبل إدراجه في HTML
 * يستبدل &, <, >, ", ' بمراجع HTML آمنة
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * يُنشئ عنصر DOM نصياً آمناً (textContent بدلاً من innerHTML)
 * @param {string} tag - اسم العنصر
 * @param {string} [className] - الكلاسات
 * @param {string} [textContent] - النص الداخلي (آمن تلقائياً)
 * @returns {HTMLElement}
 */
function createElement(tag, className = '', textContent = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (textContent) el.textContent = textContent;
  return el;
}

// ============================================================
// 3. معرفات فريدة
// ============================================================

/**
 * ينشئ UUID v4 عشوائياً
 * @returns {string}
 */
function generateUUID() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // fallback للمتصفحات القديمة
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * ينشئ معرفاً مؤقتاً للعمليات دون اتصال
 * يبدأ بـ TEMP_ ليتم استبداله بعد المزامنة
 * @returns {string}
 */
function generateTempId() {
  return `TEMP_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * يتحقق هل المعرف مؤقت (لم يُزامن بعد)
 * @param {string} id
 * @returns {boolean}
 */
function isTempId(id) {
  return typeof id === 'string' && id.startsWith('TEMP_');
}

// ============================================================
// 4. التنسيق — أرقام وعملات
// ============================================================

/**
 * يُنسّق رقماً كعملة سعودية
 * @param {number|string} amount
 * @param {boolean} [showSymbol=true] - إظهار رمز العملة
 * @returns {string}
 */
function formatCurrency(amount, showSymbol = true) {
  const num = parseFloat(amount) || 0;
  // أرقام صحيحة بدون كسور، مع فاصلة الآلاف (1,234)
  const rounded = Math.round(num);
  const formatted = rounded.toLocaleString('en-US'); // فاصلة إنجليزية 1,234
  const prefix = rounded < 0 ? '−' : '';
  const abs = Math.abs(rounded).toLocaleString('en-US');
  return showSymbol
    ? `${prefix}${abs} ${APP_CONFIG.CURRENCY_SYMBOL}`
    : `${prefix}${abs}`;
}

/**
 * يُنسّق رقماً صحيحاً بفاصلة الآلاف (1,234) بدون رمز العملة
 * @param {number|string} amount
 * @returns {string}
 */
function formatInt(amount) {
  const n = Math.round(parseFloat(amount) || 0);
  return n.toLocaleString('en-US');
}

/**
 * يُقرّب المبلغ لأقرب عدد صحيح (للحفظ)
 * @param {number|string} amount
 * @returns {number}
 */
function roundAmount(amount) {
  return Math.round(parseFloat(amount) || 0);
}

/**
 * يُحوّل نصاً إلى رقم بأمان
 * @param {string|number} value
 * @param {number} [fallback=0]
 * @returns {number}
 */
function toNumber(value, fallback = 0) {
  const num = parseFloat(String(value).replace(/,/g, ''));
  return isNaN(num) ? fallback : num;
}

/**
 * يُنسّق نسبة مئوية
 * @param {number} value
 * @param {number} [decimals=1]
 * @returns {string}
 */
function formatPercent(value, decimals = 1) {
  return `${Math.min(100, Math.max(0, value)).toFixed(decimals)}%`;
}

// ============================================================
// 5. التواريخ والوقت (بتوقيت السعودية)
// ============================================================

/**
 * يُعيد التاريخ الحالي بتوقيت السعودية بصيغة YYYY-MM-DD
 * @returns {string}
 */
function getCurrentSaudiDate() {
  return new Date().toLocaleDateString('en-CA', { timeZone: APP_CONFIG.TIMEZONE });
}

/**
 * يُعيد وقت الآن بتوقيت السعودية بصيغة HH:MM:SS
 * @returns {string}
 */
function getCurrentSaudiTime() {
  return new Date().toLocaleTimeString('en-GB', { timeZone: APP_CONFIG.TIMEZONE });
}

/**
 * يُنسّق تاريخاً لعرضه بالعربية
 * @param {string|Date} dateStr
 * @returns {string}
 */
function formatDateArabic(dateStr) {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(APP_CONFIG.LOCALE, {
      timeZone : APP_CONFIG.TIMEZONE,
      year     : 'numeric',
      month    : 'long',
      day      : 'numeric',
    });
  } catch (e) {
    return String(dateStr);
  }
}

/**
 * يُنسّق تاريخاً ووقتاً معاً
 * @param {string|Date} dateStr
 * @returns {string}
 */
function formatDateTimeArabic(dateStr) {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    return date.toLocaleString(APP_CONFIG.LOCALE, {
      timeZone : APP_CONFIG.TIMEZONE,
      year     : 'numeric',
      month    : 'short',
      day      : 'numeric',
      hour     : '2-digit',
      minute   : '2-digit',
    });
  } catch (e) {
    return String(dateStr);
  }
}

/**
 * يُعيد فرق الوقت نسبياً (منذ قليل، منذ ساعة، إلخ)
 * @param {string|Date} dateStr
 * @returns {string}
 */
function timeAgo(dateStr) {
  if (!dateStr) return '—';
  try {
    const diff  = Date.now() - new Date(dateStr).getTime();
    const secs  = Math.floor(diff / 1_000);
    const mins  = Math.floor(secs  / 60);
    const hours = Math.floor(mins  / 60);
    const days  = Math.floor(hours / 24);

    if (secs  < 60)  return 'منذ لحظات';
    if (mins  < 60)  return `منذ ${mins} دقيقة`;
    if (hours < 24)  return `منذ ${hours} ساعة`;
    if (days  < 7)   return `منذ ${days} يوم`;
    return formatDateArabic(dateStr);
  } catch (e) {
    return '—';
  }
}

/**
 * يُعيد تاريخ الأمس بصيغة YYYY-MM-DD (بتوقيت السعودية)
 * @returns {string}
 */
function getYesterdaySaudiDate() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return yesterday.toLocaleDateString('en-CA', { timeZone: APP_CONFIG.TIMEZONE });
}

// ============================================================
// 6. التنبيهات (Toast Notifications)
// ============================================================

let _toastContainer = null;

/**
 * يُنشئ حاوية التنبيهات إن لم تكن موجودة
 * @returns {HTMLElement}
 */
function _getToastContainer() {
  if (!_toastContainer) {
    _toastContainer = document.createElement('div');
    _toastContainer.id = 'toast-container';
    _toastContainer.style.cssText = [
      'position: fixed',
      'top: 50%',
      'left: 50%',
      'transform: translate(-50%, -50%)',
      'z-index: 99999',
      'display: flex',
      'flex-direction: column',
      'align-items: center',
      'gap: 10px',
      'pointer-events: none',
    ].join(';');
    document.body.appendChild(_toastContainer);
  }
  return _toastContainer;
}

/**
 * يُظهر تنبيهاً في وسط الشاشة يختفي تلقائياً
 * @param {string} message - نص التنبيه
 * @param {'success'|'error'|'warning'|'info'} [type='info'] - نوع التنبيه
 * @param {number} [duration] - مدة الظهور بالمللي ثانية
 */
function showToast(message, type = 'info', duration = APP_CONFIG.DEFAULT_TOAST_MS) {
  const container = _getToastContainer();

  const icons = {
    success : '✅',
    error   : '❌',
    warning : '⚠️',
    info    : 'ℹ️',
  };

  const colors = {
    success : 'var(--success)',
    error   : 'var(--danger)',
    warning : 'var(--warning)',
    info    : 'var(--info)',
  };

  const toast = document.createElement('div');
  toast.className = 'toast-item';
  toast.style.cssText = [
    'display: flex',
    'align-items: center',
    'gap: 10px',
    'padding: 14px 20px',
    'border-radius: 12px',
    'background: var(--glass-bg)',
    'backdrop-filter: blur(16px)',
    '-webkit-backdrop-filter: blur(16px)',
    'border: 1px solid var(--glass-border)',
    'box-shadow: 0 8px 32px rgba(0,0,0,0.18)',
    'font-size: 0.95rem',
    'font-weight: 500',
    'color: var(--text-primary)',
    `border-right: 4px solid ${colors[type] || colors.info}`,
    'pointer-events: auto',
    'cursor: pointer',
    'min-width: 260px',
    'max-width: 420px',
    'text-align: right',
    'direction: rtl',
    'opacity: 0',
    'transform: translateY(-12px) scale(0.96)',
    'transition: all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
  ].join(';');

  // محتوى التنبيه — آمن بالكامل (textContent)
  const icon = document.createElement('span');
  icon.textContent = icons[type] || icons.info;
  icon.style.fontSize = '1.1rem';
  icon.style.flexShrink = '0';

  const text = document.createElement('span');
  text.textContent = message; // textContent آمن — لا innerHTML هنا
  text.style.flex = '1';

  toast.appendChild(icon);
  toast.appendChild(text);

  toast.addEventListener('click', () => removeToast(toast));
  container.appendChild(toast);

  // تأخير قصير ثم إظهار التنبيه بأنيميشن
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.style.opacity  = '1';
      toast.style.transform = 'translateY(0) scale(1)';
    });
  });

  const timer = setTimeout(() => removeToast(toast), duration);
  toast._timer = timer;
}

/**
 * يُزيل تنبيهاً بأنيميشن
 * @param {HTMLElement} toast
 */
function removeToast(toast) {
  if (!toast || !toast.parentNode) return;
  clearTimeout(toast._timer);
  toast.style.opacity   = '0';
  toast.style.transform = 'translateY(-8px) scale(0.95)';
  setTimeout(() => {
    if (toast.parentNode) toast.parentNode.removeChild(toast);
  }, 280);
}

// ============================================================
// 7. مودال التأكيد المخصص (بدلاً من confirm() النظامي)
// ============================================================

/**
 * يُظهر مودال تأكيد مخصص بنمط زجاجي
 * @param {string} message - نص التأكيد
 * @param {string} [confirmText='تأكيد'] - نص زر التأكيد
 * @param {string} [cancelText='إلغاء'] - نص زر الإلغاء
 * @param {'danger'|'warning'|'info'} [type='danger'] - نوع المودال
 * @returns {Promise<boolean>}
 */
function confirmDialog(message, confirmText = 'تأكيد', cancelText = 'إلغاء', type = 'danger') {
  return new Promise((resolve) => {
    // إزالة أي مودال سابق
    const existing = document.getElementById('confirm-modal-overlay');
    if (existing) existing.remove();

    const typeColors = {
      danger  : 'var(--danger)',
      warning : 'var(--warning)',
      info    : 'var(--accent)',
    };
    const accentColor = typeColors[type] || typeColors.danger;

    const overlay = document.createElement('div');
    overlay.id = 'confirm-modal-overlay';
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background: rgba(0,0,0,0.55)',
      'backdrop-filter: blur(4px)',
      'z-index: 99998',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'padding: 20px',
      'opacity: 0',
      'transition: opacity 0.2s ease',
    ].join(';');

    const modal = document.createElement('div');
    modal.style.cssText = [
      'background: var(--glass-bg)',
      'backdrop-filter: blur(20px)',
      '-webkit-backdrop-filter: blur(20px)',
      'border: 1px solid var(--glass-border)',
      'border-radius: 20px',
      'padding: 32px',
      'max-width: 420px',
      'width: 100%',
      'box-shadow: 0 24px 64px rgba(0,0,0,0.22)',
      'direction: rtl',
      'transform: scale(0.92) translateY(16px)',
      'transition: transform 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
    ].join(';');

    // أيقونة التحذير
    const iconWrap = document.createElement('div');
    iconWrap.style.cssText = `text-align:center;margin-bottom:16px;font-size:2.4rem;`;
    const icons = { danger: '⚠️', warning: '⚠️', info: 'ℹ️' };
    iconWrap.textContent = icons[type] || '⚠️';

    // نص التأكيد
    const msgEl = document.createElement('p');
    msgEl.textContent = message;
    msgEl.style.cssText = [
      'color: var(--text-primary)',
      'font-size: 1rem',
      'font-weight: 500',
      'text-align: center',
      'line-height: 1.7',
      'margin-bottom: 24px',
    ].join(';');

    // صف الأزرار
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;gap:12px;';

    const btnConfirm = document.createElement('button');
    btnConfirm.textContent = confirmText;
    btnConfirm.style.cssText = [
      'flex: 1',
      'padding: 12px',
      'border: none',
      'border-radius: 12px',
      `background: ${accentColor}`,
      'color: #fff',
      'font-size: 0.95rem',
      'font-weight: 600',
      'cursor: pointer',
      'font-family: inherit',
      'transition: opacity 0.15s',
    ].join(';');
    btnConfirm.onmouseenter = () => { btnConfirm.style.opacity = '0.87'; };
    btnConfirm.onmouseleave = () => { btnConfirm.style.opacity = '1'; };

    const btnCancel = document.createElement('button');
    btnCancel.textContent = cancelText;
    btnCancel.style.cssText = [
      'flex: 1',
      'padding: 12px',
      'border: 1px solid var(--glass-border)',
      'border-radius: 12px',
      'background: transparent',
      'color: var(--text-secondary)',
      'font-size: 0.95rem',
      'font-weight: 500',
      'cursor: pointer',
      'font-family: inherit',
      'transition: background 0.15s',
    ].join(';');
    btnCancel.onmouseenter = () => { btnCancel.style.background = 'var(--glass-hover)'; };
    btnCancel.onmouseleave = () => { btnCancel.style.background = 'transparent'; };

    const cleanup = (result) => {
      overlay.style.opacity  = '0';
      modal.style.transform  = 'scale(0.92) translateY(16px)';
      setTimeout(() => {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        resolve(result);
      }, 220);
    };

    btnConfirm.addEventListener('click', () => cleanup(true));
    btnCancel.addEventListener('click',  () => cleanup(false));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) cleanup(false);
    });

    btnRow.appendChild(btnConfirm);
    btnRow.appendChild(btnCancel);
    modal.appendChild(iconWrap);
    modal.appendChild(msgEl);
    modal.appendChild(btnRow);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // إطلاق الأنيميشن بعد إضافة العنصر للـ DOM
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'scale(1) translateY(0)';
      });
    });
  });
}

// ============================================================
// 8. Debounce — تأجيل تنفيذ دالة لتقليل الاستدعاءات المتكررة
// ============================================================

/**
 * يُعيد نسخة مؤجلة من الدالة
 * @param {Function} fn - الدالة الأصلية
 * @param {number} [delay=300] - التأخير بالمللي ثانية
 * @returns {Function}
 */
function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

/**
 * يُعيد نسخة محدودة السرعة من الدالة (throttle)
 * @param {Function} fn
 * @param {number} [limit=300]
 * @returns {Function}
 */
function throttle(fn, limit = 300) {
  let lastCall = 0;
  return function (...args) {
    const now = Date.now();
    if (now - lastCall >= limit) {
      lastCall = now;
      return fn.apply(this, args);
    }
  };
}

// ============================================================
// 9. تشفير SHA-256 (للمعادلة السريعة وكلمات المرور المحلية)
// ============================================================

// Salt ثابت على مستوى التطبيق — يمنع هجمات Rainbow Table على الهاشات المخزنة
const APP_SALT = 'ahu_secure_salt_v1_2024';

/**
 * يحسب هاش SHA-256 مع Salt لنص ما
 * @param {string} text   - النص المراد تشفيره (المعادلة)
 * @param {string|null} userId - إذا مُرِّر، يُدمج في النص لربط الهاش بمستخدم محدد
 * @returns {Promise<string>} - الهاش بصيغة hex
 */
async function hashSHA256(text, userId = null) {
  const salted  = userId
    ? `${userId}:${String(text)}:${APP_SALT}`
    : `${String(text)}:${APP_SALT}`;
  const encoder = new TextEncoder();
  const data     = encoder.encode(salted);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray  = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ============================================================
// 10. نسخ النص إلى الحافظة
// ============================================================

/**
 * ينسخ نصاً إلى الحافظة ويُظهر رسالة تأكيد
 * @param {string} text - النص المُراد نسخه
 * @param {string} [successMsg='تم النسخ'] - رسالة النجاح
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text, successMsg = 'تم النسخ إلى الحافظة ✓') {
  try {
    await navigator.clipboard.writeText(String(text));
    showToast(successMsg, 'success', 2000);
    return true;
  } catch (e) {
    // fallback للمتصفحات القديمة
    try {
      const ta = document.createElement('textarea');
      ta.value = String(text);
      ta.style.position = 'fixed';
      ta.style.opacity  = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      showToast(successMsg, 'success', 2000);
      return true;
    } catch (e) {
      showToast('فشل النسخ', 'error');
      return false;
    }
  }
}

// ============================================================
// 11. مشاركة نص (واتساب / الحافظة)
// ============================================================

/**
 * يُشارك نصاً عبر Web Share API أو ينسخه للحافظة
 * @param {string} text - النص المُراد مشاركته
 * @param {string} [title] - عنوان للمشاركة
 */
async function shareText(text, title = APP_CONFIG.NAME_SHORT) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text });
      return;
    } catch (e) { /* المستخدم أغلق نافذة المشاركة أو رفض الإذن */ }
  }
  // fallback: نسخ للحافظة
  await copyToClipboard(text, 'تم نسخ التقرير للحافظة — يمكنك لصقه في واتساب ✓');
}

// ============================================================
// 12. التحقق من صحة المدخلات
// ============================================================

/**
 * يتحقق هل المبلغ صالح (رقم موجب)
 * @param {string|number} value
 * @returns {boolean}
 */
function isValidAmount(value) {
  const num = toNumber(value);
  const min = window.AMOUNT_CONFIG?.MIN ?? 0.01;
  const max = window.AMOUNT_CONFIG?.MAX ?? 10_000_000;
  return !isNaN(num) && num >= min && num <= max;
}

/**
 * يتحقق هل التاريخ صالح
 * @param {string} dateStr - بصيغة YYYY-MM-DD
 * @returns {boolean}
 */
function isValidDate(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return !isNaN(d.getTime());
}

/**
 * يتحقق هل البريد الإلكتروني صالح
 * @param {string} email
 * @returns {boolean}
 */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email));
}

// ============================================================
// 13. أدوات مساعدة للمصادقة والجلسة
// ============================================================

/**
 * يحفظ بيانات الجلسة في sessionStorage
 * @param {object} sessionData
 */
function saveSession(sessionData) {
  try {
    // ✅ S8: الحفاظ على sessionExpiresAt الأصلية عند تجديد الجلسة لمنع إعادة ضبط الـ 8 ساعات
    const existing = getSession();
    const data = {
      ...sessionData,
      sessionExpiresAt: sessionData.sessionExpiresAt
        ?? existing?.sessionExpiresAt
        ?? (Date.now() + 8 * 60 * 60 * 1000),
    };
    sessionStorage.setItem(SECURITY_CONFIG.SESSION_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('خطأ في حفظ الجلسة:', e);
  }
}

/**
 * يجلب بيانات الجلسة من sessionStorage
 * @returns {object|null}
 */
function getSession() {
  try {
    const raw = sessionStorage.getItem(SECURITY_CONFIG.SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * يمسح بيانات الجلسة
 */
function clearSession() {
  try {
    sessionStorage.removeItem(SECURITY_CONFIG.SESSION_KEY);
    sessionStorage.removeItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY);
  } catch (e) { /* sessionStorage غير متاح */ }
}

// ============================================================
// 14. أدوات الأداء
// ============================================================

/**
 * ينتظر عدداً من المللي ثانية (Promise-based sleep)
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * يحسب تأخير exponential backoff مع jitter
 * @param {number} retries - عدد المحاولات السابقة
 * @returns {number} - التأخير بالمللي ثانية
 */
function calcBackoffDelay(retries) {
  const base    = SYNC_CONFIG.BASE_BACKOFF_MS;
  const max     = SYNC_CONFIG.MAX_BACKOFF_MS;
  const jitter  = SYNC_CONFIG.JITTER_PERCENT;
  const delay   = Math.min(max, base * Math.pow(2, retries));
  const rand    = 1 + (Math.random() * 2 - 1) * jitter;
  return Math.floor(delay * rand);
}

// ============================================================
// 15. حالة التحميل على الأزرار
// ============================================================

/**
 * يُعطّل زراً ويُظهر مؤشر تحميل
 * @param {HTMLButtonElement} btn
 * @param {string} [loadingText='جاري الحفظ...']
 * @returns {() => void} - دالة الاستعادة
 */
function setButtonLoading(btn, loadingText = 'جاري الحفظ...') {
  if (!btn) return () => {};
  const original = btn.textContent;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.textContent = loadingText;
  btn.style.opacity = '0.75';
  btn.style.cursor  = 'not-allowed';

  return () => {
    btn.disabled     = wasDisabled;
    btn.textContent  = original;
    btn.style.opacity = '';
    btn.style.cursor  = '';
  };
}

// ============================================================
// 16. حساب فئة شريط التقدم (للسقف المالي)
// ============================================================

/**
 * يُعيد اسم فئة CSS لشريط التقدم حسب النسبة
 * @param {number} percent - النسبة من 0 إلى 100
 * @returns {'low'|'medium'|'high'}
 */
function getProgressClass(percent) {
  if (percent <= 30) return 'low';
  if (percent <= 70) return 'medium';
  return 'high';
}

// ============================================================
// 17. تحديد اللون حسب نوع العملية
// ============================================================

/**
 * يُعيد لون CSS لنوع المعاملة
 * @param {string} type
 * @returns {string}
 */
function getTransactionColor(type) {
  const colors = {
    collection        : 'var(--success)',
    deposit           : 'var(--accent)',
    expense           : 'var(--danger)',
    receipt           : 'var(--info)',
    delivery          : 'var(--warning)',
    refund_settlement : 'var(--success)',
  };
  return colors[type] || 'var(--text-secondary)';
}

/**
 * يُعيد أيقونة Lucide لنوع المعاملة
 * @param {string} type
 * @returns {string}
 */
function getTransactionIcon(type) {
  const icons = {
    collection        : 'arrow-down-circle',
    deposit           : 'landmark',
    expense           : 'minus-circle',
    receipt           : 'arrow-right-circle',
    delivery          : 'arrow-left-circle',
    refund_settlement : 'refresh-ccw',
  };
  return icons[type] || 'circle';
}

// ============================================================
// TASK-4.2: مساعد Dexie الموحّد
// ============================================================

async function withDexie(fn) {
  if (typeof db === 'undefined' || !db.isOpen()) return null;
  try { return await fn(db); } catch (e) { console.warn('⚠️ Dexie:', e.message); return null; }
}

// TASK-5.3: نمط Online-First الموحّد
async function fetchOnlineFirst(supabaseFn, dexieFn) {
  if (typeof isOnline === 'function' && isOnline()) {
    try { return await supabaseFn(); } catch (e) {
      console.warn('⚠️ fetchOnlineFirst: تعذر الوصول للخادم، التراجع لـ Dexie:', e.message);
    }
  }
  return dexieFn ? dexieFn() : err('offline');
}

// ============================================================
// تصدير جميع الدوال للاستخدام في بقية الملفات
// ============================================================

// ============================================================
// TASK-6.4: Logger مركزي بسيط — يجب تعريفه قبل Object.assign
// ============================================================

const Logger = {
  _buffer  : [],
  _maxBuffer: 200,
  log(level, module, msg, data) {
    const entry = { ts: new Date().toISOString(), level, module, msg, data };
    this._buffer.push(entry);
    if (this._buffer.length > this._maxBuffer) this._buffer.shift();
    if (level === 'error') console.error(`[${module}]`, msg, data ?? '');
    else if (level === 'warn') console.warn(`[${module}]`, msg, data ?? '');
  },
  error  : (m, msg, d) => Logger.log('error', m, msg, d),
  warn   : (m, msg, d) => Logger.log('warn',  m, msg, d),
  info   : (m, msg, d) => Logger.log('info',  m, msg, d),
  getLogs: ()          => [...Logger._buffer],
  clear  : ()          => { Logger._buffer = []; },
};
window.Logger = Logger;

Object.assign(window, {
  // Result pattern
  ok, err, isOk,

  // أمان DOM
  escapeHtml, createElement,

  // معرفات
  generateUUID, generateTempId, isTempId,

  // تنسيق
  formatCurrency, formatInt, roundAmount, toNumber, formatPercent,

  // تواريخ
  getCurrentSaudiDate, getCurrentSaudiTime,
  formatDateArabic, formatDateTimeArabic,
  timeAgo, getYesterdaySaudiDate,

  // UI
  showToast, confirmDialog,

  // أدوات
  debounce, throttle,
  hashSHA256,
  copyToClipboard, shareText,

  // تحقق
  isValidAmount, isValidDate, isValidEmail,

  // جلسة
  saveSession, getSession, clearSession,

  // أداء
  sleep, calcBackoffDelay,
  withDexie, fetchOnlineFirst,
  Logger,

  // أزرار
  setButtonLoading,

  // مساعدات UI
  getProgressClass,
  getTransactionColor,
  getTransactionIcon,
});

console.log('✅ helpers.js محمّل — جميع الدوال المساعدة جاهزة');

// ============================================================
// TASK-6.2: مُلقِّط الأخطاء غير المعالجة
// ============================================================

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason;
  const msg    = reason?.message || String(reason) || 'unknown';
  console.error('🔴 Unhandled Promise Rejection:', msg, reason);
  // تسجيل في Logger إن كان متاحاً
  if (window.Logger) Logger.error('App', 'unhandledRejection', msg);
});

window.addEventListener('error', (event) => {
  console.error('🔴 Uncaught Error:', event.message, event.filename, event.lineno);
  if (window.Logger) Logger.error('App', 'uncaughtError', event.message);
});
