/**
 * services/SyncService.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * خدمة إدارة المزامنة الكاملة
 *
 * المسؤوليات:
 * - الاستماع لحدث online وتشغيل processQueue تلقائياً
 * - مزامنة الجداول الأساسية عند عودة الاتصال
 * - إدارة حالة المزامنة في AppStore
 * - إشعار المدير بالتعارضات
 * - جدولة مزامنة دورية (كل 5 دقائق)
 * - نشر إحصائيات الطابور لتحديث الهيدر
 */

'use strict';

// ============================================================
// الحالة الداخلية للخدمة
// ============================================================

const _syncState = {
  isRunning          : false,    // هل المزامنة تعمل حالياً؟
  lastSyncAt         : null,     // وقت آخر مزامنة ناجحة
  periodicTimer      : null,     // مؤقت المزامنة الدورية
  failedNotified     : new Set(),// IDs التعارضات التي أُشعر بها
};

// ============================================================
// 1. التهيئة الرئيسية
// ============================================================

/**
 * يُهيّئ خدمة المزامنة ويربط جميع المستمعين
 * يُستدعى مرة واحدة عند بدء التطبيق من App.js
 */
function initSyncService() {
  // الاستماع لحدث الاتصال (مُعرَّف في SupabaseClient.js)
  window.addEventListener('app:onlineStatusChange', _onOnlineStatusChange);

  // الاستماع لتغيرات حالة الطابور
  window.addEventListener('sync:queueCountChanged', _onQueueCountChanged);

  // الاستماع لاكتشاف تعارض جديد
  window.addEventListener('sync:conflict', _onConflictDetected);

  // الاستماع لاستبدال المعرف المؤقت
  window.addEventListener('sync:tempIdReplaced', _onTempIdReplaced);

  // مزامنة فورية إن كان هناك عمليات معلقة عند البدء
  if (isOnline()) {
    setTimeout(() => _triggerSync('startup'), 2000);
  }

  // جدولة مزامنة دورية كل 5 دقائق
  _schedulePeriodicSync();

  console.log('✅ SyncService: تم التهيئة وبدء الاستماع');
}

// ============================================================
// 2. معالج تغيير حالة الاتصال
// ============================================================

/**
 * يُشغَّل عند عودة الاتصال أو انقطاعه
 * @param {CustomEvent} event
 */
async function _onOnlineStatusChange(event) {
  const { online } = event.detail;

  // إعلام AppStore بحالة الاتصال
  window.dispatchEvent(new CustomEvent('store:setOnlineStatus', {
    detail: { online },
  }));

  if (online) {
    showToast('تم استعادة الاتصال — جاري المزامنة...', 'info', 2500);
    await sleep(800); // تأخير قصير لاستقرار الاتصال
    await _triggerSync('reconnect');
  } else {
    showToast('انقطع الاتصال — سيتم حفظ بياناتك محلياً', 'warning', 3000);
  }
}

// ============================================================
// 3. تشغيل المزامنة
// ============================================================

/**
 * يُشغّل دورة مزامنة كاملة
 * @param {string} [reason='manual'] - سبب التشغيل (للتتبع)
 * @returns {Promise<void>}
 */
async function _triggerSync(reason = 'manual') {
  if (_syncState.isRunning) {
    console.log(`ℹ️  SyncService: المزامنة جارية (طلب من: ${reason})`);
    return;
  }

  if (!isOnline()) {
    console.log('ℹ️  SyncService: غير متصل — تخطي المزامنة');
    return;
  }

  _syncState.isRunning = true;
  _notifyRunning(true);

  try {
    console.log(`🔄 SyncService: بدء المزامنة (${reason})...`);

    // 1. معالجة طابور المزامنة (العمليات المعلقة)
    const queueResult = await SyncQueue.processQueue();
    if (isOk(queueResult)) {
      const { processed, failed } = queueResult.data;
      if (processed > 0 || failed > 0) {
        console.log(`   ✓ طابور المزامنة: ${processed} ناجحة, ${failed} فاشلة`);
      }
    }

    // 2. مزامنة السجلات المعلقة في الجداول الأساسية
    await _syncPendingRecords();

    // 3. تحديث البيانات المحلية من Supabase (pull)
    if (reason === 'reconnect' || reason === 'startup') {
      await _pullFreshData();
    }

    // 4. التحقق من التعارضات الجديدة
    await _checkAndNotifyConflicts();

    _syncState.lastSyncAt = new Date().toISOString();
    console.log(`✅ SyncService: اكتملت المزامنة (${reason})`);

  } catch (e) {
    console.error('❌ SyncService._triggerSync():', e);
  } finally {
    _syncState.isRunning = false;
    _notifyRunning(false);
  }
}

// ============================================================
// 4. مزامنة السجلات المعلقة
// ============================================================

/**
 * يُزامن جميع الجداول التي قد تحتوي على سجلات معلقة
 * ✅ إصلاح: تخطي الجداول التي لها عمليات نشطة في SyncQueue
 * لمنع الازدواجية مع processQueue() والكتابة المزدوجة على Supabase
 */
async function _syncPendingRecords() {
  try {
    // جلب أسماء الجداول التي لها عمليات نشطة في الطابور
    const activeQueueItems = await db.sync_queue
      .where('sync_status')
      .anyOf(['pending', 'processing'])
      .toArray();

    const queuedTables = new Set(activeQueueItems.map(item => item.table_name));

    const tablesToSync = [
      TABLES.TRANSACTIONS,
      TABLES.FAILED_DEPOSITS,
      TABLES.DEBTORS,
      TABLES.NOTIFICATIONS,
    ];

    for (const table of tablesToSync) {
      // ✅ تخطي الجداول التي في الطابور — سيتولاها processQueue
      if (queuedTables.has(table)) {
        console.log(`   ⏭️  ${table}: تم التخطي (موجود في طابور المزامنة)`);
        continue;
      }

      try {
        const result = await repo.syncPendingOperations(table);
        if (isOk(result) && result.data.synced > 0) {
          console.log(`   ✓ ${table}: ${result.data.synced} سجل مُزامَن`);
        }
      } catch (e) {
        console.warn(`   ⚠️  فشل مزامنة ${table}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('⚠️  فشل _syncPendingRecords:', e.message);
  }
}

// ============================================================
// 5. جلب البيانات الحديثة من Supabase (Pull)
// ============================================================

/**
 * يجلب البيانات المحدثة حديثاً من Supabase بعد عودة الاتصال
 * يُحدّث الكاش المحلي فقط — لا يحذف شيئاً
 */
async function _pullFreshData() {
  try {
    const user = AuthService.getCurrentUser();
    if (!user) return;

    // جلب إشعارات جديدة لم تُقرأ بعد
    await _pullNotifications(user);

    // المدير والمساعد الإداري: جلب بيانات إضافية
    if (user.role === ROLES.ADMIN || user.role === ROLES.ADMIN_ASSISTANT) {
      await _pullBankAccounts();
      await _pullDebtors();
    }

    // المندوب: جلب عملياته للتاريخ الحالي
    if (user.role === ROLES.AGENT) {
      await _pullAgentTransactions(user.id);
    }

  } catch (e) {
    console.warn('⚠️  SyncService._pullFreshData():', e.message);
  }
}

async function _pullNotifications(user) {
  const { data } = await supabaseClient
    .from(TABLES.NOTIFICATIONS)
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);

  if (data && data.length > 0) {
    await db.notifications.bulkPut(data);
    window.dispatchEvent(new CustomEvent('store:notificationsUpdated', {
      detail: { count: data.length },
    }));
  }
}

async function _pullBankAccounts() {
  const { data } = await supabaseClient
    .from(TABLES.BANK_ACCOUNTS)
    .select('*')
    .order('name');

  if (data) {
    await db.bank_accounts.bulkPut(
      data.map(b => ({ ...b, sync_status: SYNC_STATUS.SYNCED }))
    );
  }
}

async function _pullDebtors() {
  const { data } = await supabaseClient
    .from(TABLES.DEBTORS)
    .select('*')
    .order('name');

  if (data) {
    await db.debtors.bulkPut(
      data.map(d => ({ ...d, sync_status: SYNC_STATUS.SYNCED }))
    );
  }
}

async function _pullAgentTransactions(agentId) {
  const today = getCurrentSaudiDate();
  const { data } = await supabaseClient
    .from(TABLES.TRANSACTIONS)
    .select('*')
    .eq('agent_id', agentId)
    .gte('date', today)
    .order('created_at', { ascending: false });

  if (data) {
    await db.transactions.bulkPut(
      data.map(tx => ({ ...tx, sync_status: SYNC_STATUS.SYNCED }))
    );
  }
}

// ============================================================
// 6. التحقق من التعارضات وإشعار المدير
// ============================================================

/**
 * يجلب التعارضات غير المحلولة ويُشعر المدير بها
 */
async function _checkAndNotifyConflicts() {
  try {
    const conflicts = await SyncQueue.getUnresolvedConflicts();
    if (conflicts.length === 0) return;

    const newConflicts = conflicts.filter(c => !_syncState.failedNotified.has(c.id));
    if (newConflicts.length === 0) return;

    for (const conflict of newConflicts) {
      _syncState.failedNotified.add(conflict.id);
    }

    // تحديث AppStore بعدد التعارضات
    window.dispatchEvent(new CustomEvent('store:conflictsUpdated', {
      detail: { count: conflicts.length, conflicts },
    }));

    showToast(
      `يوجد ${newConflicts.length} تعارض في المزامنة يحتاج مراجعة المدير`,
      'warning',
      6000
    );

  } catch (e) {
    console.warn('⚠️  فشل التحقق من التعارضات:', e.message);
  }
}

// ============================================================
// 7. معالجات الأحداث
// ============================================================

/**
 * عند تغيير عدد عمليات الطابور
 */
function _onQueueCountChanged(event) {
  const { count } = event.detail;
  window.dispatchEvent(new CustomEvent('store:updateSyncQueueLength', {
    detail: { count },
  }));
}

/**
 * عند اكتشاف تعارض جديد
 */
async function _onConflictDetected(event) {
  const { item, reason } = event.detail;

  // إشعار داخل النظام للمدير
  if (AuthService.isAdmin()) {
    showToast(
      `تعارض في المزامنة — ${DEXIE_TABLES[item?.table_name?.toUpperCase()] || item?.table_name} يحتاج مراجعة`,
      'warning',
      8000
    );
  }

  window.dispatchEvent(new CustomEvent('store:conflictAdded', {
    detail: { item, reason },
  }));
}

/**
 * عند استبدال TEMP_id بالمعرف الحقيقي
 */
function _onTempIdReplaced(event) {
  const { tempId, realId, table } = event.detail;
  window.dispatchEvent(new CustomEvent('store:tempIdReplaced', {
    detail: { tempId, realId, table },
  }));
}

// ============================================================
// 8. المزامنة الدورية
// ============================================================

/**
 * يجدول مزامنة تلقائية كل 5 دقائق
 */
function _schedulePeriodicSync() {
  if (_syncState.periodicTimer) {
    clearInterval(_syncState.periodicTimer);
  }

  const INTERVAL_MS = 5 * 60 * 1000; // 5 دقائق

  _syncState.periodicTimer = setInterval(async () => {
    if (isOnline() && !_syncState.isRunning) {
      const stats = await SyncQueue.getStats();
      if (isOk(stats) && stats.data.pending > 0) {
        await _triggerSync('periodic');
      }
    }
  }, INTERVAL_MS);
}

// ============================================================
// 9. إشعار AppStore بحالة التشغيل
// ============================================================

function _notifyRunning(running) {
  window.dispatchEvent(new CustomEvent('store:syncRunning', {
    detail: { running, lastSyncAt: _syncState.lastSyncAt },
  }));
}

// ============================================================
// 10. API العامة للخدمة
// ============================================================

/**
 * يُشغّل مزامنة يدوية (يُستدعى من زر المزامنة في الهيدر)
 * @returns {Promise<void>}
 */
async function manualSync() {
  if (!isOnline()) {
    showToast('لا يوجد اتصال بالإنترنت', 'warning');
    return;
  }
  showToast('جاري المزامنة...', 'info', 1500);
  await _triggerSync('manual');
  showToast('تمت المزامنة بنجاح', 'success');
}

/**
 * يحل تعارضاً يدوياً (يُستدعى من واجهة حل التعارضات)
 * @param {number} conflictId
 * @param {'server'|'client'} resolution
 * @returns {Promise<{ok: boolean}>}
 */
async function resolveConflict(conflictId, resolution) {
  const result = await SyncQueue.resolveConflict(conflictId, resolution);
  if (isOk(result)) {
    _syncState.failedNotified.delete(conflictId);
    await _checkAndNotifyConflicts();
    showToast('تم حل التعارض بنجاح', 'success');
  } else {
    showToast(`فشل حل التعارض: ${result.error}`, 'error');
  }
  return result;
}

/**
 * يُعيد إحصائيات المزامنة الحالية
 * @returns {Promise<object>}
 */
async function getSyncStats() {
  const stats = await SyncQueue.getStats();
  return {
    ...(isOk(stats) ? stats.data : {}),
    isRunning    : _syncState.isRunning,
    lastSyncAt   : _syncState.lastSyncAt,
    isOnline     : isOnline(),
  };
}

/**
 * يُوقف خدمة المزامنة (عند تسجيل الخروج)
 */
function stopSyncService() {
  if (_syncState.periodicTimer) {
    clearInterval(_syncState.periodicTimer);
    _syncState.periodicTimer = null;
  }

  window.removeEventListener('app:onlineStatusChange',  _onOnlineStatusChange);
  window.removeEventListener('sync:queueCountChanged',  _onQueueCountChanged);
  window.removeEventListener('sync:conflict',           _onConflictDetected);
  window.removeEventListener('sync:tempIdReplaced',     _onTempIdReplaced);

  _syncState.isRunning  = false;
  _syncState.failedNotified.clear();

  console.log('🛑 SyncService: تم الإيقاف');
}

// ============================================================
// تصدير الخدمة
// ============================================================

const SyncService = {
  init           : initSyncService,
  stop           : stopSyncService,
  manualSync,
  resolveConflict,
  getSyncStats,
  // للاستخدام الداخلي
  _triggerSync,
};

window.SyncService = SyncService;

console.log('✅ SyncService.js محمّل — خدمة المزامنة جاهزة');
