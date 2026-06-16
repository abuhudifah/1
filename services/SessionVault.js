/**
 * services/SessionVault.js — v1.0
 * نظام أبو حذيفة — إعادة الهيكلة (المرحلة 2)
 *
 * «الجلسة المشفّرة محليّاً»: نخزّن جلسة Supabase (refresh_token) + الملف
 * والصلاحيات في خزنة مشفّرة (AES-GCM) على الجهاز، تُفتح بمفتاح مُشتقّ
 * (PBKDF2) من سرّ الفتح (معادلة حاسبية / PIN). لا استبدال لكلمة المرور،
 * ولا أسرار على الخادم.
 *
 * يعمل في المتصفّح (window.crypto.subtle) وفي Node (globalThis.crypto)
 * لأغراض الاختبار. لا يعتمد على أي مكتبة خارجية.
 */

'use strict';

(function (root) {
  const crypto = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
  const subtle = crypto && crypto.subtle;

  const VAULT_PREFIX = 'ahu_vault_';
  const PBKDF2_ITERS = 310000;       // مقاومة للقوة الغاشمة لسرّ منخفض الإنتروبيا
  const SALT_BYTES   = 16;
  const IV_BYTES     = 12;           // AES-GCM
  const VERSION      = 1;

  // أنواع أسرار الفتح المدعومة
  const SECRET = Object.freeze({
    EQUATION: 'equation',  // المعادلة الحاسبية (أونلاين)
    PIN     : 'pin',       // رمز PIN (أوفلاين)
    BIOMETRIC: 'biometric',// مفتاح عشوائي يحرسه المُصادِق الحيوي (WebAuthn)
    EQ_SEED : 'eqseed',    // بذرة استرجاع المعادلة (مشفّرة بمفتاح ثابت للجهاز) — لتجديد توكن خزنة المعادلة بعد الخروج
  });

  // ── أدوات ترميز تعمل في المتصفّح و Node ───────────────────────────────
  function _bytesToB64(bytes) {
    if (typeof root.btoa === 'function') {
      let bin = '';
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      return root.btoa(bin);
    }
    return Buffer.from(bytes).toString('base64');
  }
  function _b64ToBytes(b64) {
    if (typeof root.atob === 'function') {
      const bin = root.atob(b64);
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    }
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }

  function _storageKey(userId, secretType) {
    return `${VAULT_PREFIX}${userId}_${secretType}`;
  }

  // ── اشتقاق مفتاح AES-GCM من سرّ نصّي عبر PBKDF2 ───────────────────────
  async function _deriveKey(secret, salt) {
    const enc = new TextEncoder();
    const baseKey = await subtle.importKey(
      'raw', enc.encode(String(secret)), { name: 'PBKDF2' }, false, ['deriveKey']
    );
    return subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  function isSupported() {
    return !!(subtle && typeof subtle.deriveKey === 'function');
  }

  /**
   * إنشاء/تحديث خزنة لمستخدم بنوع سرّ معيّن.
   * @returns {Promise<boolean>}
   */
  async function create({ userId, secretType, secret, payload }) {
    if (!isSupported()) throw new Error('WebCrypto غير مدعوم على هذا الجهاز');
    if (!userId || !secretType || !secret) throw new Error('بيانات الخزنة ناقصة');

    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const iv   = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const key  = await _deriveKey(secret, salt);

    const plaintext = new TextEncoder().encode(JSON.stringify(payload ?? {}));
    const ctBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);

    const blob = {
      v: VERSION,
      alg: 'AES-GCM',
      iters: PBKDF2_ITERS,
      salt: _bytesToB64(salt),
      iv:  _bytesToB64(iv),
      ct:  _bytesToB64(new Uint8Array(ctBuf)),
      createdAt: new Date().toISOString(),
    };
    root.localStorage.setItem(_storageKey(userId, secretType), JSON.stringify(blob));
    return true;
  }

  /**
   * فتح الخزنة. يُرجع الحمولة، أو يرمي خطأً عند فشل التحقّق (سرّ خاطئ).
   * @returns {Promise<object>}
   */
  async function unlock({ userId, secretType, secret }) {
    if (!isSupported()) throw new Error('WebCrypto غير مدعوم على هذا الجهاز');
    const raw = root.localStorage.getItem(_storageKey(userId, secretType));
    if (!raw) throw new Error('لا توجد خزنة محفوظة');

    let blob;
    try { blob = JSON.parse(raw); } catch { throw new Error('الخزنة تالفة'); }

    const salt = _b64ToBytes(blob.salt);
    const iv   = _b64ToBytes(blob.iv);
    const ct   = _b64ToBytes(blob.ct);
    const key  = await _deriveKey(secret, salt);

    let ptBuf;
    try {
      ptBuf = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
    } catch {
      // فشل auth-tag → السرّ خاطئ
      throw new Error('السرّ غير صحيح');
    }
    return JSON.parse(new TextDecoder().decode(ptBuf));
  }

  function has(userId, secretType) {
    try { return !!root.localStorage.getItem(_storageKey(userId, secretType)); }
    catch { return false; }
  }

  /** أنواع الأسرار المتاحة لهذا المستخدم على هذا الجهاز. */
  function list(userId) {
    return Object.values(SECRET).filter((t) => has(userId, t));
  }

  /** حذف خزنة (نوع محدّد أو كل أنواع المستخدم). */
  function remove(userId, secretType = null) {
    try {
      if (secretType) {
        root.localStorage.removeItem(_storageKey(userId, secretType));
        return;
      }
      Object.values(SECRET).forEach((t) =>
        root.localStorage.removeItem(_storageKey(userId, t)));
    } catch { /* تجاهل */ }
  }

  /** مسح خزائن كل المستخدمين على هذا الجهاز (يُستخدم في RESET). */
  function purgeAll() {
    try {
      const keys = [];
      for (let i = 0; i < root.localStorage.length; i++) {
        const k = root.localStorage.key(i);
        if (k && k.startsWith(VAULT_PREFIX)) keys.push(k);
      }
      keys.forEach((k) => root.localStorage.removeItem(k));
    } catch { /* تجاهل */ }
  }

  const SessionVault = {
    SECRET,
    isSupported,
    create,
    unlock,
    has,
    list,
    remove,
    purgeAll,
  };

  root.SessionVault = SessionVault;
  if (typeof module !== 'undefined' && module.exports) module.exports = SessionVault;
})(typeof window !== 'undefined' ? window : globalThis);

if (typeof console !== 'undefined') console.log('✅ SessionVault.js v1.0 محمّل — الجلسة المشفّرة محليّاً');
