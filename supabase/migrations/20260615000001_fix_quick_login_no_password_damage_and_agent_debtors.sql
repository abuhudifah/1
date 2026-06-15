-- ============================================================
-- Migration: fix_quick_login_no_password_damage_and_agent_debtors
-- تاريخ: 2026-06-15
-- ============================================================
-- يعالج هذا الملف ثلاث مشاكل:
--
--  (1) خطأ 23505 في الدخول السريع:
--      كانت quick_login_with_token تُدرج صفّاً في
--      quick_login_temp_passwords بلا ON CONFLICT، بينما الجدول
--      يحمل قيد UNIQUE(user_id, device_id). فينجح أول دخول سريع
--      على الجهاز ثم تفشل كل المحاولات اللاحقة بـ duplicate key
--      → تتراجع المعاملة بالكامل → "المعادلة غير صحيحة".
--
--  (2) إتلاف كلمة مرور البريد:
--      كانت الدالة تستبدل auth.users.encrypted_password بكلمة
--      مؤقتة عشوائية في كل دخول سريع ولا تُعيدها أبداً، فيتعذّر
--      بعدها الدخول بالبريد/كلمة المرور.
--      الحل: نحفظ الهاش الأصلي قبل الاستبدال، ونضيف دالة
--      quick_login_restore_password() يستدعيها العميل فور نجاح
--      إنشاء الجلسة لإعادة الهاش الأصلي. مع علامة temp_active
--      لمنع التقاط كلمة مؤقتة على أنها "الأصلية" عند تكرار الدخول.
--
--  (3) تعارض مزامنة العملاء (debtors):
--      لا توجد سياسة RLS تسمح للمندوب (agent) بإدراج عميل، فيُرفض
--      العميل المُنشأ دون اتصال، ثم تفشل المعاملة المرتبطة بقيد
--      transactions_customer_id_fkey. نضيف سياسة INSERT للمندوب
--      النشط بشرط أن يُسند العميل لنفسه (assigned_agents ? uid).
-- ============================================================


-- ============================================================
-- SECTION 0: توثيق القيد الفريد (موجود في القاعدة الحيّة، مفقود من الـ migrations)
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quick_login_temp_passwords_user_id_device_id_key'
  ) THEN
    ALTER TABLE public.quick_login_temp_passwords
      ADD CONSTRAINT quick_login_temp_passwords_user_id_device_id_key
      UNIQUE (user_id, device_id);
  END IF;
END $$;


-- ============================================================
-- SECTION 1: أعمدة حفظ/استعادة كلمة المرور
-- ============================================================
ALTER TABLE public.quick_login_temp_passwords
  ADD COLUMN IF NOT EXISTS prev_encrypted_password TEXT,
  ADD COLUMN IF NOT EXISTS temp_active BOOLEAN NOT NULL DEFAULT false;


-- ============================================================
-- SECTION 2: quick_login_with_token — إصلاح 23505 + حفظ كلمة المرور الأصلية
-- ============================================================
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
  v_token_rec       public.quick_login_tokens%ROWTYPE;
  v_user_rec        public.users%ROWTYPE;
  v_new_token       TEXT := gen_random_uuid()::TEXT;
  v_temp_password   TEXT := encode(extensions.gen_random_bytes(16), 'hex');
  v_existing_prev   TEXT;
  v_existing_active BOOLEAN;
  v_current_pw      TEXT;
  v_prev_to_keep    TEXT;
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

  -- 4. تحديد كلمة المرور الأصلية الواجب حفظها لاستعادتها لاحقاً
  --    إن كانت هناك كلمة مؤقتة فعّالة لم تُستعَد بعد (temp_active)، نُبقي
  --    الهاش الأصلي المحفوظ مسبقاً؛ وإلا فالهاش الحالي هو الأصلي.
  SELECT prev_encrypted_password, temp_active
    INTO v_existing_prev, v_existing_active
  FROM public.quick_login_temp_passwords
  WHERE user_id = v_user_rec.id AND device_id = p_device_id;

  SELECT encrypted_password INTO v_current_pw
  FROM auth.users WHERE id = v_user_rec.id;

  IF COALESCE(v_existing_active, false) THEN
    v_prev_to_keep := v_existing_prev;
  ELSE
    v_prev_to_keep := v_current_pw;
  END IF;

  -- 5. تعيين كلمة مرور مؤقتة في auth.users
  UPDATE auth.users
  SET encrypted_password = extensions.crypt(v_temp_password, extensions.gen_salt('bf'))
  WHERE id = v_user_rec.id;

  -- 6. حفظ/تحديث صفّ التدقيق مع الهاش الأصلي (Upsert يعالج 23505)
  INSERT INTO public.quick_login_temp_passwords
    (user_id, device_id, prev_encrypted_password, temp_active, used_at)
  VALUES
    (v_user_rec.id, p_device_id, v_prev_to_keep, true, NOW())
  ON CONFLICT (user_id, device_id) DO UPDATE
    SET prev_encrypted_password = EXCLUDED.prev_encrypted_password,
        temp_active             = true,
        used_at                 = NOW();

  -- 7. Token Rotation
  UPDATE public.quick_login_tokens
  SET is_active = false, used_at = NOW()
  WHERE id = v_token_rec.id;

  INSERT INTO public.quick_login_tokens
    (user_id, token, equation_hash, device_id, expires_at, is_active)
  VALUES
    (v_user_rec.id, v_new_token, v_token_rec.equation_hash,
     p_device_id, v_token_rec.expires_at, true);

  -- 8. سجل التدقيق
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

  -- 9. الإعادة
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


-- ============================================================
-- SECTION 3: استعادة كلمة المرور الأصلية بعد إنشاء الجلسة
-- يستدعيها العميل (وهو مُصادَق بـ JWT) فور نجاح signInWithPassword.
-- تحديث encrypted_password مباشرةً عبر SQL لا يُبطل الجلسة الحالية.
-- ============================================================
CREATE OR REPLACE FUNCTION public.quick_login_restore_password()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_prev TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'لا توجد جلسة');
  END IF;

  SELECT prev_encrypted_password INTO v_prev
  FROM public.quick_login_temp_passwords
  WHERE user_id = v_uid
    AND temp_active = true
    AND prev_encrypted_password IS NOT NULL
  ORDER BY used_at DESC
  LIMIT 1;

  IF v_prev IS NULL THEN
    RETURN jsonb_build_object('success', true, 'restored', false);
  END IF;

  UPDATE auth.users
  SET encrypted_password = v_prev
  WHERE id = v_uid;

  UPDATE public.quick_login_temp_passwords
  SET temp_active = false
  WHERE user_id = v_uid AND temp_active = true;

  RETURN jsonb_build_object('success', true, 'restored', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.quick_login_restore_password() TO authenticated;


-- ============================================================
-- SECTION 4: السماح للمندوب (agent) بإنشاء عملاء (debtors)
-- بشرط أن يُسند العميل لنفسه — متوافق مع سياسة SELECT الحالية
-- ومع سلوك العميل (assigned_agents = [uid]).
-- ============================================================
DROP POLICY IF EXISTS debtors_agent_insert ON public.debtors;
CREATE POLICY debtors_agent_insert ON public.debtors
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.users
      WHERE users.id = auth.uid()
        AND users.role = 'agent'
        AND users.is_active = true
    )
    AND assigned_agents ? (auth.uid())::text
  );
