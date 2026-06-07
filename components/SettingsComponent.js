/**
 * components/SettingsComponent.js — v3.0
 * نظام أبو حذيفة — الإعدادات
 *
 * التغييرات في v3.0:
 * ─────────────────────────────────────────────────────────
 * ✅ جميع المستخدمين يرون تبويب الإعدادات:
 *    - المدير: قسم الإعدادات الكاملة + الملف الشخصي
 *    - المندوب / المساعد: الملف الشخصي فقط (اسم + دخول سريع)
 *
 * ✅ إزالة التحقق من الدور في render — SettingsComponent
 *    يُعرض الآن لجميع المستخدمين.
 *
 * ✅ قسم الدخول السريع نُقل إلى ProfileSettingsComponent
 *    (لا تكرار)
 * ─────────────────────────────────────────────────────────
 */
'use strict';

const SettingsComponent = {

  async render(container) {
    const user    = AuthService.getCurrentUser();
    const isAdmin = AuthService.isAdmin();

    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:0;';

    // ── إذا لم يكن مديراً: عرض الملف الشخصي فقط ──
    if (!isAdmin) {
      if (window.ProfileSettingsComponent) {
        await ProfileSettingsComponent.render(container);
      } else {
        container.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">⚙️</div>
          <div class="empty-state-text">لم يُحمَّل مكوّن الإعدادات</div></div>`;
      }
      return;
    }

    // ═══════════════════════════════════════════════════════
    // قسم المدير الكامل (يبدأ بالملف الشخصي ثم إعدادات النظام)
    // ═══════════════════════════════════════════════════════

    // ─── 1. الملف الشخصي ───
    const profileSection = document.createElement('div');
    profileSection.style.cssText = 'margin-bottom:28px;';
    if (window.ProfileSettingsComponent) {
      await ProfileSettingsComponent.render(profileSection);
    }
    wrap.appendChild(profileSection);

    // ─── فاصل ───
    const divider = document.createElement('div');
    divider.style.cssText = `
      display:flex;align-items:center;gap:12px;margin-bottom:24px;`;
    divider.innerHTML = `
      <div style="flex:1;height:1px;background:var(--border-color);"></div>
      <span style="font-size:.78rem;color:var(--text-muted);white-space:nowrap;font-weight:600;
        padding:4px 10px;background:var(--bg-hover);border-radius:20px;border:1px solid var(--border-color);">
        ⚙️ إعدادات النظام
      </span>
      <div style="flex:1;height:1px;background:var(--border-color);"></div>`;
    wrap.appendChild(divider);

    // ─── حاوية إعدادات النظام ───
    const adminWrap = document.createElement('div');
    adminWrap.style.cssText = 'display:flex;flex-direction:column;gap:18px;max-width:560px;margin:0 auto;width:100%;';

    const settings  = AppStore.getState('systemSettings');
    const logo      = settings.get('logo')             || {};
    const closeConf = settings.get('daily_close_time') || {};

    /* ═══ 1. شعار النظام ═══ */
    const logoCard = this._buildCard('🖼️ شعار النظام');
    logoCard.innerHTML += `
      <div class="form-group">
        <label class="form-label">رابط الشعار (URL)</label>
        <input id="set-logo-url" type="url" class="form-control" dir="ltr"
          value="${escapeHtml(logo.value || '')}" placeholder="https://example.com/logo.png">
      </div>
      <div class="form-group">
        <label class="form-label">أو رفع ملف صورة من الجهاز</label>
        <input id="set-logo-file" type="file" accept="image/*" class="form-control">
      </div>
      ${logo.value ? `<div style="margin-bottom:12px;">
        <img src="${escapeHtml(logo.value)}" alt="الشعار الحالي"
          style="max-height:64px;max-width:180px;border-radius:8px;object-fit:contain;">
      </div>` : ''}
      <button id="set-logo-save" class="btn btn-primary btn-sm">حفظ الشعار</button>`;
    adminWrap.appendChild(logoCard);

    /* ═══ 2. الإقفال التلقائي ═══ */
    const lockCard = this._buildCard('⏰ الإقفال اليومي التلقائي');
    lockCard.innerHTML += `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <label class="form-label" style="margin:0;flex:1;">تفعيل الإقفال التلقائي</label>
        <input id="set-lock-enabled" type="checkbox" style="width:18px;height:18px;cursor:pointer;"
          ${closeConf.enabled ? 'checked' : ''}>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label">ساعة الإقفال</label>
          <input id="set-lock-hour" type="number" class="form-control" min="0" max="23"
            value="${closeConf.hour ?? 0}" placeholder="0-23">
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label">الدقيقة</label>
          <input id="set-lock-minute" type="number" class="form-control" min="0" max="59"
            value="${closeConf.minute ?? 0}" placeholder="0-59">
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="set-lock-save"   class="btn btn-primary btn-sm">حفظ الإعدادات</button>
        <button id="set-manual-close" class="btn btn-secondary btn-sm">إقفال يدوي الآن</button>
      </div>`;
    adminWrap.appendChild(lockCard);

    /* ═══ 3. النسخ الاحتياطي ═══ */
    const backupCard = this._buildCard('💾 النسخ الاحتياطي والاستعادة');
    backupCard.innerHTML += `
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">
        تصدير جميع بيانات النظام إلى ملف JSON، أو استعادتها من نسخة سابقة.
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px;">
        <button id="set-export-btn" class="btn btn-primary btn-sm">
          <i data-lucide="download" style="width:13px;height:13px;"></i> تصدير نسخة احتياطية
        </button>
        <button id="set-import-trigger" class="btn btn-secondary btn-sm">
          <i data-lucide="upload" style="width:13px;height:13px;"></i> استعادة من ملف
        </button>
      </div>
      <input id="set-import-file" type="file" accept=".json" style="display:none;">
      <div id="set-import-status" style="font-size:0.82rem;color:var(--text-muted);margin-top:6px;"></div>`;
    adminWrap.appendChild(backupCard);

    /* ═══ 4. مصدر البيانات (Data Source Foundation) ═══ */
    const dsCard = this._buildCard('🔌 مصدر البيانات');
    const dsInfo = DataSourceConfig.getInfo();
    dsCard.innerHTML += `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;
        background:var(--bg-hover);border-radius:10px;border:1px solid var(--border-color);margin-bottom:12px;">
        <div style="width:36px;height:36px;border-radius:8px;background:var(--primary);
          display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.1rem;">
          ☁️
        </div>
        <div style="flex:1;">
          <div style="font-weight:700;font-size:0.9rem;">${escapeHtml(dsInfo.label)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${escapeHtml(dsInfo.endpoint)}</div>
        </div>
        <span class="badge badge-success" style="font-size:0.75rem;">نشط</span>
      </div>
      <p style="font-size:0.80rem;color:var(--text-muted);line-height:1.7;margin:0;">
        دعم مزودات سحابية إضافية قيد التطوير.
        ستتاح إمكانية التبديل بين قواعد البيانات في إصدار مستقبلي.
      </p>`;
    adminWrap.appendChild(dsCard);

    wrap.appendChild(adminWrap);
    container.appendChild(wrap);

    this._bindAdminEvents();
    if (window.lucide) lucide.createIcons();
  },

  /* ══════════════════════════════════════════
     بناء بطاقة قسم
  ══════════════════════════════════════════ */
  _buildCard(headerText) {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.marginBottom = '0';
    card.innerHTML = `<h3 style="font-size:0.95rem;font-weight:700;margin-bottom:14px;">${escapeHtml(headerText)}</h3>`;
    return card;
  },

  /* ══════════════════════════════════════════
     ربط أحداث المدير فقط
  ══════════════════════════════════════════ */
  _bindAdminEvents() {
    document.getElementById('set-logo-save')?.addEventListener('click',      () => this._saveLogo());
    document.getElementById('set-lock-save')?.addEventListener('click',      () => this._saveLockSettings());
    document.getElementById('set-manual-close')?.addEventListener('click',   () => this._manualClose());
    document.getElementById('set-export-btn')?.addEventListener('click',     () => this._exportBackup());
    document.getElementById('set-import-trigger')?.addEventListener('click', () => document.getElementById('set-import-file')?.click());
    document.getElementById('set-import-file')?.addEventListener('change',   (e) => this._importBackup(e));
  },

  /* ══════════════════════════════════════════
     حفظ الشعار
  ══════════════════════════════════════════ */
  async _saveLogo() {
    const saveBtn = document.getElementById('set-logo-save');
    const restore = setButtonLoading(saveBtn);
    try {
      const urlInput  = document.getElementById('set-logo-url');
      const fileInput = document.getElementById('set-logo-file');
      let logoValue = '';
      let logoType  = 'url';

      if (fileInput?.files?.length) {
        const file     = fileInput.files[0];
        const fileName = `logo_${Date.now()}.${file.name.split('.').pop()}`;
        const { data, error } = await supabaseClient.storage
          .from(APP_CONFIG.LOGO_BUCKET)
          .upload(fileName, file, { upsert: true });
        if (error) { showToast(`فشل الرفع: ${error.message}`, 'error'); return; }
        const { data: { publicUrl } } = supabaseClient.storage
          .from(APP_CONFIG.LOGO_BUCKET)
          .getPublicUrl(fileName);
        logoValue = publicUrl;
        logoType  = 'upload';
      } else {
        logoValue = urlInput?.value.trim() || '';
        if (!logoValue) { showToast('أدخل رابط الشعار أو اختر ملفاً', 'error'); return; }
      }

      const upsertResult = await repo.upsert(TABLES.SYSTEM_SETTINGS, { key: 'logo', value: { type: logoType, value: logoValue } }, 'key');
      if (upsertResult && !isOk(upsertResult)) {
        showToast(`فشل حفظ الشعار: ${upsertResult.error?.message || 'خطأ غير معروف'}`, 'error');
        return;
      }
      showToast('تم حفظ الشعار بنجاح', 'success');
      await AppStore.refreshData();
    } catch (e) {
      showToast(`خطأ: ${e.message}`, 'error');
    } finally {
      restore();
    }
  },

  /* ══════════════════════════════════════════
     حفظ إعدادات الإقفال
  ══════════════════════════════════════════ */
  async _saveLockSettings() {
    const enabled = document.getElementById('set-lock-enabled')?.checked || false;
    const hour    = parseInt(document.getElementById('set-lock-hour')?.value) || 0;
    const minute  = parseInt(document.getElementById('set-lock-minute')?.value) || 0;

    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      showToast('قيم الساعة أو الدقيقة خارج النطاق المسموح', 'error'); return;
    }

    const saveBtn = document.getElementById('set-lock-save');
    const restore = setButtonLoading(saveBtn);

    try {
      const settings = AppStore.getState('systemSettings');
      const current  = settings.get('daily_close_time') || {};
      const updated  = { ...current, enabled, hour, minute };
      await repo.upsert(TABLES.SYSTEM_SETTINGS, { key: 'daily_close_time', value: updated }, 'key');
      showToast(enabled ? `تم تفعيل الإقفال التلقائي (${hour}:${String(minute).padStart(2,'0')})` : 'تم تعطيل الإقفال التلقائي', 'success');
      await AppStore.refreshData();
    } catch (e) {
      showToast(`خطأ: ${e.message}`, 'error');
    } finally {
      restore();
    }
  },

  /* ══════════════════════════════════════════
     إقفال يدوي
  ══════════════════════════════════════════ */
  async _manualClose() {
    const confirmed = await confirmDialog(
      'تنفيذ الإقفال اليومي الآن؟ سيُحسب ملخص اليوم وتُقفل العمليات.',
      'تنفيذ', 'إلغاء', 'warning'
    );
    if (!confirmed) return;

    const btn     = document.getElementById('set-manual-close');
    const restore = setButtonLoading(btn, 'جاري الإقفال...');
    const result  = await callRPC('perform_daily_close', { p_date: new Date().toISOString().split('T')[0] });
    restore();

    isOk(result)
      ? showToast('تم الإقفال اليومي بنجاح', 'success')
      : showToast(`فشل الإقفال: ${result.error}`, 'error');
  },

  /* ══════════════════════════════════════════
     تصدير نسخة احتياطية
  ══════════════════════════════════════════ */
  async _exportBackup() {
    const btn     = document.getElementById('set-export-btn');
    const restore = setButtonLoading(btn, 'جاري التصدير...');
    try {
      const tables = [
        TABLES.USERS, TABLES.TRANSACTIONS, TABLES.ACCOUNT_LEDGER,
        TABLES.ACCOUNT_BALANCES, TABLES.DEBTORS, TABLES.COMPANIES,
        TABLES.BANK_ACCOUNTS, TABLES.EXPENSE_ACCOUNTS, TABLES.NOTIFICATIONS,
        TABLES.FAILED_DEPOSITS, TABLES.SYSTEM_SETTINGS,
      ];
      // أعمدة يُستبعد تصديرها لأسباب أمنية (key: اسم الجدول، value: أعمدة آمنة فقط)
      const SAFE_COLUMNS = {
        [TABLES.USERS]: 'id,email,display_name,role,is_active,allowed_tabs,avatar_url,created_at,updated_at',
      };

      const backup = { version: APP_CONFIG.VERSION, exportedAt: new Date().toISOString(), tables: {} };
      for (const table of tables) {
        const cols = SAFE_COLUMNS[table] || '*';
        const { data } = await supabaseClient.from(table).select(cols);
        backup.tables[table] = data || [];
      }
      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `ahu_backup_${new Date().toLocaleDateString('en-CA')}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    } catch (e) {
      showToast(`فشل التصدير: ${e.message}`, 'error');
    } finally {
      restore();
    }
  },

  /* ══════════════════════════════════════════
     استعادة نسخة احتياطية
  ══════════════════════════════════════════ */
  async _importBackup(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const statusEl = document.getElementById('set-import-status');
    const confirmed = await confirmDialog(
      'استعادة نسخة احتياطية ستُدمج البيانات مع الموجودة. هل تريد المتابعة؟',
      'متابعة', 'إلغاء', 'danger'
    );
    if (!confirmed) { event.target.value = ''; return; }

    try {
      if (statusEl) statusEl.textContent = 'جاري قراءة الملف...';
      const text   = await file.text();
      const backup = JSON.parse(text);

      if (!backup.tables || !backup.version) {
        showToast('الملف غير صالح', 'error'); return;
      }

      // جداول ذات مفتاح أساسي مختلف عن 'id'
      const PK_MAP = { system_settings: 'key', cache_meta: 'key', account_balances: 'account_id' };

      let total = 0;
      for (const [table, records] of Object.entries(backup.tables)) {
        if (!records?.length) continue;
        if (statusEl) statusEl.textContent = `جاري استعادة: ${table}...`;
        const conflictCol = PK_MAP[table] || 'id';
        const bs = 50;
        for (let i = 0; i < records.length; i += bs) {
          await supabaseClient.from(table).upsert(records.slice(i, i+bs), { onConflict: conflictCol });
          total += Math.min(bs, records.length - i);
        }
      }

      if (statusEl) statusEl.textContent = '';
      showToast(`تمت الاستعادة — ${total} سجل`, 'success');
      await AppStore.refreshData();
    } catch (e) {
      showToast(`فشل الاستعادة: ${e.message}`, 'error');
      if (statusEl) statusEl.textContent = '';
    } finally {
      event.target.value = '';
    }
  },

};

window.SettingsComponent = SettingsComponent;
console.log('✅ SettingsComponent.js v3.0 محمّل — يعمل لجميع المستخدمين');
