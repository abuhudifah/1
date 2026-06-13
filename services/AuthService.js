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

// ── Brute Force helpers ─────────────────────────────────────────────────────
// مخزّنة في sessionStorage لتبقى بعد F5 وتُمسح تلقائياً عند إغلاق التبويب.
// لا تُخزَّن في localStorage لتجنب تسرب بيانات القفل بين جلسات مختلفة.
const _BF_PREFIX = 'ahu_bf_';
function _bfRead(key) {
  try { return JSON.parse(sessionStorage.getItem(_BF_PREFIX + key) || 'null'); }
  catch (e) { return null; }
}
function _bfWrite(key, data) {
  try { sessionStorage.setItem(_BF_PREFIX + key, JSON.stringify(data)); } catch (e) { /* sessionStorage غير متاح */ }
}
function _resetAttempts(key) {
  try { sessionStorage.removeItem(_BF_PREFIX + key); } catch (e) { /* sessionStorage غير متاح */ }
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
    await supabaseClient.auth.signOut();
    clearSession();

    AuthState.currentUser   = null;
    AuthState.authUser      = null;
    AuthState.isInitialized = false;

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
    // 1. تحقق سريع من الجلسة المحلية — فشل فوري دون استدعاء Supabase
    const localSession = getSession();
    if (!localSession) return err('لا توجد جلسة نشطة');

    // 2. فحص انتهاء الصلاحية المحلية (8 ساعات مطلقة) ✅ S8
    if (localSession.sessionExpiresAt && Date.now() > localSession.sessionExpiresAt) {
      await logout();
      return err('انتهت صلاحية الجلسة. يُرجى تسجيل الدخول مجدداً');
    }

    // 3. التحقق من صلاحية JWT مع Supabase
    const { data: { session }, error } = await supabaseClient.auth.getSession();
    if (error || !session) {
      await logout();
      return err('الجلسة غير صالحة. يُرجى تسجيل الدخول مجدداً');
    }

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
    return err(formatErrorMessage(e));
  }
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
    } catch (e) {
      return err('المعادلة غير صالحة رياضياً');
    }
    
    // الهاش مرتبط بـ userId لمنع استخدام نفس المعادلة بين حسابات مختلفة
    const uid  = AuthState.currentUser.id;
    const hash = await hashSHA256(trimmed, uid);

    // ✅ إنشاء Token من الخادم — لا نخزن كلمة المرور إطلاقاً
    if (!isOnline()) return err('تفعيل الدخول السريع يتطلب اتصالاً بالإنترنت');

    // ✅ S6 + UX-4: التحقق من كلمة المرور مع شرح الغرض للمستخدم
    const password = await PasswordDialog.show({
      title   : 'تأكيد هويتك',
      subtitle : 'سيتم استخدام هذه المعادلة للدخول السريع مستقبلاً — حتى بدون إنترنت',
    });
    if (!password) return err('تم إلغاء تفعيل الدخول السريع');

    const { error: verifyError } = await supabaseClient.auth.signInWithPassword({
      email   : AuthState.authUser?.email || AuthState.currentUser.username,
      password,
    });
    if (verifyError) {
      return err('كلمة المرور غير صحيحة. فشل تفعيل الدخول السريع');
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 يوماً

    const { data: token, error: tokenError } = await supabaseClient.rpc(
      'create_quick_login_token',
      {
        p_user_id      : uid,
        p_equation_hash: hash,
        p_device_id    : getDeviceToken(),
        p_expires_at   : expiresAt.toISOString(),
      }
    );

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

    AuthState.currentUser.quick_equation_hash = hash;

    try {
      if (typeof db !== 'undefined' && db.isOpen())
        await db.users.update(uid, { quick_equation_hash: hash });
    } catch (e) {
      console.warn('[enableQuickLogin] تحديث Dexie فشل:', e.message);
    }

    saveSession({ ...getSession(), quickLoginEnabled: true });
    return ok(true);
  } catch (e) {
    return err(formatErrorMessage(e));
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

    // البحث per-user: لكل مدخل نستخرج userId ونحسب الهاش بـ Salt الخاص به
    // لا نحسب هاشاً واحداً مسبقاً لأنه مرتبط بـ userId المجهول حتى الآن
    if (isOnline()) {
      let quickData = null;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('ahu_quick_')) continue;
        try {
          const data = JSON.parse(localStorage.getItem(key));
          if (!data?.userId) continue;
          // نحسب الهاش بنفس userId المستخرج من هذا المدخل
          const candidateHash = await hashSHA256(trimmed, data.userId);
          if (candidateHash === data.hash) {
            quickData = data;
            break;
          }
        } catch (e) { /* تجاهل أخطاء JSON في localStorage */ }
      }

      if (!quickData) {
        _recordFailedAttempt('quick_login');
        return err('لم يتم تفعيل الدخول السريع على هذا الجهاز، أو المعادلة غير صحيحة');
      }

      const { userId } = quickData;

      // ✅ S4: فحص Brute Force الخاص بهذا المستخدم تحديداً
      // (المفتاح العام 'quick_login' يحمي من تخمين المعادلات بمجهول)
      // (المفتاح الخاص يحمي من استنزاف Token هذا المستخدم تحديداً)
      const perUserLock = _checkBruteForce(`quick_login_${userId}`);
      if (!isOk(perUserLock)) return perUserLock;

      try {
        // ✅ التحقق عبر Token — لا signInWithPassword، لا كلمة مرور
        const { data: tokenResult, error: tokenError } =
          await supabaseClient.rpc('quick_login_with_token', {
            p_token    : quickData.token,
            p_device_id: getDeviceToken(),
          });

        if (tokenError) throw tokenError;

        if (!tokenResult?.success) {
          // Token منتهي الصلاحية أو غير صالح → حذف البيانات المحلية
          localStorage.removeItem(`ahu_quick_${userId}`);
          return err(tokenResult?.error || 'انتهت صلاحية الدخول السريع. يُرجى إعادة التفعيل');
        }

        const profile = tokenResult.user;
        if (!profile.is_active) return err('تم تعطيل هذا الحساب. راجع المدير.');

        // ✅ الحصول على JWT حقيقي عبر كلمة المرور المؤقتة
        const { data: authData, error: authError } =
          await supabaseClient.auth.signInWithPassword({
            email   : profile.username,
            password: tokenResult.temp_password,
          });
        if (authError) {
          console.error('[QuickLogin] فشل الدخول بكلمة المرور المؤقتة:', authError);
          return err('فشل تسجيل الدخول السريع: ' + authError.message);
        }

        // ✅ Token Rotation: نحدّث الـ Token المخزن للاستخدام التالي
        if (tokenResult.new_token) {
          const updated = { ...quickData, token: tokenResult.new_token };
          localStorage.setItem(`ahu_quick_${userId}`, JSON.stringify(updated));
        }

        AuthState.currentUser   = profile;
        AuthState.authUser      = authData.user; // ✅ JWT حقيقي من Supabase
        AuthState.isInitialized = true;
        _resetAttempts('quick_login');
        _resetAttempts(`quick_login_${userId}`);

        // role و allowedTabs لا تُخزَّن في localStorage — تُقرأ دائماً من AuthState.currentUser
        saveSession({
          userId        : profile.id,
          displayName   : profile.display_name,
          username      : profile.username,
          quickLoginMode: true,
          accountNumber : profile.account_number,
        });

        _saveToDexieBackground(profile);
        _preloadEssentialData(profile);

        return ok({ profile });
      } catch (e) {
        console.error('[QuickLogin] فشل تسجيل الدخول:', e);
        // ✅ L1: خطأ الشبكة لا يحذف بيانات الدخول السريع ولا يُسجّل محاولة فاشلة
        const isNetworkError = e?.message?.includes('Failed to fetch')
          || e?.message?.includes('NetworkError')
          || e?.name === 'TypeError';
        if (isNetworkError) {
          return err('انقطع الاتصال. يُرجى المحاولة مجدداً عند عودة الشبكة');
        }
        _recordFailedAttempt(`quick_login_${quickData.userId}`);
        return err(formatErrorMessage(e));
      }
    }

    // وضع عدم الاتصال
    let offlineProfile = null;

    try {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key?.startsWith('ahu_quick_')) continue;
        let stored;
        try { stored = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) { continue; }
        if (!stored?.userId) continue;
        // نفس منطق Online: نحسب الهاش per-userId
        const candidateHash = await hashSHA256(trimmed, stored.userId);
        if (candidateHash !== stored.hash) continue;
        if (typeof db !== 'undefined' && db.isOpen()) {
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

    // ✅ S4: فحص Brute Force الخاص بهذا المستخدم (offline)
    const perUserLockOffline = _checkBruteForce(`quick_login_${offlineProfile.id}`);
    if (!isOk(perUserLockOffline)) return perUserLockOffline;

    if (!offlineProfile.is_active) return err('تم تعطيل هذا الحساب.');

    AuthState.currentUser   = offlineProfile;
    AuthState.isOffline     = true;
    AuthState.isInitialized = true;
    _resetAttempts('quick_login');
    _resetAttempts(`quick_login_${offlineProfile.id}`);

    // role و allowedTabs لا تُخزَّن في localStorage — تُقرأ من AuthState.currentUser (مُحمَّل من Dexie)
    saveSession({
      userId        : offlineProfile.id,
      displayName   : offlineProfile.display_name,
      username      : offlineProfile.username,
      quickLoginMode: true,
      offlineSession: true,
      accountNumber : offlineProfile.account_number,
    });

    return ok({ profile: offlineProfile });
  } catch (e) {
    console.error('❌ AuthService.quickLogin():', e);
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
    localStorage.removeItem(`ahu_quick_${uid}`);

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
            .select('id,username,display_name,role,is_active,allowed_tabs,account_number')
            .order('display_name')
            .limit(QUERY_LIMITS.USERS)
            .then(({ data }) => {
              if (data && typeof db !== 'undefined' && db.isOpen())
                db.users?.bulkPut(data.map(u => ({ ...u, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {});
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
// تصدير
// ============================================================
const AuthService = {
  login, logout, checkSession, refreshSession,
  enableQuickLogin, quickLogin, disableQuickLogin,
  getDeviceToken, getCurrentUser, getCurrentRole, getCurrentUserId,
  isAdmin, isAgent, isAdminAssistant, isAdminOrAssistant,
  getAllowedCompanies, getAllowedBanks, getAllowedUsers,
  verifyIsActive,
  canAccessTab, getAllowedTabs, generateAccountNumber,
  getUserAccountNumber, createAccountNumber, generateBankAccountNumber, createBankAccount,
  _state: AuthState,
};

window.AuthService = AuthService;
window.AuthState   = AuthState;   // مطلوب لـ LoginComponent._offlineLogin و OfflineAuthService
console.log('✅ AuthService.js v5.3 — createBankAccount: توليد internal_account_number تلقائياً عند الإنشاء');
