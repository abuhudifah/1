-- ============================================================
-- Migration: phase_2a_jwt_session_fix
-- المرحلة 2A: إصلاح JWT Session بعد quickLogin
-- تاريخ الإنشاء: 2026-06-12
-- ============================================================
-- الهدف: بعد التحقق من Token الدخول السريع، نولّد كلمة مرور
-- مؤقتة عشوائية ونحدّث auth.users.encrypted_password بها.
-- يُعيد الـ RPC هذه الكلمة المؤقتة للـ client الذي يستخدمها
-- في signInWithPassword للحصول على JWT حقيقي.
-- ============================================================

-- ===========================================================
-- SECTION 1: جدول مساعد للتدقيق (Audit-only — لا تُخزن كلمة مرور)
-- ===========================================================

CREATE TABLE IF NOT EXISTS public.quick_login_temp_passwords (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  used_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  device_id  TEXT
);

-- RLS: السجلات للقراءة من قِبل المدير فقط عبر Supabase Dashboard
ALTER TABLE public.quick_login_temp_passwords ENABLE ROW LEVEL SECURITY;

-- لا policy للـ authenticated — الكتابة تتم داخل SECURITY DEFINER RPC فقط
-- المدير يقرأها عبر service_role مباشرة

-- Index للتنظيف الدوري
CREATE INDEX IF NOT EXISTS idx_qlt_user_used
  ON public.quick_login_temp_passwords (user_id, used_at);


-- ===========================================================
-- SECTION 2: تعديل quick_login_with_token ليُعيد temp_password
-- ===========================================================

CREATE OR REPLACE FUNCTION public.quick_login_with_token(
  p_token     UUID,
  p_device_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
AS $$
DECLARE
  v_token_rec   public.quick_login_tokens%ROWTYPE;
  v_user_rec    public.users%ROWTYPE;
  v_new_token   UUID := gen_random_uuid();
  v_temp_password TEXT := encode(extensions.gen_random_bytes(16), 'hex');
BEGIN

  -- 1. جلب Token
  SELECT * INTO v_token_rec
  FROM public.quick_login_tokens
  WHERE token = p_token
    AND is_active = true
    AND expires_at > NOW()
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'انتهت صلاحية الدخول السريع أو Token غير صالح'
    );
  END IF;

  -- 2. التحقق من الجهاز
  IF v_token_rec.device_id IS DISTINCT FROM p_device_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'هذا الجهاز غير مصرح له باستخدام هذا Token'
    );
  END IF;

  -- 3. جلب بيانات المستخدم
  SELECT * INTO v_user_rec
  FROM public.users
  WHERE id = v_token_rec.user_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'المستخدم غير موجود أو تم تعطيله'
    );
  END IF;

  -- 4. تحديث كلمة المرور المؤقتة في auth.users
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(v_temp_password, extensions.gen_salt('bf'))
  WHERE id = v_user_rec.id;

  -- 5. تسجيل استخدام كلمة المرور المؤقتة (للتدقيق)
  INSERT INTO public.quick_login_temp_passwords (user_id, device_id)
  VALUES (v_user_rec.id, p_device_id);

  -- 6. Token Rotation: إلغاء القديم وإنشاء الجديد
  UPDATE public.quick_login_tokens
  SET is_active = false, used_at = NOW()
  WHERE id = v_token_rec.id;

  INSERT INTO public.quick_login_tokens
    (user_id, token, equation_hash, device_id, expires_at, is_active)
  VALUES
    (v_user_rec.id, v_new_token, v_token_rec.equation_hash,
     p_device_id, v_token_rec.expires_at, true);

  -- 7. تسجيل في audit_logs
  BEGIN
    INSERT INTO public.audit_logs
      (id, user_id, action, record_type, record_id, timestamp)
    VALUES
      (gen_random_uuid(), v_user_rec.id, 'quick_login',
       'users', v_user_rec.id::TEXT, NOW());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_log INSERT failed for quick_login user=%: %',
      v_user_rec.id, SQLERRM;
  END;

  -- 8. إعادة النتيجة مع temp_password و new_token
  RETURN jsonb_build_object(
    'success',       true,
    'temp_password', v_temp_password,
    'new_token',     v_new_token,
    'user', jsonb_build_object(
      'id',             v_user_rec.id,
      'username',       v_user_rec.username,
      'display_name',   v_user_rec.display_name,
      'role',           v_user_rec.role,
      'is_active',      v_user_rec.is_active,
      'allowed_tabs',   v_user_rec.allowed_tabs,
      'account_number', v_user_rec.account_number
    )
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.quick_login_with_token(UUID, TEXT) TO anon, authenticated;


-- ===========================================================
-- SECTION 3: دالة تنظيف سجلات كلمات المرور المؤقتة القديمة
-- ===========================================================

CREATE OR REPLACE FUNCTION public.cleanup_temp_passwords()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.quick_login_temp_passwords
  WHERE used_at < NOW() - INTERVAL '24 hours';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cleanup_temp_passwords() TO authenticated;
