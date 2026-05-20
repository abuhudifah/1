// ==========================================
// repository.js - طبقة الوصول إلى البيانات (Supabase + Dexie)
// ==========================================

import { safeNumber, dateInputAden, timeInputAden } from '../utils.js';

// ==========================================
// Helpers ديناميكية - لا تلتقط الحالة مبكراً
// ==========================================

function getSupabaseClient() {
  return typeof window !== 'undefined' ? (window.supabaseClient || null) : null;
}

function getLocalDB() {
  return typeof window !== 'undefined' ? (window.App?.db || null) : null;
}

function ensureAppObject() {
  if (typeof window === 'undefined') return null;
  window.App = window.App || {};
  return window.App;
}

function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `op_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function hasOnlineAccess() {
  const app = ensureAppObject();
  return Boolean(window?.navigator?.onLine && app?.supabaseHealthy !== false);
}

// ==========================================
// دوال مساعدة داخلية
// ==========================================

const TABLE_ACCESSORS = {
  records: () => window.App?.recordView?.rows || window.App?.records || [],
  users: () => window.App?.users || [],
  notifications: () => window.App?.notifications || [],
  audit_logs: () => window.App?.auditLogs || [],
  settings: () => window.App?.settings || [],
  daily_balances: () => window.App?.dailyBalances || [],
  backups: () => window.App?.backups || []
};

const TABLE_NORMALIZERS = {
  records: (row) => normalizeRecord(row),
  users: (row) => normalizeUser(row),
  notifications: (row) => normalizeNotification(row),
  audit_logs: (row) => normalizeAudit(row),
  settings: (row) => normalizeSettings(row),
  daily_balances: (row) => ({ ...row }),
  backups: (row) => ({ ...row })
};

function normalizeRecord(row = {}) {
  return {
    ...row,
    id: row.id,
    type: row.type || 'record',
    user_id: row.user_id || null,
    agent_name: row.agent_name || row.username || row.display_name || '',
    date: row.date || dateInputAden(),
    time: row.time || timeInputAden(),
    amount: safeNumber(row.amount, 0),
    is_bank_account: row.is_bank_account === true || row.is_bank_account === 'true',
    is_debtor_customer: row.is_debtor_customer === true || row.is_debtor_customer === 'true',
    is_failed_deposit: row.is_failed_deposit === true || row.is_failed_deposit === 'true',
    is_reversal: row.is_reversal === true || row.is_reversal === 'true',
    is_reversed: row.is_reversed === true || row.is_reversed === 'true',
    is_correction: row.is_correction === true || row.is_correction === 'true',
    deleted_at: row.deleted_at || null,
    version: safeNumber(row.version, 1),
    updated_at: row.updated_at || row.created_at || new Date().toISOString()
  };
}

function normalizeUser(row = {}) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata : {};
  return {
    ...row,
    id: row.id,
    username: (row.username || metadata.username || '').toString().trim().toLowerCase(),
    display_name: row.display_name || metadata.display_name || row.username || 'مستخدم',
    role: row.role || metadata.role || 'agent',
    quick_eq: row.quick_eq || metadata.quick_eq || '',
    email: row.email || metadata.email || '',
    phone: row.phone || metadata.phone || '',
    password_hash: row.password_hash || metadata.password_hash || '',
    deleted_at: row.deleted_at || null,
    version: safeNumber(row.version, 1),
    updated_at: row.updated_at || row.created_at || new Date().toISOString()
  };
}

function normalizeNotification(row = {}) {
  return {
    ...row,
    id: row.id,
    user_id: row.user_id || null,
    target_role: row.target_role || null,
    title: row.title || '',
    body: row.body || '',
    severity: row.severity || 'info',
    is_read: row.is_read === true || row.is_read === 'true',
    deleted_at: row.deleted_at || null,
    updated_at: row.updated_at || row.created_at || new Date().toISOString()
  };
}

function normalizeAudit(row = {}) {
  return {
    ...row,
    id: row.id,
    user_id: row.user_id || null,
    username: row.username || '',
    display_name: row.display_name || '',
    action: row.action || '',
    record_type: row.record_type || 'record',
    record_id: row.record_id || null,
    old_value: row.old_value || null,
    new_value: row.new_value || null,
    timestamp: row.timestamp || row.created_at || new Date().toISOString(),
    source: row.source || 'app'
  };
}

function normalizeSettings(row = {}) {
  return {
    ...row,
    id: row.id,
    scope: row.scope || 'global',
    key: row.key || '',
    value: row.value ?? {},
    updated_by: row.updated_by || null,
    deleted_at: row.deleted_at || null,
    version: safeNumber(row.version, 1),
    updated_at: row.updated_at || row.created_at || new Date().toISOString()
  };
}

function getTableRows(table) {
  const getter = TABLE_ACCESSORS[table];
  return typeof getter === 'function' ? getter() : [];
}

function setTableRows(table, rows, meta = {}) {
  const app = ensureAppObject();
  if (!app) return;

  const list = Array.isArray(rows) ? rows : [];

  if (table === 'records') {
    app.records = list;
    app.recordView = {
      rows: list,
      filters: meta.filters || null,
      loadedAt: new Date().toISOString()
    };
    return;
  }

  if (table === 'users') app.users = list;
  else if (table === 'notifications') app.notifications = list;
  else if (table === 'audit_logs') app.auditLogs = list;
  else if (table === 'settings') app.settings = list;
  else if (table === 'daily_balances') app.dailyBalances = list;
  else if (table === 'backups') app.backups = list;
}

function getRecordView() {
  const app = ensureAppObject();
  return app?.recordView || { rows: app?.records || [], filters: null };
}

function setRecordView(rows, filters = null) {
  setTableRows('records', rows, { filters });
}

function recordMatchesFilters(row, filters = {}) {
  if (!row) return false;

  if (filters.includeDeleted !== true && row.deleted_at) return false;

  if (filters.date && row.date !== filters.date) return false;
  if (filters.dateFrom && row.date < filters.dateFrom) return false;
  if (filters.dateTo && row.date > filters.dateTo) return false;

  if (filters.type && row.type !== filters.type) return false;
  if (filters.userId && String(row.user_id || '') !== String(filters.userId)) return false;
  if (filters.agentName && String(row.agent_name || '') !== String(filters.agentName)) return false;

  if (filters.search) {
    const q = String(filters.search).trim().toLowerCase();
    const haystack = [
      row.agent_name,
      row.customer_name,
      row.bank_account,
      row.expense_details,
      row.received_from,
      row.delivered_to,
      row.notes,
      row.type
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    if (!haystack.includes(q)) return false;
  }

  return true;
}

function sortRows(table, rows, filters = {}) {
  const list = Array.isArray(rows) ? [...rows] : [];

  if (table === 'records') {
    list.sort((a, b) => {
      const da = new Date(`${a.date || '1970-01-01'}T${a.time || '00:00:00'}`).getTime();
      const db = new Date(`${b.date || '1970-01-01'}T${b.time || '00:00:00'}`).getTime();
      return db - da;
    });
    return list;
  }

  const orderBy = filters.orderBy || 'updated_at';
  const ascending = Boolean(filters.ascending);

  list.sort((a, b) => {
    const va = a?.[orderBy];
    const vb = b?.[orderBy];

    if (va === vb) return 0;
    if (va == null) return ascending ? -1 : 1;
    if (vb == null) return ascending ? 1 : -1;

    if (typeof va === 'number' && typeof vb === 'number') {
      return ascending ? va - vb : vb - va;
    }

    const sa = String(va);
    const sb = String(vb);
    return ascending ? sa.localeCompare(sb) : sb.localeCompare(sa);
  });

  return list;
}

function applyPagination(rows, filters = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const offset = safeNumber(filters.offset, 0);
  const limit = filters.limit == null ? null : safeNumber(filters.limit, null);

  if (limit == null && offset <= 0) return list;
  if (limit == null) return list.slice(offset);

  return list.slice(offset, offset + Math.max(0, limit));
}

function getDefaultRecordWindowFilters() {
  const today = dateInputAden();
  const app = ensureAppObject();
  const currentUser = app?.currentUser || null;

  if (!currentUser) {
    return { date: today };
  }

  if (currentUser.role === 'admin') {
    const from = new Date();
    from.setDate(from.getDate() - 29);
    return {
      dateFrom: from.toISOString().slice(0, 10),
      dateTo: today
    };
  }

  return {
    date: today,
    userId: currentUser.id || null,
    agentName: currentUser.display_name || currentUser.username || null
  };
}

async function fetchRecordsFromRemote(filters = {}) {
  const client = getSupabaseClient();
  if (!client?.from) return [];

  let query = client.from('records').select('*');

  if (filters.includeDeleted !== true) {
    query = query.is('deleted_at', null);
  }

  if (filters.date) {
    query = query.eq('date', filters.date);
  } else {
    if (filters.dateFrom) query = query.gte('date', filters.dateFrom);
    if (filters.dateTo) query = query.lte('date', filters.dateTo);
  }

  if (filters.type) query = query.eq('type', filters.type);
  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.agentName) query = query.eq('agent_name', filters.agentName);

  if (filters.orderBy) {
    query = query.order(filters.orderBy, { ascending: Boolean(filters.ascending) });
  } else {
    query = query.order('date', { ascending: false }).order('time', { ascending: false });
  }

  if (typeof filters.offset === 'number' && typeof filters.limit === 'number') {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (typeof filters.limit === 'number') {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data || []).map((row) => normalizeRecord(row));
  rows = rows.filter((row) => recordMatchesFilters(row, filters));
  rows = sortRows('records', rows, filters);
  return applyPagination(rows, filters);
}

async function fetchRecordsFromLocal(filters = {}) {
  const db = getLocalDB();
  if (!db?.records) return [];

  const DexieRef = typeof window !== 'undefined' ? window.Dexie : null;
  const minKey = DexieRef?.minKey ?? '';
  const maxKey = DexieRef?.maxKey ?? '\uffff';

  let collection = null;

  if (filters.date) {
    collection = db.records.where('date').equals(filters.date);
  } else if (filters.dateFrom || filters.dateTo) {
    collection = db.records
      .where('date')
      .between(filters.dateFrom || minKey, filters.dateTo || maxKey, true, true);
  } else if (filters.userId) {
    collection = db.records.where('user_id').equals(filters.userId);
  } else if (filters.agentName) {
    collection = db.records.where('agent_name').equals(filters.agentName);
  } else if (filters.type) {
    collection = db.records.where('type').equals(filters.type);
  } else {
    collection = db.records.toCollection();
  }

  let rows = await collection.toArray();
  rows = rows.map((row) => normalizeRecord(row));
  rows = rows.filter((row) => recordMatchesFilters(row, filters));
  rows = sortRows('records', rows, filters);
  return applyPagination(rows, filters);
}

async function fetchGenericRemote(table, filters = {}) {
  const client = getSupabaseClient();
  if (!client?.from) return [];

  let query = client.from(table).select('*');

  if (table !== 'settings' && filters.includeDeleted !== true) {
    query = query.is('deleted_at', null);
  }

  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.targetRole) query = query.eq('target_role', filters.targetRole);
  if (filters.scope) query = query.eq('scope', filters.scope);
  if (filters.key) query = query.eq('key', filters.key);
  if (filters.id) query = query.eq('id', filters.id);

  const orderBy = filters.orderBy || 'updated_at';
  if (orderBy) {
    query = query.order(orderBy, { ascending: Boolean(filters.ascending) });
  }

  if (typeof filters.offset === 'number' && typeof filters.limit === 'number') {
    query = query.range(filters.offset, filters.offset + filters.limit - 1);
  } else if (typeof filters.limit === 'number') {
    query = query.limit(filters.limit);
  }

  const { data, error } = await query;
  if (error) throw error;

  let rows = (data || []).map((row) => normalizeTableRow(table, row));
  rows = sortRows(table, rows, filters);
  return applyPagination(rows, filters);
}

async function fetchGenericLocal(table, filters = {}) {
  const db = getLocalDB();
  if (!db?.[table]) return [];

  let rows = await db[table].toArray();
  rows = rows.map((row) => normalizeTableRow(table, row));

  if (table !== 'settings' && filters.includeDeleted !== true) {
    rows = rows.filter((row) => !row.deleted_at);
  }

  if (filters.userId) rows = rows.filter((row) => String(row.user_id || '') === String(filters.userId));
  if (filters.targetRole) rows = rows.filter((row) => String(row.target_role || '') === String(filters.targetRole));
  if (filters.scope) rows = rows.filter((row) => String(row.scope || '') === String(filters.scope));
  if (filters.key) rows = rows.filter((row) => String(row.key || '') === String(filters.key));
  if (filters.id) rows = rows.filter((row) => String(row.id || '') === String(filters.id));

  rows = sortRows(table, rows, filters);
  return applyPagination(rows, filters);
}

function syncRecordViewRow(row, action = 'upsert') {
  const view = getRecordView();
  const filters = view.filters || null;
  let rows = Array.isArray(view.rows) ? [...view.rows] : [];
  const idx = rows.findIndex((item) => String(item.id) === String(row?.id));

  if (action === 'delete') {
    if (idx >= 0) rows.splice(idx, 1);
    setRecordView(rows, filters);
    return;
  }

  const shouldInclude = !filters || recordMatchesFilters(row, filters);

  if (idx >= 0 && shouldInclude) {
    rows[idx] = row;
  } else if (idx >= 0 && !shouldInclude) {
    rows.splice(idx, 1);
  } else if (shouldInclude) {
    rows.unshift(row);
  }

  setRecordView(rows, filters);
}

function removeRecordFromView(id) {
  const view = getRecordView();
  const filters = view.filters || null;
  const rows = Array.isArray(view.rows) ? view.rows.filter((item) => String(item.id) !== String(id)) : [];
  setRecordView(rows, filters);
}

function upsertRecordInView(row) {
  syncRecordViewRow(row, 'upsert');
}

async function mergeCachedRowsInternal(table, rows) {
  const db = getLocalDB();
  if (!db?.[table]) return;

  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;

  await db[table].bulkPut(list);
}

// ==========================================
// القراءة الموحدة للجدول
// ==========================================

export async function fetchTableRows(table, options = {}) {
  const filters = normalizeFilters(options.filters || options);
  const online = hasOnlineAccess();

  try {
    if (table === 'records') {
      if (online) return await fetchRecordsFromRemote(filters);
      return await fetchRecordsFromLocal(filters);
    }

    if (online) return await fetchGenericRemote(table, filters);
    return await fetchGenericLocal(table, filters);
  } catch (error) {
    console.warn(`⚠️ fetchTableRows failed for ${table}:`, error);

    try {
      if (table === 'records') return await fetchRecordsFromLocal(filters);
      return await fetchGenericLocal(table, filters);
    } catch (fallbackError) {
      console.warn(`⚠️ fallback fetchTableRows failed for ${table}:`, fallbackError);
      return [];
    }
  }
}

export async function queryTableRows(table, options = {}) {
  const rows = await fetchTableRows(table, options);
  const setActive = options.setActive !== false;

  if (setActive) {
    if (table === 'records') {
      setRecordView(rows, normalizeFilters(options.filters || options));
    } else {
      setTableRows(table, rows);
    }
  }

  return rows;
}

export async function loadTableRows(table, options = {}) {
  return queryTableRows(table, options);
}

export async function countTableRows(table, filters = {}) {
  const normalized = normalizeFilters(filters);
  const online = hasOnlineAccess();

  try {
    if (table === 'records') {
      if (online && getSupabaseClient()?.from && !normalized.search) {
        let query = getSupabaseClient().from('records').select('id', { head: true, count: 'exact' });

        if (normalized.includeDeleted !== true) query = query.is('deleted_at', null);
        if (normalized.date) {
          query = query.eq('date', normalized.date);
        } else {
          if (normalized.dateFrom) query = query.gte('date', normalized.dateFrom);
          if (normalized.dateTo) query = query.lte('date', normalized.dateTo);
        }
        if (normalized.type) query = query.eq('type', normalized.type);
        if (normalized.userId) query = query.eq('user_id', normalized.userId);
        if (normalized.agentName) query = query.eq('agent_name', normalized.agentName);

        const { count, error } = await query;
        if (!error) return safeNumber(count, 0);
      }

      const rows = await fetchRecordsFromLocal(normalized);
      return rows.length;
    }

    if (online && getSupabaseClient()?.from) {
      let query = getSupabaseClient().from(table).select('id', { head: true, count: 'exact' });

      if (table !== 'settings' && normalized.includeDeleted !== true) {
        query = query.is('deleted_at', null);
      }

      if (normalized.userId) query = query.eq('user_id', normalized.userId);
      if (normalized.targetRole) query = query.eq('target_role', normalized.targetRole);
      if (normalized.scope) query = query.eq('scope', normalized.scope);
      if (normalized.key) query = query.eq('key', normalized.key);
      if (normalized.id) query = query.eq('id', normalized.id);

      const { count, error } = await query;
      if (!error) return safeNumber(count, 0);
    }

    const db = getLocalDB();
    if (!db?.[table]) return 0;
    const rows = await fetchGenericLocal(table, normalized);
    return rows.length;
  } catch (error) {
    console.warn(`⚠️ countTableRows failed for ${table}:`, error);
    return 0;
  }
}

export async function mergeCachedRows(table, rows) {
  await mergeCachedRowsInternal(table, rows);
}

export async function replaceCachedRows(table, rows) {
  const db = getLocalDB();
  if (!db?.[table]) return;

  const list = Array.isArray(rows) ? rows : [];

  if (table === 'records') {
    await mergeCachedRowsInternal(table, list);
    return;
  }

  await db[table].clear();
  if (list.length) await db[table].bulkPut(list);
}

export async function cacheTable(table, rows) {
  await replaceCachedRows(table, rows);
}

// ==========================================
// المزامنة المحلية / البعيدة للجدول
// ==========================================

export async function enqueueOutbox(table, operation_type, target_id, payload) {
  const db = getLocalDB();
  const entry = {
    op_uuid: createId(),
    table_name: table,
    operation_type,
    target_id,
    payload,
    status: 'pending',
    created_at: new Date().toISOString()
  };

  if (db?.outbox?.add) {
    await db.outbox.add(entry);
  } else {
    console.warn('⚠️ outbox غير جاهز بعد، سيتم الاحتفاظ بالعملية في الذاكرة فقط:', entry);
  }

  return entry;
}

async function writeRemoteRow(table, row) {
  const client = getSupabaseClient();
  if (!client?.from) return { skipped: true };

  const { error } = await client.from(table).upsert(row, { onConflict: 'id' });
  if (error) throw error;

  return { skipped: false };
}

async function softDeleteRemoteRow(table, id) {
  const client = getSupabaseClient();
  if (!client?.from) return { skipped: true };

  const { error } = await client
    .from(table)
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  if (error) throw error;

  return { skipped: false };
}

function scheduleUiRefresh(tabId = 'data-entry', reason = 'repository') {
  const payload = { tabId, reason };
  if (typeof window.queueRefreshUI === 'function') {
    window.queueRefreshUI(payload);
    return;
  }
  if (typeof window.refreshUI === 'function') {
    window.refreshUI(payload).catch?.(() => {});
  }
}

export async function persistTable(table, payload, editId = '', options = {}) {
  const row = normalizeTableRow(table, {
    ...payload,
    id: editId || payload?.id || createId()
  });

  row.updated_at = new Date().toISOString();
  if (!row.created_at) row.created_at = row.updated_at;
  if (!Object.prototype.hasOwnProperty.call(row, 'deleted_at')) row.deleted_at = null;

  const isOnline = hasOnlineAccess();

  if (!isOnline) {
    await enqueueOutbox(table, editId ? 'update' : 'insert', row.id, row);

    if (table === 'records') {
      await mergeCachedRowsInternal('records', [row]);
      syncRecordViewRow(row, 'upsert');
      scheduleUiRefresh('data-entry', 'persist-offline');
      return row;
    }

    const currentRows = getTableRows(table);
    const existingIndex = currentRows.findIndex((item) => String(item.id) === String(row.id));
    if (existingIndex >= 0) currentRows[existingIndex] = row;
    else currentRows.unshift(row);
    setTableRows(table, currentRows);
    await replaceCachedRows(table, currentRows);
    scheduleUiRefresh('data-entry', 'persist-offline');
    return row;
  }

  try {
    await writeRemoteRow(table, row);
  } catch (error) {
    console.warn(`⚠️ فشل الحفظ البعيد للجدول ${table}، سيتم الاحتفاظ بالتغيير محلياً:`, error);
    await enqueueOutbox(table, editId ? 'update' : 'insert', row.id, row);
  }

  if (table === 'records') {
    await mergeCachedRowsInternal('records', [row]);
    syncRecordViewRow(row, 'upsert');
    scheduleUiRefresh('data-entry', 'persist-online');
    return row;
  }

  const currentRows = getTableRows(table);
  const existingIndex = currentRows.findIndex((item) => String(item.id) === String(row.id));
  if (existingIndex >= 0) currentRows[existingIndex] = row;
  else currentRows.unshift(row);

  setTableRows(table, currentRows);
  await replaceCachedRows(table, currentRows);
  scheduleUiRefresh('data-entry', 'persist-online');
  return row;
}

export async function deleteTableRow(table, id, options = {}) {
  const isOnline = hasOnlineAccess();
  const deletedAt = new Date().toISOString();

  if (!isOnline) {
    await enqueueOutbox(table, 'delete', id, { id, deleted_at: deletedAt });

    if (table === 'records') {
      const db = getLocalDB();
      const existing = db?.records?.get ? await db.records.get(id) : null;
      const tombstone = existing ? { ...existing, deleted_at: deletedAt, updated_at: deletedAt } : { id, deleted_at: deletedAt, updated_at: deletedAt };
      await mergeCachedRowsInternal('records', [tombstone]);
      removeRecordFromView(id);
      scheduleUiRefresh('data-entry', 'delete-offline');
      return true;
    }

    const currentRows = getTableRows(table);
    const idx = currentRows.findIndex((item) => String(item.id) === String(id));
    if (idx >= 0) currentRows.splice(idx, 1);
    setTableRows(table, currentRows);
    await replaceCachedRows(table, currentRows);
    scheduleUiRefresh('data-entry', 'delete-offline');
    return true;
  }

  try {
    await softDeleteRemoteRow(table, id);
  } catch (error) {
    console.warn(`⚠️ فشل الحذف البعيد للجدول ${table}، سيتم الاحتفاظ بالحذف محلياً:`, error);
    await enqueueOutbox(table, 'delete', id, { id, deleted_at: deletedAt });
  }

  if (table === 'records') {
    const db = getLocalDB();
    const existing = db?.records?.get ? await db.records.get(id) : null;
    const tombstone = existing ? { ...existing, deleted_at: deletedAt, updated_at: deletedAt } : { id, deleted_at: deletedAt, updated_at: deletedAt };
    await mergeCachedRowsInternal('records', [tombstone]);
    removeRecordFromView(id);
    scheduleUiRefresh('data-entry', 'delete-online');
    return true;
  }

  const currentRows = getTableRows(table);
  const idx = currentRows.findIndex((item) => String(item.id) === String(id));
  if (idx >= 0) currentRows.splice(idx, 1);
  setTableRows(table, currentRows);
  await replaceCachedRows(table, currentRows);
  scheduleUiRefresh('data-entry', 'delete-online');
  return true;
}

// ==========================================
// دوال مساعدة محددة للسجلات
// ==========================================

export async function queryRecords(filters = {}, options = {}) {
  return queryTableRows('records', {
    filters,
    setActive: options.setActive !== false
  });
}

export async function loadRecordsWindow(filters = null, options = {}) {
  const resolvedFilters = filters || getDefaultRecordWindowFilters();
  return queryTableRows('records', {
    filters: resolvedFilters,
    setActive: options.setActive !== false
  });
}

// تصدير دوال التسوية للاستخدام الداخلي (إذا لزم)
export {
  getTableRows,
  setTableRows,
  recordMatchesFilters,
  getRecordView,
  setRecordView,
  syncRecordViewRow,
  removeRecordFromView,
  getDefaultRecordWindowFilters,
  getDefaultRecordWindowFilters as buildDefaultRecordWindowFilters
};

// تصدير دوال التسوية إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
  window.persistTable = persistTable;
  window.deleteTableRow = deleteTableRow;
  window.cacheTable = cacheTable;
  window.enqueueOutbox = enqueueOutbox;
  window.queryRecords = queryRecords;
  window.loadRecordsWindow = loadRecordsWindow;
             }
