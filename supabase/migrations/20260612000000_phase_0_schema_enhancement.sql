-- ============================================================
-- Migration: phase_0_schema_enhancement
-- المرحلة 0: تحسين بنية قاعدة البيانات بشكل آمن وذكي
-- تاريخ الإنشاء: 2026-06-12
-- ============================================================

-- ===========================================================
-- SECTION 1: إضافة أعمدة Offline إلى جدول transactions
-- ===========================================================

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS idempotency_key  UUID,
  ADD COLUMN IF NOT EXISTS device_id        TEXT,
  ADD COLUMN IF NOT EXISTS local_timestamp  TIMESTAMPTZ;

-- Index جزئي: فريد فقط عندما تكون القيمة غير فارغة
-- يمنع إعادة إرسال نفس العملية من نفس الجهاز عند الـ sync
CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_idempotency_key
  ON public.transactions (idempotency_key)
  WHERE idempotency_key IS NOT NULL;


-- ===========================================================
-- SECTION 2: القفل التفاؤلي (Optimistic Locking)
-- إضافة عمود version للجداول الحرجة
-- ===========================================================

ALTER TABLE public.users          ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.accounts       ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.bank_accounts  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.companies      ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.transactions   ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.debtors        ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE public.failed_deposits ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;

-- دالة عامة: تزيد version بمقدار 1 قبل كل UPDATE
CREATE OR REPLACE FUNCTION public.trg_increment_version()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  NEW.version := COALESCE(OLD.version, 0) + 1;
  RETURN NEW;
END;
$$;

-- تطبيق trigger الـ version على كل الجداول الحرجة (idempotent بـ DROP IF EXISTS)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','accounts','bank_accounts',
    'companies','transactions','debtors','failed_deposits'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_%I_increment_version ON public.%I',
      t, t
    );
    EXECUTE format(
      'CREATE TRIGGER trg_%I_increment_version
         BEFORE UPDATE ON public.%I
         FOR EACH ROW EXECUTE FUNCTION public.trg_increment_version()',
      t, t
    );
  END LOOP;
END;
$$;


-- ===========================================================
-- SECTION 3: جدول offline_sessions لإدارة جلسات Offline
-- ===========================================================

CREATE TABLE IF NOT EXISTS public.offline_sessions (
  id                     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  device_id              TEXT        NOT NULL,
  -- Hash يحتوي على salt مدمج (bcrypt / argon2id) — لا نخزن PIN بالنص الواضح أبداً
  pin_hash               TEXT,
  -- معرف بيانات اعتماد WebAuthn (Passkey) إن وُجدت
  webauthn_credential_id TEXT,
  expires_at             TIMESTAMPTZ NOT NULL,
  is_active              BOOLEAN     NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- جهاز واحد = جلسة واحدة نشطة لكل مستخدم
  CONSTRAINT uq_offline_sessions_user_device UNIQUE (user_id, device_id)
);

-- updated_at تلقائي
DROP TRIGGER IF EXISTS trg_offline_sessions_updated_at ON public.offline_sessions;
CREATE TRIGGER trg_offline_sessions_updated_at
  BEFORE UPDATE ON public.offline_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- RLS: كل مستخدم يرى ويعدّل جلساته فقط
ALTER TABLE public.offline_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "offline_sessions: own sessions only" ON public.offline_sessions;
CREATE POLICY "offline_sessions: own sessions only"
  ON public.offline_sessions
  FOR ALL
  TO authenticated
  USING  (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Index لتسريع البحث عن الجلسات النشطة
CREATE INDEX IF NOT EXISTS idx_offline_sessions_user_active
  ON public.offline_sessions (user_id, is_active)
  WHERE is_active = true;


-- ===========================================================
-- SECTION 4: تحسين سجل التدقيق (Lightweight Smart Audit Log)
-- ===========================================================

-- 4a: إضافة عمود changed_fields إلى جدول audit_logs
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS changed_fields JSONB;

-- 4b: استبدال دالة الـ Trigger بنسخة ذكية تسجّل الفروقات فقط
--
-- آلية التوفير:
--   بدلاً من حفظ الصف كاملاً مرتين (old + new)، تقارن الدالة
--   كل حقل بحقله، وتبني كائن JSONB يحتوي فقط على:
--     { "اسم_الحقل": { "old": القيمة_القديمة, "new": القيمة_الجديدة } }
--   مثال: تعديل رصيد فقط → { "balance": { "old": 1000, "new": 800 } }
--   توفير ~97% في حجم كل سجل مقارنة بحفظ الصف كاملاً.
CREATE OR REPLACE FUNCTION public.trg_write_audit_log()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
DECLARE
  v_changed JSONB   := '{}';
  v_old     JSONB;
  v_new     JSONB;
  v_key     TEXT;
  -- أعمدة تشغيلية/نظامية: لا قيمة في تتبعها بسجل التدقيق
  v_skip    TEXT[]  := ARRAY[
    'version', 'updated_at', 'last_updated',
    'sync_status', 'last_login', 'created_at'
  ];
BEGIN

  -- ── UPDATE: سجّل الحقول المتغيرة فقط ──────────────────────
  IF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);

    FOR v_key IN
      SELECT key FROM jsonb_each(v_new)
      WHERE key != ALL(v_skip)
    LOOP
      IF (v_old -> v_key) IS DISTINCT FROM (v_new -> v_key) THEN
        v_changed := v_changed || jsonb_build_object(
          v_key,
          jsonb_build_object(
            'old', v_old -> v_key,
            'new', v_new -> v_key
          )
        );
      END IF;
    END LOOP;

    -- إذا لم تتغير أي حقول جوهرية → لا نسجّل
    IF v_changed = '{}' THEN
      RETURN NEW;
    END IF;

    INSERT INTO public.audit_logs
      (id, user_id, action, record_type, record_id, changed_fields, timestamp)
    VALUES
      (gen_random_uuid(), auth.uid(), 'update',
       TG_TABLE_NAME, NEW.id::TEXT, v_changed, NOW());

    RETURN NEW;

  -- ── DELETE: احفظ لقطة كاملة للصف المحذوف للاسترجاع الجنائي ──
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_logs
      (id, user_id, action, record_type, record_id, changed_fields, timestamp)
    VALUES
      (gen_random_uuid(), auth.uid(), 'delete',
       TG_TABLE_NAME, OLD.id::TEXT,
       jsonb_build_object('_snapshot', to_jsonb(OLD)),
       NOW());

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

-- 4c: إضافة Audit Triggers للجداول التي كانت ناقصة (companies, accounts)
DROP TRIGGER IF EXISTS trg_companies_audit_update ON public.companies;
CREATE TRIGGER trg_companies_audit_update
  AFTER UPDATE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_write_audit_log();

DROP TRIGGER IF EXISTS trg_companies_audit_delete ON public.companies;
CREATE TRIGGER trg_companies_audit_delete
  AFTER DELETE ON public.companies
  FOR EACH ROW EXECUTE FUNCTION public.trg_write_audit_log();

DROP TRIGGER IF EXISTS trg_accounts_audit_update ON public.accounts;
CREATE TRIGGER trg_accounts_audit_update
  AFTER UPDATE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_write_audit_log();

DROP TRIGGER IF EXISTS trg_accounts_audit_delete ON public.accounts;
CREATE TRIGGER trg_accounts_audit_delete
  AFTER DELETE ON public.accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_write_audit_log();

-- 4d: GIN Index على changed_fields لتسريع الاستعلامات
CREATE INDEX IF NOT EXISTS idx_audit_logs_changed_fields
  ON public.audit_logs USING GIN (changed_fields);
