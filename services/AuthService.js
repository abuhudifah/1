/**
 * services/AuthService.js — v4.0 FINAL FIX
 * نظام أبو حذيفة
 *
 * ══════════════════════════════════════════════════════════
 * السبب الجذري النهائي المكتشف:
 * ══════════════════════════════════════════════════════════
 *
 * الهاشات المخزنة في قاعدة البيانات حُسبت بكود قديم مختلف
 * عن الكود الحالي → لا تتطابق → الدخول السريع يفشل دائماً
 *
 * تم حذف جميع الهاشات القديمة من قاعدة البيانات مباشرة.
 * يجب على كل مستخدم إعادة تعيين معادلته من الإعدادات.
 *
 * قاعدة التوافق الكاملة (v4.0):
 * enableQuickLogin(eq) → hashSHA256(eq.trim())
 * quickLogin(eq)       → hashSHA256(eq.trim())
 * _evaluate()          → _tryQuickLogin(s.expression) [النص الخام]
 * → الثلاثة يستخدمون النص الخام للمعادلة (مثل "12+88")
 *
 * ══════════════════════════════════════════════════════════
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
      email: email.trim().toLowerCase(), password,
    });

    if (authError) {
      _recordFailedAttempt(email);
      return err(_translateAuthError(authError.message));
    }

    _loginAttempts.delete(email);

    const profileResult = await _fetchUserProfile(authData.user.id);
    if (!isOk(profileResult)) {
      await supabaseClient.auth.signOut();
      return err('لم يُعثر على ملف المستخدم. تواصل مع المدير.');
    }

    const profile = profileResult.data;
    if (!profile.is_active) {
      await supabaseClient.auth.signOut();
      return err('تم تعطيل هذا الحساب. راجع المدير.');
    }

    AuthState.currentUser   = profile;
    AuthState.authUser      = authData.user;
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
    if (window.unsubscribeAll) await unsubscribeAll();
    if (window.SyncQueue) SyncQueue.clearRetryTimers();
    await supabaseClient.auth.signOut();
    clearSession();

    AuthState.currentUser   = null;
    AuthState.authUser      = null;
    AuthState.isInitialized = false;

    console.log('👋 AuthService: تم تسجيل الخروج');
    window.dispatchEvent(new CustomEvent('auth:logout'));
    return ok(true);

  } catch (e) {
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
    _migrateQuickLoginStorage();
    return ok({ user: session.user, profile });

  } catch (e) {
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
  } catch (e) { return err(e.message); }
}

// ============================================================
// 5. الدخول السريع — enableQuickLogin
// ============================================================
async function enableQuickLogin(equation) {
  try {
    if (!AuthState.currentUser) return err('يجب تسجيل الدخول أولاً');

    const trimmed = String(equation).trim();
    if (!trimmed) return err('المعادلة فارغة');

    // التحقق من صحة المعادلة رياضياً
    try {
      const parser = new window.exprEval.Parser();
      const result = parser.evaluate(trimmed);
      if (typeof result !== 'number' || !isFinite(result))
        return err('المعادلة لا تُنتج رقماً صحيحاً');
    } catch {
      return err('المعادلة غير صالحة رياضياً');
    }

    // ═══════════════════════════════════════════════════
    // حساب الهاش: SHA256 للنص الخام (مثل "12+88")
    // هذا يتطابق تماماً مع quickLogin أدناه
    // ═══════════════════════════════════════════════════
    const hash = await hashSHA256(trimmed);

    console.log(`[QuickLogin] enableQuickLogin: eq="${trimmed}", hash="${hash.slice(0,16)}..."`);

    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ quick_equation_hash: hash })
      .eq('id', AuthState.currentUser.id);

    if (error) return err(`فشل حفظ المعادلة: ${error.message}`);

    // تحديث الحالة المحلية
    AuthState.currentUser.quick_equation_hash = hash;

    // Dexie
    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(AuthState.currentUser.id, { quick_equation_hash: hash });
    } catch {}

    // حفظ بيانات الجهاز للاستخدام offline
    try {
      const uid = AuthState.currentUser.id;
      let deviceToken = localStorage.getItem(`ahu_device_${uid}`);
      if (!deviceToken) {
        deviceToken = `${uid}_${generateUUID()}`;
        localStorage.setItem(`ahu_device_${uid}`, deviceToken);
      }
      sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, deviceToken);
      localStorage.setItem(`ahu_quick_${uid}`, JSON.stringify({ hash, userId: uid }));
    } catch {}

    saveSession({ ...getSession(), quickLoginEnabled: true });
    console.log('✅ AuthService: تم تفعيل الدخول السريع');
    return ok(true);

  } catch (e) {
    return err(`خطأ في تفعيل الدخول السريع: ${e.message}`);
  }
}

// ============================================================
// 6. الدخول السريع — quickLogin
// ============================================================
async function quickLogin(equation) {
  try {
    const trimmed = String(equation).trim();
    if (!trimmed) return err('معادلة فارغة');

    const lockCheck = _checkBruteForce('quick_login');
    if (!isOk(lockCheck)) return lockCheck;

    // ═══════════════════════════════════════════════════
    // حساب الهاش: SHA256 للنص الخام (نفس enableQuickLogin)
    // ═══════════════════════════════════════════════════
    const hash = await hashSHA256(trimmed);

    console.log(`[QuickLogin] quickLogin: eq="${trimmed}", hash="${hash.slice(0,16)}..."`);

    // ─── وضع الاتصال ───
    if (isOnline()) {
      const result = await callRPC(RPC.VERIFY_QUICK_LOGIN, { p_equation_hash: hash });
      console.log('[QuickLogin] RPC result:', JSON.stringify(result?.data));

      if (!isOk(result) || !result.data?.success) {
        _recordFailedAttempt('quick_login');
        return err(result.data?.message || 'معادلة غير صحيحة أو الحساب معطل');
      }

      // استخدام profile المُعاد من RPC مباشرة (تتجاوز RLS)
      const profile = result.data.profile;
      if (!profile) return err('فشل جلب بيانات المستخدم من الخادم');
      if (!profile.is_active) return err('تم تعطيل هذا الحساب. راجع المدير.');

      AuthState.currentUser   = profile;
      AuthState.isInitialized = true;
      _loginAttempts.delete('quick_login');

      // حفظ device token
      try {
        const uid = profile.id;
        let deviceToken = localStorage.getItem(`ahu_device_${uid}`);
        if (!deviceToken) {
          deviceToken = `${uid}_${generateUUID()}`;
          localStorage.setItem(`ahu_device_${uid}`, deviceToken);
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

      _saveToDexieBackground(profile);
      _preloadEssentialData(profile);

      console.log(`⚡ AuthService: دخول سريع (online) — ${profile.display_name}`);
      return ok({ profile });
    }

    // ─── وضع عدم الاتصال ───
    console.log('[QuickLogin] Offline mode...');
    let offlineProfile = null;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('ahu_quick_')) continue;
        let stored;
        try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch { continue; }
        if (stored.hash !== hash) continue;
        if (stored.userId && typeof db !== 'undefined' && db.isOpen()) {
          offlineProfile = await db.users.get(stored.userId);
        }
        if (offlineProfile) break;
      }
    } catch (e) {
      console.warn('[QuickLogin] خطأ في البحث offline:', e.message);
    }

    if (!offlineProfile) {
      _recordFailedAttempt('quick_login');
      return err('الدخول السريع غير متاح offline.\nسجّل دخولك التقليدي مرة واحدة أولاً.');
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

// ============================================================
// 7. إلغاء الدخول السريع
// ============================================================
async function disableQuickLogin() {
  try {
    if (!AuthState.currentUser) return err('يجب تسجيل الدخول أولاً');

    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ quick_equation_hash: null })
      .eq('id', AuthState.currentUser.id);
    if (error) return err(error.message);

    AuthState.currentUser.quick_equation_hash = null;

    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(AuthState.currentUser.id, { quick_equation_hash: null });
      const uid = AuthState.currentUser.id;
      localStorage.removeItem(`ahu_quick_${uid}`);
    } catch {}

    return ok(true);
  } catch (e) { return err(e.message); }
}

// ============================================================
// 8. Device Token
// ============================================================
async function _setupDeviceToken(userId) {
  try {
    let dt = localStorage.getItem(`ahu_device_${userId}`);
    if (!dt) {
      dt = `${userId}_${generateUUID()}`;
      localStorage.setItem(`ahu_device_${userId}`, dt);
    }
    sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, dt);
    return dt;
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
// 9. جلب ملف المستخدم (فقط عند وجود جلسة Auth نشطة)
// ============================================================
async function _fetchUserProfile(userId) {
  if (isOnline()) {
    try {
      const { data, error } = await supabaseClient
        .from(TABLES.USERS).select('*').eq('id', userId).single();
      if (!error && data) return ok(data);
      console.warn('⚠️ _fetchUserProfile Supabase فشل:', error?.message);
    } catch (e) {
      console.warn('⚠️ _fetchUserProfile استثناء:', e.message);
    }
  }
  try {
    if (typeof db !== 'undefined' && db.isOpen()) {
      const local = await db.users.get(userId);
      if (local) return ok(local);
    }
  } catch {}
  return err('لم يُعثر على ملف المستخدم. تواصل مع المدير.');
}

// ============================================================
// 10. Dexie background
// ============================================================
function _saveToDexieBackground(profile) {
  (async () => {
    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.put({ ...profile, sync_status: SYNC_STATUS.SYNCED });
    } catch {}
  })();
}

// ============================================================
// 11. Preload
// ============================================================
function _preloadEssentialData(profile) {
  (async () => {
    try {
      if (!isOnline()) return;
      const tasks = [
        supabaseClient.from(TABLES.SYSTEM_SETTINGS).select('*').then(({ data }) => {
          if (data && typeof db !== 'undefined' && db.isOpen())
            db.system_settings?.bulkPut(data).catch(() => {});
        }),
        supabaseClient.from(TABLES.COMPANIES).select('*').order('name').then(({ data }) => {
          if (data && typeof db !== 'undefined' && db.isOpen())
            db.companies?.bulkPut(data).catch(() => {});
        }),
      ];
      if (profile.role === ROLES.ADMIN || profile.role === ROLES.ADMIN_ASSISTANT) {
        tasks.push(
          supabaseClient.from(TABLES.USERS)
            .select('id,username,display_name,role,is_active,allowed_tabs,quick_equation_hash')
            .order('display_name')
            .then(({ data }) => {
              if (data && typeof db !== 'undefined' && db.isOpen())
                db.users?.bulkPut(data.map(u => ({ ...u, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {});
            })
        );
      }
      await Promise.allSettled(tasks);
    } catch {}
  })();
}

// ============================================================
// 12. تنظيف localStorage من حقل eq المخزَّن (ترحيل أمني)
// ============================================================
function _migrateQuickLoginStorage() {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ahu_quick_')) continue;
      try {
        const val = JSON.parse(localStorage.getItem(key) || '{}');
        if ('eq' in val) {
          delete val.eq;
          localStorage.setItem(key, JSON.stringify(val));
        }
      } catch {}
    }
  } catch {}
}

// ============================================================
// 13. Brute Force
// ============================================================
function _checkBruteForce(key) {
  const r = _loginAttempts.get(key);
  if (!r) return ok(true);
  if (r.lockedUntil && Date.now() < r.lockedUntil) {
    const mins = Math.ceil((r.lockedUntil - Date.now()) / 60000);
    return err(`تم قفل الحساب. حاول بعد ${mins} دقيقة`);
  }
  return ok(true);
}
function _recordFailedAttempt(key) {
  const r = _loginAttempts.get(key) || { count: 0 };
  r.count++;
  if (r.count >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS)
    r.lockedUntil = Date.now() + SECURITY_CONFIG.LOCKOUT_MINUTES * 60 * 1000;
  _loginAttempts.set(key, r);
}
function _translateAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (msg.includes('Email not confirmed'))        return 'يجب تأكيد البريد الإلكتروني أولاً';
  if (msg.includes('Too many requests'))          return 'محاولات كثيرة. انتظر قليلاً';
  return msg;
}

// ============================================================
// 14. التحقق من is_active عند التنقل (TASK-2.3)
// ============================================================
let _lastActiveCheckTs = 0;
const _ACTIVE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 دقائق

async function verifyIsActive() {
  const user = AuthState.currentUser;
  if (!user) return err('لا يوجد مستخدم مسجّل');

  const now = Date.now();
  const useCache = !isOnline() || (now - _lastActiveCheckTs) < _ACTIVE_CHECK_INTERVAL_MS;
  if (useCache) return user.is_active ? ok(true) : err('تم تعطيل هذا الحساب');

  try {
    const { data, error } = await supabaseClient
      .from(TABLES.USERS).select('is_active').eq('id', user.id).single();
    _lastActiveCheckTs = now;
    if (!error && data) AuthState.currentUser.is_active = data.is_active;
    const active = error ? user.is_active : data.is_active;
    return active ? ok(true) : err('تم تعطيل هذا الحساب');
  } catch {
    return user.is_active ? ok(true) : err('تم تعطيل هذا الحساب');
  }
}

// ============================================================
// 15. الدوال العامة
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
    const tabs = user.allowed_tabs;
    const parsed = Array.isArray(tabs) ? tabs
      : (typeof tabs === 'string' ? (() => { try { return JSON.parse(tabs); } catch { return []; } })() : []);
    return parsed.length ? parsed : [...AGENT_TABS];
  }
  return [...AGENT_TABS];
}

function generateAccountNumber(user) {
  if (!user) return null;
  const prefix  = user.role === ROLES.ADMIN ? 'M' : user.role === ROLES.ADMIN_ASSISTANT ? 'X' : 'A';
  const shortId = user.id.replace(/-/g, '').slice(-4).toUpperCase();
  return `${prefix}${shortId}`;
}

// ============================================================
// تصدير
// ============================================================
const AuthService = {
  login, logout, checkSession, refreshSession,
  enableQuickLogin, quickLogin, disableQuickLogin,
  getDeviceToken, getCurrentUser, getCurrentRole, getCurrentUserId,
  isAdmin, isAgent, isAdminAssistant,
  verifyIsActive,
  canAccessTab, getAllowedTabs, generateAccountNumber,
  _state: AuthState,
};

window.AuthService = AuthService;
console.log('✅ AuthService.js v4.0 FINAL — إصلاح نهائي + حذف هاشات قديمة غير متوافقة');
