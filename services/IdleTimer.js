/**
 * services/IdleTimer.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * خدمة مراقبة الخمول وتسجيل الخروج التلقائي
 *
 * المسؤوليات:
 * - مراقبة أحداث النشاط: mousemove, keydown, click, scroll, touchstart, touchmove
 * - بعد IDLE_TIMEOUT_MS من آخر نشاط → تسجيل خروج تلقائي
 * - إظهار تحذير قبل 60 ثانية من انتهاء المهلة
 * - يعمل فقط للمندوبين (role === 'agent')
 * - يوفر دوال: start(), stop(), reset(), isRunning()
 *
 * القواعد:
 * - لا eval() مطلقاً
 * - يُنظّف جميع المستمعين عند الإيقاف
 * - لا يؤثر على أداء التطبيق (passive listeners)
 */

'use strict';

const IdleTimer = (function () {

  // ============================================================
  // الثوابت
  // ============================================================

  /** مهلة الخمول الافتراضية للمندوب: 5 دقائق */
  const AGENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

  /** مهلة الخمول للمدير والمساعد: 90 دقيقة */
  const ADMIN_IDLE_TIMEOUT_MS = 90 * 60 * 1000;

  /** مهلة التحذير المسبق: 60 ثانية قبل انتهاء المهلة */
  const WARNING_BEFORE_MS = 60 * 1000;

  /** الأحداث التي تُعدّ نشاطاً */
  const ACTIVITY_EVENTS = [
    'mousemove',
    'keydown',
    'click',
    'scroll',
    'touchstart',
    'touchmove',
  ];

  // ============================================================
  // الحالة الداخلية
  // ============================================================

  let _running         = false;               // هل الخدمة تعمل؟
  let _idleTimer       = null;               // المؤقت الرئيسي للخروج
  let _warningTimer    = null;               // مؤقت التحذير المسبق
  let _warningShown    = false;              // هل ظهر التحذير؟
  let _warningToastEl  = null;              // عنصر التنبيه المعروض
  let _timeoutMs       = AGENT_IDLE_TIMEOUT_MS; // المهلة النشطة حالياً
  let _isAdmin         = false;             // مدير/مساعد: تحذير فقط بلا خروج

  // ============================================================
  // دوال المؤقتات
  // ============================================================

  /**
   * يُلغي جميع المؤقتات النشطة
   */
  function _clearTimers() {
    if (_idleTimer)    { clearTimeout(_idleTimer);    _idleTimer    = null; }
    if (_warningTimer) { clearTimeout(_warningTimer); _warningTimer = null; }
  }

  /**
   * يُخفي تنبيه التحذير إن كان معروضاً
   */
  function _hideWarning() {
    // التقاط مرجع محلي ثابت قبل تصفير المتغيّر العام — وإلا فإن الـ setTimeout
    // المؤجَّل يقرأ null فلا يُنفَّذ removeChild ويبقى التنبيه عالقاً في DOM.
    const el = _warningToastEl;
    _warningShown   = false;
    _warningToastEl = null;
    if (el && el.parentNode) {
      el.style.opacity   = '0';
      el.style.transform = 'translateY(-8px) scale(0.95)';
      setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 280);
    }
  }

  /**
   * يُظهر تنبيه تحذيري لا يختفي تلقائياً (يبقى حتى يُخفى يدوياً)
   */
  function _showWarning() {
    // إغلاق أي تنبيه سابق أولاً — يمنع تراكم تنبيهات يتيمة (idempotent)
    _hideWarning();
    _warningShown = true;

    // البحث عن حاوية التنبيهات أو إنشاؤها
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-item';
    toast.style.cssText = [
      'display: flex',
      'align-items: center',
      'gap: 10px',
      'padding: 14px 20px',
      'border-radius: 12px',
      'background: var(--glass-bg, rgba(255,255,255,0.92))',
      'backdrop-filter: blur(16px)',
      '-webkit-backdrop-filter: blur(16px)',
      'border: 1px solid var(--glass-border, rgba(15,23,42,0.10))',
      'box-shadow: 0 8px 32px rgba(0,0,0,0.18)',
      'font-size: 0.92rem',
      'font-weight: 600',
      'color: var(--text-primary, #0f172a)',
      'border-right: 4px solid var(--warning, #d97706)',
      'pointer-events: auto',
      'cursor: pointer',
      'min-width: 280px',
      'max-width: 420px',
      'text-align: right',
      'direction: rtl',
      'transition: all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
    ].join(';');

    const icon = document.createElement('span');
    icon.textContent = '⏱️';
    icon.style.cssText = 'font-size:1.2rem;flex-shrink:0;';

    const text = document.createElement('span');
    text.textContent = 'ستنتهي جلستك خلال دقيقة واحدة بسبب عدم النشاط. انقر أي مكان للاستمرار.';
    text.style.flex = '1';

    toast.appendChild(icon);
    toast.appendChild(text);

    // النقر على التنبيه يُغلقه دائماً (غير مشروط بـ _running) ثم يُعيد تعيين المؤقت إن كان نشطاً
    toast.addEventListener('click', () => { _hideWarning(); reset(); });

    container.appendChild(toast);
    _warningToastEl = toast;

    // ظهور بأنيميشن
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity   = '1';
        toast.style.transform = 'translateY(0) scale(1)';
      });
    });

    // ابدأ بدون opacity (لأنيميشن الدخول)
    toast.style.opacity   = '0';
    toast.style.transform = 'translateY(-12px) scale(0.96)';
  }

  /**
   * يُجدول مؤقتات التحذير والخروج
   */
  function _scheduleTimers() {
    _clearTimers();

    // مؤقت التحذير المسبق — لجميع الأدوار
    _warningTimer = setTimeout(() => {
      if (_running) _showWarning();
    }, _timeoutMs - WARNING_BEFORE_MS);

    // المؤقت الرئيسي — تسجيل خروج لجميع الأدوار
    _idleTimer = setTimeout(async () => {
      if (!_running) return;

      console.log('⏱️  IdleTimer: انتهت مهلة الخمول — تسجيل خروج تلقائي');
      _hideWarning();
      _running = false;
      _clearTimers();
      _removeActivityListeners();

      if (typeof showToast === 'function') {
        showToast('تم تسجيل خروجك تلقائياً بسبب عدم النشاط', 'warning', 4000);
      }

      await new Promise(resolve => setTimeout(resolve, 800));

      try {
        if (window.AuthService && typeof AuthService.logout === 'function') {
          await AuthService.logout();
        }
        if (window.AppStore) {
          AppStore.dispatchEvent(new CustomEvent('store:userCleared'));
        }
      } catch (e) {
        console.error('❌ IdleTimer: خطأ أثناء تسجيل الخروج:', e);
        window.location.reload();
      }
    }, _timeoutMs);
  }

  // ============================================================
  // معالج النشاط
  // ============================================================

  /**
   * يُعيد تعيين مؤقت الخمول عند أي نشاط
   * (دالة واحدة مُشتركة بين جميع الأحداث لتسهيل الإضافة والإزالة)
   */
  function _onActivity() {
    if (!_running) return;
    // إخفاء التحذير إن كان معروضاً
    if (_warningShown) {
      _hideWarning();
    }
    // إعادة جدولة المؤقتات
    _scheduleTimers();
  }

  // ============================================================
  // إدارة المستمعين
  // ============================================================

  /**
   * يُضيف مستمعي أحداث النشاط
   */
  function _addActivityListeners() {
    ACTIVITY_EVENTS.forEach(eventName => {
      document.addEventListener(eventName, _onActivity, { passive: true });
    });
  }

  /**
   * يُزيل مستمعي أحداث النشاط
   */
  function _removeActivityListeners() {
    ACTIVITY_EVENTS.forEach(eventName => {
      document.removeEventListener(eventName, _onActivity);
    });
  }

  // ============================================================
  // API العامة
  // ============================================================

  /**
   * يبدأ مراقبة الخمول لأي دور
   * @param {number} [timeoutMs] — المهلة بالمللي ثانية (افتراضي: 5 دقائق للمندوب)
   */
  function start(timeoutMs) {
    _timeoutMs = (typeof timeoutMs === 'number' && timeoutMs > 0)
      ? timeoutMs
      : AGENT_IDLE_TIMEOUT_MS;

    const role = (typeof AuthService !== 'undefined') ? AuthService.getCurrentRole?.() : null;
    _isAdmin = role === 'admin' || role === 'admin_assistant';

    if (_running) {
      reset();
      return;
    }

    _running      = false;
    _warningShown = false;

    _addActivityListeners();
    _running = true;
    _scheduleTimers();

    console.log(`✅ IdleTimer: بدأ — ${_timeoutMs / 60000} دقيقة`);
  }

  /**
   * يوقف مراقبة الخمول ويُنظّف كل شيء
   * يُستدعى عند تسجيل الخروج أو عند دخول مستخدم غير مندوب
   */
  function stop() {
    if (!_running && !_idleTimer && !_warningTimer) return;

    _running = false;
    _clearTimers();
    _removeActivityListeners();
    _hideWarning();

    console.log('🛑 IdleTimer: تم الإيقاف');
  }

  /**
   * يُعيد تعيين مؤقت الخمول (عند استئناف النشاط يدوياً)
   */
  function reset() {
    if (!_running) return;
    _hideWarning();
    _scheduleTimers();
  }

  /**
   * يُعيد هل الخدمة تعمل حالياً
   * @returns {boolean}
   */
  function isRunning() {
    return _running;
  }

  /**
   * يُعيد الوقت المتبقي بالمللي ثانية (تقريباً)
   * ملاحظة: هذا تقدير، ليس دقيقاً لأننا لا نتتبع وقت بدء المؤقت
   * @returns {number}
   */
  function getTimeoutMs() {
    return _timeoutMs;
  }

  // ============================================================
  // تصدير
  // ============================================================

  return {
    start,
    stop,
    reset,
    isRunning,
    getTimeoutMs,
    AGENT_IDLE_TIMEOUT_MS,
    ADMIN_IDLE_TIMEOUT_MS,
  };

})();

// تصدير للاستخدام العالمي
window.IdleTimer = IdleTimer;

console.log('✅ IdleTimer.js محمّل — خدمة الخروج التلقائي جاهزة');
