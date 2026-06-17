-- إضافة عمود الرصيد الافتتاحي للحسابات البنكية
ALTER TABLE public.bank_accounts
  ADD COLUMN IF NOT EXISTS opening_balance numeric NOT NULL DEFAULT 0;
