# تقرير التغييرات النهائي — نظام أبو حذيفة للصرافة
**تاريخ التقرير:** 2026-06-07  
**المهندس:** Senior Fintech Engineer (Claude Code Session)  
**الفرع:** `claude/inspiring-ritchie-7jElh`

---

## 1. تغييرات قاعدة البيانات (Supabase: gffyakxcfoeehtapelgd)

### FIX-A — إضافة `bank_withdrawal` لقيد CHECK
```sql
-- 2026-06-07
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_type_check
  CHECK (type = ANY (ARRAY[
    'collection','deposit','bank_withdrawal','expense',
    'receipt','delivery','refund_settlement'
  ]));
```
**نتيجة الاختبار:** ✅ PASS — INSERT بـ `bank_withdrawal` نجح

---

### FIX-B — إصلاح RLS على `quick_login_rate_limit`
```sql
-- 2026-06-07
CREATE POLICY "rate_limit_service_only"
  ON quick_login_rate_limit FOR ALL TO service_role
  USING (true) WITH CHECK (true);

ALTER FUNCTION verify_quick_login(text) SECURITY DEFINER;
```
**نتيجة الاختبار:** ✅ PASS — `verify_quick_login` يعمل بدون خطأ RLS

---

### FIX-C — حماية أعمدة حساسة في `users` (التريجر)
**النسخة الأولى** (مطبقة سابقاً) كانت تمنع حتى المدير من تعديل `is_active`.  
**النسخة الثانية** (2026-06-07) بالمنطق الصحيح:

```sql
DROP TRIGGER IF EXISTS trg_protect_user_sensitive ON users;
DROP FUNCTION IF EXISTS protect_user_sensitive_columns();

CREATE OR REPLACE FUNCTION protect_user_sensitive_columns()
RETURNS TRIGGER AS $$
DECLARE
  v_caller_role text;
BEGIN
  SELECT role INTO v_caller_role FROM users WHERE id = auth.uid();

  -- Admin: يسمح بكل شيء عدا quick_equation_hash
  IF v_caller_role = 'admin' THEN
    IF OLD.quick_equation_hash IS DISTINCT FROM NEW.quick_equation_hash THEN
      RAISE EXCEPTION 'Cannot change quick_equation_hash directly';
    END IF;
    RETURN NEW;
  END IF;

  -- مستخدم عادي يعدّل صفه: يمنع الأعمدة الحساسة
  IF OLD.id = auth.uid() THEN
    IF OLD.role IS DISTINCT FROM NEW.role
    OR OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.allowed_tabs IS DISTINCT FROM NEW.allowed_tabs
    OR OLD.quick_equation_hash IS DISTINCT FROM NEW.quick_equation_hash
    THEN
      RAISE EXCEPTION 'You cannot change role, is_active, allowed_tabs, or quick_equation_hash';
    END IF;
    RETURN NEW;
  END IF;

  -- مستخدم عادي يعدّل صف آخر: ممنوع كلياً
  RAISE EXCEPTION 'You can only update your own user record';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_protect_user_sensitive
  BEFORE UPDATE ON users FOR EACH ROW
  EXECUTE FUNCTION protect_user_sensitive_columns();
```

**نتائج الاختبارات:**
| الاختبار | النتيجة |
|----------|---------|
| Admin يغيّر `is_active` لمستخدم آخر | ✅ PASS (مسموح) |
| Agent يحاول تغيير `is_active` لنفسه | ✅ PASS (محجوب — خطأ P0001) |
| Admin يحاول تغيير `quick_equation_hash` | ✅ PASS (محجوب — خطأ P0001) |

---

### FIX-D — `perform_daily_close` وتصحيح التعليق
```sql
-- لا تغيير في قاعدة البيانات — الدالة كانت صحيحة
-- التغيير كان في كود JavaScript (انظر القسم 2)
```

---

### FIX-E — سياسة RLS لـ `audit_logs` للمساعد الإداري
```sql
-- 2026-06-07
CREATE POLICY "audit_logs_assistant_select"
  ON audit_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
        AND users.role = 'admin_assistant'
        AND users.is_active = true
    )
  );
```
**نتيجة الاختبار:** ✅ PASS — سياستان مؤكدتان على `audit_logs`

---

### FIX-F — تخفيف قيد `debtors.debt_amount`
```sql
-- 2026-06-07
ALTER TABLE debtors DROP CONSTRAINT IF EXISTS debtors_debt_amount_check;
ALTER TABLE debtors ADD CONSTRAINT debtors_debt_amount_check
  CHECK (debt_amount >= -1000000);
```
**نتيجة الاختبار:** ✅ PASS — INSERT/UPDATE بـ `-500` نجح

---

## 2. تغييرات الكود

### `components/SettingsComponent.js`

#### FIX-D — السطر 270: إرسال `p_date` لـ `perform_daily_close`
```js
// قبل (خاطئ):
const result = await callRPC('perform_daily_close', {});

// بعد (صحيح):
const result = await callRPC('perform_daily_close', { p_date: new Date().toISOString().split('T')[0] });
```
**Commit:** `6895361`

#### N2 FIX — السطر 340: إصلاح `onConflict` في `_importBackup`
```js
// قبل (خاطئ — system_settings PK هو 'key' وليس 'id'):
await supabaseClient.from(table).upsert(records.slice(i, i+bs), { onConflict: 'id' });

// بعد (صحيح):
const PK_MAP = { system_settings: 'key', cache_meta: 'key', account_balances: 'account_id' };
const conflictCol = PK_MAP[table] || 'id';
await supabaseClient.from(table).upsert(records.slice(i, i+bs), { onConflict: conflictCol });
```
**Commit:** `64ffbfc`

---

### `config.js`

#### FIX-D — السطر 67: تصحيح التعليق
```js
// قبل:
PERFORM_DAILY_CLOSE: 'perform_daily_close', // params: {p_date, p_user_id}

// بعد:
PERFORM_DAILY_CLOSE: 'perform_daily_close', // params: {p_date}
```
**Commit:** `6895361`

---

## 3. حالة GitHub

| البند | التفاصيل |
|-------|---------|
| الفرع | `claude/inspiring-ritchie-7jElh` |
| الحالة | ✅ مرفوع بنجاح |
| Commits | `6895361`, `64ffbfc` (فوق `beb13c9`) |
| رابط PR | https://github.com/abuhudifah/1/pull/new/claude/inspiring-ritchie-7jElh |

---

## 4. نتائج الاختبارات

### اختبارات قاعدة البيانات (SQL مباشر)
| الاختبار | النتيجة |
|----------|---------|
| bank_withdrawal INSERT | ✅ PASS |
| verify_quick_login بدون RLS error | ✅ PASS |
| Admin يغيّر is_active لمستخدم آخر | ✅ PASS |
| Agent يحاول تغيير is_active لنفسه | ✅ PASS (محجوب) |
| Admin يحاول تغيير quick_equation_hash | ✅ PASS (محجوب) |
| audit_logs_assistant_select policy | ✅ PASS |
| debtors debt_amount = -500 | ✅ PASS |
| perform_daily_close({p_date}) signature | ✅ PASS |

### اختبارات المتصفح — سكريبت للتنفيذ اليدوي

```javascript
// =====================================================
// سكريبت اختبار متصفح — افتح Console في Chrome/Firefox
// =====================================================

// ─── 1. سحب بنكي ───
// تسجيل دخول كمدير ثم انسخ هذا في Console:
async function testBankWithdrawal() {
  const { data, error } = await supabaseClient
    .from('transactions')
    .insert({
      type: 'bank_withdrawal',
      amount: 100,
      currency: 'SAR',
      status: 'pending',
      created_by: (await supabaseClient.auth.getUser()).data.user.id,
    })
    .select()
    .single();
  
  if (error) console.error('❌ FAIL bank_withdrawal:', error.message);
  else console.log('✅ PASS bank_withdrawal — id:', data.id);
  
  // تنظيف
  if (data?.id) await supabaseClient.from('transactions').delete().eq('id', data.id);
}
testBankWithdrawal();

// ─── 2. إقفال يومي ───
// في واجهة المستخدم: الإعدادات → زر "إقفال يدوي الآن"
// تحقق: رسالة نجاح "تم الإقفال اليومي بنجاح" في Toast
// تحقق في Console: لا يوجد خطأ "missing required field"

// ─── 3. محاولة اختراق الدور (مندوب) ───
// سجّل دخول كمندوب، ثم:
async function testRoleEscalation() {
  const userId = (await supabaseClient.auth.getUser()).data.user.id;
  const { error } = await supabaseClient
    .from('users')
    .update({ role: 'admin' })
    .eq('id', userId);
  
  if (error) console.log('✅ PASS: escalation blocked —', error.message);
  else console.error('❌ FAIL: role was changed! CRITICAL SECURITY BUG');
}
testRoleEscalation();

// ─── 4. سجل التدقيق للمساعد الإداري ───
// سجّل دخول كمساعد إداري → تبويب "سجل التدقيق"
// تحقق: تظهر بيانات (ليست قائمة فارغة)
// في Console:
async function testAuditLogAccess() {
  const { data, error, count } = await supabaseClient
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .limit(5);
  
  if (error) console.error('❌ FAIL audit_logs:', error.message);
  else if (!data?.length) console.warn('⚠️ audit_logs فارغة (ربما لا توجد بيانات بعد)');
  else console.log('✅ PASS audit_logs — عدد السجلات:', count);
}
testAuditLogAccess();
```

**ملاحظة:** لا تتوفر أداة Puppeteer في هذه البيئة — يُنفَّذ السكريبت أعلاه يدوياً في Console المتصفح بعد تسجيل الدخول بالحساب المناسب.

---

## 5. قائمة المخاطر المتبقية

| الرمز | المخاطرة | الأولوية |
|-------|---------|---------|
| R1 | `verify_quick_login` يستخدم SHA-256 من طرف العميل — يمكن تسريب الهاش إذا اعتُرض الطلب. يُفضل الانتقال لـ bcrypt على مستوى DB | متوسط |
| R2 | `_exportBackup` يصدر `users` كاملاً بما فيه `quick_equation_hash` — إذا سُرق ملف الـ backup يمكن استخدامه لتسجيل الدخول | متوسط |
| R3 | لا يوجد Rate Limiting على الـ API العام (Supabase ANON_KEY مكشوف في config.js) — يحتاج Cloudflare WAF أو Edge Function | منخفض-متوسط |
| R4 | `SyncQueue` لا يتحقق من نجاح الـ batch قبل حذفه من Dexie — خسارة بيانات في حالة crash بعد الرفع وقبل التأكيد | منخفض |
| R5 | `STALE_DAYS: 90` في CACHE_CONFIG يحذف معاملات IndexedDB الأقدم من 90 يوم — قد يُفقد بيانات offline إذا بقي الجهاز بدون اتصال طويلاً | منخفض |

---

## 6. الحكم النهائي

```
STATUS: NEEDS_MORE_WORK (minor)
```

**المبررات:**
- ✅ جميع الإصلاحات الحرجة (FIX-A إلى FIX-F + FIX-C v2 + N2) طُبِّقت وتُحققت على قاعدة البيانات الفعلية.
- ✅ الكود مرفوع على GitHub (فرع `claude/inspiring-ritchie-7jElh`).
- ⚠️ لم تُنفَّذ اختبارات المتصفح الحقيقية بسبب عدم توفر Puppeteer — **مطلوب تنفيذ السكريبت أعلاه يدوياً** قبل النشر.
- ⚠️ مخاطر R1 وR2 تستحق المعالجة قبل الإنتاج في بيئة حساسة مالياً.

**للوصول إلى `READY_FOR_PRODUCTION` يلزم:**
1. تنفيذ سكريبت اختبار المتصفح والتأكد من نجاح السيناريوهات الأربعة.
2. معالجة R2 (استثناء `quick_equation_hash` من ملف الـ backup).
