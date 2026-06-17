-- السماح لجميع المستخدمين المصادق عليهم بإضافة مدينين
-- التحقق من الاسم الثلاثي يتم على مستوى التطبيق (DataEntryComponent)

-- حذف السياسة القديمة التي تقصر الإضافة على المدير
DROP POLICY IF EXISTS "admins can insert debtors" ON public.debtors;

-- سياسة جديدة: أي مستخدم مصادق عليه يمكنه إضافة مدين
CREATE POLICY "authenticated can insert debtors"
  ON public.debtors
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
