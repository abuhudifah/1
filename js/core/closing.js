// ==========================================
// closing.js - الإقفال اليومي وحساب الأرصدة
// ==========================================

import { safeNumber, showToast, dateInputAden, currentUserName, defaultAgentName } from '../utils.js';
import { persistTable, cacheTable } from './repository.js';
import { appendAuditEntry } from './audit.js';
import { getDailyCloseSettings, saveDailyCloseSettings } from './settings.js';

const { supabaseClient } = window;

// متغير لمنع تكرار الإقفال المتزامن
let isClosingInProgress = false;

/**
 * الحصول على الرصيد الافتتاحي ليوم معين من daily_balances (Supabase)
 * @param {string} agentName - اسم المندوب (display_name أو username)
 * @param {string} dateStr - التاريخ بصيغة YYYY-MM-DD
 * @returns {Promise<number>}
 */
export async function getOpeningBalanceFromCloud(agentName, dateStr) {
    if (!agentName || !dateStr) return 0;
    const user = (window.App?.users || []).find(u => u.display_name === agentName || u.username === agentName);
    if (!user?.id) return 0;
    try {
        const { data, error } = await supabaseClient
            .from('daily_balances')
            .select('total_balance')
            .eq('balance_date', dateStr)
            .eq('user_id', user.id)
            .maybeSingle();
        if (error) throw error;
        return data?.total_balance ?? 0;
    } catch (err) {
        console.warn('فشل جلب الرصيد من daily_balances:', err);
        return 0;
    }
}

/**
 * حفظ الرصيد الختامي (الافتتاحي لليوم التالي) في daily_balances
 * @param {string} agentName - اسم المندوب
 * @param {string} dateStr - التاريخ (اليوم التالي للإقفال)
 * @param {number} balance - الرصيد المراد حفظه
 */
export async function saveClosingBalanceToCloud(agentName, dateStr, balance) {
    if (!agentName || !dateStr) return;
    const user = (window.App?.users || []).find(u => u.display_name === agentName || u.username === agentName);
    if (!user?.id) return;
    const rounded = Math.round(balance);
    try {
        const { error } = await supabaseClient
            .from('daily_balances')
            .upsert({
                balance_date: dateStr,
                user_id: user.id,
                total_balance: rounded,
                updated_at: new Date().toISOString()
            }, { onConflict: 'balance_date, user_id' });
        if (error) {
            // fallback في حال عدم وجود قيد فريد
            const { data: existing } = await supabaseClient
                .from('daily_balances')
                .select('id')
                .eq('balance_date', dateStr)
                .eq('user_id', user.id)
                .maybeSingle();
            if (existing?.id) {
                await supabaseClient.from('daily_balances')
                    .update({ total_balance: rounded, updated_at: new Date().toISOString() })
                    .eq('id', existing.id);
            } else {
                await supabaseClient.from('daily_balances')
                    .insert({
                        id: crypto.randomUUID(),
                        balance_date: dateStr,
                        user_id: user.id,
                        total_balance: rounded,
                        created_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    });
            }
        }
        // تحديث الكاش المحلي
        const idx = (window.App.dailyBalances || []).findIndex(d => d.balance_date === dateStr && d.user_id === user.id);
        if (idx >= 0) window.App.dailyBalances[idx].total_balance = rounded;
        else window.App.dailyBalances.push({ balance_date: dateStr, user_id: user.id, total_balance: rounded });
        await cacheTable('daily_balances', window.App.dailyBalances);
    } catch (err) {
        console.warn('فشل حفظ الرصيد الختامي:', err);
    }
}

/**
 * حساب الرصيد السابق (الافتتاحي) ليوم معين – يستخدم الرصيد المخزن أولاً ثم يحسب من السجلات
 * @param {string} targetDate - التاريخ (YYYY-MM-DD) (اختياري، افتراضي اليوم الحالي)
 * @returns {Promise<number>}
 */
export async function calculatePreviousBalance(targetDate = null) {
    const date = targetDate || dateInputAden();
    const agentName = defaultAgentName();
    if (!agentName) return 0;
    
    const stored = await getOpeningBalanceFromCloud(agentName, date);
    if (stored !== 0) return stored;
    
    const user = (window.App?.users || []).find(u => u.display_name === agentName || u.username === agentName);
    const userId = user?.id;
    let calculated = 0;
    const previousRecords = (window.App.records || []).filter(r => {
        if (r.is_bank_account || r.is_debtor_customer || r.is_failed_deposit) return false;
        if (r.deleted_at) return false;
        const belongs = (userId && r.user_id === userId) || (r.agent_name === agentName);
        return belongs && r.date < date;
    });
    previousRecords.forEach(r => {
        if (r.is_reversed) return; // تجاهل العمليات المعكوسة
        const amt = safeNumber(r.amount, 0);
        if (r.is_reversal) {
            calculated += amt; // amt سالبة
        } else if (r.type === 'collection' || r.type === 'receipt') {
            calculated += amt;
        } else if (r.type === 'deposit' || r.type === 'expense' || r.type === 'delivery') {
            calculated -= amt;
        } else if (r.is_failed_deposit) {
            calculated -= amt;
        }
    });
    return Math.round(calculated);
}

/**
 * إقفال يوم محدد (للمدير فقط) – يحسب الأرصدة لكل مندوب ويخزنها
 * @param {string} dateToClose - التاريخ (YYYY-MM-DD)
 */
export async function closeSpecificDay(dateToClose) {
    if (isClosingInProgress) {
        console.warn('⚠️ عملية إقفال قيد التنفيذ بالفعل');
        return;
    }
    isClosingInProgress = true;
    try {
        const dayRecords = (window.App.records || []).filter(r => 
            r.date === dateToClose && 
            !r.is_bank_account && 
            !r.is_debtor_customer && 
            !r.deleted_at
        );
        
        const uniqueIds = new Set();
        for (const rec of dayRecords) {
            const id = rec.user_id || rec.agent_name;
            if (id) uniqueIds.add(id);
        }
        
        for (const identifier of uniqueIds) {
            let agentName = identifier;
            const user = (window.App.users || []).find(u => u.id === identifier);
            if (user) agentName = user.display_name || user.username;
            
            let openingBalance = await getOpeningBalanceFromCloud(agentName, dateToClose);
            if (isNaN(openingBalance)) openingBalance = 0;
            
            const agentRecords = dayRecords.filter(r => (r.user_id || r.agent_name) === identifier);
            let totals = { collections:0, deposits:0, expenses:0, receipts:0, deliveries:0, failed:0 };
            agentRecords.forEach(r => {
                const amt = safeNumber(r.amount, 0);
                if (r.type === 'collection') totals.collections += amt;
                else if (r.type === 'deposit') totals.deposits += amt;
                else if (r.type === 'expense') totals.expenses += amt;
                else if (r.type === 'receipt') totals.receipts += amt;
                else if (r.type === 'delivery') totals.deliveries += amt;
                else if (r.is_failed_deposit) totals.failed += amt;
            });
            
            const closingBalance = openingBalance
                + totals.collections + totals.receipts
                - totals.deposits - totals.expenses - totals.deliveries - totals.failed;
            
            const nextDate = new Date(dateToClose);
            nextDate.setDate(nextDate.getDate() + 1);
            const nextDateStr = nextDate.toISOString().split('T')[0];
            await saveClosingBalanceToCloud(agentName, nextDateStr, closingBalance);
        }
        
        await appendAuditEntry({
            action: 'daily_close',
            table_name: 'daily_balances',
            record_id: dateToClose,
            before_value: null,
            after_value: { closed_date: dateToClose, closed_by: window.App?.currentUser?.id },
            source: 'system'
        });
        console.log(`✅ تم إقفال يوم ${dateToClose}`);
    } finally {
        isClosingInProgress = false;
    }
}

/**
 * الإقفال اليدوي لليوم السابق (للمدير)
 */
export async function manualCloseToday() {
    const isAdmin = window.App?.currentUser?.role === 'admin';
    if (!isAdmin) {
        showToast('غير مصرح – يجب أن تكون مديراً', 'error');
        return;
    }
    const now = new Date();
    const saudiTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    const yesterday = new Date(saudiTime);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    
    showToast(`جاري إقفال يوم ${yesterdayStr} ...`, 'info');
    try {
        await closeSpecificDay(yesterdayStr);
        await saveDailyCloseSettings({
            lastClosedDate: yesterdayStr,
            lastExecution: new Date().toISOString()
        });
        showToast(`✅ تم إقفال يوم ${yesterdayStr} يدوياً بنجاح`, 'success');
        if (typeof refreshUI === 'function') refreshUI();
    } catch (err) {
        console.error('فشل الإقفال اليدوي:', err);
        showToast('فشل الإقفال: ' + err.message, 'error');
    }
}

/**
 * تنفيذ الإقفال اليومي (تلقائي أو يدوي)
 * @param {boolean} force - تجاهل الإعدادات وتنفيذ الإقفال فوراً
 * @returns {Promise<boolean>}
 */
export async function runDailyClose(force = false) {
    const isAdmin = window.App?.currentUser?.role === 'admin';
    if (!isAdmin) {
        showToast('هذه الميزة للمدير فقط', 'warning');
        return false;
    }
    const cfg = getDailyCloseSettings();
    if (!cfg.enabled && !force) {
        showToast('الإقفال اليومي غير مفعّل', 'warning');
        return false;
    }
    
    const now = new Date();
    const saudiTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    const yesterday = new Date(saudiTime);
    yesterday.setDate(yesterday.getDate() - 1);
    const closeDay = yesterday.toISOString().split('T')[0];
    
    if (!force && cfg.lastClosedDate === closeDay) return false;
    
    showToast(`جاري إقفال يوم ${closeDay} ...`, 'info');
    try {
        await closeSpecificDay(closeDay);
        await saveDailyCloseSettings({
            enabled: cfg.enabled,
            hour: cfg.hour,
            minute: cfg.minute,
            lastClosedDate: closeDay,
            lastExecution: new Date().toISOString()
        });
        showToast(`تم إقفال يوم ${closeDay} بنجاح ✅`, 'success');
        if (typeof refreshUI === 'function') refreshUI();
        return true;
    } catch (err) {
        console.error('فشل الإقفال:', err);
        showToast('فشل الإقفال: ' + err.message, 'error');
        return false;
    }
}

/**
 * بدء المراقبة التلقائية للإقفال اليومي (تعمل كل دقيقة)
 */
export function startDailyCloseWatcher() {
    if (window.__dailyCloseWatcher) clearInterval(window.__dailyCloseWatcher);
    window.__dailyCloseWatcher = setInterval(async () => {
        try {
            const cfg = getDailyCloseSettings();
            const isAdmin = window.App?.currentUser?.role === 'admin';
            if (!cfg.enabled || !isAdmin) return;
            
            const now = new Date();
            const saudiTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
            const currentHour = saudiTime.getUTCHours();
            const currentMinute = saudiTime.getUTCMinutes();
            const targetHour = cfg.hour;
            const targetMinute = cfg.minute;
            const reached = currentHour > targetHour || (currentHour === targetHour && currentMinute >= targetMinute);
            if (reached) await runDailyClose(false);
        } catch (error) {
            console.warn('تعذر تنفيذ الإقفال اليومي:', error);
        }
    }, 60000);
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم
if (typeof window !== 'undefined') {
    window.getOpeningBalanceFromCloud = getOpeningBalanceFromCloud;
    window.saveClosingBalanceToCloud = saveClosingBalanceToCloud;
    window.calculatePreviousBalance = calculatePreviousBalance;
    window.closeSpecificDay = closeSpecificDay;
    window.manualCloseToday = manualCloseToday;
    window.runDailyClose = runDailyClose;
    window.startDailyCloseWatcher = startDailyCloseWatcher;
    }
