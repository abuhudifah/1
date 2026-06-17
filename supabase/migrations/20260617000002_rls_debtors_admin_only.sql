-- Migration: 20260617000002_rls_debtors_admin_only
-- تقييد إدراج/تحديث/حذف جدول debtors للمدير فقط، مع السماح للجميع بالقراءة

-- ══════════════════════════════════════════════════════
-- تفعيل RLS على جدول debtors
-- ══════════════════════════════════════════════════════
ALTER TABLE public.debtors ENABLE ROW LEVEL SECURITY;

-- ══════════════════════════════════════════════════════
-- سياسة SELECT: جميع المستخدمين الموثوقين (للقراءة)
-- ══════════════════════════════════════════════════════
DROP POLICY IF EXISTS "debtors_select_authenticated" ON public.debtors;
CREATE POLICY "debtors_select_authenticated"
  ON public.debtors
  FOR SELECT
  TO authenticated
  USING (true);

-- ══════════════════════════════════════════════════════
-- سياسة INSERT: المدير فقط
-- ══════════════════════════════════════════════════════
DROP POLICY IF EXISTS "debtors_insert_admin" ON public.debtors;
CREATE POLICY "debtors_insert_admin"
  ON public.debtors
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ══════════════════════════════════════════════════════
-- سياسة UPDATE: المدير فقط
-- ══════════════════════════════════════════════════════
DROP POLICY IF EXISTS "debtors_update_admin" ON public.debtors;
CREATE POLICY "debtors_update_admin"
  ON public.debtors
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ══════════════════════════════════════════════════════
-- سياسة DELETE: المدير فقط
-- ══════════════════════════════════════════════════════
DROP POLICY IF EXISTS "debtors_delete_admin" ON public.debtors;
CREATE POLICY "debtors_delete_admin"
  ON public.debtors
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

-- ══════════════════════════════════════════════════════
-- استثناء update_debtor_balance: يُعدَّل رصيد المدين عبر RPC
-- (الدالة تعمل SECURITY DEFINER وتتجاوز RLS تلقائياً)
-- ══════════════════════════════════════════════════════
