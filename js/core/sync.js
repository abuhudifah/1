// ==========================================
// sync.js - المزامنة (Outbox + Realtime)
// ==========================================

import {
  getTableRows,
  setTableRows,
  cacheTable,
  loadTableRows,
  loadRecordsWindow,
  getDefaultRecordWindowFilters,
  syncRecordViewRow,
  removeRecordFromView,
  mergeCachedRows
} from './repository.js';

function getSupabaseClient() {
  return typeof window !== 'undefined' ? (window.supabaseClient || null) : null;
}

function getLocalDB() {
  return typeof window !== 'undefined' ? (window.App?.db || null) : null;
}

function ensureApp() {
  if (typeof window === 'undefined') return null;
  window.App = window.App || {};
  return window.App;
}

function scheduleUiRefresh(tabId = 'data-entry', reason = 'sync') {
  const payload = { tabId, reason };
  if (typeof window.queueRefreshUI === 'function') {
    window.queueRefreshUI(payload);
    return;
  }
  if (typeof window.refreshUI === 'function') {
    window.refreshUI(payload).catch?.(() => {});
  }
}

export async function flushOutbox() {
  const app = ensureApp();
  const localDB = getLocalDB();
  const supabaseClient = getSupabaseClient();

  const isOnline = window.navigator.onLine && app?.supabaseHealthy !== false;
  if (!isOnline || app?.syncing) return;
  if (!localDB?.outbox || !supabaseClient?.from) return;

  app.syncing = true;
  let processed = 0;

  try {
    const entries = await localDB.outbox.orderBy('created_at').toArray();

    for (const entry of entries) {
      const table = entry.table_name;

      try {
        if (entry.operation_type === 'delete') {
          const { error } = await supabaseClient
            .from(table)
            .update({ deleted_at: new Date().toISOString() })
            .eq('id', entry.target_id);
          if (error) throw error;
        } else if (entry.operation_type === 'update') {
          const payload = normalizeTableRow(table, entry.payload || { id: entry.target_id });
          const { error } = await supabaseClient
            .from(table)
            .update(payload)
            .eq('id', entry.target_id);
          if (error) throw error;
        } else {
          const payload = normalizeTableRow(table, entry.payload || { id: entry.target_id });
          const { error } = await supabaseClient
            .from(table)
            .upsert(payload, { onConflict: 'id' });
          if (error) throw error;
        }

        await localDB.outbox.delete(entry.op_uuid);
        processed++;
      } catch (entryError) {
        console.warn('⚠️ فشلت مزامنة عملية:', entry.op_uuid, entryError);
      }
    }

    if (processed > 0) {
      scheduleUiRefresh('data-entry', 'flush-outbox');
    }
  } catch (error) {
    console.warn('❌ فشل تفريغ طابور المزامنة:', error);
  } finally {
    app.syncing = false;
  }
}

export async function syncSingleTable(table, options = {}) {
  const isOnline = window.navigator.onLine && ensureApp()?.supabaseHealthy !== false;
  if (!isOnline) return [];

  if (table === 'records') {
    const filters = options.filters || getDefaultRecordWindowFilters();
    const rows = await loadRecordsWindow(filters, {
      setActive: options.setActive !== false
    });
    return rows;
  }

  const rows = await loadTableRows(table, {
    setActive: options.setActive !== false
  });

  return rows;
}

export async function syncAllTablesFromRemote(options = {}) {
  const isOnline = window.navigator.onLine && ensureApp()?.supabaseHealthy !== false;
  if (!isOnline) return;

  const includeRecords = options.includeRecords !== false;
  const tables = ['users', 'notifications', 'audit_logs', 'settings', 'daily_balances', 'backups'];

  if (includeRecords) {
    await syncSingleTable('records', {
      filters: options.recordFilters || getDefaultRecordWindowFilters(),
      setActive: true
    });
  }

  await Promise.all(
    tables.map((table) =>
      syncSingleTable(table, { setActive: true })
    )
  );

  scheduleUiRefresh('data-entry', 'sync-all');
}

export async function setupSupabaseRealtime() {
  const app = ensureApp();
  const supabaseClient = getSupabaseClient();

  if (app?.realtimeBound) return app.realtimeChannel;
  if (!supabaseClient?.channel) return null;

  app.realtimeBound = true;

  const channelName = `abu-hudhaifa:${supabaseClient.supabaseUrl || 'default'}`;
  const channel = supabaseClient.channel(channelName, { config: { broadcast: { ack: false } } });

  const tables = ['records', 'users', 'notifications', 'audit_logs', 'settings', 'daily_balances', 'backups'];

  tables.forEach((table) => {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      async (payload) => {
        const eventType = payload.eventType?.toUpperCase?.() || '';
        const row = payload.new || payload.old || null;

        if (!row) return;

        if (table === 'records') {
          const normalized = normalizeTableRow(table, row);
          await mergeCachedRows(table, [normalized]);

          if (eventType === 'DELETE') {
            removeRecordFromView(normalized.id);
          } else {
            syncRecordViewRow(normalized, 'upsert');
          }

          scheduleUiRefresh('data-entry', 'realtime-records');
          return;
        }

        if (eventType === 'DELETE') {
          const currentRows = getTableRows(table);
          const idx = currentRows.findIndex(item => String(item.id) === String(row.id));
          if (idx >= 0) {
            currentRows.splice(idx, 1);
            setTableRows(table, currentRows);
            await cacheTable(table, currentRows);
          }
        } else {
          const normalized = normalizeTableRow(table, row);
          const currentRows = getTableRows(table);
          const idx = currentRows.findIndex(item => String(item.id) === String(normalized.id));
          if (idx >= 0) currentRows[idx] = normalized;
          else currentRows.unshift(normalized);
          setTableRows(table, currentRows);
          await cacheTable(table, currentRows);
        }

        scheduleUiRefresh('data-entry', `realtime-${table}`);
      }
    );
  });

  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      app.realtimeChannel = channel;
      console.log('✅ Realtime subscribed for all tables');
    }
  });

  app.realtimeChannel = channel;
  return channel;
}

if (typeof window !== 'undefined') {
  window.flushOutbox = flushOutbox;
  window.syncSingleTable = syncSingleTable;
  window.syncAllTablesFromRemote = syncAllTablesFromRemote;
  window.setupSupabaseRealtime = setupSupabaseRealtime;
}
