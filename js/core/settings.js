// ==========================================
// settings.js - إعدادات النظام والإقفال اليومي
// ==========================================

import { safeNumber } from '../utils.js';
import { persistTable, cacheTable } from './repository.js';

const { supabaseClient } = window;

/**
 * الحصول على قيمة إعداد معين من App.settings
 * @param {string} scope - نطاق الإعداد (مثل system_settings)
 * @param {string} key - مفتاح الإعداد
 * @param {any} fallback - القيمة الافتراضية (اختياري)
 * @returns {any}
 */
export function getSettingValue(scope, key, fallback = null) {
  const row = (window.App?.settings || []).find(item => String(item.scope) === String(scope) && String(item.key) === String(key));
  return row ? (row.value ?? fallback) : fallback;
}

/**
 * تحديث أو إضافة إعداد محلي (دون مزامنة مع Supabase)
 * @param {string} scope - نطاق الإعداد
 * @param {string} key - مفتاح الإعداد
 * @param {any} value - القيمة
 * @returns {Object}
 */
export function upsertLocalSetting(scope, key, value) {
  const normalized = {
    id: crypto.randomUUID(),
    scope,
    key,
    value,
    updated_at: new Date().toISOString()
  };
  const idx = (window.App.settings || []).findIndex(item => String(item.scope) === String(scope) && String(item.key) === String(key));
  if (idx >= 0) window.App.settings[idx] = normalized;
  else window.App.settings.unshift(normalized);
  return normalized;
}

/**
 * الحصول على إعدادات الإقفال اليومي
 * @returns {Object}
 */
export function getDailyCloseSettings() {
  const raw = getSettingValue('system_settings', 'daily_close', {});
  return {
    enabled: raw?.enabled === true || raw?.enabled === 'true',
    hour: Math.max(0, Math.min(23, safeNumber(raw?.hour, 0))),
    minute: Math.max(0, Math.min(59, safeNumber(raw?.minute, 0))),
    lastClosedDate: raw?.lastClosedDate || null,
    lastExecution: raw?.lastExecution || null
  };
}

/**
 * حفظ إعدادات الإقفال اليومي (في Supabase و Dexie)
 * @param {Object} patch - التعديلات الجزئية على الإعدادات
 * @returns {Promise<Object>}
 */
export async function saveDailyCloseSettings(patch = {}) {
  const current = getDailyCloseSettings();
  const next = { ...current, ...patch };
  const payload = {
    scope: 'system_settings',
    key: 'daily_close',
    value: next,
    updated_by: window.App?.currentUser?.id || null
  };
  await persistTable('settings', payload);
  upsertLocalSetting('system_settings', 'daily_close', next);
  window.App.dailyCloseSettings = next;
  return next;
}

// تحديث واجهة الإعدادات (عرض آخر إقفال، الساعة، إلخ)
function hydrateSettingsUI() {
  const cfg = window.App.dailyCloseSettings || getDailyCloseSettings();
  const toggle = document.getElementById('auto-close-toggle');
  const hour = document.getElementById('close-hour');
  const minute = document.getElementById('close-minute');
  if (toggle) toggle.checked = !!cfg.enabled;
  if (hour && String(hour.value) !== String(cfg.hour)) hour.value = String(cfg.hour).padStart(2, '0');
  if (minute && String(minute.value) !== String(cfg.minute)) minute.value = String(cfg.minute).padStart(2, '0');
  const lastInfo = document.getElementById('last-close-info');
  if (lastInfo) {
    lastInfo.textContent = cfg.lastClosedDate
      ? `آخر إقفال: ${cfg.lastClosedDate}${cfg.lastExecution ? ' | ' + new Date(cfg.lastExecution).toLocaleString('ar-EG') : ''}`
      : 'لم يتم تنفيذ أي إقفال بعد';
  }
}

/**
 * حفظ إعداد (عام) في قاعدة البيانات
 * @param {string} key - مفتاح الإعداد
 * @param {any} value - القيمة
 * @param {string} scope - النطاق (افتراضي system_settings)
 * @returns {Promise<Object>}
 */
export async function saveSetting(key, value, scope = 'system_settings') {
  const payload = {
    id: crypto.randomUUID(),
    scope,
    key,
    value,
    updated_by: window.App?.currentUser?.id || null
  };
  const stored = await persistTable('settings', payload);
  const idx = (window.App.settings || []).findIndex(row => row.scope === scope && row.key === key);
  if (idx >= 0) window.App.settings[idx] = stored;
  else window.App.settings.unshift(stored);
  await cacheTable('settings', window.App.settings);
  return stored;
}

// تصدير الوظائف إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
  window.getSettingValue = getSettingValue;
  window.upsertLocalSetting = upsertLocalSetting;
  window.getDailyCloseSettings = getDailyCloseSettings;
  window.saveDailyCloseSettings = saveDailyCloseSettings;
  window.saveSetting = saveSetting;
  window.hydrateSettingsUI = hydrateSettingsUI;
}
