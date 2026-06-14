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

    /* ═══ 4. إعادة ضبط البيانات التشغيلية ═══ */
    const resetCard = this._buildCard('⚠️ إعادة ضبط البيانات التشغيلية');
    resetCard.innerHTML += `
      <div style="background:rgba(220,38,38,0.06);border:1px solid rgba(220,38,38,0.20);
        border-radius:10px;padding:12px 14px;margin-bottom:14px;">
        <p style="font-size:0.83rem;color:var(--danger);font-weight:600;margin:0 0 6px;">
          ⚠️ تحذير: هذه العملية لا يمكن التراجع عنها
        </p>
        <p style="font-size:0.80rem;color:var(--text-secondary);margin:0;line-height:1.6;">
          يتم حذف جميع العمليات (معاملات، إيداعات، سحوبات، حسابات بنكية، شركات، مديونيات، إقفالات يومية)
          من Supabase ومن جميع الأجهزة المتصلة. <strong>يُحتفظ بالمستخدمين وإعدادات النظام.</strong>
        </p>
      </div>
      <button id="set-reset-data-btn" class="btn btn-sm"
        style="background:rgba(220,38,38,0.12);border:1px solid rgba(220,38,38,0.35);
               color:var(--danger);font-weight:700;gap:6px;">
        <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
        إعادة ضبط جميع البيانات التشغيلية
      </button>`;
    adminWrap.appendChild(resetCard);

    /* ═══ 5. مصدر البيانات (Data Source Foundation) ═══ */
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

    /* ═══ 6. تعارضات المزامنة (للمدير فقط) ═══ */
    const conflictsCard = document.createElement('div');
    conflictsCard.className = 'glass-card';
    conflictsCard.style.marginBottom = '0';
    conflictsCard.setAttribute('data-sc-conflicts-card', '');
    conflictsCard.innerHTML = `
      <h3 style="font-size:.95rem;font-weight:700;margin-bottom:14px;
        display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <span>⚠️ تعارضات المزامنة</span>
        <span id="sc-conflicts-badge" style="display:none;
          padding:2px 10px;border-radius:20px;font-size:.73rem;font-weight:700;
          background:rgba(220,38,38,.15);color:#dc2626;border:1px solid rgba(220,38,38,.3);">
        </span>
      </h3>
      <p style="font-size:.83rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
        عمليات فشلت بعد عدة محاولات وتحتاج تدخلاً يدوياً — قبول نسخة الخادم أو فرض نسخة العميل.
      </p>
      <div id="sc-conflicts-list">
        <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:.83rem;">
          ⏳ جاري التحميل...
        </div>
      </div>
      <div id="sc-conflicts-actions" style="display:none;margin-top:12px;gap:10px;flex-wrap:wrap;">
        <button id="sc-conflicts-resolve-all-server" class="btn btn-sm"
          style="background:rgba(34,197,94,.1);color:#16a34a;border:1px solid rgba(34,197,94,.3);font-size:.78rem;">
          ✅ قبول الخادم للكل
        </button>
        <button id="sc-conflicts-clear-all" class="btn btn-sm"
          style="background:rgba(220,38,38,.08);color:#dc2626;border:1px solid rgba(220,38,38,.25);font-size:.78rem;">
          🗑️ حذف جميع التعارضات
        </button>
      </div>`;
    adminWrap.appendChild(conflictsCard);

    wrap.appendChild(adminWrap);
    container.appendChild(wrap);

    this._bindAdminEvents();
    if (window.lucide) lucide.createIcons();
    await this._loadConflicts();
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
    document.getElementById('set-logo-save')?.addEventListener('click',       () => this._saveLogo());
    document.getElementById('set-lock-save')?.addEventListener('click',       () => this._saveLockSettings());
    document.getElementById('set-manual-close')?.addEventListener('click',    () => this._manualClose());
    document.getElementById('set-export-btn')?.addEventListener('click',      () => this._exportBackup());
    document.getElementById('set-import-trigger')?.addEventListener('click',  () => document.getElementById('set-import-file')?.click());
    document.getElementById('set-import-file')?.addEventListener('change',    (e) => this._importBackup(e));
    document.getElementById('set-reset-data-btn')?.addEventListener('click',  () => this._resetAllData());
    document.getElementById('sc-conflicts-resolve-all-server')?.addEventListener('click', () => this._resolveAllConflicts('server'));
    document.getElementById('sc-conflicts-clear-all')?.addEventListener('click', () => this._clearAllConflicts());
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
        const file = fileInput.files[0];

        if (!file.type.startsWith('image/')) {
          showToast('يُرجى اختيار ملف صورة', 'warning'); return;
        }
        if (file.size > 2 * 1024 * 1024) {
          showToast('حجم الصورة كبير جداً (الحد الأقصى 2MB)', 'warning'); return;
        }

        // محاولة الرفع إلى Supabase Storage أولاً
        try {
          const fileName = `logo_${Date.now()}.${file.name.split('.').pop()}`;
          const { error: upErr } = await supabaseClient.storage
            .from(APP_CONFIG.LOGO_BUCKET)
            .upload(fileName, file, { upsert: true });
          if (upErr) throw upErr;
          const { data: { publicUrl } } = supabaseClient.storage
            .from(APP_CONFIG.LOGO_BUCKET)
            .getPublicUrl(fileName);
          logoValue = publicUrl;
          logoType  = 'upload';
        } catch (storageErr) {
          // Storage غير متاح أو لا يوجد bucket → نحوّل إلى Base64
          console.warn('⚠️ Storage upload failed, using Base64 fallback:', storageErr.message);
          logoValue = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload  = (e) => resolve(e.target.result);
            reader.onerror = ()  => reject(new Error('فشل قراءة الملف'));
            reader.readAsDataURL(file);
          });
          logoType = 'base64';
        }
      } else {
        logoValue = urlInput?.value.trim() || '';
        if (!logoValue) { showToast('أدخل رابط الشعار أو اختر ملفاً', 'error'); return; }
      }

      const upsertResult = await repo.upsert(TABLES.SYSTEM_SETTINGS, { key: 'logo', value: { type: logoType, value: logoValue } }, 'key');
      if (upsertResult && !isOk(upsertResult)) {
        showToast(`فشل حفظ الشعار: ${upsertResult.error?.message || 'خطأ غير معروف'}`, 'error');
        return;
      }
      showToast('✅ تم حفظ الشعار بنجاح', 'success');
      await AppStore.refreshData();
    } catch (e) {
      showToast(`خطأ: ${e.message}`, 'error');
      console.error('❌ _saveLogo:', e);
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

  /* ══════════════════════════════════════════
     إعادة ضبط جميع البيانات التشغيلية
     (تسلسل أمان مزدوج: تأكيد نصي + RPC + system_commands + إعادة تحميل)
  ══════════════════════════════════════════ */
  async _resetAllData() {
    // خطوة 1: تأكيد أول
    const first = await confirmDialog(
      '⚠️ سيتم حذف جميع البيانات التشغيلية (معاملات، دفتر الأستاذ، أرصدة الحسابات، إقفالات، ودائع فاشلة، إشعارات، سجل التدقيق، طابور المزامنة) من Supabase وجميع الأجهزة. المستخدمون وإعدادات النظام والشركات والحسابات البنكية والمديونيات لن تُمس. لا يمكن التراجع عن هذا.',
      'تأكيد أول — متابعة', 'إلغاء', 'warning'
    );
    if (!first) return;

    // خطوة 2: تأكيد ثانٍ بنص صريح
    const code  = 'إعادة الضبط';
    const typed = window.prompt(`⚠️ تأكيد نهائي: اكتب "${code}" بالضبط للمتابعة:`);
    if (typed !== code) {
      showToast('تم الإلغاء — النص غير مطابق', 'info');
      return;
    }

    const btn = document.getElementById('set-reset-data-btn');
    setButtonLoading(btn, 'جاري إعادة الضبط...');

    try {
      const userId = AppStore.getState('currentUser')?.id;

      // خطوة 3: حذف البيانات التشغيلية من Supabase عبر RPC (SECURITY DEFINER)
      showToast('جاري حذف البيانات من السحابة...', 'info');
      const { error: rpcError } = await supabaseClient.rpc(RPC.RESET_ALL_OPERATIONAL_DATA);
      if (rpcError) {
        showToast(`فشل حذف البيانات: ${rpcError.message}`, 'error');
        if (btn) btn.disabled = false;
        return;
      }

      // خطوة 4: إيقاف خدمات المزامنة قبل مسح Dexie
      try {
        if (typeof SyncQueue   !== 'undefined') SyncQueue.clearRetryTimers();
        if (typeof SyncService !== 'undefined') SyncService.stop();
      } catch (_e) { /* non-critical */ }

      // خطوة 5: نشر أمر RESET لباقي الأجهزة
      const { error: cmdError } = await supabaseClient
        .from(TABLES.SYSTEM_COMMANDS)
        .insert({
          command   : 'RESET_ALL_DATA',
          issued_by : userId,
          note      : `إعادة ضبط يدوية بواسطة المدير — ${new Date().toLocaleString('ar-SA')}`,
        });
      if (cmdError) {
        console.warn('⚠️ SettingsComponent: فشل إدراج system_commands:', cmdError.message);
      }

      // خطوة 6: مسح قاعدة البيانات المحلية (Dexie) بالكامل
      showToast('جاري مسح قاعدة البيانات المحلية...', 'info');
      if (window.db) {
        try {
          await db.delete();
          await db.open();
          console.log('✅ Dexie: أُعيدت تهيئتها بعد إعادة الضبط');
        } catch (dexieErr) {
          console.warn('⚠️ Dexie delete/reopen:', dexieErr.message);
        }
      }

      // خطوة 7: مسح كاش localStorage التشغيلي (تفضيلات العرض المرتبطة بالبيانات المحذوفة)
      this._clearLocalCaches();

      showToast('✅ تمت إعادة الضبط بنجاح — سيُعاد تحميل النظام...', 'success', 3000);

      // خطوة 8: إعادة تحميل الصفحة لضمان حالة نظيفة تماماً
      setTimeout(() => window.location.reload(), 2500);

    } catch (e) {
      showToast(`خطأ غير متوقع: ${e.message}`, 'error');
      console.error('❌ _resetAllData:', e);
      if (btn) btn.disabled = false;
    }
  },

  /* ══════════════════════════════════════════
     مسح كاش localStorage التشغيلي
     يُحافظ على: الثيم، بيانات المصادقة (quick_login، device_id، offline_session)
  ══════════════════════════════════════════ */
  _clearLocalCaches() {
    try {
      // تفضيل فلتر كشف الحساب (يشير إلى فترات زمنية لبيانات محذوفة)
      localStorage.removeItem('ahu_stmt_filter_pref');
      // بانر الدخول السريع — إعادة الظهور بعد الضبط
      localStorage.removeItem('ahu_quick_banner_dismissed');
      // البنوك المفضلة لجميع المستخدمين (favBanks_<userId>)
      const toRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('favBanks_')) toRemove.push(k);
      }
      toRemove.forEach(k => localStorage.removeItem(k));
      console.log('🧹 SettingsComponent: تم مسح كاش localStorage التشغيلي');
    } catch (e) {
      console.warn('⚠️ _clearLocalCaches:', e.message);
    }
  },

  /* ══════════════════════════════════════════
     تحميل التعارضات وعرضها
  ══════════════════════════════════════════ */
  async _loadConflicts() {
    const listEl    = document.getElementById('sc-conflicts-list');
    const badgeEl   = document.getElementById('sc-conflicts-badge');
    const actionsEl = document.getElementById('sc-conflicts-actions');
    if (!listEl) return;

    try {
      const conflicts = await SyncQueue.getUnresolvedConflicts();

      if (badgeEl) {
        badgeEl.textContent   = conflicts.length > 0 ? `${conflicts.length} تعارض` : '';
        badgeEl.style.display = conflicts.length > 0 ? '' : 'none';
      }
      if (actionsEl) {
        actionsEl.style.display = conflicts.length > 0 ? 'flex' : 'none';
      }

      if (conflicts.length === 0) {
        listEl.innerHTML = `
          <div style="text-align:center;padding:20px;color:var(--text-muted);font-size:.83rem;">
            ✅ لا توجد تعارضات معلقة
          </div>`;
        return;
      }

      const TABLE_LABELS = {
        transactions    : 'معاملات',
        failed_deposits : 'إيداعات فاشلة',
        debtors         : 'مديونيات',
        notifications   : 'إشعارات',
      };

      listEl.innerHTML = '';
      conflicts.forEach(c => {
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:10px 12px;
          border:1px solid var(--border-color);border-radius:8px;margin-bottom:8px;
          background:var(--bg-secondary);flex-wrap:wrap;`;

        const tLabel  = TABLE_LABELS[c.table_name] || escapeHtml(c.table_name || '');
        const dateStr = c.created_at
          ? new Date(c.created_at).toLocaleString('ar-SA', { dateStyle: 'short', timeStyle: 'short' })
          : '';

        row.innerHTML = `
          <div style="flex:1;min-width:0;">
            <div style="font-size:.82rem;font-weight:600;color:var(--text-primary);
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
              ${escapeHtml(tLabel)} — ${escapeHtml(String(c.record_id || c.operation_id || c.id))}
            </div>
            <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px;">
              ${escapeHtml(c.reason || '')}${dateStr ? ` · ${dateStr}` : ''}
            </div>
          </div>
          <button class="btn btn-sm" data-cid="${c.id}" data-action="view"
            style="font-size:.73rem;padding:3px 9px;background:var(--bg-hover);
              border:1px solid var(--border-color);color:var(--text-secondary);">
            عرض
          </button>
          <button class="btn btn-sm" data-cid="${c.id}" data-action="server"
            style="font-size:.73rem;padding:3px 9px;
              background:rgba(34,197,94,.1);color:#16a34a;border:1px solid rgba(34,197,94,.3);">
            ✅ خادم
          </button>
          <button class="btn btn-sm" data-cid="${c.id}" data-action="client"
            style="font-size:.73rem;padding:3px 9px;
              background:rgba(59,130,246,.1);color:#2563eb;border:1px solid rgba(59,130,246,.3);">
            📱 عميل
          </button>
          <button class="btn btn-sm" data-cid="${c.id}" data-action="delete"
            style="font-size:.73rem;padding:3px 9px;
              background:rgba(220,38,38,.08);color:#dc2626;border:1px solid rgba(220,38,38,.25);">
            🗑️
          </button>`;
        listEl.appendChild(row);
      });

      this._conflictsCache = conflicts;

      if (this._conflictsClickHandler) {
        listEl.removeEventListener('click', this._conflictsClickHandler);
      }
      this._conflictsClickHandler = (e) => {
        const btn = e.target.closest('[data-cid]');
        if (!btn) return;
        const cid    = parseInt(btn.dataset.cid, 10);
        const action = btn.dataset.action;
        if (action === 'view') {
          const conflict = this._conflictsCache?.find(x => x.id === cid);
          if (conflict) this._showConflictModal(conflict);
        } else if (action === 'server') {
          this._resolveConflict(cid, 'server');
        } else if (action === 'client') {
          this._resolveConflict(cid, 'client');
        } else if (action === 'delete') {
          this._deleteConflict(cid);
        }
      };
      listEl.addEventListener('click', this._conflictsClickHandler);

    } catch (e) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:14px;color:var(--danger);font-size:.82rem;">
          ⚠️ خطأ في تحميل التعارضات: ${escapeHtml(e.message)}
        </div>`;
    }
  },

  /* ══════════════════════════════════════════
     مودال تفاصيل التعارض
  ══════════════════════════════════════════ */
  _showConflictModal(conflict) {
    document.getElementById('sc-conflict-modal')?.remove();

    const TABLE_LABELS = {
      transactions    : 'معاملات',
      failed_deposits : 'إيداعات فاشلة',
      debtors         : 'مديونيات',
      notifications   : 'إشعارات',
    };

    const tLabel = TABLE_LABELS[conflict.table_name] || conflict.table_name || '';
    const fmt = (obj) => {
      if (obj === null || obj === undefined) return '—';
      try {
        const parsed = typeof obj === 'string' ? JSON.parse(obj) : obj;
        return JSON.stringify(parsed, null, 2);
      } catch {
        return String(obj);
      }
    };

    const overlay = document.createElement('div');
    overlay.id = 'sc-conflict-modal';
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.55);
      display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;`;

    const modal = document.createElement('div');
    modal.style.cssText = `background:var(--bg-secondary);border:1px solid var(--border-color);
      border-radius:14px;padding:20px;width:100%;max-width:520px;max-height:80vh;
      overflow-y:auto;display:flex;flex-direction:column;gap:14px;`;

    modal.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;">
        <h4 style="font-size:.92rem;font-weight:700;margin:0;">
          تعارض: ${escapeHtml(tLabel)} — ${escapeHtml(String(conflict.record_id || conflict.operation_id || conflict.id))}
        </h4>
        <button id="sc-modal-close"
          style="background:none;border:none;cursor:pointer;font-size:1.2rem;
            color:var(--text-muted);padding:4px 8px;line-height:1;">✕</button>
      </div>
      ${conflict.reason ? `<p style="font-size:.78rem;color:var(--text-muted);margin:0;">${escapeHtml(conflict.reason)}</p>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
        <div>
          <div style="font-size:.75rem;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">
            📱 بيانات العميل (المحلية)
          </div>
          <pre style="font-size:.70rem;background:rgba(59,130,246,.06);
            border:1px solid rgba(59,130,246,.2);border-radius:8px;padding:10px;
            overflow-x:auto;white-space:pre-wrap;word-break:break-all;
            max-height:200px;overflow-y:auto;color:var(--text-primary);margin:0;">${escapeHtml(fmt(conflict.client_data))}</pre>
        </div>
        <div>
          <div style="font-size:.75rem;font-weight:700;color:var(--text-secondary);margin-bottom:6px;">
            ☁️ بيانات الخادم
          </div>
          <pre style="font-size:.70rem;background:rgba(34,197,94,.05);
            border:1px solid rgba(34,197,94,.2);border-radius:8px;padding:10px;
            overflow-x:auto;white-space:pre-wrap;word-break:break-all;
            max-height:200px;overflow-y:auto;color:var(--text-primary);margin:0;">${escapeHtml(fmt(conflict.server_data))}</pre>
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;">
        <button id="sc-modal-server" class="btn btn-sm"
          style="background:rgba(34,197,94,.1);color:#16a34a;border:1px solid rgba(34,197,94,.3);">
          ✅ قبول الخادم
        </button>
        <button id="sc-modal-client" class="btn btn-sm"
          style="background:rgba(59,130,246,.1);color:#2563eb;border:1px solid rgba(59,130,246,.3);">
          📱 فرض العميل
        </button>
        <button id="sc-modal-cancel" class="btn btn-secondary btn-sm">إغلاق</button>
      </div>`;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const close = () => overlay.remove();
    document.getElementById('sc-modal-close')?.addEventListener('click', close);
    document.getElementById('sc-modal-cancel')?.addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

    document.getElementById('sc-modal-server')?.addEventListener('click', () => {
      close();
      this._resolveConflict(conflict.id, 'server');
    });
    document.getElementById('sc-modal-client')?.addEventListener('click', () => {
      close();
      this._resolveConflict(conflict.id, 'client');
    });
  },

  /* ══════════════════════════════════════════
     حل تعارض واحد
  ══════════════════════════════════════════ */
  async _resolveConflict(id, resolution) {
    const result = await SyncQueue.resolveConflict(id, resolution);
    if (isOk(result)) {
      showToast(resolution === 'server' ? 'تم قبول نسخة الخادم' : 'تم فرض نسخة العميل', 'success');
    } else {
      showToast(`فشل حل التعارض: ${result.error}`, 'error');
    }
    await this._loadConflicts();
  },

  /* ══════════════════════════════════════════
     حذف تعارض واحد بدون حل
  ══════════════════════════════════════════ */
  async _deleteConflict(id) {
    const confirmed = await confirmDialog(
      'حذف هذا التعارض من القائمة بدون حل؟',
      'حذف', 'إلغاء', 'warning'
    );
    if (!confirmed) return;
    try {
      if (typeof db !== 'undefined' && db.isOpen()) {
        await db.sync_conflicts.delete(id);
      }
      showToast('تم حذف التعارض', 'success');
    } catch (e) {
      showToast(`فشل الحذف: ${e.message}`, 'error');
    }
    await this._loadConflicts();
  },

  /* ══════════════════════════════════════════
     حل جميع التعارضات بنفس القرار
  ══════════════════════════════════════════ */
  async _resolveAllConflicts(resolution) {
    const label     = resolution === 'server' ? 'نسخة الخادم' : 'نسخة العميل';
    const confirmed = await confirmDialog(
      `قبول ${label} لجميع التعارضات المعلقة؟ لا يمكن التراجع عن هذا.`,
      'تأكيد', 'إلغاء', 'warning'
    );
    if (!confirmed) return;

    try {
      const conflicts = await SyncQueue.getUnresolvedConflicts();
      if (!conflicts.length) { showToast('لا توجد تعارضات معلقة', 'info'); return; }

      let done = 0;
      let fail = 0;
      for (const c of conflicts) {
        const r = await SyncQueue.resolveConflict(c.id, resolution);
        isOk(r) ? done++ : fail++;
      }
      showToast(
        `تم حل ${done} تعارض` + (fail > 0 ? ` (${fail} فاشل)` : ''),
        fail > 0 ? 'warning' : 'success'
      );
    } catch (e) {
      showToast(`خطأ: ${e.message}`, 'error');
    }
    await this._loadConflicts();
  },

  /* ══════════════════════════════════════════
     حذف جميع التعارضات بدون حل
  ══════════════════════════════════════════ */
  async _clearAllConflicts() {
    const confirmed = await confirmDialog(
      'حذف جميع التعارضات من القائمة بدون حل؟ لا يمكن التراجع عن هذا.',
      'حذف الكل', 'إلغاء', 'danger'
    );
    if (!confirmed) return;
    try {
      if (typeof db !== 'undefined' && db.isOpen()) {
        await db.sync_conflicts.clear();
      }
      showToast('تم حذف جميع التعارضات', 'success');
    } catch (e) {
      showToast(`فشل الحذف: ${e.message}`, 'error');
    }
    await this._loadConflicts();
  },

};

window.SettingsComponent = SettingsComponent;
console.log('✅ SettingsComponent.js v3.0 محمّل — يعمل لجميع المستخدمين');
