/**
 * components/SettingsComponent.js
 * نظام أبو حذيفة — الإعدادات (للمدير فقط)
 * رفع شعار + إقفال تلقائي + نسخ احتياطي كامل + استعادة
 */
'use strict';

const SettingsComponent = {

  async render(container) {
    if (!AuthService.isAdmin()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">الإعدادات للمدير فقط</div></div>`;
      return;
    }

    const settings  = AppStore.getState('systemSettings');
    const logo      = settings.get('logo')             || {};
    const autoLock  = settings.get('auto_lock')        || {};
    const closeConf = settings.get('daily_close_time') || {};

    container.innerHTML = '';
    const wrap = document.createElement('div');

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);margin-bottom:24px;';
    title.textContent = 'الإعدادات';
    wrap.appendChild(title);

    /* ══════════════════════════════════════════
       1. شعار النظام
    ══════════════════════════════════════════ */
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

    wrap.appendChild(logoCard);

    /* ══════════════════════════════════════════
       2. الإقفال التلقائي
    ══════════════════════════════════════════ */
    const lockCard = this._buildCard('⏰ الإقفال اليومي التلقائي');
    lockCard.innerHTML += `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <label class="form-label" style="margin:0;flex:1;">تفعيل الإقفال التلقائي</label>
        <input id="set-lock-enabled" type="checkbox" style="width:18px;height:18px;cursor:pointer;"
          ${closeConf.enabled ? 'checked' : ''}>
      </div>
      <div class="form-group">
        <label class="form-label">وقت الإقفال (بتوقيت السعودية)</label>
        <input id="set-lock-hour" type="time" class="form-control"
          value="${String(closeConf.hour || 0).padStart(2,'0')}:${String(closeConf.minute || 0).padStart(2,'0')}">
      </div>
      <div style="margin-bottom:12px;font-size:0.85rem;color:var(--text-muted);">
        آخر إقفال: <strong>${escapeHtml(closeConf.lastClosedDate || '—')}</strong>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button id="set-lock-save" class="btn btn-primary btn-sm">حفظ الإعدادات</button>
        <button id="set-manual-close" class="btn btn-secondary btn-sm" style="color:var(--warning);">
          <i data-lucide="lock" style="width:14px;height:14px"></i> إقفال يدوي للأمس
        </button>
      </div>`;

    wrap.appendChild(lockCard);

    /* ══════════════════════════════════════════
       3. النسخ الاحتياطي
    ══════════════════════════════════════════ */
    const backupCard = this._buildCard('💾 النسخ الاحتياطي والاستعادة');
    backupCard.innerHTML += `
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:14px;">
        تصدير جميع بيانات النظام إلى ملف JSON يمكن استعادته لاحقاً.
      </p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">
        <button id="set-export-btn" class="btn btn-primary btn-sm">
          <i data-lucide="download" style="width:14px;height:14px"></i> تصدير النسخة الاحتياطية
        </button>
        <button id="set-import-trigger" class="btn btn-secondary btn-sm">
          <i data-lucide="upload" style="width:14px;height:14px"></i> استعادة نسخة احتياطية
        </button>
      </div>
      <input id="set-import-file" type="file" accept=".json" style="display:none;">
      <div id="set-import-status" style="font-size:0.82rem;color:var(--text-muted);"></div>`;

    wrap.appendChild(backupCard);

    /* ══════════════════════════════════════════
       4. الدخول السريع
    ══════════════════════════════════════════ */
    const qCard = this._buildCard('⚡ الدخول السريع');
    qCard.innerHTML += `
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">
        يمكنك تفعيل الدخول السريع بمعادلة رياضية (مثال: 12+88).
        تُستخدم نتيجة المعادلة للدخول السريع بدلاً من كلمة المرور.
      </p>
      <div class="form-group">
        <label class="form-label">معادلة الدخول السريع</label>
        <input id="set-quick-eq" type="text" class="form-control" dir="ltr"
          placeholder="مثال: 12+88 أو 100*2">
      </div>
      <div id="set-quick-preview" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;"></div>
      <button id="set-quick-save" class="btn btn-primary btn-sm">تفعيل الدخول السريع</button>`;

    wrap.appendChild(backupCard);
    wrap.appendChild(qCard);
    container.appendChild(wrap);

    /* ── ربط الأحداث ── */
    this._bindEvents();
    if (window.lucide) lucide.createIcons();
  },

  /* ── بناء بطاقة قسم ── */
  _buildCard(headerText) {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.marginBottom = '20px';
    card.innerHTML = `<h3 style="font-size:0.95rem;font-weight:700;margin-bottom:14px;">${escapeHtml(headerText)}</h3>`;
    return card;
  },

  /* ── ربط أحداث الأزرار ── */
  _bindEvents() {
    document.getElementById('set-logo-save')?.addEventListener('click',       () => this._saveLogo());
    document.getElementById('set-lock-save')?.addEventListener('click',       () => this._saveLockSettings());
    document.getElementById('set-manual-close')?.addEventListener('click',    () => this._manualClose());
    document.getElementById('set-export-btn')?.addEventListener('click',      () => this._exportBackup());
    document.getElementById('set-import-trigger')?.addEventListener('click',  () => document.getElementById('set-import-file')?.click());
    document.getElementById('set-import-file')?.addEventListener('change',    (e) => this._importBackup(e));

    /* معاينة معادلة الدخول السريع */
    document.getElementById('set-quick-eq')?.addEventListener('input', (e) => {
      const preview = document.getElementById('set-quick-preview');
      if (!preview) return;
      try {
        const parser = new window.exprEval.Parser();
        const result = parser.evaluate(e.target.value.trim());
        preview.textContent = `النتيجة: ${result}`;
        preview.style.color = 'var(--success)';
      } catch {
        preview.textContent = 'معادلة غير صالحة';
        preview.style.color = 'var(--danger)';
      }
    });

    document.getElementById('set-quick-save')?.addEventListener('click', () => this._saveQuickLogin());
  },

  /* ── حفظ الشعار ── */
  async _saveLogo() {
    const saveBtn = document.getElementById('set-logo-save');
    const restore = setButtonLoading(saveBtn);

    try {
      const urlInput  = document.getElementById('set-logo-url');
      const fileInput = document.getElementById('set-logo-file');

      let logoValue = '';
      let logoType  = 'url';

      if (fileInput?.files?.length) {
        /* رفع الملف إلى Supabase Storage */
        const file     = fileInput.files[0];
        const fileName = `logo_${Date.now()}.${file.name.split('.').pop()}`;

        if (isOnline()) {
          const { data, error } = await supabaseClient.storage
            .from('logos')
            .upload(fileName, file, { upsert: true });

          if (error) { showToast(`فشل رفع الصورة: ${error.message}`, 'error'); return; }

          const { data: urlData } = supabaseClient.storage.from('logos').getPublicUrl(fileName);
          logoValue = urlData?.publicUrl || '';
          logoType  = 'upload';
        } else {
          showToast('يجب الاتصال بالإنترنت لرفع الصورة', 'warning');
          return;
        }
      } else if (urlInput?.value.trim()) {
        logoValue = urlInput.value.trim();
        logoType  = 'url';
      } else {
        showToast('أدخل رابطاً أو اختر ملفاً', 'warning');
        return;
      }

      const logoData = { type: logoType, value: logoValue };
      const result   = await repo.upsert(TABLES.SYSTEM_SETTINGS, {
        key       : 'logo',
        value     : logoData,
        updated_at: new Date().toISOString(),
      }, ['key']);

      if (isOk(result)) {
        await setLocalSetting('logo', logoData);
        await AppStore.refreshData();
        /* تحديث الشعار في الهيدر فوراً */
        const headerLogo = document.getElementById('header-logo');
        if (headerLogo) { headerLogo.src = logoValue; headerLogo.style.display = 'block'; }
        showToast('تم حفظ الشعار بنجاح', 'success');
      } else {
        showToast(`فشل الحفظ: ${result.error}`, 'error');
      }
    } finally {
      restore();
    }
  },

  /* ── حفظ إعدادات الإقفال ── */
  async _saveLockSettings() {
    const enabled = document.getElementById('set-lock-enabled')?.checked || false;
    const timeVal = document.getElementById('set-lock-hour')?.value || '00:00';
    const [hour, minute] = timeVal.split(':').map(Number);

    const settings = AppStore.getState('systemSettings');
    const existing = settings.get('daily_close_time') || {};

    const data = { ...existing, enabled, hour: hour || 0, minute: minute || 0 };
    const result = await repo.upsert(TABLES.SYSTEM_SETTINGS, {
      key: 'daily_close_time', value: data, updated_at: new Date().toISOString(),
    }, ['key']);

    if (isOk(result)) {
      await setLocalSetting('daily_close_time', data);
      showToast('تم حفظ إعدادات الإقفال', 'success');
    } else {
      showToast(`فشل: ${result.error}`, 'error');
    }
  },

  /* ── إقفال يدوي ── */
  async _manualClose() {
    const btn     = document.getElementById('set-manual-close');
    const restore = setButtonLoading(btn, 'جاري الإقفال...');
    const result  = await AccountingService.dailyClose();
    restore();
    if (!isOk(result)) showToast(`فشل الإقفال: ${result.error}`, 'error');
  },

  /* ── تصدير نسخة احتياطية ── */
  async _exportBackup() {
    const btn     = document.getElementById('set-export-btn');
    const restore = setButtonLoading(btn, 'جاري التصدير...');

    try {
      const backup = {
        version    : '1.0',
        exportedAt : new Date().toISOString(),
        tables     : {},
      };

      const tablesToExport = [
        TABLES.USERS, TABLES.COMPANIES, TABLES.EXPENSE_ACCOUNTS,
        TABLES.BANK_ACCOUNTS, TABLES.DEBTORS, TABLES.TRANSACTIONS,
        TABLES.FAILED_DEPOSITS, TABLES.ACCOUNT_BALANCES, TABLES.SYSTEM_SETTINGS,
      ];

      for (const table of tablesToExport) {
        const { data } = await supabaseClient.from(table).select('*');
        backup.tables[table] = data || [];
      }

      const json    = JSON.stringify(backup, null, 2);
      const blob    = new Blob([json], { type: 'application/json' });
      const url     = URL.createObjectURL(blob);
      const date    = getCurrentSaudiDate().replace(/-/g,'');
      const anchor  = document.createElement('a');
      anchor.href     = url;
      anchor.download = `abu_hudhaifa_backup_${date}.json`;
      anchor.click();
      URL.revokeObjectURL(url);

      showToast(`تم تصدير النسخة الاحتياطية بنجاح (${tablesToExport.length} جدول)`, 'success');
    } catch (e) {
      showToast(`فشل التصدير: ${e.message}`, 'error');
    } finally {
      restore();
    }
  },

  /* ── استعادة نسخة احتياطية ── */
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
        showToast('الملف غير صالح — يجب أن يكون ملف نسخة احتياطية من نظام أبو حذيفة', 'error');
        return;
      }

      let totalImported = 0;
      for (const [table, records] of Object.entries(backup.tables)) {
        if (!records?.length) continue;
        if (statusEl) statusEl.textContent = `جاري استعادة: ${table}...`;

        /* إدراج دفعات (upsert) */
        const batchSize = 50;
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize);
          await supabaseClient.from(table).upsert(batch, { onConflict: 'id' });
          totalImported += batch.length;
        }
      }

      if (statusEl) statusEl.textContent = '';
      showToast(`تمت الاستعادة بنجاح — ${totalImported} سجل`, 'success');
      await AppStore.refreshData();
    } catch (e) {
      showToast(`فشل الاستعادة: ${e.message}`, 'error');
      if (statusEl) statusEl.textContent = '';
    } finally {
      event.target.value = '';
    }
  },

  /* ── تفعيل الدخول السريع ── */
  async _saveQuickLogin() {
    const equation = document.getElementById('set-quick-eq')?.value.trim();
    if (!equation) { showToast('أدخل معادلة أولاً', 'warning'); return; }

    const btn     = document.getElementById('set-quick-save');
    const restore = setButtonLoading(btn);
    const result  = await AuthService.enableQuickLogin(equation);
    restore();

    if (isOk(result)) {
      showToast('تم تفعيل الدخول السريع بنجاح. احتفظ بمعادلتك!', 'success');
      document.getElementById('set-quick-eq').value = '';
      document.getElementById('set-quick-preview').textContent = '';
    } else {
      showToast(`فشل: ${result.error}`, 'error');
    }
  },
};

window.SettingsComponent = SettingsComponent;
console.log('✅ SettingsComponent.js محمّل');
