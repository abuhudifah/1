# REMEDIATION_PLAN.md
# نظام أبو حذيفة المتكامل للصرافة والتحويلات
# خطة المعالجة التنفيذية الشاملة

**المرجع:** SYSTEM_ANALYSIS_MASTER.md  
**تاريخ الإصدار:** 2026-06-06  
**نهج العمل:** إصلاح تدريجي — بدون إعادة كتابة، بدون هجرة أطر عمل، بدون إعادة تصميم  
**إجمالي المهام:** 30 مهمة موزعة على 6 مراحل  

---

## مبادئ التنفيذ

1. **التغيير الجراحي:** كل مهمة تمس ملفاً واحداً أو عدداً محدوداً من الملفات فقط.
2. **التحقق قبل الدمج:** كل مهمة لها خطوات تحقق صريحة قابلة للتنفيذ يدوياً.
3. **الرجوع للخلف:** كل مهمة لها استراتيجية rollback واضحة.
4. **الترتيب التبعي:** لا تُنفَّذ مهمة إلا بعد اكتمال تبعياتها.
5. **عزل المخاطر:** المهام عالية الخطورة تُنفَّذ منفردة على commit مستقل.

---

## Phase 1: Critical Stability — الاستقرار الحرج

> **الهدف:** إصلاح الأخطاء التي تُسبب فشلاً صامتاً أو سلوكاً غير متوقعاً في بيئة الإنتاج الحالية.  
> **الجدول الزمني المقترح:** أسبوع واحد  
> **يجب إنجازها قبل أي مرحلة لاحقة.**

---

### TASK-1.1 — إصلاح `defer` لـ ProfileSettingsComponent و QuickLoginBanner

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🔴 حرج |
| **المصدر** | R09, P1.4 |
| **الخطر** | السكريبتان تُنفَّذان قبل اكتمال DOM وقبل تحميل AppStore — أخطاء `undefined` عشوائية |
| **الجهد المقدَّر** | 15 دقيقة |
| **الملفات المتأثرة** | `index.html` (السطران 160، 163) |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `index.html`.
2. السطر 160: إضافة خاصية `defer` لعلامة `<script src="components/ProfileSettingsComponent.js">`.
3. السطر 163: إضافة خاصية `defer` لعلامة `<script src="utils/QuickLoginBanner.js">`.
4. التأكد من أن ترتيب السكريبتَين لا يزال بعد `AuthService.js` في تسلسل التحميل.

**خطوات التحقق:**
- فتح التطبيق في المتصفح → DevTools → Console.
- التأكد من عدم وجود أخطاء `Cannot read properties of undefined` عند التحميل.
- تسجيل الدخول والتنقل لإعدادات الملف الشخصي — يجب أن تعمل الصفحة بشكل طبيعي.
- تسجيل الدخول كمندوب جديد (لم يُفعّل Quick Login) — يجب أن يظهر البانر بعد 30 ثانية.

**استراتيجية Rollback:**
- حذف خاصية `defer` من السطرين المُعدَّلين فقط.

---

### TASK-1.2 — دمج تعريف `window.RPC` المزدوج في config.js

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🔴 حرج |
| **المصدر** | R04, P1.3 |
| **الخطر** | كود يعمل قبل السطر 328 يرى RPC قديمة تفتقر لـ `GET_ADMIN_DASHBOARD` وغيرها |
| **الجهد المقدَّر** | 30 دقيقة |
| **الملفات المتأثرة** | `config.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `config.js`.
2. تحديد التعريف الأول `const RPC = {...}` (السطر ~64) والتعريف الثاني `window.RPC = {...}` (السطر ~328).
3. نسخ جميع مفاتيح التعريف الثاني التي ليست موجودة في الأول.
4. دمجها في التعريف الأول (السطر ~64) بحيث يصبح كائناً واحداً شاملاً.
5. حذف التعريف الثاني (السطر ~328) بالكامل.
6. التأكد من أن `window.RPC` لا تزال تُعيَّن مرة واحدة فقط في نهاية الملف.

**خطوات التحقق:**
- في DevTools Console: `window.RPC` — يجب أن تُظهر كائناً واحداً يحتوي على جميع المفاتيح بما فيها `GET_ADMIN_DASHBOARD`.
- فتح لوحة التحكم — يجب أن تعمل KPIs والرسوم البيانية بشكل طبيعي.
- فتح كشف الحسابات — يجب أن يعمل بشكل طبيعي.
- `Object.keys(window.RPC).length` — يجب أن يساوي المجموع المتوقع من كلا التعريفين.

**استراتيجية Rollback:**
- استعادة الملف من git: `git checkout HEAD -- config.js`.

---

### TASK-1.3 — إصلاح `_executeUpdate()` و `_executeDelete()` في SyncQueue

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🔴 حرج |
| **المصدر** | R05, P1.5 |
| **الخطر** | فشل صامت لمزامنة `account_balances` و`system_settings` — الجدولان يستخدمان PK غير `id` |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | `repository/SyncQueue.js` |
| **التبعيات** | TASK-1.2 (للتأكد من أن `config.js` مستقر أولاً) |

**خطوات التنفيذ:**
1. فتح `repository/SyncQueue.js`.
2. تحديد `_executeUpdate()` (السطر ~325) — استبدال `.eq('id', recordId)` بـ:
   ```js
   const pkCol = TABLE_PRIMARY_KEYS[item.table_name] || 'id';
   .eq(pkCol, recordId)
   ```
3. تحديد `_executeDelete()` — تطبيق نفس الاستبدال.
4. التأكد من أن `TABLE_PRIMARY_KEYS` مُستوردة/مرئية في نطاق الدالتين (تأتي من `Repository.js` عبر `window.*` أو معرَّفة محلياً).
5. إذا لم تكن `TABLE_PRIMARY_KEYS` متاحة في `SyncQueue.js`، إضافة تعريف محلي مطابق:
   ```js
   const _PK_MAP = { account_balances: 'account_id', system_settings: 'key', cache_meta: 'key' };
   ```
   واستخدامه في الدالتين.

**خطوات التحقق:**
- إيقاف الاتصال (DevTools → Network → Offline).
- تعديل إعداد نظام (system_settings) — يجب أن يُضاف للطابور.
- استعادة الاتصال — مراقبة Console: يجب أن تظهر رسالة نجاح المزامنة دون أخطاء `406 Not Acceptable` أو `400 Bad Request`.
- التحقق في Supabase Dashboard أن السجل تحدَّث فعلاً.

**استراتيجية Rollback:**
- `git checkout HEAD -- repository/SyncQueue.js`.

---

### TASK-1.4 — إصلاح `resolveConflict()` — إضافة `onConflict` لـ upsert

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🔴 حرج |
| **المصدر** | R14, P3.7 |
| **الخطر** | حل التعارض قد يُنشئ سجلاً مكرراً بدلاً من تحديث الموجود |
| **الجهد المقدَّر** | 30 دقيقة |
| **الملفات المتأثرة** | `repository/SyncQueue.js` |
| **التبعيات** | TASK-1.3 (العمل في نفس الملف — يُنجَزان معاً) |

**خطوات التنفيذ:**
1. فتح `repository/SyncQueue.js`.
2. تحديد `resolveConflict()` (السطر ~613).
3. تعديل استدعاء `upsert()`:
   ```js
   // قبل:
   supabaseClient.from(conflict.table_name).upsert({ ...conflict.local_data })
   // بعد:
   const pkCol = _PK_MAP[conflict.table_name] || 'id';
   supabaseClient.from(conflict.table_name)
     .upsert({ ...conflict.local_data }, { onConflict: pkCol })
   ```

**خطوات التحقق:**
- إنشاء تعارض مصطنع في بيئة اختبار (تعديل سجل من واجهة Supabase ثم تعديله offline).
- محاولة حل التعارض من الواجهة.
- التحقق في Supabase أنه لا يوجد سجل مكرر — فقط تحديث للسجل الأصلي.

**استراتيجية Rollback:**
- `git checkout HEAD -- repository/SyncQueue.js`.

---

### TASK-1.5 — إضافة UNIQUE constraint على `transactions.id` في Supabase

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🔴 حرج |
| **المصدر** | R08, P2.4 |
| **الخطر** | معاملات مالية مكررة عند انقطاع الاتصال أثناء INSERT |
| **الجهد المقدَّر** | 20 دقيقة |
| **الملفات المتأثرة** | Supabase Dashboard (لا ملفات كود) |
| **التبعيات** | لا يوجد (تبعية مستقلة على مستوى قاعدة البيانات) |

**خطوات التنفيذ:**
1. فتح Supabase Dashboard → Table Editor → `transactions`.
2. التحقق من أن عمود `id` من نوع `uuid` وهو بالفعل PRIMARY KEY.
3. إذا لم يكن PRIMARY KEY، فتح SQL Editor وتنفيذ:
   ```sql
   ALTER TABLE transactions ADD CONSTRAINT transactions_id_unique UNIQUE (id);
   ```
4. التأكد كذلك من أن عمليات INSERT من RPC `create_transaction_with_entries` تستخدم `ON CONFLICT (id) DO NOTHING` أو `DO UPDATE`.

**خطوات التحقق:**
- في SQL Editor: `SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'transactions' AND constraint_type = 'UNIQUE';`
- يجب أن تظهر قيد UNIQUE على `id`.
- إنشاء معاملة، ثم محاولة INSERT بنفس الـ UUID من SQL Editor — يجب أن تفشل بخطأ UNIQUE violation لا بإنشاء سجل مكرر.

**استراتيجية Rollback:**
```sql
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_id_unique;
```

---

## Phase 2: Authentication & Security — المصادقة والأمان

> **الهدف:** إغلاق الثغرات الأمنية المباشرة دون تغيير تجربة المستخدم.  
> **الجدول الزمني المقترح:** الأسبوع الثاني  
> **متطلب:** إنجاز Phase 1 بالكامل.

---

### TASK-2.1 — إزالة `eq: trimmed` من localStorage في AuthService

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🔴 حرج |
| **المصدر** | R03, P1.6 |
| **الخطر** | المعادلة الأصلية (كلمة المرور الفعلية) مكشوفة في localStorage — XSS أو وصول مادي كافيان للسرقة |
| **الجهد المقدَّر** | 45 دقيقة |
| **الملفات المتأثرة** | `services/AuthService.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `services/AuthService.js`.
2. تحديد `enableQuickLogin()` (السطر ~218).
3. تعديل `localStorage.setItem`: إزالة حقل `eq` من الكائن المحفوظ:
   ```js
   // قبل:
   localStorage.setItem(`ahu_quick_${uid}`, JSON.stringify({ hash, userId, eq: trimmed }));
   // بعد:
   localStorage.setItem(`ahu_quick_${uid}`, JSON.stringify({ hash, userId }));
   ```
4. البحث عن أي موضع يقرأ `eq` من localStorage (`getItem` + `.eq`) وتعديله إذا وُجد.
5. تنظيف localStorage للمستخدمين الحاليين — إضافة كود ترحيل في `initSyncService` أو `checkSession`:
   ```js
   // تنظيف one-time للبيانات القديمة
   Object.keys(localStorage).filter(k => k.startsWith('ahu_quick_')).forEach(k => {
     try {
       const val = JSON.parse(localStorage.getItem(k));
       if (val && val.eq) { delete val.eq; localStorage.setItem(k, JSON.stringify(val)); }
     } catch {}
   });
   ```

**خطوات التحقق:**
- تفعيل Quick Login لمستخدم.
- فتح DevTools → Application → Local Storage.
- البحث عن مفتاح `ahu_quick_*` — يجب أن لا يحتوي على حقل `eq`.
- تسجيل الخروج وإعادة الدخول بالدخول السريع — يجب أن يعمل بشكل طبيعي.

**استراتيجية Rollback:**
- `git checkout HEAD -- services/AuthService.js`.
- يجب إعادة تفعيل Quick Login للمستخدمين المتأثرين.

---

### TASK-2.2 — تقييد صلاحيات ANON_KEY في Supabase Dashboard

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🔴 حرج |
| **المصدر** | R01, P1.1 |
| **الخطر** | المفتاح مكشوف في كود المصدر — لا يمكن إخفاؤه في Vanilla JS، لكن يمكن تقييد صلاحياته |
| **الجهد المقدَّر** | 2-4 ساعات (عمل في Supabase Dashboard) |
| **الملفات المتأثرة** | Supabase Dashboard — Row Level Security على جميع الجداول |
| **التبعيات** | لا يوجد (لكن يجب اختبار RLS بدقة لتجنب كسر وظائف موجودة) |

**خطوات التنفيذ:**
1. فتح Supabase Dashboard → Authentication → Policies.
2. لكل جدول، تفعيل RLS وإضافة سياسات:

   **جدول `users`:**
   ```sql
   -- المدير يرى الكل
   CREATE POLICY "admins_see_all_users" ON users FOR SELECT
   USING (auth.jwt() ->> 'role' IN ('admin', 'admin_assistant'));
   -- المستخدم يرى نفسه فقط
   CREATE POLICY "user_sees_self" ON users FOR SELECT
   USING (auth.uid() = auth_id);
   ```

   **جدول `transactions`:**
   ```sql
   -- المدير يرى الكل
   CREATE POLICY "admins_see_all_tx" ON transactions FOR SELECT
   USING (auth.jwt() ->> 'role' IN ('admin', 'admin_assistant'));
   -- المندوب يرى معاملاته فقط
   CREATE POLICY "agent_sees_own_tx" ON transactions FOR SELECT
   USING (agent_id = (SELECT id FROM users WHERE auth_id = auth.uid()));
   ```

   **جداول `bank_accounts`, `companies`, `expense_accounts`:**
   ```sql
   CREATE POLICY "authenticated_read" ON [table] FOR SELECT
   USING (auth.role() = 'authenticated');
   ```

3. اختبار كل سياسة بمستخدمي اختبار من كل دور.

**خطوات التحقق:**
- تسجيل الدخول كمندوب.
- في DevTools Network: مراقبة استعلامات Supabase — يجب أن لا ترجع معاملات مندوبين آخرين.
- تسجيل الدخول كمدير — يجب رؤية جميع البيانات.
- تشغيل `supabase.from('transactions').select('*')` من Console بدون auth token — يجب أن يرجع `[]` أو خطأ.

**استراتيجية Rollback:**
- حذف السياسات المُضافة من Supabase Dashboard → Policies.
- أو تنفيذ `DROP POLICY "policy_name" ON table_name;` لكل سياسة.

---

### TASK-2.3 — تفعيل التحقق من `is_active` عند كل تنقل بين التبويبات

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟠 عالية |
| **المصدر** | P2.8 |
| **الخطر** | مستخدم موقوف يستمر في العمل طوال صلاحية الـ JWT (عادة ساعة) |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | `services/AuthService.js`, `App.js` |
| **التبعيات** | TASK-2.2 (RLS يجب أن يكون مُفعَّلاً أولاً) |

**خطوات التنفيذ:**
1. في `services/AuthService.js`، إضافة دالة جديدة:
   ```js
   async function verifyActiveStatus() {
     try {
       const user = getCurrentUser();
       if (!user) return false;
       const { data } = await supabaseClient
         .from('users').select('is_active').eq('id', user.id).single();
       return data?.is_active === true;
     } catch { return true; } // في حالة offline، السماح بالاستمرار
   }
   ```
2. في `App.js`، داخل `_navigateTo()` أو حدث النقر على التبويبات، إضافة:
   ```js
   if (isOnline()) {
     const isActive = await AuthService.verifyActiveStatus();
     if (!isActive) { AuthService.logout(); return; }
   }
   ```

**خطوات التحقق:**
- تسجيل الدخول كمستخدم.
- تعطيل المستخدم من Supabase Dashboard (`is_active = false`).
- النقر على أي تبويب آخر في التطبيق — يجب أن يُسجَّل الخروج تلقائياً.
- اختبار offline: قطع الاتصال، ثم النقر بين التبويبات — يجب أن يستمر العمل.

**استراتيجية Rollback:**
- حذف استدعاء `verifyActiveStatus()` من `_navigateTo()`.
- حذف دالة `verifyActiveStatus()` من `AuthService.js`.

---

### TASK-2.4 — تطبيق Idle Timeout على المدير والمساعد الإداري

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟠 عالية |
| **المصدر** | R16, P2.5 |
| **الخطر** | جهاز مدير مفتوح بدون حراسة = وصول كامل لجميع البيانات المالية |
| **الجهد المقدَّر** | 45 دقيقة |
| **الملفات المتأثرة** | `services/IdleTimer.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `services/IdleTimer.js`.
2. تحديد الشرط الذي يُفعَّل به الـ IdleTimer — غالباً `if (user.role === ROLES.AGENT)`.
3. توسيع الشرط ليشمل جميع الأدوار:
   ```js
   // قبل:
   if (user.role === ROLES.AGENT) { startIdleTimer(); }
   // بعد:
   startIdleTimer(); // يسري على جميع الأدوار
   ```
4. ضبط مهلة المدير والمساعد على قيمة أطول إذا كان مناسباً (مثلاً 30 دقيقة بدلاً من 5):
   ```js
   const timeout = user.role === ROLES.AGENT ? 5 * 60 * 1000 : 30 * 60 * 1000;
   ```

**خطوات التحقق:**
- تسجيل الدخول كمدير.
- الانتظار حتى مهلة الخمول (أو تعديل المهلة مؤقتاً لـ 30 ثانية للاختبار).
- يجب أن يُسجَّل الخروج تلقائياً مع إشعار للمستخدم.
- تسجيل الدخول كمندوب — يجب أن تبقى مهلته 5 دقائق.

**استراتيجية Rollback:**
- استعادة الشرط الأصلي `if (user.role === ROLES.AGENT)`.

---

### TASK-2.5 — تقييد `select('*')` لاستبعاد `quick_equation_hash`

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟠 عالية |
| **المصدر** | R18, P2.7 |
| **الخطر** | هاش المعادلة يظهر في Network tab لكل مطور يفتح DevTools |
| **الجهد المقدَّر** | 1.5 ساعة |
| **الملفات المتأثرة** | `services/AuthService.js`, `store/AppStore.js`, `components/UsersComponent.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. البحث في جميع الملفات عن `.from('users').select('*')` أو `.from(TABLES.USERS).select('*')`.
2. استبدالها بـ `select` محدد يستثني `quick_equation_hash`:
   ```js
   .select('id, auth_id, name, role, is_active, allowed_tabs, created_at, updated_at')
   ```
3. الاستثناء: استعلام `_preloadEssentialData()` في AuthService يحتاج هذا الهاش للمقارنة المحلية — تركه كما هو لكن مراجعة ما إذا كان ضرورياً (Quick Login يُتحقق منه عبر RPC بالفعل).
4. إذا كان `_preloadEssentialData()` لا يستخدم الهاش فعلياً للمقارنة المحلية، تعديله أيضاً.

**خطوات التحقق:**
- فتح DevTools → Network → فلترة على Supabase endpoint.
- تحميل قائمة المستخدمين في `UsersComponent`.
- فحص الاستجابة: يجب أن لا يظهر حقل `quick_equation_hash`.
- التأكد من أن واجهة إدارة المستخدمين لا تزال تعمل (عرض الأسماء والأدوار).

**استراتيجية Rollback:**
- استعادة `select('*')` في الملفات المُعدَّلة.

---

### TASK-2.6 — إضافة حد أقصى للمبلغ في `isValidAmount()`

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟠 عالية |
| **المصدر** | R20, P2.6 |
| **الخطر** | إدخال مبالغ كارثية (مليار ريال) دون أي تحقق |
| **الجهد المقدَّر** | 20 دقيقة |
| **الملفات المتأثرة** | `utils/helpers.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `utils/helpers.js`.
2. تحديد دالة `isValidAmount()`.
3. إضافة حد أقصى منطقي (يُحدَّد بالاتفاق مع متطلبات العمل — المقترح 10 مليون):
   ```js
   function isValidAmount(value) {
     const MAX_AMOUNT = 10_000_000;
     const num = parseFloat(value);
     return !isNaN(num) && num > 0 && num <= MAX_AMOUNT;
   }
   ```
4. إضافة رسالة خطأ واضحة في نماذج الإدخال عند تجاوز الحد.

**خطوات التحقق:**
- فتح نموذج إدخال معاملة جديدة.
- إدخال مبلغ `999999999` — يجب أن يرفضه الـ form بمسالة واضحة.
- إدخال `1000000` — يجب أن يُقبَل.
- إدخال `0` و `-100` — يجب أن يُرفضا.

**استراتيجية Rollback:**
- حذف السطر `const MAX_AMOUNT` وشرط `num <= MAX_AMOUNT`.

---

## Phase 3: Synchronization Reliability — موثوقية المزامنة

> **الهدف:** إصلاح حالات فقدان البيانات وتكرارها والـ race conditions في نظام المزامنة.  
> **الجدول الزمني المقترح:** الأسبوع الثالث  
> **متطلب:** إنجاز Phase 1 بالكامل.

---

### TASK-3.1 — إصلاح `getStatement()` — إضافة LIMIT لـ `priorEntries`

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟠 عالية |
| **المصدر** | R07, P2.1 |
| **الخطر** | تعطل كشوف الحساب عند تراكم آلاف القيود — جلب غير محدود من Supabase |
| **الجهد المقدَّر** | 2 ساعات |
| **الملفات المتأثرة** | `services/AccountingService.js` |
| **التبعيات** | TASK-1.5 (الاستقرار العام للـ Supabase) |

**خطوات التنفيذ:**
1. فتح `services/AccountingService.js`.
2. تحديد `getStatement()` والاستعلام الذي يجلب `priorEntries`.
3. **الحل الأمثل:** إضافة RPC على Supabase لحساب الرصيد الافتتاحي:
   ```sql
   CREATE OR REPLACE FUNCTION get_opening_balance(p_account_id TEXT, p_from_date DATE)
   RETURNS NUMERIC AS $$
   SELECT COALESCE(SUM(CASE WHEN type = 'debit' THEN amount ELSE -amount END), 0)
   FROM account_ledger WHERE account_id = p_account_id AND date < p_from_date;
   $$ LANGUAGE sql STABLE;
   ```
4. **البديل المؤقت (إذا لم تكن RPC متاحة فوراً):** إضافة `.limit(1000)` و`.order('date', { ascending: false })` لتحديد الأثر.
5. تعديل `getStatement()` لاستخدام RPC:
   ```js
   const { data: openingBalance } = await callRPC('GET_OPENING_BALANCE', {
     p_account_id: accountId, p_from_date: fromDate
   });
   ```

**خطوات التحقق:**
- فتح DevTools → Network أثناء عرض كشف حساب نشط.
- التأكد من أن الاستعلام لا يُرجع أكثر من الحد المضروب.
- التحقق من صحة الرصيد الافتتاحي المُحسَب (مقارنته يدوياً بالأرقام المعروفة).

**استراتيجية Rollback:**
- `git checkout HEAD -- services/AccountingService.js`.
- حذف دالة RPC إذا أُضيفت: `DROP FUNCTION IF EXISTS get_opening_balance;`.

---

### TASK-3.2 — إصلاح `_voucherCounter` — استخدام sequence في Supabase

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟠 عالية |
| **المصدر** | R10, P2.2 |
| **الخطر** | أرقام إيصالات متكررة بين المستخدمين وعند إعادة تحميل الصفحة |
| **الجهد المقدَّر** | 2 ساعات |
| **الملفات المتأثرة** | `services/AccountingService.js`, Supabase (sequence) |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. في Supabase SQL Editor، إنشاء sequence:
   ```sql
   CREATE SEQUENCE IF NOT EXISTS voucher_number_seq START 1000;
   CREATE OR REPLACE FUNCTION get_next_voucher_number()
   RETURNS TEXT AS $$
   SELECT 'VCH-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || LPAD(nextval('voucher_number_seq')::TEXT, 5, '0');
   $$ LANGUAGE sql;
   ```
2. في `services/AccountingService.js`، تعديل دالة توليد رقم الإيصال:
   ```js
   async function _getNextVoucherNumber() {
     if (isOnline()) {
       const { data } = await callRPC('GET_NEXT_VOUCHER_NUMBER', {});
       if (data) return data;
     }
     // Fallback offline: مؤقت بـ timestamp
     return `VCH-LOCAL-${Date.now()}`;
   }
   ```
3. استبدال كل استخدام لـ `_voucherCounter` بـ `await _getNextVoucherNumber()`.

**خطوات التحقق:**
- إنشاء 3 معاملات متتالية — يجب أن تكون أرقام إيصالاتها تسلسلية ومختلفة.
- إعادة تحميل الصفحة وإنشاء معاملة جديدة — يجب أن يستمر التسلسل من حيث توقف.
- تسجيل الدخول من جهازين في نفس الوقت وإنشاء معاملات — لا تكرار في الأرقام.

**استراتيجية Rollback:**
- `git checkout HEAD -- services/AccountingService.js`.
- `DROP SEQUENCE IF EXISTS voucher_number_seq CASCADE;`.

---

### TASK-3.3 — تنظيف `_syncState.failedNotified` Set في SyncService

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | P3.6 |
| **الخطر** | تراكم IDs في الذاكرة مع مرور الوقت — طفيف لكن مستمر |
| **الجهد المقدَّر** | 20 دقيقة |
| **الملفات المتأثرة** | `services/SyncService.js` |
| **التبعيات** | TASK-1.3 (استقرار SyncQueue أولاً) |

**خطوات التنفيذ:**
1. فتح `services/SyncService.js`.
2. في `resolveConflict()` وعند نجاح الحل، إضافة:
   ```js
   _syncState.failedNotified.delete(conflictId);
   ```
   (هذا موجود بالفعل — التحقق فقط من أنه يعمل بشكل صحيح).
3. إضافة تنظيف دوري: في `_schedulePeriodicSync()` أو عند كل مزامنة ناجحة:
   ```js
   // إذا تجاوز الـ Set 500 عنصر، مسح العناصر القديمة
   if (_syncState.failedNotified.size > 500) {
     _syncState.failedNotified.clear();
   }
   ```

**خطوات التحقق:**
- في DevTools Console: `SyncService._triggerSync` ثم `window._syncState`.
- بعد جلسة عمل طويلة: `_syncState.failedNotified.size` يجب أن لا يتجاوز 500.

**استراتيجية Rollback:**
- `git checkout HEAD -- services/SyncService.js`.

---

### TASK-3.4 — إضافة LIMIT لـ `cleanStaleQueueItems()`

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | R11, P3.5 |
| **الخطر** | حذف دفعي ضخم عند بدء التطبيق — ضغط على IndexedDB |
| **الجهد المقدَّر** | 30 دقيقة |
| **الملفات المتأثرة** | `repository/Dexie.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `repository/Dexie.js`.
2. تحديد `cleanStaleQueueItems()`.
3. تعديل الحذف ليتم على دفعات:
   ```js
   async function cleanStaleQueueItems() {
     const BATCH_SIZE = 100;
     const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
     const stale = await db.sync_queue
       .where('created_at').below(cutoff)
       .and(item => item.sync_status === 'failed')
       .limit(BATCH_SIZE).toArray();
     if (stale.length > 0) {
       await db.sync_queue.bulkDelete(stale.map(i => i.id));
       console.log(`🧹 Dexie: حذف ${stale.length} عنصر قديم من الطابور`);
     }
   }
   ```
4. **مهم:** التأكد من أن الشرط يشمل فقط `sync_status === 'failed'` وليس `pending` — لا يُحذف ما لم يُزامَن.

**خطوات التحقق:**
- إنشاء 200+ عنصر فاشل قديم في sync_queue (يدوياً أو عبر بيانات اختبار).
- إعادة تحميل التطبيق.
- فحص IndexedDB: يجب حذف 100 عنصر فقط لا الكل.
- العناصر `pending` يجب أن تبقى بالكامل.

**استراتيجية Rollback:**
- `git checkout HEAD -- repository/Dexie.js`.

---

### TASK-3.5 — تجميع استعلامات Dashboard في RPC واحدة

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟠 عالية |
| **المصدر** | R17, P2.3 |
| **الخطر** | 3+ استعلامات مستقلة على نفس الجدول في كل تحميل للوحة التحكم |
| **الجهد المقدَّر** | 3 ساعات |
| **الملفات المتأثرة** | `components/DashboardComponent.js` |
| **التبعيات** | TASK-1.2 (تعريف RPC مُصحَّح أولاً) |

**خطوات التنفيذ:**
1. فتح `components/DashboardComponent.js`.
2. تحديد `_loadAll()` وتحليل الاستعلامات الثلاثة المنفصلة.
3. التحقق من أن RPC `GET_ADMIN_DASHBOARD` موجودة في Supabase وتُرجع البيانات المطلوبة.
4. إذا كانت موجودة وكاملة: تعديل `_loadAll()` لاستدعاء `callRPC('GET_ADMIN_DASHBOARD', { date })` مرة واحدة وتوزيع النتائج على `_renderKPI()`, `_renderBankProgress()`, `_renderAgentsBoxes()`.
5. إذا لم تكن RPC كاملة: الاكتفاء بدمج `_loadKPI()` و`_loadBankProgress()` في استعلام واحد `from(TABLES.TRANSACTIONS).select('*').eq('date', today)` وتمرير النتيجة لكلتا الدالتين.

**خطوات التحقق:**
- فتح DevTools → Network أثناء تحميل لوحة التحكم.
- عد طلبات Supabase على جدول `transactions` — يجب أن تكون 1 بدلاً من 3.
- التحقق من صحة جميع الأرقام المعروضة (KPI، تقدم البنوك، صناديق المندوبين).

**استراتيجية Rollback:**
- `git checkout HEAD -- components/DashboardComponent.js`.

---

## Phase 4: Performance Optimization — تحسين الأداء

> **الهدف:** تحسين سرعة الاستجابة وتقليل استهلاك الذاكرة والطلبات غير الضرورية.  
> **الجدول الزمني المقترح:** الأسبوع الرابع  
> **متطلب:** إنجاز Phase 1 و Phase 3.

---

### TASK-4.1 — إصلاح `_loadWeeklyChart()` offline — استعلام واحد بدلاً من 7

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | P3.10 |
| **الخطر** | 7 استعلامات IndexedDB لكل تحميل للرسم البياني الأسبوعي في وضع offline |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | `components/DashboardComponent.js` |
| **التبعيات** | TASK-3.5 (نفس الملف) |

**خطوات التنفيذ:**
1. فتح `components/DashboardComponent.js`.
2. تحديد `_loadWeeklyChart()` أو الدالة المعادلة.
3. استبدال حلقة الاستعلامات اليومية باستعلام واحد:
   ```js
   const weekStart = /* تاريخ 7 أيام مضت */;
   const weekData = await db.transactions
     .where('date').between(weekStart, today, true, true)
     .toArray();
   // ثم تجميع النتائج في JS بدلاً من Dexie:
   const byDay = weekData.reduce((acc, tx) => {
     acc[tx.date] = (acc[tx.date] || 0) + tx.amount;
     return acc;
   }, {});
   ```

**خطوات التحقق:**
- تشغيل التطبيق في وضع offline.
- فتح DevTools → Application → IndexedDB ومراقبة عمليات القراءة.
- تحميل الرسم البياني الأسبوعي — يجب ظهور قراءة واحدة فقط بدلاً من 7.
- التحقق من صحة البيانات المعروضة في الرسم البياني.

**استراتيجية Rollback:**
- `git checkout HEAD -- components/DashboardComponent.js`.

---

### TASK-4.2 — تقليل تكرار فحص `db.isOpen()` بنمط مساعد مشترك

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | Section 12 — الأكواد المكررة |
| **الخطر** | صيانة 20+ موضع متفرق عند تغيير منطق التحقق |
| **الجهد المقدَّر** | 2 ساعات |
| **الملفات المتأثرة** | `utils/helpers.js`, الملفات المُحدَّثة (لا تعديل واسع — فقط توحيد النمط في الملفات الجديدة) |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. إضافة دالة مساعدة في `utils/helpers.js`:
   ```js
   async function withDexie(fn) {
     if (typeof db === 'undefined' || !db.isOpen()) return null;
     try { return await fn(db); } catch (e) { console.warn('Dexie error:', e.message); return null; }
   }
   ```
2. **لا تعديل الكود القائم** — فقط استخدام `withDexie()` في الكود الجديد أو عند تعديل ملف لسبب آخر.

**خطوات التحقق:**
- التأكد من أن `withDexie` منشورة على `window.withDexie` أو متاحة عالمياً.
- استخدامها في TASK التالية كمرجع.

**استراتيجية Rollback:**
- حذف `withDexie` من `helpers.js`.

---

### TASK-4.3 — تحسين `_loadNotifications()` — تخزين `read_by` و`hidden_by` محلولاً

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | Section 6 — مشاكل الأداء |
| **الخطر** | `JSON.parse()` على كل إشعار في كل تحميل — طفيف حالياً لكن يتفاقم |
| **الجهد المقدَّر** | 45 دقيقة |
| **الملفات المتأثرة** | `store/AppStore.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `store/AppStore.js`.
2. تحديد `_loadNotifications()`.
3. إضافة دالة تطبيعية تُشغَّل مرة واحدة عند الجلب:
   ```js
   function _normalizeNotification(n) {
     return {
       ...n,
       read_by: typeof n.read_by === 'string' ? JSON.parse(n.read_by || '[]') : (n.read_by || []),
       hidden_by: typeof n.hidden_by === 'string' ? JSON.parse(n.hidden_by || '[]') : (n.hidden_by || []),
       target: typeof n.target === 'string' ? JSON.parse(n.target || 'null') : n.target,
     };
   }
   ```
4. تطبيقها على المصفوفة بعد الجلب: `data.map(_normalizeNotification)`.
5. استبدال كل `JSON.parse()` في المكونات باستخدام الحقول المُحلَّلة مباشرة.

**خطوات التحقق:**
- تحميل صفحة الإشعارات.
- التأكد من عرض حالة القراءة بشكل صحيح.
- فتح إشعار وتأكيد تحديث `read_by` بشكل صحيح.

**استراتيجية Rollback:**
- `git checkout HEAD -- store/AppStore.js`.

---

### TASK-4.4 — إضافة فهرس `[account_id + date]` على Supabase `account_ledger`

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | P3.8 |
| **الخطر** | بطء كشوف الحساب عند نمو `account_ledger` |
| **الجهد المقدَّر** | 15 دقيقة |
| **الملفات المتأثرة** | Supabase Dashboard فقط |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. في Supabase SQL Editor:
   ```sql
   CREATE INDEX IF NOT EXISTS idx_account_ledger_account_date
   ON account_ledger (account_id, date DESC);
   
   CREATE INDEX IF NOT EXISTS idx_account_ledger_reference
   ON account_ledger (reference_id);
   ```

**خطوات التحقق:**
```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'account_ledger';
```
يجب أن يظهر `idx_account_ledger_account_date`.

**استراتيجية Rollback:**
```sql
DROP INDEX IF EXISTS idx_account_ledger_account_date;
DROP INDEX IF EXISTS idx_account_ledger_reference;
```

---

### TASK-4.5 — إصلاح تراكم Event Listeners في App.js Header

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | Section 9 — Event Listener Leaks |
| **الخطر** | إعادة بناء الهيدر (عند تحديث الشعار) تُكدِّس listeners |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | `App.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `App.js`.
2. تحديد كل `addEventListener` في دوال بناء الهيدر (السطور ~250-291).
3. تحويل handlers إلى event delegation على container واحد:
   ```js
   // بدلاً من إضافة listener لكل زر:
   headerContainer.addEventListener('click', (e) => {
     const btn = e.target.closest('[data-action]');
     if (!btn) return;
     const action = btn.dataset.action;
     if (action === 'logout') AuthService.logout();
     if (action === 'sync') SyncService.manualSync();
     // ... إلخ
   });
   ```
4. التأكد من أن هذا الـ listener يُضاف مرة واحدة فقط في دورة حياة التطبيق.

**خطوات التحقق:**
- في DevTools: `getEventListeners(document.querySelector('.header-container'))` قبل وبعد تحديث الشعار.
- يجب أن لا يزداد عدد الـ listeners بعد التحديث.
- التحقق من عمل أزرار الهيدر (logout, sync, theme) بشكل طبيعي.

**استراتيجية Rollback:**
- `git checkout HEAD -- App.js`.

---

## Phase 5: Code Quality & Refactoring — جودة الكود وإعادة الهيكلة

> **الهدف:** تقليل التكرار وتحسين قابلية الصيانة دون تغيير السلوك الخارجي.  
> **الجدول الزمني المقترح:** الأسبوع الخامس والسادس  
> **متطلب:** إنجاز Phase 1 و Phase 2.

---

### TASK-5.1 — نقل CSS الهيدر من `_injectHeaderStyles()` إلى styles.css

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | P3.3 |
| **الخطر** | صعوبة صيانة الـ CSS المدفون في JavaScript |
| **الجهد المقدَّر** | 1.5 ساعة |
| **الملفات المتأثرة** | `App.js`, `assets/css/styles.css` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `App.js` وتحديد `_injectHeaderStyles()`.
2. استخراج محتوى CSS من السلسلة النصية ونقله كما هو إلى `assets/css/styles.css` في نهاية الملف تحت تعليق `/* Header Styles */`.
3. حذف `_injectHeaderStyles()` من `App.js`.
4. حذف استدعاء `_injectHeaderStyles()` من `_buildHeader()` أو أي موضع آخر.
5. التأكد من أن `styles.css` مُحمَّل في `index.html` قبل أي script.

**خطوات التحقق:**
- تحميل التطبيق — يجب أن يبدو الهيدر متطابقاً بصرياً مع ما كان عليه.
- DevTools → Elements: البحث عن `<style>` tags مُحقَنة — يجب أن لا يكون هناك style tag للهيدر.
- اختبار الوضع المظلم والفاتح.

**استراتيجية Rollback:**
- `git checkout HEAD -- App.js assets/css/styles.css`.

---

### TASK-5.2 — إضافة Content Security Policy في index.html

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | R12, P3.1 |
| **الخطر** | هجمات XSS وتحميل scripts خارجية غير مصرح بها |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | `index.html` |
| **التبعيات** | TASK-5.1 (يجب إزالة inline styles أولاً لأن CSP تمنع `style-src 'unsafe-inline'`) |

**خطوات التنفيذ:**
1. فتح `index.html`.
2. في `<head>`، إضافة meta CSP:
   ```html
   <meta http-equiv="Content-Security-Policy" content="
     default-src 'self';
     script-src 'self' https://cdn.tailwindcss.com https://unpkg.com https://cdn.jsdelivr.net;
     style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
     font-src 'self' https://fonts.gstatic.com;
     connect-src 'self' https://*.supabase.co wss://*.supabase.co;
     img-src 'self' data: https://*.supabase.co;
   ">
   ```
3. ملاحظة: `style-src 'unsafe-inline'` ضروري مؤقتاً لـ Tailwind CDN الذي يُحقن styles.
4. إضافة Subresource Integrity (SRI) للسكريبتات الخارجية:
   - الحصول على hashes من https://www.srihash.org
   - إضافة `integrity="sha384-..."` و`crossorigin="anonymous"` لكل CDN script.

**خطوات التحقق:**
- فتح DevTools → Console: لا يجب أن تظهر أخطاء CSP للعمليات العادية.
- محاولة تنفيذ `eval('alert(1)')` في Console — يجب أن يُرفض.
- التأكد من أن جميع المكتبات الخارجية (Chart.js, Lucide, Supabase) تعمل بشكل طبيعي.

**استراتيجية Rollback:**
- حذف meta CSP من `index.html`.

---

### TASK-5.3 — توحيد نمط Online-First في مساعد مشترك

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟢 منخفضة |
| **المصدر** | Section 12 — الأكواد المكررة |
| **الخطر** | تكرار نمط `if (isOnline()) { Supabase } else { Dexie }` في كل مكون |
| **الجهد المقدَّر** | 2 ساعات |
| **الملفات المتأثرة** | `utils/helpers.js` (إضافة)، لا تعديل على الملفات القائمة |
| **التبعيات** | TASK-4.2 |

**خطوات التنفيذ:**
1. في `utils/helpers.js`، إضافة:
   ```js
   async function fetchOnlineFirst(supabaseFn, dexieFn) {
     if (isOnline()) {
       try { return await supabaseFn(); } catch (e) {
         console.warn('Online fetch failed, falling back:', e.message);
       }
     }
     return dexieFn ? await dexieFn() : err('offline');
   }
   window.fetchOnlineFirst = fetchOnlineFirst;
   ```
2. **لا تعديل إجباري** على الكود القائم — فقط توثيق النمط واستخدامه في الكود الجديد.

**خطوات التحقق:**
- `typeof window.fetchOnlineFirst === 'function'` في Console — يجب أن يُرجع `true`.

**استراتيجية Rollback:**
- حذف `fetchOnlineFirst` من `helpers.js`.

---

### TASK-5.4 — تنظيف `_loginAttempts` Map في AuthService

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟢 منخفضة |
| **المصدر** | Section 9 — استهلاك الذاكرة |
| **الخطر** | تراكم طفيف في الذاكرة مع مرور الوقت |
| **الجهد المقدَّر** | 20 دقيقة |
| **الملفات المتأثرة** | `services/AuthService.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. فتح `services/AuthService.js`.
2. تحديد `_loginAttempts` Map.
3. في `_checkBruteForce()` أو عند نجاح تسجيل الدخول، إضافة تنظيف:
   ```js
   // بعد تسجيل الدخول الناجح:
   _loginAttempts.delete(key);
   
   // تنظيف دوري: حذف الإدخالات القديمة (أكثر من ساعة)
   const now = Date.now();
   for (const [k, v] of _loginAttempts.entries()) {
     if (now - v.lastAttempt > 60 * 60 * 1000) _loginAttempts.delete(k);
   }
   ```

**خطوات التحقق:**
- تسجيل الدخول بنجاح.
- في Console: لا يجب أن يتراكم عدد مفاتيح `_loginAttempts` بشكل غير محدود.

**استراتيجية Rollback:**
- `git checkout HEAD -- services/AuthService.js`.

---

### TASK-5.5 — توثيق دوال RPC في config.js

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟢 منخفضة |
| **المصدر** | Section 15 ملاحظات المعلومات غير الكافية |
| **الخطر** | صعوبة فهم RPC المتاحة وبارامتراتها |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | `config.js` |
| **التبعيات** | TASK-1.2 (بعد دمج RPC في تعريف واحد) |

**خطوات التنفيذ:**
1. بعد دمج `window.RPC` في TASK-1.2، إضافة تعليق مختصر لكل RPC يوضح:
   - الغرض
   - البارامترات المطلوبة
   - نوع القيمة المُرجَعة
   ```js
   const RPC = {
     CREATE_TRANSACTION_WITH_ENTRIES: 'create_transaction_with_entries', // params: {tx_data, entries_data}
     GET_ADMIN_DASHBOARD: 'get_admin_dashboard', // params: {p_date} → {kpi, banks, agents}
     // ...
   };
   ```

**خطوات التحقق:**
- مراجعة بصرية للتعليقات — يجب أن تكون دقيقة ومتطابقة مع الـ RPC الفعلية في Supabase.

**استراتيجية Rollback:**
- حذف التعليقات فقط (لا تأثير وظيفي).

---

## Phase 6: Production Hardening — تصليب بيئة الإنتاج

> **الهدف:** إضافة طبقات حماية إضافية وتحسينات تشغيلية لبيئة إنتاج مستدامة.  
> **الجدول الزمني المقترح:** الأسبوعان السابع والثامن  
> **متطلب:** إنجاز Phase 1 و Phase 2 بالكامل، Phase 3 اختياري لكن مُوصى به.

---

### TASK-6.1 — إضافة Rate Limiting على Supabase لطلبات المصادقة

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | P4.4 |
| **الخطر** | Brute Force من أجهزة مختلفة يتجاوز الحماية المحلية |
| **الجهد المقدَّر** | 30 دقيقة |
| **الملفات المتأثرة** | Supabase Dashboard → Auth Settings |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. Supabase Dashboard → Authentication → Rate Limits.
2. ضبط الإعدادات:
   - Email Sign-ins: 5 per hour per IP
   - Token Refresh: 360 per hour
3. في `VERIFY_QUICK_LOGIN` RPC، إضافة rate limiting داخل الدالة:
   ```sql
   -- داخل دالة verify_quick_login:
   -- التحقق من عدد المحاولات الأخيرة في آخر 15 دقيقة
   IF (SELECT COUNT(*) FROM auth.audit_log_entries
       WHERE ip_address = current_setting('request.headers')::json->>'x-forwarded-for'
       AND created_at > NOW() - INTERVAL '15 minutes'
       AND event_message LIKE '%quick_login%') > 5 THEN
     RAISE EXCEPTION 'too_many_attempts';
   END IF;
   ```

**خطوات التحقق:**
- محاولة 6 محاولات دخول سريع فاشلة في 15 دقيقة.
- يجب أن تُرفض المحاولة السادسة.

**استراتيجية Rollback:**
- إعادة ضبط Auth Rate Limits لقيمها الافتراضية.
- تعديل دالة RPC لإزالة شرط Rate Limiting.

---

### TASK-6.2 — إعداد مراقبة الأخطاء وتنبيهات Supabase

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | Section 11 — المخاطر المستقبلية (R13) |
| **الخطر** | توقف الخدمة دون علم عند تجاوز حصة Supabase أو حدوث أخطاء |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | Supabase Dashboard، `utils/helpers.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. Supabase Dashboard → Monitoring → إعداد تنبيهات البريد الإلكتروني لـ:
   - قاعدة البيانات > 80% من الحصة
   - Bandwidth > 80% من الحصة
   - عدد Errors المرتفع
2. في `utils/helpers.js`، إضافة مُلقِّط للأخطاء الحرجة:
   ```js
   window.addEventListener('unhandledrejection', (event) => {
     console.error('🔴 Unhandled Promise Rejection:', event.reason);
     // يمكن إرسال للـ Supabase audit_logs أو خدمة خارجية
   });
   ```

**خطوات التحقق:**
- إثارة خطأ غير معالج في Console: `Promise.reject(new Error('test'))`.
- يجب أن يظهر في Console بشكل موحد.

**استراتيجية Rollback:**
- إزالة event listener من `helpers.js`.
- إلغاء التنبيهات من Supabase Dashboard.

---

### TASK-6.3 — اختبار استرداد البيانات (Disaster Recovery Drill)

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | Section 7 — مخاطر فقدان البيانات |
| **الخطر** | عدم التحقق من قدرة الاستعادة حتى يصبح الوقت متأخراً |
| **الجهد المقدَّر** | 2 ساعات |
| **الملفات المتأثرة** | لا ملفات (اختبار تشغيلي) |
| **التبعيات** | جميع مهام Phase 1 و Phase 3 |

**خطوات التنفيذ:**
1. إنشاء نسخة احتياطية كاملة من Supabase (Database Backup).
2. اختبار وضع offline:
   - قطع الاتصال لـ 5 دقائق.
   - إجراء 5-10 معاملات متنوعة.
   - استعادة الاتصال.
   - التحقق من مزامنة جميع المعاملات بشكل صحيح في Supabase.
3. اختبار انقطاع الاتصال أثناء إنشاء معاملة:
   - بدء إنشاء معاملة.
   - قطع الاتصال قبل إتمامها.
   - إعادة الاتصال.
   - التحقق من عدم تكرار المعاملة.
4. توثيق النتائج.

**خطوات التحقق:**
- جميع المعاملات المُنشأة offline موجودة في Supabase.
- لا تكرار في المعاملات.
- أرقام الإيصالات صحيحة وغير متكررة.

**استراتيجية Rollback:**
- استعادة النسخة الاحتياطية إذا تلفت البيانات أثناء الاختبار.

---

### TASK-6.4 — إضافة نظام لوغ مركزي بسيط

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟢 منخفضة |
| **المصدر** | P4.9 |
| **الخطر** | صعوبة debugging مشاكل الإنتاج |
| **الجهد المقدَّر** | 1.5 ساعة |
| **الملفات المتأثرة** | `utils/helpers.js` |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. إضافة `Logger` بسيط في `helpers.js`:
   ```js
   const Logger = {
     _buffer: [],
     _maxBuffer: 200,
     log(level, module, msg, data) {
       const entry = { ts: new Date().toISOString(), level, module, msg, data };
       this._buffer.push(entry);
       if (this._buffer.length > this._maxBuffer) this._buffer.shift();
       if (level === 'error') console.error(`[${module}]`, msg, data || '');
       else if (level === 'warn') console.warn(`[${module}]`, msg, data || '');
     },
     error: (m, msg, d) => Logger.log('error', m, msg, d),
     warn: (m, msg, d) => Logger.log('warn', m, msg, d),
     info: (m, msg, d) => Logger.log('info', m, msg, d),
     getLogs: () => [...Logger._buffer],
   };
   window.Logger = Logger;
   ```
2. **لا استبدال إجباري** لـ `console.log` القائم — فقط استخدام `Logger` في الكود الجديد.

**خطوات التحقق:**
- `window.Logger.getLogs()` في Console — يجب أن يُرجع مصفوفة من الأحداث المسجَّلة.

**استراتيجية Rollback:**
- حذف `Logger` من `helpers.js`.

---

### TASK-6.5 — مراجعة وتوثيق إجراءات النسخ الاحتياطي الدوري

| الحقل | التفاصيل |
|-------|---------|
| **الأولوية** | 🟡 متوسطة |
| **المصدر** | Section 13 — المشاكل المحتملة |
| **الخطر** | فقدان البيانات الكاملة في حالة خطأ كارثي |
| **الجهد المقدَّر** | 1 ساعة |
| **الملفات المتأثرة** | لا ملفات (توثيق إجراءات) |
| **التبعيات** | لا يوجد |

**خطوات التنفيذ:**
1. Supabase Dashboard → Database → Backups: تفعيل النسخ الاحتياطي اليومي (متاح في الخطة المدفوعة).
2. إذا كانت الخطة مجانية: إنشاء جدول أسبوعي يدوي لتشغيل `pg_dump` أو استخدام ميزة Export في Supabase.
3. اختبار استعادة النسخة الاحتياطية على بيئة Supabase مستقلة (Branch).
4. توثيق الإجراء في `Setup.md`.

**خطوات التحقق:**
- وجود نسخة احتياطية حديثة لا يتجاوز عمرها 7 أيام.
- اختبار استعادة ناجح.

**استراتيجية Rollback:**
- لا يوجد — هذه مهمة وقائية لا تُعدِّل الكود.

---

## ملخص تنفيذي

### جدول المهام الكاملة

| # | المهمة | المرحلة | الأولوية | الجهد | الملفات |
|---|--------|---------|---------|-------|---------|
| 1.1 | إصلاح `defer` لـ ProfileSettings و QuickLoginBanner | Phase 1 | 🔴 | 15 د | index.html |
| 1.2 | دمج `window.RPC` المزدوج | Phase 1 | 🔴 | 30 د | config.js |
| 1.3 | إصلاح `_executeUpdate/Delete` في SyncQueue | Phase 1 | 🔴 | 1 س | SyncQueue.js |
| 1.4 | إصلاح `resolveConflict()` — onConflict | Phase 1 | 🔴 | 30 د | SyncQueue.js |
| 1.5 | UNIQUE constraint على transactions.id | Phase 1 | 🔴 | 20 د | Supabase |
| 2.1 | إزالة `eq: trimmed` من localStorage | Phase 2 | 🔴 | 45 د | AuthService.js |
| 2.2 | تقييد ANON_KEY عبر RLS | Phase 2 | 🔴 | 4 س | Supabase |
| 2.3 | التحقق من `is_active` عند التنقل | Phase 2 | 🟠 | 1 س | AuthService.js, App.js |
| 2.4 | Idle Timeout للمدير والمساعد | Phase 2 | 🟠 | 45 د | IdleTimer.js |
| 2.5 | تقييد `select('*')` لاستبعاد hash | Phase 2 | 🟠 | 1.5 س | 3 ملفات |
| 2.6 | حد أقصى للمبلغ في isValidAmount | Phase 2 | 🟠 | 20 د | helpers.js |
| 3.1 | LIMIT لـ `priorEntries` في getStatement | Phase 3 | 🟠 | 2 س | AccountingService.js |
| 3.2 | إصلاح `_voucherCounter` — sequence | Phase 3 | 🟠 | 2 س | AccountingService.js |
| 3.3 | تنظيف `failedNotified` Set | Phase 3 | 🟡 | 20 د | SyncService.js |
| 3.4 | LIMIT لـ `cleanStaleQueueItems` | Phase 3 | 🟡 | 30 د | Dexie.js |
| 3.5 | تجميع استعلامات Dashboard | Phase 3 | 🟠 | 3 س | DashboardComponent.js |
| 4.1 | استعلام واحد للرسم البياني الأسبوعي | Phase 4 | 🟡 | 1 س | DashboardComponent.js |
| 4.2 | مساعد `withDexie()` مشترك | Phase 4 | 🟡 | 2 س | helpers.js |
| 4.3 | تطبيع بيانات الإشعارات | Phase 4 | 🟡 | 45 د | AppStore.js |
| 4.4 | فهرس `[account_id+date]` على Supabase | Phase 4 | 🟡 | 15 د | Supabase |
| 4.5 | إصلاح تراكم Event Listeners في Header | Phase 4 | 🟡 | 1 س | App.js |
| 5.1 | نقل CSS الهيدر إلى styles.css | Phase 5 | 🟡 | 1.5 س | App.js, styles.css |
| 5.2 | إضافة Content Security Policy | Phase 5 | 🟡 | 1 س | index.html |
| 5.3 | توحيد نمط Online-First | Phase 5 | 🟢 | 2 س | helpers.js |
| 5.4 | تنظيف `_loginAttempts` Map | Phase 5 | 🟢 | 20 د | AuthService.js |
| 5.5 | توثيق دوال RPC في config.js | Phase 5 | 🟢 | 1 س | config.js |
| 6.1 | Rate Limiting على Supabase Auth | Phase 6 | 🟡 | 30 د | Supabase |
| 6.2 | مراقبة الأخطاء وتنبيهات Supabase | Phase 6 | 🟡 | 1 س | Supabase, helpers.js |
| 6.3 | اختبار استرداد البيانات | Phase 6 | 🟡 | 2 س | — |
| 6.4 | نظام Logger مركزي بسيط | Phase 6 | 🟢 | 1.5 س | helpers.js |
| 6.5 | توثيق إجراءات النسخ الاحتياطي | Phase 6 | 🟡 | 1 س | Setup.md |

### إجمالي الجهد المقدَّر

| المرحلة | الجهد الإجمالي | المخاطر المعالجة |
|---------|--------------|-----------------|
| Phase 1 | ~3.5 ساعات | R04, R05, R08, R09, R14 |
| Phase 2 | ~9 ساعات | R01, R03, R06, R16, R18, R20 |
| Phase 3 | ~8 ساعات | R07, R10, R11, R17 |
| Phase 4 | ~6 ساعات | أداء وذاكرة |
| Phase 5 | ~6.5 ساعات | R12، جودة الكود |
| Phase 6 | ~7 ساعات | R13، استدامة الإنتاج |
| **الإجمالي** | **~40 ساعة عمل** | **20 مخاطرة من Risk Register** |

---

*هذه الخطة تُنجَز بشكل تدريجي — كل مرحلة قابلة للتسليم والاختبار بشكل مستقل.*  
*التحديث الأخير: 2026-06-06*
