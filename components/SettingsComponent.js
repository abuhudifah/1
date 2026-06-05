/**
 * components/SettingsComponent.js — v2.0
 * نظام أبو حذيفة — الإعدادات (للمدير فقط)
 * رفع شعار + إقفال تلقائي + نسخ احتياطي + استعادة + دخول سريع
 * ✅ إضافة: قسم "إعادة ضبط البيانات المحلية" (للمدير فقط)
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
       3. النسخ الاحتياطي والاستعادة
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
        تفعيل الدخول السريع بمعادلة رياضية (مثال: 12+88).
        تُستخدم نتيجة المعادلة للدخول السريع بدلاً من كلمة المرور.
      </p>
      <div class="form-group">
        <label class="form-label">معادلة الدخول السريع</label>
        <input id="set-quick-eq" type="text" class="form-control" dir="ltr"
          placeholder="مثال: 12+88 أو 100*2">
      </div>
      <div id="set-quick-preview" style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;"></div>
      <button id="set-quick-save" class="btn btn-primary btn-sm">تفعيل الدخول السريع</button>`;
    wrap.appendChild(qCard);

    /* ══════════════════════════════════════════
       5. ✅ إعادة ضبط البيانات المحلية (جديد)
    ══════════════════════════════════════════ */
    const resetCard = this._buildCard('🗑️ إعادة ضبط البيانات المحلية');
    resetCard.innerHTML += `
      <div style="padding:12px 14px;background:rgba(220,38,38,0.06);
        border:1px solid rgba(220,38,38,0.18);border-radius:10px;margin-bottom:16px;">
        <p style="font-size:0.85rem;font-weight:700;color:var(--danger);margin-bottom:6px;">
          ⚠️ تحذير: هذا الإجراء لا يمكن التراجع عنه على هذا الجهاز
        </p>
        <ul style="font-size:0.80rem;color:var(--text-secondary);line-height:1.8;padding-right:16px;margin:0;">
          <li>يحذف جميع بيانات <strong>IndexedDB (Dexie)</strong> من هذا الجهاز فقط.</li>
          <li>يمسح <strong>localStorage</strong> و<strong>sessionStorage</strong> (مع الاحتفاظ بإعداد الثيم).</li>
          <li>لا يتأثر أي بيانات في <strong>Supabase</strong>.</li>
          <li>لا تتأثر أجهزة المستخدمين الآخرين.</li>
          <li>بعد الضبط ستُعاد تهيئة قاعدة البيانات المحلية تلقائياً.</li>
        </ul>
      </div>
      <button id="set-reset-local-btn"
        class="btn btn-sm"
        style="background:rgba(220,38,38,0.08);color:var(--danger);
               border:1px solid rgba(220,38,38,0.25);display:flex;align-items:center;gap:6px;">
        <i data-lucide="trash-2" style="width:14px;height:14px;"></i>
        إعادة ضبط البيانات المحلية لهذا الجهاز
      </button>`;
    wrap.appendChild(resetCard);

    container.appendChild(wrap);

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
    document.getElementById('set-logo-save')?.addEventListener('click',      () => this._saveLogo());
    document.getElementById('set-lock-save')?.addEventListener('click',      () => this._saveLockSettings());
    document.getElementById('set-manual-close')?.addEventListener('click',   () => this._manualClose());
    document.getElementById('set-export-btn')?.addEventListener('click',     () => this._exportBackup());
    document.getElementById('set-import-trigger')?.addEventListener('click', () => document.getElementById('set-import-file')?.click());
    document.getElementById('set-import-file')?.addEventListener('change',   (e) => this._importBackup(e));
    document.getElementById('set-reset-local-btn')?.addEventListener('click',() => this._resetLocalData());

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

  /* ══════════════════════════════════════════
     دوال الحفظ والتصدير
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
        if (isOnline()) {
          const { data, error } = await supabaseClient.storage
            .from('logos').upload(fileName, file, { upsert: true });
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
        key: 'logo', value: logoData, updated_at: new Date().toISOString(),
      }, ['key']);

      if (isOk(result)) {
        await AppStore.refreshData();
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

  async _saveLockSettings() {
    const enabled = document.getElementById('set-lock-enabled')?.checked || false;
    const timeVal = document.getElementById('set-lock-hour')?.value || '00:00';
    const [hour, minute] = timeVal.split(':').map(Number);

    const settings = AppStore.getState('systemSettings');
    const existing = settings.get('daily_close_time') || {};
    const data     = { ...existing, enabled, hour: hour || 0, minute: minute || 0 };

    const result = await repo.upsert(TABLES.SYSTEM_SETTINGS, {
      key: 'daily_close_time', value: data, updated_at: new Date().toISOString(),
    }, ['key']);

    if (isOk(result)) {
      showToast('تم حفظ إعدادات الإقفال', 'success');
    } else {
      showToast(`فشل: ${result.error}`, 'error');
    }
  },

  async _manualClose() {
    const btn     = document.getElementById('set-manual-close');
    const restore = setButtonLoading(btn, 'جاري الإقفال...');
    const result  = await AccountingService.dailyClose();
    restore();
    if (!isOk(result)) showToast(`فشل الإقفال: ${result.error}`, 'error');
    else showToast('تم الإقفال اليومي بنجاح', 'success');
  },

  async _exportBackup() {
    const btn     = document.getElementById('set-export-btn');
    const restore = setButtonLoading(btn, 'جاري التصدير...');
    try {
      const tables = [
        TABLES.TRANSACTIONS, TABLES.USERS, TABLES.BANK_ACCOUNTS,
        TABLES.DEBTORS, TABLES.FAILED_DEPOSITS, TABLES.NOTIFICATIONS,
        TABLES.ACCOUNT_LEDGER, TABLES.ACCOUNT_BALANCES,
        TABLES.DAILY_CLOSINGS, TABLES.SYSTEM_SETTINGS,
        TABLES.COMPANIES, TABLES.EXPENSE_ACCOUNTS,
      ];

      const backup = { version: '2.0', exportedAt: new Date().toISOString(), tables: {} };

      for (const table of tables) {
        const { data } = await supabaseClient.from(table).select('*');
        backup.tables[table] = data || [];
      }

      const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `abu_hudhaifa_backup_${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      showToast('تم تصدير النسخة الاحتياطية بنجاح', 'success');
    } catch (e) {
      showToast(`فشل التصدير: ${e.message}`, 'error');
    } finally {
      restore();
    }
  },

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

  /* ══════════════════════════════════════════
     ✅ إعادة ضبط البيانات المحلية
  ══════════════════════════════════════════ */

  /**
   * يحذف جميع بيانات IndexedDB وlocalStorage وsessionStorage
   * من هذا الجهاز فقط — لا يمس Supabase ولا أجهزة الآخرين
   */
  async _resetLocalData() {
    if (!AuthService.isAdmin()) return;

    /* تأكيد أول */
    const confirmed1 = await confirmDialog(
      'هل أنت متأكد من إعادة ضبط البيانات المحلية لهذا الجهاز؟\n\n' +
      '• سيتم حذف جميع بيانات IndexedDB وlocalStorage وsessionStorage.\n' +
      '• لن تتأثر بيانات Supabase ولا أجهزة المستخدمين الآخرين.\n' +
      '• ستُعاد تهيئة قاعدة البيانات المحلية تلقائياً بعد إعادة التحميل.',
      'نعم، أعد الضبط', 'إلغاء', 'danger'
    );
    if (!confirmed1) return;

    /* تأكيد ثانٍ للحماية من النقر الخاطئ */
    const confirmed2 = await confirmDialog(
      '⚠️ تأكيد نهائي: سيُمسح كل شيء محلياً ثم تُعاد تهيئة الصفحة.',
      'حذف وإعادة تحميل', 'إلغاء', 'danger'
    );
    if (!confirmed2) return;

    const btn     = document.getElementById('set-reset-local-btn');
    if (btn) {
      btn.disabled     = true;
      btn.textContent  = '⏳ جاري الحذف...';
      btn.style.opacity = '0.7';
    }

    try {
      /* 1. حذف كل جداول Dexie */
      if (typeof db !== 'undefined') {
        const tableNames = [
          'transactions', 'users', 'bank_accounts', 'debtors',
          'failed_deposits', 'notifications', 'audit_logs',
          'account_ledger', 'account_balances', 'daily_closings',
          'system_settings', 'companies', 'expense_accounts',
          'sync_queue', 'sync_conflicts', 'cache_meta',
        ];
        try {
          if (db.isOpen()) {
            await Promise.allSettled(tableNames.map(t => db[t]?.clear?.()));
            db.close();
          }
        } catch (dexieErr) {
          console.warn('⚠️ SettingsComponent: خطأ في مسح Dexie:', dexieErr.message);
        }
      }

      /* 2. مسح localStorage مع الاحتفاظ بإعداد الثيم فقط */
      const savedTheme = localStorage.getItem('abu_theme');
      try { localStorage.clear(); } catch { /* تجاهل */ }
      if (savedTheme) {
        try { localStorage.setItem('abu_theme', savedTheme); } catch { /* تجاهل */ }
      }

      /* 3. مسح sessionStorage */
      try { sessionStorage.clear(); } catch { /* تجاهل */ }

      showToast('✅ تم مسح البيانات المحلية. جاري إعادة التحميل...', 'success', 2500);

      /* 4. إعادة تحميل الصفحة بعد 2.5 ثانية */
      setTimeout(() => window.location.reload(), 2500);

    } catch (e) {
      console.error('❌ SettingsComponent._resetLocalData():', e);
      if (btn) {
        btn.disabled    = false;
        btn.textContent = 'إعادة ضبط البيانات المحلية لهذا الجهاز';
        btn.style.opacity = '1';
      }
      showToast(`فشل إعادة الضبط: ${e.message}`, 'error');
    }
  },

};

window.SettingsComponent = SettingsComponent;
console.log('✅ SettingsComponent.js v2.0 محمّل — مع قسم إعادة ضبط البيانات المحلية');
