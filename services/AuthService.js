/**
 * services/AuthService.js — v5.1 (BEHAVIOR FIXED)
 * نظام أبو حذيفة
 *
 * التغييرات الجوهرية (السلوك الرابع):
 * ─────────────────────────────────────────────────────────
 * ✅ generateAccountNumber أصبح يُعيد account_number المخزن في جدول users
 *    بدلاً من توليد رقم وهمي من المعرف.
 *
 * ✅ إضافة fetchAndUpdateAccountNumber: تحديث account_number إذا كان null
 *    باستخدام generate_account_number RPC الموجودة في قاعدة البيانات.
 *
 * ✅ إضافة getUserAccountNumber: جلب رقم الحساب لمستخدم محدد.
 * ─────────────────────────────────────────────────────────
 */

'use strict';

const AuthState = {
  currentUser   : null,
  authUser      : null,
  isInitialized : false,
};

// ── Brute Force helpers ─────────────────────────────────────────────────────
// مخزّنة في sessionStorage لتبقى بعد F5 وتُمسح تلقائياً عند إغلاق التبويب.
// لا تُخزَّن في localStorage لتجنب تسرب بيانات القفل بين جلسات مختلفة.
const _BF_PREFIX = 'ahu_bf_';
function _bfRead(key) {
  try { return JSON.parse(sessionStorage.getItem(_BF_PREFIX + key) || 'null'); }
  catch { return null; }
}
function _bfWrite(key, data) {
  try { sessionStorage.setItem(_BF_PREFIX + key, JSON.stringify(data)); } catch {}
}
function _resetAttempts(key) {
  try { sessionStorage.removeItem(_BF_PREFIX + key); } catch {}
}
// ────────────────────────────────────────────────────────────────────────────

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

    _resetAttempts(email);

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

    // ✅ التأكد من وجود رقم حساب للمستخدم
    await _ensureUserAccountNumber(profile.id, profile);

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
      accountNumber: profile.account_number,
    });

    _saveToDexieBackground(profile);
    _preloadEssentialData(profile);

    console.log(`✅ AuthService: دخل ${profile.display_name} (${profile.role}) - رقم الحساب: ${profile.account_number || '—'}`);
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

    // ✅ التأكد من وجود رقم حساب للمستخدم
    await _ensureUserAccountNumber(profile.id, profile);

    AuthState.currentUser   = profile;
    AuthState.authUser      = session.user;
    AuthState.isInitialized = true;

    saveSession({
      userId      : profile.id,
      role        : profile.role,
      displayName : profile.display_name,
      username    : profile.username,
      allowedTabs : profile.allowed_tabs || [],
      accountNumber: profile.account_number,
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
    
    try {
      const parser = new window.exprEval.Parser();
      const result = parser.evaluate(trimmed);
      if (typeof result !== 'number' || !isFinite(result))
        return err('المعادلة لا تُنتج رقماً صحيحاً');
    } catch {
      return err('المعادلة غير صالحة رياضياً');
    }
    
    const hash = await hashSHA256(trimmed);
    
    const password = prompt('أدخل كلمة المرور الخاصة بك (سيتم تخزينها محلياً للدخول السريع)');
    if (!password) return err('كلمة المرور مطلوبة');
    
    const uid = AuthState.currentUser.id;
    const quickData = {
      hash,
      userId: uid,
      password: password,
      displayName: AuthState.currentUser.display_name,
      role: AuthState.currentUser.role,
      allowedTabs: AuthState.currentUser.allowed_tabs || [],
      username: AuthState.currentUser.username,
      accountNumber: AuthState.currentUser.account_number,
    };
    localStorage.setItem(`ahu_quick_${uid}`, JSON.stringify(quickData));
    
    AuthState.currentUser.quick_equation_hash = hash;
    
    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(uid, { quick_equation_hash: hash });
    } catch {}
    
    saveSession({ ...getSession(), quickLoginEnabled: true });
    console.log('✅ AuthService: تم تفعيل الدخول السريع محلياً');
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

    // مفتاح عام على مستوى الجهاز — نستخدمه قبل معرفة userId
    const lockCheck = _checkBruteForce('quick_login');
    if (!isOk(lockCheck)) return lockCheck;

    const hash = await hashSHA256(trimmed);

    if (isOnline()) {
      let quickData = null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('ahu_quick_')) continue;
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (data.hash === hash) {
            quickData = data;
            break;
          }
        } catch { /* تجاهل */ }
      }

      if (!quickData) {
        _recordFailedAttempt('quick_login');
        return err('لم يتم تفعيل الدخول السريع على هذا الجهاز، أو المعادلة غير صحيحة');
      }

      const { username, password, userId } = quickData;

      try {
        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
          email: username,
          password: password,
        });

        if (authError) throw authError;

        const { data: profile, error: profileError } = await supabaseClient
          .from(TABLES.USERS)
          .select('id, display_name, role, is_active, allowed_tabs, username, account_number')
          .eq('id', userId)
          .single();

        if (profileError || !profile) throw new Error('لم يتم العثور على ملف المستخدم');
        if (!profile.is_active) return err('تم تعطيل هذا الحساب. راجع المدير.');

        AuthState.currentUser = profile;
        AuthState.authUser = authData.user;
        AuthState.isInitialized = true;
        // نمسح المفتاحين: العام ومفتاح هذا المستخدم تحديداً
        _resetAttempts('quick_login');
        _resetAttempts(`quick_login_${userId}`);

        saveSession({
          userId: profile.id,
          role: profile.role,
          displayName: profile.display_name,
          username: profile.username,
          allowedTabs: profile.allowed_tabs || [],
          quickLoginMode: true,
          accountNumber: profile.account_number,
        });

        _saveToDexieBackground(profile);
        _preloadEssentialData(profile);

        console.log(`⚡ AuthService: دخول سريع (online) — ${profile.display_name} - رقم الحساب: ${profile.account_number || '—'}`);
        return ok({ profile });
      } catch (e) {
        console.error('[QuickLogin] فشل تسجيل الدخول:', e);
        // نسجّل الفشل بمفتاح userId-specific لعزل قفل كل مستخدم عن الآخر
        _recordFailedAttempt(`quick_login_${quickData.userId}`);
        if (quickData?.userId) {
          localStorage.removeItem(`ahu_quick_${quickData.userId}`);
        }
        return err('فشل الدخول السريع. يُرجى إعادة تفعيل الدخول السريع من الإعدادات.');
      }
    }

    // وضع عدم الاتصال
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

    AuthState.currentUser = offlineProfile;
    AuthState.isInitialized = true;
    _resetAttempts('quick_login');
    _resetAttempts(`quick_login_${offlineProfile.id}`);

    saveSession({
      userId: offlineProfile.id,
      role: offlineProfile.role,
      displayName: offlineProfile.display_name,
      username: offlineProfile.username,
      allowedTabs: offlineProfile.allowed_tabs || [],
      quickLoginMode: true,
      offlineSession: true,
      accountNumber: offlineProfile.account_number,
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

    const uid = AuthState.currentUser.id;
    localStorage.removeItem(`ahu_quick_${uid}`);

    AuthState.currentUser.quick_equation_hash = null;

    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(uid, { quick_equation_hash: null });
    } catch {}

    return ok(true);
  } catch (e) { return err(e.message); }
}

// ============================================================
// 8. دوال رقم الحساب (السلوك الرابع)
// ============================================================

/**
 * يُعيد رقم الحساب المخزن للمستخدم الحالي
 * @param {object} user - كائن المستخدم (اختياري، يستخدم currentUser افتراضياً)
 * @returns {string|null}
 */
function generateAccountNumber(user = null) {
  const targetUser = user || AuthState.currentUser;
  if (!targetUser) return null;
  // ✅ إرجاع account_number المخزن في قاعدة البيانات
  return targetUser.account_number || null;
}

/**
 * يجلب رقم الحساب لمستخدم محدد من قاعدة البيانات
 * @param {string} userId - معرف المستخدم
 * @returns {Promise<string|null>}
 */
async function getUserAccountNumber(userId) {
  try {
    if (isOnline()) {
      const { data, error } = await supabaseClient
        .from(TABLES.USERS)
        .select('account_number')
        .eq('id', userId)
        .single();
      if (!error && data) return data.account_number || null;
    }
    if (typeof db !== 'undefined' && db.isOpen()) {
      const local = await db.users.get(userId);
      return local?.account_number || null;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * يضمن وجود رقم حساب للمستخدم، ويُحدّثه إذا كان null
 * @param {string} userId - معرف المستخدم
 * @param {object} profile - ملف المستخدم (اختياري، يُمرر للتحديث المباشر)
 * @returns {Promise<string|null>}
 */
async function _ensureUserAccountNumber(userId, profile = null) {
  if (profile && profile.account_number) {
    return profile.account_number;
  }
  
  try {
    // محاولة جلب الرقم الحالي
    let currentNumber = null;
    if (isOnline()) {
      const { data, error } = await supabaseClient
        .from(TABLES.USERS)
        .select('account_number')
        .eq('id', userId)
        .single();
      if (!error && data) currentNumber = data.account_number;
    } else if (typeof db !== 'undefined' && db.isOpen()) {
      const local = await db.users.get(userId);
      currentNumber = local?.account_number;
    }
    
    if (currentNumber) {
      if (profile) profile.account_number = currentNumber;
      return currentNumber;
    }
    
    // توليد رقم حساب جديد باستخدام RPC
    if (!isOnline()) {
      console.warn('⚠️ لا يمكن توليد رقم حساب دون اتصال');
      return null;
    }
    
    const entityType = profile?.role === ROLES.AGENT ? 'user' : 'user'; // RPC تدعم 'user'
    const { data: newNumber, error: genError } = await supabaseClient.rpc('generate_account_number', { 
      entity_type: entityType 
    });
    
    if (genError) {
      console.error('❌ فشل توليد رقم الحساب:', genError);
      return null;
    }
    
    // تحديث قاعدة البيانات
    const { error: updateError } = await supabaseClient
      .from(TABLES.USERS)
      .update({ account_number: newNumber })
      .eq('id', userId);
    
    if (updateError) {
      console.error('❌ فشل تحديث رقم الحساب:', updateError);
      return null;
    }
    
    if (profile) profile.account_number = newNumber;
    
    // تحديث Dexie
    if (typeof db !== 'undefined' && db.isOpen()) {
      const existing = await db.users.get(userId);
      if (existing) {
        await db.users.update(userId, { account_number: newNumber });
      }
    }
    
    console.log(`✅ تم تعيين رقم الحساب ${newNumber} للمستخدم ${userId}`);
    return newNumber;
    
  } catch (e) {
    console.error('❌ _ensureUserAccountNumber:', e);
    return null;
  }
}

// ============================================================
// 9. Device Token
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
// 10. جلب ملف المستخدم
// ============================================================
async function _fetchUserProfile(userId) {
  if (isOnline()) {
    try {
      const { data, error } = await supabaseClient
        .from(TABLES.USERS)
        .select('id, username, display_name, role, is_active, allowed_tabs, quick_equation_hash, last_login, created_at, assigned_debtors, account_number')
        .eq('id', userId).single();
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
// 11. Dexie background
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
// 12. Preload
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
            .select('id,username,display_name,role,is_active,allowed_tabs,account_number')
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
// 13. تنظيف localStorage (ترحيل أمني)
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
// 14. Brute Force — sessionStorage-backed (persistent across F5)
// ============================================================
function _checkBruteForce(key) {
  const r = _bfRead(key);
  if (!r) return ok(true);
  if (r.lockedUntil && Date.now() < r.lockedUntil) {
    const mins = Math.ceil((r.lockedUntil - Date.now()) / 60000);
    return err(`تم قفل الحساب. حاول بعد ${mins} دقيقة`);
  }
  // انتهت مدة القفل → نظّف تلقائياً
  if (r.lockedUntil && Date.now() >= r.lockedUntil) _resetAttempts(key);
  return ok(true);
}
function _recordFailedAttempt(key) {
  const now = Date.now();
  const r   = _bfRead(key) || { count: 0, lastAttempt: now };
  r.count++;
  r.lastAttempt = now;
  if (r.count >= SECURITY_CONFIG.MAX_LOGIN_ATTEMPTS)
    r.lockedUntil = now + SECURITY_CONFIG.LOCKOUT_MINUTES * 60 * 1000;
  _bfWrite(key, r);
}
function _translateAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (msg.includes('Email not confirmed'))        return 'يجب تأكيد البريد الإلكتروني أولاً';
  if (msg.includes('Too many requests'))          return 'محاولات كثيرة. انتظر قليلاً';
  return msg;
}

// ============================================================
// 15. التحقق من is_active عند التنقل
// ============================================================
let _lastActiveCheckTs = 0;
const _ACTIVE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

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
// 16. الدوال العامة
// ============================================================
function getCurrentUser()    { return AuthState.currentUser; }
function getCurrentRole()    { return AuthState.currentUser?.role || null; }
function getCurrentUserId()  { return AuthState.currentUser?.id   || null; }
function isAdmin() {
  const appRole = window.AppStore?.getState?.('role');
  if (appRole === ROLES.ADMIN) return true;
  return AuthState.currentUser?.role === ROLES.ADMIN;}
function isAgent()           { return AuthState.currentUser?.role === ROLES.AGENT; }
function isAdminAssistant()  { return AuthState.currentUser?.role === ROLES.ADMIN_ASSISTANT; }
function canAccessTab(tabId) { return getAllowedTabs().includes(tabId); }

function getAllowedTabs() {
  const appRole = window.AppStore?.getState?.('role');
  const appAllowedTabs = window.AppStore?.getState?.('allowedTabs');
  
  if (appRole === ROLES.ADMIN) return [...ADMIN_TABS];
  if (appRole === ROLES.ADMIN_ASSISTANT && Array.isArray(appAllowedTabs) && appAllowedTabs.length) {
    return [...appAllowedTabs];
  }
  
  const user = AuthState.currentUser;
  if (!user) return [];
  if (user.role === ROLES.ADMIN) return [...ADMIN_TABS];
  if (user.role === ROLES.ADMIN_ASSISTANT) {
    const tabs = user.allowed_tabs;
    const parsed = Array.isArray(tabs) ? tabs :
      (typeof tabs === 'string' ? (() => { try { return JSON.parse(tabs); } catch { return []; } })() : []);
    return parsed.length ? parsed : [...AGENT_TABS];
  }
  return [...AGENT_TABS];
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
  getUserAccountNumber,
  _state: AuthState,
};

window.AuthService = AuthService;
console.log('✅ AuthService.js v5.1 — السلوك الرابع: generateAccountNumber يُعيد account_number المخزن');
