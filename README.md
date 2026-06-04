
# نظام أبو حذيفة المتكامل للصرافة والتحويلات
**Abu Hudhaifa Integrated Exchange & Transfer System**

نظام مالي احترافي يعمل بدون اتصال (Offline-First)، مصمم لإدارة عمليات الصرافة والتحويلات المالية مع دعم متعدد الأدوار وقيد محاسبي مزدوج.

---

## ⚡ التشغيل السريع

```bash
# 1. انسخ المشروع
git clone <repo-url>
cd abu-hudhaifa

# 2. أنشئ ملف الإعدادات
cp config.example.js config.js
# عدّل config.js بمعلومات مشروع Supabase الخاص بك

# 3. افتح index.html في المتصفح
# يمكن استخدام Live Server في VS Code أو أي خادم HTTP بسيط
npx serve .
# أو
python -m http.server 8080
```

---

📋 المتطلبات

متطلبات Supabase

· مشروع Supabase نشط (free tier يكفي للتطوير)
· تطبيق migrations من مجلد /supabase/migrations/
· تفعيل Realtime على الجداول الحيوية
· إنشاء Storage Bucket باسم logos (Public)

متطلبات المتصفح

المتصفح الإصدار الأدنى
Chrome / Edge 90+
Firefox 88+
Safari 14+
Mobile Chrome 90+

المكتبات الخارجية (CDN — لا تحتاج تثبيت)

المكتبة الغرض
Dexie.js 3.2.4 IndexedDB (Offline Storage)
Supabase JS 2.x قاعدة البيانات السحابية
Chart.js 4.4.0 الرسوم البيانية
Lucide 0.263.0 الأيقونات
expr-eval 2.0.2 الآلة الحاسبة الآمنة
Tailwind CSS التنسيق
IBM Plex Sans Arabic الخط

---

🔧 إعداد متغيرات البيئة

في ملف config.js، عدّل القيم التالية:

```javascript
const SUPABASE_CONFIG = Object.freeze({
  URL      : 'https://YOUR_PROJECT_ID.supabase.co',  // ← عدّل هذا
  ANON_KEY : 'YOUR_ANON_KEY',                         // ← عدّل هذا
});
```

للحصول على هذه القيم:

1. سجّل الدخول إلى supabase.com
2. افتح مشروعك → Settings → API
3. انسخ Project URL و anon public key

---

🏗️ هيكل المجلدات (محدث)

```
abu-hudhaifa/
│
├── index.html                    # نقطة الدخول الرئيسية
├── config.js                     # الإعدادات والثوابت
├── App.js                        # التهيئة والتوجيه
│
├── assets/
│   └── css/
│       └── styles.css            # التنسيقات الأساسية (يدعم الوضع المظلم)
│
├── utils/
│   └── helpers.js                # الدوال المساعدة (17 مجموعة)
│
├── repository/
│   ├── Dexie.js                  # قاعدة البيانات المحلية (IndexedDB)
│   ├── SupabaseClient.js         # تهيئة عميل Supabase + Realtime
│   ├── Repository.js             # CRUD موحد (Offline-First)
│   └── SyncQueue.js              # طابور المزامنة الذكي
│
├── services/
│   ├── AuthService.js            # المصادقة + الدخول السريع
│   ├── AccountingService.js      # القيد المزدوج المحاسبي
│   ├── SyncService.js            # إدارة المزامنة
│   └── ThemeManager.js           # ✅ مدير الوضع المظلم/الفاتح (موحد)
│
├── store/
│   └── AppStore.js               # الحالة المركزية (EventTarget)
│
└── components/
    ├── LoginComponent.js          # آلة حاسبة + تسجيل دخول
    ├── DashboardComponent.js      # لوحة المعلومات (للمدير)
    ├── DataEntryComponent.js      # إدخال البيانات (4 نماذج)
    ├── DailySummaryComponent.js   # الملخص اليومي
    ├── BankAccountsComponent.js   # الحسابات البنكية
    ├── DebtorsComponent.js        # العملاء المديونون
    ├── FailedDepositsComponent.js # الإيداعات الفاشلة
    ├── NotificationsComponent.js  # الإشعارات
    ├── AllOperationsComponent.js  # جميع العمليات + فلاتر
    ├── AuditLogComponent.js       # سجل التدقيق
    ├── UsersComponent.js          # إدارة المستخدمين
    ├── AccountManagementComponent.js # الحسابات المحاسبية
    └── SettingsComponent.js       # الإعدادات + النسخ الاحتياطي
```

🔍 توضيح حول ThemeManager.js

· الغرض: إدارة الوضع المظلم والفاتح بشكل مركزي وموحد في جميع أنحاء التطبيق (شاشة الدخول، لوحة المعلومات، الإعدادات، …).
· الموقع: مجلد services/ (يُحمَّل قبل LoginComponent.js في index.html).
· الآلية:
  · يقرأ التفضيل المخزن في localStorage (مفتاح abu_theme).
  · يطبّق الكلاس dark-mode على عنصر body ليتوافق مع تنسيقات CSS.
  · يوفر دوال: init()، toggle()، setTheme(isDark)، isDarkMode()، onChange(callback).
  · يستمع لتغيرات localStorage بين التبويبات لتزامن الثيم فوراً.
  · يدعم احترام تفضيل النظام (prefers-color-scheme) عند أول زيارة.
· لماذا تمت إضافته؟
    لحل مشكلة عدم استجابة الوضع المظلم من زر القائمة في شاشة تسجيل الدخول، ولتجنب تعارض آليتين مختلفتين (كانت LoginComponent تستخدم html.dark بينما App تستخدم body.dark-mode). الآن أصبح هناك مصدر واحد للحقيقة.

---

👥 الأدوار والصلاحيات

الدور الوصف التبويبات
admin مدير كامل الصلاحيات جميع التبويبات (12)
admin_assistant مساعد إداري تبويبات يحددها المدير
agent مندوب إدخال بيانات، ملخص، بنوك، مديونين، إشعارات

---

💰 أنواع العمليات المالية

النوع الرمز القيود المحاسبية
تحصيل collection قيد واحد (AGT مدين، COMP دائن)
إيداع بنكي deposit قيدان (BNK مدين + تسوية AGT)
مصروف expense قيد واحد (EXP مدين، AGT دائن)
استلام receipt قيد واحد (AGT_مستلم مدين، AGT_مصدر دائن)
تسليم delivery قيد واحد (AGT_مستلم مدين، AGT_مسلّم دائن)
تسوية استرداد refund_settlement قيد واحد (AGT مدين، COMP دائن)

---

🔄 كيف يعمل Offline-First

```
المستخدم يضغط "حفظ"
       ↓
[Dexie] حفظ فوري محلياً (sync_status = pending)
       ↓
 هل الإنترنت متاح؟
    ↙         ↘
  نعم          لا
   ↓            ↓
[Supabase]   [SyncQueue]
  إرسال       إضافة للطابور
   ↓            ↓
 نجح؟       عند عودة الاتصال
  ↙  ↘          ↓
نعم   لا     processQueue()
 ↓     ↓
SYNCED  SyncQueue
```

---

🔐 الأمان

· لا eval() — الآلة الحاسبة تستخدم expr-eval الآمنة
· escapeHtml() على كل مخرجات DOM
· sessionStorage فقط — لا localStorage للبيانات الحساسة (ما عدا تفضيل الثيم)
· RLS على جميع الجداول في Supabase
· Brute Force — قفل بعد 5 محاولات / 15 دقيقة
· SHA-256 لهاش معادلة الدخول السريع
· HTTPS إلزامي في الإنتاج

---

🚀 النشر على Netlify / Vercel

Netlify

```bash
# netlify.toml
[build]
  publish = "."
  command = ""

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

Vercel

```json
// vercel.json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

مهم: في الإنتاج، لا تضع مفاتيح Supabase في config.js مباشرة.
استخدم متغيرات البيئة أو خدمة secrets management.

---

📊 مؤشرات الأداء المستهدفة

السيناريو الهدف الحد الأقصى
تحميل الصفحة < 1.5s 3s
تسجيل الدخول < 1s 2s
إدراج عملية مالية < 500ms 1s
عرض قائمة (20 عنصر) < 300ms 600ms
مزامنة 100 عملية < 5s 10s

---

🐛 حل المشكلات الشائعة

المشكلة: RLS policy violation
الحل: تأكد من تسجيل الدخول وأن لديك الدور المناسب.

المشكلة: Dexie open failed
الحل: افتح Developer Tools → Application → IndexedDB → احذف قاعدة AbuHudhaifaDB.

المشكلة: الصفحة لا تُحمَّل offline
الحل: افتح التطبيق مرة واحدة وأنت متصل أولاً لتعبئة الكاش المحلي.

المشكلة: Storage Bucket not found
الحل: أنشئ Bucket باسم logos في Supabase Dashboard → Storage.

المشكلة: الوضع المظلم لا يعمل من شاشة الدخول
الحل: تأكد من وجود services/ThemeManager.js وتحميله قبل LoginComponent.js في index.html. ثم أعد تحميل الصفحة.

---

📞 الدعم

للمشكلات التقنية، راجع ملف SETUP.md للإعداد التفصيلي.

```

