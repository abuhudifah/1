# دليل اختبار النظام — نظام أبو حذيفة للصرافة
**الإصدار:** 1.0.0 | **التاريخ:** 2026-06-07

---

## المتطلبات المسبقة

### 1. حسابات الاختبار
تأكد من وجود ثلاثة حسابات نشطة في قاعدة البيانات:

| الدور | الوصف | مطلوب لـ |
|-------|-------|---------|
| `admin` | مدير النظام | اختبار 1، 2، 3 |
| `agent` | مندوب | اختبار 4 (اختراق الدور) |
| `admin_assistant` | مساعد إداري | اختبار 5 (سجل التدقيق) |

للتحقق من وجود الحسابات، نفّذ في Supabase SQL Editor:
```sql
SELECT id, role, is_active FROM users WHERE role IN ('admin','agent','admin_assistant');
```

### 2. بيانات أولية مطلوبة
- يجب وجود سجل واحد على الأقل في `audit_logs` (لاختبار 5).
- يجب وجود حساب بنكي واحد على الأقل في `bank_accounts` (لاختبار 1).

### 3. المتصفح
Chrome أو Firefox — **النسخ الحديثة فقط**.

---

## كيفية فتح Developer Console

1. افتح التطبيق في المتصفح.
2. اضغط **F12** (أو **Cmd+Option+I** على Mac).
3. انتقل إلى تبويب **Console**.
4. تأكد من عدم وجود فلاتر مفعّلة (اختر "All levels").

---

## الاختبارات

---

### الاختبار 1: سحب بنكي

**الخطوات:**
1. سجّل الدخول بحساب **مدير**.
2. افتح Console والصق الكود التالي:

```javascript
async function testBankWithdrawal() {
  console.log('🧪 يبدأ اختبار السحب البنكي...');
  const userId = (await supabaseClient.auth.getUser()).data?.user?.id;
  if (!userId) { console.error('❌ لم تسجل الدخول'); return; }

  const { data, error } = await supabaseClient
    .from('transactions')
    .insert({
      type: 'bank_withdrawal',
      amount: 100,
      currency: 'SAR',
      status: 'pending',
      created_by: userId,
    })
    .select()
    .single();

  if (error) {
    console.error('❌ FAIL bank_withdrawal:', error.message);
  } else {
    console.log('✅ PASS bank_withdrawal — id:', data.id);
    // تنظيف — حذف سجل الاختبار
    await supabaseClient.from('transactions').delete().eq('id', data.id);
    console.log('🧹 سجل الاختبار حُذف');
  }
}
testBankWithdrawal();
```

**النتيجة المتوقعة:**
```
🧪 يبدأ اختبار السحب البنكي...
✅ PASS bank_withdrawal — id: xxxxxxxx-xxxx-...
🧹 سجل الاختبار حُذف
```

**إذا فشل:** يظهر `❌ FAIL bank_withdrawal: ...` → ابلغ المطور المسؤول بنص الخطأ كاملاً.

---

### الاختبار 2: الإقفال اليومي (UI)

**الخطوات:**
1. سجّل الدخول بحساب **مدير**.
2. انتقل إلى: **الإعدادات → قسم "الإقفال اليومي التلقائي"**.
3. اضغط زر **"إقفال يدوي الآن"**.
4. في نافذة التأكيد، اضغط **"تنفيذ"**.

**النتيجة المتوقعة:**
- تظهر رسالة Toast خضراء: **"تم الإقفال اليومي بنجاح"**
- في Console **لا يوجد** خطأ من نوع `missing required field` أو `parameter mismatch`.

**للتحقق إضافياً عبر Console:**
```javascript
// تحقق من وجود سجل إقفال اليوم
const today = new Date().toISOString().split('T')[0];
const { data, error } = await supabaseClient
  .from('daily_closings')
  .select('*')
  .eq('closing_date', today)
  .maybeSingle();

if (error) console.error('❌ FAIL daily_close check:', error.message);
else if (!data) console.warn('⚠️ لا يوجد سجل إقفال لليوم — ربما لم ينفذ بعد');
else console.log('✅ PASS daily_close — سجل موجود:', data);
```

**إذا فشل:** Toast حمراء "فشل الإقفال: ..." → انسخ رسالة الخطأ من Console وأبلغ المطور.

---

### الاختبار 3: التحقق من أمان النسخة الاحتياطية

**الخطوات:**
1. سجّل الدخول بحساب **مدير**.
2. انتقل إلى **الإعدادات → النسخ الاحتياطي والاستعادة**.
3. اضغط **"تصدير نسخة احتياطية"**.
4. افتح ملف JSON المُنزَّل في أي محرر نص.
5. ابحث عن كلمة `quick_equation_hash` (Ctrl+F).

**النتيجة المتوقعة:**
- **لا يوجد** `quick_equation_hash` في أي مكان في الملف.
- بيانات `users` تحتوي فقط: `id, email, display_name, role, is_active, allowed_tabs, avatar_url, created_at, updated_at`.

**للتحقق عبر Console (بعد التصدير):**
```javascript
// هذا الكود يتحقق من أن آخر تصدير لم يحتوِ على quick_equation_hash
// تشغيله بعد فتح ملف JSON يدوياً وأخذ محتواه:
// انسخ محتوى JSON كاملاً في المتغير أدناه:
const backupJson = /* الصق محتوى الملف هنا */ null;
if (!backupJson) { console.warn('⚠️ ضع محتوى JSON في المتغير backupJson'); }
else {
  const hasHash = JSON.stringify(backupJson).includes('quick_equation_hash');
  if (hasHash) console.error('❌ FAIL: quick_equation_hash موجود في النسخة الاحتياطية!');
  else console.log('✅ PASS: quick_equation_hash غير موجود في النسخة الاحتياطية');
}
```

**إذا فشل:** وجود `quick_equation_hash` في الملف → أبلغ المطور فوراً (ثغرة أمنية).

---

### الاختبار 4: محاولة رفع الصلاحية (Agent → Admin)

**الخطوات:**
1. سجّل الدخول بحساب **مندوب (agent)**.
2. افتح Console والصق الكود التالي:

```javascript
async function testRoleEscalation() {
  console.log('🧪 يبدأ اختبار رفع الصلاحية...');
  const userId = (await supabaseClient.auth.getUser()).data?.user?.id;
  if (!userId) { console.error('❌ لم تسجل الدخول'); return; }

  const { data, error } = await supabaseClient
    .from('users')
    .update({ role: 'admin' })
    .eq('id', userId)
    .select()
    .single();

  if (error) {
    console.log('✅ PASS: رفع الصلاحية مُحجَب —', error.message);
  } else if (data?.role === 'admin') {
    console.error('❌ FAIL CRITICAL: الدور تغيّر إلى admin! — ثغرة أمنية خطيرة');
  } else {
    console.warn('⚠️ استجابة غير متوقعة:', data);
  }
}
testRoleEscalation();
```

**النتيجة المتوقعة:**
```
🧪 يبدأ اختبار رفع الصلاحية...
✅ PASS: رفع الصلاحية مُحجَب — You cannot change role, is_active, allowed_tabs, or quick_equation_hash
```

**إذا فشل:** يظهر `❌ FAIL CRITICAL` → **أوقف التشغيل فوراً** وأبلغ المطور المسؤول — هذه ثغرة أمنية حرجة.

---

### الاختبار 5: سجل التدقيق للمساعد الإداري

**الخطوات:**
1. سجّل الدخول بحساب **مساعد إداري (admin_assistant)**.
2. افتح Console والصق الكود التالي:

```javascript
async function testAuditLogAccess() {
  console.log('🧪 يبدأ اختبار سجل التدقيق...');

  const { data, error, count } = await supabaseClient
    .from('audit_logs')
    .select('*', { count: 'exact' })
    .limit(5);

  if (error) {
    console.error('❌ FAIL audit_logs:', error.message);
  } else if (count === 0) {
    console.warn('⚠️ audit_logs فارغة — تأكد من وجود سجلات في الجدول');
  } else {
    console.log(`✅ PASS audit_logs — ${count} سجل متاح للمساعد الإداري`);
    console.table(data);
  }
}
testAuditLogAccess();
```

3. انتقل إلى تبويب **"سجل التدقيق"** في الواجهة — يجب أن تظهر بيانات (ليست قائمة فارغة).

**النتيجة المتوقعة:**
```
🧪 يبدأ اختبار سجل التدقيق...
✅ PASS audit_logs — N سجل متاح للمساعد الإداري
```

**إذا فشل:** يظهر خطأ `permission denied` → أبلغ المطور بنص الخطأ كاملاً.

---

## جدول النتائج (يملأه المطور)

| # | الاختبار | النتيجة | ملاحظات |
|---|---------|---------|---------|
| 1 | سحب بنكي | ⬜ PASS / ⬜ FAIL | |
| 2 | إقفال يومي | ⬜ PASS / ⬜ FAIL | |
| 3 | أمان النسخة الاحتياطية | ⬜ PASS / ⬜ FAIL | |
| 4 | محاولة رفع الصلاحية | ⬜ PASS / ⬜ FAIL | |
| 5 | سجل التدقيق للمساعد | ⬜ PASS / ⬜ FAIL | |

---

## في حالة الفشل

1. انسخ **نص الخطأ كاملاً** من Console.
2. خذ **لقطة شاشة** للرسالة.
3. حدد **الاختبار رقم** الذي فشل.
4. أرسل المعلومات للمطور المسؤول عن هذه الجلسة.

> **ملاحظة:** أي فشل في الاختبار 4 (رفع الصلاحية) يستوجب **إيقاف النظام فوراً** حتى يُصلح.
