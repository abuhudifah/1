/**
 * utils/PWAManager.js
 * إدارة تثبيت التطبيق وتحديثات Service Worker
 */
'use strict';

const PWAManager = (() => {
  let _deferredPrompt = null;
  let _installBtn     = null;

  // ─── تسجيل Service Worker ────────────────────────────────
  async function init() {
    if (!('serviceWorker' in navigator)) return;

    try {
      const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
      console.log('[PWA] Service Worker مسجَّل');

      // كشف تحديث متاح
      reg.addEventListener('updatefound', () => {
        const newSW = reg.installing;
        newSW?.addEventListener('statechange', () => {
          if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
            _showUpdateToast();
          }
        });
      });

      // إذا كان هناك SW انتظار → أخبره بالتفعيل الفوري
      if (reg.waiting) {
        reg.waiting.postMessage('SKIP_WAITING');
      }

      // إعادة تحميل عند تفعيل SW الجديد
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload();
      });

    } catch (err) {
      console.warn('[PWA] فشل تسجيل SW:', err.message);
    }
  }

  // ─── التقاط حدث التثبيت ─────────────────────────────────
  function setupInstallPrompt() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      _deferredPrompt = e;
      _showInstallButton();
    });

    window.addEventListener('appinstalled', () => {
      _deferredPrompt = null;
      _hideInstallButton();
      console.log('[PWA] تم تثبيت التطبيق');
    });
  }

  // ─── زر التثبيت (داخل التطبيق — مخفي عن المتطفلين) ─────
  function _showInstallButton() {
    if (_installBtn || !_deferredPrompt) return;

    _installBtn = document.createElement('button');
    _installBtn.id        = 'pwa-install-btn';
    _installBtn.className = 'btn btn-secondary btn-sm';
    _installBtn.title     = 'تثبيت التطبيق على الجهاز';
    _installBtn.innerHTML = `<i data-lucide="download" style="width:14px;height:14px;"></i>`;
    _installBtn.style.cssText = 'position:fixed;bottom:80px;left:16px;z-index:9990;border-radius:50%;width:44px;height:44px;padding:0;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,.25);';

    _installBtn.addEventListener('click', () => triggerInstall());
    document.body.appendChild(_installBtn);

    if (window.lucide) lucide.createIcons({ nodes: [_installBtn] });
  }

  function _hideInstallButton() {
    _installBtn?.remove();
    _installBtn = null;
  }

  // ─── تفعيل التثبيت ──────────────────────────────────────
  async function triggerInstall() {
    if (!_deferredPrompt) return false;
    _deferredPrompt.prompt();
    const { outcome } = await _deferredPrompt.userChoice;
    _deferredPrompt = null;
    if (outcome === 'accepted') _hideInstallButton();
    return outcome === 'accepted';
  }

  // ─── إشعار التحديث ──────────────────────────────────────
  function _showUpdateToast() {
    const toast = document.createElement('div');
    toast.style.cssText = `
      position:fixed;bottom:20px;right:20px;left:20px;z-index:9999;
      background:var(--accent,#2563eb);color:#fff;
      border-radius:12px;padding:12px 16px;
      display:flex;align-items:center;gap:10px;
      box-shadow:0 8px 24px rgba(0,0,0,.25);
      font-size:.88rem;font-family:inherit;`;
    toast.innerHTML = `
      <span style="flex:1;">🔄 يوجد إصدار جديد من التطبيق</span>
      <button id="pwa-update-btn" style="background:rgba(255,255,255,.2);border:none;cursor:pointer;
        color:#fff;padding:6px 12px;border-radius:8px;font-family:inherit;font-size:.82rem;font-weight:700;">
        تحديث الآن
      </button>`;

    toast.querySelector('#pwa-update-btn').addEventListener('click', () => {
      navigator.serviceWorker.getRegistration().then(reg => {
        reg?.waiting?.postMessage('SKIP_WAITING');
      });
      toast.remove();
    });

    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 15000);
  }

  // ─── هل التطبيق مثبَّت؟ ─────────────────────────────────
  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  return { init, setupInstallPrompt, triggerInstall, isInstalled };
})();

window.PWAManager = PWAManager;
console.log('[PWA] PWAManager.js محمّل');
