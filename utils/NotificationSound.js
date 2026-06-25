/**
 * utils/NotificationSound.js
 * صوت الإشعارات + اهتزاز + App Badge API
 */
'use strict';

const NotificationSound = (() => {
  let _ctx = null;
  let _enabled = true;

  function _getCtx() {
    if (!_ctx || _ctx.state === 'closed') {
      _ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  // نغمتان صاعدتان (E5 → G5) — خفيفتان وقصيرتان
  function play() {
    if (!_enabled) return;
    try {
      const ctx   = _getCtx();
      const notes = [659.25, 783.99]; // E5, G5
      const t0    = ctx.currentTime;

      notes.forEach((freq, i) => {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.type          = 'sine';
        osc.frequency.value = freq;

        const start = t0 + i * 0.19;
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.28, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, start + 0.28);

        osc.start(start);
        osc.stop(start + 0.3);
      });
    } catch (e) {
      // AudioContext غير مدعوم أو محجوب
    }
  }

  // اهتزاز — نمط إشعار قصير
  function vibrate() {
    if (navigator.vibrate) {
      navigator.vibrate([80, 40, 80]);
    }
  }

  // App Badge API — يظهر العدد على أيقونة التطبيق
  function setBadge(count) {
    if (!navigator.setAppBadge) return;
    if (count > 0) {
      navigator.setAppBadge(count).catch(() => {});
    } else {
      navigator.clearAppBadge?.().catch(() => {});
    }
  }

  function clearBadge() {
    navigator.clearAppBadge?.().catch(() => {});
  }

  // تشغيل الكل معاً عند وصول إشعار جديد
  function onNewNotification(unreadCount) {
    play();
    vibrate();
    setBadge(unreadCount);
  }

  function setEnabled(val) { _enabled = !!val; }
  function isEnabled()     { return _enabled; }

  return { play, vibrate, setBadge, clearBadge, onNewNotification, setEnabled, isEnabled };
})();

window.NotificationSound = NotificationSound;
