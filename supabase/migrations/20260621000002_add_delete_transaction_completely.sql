-- حذف معاملة بالكامل: يعكس أثر القيود على الأرصدة ثم يحذف القيود والمعاملة.
-- التفويض: المدير دائماً | المندوب لعملياته في نفس اليوم فقط.
CREATE OR REPLACE FUNCTION public.delete_transaction_completely(p_transaction_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_id  uuid := auth.uid();
  v_is_admin   boolean := public.is_admin();
  v_tx         RECORD;
  v_entry      RECORD;
  v_ledger_cnt integer := 0;
BEGIN
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'المعاملة غير موجودة';
  END IF;

  -- التفويض
  IF NOT v_is_admin THEN
    IF v_tx.agent_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'غير مصرح: يمكنك حذف عملياتك فقط';
    END IF;
    IF v_tx.date <> CURRENT_DATE THEN
      RAISE EXCEPTION 'غير مصرح: يمكن حذف عمليات اليوم الحالي فقط';
    END IF;
  END IF;

  -- عكس أثر كل قيد على الأرصدة ثم سيُحذف
  FOR v_entry IN
    SELECT account_id, debit, credit FROM public.account_ledger WHERE reference_id = p_transaction_id
  LOOP
    UPDATE public.account_balances
       SET balance = balance - v_entry.debit + v_entry.credit,
           last_updated = NOW()
     WHERE account_id = v_entry.account_id;
    v_ledger_cnt := v_ledger_cnt + 1;
  END LOOP;

  DELETE FROM public.account_ledger WHERE reference_id = p_transaction_id;
  DELETE FROM public.transactions   WHERE id = p_transaction_id;

  INSERT INTO public.audit_logs (user_id, action, record_type, record_id, old_value, new_value)
  VALUES (
    v_caller_id, 'delete', 'transaction', p_transaction_id::text,
    to_jsonb(v_tx),
    jsonb_build_object('deleted', true, 'ledger_entries_deleted', v_ledger_cnt)
  );

  RETURN jsonb_build_object(
    'success', true,
    'transaction_id', p_transaction_id,
    'ledger_entries_deleted', v_ledger_cnt
  );

EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'فشل حذف المعاملة: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_transaction_completely(uuid) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.delete_transaction_completely(uuid) TO authenticated;
