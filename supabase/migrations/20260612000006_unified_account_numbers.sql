-- Migration 006: توحيد أرقام الحسابات بالصيغة الموحدة
-- التاريخ: 2026-06-12
-- الوصف: تحديث الأرقام القديمة (AGT-, COM-, رقم بنكي خام)
--         إلى الصيغة الموحدة (USR-, ADM-, CMP-, BNK-XXXXXX-YY)
--
-- ملاحظات:
-- * لا تُعدَّل الأرقام التي تبدأ بالبادئات الصحيحة بالفعل
-- * الحساب البنكي يأخذ أرقام الشركة المالكة + تسلسل (01, 02, ...)
-- * قيود UNIQUE لـ users/companies موجودة مسبقاً؛ يُضاف القيد لـ bank_accounts فقط

-- ============================================
-- 1. تحديث أرقام المستخدمين (users)
--    AGT-0001 → ADM-XXXXXX  (admin / admin_assistant)
--    AGT-0002 → USR-XXXXXX  (agent)
-- ============================================
UPDATE users
SET account_number = CONCAT(
  CASE WHEN role IN ('admin', 'admin_assistant') THEN 'ADM-' ELSE 'USR-' END,
  LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0')
)
WHERE account_number IS NULL
   OR account_number = ''
   OR (account_number NOT LIKE 'USR-%' AND account_number NOT LIKE 'ADM-%');

-- ============================================
-- 2. تحديث أرقام الشركات (companies)
--    COM-001 → CMP-XXXXXX
-- ============================================
UPDATE companies
SET account_number = CONCAT('CMP-', LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0'))
WHERE account_number IS NULL
   OR account_number = ''
   OR account_number NOT LIKE 'CMP-%';

-- ============================================
-- 3. تحديث أرقام الحسابات البنكية (bank_accounts)
--    BNK-XXXXXX-YY: أرقام الشركة + تسلسل ثنائي
--    يعمل بعد تحديث companies لضمان وجود CMP-XXXXXX
-- ============================================
DO $$
DECLARE
  bank_record      RECORD;
  company_digits   TEXT;
  bank_seq         TEXT;
  bank_count       INTEGER;
  current_comp_id  UUID;
BEGIN
  current_comp_id := NULL;
  bank_count      := 0;

  FOR bank_record IN
    SELECT id, company_id, created_at
    FROM   bank_accounts
    WHERE  account_number IS NULL
        OR account_number = ''
        OR account_number NOT LIKE 'BNK-______-__'
    ORDER  BY company_id, created_at
  LOOP
    -- شركة جديدة → إعادة التسلسل وجلب أرقامها
    IF current_comp_id IS DISTINCT FROM bank_record.company_id THEN
      current_comp_id := bank_record.company_id;
      bank_count      := 0;

      SELECT COALESCE(
               NULLIF(SPLIT_PART(account_number, '-', 2), ''),
               LPAD(FLOOR(RANDOM() * 900000 + 100000)::TEXT, 6, '0')
             )
        INTO company_digits
        FROM companies
       WHERE id = current_comp_id;
    END IF;

    bank_count := bank_count + 1;
    bank_seq   := LPAD(bank_count::TEXT, 2, '0');

    UPDATE bank_accounts
       SET account_number = CONCAT('BNK-', company_digits, '-', bank_seq)
     WHERE id = bank_record.id;
  END LOOP;
END $$;

-- ============================================
-- 4. UNIQUE على bank_accounts (users/companies لديهم قيود مسبقاً)
-- ============================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM information_schema.table_constraints
     WHERE table_name     = 'bank_accounts'
       AND constraint_type = 'UNIQUE'
       AND constraint_name LIKE '%account_number%'
  ) THEN
    ALTER TABLE bank_accounts
      ADD CONSTRAINT bank_accounts_account_number_unique
      UNIQUE (account_number);
  END IF;
END $$;

-- ============================================
-- 5. Indexes للبحث السريع (IF NOT EXISTS)
-- ============================================
CREATE INDEX IF NOT EXISTS idx_users_account_number
  ON users(account_number);

CREATE INDEX IF NOT EXISTS idx_companies_account_number
  ON companies(account_number);

CREATE INDEX IF NOT EXISTS idx_bank_accounts_account_number
  ON bank_accounts(account_number);

-- ============================================
-- 6. تقرير النتائج
-- ============================================
DO $$
DECLARE
  v_users     INT;
  v_companies INT;
  v_banks     INT;
BEGIN
  SELECT COUNT(*) INTO v_users
    FROM users
   WHERE account_number LIKE 'USR-%' OR account_number LIKE 'ADM-%';

  SELECT COUNT(*) INTO v_companies
    FROM companies
   WHERE account_number LIKE 'CMP-%';

  SELECT COUNT(*) INTO v_banks
    FROM bank_accounts
   WHERE account_number LIKE 'BNK-%-__';

  RAISE NOTICE '✅ Migration 006: اكتمل بنجاح';
  RAISE NOTICE '👤 المستخدمون (USR/ADM): %', v_users;
  RAISE NOTICE '🏢 الشركات (CMP): %',        v_companies;
  RAISE NOTICE '🏦 الحسابات البنكية (BNK): %', v_banks;
END $$;
