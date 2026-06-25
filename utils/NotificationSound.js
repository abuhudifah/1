/**
 * utils/NotificationSound.js
 * صوت الإشعارات + اهتزاز + App Badge + إشعارات نظام التشغيل
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

  // نغمتان صاعدتان (E5 → G5) — تعمل فقط عندما التطبيق في المقدمة
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

        osc.type            = 'sine';
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
    if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
  }

  // ─── App Badge API ────────────────────────────────────────────
  function setBadge(count) {
    if (!navigator.setAppBadge) return;
    if (count > 0) navigator.setAppBadge(count).catch(() => {});
    else           navigator.clearAppBadge?.().catch(() => {});
  }

  function clearBadge() {
    navigator.clearAppBadge?.().catch(() => {});
  }

  // ─── طلب إذن الإشعارات ──────────────────────────────────────
  async function requestPermission() {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied')  return 'denied';
    try {
      return await Notification.requestPermission();
    } catch {
      return 'denied';
    }
  }

  // ─── إشعار نظام التشغيل ──────────────────────────────────────
  // يعمل عبر Service Worker → يظهر حتى عندما التطبيق في الخلفية
  async function showOSNotification(title, body, type = 'info') {
    if (Notification.permission !== 'granted') return;

    const icon  = './assets/icons/icon-192.png';
    const badge = './assets/icons/favicon-32.png';
    const tag   = 'app-notification-' + Date.now();

    const opts = {
      body,
      icon,
      badge,
      tag,
      renotify : true,
      vibrate  : [80, 40, 80],
      data     : { url: './?tab=notifications' },
    };

    try {
      // استخدام SW لعرض الإشعار (يعمل في الخلفية + iOS PWA)
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, opts);
    } catch {
      // fallback: Notification API مباشرة (للمتصفحات القديمة)
      try { new Notification(title, opts); } catch { /* silent */ }
    }
  }

  // ─── تشغيل الكل عند وصول إشعار جديد ────────────────────────
  async function onNewNotification(title, body, type, unreadCount) {
    setBadge(unreadCount);
    vibrate();

    // الصوت فقط إذا كان التطبيق في المقدمة
    if (!document.hidden) play();

    // إشعار نظام التشغيل إذا كان التطبيق في الخلفية أو الإذن ممنوح
    await showOSNotification(title, body, type);
  }

  function setEnabled(val) { _enabled = !!val; }
  function isEnabled()     { return _enabled; }

  // ─── Web Push Subscription ───────────────────────────────────
  function _urlB64ToUint8(b64) {
    const pad = '='.repeat((4 - b64.length % 4) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  async function subscribeToPush() {
    if (!('PushManager' in window) || !('serviceWorker' in navigator)) return;
    if (Notification.permission !== 'granted') return;
    if (!window.VAPID_PUBLIC_KEY || !window.supabaseClient) return;

    try {
      const reg = await navigator.serviceWorker.ready;
      let sub   = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly     : true,
          applicationServerKey: _urlB64ToUint8(window.VAPID_PUBLIC_KEY),
        });
      }

      const { data: { user } } = await window.supabaseClient.auth.getUser();
      if (!user) return;

      const json = sub.toJSON();
      await window.supabaseClient.from('push_subscriptions').upsert({
        user_id  : user.id,
        endpoint : json.endpoint,
        p256dh   : json.keys.p256dh,
        auth     : json.keys.auth,
      }, { onConflict: 'user_id,endpoint', ignoreDuplicates: true });

      console.log('📡 Web Push: اشتراك مُسجَّل');
    } catch (e) {
      console.warn('⚠️ Web Push: فشل الاشتراك:', e.message);
    }
  }

  return {
    play, vibrate,
    setBadge, clearBadge,
    requestPermission, showOSNotification,
    onNewNotification,
    setEnabled, isEnabled,
    subscribeToPush,
  };
})();

window.NotificationSound = NotificationSound;
