/**
 * repository/SupabaseClient.js — v2.1 (FIXED)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * الإصلاحات:
 * ✅ FIX-1: توحيد اسم المتغير — كان هناك تعارض بين المتغير المحلي
 *           `supabaseClient` وما يُصدَّر عبر `window.supabaseClient = supabase`
 *           (حيث supabase = window.supabase وليس نفس المتغير المحلي).
 *           الآن: متغير واحد `supabaseClient` يُنشأ ويُصدَّر بنفس الاسم.
 * ✅ FIX-2: استبدال كل استخدامات `supabase.` الخام (كانت تشير لـ window.supabase)
 *           بـ `supabaseClient.` الموحَّد داخل هذا الملف.
 */

'use strict';

// ============================================================
// FIX-1: إنشاء عميل Supabase وتخزينه في متغير واحد موحَّد
// ============================================================

const supabaseClient = window.supabase.createClient(
  SUPABASE_CONFIG.URL,
  SUPABASE_CONFIG.ANON_KEY,
  {
    auth: {
      storage            : window.localStorage,
      persistSession     : true,
      autoRefreshToken   : true,
      detectSessionInUrl : false,
      flowType           : 'pkce',
    },
    realtime: {
      params: { eventsPerSecond: 10 },
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

  window.dispatchEvent(new CustomEvent('supabase:authChange', {
    detail: { event, session, user: _authState.user },
  }));
});

// ============================================================
// دوال مساعدة للمصادقة
// ============================================================

async function getCurrentSession() {
  // FIX-2: استخدام supabaseClient بدلاً من supabase الخام
  const { data, error } = await supabaseClient.auth.getSession();
  return { session: data?.session || null, error };
}

async function getCurrentAuthUser() {
  const { data } = await supabaseClient.auth.getUser();
  return data?.user || null;
}

async function isSessionActive() {
  const { session } = await getCurrentSession();
  if (!session) return false;

  const expiresAt = session.expires_at;
  if (expiresAt && Date.now() / 1000 > expiresAt - 60) {
    // FIX-2: كان يستخدم supabase.auth بدلاً من supabaseClient.auth
    const { error } = await supabaseClient.auth.refreshSession();
    return !error;
  }
  return true;
}

async function getAccessToken() {
  const { session } = await getCurrentSession();
  return session?.access_token || null;
}

/**
 * يستدعي دالة RPC على Supabase بشكل آمن
 */
async function callRPC(fnName, params = {}) {
  try {
    // FIX-2: كان يستخدم supabase.rpc في بعض المواضع
    const { data, error } = await supabaseClient.rpc(fnName, params);
    if (error) return err(error.message, error);
    return ok(data);
  } catch (e) {
    return err(`خطأ غير متوقع في RPC ${fnName}: ${e.message}`);
  }
}

// ============================================================
// مراقبة حالة الاتصال
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

function isOnline() {
  // وضع Offline النشط يتجاوز حالة navigator.onLine
  if (window.AuthState?.isOffline) return false;
  return _isOnline;
}

/**
 * فحص حقيقي للاتصال بـ Supabase (أبطأ من isOnline لكن أدق)
 * @returns {Promise<boolean>}
 */
async function checkRealConnection() {
  return pingSupabase();
}

async function pingSupabase() {
  try {
    // FIX-2: كان يستخدم supabase.from بدلاً من supabaseClient.from
    const { error } = await supabaseClient
      .from(TABLES.SYSTEM_SETTINGS)
      .select('key')
      .limit(1)
      .single();
    return !error || error.code === 'PGRST116';
  } catch {
    return false;
  }
}

// ============================================================
// إعداد Realtime Channels
// ============================================================

const _realtimeChannels = new Map();

function subscribeToTable(tableName, onInsert, onUpdate, onDelete) {
  if (_realtimeChannels.has(tableName)) {
    const old = _realtimeChannels.get(tableName);
    // FIX-2: كان يستخدم supabase.removeChannel
    supabaseClient.removeChannel(old);
    _realtimeChannels.delete(tableName);
  }

  // FIX-2: كان يستخدم supabase.channel بدلاً من supabaseClient.channel
  const channel = supabaseClient
    .channel(`realtime:${tableName}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: tableName },
      (payload) => { if (typeof onInsert === 'function') onInsert(payload.new); })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: tableName },
      (payload) => { if (typeof onUpdate === 'function') onUpdate(payload.new, payload.old); })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: tableName },
      (payload) => { if (typeof onDelete === 'function') onDelete(payload.old); })
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

async function unsubscribeAll() {
  for (const [, channel] of _realtimeChannels) {
    // FIX-2: كان يستخدم supabase.removeChannel
    await supabaseClient.removeChannel(channel);
  }
  _realtimeChannels.clear();
  console.log('📡 Realtime: تم إلغاء جميع الاشتراكات');
}

// ============================================================
// FIX-1: تصدير — متغير واحد موحَّد باسم supabaseClient
// ============================================================

// قبل الإصلاح كان: window.supabaseClient = supabase  (خطأ! supabase هو window.supabase)
// بعد الإصلاح:      window.supabaseClient = supabaseClient  (نفس المتغير المُنشأ أعلاه)
window.supabaseClient        = supabaseClient;
window._authState            = _authState;
window.getCurrentSession     = getCurrentSession;
window.getCurrentAuthUser    = getCurrentAuthUser;
window.isSessionActive       = isSessionActive;
window.getAccessToken        = getAccessToken;
window.callRPC               = callRPC;
window.isOnline              = isOnline;
window.checkRealConnection   = checkRealConnection;
window.pingSupabase          = pingSupabase;
window.subscribeToTable      = subscribeToTable;
window.unsubscribeAll        = unsubscribeAll;

console.log('✅ SupabaseClient.js v2.1 — FIX-1: supabaseClient موحَّد (لا تعارض مع window.supabase)');
