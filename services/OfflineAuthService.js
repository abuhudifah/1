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

function _resetPinAttempts(userId) {
  try {
    sessionStorage.removeItem(_PIN_BF_PREFIX + userId);
  } catch { /* تجاهل */ }
}

function _checkPinBruteForce(userId) {
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

  if (r.count >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS) {
    r.lockedUntil = now + SECURITY_CONFIG.LOCKOUT_MINUTES * 60 * 1000;
    console.warn(`[OfflineAuth] قُفل الدخول للمستخدم ${userId} بعد ${r.count} محاولات فاشلة`);
  }

  _pinBfWrite(userId, r);
}

/** يُعيد عدد المحاولات المتبقية قبل القفل (للعرض في UI) */
function _remainingPinAttempts(userId) {
  const r = _pinBfRead(userId);
  if (!r) return SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS;
  return Math.max(0, SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS - (r.count || 0));
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
   * يحسب PIN hash ويخزّنه في Supabase (إن اتصل) + Dexie.
   * لا يُخزَّن PIN نفسه في أي مكان.
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

    const pinHash  = await hashSHA256(pinStr, userId);
    const deviceId = getDeviceToken();

    // ── محاولة الإنشاء عبر الخادم أولاً ──────────────────
    if (isOnline() && window.AuthState?.authUser) {
      try {
        const { data: sessionId, error } = await supabaseClient.rpc(
          'create_offline_session',
          { p_user_id: userId, p_device_id: deviceId, p_pin_hash: pinHash }
        );

        if (error) return err('فشل إنشاء جلسة Offline: ' + error.message);

        await this._saveSessionToDexie({
          id        : sessionId,
          user_id   : userId,
          device_id : deviceId,
          pin_hash  : pinHash,
          is_active : true,
        });

      } catch (e) {
        return err('خطأ في الشبكة أثناء إنشاء الجلسة: ' + e.message);
      }

    } else {
      // ── Offline: إنشاء محلي فقط — ستُزامن عند عودة الاتصال ──
      if (typeof db === 'undefined' || !db.isOpen()) {
        return err('قاعدة البيانات المحلية غير متاحة — تعذّر إنشاء جلسة Offline');
      }

      const localId = crypto.randomUUID();
      await this._saveSessionToDexie({
        id          : localId,
        user_id     : userId,
        device_id   : deviceId,
        pin_hash    : pinHash,
        is_active   : true,
        _local_only : true,
      });
    }

    // خزّن بيانات الجلسة (بدون PIN أو hash) في localStorage
    localStorage.setItem(
      `ahu_offline_session_${userId}`,
      JSON.stringify({
        userId,
        deviceId,
        hasPin      : true,
        hasWebAuthn : false,
        createdAt   : new Date().toISOString(),
      })
    );

    console.log(`✅ OfflineAuthService: جلسة Offline أُنشئت (userId=${userId})`);
    return ok(true);
  },

  // ==========================================================
  // التحقق من PIN
  // ==========================================================

  /**
   * يتحقق من صحة PIN لجلسة Offline نشطة.
   * يستخدم الخادم إن توفّر الاتصال + JWT، وإلا يتحقق محلياً من Dexie.
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

    const pinHash  = await hashSHA256(String(pin).trim(), userId);
    const deviceId = getDeviceToken();

    // ── محاولة التحقق عبر الخادم (إن كان متصلاً ولديه JWT) ──
    if (isOnline() && window.AuthState?.authUser) {
      try {
        const { data: valid, error } = await supabaseClient.rpc(
          'verify_offline_session',
          { p_user_id: userId, p_device_id: deviceId, p_pin_hash: pinHash }
        );

        if (!error && valid === true) {
          _resetPinAttempts(userId);
          return ok(true);
        }

        // RPC أعاد false بدون خطأ = PIN خاطئ
        if (!error && valid !== true) {
          _recordPinFailure(userId);
          return err('PIN غير صحيح', {
            remaining: _remainingPinAttempts(userId),
          });
        }
        // خطأ شبكة → ننتقل للتحقق المحلي
      } catch { /* الشبكة فاشلة → تحقق محلي */ }
    }

    // ── التحقق المحلي من Dexie ────────────────────────────
    return this._verifyLocal(userId, deviceId, pinHash);
  },

  /** تحقق محلي (Dexie) — مشترك بين verify وWebAuthn fallback */
  async _verifyLocal(userId, deviceId, pinHash) {
    try {
      if (typeof db === 'undefined' || !db.isOpen()) {
        return err('قاعدة البيانات المحلية غير متاحة');
      }

      const session = await db.offline_sessions
        .where('[user_id+device_id]')
        .equals([userId, deviceId])
        .filter(s => s.is_active === true)
        .first();

      if (!session || session.pin_hash !== pinHash) {
        _recordPinFailure(userId);
        return err('PIN غير صحيح', {
          remaining: _remainingPinAttempts(userId),
        });
      }

      _resetPinAttempts(userId);
      return ok(true);

    } catch (e) {
      return err('خطأ في التحقق المحلي: ' + e.message);
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
   * ينهي جلسة Offline: يمسح localStorage ويُعيّن is_active=false في Dexie.
   * @param {string} userId
   * @returns {Promise<{ok: boolean}>}
   */
  async endOfflineSession(userId) {
    localStorage.removeItem(`ahu_offline_session_${userId}`);

    if (typeof db !== 'undefined' && db.isOpen()) {
      try {
        const deviceId = getDeviceToken();
        const sessions = await db.offline_sessions
          .where('[user_id+device_id]')
          .equals([userId, deviceId])
          .toArray();

        for (const s of sessions) {
          await db.offline_sessions.update(s.id, { is_active: false });
        }
      } catch (e) {
        console.warn('[OfflineAuth] endOfflineSession — Dexie:', e.message);
      }
    }

    if (isOnline() && window.AuthState?.authUser) {
      try {
        await supabaseClient.rpc('end_offline_session', {
          p_user_id  : userId,
          p_device_id: getDeviceToken(),
        });
      } catch { /* الشبكة غير متاحة — الجلسة انتهت محلياً */ }
    }

    console.log(`✅ OfflineAuthService: جلسة Offline انتهت (userId=${userId})`);
    return ok(true);
  },

  // ==========================================================
  // WebAuthn — تفعيل
  // ==========================================================

  /**
   * يُفعّل WebAuthn (Passkey / بصمة) للجلسة الحالية.
   * يتطلب اتصالاً بالإنترنت + JWT صالح.
   *
   * @param {string} userId
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async enableWebAuthn(userId) {
    if (!window.PublicKeyCredential) {
      return err('المتصفح لا يدعم WebAuthn / Passkeys');
    }
    if (!isOnline() || !window.AuthState?.authUser) {
      return err('تفعيل WebAuthn يتطلب اتصالاً بالإنترنت وجلسة نشطة');
    }

    try {
      // Challenge عشوائي (لا نحتاج التحقق من الخادم لـ registration في هذا السياق)
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

      // حفظ credential ID في Supabase
      const { error: saveError } = await supabaseClient.rpc('save_webauthn_credential', {
        p_user_id       : userId,
        p_device_id     : getDeviceToken(),
        p_credential_id : credId,
      });

      if (saveError) return err('فشل حفظ بيانات WebAuthn: ' + saveError.message);

      // تحديث Dexie
      if (typeof db !== 'undefined' && db.isOpen()) {
        const deviceId = getDeviceToken();
        const sessions = await db.offline_sessions
          .where('[user_id+device_id]')
          .equals([userId, deviceId])
          .toArray();
        for (const s of sessions) {
          await db.offline_sessions.update(s.id, { webauthn_credential_id: credId });
        }
      }

      // تحديث localStorage (بدون credId — metadata فقط)
      const session = this.getOfflineSession(userId);
      if (session) {
        session.hasWebAuthn = true;
        localStorage.setItem(`ahu_offline_session_${userId}`, JSON.stringify(session));
      }

      console.log('✅ OfflineAuthService: WebAuthn مُفعَّل');
      return ok(true);

    } catch (e) {
      if (e.name === 'NotAllowedError') {
        return err('تم رفض طلب التحقق بالبصمة');
      }
      return err('خطأ في تفعيل WebAuthn: ' + e.message);
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
      return err('المتصفح لا يدعم WebAuthn / Passkeys');
    }

    // فحص Brute Force
    const bfCheck = _checkPinBruteForce(userId);
    if (!isOk(bfCheck)) return bfCheck;

    // جلب credential ID من Dexie
    let credentialId = null;
    if (typeof db !== 'undefined' && db.isOpen()) {
      const deviceId = getDeviceToken();
      const session  = await db.offline_sessions
        .where('[user_id+device_id]')
        .equals([userId, deviceId])
        .filter(s => s.is_active === true && !!s.webauthn_credential_id)
        .first();
      credentialId = session?.webauthn_credential_id || null;
    }

    if (!credentialId) {
      return err('لم يتم تفعيل WebAuthn على هذا الجهاز. استخدم PIN بدلاً من ذلك.');
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
      return err('خطأ في WebAuthn: ' + e.message);
    }
  },

  // ==========================================================
  // مساعد داخلي: حفظ الجلسة في Dexie
  // ==========================================================

  async _saveSessionToDexie(sessionData) {
    if (typeof db === 'undefined' || !db.isOpen()) return;
    try {
      await db.offline_sessions.put({
        ...sessionData,
        created_at : sessionData.created_at || new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[OfflineAuth] _saveSessionToDexie:', e.message);
    }
  },

};

// ============================================================
// تصدير
// ============================================================

window.OfflineAuthService = OfflineAuthService;

console.log('✅ OfflineAuthService.js محمّل — نظام Offline Authentication جاهز');
