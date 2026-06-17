# مرجع دوال RPC — نظام أبو حذيفة

**آخر تحديث:** 2026-06-17

جميع الدوال تُستدعى عبر `supabase.rpc(name, params)` أو `callRPC(RPC.NAME, params)`.

---

## معاملات مالية

### `create_transaction_with_entries`
يُنشئ معاملة مالية مع قيودها المحاسبية في عملية واحدة (Atomic).

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `tx_data` | `jsonb` | بيانات المعاملة (id, type, amount, date, agent_id, …) |
| `entries_data` | `jsonb[]` | مصفوفة القيود (account_id, debit, credit, description) |

**القيم المُعادة:** `{ transaction_id uuid, voucher_number text }`

**التأثيرات الجانبية:**
- يُدرج في `transactions` و `account_ledger`
- يُحدِّث `account_balances`
- إذا كان `id` موجوداً مسبقاً → 23505 يُعامَل كنجاح (idempotency)

---

### `reverse_transaction`
يُنشئ قيوداً عكسية لمعاملة مُزامنة ويضع علامة `is_reversed = true`.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_transaction_id` | `uuid` | معرّف المعاملة المراد عكسها |

**القيم المُعادة:** `{ reversed boolean, reversal_voucher text }`

**التأثيرات الجانبية:**
- يُدرج قيوداً عكسية في `account_ledger` بـ `voucher_number = 'REV_<tx_id_prefix>'`
- يُعدِّل `transactions.is_reversed = true`
- يُحدِّث `account_balances`

---

### `update_debtor_balance`
يُحدِّث رصيد المدين بعد تحصيل مبلغ.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_debtor_id` | `uuid` | معرّف المدين |
| `p_collected_amount` | `numeric` | المبلغ المُحصَّل |

**القيم المُعادة:** `{ new_balance numeric }`

**ملاحظة:** تعمل SECURITY DEFINER — تتجاوز سياسات RLS على `debtors`.

---

### `perform_daily_close`
يُنفِّذ الإقفال اليومي (مدير فقط).

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_date` | `date` | تاريخ الإقفال (YYYY-MM-DD) |

**القيم المُعادة:** `{ closed boolean, date date }`

**التأثيرات الجانبية:**
- يُدرج سجلاً في `daily_closings`
- يُجمِّد المعاملات قبل `p_date`

---

## موافقة على المعاملات

### `approve_transaction`
يُوافق على معاملة معلّقة الموافقة (مدير فقط).

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_transaction_id` | `uuid` | معرّف المعاملة |

**القيم المُعادة:** `{ approved boolean }`

**التأثيرات الجانبية:**
- يُعدِّل `transactions.approval_status = 'approved'`
- يُدرج قيوداً في `account_ledger` إن لم تكن موجودة

---

### `reject_transaction`
يرفض معاملة معلّقة الموافقة وينشئ قيوداً عكسية للـ SUSPENSE_ (مدير فقط).

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_transaction_id` | `uuid` | معرّف المعاملة |
| `p_reason` | `text` | سبب الرفض |

**القيم المُعادة:** `{ rejected boolean }`

**التأثيرات الجانبية:**
- يُعدِّل `transactions.approval_status = 'rejected'`
- يُدرج قيوداً عكسية لحسابات SUSPENSE_ وAGT_

---

### `get_pending_approvals`
يجلب المعاملات المعلّقة الموافقة.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| _(لا معاملات)_ | — | — |

**القيم المُعادة:** `[{ id, type, amount, date, agent_id, customer_name, … }]`

---

## تقارير واستعلامات

### `get_admin_dashboard`
يجلب بيانات لوحة تحكم المدير لتاريخ محدد.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_date` | `date` | تاريخ اللوحة |

**القيم المُعادة:** `{ kpi: {…}, banks: [{…}], agents: [{…}] }`

---

### `get_daily_summary`
يجلب ملخص العمليات اليومية (اختياري: مُصفَّى بمندوب).

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_date` | `date` | التاريخ |
| `p_agent_id` | `uuid?` | معرّف المندوب (اختياري) |

**القيم المُعادة:** `{ collection, deposit, bank_withdrawal, expense, receipt, net }`

---

### `get_account_statement`
يجلب كشف حساب محاسبي من `account_ledger`.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_account_id` | `text` | معرّف الحساب (AGT_, COMP_, BNK_, …) |
| `p_from` | `date` | من تاريخ |
| `p_to` | `date` | إلى تاريخ |

**القيم المُعادة:** `[{ date, voucher_number, description, debit, credit, balance }]`

---

### `get_bank_statement`
يجلب كشف حساب بنكي من `transactions`.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_bank_id` | `uuid` | معرّف الحساب البنكي |
| `p_from` | `date` | من تاريخ |
| `p_to` | `date` | إلى تاريخ |

**القيم المُعادة:** `[{ date, type, amount, agent_name, details }]`

---

### `get_opening_balance`
يجلب الرصيد الافتتاحي لحساب في تاريخ محدد.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_account_id` | `text` | معرّف الحساب |
| `p_from_date` | `date` | تاريخ البداية |

**القيم المُعادة:** `numeric` (الرصيد قبل p_from_date)

---

### `get_next_voucher_number`
يجلب رقم القيد التالي المتسلسل.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| _(لا معاملات)_ | — | — |

**القيم المُعادة:** `text` (مثال: `VCH-2026-001234`)

---

### `get_chart_of_accounts`
يجلب شجرة الحسابات مع الأرصدة الحالية.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| _(لا معاملات)_ | — | — |

**القيم المُعادة:** `[{ account_id, name, balance }]`

---

### `get_audit_logs`
يجلب سجلات التدقيق بفترة زمنية.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_from` | `timestamptz` | من تاريخ |
| `p_to` | `timestamptz` | إلى تاريخ |
| `p_user_id` | `uuid?` | مرشّح بالمستخدم (اختياري) |

**القيم المُعادة:** `[{ id, user_id, action, record_type, record_id, old_value, new_value, timestamp }]`

---

## إدارة النظام

### `verify_quick_login`
يتحقق من صحة رمز PIN للدخول السريع.

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_hash` | `text` | هاش رمز PIN |

**القيم المُعادة:** `{ user_id uuid, valid boolean }`

---

### `clear_audit_logs`
يحذف سجلات التدقيق القديمة (مدير فقط).

| المعامل | النوع | الوصف |
|---------|-------|-------|
| `p_before_date` | `timestamptz?` | احذف ما قبل هذا التاريخ (اختياري = احذف الكل) |

**القيم المُعادة:** `{ deleted integer, success boolean }`

---

### `reset_all_operational_data`
يُعيد ضبط جميع البيانات التشغيلية (مدير فقط — خطر).

| المعامل | النوع | الوصف |
|---------|-------|-------|
| _(لا معاملات)_ | — | — |

**القيم المُعادة:** `text` (`'OK'` أو يرمي EXCEPTION)

---

## ملاحظات تقنية

- **idempotency:** كل `create_transaction_with_entries` يستخدم `transaction.id` كـ idempotency key — الخطأ 23505 يُعامَل كنجاح.
- **FIFO:** `OutboxService.processOutbox` يعالج `sync_queue` بترتيب `local_timestamp` ASC لضمان تسلسل الإنشاء.
- **FK safety:** `debtors` يُدرَج قبل `transactions` في الطابور بسبب FIFO — يمنع `transactions_customer_id_fkey` violation.
- **RLS:** دوال `SECURITY DEFINER` (مثل `update_debtor_balance`) تتجاوز سياسات RLS تلقائياً.
