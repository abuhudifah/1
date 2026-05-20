// ==========================================
// sync.js - المزامنة (Outbox + Realtime)
// ==========================================

import { normalizeTableRow, getTableRows, setTableRows, cacheTable } from './repository.js';
import { appendAuditEntry } from './audit.js';

const { supabaseClient } = window;
const localDB = window.App?.db || null;

/**
 * تفريغ طابور المزامنة (outbox) – إرسال العمليات المحفوظة محلياً إلى Supabase
 * @returns {Promise<void>}
 */
export async function flushOutbox() {
  const isOnline = window.navigator.onLine && window.App?.supabaseHealthy !== false;
  if (!isOnline || window.App?.syncing) return;
  
  window.App.syncing = true;
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
          // insert
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
      // إعادة تحميل البيانات من الخادم بعد المزامنة الناجحة
      if (typeof loadServerData === 'function') {
        await loadServerData();
      }
    }
  } catch (error) {
    console.warn('❌ فشل تفريغ طابور المزامنة:', error);
  } finally {
    window.App.syncing = false;
  }
}

/**
 * مزامنة جدول واحد من الخادم إلى المحلي
 * @param {string} table - اسم الجدول
 * @returns {Promise<void>}
 */
export async function syncSingleTable(table) {
  const isOnline = window.navigator.onLine && window.App?.supabaseHealthy !== false;
  if (!isOnline) return;
  
  try {
    const query = supabaseClient.from(table).select('*').order('updated_at', { ascending: false });
    if (table !== 'settings') query.is('deleted_at', null);
    const { data, error } = await query;
    if (error) throw error;
    
    const rows = (data || []).map(row => normalizeTableRow(table, row));
    setTableRows(table, rows);
    await cacheTable(table, rows);
  } catch (error) {
    console.warn(`⚠️ فشلت مزامنة الجدول ${table}:`, error);
  }
}

/**
 * مزامنة جميع الجداول المهمة من الخادم
 * @returns {Promise<void>}
 */
export async function syncAllTablesFromRemote() {
  const isOnline = window.navigator.onLine && window.App?.supabaseHealthy !== false;
  if (!isOnline) return;
  
  const tables = ['records', 'users', 'notifications', 'audit_logs', 'settings', 'daily_balances', 'backups'];
  await Promise.all(tables.map(table => syncSingleTable(table)));
  
  // تحديث واجهة المستخدم بعد المزامنة
  if (typeof refreshUI === 'function') refreshUI();
}

/**
 * إعداد الإشتراك في التحديثات الفورية (Realtime) من Supabase
 * @returns {Promise<any>}
 */
export async function setupSupabaseRealtime() {
  if (window.App?.realtimeBound) return window.App.realtimeChannel;
  window.App.realtimeBound = true;
  
  const channelName = `abu-hudhaifa:${supabaseClient.supabaseUrl || 'default'}`;
  const channel = supabaseClient.channel(channelName, { config: { broadcast: { ack: false } } });
  
  const tables = ['records', 'users', 'notifications', 'audit_logs', 'settings', 'daily_balances', 'backups'];
  
  tables.forEach((table) => {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table },
      async (payload) => {
        // معالجة التغيير الفوري (يمكن توسيعها لاحقاً)
        const eventType = payload.eventType?.toUpperCase?.();
        const row = payload.new || payload.old || null;
        
        if (eventType === 'DELETE') {
          if (row?.id) {
            const currentRows = getTableRows(table);
            const idx = currentRows.findIndex(item => String(item.id) === String(row.id));
            if (idx >= 0) {
              currentRows.splice(idx, 1);
              setTableRows(table, currentRows);
              await cacheTable(table, currentRows);
            }
          }
        } else if (row) {
          const normalized = normalizeTableRow(table, row);
          const currentRows = getTableRows(table);
          const idx = currentRows.findIndex(item => String(item.id) === String(normalized.id));
          if (idx >= 0) currentRows[idx] = normalized;
          else currentRows.unshift(normalized);
          setTableRows(table, currentRows);
          await cacheTable(table, currentRows);
        }
        
        if (typeof refreshUI === 'function') refreshUI();
      }
    );
  });
  
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') {
      window.App.realtimeChannel = channel;
      console.log('✅ Realtime subscribed for all tables');
    }
  });
  
  window.App.realtimeChannel = channel;
  return channel;
}

// تصدير الدوال إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
  window.flushOutbox = flushOutbox;
  window.syncSingleTable = syncSingleTable;
  window.syncAllTablesFromRemote = syncAllTablesFromRemote;
  window.setupSupabaseRealtime = setupSupabaseRealtime;
}
