# ROLE_STABILIZATION_FIX_PLAN.md
## خطة تثبيت النظام — ما قبل UX/UI

تاريخ التحليل: 2026-06-06  
الفرع: claude/serene-gates-4EvPd

---

## إصلاح 1: COMP_ — عدم إنشاء حساب محاسبي عند إنشاء شركة جديدة

### المشكلة
3 شركات في قاعدة البيانات (فيصل ×2، زغلول) وصفر سجلات `COMP_<id>` في `account_balances`.  
أي عملية تحصيل أو إيداع تُحدد فيها شركة تُحاول الكتابة إلى حساب غير موجود.

### السبب الجذري
`AccountManagementComponent._saveNewAccount()` (سطر 1365-1381) يُدرج في `companies` فقط بدون إنشاء السجل المقابل في `account_balances`.  
لا يوجد DB Trigger على `companies.INSERT` يتولى ذلك.

### الملف / RPC / Trigger المسؤول
- `components/AccountManagementComponent.js` سطر 1364-1381  
- لا يوجد Trigger — هذا هو الخلل

### الإصلاح المقترح
**DB Trigger** على `companies` (INSERT) ينشئ `COMP_<id>` تلقائياً:
```sql
CREATE OR REPLACE FUNCTION trg_init_company_account()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_balances (account_id, balance)
  VALUES ('COMP_' || NEW.id::text, 0)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_companies_init_account
AFTER INSERT ON companies
FOR EACH ROW EXECUTE FUNCTION trg_init_company_account();
```

**Backfill** للشركات الموجودة:
```sql
INSERT INTO account_balances (account_id, balance)
SELECT 'COMP_' || id::text, 0 FROM companies
ON CONFLICT (account_id) DO NOTHING;
```

### يحتاج Migration؟ نعم

### الأثر على المدير
إنشاء شركة جديدة → يظهر `COMP_<id>` فوراً في Account Management وChart of Accounts.

### الأثر على المندوب
عمليات التحصيل/الإيداع التي تشير لشركة تعمل بشكل صحيح بدلاً من الفشل بصمت.

---

## إصلاح 2: BNK_ — التحقق من إنشاء الحساب البنكي

### المشكلة
عند إنشاء حساب بنكي جديد لا يُنشأ `BNK_<id>` في `account_balances` تلقائياً.  
الحساب البنكي الحالي (BNK_d53199fc) أُنشئ يدوياً.

### السبب الجذري
`BankAccountsComponent._save()` سطر 671 و`AccountManagementComponent._saveNewAccount()` نوع 'bank' سطر 1387 — كلاهما يستدعي `repo.create('bank_accounts', ...)` دون إنشاء السجل في `account_balances`.

### الملف / RPC / Trigger المسؤول
- `components/BankAccountsComponent.js` سطر 669-681  
- `components/AccountManagementComponent.js` سطر 1383-1393

### الإصلاح المقترح
**DB Trigger** على `bank_accounts` (INSERT):
```sql
CREATE OR REPLACE FUNCTION trg_init_bank_account()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_balances (account_id, balance)
  VALUES ('BNK_' || NEW.id::text, 0)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_bank_accounts_init_account
AFTER INSERT ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION trg_init_bank_account();
```

### يحتاج Migration؟ نعم

### الأثر على المدير
إنشاء حساب بنكي → يُنشأ حسابه المحاسبي فوراً.

### الأثر على المندوب
عمليات السحب/الإيداع على حسابات بنكية جديدة تعمل صحياً.

---

## إصلاح 3: CUST_ — اعتبار المدين حساباً محاسبياً فعلياً

### المشكلة
`debtors` تُعامَل حالياً كجدول تتبع فقط. لا يوجد `CUST_<id>` في `account_balances` لأي مدين.  
`_buildCollectionEntries` يُنشئ قيوداً تُشير إلى `CUST_<id>` لكن الحساب غير موجود في `account_balances`.

### السبب الجذري
`DebtorsComponent._saveDebtor()` سطر 207 يستدعي `repo.create(TABLES.DEBTORS, data)` دون إنشاء الحساب المحاسبي.

### الملف / RPC / Trigger المسؤول
- `components/DebtorsComponent.js` سطر 207

### الإصلاح المقترح
**DB Trigger** على `debtors` (INSERT):
```sql
CREATE OR REPLACE FUNCTION trg_init_debtor_account()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO account_balances (account_id, balance)
  VALUES ('CUST_' || NEW.id::text, COALESCE(NEW.debt_amount, 0))
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_debtors_init_account
AFTER INSERT ON debtors
FOR EACH ROW EXECUTE FUNCTION trg_init_debtor_account();
```

**ملاحظة**: الرصيد الأولي = `debt_amount` (ما يدين به العميل).  
`update_debtor_balance` RPC يُحدِّث `debtors.debt_amount` — يجب مزامنته مع `account_balances`.

### يحتاج Migration؟ نعم

### الأثر على المدير
CUST_ يظهر في Chart of Accounts وكشف الحسابات بشكل صحيح.

### الأثر على المندوب
عمليات تحصيل الديون تُنشئ قيوداً صحيحة تُقلل رصيد CUST_.

---

## إصلاح 4: الإيداعات الفاشلة — رؤية المندوب والتسوية المحاسبية

### المشكلة أ: المندوب لا يرى تبويب الإيداعات الفاشلة
`AGENT_TABS` في config.js (سطر 162-169) لا يتضمن `TABS.FAILED_DEPOSITS`.  
المندوب يستطيع إنشاء إيداعات فاشلة (RLS تسمح له) لكن لا يستطيع متابعتها.

### المشكلة ب: تغيير حالة الإيداع الفاشل لا يُنشئ قيوداً محاسبية
`FailedDepositsComponent._updateStatus()` سطر 315 يستدعي `repo.update(TABLES.FAILED_DEPOSITS, fd.id, { status: choice })` فقط.  
عند الاسترداد (refunded) لا يحدث أي قيد محاسبي.

### السبب الجذري
- config.js: `AGENT_TABS` لا يتضمن `failed-deposits`  
- FailedDepositsComponent: `_updateStatus()` يُحدِّث الحالة فقط دون قيد محاسبي

### الملفات المسؤولة
- `config.js` سطر 162-169  
- `components/FailedDepositsComponent.js` سطر 313-317

### الإصلاح المقترح

**أ — config.js**: إضافة `TABS.FAILED_DEPOSITS` لـ`AGENT_TABS`:
```javascript
const AGENT_TABS = Object.freeze([
  TABS.DATA_ENTRY,
  TABS.DAILY_SUMMARY,
  TABS.BANK_ACCOUNTS,
  TABS.DEBTORS,
  TABS.FAILED_DEPOSITS,   // ← إضافة
  TABS.NOTIFICATIONS,
  TABS.SETTINGS,
]);
```

**ب — FailedDepositsComponent**: عند تحديث الحالة إلى 'refunded'، استدعاء `AccountingService.createTransactionWithEntries` بنوع 'deposit' لإنشاء القيد:
```javascript
if (choice === FAILED_DEPOSIT_STATUS.REFUNDED && fd.bank_account_id) {
  await AccountingService.createTransactionWithEntries({
    type            : TRANSACTION_TYPES.DEPOSIT,
    amount          : fd.amount,
    agent_id        : fd.agent_id,
    bank_account_id : fd.bank_account_id,
    date            : getCurrentSaudiDate(),
    details         : `تسوية إيداع فاشل — ${fd.id}`,
  });
}
```

القيد الناتج:
- مدين: `BNK_<bank_id>` (البنك يستلم المبلغ)
- دائن: `AGT_<agent_id>` (تبرئة ذمة المندوب)

### يحتاج Migration؟ لا

### الأثر على المدير
لا تغيير — يرى الإيداعات الفاشلة بالفعل + يرى القيود الجديدة في كشف الحساب.

### الأثر على المندوب
- يرى تبويب "الإيداعات الفاشلة" مباشرةً في قائمة تبويباته
- عند استرداد المبلغ يتم تبرئة ذمته محاسبياً تلقائياً

---

## إصلاح 5: صلاحيات المندوب على الحسابات البنكية في Data Entry

### المشكلة
`AppStore._loadAgentBankAccounts()` سطر 299-328 يجلب فقط البنوك التي أودع فيها المندوب اليوم.  
في Data Entry، القائمة المنسدلة للبنك لا تُظهر سوى البنوك المُودَع فيها اليوم — مما يمنع المندوب من الإيداع في حساب جديد.

### السبب الجذري
`AppStore._loadAgentBankAccounts()` يُقيِّد الاستعلام بـ `type = 'deposit'` و`date = today`.  
لكن RLS `bank_accounts_agent_select_all` تسمح للمندوب بقراءة جميع السجلات.

### الملف المسؤول
- `store/AppStore.js` سطر 299-327

### الإصلاح المقترح
تحميل جميع البنوك للمندوب (RLS تسمح):
```javascript
async function _loadAgentBankAccounts(agentId) {
  // يجلب كل البنوك — RLS تضمن أن المندوب يقرأ كلها
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.BANK_ACCOUNTS,
    () => supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name'),
    () => db.isOpen() ? db.bank_accounts.toArray().catch(() => []) : []
  );
  setState({ bankAccounts: data || [] }, 'store:bankAccountsLoaded');
}
```

`BankAccountsComponent` يُبقي سلوكه — يُظهر فقط بنوك اليوم عبر تصفية محلية في `_load()`.

### يحتاج Migration؟ لا

### الأثر على المدير
لا تغيير.

### الأثر على المندوب
- في Data Entry: يرى كل البنوك عند اختيار حساب الإيداع  
- في تبويب "الحسابات البنكية": يُبقى عرض بنوك اليوم فقط (سلوك BankAccountsComponent لا يتغير)

---

## إصلاح 6: نموذج التحصيل — التمييز بين تحصيل عميل وتحصيل شركة

### المشكلة
`_saveCollection()` يقبل `company_id` و`customer_id` معاً بدون تحقق من التعارض.  
إذا مُرِّر الاثنان معاً، `_buildCollectionEntries` يستخدم `company_id` فقط (أولوية الـif).  
لا يوجد `collection_subtype` في بيانات العملية مما يُصعِّب الفلترة في التقارير.

### السبب الجذري
`DataEntryComponent._saveCollection()` سطر 831 لا يتحقق من التعارض بين `company_id` و`customer_id`.

### الملف المسؤول
- `components/DataEntryComponent.js` سطر 831-872  
- `services/AccountingService.js` (المنطق صحيح، الفرز بالأولوية كافٍ)

### الإصلاح المقترح
إضافة تحقق في `_saveCollection()`:
```javascript
if (companyId && customerId) {
  showToast('لا يمكن تحديد شركة وعميل مديون في نفس الوقت', 'error');
  return;
}
```

وإضافة `collection_subtype` للـtxData لأغراض التقارير:
```javascript
const txData = {
  ...,
  collection_subtype: companyId ? 'company' : customerId ? 'customer' : 'general',
};
```

**ملاحظة**: `collection_subtype` يُخزَّن في `details` أو يحتاج عمود جديد في `transactions` — تُحسم هذه النقطة عند التنفيذ بناءً على مخطط الجدول.

### يحتاج Migration؟ ربما (إضافة عمود `collection_subtype`)

### الأثر على المدير
التقارير تُميز بوضوح بين أنواع التحصيل الثلاثة.

### الأثر على المندوب
يتلقى رسالة خطأ واضحة إذا حدد شركة وعميلاً في نفس الوقت.

---

## ملخص التنفيذ

| الإصلاح | النوع | الملفات المتأثرة | Migration؟ |
|---------|------|----------------|-----------|
| COMP_ auto-init | DB Trigger + Backfill | Supabase | ✅ نعم |
| BNK_ auto-init | DB Trigger | Supabase | ✅ نعم |
| CUST_ as account | DB Trigger | Supabase | ✅ نعم |
| Agent failed_deposits tab | config.js | config.js | ❌ لا |
| Failed deposit accounting | FailedDepositsComponent | FailedDepositsComponent.js | ❌ لا |
| Agent all banks in Data Entry | AppStore | AppStore.js | ❌ لا |
| Collection type validation | DataEntryComponent | DataEntryComponent.js | ⚠️ اختياري |

---

## ترتيب التنفيذ

1. DB Migrations (Triggers + Backfill) — أساس كل شيء
2. config.js — إضافة failed-deposits لـAGENT_TABS
3. AppStore.js — تحميل كل البنوك للمندوب
4. FailedDepositsComponent.js — القيد المحاسبي عند الاسترداد
5. DataEntryComponent.js — تحقق التعارض في التحصيل
