-- ============================================================
-- Migration: version_locking_and_ledger_idempotency
-- تاريخ الإنشاء: 2026-06-19
--
-- الهدف:
--   1. إعادة كتابة RPC create_transaction_with_entries لدعم:
--      أ) قبول UUID من العميل لكل قيد محاسبي (account_ledger.id)
--      ب) ON CONFLICT (id) DO NOTHING — أبوّة idempotency على مستوى القيد
--      ج) IF FOUND THEN — تحديث account_balances فقط إذا أُضيف القيد فعلاً
--         (يمنع مضاعفة الأرصدة عند إعادة المحاولة بعد الانقطاع)
--
-- الاعتماديات:
--   - account_ledger.id هو PRIMARY KEY (مُثبَّت من Phase 0)
--   - trg_increment_version موجود بالفعل على جداول الـ version (Phase 0)
--   - لا تغييرات في مخطط الجداول — DDL فقط على دالة RPC
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
  v_idempotency_key TEXT;
  v_existing_id     UUID;
  v_entry           JSONB;
  v_entry_id        UUID;
  v_result          JSONB;
BEGIN
  -- ================================================================
  -- 1. Idempotency على مستوى المعاملة (transaction)
  -- ================================================================
  v_idempotency_key := p_transaction->>'idempotency_key';

  IF v_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.transactions
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    IF FOUND THEN
      -- المعاملة موجودة بالفعل — نُعيد المعرف مباشرةً دون أي كتابة
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
    (p_transaction->>'id')::UUID,
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
    v_idempotency_key,
    p_transaction->>'type',
    (p_transaction->>'amount')::NUMERIC,
    COALESCE(p_transaction->>'currency', 'SAR'),
    (p_transaction->>'user_id')::UUID,
    (p_transaction->>'company_id')::UUID,
    (p_transaction->>'debtor_id')::UUID,
    (p_transaction->>'bank_account_id')::UUID,
    p_transaction->>'description',
    p_transaction->>'notes',
    (p_transaction->>'date')::DATE,
    p_transaction->>'reference_number',
    COALESCE(p_transaction->>'sync_status', 'synced'),
    COALESCE(
      (p_transaction->>'created_at')::TIMESTAMPTZ,
      NOW()
    ),
    NOW()
  );

  -- ================================================================
  -- 3. إدراج القيود المحاسبية مع idempotency على مستوى كل قيد
  -- ================================================================
  FOR v_entry IN SELECT * FROM jsonb_array_elements(p_entries) LOOP

    -- قبول UUID من العميل — ضمان idempotency عند إعادة المحاولة
    v_entry_id := COALESCE(
      (v_entry->>'id')::UUID,
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
    -- إذا وصل القيد مرتين (إعادة محاولة بعد انقطاع) — تجاهل بصمت
    ON CONFLICT (id) DO NOTHING;

    -- تحديث الرصيد فقط إذا أُدرج القيد فعلاً (FOUND = TRUE)
    -- يمنع مضاعفة الرصيد عند إعادة المحاولة
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
    WHERE idempotency_key = v_idempotency_key
    LIMIT 1;

    RETURN jsonb_build_object(
      'transaction_id', COALESCE(v_existing_id, v_transaction_id),
      'skipped',        true,
      'reason',         'unique_violation'
    );
END;
$$;

-- منح الصلاحية لحسابات المصادقة
GRANT EXECUTE ON FUNCTION public.create_transaction_with_entries(JSONB, JSONB) TO authenticated;

-- ============================================================
-- تعليق توثيقي على الدالة
-- ============================================================
COMMENT ON FUNCTION public.create_transaction_with_entries(JSONB, JSONB) IS
'RPC ذري لإنشاء معاملة مالية مع قيودها المحاسبية.
الضمانات:
  - Idempotency على مستوى المعاملة: idempotency_key يمنع التكرار
  - Idempotency على مستوى كل قيد: account_ledger.id → ON CONFLICT DO NOTHING
  - تحديث account_balances مشروط بـ FOUND (لا مضاعفة عند إعادة المحاولة)
  - يُعيد {transaction_id, skipped, reason?} دائماً
';
