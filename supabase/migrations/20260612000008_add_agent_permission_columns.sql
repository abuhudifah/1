-- Migration: أعمدة صلاحيات المندوب + تحديث generate_account_number
-- Applied via Supabase MCP on 2026-06-12

-- إضافة أعمدة الصلاحيات للمندوبين
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS allowed_companies TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_banks     TEXT[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS allowed_users     TEXT[] DEFAULT '{}';

-- تحديث دالة generate_account_number لصيغة PPPdddddd (بدون شرطة - للاستخدام الداخلي فقط)
CREATE OR REPLACE FUNCTION generate_account_number(entity_type TEXT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_seq INT;
  prefix   TEXT;
  padded   TEXT;
BEGIN
  IF    entity_type = 'user'    THEN prefix := 'AGT';
  ELSIF entity_type = 'company' THEN prefix := 'COM';
  ELSIF entity_type = 'bank'    THEN prefix := 'BNK';
  ELSE  RAISE EXCEPTION 'نوع غير معروف: %', entity_type;
  END IF;

  UPDATE account_sequences
     SET last_sequence = last_sequence + 1
   WHERE account_sequences.entity_type = generate_account_number.entity_type
  RETURNING last_sequence INTO next_seq;

  padded := LPAD(next_seq::TEXT, 6, '0');
  RETURN prefix || padded;
END;
$$;

-- دالة ترحيل الأرقام القديمة إلى الصيغة الجديدة (تُنفَّذ مرة واحدة)
CREATE OR REPLACE FUNCTION migrate_account_numbers()
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  migrated_users     INT := 0;
  migrated_companies INT := 0;
  migrated_banks     INT := 0;
  rec                RECORD;
  new_num            TEXT;
BEGIN
  FOR rec IN
    SELECT id, account_number FROM public.users
    WHERE account_number IS NOT NULL AND account_number ~ '^AGT-[0-9]+$'
  LOOP
    new_num := 'AGT' || LPAD(REGEXP_REPLACE(rec.account_number, '^AGT-', ''), 6, '0');
    UPDATE public.users SET account_number = new_num WHERE id = rec.id;
    migrated_users := migrated_users + 1;
  END LOOP;

  FOR rec IN
    SELECT id, account_number FROM public.companies
    WHERE account_number IS NOT NULL AND account_number ~ '^COM-[0-9]+$'
  LOOP
    new_num := 'COM' || LPAD(REGEXP_REPLACE(rec.account_number, '^COM-', ''), 6, '0');
    UPDATE public.companies SET account_number = new_num WHERE id = rec.id;
    migrated_companies := migrated_companies + 1;
  END LOOP;

  FOR rec IN
    SELECT id, account_number FROM public.bank_accounts
    WHERE account_number IS NOT NULL AND account_number ~ '^BNK-[0-9]+'
  LOOP
    new_num := 'BNK' || LPAD(REGEXP_REPLACE(rec.account_number, '^BNK-([0-9]+).*', '\1'), 6, '0');
    UPDATE public.bank_accounts SET account_number = new_num WHERE id = rec.id;
    migrated_banks := migrated_banks + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'migrated_users',     migrated_users,
    'migrated_companies', migrated_companies,
    'migrated_banks',     migrated_banks
  );
END;
$$;
