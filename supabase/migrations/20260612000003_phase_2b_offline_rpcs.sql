-- ============================================================
-- Migration: phase_2b_offline_rpcs
-- المرحلة 2B: دوال RPC لإدارة جلسات Offline
-- تاريخ الإنشاء: 2026-06-12
-- ============================================================
-- الجدول offline_sessions تم إنشاؤه بالفعل في Phase 0.
-- هنا نضيف فقط دوال RPC التي يستخدمها OfflineAuthService.js
-- ============================================================


-- ===========================================================
-- SECTION 1: create_offline_session
-- ينشئ أو يجدّد جلسة Offline لمستخدم وجهاز محددين
-- يستخدم UPSERT لضمان: جهاز واحد = جلسة واحدة نشطة
-- ===========================================================

CREATE OR REPLACE FUNCTION public.create_offline_session(
  p_user_id   UUID,
  p_device_id TEXT,
  p_pin_hash  TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session_id UUID;
BEGIN
  -- تحقق: المستخدم يُنشئ جلسته الخاصة فقط
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'غير مصرح: يمكن إنشاء جلسة للمستخدم الحالي فقط';
  END IF;

  -- UPSERT: إن وجدت جلسة لنفس الجهاز، يُجدَّد الـ hash والصلاحية
  INSERT INTO public.offline_sessions
    (user_id, device_id, pin_hash, is_active, expires_at)
  VALUES
    (p_user_id, p_device_id, p_pin_hash, true, NOW() + INTERVAL '90 days')
  ON CONFLICT (user_id, device_id) DO UPDATE
    SET pin_hash   = EXCLUDED.pin_hash,
        is_active  = true,
        expires_at = NOW() + INTERVAL '90 days',
        updated_at = NOW()
  RETURNING id INTO v_session_id;

  RETURN v_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_offline_session(UUID, TEXT, TEXT) TO authenticated;


-- ===========================================================
-- SECTION 2: verify_offline_session
-- يتحقق من صحة PIN hash لجلسة نشطة غير منتهية
-- يُستخدم عند وجود اتصال + JWT صالح
-- للتحقق بدون إنترنت: يتم محلياً في Dexie بـ OfflineAuthService
-- ===========================================================

CREATE OR REPLACE FUNCTION public.verify_offline_session(
  p_user_id   UUID,
  p_device_id TEXT,
  p_pin_hash  TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_valid BOOLEAN := false;
BEGIN
  SELECT true INTO v_valid
  FROM public.offline_sessions
  WHERE user_id   = p_user_id
    AND device_id = p_device_id
    AND pin_hash  = p_pin_hash
    AND is_active = true
    AND expires_at > NOW();

  IF v_valid THEN
    -- تسجيل آخر نشاط
    UPDATE public.offline_sessions
    SET updated_at = NOW()
    WHERE user_id = p_user_id AND device_id = p_device_id;
  END IF;

  RETURN COALESCE(v_valid, false);
END;
$$;

-- authenticated فقط — لا نمنح anon حتى لا يُفتح باب bruteforce على الخادم
GRANT EXECUTE ON FUNCTION public.verify_offline_session(UUID, TEXT, TEXT) TO authenticated;


-- ===========================================================
-- SECTION 3: end_offline_session
-- يُنهي جلسة Offline (يُعيّن is_active = false)
-- ===========================================================

CREATE OR REPLACE FUNCTION public.end_offline_session(
  p_user_id   UUID,
  p_device_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.offline_sessions
  SET is_active  = false,
      updated_at = NOW()
  WHERE user_id   = p_user_id
    AND device_id = p_device_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.end_offline_session(UUID, TEXT) TO authenticated;


-- ===========================================================
-- SECTION 4: save_webauthn_credential
-- يحفظ معرف بيانات اعتماد WebAuthn للجلسة
-- ===========================================================

CREATE OR REPLACE FUNCTION public.save_webauthn_credential(
  p_user_id       UUID,
  p_device_id     TEXT,
  p_credential_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF p_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'غير مصرح';
  END IF;

  UPDATE public.offline_sessions
  SET webauthn_credential_id = p_credential_id,
      updated_at             = NOW()
  WHERE user_id   = p_user_id
    AND device_id = p_device_id
    AND is_active = true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_webauthn_credential(UUID, TEXT, TEXT) TO authenticated;
