// ==========================================
// audit.js - سجل التدقيق (Audit Log)
// ==========================================

import { safeNumber, currentUserName, escapeHtml } from '../utils.js';
import { persistTable, cacheTable, deleteTableRow } from './repository.js';

const { supabaseClient } = window;

/**
 * تنظيف البيانات قبل تخزينها في سجل التدقيق (حذف التواريخ والحقول الحساسة)
 * @param {Object} row - السجل الأصلي
 * @returns {Object|null}
 */
export function stripRowForAudit(row) {
  if (!row || typeof row !== 'object') return null;
  const clone = { ...row };
  delete clone.updated_at;
  delete clone.created_at;
  delete clone.deleted_at;
  delete clone.password_hash;
  delete clone.card_pin;
  return clone;
}

/**
 * إضافة سجل تدقيق جديد
 * @param {Object} params - معاملات السجل
 * @param {string} params.action - الإجراء (insert, update, delete, etc.)
 * @param {string} params.table_name - اسم الجدول المتأثر
 * @param {string} params.record_id - معرف السجل المتأثر
 * @param {any} params.before_value - القيمة قبل التغيير (اختياري)
 * @param {any} params.after_value - القيمة بعد التغيير (اختياري)
 * @param {string} params.source - مصدر الإجراء (app, offline, system)
 * @returns {Promise<Object|null>}
 */
export async function appendAuditEntry({ action, table_name, record_id, before_value = null, after_value = null, source = 'app' }) {
  const currentUser = window.App?.currentUser;
  if (!currentUser) return null;

  const row = {
    id: crypto.randomUUID(),
    user_id: currentUser.id,
    username: currentUser.username || '',
    display_name: currentUserName(),
    action,
    record_type: table_name,
    record_id,
    old_value: before_value ? (typeof before_value === 'string' ? before_value : JSON.stringify(stripRowForAudit(before_value))) : null,
    new_value: after_value ? (typeof after_value === 'string' ? after_value : JSON.stringify(stripRowForAudit(after_value))) : null,
    timestamp: new Date().toISOString(),
    source
  };

  // إضافة إلى الذاكرة المحلية (App.auditLogs)
  if (!Array.isArray(window.App.auditLogs)) window.App.auditLogs = [];
  const existingIdx = window.App.auditLogs.findIndex(item => item.id === row.id);
  if (existingIdx >= 0) window.App.auditLogs[existingIdx] = row;
  else window.App.auditLogs.unshift(row);

  // تخزين في Dexie
  await cacheTable('audit_logs', window.App.auditLogs);

  // إذا لم يكن الجدول نفسه هو audit_logs، نخزن في Supabase (لتجنب الحلقات اللانهائية)
  if (table_name !== 'audit_logs') {
    try {
      await persistTable('audit_logs', row, row.id, { skipAudit: true });
    } catch (err) {
      console.warn('فشل حفظ سجل التدقيق في Supabase:', err);
    }
  }

  return row;
}

/**
 * مسح جميع سجلات التدقيق
 * @returns {Promise<boolean>}
 */
export async function clearAuditLogs() {
  const logs = [...(window.App.auditLogs || [])];
  if (!logs.length) {
    if (typeof showToast === 'function') showToast('لا توجد سجلات لحذفها', 'warning');
    else console.warn('لا توجد سجلات لحذفها');
    return false;
  }

  for (const log of logs) {
    await deleteTableRow('audit_logs', log.id, { skipAudit: true });
  }

  window.App.auditLogs = [];
  await cacheTable('audit_logs', window.App.auditLogs);
  if (typeof showToast === 'function') showToast('تم مسح سجل العمليات', 'success');
  return true;
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
  window.appendAuditEntry = appendAuditEntry;
  window.clearAuditLogs = clearAuditLogs;
  window.stripRowForAudit = stripRowForAudit;
}
