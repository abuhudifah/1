/**
 * tests/AuthService.test.js
 * اختبارات AuthService.js
 *
 * AuthService.js يُصدِّر كائناً واحداً: window.AuthService
 * AuthState متاح عبر AuthService._state
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScript } from './setup.js';

let AS; // اختصار لـ globalThis.AuthService

beforeAll(() => {
  loadScript('services/AuthService.js');
  AS = globalThis.AuthService;
});

beforeEach(() => {
  sessionStorage.clear();
  // إعادة AuthState لحالته الابتدائية
  if (AS?._state) {
    AS._state.currentUser   = null;
    AS._state.authUser      = null;
    AS._state.isOffline     = false;
    AS._state.isInitialized = false;
  }
  vi.clearAllMocks();
  globalThis.isOnline.mockReturnValue(true);
  globalThis.getCurrentSession.mockResolvedValue({ session: null, error: null });
});

// ============================================================
// 1. generateAccountNumber
// ============================================================
describe('AuthService.generateAccountNumber', () => {
  it('يُرجع account_number من كائن المستخدم إذا كان موجوداً', () => {
    const num = AS.generateAccountNumber({ role: 'admin', account_number: 'ADM-001' });
    expect(num).toBe('ADM-001');
  });

  it('يُرجع account_number للمندوب', () => {
    const num = AS.generateAccountNumber({ role: 'agent', account_number: 'AGT-999' });
    expect(num).toBe('AGT-999');
  });

  it('يُرجع null إذا لم يكن للمستخدم account_number', () => {
    const num = AS.generateAccountNumber({ role: 'admin' });
    expect(num).toBeNull();
  });

  it('يُرجع null إذا لم يُمرَّر مستخدم ولم يكن currentUser موجوداً', () => {
    AS._state.currentUser = null;
    const num = AS.generateAccountNumber();
    expect(num).toBeNull();
  });

  it('يستخدم currentUser إذا لم يُمرَّر مستخدم', () => {
    AS._state.currentUser = { role: 'admin', account_number: 'ADM-STATE-1' };
    const num = AS.generateAccountNumber();
    expect(num).toBe('ADM-STATE-1');
  });
});

// ============================================================
// 2. Role checks — isAdmin / isAgent / isAdminAssistant
// ============================================================
describe('Role checks via AuthService._state', () => {
  it('isAdmin() صحيح للمدير', () => {
    AS._state.currentUser = { role: 'admin', is_active: true };
    expect(AS.isAdmin()).toBe(true);
    expect(AS.isAgent()).toBe(false);
    expect(AS.isAdminAssistant()).toBe(false);
  });

  it('isAgent() صحيح للمندوب', () => {
    AS._state.currentUser = { role: 'agent', is_active: true };
    expect(AS.isAgent()).toBe(true);
    expect(AS.isAdmin()).toBe(false);
  });

  it('isAdminAssistant() صحيح للمساعد الإداري', () => {
    AS._state.currentUser = { role: 'admin_assistant', is_active: true };
    expect(AS.isAdminAssistant()).toBe(true);
  });

  it('جميع الدوال false عند غياب currentUser', () => {
    AS._state.currentUser = null;
    expect(AS.isAdmin()).toBe(false);
    expect(AS.isAgent()).toBe(false);
    expect(AS.isAdminAssistant()).toBe(false);
  });
});

// ============================================================
// 3. getAllowedTabs / canAccessTab
// ============================================================
describe('getAllowedTabs / canAccessTab', () => {
  it('المدير يصل لجميع التبويبات المهمة', () => {
    AS._state.currentUser = { role: 'admin', is_active: true };
    const tabs = AS.getAllowedTabs();
    expect(tabs).toContain('dashboard');
    expect(tabs).toContain('users');
    expect(tabs).toContain('settings');
    expect(tabs).toContain('audit-log');
  });

  it('المندوب لا يصل لـ dashboard وusers وaudit-log', () => {
    AS._state.currentUser = { role: 'agent', is_active: true };
    const tabs = AS.getAllowedTabs();
    expect(tabs).not.toContain('dashboard');
    expect(tabs).not.toContain('users');
    expect(tabs).not.toContain('audit-log');
  });

  it('المندوب يصل لـ data-entry وdaily-summary', () => {
    AS._state.currentUser = { role: 'agent', is_active: true };
    expect(AS.canAccessTab('data-entry')).toBe(true);
    expect(AS.canAccessTab('daily-summary')).toBe(true);
    expect(AS.canAccessTab('notifications')).toBe(true);
  });

  it('canAccessTab يرفض تبويبات الإدارة للمندوب', () => {
    AS._state.currentUser = { role: 'agent', is_active: true };
    expect(AS.canAccessTab('dashboard')).toBe(false);
    expect(AS.canAccessTab('users')).toBe(false);
    expect(AS.canAccessTab('account-management')).toBe(false);
  });

  it('getAllowedTabs يُرجع [] عند غياب currentUser', () => {
    AS._state.currentUser = null;
    expect(AS.getAllowedTabs()).toEqual([]);
  });
});

// ============================================================
// 4. login — نجاح / فشل
// ============================================================
describe('AuthService.login', () => {
  it('نجاح الدخول → ok مع profile', async () => {
    const mockUser    = { id: 'u-1', email: 'admin@test.com' };
    const mockProfile = { id: 'u-1', email: 'admin@test.com', role: 'admin', display_name: 'Admin', is_active: true, account_number: 'ADM001' };

    globalThis.supabaseClient.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: mockUser, session: { access_token: 'tok' } },
      error: null,
    });
    globalThis.supabaseClient.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: mockProfile, error: null }),
    });
    // mock لـ _ensureUserAccountNumber
    globalThis.supabaseClient.from.mockReturnValueOnce({
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: mockProfile, error: null }),
    });

    const result = await AS.login('admin@test.com', 'Password123!');
    expect(result.ok).toBe(true);
    expect(result.data.profile.role).toBe('admin');
  });

  it('خطأ Supabase → err مع رسالة مفهومة', async () => {
    globalThis.supabaseClient.auth.signInWithPassword.mockResolvedValueOnce({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    const result = await AS.login('bad@test.com', 'wrongpassword');
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('email فارغ → err فوري بدون استدعاء Supabase', async () => {
    const result = await AS.login('', 'Password123!');
    expect(result.ok).toBe(false);
    expect(globalThis.supabaseClient.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it('password فارغ → err فوري', async () => {
    const result = await AS.login('user@test.com', '');
    expect(result.ok).toBe(false);
    expect(globalThis.supabaseClient.auth.signInWithPassword).not.toHaveBeenCalled();
  });
});

// ============================================================
// 5. Brute Force protection
// ============================================================
describe('Brute Force protection', () => {
  it('بعد 5 محاولات فاشلة الحساب مقفول — Supabase لا يُستدعى في المحاولة السادسة', async () => {
    globalThis.supabaseClient.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    const email = 'brute@test.com';
    // 5 محاولات فاشلة
    for (let i = 0; i < 5; i++) {
      await AS.login(email, 'wrong');
    }

    const callsBefore = globalThis.supabaseClient.auth.signInWithPassword.mock.calls.length;
    const result = await AS.login(email, 'wrong');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('قفل');
    // Supabase لم يُستدعَ مرة إضافية
    expect(globalThis.supabaseClient.auth.signInWithPassword.mock.calls.length).toBe(callsBefore);
  });

  it('حسابات مختلفة تملك عدّادات مستقلة', async () => {
    globalThis.supabaseClient.auth.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    // 4 محاولات للحساب الأول
    for (let i = 0; i < 4; i++) {
      await AS.login('user-a@test.com', 'wrong');
    }

    // حساب ثانٍ — يجب أن لا يكون مقفولاً
    const result = await AS.login('user-b@test.com', 'wrong');
    expect(result.error).not.toContain('قفل');
  });
});

// ============================================================
// 6. logout
// ============================================================
describe('AuthService.logout', () => {
  it('logout يمسح الجلسة ويُرجع ok', async () => {
    globalThis.saveSession({ userId: 'u-99', role: 'admin' });
    AS._state.currentUser = { id: 'u-99', role: 'admin' };

    globalThis.supabaseClient.auth.signOut.mockResolvedValueOnce({ error: null });

    const result = await AS.logout();
    expect(result.ok).toBe(true);
    expect(globalThis.getSession()).toBeNull();
    expect(AS._state.currentUser).toBeNull();
  });
});

// ============================================================
// 7. checkSession
// ============================================================
describe('AuthService.checkSession', () => {
  it('لا جلسة في sessionStorage → err فوري بدون استدعاء Supabase', async () => {
    // sessionStorage فارغ — لا داعي لاستدعاء Supabase
    const result = await AS.checkSession();
    expect(result.ok).toBe(false);
    expect(globalThis.supabaseClient.auth.getSession).not.toHaveBeenCalled();
  });

  it('جلسة منتهية الصلاحية (sessionExpiresAt ماضٍ) → err بدون استدعاء Supabase', async () => {
    // الجلسة المحلية منتهية الصلاحية — فشل سريع
    globalThis.saveSession({ userId: 'u-1', sessionExpiresAt: Date.now() - 1000 });
    globalThis.supabaseClient.auth.signOut.mockResolvedValueOnce({ error: null });

    const result = await AS.checkSession();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('انتهت');
    expect(globalThis.supabaseClient.auth.getSession).not.toHaveBeenCalled();
  });
});
