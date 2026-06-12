/**
 * tests/helpers.test.js
 * اختبارات helpers.js
 * الملف محمَّل بالفعل في setup.js — نختبر window.* exports مباشرة.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ============================================================
// 1. Result Pattern
// ============================================================
describe('Result Pattern — ok / err / isOk', () => {
  it('ok() يُنشئ كائن نجاح بالبيانات الصحيحة', () => {
    const result = globalThis.ok({ id: 1, name: 'test' });
    expect(result).toEqual({ ok: true, data: { id: 1, name: 'test' } });
    expect(result.ok).toBe(true);
  });

  it('ok() يقبل null وundefined', () => {
    expect(globalThis.ok(null)).toEqual({ ok: true, data: null });
    expect(globalThis.ok(undefined)).toEqual({ ok: true, data: undefined });
  });

  it('err() يُنشئ كائن فشل برسالة الخطأ', () => {
    const result = globalThis.err('حدث خطأ');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('حدث خطأ');
  });

  it('err() يقبل تفاصيل إضافية', () => {
    const result = globalThis.err('خطأ', { code: 404 });
    expect(result.details).toEqual({ code: 404 });
  });

  it('isOk() يُرجع true للنجاح وfalsy للفشل', () => {
    expect(globalThis.isOk(globalThis.ok(42))).toBe(true);
    expect(globalThis.isOk(globalThis.err('خطأ'))).toBe(false);
    // null/undefined مُقيَّمان كـ short-circuit — falsy وليس false بالضرورة
    expect(globalThis.isOk(null)).toBeFalsy();
    expect(globalThis.isOk(undefined)).toBeFalsy();
    expect(globalThis.isOk({ ok: false })).toBe(false);
  });
});

// ============================================================
// 2. escapeHtml
// ============================================================
describe('escapeHtml — تنظيف الـ HTML', () => {
  it('يُهرِّب الحروف الخطرة', () => {
    expect(globalThis.escapeHtml('<script>alert("xss")</script>'))
      .toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
  });

  it('يُهرِّب & و < و > و " و \'', () => {
    expect(globalThis.escapeHtml('a & b')).toBe('a &amp; b');
    expect(globalThis.escapeHtml('<div>')).toBe('&lt;div&gt;');
    expect(globalThis.escapeHtml('"quoted"')).toBe('&quot;quoted&quot;');
    expect(globalThis.escapeHtml("it's")).toBe('it&#039;s');
  });

  it('يُرجع نص فارغ لـ null وundefined', () => {
    expect(globalThis.escapeHtml(null)).toBe('');
    expect(globalThis.escapeHtml(undefined)).toBe('');
  });

  it('لا يُغيِّر النص الآمن', () => {
    expect(globalThis.escapeHtml('مرحبا أبو حذيفة')).toBe('مرحبا أبو حذيفة');
  });
});

// ============================================================
// 3. formatErrorMessage
// ============================================================
describe('formatErrorMessage — تحويل الأخطاء لرسائل عربية', () => {
  it('يُرجع رسالة افتراضية لـ null وundefined', () => {
    expect(globalThis.formatErrorMessage(null)).toBe('حدث خطأ غير متوقع');
    expect(globalThis.formatErrorMessage(undefined)).toBe('حدث خطأ غير متوقع');
  });

  it('يُرجع النص مباشرة إذا كان string', () => {
    expect(globalThis.formatErrorMessage('خطأ مخصص')).toBe('خطأ مخصص');
  });

  it('يعالج خطأ err() كائن — يُرجع رسالة الخطأ', () => {
    const errObj = globalThis.err('رسالة الخطأ');
    expect(globalThis.formatErrorMessage(errObj)).toBe('رسالة الخطأ');
  });

  it('يكشف أخطاء الشبكة "Failed to fetch"', () => {
    const networkErr = new TypeError('Failed to fetch');
    const msg = globalThis.formatErrorMessage(networkErr);
    expect(msg).toContain('الاتصال');
  });

  it('يكشف أخطاء المصادقة "Invalid login credentials"', () => {
    const authErr = new Error('Invalid login credentials');
    const msg = globalThis.formatErrorMessage(authErr);
    expect(msg).toContain('كلمة المرور');
  });

  it('يكشف أخطاء JWT/token', () => {
    const tokenErr = new Error('JWT expired');
    const msg = globalThis.formatErrorMessage(tokenErr);
    expect(msg).toContain('الجلسة');
  });

  it('يكشف خطأ الـ duplicate key (23505)', () => {
    const dupErr = new Error('duplicate key value violates unique constraint — 23505');
    const msg = globalThis.formatErrorMessage(dupErr);
    expect(msg).toContain('موجود');
  });

  it('يُرجع رسالة قصيرة مباشرة بدون تعديل', () => {
    const shortErr = new Error('مبلغ غير صحيح');
    expect(globalThis.formatErrorMessage(shortErr)).toBe('مبلغ غير صحيح');
  });
});

// ============================================================
// 4. hashSHA256
// ============================================================
describe('hashSHA256 — تشفير SHA-256', () => {
  it('يُرجع string hex من 64 حرفاً', async () => {
    const hash = await globalThis.hashSHA256('my-equation');
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('نفس النص + userId يُنتج نفس الهاش دائماً (deterministic)', async () => {
    const h1 = await globalThis.hashSHA256('1+1', 'user-123');
    const h2 = await globalThis.hashSHA256('1+1', 'user-123');
    expect(h1).toBe(h2);
  });

  it('نص مختلف يُنتج هاش مختلف', async () => {
    const h1 = await globalThis.hashSHA256('equation-A');
    const h2 = await globalThis.hashSHA256('equation-B');
    expect(h1).not.toBe(h2);
  });

  it('نفس النص بـ userId مختلف يُنتج هاش مختلف (ربط الهاش بالمستخدم)', async () => {
    const h1 = await globalThis.hashSHA256('eq', 'user-1');
    const h2 = await globalThis.hashSHA256('eq', 'user-2');
    expect(h1).not.toBe(h2);
  });

  it('النص بدون userId يُنتج هاش مختلف عن نفسه مع userId', async () => {
    const h1 = await globalThis.hashSHA256('test');
    const h2 = await globalThis.hashSHA256('test', 'some-user');
    expect(h1).not.toBe(h2);
  });
});

// ============================================================
// 5. Session helpers — saveSession / getSession / clearSession
// ============================================================
describe('Session helpers — saveSession / getSession / clearSession', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('saveSession → getSession يُرجع ما تم حفظه', () => {
    const session = { userId: 'u-1', role: 'admin' };
    globalThis.saveSession(session);
    const loaded = globalThis.getSession();
    expect(loaded.userId).toBe('u-1');
    expect(loaded.role).toBe('admin');
  });

  it('saveSession يُحافظ على sessionExpiresAt الموجود', () => {
    const expiry = Date.now() + 3_600_000;
    globalThis.saveSession({ userId: 'u-2', sessionExpiresAt: expiry });
    // حفظ مرة ثانية بدون sessionExpiresAt — يجب أن يحتفظ بالـ expiry الأصلي
    globalThis.saveSession({ userId: 'u-2' });
    const loaded = globalThis.getSession();
    expect(loaded.sessionExpiresAt).toBe(expiry);
  });

  it('saveSession يُعيّن sessionExpiresAt جديد إذا لم يكن موجوداً', () => {
    const before = Date.now();
    globalThis.saveSession({ userId: 'u-3' });
    const loaded = globalThis.getSession();
    const after = Date.now();
    expect(loaded.sessionExpiresAt).toBeGreaterThanOrEqual(before + 28_790_000);
    expect(loaded.sessionExpiresAt).toBeLessThanOrEqual(after + 28_800_000);
  });

  it('clearSession يمسح الجلسة — getSession يُرجع null', () => {
    globalThis.saveSession({ userId: 'u-4' });
    globalThis.clearSession();
    expect(globalThis.getSession()).toBeNull();
  });

  it('getSession يُرجع null إذا لم توجد جلسة', () => {
    expect(globalThis.getSession()).toBeNull();
  });
});

// ============================================================
// 6. Validation helpers
// ============================================================
describe('isValidEmail', () => {
  it('يقبل emails صحيحة', () => {
    expect(globalThis.isValidEmail('user@example.com')).toBe(true);
    expect(globalThis.isValidEmail('a.b+c@d.org')).toBe(true);
  });

  it('يرفض emails خاطئة', () => {
    expect(globalThis.isValidEmail('not-an-email')).toBe(false);
    expect(globalThis.isValidEmail('')).toBe(false);
    expect(globalThis.isValidEmail('missing@')).toBe(false);
  });
});

describe('isValidAmount', () => {
  it('يقبل مبالغ ضمن النطاق المسموح', () => {
    expect(globalThis.isValidAmount(100)).toBe(true);
    expect(globalThis.isValidAmount(0.01)).toBe(true);
    expect(globalThis.isValidAmount(10_000_000)).toBe(true);
  });

  it('يرفض مبالغ خارج النطاق', () => {
    expect(globalThis.isValidAmount(0)).toBe(false);
    expect(globalThis.isValidAmount(-5)).toBe(false);
    expect(globalThis.isValidAmount(10_000_001)).toBe(false);
  });

  it('يرفض قيم غير رقمية', () => {
    expect(globalThis.isValidAmount('abc')).toBe(false);
    expect(globalThis.isValidAmount(null)).toBe(false);
    expect(globalThis.isValidAmount(undefined)).toBe(false);
    expect(globalThis.isValidAmount(NaN)).toBe(false);
  });
});

// ============================================================
// 7. generateUUID
// ============================================================
describe('generateUUID', () => {
  it('يُنتج UUID بصيغة v4 صحيحة', () => {
    const uuid = globalThis.generateUUID();
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('كل استدعاء يُنتج UUID فريداً', () => {
    const ids = new Set(Array.from({ length: 20 }, () => globalThis.generateUUID()));
    expect(ids.size).toBe(20);
  });
});

// ============================================================
// 8. formatCurrency
// ============================================================
describe('formatCurrency', () => {
  it('يُنسِّق المبالغ بشكل صحيح', () => {
    const formatted = globalThis.formatCurrency(1500.5);
    expect(formatted).toBeTruthy();
    // يجب أن يحتوي على الرقم الأساسي
    expect(formatted).toContain('1');
  });

  it('يُعالج الصفر', () => {
    const formatted = globalThis.formatCurrency(0);
    expect(formatted).toBeTruthy();
  });

  it('يُعالج الأرقام السالبة', () => {
    const formatted = globalThis.formatCurrency(-100);
    expect(formatted).toBeTruthy();
  });
});
