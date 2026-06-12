-- ============================================================
-- Migration: phase_1_quick_login_tokens
-- المرحلة 1.3: نظام Quick Login Token الآمن
-- ============================================================

-- SECTION 1: توسيع CHECK constraint لـ audit_logs.action
ALTER TABLE public.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_action_check;

ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check
  CHECK (action = ANY (ARRAY[
    'create'::text, 'update'::text, 'delete'::text, 'quick_login'::text
  ]));

-- SECTION 2: جدول quick_login_tokens
CREATE TABLE IF NOT EXISTS public.quick_login_tokens (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  token         TEXT        NOT NULL UNIQUE,
  equation_hash TEXT        NOT NULL,
  device_id     TEXT        NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NOT NULL,
  used_at       TIMESTAMPTZ,
  is_active     BOOLEAN     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_quick_login_tokens_token
  ON public.quick_login_tokens (token);

CREATE INDEX IF NOT EXISTS idx_quick_login_tokens_user_device
  ON public.quick_login_tokens (user_id, device_id);

CREATE INDEX IF NOT EXISTS idx_quick_login_tokens_active
  ON public.quick_login_tokens (expires_at)
  WHERE is_active = true AND used_at IS NULL;

ALTER TABLE public.quick_login_tokens ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "qlt: authenticated user owns" ON public.quick_login_tokens;
CREATE POLICY "qlt: authenticated user owns"
  ON public.quick_login_tokens
  FOR ALL TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- SECTION 3: RPC — create_quick_login_token
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
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id AND is_active = true) THEN
    RAISE EXCEPTION 'المستخدم غير نشط';
  END IF;
  v_token := encode(gen_random_bytes(32), 'hex');
  UPDATE public.quick_login_tokens
  SET is_active = false
  WHERE user_id = p_user_id AND device_id = p_device_id AND is_active = true;
  INSERT INTO public.quick_login_tokens (user_id, token, equation_hash, device_id, expires_at)
  VALUES (p_user_id, v_token, p_equation_hash, p_device_id, p_expires_at);
  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_quick_login_token TO authenticated;

-- SECTION 4: RPC — quick_login_with_token (مع Token Rotation)
CREATE OR REPLACE FUNCTION public.quick_login_with_token(
  p_token     TEXT,
  p_device_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_token_rec RECORD;
  v_user_rec  RECORD;
  v_new_token TEXT;
  v_validity  INTERVAL;
BEGIN
  SELECT * INTO v_token_rec
  FROM public.quick_login_tokens
  WHERE token = p_token AND device_id = p_device_id
    AND is_active = true AND used_at IS NULL AND expires_at > NOW();

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Token غير صالح أو منتهي الصلاحية');
  END IF;

  SELECT * INTO v_user_rec
  FROM public.users WHERE id = v_token_rec.user_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'المستخدم غير موجود أو معطل');
  END IF;

  UPDATE public.quick_login_tokens
  SET used_at = NOW(), is_active = false WHERE id = v_token_rec.id;

  v_new_token := encode(gen_random_bytes(32), 'hex');
  v_validity  := v_token_rec.expires_at - v_token_rec.created_at;
  INSERT INTO public.quick_login_tokens (user_id, token, equation_hash, device_id, expires_at)
  VALUES (v_user_rec.id, v_new_token, v_token_rec.equation_hash, p_device_id, NOW() + v_validity);

  BEGIN
    INSERT INTO public.audit_logs (id, user_id, action, record_type, record_id, changed_fields, timestamp)
    VALUES (gen_random_uuid(), v_user_rec.id, 'quick_login', 'users', v_user_rec.id::TEXT,
            jsonb_build_object('device_id', p_device_id, 'method', 'token'), NOW());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'audit_log INSERT failed for quick_login user=% : %', v_user_rec.id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'success', true, 'new_token', v_new_token,
    'user', jsonb_build_object(
      'id', v_user_rec.id, 'username', v_user_rec.username,
      'display_name', v_user_rec.display_name, 'role', v_user_rec.role,
      'is_active', v_user_rec.is_active, 'allowed_tabs', v_user_rec.allowed_tabs,
      'account_number', v_user_rec.account_number
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.quick_login_with_token TO anon;
GRANT EXECUTE ON FUNCTION public.quick_login_with_token TO authenticated;
