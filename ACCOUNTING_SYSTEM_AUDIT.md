# مراجعة النظام المحاسبي الشاملة
## ACCOUNTING SYSTEM AUDIT

**التاريخ:** 2026-06-06  
**المشروع:** gffyakxcfoeehtapelgd  
**الفرع:** `claude/festive-faraday-rGYhA`  
**الحالة:** تحليل فقط — لا تعديلات

---

## فهرس المشاكل المكتشفة

| الخطورة | المعرف | العنوان |
|---------|--------|---------|
| 🔴 حرج | CR-1 | `post_manual_journal_entries` يُدرج حقل `sync_status` غير موجود → دائماً يفشل |
| 🔴 حرج | CR-2 | `getStatement()` يحسب الرصيد الختامي من صفحة واحدة فقط |
| 🔴 حرج | CR-3 | قيود تحصيل المدينين معكوسة محاسبياً |
| 🔴 حرج | CR-4 | الإيداع يُصفّر حساب البنك في دفتر الأستاذ |
| 🟠 عالٍ | HI-1 | `getAccountBalance()` يُعيد رصيداً محلياً قديماً قبل الاستعلام عن الخادم |
| 🟠 عالٍ | HI-2 | معرّف حسابات المصروفات مضاعف البادئة: `EXP_EXP_<code>` |
| 🟠 عالٍ | HI-3 | حسابات المدينين `CUST_` غير مُدرجة في شجرة الحسابات |
| 🟠 عالٍ | HI-4 | `perform_daily_close` يلتقط بيانات غير مزامَنة |
| 🟠 عالٍ | HI-5 | مسارَان مختلفان لكشف الحساب يُنتجان نتائج متباينة |
| 🟠 عالٍ | HI-6 | غياب حسابات الإيرادات والرأس المال لنشاط الصرافة |
| 🟡 متوسط | ME-1 | فهارس مكررة على `account_ledger` (4 أزواج) |
| 🟡 متوسط | ME-2 | `reverse_transaction` يستخدم `CURRENT_DATE` بدلاً من تاريخ العكس |
| 🟡 متوسط | ME-3 | لا توجد شجرة حسابات مادية (جدول مستقل) |
| 🟡 متوسط | ME-4 | `get_opening_balance` مسح كامل دون حد أعلى للتاريخ عند التوسع |
| 🟡 متوسط | ME-5 | الغموض الدلالي في مصطلحَي استلام/تسليم |
| 🟡 متوسط | ME-6 | `get_admin_dashboard` يستعلم عن GENERAL_FUND مرتين |
| 🟢 منخفض | LO-1 | بيانات `daily_closings` غير مُستخدمة في حساب الأرصدة الافتتاحية |
| 🟢 منخفض | LO-2 | القيود اليدوية بدون ربط بـ `transactions` |
| 🟢 منخفض | LO-3 | `voucher_number_seq` مشترك — خطر التكرار عند إعادة الضبط |
| 🟢 منخفض | LO-4 | `get_account_statement` يحظر الوصول للوكلاء تماماً |

---

# 1. سلامة شجرة الحسابات

## 1.1 التصميم الحالي

لا توجد جداول `accounts` أو `chart_of_accounts` مستقلة. الحسابات **افتراضية** — مُشتقّة ديناميكياً من جداول أخرى عبر بوادئ نصية:

```
AGT_<user_id>            ← حسابات المندوبين   (من جدول users)
COMP_<account_prefix>    ← حسابات الشركات    (من جدول companies.account_prefix)
BNK_<bank_account_id>    ← الحسابات البنكية  (من جدول bank_accounts — UUID)
CUST_<debtor_id>         ← حسابات المدينين   (من جدول debtors — UUID)
EXP_<expense_code>       ← حسابات المصروفات  (من جدول expense_accounts.code)
GENERAL_FUND             ← الصندوق العام
CASH_GENERAL             ← الخزينة النقدية
COMP_GENERAL             ← حساب الشركات العام
```

**دليل — `get_chart_of_accounts` RPC:**
```sql
WITH accounts AS (
  SELECT 'AGT_' || u.id::TEXT AS account_id, u.display_name AS account_name, 'agents' AS category ...
  UNION ALL
  SELECT 'COMP_' || c.account_prefix AS account_id ...
  UNION ALL
  SELECT 'BNK_' || ba.id::TEXT AS account_id ...
  UNION ALL
  SELECT 'EXP_' || ea.code AS account_id ...
  UNION ALL
  SELECT ab.account_id ... WHERE ab.account_id IN ('GENERAL_FUND','CASH_GENERAL','COMP_GENERAL')
)
```

## 1.2 الأرصدة الفعلية في قاعدة البيانات

```
account_id                                    | balance
----------------------------------------------|----------
AGT_0193142e-4960-421d-aae0-b6fee9197722      | 1000.00
AGT_4c3538be-f4a0-42b3-bc96-e370a18ba5de      | 400.00
BNK_d53199fc-965d-437c-930f-4656d74d582c      | 1000.00
CASH_GENERAL                                  | 0.00
COMP_GENERAL                                  | 0.00
EXP_EXP_مصروفات_تشغيلية                       | 150.00   ← مشكلة HI-2!
GENERAL_FUND                                  | -2550.00
```

## 1.3 مشاكل شجرة الحسابات

### 🟠 HI-2 — بادئة المصروفات مضاعفة

**الدليل من DB:**
```
account_id = 'EXP_EXP_مصروفات_تشغيلية'
```

**السبب — `AccountingService.js:50,115`:**
```javascript
expense : (code) => `${ACCOUNT_PREFIXES.EXPENSE}${code}`,
// ACCOUNT_PREFIXES.EXPENSE = 'EXP_'

// في _buildExpenseEntries:
const expCode = tx.expense_type || 'MISC';    // ← يُستخدم expense_type
const expAcc  = AccountId.expense(expCode);   // = 'EXP_' + expCode
```

**لكن في `expense_accounts` table:** العمود `code` يُستخدم لتوليد accountId، بينما `expense_type` في transactions قد يساوي `code` الكامل أو بادئاً بـ `EXP_`.

**النتيجة:** `EXP_` + `EXP_مصروفات_تشغيلية` = `EXP_EXP_مصروفات_تشغيلية`

**التأثير المحاسبي:** حساب المصروف موجود في `account_ledger` ولكن لن يُجمع مع حساب `EXP_مصروفات_تشغيلية` إن وُجد — انشطار في سجل المصروفات.

---

### 🟠 HI-3 — حسابات `CUST_` غير مُدرجة في شجرة الحسابات

**الدليل:** `get_chart_of_accounts` RPC لا يُدرج `CUST_` ضمن الـ UNION:
- لا `UNION ALL SELECT 'CUST_' || d.id AS account_id FROM debtors d`

**الدليل من config.js:**
```javascript
ACCOUNT_PREFIXES = {
  AGENT    : 'AGT_',
  COMPANY  : 'COMP_',
  BANK     : 'BNK_',
  CUSTOMER : 'CUST_',  ← مُعرَّف لكن غير مُستخدم في شجرة الحسابات
  EXPENSE  : 'EXP_',
  SUSPENSE : 'SUSP_',  ← مُعرَّف لكن غير مُستخدم إطلاقاً
}
```

**التأثير:** إذا وُجدت قيود لحسابات المدينين في `account_ledger`، فهي غير مرئية في شجرة الحسابات وغير قابلة للمراجعة من الواجهة.

---

### 🟠 HI-6 — حسابات ناقصة لنشاط الصرافة والتحويلات

النظام يفتقر إلى فئات حسابية جوهرية:

| الفئة المفقودة | الأهمية | التأثير |
|----------------|---------|---------|
| الإيرادات (Revenue) | حرج | لا توجد إيرادات العمولات والرسوم |
| رأس المال/حقوق الملكية | عالٍ | لا يمكن عمل ميزانية عمومية |
| الحسابات المعلقة (SUSP_) | متوسط | مُعرَّف لكن غير مُستخدم |
| الحسابات المؤجلة | منخفض | لا يوجد |

---

### 🟡 ME-3 — غياب جدول شجرة الحسابات المستقل

**الوضع الحالي:** الحسابات تُشتق من جداول أخرى عبر RPC.

**المخاطر:**
- حذف مندوب → حذف حساب `AGT_` تلقائياً من الشجرة (لكن بقاء قيوده في `account_ledger`)
- إضافة مندوب → يظهر حسابه تلقائياً حتى لو لم يُجرِ أي معاملة بعد
- لا يمكن إضافة حسابات مخصصة خارج الفئات المُعرَّفة

---

# 2. سلامة القيد المزدوج

## 2.1 مصفوفة القيود لكل عملية

### التحصيل — `collection`

**حالة 1: مع شركة (`company_id`)**
```
DR: AGT_<agent_id>      + amount    ← صندوق الوكيل يزيد ✓
CR: COMP_<company_id>   + amount    ← رصيد الشركة يتراجع ✓
```
**الحكم:** ✅ صحيح — الوكيل تحصّل لصالح الشركة

**حالة 2: مع مدين (`customer_id`)** — **🔴 CR-3**
```
DR: CUST_<customer_id>  + amount    ← رصيد المدين يزيد ❌
CR: AGT_<agent_id>      + amount    ← صندوق الوكيل يتراجع ❌
```

**الدليل — `AccountingService.js:71-79`:**
```javascript
entries.push(
  { account_id: custAcc,  debit: tx.amount, credit: 0,        // DR: CUST_ ← يزيد الدين!
    description: `تخفيض دين العميل...` },
  { account_id: agentAcc, debit: 0,         credit: tx.amount, // CR: AGT_ ← يُنقص الوكيل!
    description: 'استلام من مدين لحساب صندوق الوكيل' }
);
```

**الصواب المحاسبي:**
```
DR: AGT_<agent_id>      + amount    ← الوكيل يتسلّم النقد
CR: CUST_<customer_id>  + amount    ← دين العميل ينقص
```

**التأثير:** كل تحصيل من مدين يُنقص رصيد الوكيل بدلاً من زيادته، ويُضخّم حساب المدين بدلاً من تخفيضه.

**حالة 3: نقدي عام (بدون شركة أو مدين)**
```
DR: AGT_<agent_id>      + amount    ← صندوق الوكيل يزيد ✓
CR: GENERAL_FUND        + amount    ← الصندوق العام يتراجع ✓
```
**الحكم:** ✅ صحيح

---

### الإيداع — `deposit` — **🔴 CR-4**

**الدليل — `AccountingService.js:92-109` (يُنشئ قسيمتين لمعاملة واحدة):**

```javascript
return [
  // قسيمة 2:
  { voucher_number: voucher2, account_id: bankAcc,  debit: tx.amount, credit: 0 },
  { voucher_number: voucher2, account_id: agentAcc, debit: 0, credit: tx.amount },
  // قسيمة 3:
  { voucher_number: voucher3, account_id: compAcc,  debit: tx.amount, credit: 0 },
  { voucher_number: voucher3, account_id: bankAcc,  debit: 0, credit: tx.amount },
];
```

**الأثر الصافي على كل حساب:**
```
BNK_<bank>:   +amount (voucher2) - amount (voucher3) = 0  ← يتصفر!
AGT_<agent>:  -amount (voucher2)
COMP_/GENERAL: +amount (voucher3)
```

**المشكلة:** حساب البنك `BNK_` يُصفَّر في كل إيداع. رصيد البنك في دفتر الأستاذ لا يعكس إجمالي الودائع.

**الدليل من DB:**
```sql
-- إجمالي دفتر الأستاذ
total_debit = 4700.00, total_credit = 4700.00, net = 0.00
-- رصيد BNK_ في account_balances = 1000.00
-- هذا يعني BNK_ تغيّر بمدخلات خارج منطق الإيداع الطبيعي
```

**نتيجة:** الكشف البنكي (`get_bank_statement`) يعتمد على `SUM(transactions.amount)` مباشرة، لا على `account_ledger`. نظامان متوازيان لتتبع نفس البيانات — خطر التناقض.

---

### المصروفات — `expense`

```
DR: EXP_<code>      + amount    ← حساب المصروف يزيد ✓
CR: AGT_<agent_id>  + amount    ← صندوق الوكيل يتراجع ✓
```
**الحكم:** ✅ صحيح محاسبياً (مع تحفظ HI-2 حول البادئة المضاعفة)

---

### الاستلام — `receipt`

**الدليل — `AccountingService.js:125-138`:**
```javascript
function _buildReceiptEntries(tx, voucher) {
  const receiverAcc = AccountId.agent(tx.agent_id);     // ← agent_id هو المستلِم
  const senderAcc   = tx.from_agent_id
    ? AccountId.agent(tx.from_agent_id)
    : (tx.company_id ? AccountId.company(tx.company_id) : GENERAL_ACCOUNT_ID);

  return [
    { account_id: receiverAcc, debit: tx.amount,  credit: 0 },  // DR: agent_id يستلم
    { account_id: senderAcc,   debit: 0, credit: tx.amount },   // CR: المصدر يرسل
  ];
}
```

**التحليل:**
- في سياق "استلام": المدير يستلم من الوكيل → رصيد الوكيل يجب أن **ينقص**
- لكن الكود: `agent_id` يكون **مدين** (رصيده يزيد)
- المصدر `from_agent_id` أو `GENERAL_FUND` يُخصم (رصيده يتراجع)

**🟡 ME-5 — الغموض الدلالي:** في عملية الاستلام، هل `tx.agent_id` هو:
- الوكيل الذي يُسلِّم المال للمدير؟ (سيصبح قيده خاطئاً)
- الوكيل الذي يستلم المال من المدير؟ (سيكون صحيحاً)

**مثال توضيحي:** رصيد GENERAL_FUND = -2550.00 (سالب) مع ارتفاع أرصدة الوكلاء يدل على أن GENERAL_FUND يُسلِّم للوكلاء — ما يُشير إلى أن "receipt" = الوكيل يستلم من الصندوق (تسليم فعلي) وليس العكس.

---

### التسليم — `delivery`

**الدليل — `AccountingService.js:141-154`:**
```javascript
function _buildDeliveryEntries(tx, voucher) {
  const giverAcc    = AccountId.agent(tx.agent_id);     // ← agent_id هو المُعطي
  const receiverAcc = tx.to_agent_id
    ? AccountId.agent(tx.to_agent_id)
    : (tx.company_id ? AccountId.company(tx.company_id) : GENERAL_ACCOUNT_ID);

  return [
    { account_id: receiverAcc, debit: tx.amount,  credit: 0 },  // DR: المستلم يزيد
    { account_id: giverAcc,    debit: 0, credit: tx.amount },   // CR: agent_id ينقص
  ];
}
```

**القيد:**
```
DR: to_agent / GENERAL_FUND   + amount
CR: AGT_<agent_id>            - amount    ← رصيد الوكيل ينقص
```

**إذا كان "تسليم" = الوكيل يُسلِّم للمدير:** رصيد الوكيل ينقص ✓ GENERAL_FUND يزيد ✓

---

### تسوية الإيداع الفاشل — `refund_settlement`

```
DR: AGT_<agent_id>    + amount    ← الوكيل يسترد المبلغ المسترجَع
CR: COMP_/GENERAL     + amount    ← مصدر الاسترداد يتراجع
```
**الحكم:** ✅ منطقي (مع تحفظ على تحديد المصدر الصحيح)

---

### ملاحظة: غياب قيود لأنواع عمليات أخرى

| العملية | هل تُولّد قيوداً محاسبية؟ |
|---------|--------------------------|
| الحوالات (transfers) | ❌ لا يوجد نوع `transfer` في `TRANSACTION_TYPES` |
| المديونيات (debtors) | ⚠️ جزئي — `update_debtor_balance` يُحدِّث `debtors.debt_amount` لكن لا يُنشئ قيوداً في `account_ledger` |
| الإيداعات الفاشلة (failed_deposits) | ❌ لا تُنشئ قيوداً تلقائياً — تعتمد على `refund_settlement` يدوياً |

**الدليل:** `TRANSACTION_TYPES` في config.js:
```javascript
COLLECTION, DEPOSIT, EXPENSE, RECEIPT, DELIVERY, REFUND_SETTLEMENT
```
لا يوجد `TRANSFER` أو `HAWALA` أو `FAILED_DEPOSIT`.

---

## 2.2 التحقق من التوازن في قاعدة البيانات

```sql
SELECT SUM(debit), SUM(credit), SUM(debit)-SUM(credit) AS net,
       COUNT(DISTINCT voucher_number) AS vouchers
FROM account_ledger;
-- النتيجة:
-- total_debit = 4700.00, total_credit = 4700.00, net = 0.00, vouchers = 4
```

**✅ جيد:** البيانات الموجودة متوازنة. لكن هذا ببيانات محدودة (4 قسائم فقط).

---

# 3. سلامة الأرصدة

## 3.1 تطابق account_ledger مع account_balances

```sql
SELECT ab.account_id, ab.balance AS stored,
       COALESCE(SUM(al.debit)-SUM(al.credit),0) AS computed, 
       ab.balance - COALESCE(SUM(al.debit)-SUM(al.credit),0) AS discrepancy
FROM account_balances ab
LEFT JOIN account_ledger al ON al.account_id = ab.account_id
GROUP BY ab.account_id, ab.balance;
```

**النتائج الحالية:** جميع الأرصدة متطابقة — discrepancy = 0 لكل الحسابات.

**✅ حالياً:** لا تباين. ولكن هذا في بيئة بيانات محدودة جداً (7 حسابات، 12 قيداً).

## 3.2 حالات يمكن أن يحدث فيها تباين

### 🔴 CR-4 — الإيداع يُصفّر BNK_

عند إيداع 1000 ريال:
- BNK_ تُضاف 1000 ثم تُخصم 1000 → صافي تأثير = 0
- `account_balances['BNK_x']` لا يتغير بالإيداع
- لكن التطبيق يحسب "استخدام السقف اليومي" من `transactions` مباشرة
- **تناقض:** كشف حساب البنك من `account_ledger` ≠ كشف البنك من `get_bank_statement`

### 🟠 HI-1 — الرصيد المحلي القديم

**الدليل — `AccountingService.js:344-348`:**
```javascript
async function getAccountBalance(accountId) {
  if (typeof db !== 'undefined' && db.isOpen()) {
    const localBalance = await getLocalAccountBalance(accountId);
    if (localBalance !== 0) return ok(localBalance);  // ← يعود مباشرة إذا non-zero
  }
  // Supabase لا يُستعلم إلا إذا كان الرصيد المحلي = 0
```

**المشكلة:** إذا كان الرصيد المحلي 0.01 (مثلاً بسبب خطأ سابق)، يُعاد هذا الرصيد الخاطئ دائماً دون استعلام Supabase.

**التأثير:** شاشة الملخص اليومي قد تعرض رصيداً قديماً للوكيل.

### Race Condition (موثّق في SYNC_CONFLICT_ROOT_CAUSE_ANALYSIS.md)

`account_balances` يكتب القيمة المطلقة عبر `upsert`. في `create_transaction_with_entries`:
```sql
ON CONFLICT (account_id) DO UPDATE
  SET balance = public.account_balances.balance
              + COALESCE((v_entry->>'debit')::NUMERIC, 0)
              - COALESCE((v_entry->>'credit')::NUMERIC, 0)
```

✅ **الجيد:** RPC يستخدم `balance = balance + delta` (تراكمي) وليس كتابة مطلقة — هذا يحمي من Race Condition في المسار الأساسي (online).

⚠️ **الخطر:** في المسار offline (عبر Repository + SyncQueue)، الكود يستخدم `upsert` بقيمة مطلقة:
```javascript
// في AccountingService.createTransactionWithEntries() — المسار offline:
await repo.upsert('account_balances', { account_id: acc, balance: newBalance })
// newBalance = balance_at_offline_time ← يُكتب فوق أي تحديث concurrent
```

---

# 4. مراجعة كشف الحساب

## 4.1 مسارَان متناقضان

| المعيار | `AccountingService.getStatement()` | `get_account_statement` RPC |
|---------|-----------------------------------|---------------------------|
| الملف | `AccountingService.js:373-411` | DB Function |
| مصدر البيانات | `repo.query(ACCOUNT_LEDGER)` | SQL مباشر |
| pagination | ✅ نعم (pageSize) | ❌ لا (كل النتائج) |
| الرصيد الافتتاحي | `get_opening_balance` RPC منفصل | محسوب داخل نفس SQL |
| الرصيد الجاري | ❌ خاطئ — من صفحة واحدة (CR-2) | ✅ صحيح — Window Function |
| المستخدِم | `DailySummaryComponent` | `AccountManagementComponent` |

## 4.2 🔴 CR-2 — خطأ الرصيد الختامي عند التصفح

**الدليل — `AccountingService.js:386-406`:**
```javascript
const result = await repo.query(TABLES.ACCOUNT_LEDGER, filters, { page, pageSize });
const entries = result.data.data || [];

let totalDebit = 0, totalCredit = 0;
for (const entry of entries) {      // ← فقط قيود الصفحة الحالية!
  totalDebit  += parseFloat(entry.debit  || 0);
  totalCredit += parseFloat(entry.credit || 0);
}

const openingBalance = await supabaseClient.rpc('get_opening_balance', ...);
const closingBalance = openingBalance + totalDebit - totalCredit;
// ← closingBalance خاطئ إذا page > 1 !
```

**المثال:**
- رصيد افتتاحي = 5000
- قيود ص1 (يناير 1-10): مجموع MD 3000، مجموع DN 1000
- قيود ص2 (يناير 11-20): مجموع MD 2000، مجموع DN 500
- الرصيد الختامي الصحيح = 5000 + 3000 + 2000 - 1000 - 500 = 8500
- ما يُحسَب في ص2: 5000 + 2000 - 500 = **6500** ❌

**الصواب:** استخدام `get_account_statement` RPC الذي يستخدم Window Function:
```sql
SUM(al.debit - al.credit) OVER (ORDER BY al.date, al.created_at ROWS UNBOUNDED PRECEDING) + v_opening_balance
```

## 4.3 `get_account_statement` RPC — تحليل

```sql
-- الرصيد الافتتاحي (سليم):
SELECT COALESCE(SUM(debit) - SUM(credit), 0) INTO v_opening_balance
FROM account_ledger
WHERE account_id = p_account_id AND date < p_from_date;

-- الرصيد الجاري (سليم):
SUM(al.debit - al.credit) OVER (ORDER BY al.date, al.created_at ...) + v_opening_balance AS running_balance
```

**✅ الجيد:** Window Function تُنتج رصيداً تراكمياً صحيحاً لكل سطر.

**⚠️ مشكلة الأداء عند التوسع (ME-4):**
```sql
-- يمسح كل القيود قبل p_from_date لحساب opening_balance
SELECT SUM(debit) - SUM(credit) FROM account_ledger
WHERE account_id = ? AND date < ?;
-- عند مليون قيد تاريخية: O(n) scan
```

الفهرس `idx_account_ledger_account_date` يُسرّع هذا لكن لا يُلغيه — في بيانات ضخمة يُصبح بطيئاً.

---

# 5. مراجعة الإقفال اليومي

## 5.1 كود `perform_daily_close`

```sql
-- يمنع الإقفال المزدوج ✓
SELECT id INTO v_existing_id FROM daily_closings WHERE date = p_date;
IF v_existing_id IS NOT NULL THEN
  RAISE EXCEPTION 'تم إقفال هذا اليوم مسبقاً: %', p_date;
END IF;

-- يلتقط snapshot من account_balances
SELECT jsonb_object_agg(account_id, balance) INTO v_snapshot FROM account_balances;

INSERT INTO daily_closings (date, closing_data) VALUES (p_date, v_snapshot);
```

## 5.2 تحليل نقاط الضعف

### 🟠 HI-4 — الإقفال يلتقط بيانات غير مزامَنة

**الوضع:** إذا كان لدى الوكيل قيود offline (sync_status = 'pending' في Dexie) لم تُزامَن بعد:
- `account_balances` على الخادم لا تعكس هذه القيود
- `perform_daily_close` يلتقط snapshot ناقص
- `closing_data` يحتوي على أرصدة خاطئة

**لا يوجد تحقق من القيود المعلقة قبل الإقفال.**

### ✅ الإقفال لا يمكن تنفيذه مرتين

**الدليل:** `UNIQUE INDEX daily_closings_date_key ON daily_closings(date)` + فحص في الكود. أي محاولة ثانية ترفع استثناءً.

### 🟢 LO-1 — بيانات الإقفال غير مُستخدمة في الحسابات اللاحقة

`get_account_statement` و`get_opening_balance` يحسبان الرصيد الافتتاحي من صفر عبر `SUM(account_ledger)` — لا يستخدمان `daily_closings.closing_data` كنقطة انطلاق.

**الأثر:** مع نمو البيانات، حساب الرصيد الافتتاحي يُصبح أبطأ تدريجياً لأنه يمسح كل التاريخ.

### ⚠️ الإقفال لا يُحقق توازن القيود

```sql
-- ما يفعله:
SELECT jsonb_object_agg(account_id, balance) INTO v_snapshot FROM account_balances;
-- لا يتحقق من: SUM(positive_balances) == SUM(negative_balances)
```

**التأثير:** يمكن إقفال يوم بميزانية عمومية مختلة دون تنبيه.

---

# 6. مراجعة حسابات الاستلام والتسليم

## 6.1 جدول القيود الكامل

| نوع العملية | من (`CR`) | إلى (`DR`) | توازن | ملاحظة |
|-------------|-----------|------------|-------|---------|
| تحصيل عام | GENERAL_FUND ↓ | AGT_ ↑ | ✅ | صحيح |
| تحصيل شركة | COMP_ ↓ | AGT_ ↑ | ✅ | صحيح |
| تحصيل مدين | AGT_ ↓ | CUST_ ↑ | ❌ | **معكوس — CR-3** |
| إيداع | AGT_ ↓ + BNK_ ↓ | BNK_ ↑ + COMP_ ↑ | ⚠️ | BNK_ يتصفر — CR-4 |
| مصروف | AGT_ ↓ | EXP_ ↑ | ✅ | صحيح (مع تحفظ HI-2) |
| استلام (من مصدر خارجي) | GENERAL/FROM_AGT ↓ | AGT_ ↑ | ⚠️ | غموض دلالي — ME-5 |
| تسليم (لمستلم خارجي) | AGT_ ↓ | GENERAL/TO_AGT ↑ | ⚠️ | غموض دلالي — ME-5 |
| تسوية إرجاع | COMP_/GENERAL ↓ | AGT_ ↑ | ✅ | منطقي |

## 6.2 🔴 CR-1 — `post_manual_journal_entries` دائماً يفشل

**الدليل من الكود (RPC المسترجع):**
```sql
INSERT INTO public.account_ledger (
  id, account_id, debit, credit, description, date, voucher_number,
  reference_id, created_at, sync_status  ← ❌ عمود غير موجود!
) VALUES (...)
```

**الدليل من DB Schema:**
```
account_ledger columns:
  id, voucher_number, date, account_id, debit, credit, description, reference_id, created_at
  -- لا يوجد عمود sync_status!
```

**نتيجة:** كل محاولة لإدخال قيود يدوية من واجهة إدارة الحسابات تفشل بخطأ:
```
ERROR 42703: column "sync_status" of relation "account_ledger" does not exist
```

**الأثر التشغيلي:** ميزة القيود اليدوية (`AccountManagementComponent._saveJournalEntry()`) معطلة تماماً.

## 6.3 التحقق من ازدواجية القيود

**هل يمكن ازدواجية قيود معاملة واحدة؟**

`create_transaction_with_entries` RPC يتحقق من الـ Idempotency:
```sql
IF (p_transaction->>'id') IS NOT NULL THEN
  SELECT id INTO v_existing_id FROM transactions WHERE id = (p_transaction->>'id')::UUID;
  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', TRUE, 'transaction_id', v_existing_id, 'message', 'المعاملة موجودة مسبقاً (idempotent)');
  END IF;
END IF;
```

✅ **يمنع ازدواجية المعاملة** إذا أُرسل نفس UUID.

⚠️ **لكن:** إذا كانت المعاملة أُنشئت offline بـ TEMP_ID ثم أُعيدت المحاولة بـ UUID مختلف → **إدخال مكرر محتمل**.

## 6.4 تحليل `reverse_transaction` RPC

```sql
-- يستخدم FOR UPDATE ← يمنع race condition ✓
SELECT * FROM transactions WHERE id = p_transaction_id FOR UPDATE;

-- يعكس القيود بتبديل debit وcredit ✓
INSERT INTO account_ledger (voucher_number, date, account_id, debit, credit, ...)
VALUES ('REV_' || p_transaction_id, CURRENT_DATE, v_entry.account_id, v_entry.credit, v_entry.debit, ...);

-- يُحدّث الأرصدة ✓
UPDATE account_balances SET balance = balance + v_entry.credit - v_entry.debit WHERE account_id = v_entry.account_id;
```

✅ **FOR UPDATE** يمنع الإلغاء المتزامن من مستخدمَين.

**🟡 ME-2 — تاريخ الإلغاء:**
```sql
VALUES ('REV_' || p_transaction_id, CURRENT_DATE, ...)  ← CURRENT_DATE دائماً
```

الإلغاء يُسجَّل بتاريخ اليوم بغض النظر عن تاريخ المعاملة الأصلية. هذا قد يكون مقصوداً لكنه يُربك التقارير التاريخية.

**مثال:** معاملة بتاريخ 1 يناير تُعكَس في 15 فبراير — يظهر الإلغاء في تقرير فبراير لا يناير.

---

# 7. مراجعة قابلية التوسع

## 7.1 الوضع الحالي للبيانات

```
account_ledger: 12 قيداً، 4 قسائم  ← بيانات تطوير محدودة جداً
account_balances: 7 حسابات
transactions: عدد محدود
```

## 7.2 تحليل عند 100,000 معاملة / 1,000,000 قيد

### أداء `get_opening_balance`

```sql
SELECT COALESCE(SUM(debit) - SUM(credit), 0)
FROM account_ledger
WHERE account_id = ? AND date < ?;
```

**الفهرس المتاح:** `idx_account_ledger_account_date` = `btree (account_id, date DESC)`

**عند مليون قيد** مع 50 حساباً فعلياً:
- كل حساب يملك ~20,000 قيد تاريخياً
- `SUM` على 20,000 صف لكل استعلام = مقبول
- لكن مع تزايد التاريخ (5-10 سنوات): **قد يصل لـ 500,000 قيد للحساب الواحد**

**🟡 ME-4 — الحل المقترح:** استخدام `daily_closings.closing_data` كنقطة انطلاق:
```sql
opening = daily_closings_balance_before_period + SUM(ledger WHERE date >= last_close AND date < from_date)
```

### أداء `get_account_statement`

```sql
SUM(al.debit - al.credit) OVER (ORDER BY al.date, al.created_at ROWS UNBOUNDED PRECEDING)
```

يعمل على مجموعة الفترة فقط (مُفلتَرة بـ `BETWEEN`) — أداء جيد مع الفهرس.

### فهارس مكررة — 🟡 ME-1

**الدليل من DB:**
```
idx_account_ledger_account_date → btree (account_id, date DESC)   ← TASK-4.4
idx_ledger_account_date         → btree (account_id, date DESC)   ← قديم
idx_account_ledger_reference    → btree (reference_id)            ← TASK-4.4
idx_ledger_reference_id         → btree (reference_id)            ← قديم
idx_ledger_account_id           → btree (account_id)              ← مُكرَّر (مُغطّى بالمركّب)
idx_ledger_date                 → btree (date DESC)               ← مُكرَّر جزئياً
```

**أزواج المكررات:**
1. `idx_account_ledger_account_date` = `idx_ledger_account_date`
2. `idx_account_ledger_reference` = `idx_ledger_reference_id`

**التأثير:** كل INSERT في `account_ledger` يُحدِّث 8 فهارس بدلاً من 4 — ضعف تكلفة الكتابة عند التحميل العالي.

### قيد `chk_debit_or_credit`

```sql
(debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)
```

✅ **جيد:** يمنع السطور المختلطة. لكن **يمنع أيضاً** إدخال سطر `debit=0, credit=0` (سطر صفري) — مشكلة إذا احتاج الكود إدخال سطر تعريفي.

---

# 8. مراجعة الـ RPCs الكاملة

## 8.1 خريطة RPCs المحاسبية

| RPC | الاستخدام | التحقق من الهوية | ذري (Atomic) | حالة |
|-----|----------|-----------------|-------------|------|
| `create_transaction_with_entries` | إنشاء معاملة + قيود | ✅ auth.uid() | ✅ BEGIN/COMMIT | ✅ سليم |
| `get_account_statement` | كشف حساب | ✅ ليس وكيلاً | ✅ | ✅ سليم |
| `get_opening_balance` | الرصيد الافتتاحي | ❌ بدون فحص | N/A | ⚠️ مكشوف |
| `perform_daily_close` | إقفال يومي | ✅ admin فقط | ✅ | ⚠️ HI-4 |
| `reverse_transaction` | عكس معاملة | ✅ admin فقط + FOR UPDATE | ✅ | ✅ سليم |
| `post_manual_journal_entries` | قيود يدوية | ✅ admin/assistant | ✅ | 🔴 CR-1 |
| `get_chart_of_accounts` | شجرة الحسابات | ✅ ليس وكيلاً | N/A | ⚠️ HI-3 |
| `get_admin_dashboard` | لوحة التحكم | ✅ admin/assistant | N/A | 🟡 ME-6 |
| `get_daily_summary` | ملخص يومي | ✅ | N/A | ✅ سليم |
| `get_bank_statement` | كشف بنكي | ✅ ليس وكيلاً | N/A | ✅ سليم |
| `update_debtor_balance` | رصيد المدين | ✅ auth.uid() + FOR UPDATE | ✅ | ✅ سليم |
| `get_next_voucher_number` | رقم قسيمة | ❌ بدون فحص | N/A | 🟢 مقبول |

### 🟢 LO-4 — `get_account_statement` يحجب الوكلاء تماماً

```sql
IF v_caller_role = 'agent' THEN RAISE EXCEPTION 'صلاحية مرفوضة'; END IF;
```

الوكيل لا يستطيع رؤية كشف حسابه الخاص — ربما مقصود، لكن يُحدّ من شفافية المعلومات للوكلاء.

### 🟡 ME-6 — `get_admin_dashboard` يستعلم مرتين عن نفس الأرصدة

```sql
-- في v_totals:
'general_fund': (SELECT COALESCE(balance,0) FROM account_balances WHERE account_id='GENERAL_FUND')
'cash_general': (SELECT COALESCE(balance,0) FROM account_balances WHERE account_id='CASH_GENERAL')

-- في RETURN:
'general_fund_balance': (SELECT COALESCE(balance,0) FROM account_balances WHERE account_id='GENERAL_FUND')
'cash_general_balance': (SELECT COALESCE(balance,0) FROM account_balances WHERE account_id='CASH_GENERAL')
```

4 Sub-queries إضافية لنفس البيانات مرتين — يُبطئ استجابة لوحة التحكم.

---

# ملخص المشاكل المرتبة حسب الأولوية

## 🔴 حرج — يؤثر على سلامة البيانات أو يُعطّل وظائف أساسية

| المعرف | الوصف | الملف | السطور | التأثير المحاسبي | التأثير التقني |
|--------|-------|-------|--------|-----------------|----------------|
| **CR-1** | `post_manual_journal_entries` يُدرج `sync_status` غير موجود | Supabase RPC | — | قيود يدوية مستحيلة | خطأ DB 42703 |
| **CR-2** | `getStatement()` يحسب الرصيد من صفحة واحدة فقط | AccountingService.js | 386-406 | رصيد ختامي خاطئ في التصفح | خطأ حسابي صامت |
| **CR-3** | قيود تحصيل المدين معكوسة (DR CUST_, CR AGT_) | AccountingService.js | 71-79 | رصيد الوكيل ينقص عند تحصيل دين | تشويه الأرصدة |
| **CR-4** | الإيداع يُصفّر حساب BNK_ في دفتر الأستاذ | AccountingService.js | 92-109 | BNK_ لا يعكس الودائع الفعلية | تناقض بين account_ledger وget_bank_statement |

## 🟠 عالٍ — يؤثر على موثوقية البيانات

| المعرف | الوصف | الملف | السطور | التأثير المحاسبي | التأثير التقني |
|--------|-------|-------|--------|-----------------|----------------|
| **HI-1** | `getAccountBalance()` يُعيد رصيداً محلياً قديماً | AccountingService.js | 344-348 | أرصدة مُبلَّغة خاطئة | Stale read |
| **HI-2** | بادئة `EXP_` مضاعفة في معرفات المصروفات | AccountingService.js | 50 | انشطار حساب المصروف | account_id خاطئ في DB |
| **HI-3** | حسابات CUST_ غير مُدرجة في شجرة الحسابات | Supabase RPC | — | ديون غير مرئية محاسبياً | chart يُخفي بيانات |
| **HI-4** | `perform_daily_close` يُقفل بدون التحقق من المزامنة | Supabase RPC | — | إقفال بأرصدة ناقصة | Snapshot unreliable |
| **HI-5** | مسارَان لكشف الحساب بنتائج مختلفة | AccountingService.js + RPC | 373-411 | تقارير متناقضة | Code inconsistency |
| **HI-6** | غياب حسابات الإيرادات ورأس المال | config.js + RPC | — | لا يمكن ميزانية عمومية | Schema incomplete |

## 🟡 متوسط — يؤثر على الصحة الهيكلية والأداء

| المعرف | الوصف | التأثير |
|--------|-------|---------|
| **ME-1** | 4 أزواج فهارس مكررة على account_ledger | ضعف تكلفة الكتابة |
| **ME-2** | `reverse_transaction` يستخدم CURRENT_DATE | تقارير تاريخية مُضلِّلة |
| **ME-3** | غياب جدول شجرة الحسابات المستقل | صعوبة إضافة حسابات مخصصة |
| **ME-4** | `get_opening_balance` مسح O(n) كامل | أداء يتراجع مع البيانات التاريخية |
| **ME-5** | غموض دلالي في استلام/تسليم | صعوبة التدقيق والمراجعة |
| **ME-6** | لوحة التحكم تستعلم عن نفس الأرصدة مرتين | 4 Sub-queries زائدة |

## 🟢 منخفض — تحسينات مستحسنة

| المعرف | الوصف | التأثير |
|--------|-------|---------|
| **LO-1** | `daily_closings.closing_data` غير مُستخدم لتحسين الأداء | فرصة تحسين missed |
| **LO-2** | القيود اليدوية بدون reference_id | صعوبة ربط القيد بمصدره |
| **LO-3** | `voucher_number_seq` مشترك — خطر التكرار عند إعادة الضبط | integrity risk نظري |
| **LO-4** | `get_account_statement` يحجب الوكلاء | شفافية محدودة |

---

## ترتيب الإصلاح المقترح

```
المرحلة 1 — إصلاح فوري (يوقف الضرر):
  CR-1: إزالة sync_status من post_manual_journal_entries
  CR-3: تصحيح قيود تحصيل المدين (DR: AGT_, CR: CUST_)
  HI-2: توحيد بناء معرف حساب المصروف

المرحلة 2 — إصلاح عالي الأولوية:
  CR-2: استبدال getStatement() بـ get_account_statement RPC
  CR-4: إعادة تصميم منطق قيود الإيداع
  HI-1: إصلاح أولوية جلب الرصيد (Supabase أولاً)
  ME-1: حذف الفهارس المكررة

المرحلة 3 — تعزيز الاكتمال:
  HI-3: إضافة CUST_ لشجرة الحسابات
  HI-4: فحص المزامنة قبل الإقفال
  HI-5: توحيد مسار كشف الحساب
  HI-6: إضافة فئات الإيرادات

المرحلة 4 — التحسين للمستقبل:
  LO-1: استخدام daily_closings كنقطة انطلاق للأرصدة
  ME-4: تحسين get_opening_balance
  ME-3: جدول chart_of_accounts مستقل
```

---

*هذا التقرير مبني بالكامل على الكود الفعلي في الفرع `claude/festive-faraday-rGYhA` واستعلامات SQL مباشرة على قاعدة البيانات `gffyakxcfoeehtapelgd`. كل استنتاج مرفق بدليل من ملف أو نتيجة استعلام.*
