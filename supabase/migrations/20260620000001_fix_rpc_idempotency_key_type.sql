-- ============================================================
-- Migration: fix_rpc_idempotency_key_type
-- تاريخ: 2026-06-20
--
-- المشكلة:
--   migrations/20260619000004 أعلن v_idempotency_key كـ TEXT
--   لكن transactions.idempotency_key نوعه UUID (Phase 0).
--   نتيجة: PostgreSQL يرفض "uuid = text" → خطأ 42883 عند كل batch sync.
--
-- الإصلاح:
--   تغيير إعلان المتغير إلى UUID + casting صريح عند الاستخراج من JSONB.
--   JSONB ->>'key' دائماً يُعيد TEXT، لذا نكتب ::UUID صراحةً.
--
-- الاعتماديات: 20260619000004_version_locking_and_ledger_idempotency
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_transaction_with_entries(
  p_transaction JSONB,
  p_entries     JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_transaction_id  UUID;
  v_idempotency_key UUID;   -- ✅ FIX: كان TEXT — يجب أن يكون UUID لمطابقة نوع العمود
  v_existing_id     UUID;
  v_entry           JSONB;
  v_entry_id        UUID;
BEGIN
  -- ================================================================
  -- 1. Idempotency على مستوى المعاملة (transaction)
  -- ================================================================

  -- ✅ FIX: JSONB ->>'key' يُعيد TEXT دائماً — نكتب ::UUID صراحةً
  -- NULLIF يُعيد NULL إذا كانت السلسلة فارغة → تجنب خطأ invalid UUID
  v_idempotency_key := NULLIF(p_transaction->>'idempotency_key', '')::UUID;

  IF v_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.transactions
    WHERE idempotency_key = v_idempotency_key  -- ✅ uuid = uuid → لا خطأ
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'transaction_id', v_existing_id,
        'skipped',        true,
        'reason',         'already_exists'
      );
    END IF;
  END IF;

  -- ================================================================
  -- 2. إدراج المعاملة المالية
  -- ================================================================
  v_transaction_id := COALESCE(
    NULLIF(p_transaction->>'id', '')::UUID,
    gen_random_uuid()
  );

  INSERT INTO public.transactions (
    id,
    idempotency_key,
    type,
    amount,
    currency,
    user_id,
    company_id,
    debtor_id,
    bank_account_id,
    description,
    notes,
    date,
    reference_number,
    sync_status,
    created_at,
    updated_at
  ) VALUES (
    v_transaction_id,
    v_idempotency_key,                                 -- ✅ uuid = uuid
    p_transaction->>'type',
    (p_transaction->>'amount')::NUMERIC,
    COALESCE(p_transaction->>'currency', 'SAR'),
    NULLIF(p_transaction->>'user_id',         '')::UUID,
    NULLIF(p_transaction->>'company_id',      '')::UUID,
    NULLIF(p_transaction->>'debtor_id',       '')::UUID,
    NULLIF(p_transaction->>'bank_account_id', '')::UUID,
    p_transaction->>'description',
    p_transaction->>'notes',
    (p_transaction->>'date')::DATE,
    p_transaction->>'reference_number',
    COALESCE(p_transaction->>'sync_status', 'synced'),
    COALESCE(
      NULLIF(p_transaction->>'created_at', '')::TIMESTAMPTZ,
      NOW()
    ),
    NOW()
  );

  -- ================================================================
  -- 3. إدراج القيود المحاسبية مع idempotency على مستوى كل قيد
  -- ================================================================
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP

    v_entry_id := COALESCE(
      NULLIF(v_entry->>'id', '')::UUID,
      gen_random_uuid()
    );

    INSERT INTO public.account_ledger (
      id,
      voucher_number,
      date,
      account_id,
      debit,
      credit,
      description,
      reference_id
    ) VALUES (
      v_entry_id,
      v_entry->>'voucher_number',
      (v_entry->>'date')::DATE,
      v_entry->>'account_id',
      COALESCE((v_entry->>'debit')::NUMERIC,  0),
      COALESCE((v_entry->>'credit')::NUMERIC, 0),
      v_entry->>'description',
      v_transaction_id
    )
    ON CONFLICT (id) DO NOTHING;

    IF FOUND THEN
      INSERT INTO public.account_balances (account_id, balance, last_updated)
      VALUES (
        v_entry->>'account_id',
        COALESCE((v_entry->>'debit')::NUMERIC, 0)
          - COALESCE((v_entry->>'credit')::NUMERIC, 0),
        NOW()
      )
      ON CONFLICT (account_id) DO UPDATE
        SET balance      = public.account_balances.balance
                           + COALESCE((v_entry->>'debit')::NUMERIC,  0)
                           - COALESCE((v_entry->>'credit')::NUMERIC, 0),
            last_updated = NOW();
    END IF;

  END LOOP;

  -- ================================================================
  -- 4. إعادة المعرف للعميل
  -- ================================================================
  RETURN jsonb_build_object(
    'transaction_id', v_transaction_id,
    'skipped',        false
  );

EXCEPTION
  WHEN unique_violation THEN
    -- 23505: المعاملة موجودة بالفعل عبر مسار آخر
    SELECT id INTO v_existing_id
    FROM public.transactions
    WHERE idempotency_key = v_idempotency_key   -- ✅ uuid = uuid
    LIMIT 1;

    RETURN jsonb_build_object(
      'transaction_id', COALESCE(v_existing_id, v_transaction_id),
      'skipped',        true,
      'reason',         'unique_violation'
    );

  WHEN invalid_text_representation THEN
    -- 22P02: قيمة غير صالحة للـ UUID (حماية من بيانات تالفة)
    RETURN jsonb_build_object(
      'transaction_id', NULL,
      'skipped',        true,
      'reason',         'invalid_uuid_format'
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_transaction_with_entries(JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.create_transaction_with_entries(JSONB, JSONB) IS
'RPC ذري لإنشاء معاملة مالية مع قيودها المحاسبية.
v2 (2026-06-20): إصلاح نوع v_idempotency_key من TEXT إلى UUID
  → يمنع خطأ 42883 (operator does not exist: uuid = text)
  → يمنع تحذير 42804 (implicit coercion from text to uuid)
الضمانات:
  - Idempotency على مستوى المعاملة: idempotency_key (UUID) يمنع التكرار
  - Idempotency على مستوى كل قيد: account_ledger.id → ON CONFLICT DO NOTHING
  - تحديث account_balances مشروط بـ FOUND (لا مضاعفة عند إعادة المحاولة)
  - NULLIF(..., '') لكل UUID field → تجنب خطأ 22P02 عند القيم الفارغة
';
