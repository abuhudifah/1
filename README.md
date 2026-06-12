# نظام أبو حذيفة المتكامل للصرافة والتحويلات

**الإصدار:** 1.0.0 | **البيئة:** Vanilla JS + Supabase + Dexie.js | **الاتجاه:** RTL / العربية

---

## نظرة عامة

نظام إدارة مالية احترافي مصمم لشركات الصرافة والتحويلات. يعمل بمعمارية **Online-First مع صمود Offline** — تذهب جميع العمليات إلى Supabase أولاً، وتسقط تلقائياً إلى Dexie (IndexedDB) عند انقطاع الاتصال، مع مزامنة تلقائية عند العودة.

---

## الميزات المنجزة

### المرحلة 0 — البنية الأساسية
- [x] هيكل المشروع الكامل (config، helpers، repository، services، components، store)
- [x] Schema Supabase الكاملة مع RLS على جميع الجداول
- [x] Schema Dexie (IndexedDB) مع دعم الإصداريْن 1 و 2
- [x] Result Pattern موحد (`ok(data)` / `err(message)`) في جميع الطبقات
- [x] نظام تسجيل دخول تقليدي (email + password) عبر Supabase Auth

### المرحلة 1 — الدخول السريع (Quick Login)
- [x] نظام معادلة رياضية للدخول السريع بدون كلمة مرور
- [x] تشفير SHA-256 مع Salt ثابت (`ahu_secure_salt_v1_2024`)
- [x] Token Rotation عبر RPC `verify_quick_login_token`
- [x] حماية Brute Force في sessionStorage (5 محاولات → قفل 15 دقيقة)
- [x] `PasswordDialog` احترافي يحل محل `window.prompt()`
- [x] `QuickLoginBanner` — إشعار ذكي لتفعيل الدخول السريع بعد أول دخول

### المرحلة 2 — الصمود Offline
- [x] دخول Offline عبر `OfflineAuthService` (PIN مخزن محلياً)
- [x] `LocalOperationsService` — حفظ العمليات في Dexie عند انقطاع الاتصال
- [x] `SyncEngine` — مزامنة العمليات المعلقة مع حل التعارضات (Optimistic Locking)
- [x] `SyncService` — تشغيل تلقائي كل 30 ثانية عند وجود عمليات معلقة
- [x] Sync Queue Widget في الهيدر — عرض عدد العمليات المعلقة مع زر مزامنة يدوية
- [x] حماية من تكرار الحفظ عبر `idempotency_key` + `TEMP_` IDs

### المرحلة 3 — الأمان المتقدم
- [x] جلسة مطلقة 8 ساعات (`sessionExpiresAt`) — تسجيل خروج تلقائي
- [x] `IdleTimer` — خروج تلقائي للمندوبين بعد 5 دقائق خمول (30 دقيقة للإدارة)
- [x] إزالة جميع `console.log` الحساسة (كلمات مرور، tokens، بيانات مستخدمين)
- [x] معالجة أخطاء الشبكة في `quickLogin` — لا يُحذف localStorage عند انقطاع الاتصال
- [x] 25+ كتلة `catch {}` فارغة أصبحت `catch (e)` مع `console.warn`

### المرحلة 4 — تحسينات المعمارية والتجربة
- [x] إصلاح Race Condition في `_ensureUserAccountNumber` (فلتر `.is('account_number', null)`)
- [x] Skeleton Loading في 3 مكونات (DailySummary، DataEntry، AccountManagement)
- [x] `renderSkeleton(type, count)` helper قابل للاستخدام في جميع المكونات
- [x] `DataSourceConfig` — طبقة تجريد لمزود البيانات (Supabase أولاً، Firebase مستقبلاً)

### المرحلة 5 — جودة الواجهة
- [x] **Responsive Design:** breakpoints عند 768/640/480/399px
- [x] **Accessibility:** skip-link، aria-label، aria-live، role="dialog"، role="alert"، aria-describedby
- [x] **formatErrorMessage(error):** تحويل الأخطاء التقنية لرسائل عربية مفهومة
- [x] **اختصارات لوحة المفاتيح:** Ctrl+S/F/O/L، Escape، F5، `?`
- [x] نافذة مساعدة الاختصارات (`?`) بتصميم متوافق مع هوية التطبيق

---

## البنية المعمارية

```
/
├── index.html                        # هيكل HTML الوحيد
├── config.js                         # ثوابت النظام (ROLES, TABS, TABLES, RPC names)
│
├── utils/
│   ├── helpers.js                    # Result pattern، تنسيق، تشفير، جلسة، Logger
│   └── QuickLoginBanner.js           # بانر تفعيل الدخول السريع
│
├── repository/
│   ├── Dexie.js                      # Schema IndexedDB + دوال CRUD محلية
│   ├── SupabaseClient.js             # عميل Supabase + أحداث الاتصال
│   ├── Repository.js                 # CRUD موحد (Supabase أساساً، Dexie احتياطاً)
│   └── SyncQueue.js                  # طابور المزامنة + حل التعارضات
│
├── services/
│   ├── AuthService.js                # تسجيل دخول، جلسة، Quick Login، صلاحيات
│   ├── OfflineAuthService.js         # دخول Offline عبر PIN محلي
│   ├── LocalOperationsService.js     # حفظ العمليات محلياً عند Offline
│   ├── SyncEngine.js                 # مزامنة العمليات المعلقة مع Supabase
│   ├── SyncService.js                # جدولة المزامنة التلقائية (30 ثانية)
│   ├── AccountingService.js          # قيود القيد المزدوج (v4.0)
│   ├── ThemeManager.js               # وضع مظلم/فاتح
│   ├── IdleTimer.js                  # خروج تلقائي بالخمول
│   ├── PrintService.js               # طباعة ومشاركة التقارير
│   └── DataSourceConfig.js           # تجريد مزود البيانات
│
├── store/
│   └── AppStore.js                   # حالة التطبيق المركزية (EventTarget)
│
├── components/
│   ├── LoginComponent.js             # شاشة الدخول (تقليدي + معادلة + Offline)
│   ├── DashboardComponent.js         # لوحة التحكم + KPIs + رسوم بيانية
│   ├── DataEntryComponent.js         # إدخال العمليات (5 أنواع)
│   ├── DailySummaryComponent.js      # ملخص يومي
│   ├── BankAccountsComponent.js      # إدارة الحسابات البنكية
│   ├── DebtorsComponent.js           # إدارة المدينين
│   ├── FailedDepositsComponent.js    # الإيداعات الفاشلة
│   ├── NotificationsComponent.js     # الإشعارات
│   ├── AllOperationsComponent.js     # جميع العمليات + فلترة
│   ├── AuditLogComponent.js          # سجل التدقيق
│   ├── UsersComponent.js             # إدارة المستخدمين
│   ├── AccountManagementComponent.js # إدارة الحسابات المحاسبية
│   ├── SettingsComponent.js          # إعدادات النظام
│   ├── ProfileSettingsComponent.js   # إعدادات الملف الشخصي
│   ├── PasswordDialog.js             # مودال إدخال كلمة المرور
│   └── PinDialog.js                  # مودال إدخال PIN
│
├── assets/css/styles.css             # التنسيقات الكاملة (Light/Dark/Mobile/A11y)
│
└── supabase/migrations/
    ├── 20260612000000_phase_0_schema_enhancement.sql
    ├── 20260612000001_phase_1_quick_login_tokens.sql
    ├── 20260612000002_phase_2a_jwt_session_fix.sql
    └── 20260612000003_phase_2b_offline_rpcs.sql
```

---

## تدفق البيانات

```
          طلب المستخدم (قراءة / كتابة)
                       │
              ┌────────▼────────┐
              │  isOnline() ?   │
              └──┬──────────┬───┘
           نعم │            │ لا
    ┌───────────▼──┐   ┌────▼───────────────┐
    │  Supabase    │   │  Dexie (IndexedDB)  │
    │  (PRIMARY)   │   │  + SyncQueue        │
    └──────┬───────┘   └────────┬────────────┘
           │                    │
           └─────────┬──────────┘
                     │
            ┌────────▼────────┐
            │    AppStore     │  ← EventTarget (حالة مركزية)
            └─────────────────┘
                     │
            ┌────────▼────────┐
            │   Components    │  ← يستمعون لـ store events
            └─────────────────┘
```

**ضمانات النظام:**
1. Supabase هي المصدر الحقيقي للبيانات دائماً
2. Dexie للاستخدام الطارئ فقط (Offline/Error fallback)
3. `idempotency_key` يمنع تكرار العمليات عند إعادة المزامنة
4. `updated_at` يُستخدم لكشف التعارضات (Optimistic Locking)
5. تنظيف تلقائي عند التشغيل (معاملات أقدم من 90 يوماً، طابور أقدم من 30 يوماً)

---

## جداول قاعدة البيانات (Supabase)

| الجدول | الغرض |
|--------|-------|
| `users` | المستخدمون (admin، admin_assistant، agent) |
| `transactions` | جميع العمليات المالية |
| `bank_accounts` | الحسابات البنكية |
| `companies` | شركات التحويل |
| `expense_accounts` | حسابات المصروفات |
| `debtors` | المدينون |
| `failed_deposits` | الإيداعات الفاشلة |
| `notifications` | الإشعارات الداخلية |
| `audit_logs` | سجل التدقيق (UPDATE/DELETE على الجداول الحرجة فقط) |
| `account_ledger` | قيود القيد المزدوج |
| `account_balances` | أرصدة الحسابات المحاسبية |
| `daily_closings` | الإغلاق اليومي |
| `system_settings` | إعدادات النظام |
| `system_commands` | أوامر المدير الفورية |
| `transfer_requests` | طلبات التحويل بين المندوبين |
| `quick_login_tokens` | رموز الدخول السريع (مع انتهاء صلاحية) |

**RPC Functions:**
`create_transaction_with_entries`، `get_admin_dashboard`، `get_daily_summary`، `get_chart_of_accounts`، `get_account_statement`، `get_audit_logs`، `verify_quick_login_token`، `perform_daily_close`، `reverse_transaction`، `approve_transaction`، `reject_transaction`، `reset_all_operational_data`

---

## الأدوار والصلاحيات

| الدور | التبويبات المتاحة |
|-------|-----------------|
| `admin` | جميع التبويبات الـ 12 |
| `admin_assistant` | dashboard، data-entry، daily-summary، bank-accounts، debtors، failed-deposits، notifications، all-operations |
| `agent` | data-entry، daily-summary، notifications |

---

## اختصارات لوحة المفاتيح

| الاختصار | الوظيفة |
|---------|---------|
| `Ctrl/⌘ + S` | حفظ العملية الحالية في DataEntry |
| `Ctrl/⌘ + F` | التركيز على حقل البحث |
| `Ctrl/⌘ + O` | مزامنة يدوية فورية |
| `Ctrl/⌘ + L` | تسجيل الخروج |
| `Escape` | إغلاق أي نافذة منبثقة |
| `F5` | تحديث البيانات بدون إعادة تحميل الصفحة |
| `?` | عرض/إخفاء نافذة الاختصارات |

---

## الأمان

| المعيار | التطبيق |
|--------|---------|
| كلمات المرور | لا تُخزَّن أبداً في localStorage أو sessionStorage |
| Quick Login Hash | `SHA-256(userId:equation:ahu_secure_salt_v1_2024)` |
| Brute Force | 5 محاولات → قفل 15 دقيقة (sessionStorage) |
| الجلسة | 8 ساعات مطلقة (`sessionExpiresAt`) ثم خروج تلقائي |
| IdleTimer | خروج تلقائي للمندوبين بعد 5 دقائق خمول |
| RLS | مفعّل على جميع جداول Supabase |
| Audit Log | UPDATE/DELETE فقط على الجداول الحرجة، الحقول المتغيرة فقط |
| eval() | ممنوع تماماً — صفر استخدامات في الكود |

---

## التقنيات المستخدمة

| المكتبة | الإصدار | الغرض |
|---------|---------|-------|
| Supabase JS | 2.x | قاعدة البيانات السحابية + Auth |
| Dexie.js | 3.2.4 | IndexedDB (offline storage) |
| Chart.js | 4.4.0 | الرسوم البيانية |
| Tailwind CSS | CDN | أدوات التنسيق |
| Lucide Icons | 0.263.0 | الأيقونات |
| expr-eval | 2.0.2 | تقييم المعادلات الرياضية (Quick Login) |
| IBM Plex Sans Arabic | Google Fonts | الخط العربي |

---

## التشغيل والتثبيت

### المتطلبات
- مشروع Supabase نشط مع تطبيق جميع ملفات `supabase/migrations/`
- إعداد `config.js` بالقيم الصحيحة:
  ```javascript
  SUPABASE_CONFIG.URL      = 'https://<project>.supabase.co'
  SUPABASE_CONFIG.ANON_KEY = '<anon-key>'
  ```

### التشغيل المحلي
```bash
# لا يوجد Build step — أي HTTP server بسيط يكفي
npx serve .
# أو
python3 -m http.server 8080
```

### تطبيق الـ Migrations (بالترتيب)
```bash
supabase db push
# أو يدوياً بالترتيب:
# 20260612000000 → 20260612000001 → 20260612000002 → 20260612000003
```

---

## المراحل المستقبلية

- **المرحلة 6:** Unit Tests (helpers، AuthService، AccountingService)
- **المرحلة 7:** ESLint + تحسينات جودة الكود
- **المرحلة 8:** PWA كاملة (Service Worker، App Manifest، Push Notifications)
- **المرحلة 9:** تقارير متقدمة (PDF export، رسوم بيانية تفاعلية)
- **المرحلة 10:** دعم متعدد العملات
