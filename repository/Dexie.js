/**
 * repository/Dexie.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * قاعدة البيانات المحلية (IndexedDB) باستخدام Dexie.js
 *
 * المسؤوليات:
 * - إنشاء قاعدة Dexie وتعريف جميع الجداول والفهارس
 * - تهيئة البيانات الأولية (seed)
 * - تنظيف البيانات القديمة تلقائياً عند بدء التطبيق
 * - مراقبة حجم التخزين وتنبيه المدير عند الاقتراب من الحد
 *
 * القواعد:
 * - لا eval() / Function() مطلقاً
 * - جميع العمليات async/await
 * - Result pattern للأخطاء
 */

'use strict';

// ============================================================
// إنشاء قاعدة Dexie
// ============================================================

const db = new Dexie(DEXIE_CONFIG.DB_NAME);

/**
 * تعريف مخطط قاعدة البيانات المحلية
 * الرقم 1 = إصدار المخطط (يُزاد عند تغيير الهيكل)
 *
 * الفهارس المُعرَّفة:
 * - ++ = auto-increment primary key
 * - & = unique index
 * - * = multi-entry index (للمصفوفات)
 * - [a+b] = compound index
 */
db.version(DEXIE_CONFIG.DB_VERSION).stores({

  // -------------------------------------------------------
  // المعاملات المالية — الجدول الأكثر استخداماً
  // -------------------------------------------------------
  transactions: [
    'id',           // Primary Key (UUID أو TEMP_)
    'date',         // للفلترة حسب التاريخ
    'type',         // نوع العملية
    'agent_id',     // المندوب
    'sync_status',  // حالة المزامنة
    '[date+agent_id]',       // فهرس مركب: ملخص يومي للمندوب
    '[date+type]',           // فهرس مركب: فلترة حسب التاريخ والنوع
    'bank_account_id',       // الحساب البنكي
    'created_at',            // للترتيب الزمني
  ].join(','),

  // -------------------------------------------------------
  // المستخدمون
  // -------------------------------------------------------
  users: [
    'id',
    'username',
    'role',
    'is_active','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // الحسابات البنكية
  // -------------------------------------------------------
  bank_accounts: [
    'id',
    'company_id',
    'name','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // الشركات
  // -------------------------------------------------------
  companies: [
    'id',
    'account_prefix','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // حسابات المصروفات الفرعية
  // -------------------------------------------------------
  expense_accounts: [
    'id',
    'code','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // العملاء المديونون
  // -------------------------------------------------------
  debtors: [
    'id',
    'name','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // الإيداعات الفاشلة
  // -------------------------------------------------------
  failed_deposits: [
    'id',
    'agent_id',
    'status',
    'date','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // الإشعارات
  // -------------------------------------------------------
  notifications: [
    'id',
    'created_at',
    'type','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // سجل التدقيق
  // -------------------------------------------------------
  audit_logs: [
    'id',
    'timestamp',
    'user_id',
    'record_type','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // دفتر الأستاذ المحاسبي
  // -------------------------------------------------------
  account_ledger: [
    'id',
    'account_id',
    'date',
    'reference_id',
    '[account_id+date]','sync_status'
  ].join(','),

  // -------------------------------------------------------
  // الأرصدة التراكمية
  // -------------------------------------------------------
  account_balances: [
    'account_id',   // Primary Key (نص)
    'last_updated',
  ].join(','),

  // -------------------------------------------------------
  // الإقفالات اليومية
  // -------------------------------------------------------
  daily_closings: [
    'id',
    '&date','sync_status' 
    // فريد: إقفال واحد فقط في اليوم
  ].join(','),

  // -------------------------------------------------------
  // إعدادات النظام
  // -------------------------------------------------------
  system_settings: [
    'key',          // Primary Key
  ].join(','),

  // -------------------------------------------------------
  // طابور المزامنة (Sync Queue)
  // العمليات المعلقة التي تنتظر الإرسال لـ Supabase
  // -------------------------------------------------------
  sync_queue: [
    '++id',         // auto-increment
    'action',       // create | update | delete | batch
    'table_name',   // اسم الجدول المستهدف
    'record_id',    // معرف السجل (قد يكون TEMP_)
    'sync_status',  // pending | processing | failed
    'retries',      // عدد المحاولات
    'created_at',   // لترتيب FIFO
    'last_retry_at',
  ].join(','),

  // -------------------------------------------------------
  // سجل التعارضات (Sync Conflicts)
  // التعارضات التي تحتاج تدخل يدوي من المدير
  // -------------------------------------------------------
  sync_conflicts: [
    '++id',
    'operation_id', // مرجع إلى sync_queue
    'table_name',
    'record_id',
    'resolution',   // null | server | client
    'created_at',
  ].join(','),

  // -------------------------------------------------------
  // بيانات التخزين المؤقت (Cache Metadata)
  // -------------------------------------------------------
  cache_meta: [
    'key',          // مفتاح فريد للكاش
    'expires_at',   // وقت انتهاء الصلاحية
    'updated_at',
  ].join(','),

});

// ============================================================
// إصدار 2: إضافة جدول offline_sessions (Phase 2B)
// ============================================================

db.version(2).stores({
  // جلسات Offline: PIN hash + WebAuthn credential ID
  offline_sessions: 'id, user_id, device_id, is_active, [user_id+device_id]',
});

// ============================================================
// إصدار 3: إضافة user_beneficiaries للعمل دون اتصال
// ============================================================
db.version(3).stores({
  user_beneficiaries: 'id, user_id, beneficiary_id, beneficiary_type, [user_id+beneficiary_type]',
});

// ============================================================
// إصدار 4 (Phase 3): إضافة idempotency_key + local_timestamp
// - sync_queue: فهرسة idempotency_key (تجنّب التكرار) و local_timestamp (FIFO)
// - transactions: فهرسة idempotency_key (مطابقة مع id في المسارات الجديدة)
// ============================================================
db.version(4).stores({
  sync_queue: [
    '++id',
    'action',
    'table_name',
    'record_id',
    'idempotency_key',
    'sync_status',
    'retries',
    'created_at',
    'last_retry_at',
    'local_timestamp',
  ].join(','),
  transactions: [
    'id',
    'date',
    'type',
    'agent_id',
    'sync_status',
    'idempotency_key',
    '[date+agent_id]',
    '[date+type]',
    'bank_account_id',
    'created_at',
  ].join(','),
});

// ============================================================
// إصدار 5: تحديث فهرس failed_deposits لإضافة bank_account_id
// ============================================================
db.version(5).stores({
  failed_deposits: 'id, agent_id, bank_account_id, status, date, sync_status',
});

// ============================================================
// معالج الخطأ العام لـ Dexie
// ============================================================

db.on('blocked', () => {
  console.warn('⚠️  قاعدة البيانات المحلية محجوبة — يُرجى إغلاق النوافذ الأخرى للنظام');
  showToast('قاعدة البيانات محجوبة. أغلق النوافذ الأخرى وأعد تحميل الصفحة.', 'warning', 8000);
});

db.on('versionchange', () => {
  db.close();
  showToast('تم تحديث قاعدة البيانات. سيتم إعادة تحميل الصفحة.', 'info', 3000);
  setTimeout(() => window.location.reload(), 3000);
});

// ============================================================
// وظائف تهيئة وفتح قاعدة البيانات
// ============================================================

/**
 * يفتح قاعدة البيانات ويتحقق من سلامتها
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function initDexie() {
  try {
    await db.open();
    console.log(`✅ Dexie مفتوحة — الإصدار ${db.verno}`);
    return ok(true);
  } catch (e) {
    console.error('❌ فشل فتح Dexie:', e);
    return err(`فشل فتح قاعدة البيانات المحلية: ${e.message}`);
  }
}

/**
 * يغلق قاعدة البيانات بأمان
 */
function closeDexie() {
  try {
    if (db.isOpen()) {
      db.close();
      console.log('✅ Dexie مغلقة');
    }
  } catch (e) {
    console.error('خطأ عند إغلاق Dexie:', e);
  }
}

// ============================================================
// تنظيف البيانات القديمة (Data Cleanup)
// يُشغَّل عند بدء التطبيق
// ============================================================

/**
 * يحذف المعاملات الأقدم من STALE_DAYS يوماً (90 يوماً افتراضياً)
 * مع استثناء السجلات غير المتزامنة بعد
 * @returns {Promise<{ok: boolean, deleted: number}>}
 */
async function cleanStaleTransactions() {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CACHE_CONFIG.STALE_DAYS);
    const cutoffStr = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD

    const staleIds = await db.transactions
      .where('date')
      .below(cutoffStr)
      .and(tx => tx.sync_status === SYNC_STATUS.SYNCED)
      .primaryKeys();

    if (staleIds.length > 0) {
      await db.transactions.bulkDelete(staleIds);
      console.log(`🧹 حُذف ${staleIds.length} معاملة قديمة من الكاش المحلي`);
    }

    return ok({ deleted: staleIds.length });
  } catch (e) {
    console.error('خطأ في تنظيف المعاملات القديمة:', e);
    return err(e.message);
  }
}

/**
 * يحذف عمليات sync_queue التي تجاوز عمرها STALE_QUEUE_DAYS يوماً (30 يوماً)
 * هذه العمليات تعتبر منسية ولن تنجح
 * @returns {Promise<{ok: boolean, deleted: number}>}
 */
async function cleanStaleQueueItems() {
  try {
    const BATCH_SIZE = 100;
    const cutoff     = new Date(Date.now() - SYNC_CONFIG.STALE_QUEUE_DAYS * 24 * 60 * 60 * 1000).toISOString();

    const stale = await db.sync_queue
      .where('created_at')
      .below(cutoff)
      .and(item => item.sync_status === SYNC_STATUS.CONFLICT || item.retries >= SYNC_CONFIG.MAX_RETRIES)
      .limit(BATCH_SIZE)
      .toArray();

    if (stale.length > 0) {
      await db.sync_queue.bulkDelete(stale.map(i => i.id));
      console.log(`🧹 حُذف ${stale.length} عملية قديمة فاشلة من طابور المزامنة`);
    }

    return ok({ deleted: stale.length });
  } catch (e) {
    console.error('خطأ في تنظيف طابور المزامنة القديم:', e);
    return err(e.message);
  }
}

/**
 * يراقب حجم قاعدة IndexedDB ويُحذر عند الاقتراب من الحد
 * الحد الأقصى: CACHE_CONFIG.MAX_STORAGE_MB (50 ميجابايت)
 * @returns {Promise<{ok: boolean, usageMB: number, isNearLimit: boolean}>}
 */
async function checkStorageQuota() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) {
      return ok({ usageMB: 0, isNearLimit: false });
    }

    const estimate = await navigator.storage.estimate();
    const usageMB  = (estimate.usage || 0) / (1024 * 1024);
    const limitMB  = CACHE_CONFIG.MAX_STORAGE_MB;
    const isNearLimit = usageMB >= limitMB * 0.85; // 85% = تحذير

    if (isNearLimit) {
      console.warn(`⚠️  التخزين المحلي: ${usageMB.toFixed(1)} MB / ${limitMB} MB`);
      showToast(
        `تنبيه: التخزين المحلي وصل إلى ${usageMB.toFixed(1)} MB. يُنصح بمزامنة البيانات.`,
        'warning',
        8000
      );
    }

    return ok({ usageMB, isNearLimit });
  } catch (e) {
    return ok({ usageMB: 0, isNearLimit: false });
  }
}

/**
 * ينفذ جميع عمليات التنظيف دفعة واحدة عند بدء التطبيق
 * @returns {Promise<void>}
 */
async function runStartupCleanup() {
  console.log('🧹 بدء تنظيف البيانات القديمة...');

  const [txResult, queueResult, storageResult] = await Promise.allSettled([
    cleanStaleTransactions(),
    cleanStaleQueueItems(),
    checkStorageQuota(),
  ]);

  if (txResult.status === 'fulfilled' && isOk(txResult.value)) {
    const { deleted } = txResult.value.data;
    if (deleted > 0) console.log(`  ✓ حُذف ${deleted} معاملة قديمة`);
  }

  if (queueResult.status === 'fulfilled' && isOk(queueResult.value)) {
    const { deleted } = queueResult.value.data;
    if (deleted > 0) console.log(`  ✓ حُذف ${deleted} عملية من الطابور`);
  }

  if (storageResult.status === 'fulfilled' && isOk(storageResult.value)) {
    const { usageMB } = storageResult.value.data;
    console.log(`  ✓ حجم التخزين المحلي: ${usageMB.toFixed(2)} MB`);
  }

  console.log('✅ اكتمل تنظيف البيانات');
}

// ============================================================
// دوال مساعدة لقراءة/كتابة الكاش
// ============================================================

/**
 * يتحقق هل مفتاح الكاش لا يزال صالحاً
 * @param {string} key
 * @returns {Promise<boolean>}
 */
async function isCacheValid(key) {
  try {
    const meta = await db.cache_meta.get(key);
    if (!meta) return false;
    return new Date(meta.expires_at) > new Date();
  } catch {
    return false;
  }
}

/**
 * يُسجّل مفتاح كاش مع وقت انتهاء صلاحيته
 * @param {string} key
 * @param {number} [ttlMinutes] - مدة الصلاحية بالدقائق
 * @returns {Promise<void>}
 */
async function setCacheMeta(key, ttlMinutes = CACHE_CONFIG.TTL_MINUTES) {
  try {
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    await db.cache_meta.put({ key, expires_at: expiresAt, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('تحذير: فشل تسجيل بيانات الكاش:', e);
  }
}

/**
 * يُبطل مفتاح كاش محدد (يُستخدم عند تعديل أو حذف بيانات)
 * @param {string} key
 * @returns {Promise<void>}
 */
async function invalidateCache(key) {
  try {
    await db.cache_meta.delete(key);
  } catch { /* تجاهل */ }
}

/**
 * يُبطل جميع مفاتيح الكاش التي تبدأ بـ prefix
 * @param {string} prefix
 * @returns {Promise<void>}
 */
async function invalidateCacheByPrefix(prefix) {
  try {
    const keys = await db.cache_meta
      .where('key')
      .startsWith(prefix)
      .primaryKeys();
    if (keys.length > 0) {
      await db.cache_meta.bulkDelete(keys);
    }
  } catch { /* تجاهل */ }
}

// ============================================================
// دوال مساعدة للجداول الأساسية
// ============================================================

/**
 * يجلب جميع المستخدمين من الكاش المحلي
 * @returns {Promise<Array>}
 */
async function getLocalUsers() {
  try {
    return await db.users.toArray();
  } catch {
    return [];
  }
}

/**
 * يجلب مستخدماً بمعرفه من الكاش المحلي
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getLocalUser(id) {
  try {
    return await db.users.get(id) || null;
  } catch {
    return null;
  }
}

/**
 * يجلب جميع الشركات من الكاش المحلي
 * @returns {Promise<Array>}
 */
async function getLocalCompanies() {
  try {
    return await db.companies.toArray();
  } catch {
    return [];
  }
}

/**
 * يجلب جميع حسابات المصروفات من الكاش المحلي
 * @returns {Promise<Array>}
 */
async function getLocalExpenseAccounts() {
  try {
    return await db.expense_accounts.toArray();
  } catch {
    return [];
  }
}

/**
 * يجلب جميع الحسابات البنكية من الكاش المحلي
 * @returns {Promise<Array>}
 */
async function getLocalBankAccounts() {
  try {
    return await db.bank_accounts.toArray();
  } catch {
    return [];
  }
}

/**
 * يجلب المعاملات لتاريخ ومندوب محدد من الكاش المحلي
 * @param {string} date - YYYY-MM-DD
 * @param {string} [agentId] - معرف المندوب (اختياري)
 * @returns {Promise<Array>}
 */
async function getLocalTransactionsByDate(date, agentId = null) {
  try {
    let collection;
    if (agentId) {
      collection = db.transactions.where('[date+agent_id]').equals([date, agentId]);
    } else {
      collection = db.transactions.where('date').equals(date);
    }
    return await collection.toArray();
  } catch {
    return [];
  }
}

/**
 * يجلب رصيد حساب محاسبي من الكاش المحلي
 * @param {string} accountId - مثل AGT_uuid
 * @returns {Promise<number>}
 */
async function getLocalAccountBalance(accountId) {
  try {
    const record = await db.account_balances.get(accountId);
    return record ? parseFloat(record.balance) : 0;
  } catch {
    return 0;
  }
}

/**
 * يُحدّث رصيد حساب محاسبي في الكاش المحلي
 * @param {string} accountId
 * @param {number} newBalance
 * @returns {Promise<void>}
 */
async function setLocalAccountBalance(accountId, newBalance) {
  try {
    await db.account_balances.put({
      account_id   : accountId,
      balance      : newBalance,
      last_updated : new Date().toISOString(),
    });
  } catch (e) {
    console.error('خطأ في تحديث الرصيد المحلي:', e);
  }
}

/**
 * يجلب جميع إعدادات النظام من الكاش المحلي كـ Map
 * @returns {Promise<Map<string, any>>}
 */
async function getLocalSettings() {
  try {
    const all = await db.system_settings.toArray();
    const map = new Map();
    all.forEach(s => map.set(s.key, s.value));
    return map;
  } catch {
    return new Map();
  }
}

/**
 * يُحدّث إعداداً واحداً في الكاش المحلي
 * @param {string} key
 * @param {*} value
 * @returns {Promise<void>}
 */
async function setLocalSetting(key, value) {
  try {
    await db.system_settings.put({ key, value, updated_at: new Date().toISOString() });
  } catch (e) {
    console.error('خطأ في حفظ الإعداد محلياً:', e);
  }
}

// ============================================================
// إحصائيات قاعدة البيانات المحلية (للتشخيص)
// ============================================================

/**
 * يجلب إحصائيات عدد السجلات في كل جدول
 * @returns {Promise<object>}
 */
async function getDexieStats() {
  try {
    const [
      txCount,
      usersCount,
      bankCount,
      debtorsCount,
      queueCount,
      conflictsCount,
    ] = await Promise.all([
      db.transactions.count(),
      db.users.count(),
      db.bank_accounts.count(),
      db.debtors.count(),
      db.sync_queue.count(),
      db.sync_conflicts.count(),
    ]);

    return {
      transactions   : txCount,
      users          : usersCount,
      bank_accounts  : bankCount,
      debtors        : debtorsCount,
      sync_queue     : queueCount,
      sync_conflicts : conflictsCount,
    };
  } catch (e) {
    console.error('خطأ في جلب إحصائيات Dexie:', e);
    return {};
  }
}

// ============================================================
// تصدير للاستخدام في Repository.js وبقية الملفات
// ============================================================

window.db                       = db;
window.initDexie                = initDexie;
window.closeDexie               = closeDexie;
window.runStartupCleanup        = runStartupCleanup;
window.isCacheValid             = isCacheValid;
window.setCacheMeta             = setCacheMeta;
window.invalidateDexieCache     = invalidateCache;
window.invalidateCacheByPrefix  = invalidateCacheByPrefix;
window.getLocalUsers            = getLocalUsers;
window.getLocalUser             = getLocalUser;
window.getLocalCompanies        = getLocalCompanies;
window.getLocalExpenseAccounts  = getLocalExpenseAccounts;
window.getLocalBankAccounts     = getLocalBankAccounts;
window.getLocalTransactionsByDate = getLocalTransactionsByDate;
window.getLocalAccountBalance   = getLocalAccountBalance;
window.setLocalAccountBalance   = setLocalAccountBalance;
window.getLocalSettings         = getLocalSettings;
window.setLocalSetting          = setLocalSetting;
window.getDexieStats            = getDexieStats;

console.log('✅ Dexie.js محمّل — قاعدة البيانات المحلية جاهزة');
