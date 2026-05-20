// ==========================================
// auth.js - إدارة المصادقة والجلسات والدخول السريع
// ==========================================

import { showToast, setOfflineBanner, isAdmin, currentUserName, escapeHtml } from './utils.js';
import { loginWithPassword, loginWithQuickEquation, getUsers, getUserByUsername } from './features/users/userService.js';
import { syncAllTablesFromRemote } from './core/sync.js';
import { refreshUI } from './ui.js';

const { supabaseClient } = window;

// ==========================================
// متغيرات الجلسة
// ==========================================

let inactivityTimer = null;
const AGENT_INACTIVITY_LIMIT = 5 * 60 * 1000; // 5 دقائق للمندوب

// ==========================================
// دوال مساعدة للواجهة
// ==========================================

function showAuthenticatedArea() {
    const loginSection = document.getElementById('login-section');
    const mainContent = document.getElementById('main-content');
    if (loginSection) loginSection.classList.add('hidden');
    if (mainContent) mainContent.classList.remove('hidden');
}

function showUnauthenticatedArea() {
    const loginSection = document.getElementById('login-section');
    const mainContent = document.getElementById('main-content');
    if (loginSection) loginSection.classList.remove('hidden');
    if (mainContent) mainContent.classList.add('hidden');
}

function applyRoleLayout(role) {
    const isAdminUser = role === 'admin';
    document.body.classList.toggle('admin-layout', isAdminUser);
    document.body.classList.toggle('agent-layout', !isAdminUser);
    
    document.querySelectorAll('.admin-only-tab').forEach(el => el.classList.toggle('hidden', !isAdminUser));
    document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', !isAdminUser));
    document.querySelectorAll('.agent-only').forEach(el => el.classList.toggle('hidden', isAdminUser));
    
    const bottomNav = document.getElementById('bottom-nav');
    if (bottomNav) bottomNav.classList.toggle('hidden', isAdminUser);
    
    const addBankBtn = document.getElementById('add-bank-btn');
    if (addBankBtn) addBankBtn.style.display = isAdminUser ? '' : 'none';
    
    const companyFilter = document.getElementById('bank-company-filter');
    if (companyFilter) companyFilter.style.display = isAdminUser ? '' : 'none';
}

function setCurrentUserLabel(user) {
    const label = document.getElementById('current-username');
    if (!label) return;
    if (!user) {
        label.textContent = 'المستخدم: غير مسجل';
        return;
    }
    const prefix = user.role === 'admin' ? 'المدير' : 'المندوب';
    label.textContent = `${prefix}: ${user.display_name || user.username || 'غير محدد'}`;
}

// ==========================================
// إدارة الجلسة (Session Management)
// ==========================================

function resetInactivityTimer() {
    if (!window.App?.currentUser || window.App.currentUser.role !== 'agent') return;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        if (window.App?.currentUser?.role === 'agent') {
            logout();
            showToast('انتهت الجلسة بسبب عدم النشاط لمدة 5 دقائق.', 'warning');
        }
    }, AGENT_INACTIVITY_LIMIT);
}

function addInactivityListeners() {
    const events = ['mousedown', 'keydown', 'mousemove', 'touchstart', 'scroll', 'click'];
    events.forEach(event => window.addEventListener(event, resetInactivityTimer));
}

function removeInactivityListeners() {
    const events = ['mousedown', 'keydown', 'mousemove', 'touchstart', 'scroll', 'click'];
    events.forEach(event => window.removeEventListener(event, resetInactivityTimer));
}

function startSessionTimer(role) {
    if (inactivityTimer) clearTimeout(inactivityTimer);
    removeInactivityListeners();
    if (role === 'agent') {
        addInactivityListeners();
        resetInactivityTimer();
    }
}

// ==========================================
// دوال تسجيل الدخول الأساسية (تستخدم من calculator و traditional login)
// ==========================================

async function loginUser(user, options = {}) {
    if (!user) return false;
    
    window.App.currentUser = user;
    setCurrentUserLabel(user);
    applyRoleLayout(user.role);
    showAuthenticatedArea();
    
    startSessionTimer(user.role);
    
    if (!options.silentLoad) {
        await syncAllTablesFromRemote();
    }
    
    await refreshUI();
    
    if (typeof window.switchTab === 'function') {
        window.switchTab(user.role === 'admin' ? 'dashboard' : 'data-entry');
    }
    
    return true;
}

async function logout() {
    try {
        await supabaseClient.auth.signOut();
    } catch (e) {}
    
    window.App.currentUser = null;
    window.App.records = [];
    window.App.users = [];
    window.App.notifications = [];
    window.App.auditLogs = [];
    
    removeInactivityListeners();
    if (inactivityTimer) clearTimeout(inactivityTimer);
    
    showUnauthenticatedArea();
    applyRoleLayout('agent');
    setCurrentUserLabel(null);
    
    if (typeof window.refreshUI === 'function') window.refreshUI();
}

async function restoreSession() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session?.user?.id) {
            const { data: profile, error } = await supabaseClient
                .from('users')
                .select('*')
                .eq('auth_user_id', session.user.id)
                .maybeSingle();
            if (!error && profile) {
                await loginUser(profile, { silentLoad: true });
                return true;
            }
        }
    } catch (error) {
        console.warn('فشل استعادة الجلسة:', error);
    }
    showUnauthenticatedArea();
    return false;
}

// ==========================================
// الدخول التقليدي (اسم المستخدم + كلمة المرور)
// ==========================================

async function traditionalLogin(username, password) {
    if (!username || !password) {
        showToast('أدخل اسم المستخدم وكلمة المرور', 'warning');
        return false;
    }
    
    const user = await loginWithPassword(username, password);
    if (user) {
        await loginUser(user);
        showToast(`أهلاً بك، ${user.display_name} ✅`, 'success');
        return true;
    } else {
        showToast('اسم المستخدم أو كلمة المرور غير صحيحة', 'error');
        return false;
    }
}

// ==========================================
// الدخول السريع (عبر الآلة الحاسبة)
// ==========================================

async function quickLogin(equation) {
    if (!equation) return false;
    const cleanEq = String(equation).replace(/\s+/g, '');
    
    const user = await loginWithQuickEquation(cleanEq);
    if (user) {
        await loginUser(user);
        showToast(`أهلاً بك مجدداً، ${user.display_name} ✅`, 'success');
        return true;
    }
    return false;
}

// ==========================================
// معالجة نموذج تسجيل الدخول التقليدي
// ==========================================

function bindLoginForm() {
    const form = document.getElementById('traditional-login-form');
    if (!form || form.dataset.bound) return;
    form.dataset.bound = '1';
    
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('login-username')?.value.trim().toLowerCase() || '';
        const password = document.getElementById('login-password')?.value || '';
        
        const btn = document.getElementById('login-btn-text');
        const spinner = document.getElementById('login-spinner');
        const originalText = btn?.textContent || 'تسجيل الدخول';
        
        if (btn) btn.textContent = 'جاري التحقق...';
        if (spinner) spinner.classList.remove('hidden');
        
        await traditionalLogin(username, password);
        
        if (btn) btn.textContent = originalText;
        if (spinner) spinner.classList.add('hidden');
    });
    
    const toggleBtn = document.getElementById('toggle-login-password');
    const pwdInput = document.getElementById('login-password');
    const pwdIcon = document.getElementById('toggle-password-icon');
    if (toggleBtn && pwdInput) {
        toggleBtn.addEventListener('click', () => {
            const type = pwdInput.type === 'password' ? 'text' : 'password';
            pwdInput.type = type;
            if (pwdIcon) pwdIcon.classList.toggle('fa-eye');
            if (pwdIcon) pwdIcon.classList.toggle('fa-eye-slash');
        });
    }
}

// ==========================================
// دوال الآلة الحاسبة والتوافق مع authShell القديم
// ==========================================

let calcState = {
    expression: '0',
    pending: null,
    operation: null,
    justEvaluated: false
};

function updateCalcDisplay() {
    const display = document.getElementById('calc-display');
    if (display) display.textContent = calcState.expression;
}

function evaluateExpression(expr) {
    try {
        // استخدام Function بدلاً من eval للأمان (يسمح فقط بالعمليات الحسابية)
        const result = Function(`"use strict"; return (${expr})`)();
        return Number.isFinite(result) ? String(result) : 'Error';
    } catch {
        return 'Error';
    }
}

function handleCalcPress(symbol) {
    const current = calcState.expression;
    
    if (symbol === 'C') {
        calcState.expression = '0';
        calcState.pending = null;
        calcState.operation = null;
        calcState.justEvaluated = false;
        updateCalcDisplay();
        return;
    }
    
    if (symbol === 'sqrt') {
        const n = parseFloat(current);
        if (!isNaN(n)) {
            calcState.expression = String(Math.sqrt(Math.max(0, n)));
            calcState.justEvaluated = true;
            updateCalcDisplay();
        }
        return;
    }
    
    if (symbol === '%') {
        const n = parseFloat(current);
        if (!isNaN(n)) {
            calcState.expression = String(n / 100);
            calcState.justEvaluated = true;
            updateCalcDisplay();
        }
        return;
    }
    
    if (symbol === '=') {
        // حاول تسجيل الدخول السريع أولاً
        const cleanExpr = current.replace(/\s+/g, '');
        quickLogin(cleanExpr).then(matched => {
            if (matched) {
                calcState.expression = '0';
                calcState.pending = null;
                calcState.operation = null;
                calcState.justEvaluated = true;
                updateCalcDisplay();
                return;
            }
            
            let finalExpr = current;
            if (calcState.pending !== null && calcState.operation) {
                finalExpr = `${calcState.pending}${calcState.operation}${current}`;
            }
            const result = evaluateExpression(finalExpr);
            calcState.expression = result;
            calcState.pending = null;
            calcState.operation = null;
            calcState.justEvaluated = true;
            updateCalcDisplay();
        });
        return;
    }
    
    if (['+', '-', '*', '/'].includes(symbol)) {
        if (calcState.justEvaluated) {
            calcState.justEvaluated = false;
        }
        if (calcState.pending === null) {
            calcState.pending = current;
            calcState.operation = symbol;
            calcState.expression = '0';
        } else {
            // حساب العملية السابقة أولاً
            const expr = `${calcState.pending}${calcState.operation}${current}`;
            const result = evaluateExpression(expr);
            if (result !== 'Error') {
                calcState.pending = result;
                calcState.expression = '0';
                calcState.operation = symbol;
            } else {
                calcState.expression = 'Error';
                calcState.pending = null;
                calcState.operation = null;
            }
        }
        updateCalcDisplay();
        return;
    }
    
    // أرقام ونقطة
    if (calcState.justEvaluated) {
        calcState.expression = '0';
        calcState.justEvaluated = false;
    }
    if (symbol === '.' && calcState.expression.includes('.')) return;
    if (calcState.expression === '0' && symbol !== '.') {
        calcState.expression = symbol;
    } else {
        calcState.expression += symbol;
    }
    updateCalcDisplay();
}

// ==========================================
// إنشاء كائن authShell للتوافق مع الكود القديم
// ==========================================

window.authShell = {
    press(symbol) {
        handleCalcPress(symbol);
    },
    async submitLogin(event) {
        if (event) event.preventDefault();
        const username = document.getElementById('login-username')?.value.trim().toLowerCase() || '';
        const password = document.getElementById('login-password')?.value || '';
        await traditionalLogin(username, password);
    },
    togglePassword(event) {
        if (event) event.preventDefault();
        const pwdInput = document.getElementById('login-password');
        const pwdIcon = document.getElementById('toggle-password-icon');
        if (!pwdInput) return;
        const type = pwdInput.type === 'password' ? 'text' : 'password';
        pwdInput.type = type;
        if (pwdIcon) pwdIcon.classList.toggle('fa-eye');
        if (pwdIcon) pwdIcon.classList.toggle('fa-eye-slash');
    },
    showCalc(event) {
        if (event) event.preventDefault();
        const calc = document.getElementById('smart-calculator');
        const login = document.getElementById('traditional-login');
        if (calc) calc.classList.remove('hidden');
        if (login) login.classList.add('hidden');
    },
    showLogin(event) {
        if (event) event.preventDefault();
        const calc = document.getElementById('smart-calculator');
        const login = document.getElementById('traditional-login');
        if (calc) calc.classList.add('hidden');
        if (login) login.classList.remove('hidden');
    }
};

// ==========================================
// تصدير الدوال العامة
// ==========================================

export {
    loginUser,
    logout,
    restoreSession,
    traditionalLogin,
    quickLogin,
    bindLoginForm,
    showAuthenticatedArea,
    showUnauthenticatedArea,
    applyRoleLayout,
    setCurrentUserLabel
};

// ربط تلقائي عند تحميل DOM
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        bindLoginForm();
        restoreSession();
    });
} else {
    bindLoginForm();
    restoreSession();
}

// تصدير إلى النطاق العام للتوافق مع الكود القديم غير المعياري
if (typeof window !== 'undefined') {
    window.loginUser = loginUser;
    window.logout = logout;
    window.restoreSession = restoreSession;
    window.traditionalLogin = traditionalLogin;
    window.quickLogin = quickLogin;
    window.bindLoginForm = bindLoginForm;
}
