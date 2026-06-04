/**
 * repository/SupabaseClient.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * تهيئة عميل Supabase وإدارة حالة المصادقة
 *
 * المسؤوليات:
 * - إنشاء عميل Supabase من SUPABASE_CONFIG
 * - الاستماع لتغييرات حالة المصادقة
 * - تجديد التوكن تلقائياً
 * - إدارة الجلسة في sessionStorage
 * - توفير دالة مساعدة للتحقق من الاتصال
 */

'use strict';

// ============================================================
// إنشاء عميل Supabase
// ============================================================

const supabaseClient = window.supabase.createClient(
  SUPABASE_CONFIG.URL,
  SUPABASE_CONFIG.ANON_KEY,
  {
    auth: {
      // تخزين الجلسة في sessionStorage فقط (تختفي عند إغلاق المتصفح)
      storage              : window.sessionStorage,
      persistSession       : true,
      autoRefreshToken     : true,
      detectSessionInUrl   : false,
      flowType             : 'pkce',
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
    global: {
      headers: {
        'x-client-info': `abu-hudhaifa/${APP_CONFIG.VERSION}`,
      },
    },
  }
);

// ============================================================
// الاستماع لتغييرات حالة المصادقة
// ============================================================

/**
 * حالة المصادقة الحالية — يُحدَّث عند كل تغيير
 * @type {{ session: object|null, user: object|null }}
 */
const _authState = {
  session : null,
  user    : null,
};

supabaseClient.auth.onAuthStateChange((event, session) => {
  _authState.session = session;
  _authState.user    = session?.user || null;

  switch (event) {
    case 'SIGNED_IN':
      console.log('✅ Supabase: تسجيل دخول ناجح —', session?.user?.email);
      break;

    case 'SIGNED_OUT':
      console.log('👋 Supabase: تم تسجيل الخروج');
      _authState.session = null;
      _authState.user    = null;
      break;

    case 'TOKEN_REFRESHED':
      console.log('🔄 Supabase: تم تجديد التوكن تلقائياً');
      break;

    case 'USER_UPDATED':
      console.log('👤 Supabase: بيانات المستخدم محدثة');
      break;

    default:
      break;
  }

  // إطلاق حدث مخصص ليستمع إليه AppStore
  window.dispatchEvent(new CustomEvent('supabase:authChange', {
    detail: { event, session, user: _authState.user },
  }));
});

// ============================================================
// دوال مساعدة للمصادقة
// ============================================================

/**
 * يُعيد الجلسة الحالية (يجدد التوكن إذا انتهى)
 * @returns {Promise<{ session: object|null, error: object|null }>}
 */
async function getCurrentSession() {
  const { data, error } = await supabaseClient.auth.getSession();
  return { session: data?.session || null, error };
}

/**
 * يُعيد المستخدم الحالي من الجلسة النشطة
 * @returns {Promise<object|null>}
 */
async function getCurrentAuthUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data?.user || null;
}

/**
 * يتحقق هل هناك جلسة نشطة صالحة
 * @returns {Promise<boolean>}
 */
async function isSessionActive() {
  const { session } = await getCurrentSession();
  if (!session) return false;

  // التحقق من أن التوكن لم ينته
  const expiresAt = session.expires_at;
  if (expiresAt && Date.now() / 1000 > expiresAt - 60) {
    // ينتهي خلال أقل من دقيقة — حاول التجديد
    const { error } = await supabaseClient.auth.refreshSession();
    return !error;
  }

  return true;
}

/**
 * يُعيد access_token الحالي للاستخدام في الطلبات اليدوية
 * @returns {Promise<string|null>}
 */
async function getAccessToken() {
  const { session } = await getCurrentSession();
  return session?.access_token || null;
}

/**
 * يستدعي دالة RPC على Supabase بشكل آمن
 * @param {string} fnName - اسم الدالة
 * @param {object} [params] - المعاملات
 * @returns {Promise<{ok: boolean, data?: *, error?: string}>}
 */
async function callRPC(fnName, params = {}) {
  try {
    const { data, error } = await supabaseClient.rpc(fnName, params);
    if (error) return err(error.message, error);
    return ok(data);
  } catch (e) {
    return err(`خطأ غير متوقع في RPC ${fnName}: ${e.message}`);
  }
}

// ============================================================
// مراقبة حالة الاتصال بالإنترنت
// ============================================================

let _isOnline = navigator.onLine;

window.addEventListener('online', () => {
  _isOnline = true;
  console.log('🌐 الاتصال بالإنترنت: متصل');
  window.dispatchEvent(new CustomEvent('app:onlineStatusChange', { detail: { online: true } }));
});

window.addEventListener('offline', () => {
  _isOnline = false;
  console.log('📵 الاتصال بالإنترنت: غير متصل');
  window.dispatchEvent(new CustomEvent('app:onlineStatusChange', { detail: { online: false } }));
});

/**
 * يُعيد حالة الاتصال الحالية
 * @returns {boolean}
 */
function isOnline() {
  return _isOnline;
}

/**
 * يتحقق من الاتصال الفعلي بـ Supabase (ping)
 * @returns {Promise<boolean>}
 */
async function pingSupabase() {
  try {
    const { error } = await supabase
      .from(TABLES.SYSTEM_SETTINGS)
      .select('key')
      .limit(1)
      .single();
    // خطأ PGRST116 (لا توجد صفوف) يعني أن الاتصال يعمل
    return !error || error.code === 'PGRST116';
  } catch {
    return false;
  }
}

// ============================================================
// إعداد Realtime Channels
// ============================================================

/** تخزين القنوات المفتوحة لمنع التكرار */
const _realtimeChannels = new Map();

/**
 * يُنشئ أو يُعيد قناة Realtime لجدول محدد
 * @param {string} tableName - اسم الجدول
 * @param {Function} onInsert - دالة عند إدراج سجل
 * @param {Function} onUpdate - دالة عند تحديث سجل
 * @param {Function} onDelete - دالة عند حذف سجل
 * @returns {object} channel
 */
function subscribeToTable(tableName, onInsert, onUpdate, onDelete) {
  // إغلاق القناة القديمة إن وجدت
  if (_realtimeChannels.has(tableName)) {
    const old = _realtimeChannels.get(tableName);
    supabaseClient.removeChannel(old);
    _realtimeChannels.delete(tableName);
  }

  const channel = supabase
    .channel(`realtime:${tableName}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: tableName },
      (payload) => {
        if (typeof onInsert === 'function') onInsert(payload.new);
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: tableName },
      (payload) => {
        if (typeof onUpdate === 'function') onUpdate(payload.new, payload.old);
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: tableName },
      (payload) => {
        if (typeof onDelete === 'function') onDelete(payload.old);
      }
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log(`📡 Realtime: مشترك في جدول ${tableName}`);
      } else if (status === 'CHANNEL_ERROR') {
        console.error(`❌ Realtime: خطأ في قناة ${tableName}`);
      }
    });

  _realtimeChannels.set(tableName, channel);
  return channel;
}

/**
 * يُلغي الاشتراك في جميع قنوات Realtime
 * يُستخدم عند تسجيل الخروج
 */
async function unsubscribeAll() {
  for (const [, channel] of _realtimeChannels) {
    await supabaseClient.removeChannel(channel);
  }
  _realtimeChannels.clear();
  console.log('📡 Realtime: تم إلغاء جميع الاشتراكات');
}

// ============================================================
// تصدير للاستخدام في Repository.js والخدمات
// ============================================================

window.supabaseClient        = supabase;
window._authState            = _authState;
window.getCurrentSession     = getCurrentSession;
window.getCurrentAuthUser    = getCurrentAuthUser;
window.isSessionActive       = isSessionActive;
window.getAccessToken        = getAccessToken;
window.callRPC               = callRPC;
window.isOnline              = isOnline;
window.pingSupabase          = pingSupabase;
window.subscribeToTable      = subscribeToTable;
window.unsubscribeAll        = unsubscribeAll;

console.log('✅ SupabaseClient.js محمّل — عميل Supabase جاهز');
