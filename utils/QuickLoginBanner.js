/**
 * utils/QuickLoginBanner.js — v1.0
 * نظام أبو حذيفة — إشعار تفعيل الدخول السريع
 *
 * يظهر للمستخدم الذي لم يفعّل الدخول السريع بعد.
 * يُعرض كـ Banner ثابت أعلى المحتوى مع زر "فعّل الآن" يُوجّه للإعدادات.
 *
 * ─────────────────────────────────────────────────────────
 * طريقة الاستخدام:
 *   في App.js داخل _bootApp() أو بعد _buildLayout():
 *
 *   if (window.QuickLoginBanner) {
 *     QuickLoginBanner.maybeShow(profile);
 *   }
 * ─────────────────────────────────────────────────────────
 *
 * منطق الإخفاء:
 *   - يُخفى إذا: quick_equation_hash موجود (مفعّل)
 *   - يُخفى إذا: المستخدم أغلق الإشعار (localStorage)
 *   - يُعاد إظهاره بعد 7 أيام من الإغلاق
 *   - يُخفى نهائياً بعد التفعيل
 */
'use strict';

const QuickLoginBanner = {

  _DISMISS_KEY : 'ahu_quick_banner_dismissed',
  _SNOOZE_DAYS : 7,

  // ────────────────────────────────────────────────────────
  // maybeShow — نقطة الدخول
  // ────────────────────────────────────────────────────────
  maybeShow(profile) {
    // لا نعرض للمدير (لديه أدوات أخرى في الإعدادات)
    // يمكن حذف هذا السطر إذا أردت إظهاره للمدير أيضاً
    // if (profile.role === 'admin') return;

    // مفعّل بالفعل — لا نعرض
    if (profile.quick_equation_hash) return;

    // مُعلَّق مؤقتاً — تحقق من انتهاء مدة التعليق
    try {
      const raw = localStorage.getItem(this._DISMISS_KEY);
      if (raw) {
        const { until } = JSON.parse(raw);
        if (until && Date.now() < until) return; // لا تزال فترة التعليق سارية
      }
    } catch { /* localStorage may be unavailable */ }

    this._render(profile);
  },

  // ────────────────────────────────────────────────────────
  // _render — رسم البانر
  // ────────────────────────────────────────────────────────
  _render(profile) {
    // إزالة أي بانر سابق
    document.getElementById('ql-banner')?.remove();

    const banner = document.createElement('div');
    banner.id = 'ql-banner';
    banner.style.cssText = `
      position:sticky;top:0;z-index:500;
      margin:0 0 16px;
      background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);
      border-radius:14px;
      padding:14px 16px;
      display:flex;align-items:center;gap:12px;
      box-shadow:0 4px 20px rgba(79,70,229,.35);
      animation:qlBannerIn .4s cubic-bezier(.34,1.56,.64,1);
      flex-wrap:wrap;`;

    // أنيميشن
    if (!document.getElementById('ql-banner-style')) {
      const style = document.createElement('style');
      style.id = 'ql-banner-style';
      style.textContent = `
        @keyframes qlBannerIn {
          from { opacity:0; transform:translateY(-12px) scale(.97); }
          to   { opacity:1; transform:translateY(0)     scale(1);   }
        }
        @keyframes qlBannerOut {
          from { opacity:1; transform:scaleY(1);   max-height:120px; }
          to   { opacity:0; transform:scaleY(0);   max-height:0;     }
        }
        #ql-banner.hiding {
          animation:qlBannerOut .3s ease forwards;
          overflow:hidden;
        }
        @keyframes zapBounce {
          0%,100% { transform:translateY(0); }
          50%      { transform:translateY(-4px); }
        }
        #ql-zap-icon { animation:zapBounce 1.6s ease-in-out infinite; }`;
      document.head.appendChild(style);
    }

    const supportsWebAuthn = !!window.PublicKeyCredential;

    banner.innerHTML = `
      <!-- أيقونة -->
      <div id="ql-zap-icon" style="font-size:1.6rem;flex-shrink:0;">⚡</div>

      <!-- النص -->
      <div style="flex:1;min-width:180px;">
        <div style="font-weight:700;font-size:.92rem;color:#fff;margin-bottom:3px;">
          فعّل الدخول السريع لتوفير وقتك
        </div>
        <div style="font-size:.8rem;color:rgba(255,255,255,.8);line-height:1.5;">
          استخدم معادلة رياضية أو البصمة للدخول بضغطة واحدة — بدون كتابة كلمة مرور في كل مرة.
        </div>
      </div>

      <!-- أزرار -->
      <div style="display:flex;gap:8px;flex-shrink:0;flex-wrap:wrap;align-items:center;">
        <button id="ql-banner-activate"
          style="padding:8px 16px;border-radius:8px;border:none;cursor:pointer;
            background:#fff;color:#4f46e5;font-weight:700;font-size:.84rem;
            font-family:inherit;transition:all .15s;box-shadow:0 2px 8px rgba(0,0,0,.15);">
          ⚡ إعداد المعادلة
        </button>
        ${supportsWebAuthn ? `
        <button id="ql-banner-webauthn"
          style="padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.5);
            cursor:pointer;background:rgba(255,255,255,.12);color:#fff;
            font-weight:600;font-size:.84rem;font-family:inherit;transition:all .15s;">
          👆 إعداد البصمة
        </button>` : ''}
        <button id="ql-banner-snooze"
          style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.25);
            cursor:pointer;background:transparent;color:rgba(255,255,255,.75);
            font-size:.8rem;font-family:inherit;transition:all .15s;"
          title="تذكير بعد ${this._SNOOZE_DAYS} أيام">
          تخطّ
        </button>
        <button id="ql-banner-dismiss"
          style="padding:8px;border-radius:8px;border:none;cursor:pointer;
            background:transparent;color:rgba(255,255,255,.6);font-size:.9rem;
            transition:color .15s;line-height:1;"
          title="إغلاق نهائياً">✕</button>
      </div>`;

    // أحداث
    banner.querySelector('#ql-banner-activate').addEventListener('click', () => {
      this._hide(banner);
      // انتقل لتبويب الإعدادات
      if (window._appNavigateTo) {
        _appNavigateTo(TABS.SETTINGS);
      } else if (window.App?.navigateTo) {
        App.navigateTo(TABS.SETTINGS);
      }
    });

    if (supportsWebAuthn) {
      banner.querySelector('#ql-banner-webauthn')?.addEventListener('click', () => {
        this._hide(banner);
        if (window._appNavigateTo) {
          _appNavigateTo(TABS.SETTINGS);
        } else if (window.App?.navigateTo) {
          App.navigateTo(TABS.SETTINGS);
        }
      });
    }

    banner.querySelector('#ql-banner-snooze').addEventListener('click', () => {
      try {
        const until = Date.now() + this._SNOOZE_DAYS * 24 * 60 * 60 * 1000;
        localStorage.setItem(this._DISMISS_KEY, JSON.stringify({ until }));
      } catch { /* localStorage may be unavailable */ }
      this._hide(banner);
    });

    banner.querySelector('#ql-banner-dismiss').addEventListener('click', () => {
      try {
        // إغلاق لمدة طويلة جداً (سنة)
        const until = Date.now() + 365 * 24 * 60 * 60 * 1000;
        localStorage.setItem(this._DISMISS_KEY, JSON.stringify({ until }));
      } catch { /* localStorage may be unavailable */ }
      this._hide(banner);
    });

    // أين نُضيف البانر؟
    // نبحث عن #app-content أو نُضيفه أعلى أول عنصر في الصفحة
    const target = document.getElementById('app-content');
    if (target) {
      target.prepend(banner);
    } else {
      document.body.prepend(banner);
    }

    // إضافة تأثيرات hover بعد الإدراج في DOM (بدلاً من inline handlers)
    const activateBtn = banner.querySelector('#ql-banner-activate');
    if (activateBtn) {
      activateBtn.addEventListener('mouseenter', () => { activateBtn.style.transform = 'scale(1.03)'; });
      activateBtn.addEventListener('mouseleave', () => { activateBtn.style.transform = ''; });
    }

    const webAuthnBtn = banner.querySelector('#ql-banner-webauthn');
    if (webAuthnBtn) {
      webAuthnBtn.addEventListener('mouseenter', () => { webAuthnBtn.style.background = 'rgba(255,255,255,.22)'; });
      webAuthnBtn.addEventListener('mouseleave', () => { webAuthnBtn.style.background = 'rgba(255,255,255,.12)'; });
    }

    const snoozeBtn = banner.querySelector('#ql-banner-snooze');
    if (snoozeBtn) {
      snoozeBtn.addEventListener('mouseenter', () => { snoozeBtn.style.background = 'rgba(255,255,255,.1)'; });
      snoozeBtn.addEventListener('mouseleave', () => { snoozeBtn.style.background = 'transparent'; });
    }

    const dismissBtn = banner.querySelector('#ql-banner-dismiss');
    if (dismissBtn) {
      dismissBtn.addEventListener('mouseenter', () => { dismissBtn.style.color = '#fff'; });
      dismissBtn.addEventListener('mouseleave', () => { dismissBtn.style.color = 'rgba(255,255,255,.6)'; });
    }
  },

  // ────────────────────────────────────────────────────────
  // _hide — إخفاء بأنيميشن
  // ────────────────────────────────────────────────────────
  _hide(banner) {
    banner.classList.add('hiding');
    setTimeout(() => banner.remove(), 350);
  },

  // ────────────────────────────────────────────────────────
  // dismiss — يُستدعى من خارج (بعد التفعيل الناجح)
  // ────────────────────────────────────────────────────────
  dismiss() {
    const banner = document.getElementById('ql-banner');
    if (banner) this._hide(banner);
    try {
      const until = Date.now() + 365 * 24 * 60 * 60 * 1000;
      localStorage.setItem(this._DISMISS_KEY, JSON.stringify({ until }));
    } catch { /* localStorage may be unavailable */ }
  },
};

window.QuickLoginBanner = QuickLoginBanner;
console.log('✅ QuickLoginBanner.js v1.0 محمّل');
