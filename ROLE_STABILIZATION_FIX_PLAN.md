# ROLE_STABILIZATION_FIX_PLAN.md
## خطة تثبيت النظام — ما قبل UX/UI

تاريخ التنفيذ: 2026-06-06  
الفرع: claude/serene-gates-4EvPd  
حالة التنفيذ: ✅ مكتمل

---

## إصلاح 1: COMP_ — إنشاء حساب محاسبي عند إنشاء شركة

### المشكلة
3 شركات في قاعدة البيانات (فيصل ×2، زغلول) وصفر سجلات `COMP_<id>` في `account_balances`.
أي عملية تحصيل أو إيداع تشير لشركة تحاول الكتابة لحساب غير موجود.

### السبب الجذري
`AccountManagementComponent._saveNewAccount()` يُدرج في `companies` فقط.
لا يوجد DB Trigger على `companies.INSERT`.

### الملف / Trigger المسؤول
- `components/AccountManagementComponent.js` سطر 1364-1381 (مصدر الإنشاء)
- Supabase: لا trigger — هذا الخلل

### الإصلاح المُطبَّق
**Migration: `init_entity_accounts`**
```sql
CREATE OR REPLACE FUNCTION trg_init_company_account() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO account_balances (account_id, balance)
  VALUES ('COMP_' || NEW.id::text, 0)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_companies_init_account
AFTER INSERT ON companies
FOR EACH ROW EXECUTE FUNCTION trg_init_company_account();

-- Backfill
INSERT INTO account_balances (account_id, balance)
SELECT 'COMP_' || id::text, 0 FROM companies
ON CONFLICT (account_id) DO NOTHING;
```

### يحتاج Migration؟ ✅ نعم — تم تطبيقه
### الأثر على المدير: شركة جديدة → COMP_ يظهر فوراً في Account Management وChart of Accounts
### الأثر على المندوب: عمليات التحصيل/الإيداع على شركة تعمل صحياً

---

## إصلاح 2: BNK_ — إنشاء الحساب المحاسبي عند إنشاء حساب بنكي

### المشكلة
`BankAccountsComponent._save()` و `AccountManagementComponent` يحفظان الحساب البنكي دون إنشاء `BNK_<id>`.

### السبب الجذري
لا trigger على `bank_accounts.INSERT` في قاعدة البيانات.

### الملف / Trigger المسؤول
- `components/BankAccountsComponent.js` سطر 669-681
- `components/AccountManagementComponent.js` سطر 1383-1393

### الإصلاح المُطبَّق
**Migration: `init_entity_accounts`**
```sql
CREATE OR REPLACE FUNCTION trg_init_bank_account() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO account_balances (account_id, balance)
  VALUES ('BNK_' || NEW.id::text, 0)
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_bank_accounts_init_account
AFTER INSERT ON bank_accounts
FOR EACH ROW EXECUTE FUNCTION trg_init_bank_account();
```

### يحتاج Migration؟ ✅ نعم — تم
### الأثر على المدير: حساب بنكي جديد → BNK_ يظهر في كشف الحساب والتقارير
### الأثر على المندوب: السحب/الإيداع على حسابات بنكية جديدة يعمل صحياً

---

## إصلاح 3: CUST_ — المدين كحساب محاسبي فعلي

### المشكلة
`debtors` تُعامَل كجدول تتبع فقط. `_buildCollectionEntries` يُنشئ قيوداً تشير لـ`CUST_<id>` لكنه غير موجود في `account_balances`.

### السبب الجذري
`DebtorsComponent._saveDebtor()` سطر 207 يستدعي `repo.create(TABLES.DEBTORS, data)` دون إنشاء الحساب.

### الإصلاح المُطبَّق
**Migration: `init_entity_accounts`**
```sql
CREATE OR REPLACE FUNCTION trg_init_debtor_account() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO account_balances (account_id, balance)
  VALUES ('CUST_' || NEW.id::text, COALESCE(NEW.debt_amount, 0))
  ON CONFLICT (account_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_debtors_init_account
AFTER INSERT ON debtors
FOR EACH ROW EXECUTE FUNCTION trg_init_debtor_account();
```

الرصيد الأولي = `debt_amount` (ما يدين به العميل).

### يحتاج Migration؟ ✅ نعم — تم
### الأثر على المدير: CUST_ يظهر في Chart of Accounts وكشف الحسابات
### الأثر على المندوب: قيود تحصيل الديون تُنشَأ بشكل صحيح

---

## إصلاح 4: الإيداعات الفاشلة — رؤية المندوب والتسوية المحاسبية

### المشكلة أ: المندوب لا يرى تبويب الإيداعات الفاشلة
`AGENT_TABS` لا يتضمن `TABS.FAILED_DEPOSITS` رغم أن RLS تسمح له بالوصول الكامل.

### المشكلة ب: تغيير الحالة لا يُنشئ قيوداً
`_updateStatus()` سطر 315 يستدعي `repo.update` فقط دون قيد محاسبي.

### الإصلاح المُطبَّق

**config.js** — إضافة `TABS.FAILED_DEPOSITS` لـ`AGENT_TABS`

**FailedDepositsComponent.js** — قيد محاسبي عند الاسترداد:
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
القيد: مدين `BNK_<bank_id>` / دائن `AGT_<agent_id>` (تبرئة ذمة المندوب).

### يحتاج Migration؟ ❌ لا
### الأثر على المدير: يرى القيود الجديدة في كشف الحسابات
### الأثر على المندوب: يرى ويتابع إيداعاته الفاشلة + ذمته تُبرَّأ محاسبياً عند الاسترداد

---

## إصلاح 5: الحسابات البنكية المفضلة للمندوب

### المشكلة
- المندوب يرى كل البنوك في Data Entry لكن لا توجد آلية تثبيت صريحة (pinning)
- في تبويب الحسابات البنكية يجب أن يرى فقط إيداعات اليوم — هذا صحيح بالفعل (BankAccountsComponent._load سطر 77-99)

### السبب الجذري
`AppStore._loadAgentBankAccounts` كانت تُحمِّل بنوك اليوم فقط — صُحِّح.
لا توجد آلية تثبيت في DataEntry.

### الإصلاح المُطبَّق

**AppStore.js** — تحميل كل البنوك للمندوب (RLS تضمن الصلاحية):
```javascript
async function _loadAgentBankAccounts(agentId) {
  const data = await _fetchFromSupabaseWithFallback(
    TABLES.BANK_ACCOUNTS,
    () => supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name'),
    () => db.isOpen() ? db.bank_accounts.orderBy('name').toArray().catch(() => []) : []
  );
  setState({ bankAccounts: data || [] }, 'store:bankAccountsLoaded');
}
```

**DataEntryComponent.js** — نظام المفضلة عبر localStorage:
- `_getFavoriteBanks()` / `_toggleFavoriteBank(bankId)` — تخزين في `favBanks_<userId>`
- `_prepareSortedBanks()` — المفضلة تأتي أولاً ثم الأحدث استخداماً
- `_buildBankSelect()` — علامة ★ على المفضلة
- `_buildBankPinBtn(selectId)` — زر "☆ تثبيت / ★ إلغاء التثبيت" أسفل القائمة
- مُضاف لنموذجي الإيداع (dep-bank) والسحب (wd-bank)

السلوك:
- Data Entry: كل البنوك + المفضلة في الأعلى
- تبويب الحسابات البنكية: إيداعات اليوم فقط (لا تغيير)
- المفضلة لا تؤثر على الصلاحيات

### يحتاج Migration؟ ❌ لا (localStorage)
### الأثر على المدير: لا تغيير
### الأثر على المندوب: يثبت البنوك التي يتعامل معها كثيراً → تظهر دائماً في الأعلى

---

## إصلاح 6: تمييز التحصيل — شركة vs عميل

### المشكلة
`_saveCollection()` يقبل `company_id` و`customer_id` معاً دون تحقق من التعارض.

### الإصلاح المُطبَّق
**DataEntryComponent.js** سطر 836 — تحقق صريح:
```javascript
if (companyId && customerId) {
  showToast('لا يمكن تحديد شركة وعميل مديون في نفس الوقت', 'error');
  return;
}
```
التمييز في القيود المحاسبية مُطبَّق بالفعل في `_buildCollectionEntries` عبر الأولوية: `company_id` → `customer_id` → عام.

### يحتاج Migration؟ ❌ لا
### الأثر على المدير: التقارير تُميز بين أنواع التحصيل الثلاثة بوضوح
### الأثر على المندوب: رسالة خطأ واضحة عند التعارض

---

## ملخص التنفيذ

| # | الإصلاح | النوع | الحالة |
|---|---------|------|--------|
| 1 | COMP_ auto-init | DB Trigger + Backfill | ✅ مكتمل |
| 2 | BNK_ auto-init | DB Trigger | ✅ مكتمل |
| 3 | CUST_ as account | DB Trigger | ✅ مكتمل |
| 4أ | Agent failed-deposits tab | config.js | ✅ مكتمل |
| 4ب | Failed deposit accounting | FailedDepositsComponent.js | ✅ مكتمل |
| 5أ | Agent loads all banks | AppStore.js | ✅ مكتمل |
| 5ب | Favorite banks pinning | DataEntryComponent.js | ✅ مكتمل |
| 6 | Collection type validation | DataEntryComponent.js | ✅ مكتمل |

---

## حالة قاعدة البيانات بعد التنفيذ

| البادئة | العدد | الملاحظة |
|---------|-------|---------|
| AGT_ | 2 | مدير + مندوب |
| COMP_ | 4 | 3 شركات + COMP_GENERAL |
| BNK_ | 1 | trigger جاهز للجديد |
| CUST_ | 0* | trigger جاهز — لا مدينين حالياً |
| OTHER | 6 | أرصدة النظام |

*لا يوجد مدينون في قاعدة البيانات حالياً.

---

## READY FOR UX/UI PHASE = YES ✅
