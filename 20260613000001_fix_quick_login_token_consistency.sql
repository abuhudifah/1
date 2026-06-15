-- ============================================================
-- Migration: fix_quick_login_token_consistency
-- إصلاح تعارض أنواع Tokens بين create و quick_login_with_token
-- ============================================================
-- المشكلة:
--   • create_quick_login_token  كانت تولّد token بصيغة hex (64 حرفاً)
--   • quick_login_with_token    كانت تتوقع p_token UUID في migration-2
--   • نتج عن ذلك وجود نسختين متعارضتين للدالة:
--       (TEXT, TEXT) ← migration-1 — بلا temp_password
--       (UUID, TEXT) ← migration-2 — مع temp_password لكن تعارض في النوع
--   • الحل: توحيد النوع إلى TEXT مع UUID format
-- ============================================================


-- SECTION 1: حذف النسخة القديمة (TEXT, TEXT) التي لا تُعيد temp_password
DROP FUNCTION IF EXISTS public.quick_login_with_token(TEXT, TEXT);


-- SECTION 2: تحديث create_quick_login_token لاستخدام gen_random_uuid() بدلاً من hex
-- حتى يكون الـ token بصيغة UUID متوافقة مع quick_login_with_token(UUID, TEXT)

CREATE OR REPLACE FUNCTION public.create_quick_login_token(
  p_user_id       UUID,
  p_equation_hash TEXT,
  p_device_id     TEXT,
  p_expires_at    TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days')
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_token TEXT;
BEGIN
  IF p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'غير مصرح: يمكنك إنشاء tokens لحسابك فقط';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users WHERE id = p_user_id AND is_active = true
  ) THEN
    RAISE EXCEPTION 'المستخدم غير نشط';
  END IF;

  -- UUID بصيغة نصية (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx) ← متوافق مع (UUID, TEXT)
  v_token := gen_random_uuid()::TEXT;

  -- إلغاء Tokens النشطة القديمة لنفس المستخدم والجهاز
  UPDATE public.quick_login_tokens
  SET is_active = false
  WHERE user_id = p_user_id AND device_id = p_device_id AND is_active = true;

  INSERT INTO public.quick_login_tokens (user_id, token, equation_hash, device_id, expires_at)
  VALUES (p_user_id, v_token, p_equation_hash, p_device_id, p_expires_at);

  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_quick_login_token TO authenticated;


-- SECTION 3: تحديث quick_login_with_token لإعادة جميع أعمدة الصلاحيات
-- (النسخة المُعدَّلة من migration-2 + إضافة allowed_companies/banks/users)

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
  v_token_rec     public.quick_login_tokens%ROWTYPE;
  v_user_rec      public.users%ROWTYPE;
  v_new_token     TEXT := gen_random_uuid()::TEXT;
  v_temp_password TEXT := encode(extensions.gen_random_bytes(16), 'hex');
BEGIN

  -- 1. جلب Token وقفله
  SELECT * INTO v_token_rec
  FROM public.quick_login_tokens
  WHERE token = p_token::TEXT
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

  -- 3. جلب بيانات المستخدم الكاملة
  SELECT * INTO v_user_rec
  FROM public.users
  WHERE id = v_token_rec.user_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error',   'المستخدم غير موجود أو تم تعطيله'
    );
  END IF;

  -- 4. توليد كلمة مرور مؤقتة وتحديثها في auth.users
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(v_temp_password, extensions.gen_salt('bf'))
  WHERE id = v_user_rec.id;

  -- 5. تسجيل للتدقيق (بلا تخزين للكلمة ذاتها)
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

  -- 7. سجل التدقيق
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

  -- 8. الإعادة مع temp_password وجميع الصلاحيات
  RETURN jsonb_build_object(
    'success',       true,
    'temp_password', v_temp_password,
    'new_token',     v_new_token,
    'user', jsonb_build_object(
      'id',                  v_user_rec.id,
      'username',            v_user_rec.username,
      'display_name',        v_user_rec.display_name,
      'role',                v_user_rec.role,
      'is_active',           v_user_rec.is_active,
      'allowed_tabs',        v_user_rec.allowed_tabs,
      'account_number',      v_user_rec.account_number,
      'quick_equation_hash', v_user_rec.quick_equation_hash,
      'allowed_companies',   v_user_rec.allowed_companies,
      'allowed_banks',       v_user_rec.allowed_banks,
      'allowed_users',       v_user_rec.allowed_users
    )
  );

END;
$$;

GRANT EXECUTE ON FUNCTION public.quick_login_with_token(UUID, TEXT) TO anon, authenticated;


-- SECTION 4: إبطال Tokens القديمة بصيغة hex (64 حرفاً) — غير متوافقة مع النوع الجديد
UPDATE public.quick_login_tokens
SET is_active = false, used_at = NOW()
WHERE is_active = true
  AND used_at IS NULL
  AND LENGTH(token) = 64  -- hex format (لا يحتوي على شرطات UUID)
  AND token NOT LIKE '%-%';
