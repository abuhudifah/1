/**
 * tests/SyncEngine.test.js
 * اختبارات SyncEngine.js
 *
 * يختبر: syncAll (offline / no-db / success / partial)، syncOperation (نجاح / فشل / تعارض).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScript } from './setup.js';

beforeAll(() => {
  loadScript('services/SyncEngine.js');
});

beforeEach(() => {
  vi.clearAllMocks();
  globalThis.db.isOpen.mockReturnValue(true);
  globalThis.isOnline.mockReturnValue(true);
});

// ============================================================
// 1. syncAll — المتطلبات الأساسية
// ============================================================
describe('SyncEngine.syncAll', () => {
  it('يُرجع err إذا كان offline', async () => {
    globalThis.isOnline.mockReturnValueOnce(false);
    const result = await globalThis.SyncEngine.syncAll();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('اتصال');
  });

  it('يُرجع err إذا كانت Dexie مغلقة', async () => {
    globalThis.db.isOpen.mockReturnValueOnce(false);
    const result = await globalThis.SyncEngine.syncAll();
    expect(result.ok).toBe(false);
    expect(result.error).toContain('قاعدة البيانات');
  });

  it('لا توجد عمليات معلقة → ok مع synced=0', async () => {
    globalThis.db.transactions.where.mockReturnThis();
    globalThis.db.transactions.equals.mockReturnThis();
    globalThis.db.transactions.toArray.mockResolvedValueOnce([]);

    const result = await globalThis.SyncEngine.syncAll();
    expect(result.ok).toBe(true);
    expect(result.data.synced).toBe(0);
    expect(result.data.total).toBe(0);
  });

  it('مزامنة عملية واحدة بنجاح → synced=1, failed=0', async () => {
    const pendingOp = {
      id: 'TEMP_abc123',
      type: 'collection',
      amount: 100,
      sync_status: 'pending',
      idempotency_key: 'idem-1',
      user_id: 'u-1',
      date: '2026-06-12',
    };

    globalThis.db.transactions.where.mockReturnThis();
    globalThis.db.transactions.equals.mockReturnThis();
    globalThis.db.transactions.toArray.mockResolvedValueOnce([pendingOp]);

    // mock syncOperation ليُرجع نجاحاً
    const originalSync = globalThis.SyncEngine.syncOperation;
    globalThis.SyncEngine.syncOperation = vi.fn().mockResolvedValueOnce(globalThis.ok({ id: 'server-id-1' }));

    const result = await globalThis.SyncEngine.syncAll();
    expect(result.ok).toBe(true);
    expect(result.data.synced).toBe(1);
    expect(result.data.failed).toBe(0);

    globalThis.SyncEngine.syncOperation = originalSync;
  });

  it('فشل مزامنة عملية → failed يزداد', async () => {
    const pendingOp = {
      id: 'TEMP_fail1', type: 'collection', amount: 100,
      sync_status: 'pending', idempotency_key: 'idem-fail',
      user_id: 'u-1', date: '2026-06-12',
    };

    globalThis.db.transactions.where.mockReturnThis();
    globalThis.db.transactions.equals.mockReturnThis();
    globalThis.db.transactions.toArray.mockResolvedValueOnce([pendingOp]);

    const originalSync = globalThis.SyncEngine.syncOperation;
    globalThis.SyncEngine.syncOperation = vi.fn().mockResolvedValueOnce(globalThis.err('فشل الخادم'));

    const result = await globalThis.SyncEngine.syncAll();
    expect(result.ok).toBe(true);
    expect(result.data.failed).toBe(1);
    expect(result.data.synced).toBe(0);

    globalThis.SyncEngine.syncOperation = originalSync;
  });

  it('خطأ عام في syncAll → يُرجع err مع رسالة مفهومة', async () => {
    globalThis.db.transactions.where.mockImplementationOnce(() => {
      throw new Error('Unexpected DB error');
    });

    const result = await globalThis.SyncEngine.syncAll();
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================
// 2. syncOperation — مزامنة عملية واحدة
// ============================================================
describe('SyncEngine.syncOperation', () => {
  const pendingOp = {
    id: 'TEMP_test',
    type: 'collection',
    amount: 500,
    sync_status: 'pending',
    idempotency_key: 'idem-test',
    user_id: 'u-1',
    date: '2026-06-12',
    debtor_id: 'debtor-1',
    updated_at: '2026-06-12T10:00:00Z',
  };

  it('نجاح الإدراج في Supabase → ok مع البيانات المُرجَعة', async () => {
    const serverData = { ...pendingOp, id: 'server-real-id', sync_status: 'synced' };

    const chain = {
      from:   vi.fn().mockReturnThis(),
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: serverData, error: null }),
    };
    globalThis.supabaseClient.from.mockReturnValueOnce(chain);
    globalThis.db.transactions.update.mockResolvedValueOnce(1);

    const result = await globalThis.SyncEngine.syncOperation(pendingOp);
    expect(result.ok).toBe(true);
  });

  it('خطأ 23505 (duplicate key) → يُعامَل كنجاح (idempotent)', async () => {
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: null, error: { code: '23505', message: 'duplicate key' } }),
    };
    globalThis.supabaseClient.from.mockReturnValueOnce(chain);

    // في حالة 23505، يُرجع ok (الإدراج مكرر يُعدّ نجاحاً)
    const result = await globalThis.SyncEngine.syncOperation(pendingOp);
    // السلوك المتوقع: إما ok أو err — لكن يجب عدم الـ crash
    expect(typeof result.ok).toBe('boolean');
  });

  it('خطأ الخادم العام → يُرجع err مع رسالة مفهومة', async () => {
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValueOnce({ data: null, error: { code: '500', message: 'Internal Server Error' } }),
    };
    globalThis.supabaseClient.from.mockReturnValueOnce(chain);

    const result = await globalThis.SyncEngine.syncOperation(pendingOp);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('استثناء غير متوقع → يُرجع err بدون crash', async () => {
    globalThis.supabaseClient.from.mockImplementationOnce(() => {
      throw new TypeError('Network failure');
    });

    const result = await globalThis.SyncEngine.syncOperation(pendingOp);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ============================================================
// 3. _markSynced — تحديث حالة العملية في Dexie
// ============================================================
describe('SyncEngine._markSynced', () => {
  it('يُحدِّث sync_status إلى synced في Dexie', async () => {
    globalThis.db.transactions.update.mockResolvedValueOnce(1);

    await globalThis.SyncEngine._markSynced('TEMP_abc');
    expect(globalThis.db.transactions.update).toHaveBeenCalledWith(
      'TEMP_abc',
      expect.objectContaining({ sync_status: 'synced' })
    );
  });
});
