-- ============================================================
-- Migration: phase_r1_device_registry_and_reversal
-- إعادة الهيكلة — المرحلة 1: أساس قاعدة البيانات
-- ============================================================
-- 1) سجلّ الأجهزة (user_devices): سجلّ + إلغاء فقط، بلا أسرار.
--    يدعم «الأجهزة النشطة» والإلغاء عن بُعد في نموذج المصادقة الجديد
--    (الجلسة المشفّرة محليّاً).
-- 2) عمود reverses_id على transactions: للقيد العكسي (تصحيح
--    المعاملات النهائية بقيد جديد بدل التعديل).
-- ============================================================

-- ─────────────────────────────────────────────────────────
-- SECTION 1: جدول سجلّ الأجهزة
-- ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_devices (
  device_id    TEXT        PRIMARY KEY,
  user_id      UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  label        TEXT,
  user_agent   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_user_devices_user ON public.user_devices (user_id);

ALTER TABLE public.user_devices ENABLE ROW LEVEL SECURITY;

-- المستخدم يدير أجهزته فقط؛ المدير يرى الكل
DROP POLICY IF EXISTS user_devices_self ON public.user_devices;
CREATE POLICY user_devices_self ON public.user_devices
  FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public.is_admin())
  WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- ─────────────────────────────────────────────────────────
-- SECTION 2: تسجيل الجهاز (يُستدعى عند الدخول الكامل بالبريد)
-- يُنشئ/يُحدّث الصف ويُلغي أي إلغاء سابق (المستخدم أعاد المصادقة).
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_device(
  p_device_id  TEXT,
  p_label      TEXT DEFAULT NULL,
  p_user_agent TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'غير مصرح — يجب تسجيل الدخول';
  END IF;

  INSERT INTO public.user_devices (device_id, user_id, label, user_agent, last_seen_at, revoked_at)
  VALUES (p_device_id, v_uid, p_label, p_user_agent, now(), NULL)
  ON CONFLICT (device_id) DO UPDATE
    SET last_seen_at = now(),
        label        = COALESCE(EXCLUDED.label, public.user_devices.label),
        user_agent   = COALESCE(EXCLUDED.user_agent, public.user_devices.user_agent),
        revoked_at   = NULL
  WHERE public.user_devices.user_id = v_uid;
END;
$$;
GRANT EXECUTE ON FUNCTION public.register_device(TEXT, TEXT, TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────
-- SECTION 3: تحديث آخر نشاط (يُستدعى عند الفتح السريع)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_device(p_device_id TEXT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  UPDATE public.user_devices
  SET last_seen_at = now()
  WHERE device_id = p_device_id AND user_id = auth.uid();
$$;
GRANT EXECUTE ON FUNCTION public.touch_device(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────
-- SECTION 4: إلغاء جهاز عن بُعد (المالك أو المدير)
-- ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.revoke_device(p_device_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'غير مصرح — يجب تسجيل الدخول';
  END IF;

  UPDATE public.user_devices
  SET revoked_at = now()
  WHERE device_id = p_device_id
    AND (user_id = v_uid OR public.is_admin());
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_device(TEXT) TO authenticated;

-- ─────────────────────────────────────────────────────────
-- SECTION 5: عمود القيد العكسي على transactions
-- ─────────────────────────────────────────────────────────
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS reverses_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_reverses ON public.transactions (reverses_id);

COMMENT ON COLUMN public.transactions.reverses_id IS
  'المعاملة التي يعكسها هذا القيد (تصحيح المعاملات النهائية بدل التعديل).';
