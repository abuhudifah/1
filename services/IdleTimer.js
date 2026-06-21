/**
 * services/IdleTimer.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * خدمة مراقبة الخمول وتسجيل الخروج التلقائي
 */

'use strict';

const IdleTimer = (function () {

  /** مهلة الخمول الافتراضية للمندوب: 30 دقيقة */
  const AGENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

  /** مهلة الخمول للمدير والمساعد: 90 دقيقة */
  const ADMIN_IDLE_TIMEOUT_MS = 90 * 60 * 1000;

  const ACTIVITY_EVENTS = [
    'mousemove',
    'keydown',
    'click',
    'scroll',
    'touchstart',
    'touchmove',
  ];

  let _running   = false;
  let _idleTimer = null;
  let _timeoutMs = AGENT_IDLE_TIMEOUT_MS;

  function _clearTimers() {
    if (_idleTimer) { clearTimeout(_idleTimer); _idleTimer = null; }
  }

  /**
   * إشعار ما بعد تسجيل الخروج التلقائي — يظهر فوق شاشة تسجيل الدخول
   * ويختفي بعد 3 ثوانٍ أو بالنقر عليه أو بالنقر في أي مكان آخر.
   */
  function _showLogoutNotice() {
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
      'font-size: 0.88rem',
      'font-weight: 600',
      'color: var(--text-primary, #0f172a)',
      'border-right: 4px solid var(--info, #2563eb)',
      'pointer-events: auto',
      'cursor: pointer',
      'min-width: 280px',
      'max-width: 440px',
      'text-align: right',
      'direction: rtl',
      'transition: all 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
      'opacity: 0',
      'transform: translateY(-12px) scale(0.96)',
    ].join(';');

    const icon = document.createElement('span');
    icon.textContent = '🔒';
    icon.style.cssText = 'font-size:1.2rem;flex-shrink:0;';

    const text = document.createElement('span');
    text.textContent = 'تم الخروج التلقائي بسبب عدم النشاط. سجل الدخول مجدداً بالدخول السريع أو التقليدي';
    text.style.flex = '1';

    toast.appendChild(icon);
    toast.appendChild(text);
    container.appendChild(toast);

    const dismiss = () => {
      toast.style.opacity   = '0';
      toast.style.transform = 'translateY(-8px) scale(0.95)';
      setTimeout(() => { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 280);
      document.removeEventListener('click', onOutsideClick, true);
    };

    toast.addEventListener('click', (e) => { e.stopPropagation(); dismiss(); });

    const onOutsideClick = () => dismiss();
    setTimeout(() => document.addEventListener('click', onOutsideClick, { once: true, capture: true }), 50);

    setTimeout(dismiss, 3000);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        toast.style.opacity   = '1';
        toast.style.transform = 'translateY(0) scale(1)';
      });
    });
  }

  function _scheduleTimers() {
    _clearTimers();

    _idleTimer = setTimeout(async () => {
      if (!_running) return;

      console.log('⏱️  IdleTimer: انتهت مهلة الخمول — تسجيل خروج تلقائي');
      _running = false;
      _clearTimers();
      _removeActivityListeners();

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
        return;
      }

      _showLogoutNotice();
    }, _timeoutMs);
  }

  function _onActivity() {
    if (!_running) return;
    _scheduleTimers();
  }

  function _addActivityListeners() {
    ACTIVITY_EVENTS.forEach(eventName => {
      document.addEventListener(eventName, _onActivity, { passive: true });
    });
  }

  function _removeActivityListeners() {
    ACTIVITY_EVENTS.forEach(eventName => {
      document.removeEventListener(eventName, _onActivity);
    });
  }

  function start(timeoutMs) {
    _timeoutMs = (typeof timeoutMs === 'number' && timeoutMs > 0)
      ? timeoutMs
      : AGENT_IDLE_TIMEOUT_MS;

    if (_running) {
      reset();
      return;
    }

    _running = false;
    _addActivityListeners();
    _running = true;
    _scheduleTimers();

    console.log(`✅ IdleTimer: بدأ — ${_timeoutMs / 60000} دقيقة`);
  }

  function stop() {
    if (!_running && !_idleTimer) return;

    _running = false;
    _clearTimers();
    _removeActivityListeners();

    console.log('🛑 IdleTimer: تم الإيقاف');
  }

  function reset() {
    if (!_running) return;
    _scheduleTimers();
  }

  function isRunning() {
    return _running;
  }

  function getTimeoutMs() {
    return _timeoutMs;
  }

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

window.IdleTimer = IdleTimer;

console.log('✅ IdleTimer.js محمّل — خدمة الخروج التلقائي جاهزة');
