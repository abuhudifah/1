-- FIX: account_prefix هو بادئة تصنيفية (COM, AGT, BNK) وليس معرفاً فريداً.
-- جميع شركات النظام ستحصل على البادئة 'COM'، لذا يجب إزالة قيد UNIQUE.
ALTER TABLE public.companies DROP CONSTRAINT IF EXISTS companies_account_prefix_key;
