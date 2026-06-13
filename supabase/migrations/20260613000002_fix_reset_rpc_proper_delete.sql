-- ============================================================
-- Migration: fix_reset_rpc_proper_delete
-- إصلاح دالة reset_all_operational_data
-- ============================================================
-- المشكلة السابقة:
--   FOREACH v_table IN ARRAY ... EXECUTE 'DELETE FROM %I WHERE id != %L'
--   → account_balances له PK = account_id وليس id
--     → لا يُحذف أي صف من account_balances مطلقاً
--   → sync_queue له id عدد صحيح وليس UUID
--     → المقارنة مع '00000000-...' لا تحذف شيئاً
--
-- الإصلاح:
--   DELETE مباشر لكل جدول دون WHERE زائفة، بالترتيب الصحيح للـ FK.
-- ============================================================

CREATE OR REPLACE FUNCTION public.reset_all_operational_data()
  RETURNS TEXT
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN

  -- التحقق من الجلسة
  IF auth.role() != 'authenticated' THEN
    RAISE EXCEPTION 'غير مصرح — يجب تسجيل الدخول';
  END IF;

  -- التحقق من دور المدير
  IF NOT EXISTS (
    SELECT 1 FROM public.users
    WHERE id = v_uid AND role = 'admin' AND is_active = true
  ) THEN
    RAISE EXCEPTION 'غير مصرح — هذه العملية تتطلب صلاحية مدير';
  END IF;

  -- ─────────────────────────────────────────────────────────
  -- الحذف بالترتيب الصحيح للـ FK
  -- الجداول الفرعية أولاً ثم الرئيسية
  -- ─────────────────────────────────────────────────────────

  -- WHERE true يتجاوز pg_safeupdate (امتداد Supabase الذي يمنع DELETE بدون WHERE)
  -- ملاحظة: sync_queue جدول Dexie محلي فقط — غير موجود في Supabase

  -- 1. دفتر الأستاذ (يشير إلى transactions)
  DELETE FROM public.account_ledger             WHERE true;

  -- 2. الأرصدة التراكمية — PK = account_id (ليس id)
  DELETE FROM public.account_balances           WHERE true;

  -- 3. الإقفالات اليومية
  DELETE FROM public.daily_closings             WHERE true;

  -- 4. الإيداعات الفاشلة
  DELETE FROM public.failed_deposits            WHERE true;

  -- 5. الإشعارات
  DELETE FROM public.notifications              WHERE true;

  -- 6. سجل التدقيق
  DELETE FROM public.audit_logs                 WHERE true;

  -- 7. كلمات المرور المؤقتة للدخول السريع
  DELETE FROM public.quick_login_temp_passwords WHERE true;

  -- 8. المعاملات الرئيسية (آخراً لأن account_ledger يشير إليها)
  DELETE FROM public.transactions               WHERE true;

  -- جداول اختيارية (قد لا توجد في جميع البيئات)
  BEGIN DELETE FROM public.transfer_requests WHERE true;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  BEGIN DELETE FROM public.sync_queue WHERE true;
  EXCEPTION WHEN undefined_table THEN NULL; END;

  -- ─────────────────────────────────────────────────────────
  -- سجل التدقيق (يبقى حتى إعادة الضبط التالية)
  -- ─────────────────────────────────────────────────────────
  INSERT INTO public.audit_logs
    (id, user_id, action, record_type, record_id, timestamp)
  VALUES
    (gen_random_uuid(), v_uid, 'delete', 'system', 'reset_all_operational_data', NOW());

  RETURN 'OK';
END;
$$;

GRANT EXECUTE ON FUNCTION public.reset_all_operational_data() TO authenticated;

COMMENT ON FUNCTION public.reset_all_operational_data() IS
  'يحذف البيانات التشغيلية فقط بالترتيب الصحيح للـ FK. يتحقق من PK الصحيح لكل جدول.
   الجداول المحذوفة: account_ledger, account_balances, daily_closings, failed_deposits,
   notifications, audit_logs, sync_queue, quick_login_temp_passwords, transactions, transfer_requests.
   المحفوظة: users, bank_accounts, companies, system_settings, debtors, quick_login_tokens.';
