/**
 * tests/LocalOperationsService.test.js
 * اختبارات LocalOperationsService.js
 *
 * يختبر: validateOperation (منطق بحت)، saveLocalOperation (مع Dexie mock).
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScript } from './setup.js';

beforeAll(() => {
  loadScript('services/LocalOperationsService.js');
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================================
// 1. validateOperation — منطق بحت لا يحتاج DB
// ============================================================
describe('validateOperation', () => {
  const baseOp = {
    type: 'collection',
    amount: 500,
    user_id: 'user-1',
    date: '2026-06-12',
    debtor_id: 'debtor-1',
  };

  it('يقبل عملية صحيحة كاملة', () => {
    const result = globalThis.LocalOperationsService.validateOperation(baseOp);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('يرفض null', () => {
    const result = globalThis.LocalOperationsService.validateOperation(null);
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('يرفض عملية بدون type', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, type: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('نوع');
  });

  it('يرفض نوع عملية غير معروف', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, type: 'unknown_type' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('غير معروف');
  });

  it('يرفض مبلغ صفر', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, amount: 0 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('المبلغ');
  });

  it('يرفض مبلغ سالب', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, amount: -100 });
    expect(result.valid).toBe(false);
  });

  it('يرفض مبلغ يتجاوز الحد الأقصى', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, amount: 10_000_001 });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('الحد الأقصى');
  });

  it('يرفض عملية بدون user_id', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, user_id: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('المستخدم');
  });

  it('يرفض عملية بدون date', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, date: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('تاريخ');
  });

  it('تحصيل بدون debtor_id → خطأ', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, debtor_id: undefined });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('المدين');
  });

  it('إيداع بدون bank_account_id → خطأ', () => {
    const depositOp = { ...baseOp, type: 'deposit', debtor_id: undefined };
    const result = globalThis.LocalOperationsService.validateOperation(depositOp);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('البنكي');
  });

  it('مبلغ عند الحد الأدنى (0.01) مقبول', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, amount: 0.01 });
    expect(result.valid).toBe(true);
  });

  it('مبلغ عند الحد الأقصى (10,000,000) مقبول', () => {
    const result = globalThis.LocalOperationsService.validateOperation({ ...baseOp, amount: 10_000_000 });
    expect(result.valid).toBe(true);
  });
});

// ============================================================
// 2. saveLocalOperation — مع Dexie mock
// ============================================================
describe('saveLocalOperation', () => {
  const validOp = {
    type: 'collection',
    amount: 250,
    user_id: 'user-1',
    date: '2026-06-12',
    debtor_id: 'debtor-1',
  };

  it('يحفظ العملية في Dexie ويُرجع ok', async () => {
    const savedId = 'local-id-1';
    globalThis.db.transactions.add.mockResolvedValueOnce(savedId);

    const result = await globalThis.LocalOperationsService.saveLocalOperation(validOp);

    expect(result.ok).toBe(true);
    expect(globalThis.db.transactions.add).toHaveBeenCalledOnce();
  });

  it('الكائن المحفوظ يحتوي على idempotency_key وsync_status=pending', async () => {
    let savedData;
    globalThis.db.transactions.add.mockImplementationOnce(async (data) => {
      savedData = data;
      return 'id-1';
    });

    await globalThis.LocalOperationsService.saveLocalOperation(validOp);

    expect(savedData).toBeDefined();
    expect(savedData.sync_status).toBe('pending');
    expect(savedData.idempotency_key).toBeTruthy();
  });

  it('يُرجع err إذا فشل الـ Dexie', async () => {
    globalThis.db.transactions.add.mockRejectedValueOnce(new Error('QuotaExceeded'));

    const result = await globalThis.LocalOperationsService.saveLocalOperation(validOp);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('يرفض عملية غير صالحة قبل الوصول لـ DB', async () => {
    const invalidOp = { type: 'collection', amount: 0, user_id: 'u', date: '2026-01-01', debtor_id: 'd' };
    const result = await globalThis.LocalOperationsService.saveLocalOperation(invalidOp);
    expect(result.ok).toBe(false);
    // DB لم يُستدعَ
    expect(globalThis.db.transactions.add).not.toHaveBeenCalled();
  });
});

// ============================================================
// 3. getLocalOperations
// ============================================================
describe('getLocalOperations', () => {
  it('يُرجع العمليات المعلقة من Dexie', async () => {
    const mockRows = [
      { id: 'T1', type: 'collection', amount: 100, sync_status: 'pending' },
      { id: 'T2', type: 'deposit',    amount: 200, sync_status: 'pending' },
    ];
    globalThis.db.transactions.toArray.mockResolvedValueOnce(mockRows);

    const result = await globalThis.LocalOperationsService.getLocalOperations({});
    expect(result.ok).toBe(true);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('يُرجع err إذا فشل Dexie', async () => {
    globalThis.db.transactions.toArray.mockRejectedValueOnce(new Error('DB error'));
    const result = await globalThis.LocalOperationsService.getLocalOperations({});
    expect(result.ok).toBe(false);
  });
});

// ============================================================
// 4. deleteLocalOperation
// ============================================================
describe('deleteLocalOperation', () => {
  it('يحذف العملية بـ id صحيح ويُرجع ok', async () => {
    globalThis.db.transactions.delete.mockResolvedValueOnce(undefined);

    const result = await globalThis.LocalOperationsService.deleteLocalOperation('T-1');
    expect(result.ok).toBe(true);
    expect(globalThis.db.transactions.delete).toHaveBeenCalledWith('T-1');
  });

  it('يرفض id فارغ', async () => {
    const result = await globalThis.LocalOperationsService.deleteLocalOperation('');
    expect(result.ok).toBe(false);
  });

  it('يُرجع err إذا فشل Dexie', async () => {
    globalThis.db.transactions.delete.mockRejectedValueOnce(new Error('Not found'));
    const result = await globalThis.LocalOperationsService.deleteLocalOperation('BAD_ID');
    expect(result.ok).toBe(false);
  });
});
