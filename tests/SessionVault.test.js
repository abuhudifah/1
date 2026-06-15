/**
 * tests/SessionVault.test.js
 * اختبارات services/SessionVault.js — «الجلسة المشفّرة محليّاً»
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { loadScript } from './setup.js';

let SV;

beforeAll(() => {
  loadScript('services/SessionVault.js');
  SV = globalThis.SessionVault;
});

beforeEach(() => {
  localStorage.clear();
});

const userId = 'user-uuid-1';
const payload = {
  refresh_token: 'rt_secret_abc',
  profile: { id: userId, role: 'agent', allowed_tabs: ['data-entry'] },
  deviceId: 'user-uuid-1_dev9',
};

describe('SessionVault', () => {
  it('مدعوم في بيئة الاختبار (WebCrypto متاح)', () => {
    expect(SV.isSupported()).toBe(true);
  });

  it('يشفّر ثم يفكّ بنفس السرّ (round-trip)', async () => {
    await SV.create({ userId, secretType: SV.SECRET.EQUATION, secret: '1997+5', payload });
    const out = await SV.unlock({ userId, secretType: SV.SECRET.EQUATION, secret: '1997+5' });
    expect(out.refresh_token).toBe('rt_secret_abc');
    expect(out.profile.role).toBe('agent');
  });

  it('يفشل الفكّ بسرّ خاطئ (auth-tag)', async () => {
    await SV.create({ userId, secretType: SV.SECRET.EQUATION, secret: '1997+5', payload });
    await expect(
      SV.unlock({ userId, secretType: SV.SECRET.EQUATION, secret: '1+1' })
    ).rejects.toThrow();
  });

  it('يسمح بالفتح أكثر من مرة (لا قيد استخدام واحد)', async () => {
    await SV.create({ userId, secretType: SV.SECRET.PIN, secret: '4321', payload });
    const a = await SV.unlock({ userId, secretType: SV.SECRET.PIN, secret: '4321' });
    const b = await SV.unlock({ userId, secretType: SV.SECRET.PIN, secret: '4321' });
    expect(a.refresh_token).toBe(b.refresh_token);
  });

  it('has/list يعكسان الأنواع المخزّنة', async () => {
    await SV.create({ userId, secretType: SV.SECRET.EQUATION, secret: 'x', payload });
    expect(SV.has(userId, SV.SECRET.EQUATION)).toBe(true);
    expect(SV.has(userId, SV.SECRET.PIN)).toBe(false);
    expect(SV.list(userId)).toEqual(['equation']);
  });

  it('remove يحذف نوعاً محدّداً، purgeAll يمسح الكل', async () => {
    await SV.create({ userId, secretType: SV.SECRET.EQUATION, secret: 'x', payload });
    await SV.create({ userId, secretType: SV.SECRET.PIN, secret: '1111', payload });
    SV.remove(userId, SV.SECRET.PIN);
    expect(SV.has(userId, SV.SECRET.PIN)).toBe(false);
    expect(SV.has(userId, SV.SECRET.EQUATION)).toBe(true);
    SV.purgeAll();
    expect(SV.list(userId)).toEqual([]);
  });

  it('unlock يرمي عند غياب الخزنة', async () => {
    await expect(
      SV.unlock({ userId, secretType: SV.SECRET.EQUATION, secret: 'x' })
    ).rejects.toThrow();
  });
});
