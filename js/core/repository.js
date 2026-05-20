// ==========================================
// repository.js - طبقة الوصول إلى البيانات (Supabase + Dexie)
// ==========================================

import { safeNumber } from '../utils.js';

const { supabaseClient } = window;
const localDB = window.App?.db || null;

// ==========================================
// دوال مساعدة داخلية
// ==========================================

const TABLE_ACCESSORS = {
  records: () => window.App?.records || [],
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
    date: row.date || (typeof dateInputAden === 'function' ? dateInputAden() : new Date().toISOString().slice(0, 10)),
    time: row.time || (typeof timeInputAden === 'function' ? timeInputAden() : new Date().toTimeString().slice(0, 5)),
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
  return getter ? getter() : [];
}

function setTableRows(table, rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (table === 'records') window.App.records = list;
  else if (table === 'users') window.App.users = list;
  else if (table === 'notifications') window.App.notifications = list;
  else if (table === 'audit_logs') window.App.auditLogs = list;
  else if (table === 'settings') window.App.settings = list;
  else if (table === 'daily_balances') window.App.dailyBalances = list;
  else if (table === 'backups') window.App.backups = list;
}

function normalizeTableRow(table, row) {
  const normalizer = TABLE_NORMALIZERS[table] || ((x) => ({ ...x }));
  return normalizer(row || {});
}

// ==========================================
// الدوال الأساسية المصدّرة
// ==========================================

/**
 * حفظ جدول في Dexie (الكاش المحلي)
 * @param {string} table - اسم الجدول
 * @param {Array} rows - المصفوفة المراد تخزينها
 */
export async function cacheTable(table, rows) {
  if (!localDB?.[table]) return;
  const list = Array.isArray(rows) ? rows : [];
  await localDB[table].clear();
  if (list.length) await localDB[table].bulkPut(list);
}

/**
 * إضافة سجل إلى طابور المزامنة (عند عدم الاتصال)
 * @param {string} table - اسم الجدول
 * @param {string} operation_type - insert / update / delete
 * @param {string} target_id - معرف السجل
 * @param {Object} payload - البيانات
 * @returns {Promise<Object>}
 */
export async function enqueueOutbox(table, operation_type, target_id, payload) {
  const entry = {
    op_uuid: crypto.randomUUID(),
    table_name: table,
    operation_type,
    target_id,
    payload,
    status: 'pending',
    created_at: new Date().toISOString()
  };
  await localDB.outbox.add(entry);
  return entry;
}

/**
 * حفظ أو تحديث سجل في Supabase و Dexie (أساسي)
 * @param {string} table - اسم الجدول
 * @param {Object} payload - البيانات
 * @param {string} editId - معرف السجل (في حالة التعديل)
 * @param {Object} options - خيارات إضافية (مثل skipAudit)
 * @returns {Promise<Object>}
 */
export async function persistTable(table, payload, editId = '', options = {}) {
  const row = normalizeTableRow(table, {
    ...payload,
    id: editId || payload?.id || crypto.randomUUID()
  });
  row.updated_at = new Date().toISOString();
  if (!row.created_at) row.created_at = row.updated_at;
  if (!Object.prototype.hasOwnProperty.call(row, 'deleted_at')) row.deleted_at = null;

  const currentRows = getTableRows(table);
  const existingIndex = currentRows.findIndex((item) => String(item.id) === String(row.id));
  const beforeValue = existingIndex >= 0 ? currentRows[existingIndex] : null;

  const isOnline = window.navigator.onLine && window.App?.supabaseHealthy !== false;

  if (!isOnline) {
    await enqueueOutbox(table, editId ? 'update' : 'insert', row.id, row);
    if (existingIndex >= 0) currentRows[existingIndex] = row;
    else currentRows.unshift(row);
    setTableRows(table, currentRows);
    await cacheTable(table, currentRows);
    return row;
  }

  const { error } = await supabaseClient.from(table).upsert(row, { onConflict: 'id' });
  if (error) throw error;

  if (existingIndex >= 0) currentRows[existingIndex] = row;
  else currentRows.unshift(row);
  setTableRows(table, currentRows);
  await cacheTable(table, currentRows);

  return row;
}

/**
 * حذف سجل من Supabase و Dexie (دعم القيد العكسي للـ records يتم في reversal.js)
 * @param {string} table - اسم الجدول
 * @param {string} id - معرف السجل
 * @param {Object} options - خيارات إضافية
 * @returns {Promise<boolean>}
 */
export async function deleteTableRow(table, id, options = {}) {
  const currentRows = getTableRows(table);
  const idx = currentRows.findIndex((item) => String(item.id) === String(id));
  const beforeValue = idx >= 0 ? currentRows[idx] : null;
  const deletedAt = new Date().toISOString();

  const isOnline = window.navigator.onLine && window.App?.supabaseHealthy !== false;

  if (!isOnline) {
    await enqueueOutbox(table, 'delete', id, { id, deleted_at: deletedAt });
    if (idx >= 0) currentRows.splice(idx, 1);
    setTableRows(table, currentRows);
    await cacheTable(table, currentRows);
    return true;
  }

  const { error } = await supabaseClient.from(table).update({ deleted_at: deletedAt }).eq('id', id);
  if (error) throw error;
  if (idx >= 0) currentRows.splice(idx, 1);
  setTableRows(table, currentRows);
  await cacheTable(table, currentRows);
  return true;
}

// تصدير دوال التسوية للاستخدام الداخلي (إذا لزم)
export { normalizeTableRow, getTableRows, setTableRows };

// تصدير دوال التسوية إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
  window.persistTable = persistTable;
  window.deleteTableRow = deleteTableRow;
  window.cacheTable = cacheTable;
    }
