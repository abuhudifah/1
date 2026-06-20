/**
 * services/RealtimeChannelManager.js — v1.0
 *
 * مدير مركزي لقنوات Supabase Realtime:
 * ─────────────────────────────────────────────────────────────
 * المشكلة: كل مكوّن يُنشئ ويُدمّر قناته بشكل مستقل
 *   → خطر تسرّب القنوات إذا فشل destroy()
 *   → لا رؤية لعدد القنوات المفتوحة
 *   → تكرار الكود في كل مكوّن
 *
 * الحل: نقطة واحدة لإنشاء/تتبع/تدمير كل القنوات
 *   subscribe()   → ينشئ قناة ويتتبّعها (يُزيل القديمة بنفس الاسم)
 *   unsubscribe() → يُغلق قناة واحدة
 *   destroyAll()  → يُغلق كل القنوات (logout / hard reset)
 */
'use strict';

const RealtimeChannelManager = (() => {
  // name → RealtimeChannel
  const _channels = new Map();

  /**
   * اشترك في قناة postgres_changes.
   *
   * @param {string}   name     - اسم فريد للقناة (مثل 'dash-transactions')
   * @param {string}   table    - اسم الجدول في Supabase
   * @param {object}   [filter] - { event, filter } اختياري (افتراضي: كل الأحداث)
   * @param {Function} callback - تُستدعى عند وصول حدث جديد
   * @returns {Function}        - دالة unsubscribe مباشرة
   */
  function subscribe(name, table, filter = {}, callback) {
    // أزل القناة القديمة بنفس الاسم قبل إنشاء جديدة
    if (_channels.has(name)) {
      _removeChannel(name);
    }

    const event = filter.event || '*';

    const channel = supabaseClient
      .channel(name)
      .on('postgres_changes', {
        event,
        schema: 'public',
        table,
        ...(filter.filter ? { filter: filter.filter } : {}),
      }, callback)
      .subscribe();

    _channels.set(name, channel);
    console.log(`📡 ChannelManager: اشتراك [${name}] → ${table} (${event})`);

    return () => unsubscribe(name);
  }

  /**
   * أنهِ اشتراك قناة واحدة بالاسم.
   */
  function unsubscribe(name) {
    if (_channels.has(name)) {
      _removeChannel(name);
      console.log(`📡 ChannelManager: إلغاء [${name}]`);
    }
  }

  /**
   * أغلق كل القنوات المفتوحة — استدعِها عند تسجيل الخروج أو reset.
   */
  function destroyAll() {
    if (_channels.size === 0) return;
    console.log(`📡 ChannelManager: إغلاق ${_channels.size} قناة/قنوات`);
    for (const name of _channels.keys()) {
      _removeChannel(name);
    }
  }

  /**
   * عدد القنوات المفتوحة حالياً — للتشخيص.
   */
  function activeCount() {
    return _channels.size;
  }

  // ── داخلي ──────────────────────────────────────────────────

  function _removeChannel(name) {
    const ch = _channels.get(name);
    if (ch) {
      try { supabaseClient.removeChannel(ch); } catch { /* تجاهل */ }
    }
    _channels.delete(name);
  }

  return { subscribe, unsubscribe, destroyAll, activeCount };
})();

window.RealtimeChannelManager = RealtimeChannelManager;
console.log('✅ RealtimeChannelManager v1.0 — مدير مركزي لقنوات Supabase Realtime');
