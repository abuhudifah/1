/**
 * sw.js — Service Worker للتطبيق
 * استراتيجية: Cache-First للملفات الثابتة + Network-First لـ API
 * skipWaiting: التحديثات تُطبَّق فوراً بدون الحاجة لإغلاق التطبيق
 */

const CACHE_VERSION = 'v4';
const CACHE_NAME    = `calc-${CACHE_VERSION}`;

// الملفات الثابتة التي تُخزَّن عند التثبيت
const STATIC_ASSETS = [
  './',
  './index.html',
  './App.js',
  './config.js',
  './assets/css/styles.css',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png',
  './manifest.json',
  // المكوّنات
  './components/LoginComponent.js',
  './components/DashboardComponent.js',
  './components/DataEntryComponent.js',
  './components/NotificationsComponent.js',
  './components/AccountManagementComponent.js',
  './components/SettingsComponent.js',
  './components/UsersComponent.js',
  './components/AllOperationsComponent.js',
  './components/AuditLogComponent.js',
  './components/BankAccountsComponent.js',
  './components/DailySummaryComponent.js',
  './components/DebtorsComponent.js',
  './components/FailedDepositsComponent.js',
  './components/PasswordDialog.js',
  './components/PinDialog.js',
  './components/ProfileSettingsComponent.js',
  // الخدمات
  './services/AuthService.js',
  './services/AccountingService.js',
  './services/DataSourceConfig.js',
  './services/IdleTimer.js',
  './services/LocalOperationsService.js',
  './services/OfflineAuthService.js',
  './services/OutboxService.js',
  './services/PrintService.js',
  './services/RealtimeChannelManager.js',
  './services/SessionVault.js',
  './services/SyncEngine.js',
  './services/SyncService.js',
  './services/ThemeManager.js',
  // المستودع
  './repository/Dexie.js',
  './repository/Repository.js',
  './repository/SupabaseClient.js',
  './repository/SyncQueue.js',
  // المتجر والأدوات
  './store/AppStore.js',
  './utils/helpers.js',
  './utils/PWAManager.js',
  './utils/QuickLoginBanner.js',
];

// النطاقات التي تذهب دائماً للشبكة (Supabase API)
const NETWORK_ONLY_PATTERNS = [
  /supabase\.co/,
  /realtime/,
];

// ─── التثبيت ──────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()) // تطبيق التحديث فوراً
      .catch(err => console.warn('[SW] فشل تخزين بعض الملفات:', err))
  );
});

// ─── التفعيل وحذف الكاشات القديمة ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k.startsWith('calc-') && k !== CACHE_NAME)
            .map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim()) // تولّي السيطرة على كل التبويبات فوراً
  );
});

// ─── معالجة الطلبات ───────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // تجاهل الطلبات غير HTTP
  if (!request.url.startsWith('http')) return;

  // Supabase API → Network Only (بيانات مالية لا تُخزَّن)
  if (NETWORK_ONLY_PATTERNS.some(p => p.test(request.url))) {
    event.respondWith(fetch(request).catch(() => new Response(
      JSON.stringify({ error: 'offline' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    )));
    return;
  }

  // الملفات الثابتة → Cache First مع fallback للشبكة
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) {
          // SWR: أعد الكاش فوراً + حدّث في الخلفية
          const networkUpdate = fetch(request).then(response => {
            if (response && response.status === 200) {
              const clone = response.clone();
              caches.open(CACHE_NAME).then(c => c.put(request, clone));
            }
            return response;
          }).catch(() => {});
          return cached;
        }
        // لا يوجد كاش → شبكة مع حفظ
        return fetch(request).then(response => {
          if (response && response.status === 200 && url.origin === self.location.origin) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(request, clone));
          }
          return response;
        }).catch(() => caches.match('./index.html')); // fallback للصفحة الرئيسية
      })
    );
    return;
  }
});

// ─── رسالة من الصفحة: تحديث فوري ────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

console.log(`[SW] ${CACHE_NAME} — جاهز`);
