/**
 * services/ThemeManager.js
 * مدير الوضع المظلم والفاتح — مصدر واحد للحقيقة
 * 
 * المسؤوليات:
 * - تخزين تفضيل الثيم في localStorage (مفتاح موحد: 'abu_theme')
 * - تطبيق الكلاس المناسب على body (dark-mode)
 * - توفير دالة toggle() تستخدمها أي مكون
 * - الاستماع لتغيرات localStorage بين التبويبات (مزامنة تلقائية)
 * - إطلاق حدث 'theme:changed' عند التبديل لأي مستمع
 * - احترام prefers-color-scheme عند أول زيارة (اختياري)
 */

'use strict';

const ThemeManager = (function() {
  // المفتاح الموحد في localStorage
  const STORAGE_KEY = 'abu_theme';
  
  // الكلاس الذي يضاف/يزال على body
  const DARK_CLASS = 'dark-mode';
  
  // الحالة الحالية
  let _isDark = false;
  
  // مستمعو الأحداث
  const _listeners = [];
  
  /**
   * يقرأ القيمة المخزنة في localStorage ويعيدها كـ boolean
   * @returns {boolean | null} true=داكن، false=فاتح، null=لا يوجد تفضيل
   */
  function getStoredTheme() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return null;
  }
  
  /**
   * يحفظ القيمة في localStorage
   * @param {boolean} isDark 
   */
  function saveToStorage(isDark) {
    localStorage.setItem(STORAGE_KEY, isDark ? 'dark' : 'light');
  }
  
  /**
   * يطبق الثيم على body بإضافة أو إزالة الكلاس DARK_CLASS
   * @param {boolean} isDark 
   */
  function applyThemeToBody(isDark) {
    if (isDark) {
      document.body.classList.add(DARK_CLASS);
    } else {
      document.body.classList.remove(DARK_CLASS);
    }
  }
  
  /**
   * يتحقق من تفضيل النظام (prefers-color-scheme)
   * @returns {boolean} true إذا كان النظام يفضل الداكن
   */
  function getSystemPreference() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  
  /**
   * يُطلق حدث التغيير لجميع المستمعين
   * @param {boolean} isDark 
   */
  function notifyListeners(isDark) {
    _listeners.forEach(fn => {
      try { fn(isDark); } catch (e) { console.warn('ThemeManager listener error:', e); }
    });
    // أيضاً نطلق حدث DOM مخصص لأي مكون يريد الاستماع
    window.dispatchEvent(new CustomEvent('theme:changed', { detail: { isDark } }));
  }
  
  /**
   * يهيئ مدير الثيم:
   * - يقرأ التفضيل المخزن أو النظام
   * - يطبقه على body
   * - يستمع لتغيرات localStorage (مزامنة بين التبويبات)
   * - يستمع لتغيرات prefers-color-scheme (اختياري)
   */
  function init() {
    // تحديد القيمة الأولية
    let initialDark = getStoredTheme();
    
    if (initialDark === null) {
      // لا تفضيل مخزن → استخدم تفضيل النظام
      initialDark = getSystemPreference();
      saveToStorage(initialDark); // نخزنها لأول مرة
    }
    
    _isDark = initialDark;
    applyThemeToBody(_isDark);
    
    // الاستماع لتغيرات localStorage من التبويبات الأخرى
    window.addEventListener('storage', (e) => {
      if (e.key === STORAGE_KEY) {
        const newValue = e.newValue;
        const newIsDark = (newValue === 'dark');
        if (newIsDark !== _isDark) {
          _isDark = newIsDark;
          applyThemeToBody(_isDark);
          notifyListeners(_isDark);
        }
      }
    });
    
    // (اختياري) الاستماع لتغير تفضيل النظام أثناء تشغيل التطبيق
    if (window.matchMedia) {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      mediaQuery.addEventListener('change', (e) => {
        // فقط إذا لم يكن هناك تفضيل مخزن من المستخدم
        if (localStorage.getItem(STORAGE_KEY) === null) {
          const newIsDark = e.matches;
          if (newIsDark !== _isDark) {
            _isDark = newIsDark;
            applyThemeToBody(_isDark);
            saveToStorage(_isDark);
            notifyListeners(_isDark);
          }
        }
      });
    }
    
    console.log(`✅ ThemeManager مهيأ — الوضع: ${_isDark ? 'مظلم' : 'فاتح'}`);
  }
  
  /**
   * يبدل الوضع الحالي (فاتح ← مظلم أو العكس)
   * @returns {boolean} الحالة الجديدة (true=مظلم، false=فاتح)
   */
  function toggle() {
    _isDark = !_isDark;
    applyThemeToBody(_isDark);
    saveToStorage(_isDark);
    notifyListeners(_isDark);
    return _isDark;
  }
  
  /**
   * يضبط وضعاً محدداً
   * @param {boolean} isDark 
   */
  function setTheme(isDark) {
    if (_isDark === isDark) return;
    _isDark = isDark;
    applyThemeToBody(_isDark);
    saveToStorage(_isDark);
    notifyListeners(_isDark);
  }
  
  /**
   * يُعيد الحالة الحالية
   * @returns {boolean}
   */
  function isDarkMode() {
    return _isDark;
  }
  
  /**
   * يُضيف مستمعاً للتغييرات
   * @param {Function} listener - دالة تستقبل (isDark)
   * @returns {Function} دالة لإزالة المستمع
   */
  function onChange(listener) {
    _listeners.push(listener);
    return () => {
      const index = _listeners.indexOf(listener);
      if (index !== -1) _listeners.splice(index, 1);
    };
  }
  
  // API العامة
  return {
    init,
    toggle,
    setTheme,
    isDarkMode,
    onChange,
    // للاستخدام في console (debug)
    get STORAGE_KEY() { return STORAGE_KEY; },
  };
})();

// تصدير للاستخدام العالمي
window.ThemeManager = ThemeManager;
console.log('✅ ThemeManager.js محمّل — مدير الوضع المظلم جاهز');
