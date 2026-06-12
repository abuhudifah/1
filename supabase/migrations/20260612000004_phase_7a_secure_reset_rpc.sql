-- Migration: Phase 7A — تأمين إعادة ضبط البيانات
-- Creates reset_all_operational_data() RPC that deletes ONLY operational tables,
-- never touching users, settings, or company/bank configuration.

CREATE OR REPLACE FUNCTION public.reset_all_operational_data()
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  -- الجداول التشغيلية فقط — لا يُمس users أو system_settings أو companies أو bank_accounts أو debtors
  v_operational_tables TEXT[] := ARRAY[
    'transactions',
    'account_ledger',
    'account_balances',
    'daily_closings',
    'failed_deposits',
    'transfer_requests',
    'notifications',
    'audit_logs',
    'sync_queue'
  ];
  v_table TEXT;
BEGIN
  -- يُسمح للمدير فقط
  IF auth.role() != 'authenticated' THEN
    RAISE EXCEPTION 'غير مصرح — يجب تسجيل الدخول';
  END IF;

  -- التحقق من أن المستخدم له دور admin
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid() AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'غير مصرح — هذه العملية تتطلب صلاحية مدير';
  END IF;

  -- حذف البيانات التشغيلية فقط
  FOREACH v_table IN ARRAY v_operational_tables LOOP
    EXECUTE format(
      'DELETE FROM public.%I WHERE id != %L',
      v_table,
      '00000000-0000-0000-0000-000000000000'
    );
  END LOOP;

  -- تسجيل العملية في audit_logs (سيُحذف في المسح القادم، لكن يبقى للمراجعة الفورية)
  BEGIN
    INSERT INTO public.audit_logs
      (id, user_id, action, record_type, record_id, changed_fields, timestamp)
    VALUES
      (gen_random_uuid(), auth.uid(), 'delete', 'system', 'reset_all_operational_data',
       jsonb_build_object('tables', v_operational_tables), NOW());
  EXCEPTION WHEN OTHERS THEN
    -- فشل التسجيل لا يوقف العملية
    RAISE WARNING 'audit_log INSERT failed after reset: %', SQLERRM;
  END;

  RETURN 'OK';
END;
$$;

-- منح الصلاحية للمستخدمين الموثّقين (الفحص الداخلي يتحقق من دور admin)
GRANT EXECUTE ON FUNCTION public.reset_all_operational_data() TO authenticated;

COMMENT ON FUNCTION public.reset_all_operational_data() IS
  'يحذف البيانات التشغيلية فقط (transactions, ledger, closings, notifications...). لا يُمس users أو system_settings أو companies أو bank_accounts أو debtors.';
