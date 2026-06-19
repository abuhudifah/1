-- ============================================================
-- Migration: rls_cleanup_legacy_policies
-- حذف السياسات القديمة المكررة أو المتعارضة مع migration 20260619000001
--
-- السياسة الحرجة المكتشفة:
--   transactions_agent_own (ALL) ← كانت تتيح للوكيل DELETE معاملاته
--   وهو ما يتعارض مع "tx: admin delete" الذي يحصر الحذف بالمدير فقط
-- ============================================================

-- ===========================================================
-- SECTION 1: جدول transactions
-- ===========================================================

-- حرج: هذه السياسة تتيح DELETE للوكيل على معاملاته (يكسر قيد admin-only delete)
DROP POLICY IF EXISTS "transactions_agent_own"      ON public.transactions;

-- مكررة: مغطاة بـ "tx: admin full access" + "tx: admin delete"
DROP POLICY IF EXISTS "transactions_admin_all"      ON public.transactions;

-- مكررة: مغطاة بـ "tx: admin full access" (is_admin() يشمل admin_assistant)
DROP POLICY IF EXISTS "transactions_assistant_select" ON public.transactions;


-- ===========================================================
-- SECTION 2: جدول account_ledger
-- ===========================================================

-- مكررة: مغطاة بـ ledger: admin insert/update/delete
DROP POLICY IF EXISTS "account_ledger_admin_all"        ON public.account_ledger;

-- مكررة: مغطاة بـ "ledger: agent select own"
DROP POLICY IF EXISTS "account_ledger_agent_select_own" ON public.account_ledger;

-- مكررة: مغطاة بـ "ledger: admin full access" (is_admin() يشمل admin_assistant)
DROP POLICY IF EXISTS "account_ledger_assistant_select" ON public.account_ledger;


-- ===========================================================
-- SECTION 3: جدول account_balances
-- ===========================================================

-- مكررة
DROP POLICY IF EXISTS "account_balances_admin_all"       ON public.account_balances;
DROP POLICY IF EXISTS "account_balances_agent_select_own" ON public.account_balances;
DROP POLICY IF EXISTS "account_balances_assistant_select" ON public.account_balances;


-- ===========================================================
-- SECTION 4: جدول bank_accounts
-- ===========================================================

-- مكررة
DROP POLICY IF EXISTS "bank_accounts_admin_all"      ON public.bank_accounts;
DROP POLICY IF EXISTS "bank_accounts_assistant_all"  ON public.bank_accounts;
DROP POLICY IF EXISTS "bank_accounts_agent_select_all" ON public.bank_accounts;


-- ===========================================================
-- SECTION 5: جدول companies
-- ===========================================================

-- مكررة
DROP POLICY IF EXISTS "companies_admin_write" ON public.companies;
DROP POLICY IF EXISTS "companies_all_select"  ON public.companies;


-- ===========================================================
-- SECTION 6: التحقق النهائي — السياسات الفعالة بعد التنظيف
-- ===========================================================
SELECT
  tablename,
  policyname,
  cmd,
  qual       AS using_expr,
  with_check AS check_expr
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'transactions','account_ledger','account_balances',
    'bank_accounts','companies'
  )
ORDER BY tablename, cmd, policyname;
