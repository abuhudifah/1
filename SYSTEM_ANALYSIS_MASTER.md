# SYSTEM_ANALYSIS_MASTER.md
# نظام أبو حذيفة المتكامل للصرافة والتحويلات
# تقرير التحليل المعماري الشامل

**تاريخ التقرير:** 2026-06-06  
**المُحلِّل:** Principal Software Architect — Claude (Sonnet 4.6)  
**الإصدار المُحلَّل:** v3.0 / v4.1  
**إجمالي الملفات المُحلَّلة:** 32 ملفاً  

---

## 1. Executive Summary

### وصف عام للنظام
نظام أبو حذيفة للصرافة والتحويلات هو تطبيق ويب مالي متكامل (SPA) مبني بـ Vanilla JavaScript خالص بدون أي إطار عمل frontend. يُدير عمليات الصرافة والتحويلات المالية مع دعم العمل دون اتصال (Offline-First). يعتمد على Supabase كقاعدة بيانات سحابية ومزود للمصادقة، وعلى Dexie.js (IndexedDB) كطبقة تخزين محلية احتياطية.

**المكونات الأساسية:**
- نظام محاسبي بالقيد المزدوج (Double-Entry Accounting)
- إدارة مستخدمين بثلاثة أدوار (مدير، مساعد إداري، مندوب)
- مزامنة ذكية مع طابور انتظار ودعم حل التعارضات
- لوحة تحكم إدارية مع رسوم بيانية حية (Realtime)
- دخول سريع بمعادلات رياضية مع تشفير SHA-256

### تقييم عام للبنية الحالية
البنية الحالية **طموحة** لنظام Vanilla JS ولكنها تحمل **عبئاً تقنياً** (Technical Debt) كبيراً ناجماً عن:
- اعتماد كلي على المتغيرات العامة (Global Variables) عبر `window.*`
- غياب أي نظام تجميع (Bundler) أو إدارة تبعيات (Package Manager)
- قواعد بيانات مزدوجة تُعقّد منطق التزامن
- كود CSS مُحقَن برمجياً داخل JavaScript (JavaScript-injected styles)
- غياب أي اختبارات تلقائية (Unit/Integration Tests)

### نسبة جاهزية النظام للإنتاج

| المجال | التقييم | النسبة |
|--------|---------|--------|
| الوظائف الأساسية | جيدة جداً | 78% |
| الأمان | متوسط | 55% |
| الأداء | متوسط | 60% |
| الاستقرار | جيد | 70% |
| قابلية الصيانة | ضعيفة | 35% |
| التوثيق | جيد جداً | 80% |
| **الإجمالي** | **متوسط-جيد** | **63%** |

**الاستنتاج:** النظام يعمل بشكل معقول في بيئة محكومة (مستخدمون محدودون، بيانات يومية نسبياً)، لكنه **غير جاهز للإنتاج الحقيقي** دون معالجة المخاطر الأمنية والبنيوية الجوهرية.

---

## 2. Architecture Analysis

### تحليل البنية المعمارية الحالية

```
┌─────────────────────────────────────────────────────────┐
│                    index.html (Entry Point)              │
│            تحميل متسلسل صارم لـ 32 ملف JS              │
└───────────────────────────┬─────────────────────────────┘
                            │ defer scripts (ordered)
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────────┐
│   config.js  │   │  helpers.js  │   │   Dexie.js       │
│  (Constants) │   │  (Utilities) │   │  (IndexedDB)     │
└──────┬───────┘   └──────┬───────┘   └────────┬─────────┘
       │                  │                     │
       └──────────────────┼─────────────────────┘
                          ▼
              ┌───────────────────────┐
              │   SupabaseClient.js   │
              │  (Supabase Instance)  │
              └───────────┬───────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
      ┌──────────┐ ┌──────────┐ ┌──────────┐
      │Repository│ │SyncQueue │ │AuthService│
      │  .js     │ │   .js    │ │   .js    │
      └──────────┘ └──────────┘ └──────────┘
              │           │           │
              └───────────┼───────────┘
                          ▼
              ┌───────────────────────┐
              │      AppStore.js      │
              │   (EventTarget State) │
              └───────────┬───────────┘
                          │
              ┌───────────┼───────────┐
              ▼           ▼           ▼
        ┌─────────┐ ┌─────────┐ ┌─────────┐
        │Dashboard│ │DataEntry│ │  ...    │
        │Component│ │Component│ │12 Comp. │
        └─────────┘ └─────────┘ └─────────┘
```

**النمط المُتبَّع:** Layered Architecture + Event-Driven Communication

### نقاط القوة

1. **Result Pattern موحد:** استخدام `ok(data) / err(msg) / isOk(result)` في جميع الملفات يُنتج كوداً متوقعاً وقابلاً للتتبع.
2. **FIX Documentation:** توثيق واضح لكل إصلاح تم (FIX-1 إلى FIX-5b) مع شرح السبب الجذري.
3. **Online-First مع Dexie Fallback:** المنطق المعمول به سليم من حيث التصميم — Supabase أولاً، Dexie للطوارئ فقط.
4. **Double-Entry Accounting:** التطبيق الصحيح للقيد المزدوج مع التحقق من التوازن (`validateLedger`).
5. **XSS Protection:** استخدام `escapeHtml()` و`textContent` في الأماكن الحساسة.
6. **Brute Force Protection:** حماية تجريبية من الهجمات عبر `_loginAttempts` map.
7. **Exponential Backoff:** تصميم سليم للمزامنة مع تأخير تصاعدي وعشوائية (jitter).

### نقاط الضعف

1. **Global Variable Hell:** كل الكائنات تعيش على `window.*` — لا namespace، لا module isolation.
2. **No Build System:** لا Webpack، لا Vite، لا ESM imports — التبعيات يدوية وهشة.
3. **No Tests:** صفر اختبارات تلقائية على نظام مالي حقيقي.
4. **CSS-in-JS غير منظم:** `_injectHeaderStyles()` في App.js تُحقن CSS عبر `<style>` tags داخل JavaScript.
5. **Tight Coupling عبر window:** المكونات تستدعي بعضها عبر `window.ComponentName` مباشرة.
6. **ANON_KEY مكشوف في كود المصدر:** مفتاح Supabase موجود كـ plaintext في `config.js`.

### مدى التوافق بين المكونات

| الزوج | درجة التوافق | ملاحظات |
|-------|-------------|---------|
| Repository ↔ SyncQueue | عالية | واضح ومتسق |
| AuthService ↔ AppStore | متوسطة | تداخل في مسؤوليات الجلسة |
| SyncService ↔ SyncQueue | عالية | تفويض واضح |
| Components ↔ AppStore | متوسطة | بعض المكونات تُحدّث Supabase مباشرة |
| AccountingService ↔ Repository | متوسطة | أحياناً يُسأل Supabase مباشرة |
| config.js ↔ كل الملفات | ضعيفة | ثوابت `RPC` مُعرَّفة مرتين (bug) |

---

## 3. Module Inventory

| الملف | مسؤوليته | الملفات المرتبطة | مستوى الأهمية |
|-------|---------|----------------|--------------|
| `config.js` | ثوابت النظام، مفاتيح Supabase، تكوين التطبيق | جميع الملفات | 🔴 حرج |
| `utils/helpers.js` | دوال مساعدة عامة (ok/err، UUID، تنسيق، توست، SHA-256) | جميع الملفات | 🔴 حرج |
| `repository/Dexie.js` | تعريف مخطط IndexedDB (16 جدولاً)، تهيئة، تنظيف | Repository.js، SyncQueue.js | 🔴 حرج |
| `repository/SupabaseClient.js` | إنشاء عميل Supabase، Realtime، مراقبة الاتصال | جميع الملفات تقريباً | 🔴 حرج |
| `repository/Repository.js` | CRUD موحد (Online-First + Dexie Fallback) | SyncQueue.js، جميع المكونات | 🔴 حرج |
| `repository/SyncQueue.js` | طابور المزامنة، Exponential Backoff، حل التعارضات | Repository.js، SyncService.js | 🔴 حرج |
| `services/AuthService.js` | تسجيل الدخول (تقليدي + سريع)، RBAC، جلسات | AppStore.js، App.js | 🔴 حرج |
| `services/AccountingService.js` | منطق القيد المزدوج، إنشاء المعاملات، الإقفال | Repository.js، SyncQueue.js | 🔴 حرج |
| `services/SyncService.js` | جدولة المزامنة (30 ثانية)، اتصال بـ SyncQueue | SyncQueue.js، AppStore.js | 🔴 حرج |
| `store/AppStore.js` | الحالة المركزية (EventTarget)، تحميل البيانات | جميع المكونات | 🔴 حرج |
| `App.js` | Bootstrap، تهيئة، توجيه، Header/Nav، تدمير المكونات | جميع المكونات | 🔴 حرج |
| `components/DashboardComponent.js` | لوحة المعلومات، KPIs، رسوم بيانية، Realtime | AppStore.js، supabaseClient | 🟠 عالي |
| `components/DataEntryComponent.js` | نماذج الإدخال (تحصيل، إيداع، مصروف، تحويل) | AccountingService.js | 🟠 عالي |
| `components/LoginComponent.js` | واجهة الدخول (آلة حاسبة + تقليدي) | AuthService.js | 🟠 عالي |
| `components/DailySummaryComponent.js` | الملخص اليومي، طباعة، واتساب | repo، supabaseClient | 🟠 عالي |
| `components/BankAccountsComponent.js` | إدارة الحسابات البنكية، الإيداعات اليومية | repo، AppStore.js | 🟠 عالي |
| `components/AccountManagementComponent.js` | دفتر الأستاذ، كشوفات الحساب، ميزان المراجعة | AccountingService.js، repo | 🟠 عالي |
| `components/UsersComponent.js` | إدارة المستخدمين (إنشاء، تعطيل، حذف، تغيير كلمة مرور) | supabaseClient، AppStore.js | 🟠 عالي |
| `components/DebtorsComponent.js` | إدارة العملاء المديونين | repo | 🟡 متوسط |
| `components/FailedDepositsComponent.js` | الإيداعات الفاشلة، تدفق الحالات | repo | 🟡 متوسط |
| `components/AllOperationsComponent.js` | قائمة جميع العمليات مع فلاتر وصفحات | repo، supabaseClient | 🟡 متوسط |
| `components/AuditLogComponent.js` | سجل التدقيق (عبر RPC) | callRPC، supabaseClient | 🟡 متوسط |
| `components/NotificationsComponent.js` | قراءة/إخفاء الإشعارات، إرسال جديد | repo، AppStore.js | 🟡 متوسط |
| `components/SettingsComponent.js` | رفع الشعار، نسخ احتياطي، إعادة تعيين | supabaseClient، AppStore.js | 🟡 متوسط |
| `components/ProfileSettingsComponent.js` | إعدادات الملف الشخصي، تفعيل الدخول السريع | AuthService.js | 🟡 متوسط |
| `services/IdleTimer.js` | الخروج التلقائي بعد 5 دقائق خمول (للمناديب فقط) | AuthService.js، App.js | 🟡 متوسط |
| `services/ThemeManager.js` | إدارة الوضع المظلم/الفاتح، مزامنة عبر التبويبات | localStorage | 🟢 منخفض |
| `utils/QuickLoginBanner.js` | بانر دعوة لتفعيل الدخول السريع (snooze/dismiss) | AuthService.js، localStorage | 🟢 منخفض |
| `index.html` | نقطة دخول HTML، ترتيب تحميل السكريبتات | جميع الملفات | 🔴 حرج |
| `assets/css/styles.css` | تصميم glassmorphism، الوضع المظلم، متجاوب | index.html | 🟡 متوسط |
| `README.md` | توثيق البنية المعمارية | — | 🟢 منخفض |
| `Setup.md` | دليل إعداد Supabase (9 ملفات SQL) | — | 🟡 متوسط |

---

## 4. Dependency Analysis

### العلاقات بين الوحدات

```
config.js
    ↓ (يُصدَّر لـ window.*)
helpers.js
    ↓
Dexie.js → Repository.js ←─── SyncQueue.js
    ↓              ↓                  ↓
SupabaseClient.js  ↓           SyncService.js
    ↓ ─────────────┘                  │
AuthService.js ──────────────────────┤
    ↓                                 │
AccountingService.js ─────────────────┤
    ↓                                 │
AppStore.js ──────────────────────────┤
    ↓                                 │
App.js (Bootstrap) ←──────────────────┘
    ↓
[12 Component]
```

### Circular Dependencies

**لا توجد دورات مباشرة في الاستيراد** (لأن المشروع لا يستخدم ESM/CommonJS). لكن هناك **دورات منطقية** خطيرة عبر `window.*`:

| الدورة | الخطورة | الوصف |
|--------|---------|-------|
| `AppStore → SyncService → AppStore` | 🟠 عالية | AppStore يستمع لأحداث SyncService، وSyncService يرسل أحداثاً لـ AppStore |
| `AuthService → Dexie ← Repository → AuthService` | 🟡 متوسطة | كلاهما يقرأ/يكتب Dexie مباشرة دون تنسيق |
| `AccountingService → SyncQueue ← Repository` | 🟡 متوسطة | كلاهما يُضيف للـ SyncQueue بشكل مستقل |

### Coupling Issues

1. **Tight Coupling عبر window.*:** كل ملف يُصدَّر لـ window ويمكن لأي ملف آخر استدعاؤه مباشرة — لا يوجد interface رسمي.
2. **DashboardComponent يُسأل Supabase مباشرة:** بدلاً من المرور عبر `repo` أو `AppStore`، يستدعي `supabaseClient.from('transactions')` مباشرة في 6 مواضع على الأقل.
3. **DataEntryComponent يستدعي `db.bank_accounts.toArray()` مباشرة** عند offline بدلاً من استخدام `repo.fetchFromCache()`.
4. **SyncQueue.js يحتوي `db.*` مباشرة** دون المرور بـ Repository — يُعقّد الصيانة.

### Hidden Dependencies

1. **ProfileSettingsComponent.js:** محمّل بدون `defer` (السطر 160 من index.html) — سيُنفَّذ قبل اكتمال DOM وقبل تحميل AppStore.
2. **QuickLoginBanner.js:** محمّل بدون `defer` أيضاً — نفس المشكلة.
3. **`window.RPC` مُعرَّفة مرتين في config.js:** السطر 64 يُعرِّفها كـ `const RPC`، والسطر 328 يُعيد تعريف `window.RPC` بإضافة RPC جديدة. النسخة الأولى `const RPC` لا تحتوي على `GET_ADMIN_DASHBOARD` وما بعدها — **ثغرة خطيرة إذا استُخدمت قبل إعادة التعريف.**
4. **`_voucherCounter` في AccountingService.js:** متغير عام داخل closure، غير مُعاد تهيئته عند تحديث الصفحة — ستتكرر أرقام الإيصالات عند إعادة تحميل الصفحة في اليوم نفسه.

---

## 5. Authentication Analysis

### مشاكل المصادقة

| المشكلة | الخطورة | التفاصيل |
|---------|---------|---------|
| **Quick Login Hash محفوظ كـ plaintext في localStorage** | 🔴 حرج | `localStorage.setItem('ahu_quick_${uid}', JSON.stringify({hash, userId, eq: trimmed}))` — النص الأصلي للمعادلة (المفتاح) محفوظ محلياً |
| **لا تحقق من صلاحية الجلسة عند كل طلب** | 🔴 حرج | بعد تسجيل الدخول، لا يُعاد التحقق من `is_active` إلا عند `checkSession()` عند بدء التطبيق |
| **Quick Login offline يُؤمَّن محلياً فقط** | 🟠 عالية | إذا سُرق localStorage يمكن تجاوز التحقق من الخادم |
| **كلمات مرور المستخدمين تُغيَّر من UsersComponent دون تسجيل Audit** | 🟠 عالية | `supabaseClient.auth.admin.updateUserById()` — لا سجل تدقيق في الكود المُحلَّل |
| **المفتاح `ahu_quick_*` قابل للقراءة من أي JavaScript على الصفحة** | 🟡 متوسطة | XSS يمكنه سرقة المعادلة وتسجيل الدخول |

### مشاكل الجلسات

1. **مزدوجية الجلسة:** الجلسة محفوظة في مكانين متوازيين:
   - `sessionStorage` (عبر `saveSession()` في helpers.js) — بيانات مخصصة
   - `localStorage` (عبر Supabase Auth persistence) — توكن JWT أصلي
   
   في حالة تعارض بينهما، لا يوجد آلية لحل التعارض.

2. **checkSession() يتحقق فقط من وجود session Supabase:** لا يتحقق من أن المستخدم لا يزال نشطاً في قاعدة البيانات (`is_active`). يمكن لمستخدم موقوف الاستمرار في العمل إذا كان لديه توكن غير منتهٍ.

3. **IdleTimer يعمل فقط للمناديب:** المدير والمساعد الإداري لا يُطبَّق عليهم Idle Timeout — إذا نسي المدير جهازه مفتوحاً لا يوجد أي حماية تلقائية.

### مشاكل الصلاحيات

1. **RBAC يعتمد على الجانب الأمامي فقط:** `AuthService.canAccessTab()` و`getAllowedTabs()` تعمل على الـ Client فقط. لا يوجد تحقق من الصلاحيات على مستوى Supabase RLS.
   
   ⚠️ **مُحتمَل:** إذا كانت RLS على Supabase غير مُفعَّلة/صحيحة، يمكن لأي مستخدم رؤية بيانات المستخدمين الآخرين.

2. **`admin_assistant` الصلاحيات قابلة للتلاعب:** `allowed_tabs` محفوظة في جدول users ويمكن تعديلها من الـ Supabase Dashboard مباشرة دون أي تحقق.

3. **لا يوجد مفهوم للمستأجرين (Multi-tenancy):** النظام يفترض نشراً واحداً لعمل واحد — لا توجد عزل بين الشركات.

---

## 6. Supabase Analysis

### المشاكل الحالية

| المشكلة | الخطورة | التفاصيل |
|---------|---------|---------|
| **ANON_KEY مكشوف في كود المصدر** | 🔴 حرج | `config.js` السطر 17: المفتاح موجود كنص في ملف JS عام — أي شخص يفتح devtools يراه |
| **URL قاعدة البيانات مكشوف** | 🟠 عالية | `https://gffyakxcfoeehtapelgd.supabase.co` مرئي للجميع |
| **استخدام `select('*')` في كثير من الاستعلامات** | 🟡 متوسطة | يُرسَل كل البيانات حتى الحقول الحساسة كـ `quick_equation_hash` |

### سوء الاستخدام

1. **استدعاءات Supabase مكررة بدلاً من تجميعها:**
   في `DashboardComponent._loadAll()`:
   - `_loadKPI()` → استعلام على transactions
   - `_loadBankProgress()` → استعلام آخر على transactions
   - `_loadAgentsBoxes()` → استعلام ثالث على transactions
   
   ثلاثة استعلامات مستقلة على نفس الجدول لنفس الفترة الزمنية — يمكن تجميعها في استعلام واحد.

2. **`_preloadEssentialData()` في AuthService** تجلب بيانات المستخدمين (بما فيها `quick_equation_hash`) من Supabase وتحفظها في Dexie — هذه البيانات الحساسة مُخزَّنة محلياً.

3. **Realtime Channel بدون فلترة:** في DashboardComponent:
   ```js
   .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, ...)
   ```
   يستقبل **كل** التغييرات على جدول transactions من **كل** المستخدمين — يُثقل الاتصال.

4. **`callRPC()` بدون تحديد مهلة زمنية (timeout):** إذا تأخر الخادم، سيتجمد الـ UI.

### المخاطر المستقبلية

1. **حصة Supabase المجانية:** إذا تجاوز الاستخدام حد الخطة المجانية (500MB قاعدة بيانات، 2GB bandwidth) ستتوقف الخدمة.
2. **Row Level Security (RLS):** التقرير الحالي لا يُمكّنه من التحقق من إعدادات RLS في Supabase — هذا مجال معلومات غير كافية (لا يوجد ملف migrations).

### مشاكل الأداء

1. **`getStatement()` في AccountingService:** يجلب `priorEntries` بدون LIMIT — عند تراكم السنوات سيجلب آلاف السجلات لحساب الرصيد الافتتاحي.
2. **`_loadNotifications()` في AppStore:** يجلب 50 إشعاراً وتُحسب `read_by` و`hidden_by` من JSON strings — يستخدم `JSON.parse()` على كل إشعار عند كل تحميل.

---

## 7. Dexie & Offline First Analysis

### مخاطر فقدان البيانات

1. **تنظيف تلقائي قد يحذف بيانات لم تُزامن:**
   `cleanStaleTransactions()` تحذف المعاملات الأقدم من 90 يوماً — لكن الشرط `sync_status === 'synced'` يحميها فقط إذا حُدِّثت الحالة بشكل صحيح. إذا أُجريت معاملة offline ولم تُزامن لـ 90 يوماً ثم حُذفت من Supabase — ستُفقَد.

2. **`cleanStaleQueueItems()` تحذف عمليات قديمة:**
   قد تحذف عمليات مالية لم تُكمَل مزامنتها — فقدان بيانات مالية حقيقية.

3. **`clearAll()` في SyncQueue:** دالة خطيرة تمسح الطابور والتعارضات بالكامل — لا يوجد تصدير أو نسخ احتياطي قبل الحذف.

### مشاكل المزامنة

1. **`_executeUpdate()` في SyncQueue تستخدم `eq('id', recordId)` الثابتة:**
   بينما `Repository.js` أُصلحت لاستخدام `_getPKColumn()`، لكن `SyncQueue._executeUpdate()` لا تزال تستخدم `'id'` الثابتة (السطر 325) — **تعارض مع FIX-4**.

2. **`_executeDelete()` في SyncQueue تستخدم `eq('id', recordId)` الثابتة:**
   نفس مشكلة `_executeUpdate()` — لن تعمل مع `account_balances` و`system_settings`.

### تعارضات البيانات

1. **آلية كشف التعارض تعتمد على `updated_at`:**
   هذه الآلية ضعيفة — إذا تغير timestamp الخادم (بسبب تحديث لاعلاقة له) ستُكتشَف تعارضات وهمية.

2. **لا يوجد آلية لحل تعارضات `account_balances`:**
   الأرصدة المحاسبية تُحسَب محلياً ثم تُزامن — إذا حدث تعارض في رصيد، لا يوجد منطق خاص لإعادة الحساب.

3. **`resolveConflict()` تستخدم `upsert()` بدون `onConflict`:**
   السطر 613: `supabaseClient.from(conflict.table_name).upsert({...})` بدون تحديد `onConflict` — قد يُنشئ سجلاً جديداً بدلاً من تحديث الموجود.

### مشاكل التخزين المحلي

1. **`quick_equation_hash` + المعادلة الأصلية محفوظة في localStorage:** بيانات حساسة.
2. **لا توجد تشفير لـ IndexedDB:** كل البيانات المالية قابلة للقراءة بنص عادي من devtools.
3. **حد CACHE_CONFIG.MAX_STORAGE_MB = 50MB:** يُمكن الوصول إليه مع كميات بيانات كافية، خاصة أن `account_ledger` يحفظ قيدين أو أكثر لكل معاملة.

---

## 8. Synchronization Analysis

### تدفق المزامنة الحالي

```
1. المستخدم يُجري عملية مالية
       ↓
2. AccountingService.createTransactionWithEntries()
       ↓
3. isOnline()?
   ├── نعم → callRPC(CREATE_TRANSACTION_WITH_ENTRIES)
   │         ├── نجاح → حفظ Dexie + updateLocalBalances
   │         └── فشل → SyncQueue.add(BATCH) + حفظ Dexie
   └── لا  → SyncQueue.add(BATCH) + حفظ Dexie
       ↓
4. SyncService (كل 30 ثانية أو عند عودة الاتصال)
       ↓
5. SyncQueue.processQueue()
       ↓
6. لكل عملية: _processItem() → _executeCreate/Update/Delete/Batch()
       ↓
7. نجاح → remove من الطابور | فشل → handleFailure() → backoff/conflict
```

### نقاط الفشل المحتملة

1. **فشل RPC + فشل Dexie معاً:** إذا فشل `callRPC()` وفشل `db.transactions.put()` في نفس الوقت — لا توجد محاولة recovery، البيانات تُفقَد.

2. **قطع الاتصال أثناء معالجة الطابور:** إذا انقطع الاتصال بعد إرسال طلب الـ INSERT ولكن قبل استلام الرد — الخادم قد يكون أنشأ السجل، لكن العميل سيُعيد المحاولة وينشئه مجدداً (تكرار).

3. **`processQueue()` غير قابل لإعادة الدخول (Not Re-entrant):**
   `_queueState.isProcessing` تمنع التشغيل المتزامن — لكنها متغير محلي يُعاد تهيئته عند إعادة تحميل الصفحة.

### حالات Race Conditions

1. **إضافة عملية للطابور أثناء معالجته:** `add()` و`processQueue()` يعملان بشكل غير متزامن — قد تُعالج عملية قبل إضافتها بالكامل إذا كان الطابور يدور.

2. **`_updatePendingCount()` غير atomicية:** تقرأ ثم تُرسل حدثاً — قد يرى UI عدداً قديماً.

3. **SyncService._syncPendingRecords() + SyncQueue.processQueue():** كلاهما قد يتعامل مع نفس السجلات بالتوازي عند الاتصال.

### مخاطر تكرار البيانات

1. **المعاملات المالية قد تُنشأ مرتين:** عند إرسال طلب INSERT ثم انقطاع الاتصال قبل الرد، إعادة المحاولة ستُرسل طلباً جديداً — إذا لم يكن هناك UNIQUE constraint على UUID في Supabase، ستُنشأ معاملتان بنفس UUID.

2. **`replaceTempId()` قد تفشل جزئياً:** رغم استخدام `db.transaction()` لضمان الذرية محلياً، لكن التحديثات على Supabase تحدث خارج هذه المعاملة.

---

## 9. Performance Analysis

### العمليات المكلفة

| العملية | الموقع | التكلفة | السبب |
|---------|--------|---------|-------|
| `_loadAll()` في Dashboard | DashboardComponent.js | عالية | 3+ استعلامات مستقلة على transactions |
| `getStatement()` لكشف الحساب | AccountingService.js | عالية جداً | `priorEntries` بدون LIMIT |
| `runStartupCleanup()` | Dexie.js | متوسطة | تشغيل 3 عمليات عند كل تحميل |
| `_loadNotifications()` | AppStore.js | متوسطة | JSON.parse لكل إشعار |
| `_loadAgentsBoxes()` | DashboardComponent.js | متوسطة | `.filter()` على مصفوفة txs لكل وكيل |
| `getUnresolvedConflicts()` | SyncQueue.js | متوسطة | يجلب كل التعارضات ثم يُفلترها في الذاكرة |

### استهلاك الذاكرة

1. **Chart.js instances:** رغم الإصلاح في DashboardComponent، مكونات أخرى (إن وُجدت رسوم بيانية) قد لا تُنظف.
2. **`_state` في AppStore:** يحتفظ بمصفوفات `transactions`, `notifications`, `users` كلها في الذاكرة.
3. **`_loginAttempts` Map في AuthService:** لا تُنظَّف أبداً — تتراكم مع الوقت (مشكلة طفيفة).
4. **`_syncState.failedNotified` Set في SyncService:** تتراكم معرفات التعارضات ولا تُنظَّف.

### Memory Leaks

| التسريب | الموقع | الشدة |
|---------|--------|-------|
| **Event listeners على `window`** | SyncService.js | 🟡 متوسط — يُزال عند `stop()` لكن ليس دائماً |
| **setInterval في SyncService** | SyncService.js | 🟡 متوسط — يُوقف عند `stop()` |
| **_dateTimer في App.js** | App.js | 🟢 طفيف — يُوقف عند logout |
| **Retry Timers في SyncQueue** | SyncQueue.js | 🟡 متوسط — يُنظَّف عند `clearRetryTimers()` فقط |
| **_toastContainer في helpers.js** | helpers.js | 🟢 طفيف — يبقى طوال دورة حياة التطبيق |

### Event Listener Leaks

```
المشكلة: App.js السطر 250-291 يُضيف addEventListener لكل زر في الهيدر
عند rebuild الهيدر (مثلاً عند تحديث الشعار) لا تُزال الـ listeners القديمة
→ مستمعو الأحداث يتراكمون
```

### Re-render Problems

1. **`lucide.createIcons()` مُستدعاة عند كل navigateTo:** تُعيد معالجة كل الأيقونات في الصفحة — مكلفة عند وجود صفحات غنية بالأيقونات.
2. **AppStore `setState()` يُرسل حدثَين دائماً:** الحدث المحدد + `store:stateChanged` — كل مكون مشترك يُعيد الرسم مرتين.

### Slow Queries

1. **`cleanStaleTransactions()` بدون فهرس مناسب:** تستخدم `.where('date').below(cutoffStr).and(tx => ...)` — شرط `.and()` يقرأ كل السجلات الموجودة.
2. **`_loadWeeklyChart()` يُرسل 7 استعلامات منفصلة عند offline:** واحد لكل يوم بدلاً من استعلام واحد بـ `between`.

---

## 10. Security Analysis

### الثغرات الأمنية

| الثغرة | الخطورة | الموقع | الوصف |
|--------|---------|--------|-------|
| **ANON_KEY مكشوف** | 🔴 حرج | config.js:17 | مفتاح Supabase في كود JavaScript عام |
| **المعادلة الأصلية محفوظة** | 🔴 حرج | AuthService.js:218 | `eq: trimmed` في localStorage |
| **لا تحقق من صلاحيات على الخادم** | 🔴 حرج | جميع المكونات | RBAC على Client-side فقط |
| **XSS محتمل في بعض المواضع** | 🟠 عالية | DashboardComponent:_renderAgentsBoxes | استخدام `onmouseenter="..."` inline HTML |
| **عدم التحقق من نوع البيانات** | 🟠 عالية | DataEntryComponent | المبالغ تُقبَل كنصوص وتُحوَّل لاحقاً |
| **Supabase Storage public bucket** | 🟠 عالية | config.js:290 `LOGO_BUCKET: 'logos'` | قد يكون الـ bucket عاماً بدون تحقق |

### ضعف التحقق من المدخلات

1. **`isValidAmount()`:** يتحقق فقط من أن القيمة > 0، لا يوجد حد أقصى للمبلغ — يمكن إدخال مليار ريال.
2. **`customer_name` في المعاملات:** لا يوجد حد أقصى للطول، لا تنظيف.
3. **تحقق من صيغة `allowed_tabs` في AuthService:** `JSON.parse()` بدون التحقق من صحة محتوى المصفوفة — إذا أدخل شخص قيمة غريبة سيحصل على tabs غير متوقعة.

### مشاكل الصلاحيات

1. **لا يوجد Content Security Policy (CSP)** في index.html.
2. **Tailwind CDN:** يُحمَّل سكريبت خارجي من CDN بدون Subresource Integrity (SRI).
3. **Supabase JS Client CDN:** نفس المشكلة — بدون SRI.
4. **`expr-eval` CDN:** نفس المشكلة — مكتبة تنفذ تعبيرات رياضية بدون SRI.

### البيانات الحساسة

1. **`quick_equation_hash`:** يُعاد في `select('*')` على جدول users — يظهر في console.log للمطورين.
2. **كلمات مرور المستخدمين:** تُعالج عبر Supabase Auth — آمنة.
3. **البيانات المالية في Dexie:** غير مشفرة، مرئية في devtools → Application → IndexedDB.

---

## 11. Scalability Analysis

### المشاكل التي ستظهر عند نمو البيانات

| الحجم | المشكلة المتوقعة |
|-------|----------------|
| **+1000 معاملة/يوم** | `DashboardComponent` سيُطلب بيانات كبيرة — استعلامات transactions ستبطأ |
| **+10,000 سجل account_ledger** | `getStatement()` بدون LIMIT على `priorEntries` ستجلب كل السجلات |
| **+90 يوم من البيانات في Dexie** | `cleanStaleTransactions()` ستجلب آلاف السجلات لحذفها دفعة واحدة |
| **+5000 عنصر في sync_queue** | سيصل للحد الأقصى `MAX_QUEUE_SIZE` وتتوقف العمليات offline |

### المشاكل عند تعدد المستخدمين

1. **لا يوجد قفل تفاؤلي (Optimistic Locking) حقيقي:** كشف التعارض يعتمد على `updated_at` فقط — غير كافٍ.
2. **Realtime لا يُميز المستخدمين:** كل المستخدمين يستقبلون تحديثات من كل المستخدمين.
3. **`_voucherCounter` محلي:** رقم الإيصال قد يتكرر بين مستخدمين مختلفين في اليوم نفسه.

### المشاكل عند تعدد الأجهزة

1. **Quick Login مرتبط بـ localStorage لكل جهاز:** عند تسجيل الدخول السريع، الهاش محفوظ في قاعدة البيانات، لكن بيانات الجهاز (`ahu_quick_*`) خاصة بكل جهاز — إذا مسح المستخدم localStorage لن يُمكنه الدخول السريع.
2. **`_loginAttempts` Map محلية:** القفل بعد 5 محاولات فاشلة خاص بكل جهاز — يمكن تجاوزه بالتبديل بين الأجهزة.
3. **Dexie تتزامن باتجاه واحد:** البيانات تنتقل من Supabase إلى Dexie ولكن ليس العكس تلقائياً — قد يرى جهازان بيانات مختلفة.

---

## 12. Code Quality Analysis

### الملفات التي تحتاج Refactoring

| الملف | الأولوية | السبب |
|-------|---------|-------|
| `config.js` | 🔴 حرج | تعريف مزدوج لـ `window.RPC` (bug محتمل) |
| `App.js` | 🟠 عالية | CSS مُحقَن (500+ سطر styles داخل JS)، مسؤوليات متعددة |
| `services/AccountingService.js` | 🟠 عالية | `getStatement()` بدون LIMIT |
| `repository/SyncQueue.js` | 🟠 عالية | `_executeUpdate/Delete` لا تستخدم `_getPKColumn()` |
| `components/DashboardComponent.js` | 🟡 متوسطة | استعلامات Supabase مكررة |
| `store/AppStore.js` | 🟡 متوسطة | يتضمن منطق جلب البيانات + إدارة الحالة معاً |

### الملفات المتضخمة

| الملف | عدد الأسطر | الحل المقترح |
|-------|----------|-------------|
| `App.js` | ~887 سطر | فصل الـ CSS إلى styles.css، فصل Header إلى HeaderComponent |
| `components/DataEntryComponent.js` | كبير (>400 سطر مُقدَّر) | فصل نماذج كل نوع عملية |
| `repository/Repository.js` | ~632 سطر | مقبول كـ Data Access Layer |
| `services/AccountingService.js` | ~643 سطر | فصل `getStatement()` و`dailyClose()` |

### الأكواد المكررة

1. **كتابة Dexie في الخلفية:** نمط `(async () => { if (db.isOpen()) await db[...].put(...) })()` يتكرر في 10+ مواضع.
2. **التحقق من `typeof db === 'undefined' || !db.isOpen()`:** يتكرر في 20+ موضع.
3. **منطق Online-First:** `if (isOnline()) { Supabase } else { Dexie }` يتكرر في كل مكون.
4. **إنشاء Skeleton loaders:** HTML للـ skeleton يتكرر في كل مكون.

### Technical Debt

| النوع | الحجم | الأثر |
|-------|-------|-------|
| لا اختبارات | كبير جداً | أي تغيير قد يكسر وظيفة مالية دون علم |
| لا Build System | كبير | التبعيات يدوية، لا Tree Shaking، لا minification |
| Global Variables | كبير | صعوبة التتبع، التعارضات المحتملة |
| CSS-in-JS غير منظم | متوسط | صعوبة الصيانة البصرية |
| توثيق SQL غير موجود | متوسط | Schema الـ DB موصوفة في Setup.md فقط |

---

## 13. Database Analysis

### الجداول (من config.js و Dexie.js)

| الجدول (Supabase) | الغرض | الملاحظات |
|-------------------|-------|----------|
| `users` | بيانات المستخدمين + الأدوار + هاش الدخول السريع | يحتوي `quick_equation_hash` — حساس |
| `transactions` | العمليات المالية الكاملة | الجدول الأكثر استخداماً |
| `bank_accounts` | الحسابات البنكية + السقف المالي | |
| `debtors` | العملاء المديونون + `assigned_agents` | `assigned_agents` محفوظة كـ JSON array |
| `failed_deposits` | الإيداعات الفاشلة مع تدفق الحالات | |
| `notifications` | الإشعارات مع `target` و`read_by` و`hidden_by` كـ JSON | تصميم غير طبيعي (denormalized) |
| `audit_logs` | سجل التدقيق — يُملأ عبر RPC | |
| `account_ledger` | قيود دفتر الأستاذ (مدين/دائن) | ينمو بمعدل 2-4× عدد المعاملات |
| `account_balances` | الأرصدة التراكمية بـ PK = `account_id` | يُحدَّث عبر RPC |
| `daily_closings` | إقفالات يومية بـ UNIQUE على `date` | |
| `system_settings` | إعدادات النظام بـ PK = `key` | |
| `companies` | الشركات المرتبطة بالمعاملات | |
| `expense_accounts` | حسابات المصروفات الفرعية | |

### العلاقات

```
users ─────────────→ transactions (agent_id)
                   → debtors (assigned_agents[])
companies ─────────→ transactions (company_id)
                   → bank_accounts (company_id)
bank_accounts ─────→ transactions (bank_account_id)
debtors ───────────→ transactions (customer_id)
transactions ──────→ account_ledger (reference_id)
account_ledger ────→ account_balances (account_id)
expense_accounts ──→ transactions (expense_type)
```

### الفهارس (من Dexie.js)

| الجدول | الفهارس | ملاحظات |
|--------|---------|---------|
| `transactions` | `id, date, type, agent_id, sync_status, [date+agent_id], [date+type], bank_account_id, created_at` | جيد — فهارس مركبة مهمة |
| `account_ledger` | `id, account_id, date, reference_id, [account_id+date], sync_status` | جيد |
| `sync_queue` | `++id, action, table_name, record_id, sync_status, retries, created_at, last_retry_at` | مقبول |
| `account_balances` | `account_id (PK), last_updated` | **لا يوجد فهرس على `balance`** |

**ملاحظة:** لا يوجد إمكانية التحقق من فهارس Supabase PostgreSQL بدون الوصول للـ dashboard — هذا **مجال معلومات غير كافية**.

### المشاكل المحتملة

1. **`notifications.target`، `notifications.read_by`، `notifications.hidden_by`:** محفوظة كـ JSON strings أو arrays — يُجبر كل مكون على `JSON.parse()` — غير قابل للفهرسة.
2. **`debtors.assigned_agents`:** مصفوفة JSON — استعلام `contains()` على Supabase يستخدم GIN index إذا وُجد، وإلا full scan.
3. **`account_ledger`:** سيكون أكبر الجداول على المدى البعيد — يحتاج فهرس مركب `[account_id + date]` على Supabase أيضاً.
4. **`daily_closings.date` UNIQUE:** موجود في Dexie (`&date`) لكن لم يُتحقق من وجوده في Supabase.

---

## 14. Risk Register

| # | المشكلة | درجة الخطورة | التأثير | احتمالية الحدوث |
|---|---------|-------------|---------|----------------|
| R01 | ANON_KEY مكشوف في كود مصدر عام | 🔴 حرج | أي شخص يمكنه قراءة قاعدة البيانات إذا كانت RLS ضعيفة | 🔴 مؤكد (مكشوف حالياً) |
| R02 | لا اختبارات تلقائية على نظام مالي | 🔴 حرج | أي تغيير قد يكسر منطق القيد المزدوج بدون علم | 🔴 عالية جداً |
| R03 | المعادلة الأصلية محفوظة في localStorage | 🔴 حرج | سرقة هوية المستخدم عبر XSS أو وصول مادي | 🟠 متوسطة |
| R04 | تعريف مزدوج لـ `window.RPC` في config.js | 🔴 حرج | RPC قديمة قد تُستخدَم في بعض السياقات بدلاً من الجديدة | 🟡 منخفضة-متوسطة |
| R05 | `_executeUpdate/Delete` في SyncQueue لا تستخدم _getPKColumn | 🔴 حرج | فشل مزامنة account_balances و system_settings | 🟡 منخفضة-متوسطة |
| R06 | RBAC على Client-side فقط دون RLS | 🔴 حرج | مستخدم يمكنه رؤية/تعديل بيانات مستخدمين آخرين | 🟡 متوسطة (حسب RLS) |
| R07 | `getStatement()` بدون LIMIT على priorEntries | 🟠 عالية | تعطل التطبيق عند كميات بيانات كبيرة | 🟠 متأكد على المدى المتوسط |
| R08 | تكرار المعاملات عند انقطاع الاتصال أثناء INSERT | 🟠 عالية | معاملات مالية مكررة في قاعدة البيانات | 🟡 متوسطة |
| R09 | ProfileSettingsComponent و QuickLoginBanner بدون defer | 🟠 عالية | تنفيذ قبل تحميل التبعيات — أخطاء عشوائية | 🟠 عالية |
| R10 | `_voucherCounter` يُعاد من 1 عند كل تحميل | 🟠 عالية | أرقام إيصالات متكررة في نفس اليوم | 🟠 عالية |
| R11 | `cleanStaleQueueItems()` تحذف عمليات مالية معلقة | 🟠 عالية | فقدان بيانات مالية إذا تأخرت المزامنة 30 يوماً | 🟡 منخفضة لكن كارثية |
| R12 | لا CSP وسكريبتات CDN بدون SRI | 🟡 متوسطة | هجوم Supply Chain يمكنه تعديل كود الصفحة | 🟡 منخفضة |
| R13 | استهلاك حصة Supabase المجانية | 🟡 متوسطة | توقف الخدمة بالكامل | 🟡 متوسطة |
| R14 | `resolveConflict()` تستخدم upsert بدون onConflict | 🟡 متوسطة | إنشاء سجل مكرر عند حل التعارض | 🟡 متوسطة |
| R15 | بيانات مالية غير مشفرة في IndexedDB | 🟡 متوسطة | قراءة بيانات من devtools أو مشاركة الجهاز | 🟠 عالية |
| R16 | لا Idle Timeout للمدير والمساعد | 🟡 متوسطة | جهاز مفتوح بدون رقابة | 🟡 متوسطة |
| R17 | استعلامات Supabase مكررة في Dashboard | 🟡 متوسطة | بطء وزيادة تكلفة | 🔴 مؤكد |
| R18 | `select('*')` يجلب quick_equation_hash | 🟢 منخفضة | بيانات حساسة في network tab | 🔴 مؤكد |
| R19 | IdleTimer للمندوبين فقط | 🟢 منخفضة | عدم تسجيل خروج تلقائي للمدير | 🟡 متوسطة |
| R20 | لا محدودية للمبلغ الأقصى في isValidAmount | 🟢 منخفضة | إدخال مبالغ خاطئة ضخمة | 🟡 متوسطة |

---

## 15. Priority Roadmap

### Priority 1 — Critical (يجب معالجتها فوراً قبل أي استخدام إنتاجي)

| # | المهمة | الخطر إذا لم تُعالَج | الملف |
|---|-------|-------------------|-------|
| P1.1 | **إزالة ANON_KEY من كود المصدر** — نقله إلى متغير بيئي أو تقييد صلاحياته في Supabase Dashboard | أي شخص يرى الكود يملك مفتاح قاعدة البيانات | config.js |
| P1.2 | **تفعيل RLS (Row Level Security) على Supabase** لجميع الجداول | أي مستخدم مصادق يمكنه قراءة/تعديل جميع البيانات | Supabase Dashboard |
| P1.3 | **إصلاح تعريف `window.RPC` المزدوج في config.js** — دمج التعريفين في تعريف واحد نهائي | استخدام RPC قديمة في بعض السياقات | config.js |
| P1.4 | **إصلاح `ProfileSettingsComponent.js` و `QuickLoginBanner.js`** — إضافة `defer` | أخطاء تشغيل عشوائية عند تحميل الصفحة | index.html |
| P1.5 | **إصلاح `_executeUpdate()` و `_executeDelete()` في SyncQueue** — استخدام `TABLE_PRIMARY_KEYS` | فشل مزامنة account_balances و system_settings | SyncQueue.js |
| P1.6 | **عدم حفظ `eq: trimmed` في localStorage** — تخزين الهاش فقط، ليس المعادلة الأصلية | سرقة المعادلة = سرقة الهوية | AuthService.js |

### Priority 2 — High (معالجة خلال أسبوعين)

| # | المهمة | الخطر | الملف |
|---|-------|-------|-------|
| P2.1 | **إضافة LIMIT لـ `priorEntries` في `getStatement()`** — حساب الرصيد الافتتاحي عبر RPC أو Materialized View | تعطل كشوف الحساب عند كميات بيانات كبيرة | AccountingService.js |
| P2.2 | **إصلاح `_voucherCounter`** — استخدام sequence في Supabase بدلاً من متغير محلي | تكرار أرقام الإيصالات | AccountingService.js |
| P2.3 | **تجميع استعلامات Dashboard في RPC واحدة** — استخدام `get_admin_dashboard` بالكامل | ضغط غير ضروري على Supabase | DashboardComponent.js |
| P2.4 | **إضافة UNIQUE constraint على `transactions.id` في Supabase** | تكرار المعاملات عند انقطاع الاتصال | Supabase Migration |
| P2.5 | **تطبيق Idle Timeout على المدير والمساعد** | جهاز مفتوح بلا حماية | services/IdleTimer.js |
| P2.6 | **إضافة حد أقصى للمبلغ في `isValidAmount()`** | إدخال مبالغ خاطئة ضخمة | utils/helpers.js |
| P2.7 | **إضافة `select` محدد بدلاً من `select('*')`** لاستبعاد `quick_equation_hash` من استعلامات القوائم | تسريب بيانات حساسة | جميع الملفات |
| P2.8 | **التحقق من صلاحية الجلسة (`is_active`) عند كل تنقل بين التبويبات** | مستخدم موقوف يستمر في العمل | AuthService.js |

### Priority 3 — Medium (خلال شهر)

| # | المهمة | الخطر | الملف |
|---|-------|-------|-------|
| P3.1 | **إضافة Content Security Policy في index.html** | هجمات XSS و Injection | index.html |
| P3.2 | **إضافة Subresource Integrity (SRI) لسكريبتات CDN** | هجمات Supply Chain | index.html |
| P3.3 | **نقل CSS الهيدر من `_injectHeaderStyles()` إلى styles.css** | صعوبة الصيانة | App.js → styles.css |
| P3.4 | **إنشاء `BackgroundWriter` utility مشترك** لتجنب تكرار كود كتابة Dexie | تكرار الكود في 10+ مواضع | utils/ |
| P3.5 | **إضافة LIMIT لـ `cleanStaleQueueItems()`** — حذف دفعات صغيرة بدلاً من دفعة واحدة | ضغط على IndexedDB | Dexie.js |
| P3.6 | **تنظيف `_syncState.failedNotified` Set** بعد حل التعارضات | تراكم الذاكرة | SyncService.js |
| P3.7 | **`resolveConflict()` — إضافة `onConflict` لـ upsert** | إنشاء سجلات مكررة | SyncQueue.js |
| P3.8 | **إضافة فهرس `[account_id + date]` على Supabase `account_ledger`** | بطء كشوف الحساب | Supabase Migration |
| P3.9 | **تطبيع `notifications.target/read_by/hidden_by`** إلى جداول منفصلة | استعلامات بطيئة وعدم قابلية الفهرسة | Supabase Migration |
| P3.10 | **`_loadWeeklyChart()` offline:** استعلام واحد بـ `between` بدلاً من 7 استعلامات | ضغط على IndexedDB | DashboardComponent.js |

### Priority 4 — Low (خلال ربع سنة)

| # | المهمة | الخطر | الملف |
|---|-------|-------|-------|
| P4.1 | **Migrate إلى Build System (Vite/Rollup)** | صعوبة الصيانة المستقبلية | هيكل المشروع |
| P4.2 | **كتابة اختبارات وحدة لـ AccountingService** على الأقل | أخطاء مالية غير مكتشفة | tests/ |
| P4.3 | **تفعيل تشفير IndexedDB** أو نقل البيانات الحساسة لخادم فقط | قراءة بيانات مالية من devtools | repository/ |
| P4.4 | **إضافة Rate Limiting على مستوى Supabase** لطلبات المصادقة | Brute Force من أجهزة مختلفة | Supabase Dashboard |
| P4.5 | **تحسين `_loginAttempts` Map** لتشمل Rate Limiting مستمر (session-persistent) | تجاوز القفل بإعادة تحميل الصفحة | AuthService.js |
| P4.6 | **إنشاء Namespace عوضاً عن window.*** | تعارضات غير متوقعة | جميع الملفات |
| P4.7 | **Skeleton Loader مشترك** بدلاً من تكراره في كل مكون | تكرار الكود | utils/ |
| P4.8 | **مراجعة Realtime subscriptions** — إضافة فلترة حسب المستخدم/الشركة | ضغط على Supabase Realtime | DashboardComponent.js |
| P4.9 | **نظام لوغ مركزي** بدلاً من `console.log/warn/error` المبعثرة | صعوبة debugging في الإنتاج | utils/ |
| P4.10 | **تطوير Multi-tenant support** إذا كان النظام سيخدم أكثر من شركة | اختلاط بيانات الشركات | قاعدة البيانات + الكود |

---

## ملاحظات المعلومات غير الكافية

1. **إعدادات RLS في Supabase:** التقرير لا يملك إمكانية التحقق من سياسات Row Level Security الفعلية — هذا المجال الأكثر خطراً وغير المرئي.

2. **ملفات SQL للـ Migrations:** Setup.md يشير إلى 9 ملفات SQL لكنها غير موجودة في المشروع — البنية الكاملة لقاعدة البيانات وقيودها والفهارس والـ RLS غير معروفة.

3. **إعدادات Supabase Storage Bucket (`logos`):** هل الـ Bucket عام أم خاص؟ غير معروف.

4. **دوال RPC في قاعدة البيانات:** `create_transaction_with_entries`، `perform_daily_close`، `reverse_transaction`، `update_debtor_balance`، `verify_quick_login`، `get_admin_dashboard`، `get_daily_summary`، `get_chart_of_accounts`، `get_account_statement`، `get_bank_statement`، `get_audit_logs` — كلها غير مرئية في هذا التحليل.

5. **حجم البيانات الحالي:** عدد السجلات الفعلية في كل جدول غير معروف — التحليل بُني على افتراضات.

6. **بيئة الإنتاج الفعلية:** هل يعمل النظام على خطة Supabase مجانية أم مدفوعة؟ غير معروف.

---

*هذا التقرير مرجع حي يجب تحديثه عند كل مرحلة إصلاح رئيسية.*  
*إعداد: Claude Code — Principal Software Architect Analysis*  
*تاريخ: 2026-06-06*
