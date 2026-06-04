/**
 * services/AuthService.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * خدمة المصادقة وإدارة الجلسات
 *
 * المسؤوليات:
 * - تسجيل الدخول (بريد/كلمة مرور)
 * - تسجيل الخروج الكامل
 * - التحقق من الجلسة وتجديد التوكن
 * - الدخول السريع (معادلة رياضية → RPC → توكن)
 * - توثيق الجهاز (device_token)
 * - حماية Brute Force (5 محاولات / 15 دقيقة)
 * - تحميل بيانات المستخدم من جدول users
 *
 * القواعد الصارمة:
 * - لا يُخزّن أي سر في localStorage
 * - كلمات المرور لا تُلمس — Supabase Auth يتولاها
 * - هاش SHA-256 للمعادلة السريعة فقط (لا النص الواضح)
 */

'use strict';

// ============================================================
// حالة المصادقة الداخلية
// ============================================================

const AuthState = {
  currentUser   : null,   // بيانات المستخدم من جدول users
  authUser      : null,   // بيانات auth.users (Supabase)
  isInitialized : false,  // هل تمت التهيئة؟
};

// سجل محاولات الدخول الفاشلة (Brute Force protection)
// { email: { count, lockedUntil } }
const _loginAttempts = new Map();

// ============================================================
// 1. تسجيل الدخول التقليدي
// ============================================================

/**
 * يُسجّل دخول المستخدم بالبريد الإلكتروني وكلمة المرور
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ok: boolean, data?: {user, profile}, error?: string}>}
 */
async function login(email, password) {
  try {
    // التحقق من Brute Force
    const lockCheck = _checkBruteForce(email);
    if (!isOk(lockCheck)) return lockCheck;

    // التحقق من المدخلات
    if (!email || !password) {
      return err('البريد الإلكتروني وكلمة المرور مطلوبان');
    }
    if (!isValidEmail(email)) {
      return err('البريد الإلكتروني غير صالح');
    }

    // المصادقة عبر Supabase Auth
    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email    : email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      _recordFailedAttempt(email);
      const msg = _translateAuthError(authError.message);
      return err(msg);
    }

    // تسجيل نجاح الدخول (مسح سجل الفشل)
    _loginAttempts.delete(email);

    // جلب بيانات المستخدم من جدول users
    const profileResult = await _fetchUserProfile(authData.user.id);
    if (!isOk(profileResult)) {
      await supabaseClient.auth.signOut();
      return err('لم يُعثر على ملف المستخدم في النظام. تواصل مع المدير.');
    }

    const profile = profileResult.data;

    // التحقق من أن الحساب نشط
    if (!profile.is_active) {
      await supabaseClient.auth.signOut();
      return err('تم تعطيل هذا الحساب. راجع المدير.');
    }

    // تخزين بيانات المستخدم في الحالة الداخلية
    AuthState.currentUser = profile;
    AuthState.authUser    = authData.user;

    // توثيق الجهاز (حفظ device_token)
    await _setupDeviceToken(profile.id);

    // تخزين بيانات الجلسة (sessionStorage فقط)
    saveSession({
      userId      : profile.id,
      role        : profile.role,
      displayName : profile.display_name,
      username    : profile.username,
      allowedTabs : profile.allowed_tabs || [],
    });

    // تخزين بيانات المستخدم في Dexie للاستخدام offline
    await db.users.put({ ...profile, sync_status: SYNC_STATUS.SYNCED });

    // تحميل البيانات الأساسية في الخلفية
    _preloadEssentialData(profile);

    console.log(`✅ AuthService: دخل ${profile.display_name} (${profile.role})`);

    return ok({ user: authData.user, profile });

  } catch (e) {
    console.error('❌ AuthService.login():', e);
    return err(`خطأ غير متوقع: ${e.message}`);
  }
}

// ============================================================
// 2. تسجيل الخروج
// ============================================================

/**
 * يُسجّل خروج المستخدم ويُنظّف كل البيانات المحلية
 * @param {boolean} [clearLocalData=false] - مسح Dexie أيضاً؟
 * @returns {Promise<{ok: boolean}>}
 */
async function logout(clearLocalData = false) {
  try {
    // إلغاء جميع اشتراكات Realtime
    await unsubscribeAll();

    // إلغاء مؤقتات المزامنة
    if (window.SyncQueue) {
      SyncQueue.clearRetryTimers();
    }

    // تسجيل الخروج من Supabase
    await supabaseClient.auth.signOut();

    // مسح الجلسة من sessionStorage
    clearSession();

    // مسح الحالة الداخلية
    AuthState.currentUser   = null;
    AuthState.authUser      = null;
    AuthState.isInitialized = false;

    // مسح الكاش المحلي (اختياري — عند تسجيل خروج نظيف)
    if (clearLocalData) {
      try {
        await Promise.all([
          db.transactions.clear(),
          db.notifications.clear(),
          db.cache_meta.clear(),
        ]);
      } catch { /* تجاهل */ }
    }

    console.log('👋 AuthService: تم تسجيل الخروج بنجاح');

    // إطلاق حدث مخصص لـ AppStore
    window.dispatchEvent(new CustomEvent('auth:logout'));

    return ok(true);

  } catch (e) {
    console.error('❌ AuthService.logout():', e);
    // حتى لو فشل — نُنظّف محلياً
    clearSession();
    AuthState.currentUser = null;
    AuthState.authUser    = null;
    return ok(true);
  }
}

// ============================================================
// 3. التحقق من الجلسة عند بدء التطبيق
// ============================================================

/**
 * يتحقق من وجود جلسة نشطة عند فتح التطبيق
 * يُستخدم في App.js عند التهيئة
 * @returns {Promise<{ok: boolean, data?: {user, profile}, error?: string}>}
 */
async function checkSession() {
  try {
    // جلب الجلسة من Supabase (يتحقق من sessionStorage تلقائياً)
    const { session, error } = await getCurrentSession();

    if (error || !session) {
      return err('لا توجد جلسة نشطة');
    }

    // جلب بيانات المستخدم من جدول users
    const profileResult = await _fetchUserProfile(session.user.id);
    if (!isOk(profileResult)) {
      return err('لم يُعثر على ملف المستخدم');
    }

    const profile = profileResult.data;

    if (!profile.is_active) {
      await logout();
      return err('تم تعطيل هذا الحساب');
    }

    AuthState.currentUser   = profile;
    AuthState.authUser      = session.user;
    AuthState.isInitialized = true;

    // تحديث الجلسة في sessionStorage
    saveSession({
      userId      : profile.id,
      role        : profile.role,
      displayName : profile.display_name,
      username    : profile.username,
      allowedTabs : profile.allowed_tabs || [],
    });

    return ok({ user: session.user, profile });

  } catch (e) {
    console.error('❌ AuthService.checkSession():', e);
    return err(`فشل التحقق من الجلسة: ${e.message}`);
  }
}

// ============================================================
// 4. تجديد التوكن
// ============================================================

/**
 * يُجدّد access_token قبل انتهائه
 * يُستخدم تلقائياً من Supabase، أو يُستدعى يدوياً
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function refreshSession() {
  try {
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error) return err(error.message);
    return ok(data.session);
  } catch (e) {
    return err(e.message);
  }
}

// ============================================================
// 5. الدخول السريع (Quick Login)
// ============================================================

/**
 * يُفعّل الدخول السريع بحفظ هاش المعادلة
 * يُستدعى بعد أول تسجيل دخول تقليدي ناجح
 * @param {string} equation - المعادلة الرياضية (مثل 12+88)
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function enableQuickLogin(equation) {
  try {
    if (!AuthState.currentUser) {
      return err('يجب تسجيل الدخول أولاً');
    }

    const trimmed = String(equation).trim();
    if (!trimmed) return err('المعادلة فارغة');

    // التحقق من أن المعادلة تُنتج نتيجة صحيحة (باستخدام expr-eval الآمن)
    try {
      const parser = new window.exprEval.Parser();
      const result = parser.evaluate(trimmed);
      if (typeof result !== 'number' || !isFinite(result)) {
        return err('المعادلة لا تُنتج رقماً صحيحاً');
      }
    } catch {
      return err('المعادلة غير صالحة رياضياً');
    }

    // حساب هاش SHA-256
    const hash = await hashSHA256(trimmed);

    // حفظ الهاش في جدول users على Supabase
    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ quick_equation_hash: hash })
      .eq('id', AuthState.currentUser.id);

    if (error) return err(`فشل حفظ معادلة الدخول السريع: ${error.message}`);

    // تحديث محلياً أيضاً
    await db.users.update(AuthState.currentUser.id, { quick_equation_hash: hash });

    // حفظ إشارة في sessionStorage أن الدخول السريع مفعّل
    const session = getSession();
    if (session) {
      saveSession({ ...session, quickLoginEnabled: true });
    }

    console.log('✅ AuthService: تم تفعيل الدخول السريع');
    return ok(true);

  } catch (e) {
    return err(`خطأ في تفعيل الدخول السريع: ${e.message}`);
  }
}

/**
 * يُنفّذ الدخول السريع بالمعادلة الرياضية
 * يُرسل الهاش لـ RPC ويُعيد بيانات المستخدم
 * @param {string} equation - المعادلة التي أدخلها المستخدم
 * @returns {Promise<{ok: boolean, data?: {profile}, error?: string}>}
 */
async function quickLogin(equation) {
  try {
    const trimmed = String(equation).trim();
    if (!trimmed) return err('المعادلة فارغة');

    // التحقق من Brute Force بالمفتاح 'quick_login'
    const lockCheck = _checkBruteForce('quick_login');
    if (!isOk(lockCheck)) return lockCheck;

    // حساب هاش المعادلة
    const hash = await hashSHA256(trimmed);

    // الاستدعاء عبر RPC
    const result = await callRPC(RPC.VERIFY_QUICK_LOGIN, {
      p_equation_hash: hash,
    });

    if (!isOk(result)) {
      _recordFailedAttempt('quick_login');
      return err('معادلة غير صحيحة');
    }

    const rpcData = result.data;
    if (!rpcData?.success) {
      _recordFailedAttempt('quick_login');
      return err(rpcData?.message || 'معادلة غير صحيحة أو الحساب معطل');
    }

    // جلب الملف الكامل من Supabase
    const profileResult = await _fetchUserProfile(rpcData.user_id);
    if (!isOk(profileResult)) return err('فشل جلب بيانات المستخدم');

    const profile = profileResult.data;
    if (!profile.is_active) return err('تم تعطيل هذا الحساب. راجع المدير.');

    // تسجيل الدخول عبر Supabase Auth باستخدام magic token
    // ملاحظة: في بيئة الإنتاج تُستخدم Edge Function لإعادة JWT
    // هنا نُخزّن بيانات المستخدم بدون auth session كاملة
    AuthState.currentUser = profile;
    _loginAttempts.delete('quick_login');

    saveSession({
      userId         : profile.id,
      role           : profile.role,
      displayName    : profile.display_name,
      username       : profile.username,
      allowedTabs    : profile.allowed_tabs || [],
      quickLoginMode : true,
    });

    await db.users.put({ ...profile, sync_status: SYNC_STATUS.SYNCED });
    _preloadEssentialData(profile);

    console.log(`⚡ AuthService: دخول سريع — ${profile.display_name}`);
    return ok({ profile });

  } catch (e) {
    return err(`خطأ في الدخول السريع: ${e.message}`);
  }
}

/**
 * يُلغي الدخول السريع للمستخدم الحالي
 * @returns {Promise<{ok: boolean}>}
 */
async function disableQuickLogin() {
  try {
    if (!AuthState.currentUser) return err('يجب تسجيل الدخول أولاً');

    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ quick_equation_hash: null })
      .eq('id', AuthState.currentUser.id);

    if (error) return err(error.message);

    await db.users.update(AuthState.currentUser.id, { quick_equation_hash: null });

    return ok(true);
  } catch (e) {
    return err(e.message);
  }
}

// ============================================================
// 6. توثيق الجهاز (Device Token)
// ============================================================

/**
 * يُنشئ أو يُعيد device_token ويخزنه في sessionStorage
 * @param {string} userId
 * @returns {Promise<string>} - device_token
 */
async function _setupDeviceToken(userId) {
  try {
    let deviceToken = sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY);
    if (!deviceToken) {
      deviceToken = `${userId}_${generateUUID()}`;
      sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, deviceToken);
    }
    return deviceToken;
  } catch {
    return generateUUID();
  }
}

/**
 * يُعيد device_token الحالي
 * @returns {string|null}
 */
function getDeviceToken() {
  try {
    return sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY);
  } catch {
    return null;
  }
}

// ============================================================
// 7. جلب بيانات ملف المستخدم
// ============================================================

/**
 * يجلب بيانات المستخدم من جدول users
 * @param {string} userId
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function _fetchUserProfile(userId) {
  try {
    // أولاً من Dexie (أسرع)
    const local = await db.users.get(userId);
    if (local) return ok(local);

    // من Supabase إن لم يوجد محلياً
    const { data, error } = await supabaseClient
      .from(TABLES.USERS)
      .select('*')
      .eq('id', userId)
      .single();

    if (error) return err(error.message);
    if (!data)  return err('المستخدم غير موجود');

    return ok(data);
  } catch (e) {
    return err(e.message);
  }
}

// ============================================================
// 8. تحميل البيانات الأساسية في الخلفية
// ============================================================

/**
 * يُحمّل البيانات المشتركة في الخلفية بعد تسجيل الدخول
 * مثل: الشركات، حسابات المصروفات، إعدادات النظام
 * @param {object} profile
 */
async function _preloadEssentialData(profile) {
  try {
    const tasks = [
      _preloadSystemSettings(),
      _preloadCompanies(),
      _preloadExpenseAccounts(),
    ];

    // المدير يحتاج بيانات إضافية
    if (profile.role === ROLES.ADMIN || profile.role === ROLES.ADMIN_ASSISTANT) {
      tasks.push(_preloadUsers());
      tasks.push(_preloadBankAccounts());
    }

    await Promise.allSettled(tasks);
    console.log('✅ AuthService: اكتمل تحميل البيانات الأساسية');

  } catch (e) {
    console.warn('تحذير: فشل تحميل بعض البيانات الأساسية:', e.message);
  }
}

async function _preloadSystemSettings() {
  const { data, error } = await supabaseClient
    .from(TABLES.SYSTEM_SETTINGS)
    .select('*');
  if (!error && data) {
    for (const setting of data) {
      await db.system_settings.put(setting);
    }
  }
}

async function _preloadCompanies() {
  const { data, error } = await supabaseClient
    .from(TABLES.COMPANIES)
    .select('*')
    .order('name');
  if (!error && data) {
    await db.companies.bulkPut(data);
  }
}

async function _preloadExpenseAccounts() {
  const { data, error } = await supabaseClient
    .from(TABLES.EXPENSE_ACCOUNTS)
    .select('*')
    .order('name');
  if (!error && data) {
    await db.expense_accounts.bulkPut(data);
  }
}

async function _preloadUsers() {
  const { data, error } = await supabaseClient
    .from(TABLES.USERS)
    .select('id, username, display_name, role, is_active, allowed_tabs, assigned_debtors')
    .order('display_name');
  if (!error && data) {
    await db.users.bulkPut(data.map(u => ({ ...u, sync_status: SYNC_STATUS.SYNCED })));
  }
}

async function _preloadBankAccounts() {
  const { data, error } = await supabaseClient
    .from(TABLES.BANK_ACCOUNTS)
    .select('*')
    .order('name');
  if (!error && data) {
    await db.bank_accounts.bulkPut(data.map(b => ({ ...b, sync_status: SYNC_STATUS.SYNCED })));
  }
}

// ============================================================
// 9. حماية Brute Force
// ============================================================

/**
 * يتحقق هل البريد محجوب بسبب محاولات فاشلة متكررة
 * @param {string} key - البريد أو 'quick_login'
 * @returns {{ok: boolean, error?: string}}
 */
function _checkBruteForce(key) {
  const record = _loginAttempts.get(key);
  if (!record) return ok(true);

  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const remainingMins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return err(`تم تجاوز الحد الأقصى للمحاولات. انتظر ${remainingMins} دقيقة.`);
  }

  return ok(true);
}

/**
 * يُسجّل محاولة دخول فاشلة
 * @param {string} key
 */
function _recordFailedAttempt(key) {
  const record = _loginAttempts.get(key) || { count: 0, lockedUntil: null };
  record.count++;

  if (record.count >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + SECURITY_CONFIG.LOCKOUT_MINUTES * 60 * 1000;
    console.warn(`🔒 AuthService: تم قفل ${key} بسبب ${record.count} محاولات فاشلة`);
    showToast(
      `تم قفل الحساب مؤقتاً لمدة ${SECURITY_CONFIG.LOCKOUT_MINUTES} دقيقة بسبب محاولات خاطئة متكررة`,
      'error',
      6000
    );
  }

  _loginAttempts.set(key, record);
}

/**
 * يُترجم رسائل خطأ Supabase Auth للعربية
 * @param {string} msg
 * @returns {string}
 */
function _translateAuthError(msg) {
  const map = {
    'Invalid login credentials'              : 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'Email not confirmed'                    : 'البريد الإلكتروني غير مؤكد',
    'User not found'                         : 'المستخدم غير موجود',
    'Too many requests'                      : 'طلبات كثيرة جداً. انتظر قليلاً.',
    'Invalid email or password'              : 'البريد الإلكتروني أو كلمة المرور غير صحيحة',
    'signup_disabled'                        : 'التسجيل معطل في هذا النظام',
  };
  return map[msg] || `خطأ في المصادقة: ${msg}`;
}

// ============================================================
// 10. دوال الوصول للحالة الداخلية
// ============================================================

/** يُعيد المستخدم الحالي */
function getCurrentUser() {
  return AuthState.currentUser;
}

/** يُعيد دور المستخدم الحالي */
function getCurrentRole() {
  return AuthState.currentUser?.role || null;
}

/** يُعيد معرف المستخدم الحالي */
function getCurrentUserId() {
  return AuthState.currentUser?.id || null;
}

/** يتحقق هل المستخدم الحالي مدير */
function isAdmin() {
  return AuthState.currentUser?.role === ROLES.ADMIN;
}

/** يتحقق هل المستخدم الحالي مندوب */
function isAgent() {
  return AuthState.currentUser?.role === ROLES.AGENT;
}

/** يتحقق هل المستخدم الحالي مساعد إداري */
function isAdminAssistant() {
  return AuthState.currentUser?.role === ROLES.ADMIN_ASSISTANT;
}

/**
 * يتحقق هل للمستخدم الوصول لتبويب معين
 * @param {string} tabId
 * @returns {boolean}
 */
function canAccessTab(tabId) {
  const user = AuthState.currentUser;
  if (!user) return false;

  if (user.role === ROLES.ADMIN) return true;

  if (user.role === ROLES.ADMIN_ASSISTANT) {
    const allowed = user.allowed_tabs || [];
    return Array.isArray(allowed) && allowed.includes(tabId);
  }

  if (user.role === ROLES.AGENT) {
    return AGENT_TABS.includes(tabId);
  }

  return false;
}

/**
 * يُعيد قائمة التبويبات المتاحة للمستخدم الحالي
 * @returns {string[]}
 */
function getAllowedTabs() {
  const user = AuthState.currentUser;
  if (!user) return [];

  if (user.role === ROLES.ADMIN)           return [...ADMIN_TABS];
  if (user.role === ROLES.AGENT)           return [...AGENT_TABS];
  if (user.role === ROLES.ADMIN_ASSISTANT) return user.allowed_tabs || [];

  return [];
}

/**
 * يُولّد رقم حساب مختصر للمستخدم (مثل M0001، A0012)
 * يُعرض في الهيدر ويمكن نسخه
 * @param {object} user
 * @returns {string}
 */
function generateAccountNumber(user) {
  if (!user) return '----';
  const prefix = user.role === ROLES.ADMIN ? 'M' :
                 user.role === ROLES.ADMIN_ASSISTANT ? 'X' : 'A';
  // نأخذ آخر 4 أرقام من UUID كمعرف مختصر
  const shortId = user.id.replace(/-/g, '').slice(-4).toUpperCase();
  return `${prefix}${shortId}`;
}

// ============================================================
// تصدير الخدمة
// ============================================================

const AuthService = {
  login,
  logout,
  checkSession,
  refreshSession,
  enableQuickLogin,
  quickLogin,
  disableQuickLogin,
  getDeviceToken,
  getCurrentUser,
  getCurrentRole,
  getCurrentUserId,
  isAdmin,
  isAgent,
  isAdminAssistant,
  canAccessTab,
  getAllowedTabs,
  generateAccountNumber,
  // للاستخدام الداخلي
  _state : AuthState,
};

window.AuthService = AuthService;

console.log('✅ AuthService.js محمّل — خدمة المصادقة جاهزة');
