-- ============================================================
-- Migration: rls_financial_tables
-- تفعيل Row Level Security على الجداول المالية الخمسة:
--   transactions, account_ledger, account_balances,
--   bank_accounts, companies
--
-- القاعدة العامة:
--   • الوكيل (agent) يرى بياناته فقط
--   • المدير ومساعده (admin / admin_assistant) يريان كل شيء
--   • anon ← ممنوع نهائياً (لا توجد سياسة تمنحه شيئاً)
-- ============================================================


-- ===========================================================
-- SECTION 0: دالة is_admin()
-- تُعيد true إذا كان المستخدم الحالي admin أو admin_assistant
-- STABLE    : تُخزَّن مؤقتاً داخل الاستعلام الواحد
-- SECURITY DEFINER : تقرأ public.users بصلاحية المالك (تتجاوز RLS)
-- ===========================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id   = auth.uid()
      AND role IN ('admin', 'admin_assistant')
      AND is_active = true
  )
$$;

GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated;


-- ===========================================================
-- SECTION 1: فهارس الأداء
-- يجب إنشاؤها قبل تفعيل RLS لتسريع EXISTS و USING clauses
-- ===========================================================

-- transactions ← فلتر agent_id (SELECT / INSERT / UPDATE الخاص بالوكيل)
CREATE INDEX IF NOT EXISTS idx_transactions_agent_id
  ON public.transactions (agent_id);

-- transactions ← فلتر اليوم الحالي + النوع (سياسة السقف المالي)
CREATE INDEX IF NOT EXISTS idx_transactions_date_type_partial
  ON public.transactions (date, type)
  WHERE type IN ('deposit', 'bank_withdrawal');

-- account_ledger ← فلتر account_id بصيغة 'AGT_<uuid>'
CREATE INDEX IF NOT EXISTS idx_account_ledger_account_id
  ON public.account_ledger (account_id);

-- users ← تسريع is_admin() (id + role + is_active)
CREATE INDEX IF NOT EXISTS idx_users_id_role_active
  ON public.users (id, role)
  WHERE is_active = true;


-- ===========================================================
-- SECTION 2: جدول transactions
-- ===========================================================

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- حذف أي سياسات قديمة
DROP POLICY IF EXISTS "tx: admin full access"       ON public.transactions;
DROP POLICY IF EXISTS "tx: agent select own"        ON public.transactions;
DROP POLICY IF EXISTS "tx: agent select bank today" ON public.transactions;
DROP POLICY IF EXISTS "tx: agent insert own"        ON public.transactions;
DROP POLICY IF EXISTS "tx: agent update own"        ON public.transactions;
DROP POLICY IF EXISTS "tx: admin delete"            ON public.transactions;

-- ── SELECT ─────────────────────────────────────────────────

-- المدير / المساعد: يريان كل المعاملات
CREATE POLICY "tx: admin full access"
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- الوكيل: يرى معاملاته الخاصة (تاريخ أي يوم)
CREATE POLICY "tx: agent select own"
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (agent_id = auth.uid());

-- الوكيل: يرى كل إيداعات وسحوبات البنوك ليوم الحالي فقط
-- السبب: عرض بطاقات البنوك (BankAccountsComponent) + فحص السقف المالي (getDailyDepositsTotal)
-- يُعرِّض مبالغ وكلاء آخرين في نفس البنك — وهذا مقصود ومعتمد تصميمياً
CREATE POLICY "tx: agent select bank today"
  ON public.transactions
  FOR SELECT
  TO authenticated
  USING (
    date = CURRENT_DATE
    AND type IN ('deposit', 'bank_withdrawal')
  );

-- ── INSERT ──────────────────────────────────────────────────

-- الوكيل يُدرج فقط بـ agent_id = uid الخاص به
-- المدير يُدرج أي شيء
CREATE POLICY "tx: agent insert own"
  ON public.transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_admin()
    OR agent_id = auth.uid()
  );

-- ── UPDATE ──────────────────────────────────────────────────

-- الوكيل يُعدِّل فقط معاملاته (مطلوب للمزامنة: sync_status، synced_at)
CREATE POLICY "tx: agent update own"
  ON public.transactions
  FOR UPDATE
  TO authenticated
  USING (
    public.is_admin()
    OR agent_id = auth.uid()
  )
  WITH CHECK (
    public.is_admin()
    OR agent_id = auth.uid()
  );

-- ── DELETE ──────────────────────────────────────────────────

-- المدير فقط (الحذف الفعلي يمر عبر reset_all_operational_data RPC بـ SECURITY DEFINER)
CREATE POLICY "tx: admin delete"
  ON public.transactions
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ===========================================================
-- SECTION 3: جدول account_ledger
-- ===========================================================

ALTER TABLE public.account_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ledger: admin full access" ON public.account_ledger;
DROP POLICY IF EXISTS "ledger: agent select own"  ON public.account_ledger;
DROP POLICY IF EXISTS "ledger: admin insert"      ON public.account_ledger;
DROP POLICY IF EXISTS "ledger: admin update"      ON public.account_ledger;
DROP POLICY IF EXISTS "ledger: admin delete"      ON public.account_ledger;

-- ── SELECT ─────────────────────────────────────────────────

CREATE POLICY "ledger: admin full access"
  ON public.account_ledger
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- الوكيل يرى فقط قيوده الخاصة: account_id = 'AGT_<uid>'
CREATE POLICY "ledger: agent select own"
  ON public.account_ledger
  FOR SELECT
  TO authenticated
  USING (account_id = 'AGT_' || auth.uid()::text);

-- ── INSERT ──────────────────────────────────────────────────

-- المدير فقط يُدرج مباشرة
-- قيود الوكيل تُنشَأ server-side بواسطة RPC CREATE_TRANSACTION_WITH_ENTRIES
-- الذي يعمل بـ SECURITY DEFINER ويتجاوز RLS تلقائياً
CREATE POLICY "ledger: admin insert"
  ON public.account_ledger
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- ── UPDATE ──────────────────────────────────────────────────

CREATE POLICY "ledger: admin update"
  ON public.account_ledger
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── DELETE ──────────────────────────────────────────────────

CREATE POLICY "ledger: admin delete"
  ON public.account_ledger
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ===========================================================
-- SECTION 4: جدول account_balances
-- ===========================================================

ALTER TABLE public.account_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "balances: admin full access" ON public.account_balances;
DROP POLICY IF EXISTS "balances: agent select own"  ON public.account_balances;
DROP POLICY IF EXISTS "balances: admin insert"      ON public.account_balances;
DROP POLICY IF EXISTS "balances: admin update"      ON public.account_balances;
DROP POLICY IF EXISTS "balances: admin delete"      ON public.account_balances;

-- ── SELECT ─────────────────────────────────────────────────

CREATE POLICY "balances: admin full access"
  ON public.account_balances
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- الوكيل يرى فقط رصيده الخاص: account_id = 'AGT_<uid>'
CREATE POLICY "balances: agent select own"
  ON public.account_balances
  FOR SELECT
  TO authenticated
  USING (account_id = 'AGT_' || auth.uid()::text);

-- ── INSERT ──────────────────────────────────────────────────

-- المدير فقط (إنشاء حساب جديد)
-- التحديثات التلقائية بعد كل معاملة تمر عبر triggers SECURITY DEFINER
CREATE POLICY "balances: admin insert"
  ON public.account_balances
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

-- ── UPDATE ──────────────────────────────────────────────────

CREATE POLICY "balances: admin update"
  ON public.account_balances
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── DELETE ──────────────────────────────────────────────────

CREATE POLICY "balances: admin delete"
  ON public.account_balances
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ===========================================================
-- SECTION 5: جدول bank_accounts
-- ===========================================================

ALTER TABLE public.bank_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "banks: all authenticated select" ON public.bank_accounts;
DROP POLICY IF EXISTS "banks: admin insert"             ON public.bank_accounts;
DROP POLICY IF EXISTS "banks: admin update"             ON public.bank_accounts;
DROP POLICY IF EXISTS "banks: admin delete"             ON public.bank_accounts;

-- ── SELECT ─────────────────────────────────────────────────

-- كل المصادَقين يقرؤون (الوكيل والمدير)
-- التضييق بـ allowed_banks يتم client-side في BankAccountsComponent
CREATE POLICY "banks: all authenticated select"
  ON public.bank_accounts
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── INSERT / UPDATE / DELETE ────────────────────────────────

CREATE POLICY "banks: admin insert"
  ON public.bank_accounts
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "banks: admin update"
  ON public.bank_accounts
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "banks: admin delete"
  ON public.bank_accounts
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ===========================================================
-- SECTION 6: جدول companies
-- ===========================================================

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "companies: all authenticated select" ON public.companies;
DROP POLICY IF EXISTS "companies: admin insert"             ON public.companies;
DROP POLICY IF EXISTS "companies: admin update"             ON public.companies;
DROP POLICY IF EXISTS "companies: admin delete"             ON public.companies;

-- ── SELECT ─────────────────────────────────────────────────

-- كل المصادَقين يقرؤون (الوكيل يحتاج اسم الشركة في عرض المعاملات)
CREATE POLICY "companies: all authenticated select"
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ── INSERT / UPDATE / DELETE ────────────────────────────────

CREATE POLICY "companies: admin insert"
  ON public.companies
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

CREATE POLICY "companies: admin update"
  ON public.companies
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE POLICY "companies: admin delete"
  ON public.companies
  FOR DELETE
  TO authenticated
  USING (public.is_admin());


-- ===========================================================
-- SECTION 7: استعلامات التحقق
-- ===========================================================

-- 1. التحقق من تفعيل RLS على الجداول الخمسة
SELECT
  tablename,
  rowsecurity AS rls_enabled
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'transactions','account_ledger','account_balances',
    'bank_accounts','companies'
  )
ORDER BY tablename;

-- 2. عرض جميع السياسات المُنشأة
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
