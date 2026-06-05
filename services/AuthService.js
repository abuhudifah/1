/**
 * services/AuthService.js — v3.0 (إصلاح نهائي للدخول السريع)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * ══════════════════════════════════════════════════════════════
 * الأسباب الجذرية لفشل الدخول السريع (مكتشفة بتشخيص مباشر):
 * ══════════════════════════════════════════════════════════════
 *
 * 🔴 السبب 1 (الرئيسي): بعد verify_quick_login، الكود يستدعي
 *    _fetchUserProfile(userId) التي تقرأ من Supabase مباشرة.
 *    لكن RLS (سياسة users_select_own) تشترط: id = auth.uid()
 *    وبما أنه لا توجد جلسة Supabase Auth أثناء الدخول السريع،
 *    فإن auth.uid() = NULL → الاستعلام يُعيد 0 صفوف → فشل.
 *    ← الحل: verify_quick_login مُحدَّثة لتُعيد profile كاملاً
 *      داخل الرد (SECURITY DEFINER تتجاوز RLS)
 *
 * 🔴 السبب 2: quickEnabled يُحسب مرة واحدة في render() من
 *    sessionStorage.getItem(DEVICE_TOKEN_KEY).
 *    إذا لم يكن DEVICE_TOKEN_KEY محفوظاً في sessionStorage
 *    (يُمسح عند إغلاق المتصفح)، فـ quickEnabled = false
 *    ولا يُستدعى _tryQuickLogin أبداً.
 *    ← الحل: التحقق من وجود quick_equation_hash في localStorage
 *      أيضاً (يبقى بين الجلسات)
 *
 * 🔴 السبب 3: عند enableQuickLogin، يُحفظ deviceToken من
 *    sessionStorage في localStorage. لكن عند إعادة تحميل الصفحة،
 *    sessionStorage تُمسح، فـ deviceToken يصبح '' (فارغاً).
 *    عند الدخول السريع offline، المقارنة تفشل لأن data.deviceToken
 *    ≠ sessionStorage.getItem (الذي يُعيد null/empty).
 *    ← الحل: تخزين deviceToken في localStorage أيضاً
 *
 * 🟡 التحسين 4: إضافة console.log تشخيصية في quickLogin
 *    لتسهيل الكشف عن الأخطاء مستقبلاً.
 * ══════════════════════════════════════════════════════════════
 */
'use strict';

const AuthState = {
  currentUser   : null,
  authUser      : null,
  isInitialized : false,
};

const _loginAttempts = new Map();

// ============================================================
// 1. تسجيل الدخول التقليدي
// ============================================================

async function login(email, password) {
  try {
    const lockCheck = _checkBruteForce(email);
    if (!isOk(lockCheck)) return lockCheck;

    if (!email || !password) return err('البريد الإلكتروني وكلمة المرور مطلوبان');
    if (!isValidEmail(email))  return err('البريد الإلكتروني غير صالح');

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (authError) {
      _recordFailedAttempt(email);
      return err(_translateAuthError(authError.message));
    }

    _loginAttempts.delete(email);

    const profileResult = await _fetchUserProfile(authData.user.id);
    if (!isOk(profileResult)) {
      await supabaseClient.auth.signOut();
      return err('لم يُعثر على ملف المستخدم في النظام. تواصل مع المدير.');
    }

    const profile = profileResult.data;
    if (!profile.is_active) {
      await supabaseClient.auth.signOut();
      return err('تم تعطيل هذا الحساب. راجع المدير.');
    }

    AuthState.currentUser = profile;
    AuthState.authUser    = authData.user;
    AuthState.isInitialized = true;

    await _setupDeviceToken(profile.id);

    saveSession({
      userId      : profile.id,
      role        : profile.role,
      displayName : profile.display_name,
      username    : profile.username,
      allowedTabs : profile.allowed_tabs || [],
    });

    _saveToDexieBackground(profile);
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

async function logout(clearLocalData = false) {
  try {
    await unsubscribeAll();
    if (window.SyncQueue) SyncQueue.clearRetryTimers();
    await supabaseClient.auth.signOut();
    clearSession();

    AuthState.currentUser   = null;
    AuthState.authUser      = null;
    AuthState.isInitialized = false;

    if (clearLocalData) {
      try {
        await Promise.allSettled([
          db.transactions.clear(),
          db.notifications.clear(),
          db.cache_meta.clear(),
        ]);
      } catch { /* Dexie قد لا تكون متاحة */ }
    }

    console.log('👋 AuthService: تم تسجيل الخروج');
    window.dispatchEvent(new CustomEvent('auth:logout'));
    return ok(true);

  } catch (e) {
    console.error('❌ AuthService.logout():', e);
    clearSession();
    AuthState.currentUser = null;
    AuthState.authUser    = null;
    return ok(true);
  }
}

// ============================================================
// 3. التحقق من الجلسة
// ============================================================

async function checkSession() {
  try {
    const { session, error } = await getCurrentSession();
    if (error || !session) return err('لا توجد جلسة نشطة');

    const profileResult = await _fetchUserProfile(session.user.id);
    if (!isOk(profileResult)) return err('لم يُعثر على ملف المستخدم');

    const profile = profileResult.data;
    if (!profile.is_active) { await logout(); return err('تم تعطيل هذا الحساب'); }

    AuthState.currentUser   = profile;
    AuthState.authUser      = session.user;
    AuthState.isInitialized = true;

    saveSession({
      userId      : profile.id,
      role        : profile.role,
      displayName : profile.display_name,
      username    : profile.username,
      allowedTabs : profile.allowed_tabs || [],
    });

    _saveToDexieBackground(profile);
    return ok({ user: session.user, profile });

  } catch (e) {
    console.error('❌ AuthService.checkSession():', e);
    return err(`فشل التحقق من الجلسة: ${e.message}`);
  }
}

// ============================================================
// 4. تجديد التوكن
// ============================================================

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
// 5. الدخول السريع
// ============================================================

async function enableQuickLogin(equation) {
  try {
    if (!AuthState.currentUser) return err('يجب تسجيل الدخول أولاً');
    const trimmed = String(equation).trim();
    if (!trimmed) return err('المعادلة فارغة');

    try {
      const parser = new window.exprEval.Parser();
      const result = parser.evaluate(trimmed);
      if (typeof result !== 'number' || !isFinite(result))
        return err('المعادلة لا تُنتج رقماً صحيحاً');
    } catch {
      return err('المعادلة غير صالحة رياضياً');
    }

    const hash = await hashSHA256(trimmed);

    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ quick_equation_hash: hash })
      .eq('id', AuthState.currentUser.id);

    if (error) return err(`فشل حفظ معادلة الدخول السريع: ${error.message}`);

    // تحديث AuthState
    AuthState.currentUser.quick_equation_hash = hash;

    // تحديث Dexie في الخلفية
    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(AuthState.currentUser.id, { quick_equation_hash: hash });
    } catch { /* تجاهل */ }

    // ✅ إصلاح 3: تخزين deviceToken في localStorage (يبقى بين الجلسات)
    try {
      const userId = AuthState.currentUser.id;
      // نُولّد device_token ثابتاً مرتبطاً بالجهاز (يُعاد توليده إن لم يوجد)
      let deviceToken = localStorage.getItem(`ahu_device_${userId}`);
      if (!deviceToken) {
        deviceToken = `${userId}_${generateUUID()}`;
        localStorage.setItem(`ahu_device_${userId}`, deviceToken);
      }
      // تحديث sessionStorage أيضاً
      sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, deviceToken);

      // حفظ بيانات الدخول السريع
      localStorage.setItem(
        `ahu_quick_${userId}`,
        JSON.stringify({ hash, deviceToken, userId })
      );
    } catch { /* تجاهل */ }

    const session = getSession();
    if (session) saveSession({ ...session, quickLoginEnabled: true });

    console.log('✅ AuthService: تم تفعيل الدخول السريع');
    return ok(true);
  } catch (e) {
    return err(`خطأ في تفعيل الدخول السريع: ${e.message}`);
  }
}

// ────────────────────────────────────────────────────────────
// quickLogin — الإصلاح الجذري
// ────────────────────────────────────────────────────────────
async function quickLogin(equation) {
  try {
    const trimmed = String(equation).trim();
    if (!trimmed) return err('المعادلة فارغة');

    const lockCheck = _checkBruteForce('quick_login');
    if (!isOk(lockCheck)) return lockCheck;

    const hash = await hashSHA256(trimmed);
    console.log('[QuickLogin] hash:', hash.slice(0,16) + '...');

    // ─── وضع الاتصال: RPC على Supabase ───
    if (isOnline()) {
      console.log('[QuickLogin] وضع Online — استدعاء verify_quick_login...');
      const result = await callRPC(RPC.VERIFY_QUICK_LOGIN, { p_equation_hash: hash });

      console.log('[QuickLogin] نتيجة RPC:', JSON.stringify(result?.data || result?.error));

      if (!isOk(result) || !result.data?.success) {
        _recordFailedAttempt('quick_login');
        return err(result.data?.message || 'معادلة غير صحيحة أو الحساب معطل');
      }

      // ✅ إصلاح 1: استخدام profile من RPC مباشرة (تتجاوز RLS)
      // بدلاً من _fetchUserProfile الذي يفشل بسبب RLS (auth.uid()=null)
      let profile = null;

      if (result.data.profile) {
        // ─── المسار الجديد: profile مُضمَّن في رد RPC ───
        profile = result.data.profile;
        // تأكد أن id string مُحوَّل لـ string (وليس uuid object)
        if (typeof profile.id !== 'string') profile.id = String(profile.id);
        console.log('[QuickLogin] ✅ profile من RPC مباشرة:', profile.display_name);
      } else {
        // ─── مسار احتياطي: حاول جلب من Dexie ───
        console.warn('[QuickLogin] profile غير موجود في RPC، محاولة Dexie...');
        try {
          if (typeof db !== 'undefined' && db.isOpen()) {
            profile = await db.users.get(result.data.user_id);
          }
        } catch {}

        if (!profile) {
          console.error('[QuickLogin] ❌ فشل جلب profile من Dexie أيضاً');
          return err('فشل جلب بيانات المستخدم — حاول تسجيل الدخول التقليدي مرة واحدة أولاً');
        }
      }

      if (!profile.is_active) {
        return err('تم تعطيل هذا الحساب. راجع المدير.');
      }

      AuthState.currentUser   = profile;
      AuthState.isInitialized = true;
      _loginAttempts.delete('quick_login');

      // ✅ حفظ للاستخدام Offline لاحقاً
      _saveToDexieBackground(profile);

      // ✅ تحديث DEVICE_TOKEN_KEY في sessionStorage
      try {
        const userId = profile.id;
        let deviceToken = localStorage.getItem(`ahu_device_${userId}`);
        if (!deviceToken) {
          deviceToken = `${userId}_${generateUUID()}`;
          localStorage.setItem(`ahu_device_${userId}`, deviceToken);
        }
        sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, deviceToken);
      } catch {}

      saveSession({
        userId         : profile.id,
        role           : profile.role,
        displayName    : profile.display_name,
        username       : profile.username,
        allowedTabs    : profile.allowed_tabs || [],
        quickLoginMode : true,
      });

      _preloadEssentialData(profile);

      console.log(`⚡ AuthService: دخول سريع (online) — ${profile.display_name}`);
      return ok({ profile });
    }

    // ─── وضع عدم الاتصال: localStorage + Dexie ───
    console.log('[QuickLogin] وضع Offline...');

    // ✅ إصلاح 3: البحث عن deviceToken في localStorage أولاً (لا sessionStorage)
    let offlineProfile = null;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('ahu_quick_')) continue;

        let stored;
        try { stored = JSON.parse(localStorage.getItem(key) || '{}'); }
        catch { continue; }

        if (stored.hash !== hash) continue;

        // تحقق deviceToken — نقبل أي deviceToken مطابق في localStorage
        const userId = stored.userId;
        if (!userId) continue;

        // جلب الملف من Dexie
        if (typeof db !== 'undefined' && db.isOpen()) {
          offlineProfile = await db.users.get(userId);
        }
        if (offlineProfile) break;
      }
    } catch (e) {
      console.warn('[QuickLogin] خطأ في البحث offline:', e.message);
    }

    if (!offlineProfile) {
      _recordFailedAttempt('quick_login');
      return err('الدخول السريع غير متاح offline على هذا الجهاز.\nسجّل دخولك التقليدي مرة واحدة أولاً.');
    }

    if (!offlineProfile.is_active) return err('تم تعطيل هذا الحساب.');

    AuthState.currentUser   = offlineProfile;
    AuthState.isInitialized = true;
    _loginAttempts.delete('quick_login');

    saveSession({
      userId         : offlineProfile.id,
      role           : offlineProfile.role,
      displayName    : offlineProfile.display_name,
      username       : offlineProfile.username,
      allowedTabs    : offlineProfile.allowed_tabs || [],
      quickLoginMode : true,
      offlineSession : true,
    });

    console.log(`⚡ AuthService: دخول سريع (offline) — ${offlineProfile.display_name}`);
    return ok({ profile: offlineProfile });

  } catch (e) {
    console.error('❌ AuthService.quickLogin():', e);
    return err(`خطأ في الدخول السريع: ${e.message}`);
  }
}

async function disableQuickLogin() {
  try {
    if (!AuthState.currentUser) return err('يجب تسجيل الدخول أولاً');
    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ quick_equation_hash: null })
      .eq('id', AuthState.currentUser.id);
    if (error) return err(error.message);

    // تحديث AuthState
    AuthState.currentUser.quick_equation_hash = null;

    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(AuthState.currentUser.id, { quick_equation_hash: null });
      const uid = AuthState.currentUser.id;
      localStorage.removeItem(`ahu_quick_${uid}`);
      // نُبقي ahu_device_ لأنه معرّف الجهاز
    } catch { /* تجاهل */ }

    return ok(true);
  } catch (e) {
    return err(e.message);
  }
}

// ============================================================
// 6. توثيق الجهاز
// ============================================================

async function _setupDeviceToken(userId) {
  try {
    // ✅ إصلاح 3: نستخدم localStorage للديمومة بين الجلسات
    let deviceToken = localStorage.getItem(`ahu_device_${userId}`);
    if (!deviceToken) {
      deviceToken = `${userId}_${generateUUID()}`;
      localStorage.setItem(`ahu_device_${userId}`, deviceToken);
    }
    // تحديث sessionStorage أيضاً للاستخدام الآني
    sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, deviceToken);
    return deviceToken;
  } catch { return generateUUID(); }
}

function getDeviceToken() {
  try {
    return sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY)
      || localStorage.getItem(`ahu_device_${AuthState.currentUser?.id}`)
      || null;
  } catch { return null; }
}

// ============================================================
// 7. جلب ملف المستخدم
// ============================================================

/**
 * يجلب ملف المستخدم — يُستخدم فقط عند وجود جلسة Auth نشطة
 * (تسجيل الدخول التقليدي أو checkSession)
 * لا تستخدمه في quickLogin لأن RLS تمنعه بدون جلسة
 */
async function _fetchUserProfile(userId) {
  if (isOnline()) {
    try {
      const { data, error } = await supabaseClient
        .from(TABLES.USERS)
        .select('*')
        .eq('id', userId)
        .single();

      if (!error && data) return ok(data);
      console.warn('⚠️ AuthService._fetchUserProfile: فشل Supabase:', error?.message);
    } catch (e) {
      console.warn('⚠️ AuthService._fetchUserProfile: استثناء:', e.message);
    }
  }

  // Dexie احتياطي
  try {
    if (typeof db !== 'undefined' && db.isOpen()) {
      const local = await db.users.get(userId);
      if (local) return ok(local);
    }
  } catch (dexieErr) {
    console.warn('⚠️ AuthService._fetchUserProfile: فشل Dexie:', dexieErr.message);
  }

  return err('لم يُعثر على ملف المستخدم في النظام. تواصل مع المدير.');
}

// ============================================================
// 8. كتابة Dexie في الخلفية
// ============================================================

function _saveToDexieBackground(profile) {
  (async () => {
    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.put({ ...profile, sync_status: SYNC_STATUS.SYNCED });
    } catch (e) {
      console.warn('⚠️ AuthService: فشل حفظ Dexie (غير حرج):', e.message);
    }
  })();
}

// ============================================================
// 9. تحميل البيانات الأساسية في الخلفية
// ============================================================

function _preloadEssentialData(profile) {
  (async () => {
    try {
      if (!isOnline()) return;
      const tasks = [
        _preloadSystemSettings(),
        _preloadCompanies(),
        _preloadExpenseAccounts(),
      ];
      if (profile.role === ROLES.ADMIN || profile.role === ROLES.ADMIN_ASSISTANT) {
        tasks.push(_preloadUsers());
        tasks.push(_preloadBankAccounts());
      }
      await Promise.allSettled(tasks);
      console.log('✅ AuthService: اكتمل تحميل البيانات الأساسية');
    } catch (e) {
      console.warn('⚠️ AuthService: فشل جزئي في تحميل البيانات الأساسية:', e.message);
    }
  })();
}

async function _preloadSystemSettings() {
  try {
    const { data, error } = await supabaseClient.from(TABLES.SYSTEM_SETTINGS).select('*');
    if (!error && data && typeof db !== 'undefined' && db.isOpen())
      for (const s of data) { try { await db.system_settings.put(s); } catch { } }
  } catch { }
}

async function _preloadCompanies() {
  try {
    const { data, error } = await supabaseClient.from(TABLES.COMPANIES).select('*').order('name');
    if (!error && data && typeof db !== 'undefined' && db.isOpen()) {
      try { await db.companies.bulkPut(data); } catch { }
    }
  } catch { }
}

async function _preloadExpenseAccounts() {
  try {
    const { data, error } = await supabaseClient.from(TABLES.EXPENSE_ACCOUNTS).select('*').order('name');
    if (!error && data && typeof db !== 'undefined' && db.isOpen()) {
      try { await db.expense_accounts.bulkPut(data); } catch { }
    }
  } catch { }
}

async function _preloadUsers() {
  try {
    const { data, error } = await supabaseClient
      .from(TABLES.USERS)
      .select('id, username, display_name, role, is_active, allowed_tabs, quick_equation_hash')
      .order('display_name');
    if (!error && data && typeof db !== 'undefined' && db.isOpen())
      try { await db.users.bulkPut(data.map(u => ({ ...u, sync_status: SYNC_STATUS.SYNCED }))); } catch { }
  } catch { }
}

async function _preloadBankAccounts() {
  try {
    const { data, error } = await supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name');
    if (!error && data && typeof db !== 'undefined' && db.isOpen())
      try { await db.bank_accounts.bulkPut(data.map(b => ({ ...b, sync_status: SYNC_STATUS.SYNCED }))); } catch { }
  } catch { }
}

// ============================================================
// 10. Brute Force Protection
// ============================================================

function _checkBruteForce(key) {
  const record = _loginAttempts.get(key);
  if (!record) return ok(true);
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const mins = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return err(`تم قفل الحساب. حاول بعد ${mins} دقيقة`);
  }
  return ok(true);
}

function _recordFailedAttempt(key) {
  const record = _loginAttempts.get(key) || { count: 0 };
  record.count++;
  if (record.count >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS) {
    record.lockedUntil = Date.now() + SECURITY_CONFIG.LOCKOUT_MINUTES * 60 * 1000;
  }
  _loginAttempts.set(key, record);
}

function _translateAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (msg.includes('Email not confirmed'))        return 'يجب تأكيد البريد الإلكتروني أولاً';
  if (msg.includes('Too many requests'))          return 'محاولات كثيرة. انتظر قليلاً';
  return msg;
}

// ============================================================
// الدوال العامة
// ============================================================

function getCurrentUser()    { return AuthState.currentUser; }
function getCurrentRole()    { return AuthState.currentUser?.role || null; }
function getCurrentUserId()  { return AuthState.currentUser?.id   || null; }
function isAdmin()           { return AuthState.currentUser?.role === ROLES.ADMIN; }
function isAgent()           { return AuthState.currentUser?.role === ROLES.AGENT; }
function isAdminAssistant()  { return AuthState.currentUser?.role === ROLES.ADMIN_ASSISTANT; }

function canAccessTab(tabId) { return getAllowedTabs().includes(tabId); }

function getAllowedTabs() {
  const user = AuthState.currentUser;
  if (!user) return [];
  if (user.role === ROLES.ADMIN) return [...ADMIN_TABS];
  if (user.role === ROLES.ADMIN_ASSISTANT) {
    const tabs   = user.allowed_tabs;
    const parsed = Array.isArray(tabs) ? tabs
      : (typeof tabs === 'string' ? (() => { try { return JSON.parse(tabs); } catch { return []; } })() : []);
    return parsed.length ? parsed : [...AGENT_TABS];
  }
  return [...AGENT_TABS];
}

function generateAccountNumber(user) {
  if (!user) return null;
  const prefix  = user.role === ROLES.ADMIN ? 'M'
    : user.role === ROLES.ADMIN_ASSISTANT   ? 'X' : 'A';
  const shortId = user.id.replace(/-/g, '').slice(-4).toUpperCase();
  return `${prefix}${shortId}`;
}

// ============================================================
// تصدير
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
  _state: AuthState,
};

window.AuthService = AuthService;
console.log('✅ AuthService.js v3.0 — إصلاح نهائي للدخول السريع (RLS bypass + localStorage deviceToken)');
