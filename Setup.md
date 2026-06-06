# دليل الإعداد التفصيلي — نظام أبو حذيفة

## المتطلبات الأساسية
- حساب على [supabase.com](https://supabase.com)
- متصفح حديث (Chrome 90+ أو Firefox 88+)
- اتصال بالإنترنت للإعداد الأولي

---

## الخطوة 1: إنشاء مشروع Supabase

1. سجّل الدخول إلى [app.supabase.com](https://app.supabase.com)
2. اضغط **New Project**
3. اختر اسماً للمشروع (مثل `abu-hudhaifa`)
4. اختر كلمة مرور قوية لقاعدة البيانات (احتفظ بها)
5. اختر أقرب Region (مثل `eu-central-1` لأوروبا أو `ap-southeast-1` لآسيا)
6. اضغط **Create new project** وانتظر 2-3 دقائق

---

## الخطوة 2: تطبيق Migration قاعدة البيانات

### الطريقة أ — باستخدام SQL Editor (الأسهل)

1. في Dashboard → **SQL Editor** → **New query**
2. انسخ والصق محتوى كل ملف من مجلد `/supabase/migrations/` بالترتيب:
   - `step_01_drop_all_old_objects.sql`
   - `step_02_create_trigger_function.sql`
   - `step_03_create_base_tables.sql`
   - `step_04_create_linked_tables.sql`
   - `step_05_create_indexes.sql`
   - `step_06_create_rls_helper_functions.sql`
   - `step_07_create_rpc_functions.sql`
   - `step_08_enable_rls_and_policies.sql`
   - `step_09_grants_and_realtime.sql`
3. اضغط **Run** لكل ملف

### الطريقة ب — باستخدام Supabase CLI

```bash
# تثبيت CLI
npm install -g supabase

# ربط المشروع
supabase link --project-ref YOUR_PROJECT_ID

# تطبيق الـ migrations
supabase db push
```

---

## الخطوة 3: إنشاء Storage Bucket للشعار

1. في Dashboard → **Storage** → **New bucket**
2. الاسم: `logos`
3. Public bucket: **✅ مفعّل** (لظهور الشعار بدون مصادقة)
4. اضغط **Create bucket**

### إضافة سياسة الوصول للـ Bucket

في Storage → logos → **Policies** → **New policy**:

```sql
-- سياسة القراءة العامة (للشعار)
CREATE POLICY "logos_public_read"
ON storage.objects FOR SELECT
USING (bucket_id = 'logos');

-- سياسة الرفع للمدير فقط
CREATE POLICY "logos_admin_upload"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'logos'
  AND public.get_user_role(auth.uid()) = 'admin'
);
```

---

## الخطوة 4: إنشاء المستخدم الأول (المدير)

### 4.1 إنشاء في Supabase Auth

1. Dashboard → **Authentication** → **Users** → **Add user**
2. البريد الإلكتروني: `admin@example.com` (أو بريدك)
3. كلمة المرور: كلمة مرور قوية
4. اضغط **Create user**
5. **انسخ الـ UUID** من العمود `id` في القائمة

### 4.2 إضافة في جدول users

في **SQL Editor**:

```sql
INSERT INTO public.users (id, username, display_name, role, is_active)
VALUES (
  'UUID_من_الخطوة_السابقة',  -- ← ضع UUID المنسوخ هنا
  'admin@example.com',
  'أبو حذيفة',
  'admin',
  TRUE
);
```

---

## الخطوة 5: إعداد config.js

افتح `config.js` وعدّل:

```javascript
const SUPABASE_CONFIG = Object.freeze({
  // من: Settings → API → Project URL
  URL      : 'https://XXXXXXXX.supabase.co',

  // من: Settings → API → anon public
  ANON_KEY : 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
});
```

---

## الخطوة 6: إضافة بيانات أساسية

في **SQL Editor**، أضف البيانات الأساسية:

```sql
-- إعدادات النظام
INSERT INTO public.system_settings (key, value) VALUES
  ('logo',             '{"type":"url","value":""}'::jsonb),
  ('daily_close_time', '{"enabled":false,"hour":0,"minute":0,"lastClosedDate":null}'::jsonb),
  ('auto_lock',        '{"enabled":false,"minutes":30}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- شركة مثال
INSERT INTO public.companies (name, account_prefix)
VALUES ('شركة مثال', 'COMP_EXAMPLE');

-- حسابات مصروفات أساسية
INSERT INTO public.expense_accounts (name, code) VALUES
  ('وقود',          'EXP_FUEL'),
  ('صيانة',         'EXP_MAINT'),
  ('مصاريف متنوعة', 'EXP_MISC');
```

---

## الخطوة 7: تشغيل التطبيق

```bash
# من مجلد المشروع
npx serve .
# أو
python -m http.server 8080
# أو افتح index.html مباشرة في Chrome
```

افتح المتصفح على `http://localhost:3000`

### تسجيل الدخول الأول

1. اضغط زر القائمة **☰** (أعلى اليسار في شاشة الآلة الحاسبة)
2. اختر **تسجيل الدخول التقليدي**
3. أدخل البريد وكلمة المرور
4. بعد الدخول يمكنك تفعيل **الدخول السريع** من الإعدادات

---

## الخطوة 8: إضافة مندوبين

من داخل النظام (بعد تسجيل دخول المدير):

1. تبويب **إدارة المستخدمين** → **إضافة مستخدم**
2. أدخل الاسم والبريد وكلمة المرور
3. اختر الدور: **مندوب**
4. اضغط **حفظ**

> **ملاحظة:** إنشاء المستخدم يتطلب اتصالاً بالإنترنت لأنه يُنشئ حساباً في Supabase Auth.

---

## التحقق من اكتمال الإعداد

```sql
-- تحقق من الجداول (يجب أن تكون 13)
SELECT COUNT(*) AS table_count
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE';

-- تحقق من سياسات RLS (يجب أن تكون 32+)
SELECT COUNT(*) AS policy_count
FROM pg_policies WHERE schemaname = 'public';

-- تحقق من الدوال (يجب أن تكون 5+)
SELECT routine_name FROM information_schema.routines
WHERE routine_schema = 'public' AND routine_type = 'FUNCTION'
  AND routine_name NOT LIKE 'handle_%';

-- تحقق من إعدادات النظام
SELECT key, value FROM public.system_settings;
```

النتائج المتوقعة:
- `table_count` = 13
- `policy_count` ≥ 32
- الدوال: `create_transaction_with_entries`, `perform_daily_close`, `reverse_transaction`, `update_debtor_balance`, `verify_quick_login`
- الإعدادات: `logo`, `daily_close_time`, `auto_lock`

---

## استكشاف الأخطاء

### خطأ: `Invalid API key`
تأكد من نسخ `ANON_KEY` الصحيحة من Settings → API (وليس `service_role`).

### خطأ: `relation "users" does not exist`
لم يتم تطبيق الـ migrations. كرر الخطوة 2.

### خطأ: `new row violates row-level security policy`
المستخدم غير موجود في جدول `public.users`. كرر الخطوة 4.

### الشعار لا يظهر
- تأكد من إنشاء Bucket باسم `logos` وأنه Public.
- تأكد من صحة رابط الصورة في الإعدادات.

### لا تعمل المزامنة
- تأكد من تفعيل Realtime في Supabase Dashboard → Database → Replication.
- افتح Browser Console وابحث عن رسائل `❌` أو `⚠️`.

---

## النسخ الاحتياطي والاسترداد (TASK-6.5)

### النسخ الاحتياطي التلقائي (Supabase Pro/Team)
1. Supabase Dashboard → **Settings → Database → Backups**
2. تفعيل **Point-in-Time Recovery** (PITR) إن توفر في خطتك
3. نسخ يومية محفوظة لمدة 7 أيام افتراضياً

### النسخ الاحتياطي اليدوي (الخطة المجانية)
نفّذ هذا الأمر أسبوعياً:
```bash
# استبدل القيم بمعلومات مشروعك من Supabase → Settings → Database
pg_dump "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  --no-owner --no-privileges \
  -f backup_$(date +%Y%m%d).sql
```

أو استخدم: Supabase Dashboard → **Database → Backups → Download**

### إجراءات الاستعادة
```bash
# استعادة على مشروع جديد أو بيئة اختبار
psql "postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres" \
  < backup_YYYYMMDD.sql
```

### قائمة تحقق أسبوعية
- [ ] تأكد من وجود نسخة احتياطية لا يتجاوز عمرها 7 أيام
- [ ] اختبر `pg_dump` شهرياً وتأكد من اكتمال الملف
- [ ] تحقق من Supabase Dashboard → Logs للتأكد من غياب أخطاء حرجة
- [ ] راجع Usage في Dashboard للتأكد من عدم اقتراب حدود الخطة المجانية
