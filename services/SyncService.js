/**
 * services/SyncService.js — v2.0 (Online-First)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * التغييرات وفق التوثيق:
 * ✅ مؤقت المزامنة الدورية: 30 ثانية (بدلاً من 5 دقائق)
 *    لكنه يعمل فقط إذا كان هناك عمليات معلقة (لا يُثقل النظام)
 */
'use strict';

const _syncState = {
  isRunning        : false,
  lastSyncAt       : null,
  periodicTimer    : null,
  failedNotified   : new Set(),
};

function initSyncService() {
  window.addEventListener('app:onlineStatusChange', _onOnlineStatusChange);
  window.addEventListener('sync:queueCountChanged', _onQueueCountChanged);
  window.addEventListener('sync:conflict',          _onConflictDetected);
  window.addEventListener('sync:tempIdReplaced',    _onTempIdReplaced);

  if (isOnline()) {
    setTimeout(() => _triggerSync('startup'), 2000);
  }

  _schedulePeriodicSync();
  console.log('✅ SyncService v2.0: تم التهيئة');
}

async function _onOnlineStatusChange(event) {
  const { online } = event.detail;
  window.dispatchEvent(new CustomEvent('store:setOnlineStatus', { detail: { online } }));

  if (online) {
    showToast('تم استعادة الاتصال — جاري المزامنة...', 'info', 2500);
    await sleep(800);
    await _triggerSync('reconnect');
  } else {
    showToast('انقطع الاتصال — سيتم حفظ بياناتك محلياً', 'warning', 3000);
  }
}

async function _triggerSync(reason = 'manual') {
  if (_syncState.isRunning) return;
  if (!isOnline()) return;

  _syncState.isRunning = true;
  _notifyRunning(true);

  try {
    console.log(`🔄 SyncService: مزامنة (${reason})...`);

    const queueResult = await SyncQueue.processQueue();
    if (isOk(queueResult)) {
      const { processed, failed } = queueResult.data;
      if (processed > 0 || failed > 0)
        console.log(`   ✓ طابور: ${processed} ناجحة, ${failed} فاشلة`);
    }

    await _syncPendingRecords();

    if (reason === 'reconnect' || reason === 'startup') {
      await _pullFreshData();
    }

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

async function _syncPendingRecords() {
  try {
    if (!db.isOpen()) return; // Dexie قد لا تكون متاحة

    const activeQueueItems = await db.sync_queue
      .where('sync_status').anyOf(['pending', 'processing']).toArray();
    const queuedTables = new Set(activeQueueItems.map(item => item.table_name));

    const tablesToSync = [
      TABLES.TRANSACTIONS,
      TABLES.FAILED_DEPOSITS,
      TABLES.DEBTORS,
      TABLES.NOTIFICATIONS,
    ];

    for (const table of tablesToSync) {
      if (queuedTables.has(table)) { console.log(`   ⏭️  ${table}: تخطي`); continue; }
      try {
        const result = await repo.syncPendingOperations(table);
        if (isOk(result) && result.data.synced > 0)
          console.log(`   ✓ ${table}: ${result.data.synced} سجل`);
      } catch (e) {
        console.warn(`   ⚠️  ${table}:`, e.message);
      }
    }
  } catch (e) {
    console.warn('⚠️  _syncPendingRecords:', e.message);
  }
}

async function _pullFreshData() {
  try {
    const user = AuthService.getCurrentUser();
    if (!user) return;

    await _pullNotifications(user);

    if (user.role === ROLES.ADMIN || user.role === ROLES.ADMIN_ASSISTANT) {
      await _pullBankAccounts();
      await _pullDebtors();
    }

    if (user.role === ROLES.AGENT) {
      await _pullAgentTransactions(user.id);
    }
  } catch (e) {
    console.warn('⚠️  _pullFreshData:', e.message);
  }
}

async function _pullNotifications(user) {
  try {
    const { data } = await supabaseClient
      .from(TABLES.NOTIFICATIONS)
      .select('*').order('created_at', { ascending: false }).limit(50);
    if (data && data.length > 0 && db.isOpen()) {
      await db.notifications.bulkPut(data);
      window.dispatchEvent(new CustomEvent('store:notificationsUpdated', { detail: { count: data.length } }));
    }
  } catch { /* تجاهل */ }
}

async function _pullBankAccounts() {
  try {
    const { data } = await supabaseClient.from(TABLES.BANK_ACCOUNTS).select('*').order('name');
    if (data && db.isOpen()) {
      await db.bank_accounts.bulkPut(data.map(b => ({ ...b, sync_status: SYNC_STATUS.SYNCED })));
    }
  } catch { /* تجاهل */ }
}

async function _pullDebtors() {
  try {
    const { data } = await supabaseClient.from(TABLES.DEBTORS).select('*').order('name');
    if (data && db.isOpen()) {
      await db.debtors.bulkPut(data.map(d => ({ ...d, sync_status: SYNC_STATUS.SYNCED })));
    }
  } catch { /* تجاهل */ }
}

async function _pullAgentTransactions(agentId) {
  try {
    const today = getCurrentSaudiDate();
    const { data } = await supabaseClient
      .from(TABLES.TRANSACTIONS).select('*')
      .eq('agent_id', agentId).gte('date', today)
      .order('created_at', { ascending: false });
    if (data && db.isOpen()) {
      await db.transactions.bulkPut(data.map(tx => ({ ...tx, sync_status: SYNC_STATUS.SYNCED })));
    }
  } catch { /* تجاهل */ }
}

async function _checkAndNotifyConflicts() {
  try {
    if (!db.isOpen()) return;
    const conflicts = await SyncQueue.getUnresolvedConflicts();
    if (!conflicts.length) return;

    const newConflicts = conflicts.filter(c => !_syncState.failedNotified.has(c.id));
    if (!newConflicts.length) return;

    newConflicts.forEach(c => _syncState.failedNotified.add(c.id));
    window.dispatchEvent(new CustomEvent('store:conflictsUpdated', { detail: { count: conflicts.length, conflicts } }));
    showToast(`يوجد ${newConflicts.length} تعارض في المزامنة يحتاج مراجعة`, 'warning', 6000);
  } catch { /* تجاهل */ }
}

// ✅ مؤقت دوري 30 ثانية — يعمل فقط عند وجود عمليات معلقة
function _schedulePeriodicSync() {
  if (_syncState.periodicTimer) clearInterval(_syncState.periodicTimer);

  const INTERVAL_MS = 30 * 1000; // 30 ثانية

  _syncState.periodicTimer = setInterval(async () => {
    if (!isOnline() || _syncState.isRunning) return;
    try {
      if (!db.isOpen()) return;

      // تنظيف failedNotified عند تجاوز 500 عنصر لمنع تسرب الذاكرة
      if (_syncState.failedNotified.size > 500) {
        _syncState.failedNotified.clear();
      }

      const stats = await SyncQueue.getStats();
      if (isOk(stats) && stats.data.pending > 0) {
        console.log(`⏰ SyncService: مزامنة دورية — ${stats.data.pending} عملية معلقة`);
        await _triggerSync('periodic');
      }
    } catch { /* تجاهل */ }
  }, INTERVAL_MS);
}

function _onQueueCountChanged(event) {
  window.dispatchEvent(new CustomEvent('store:updateSyncQueueLength', { detail: { count: event.detail.count } }));
}

function _onConflictDetected(event) {
  const { item, reason } = event.detail;
  if (AuthService.isAdmin()) {
    showToast(`تعارض في المزامنة — ${item?.table_name || ''} يحتاج مراجعة`, 'warning', 8000);
  }
  window.dispatchEvent(new CustomEvent('store:conflictAdded', { detail: { item, reason } }));
}

function _onTempIdReplaced(event) {
  window.dispatchEvent(new CustomEvent('store:tempIdReplaced', { detail: event.detail }));
}

function _notifyRunning(running) {
  window.dispatchEvent(new CustomEvent('store:syncRunning', { detail: { running, lastSyncAt: _syncState.lastSyncAt } }));
}

async function manualSync() {
  if (!isOnline()) { showToast('لا يوجد اتصال بالإنترنت', 'warning'); return; }
  showToast('جاري المزامنة...', 'info', 1500);
  await _triggerSync('manual');
  showToast('تمت المزامنة بنجاح', 'success');
}

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

async function getSyncStats() {
  const stats = await SyncQueue.getStats();
  return {
    ...(isOk(stats) ? stats.data : {}),
    isRunning  : _syncState.isRunning,
    lastSyncAt : _syncState.lastSyncAt,
    isOnline   : isOnline(),
  };
}

function stopSyncService() {
  if (_syncState.periodicTimer) { clearInterval(_syncState.periodicTimer); _syncState.periodicTimer = null; }
  window.removeEventListener('app:onlineStatusChange', _onOnlineStatusChange);
  window.removeEventListener('sync:queueCountChanged', _onQueueCountChanged);
  window.removeEventListener('sync:conflict',          _onConflictDetected);
  window.removeEventListener('sync:tempIdReplaced',    _onTempIdReplaced);
  _syncState.isRunning = false;
  _syncState.failedNotified.clear();
  console.log('🛑 SyncService: تم الإيقاف');
}

const SyncService = {
  init           : initSyncService,
  stop           : stopSyncService,
  manualSync,
  resolveConflict,
  getSyncStats,
  _triggerSync,
};

window.SyncService = SyncService;
console.log('✅ SyncService.js v2.0 — مزامنة دورية كل 30 ثانية عند وجود عمليات معلقة');
