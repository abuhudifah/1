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
  isOffline     : false,   // true أثناء وضع Offline (بدون JWT)
};

// ── تطبيع المعادلة ─────────────────────────────────────────────────────────
// 3.1: إزالة المسافات قبل حساب الهاش لضمان "12 + 88" == "12+88"
function normalizeEquation(eq) {
  return String(eq).replace(/\s+/g, '');
}

// ── فحص الاتصال الشبكي الحقيقي ───────────────────────────────────────────────
// يختلف عن isOnline() الذي يُرجع false متى كان AuthState.isOffline=true (وضع
// Offline اليدوي). إدارة المعادلة السريعة عملية خادم: تهمّها الشبكة الفعلية فقط.
function _hasRealConnection() {
  try { return navigator.onLine !== false; } catch (e) { return true; }
}

// ── Brute Force helpers ─────────────────────────────────────────────────────
// sessionStorage للقفل المؤقت (يُمسح بإغلاق التبويب)
const _BF_PREFIX = 'ahu_bf_';
function _bfRead(key) {
  try { return JSON.parse(sessionStorage.getItem(_BF_PREFIX + key) || 'null'); }
  catch (e) { return null; }
}
function _bfWrite(key, data) {
  try { sessionStorage.setItem(_BF_PREFIX + key, JSON.stringify(data)); } catch (e) { }
}
function _resetAttempts(key) {
  try { sessionStorage.removeItem(_BF_PREFIX + key); } catch (e) { }
}

// localStorage للقفل الدائم (يبقى عبر جلسات المتصفح)
const _LS_BF_PREFIX = 'ahu_lsbf_';
function _lsBfRead(key) {
  try { return JSON.parse(localStorage.getItem(_LS_BF_PREFIX + key) || 'null'); }
  catch (e) { return null; }
}
function _lsBfWrite(key, data) {
  try { localStorage.setItem(_LS_BF_PREFIX + key, JSON.stringify(data)); } catch (e) { }
}
function _lsResetAttempts(key) {
  try { localStorage.removeItem(_LS_BF_PREFIX + key); } catch (e) { }
}

// فحص القفل الدائم (localStorage-backed)
function _checkLsBruteForce(key) {
  const r = _lsBfRead(key);
  if (!r) return ok(true);
  if (r.lockedUntil && Date.now() < r.lockedUntil) {
    const mins = Math.ceil((r.lockedUntil - Date.now()) / 60000);
    return err(`تم قفل الحساب. حاول بعد ${mins} دقيقة`);
  }
  if (r.lockedUntil && Date.now() >= r.lockedUntil) _lsResetAttempts(key);
  return ok(true);
}
// ── Quick Login localStorage Rate Limiting (3.3) ────────────────────────────
// يبقى عبر جلسات المتصفح: 5 محاولات → 10د، 10 محاولات → 1 ساعة
const _QL_ATTEMPTS_PREFIX = 'ahu_quick_attempts_';
function _qlBfRead(uid) {
  try { return JSON.parse(localStorage.getItem(_QL_ATTEMPTS_PREFIX + uid) || 'null'); }
  catch (e) { return null; }
}
function _qlBfWrite(uid, data) {
  try { localStorage.setItem(_QL_ATTEMPTS_PREFIX + uid, JSON.stringify(data)); } catch (e) { }
}
function _qlBfReset(uid) {
  try { localStorage.removeItem(_QL_ATTEMPTS_PREFIX + uid); } catch (e) { }
}
function _checkQlBruteForce(uid) {
  const r = _qlBfRead(uid);
  if (!r) return ok(true);
  if (r.lockedUntil && Date.now() < r.lockedUntil) {
    const mins = Math.ceil((r.lockedUntil - Date.now()) / 60000);
    return err(`تم قفل الدخول السريع. حاول بعد ${mins} دقيقة`);
  }
  if (r.lockedUntil && Date.now() >= r.lockedUntil) _qlBfReset(uid);
  return ok(true);
}
function _recordQlFailure(uid) {
  const now = Date.now();
  const r   = _qlBfRead(uid) || { count: 0, lastAttempt: now };
  r.count++;
  r.lastAttempt = now;
  if      (r.count >= 10) r.lockedUntil = now + 60 * 60 * 1000;   // 1 ساعة
  else if (r.count >= 5)  r.lockedUntil = now + 10 * 60 * 1000;   // 10 دقائق
  _qlBfWrite(uid, r);
}
// ────────────────────────────────────────────────────────────────────────────

function _recordLsFailedAttempt(key) {
  const now = Date.now();
  const r   = _lsBfRead(key) || { count: 0, lastAttempt: now };
  r.count++;
  r.lastAttempt = now;
  // قفل متعدد المراحل
  if      (r.count >= 20) r.lockedUntil = now + 60 * 60 * 1000;   // 1 ساعة
  else if (r.count >= 10) r.lockedUntil = now + 15 * 60 * 1000;   // 15 دقيقة
  else if (r.count >= 5)  r.lockedUntil = now + 5  * 60 * 1000;   // 5 دقائق
  _lsBfWrite(key, r);
}
// ────────────────────────────────────────────────────────────────────────────
// ────────────────────────────────────────────────────────────────────────────

// ============================================================
// 1. تسجيل الدخول التقليدي
// ============================================================
async function login(email, password) {
  try {
    // فحص مزدوج: sessionStorage (مؤقت) + localStorage (دائم عبر الجلسات)
    const lockCheck = _checkBruteForce(email);
    if (!isOk(lockCheck)) return lockCheck;
    const lsLockCheck = _checkLsBruteForce(`login_${email}`);
    if (!isOk(lsLockCheck)) return lsLockCheck;

    if (!email || !password) return err('البريد الإلكتروني وكلمة المرور مطلوبان');
    if (!isValidEmail(email))  return err('البريد الإلكتروني غير صالح');

    const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
      email: email.trim().toLowerCase(), password,
    });

    if (authError) {
      _recordFailedAttempt(email);
      _recordLsFailedAttempt(`login_${email}`);
      return err(_translateAuthError(authError.message));
    }

    _resetAttempts(email);
    _lsResetAttempts(`login_${email}`);

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

    // ✅ تسجيل الجهاز في سجلّ الأجهزة (لدعم «الأجهزة النشطة» والإلغاء عن بُعد)
    //    الدخول الكامل بالبريد يُعيد تفعيل الجهاز إن كان ملغى سابقاً.
    try {
      await supabaseClient.rpc('register_device', {
        p_device_id : getDeviceToken(),
        p_label     : profile.display_name || null,
        p_user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
      });
    } catch (e) { console.warn('[login] register_device فشل:', e?.message); }

    _saveToDexieBackground(profile);
    _preloadEssentialData(profile);

    return ok({ user: authData.user, profile });

  } catch (e) {
    console.error('❌ AuthService.login():', e);
    return err(formatErrorMessage(e));
  }
}

// ============================================================
// 2. تسجيل الخروج
// ============================================================
async function logout(clearLocalData = false) {
  try {
    if (window.unsubscribeAll) await unsubscribeAll();
    if (window.SyncQueue) SyncQueue.clearRetryTimers();

    // ✅ حذف وقت انتهاء الجلسة الدائمة عند الخروج
    const uid = AuthState.currentUser?.id;
    if (uid) {
      try { localStorage.removeItem(`ahu_sess_exp_${uid}`); } catch { }
    }

    sessionStorage.setItem('ahu_intentional_logout', '1'); // ✅ علامة logout صريح
    // خروج محلّي فقط: لا نُبطل refresh_token على الخادم حتى تبقى الخزنة المشفّرة
    // قادرة على فتح الجلسة بسرعة (المعادلة/البصمة) دون إعادة إدخال كلمة المرور.
    await supabaseClient.auth.signOut({ scope: 'local' });
    clearSession();

    AuthState.currentUser   = null;
    AuthState.authUser      = null;
    AuthState.isInitialized = false;
    AuthState.isOffline     = false;

    window.dispatchEvent(new CustomEvent('auth:logout'));
    return ok(true);

  } catch (e) {
    clearSession();
    AuthState.currentUser = null;
    AuthState.authUser    = null;
    AuthState.isOffline   = false;
    return ok(true);
  }
}

// ============================================================
// 3. التحقق من الجلسة
// ============================================================
async function checkSession() {
  try {
    // 1. تحقق من sessionStorage (مسار سريع للجلسات القائمة)
    const localSession = getSession();

    // 2. فحص انتهاء الصلاحية المحلية (8 ساعات) — فقط إذا كانت موجودة
    if (localSession?.sessionExpiresAt && Date.now() > localSession.sessionExpiresAt) {
      await logout();
      return err('انتهت صلاحية الجلسة. يُرجى تسجيل الدخول مجدداً');
    }

    // 3. ✅ FIX: التحقق من JWT في Supabase (المصدر الحقيقي — يُخزَّن في localStorage)
    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (!error && session) {
      // JWT صالح — إذا كانت الجلسة المحلية مفقودة (أُغلق المتصفح) أعد بناءها
      if (!localSession) {
        const uid = session.user.id;
        // devPref='temporary' يعني فقط "لا تمدّد ahu_sess_exp" — لا يعني رمي JWT الصالح.
        // ما دام JWT موجود وصالح نبني منه الجلسة دائماً بغض النظر عن devPref.
        const devPref = localStorage.getItem(`ahu_device_pref_${uid}`);
        if (devPref !== 'temporary') {
          // فحص مهلة الجلسة الدائمة فقط للجلسات غير المؤقتة
          const persistedExpiry = localStorage.getItem(`ahu_sess_exp_${uid}`);
          if (persistedExpiry && Date.now() > parseInt(persistedExpiry, 10)) {
            await logout();
            return err('انتهت صلاحية الجلسة. يُرجى تسجيل الدخول مجدداً');
          }
        }
        // JWT صالح في كلتا الحالتين → نكمل ببناء الجلسة من JWT أدناه
      }

      const profileResult = await _fetchUserProfile(session.user.id);
      if (!isOk(profileResult)) return err('لم يُعثر على ملف المستخدم');

      const profile = profileResult.data;
      if (!profile.is_active) { await logout(); return err('تم تعطيل هذا الحساب'); }

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

      await _setupDeviceToken(profile.id);
      _saveToDexieBackground(profile);
      _preloadEssentialData(profile);
      _migrateQuickLoginStorage();
      return ok({ user: session.user, profile });
    }

    // 4. لا يوجد JWT صالح — تحقق من جلسة offline (Quick Login)
    const offlineResult = await _checkOfflineSessionFallback();
    if (offlineResult) return offlineResult;

    // 5. لا توجد جلسة بأي شكل
    clearSession();
    return err('لا توجد جلسة نشطة');

  } catch (e) {
    return err(formatErrorMessage(e));
  }
}

// ============================================================
// 3b. استعادة جلسة Offline بعد إغلاق المتصفح
// ============================================================
async function _checkOfflineSessionFallback() {
  try {
    // ✅ منع استعادة الجلسة بعد logout صريح
    const logoutFlag = sessionStorage.getItem('ahu_intentional_logout');
    if (logoutFlag) {
      sessionStorage.removeItem('ahu_intentional_logout');
      return null;
    }

    if (typeof db === 'undefined' || !db.isOpen()) return null;

    // ✅ تبحث فقط في ahu_offline_session_* (ليس ahu_quick_*)
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ahu_offline_session_')) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key) || '{}');
        if (!data?.userId || !data?.hasPin) continue; // ✅ يجب أن يكون لديه PIN

        const profile = await db.users.get(data.userId);
        if (!profile?.is_active) continue;

        AuthState.currentUser   = profile;
        AuthState.isOffline     = true;
        AuthState.isInitialized = true;
        AuthState.authUser      = null;

        saveSession({
          userId       : profile.id,
          displayName  : profile.display_name,
          username     : profile.username,
          isOffline    : true,
          accountNumber: profile.account_number,
        });

        console.log('✅ [checkSession] استعادة جلسة Offline من PIN:', profile.display_name);
        return ok({ profile, offline: true });
      } catch { continue; }
    }
  } catch (e) {
    console.warn('⚠️ _checkOfflineSessionFallback:', e.message);
  }
  return null;
}

// ============================================================
// 4. تجديد التوكن
// ============================================================
async function refreshSession() {
  try {
    const { data, error } = await supabaseClient.auth.refreshSession();
    if (error) return err(formatErrorMessage(error));
    return ok(data.session);
  } catch (e) { return err(formatErrorMessage(e)); }
}

// ============================================================
// 5. الدخول السريع — enableQuickLogin
// ============================================================
// ============================================================
// 5z. مساعدات «الجلسة المشفّرة محليّاً» (SessionVault)
// ============================================================
function _vault() {
  if (typeof SessionVault !== 'undefined') return SessionVault;
  return (typeof window !== 'undefined' && window.SessionVault) || null;
}

// بناء حمولة الخزنة من الملف والجلسة الحالية (refresh_token + لقطة الملف)
function _buildVaultPayload(profile, session) {
  return {
    refresh_token: session?.refresh_token || null,
    access_token : session?.access_token  || null,
    deviceId     : getDeviceToken() || null,
    profile: {
      id               : profile.id,
      username         : profile.username,
      display_name     : profile.display_name,
      role             : profile.role,
      is_active        : profile.is_active,
      allowed_tabs     : profile.allowed_tabs || [],
      account_number   : profile.account_number,
      allowed_companies: profile.allowed_companies,
      allowed_banks    : profile.allowed_banks,
      allowed_users    : profile.allowed_users,
    },
    savedAt: new Date().toISOString(),
  };
}

// قائمة معرّفات المستخدمين الذين لديهم خزنة من نوع معيّن على هذا الجهاز
function _listVaultUserIds(secretType) {
  const ids = [];
  const pre = 'ahu_vault_';
  const suf = '_' + secretType;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(pre) && k.endsWith(suf)) {
        ids.push(k.slice(pre.length, k.length - suf.length));
      }
    }
  } catch { /* تجاهل */ }
  return ids;
}

// التحقق أن الجهاز غير ملغى عن بُعد
async function _isDeviceRevoked(deviceId) {
  try {
    if (!deviceId) return false;
    const { data, error } = await supabaseClient
      .from('user_devices').select('revoked_at').eq('device_id', deviceId).maybeSingle();
    if (error) return false;
    return !!(data && data.revoked_at);
  } catch { return false; }
}

// إنشاء جلسة Supabase حقيقية من حمولة خزنة مفكوكة (مشترك: معادلة/بصمة).
// بلا أي لمس لكلمة المرور — نستعيد الجلسة من refresh_token المخزّن فقط.
async function _establishSessionFromVault(payload, userId) {
  let session = null;
  try {
    if (payload.access_token && payload.refresh_token) {
      const { data } = await supabaseClient.auth.setSession({
        access_token : payload.access_token,
        refresh_token: payload.refresh_token,
      });
      session = data?.session || null;
    }
    if (!session && payload.refresh_token) {
      const { data } = await supabaseClient.auth.refreshSession({ refresh_token: payload.refresh_token });
      session = data?.session || null;
    }
  } catch (e) {
    console.warn('[vault] setSession/refresh فشل:', e?.message);
  }
  if (!session) {
    return err('انتهت صلاحية الدخول السريع — يُرجى الدخول بالبريد وكلمة المرور');
  }

  // التحقق من إلغاء الجهاز عن بُعد
  const deviceId = getDeviceToken() || payload.deviceId;
  if (await _isDeviceRevoked(deviceId)) {
    _vault()?.remove(userId);
    try { await supabaseClient.auth.signOut({ scope: 'local' }); } catch { /* تجاهل */ }
    return err('تم إلغاء هذا الجهاز — يُرجى الدخول بالبريد وكلمة المرور');
  }

  // جلب الملف (لقطة الخزنة كاحتياط ثم تحديث من الخادم)
  let profile = payload.profile;
  const fresh = await _fetchUserProfile(session.user.id);
  if (isOk(fresh)) profile = fresh.data;
  if (!profile || profile.is_active === false) return err('تم تعطيل هذا الحساب');

  AuthState.currentUser   = profile;
  AuthState.authUser      = session.user;
  AuthState.isOffline     = false;
  AuthState.isInitialized = true;
  _resetAttempts('quick_login');
  _qlBfReset(userId);

  saveSession({
    userId        : profile.id,
    role          : profile.role,
    displayName   : profile.display_name,
    username      : profile.username,
    allowedTabs   : profile.allowed_tabs || [],
    quickLoginMode: true,
    accountNumber : profile.account_number,
  });

  try { await supabaseClient.rpc('touch_device', { p_device_id: deviceId }); } catch { /* تجاهل */ }
  _saveToDexieBackground(profile);
  _preloadEssentialData(profile);
  return ok({ profile });
}

async function enableQuickLogin(equation) {
  console.log('[enableQuickLogin] بدء التفعيل — equation:', equation);
  try {
    if (!AuthState.currentUser) {
      console.error('[enableQuickLogin] فشل: لا يوجد مستخدم في AuthState.currentUser');
      return err('يجب تسجيل الدخول أولاً');
    }

    // 3.1: تطبيع المعادلة (إزالة المسافات) قبل الهاش
    const normalized = normalizeEquation(equation);
    console.log('[enableQuickLogin] normalized:', normalized);
    if (!normalized) {
      console.error('[enableQuickLogin] فشل: المعادلة فارغة بعد التطبيع');
      return err('المعادلة فارغة');
    }

    try {
      const parser = new window.exprEval.Parser();
      const result = parser.evaluate(normalized);
      console.log('[enableQuickLogin] نتيجة المعادلة:', result);
      if (typeof result !== 'number' || !isFinite(result)) {
        console.error('[enableQuickLogin] فشل: النتيجة ليست رقماً صحيحاً، القيمة:', result);
        return err('المعادلة لا تُنتج رقماً صحيحاً');
      }
    } catch (e) {
      console.error('[enableQuickLogin] فشل: خطأ في تقييم المعادلة:', e.message);
      return err('المعادلة غير صالحة رياضياً');
    }

    const uid = AuthState.currentUser.id;

    // ✅ المسار الجديد: خزنة مشفّرة محليّاً — لا توكن خادم ولا استبدال كلمة مرور.
    const V = _vault();
    if (V?.isSupported()) {
      if (!_hasRealConnection() || !AuthState.authUser) {
        return err('تفعيل الدخول السريع يتطلب اتصالاً بالإنترنت وجلسة نشطة');
      }
      try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session?.refresh_token) return err('تعذّر الحصول على الجلسة — أعد تسجيل الدخول');

        await V.create({
          userId    : uid,
          secretType: V.SECRET.EQUATION,
          secret    : normalized,
          payload   : _buildVaultPayload(AuthState.currentUser, session),
        });

        // سجّل الجهاز في سجلّ الأجهزة (لدعم «الأجهزة النشطة» والإلغاء عن بُعد)
        try {
          await supabaseClient.rpc('register_device', {
            p_device_id : getDeviceToken(),
            p_label     : AuthState.currentUser.display_name || null,
            p_user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
          });
        } catch (e) { console.warn('[enableQuickLogin] register_device فشل:', e?.message); }

        // إغلاق المسار القديم: حذف توكن الخادم القديم إن وُجد على هذا الجهاز
        try { localStorage.removeItem(`ahu_quick_${uid}`); } catch { /* تجاهل */ }

        saveSession({ ...getSession(), quickLoginEnabled: true });
        console.log('[enableQuickLogin] ✅ تم التفعيل عبر الخزنة المشفّرة');
        return ok(true);
      } catch (e) {
        console.error('[enableQuickLogin] فشل إنشاء الخزنة:', e);
        return err(formatErrorMessage(e));
      }
    }

    // ── المسار القديم (احتياطي لمتصفّحات بلا WebCrypto) ──────────────────
    const hash = await hashSHA256(normalized, uid);
    console.log('[enableQuickLogin] hash:', hash, '| uid:', uid);

    // ✅ إنشاء Token من الخادم — لا نخزن كلمة المرور إطلاقاً
    // ملاحظة: إدارة المعادلة عملية خادم تتطلب اتصالاً حقيقياً + جلسة JWT صالحة،
    // ولا علاقة لها باختيار المستخدم وضع Offline اليدوي. لذا نفحص الاتصال الشبكي
    // الحقيقي (navigator.onLine) ووجود authUser، لا isOnline() المرتبط بـ AuthState.isOffline.
    if (!_hasRealConnection() || !AuthState.authUser) {
      console.error('[enableQuickLogin] فشل: لا اتصال حقيقي أو لا جلسة JWT');
      return err('تفعيل الدخول السريع يتطلب اتصالاً بالإنترنت وجلسة نشطة');
    }

    const expiresAt  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 يوماً
    const deviceId   = getDeviceToken();
    console.log('[enableQuickLogin] deviceId:', deviceId, '| expiresAt:', expiresAt.toISOString());

    if (!deviceId) {
      console.error('[enableQuickLogin] فشل: getDeviceToken() أرجع null/undefined');
      return err('فشل الحصول على معرف الجهاز');
    }

    const { data: token, error: tokenError } = await supabaseClient.rpc(
      'create_quick_login_token',
      {
        p_user_id      : uid,
        p_equation_hash: hash,
        p_device_id    : deviceId,
        p_expires_at   : expiresAt.toISOString(),
      }
    );
    console.log('[enableQuickLogin] RPC create_quick_login_token → token:', token, '| error:', tokenError);

    if (tokenError || !token) {
      console.error('[enableQuickLogin] فشل إنشاء Token:', tokenError);
      return err('فشل تفعيل الدخول السريع: ' + (tokenError?.message || 'خطأ غير معروف'));
    }

    // ✅ نخزن Token فقط — بلا كلمة مرور، بلا role، بلا allowedTabs
    const quickData = {
      hash,
      userId     : uid,
      token,
      displayName: AuthState.currentUser.display_name,
      expiresAt  : expiresAt.toISOString(),
      createdAt  : new Date().toISOString(),
    };
    localStorage.setItem(`ahu_quick_${uid}`, JSON.stringify(quickData));
    console.log('[enableQuickLogin] ✅ تم حفظ quickData في localStorage');

    AuthState.currentUser.quick_equation_hash = hash;

    // حفظ في Supabase حتى يظهر الوضع الصحيح بعد checkSession
    try {
      await supabaseClient.from(TABLES.USERS)
        .update({ quick_equation_hash: hash })
        .eq('id', uid);
    } catch (e) {
      console.warn('[enableQuickLogin] تحديث Supabase فشل:', e.message);
    }

    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(uid, { quick_equation_hash: hash });
    } catch (e) {
      console.warn('[enableQuickLogin] تحديث Dexie فشل:', e.message);
    }

    saveSession({ ...getSession(), quickLoginEnabled: true });
    console.log('[enableQuickLogin] ✅ تم التفعيل بنجاح');
    return ok(true);
  } catch (e) {
    console.error('[enableQuickLogin] استثناء غير متوقع:', e);
    return err(formatErrorMessage(e));
  }
}

// ============================================================
// 6. الدخول السريع — quickLogin
// ============================================================
async function quickLogin(equation) {
  try {
    // 3.1: تطبيع المعادلة قبل حساب الهاش
    const normalized = normalizeEquation(equation);
    if (!normalized) return err('معادلة فارغة');

    // مفتاح عام على مستوى الجهاز — نستخدمه قبل معرفة userId
    const lockCheck = _checkBruteForce('quick_login');
    if (!isOk(lockCheck)) return lockCheck;

    if (!isOnline()) {
      // المعادلة السريعة Online فقط (تُنشئ جلسة حقيقية). للأوفلاين: 🔌 برمز PIN.
      return err('لا يوجد اتصال بالإنترنت — استخدم 🔌 للدخول بدون إنترنت برمز PIN');
    }

    // ✅ المسار الجديد: فكّ خزنة المعادلة المشفّرة محليّاً (بلا لمس كلمة المرور)
    const V = _vault();
    if (V?.isSupported()) {
      for (const uid of _listVaultUserIds(V.SECRET.EQUATION)) {
        let payload = null;
        try {
          payload = await V.unlock({ userId: uid, secretType: V.SECRET.EQUATION, secret: normalized });
        } catch { continue; } // سرّ خاطئ لهذا المستخدم — جرّب التالي

        // نجح الفكّ → أنشئ جلسة Supabase حقيقية من refresh_token المخزّن
        const res = await _establishSessionFromVault(payload, uid);
        if (isOk(res)) {
          _resetAttempts('quick_login');
          // إغلاق المسار القديم: حذف توكن الخادم القديم لهذا الجهاز نهائياً
          try { localStorage.removeItem(`ahu_quick_${uid}`); } catch { /* تجاهل */ }
          // أعد تخزين الخزنة بالتوكن المُدوَّر للاستخدام التالي
          try {
            const { data: { session: cur } } = await supabaseClient.auth.getSession();
            if (cur) {
              await V.create({
                userId    : uid,
                secretType: V.SECRET.EQUATION,
                secret    : normalized,
                payload   : _buildVaultPayload(AuthState.currentUser, cur),
              });
            }
          } catch { /* تجاهل */ }
        }
        return res;
      }
    }

    // ── المسار القديم (أجهزة لم تُهاجَر بعد): توكن الخادم ────────────────
    const _uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let quickData = null;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith('ahu_quick_')) continue;
      try {
        const data = JSON.parse(localStorage.getItem(key));
        if (!data?.userId) continue;
        const candidateHash = await hashSHA256(normalized, data.userId);
        if (candidateHash === data.hash) { quickData = data; break; }
      } catch (e) { /* تجاهل أخطاء JSON */ }
    }

    if (quickData && _uuidRe.test(quickData.token || '')) {
      return await _redeemQuickToken(quickData);
    }

    _recordFailedAttempt('quick_login');
    return err('المعادلة غير صحيحة، حاول مرة أخرى');
  } catch (e) {
    console.error('❌ AuthService.quickLogin():', e);
    return err(formatErrorMessage(e));
  }
}

// ============================================================
// 6b. استبدال توكن الدخول السريع بجلسة Supabase حقيقية (مُشترَك)
//     يُستخدَم من مساري المعادلة والبصمة — مصدر JWT موحّد
// ============================================================
async function _redeemQuickToken(quickData) {
  const { userId } = quickData;

  // فحص قفل localStorage الخاص بهذا المستخدم (يبقى بعد إغلاق المتصفح)
  const qlLock = _checkQlBruteForce(userId);
  if (!isOk(qlLock)) return qlLock;

  const perUserLock = _checkBruteForce(`quick_login_${userId}`);
  if (!isOk(perUserLock)) return perUserLock;

  try {
    const { data: tokenResult, error: tokenError } =
      await supabaseClient.rpc('quick_login_with_token', {
        p_token    : quickData.token,
        p_device_id: sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY)
                     || localStorage.getItem(`ahu_device_${userId}`)
                     || null,
      });

    if (tokenError) throw tokenError;

    if (!tokenResult?.success) {
      localStorage.removeItem(`ahu_quick_${userId}`);
      _recordQlFailure(userId);
      return err('المعادلة غير صحيحة، حاول مرة أخرى');
    }

    const profile = tokenResult.user;
    if (!profile.is_active) {
      _recordQlFailure(userId);
      return err('المعادلة غير صحيحة، حاول مرة أخرى');
    }

    // ✅ مصادقة قاعدة البيانات + إنشاء جلسة Supabase حقيقية (JWT)
    const { data: authData, error: authError } =
      await supabaseClient.auth.signInWithPassword({
        email   : profile.username,
        password: tokenResult.temp_password,
      });
    if (authError) {
      console.error('[QuickLogin] فشل الدخول بكلمة المرور المؤقتة:', authError);
      _recordQlFailure(userId);
      return err('المعادلة غير صحيحة، حاول مرة أخرى');
    }

    // ✅ استعادة كلمة مرور البريد الأصلية فور إنشاء الجلسة:
    //    quick_login_with_token استبدلت كلمة المرور بكلمة مؤقتة لتسجيل الدخول،
    //    وهنا نُعيد الكلمة الأصلية حتى لا يتعطّل الدخول بالبريد لاحقاً.
    //    تحديث الكلمة عبر SQL لا يُبطل هذه الجلسة (JWT) القائمة.
    try {
      const { error: restoreError } =
        await supabaseClient.rpc('quick_login_restore_password');
      if (restoreError) {
        console.warn('[QuickLogin] تعذّرت استعادة كلمة المرور الأصلية:', restoreError);
      }
    } catch (restoreEx) {
      console.warn('[QuickLogin] استثناء أثناء استعادة كلمة المرور:', restoreEx);
    }

    // ✅ Token Rotation: نحدّث الـ Token المخزن للاستخدام التالي (نُبقي حقول البصمة)
    if (tokenResult.new_token) {
      const raw = localStorage.getItem(`ahu_quick_${userId}`);
      const base = raw ? JSON.parse(raw) : quickData;
      const updated = { ...base, token: tokenResult.new_token };
      localStorage.setItem(`ahu_quick_${userId}`, JSON.stringify(updated));
    }

    AuthState.currentUser   = profile;
    AuthState.authUser      = authData.user;  // ✅ JWT حقيقي
    AuthState.isOffline     = false;
    AuthState.isInitialized = true;
    _resetAttempts('quick_login');
    _resetAttempts(`quick_login_${userId}`);
    _qlBfReset(userId);

    saveSession({
      userId        : profile.id,
      role          : profile.role,
      displayName   : profile.display_name,
      username      : profile.username,
      allowedTabs   : profile.allowed_tabs || [],
      quickLoginMode: true,
      accountNumber : profile.account_number,
    });

    // ✅ حفظ مهلة الجلسة الدائمة (8 ساعات) ما لم تكن الجلسة مؤقتة
    try {
      const devPref = localStorage.getItem(`ahu_device_pref_${profile.id}`);
      if (devPref !== 'temporary') {
        localStorage.setItem(`ahu_sess_exp_${profile.id}`, String(Date.now() + 8 * 60 * 60 * 1000));
      }
    } catch { /* localStorage غير متاح */ }

    _saveToDexieBackground(profile);
    _preloadEssentialData(profile);

    return ok({ profile });
  } catch (e) {
    console.error('[QuickLogin] فشل تسجيل الدخول:', e);
    const isNetworkError = e?.message?.includes('Failed to fetch')
      || e?.message?.includes('NetworkError')
      || e?.name === 'TypeError';
    if (isNetworkError) {
      return err('انقطع الاتصال. يُرجى المحاولة مجدداً عند عودة الشبكة');
    }
    _recordFailedAttempt(`quick_login_${quickData.userId}`);
    _recordQlFailure(quickData.userId);
    return err('المعادلة غير صحيحة، حاول مرة أخرى');
  }
}

// ============================================================
// 6b. تفعيل البصمة عبر الخزنة المشفّرة — بلا توكن خادم وبلا كلمة مرور
// ============================================================
// يُولّد مفتاح خزنة عشوائي عالي الإنتروبيا، يسجّل اعتماد WebAuthn، ثم يحفظ
// خزنة BIOMETRIC تحوي refresh_token. تحرس بوّابة WebAuthn فكّ الخزنة لاحقاً.
function _randomVaultKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return (typeof btoa === 'function') ? btoa(bin) : Buffer.from(bytes).toString('base64');
}

async function enableBiometricQuickLogin(userId) {
  try {
    const uid = userId || AuthState.currentUser?.id;
    if (!uid) return err('مستخدم غير محدد');

    const V = _vault();
    if (!V?.isSupported()) {
      // متصفّح بلا WebCrypto → المسار القديم (توكن خادم) عبر OfflineAuthService
      if (typeof OfflineAuthService === 'undefined') return err('خدمة المصادقة غير محمّلة');
      return await OfflineAuthService.enableWebAuthn(uid);
    }

    if (!_hasRealConnection() || !AuthState.authUser) {
      return err('تفعيل البصمة يتطلب اتصالاً بالإنترنت وجلسة نشطة');
    }
    if (typeof OfflineAuthService === 'undefined') return err('خدمة المصادقة غير محمّلة');

    // 1) جلسة حالية صالحة (مصدر refresh_token للخزنة)
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session?.refresh_token) return err('تعذّر الحصول على الجلسة — أعد تسجيل الدخول');

    // 2) تسجيل اعتماد WebAuthn فقط (بلا توكن خادم)
    const reg = await OfflineAuthService.registerWebAuthnCredentialOnly(uid);
    if (!isOk(reg)) return reg;
    const credentialId = reg.data.credentialId;

    // 3) خزنة BIOMETRIC مشفّرة بمفتاح عشوائي
    const bioKey = _randomVaultKey();
    await V.create({
      userId    : uid,
      secretType: V.SECRET.BIOMETRIC,
      secret    : bioKey,
      payload   : _buildVaultPayload(AuthState.currentUser, session),
    });

    // 4) بيانات البصمة المحلية (معرّف الاعتماد + مفتاح الخزنة)
    try {
      localStorage.setItem(`ahu_bio_${uid}`, JSON.stringify({
        credentialId, bioKey, hasWebAuthn: true, createdAt: new Date().toISOString(),
      }));
    } catch (e) { return err('تعذّر حفظ بيانات البصمة محليّاً: ' + e.message); }

    // 5) سجّل الجهاز + أغلق المسار القديم
    try {
      await supabaseClient.rpc('register_device', {
        p_device_id : getDeviceToken(),
        p_label     : AuthState.currentUser?.display_name || null,
        p_user_agent: (typeof navigator !== 'undefined' ? navigator.userAgent : null),
      });
    } catch (e) { console.warn('[enableBiometricQuickLogin] register_device فشل:', e?.message); }
    try { localStorage.removeItem(`ahu_quick_${uid}`); } catch { /* تجاهل */ }

    console.log('[enableBiometricQuickLogin] ✅ تم التفعيل عبر الخزنة المشفّرة');
    return ok(true);
  } catch (e) {
    console.error('❌ AuthService.enableBiometricQuickLogin():', e);
    return err(formatErrorMessage(e));
  }
}

// ============================================================
// 6c. الدخول السريع بالبصمة (WebAuthn) — Online فقط، جلسة حقيقية
// ============================================================
async function quickLoginWithWebAuthn(userId) {
  try {
    if (!userId) return err('مستخدم غير محدد');

    // البصمة تُنشئ جلسة Supabase حقيقية ⇒ تتطلب اتصالاً
    if (!isOnline()) {
      return err('البصمة تتطلب اتصالاً بالإنترنت — استخدم 🔌 للدخول بدون إنترنت برمز PIN');
    }

    // قفل عام على مستوى الجهاز
    const lockCheck = _checkBruteForce('quick_login');
    if (!isOk(lockCheck)) return lockCheck;

    if (typeof OfflineAuthService === 'undefined') {
      return err('خدمة المصادقة غير محمّلة');
    }

    // ✅ المسار الجديد: خزنة BIOMETRIC مشفّرة — بلا توكن خادم وبلا كلمة مرور
    const V = _vault();
    let bioMeta = null;
    try {
      const raw = localStorage.getItem(`ahu_bio_${userId}`);
      if (raw) bioMeta = JSON.parse(raw);
    } catch { /* تجاهل */ }

    if (V?.isSupported() && bioMeta?.bioKey && V.has(userId, V.SECRET.BIOMETRIC)) {
      // بوّابة التحقّق الحيوي (محلي داخل المتصفح)
      const bio = await OfflineAuthService.verifyWithWebAuthn(userId);
      if (!isOk(bio)) return bio;

      // فكّ الخزنة بمفتاحها ثم استعادة جلسة Supabase من refresh_token
      let payload;
      try {
        payload = await V.unlock({ userId, secretType: V.SECRET.BIOMETRIC, secret: bioMeta.bioKey });
      } catch (e) {
        return err('تعذّر فكّ خزنة البصمة — أعد تفعيل البصمة من الإعدادات');
      }

      const res = await _establishSessionFromVault(payload, userId);
      if (isOk(res)) {
        _resetAttempts('quick_login');
        try { localStorage.removeItem(`ahu_quick_${userId}`); } catch { /* تجاهل */ }
        // أعد تخزين الخزنة بالتوكن المُدوَّر للاستخدام التالي
        try {
          const { data: { session: cur } } = await supabaseClient.auth.getSession();
          if (cur) {
            await V.create({
              userId, secretType: V.SECRET.BIOMETRIC, secret: bioMeta.bioKey,
              payload: _buildVaultPayload(AuthState.currentUser, cur),
            });
          }
        } catch { /* تجاهل */ }
      }
      return res;
    }

    // ── المسار القديم (أجهزة legacy: توكن خادم في ahu_quick_) ────────────
    let quickData = null;
    try {
      const raw = localStorage.getItem(`ahu_quick_${userId}`);
      if (raw) quickData = JSON.parse(raw);
    } catch { /* تجاهل أخطاء JSON */ }

    const _uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!quickData?.token || !quickData?.userId || !_uuidRe.test(quickData.token)) {
      return err('فعّل البصمة للدخول السريع أولاً من الإعدادات');
    }

    const bio = await OfflineAuthService.verifyWithWebAuthn(userId);
    if (!isOk(bio)) return bio;

    // نجاح البصمة → استبدال التوكن بجلسة Supabase حقيقية
    return await _redeemQuickToken(quickData);
  } catch (e) {
    console.error('❌ AuthService.quickLoginWithWebAuthn():', e);
    return err(formatErrorMessage(e));
  }
}

// ============================================================
// 7. إلغاء الدخول السريع
// ============================================================
async function disableQuickLogin() {
  try {
    if (!AuthState.currentUser) return err('يجب تسجيل الدخول أولاً');

    const uid = AuthState.currentUser.id;

    // ✅ الإزالة عملية خادم: لا نُجري إزالة محلية جزئية تُحدِث تضارباً عند إعادة التحميل.
    // نشترط اتصالاً شبكياً حقيقياً + جلسة JWT، ونحدّث الخادم أولاً (مصدر الحقيقة).
    if (!_hasRealConnection() || !AuthState.authUser) {
      return err('تتطلب إزالة الدخول السريع اتصالاً بالإنترنت وجلسة نشطة');
    }

    try {
      const { error: supaErr } = await supabaseClient.from(TABLES.USERS)
        .update({ quick_equation_hash: null })
        .eq('id', uid);
      if (supaErr) {
        console.warn('⚠️ [disableQuickLogin] Supabase تحديث فشل:', supaErr.message);
        return err('فشلت إزالة الدخول السريع من الخادم — حاول مجدداً');
      }
    } catch (e) {
      console.warn('⚠️ [disableQuickLogin] Supabase استثناء:', e.message);
      return err('انقطع الاتصال أثناء الإزالة — حاول مجدداً عند عودة الشبكة');
    }

    // ✅ الخادم تحدّث بنجاح → نظّف الحالة المحلية
    localStorage.removeItem(`ahu_quick_${uid}`);
    try { localStorage.removeItem(`ahu_bio_${uid}`); } catch { /* تجاهل */ }
    _vault()?.remove(uid); // حذف الخزنة المشفّرة (كل الأنواع: معادلة/PIN/بصمة)
    _qlBfReset(uid); // 3.3: إعادة تعيين عداد المحاولات عند الإلغاء
    AuthState.currentUser.quick_equation_hash = null;

    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(uid, { quick_equation_hash: null });
    } catch (e) { console.warn('⚠️ [disableQuickLogin] Dexie تحديث فشل:', e.message); }

    return ok(true);
  } catch (e) { return err(formatErrorMessage(e)); }
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
  } catch (e) {
    console.warn('⚠️ getUserAccountNumber:', e.message);
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
    
    let newNumber;
    const entityType = profile?.role === ROLES.AGENT ? 'user' : 'user'; // RPC تدعم 'user'
    const { data: rpcNumber, error: genError } = await supabaseClient.rpc('generate_account_number', {
      entity_type: entityType
    });

    if (genError) {
      console.warn('⚠️ RPC generate_account_number فشلت، fallback محلي:', genError.message);
      newNumber = createAccountNumber(profile?.role || 'agent');
    } else {
      newNumber = rpcNumber;
    }
    
    // ✅ A1: UPDATE مشروط (فقط إذا كان الحقل لا يزال NULL) لمنع Race Condition
    const { error: updateError } = await supabaseClient
      .from(TABLES.USERS)
      .update({ account_number: newNumber })
      .eq('id', userId)
      .is('account_number', null);

    if (updateError) {
      // 23505 = Unique Violation أو PGRST116 = لا صفوف تحقق الشرط
      // كلاهما يعني أن عملية أخرى سبقتنا وعيّنت رقماً → نجلب القيمة الحالية
      if (updateError.code === '23505' || updateError.code === 'PGRST116') {
        const { data: refetched } = await supabaseClient
          .from(TABLES.USERS).select('account_number').eq('id', userId).single();
        if (refetched?.account_number) {
          if (profile) profile.account_number = refetched.account_number;
          return refetched.account_number;
        }
      }
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
    
    return newNumber;
    
  } catch (e) {
    console.error('❌ _ensureUserAccountNumber:', e);
    return null;
  }
}

// ============================================================
// 8b. توليد أرقام الحسابات بالصيغة الموحدة الجديدة
// ============================================================

/**
 * يولّد رقم حساب جديد بالصيغة الموحدة (USR/ADM/CMP + 6 أرقام عشوائية)
 * @param {'admin'|'admin_assistant'|'agent'|'company'} role
 * @returns {string}  مثال: USR-372819
 */
function createAccountNumber(role) {
  const prefixMap = {
    admin          : 'ADM',
    admin_assistant: 'ADM',
    agent          : 'USR',
    company        : 'CMP',
  };
  const prefix      = prefixMap[role] || 'USR';
  const randomDigits = Math.floor(100000 + Math.random() * 900000);
  return `${prefix}-${randomDigits}`;
}

/**
 * يولّد رقم حساب بنكي مرتبط برقم الشركة المالكة
 * الصيغة: BNK-XXXXXX-YY  (XXXXXX = أرقام الشركة, YY = تسلسل البنوك للشركة)
 * @param {string} companyId - معرف الشركة في جدول companies
 * @returns {Promise<string>}  مثال: BNK-789012-02
 */
async function generateBankAccountNumber(companyId) {
  if (!companyId) throw new Error('معرف الشركة مطلوب لتوليد رقم الحساب البنكي');

  const { data: company, error: compErr } = await supabaseClient
    .from('companies')
    .select('account_number')
    .eq('id', companyId)
    .single();

  if (compErr || !company) throw new Error('الشركة غير موجودة أو فشل جلب بياناتها');

  const companyDigits = (company.account_number || '').split('-')[1];
  if (!companyDigits) throw new Error(`رقم حساب الشركة غير صالح: ${company.account_number}`);

  const { count, error: countErr } = await supabaseClient
    .from('bank_accounts')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', companyId);

  if (countErr) throw new Error(`فشل إحصاء الحسابات البنكية: ${countErr.message}`);

  const bankSequence = String((count || 0) + 1).padStart(2, '0');
  return `BNK-${companyDigits}-${bankSequence}`;
}

/**
 * ينشئ حساباً بنكياً جديداً مع توليد internal_account_number تلقائياً
 * @param {{ company_id: string, name: string, account_number: string,
 *           financial_ceiling?: number, card_number?: string, card_holder?: string }} bankData
 * @returns {Promise<object>} بيانات الحساب البنكي المُنشأ
 */
async function createBankAccount(bankData) {
  if (!bankData?.company_id)     throw new Error('company_id مطلوب لإنشاء الحساب البنكي');
  if (!bankData?.name)           throw new Error('اسم البنك (name) مطلوب');
  if (!bankData?.account_number) throw new Error('رقم الحساب الحقيقي (account_number) مطلوب');

  const internalNumber = await generateBankAccountNumber(bankData.company_id);

  const { data, error } = await supabaseClient
    .from('bank_accounts')
    .insert({
      company_id              : bankData.company_id,
      name                    : bankData.name,
      account_number          : bankData.account_number,       // الرقم الحقيقي من المستخدم
      internal_account_number : internalNumber,                 // BNK-XXXXXX-YY مُولَّد تلقائياً
      financial_ceiling       : bankData.financial_ceiling ?? 1,
      card_number             : bankData.card_number  ?? null,
      card_holder             : bankData.card_holder  ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`فشل إنشاء الحساب البنكي: ${error.message}`);
  return data;
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
  } catch (e) { return generateUUID(); }
}

function getDeviceToken() {
  try {
    return sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY)
      || localStorage.getItem(`ahu_device_${AuthState.currentUser?.id}`)
      || null;
  } catch (e) { return null; }
}

// ============================================================
// 10. جلب ملف المستخدم
// ============================================================
async function _fetchUserProfile(userId) {
  if (isOnline()) {
    try {
      const { data, error } = await supabaseClient
        .from(TABLES.USERS)
        .select('id, username, display_name, role, is_active, allowed_tabs, quick_equation_hash, last_login, created_at, assigned_debtors, account_number, allowed_companies, allowed_banks, allowed_users')
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
  } catch (e) { console.warn('⚠️ _fetchUserProfile Dexie:', e.message); }
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
    } catch (e) { console.warn('⚠️ _saveToDexieBackground:', e.message); }
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
        supabaseClient.from(TABLES.SYSTEM_SETTINGS).select('*').limit(QUERY_LIMITS.SYSTEM_SETTINGS).then(({ data }) => {
          if (data && typeof db !== 'undefined' && db.isOpen())
            db.system_settings?.bulkPut(data).catch(() => {});
        }),
        supabaseClient.from(TABLES.COMPANIES).select('*').order('name').limit(QUERY_LIMITS.COMPANIES).then(({ data }) => {
          if (data && typeof db !== 'undefined' && db.isOpen())
            db.companies?.bulkPut(data).catch(() => {});
        }),
      ];
      if (profile.role === ROLES.ADMIN || profile.role === ROLES.ADMIN_ASSISTANT) {
        tasks.push(
          supabaseClient.from(TABLES.USERS)
            .select('id,username,display_name,role,is_active,allowed_tabs,account_number,quick_equation_hash')
            .order('display_name')
            .limit(QUERY_LIMITS.USERS)
            .then(({ data }) => {
              if (data && typeof db !== 'undefined' && db.isOpen()) {
                // ✅ استثناء صفّ المستخدم الحالي: نسخته المرجعية تأتي من
                // _saveToDexieBackground (الملف الكامل)، فلا نكتب فوقها ونمحو الهاش.
                const others = data.filter(u => u.id !== profile.id);
                db.users?.bulkPut(others.map(u => ({ ...u, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {});
              }
            })
        );
      }
      await Promise.allSettled(tasks);
    } catch (e) { console.warn('⚠️ _preloadEssentialData:', e.message); }
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
      } catch (e) { /* تجاهل أخطاء JSON في مفاتيح localStorage الفردية */ }
    }
  } catch (e) { console.warn('⚠️ _migrateQuickLoginStorage:', e.message); }
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
  // قفل متعدد المراحل
  if      (r.count >= 20) r.lockedUntil = now + 60 * 60 * 1000;   // 1 ساعة
  else if (r.count >= 10) r.lockedUntil = now + 15 * 60 * 1000;   // 15 دقيقة
  else if (r.count >= 5)  r.lockedUntil = now + 5  * 60 * 1000;   // 5 دقائق
  _bfWrite(key, r);
}
function _translateAuthError(msg) {
  if (msg.includes('Invalid login credentials')) return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  if (msg.includes('Email not confirmed'))        return 'يجب تأكيد البريد الإلكتروني أولاً';
  if (msg.includes('Too many requests'))          return 'محاولات كثيرة. انتظر قليلاً';
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Load failed') || msg.includes('fetch'))
    return 'لا يوجد اتصال بالإنترنت — تحقق من الشبكة أو استخدم 🔌 للدخول بدون إنترنت';
  return msg;
}

// ============================================================
// 15. التحقق من is_active عند التنقل
// ============================================================
let _lastActiveCheckTs = 0;
const _ACTIVE_CHECK_INTERVAL_MS = 60 * 1000; // ✅ L2: 60 ثانية للكشف السريع عن تعطيل الحساب

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
  } catch (e) {
    console.warn('⚠️ verifyIsActive:', e.message);
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
function isAdminOrAssistant() {
  const role = window.AppStore?.getState?.('role') || AuthState.currentUser?.role;
  return role === ROLES.ADMIN || role === ROLES.ADMIN_ASSISTANT;
}
function canAccessTab(tabId) { return getAllowedTabs().includes(tabId); }

/**
 * يعيد قائمة معرفات الشركات المسموحة للمندوب.
 * المدير/المساعد: null (كل الشركات مسموحة).
 * المندوب: المصفوفة المخزنة في allowed_companies (فارغة = كل الشركات).
 */
function getAllowedCompanies() {
  if (isAdminOrAssistant()) return null;
  const raw = AuthState.currentUser?.allowed_companies;
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw :
    (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
  return arr.length ? arr : null;
}

function getAllowedBanks() {
  if (isAdminOrAssistant()) return null;
  const raw = AuthState.currentUser?.allowed_banks;
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw :
    (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
  return arr.length ? arr : null;
}

function getAllowedUsers() {
  if (isAdminOrAssistant()) return null;
  const raw = AuthState.currentUser?.allowed_users;
  if (!raw) return null;
  const arr = Array.isArray(raw) ? raw :
    (typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return []; } })() : []);
  return arr.length ? arr : null;
}

function getAllowedTabs() {
  // وضع Offline → 3 تبويبات فقط بغض النظر عن الدور
  if (AuthState.isOffline) {
    const t = typeof TABS !== 'undefined' ? TABS : {};
    return [
      t.DATA_ENTRY      || 'data-entry',
      t.FAILED_DEPOSITS || 'failed-deposits',
      t.NOTIFICATIONS   || 'notifications',
    ];
  }

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
      (typeof tabs === 'string' ? (() => { try { return JSON.parse(tabs); } catch (e) { return []; } })() : []);
    return parsed.length ? parsed : [...AGENT_TABS];
  }
  return [...AGENT_TABS];
}

// ============================================================
// 17. تسجيل الخروج من الأجهزة الأخرى
// ============================================================
async function signOutOtherDevices() {
  try {
    const { error } = await supabaseClient.auth.signOut({ scope: 'others' });
    if (error) return err('فشل تسجيل الخروج من الأجهزة الأخرى: ' + error.message);
    return ok(true);
  } catch (e) {
    return err(formatErrorMessage(e));
  }
}

async function signOutAllDevices() {
  try {
    const uid = AuthState.currentUser?.id;
    if (uid) {
      try { localStorage.removeItem(`ahu_sess_exp_${uid}`); } catch { }
    }
    const { error } = await supabaseClient.auth.signOut({ scope: 'global' });
    if (error) return err('فشل تسجيل الخروج: ' + error.message);
    clearSession();
    AuthState.currentUser   = null;
    AuthState.authUser      = null;
    AuthState.isInitialized = false;
    AuthState.isOffline     = false;
    window.dispatchEvent(new CustomEvent('auth:logout'));
    return ok(true);
  } catch (e) {
    return err(formatErrorMessage(e));
  }
}

// ============================================================
// تصدير
// ============================================================
const AuthService = {
  login, logout, checkSession, refreshSession,
  enableQuickLogin, quickLogin, quickLoginWithWebAuthn, enableBiometricQuickLogin, disableQuickLogin,
  getDeviceToken, getCurrentUser, getCurrentRole, getCurrentUserId,
  isAdmin, isAgent, isAdminAssistant, isAdminOrAssistant,
  getAllowedCompanies, getAllowedBanks, getAllowedUsers,
  verifyIsActive,
  canAccessTab, getAllowedTabs, generateAccountNumber,
  getUserAccountNumber, createAccountNumber, generateBankAccountNumber, createBankAccount,
  signOutOtherDevices, signOutAllDevices,
  _state: AuthState,
};

window.AuthService = AuthService;
window.AuthState   = AuthState;   // مطلوب لـ LoginComponent._offlineLogin و OfflineAuthService
console.log('✅ AuthService.js v6.1 — المرحلة 3: تطبيع المعادلة + رسائل آمنة + Rate Limiting localStorage للدخول السريع + ترقية التوكنات القديمة');
