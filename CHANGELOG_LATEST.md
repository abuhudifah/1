# تقرير التحديثات الشامل — نظام أبو حذيفة للصرافة

---

## جلسة 2026-06-25

### 1. إعادة تسمية "تحويل مباشر" → "تسليم عهدة" و"طلب أموال" → "طلب عهدة"

**الملفات المُعدَّلة:**

| الملف | التغيير |
|-------|---------|
| `config.js` | `TRANSACTION_TYPE_LABELS.delivery` → `'تسليم عهدة'` |
| `services/AccountingService.js` | نص القيد الدفتري + إشعار القبول |
| `components/DataEntryComponent.js` | خيارات القائمة + عناوين الإشعارات + toast |
| `components/AccountManagementComponent.js` | تسميات كشف الحساب |
| `components/DailySummaryComponent.js` | فلتر نوع العملية |
| `services/PrintService.js` | نصوص الطباعة |
| `components/NotificationsComponent.js` | إشعار رفض الطلب |

**قواعد التسمية الجديدة:**
- `TRANSACTION_TYPES.DELIVERY` (القيمة في DB: `'delivery'`) → يُعرض: **تسليم عهدة**
- طلب تحويل بانتظار موافقة → **طلب عهدة**

### 2. تصحيح عمود التفاصيل في كشف الحساب (لكم / عليكم)

**المشكلة:** `_describeLedgerEntry` في `AccountManagementComponent.js` كانت تعرض النصوص معكوسة في عمود التفاصيل رغم صحة أعمدة لكم/عليكم المحاسبية.

**الحل:**

| الحالة | قبل (خاطئ) | بعد (صحيح) |
|--------|------------|------------|
| المستقبل يشاهد حسابه (مدين) | لكم حوالة نقدية واردة... | **عليكم** حوالة نقدية واردة تسليم عهدة... |
| المرسل يشاهد حسابه (دائن) | عليكم حوالة نقدية... | **لكم** حوالة نقدية تسليم عهدة... |

نفس التصحيح طُبِّق على `PrintService.js`.

> القيود المخزنة في DB بواسطة `_buildDeliveryEntries` كانت **صحيحة أصلاً** — التصحيح فقط على العرض الديناميكي في الواجهة والطباعة.

### 3. Web Push API — إشعارات حقيقية عند إغلاق التطبيق

- جدول `push_subscriptions` + RLS + Trigger على `notifications`
- Edge Function `send-push` (VAPID keys، webhook secret)
- `sw.js` v8: push handler + `notification-icon.png`
- `utils/NotificationSound.js`: `subscribeToPush()`
- `config.js`: `VAPID_PUBLIC_KEY`

### 4. أيقونة إشعار أحادية اللون (ناقوس أبيض)

- `assets/icons/notification-icon.png`: ناقوس أبيض RGBA — يحل مشكلة المربع الأبيض على Android
- `assets/icons/icon-*.png`: تصميم احترافي جديد للحاسبة
- `scripts/generate-icons.js`: دعم RGBA + تصميم محسَّن

### 5. إشعار رفض طلب العهدة

**الملف:** `components/NotificationsComponent.js`

أُضيف إشعار للطالب عند رفض طلبه، يحمل اسم الرافض والمبلغ بصيغة `warning`.

---

## جلسة 2026-06-22
**الفرع:** `claude/fervent-wright-cxm031`

### 1. إصلاح RLS — حلقة لا نهائية في جدول `users`
**migration:** `20260619000002_rls_cleanup_legacy_policies.sql`

سياسة `admin_can_update_any_quick_hash` كانت تتسبب في infinite recursion عند أي محاولة UPDATE لأن السياسة نفسها تستعلم من `users`. تم حذفها — صلاحية UPDATE للمدير مكفولة بالسياسة العامة `allow_admin_full_access`.

### 2. نوع عملية جديد: `external_handover` (تسليم عهدة)
**الملفات:** `DataEntryComponent.js`، `AccountingService.js`، `DailySummaryComponent.js`، `config.js`

- **`DataEntryComponent._saveExternalHandover()`:** يحفظ `handover_destination` (وقتي) و`expense_type` (دائم في DB) معًا لضمان عمل القيد المحاسبي بعد التحديث
- **`AccountingService._buildExternalHandoverEntries()`:** يقرأ الوجهة من `tx.handover_destination || tx.expense_type`؛ وجهة `debtor_settlement` → DR `DEBTOR_SETTLEMENT` / CR `AGT_<agent>`؛ وجهة `general_fund` → DR `GENERAL_FUND` / CR `AGT_<agent>`
- **`DailySummaryComponent`:** إضافة بطاقة KPI شرطية لـ `external_handover` وأيقونة `📤` في خريطة الأنواع
- **`config.js`:** إضافة `EXTERNAL_HANDOVER` لـ `TRANSACTION_TYPES` و`TRANSACTION_TYPE_LABELS`

### 3. إصلاح `IdleTimer` — حذف التحذير المسبق
**الملف:** `services/IdleTimer.js`

حُذف toast التحذير الذي كان يظهر 60 ثانية قبل انتهاء المهلة. بعد الإصلاح: عند انتهاء المهلة يتم تسجيل الخروج مباشرةً ويظهر إشعار toast فوق شاشة الدخول.  
المهلات الفعلية: **30 دقيقة** للمندوب، **90 دقيقة** للمدير والمساعد.

### 4. `DebtorsComponent` — فلتر المنطقة
إضافة فلتر بالمنطقة في واجهة المدير لتصفية قائمة المدينين.

---

## جلسة 2026-06-08
**الفرع:** `claude/charming-cori-N4Hcf`  
**الـ Commits المُغطَّاة:** `1d407bc` → `5e99d3a`

---

## أولاً: ملخص التحديثات حسب الملف

### 1. `services/AuthService.js` — الإصلاح الجذري لـ quickLogin
**commit:** `5597872`

**المشكلة:** دالة `quickLogin()` كانت تضبط `AuthState.currentUser` فقط دون إنشاء جلسة Supabase Auth حقيقية → `auth.uid()` = NULL في كل دوال SECURITY DEFINER → جميع RPCs تفشل صامتة.

**الحل:**
- نشر **Edge Function** جديدة على Supabase باسم `quick-login`
- تستخدم `service_role` لاستدعاء `auth.admin.createSession({ user_id })`
- `quickLogin()` يستدعي الـ Edge Function بدلاً من RPC مباشر
- بعد النجاح: `supabaseClient.auth.setSession(session)` → `auth.uid()` يعمل فوراً

**التأثير على باقي الوظائف:**

| الوظيفة | قبل | بعد |
|---------|-----|-----|
| `get_chart_of_accounts` RPC | ❌ يفشل (auth.uid=NULL) | ✅ يعمل |
| `create_transaction_with_entries` RPC | ❌ يفشل | ✅ يعمل |
| أزرار الإجراءات (تعديل/حذف) | ❌ لا تظهر | ✅ تظهر |
| أسماء الحسابات في الجدول | ❌ UUID خام | ✅ أسماء صحيحة |
| تراكم `sync_conflicts` | ❌ يتراكم | ✅ يتوقف |
| سجل التدقيق (audit log) | ❌ فارغ | ✅ يُسجَّل |

---

### 2. `config.js` — إضافة جدول TRANSFER_REQUESTS
**commit:** `5e99d3a`

```diff
+ TRANSFER_REQUESTS : 'transfer_requests',
- BANK_WITHDRAWAL   : 'bank_withdrawal', // (حذف التكرار)
```

---

### 3. `components/DebtorsComponent.js` — v3.0 (إعادة كتابة كاملة)
**commit:** `5e99d3a`

#### ما تغيّر:

| الميزة | v2.0 (قبل) | v3.0 (بعد) |
|--------|-----------|-----------|
| واجهة الإدارة | جدول بسيط | جدول + فلترة منطقة + إحصائيات 3 بطاقات |
| واجهة المندوب | جدول (نفس الإدارة) | **بطاقات** مع أزرار 📞 💬 🌐 + زر تحصيل مباشر |
| تحديث الرصيد | يُنشئ قيوداً محاسبية في account_ledger | استبدال مباشر في `debtors.debt_amount` فقط |
| إنشاء حساب محاسبي | ✅ يُنشئ `CUST_{id}` في account_balances | ❌ لا يُنشئ أي حساب |
| الإشعارات | لا إشعارات | ✅ إشعار لكل مندوب عند الإضافة والتحديث |
| الحقول | name, debt_amount, region, assigned_agents | **+** phone, whatsapp, website |
| فلترة المندوب | تعمل في `_loadDebtors` | تعمل في `_loadDebtors` + كذلك في نموذج التحصيل |

#### هل يؤثر على مكونات أخرى؟

| المكوّن | التأثير |
|---------|---------|
| `AccountManagementComponent` | لن يُنشأ `CUST_` جديد → جدول الحسابات أنظف |
| `AccountingService._buildCollectionEntries()` | لا تأثير — يستخدم `customer_id` في transactions، لا في account_balances |
| `DataEntryComponent._buildCustomerSearch()` | ✅ محدَّث — يرى المندوب فقط عملاءه |

---

### 4. `components/AccountManagementComponent.js` — جدول الحسابات
**commit:** `5e99d3a`

**ما تغيّر:**
- **حُذف** عمود `معرف الحساب` (UUID كامل)
- **أُضيف** عمود `رقم الحساب` بصيغة: `AGT-0001`, `BNK-0001`, `COMP-0001`
- صيغة الحساب: `prefix-` + ترتيب الحساب ضمن فئته (4 أرقام)
- محسوب ديناميكياً عند العرض — لا يُخزن في قاعدة البيانات

**التأثير:** تحسين بصري فقط — لا تأثير وظيفي على باقي المكونات.

---

### 5. `components/DataEntryComponent.js` — نماذج إدخال البيانات
**commit:** `5e99d3a`

#### نموذج التحصيل:
- **أُضيف** toggle **عميل / شركة** في الأعلى (اختيار واحد في المرة)
- **تغيّر** بحث العملاء: المندوب يرى فقط عملاءه المُعيَّنين
- **أُضيف** خيار إنشاء عميل جديد مباشرةً من حقل البحث
- **أُضيف** تحديث تلقائي لـ `debt_amount` بعد كل تحصيل
- **أُضيف** `_showResultModal` — نافذة تفاصيل بعد كل عملية

#### نافذة تفاصيل العملية (`_showResultModal`):
- تظهر بعد: التحصيل، الإيداع، السحب البنكي
- أزرار: 📋 نسخ النص / 📤 مشاركة (Web Share API) / ✖️ إغلاق

---

### 6. قاعدة البيانات (Supabase)
**Migration:** `add_debtor_contact_fields_and_transfer_requests`

```sql
-- أعمدة جديدة في جدول debtors
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS whatsapp TEXT;
ALTER TABLE debtors ADD COLUMN IF NOT EXISTS website TEXT;

-- جدول طلبات التحويل
CREATE TABLE IF NOT EXISTS transfer_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id UUID REFERENCES users(id),
  to_user_id UUID REFERENCES users(id),
  amount DECIMAL NOT NULL,
  reason TEXT,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- حساب وسيط ثابت للتحصيلات
INSERT INTO account_balances (account_id, balance)
VALUES ('DEBTOR_COLLECTION', 0)
ON CONFLICT (account_id) DO NOTHING;
```

---

## ثانياً: تأثير التغييرات على المكونات الأخرى

### مكونات لا تحتاج تعديل (متوافقة)

| المكوّن | السبب |
|---------|-------|
| `DashboardComponent` | يقرأ transactions فقط، لا debtors |
| `DailySummaryComponent` | نفسه — transactions فقط |
| `BankAccountsComponent` | مستقل تماماً |
| `AllOperationsComponent` | يقرأ transactions فقط |
| `FailedDepositsComponent` | مستقل |
| `UsersComponent` | مستقل |
| `AccountingService` | لا يُنشئ CUST_ — التغيير متوافق |
| `Repository` | لا تغيير في schema الجداول الموجودة |

### مكونات تحتاج تهيئة أو تحديث (في الجلسات القادمة)

| المكوّن | ما يلزم | الأولوية |
|---------|---------|---------|
| `AppStore` | إضافة `_loadTransferRequests()` عند الحاجة | منخفضة |
| `NotificationsComponent` | دعم إشعارات من نوع `transfer_request` | متوسطة |
| جديد: TransferComponent | واجهة لإدارة طلبات التحويل بين المناديب | متوسطة |

---

## ثالثاً: مكونات تحتاج تحسين أو إكمال (تشخيص شامل)

### 🔴 فجوات وظيفية رئيسية

#### 1. جدول `transfer_requests` — بدون واجهة
- **الوضع:** الجدول موجود في DB وفي config.js لكن لا مكوّن يديره
- **المطلوب:** تبويب "التحويل وطلب الأموال" في DataEntryComponent (محدد في الخطة المعتمدة)
- **الأولوية:** عالية

#### 2. نموذج "استلام/تسليم" — يحتاج مراجعة
- **الوضع:** موجود في DataEntryComponent لكن يستخدم منطق `receipt/delivery` القديم
- **المطلوب:** تحويله لـ "تحويل مباشر / طلب أموال" حسب الخطة المعتمدة
- **الأولوية:** عالية

#### 3. نافذة تفاصيل العملية — ناقصة لبعض العمليات
- **الوضع:** تعمل للتحصيل والإيداع والسحب البنكي
- **المطلوب:** إضافتها للمصاريف والتحويل وطلبات الأموال
- **الأولوية:** متوسطة

---

### 🟡 تحسينات موصى بها

#### 4. `DailySummaryComponent` — إضافة ملخص العملاء المديونين
- **الوضع:** يعرض المعاملات فقط
- **المقترح:** بطاقة إضافية تعرض عدد العملاء الذين تم التحصيل منهم اليوم + إجمالي المبالغ المحصّلة منهم

#### 5. `NotificationsComponent` — تمييز إشعارات طلبات التحويل
- **الوضع:** يعرض الإشعارات بشكل عام
- **المقترح:** إضافة زري "قبول / رفض" على إشعارات نوع `transfer_request`

#### 6. `BankAccountsComponent` — ربط رقم الحساب القصير
- **الوضع:** يعرض معلومات البنك دون رقم الحساب القصير
- **المقترح:** إضافة رقم `BNK-000X` في هيدر كل بطاقة

#### 7. هيدر التطبيق — إظهار رقم حساب المستخدم
- **الوضع:** يعرض الاسم والدور فقط
- **المقترح:** إضافة `AGT-000X` بجانب اسم المندوب في الهيدر

---

### 🟢 مكونات مكتملة ولا تحتاج تدخل

| المكوّن | الحالة |
|---------|--------|
| `LoginComponent` | ✅ مكتمل |
| `DashboardComponent` | ✅ مكتمل مع real-time subscriptions |
| `AccountManagementComponent` | ✅ مكتمل بعد تحديث اليوم |
| `UsersComponent` | ✅ مكتمل |
| `SettingsComponent` | ✅ مكتمل |
| `AuditLogComponent` | ✅ مكتمل |
| `ProfileSettingsComponent` | ✅ مكتمل |
| `FailedDepositsComponent` | ✅ مكتمل |
| `AccountingService` | ✅ مكتمل |
| `AuthService` | ✅ مكتمل بعد إصلاح quickLogin |
| `Repository` | ✅ مكتمل |
| `SyncQueue/SyncService` | ✅ مكتمل |

---

## رابعاً: خريطة التنفيذ المتبقية (من الخطة المعتمدة)

```
✅ المرحلة 0 — إصلاح quickLogin (مكتمل)
✅ المرحلة 1 — نظام العملاء المديونين v3.0 (مكتمل)
✅ المرحلة 2 — جدول الحسابات بأرقام قصيرة (مكتمل)
✅ المرحلة 3 — نموذج التحصيل المحسّن + نافذة التفاصيل (مكتمل جزئياً)
⬜ المرحلة 4 — تحويل الأموال وطلب الأموال (الجدول جاهز، الواجهة مطلوبة)
⬜ المرحلة 5 — نافذة تفاصيل العملية لجميع النماذج (الأساس جاهز)
⬜ المرحلة 6 — المصروفات الموحدة
⬜ المرحلة 7 — لوحة إحصائيات العملاء بالمناطق (أُضيف في DebtorsComponent)
```

---

## خامساً: ملاحظات تقنية للمطور

| الموضوع | الملاحظة |
|---------|---------|
| CUST_ accounts | **محذوفة من المنطق** — لا تُنشأ عند إضافة عميل. إذا كانت موجودة في DB من قبل فستظهر في جدول الحسابات بدون تأثير سلبي |
| DEBTOR_COLLECTION | حساب وسيط ثابت في account_balances لاستقبال القيود المحاسبية من التحصيل. يحتاج RLS مناسب إذا استُخدم في RPCs |
| رقم الحساب القصير | محسوب ديناميكياً — الترتيب يعتمد على `allInCategory.findIndex()`. إذا تغيّر ترتيب الحسابات يتغيّر الرقم. هذا متوقع ومقبول |
| Edge Function | `quick-login` منشورة على Supabase مباشرة. تحتاج `SUPABASE_SERVICE_ROLE_KEY` في environment (متوفر افتراضياً) |
| transfer_requests RLS | مطبّق: `from_user_id` يمكنه الإنشاء، كلا المستخدمين يمكنهما القراءة والتحديث |
