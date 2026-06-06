# تحليل السبب الجذري لتعارضات المزامنة
## SYNC CONFLICT ROOT CAUSE ANALYSIS

**التاريخ:** 2026-06-06  
**المشروع:** gffyakxcfoeehtapelgd  
**الجداول المتأثرة:** `companies` · `notifications` · `failed_deposits`  
**الحالة:** تحليل فقط — لا تعديلات

---

# القسم الأول — تحليل التعارضات

## 1.1 دورة حياة السجل الكاملة

```
إنشاء سجل جديد (مثلاً: شركة جديدة)
          │
          ▼
  Repository.create()
  ┌─────────────────────────────────────────────┐
  │  record = {                                  │
  │    ...data,                                  │
  │    id        : generateUUID(),               │
  │    created_at: new Date().toISOString(), ◄── │
  │    updated_at: new Date().toISOString(), ◄── │ ← مُحقن دائماً
  │  }                                           │
  └─────────────────────────────────────────────┘
          │
          ▼ (متصل بالشبكة)
  supabaseClient.from('companies').insert(record)
          │
          ▼
  ❌ خطأ Supabase:
  "column updated_at of relation companies does not exist"
          │
          ▼ (معالجة الفشل في Repository)
  db['companies'].put({ ...record, sync_status: 'pending' })
  SyncQueue.add('CREATE', 'companies', id, record)
          │
          ▼
  SyncQueue._processItem()
  → _executeCreate(tableName, data, tempId)
  → cleanData = _cleanRecord(data)
    [يحذف: sync_status, _local_only, error_message]
    [يُبقي: id, name, account_prefix, created_at, ★updated_at★]
          │
          ▼
  supabaseClient.from('companies').insert(cleanData)
          │
          ▼
  ❌ نفس الخطأ مجدداً
          │
          ▼
  handleFailure() → retries++ (1/5)
          │
     ... 4 محاولات أخرى بنفس النتيجة ...
          │
          ▼
  retries === MAX_RETRIES (5)
  _moveToConflicts(item, errorMsg)
          │
          ▼
  db.sync_conflicts.add({
    table_name : 'companies',
    reason     : 'column updated_at does not exist',
    ...
  })
  ★ السجل يظهر في قائمة التعارضات ★
```

---

## 1.2 تحديد أول نقطة فشل فعلية

### الجدول: `companies`

**أول نقطة فشل:** `Repository.create()` — السطر 181 في `repository/Repository.js`

```javascript
// Repository.js:181-182
const record = {
  ...data,
  [pkColumn]  : pkValue,
  created_at  : data.created_at || new Date().toISOString(),
  updated_at  : data.updated_at || new Date().toISOString(),  // ← حقن أعمى
};
```

**الدليل من Supabase:** استعلام مباشر على قاعدة البيانات:

```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'notifications')
  AND column_name = 'updated_at';
-- النتيجة: [] (صفر صفوف)
```

**النتيجة: كلا الجدولين خاليان تماماً من عمود `updated_at`.**

---

### الجدول: `notifications`

**أول نقطة فشل مختلفة:** تحدث عند UPDATE (قراءة/إخفاء الإشعار)

```javascript
// SyncQueue.js — _executeUpdate()
const { data: current, error: fetchError } = await supabaseClient
  .from('notifications')
  .select('updated_at')      // ← يطلب عموداً غير موجود
  .eq('id', recordId)
  .single();

// fetchError يُعاد ولكن كوده ليس PGRST116
// الكود يتجاهل الخطأ ويكمل

const cleanChanges = {
  ...this._cleanRecord(changes),
  updated_at: new Date().toISOString(), // ← يُضاف دائماً هنا أيضاً
};

supabaseClient.from('notifications').update(cleanChanges)...
// ❌ فشل: column updated_at does not exist
```

---

### الجدول: `failed_deposits`

**نوع مختلف من الفشل:** ليس خطأ في schema — بل **خطأ في منطق الكشف عن التعارض**.

```javascript
// SyncQueue.js — _executeUpdate() — منطق المقارنة
if (
  current?.updated_at &&          // قيمة الخادم (T_server)
  changes?.updated_at &&          // قيمة العميل  (T_new_local)
  current.updated_at !== changes.updated_at  // دائماً مختلفان!
) {
  return err(`تعارض: السجل عُدِّل من مصدر آخر...`);
}
```

**لماذا دائماً مختلفان؟**

| المرحلة | القيمة | الملاحظة |
|---------|--------|----------|
| إنشاء السجل online | `T_server` (مُخزَّن في Dexie) | القيمة الأصلية |
| تعديل offline | `T_new = new Date()` | Repository.update() يُنشئ طابعاً جديداً |
| المزامنة: جانب الخادم | `T_server` (لم يتغير) | لم يلمسه أحد |
| المزامنة: جانب العميل | `T_new` | مختلف دائماً عن T_server |
| النتيجة | `T_server ≠ T_new` → تعارض | **إيجابي كاذب** |

**مُعقِّد إضافي:** الـ Trigger على `failed_deposits`:

```sql
-- Trigger: trg_failed_deposits_updated_at
-- handle_updated_at():
BEGIN
  NEW.updated_at = NOW();  -- يُعيد ختم الوقت على الخادم عند كل UPDATE
  RETURN NEW;
END;
```

كل مرة يُحدَّث السجل على الخادم، تصبح `updated_at = NOW()_server` وهي مختلفة عن أي قيمة عميل لاحقة. التعارض الكاذب يتراكم مع كل دورة مزامنة.

---

## 1.3 رسائل الخطأ الأصلية

### companies و notifications — خطأ الـ Schema

```
PostgreSQL / PostgREST error:
{
  "code": "42703",
  "message": "column \"updated_at\" of relation \"companies\" does not exist",
  "hint": null,
  "details": null
}
```

أو عند SELECT:
```
{
  "code": "42703",  
  "message": "column notifications.updated_at does not exist"
}
```

### failed_deposits — خطأ منطق التعارض

```javascript
// رسالة مُنشأة داخلياً في SyncQueue._executeUpdate():
`تعارض: السجل عُدِّل من مصدر آخر ` +
`(خادم: ${current.updated_at} | محلي: ${changes.updated_at})`

// مثال:
"تعارض: السجل عُدِّل من مصدر آخر " +
"(خادم: 2026-06-01T10:00:00.000Z | محلي: 2026-06-06T14:32:17.445Z)"
```

---

## 1.4 مقارنة Schema الشاملة

### جدول: `companies`

| الحقل | Dexie Schema | Supabase Schema | Repository يُرسل | النتيجة |
|-------|-------------|-----------------|-----------------|---------|
| `id` | PK | `uuid NOT NULL DEFAULT gen_random_uuid()` | ✅ | ✅ |
| `name` | — (indexed implicitly) | `text NOT NULL` | ✅ | ✅ |
| `account_prefix` | index | `text NOT NULL UNIQUE` | ✅ | ✅ |
| `created_at` | — | `timestamptz NOT NULL DEFAULT now()` | ✅ | ✅ |
| `updated_at` | — | **غير موجود** | ✅ مُحقن | ❌ **فشل** |
| `sync_status` | index | **غير موجود** | يُزال بـ `_cleanRecord` | ✅ |

**السبب الجذري لـ companies:** `updated_at` محقون من Repository دون وجود عمود مقابل في Supabase.

---

### جدول: `notifications`

| الحقل | Dexie Schema | Supabase Schema | Repository يُرسل | النتيجة |
|-------|-------------|-----------------|-----------------|---------|
| `id` | PK | `uuid NOT NULL DEFAULT gen_random_uuid()` | ✅ | ✅ |
| `title` | — | `text NOT NULL` | ✅ | ✅ |
| `body` | — | `text NOT NULL` | ✅ | ✅ |
| `type` | index | `text NOT NULL DEFAULT 'info'` | ✅ | ✅ |
| `target` | — | `jsonb NOT NULL DEFAULT '"all"'` | ✅ | ✅ |
| `sender_id` | — | `uuid NULL FK→users` | ✅ | ✅ |
| `read_by` | — | `jsonb NOT NULL DEFAULT '[]'` | ✅ (array بعد normalize) | ✅ |
| `hidden_by` | — | `jsonb NOT NULL DEFAULT '[]'` | ✅ | ✅ |
| `created_at` | index | `timestamptz NOT NULL DEFAULT now()` | ✅ | ✅ |
| `updated_at` | — | **غير موجود** | ✅ مُحقن | ❌ **فشل** |
| `sync_status` | index | **غير موجود** | يُزال بـ `_cleanRecord` | ✅ |

**ملاحظة إضافية على notifications:** سياسات RLS تمنع CREATE/DELETE للمستخدمين غير الإداريين:

```sql
-- SELECT فقط للوكلاء والمساعدين:
notifications_non_admin_select → cmd: SELECT
notifications_non_admin_update → cmd: UPDATE (شرط: target يشمل المستخدم)
notifications_admin_all        → cmd: ALL    (شرط: is_admin())
```

إذا حاول وكيل (agent) إنشاء إشعار → RLS تحجب الـ INSERT → خطأ آخر يُضاف للفشل.

---

### جدول: `failed_deposits`

| الحقل | Dexie Schema | Supabase Schema | النتيجة |
|-------|-------------|-----------------|---------|
| `id` | PK | `uuid NOT NULL DEFAULT gen_random_uuid()` | ✅ |
| `date` | index | `date NOT NULL` | ✅ |
| `time` | — | `time NULL` | ✅ |
| `bank_account_id` | — | `uuid NULL FK→bank_accounts` | ✅ |
| `account_number` | — | `text NULL` | ✅ |
| `amount` | — | `numeric NOT NULL` | ✅ |
| `agent_id` | index | `uuid NULL FK→users` | ✅ |
| `status` | index | `text NOT NULL DEFAULT 'pending'` | ✅ |
| `refund_amount` | — | `numeric NULL` | ✅ |
| `rejection_reason` | — | `text NULL` | ✅ |
| `bank_response_text` | — | `text NULL` | ✅ |
| `created_at` | — | `timestamptz NOT NULL DEFAULT now()` | ✅ |
| `updated_at` | — | `timestamptz NOT NULL DEFAULT now()` ✅ | ✅ Schema OK |
| `sync_status` | index | **غير موجود** | يُزال بـ `_cleanRecord` ✅ |

**Schema صحيح** — المشكلة في منطق التعارض فقط (الإيجابي الكاذب).

---

## 1.5 التحقق من العوامل المؤثرة

### Primary Keys

| الجدول | PK في Dexie | PK في Supabase | `_SQ_PK_MAP` | الحالة |
|--------|------------|----------------|--------------|--------|
| `companies` | `id` | `uuid PK` | 'id' (افتراضي) | ✅ |
| `notifications` | `id` | `uuid PK` | 'id' (افتراضي) | ✅ |
| `failed_deposits` | `id` | `uuid PK` | 'id' (افتراضي) | ✅ |

### Foreign Keys والقيود

| القيد | الجدول | العمود | المرجع | Risk |
|-------|--------|--------|--------|------|
| `failed_deposits_agent_id_fkey` | failed_deposits | agent_id | users.id | **متوسط**: إذا حُذف المستخدم قبل المزامنة |
| `failed_deposits_bank_account_id_fkey` | failed_deposits | bank_account_id | bank_accounts.id | **متوسط**: نفس السبب |
| `notifications_sender_id_fkey` | notifications | sender_id | users.id | **منخفض**: nullable |
| `companies_account_prefix_key` | companies | account_prefix | — | **عالٍ**: UNIQUE constraint → insert مكرر يفشل |

### UUID Generation

```javascript
// Repository.js:176-177
const pkValue = data[pkColumn] || generateUUID();
```

في الحالة online: يُرسَل UUID من العميل. Supabase يقبله ما لم يكن مكرراً.  
في الحالة offline: UUID مؤقت TEMP_* ← يُستبدَل بعد المزامنة عبر `replaceTempId()`.

**⚠️ مشكلة مع companies:** `account_prefix` له قيد UNIQUE. إذا أُنشئت شركتان بنفس البادئة في وضع offline، يُتقبَّل الاثنتان محلياً ثم الثانية تفشل على Supabase بـ UNIQUE violation → تعارض إضافي.

### Triggers المؤثرة

| الـ Trigger | الجدول | الحدث | التأثير على المزامنة |
|------------|--------|--------|---------------------|
| `trg_failed_deposits_updated_at` | failed_deposits | UPDATE | يُعيد ختم `updated_at = NOW()` → يُعطل conflict detection |
| `trg_transactions_updated_at` | transactions | UPDATE | نفس المشكلة — تعارضات كاذبة عند التحديث offline |

### RLS Policies المؤثرة

**companies:**
```sql
companies_admin_write → ALL, role: authenticated, qual: is_admin()
companies_all_select  → SELECT, role: authenticated, qual: true
```
⚠️ وكيل لا يستطيع CREATE/UPDATE شركة — إذا حاول → RLS violation → تعارض

**notifications:**
```sql
notifications_admin_all           → ALL, is_admin() فقط
notifications_non_admin_select    → SELECT فقط (وكيل/مساعد)
notifications_non_admin_update    → UPDATE بشرط target
```
⚠️ وكيل يستطيع UPDATE (قراءة/إخفاء) لكن UPDATE يفشل بسبب `updated_at` غير موجود

**failed_deposits:**
```sql
failed_deposits_admin_all    → ALL, is_admin()
failed_deposits_agent_own    → ALL (agent_id = auth.uid() AND role='agent' AND is_active)
failed_deposits_assistant_all → ALL (role='admin_assistant' AND allowed_tabs?'failed-deposits')
```
✅ RLS مناسب — المشكلة في منطق التعارض فقط

---

## 1.6 السبب الجذري الحقيقي — الخلاصة

### 🔴 سبب جذري #1: حقن `updated_at` أعمى في `companies` و `notifications`

**الملف:** `repository/Repository.js:181-182`
```javascript
const record = {
  ...data,
  [pkColumn]  : pkValue,
  created_at  : data.created_at || new Date().toISOString(),
  updated_at  : data.updated_at || new Date().toISOString(),  // ← الجاني
};
```

**الملف:** `repository/SyncQueue.js` — `_executeUpdate()`
```javascript
const cleanChanges = {
  ...this._cleanRecord(changes),
  updated_at: new Date().toISOString(), // ← يُضيف updated_at حتى لو لم يكن في changes
};
```

**الدليل القاطع من DB:**
```sql
-- استعلام التحقق
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('companies', 'notifications')
  AND column_name = 'updated_at';
-- النتيجة: [] ← صفر صفوف ← العمود غير موجود في الجدولين
```

**مسار الفشل:**
```
Repository.create(record with updated_at)
  → Supabase INSERT rejects (42703: column does not exist)
  → Dexie.put(pending) + SyncQueue.add()
  → SyncQueue._executeCreate(cleanData still has updated_at)
  → Supabase INSERT rejects again
  → handleFailure() × 5
  → _moveToConflicts()  ← ★ التعارض
```

---

### 🔴 سبب جذري #2: منطق كشف التعارض الكاذب في `failed_deposits`

**الملف:** `repository/SyncQueue.js` — `_executeUpdate()` السطور 305-320

```javascript
// المقارنة الخاطئة:
if (
  current?.updated_at &&          // T_server (وقت آخر sync)
  changes?.updated_at &&          // T_new_local (وقت التعديل المحلي)
  current.updated_at !== changes.updated_at  // دائماً true للـ offline edits
) {
  return err(`تعارض...`);  // ← إيجابي كاذب
}
```

**المشكلة:** يجب مقارنة `current.updated_at` بـ "قيمة updated_at عند آخر قراءة للسجل" (Pre-edit snapshot) لا بالقيمة الجديدة التي وضعها العميل.

**المُعقِّد:** Trigger `trg_failed_deposits_updated_at` يُعيد ختم الوقت على الخادم عند كل UPDATE:
```sql
-- handle_updated_at():
NEW.updated_at = NOW();  -- دائماً مختلف عن أي قيمة عميل
```

**النتيجة:** كل تعديل offline لـ `failed_deposits` يُصبح تعارضاً — حتى لو لم يلمسه أحد آخر.

---

# القسم الثاني — تحليل الاستلام والتسليم

## 2.1 الوضع الحالي — خريطة العمليات

بناءً على `services/AccountingService.js` و `config.js`:

### أنواع العمليات المحاسبية

| نوع العملية | القيد | الحسابات المتأثرة |
|-------------|-------|-----------------|
| `collection` (تحصيل) | مدين: صندوق الوكيل / دائن: العميل | AGT_id ← CUST_id |
| `deposit` (إيداع) | مدين: البنك / دائن: الصندوق | BANK_id ← AGT_id أو MAIN |
| `expense` (مصروف) | مدين: حساب المصروف / دائن: الصندوق | EXP_id ← MAIN أو AGT_id |
| `receipt` (استلام من وكيل) | مدين: الصندوق الرئيسي / دائن: صندوق الوكيل | MAIN ← AGT_id |
| `delivery` (تسليم للوكيل) | مدين: صندوق الوكيل / دائن: الصندوق الرئيسي | AGT_id ← MAIN |
| `agent_transfer` (تحويل بين وكلاء) | مدين: وكيل الوجهة / دائن: وكيل المصدر | AGT_to ← AGT_from |
| `box_transfer` (تحويل بين صناديق) | مدين: الصندوق الهدف / دائن: الصندوق المصدر | BOX_to ← BOX_from |
| `refund_settlement` (تسوية إرجاع) | مدين: حساب متعلق / دائن: حساب آخر | varies |

### مسار العملية الكاملة (مثال: تسليم للوكيل)

```
[1] DataEntryComponent.submit()
    → AccountingService.buildJournalEntries(tx)
    
[2] buildJournalEntries()
    → await _generateVoucherNumber()  [RPC → PostgreSQL sequence]
    → _buildDeliveryEntries(tx, voucher)
    → Returns: { transaction: {...}, entries: [...], balanceUpdates: [...] }
    
[3] الحفظ في Repository (عدة استدعاءات منفصلة):
    → Repository.create('transactions', transaction)
    → Repository.create('account_ledger', entry1)  [AGT_id debit]
    → Repository.create('account_ledger', entry2)  [MAIN credit]
    → Repository.upsert('account_balances', { account_id: 'AGT_id', balance: new_balance })
    → Repository.upsert('account_balances', { account_id: 'MAIN', balance: new_balance })
    
[4] إذا كانت المزامنة online-first:
    → كل استدعاء إلى Repository يُنفَّذ مباشرة على Supabase
    → لا يوجد DB Transaction يجمعها
```

---

## 2.2 نقاط الضعف — التحليل التفصيلي

### ⛔ ضعف #1: غياب الأتمية (Atomicity)

**المشكلة:** عمليات الاستلام والتسليم تُنفَّذ عبر استدعاءات Supabase منفصلة دون `BEGIN/COMMIT`.

```
Repository.create('transactions', tx)          ← نجح
Repository.create('account_ledger', entry1)    ← نجح
Repository.create('account_ledger', entry2)    ← ❌ فشل (انقطاع شبكة)
Repository.upsert('account_balances', bal1)    ← لم يُنفَّذ
Repository.upsert('account_balances', bal2)    ← لم يُنفَّذ
```

**النتيجة:** سجل معاملة موجود بدون قيود محاسبية. الأرصدة لم تُحدَّث. الميزانية مختلة.

**الدليل:** لا يوجد في Supabase أي Stored Procedure يجمع هذه العمليات. لا توجد RPCs لـ `create_full_transaction`.

---

### ⛔ ضعف #2: FK على `account_ledger.reference_id` + Offline TEMP IDs

**الدليل من DB:**
```sql
account_ledger.reference_id → FK → transactions.id
```

**المشكلة:**

```
[Offline] AccountingService.buildJournalEntries()
  → _generateVoucherNumber() → offline fallback: 'V2026-06-06-LOCAL-1234567890'
  → transaction.id = 'TEMP_abc123'
  → entry1.reference_id = 'TEMP_abc123'   ← FK مُعلَّق
  → entry2.reference_id = 'TEMP_abc123'   ← FK مُعلَّق

[Sync] SyncQueue processes: INSERT transactions (TEMP_abc123)
  → Supabase generates real_id = 'uuid-real'
  → replaceTempId('transactions', 'TEMP_abc123', 'uuid-real') ← في Dexie فقط!

[Sync] SyncQueue processes: INSERT account_ledger (entry1)
  → entry1.reference_id = 'TEMP_abc123'  ← لم يُحدَّث في queue data!
  → Supabase INSERT: FK violation → 'TEMP_abc123' لا يوجد في transactions
  → handleFailure() × 5 → CONFLICT
```

**التوضيح:** `replaceTempId()` يُحدِّث:
1. ✅ السجل الرئيسي في Dexie
2. ✅ `account_ledger` في Dexie (via `reference_id` query)
3. ✅ `sync_queue` items بحقل `record_id`
4. ❌ **لا يُحدِّث حقل `data` JSON داخل عناصر قائمة الانتظار**

```javascript
// SyncQueue.js — replaceTempId()
for (const qi of queueItems) {
  await db.sync_queue.update(qi.id, { record_id: realId });
  // ← يُحدِّث record_id فقط
  // ← لا يُحدِّث JSON.parse(qi.data).reference_id !
}
```

عندما يُعالَج عنصر account_ledger من القائمة، يُرسَل بـ `reference_id = 'TEMP_abc123'` القديم → FK violation.

---

### ⛔ ضعف #3: Race Condition على `account_balances`

**Schema:**
```
account_balances:
  account_id (text, PK)
  balance    (numeric)
  last_updated (timestamptz)
```

**المشكلة:** عند تنفيذ عمليتين متزامنتين تمسان نفس الحساب:

```
العميل A: يقرأ balance = 1000
العميل B: يقرأ balance = 1000
العميل A: يُحدِّث balance = 900 (سحب 100)
العميل B: يُحدِّث balance = 800 (سحب 200)
الخادم:  balance = 800  ← اللكتابة الأخيرة تفوز
الصواب:  balance = 700  ← 1000 - 100 - 200
```

**الأثر:** تغاير الأرصدة — المبالغ تُفقد أو تُضاف بالخطأ.

**لا يوجد حماية:**
- لا `SELECT FOR UPDATE` على `account_balances`
- لا version field للمقارنة
- `upsert()` يكتب مباشرة بدون قراءة أولى

---

### ⛔ ضعف #4: عدم التزامن بين `account_ledger` و `account_balances` في Offline

**المشكلة:** عند العمل offline:

```
[Offline]
create('transactions', tx) → Dexie + SyncQueue
create('account_ledger', e1) → Dexie + SyncQueue
create('account_ledger', e2) → Dexie + SyncQueue
upsert('account_balances', { balance: computed }) → Dexie + SyncQueue

[Online - بعد ربع ساعة]
SyncQueue يعالج:
1. INSERT transactions → ok
2. INSERT account_ledger e1 → ok
3. INSERT account_ledger e2 → ok
4. UPSERT account_balances → ok

[مشكلة]: مستخدم آخر عدّل balance أثناء الـ 15 دقيقة
→ upsert يكتب فوق قيمته (Last Write Wins)
```

`account_balances` ليس له سياسة تعارض صحيحة — لا يُجمع الفرق بل يُكتب الرصيد كاملاً.

---

### ⛔ ضعف #5: `account_ledger` لا يملك `updated_at`

**من Supabase:**
```
account_ledger:
  id, voucher_number, date, account_id,
  debit, credit, description, reference_id, created_at
```

`account_ledger` لا يملك `updated_at` — نفس مشكلة companies/notifications!

إذا حاول أي كود تحديث قيد محاسبي → UPDATE يُرسَل مع `updated_at` → Supabase يرفض.

---

### ⛔ ضعف #6: `daily_closings` — بيانات مُجمَّدة بدون مراجعة

**Schema:**
```
daily_closings:
  id (uuid), date (date), closing_data (jsonb), created_at
```

**المشكلة:**
- `closing_data` snapshot لحظي من وقت الإغلاق
- إذا أُلغيت معاملة بعد الإغلاق (is_reversed = true) → `closing_data` لا يتحدث
- لا يوجد trigger أو وظيفة تُعيد حساب `closing_data` عند التعديل
- تقارير اليوم التالي قد تبني على أرقام خاطئة

---

### ⚠️ ضعف #7: القيد المزدوج غير مُراجَع آلياً

**المبدأ:** مجموع المدين = مجموع الدائن لكل معاملة.

**الواقع:** لا يوجد في قاعدة البيانات:
- CHECK constraint يتحقق من `SUM(debit) = SUM(credit)` لكل `voucher_number`
- Trigger يرفض إدخالات مُختلة
- RPC يتحقق قبل الحفظ

كل التحقق يحدث فقط في `AccountingService.buildJournalEntries()` ← جانب العميل ← يمكن تجاوزه.

---

### ⚠️ ضعف #8: `agent_transfer` — خطر Race Condition مزدوج

عند تحويل مبلغ بين وكيلين (from_agent → to_agent):

```
المعاملة تحتاج تحديث 3 أرصدة:
1. account_balances[AGT_from] -= amount
2. account_balances[AGT_to]   += amount
3. account_balances[MAIN]     بدون تغيير (أو مع عمولة)

كل منها upsert منفصل → Race Condition محتمل على كل واحد
```

إذا فشل التحديث الثاني بعد نجاح الأول: المبلغ خرج من AGT_from ولم يصل AGT_to.

---

### ⚠️ ضعف #9: غياب Idempotency في عمليات الحفظ

عند retry بعد انقطاع الشبكة في منتصف الحفظ:

```
INSERT transactions → نجح وأُعيدت الاتصال
ولكن Repository لم يتلقَّ الرد → يعتقد أنه فشل
→ SyncQueue.add('CREATE', 'transactions', ...)
→ SyncQueue._executeCreate():
  supabase.insert(same_data_with_same_uuid)
  → Supabase: "duplicate key value violates unique constraint"
  → error → handleFailure × 5 → CONFLICT
```

الـ UUID ثابت لكن Supabase يرفض الإدخال المكرر على PK. الحل الصحيح هو `upsert` بدلاً من `insert` في `_executeCreate` — لكن `upsert` قد يُعطي مشاكل أخرى.

---

## 2.3 المخاطر المحاسبية

| الخطر | الاحتمالية | الخطورة | الأثر |
|-------|-----------|---------|-------|
| عدم توازن المدين/دائن بعد فشل جزئي | عالية | **حرج** | ميزانية مختلة |
| تغاير الأرصدة من Race Condition | متوسطة | **حرج** | أموال مفقودة أو مكررة |
| `closing_data` لا يعكس الإلغاءات | عالية | **عالٍ** | تقارير يومية خاطئة |
| قيد محاسبي بـ TEMP reference_id لا يُرسَل | عالية | **عالٍ** | بيانات ناقصة في Supabase |
| عدم وجود CHECK constraint للقيد المزدوج | دائمة | **متوسط** | لا صد للأخطاء البرمجية |
| Idempotency issue على retry | متوسطة | **عالٍ** | إدخالات مكررة في transactions |

---

## 2.4 المخاطر التقنية

| الخطر | الملف | السطور | الوصف |
|-------|-------|--------|-------|
| Non-atomic multi-table write | AccountingService.js | كل `save*` functions | لا DB transaction |
| TEMP_ID في `data` JSON لا يُحدَّث | SyncQueue.js | replaceTempId() | FK violation عند sync |
| Last-Write-Wins على account_balances | Repository.js | upsert() | بيانات تُكتب فوق بعضها |
| updated_at مُحقن على account_ledger | Repository.js:181-182 | — | UPDATE يفشل |
| Conflict detection كاذب | SyncQueue.js | _executeUpdate() | Offline edits → conflicts |

---

# القسم الثالث — خطة الإصلاح

> **تذكير:** هذا القسم خطة اقتراحية فقط. لا تنفيذ في هذا الملف.

---

## 3.1 الإصلاحات الحرجة (يجب أن تُنفَّذ أولاً)

### إصلاح CR-1: إضافة `updated_at` لجدول `companies`

```sql
-- Migration
ALTER TABLE companies ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
```

**الملف المؤثر:** لا تغيير برمجي — الإصلاح في DB فقط.

---

### إصلاح CR-2: إضافة `updated_at` لجدول `notifications`

```sql
ALTER TABLE notifications ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
CREATE TRIGGER trg_notifications_updated_at
  BEFORE UPDATE ON notifications
  FOR EACH ROW EXECUTE FUNCTION handle_updated_at();
```

---

### إصلاح CR-3: إضافة `updated_at` لجدول `account_ledger`

```sql
ALTER TABLE account_ledger ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
```

**ملاحظة:** قيود المحاسبة لا تُعدَّل عادةً — لكن يجب الحقل لتجنب فشل Repository.update().

---

### إصلاح CR-4: إصلاح منطق كشف التعارض في `SyncQueue._executeUpdate()`

**المشكلة:** المقارنة تستخدم `changes.updated_at` (الجديد) بدلاً من snapshot قبل التعديل.

**الحل المقترح:** حفظ `_preEditUpdatedAt` عند قراءة السجل وتمريره مع SyncQueue:

```javascript
// بدلاً من:
SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, changes)

// يصبح:
SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, {
  ...changes,
  _preEditUpdatedAt: originalRecord.updated_at  // snapshot
})

// وفي _executeUpdate():
const preEditTimestamp = item._preEditUpdatedAt || changes.updated_at;
if (current?.updated_at && preEditTimestamp && current.updated_at !== preEditTimestamp) {
  return err('تعارض حقيقي...');
}
```

---

### إصلاح CR-5: إصلاح `replaceTempId()` ليُحدِّث `data` في قائمة الانتظار

```javascript
// SyncQueue.js — replaceTempId()
for (const qi of queueItems) {
  // الحالي: يُحدِّث record_id فقط
  await db.sync_queue.update(qi.id, { record_id: realId });
  
  // المطلوب: تحديث reference_id داخل JSON أيضاً
  const parsed = _safeJsonParse(qi.data, {});
  if (parsed.reference_id === tempId) {
    parsed.reference_id = realId;
    await db.sync_queue.update(qi.id, {
      record_id : realId,
      data      : JSON.stringify(parsed),
    });
  }
}
```

---

## 3.2 الإصلاحات المهمة

### إصلاح IMP-1: RPC لكتابة المعاملة الكاملة بشكل ذري

إنشاء Stored Procedure يجمع:
- INSERT transactions
- INSERT account_ledger (entries متعددة)
- UPDATE account_balances (بالفرق لا بالقيمة الكاملة)

في `BEGIN/COMMIT` واحد — يضمن الأتمية ويحل Race Condition.

```sql
CREATE OR REPLACE FUNCTION create_full_transaction(
  p_transaction jsonb,
  p_entries     jsonb[],  -- مصفوفة القيود
  p_bal_changes jsonb[]   -- مصفوفة: { account_id, delta }
) RETURNS jsonb AS $$
BEGIN
  INSERT INTO transactions SELECT * FROM jsonb_populate_record(NULL::transactions, p_transaction);
  -- INSERT entries...
  -- UPDATE balances with delta (+=) not absolute value
END;
$$ LANGUAGE plpgsql;
```

---

### إصلاح IMP-2: تحديث `account_balances` بالفرق (Δ) لا بالقيمة المطلقة

```javascript
// بدلاً من:
Repository.upsert('account_balances', { account_id: 'AGT_x', balance: 1500 })

// المطلوب:
supabase.rpc('increment_balance', { p_account_id: 'AGT_x', p_delta: +500 })
// حيث RPC: UPDATE account_balances SET balance = balance + p_delta WHERE account_id = p_account_id
```

هذا يُحل Race Condition لأن العملية أصبحت `balance = balance + delta` وليس `balance = absolute`.

---

### إصلاح IMP-3: CHECK Constraint للقيد المزدوج

```sql
-- على مستوى voucher_number (جمع debit = جمع credit)
-- يتطلب Deferred Constraint لأن القيود تُدخَل تباعاً
CREATE CONSTRAINT TRIGGER check_double_entry
  AFTER INSERT ON account_ledger
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION verify_balanced_voucher();
```

---

### إصلاح IMP-4: تحديث `daily_closings` عند الإلغاء

إضافة منطق لإعادة حساب أو تعليم `closing_data` كـ "outdated" عند وجود `is_reversed = true` لمعاملة في تاريخ مُغلق.

---

## 3.3 الإصلاحات الاختيارية (تحسينات للمستقبل)

### إصلاح OPT-1: جعل `_executeCreate` يستخدم `upsert`

```javascript
// _executeCreate() في SyncQueue
const { data: saved, error } = await supabaseClient
  .from(tableName)
  .upsert(cleanData, { onConflict: pkCol, ignoreDuplicates: false })
  .select()
  .single();
```

يحل مشكلة Idempotency عند retry بعد فقدان الاتصال.

---

### إصلاح OPT-2: `_cleanRecord` يعرف الـ Schema لكل جدول

بدلاً من حذف حقول ثابتة، يُعيد `_cleanRecord` فقط الحقول الموجودة في schema الجدول المستهدف.

```javascript
const TABLE_ALLOWED_FIELDS = {
  companies     : ['id', 'name', 'account_prefix', 'created_at', 'updated_at'],
  notifications : ['id', 'title', 'body', 'type', 'target', 'sender_id', 'read_by', 'hidden_by', 'created_at', 'updated_at'],
  // ...
};

function _cleanRecord(tableName, data) {
  const allowed = TABLE_ALLOWED_FIELDS[tableName];
  if (!allowed) return _defaultClean(data);
  return Object.fromEntries(Object.entries(data).filter(([k]) => allowed.includes(k)));
}
```

يحل مشكلة الحقول الوهمية بشكل هيكلي بدلاً من الترقيع.

---

### إصلاح OPT-3: Audit Trail على `account_balances`

إضافة جدول `balance_audit_log` يُسجِّل كل تغيير في الرصيد مع:
- `account_id`, `delta`, `balance_before`, `balance_after`
- `transaction_id`, `user_id`, `created_at`

يُمكِّن من:
- إعادة حساب الرصيد في أي وقت من مجموع الدلتات
- الكشف عن Race Conditions بعد وقوعها
- Reconciliation تلقائي

---

## ملخص الأولويات

```
CRITICAL (يمنع المزامنة الكاملة):
  CR-1: updated_at للـ companies
  CR-2: updated_at للـ notifications
  CR-4: إصلاح conflict detection الكاذب في failed_deposits
  CR-5: إصلاح replaceTempId للـ data JSON

IMPORTANT (يمنع فقدان بيانات):
  CR-3: updated_at للـ account_ledger
  IMP-1: RPC ذري للمعاملة الكاملة
  IMP-2: تحديث الأرصدة بالفرق

OPTIONAL (تحسينات هيكلية):
  IMP-3: CHECK constraint للقيد المزدوج
  IMP-4: تحديث daily_closings عند الإلغاء
  OPT-1: Idempotent _executeCreate
  OPT-2: Schema-aware _cleanRecord
  OPT-3: balance_audit_log
```

---

*التقرير مبني بالكامل على الكود الفعلي في branch `claude/festive-faraday-rGYhA` وقاعدة البيانات `gffyakxcfoeehtapelgd` — كل استنتاج مرفق بدليل من ملف أو استعلام SQL.*
