/**
 * services/DataSourceConfig.js
 * طبقة تجريد مزود قاعدة البيانات — Cloud DB Switching Foundation
 *
 * الغرض: فصل طبقة الوصول إلى البيانات عن المزود الحالي (Supabase)
 * تُمكِّن هذه الطبقة مستقبلاً من التبديل بين مزودات تخزين سحابية متعددة
 * دون تعديل المنطق التجاري في بقية الكود.
 *
 * الحالة الحالية: مزود واحد نشط (Supabase)
 * التوسع المستقبلي: Firebase، REST API مخصص، أو أي مزود JSONB-compatible
 *
 * ════════════════════════════════════════
 * كيفية إضافة مزود جديد:
 * 1. أضف مفتاحاً جديداً في PROVIDERS
 * 2. أضف كائن تهيئة في _providerRegistry
 * 3. استدعِ DataSourceConfig.setProvider(key) لتفعيله
 * ════════════════════════════════════════
 */
'use strict';

const DataSourceConfig = (() => {

  /* ── قائمة المزودات المدعومة ── */
  const PROVIDERS = Object.freeze({
    SUPABASE : 'supabase',
    // FIREBASE : 'firebase',   // قيد التطوير
    // CUSTOM   : 'custom_rest', // قيد التطوير
  });

  /* ── سجل المزودات (نقطة التوسع المستقبلي) ── */
  const _providerRegistry = {
    [PROVIDERS.SUPABASE]: {
      label    : 'Supabase',
      endpoint : SUPABASE_CONFIG?.URL || 'https://supabase.co',
      adapter  : null, // الواجهة الحالية تستخدم supabaseClient مباشرة
    },
    /* نموذج للمزود المستقبلي:
    [PROVIDERS.FIREBASE]: {
      label    : 'Firebase Firestore',
      endpoint : 'https://firestore.googleapis.com',
      adapter  : null, // FirebaseAdapter (لم يُنفَّذ بعد)
    },
    */
  };

  let _active = PROVIDERS.SUPABASE;

  /* ── الواجهة العامة ── */
  return {
    PROVIDERS,

    /** المزود النشط حالياً */
    getActive() { return _active; },

    /** معلومات العرض للواجهة */
    getInfo() {
      const p = _providerRegistry[_active];
      return {
        key      : _active,
        label    : p?.label    || _active,
        endpoint : p?.endpoint || '—',
      };
    },

    /**
     * تفعيل مزود مختلف.
     * نقطة التوسع: يُستدعى هذا الكود عند اكتمال بناء الـ adapter.
     * @param {string} providerKey - مفتاح من PROVIDERS
     */
    setProvider(providerKey) {
      if (!_providerRegistry[providerKey]) {
        throw new Error(`مزود غير معروف: ${providerKey}`);
      }
      if (!_providerRegistry[providerKey].adapter) {
        throw new Error(`مزود ${providerKey} غير جاهز — الـ adapter لم يُنفَّذ بعد`);
      }
      _active = providerKey;
    },

    /**
     * هل المزود المطلوب نشط؟
     * @param {string} providerKey
     */
    is(providerKey) { return _active === providerKey; },
  };

})();

window.DataSourceConfig = DataSourceConfig;
console.log(`✅ DataSourceConfig.js محمّل — المزود النشط: ${DataSourceConfig.getInfo().label}`);
