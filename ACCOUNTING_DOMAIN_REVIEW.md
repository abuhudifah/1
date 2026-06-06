# مراجعة المجال المحاسبي — النظام المعماري الشامل
## Accounting Domain Review — Full Architectural Analysis
**التاريخ:** 2026-06-06  
**الفرع:** `claude/festive-faraday-rGYhA`  
**المشروع:** gffyakxcfoeehtapelgd  
**الملفات المُحلَّلة:** `AccountingService.js`, `config.js`, `AppStore.js`, `Repository.js`, `SyncService.js`, RPCs في Supabase

> **تنبيه:** هذا التقرير تحليل بحثي فقط. لا توجد تعديلات على الكود، ولا Commits، ولا تغييرات على قاعدة البيانات.

---

## الفهرس

1. [تحليل سير عمل جميع أنواع المعاملات](#1-تحليل-سير-العمل)
2. [القيود المحاسبية الفعلية الحالية](#2-القيود-الحالية)
3. [القيود المحاسبية الصحيحة المطلوبة](#3-القيود-الصحيحة)
4. [دور كل حقل في كل نوع معاملة](#4-دور-الحقول)
5. [تحليل دليل الحسابات](#5-دليل-الحسابات)
6. [هل يحتاج النظام جدول حسابات حقيقياً؟](#6-جدول-الحسابات)
7. [مراجعة كشف الحساب — أي مسار موثوق؟](#7-كشف-الحساب)
8. [تحليل أسباب تعارضات المزامنة](#8-تعارضات-المزامنة)

---

## 1. تحليل سير العمل

### نظرة عامة على الأنواع السبعة

```
COLLECTION      تحصيل نقدي من العميل أو الشركة أو مدين
DEPOSIT         إيداع مبلغ في البنك عبر شركة
EXPENSE         مصروف تشغيلي من صندوق الوكيل
RECEIPT         استلام مبلغ من وكيل آخر أو شركة
DELIVERY        تسليم مبلغ لوكيل آخر أو شركة
REFUND_SETTLEMENT  تسوية إيداع فاشل
(DEBTOR)        تتبع ديون العملاء — عبر COLLECTION مع customer_id
```

---

### 1.1 سير عمل COLLECTION (التحصيل)

**السيناريوهات الثلاثة:**

```
السيناريو أ — تحصيل من شركة (company_id موجود):
┌─────────────────────────────────────────────────────┐
│  العميل/الشركة تدفع مبلغاً للوكيل                   │
│                                                     │
│  الوكيل → يسجّل transaction نوع COLLECTION         │
│         → يحدد company_id                          │
│         → مصدر المبلغ: ذمة الشركة على الوكيل       │
│         → المبلغ يدخل صندوق الوكيل                 │
└─────────────────────────────────────────────────────┘

السيناريو ب — تحصيل من مدين (customer_id موجود):
┌─────────────────────────────────────────────────────┐
│  عميل مدين يسدّد دينه للوكيل                        │
│                                                     │
│  الوكيل → يسجّل transaction نوع COLLECTION         │
│         → يحدد customer_id                         │
│         → يستدعي RPC update_debtor_balance         │
│         → يُقلل رصيد المديونية في جدول debtors     │
└─────────────────────────────────────────────────────┘

السيناريو ج — تحصيل عام (لا company_id ولا customer_id):
┌─────────────────────────────────────────────────────┐
│  تحصيل نقدي عام بدون تحديد مصدر                   │
│  المبلغ يضاف لصندوق الوكيل من GENERAL_FUND         │
└─────────────────────────────────────────────────────┘
```

---

### 1.2 سير عمل DEPOSIT (الإيداع في البنك)

```
┌──────────────────────────────────────────────────────────────────┐
│  الوكيل يودع مبلغاً في البنك عبر شركة                           │
│                                                                  │
│  الخطوات:                                                        │
│  1. الوكيل يسجّل DEPOSIT مع company_id                          │
│  2. النظام ينشئ قسيمتين (voucher2 + voucher3)                  │
│  3. المبلغ يخرج من صندوق الوكيل → ينتقل عبر البنك → للشركة    │
│                                                                  │
│  التدفق:  AGT_ ← BNK_ ← COMP_                                  │
│  (أو يعكسه: AGT_ → المبلغ يخرج → COMP_ ترصده)                 │
└──────────────────────────────────────────────────────────────────┘
```

**ملاحظة:** التصميم الثنائي للقسيمتين يجعل BNK_ وسيطاً تقنياً — رصيده الصافي صفر دائماً.

---

### 1.3 سير عمل EXPENSE (المصروفات)

```
┌─────────────────────────────────────────────────────┐
│  الوكيل يصرف مبلغاً من صندوقه لمصروفات تشغيلية    │
│                                                     │
│  الوكيل → يسجّل EXPENSE                            │
│         → يحدد رمز المصروف (expense_code)          │
│         → المبلغ يخرج من صندوقه → يُسجَّل في EXP_ │
└─────────────────────────────────────────────────────┘
```

---

### 1.4 سير عمل RECEIPT (الاستلام بين الوكلاء)

```
┌─────────────────────────────────────────────────────────────────┐
│  وكيل يستلم مبلغاً من وكيل آخر أو من شركة                      │
│                                                                 │
│  agent_id = المُستلِم (receiver)                               │
│  from_agent_id = المُرسِل (sender) — إن كان وكيلاً             │
│  company_id = المُرسِل — إن كانت شركة                          │
│                                                                 │
│  التدفق: from_agent/company → agent_id                         │
│  النتيجة: رصيد agent_id يرتفع، رصيد المُرسِل ينخفض            │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.5 سير عمل DELIVERY (التسليم بين الوكلاء)

```
┌─────────────────────────────────────────────────────────────────┐
│  وكيل يُسلِّم مبلغاً لوكيل آخر أو لشركة                        │
│                                                                 │
│  agent_id = المُسلِّم (giver)                                  │
│  to_agent_id = المُستلِم — إن كان وكيلاً                       │
│  company_id = المُستلِم — إن كانت شركة                         │
│                                                                 │
│  التدفق: agent_id → to_agent/company                           │
│  النتيجة: رصيد agent_id ينخفض، رصيد المُستلِم يرتفع           │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.6 سير عمل REFUND_SETTLEMENT (تسوية الإيداعات الفاشلة)

```
┌─────────────────────────────────────────────────────────────────┐
│  إيداع سابق فشل في البنك — يجب استرداد المبلغ                  │
│                                                                 │
│  الخطوات:                                                       │
│  1. failed_deposit يتحول من 'pending' إلى 'refunded'           │
│  2. يُسجَّل REFUND_SETTLEMENT                                   │
│  3. المبلغ يعود من الشركة إلى صندوق الوكيل                     │
│                                                                 │
│  أو: الطرف الآخر يتنازل → عكس القيد → مسح ذمة الشركة          │
└─────────────────────────────────────────────────────────────────┘
```

---

### 1.7 سير عمل DEBTOR (المديونيات)

```
┌─────────────────────────────────────────────────────────────────┐
│  ليس نوعاً مستقلاً — يعمل عبر COLLECTION مع customer_id        │
│                                                                 │
│  الإنشاء: عند تسجيل COLLECTION بـ customer_id                  │
│          → ينشئ قيد في CUST_<customer_id>                       │
│          → يستدعي update_debtor_balance (Dexie) أو            │
│             update_debtor_balance RPC (Supabase)               │
│                                                                 │
│  التحصيل: عند دفع المدين لاحقاً                                 │
│           → يُسجَّل COLLECTION آخر                              │
│           → يُخفَّض رصيد CUST_ (وفقاً للنمط المقلوب حالياً)   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. القيود الحالية

> الكود المصدري: `AccountingService.js` — دوال `_build*Entries()`

### 2.1 COLLECTION — القيود الفعلية

**السيناريو أ: مع شركة (company_id)**
```
✅ صحيح:
DR  AGT_<agent_id>      amount    ← صندوق الوكيل يرتفع
CR  COMP_<company_id>   amount    ← ذمة الشركة تنخفض
```

**السيناريو ب: مع مدين (customer_id)**
```
⚠️ مقلوب (كود AccountingService.js السطور 80-85):
DR  CUST_<customer_id>  amount    ← ذمة المدين "ترتفع"؟
CR  AGT_<agent_id>      amount    ← صندوق الوكيل "ينخفض"؟

المتوقع الصحيح:
DR  AGT_<agent_id>      amount    ← صندوق الوكيل يرتفع (استلام نقد)
CR  CUST_<customer_id>  amount    ← ذمة المدين تنخفض (سداد دين)
```

**السيناريو ج: عام (GENERAL_FUND)**
```
✅ صحيح:
DR  AGT_<agent_id>      amount
CR  GENERAL_FUND        amount
```

---

### 2.2 DEPOSIT — القيود الفعلية

```
القسيمة الثانية (voucher2) — إيداع في البنك:
DR  BNK_<bank_id>       amount    ← رصيد البنك يرتفع
CR  COMP_<company_id>   amount    ← ذمة الشركة تنخفض

القسيمة الثالثة (voucher3) — نقل من البنك للشركة:
DR  COMP_<company_id>   amount    ← ذمة الشركة ترتفع
CR  AGT_<agent_id>      amount    ← صندوق الوكيل ينخفض

الصافي الفعلي:
AGT_:   0 - amount = -amount    ← صندوق الوكيل ينخفض ✅
COMP_:  -amount + amount = 0    ← ذمة الشركة صفر ← (تساؤل مطروح لاحقاً)
BNK_:   +amount → ثم voucher3 لا يؤثر على BNK_ ← البنك يبقى مرفوعاً!
```

**ملاحظة مهمة:** تحليل كود `_buildDepositEntries()` (سطر 92-109):
- Voucher2: DR BNK_, CR COMP_
- Voucher3: DR COMP_, CR AGT_
- **الصافي:** BNK_ = +amount (لا يُصفَّر)، COMP_ = صفر، AGT_ = -amount
- هذا يعني BNK_ **لا** يُصفَّر من القسيمتين — كل إيداع يزيد رصيد BNK_ بشكل دائم

---

### 2.3 EXPENSE — القيود الفعلية

```
✅ صحيح:
DR  EXP_<expense_code>  amount    ← سجل المصروف
CR  AGT_<agent_id>      amount    ← صندوق الوكيل ينخفض

⚠️ مشكلة تقنية:
EXP_ ID يُبنى بـ: AccountId.expense(expense_code)
                = ACCOUNT_PREFIXES.EXPENSE + expense_code
                = 'EXP_' + expense_code

إذا كان expense_code = 'EXP_مصروفات_تشغيلية':
النتيجة: 'EXP_EXP_مصروفات_تشغيلية'  ← double prefix
```

**دليل من قاعدة البيانات (account_balances الفعلية):**
```
account_id                          balance
EXP_EXP_مصروفات_تشغيلية           150.00
```
يُؤكد وجود المشكلة.

---

### 2.4 RECEIPT — القيود الفعلية

```
مع from_agent_id:
DR  AGT_<agent_id>           amount    ← المُستلِم ترتفع ✅
CR  AGT_<from_agent_id>      amount    ← المُرسِل تنخفض ✅

مع company_id:
DR  AGT_<agent_id>           amount    ✅
CR  COMP_<company_id>        amount    ✅

بدون مصدر:
DR  AGT_<agent_id>           amount    ✅
CR  GENERAL_FUND             amount    ✅
```

**تقييم:** القيود صحيحة — `agent_id` يُمثّل المُستلِم دائماً.

---

### 2.5 DELIVERY — القيود الفعلية

```
مع to_agent_id:
DR  AGT_<to_agent_id>        amount    ← المُستلِم ترتفع ✅
CR  AGT_<agent_id>           amount    ← المُسلِّم تنخفض ✅

مع company_id:
DR  COMP_<company_id>        amount    ✅
CR  AGT_<agent_id>           amount    ✅

بدون وجهة:
DR  GENERAL_FUND             amount    ✅
CR  AGT_<agent_id>           amount    ✅
```

**تقييم:** القيود صحيحة — `agent_id` يُمثّل المُسلِّم دائماً.

---

### 2.6 REFUND_SETTLEMENT — القيود الفعلية

```
مع company_id:
DR  AGT_<agent_id>           amount    ← صندوق الوكيل يرتفع ✅
CR  COMP_<company_id>        amount    ← ذمة الشركة تنخفض ✅

بدون company_id:
DR  AGT_<agent_id>           amount    ✅
CR  GENERAL_FUND             amount    ✅
```

**تقييم:** صحيح — يعكس تأثير الإيداع الفاشل.

---

## 3. القيود الصحيحة المطلوبة

### 3.1 الجدول المرجعي — المقارنة الكاملة

| النوع | السيناريو | القيد الحالي | القيد الصحيح | الحكم |
|-------|-----------|--------------|--------------|-------|
| COLLECTION | مع company | DR AGT_ / CR COMP_ | DR AGT_ / CR COMP_ | ✅ |
| COLLECTION | مع customer (مدين) | DR CUST_ / CR AGT_ | DR AGT_ / CR CUST_ | ❌ مقلوب |
| COLLECTION | عام | DR AGT_ / CR GENERAL | DR AGT_ / CR GENERAL | ✅ |
| DEPOSIT | القسيمة 2 | DR BNK_ / CR COMP_ | DR BNK_ / CR COMP_ | ✅ |
| DEPOSIT | القسيمة 3 | DR COMP_ / CR AGT_ | DR COMP_ / CR AGT_ | ✅ |
| EXPENSE | — | DR EXP_ / CR AGT_ | DR EXP_ / CR AGT_ | ✅ (خطأ ID فقط) |
| RECEIPT | من وكيل | DR AGT_ / CR AGT_(from) | DR AGT_ / CR AGT_(from) | ✅ |
| RECEIPT | من شركة | DR AGT_ / CR COMP_ | DR AGT_ / CR COMP_ | ✅ |
| DELIVERY | لوكيل | DR AGT_(to) / CR AGT_ | DR AGT_(to) / CR AGT_ | ✅ |
| DELIVERY | لشركة | DR COMP_ / CR AGT_ | DR COMP_ / CR AGT_ | ✅ |
| REFUND_SETTLEMENT | مع شركة | DR AGT_ / CR COMP_ | DR AGT_ / CR COMP_ | ✅ |

---

### 3.2 القيود الصحيحة — COLLECTION مع مدين (الإصلاح المطلوب)

**الوضع الحالي (خاطئ):**
```
عند تحصيل مبلغ من مدين:
DR  CUST_<customer_id>  amount   ← يُظهر "المديونية ترتفع" — عكس الواقع!
CR  AGT_<agent_id>      amount   ← يُظهر "الصندوق ينخفض" — عكس الواقع!
```

**التفسير الاقتصادي للخطأ:**
- من منظور الوكيل: المدين يدفع له → صندوق الوكيل **يرتفع** → لكن القيد يُظهر انخفاضه
- من منظور المديونية: المدين يسدّد → الذمة **تنخفض** → لكن القيد يُظهر ارتفاعها

**القيد الصحيح:**
```
عند تحصيل مبلغ من مدين (سداد دين):
DR  AGT_<agent_id>      amount   ← صندوق الوكيل يرتفع (استلام نقد)
CR  CUST_<customer_id>  amount   ← ذمة المدين تنخفض (تخفيض الدين)
```

---

### 3.3 تعريف طبيعة كل حساب

| نوع الحساب | الطبيعة | الزيادة | النقصان |
|------------|---------|---------|---------|
| AGT_ (صندوق الوكيل) | أصل | DR | CR |
| COMP_ (ذمة الشركة) | التزام تجاه الشركة | DR (سداد) | CR (ترتيب) |
| BNK_ (رصيد البنك) | أصل | DR | CR |
| CUST_ (ذمة المدين) | أصل (مستحقات) | DR (دين جديد) | CR (سداد) |
| EXP_ (مصروفات) | مصروف | DR | CR |
| GENERAL_FUND | رأس مال/صندوق مركزي | DR | CR |
| SUSP_ (موقوف) | مؤقت | DR/CR | CR/DR |

---

## 4. دور الحقول

### 4.1 جدول الأدوار الكامل

| الحقل | COLLECTION | DEPOSIT | EXPENSE | RECEIPT | DELIVERY | REFUND |
|-------|-----------|---------|---------|---------|----------|--------|
| `agent_id` | الوكيل المُحصِّل (CR في حالة مدين — خطأ) | الوكيل المُودِع (CR) | الوكيل الصارف (CR) | **المُستلِم** (DR) | **المُسلِّم** (CR) | الوكيل المُستردّ (DR) |
| `from_agent_id` | غير مستخدم | غير مستخدم | غير مستخدم | المُرسِل (CR) | غير مستخدم | غير مستخدم |
| `to_agent_id` | غير مستخدم | غير مستخدم | غير مستخدم | غير مستخدم | المُستلِم (DR) | غير مستخدم |
| `company_id` | مصدر المبلغ (CR) | وسيط الإيداع | غير مستخدم | مصدر المبلغ (CR) | وجهة المبلغ (DR) | مصدر استرداد (CR) |
| `customer_id` | المدين الذي يسدّد | غير مستخدم | غير مستخدم | غير مستخدم | غير مستخدم | غير مستخدم |
| `bank_id` | غير مستخدم | تحديد حساب BNK_ | غير مستخدم | غير مستخدم | غير مستخدم | غير مستخدم |
| `expense_code` | غير مستخدم | غير مستخدم | تحديد حساب EXP_ | غير مستخدم | غير مستخدم | غير مستخدم |

---

### 4.2 التناقض المعماري في agent_id

**المشكلة:** `agent_id` يحمل دوراً مختلفاً في كل نوع معاملة:

```
COLLECTION : agent_id = المُحصِّل  → القيد DR (يستلم المال)
DEPOSIT    : agent_id = المُودِع   → القيد CR (يعطي المال)
EXPENSE    : agent_id = الصارف    → القيد CR (يعطي المال)
RECEIPT    : agent_id = المُستلِم  → القيد DR (يستلم المال)
DELIVERY   : agent_id = المُسلِّم  → القيد CR (يعطي المال)
REFUND     : agent_id = المُستردّ  → القيد DR (يستلم المال)
```

**الدلالة:** لا يمكن معرفة جهة القيد لـ `agent_id` بدون معرفة نوع المعاملة. التصميم صحيح لكنه يتطلب قراءة `type` دائماً.

---

### 4.3 التناقض في RECEIPT مقابل DELIVERY

```
RECEIPT:   agent_id → المُستلِم
DELIVERY:  agent_id → المُسلِّم

من منظور وكيل A يُرسل لوكيل B:
- يُسجّل A: DELIVERY بـ agent_id=A، to_agent_id=B
- ينتج: DR AGT_B, CR AGT_A  ✅

من منظور وكيل B الذي يستلم من A:
- يُسجّل B: RECEIPT بـ agent_id=B، from_agent_id=A
- ينتج: DR AGT_B, CR AGT_A  ✅

المشكلة: نفس المبلغ يُسجَّل مرتين إذا سجّل كلاهما!
الحل المتوقع: نظام الموافقة أو الإلغاء التلقائي.
(لم يُلاحَظ وجود آلية لذلك في الكود المُحلَّل)
```

---

## 5. دليل الحسابات

### 5.1 الحسابات الموجودة فعلاً (من account_balances + account_ledger)

```sql
-- الحسابات الموجودة في قاعدة البيانات:
EXP_EXP_مصروفات_تشغيلية   150.00
(+ حسابات AGT_, COMP_, BNK_, GENERAL_FUND حسب البيانات الفعلية)
```

**نمط التسمية الفعلي:**
```
AGT_<uuid>          حسابات الوكلاء
COMP_<uuid>         حسابات الشركات
BNK_<uuid>          حسابات البنوك
CUST_<uuid>         حسابات المدينين
EXP_<code>          حسابات المصروفات  (مع خطر double prefix)
GENERAL_FUND        الصندوق المركزي (ثابت)
```

---

### 5.2 الحسابات المُعرَّفة في config.js مقابل المستخدمة

| البادئة | مُعرَّفة في config | مستخدمة في AccountingService | تظهر في DB |
|--------|------------------|------------------------------|------------|
| `AGT_` | ✅ | ✅ | ✅ |
| `COMP_` | ✅ | ✅ | ✅ |
| `BNK_` | ✅ | ✅ | ✅ |
| `CUST_` | ✅ | ✅ (مقلوب) | احتمالي |
| `EXP_` | ✅ | ✅ (double prefix) | ✅ (مشوّه) |
| `SUSP_` | ✅ | **❌ لا يُستخدم أبداً** | غير موجود |
| `GENERAL_FUND` | ✅ (ثابت) | ✅ | ✅ |

---

### 5.3 الحسابات المفقودة لنظام صرافة احترافي

| الحساب | الغرض | هل موجود؟ |
|--------|--------|-----------|
| إيرادات العمولة | تسجيل دخل النظام من العمليات | ❌ غائب |
| إيرادات رسوم التحويل | الفرق بين سعر الشراء/البيع | ❌ غائب |
| رأس المال / حقوق الملكية | الميزانية العمومية | ❌ غائب |
| الحسابات الموقوفة (SUSP_) | معاملات في الطريق / قيد التسوية | ❌ غير مستخدم رغم تعريفه |
| ذمم التحويلات (بين الفروع) | تتبع التحويلات بين وكلاء | ❌ غائب |
| فروق العملات | خسائر/مكاسب تحويل العملة | ❌ غائب |
| الأرصدة الافتتاحية | ترحيل من دورة سابقة | ❌ غائب |

---

### 5.4 الحسابات الموجودة لكن بها مشاكل

| الحساب | المشكلة |
|--------|---------|
| `EXP_*` | double prefix عند تمرير expense_code بـ "EXP_" في البداية |
| `CUST_*` | القيود مقلوبة — DR/CR معكوسان |
| `BNK_*` | الرصيد لا يُصفَّر بعد DEPOSIT — يتراكم مع كل إيداع |
| `SUSP_` | مُعرَّف لكن لا يُستخدم — فرصة ضائعة لتتبع المعاملات المعلقة |

---

## 6. جدول الحسابات

### 6.1 هل يحتاج النظام جدول حسابات حقيقياً؟

**الوضع الحالي:**
- لا يوجد جدول `accounts` مستقل
- الحسابات تُنشأ ضمنياً عند أول قيد
- `get_chart_of_accounts` RPC يولّد الحسابات من DISTINCT على `account_ledger`
- `account_balances` يحمل الأرصدة لكن بدون اسم أو نوع أو تصنيف

**مقارنة المقاربتين:**

| المعيار | النظام الحالي (افتراضي) | جدول حسابات حقيقي |
|---------|------------------------|-------------------|
| إنشاء الحسابات | تلقائي عند أول قيد | صريح وموثّق |
| تصنيف الحسابات | من البادئة فقط | حقل `type` مخصص |
| الأسماء العربية | غير موجودة | حقل `name` |
| منع الأخطاء | لا يمكن | ✅ يمكن التحقق بـ FK |
| شجرة الحسابات | مسطّحة | يمكن تعريف parent_id |
| التقارير | صعبة | سهلة مع joins |

**التوصية المعمارية (بدون تنفيذ):**
نعم، النظام يحتاج جدول حسابات حقيقي لأسباب:
1. منع إنشاء حسابات خاطئة (مثل EXP_EXP_...)
2. تعريف نوع كل حساب (أصل/التزام/إيراد/مصروف)
3. تمكين ميزانية عمومية وقائمة دخل حقيقية
4. تعيين أسماء عربية قابلة للعرض

---

### 6.2 هل تحتاج لحسابات إيرادات؟

**الجواب: نعم — غائبة تماماً.**

نظام الصرافة يجني دخله من:
- هامش سعر الصرف (الفرق بين سعر الشراء والبيع)
- عمولة على التحويلات
- رسوم الإيداع/السحب

**حالياً:** لا يوجد قيد محاسبي يُسجِّل هذا الدخل. كل العمليات كأنها بدون ربح.

---

### 6.3 هل تحتاج لحسابات رأس المال؟

**الجواب: نعم — لكن ليست ضرورية للتشغيل اليومي.**

`GENERAL_FUND` يعمل كبديل غير رسمي لرأس المال، لكن:
- لا يمكن الحصول على ميزانية عمومية صحيحة
- لا يمكن حساب صافي الأصول
- لا يمكن التحقق من معادلة الأصول = الخصوم + حقوق الملكية

---

### 6.4 هل تحتاج لحسابات موقوفة (Suspense)?

**الجواب: نعم — وهي مُعرَّفة فعلاً ولم تُستخدم.**

`SUSP_` موجود في `ACCOUNT_PREFIXES` لكن:
- لا توجد دالة `AccountId.suspense()` في AccountingService
- لا يوجد أي استخدام في `_build*Entries()`
- مناسب لـ: DELIVERY/RECEIPT قيد الانتظار، DEPOSIT قيد المعالجة

---

### 6.5 هل تحتاج لحسابات تسوية؟

**الجواب: نعم — لـ failed_deposits بشكل خاص.**

تسوية الإيداعات الفاشلة تحتاج حساباً وسيطاً يُثبت:
- المبلغ أُودع في البنك (DR BNK_)
- لم يُستلم من الطرف الآخر بعد (CR SUSP_)
- عند الاسترداد: DR SUSP_, CR BNK_
- عند الإلغاء: DR AGT_, CR SUSP_

---

## 7. كشف الحساب

### 7.1 المساران المتاحان

```
المسار 1: AccountingService.getStatement() — JavaScript
المسار 2: get_account_statement RPC — PostgreSQL
```

---

### 7.2 تحليل المسار الأول: getStatement()

**الكود (AccountingService.js سطور 373-411):**

```javascript
async getStatement(accountId, fromDate, toDate, page = 0, limit = STATEMENT_PAGE_SIZE) {
  // الخطوة 1: يجلب الرصيد الافتتاحي من account_balances
  const openingBalance = await getLocalAccountBalance(accountId);
  
  // الخطوة 2: يجلب القيود من account_ledger بـ pagination
  const entries = await db.account_ledger
    .where('account_id').equals(accountId)
    .and(e => e.date >= fromDate && e.date <= toDate)
    ...paginate...

  // الخطوة 3: يحسب الإجماليات من الصفحة الحالية فقط
  const totalDebit  = entries.reduce((s, e) => s + e.debit, 0);
  const totalCredit = entries.reduce((s, e) => s + e.credit, 0);
  
  // الخطوة 4: يحسب الرصيد الختامي
  const closingBalance = openingBalance + totalDebit - totalCredit;
}
```

**المشاكل:**

| المشكلة | الوصف | التأثير |
|---------|--------|---------|
| أرصدة الافتتاح من Dexie | يقرأ `getLocalAccountBalance` → يُرجع 0 إذا لم يكن في IndexedDB | رصيد افتتاحي خاطئ offline |
| Pagination خاطئة | `totalDebit/Credit` من الصفحة الحالية فقط | `closingBalance` خاطئ في page > 0 |
| لا window function | لا يوجد running balance لكل قيد | لا يمكن عرض عمود "الرصيد بعد القيد" |
| أولوية Dexie | يقرأ من IndexedDB حتى إذا كانت بيانات قديمة | قد يعرض بيانات غير محدّثة |

---

### 7.3 تحليل المسار الثاني: get_account_statement RPC

**مصدر الكود (من استعلام Supabase السابق):**

```sql
CREATE OR REPLACE FUNCTION get_account_statement(
  p_account_id TEXT, p_from_date DATE, p_to_date DATE,
  p_page INT DEFAULT 0, p_limit INT DEFAULT 50
)

-- يحسب الرصيد الافتتاحي من القيود قبل from_date:
opening_balance AS (
  SELECT COALESCE(SUM(debit) - SUM(credit), 0) as balance
  FROM account_ledger
  WHERE account_id = p_account_id AND date < p_from_date
),

-- يستخدم Window Function لـ running_balance:
entries_with_balance AS (
  SELECT *, 
    ob.balance + SUM(debit - credit) OVER (
      ORDER BY date, id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) as running_balance
  FROM account_ledger, opening_balance ob
  WHERE account_id = p_account_id 
    AND date BETWEEN p_from_date AND p_to_date
)
```

**ومن ناحية الصلاحيات:**
```sql
IF v_caller_role = 'agent' THEN
  RAISE EXCEPTION 'صلاحية مرفوضة';
END IF;
```

**مميزات وعيوب:**

| الجانب | المميزات | العيوب |
|--------|----------|--------|
| الرصيد الافتتاحي | من مجموع القيود الكاملة ✅ | — |
| Running Balance | Window Function دقيقة ✅ | — |
| Pagination | صحيحة لأن الرصيد يُحسب مستقلاً ✅ | — |
| الصلاحيات | admin فقط | الوكلاء محجوبون! |
| البيانات | دائماً من Supabase | لا يعمل offline |

---

### 7.4 الحكم: أي مسار موثوق؟

```
┌─────────────────────────────────────────────────────────────┐
│  الحكم: get_account_statement RPC هو المسار الموثوق         │
│                                                             │
│  لأنه:                                                      │
│  ✅ يحسب الرصيد الافتتاحي من السجل الكامل (ليس من cache)   │
│  ✅ يستخدم Window Function للدقة الكاملة                    │
│  ✅ Pagination صحيحة بغض النظر عن رقم الصفحة               │
│  ✅ يعمل على Supabase مباشرة (single source of truth)      │
│                                                             │
│  أما getStatement() في AccountingService.js فهو:           │
│  ⚠️ مسار offline مؤقت — مقبول للاستخدام عند انقطاع الشبكة  │
│  ❌ لكن غير موثوق كمرجع نهائي بسبب خطأ الـ pagination     │
│                                                             │
│  القيد الوحيد على RPC: الوكلاء محجوبون منه حالياً          │
│  (RAISE EXCEPTION للـ agent role)                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. تعارضات المزامنة

### 8.1 تصنيف التعارضات: محاسبية أم مزامنة؟

**الجدول التحليلي:**

| الجدول | سبب التعارض | نوعه | مصدره |
|--------|-------------|------|--------|
| `companies` | لا يوجد `updated_at` → Repository.js يحقن null دائماً → يعدّه تعارضاً | **مزامنة** | bug في Repository.js:181-182 |
| `notifications` | نفس مشكلة غياب `updated_at` | **مزامنة** | bug في Repository.js:181-182 |
| `failed_deposits` | `updated_at` موجود + trigger لكن منطق الكشف يقارن timestamps خاطئة | **مزامنة** | bug في SyncService conflict detection |
| `account_ledger` | لا `sync_status` → `post_manual_journal_entries` يفشل دائماً | **محاسبية** | خطأ في RPC (عمود غير موجود) |
| `account_balances` | delta-based في RPC, absolute في offline → ممكن لكن نادر | **محاسبية** | تباين المنطق |
| `transactions` | `replaceTempId()` لا يحدّث `reference_id` في JSON data | **مزامنة + محاسبية** | bug يُسبب FK violations |

---

### 8.2 تسلسل التعارض في companies

```
1. المستخدم يُنشئ شركة offline
   → Dexie: { id: "temp_xxx", name: "...", updated_at: null }
   
2. عند المزامنة:
   → Repository.js:181-182 يحقن updated_at الحالي
   → يُرسَل لـ Supabase

3. عند محاولة sync لاحقة:
   → يُقرأ من Supabase: { updated_at: "2026-06-06T10:00:00Z" }
   → يُقارَن بـ Dexie: { updated_at: null }
   → null < timestamp → يُعدّ تعارضاً!
```

**الجذر:** جدول `companies` لا يحتوي `updated_at` — لذا القيمة دائماً null في Dexie.

---

### 8.3 تسلسل التعارض في failed_deposits

```
1. failed_deposit يُنشأ online: { status: 'pending', updated_at: T1 }
   → يُحفظ في Dexie بـ updated_at = T1

2. تتحديث حالته إلى 'claimed' في Supabase: updated_at = T2
   → SyncService يجلب التحديث → يُحفظ Dexie: updated_at = T2

3. الوكيل يعدّله offline: updated_at = T3 (وقت التعديل المحلي)
   → T3 > T2 (طبيعي — local time)

4. عند المزامنة:
   → يُقارَن T3 (local) بـ T2 (server's latest)
   → T3 > T2 → لكن المنطق يعدّه "server أحدث من local" — false positive
```

---

### 8.4 تسلسل التعارض المحاسبي: replaceTempId()

```
1. offline: تُنشأ transaction بـ id="temp_abc"
   → تُنشأ account_ledger entries بـ reference_id="temp_abc"
   → كلاهما يُحفظ في SyncQueue

2. عند المزامنة — تُنشأ transaction في Supabase:
   → تُعيَّن real_id="uuid-xyz"
   → replaceTempId() يُحدِّث:
      - sync_queue.record_id: temp_abc → uuid-xyz ✅
      - sync_queue.data.reference_id: temp_abc → ??? ❌ (لا يُحدَّث)

3. عند مزامنة account_ledger entries:
   → data.reference_id = "temp_abc" (لا يزال المؤقت)
   → Supabase يرفض لأن "temp_abc" غير موجود في transactions
   → FK violation → مزامنة فاشلة → تعارض
```

---

### 8.5 الحالات المحاسبية المُحتملة للتعارض (غير الناتجة عن sync)

| الحالة | الوصف | التأثير |
|--------|--------|---------|
| إيداع فاشل + REFUND مزدوج | تسجيل استرداد مرتين | تضاعف الرصيد |
| RECEIPT + DELIVERY من طرفين | كلا الوكيلين يُسجّلان نفس العملية | تضاعف القيود |
| `perform_daily_close` مرتين | UNIQUE constraint على date يمنعه | ✅ محمي |
| قيد يدوي فاشل صامت | `post_manual_journal_entries` يفشل لكن لا تنبيه | ❌ فجوة |

---

## الخلاصة التنفيذية

### ترتيب الأولويات بناءً على التأثير

| الأولوية | المشكلة | التأثير | الحل المعماري المقترح |
|----------|---------|---------|----------------------|
| 🔴 حرج | قيود COLLECTION/مدين مقلوبة | أرصدة CUST_ خاطئة | تبديل DR/CR في `_buildCollectionEntries` |
| 🔴 حرج | `replaceTempId()` لا يُحدِّث reference_id | FK violations عند مزامنة القيود | تحديث `data.reference_id` مع `record_id` |
| 🔴 حرج | `post_manual_journal_entries` يُدرج `sync_status` | كل قيد يدوي يفشل | حذف `sync_status` من INSERT |
| 🟠 عالية | double prefix في EXP_ IDs | حسابات مصروفات مشوّهة | تطبيع expense_code قبل بناء ID |
| 🟠 عالية | companies/notifications بلا `updated_at` | تعارضات مزامنة زائفة | إضافة عمود `updated_at` + trigger |
| 🟠 عالية | `getAccountBalance()` يُرجع Dexie الأولوية | أرصدة قديمة تُعرض | عكس الأولوية: Supabase أولاً |
| 🟡 متوسطة | BNK_ لا يُصفَّر بعد DEPOSIT | رصيد بنكي تراكمي خاطئ | مراجعة تصميم قسيمتي DEPOSIT |
| 🟡 متوسطة | Agents محجوبون من get_account_statement | لا يمكن للوكيل رؤية كشف حسابه | رفع الحجب أو إنشاء RPC مخصص |
| 🟡 متوسطة | Pagination خاطئة في getStatement() | رصيد ختامي خاطئ عند page > 0 | حساب الرصيد مستقلاً عن الصفحة |
| 🟢 منخفضة | غياب حسابات إيرادات | لا قائمة دخل | إضافة حسابات REV_ |
| 🟢 منخفضة | SUSP_ غير مستخدم | معاملات معلقة غير مُتتبَّعة | تفعيل SUSP_ في DEPOSIT/RECEIPT |

---

### نموذج قاعدة بيانات مقترح (بدون تنفيذ)

```
accounts (جدول مقترح)
├── id           TEXT  PK  (AGT_xxx, COMP_xxx, ...)
├── name         TEXT      (اسم قابل للعرض بالعربية)
├── type         ENUM  (asset, liability, equity, revenue, expense)
├── sub_type     TEXT  (agent_fund, company_payable, bank, debtor, ...)
├── parent_id    TEXT  FK self
├── is_active    BOOL
└── created_at   TIMESTAMPTZ

يحلّ مشاكل:
- منع إنشاء حسابات EXP_EXP_ تلقائياً
- تمكين ميزانية عمومية
- تمكين قائمة دخل
- إضافة أسماء عربية للتقارير
```

---

*انتهى التقرير — تحليل بحثي فقط، بدون تعديلات على الكود أو قاعدة البيانات*
