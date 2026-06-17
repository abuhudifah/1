-- Migration: 20260617000001_optimize_ledger_indexes
-- تحسين فهارس account_ledger وإضافة فهرس bank_account_id لجدول transactions

-- ══════════════════════════════════════════════════════
-- إزالة الفهارس المكررة على account_ledger (إن وُجدت)
-- ══════════════════════════════════════════════════════
DROP INDEX IF EXISTS public.idx_ledger_account_date;
DROP INDEX IF EXISTS public.idx_ledger_reference_id;
DROP INDEX IF EXISTS public.idx_ledger_account_id;

-- ══════════════════════════════════════════════════════
-- إعادة إنشاء الفهارس بشكل موحّد وصريح
-- ══════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_ledger_account_date
  ON public.account_ledger USING btree (account_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_ledger_reference_id
  ON public.account_ledger USING btree (reference_id);

CREATE INDEX IF NOT EXISTS idx_ledger_account_id
  ON public.account_ledger USING btree (account_id);

-- ══════════════════════════════════════════════════════
-- فهرس مفقود: transactions(bank_account_id, date DESC)
-- يُستخدم في كشوف الحسابات البنكية
-- ══════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_transactions_bank_date
  ON public.transactions USING btree (bank_account_id, date DESC);
