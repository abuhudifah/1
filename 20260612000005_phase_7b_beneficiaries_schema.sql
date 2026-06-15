-- Migration: Phase 7B — إصلاح user_beneficiaries وإضافة الأعمدة المفقودة
-- (Applied via mcp__Supabase__apply_migration above — this file documents the SQL)

ALTER TABLE public.user_beneficiaries
  ADD COLUMN IF NOT EXISTS beneficiary_type TEXT NOT NULL DEFAULT 'bank'
    CHECK (beneficiary_type IN ('user','company','bank')),
  ADD COLUMN IF NOT EXISTS beneficiary_name TEXT,
  ADD COLUMN IF NOT EXISTS beneficiary_account TEXT;

ALTER TABLE public.user_beneficiaries
  DROP CONSTRAINT IF EXISTS user_beneficiaries_user_id_beneficiary_id_type_key;

ALTER TABLE public.user_beneficiaries
  ADD CONSTRAINT user_beneficiaries_user_id_beneficiary_id_type_key
  UNIQUE (user_id, beneficiary_id, beneficiary_type);

ALTER TABLE public.user_beneficiaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_own_beneficiaries" ON public.user_beneficiaries;
CREATE POLICY "users_own_beneficiaries" ON public.user_beneficiaries
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
