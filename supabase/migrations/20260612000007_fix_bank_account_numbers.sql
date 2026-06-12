-- Migration 007: تصحيح أرقام الحسابات البنكية
-- التاريخ: 2026-06-12
-- الوصف: فصل رقم الحساب الحقيقي (account_number) عن الرقم الداخلي (internal_account_number)
--
-- المشكلة: migration 006 كتب BNK-XXXXXX-YY في حقل account_number
--          لكن هذا الحقل يحتوي على الرقم الحقيقي للحساب في البنك.
--
-- الحل:
--   account_number          ← الرقم الحقيقي (IBAN / رقم الحساب البنكي)
--   internal_account_number ← الرقم الداخلي (BNK-XXXXXX-YY) للبحث والمعاملات الداخلية

-- ============================================
-- 1. إضافة حقل internal_account_number
-- ============================================
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS internal_account_number TEXT;

-- ============================================
-- 2. نقل BNK-XXXXXX-YY من account_number إلى internal_account_number
-- ============================================
UPDATE bank_accounts
   SET internal_account_number = account_number
 WHERE account_number LIKE 'BNK-%';

-- ============================================
-- 3. استعادة الأرقام الحقيقية في account_number
--    (القيم المُعادة مأخوذة من حالة قاعدة البيانات قبل migration 006)
--    المقبولي → 37000000062606
--    زغلول   → 27200001006609
--    فيصل    → BNK-001  (لم يكن له رقم IBAN حقيقي؛ يُعاد للقيمة الأصلية)
-- ============================================
UPDATE bank_accounts SET account_number = '37000000062606'
 WHERE id = '6f0cf8e7-3ec6-4a97-af59-601c9e3d8bcc';

UPDATE bank_accounts SET account_number = '27200001006609'
 WHERE id = '60c26121-d140-4af3-b72d-86ee5d1e450f';

UPDATE bank_accounts SET account_number = 'BNK-001'
 WHERE id = '1af5da19-9e6c-4378-b192-10a622cbc642';

-- ============================================
-- 4. Index على internal_account_number للبحث السريع
-- ============================================
CREATE INDEX IF NOT EXISTS idx_bank_accounts_internal_number
  ON bank_accounts(internal_account_number);

-- ============================================
-- 5. تقرير النتائج
-- ============================================
DO $$
DECLARE
  v_total   INT;
  v_with_internal INT;
BEGIN
  SELECT COUNT(*)                                        INTO v_total        FROM bank_accounts;
  SELECT COUNT(*) FILTER (WHERE internal_account_number IS NOT NULL)
                                                         INTO v_with_internal FROM bank_accounts;

  RAISE NOTICE '✅ Migration 007: تم فصل الأرقام الحقيقية عن الداخلية';
  RAISE NOTICE '📊 إجمالي الحسابات البنكية: %',     v_total;
  RAISE NOTICE '🔢 حسابات لها رقم داخلي: %',        v_with_internal;
END $$;
