/**
 * services/OfflineAuthService.js
 * نظام أبو حذيفة — المرحلة 2B
 *
 * مسؤولية هذا الملف: إدارة جلسات المصادقة في وضع Offline
 *
 * القواعد الصارمة:
 * - PIN لا يُخزَّن مطلقاً (لا نص، لا مشفّر) — الـ hash فقط في Dexie
 * - Hash = SHA-256(pin, userId) → userId:pin:APP_SALT
 * - Brute Force: sessionStorage ← يمسح عند إغلاق التبويب
 * - التحقق بدون إنترنت: يتم محلياً من Dexie فقط
 * - التحقق مع إنترنت + JWT: يُفضَّل الخادم ← يُكمّله Dexie عند الفشل
 */

'use strict';

// ============================================================
// Brute Force Protection — PIN (sessionStorage)
// ============================================================

const _PIN_BF_PREFIX = 'ahu_pin_bf_';

function _pinBfRead(userId) {
  try {
    return JSON.parse(sessionStorage.getItem(_PIN_BF_PREFIX + userId) || 'null');
  } catch {
    return null;
  }
}

function _pinBfWrite(userId, data) {
  try {
    sessionStorage.setItem(_PIN_BF_PREFIX + userId, JSON.stringify(data));
  } catch { /* sessionStorage ممتلئة: نتجاهل بأمان */ }
}

// ============================================================
// Brute Force Protection — PIN (localStorage — permanent lock)
// ============================================================

const _PIN_LS_BF_PREFIX = 'ahu_pin_lsbf_';

function _pinLsBfRead(userId) {
  try { return JSON.parse(localStorage.getItem(_PIN_LS_BF_PREFIX + userId) || 'null'); }
  catch { return null; }
}

function _pinLsBfWrite(userId, data) {
  try { localStorage.setItem(_PIN_LS_BF_PREFIX + userId, JSON.stringify(data)); }
  catch { }
}

function _resetPinLsAttempts(userId) {
  try { localStorage.removeItem(_PIN_LS_BF_PREFIX + userId); }
  catch { }
}

function _resetPinAttempts(userId) {
  try {
    sessionStorage.removeItem(_PIN_BF_PREFIX + userId);
  } catch { /* تجاهل */ }
  _resetPinLsAttempts(userId);
}

function _checkPinBruteForce(userId) {
  // فحص القفل الدائم في localStorage أولاً
  const ls = _pinLsBfRead(userId);
  if (ls && ls.lockedUntil && ls.lockedUntil > Date.now()) {
    return err('تم قفل الدخول نهائياً بعد 10 محاولات فاشلة. تواصل مع المسؤول.');
  }

  const r = _pinBfRead(userId);
  if (!r) return ok(true);

  if (r.lockedUntil && Date.now() < r.lockedUntil) {
    const mins = Math.ceil((r.lockedUntil - Date.now()) / 60000);
    return err(`تم قفل الدخول مؤقتاً. حاول بعد ${mins} دقيقة`);
  }

  // انتهى القفل → تنظيف
  if (r.lockedUntil && Date.now() >= r.lockedUntil) {
    _resetPinAttempts(userId);
  }

  return ok(true);
}

function _recordPinFailure(userId) {
  const now = Date.now();
  const r   = _pinBfRead(userId) || { count: 0, lastAttempt: now };
  r.count++;
  r.lastAttempt = now;

  if (r.count >= 10) {
    // قفل دائم في localStorage
    _pinLsBfWrite(userId, { lockedUntil: Date.now() + 100 * 365 * 24 * 60 * 60 * 1000 });
    console.warn(`[OfflineAuth] قُفل الدخول نهائياً للمستخدم ${userId} بعد ${r.count} محاولات فاشلة`);
  } else if (r.count >= 5) {
    r.lockedUntil = now + 15 * 60 * 1000;
    console.warn(`[OfflineAuth] قُفل الدخول للمستخدم ${userId} بعد ${r.count} محاولات فاشلة`);
  } else if (r.count >= 3) {
    r.lockedUntil = now + 5 * 60 * 1000;
    console.warn(`[OfflineAuth] قُفل الدخول للمستخدم ${userId} بعد ${r.count} محاولات فاشلة`);
  }

  _pinBfWrite(userId, r);
}

/** يُعيد عدد المحاولات المتبقية قبل القفل (للعرض في UI) */
function _remainingPinAttempts(userId) {
  const r = _pinBfRead(userId);
  if (!r) return 10;
  return Math.max(0, 10 - (r.count || 0));
}

// ============================================================
// دوال مساعدة لـ WebAuthn
// ============================================================

function _base64urlToBuffer(b64) {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

function _bufferToBase64url(buf) {
  const bytes  = new Uint8Array(buf);
  let   binary = '';
  bytes.forEach(b => { binary += String.fromCharCode(b); });
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ============================================================
// OfflineAuthService
// ============================================================

const OfflineAuthService = {

  // ==========================================================
  // إنشاء جلسة Offline
  // ==========================================================

  /**
   * ينشئ جلسة Offline لمستخدم وجهاز محددين.
   * Phase 6: المصدر الوحيد هو SessionVault (PBKDF2 + AES-GCM) — لا hash، لا RPC،
   * لا جدول offline_sessions. يعمل أوفلاين بالكامل ولا يُخزَّن PIN كنص أو hash.
   *
   * @param {string} userId - UUID المستخدم
   * @param {string} pin    - PIN رقمي (4-6 خانات)
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async createOfflineSession(userId, pin) {
    if (!userId) return err('معرف المستخدم مطلوب');

    const pinStr = String(pin).trim();
    if (pinStr.length < 4 || pinStr.length > 6 || !/^\d+$/.test(pinStr)) {
      return err('PIN يجب أن يكون من 4 إلى 6 أرقام');
    }

    const V = (typeof SessionVault !== 'undefined') ? SessionVault
            : (typeof window !== 'undefined' ? window.SessionVault : null);
    if (!V?.isSupported?.()) {
      return err('هذا المتصفح لا يدعم تشفير PIN الآمن (WebCrypto)');
    }

    const deviceId = sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY)
                     || localStorage.getItem(`ahu_device_${userId}`)
                     || null;

    try {
      const u = (typeof window !== 'undefined' && window.AuthState) ? window.AuthState.currentUser : null;
      const profile = u ? {
        id            : u.id,
        username      : u.username,
        display_name  : u.display_name,
        role          : u.role,
        is_active     : u.is_active,
        allowed_tabs  : u.allowed_tabs || [],
        account_number: u.account_number,
      } : { id: userId };

      await V.create({
        userId, secretType: V.SECRET.PIN, secret: pinStr,
        payload: { profile, deviceId, savedAt: new Date().toISOString() },
      });

      // علامة محلية للتوافق مع كاشفات الواجهة (بلا hash ولا سرّ)
      try {
        localStorage.setItem(`ahu_offline_session_${userId}`, JSON.stringify({
          userId, deviceId, hasPin: true, hasWebAuthn: false,
          source: 'vault', createdAt: new Date().toISOString(),
        }));
      } catch { /* localStorage غير متاح */ }

      return ok(true);
    } catch (e) {
      return err('تعذّر حفظ PIN المشفّر: ' + e.message);
    }
  },

  // ==========================================================
  // التحقق من PIN
  // ==========================================================

  /**
   * يتحقق من صحة PIN لجلسة Offline نشطة.
   * Phase 6: المصدر الوحيد هو SessionVault — فكّ الخزنة المشفّرة محليّاً (يعمل
   * أوفلاين بالكامل). فشل الفكّ (auth-tag) = PIN خاطئ.
   *
   * @param {string} userId
   * @param {string} pin
   * @returns {Promise<{ok: boolean, remaining?: number, error?: string}>}
   */
  async verifyOfflineSession(userId, pin) {
    if (!userId) return err('معرف المستخدم مطلوب');
    if (!pin)    return err('PIN مطلوب');

    // فحص Brute Force
    const bfCheck = _checkPinBruteForce(userId);
    if (!isOk(bfCheck)) return bfCheck;

    const V = (typeof SessionVault !== 'undefined') ? SessionVault
            : (typeof window !== 'undefined' ? window.SessionVault : null);
    if (!V?.has?.(userId, V.SECRET.PIN)) {
      return err('لم يتم تفعيل PIN على هذا الجهاز');
    }

    try {
      const payload = await V.unlock({ userId, secretType: V.SECRET.PIN, secret: String(pin).trim() });
      _resetPinAttempts(userId);
      return ok({ payload });
    } catch {
      // فشل الفكّ (auth-tag) = PIN خاطئ
      _recordPinFailure(userId);
      return err('PIN غير صحيح', { remaining: _remainingPinAttempts(userId) });
    }
  },

  // ==========================================================
  // جلب الجلسة النشطة
  // ==========================================================

  /**
   * يجلب بيانات الجلسة المخزنة في localStorage (بدون hash).
   * @param {string} userId
   * @returns {object|null}
   */
  getOfflineSession(userId) {
    try {
      // المسار الجديد: وجود خزنة PIN مشفّرة
      const V = (typeof SessionVault !== 'undefined') ? SessionVault
              : (typeof window !== 'undefined' ? window.SessionVault : null);
      if (V?.has?.(userId, V.SECRET.PIN)) {
        return { userId, hasPin: true, source: 'vault' };
      }
      const raw = localStorage.getItem(`ahu_offline_session_${userId}`);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  // ==========================================================
  // إنهاء الجلسة
  // ==========================================================

  /**
   * ينهي جلسة Offline: يمسح علامة localStorage ويحذف خزنة PIN المشفّرة.
   * Phase 6: لا تفاعل مع جدول offline_sessions أو RPC (المصدر الوحيد SessionVault).
   * @param {string} userId
   * @returns {Promise<{ok: boolean}>}
   */
  async endOfflineSession(userId) {
    localStorage.removeItem(`ahu_offline_session_${userId}`);

    try {
      const V = (typeof SessionVault !== 'undefined') ? SessionVault
              : (typeof window !== 'undefined' ? window.SessionVault : null);
      V?.remove?.(userId, V.SECRET.PIN);
    } catch { /* تجاهل */ }

    return ok(true);
  },

  // ==========================================================
  // WebAuthn — تفعيل
  // ==========================================================

  /**
   * يُفعّل WebAuthn (Passkey / بصمة) للدخول السريع (Online فقط).
   * البصمة بوّابة حيوية فوق توكن الدخول السريع — per-device، تحقق محلي.
   * يتطلب اتصالاً بالإنترنت + جلسة نشطة + تفعيل الدخول السريع بالمعادلة مسبقاً.
   *
   * @param {string} userId
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async enableWebAuthn(userId) {
    if (!window.PublicKeyCredential) {
      return err('المتصفح لا يدعم البصمة أو Face ID');
    }
    if (!isOnline() || !window.AuthState?.authUser) {
      return err('تفعيل البصمة أو Face ID يتطلب اتصالاً بالإنترنت وجلسة نشطة');
    }

    // قراءة بيانات الدخول السريع الموجودة (إن وُجدت)
    let qData = null;
    try {
      const raw = localStorage.getItem(`ahu_quick_${userId}`);
      if (raw) qData = JSON.parse(raw);
    } catch { /* تجاهل */ }

    // إذا لا توجد معادلة → أنشئ token مستقل للبصمة (الـ JWT الحالي يُثبت الهوية)
    if (!qData?.token) {

      const waHash    = await hashSHA256('_webauthn_only_' + userId, userId);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const deviceId  = getDeviceToken();

      const { data: waToken, error: tokenError } = await supabaseClient.rpc(
        'create_quick_login_token',
        { p_user_id: userId, p_equation_hash: waHash,
          p_device_id: deviceId, p_expires_at: expiresAt.toISOString() }
      );
      if (tokenError || !waToken) {
        return err('فشل إنشاء رمز البصمة: ' + (tokenError?.message || 'خطأ غير معروف'));
      }

      qData = {
        hash        : waHash,
        userId,
        token       : waToken,
        displayName : window.AuthState?.currentUser?.display_name,
        expiresAt   : expiresAt.toISOString(),
        createdAt   : new Date().toISOString(),
        webauthnOnly: true,
      };
      localStorage.setItem(`ahu_quick_${userId}`, JSON.stringify(qData));
    }

    try {
      // Challenge عشوائي (التسجيل لا يحتاج تحقق الخادم في هذا السياق)
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdBuf = new TextEncoder().encode(userId);

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp              : { name: APP_CONFIG.NAME_SHORT, id: window.location.hostname },
          user            : {
            id          : userIdBuf,
            name        : window.AuthState?.currentUser?.username  || userId,
            displayName : window.AuthState?.currentUser?.display_name || userId,
          },
          pubKeyCredParams: [
            { alg: -7,   type: 'public-key' }, // ES256
            { alg: -257, type: 'public-key' }, // RS256
          ],
          timeout               : 60_000,
          attestation           : 'none',
          authenticatorSelection: {
            residentKey     : 'preferred',
            userVerification: 'required',
          },
        },
      });

      if (!credential) return err('لم يتم إنشاء بيانات الاعتماد');

      const credId = _bufferToBase64url(credential.rawId);

      // تخزين معرّف الاعتماد + علامة البصمة داخل ahu_quick_* (per-device، تحقق محلي)
      qData.hasWebAuthn         = true;
      qData.webauthnCredentialId = credId;
      localStorage.setItem(`ahu_quick_${userId}`, JSON.stringify(qData));

      console.log('✅ OfflineAuthService: بصمة الدخول السريع مُفعَّلة');
      return ok(true);

    } catch (e) {
      if (e.name === 'NotAllowedError') {
        return err('تم رفض طلب التحقق بالبصمة');
      }
      return err('خطأ في تفعيل البصمة أو Face ID: ' + e.message);
    }
  },

  // ==========================================================
  // WebAuthn — تسجيل اعتماد فقط (للخزنة المشفّرة، بلا توكن خادم)
  // ==========================================================

  /**
   * يُسجّل اعتماد WebAuthn (Passkey / بصمة) ويُعيد معرّفه فقط — بلا إنشاء
   * توكن خادم وبلا كتابة `ahu_quick_`. يُستخدم في نموذج «الخزنة المشفّرة»
   * حيث تحرس البصمة فكّ خزنة BIOMETRIC المحلية (refresh_token).
   *
   * @param {string} userId
   * @returns {Promise<{ok: boolean, data?: {credentialId: string}, error?: string}>}
   */
  async registerWebAuthnCredentialOnly(userId) {
    if (!window.PublicKeyCredential) {
      return err('المتصفح لا يدعم البصمة أو Face ID');
    }
    if (!isOnline() || !window.AuthState?.authUser) {
      return err('تفعيل البصمة أو Face ID يتطلب اتصالاً بالإنترنت وجلسة نشطة');
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userIdBuf = new TextEncoder().encode(userId);

      const credential = await navigator.credentials.create({
        publicKey: {
          challenge,
          rp              : { name: APP_CONFIG.NAME_SHORT, id: window.location.hostname },
          user            : {
            id          : userIdBuf,
            name        : window.AuthState?.currentUser?.username  || userId,
            displayName : window.AuthState?.currentUser?.display_name || userId,
          },
          pubKeyCredParams: [
            { alg: -7,   type: 'public-key' }, // ES256
            { alg: -257, type: 'public-key' }, // RS256
          ],
          timeout               : 60_000,
          attestation           : 'none',
          authenticatorSelection: {
            residentKey     : 'preferred',
            userVerification: 'required',
          },
        },
      });

      if (!credential) return err('لم يتم إنشاء بيانات الاعتماد');

      const credId = _bufferToBase64url(credential.rawId);
      console.log('✅ OfflineAuthService: اعتماد WebAuthn مُسجَّل (وضع الخزنة)');
      return ok({ credentialId: credId });

    } catch (e) {
      if (e.name === 'NotAllowedError') {
        return err('تم رفض طلب التحقق بالبصمة');
      }
      return err('خطأ في تفعيل البصمة أو Face ID: ' + e.message);
    }
  },

  // ==========================================================
  // WebAuthn — التحقق
  // ==========================================================

  /**
   * يتحقق من هوية المستخدم بالبصمة / Passkey.
   * لا يحتاج إنترنتاً — التحقق يتم داخل المتصفح.
   *
   * @param {string} userId
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async verifyWithWebAuthn(userId) {
    if (!window.PublicKeyCredential) {
      return err('المتصفح لا يدعم البصمة أو Face ID');
    }

    // فحص Brute Force
    const bfCheck = _checkPinBruteForce(userId);
    if (!isOk(bfCheck)) return bfCheck;

    // جلب credential ID — أولاً من خزنة البصمة الجديدة (ahu_bio_*)، ثم
    // fallback إلى ahu_quick_* القديم (توافق خلفي للأجهزة غير المُهاجَرة).
    let credentialId = null;
    try {
      const bioRaw = localStorage.getItem(`ahu_bio_${userId}`);
      if (bioRaw) {
        const bData = JSON.parse(bioRaw);
        if (bData?.credentialId) credentialId = bData.credentialId;
      }
    } catch { /* تجاهل أخطاء localStorage */ }

    if (!credentialId) {
      try {
        const raw = localStorage.getItem(`ahu_quick_${userId}`);
        if (raw) {
          const qData = JSON.parse(raw);
          if (qData?.hasWebAuthn && qData?.webauthnCredentialId) {
            credentialId = qData.webauthnCredentialId;
          }
        }
      } catch { /* تجاهل أخطاء localStorage */ }
    }

    if (!credentialId) {
      return err('لم يتم تفعيل البصمة على هذا الجهاز. فعّلها من إعدادات الدخول السريع.');
    }

    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32));

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge        : challenge,
          rpId             : window.location.hostname,
          timeout          : 60_000,
          userVerification : 'required',
          allowCredentials : [{
            type : 'public-key',
            id   : _base64urlToBuffer(credentialId),
          }],
        },
      });

      if (!assertion) return err('فشل التحقق بالبصمة');

      _resetPinAttempts(userId);
      console.log('✅ OfflineAuthService: تحقق WebAuthn ناجح');
      return ok(true);

    } catch (e) {
      if (e.name === 'NotAllowedError') {
        _recordPinFailure(userId);
        return err('تم رفض طلب التحقق بالبصمة أو انتهت المهلة');
      }
      return err('خطأ في البصمة أو Face ID: ' + e.message);
    }
  },

};

// ============================================================
// تصدير
// ============================================================

window.OfflineAuthService = OfflineAuthService;

console.log('✅ OfflineAuthService.js محمّل — نظام Offline Authentication جاهز');
