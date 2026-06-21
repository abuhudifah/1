-- Fix perform_period_close: fold ALL data up to p_period_end (not just within [start, end]).
-- Previously the BETWEEN clause caused double-counting when data existed before p_period_start.
-- New behaviour: delete everything <= p_period_end, insert one opening-balance entry per account.

CREATE OR REPLACE FUNCTION public.perform_period_close(
  p_period_start date,
  p_period_end   date,
  p_notes        text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_caller_role   text;
  v_caller_id     uuid;
  v_closing_id    uuid;
  v_tx_count      integer;
  v_ledger_count  integer;
  v_ob_voucher    text;
  v_account_rec   record;
BEGIN
  -- التحقق من صلاحيات المدير فقط
  v_caller_id := auth.uid();
  SELECT role INTO v_caller_role FROM users WHERE id = v_caller_id;
  IF v_caller_role != 'admin' THEN
    RAISE EXCEPTION 'الإقفال مسموح للمدير فقط';
  END IF;

  -- التحقق من صحة التاريخ
  IF p_period_start > p_period_end THEN
    RAISE EXCEPTION 'تاريخ البداية يجب أن يكون قبل تاريخ النهاية';
  END IF;

  -- عدّ جميع السجلات حتى تاريخ النهاية (يطوى كل ما قبل p_period_end)
  SELECT COUNT(*) INTO v_tx_count
    FROM transactions
   WHERE date <= p_period_end;

  SELECT COUNT(*) INTO v_ledger_count
    FROM account_ledger
   WHERE date <= p_period_end;

  -- إنشاء سجل الإقفال
  INSERT INTO period_closings
    (close_date, period_start, period_end, closed_by,
     transactions_deleted, ledger_entries_deleted, notes)
  VALUES
    (p_period_end, p_period_start, p_period_end, v_caller_id,
     v_tx_count, v_ledger_count, p_notes)
  RETURNING id INTO v_closing_id;

  -- حفظ ملخص لكل حساب — يشمل كامل التاريخ حتى p_period_end
  -- opening_balance = 0  (نطوي كل شيء من البداية)
  -- closing_balance = الرصيد الحالي في account_balances
  INSERT INTO monthly_summaries
    (closing_id, period_start, period_end, account_id,
     opening_balance, total_debit, total_credit, closing_balance)
  SELECT
    v_closing_id,
    p_period_start,
    p_period_end,
    al.account_id,
    0,
    COALESCE(SUM(al.debit),  0),
    COALESCE(SUM(al.credit), 0),
    COALESCE(ab.balance, 0)
  FROM account_ledger al
  LEFT JOIN account_balances ab ON al.account_id = ab.account_id
  WHERE al.date <= p_period_end
  GROUP BY al.account_id, ab.balance;

  -- قيد الرصيد الافتتاحي (بعد الإقفال مباشرة — نفس تاريخ النهاية)
  v_ob_voucher := 'OB_CLOSE_' || to_char(p_period_end, 'YYYYMMDD');

  FOR v_account_rec IN
    SELECT account_id, balance FROM account_balances WHERE balance != 0
  LOOP
    INSERT INTO account_ledger
      (id, account_id, debit, credit, date, voucher_number, description, created_at, updated_at)
    VALUES (
      gen_random_uuid(),
      v_account_rec.account_id,
      CASE WHEN v_account_rec.balance > 0 THEN  v_account_rec.balance ELSE 0 END,
      CASE WHEN v_account_rec.balance < 0 THEN -v_account_rec.balance ELSE 0 END,
      p_period_end,
      v_ob_voucher,
      'رصيد افتتاحي — إقفال فترة ' || p_period_start::text || ' / ' || p_period_end::text,
      now(),
      now()
    );
  END LOOP;

  -- حذف دفتر الأستاذ القديم (كل ما قبل أو يساوي p_period_end ما عدا القيد الافتتاحي الجديد)
  DELETE FROM account_ledger
  WHERE date <= p_period_end
    AND voucher_number != v_ob_voucher;

  -- حذف المعاملات القديمة (كل ما قبل أو يساوي p_period_end)
  DELETE FROM transactions
  WHERE date <= p_period_end;

  RETURN jsonb_build_object(
    'ok',                     true,
    'closing_id',             v_closing_id,
    'transactions_deleted',   v_tx_count,
    'ledger_entries_deleted', v_ledger_count,
    'period_start',           p_period_start,
    'period_end',             p_period_end
  );

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.perform_period_close(date, date, text) FROM anon, public;
