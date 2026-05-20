// ===============================
// main.js
// Unified Safe Bootstrap Layer
// ===============================

import { initializeUI } from './ui.js';
import { initializeForms } from './forms.js';
import { initializeAuth } from './auth.js';

// ==========================================
// GLOBAL SAFE APP STATE
// ==========================================

window.App = window.App || {};

window.App.state = window.App.state || {
    initialized: false,
    initializing: false,
    domReady: false,
    supabaseReady: false,
    authReady: false,
    uiReady: false,
    formsReady: false,
    bootErrors: []
};

// ==========================================
// SAFE LOGGER
// ==========================================

function log(...args) {
    console.log('[APP]', ...args);
}

function logError(...args) {
    console.error('[APP ERROR]', ...args);
}

// ==========================================
// SAFE DOM READY
// ==========================================

function waitForDOM() {
    return new Promise((resolve) => {
        if (document.readyState === 'complete' || document.readyState === 'interactive') {
            resolve();
            return;
        }

        document.addEventListener(
            'DOMContentLoaded',
            () => resolve(),
            { once: true }
        );
    });
}

// ==========================================
// SAFE SUPABASE CHECK
// ==========================================

async function waitForSupabase(timeout = 10000) {
    const start = Date.now();

    while (!window.supabaseClient) {
        if (Date.now() - start > timeout) {
            throw new Error('Supabase client initialization timeout');
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return true;
}

// ==========================================
// SAFE INITIALIZER
// ==========================================

async function safeInitialize(name, fn) {
    try {
        log(`Initializing ${name}...`);

        await fn();

        log(`${name} initialized successfully`);

        return true;
    } catch (error) {

        logError(`${name} failed`, error);

        window.App.state.bootErrors.push({
            module: name,
            error: error.message,
            timestamp: Date.now()
        });

        return false;
    }
}

// ==========================================
// SAFE EVENT BINDING
// ==========================================

window.safeBindEvent = function(element, event, handler, options = {}) {

    if (!element) {
        console.warn(`[SAFE EVENT] Missing element for ${event}`);
        return;
    }

    const key = `__bound_${event}`;

    if (element[key]) {
        return;
    }

    element.addEventListener(event, handler, options);

    element[key] = true;
};

// ==========================================
// GLOBAL SAFE QUERY
// ==========================================

window.$safe = function(selector) {
    return document.querySelector(selector);
};

window.$safeAll = function(selector) {
    return Array.from(document.querySelectorAll(selector));
};

// ==========================================
// SAFE MENU BINDING
// ==========================================

function initializeMenuButtons() {
    
    // =====================================
    // عناصر القائمة الحقيقية من HTML الحالي
    // =====================================
    
    const menuButton =
        document.querySelector('#secret-menu-toggle') ||
        document.querySelector('.secret-menu-btn');
    
    const dropdown =
        document.querySelector('#secret-dropdown') ||
        document.querySelector('.secret-menu-dropdown');
    
    if (!menuButton || !dropdown) {
        
        console.warn('Secret menu elements not found');
        
        return;
    }
    
    // منع التكرار
    if (menuButton.dataset.bound === 'true') {
        return;
    }
    
    menuButton.dataset.bound = 'true';
    
    // =====================================
    // Toggle dropdown
    // =====================================
    
    menuButton.addEventListener('click', (e) => {
        
        e.preventDefault();
        e.stopPropagation();
        
        dropdown.classList.toggle('show');
        dropdown.classList.toggle('hidden');
        
        const isVisible =
            dropdown.classList.contains('show');
        
        dropdown.setAttribute(
            'aria-hidden',
            isVisible ? 'false' : 'true'
        );
        
    });
    
    // =====================================
    // إغلاق عند الضغط خارج القائمة
    // =====================================
    
    document.addEventListener('click', (e) => {
        
        if (
            !dropdown.contains(e.target) &&
            !menuButton.contains(e.target)
        ) {
            
            dropdown.classList.remove('show');
            dropdown.classList.add('hidden');
            
            dropdown.setAttribute(
                'aria-hidden',
                'true'
            );
        }
    });
    // =====================================
    // الانتقال لتسجيل الدخول التقليدي
    // =====================================

    const showTraditionalLoginBtn =
        document.querySelector('#show-traditional-login');

    const calculatorSection =
        document.querySelector('#smart-calculator');

    const traditionalLoginSection =
        document.querySelector('#traditional-login');

    const backToCalcBtn =
        document.querySelector('#back-to-calc');

    // فتح شاشة تسجيل الدخول
    if (showTraditionalLoginBtn &&
        calculatorSection &&
        traditionalLoginSection) {

        showTraditionalLoginBtn.addEventListener('click', (e) => {

            e.preventDefault();
            e.stopPropagation();

            // إغلاق القائمة
            dropdown.classList.remove('show');
            dropdown.classList.add('hidden');

            // إخفاء الآلة الحاسبة
            calculatorSection.classList.add('hidden');

            // إظهار تسجيل الدخول
            traditionalLoginSection.classList.remove('hidden');

            // تركيز حقل المستخدم
            const usernameInput =
                document.querySelector('#login-username');

            if (usernameInput) {
                setTimeout(() => {
                    usernameInput.focus();
                }, 150);
            }

            console.log('Traditional login opened');
        });
    }

    // العودة للآلة الحاسبة
    if (backToCalcBtn &&
        calculatorSection &&
        traditionalLoginSection) {

        backToCalcBtn.addEventListener('click', (e) => {

            e.preventDefault();

            // إخفاء تسجيل الدخول
            traditionalLoginSection.classList.add('hidden');

            // إظهار الآلة الحاسبة
            calculatorSection.classList.remove('hidden');

            console.log('Calculator restored');
        });
    }
    console.log('Secret menu initialized');
}
// ==========================================
// MAIN APP INITIALIZATION
// ==========================================

export async function initApp() {

    if (window.App.state.initialized) {
        log('App already initialized');
        return;
    }

    if (window.App.state.initializing) {
        log('App initialization already in progress');
        return;
    }

    window.App.state.initializing = true;

    try {

        log('Starting unified app bootstrap...');

        // ==========================
        // DOM READY
        // ==========================

        await waitForDOM();

        window.App.state.domReady = true;

        log('DOM ready');

        // ==========================
        // SUPABASE READY
        // ==========================

        await waitForSupabase();

        window.App.state.supabaseReady = true;

        log('Supabase ready');

        // ==========================
        // AUTH
        // ==========================

        await safeInitialize('Auth', async () => {

            if (typeof initializeAuth === 'function') {
                await initializeAuth();
            }

            window.App.state.authReady = true;
        });

        // ==========================
        // UI
        // ==========================

        await safeInitialize('UI', async () => {

            if (typeof initializeUI === 'function') {
                await initializeUI();
            }

            initializeMenuButtons();

            window.App.state.uiReady = true;
        });

        // ==========================
        // FORMS
        // ==========================

        await safeInitialize('Forms', async () => {

            if (typeof initializeForms === 'function') {
                await initializeForms();
            }

            window.App.state.formsReady = true;
        });

        // ==========================
        // FINALIZE
        // ==========================

        window.App.state.initialized = true;

        log('Application initialized successfully');

        console.table(window.App.state);

    } catch (error) {

        logError('Fatal bootstrap error', error);

        window.App.state.bootErrors.push({
            module: 'bootstrap',
            error: error.message,
            timestamp: Date.now()
        });

    } finally {

        window.App.state.initializing = false;
    }
}

// ==========================================
// AUTO START
// ==========================================

if (!window.__APP_BOOTSTRAPPED__) {

    window.__APP_BOOTSTRAPPED__ = true;

    initApp().catch((error) => {
        console.error('Application bootstrap failed', error);
    });
} 
