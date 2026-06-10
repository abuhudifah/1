/**
 * components/ProfileSettingsComponent.js — v1.1 (BEHAVIOR FIXED)
 * نظام أبو حذيفة — إعدادات الملف الشخصي (لجميع المستخدمين)
 *
 * التغييرات الجوهرية (السلوك الرابع):
 * ─────────────────────────────────────────────────────────
 * ✅ عرض رقم الحساب الفعلي (user.account_number) بدلاً من
 *    الرقم المُولَّد محلياً من المعرف.
 *
 * ✅ إضافة زر نسخ بجانب رقم الحساب لتسهيل المشاركة.
 * ─────────────────────────────────────────────────────────
 *
 * الميزات:
 * 1. تعديل الاسم (display_name)
 * 2. إعداد / تغيير معادلة الدخول السريع
 * 3. إزالة الدخول السريع
 * 4. عرض معلومات الحساب (الدور، البريد، رقم الحساب الفعلي)
 */
'use strict';

const ProfileSettingsComponent = {

  // ────────────────────────────────────────────────────────
  // render — يُعرض داخل حاوية أي مكوّن
  // ────────────────────────────────────────────────────────
  async render(container) {
    const user = AuthService.getCurrentUser();
    if (!user) return;

    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:18px;max-width:560px;margin:0 auto;';

    // ── عنوان الصفحة ──
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;gap:12px;margin-bottom:4px;';
    titleRow.innerHTML = `
      <div style="width:48px;height:48px;border-radius:14px;
        background:linear-gradient(135deg,#6366f1,#8b5cf6);
        display:flex;align-items:center;justify-content:center;
        font-size:1.4rem;color:#fff;font-weight:700;flex-shrink:0;box-shadow:0 4px 14px rgba(99,102,241,.35);">
        ${escapeHtml((user.display_name || '?').charAt(0).toUpperCase())}
      </div>
      <div>
        <h2 style="font-size:1.15rem;font-weight:700;color:var(--text-primary);margin:0 0 2px;">
          إعدادات الملف الشخصي
        </h2>
        <div style="font-size:0.8rem;color:var(--text-muted);">${escapeHtml(user.username || '')}</div>
      </div>`;
    wrap.appendChild(titleRow);

    // ── بطاقة معلومات الحساب (معدلة لعرض account_number الفعلي) ──
    wrap.appendChild(this._buildInfoCard(user));

    // ── بطاقة تعديل الاسم ──
    wrap.appendChild(this._buildNameCard(user));

    // ── بطاقة الدخول السريع ──
    wrap.appendChild(this._buildQuickLoginCard(user));

    container.appendChild(wrap);

    this._bindEvents(user);
    if (window.lucide) lucide.createIcons();
  },

  // ────────────────────────────────────────────────────────
  // ✅ بطاقة معلومات الحساب (معدلة)
  // ────────────────────────────────────────────────────────
  _buildInfoCard(user) {
    const roleIcons  = { admin: '👑', admin_assistant: '🛡️', agent: '👤' };
    const roleColors = { admin: '#16a34a', admin_assistant: '#1d4ed8', agent: '#6366f1' };
    const roleColor  = roleColors[user.role] || '#6366f1';
    const roleIcon   = roleIcons[user.role]  || '👤';
    
    // ✅ عرض رقم الحساب الفعلي من جدول users
    const accountNumber = user.account_number || '—';
    const hasQuick      = !!user.quick_equation_hash;

    const card = this._card('🪪 بيانات الحساب');
    
    // بناء HTML مع زر نسخ بجانب رقم الحساب
    const accountNumberHtml = accountNumber !== '—' 
      ? `<div style="display:flex;align-items:center;gap:6px;">
           <span dir="ltr" style="font-family:monospace;font-weight:700;color:var(--text-primary);">${escapeHtml(accountNumber)}</span>
           <button id="copy-account-number-btn" class="btn-icon" style="width:28px;height:28px;background:var(--bg-hover);border-radius:6px;" title="نسخ رقم الحساب">
             <i data-lucide="copy" style="width:13px;height:13px;"></i>
           </button>
         </div>`
      : `<span dir="ltr" style="font-family:monospace;font-weight:700;color:var(--text-primary);">${escapeHtml(accountNumber)}</span>`;
    
    card.innerHTML += `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${this._infoItem('الاسم الكامل', escapeHtml(user.display_name || '—'))}
        ${this._infoItem('البريد الإلكتروني', `<span dir="ltr" style="font-family:monospace;font-size:.83rem;">${escapeHtml(user.username || '—')}</span>`)}
        ${this._infoItem('الدور', `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:600;background:${roleColor}22;color:${roleColor};">${roleIcon} ${escapeHtml(ROLE_LABELS[user.role] || user.role)}</span>`)}
        ${this._infoItem('رقم الحساب', accountNumberHtml)}
        ${this._infoItem('الدخول السريع', hasQuick
          ? '<span style="color:#16a34a;font-weight:600;">⚡ مفعّل</span>'
          : '<span style="color:var(--text-muted);">غير مفعّل</span>')}
        ${user.last_login ? this._infoItem('آخر دخول', `<span style="font-size:.82rem;color:var(--text-secondary);">${this._timeAgo(user.last_login)}</span>`) : ''}
      </div>`;
    
    return card;
  },

  // ────────────────────────────────────────────────────────
  // بطاقة تعديل الاسم
  // ────────────────────────────────────────────────────────
  _buildNameCard(user) {
    const card = this._card('✏️ تعديل الاسم');
    card.innerHTML += `
      <p style="font-size:.84rem;color:var(--text-secondary);margin-bottom:14px;">
        الاسم الذي يظهر في النظام وعند تسجيل الدخول.
      </p>
      <div class="form-group">
        <label class="form-label">الاسم الكامل</label>
        <input id="psc-name" type="text" class="form-control"
          value="${escapeHtml(user.display_name || '')}"
          placeholder="أدخل اسمك الكامل" maxlength="60" />
        <div id="psc-name-chars" style="font-size:.73rem;color:var(--text-muted);margin-top:4px;text-align:left;direction:ltr;">
          ${(user.display_name || '').length}/60
        </div>
      </div>
      <div id="psc-name-err" style="display:none;padding:8px 12px;background:#fee2e2;
        border:1px solid #fca5a5;border-radius:8px;color:#dc2626;font-size:.83rem;margin-bottom:10px;"></div>
      <button id="psc-name-save" class="btn btn-primary btn-sm" style="min-width:120px;">
        <i data-lucide="save" style="width:13px;height:13px;"></i> حفظ الاسم
      </button>`;
    return card;
  },

  // ────────────────────────────────────────────────────────
  // بطاقة الدخول السريع
  // ────────────────────────────────────────────────────────
  _buildQuickLoginCard(user) {
    const hasQuick = !!user.quick_equation_hash;
    const card = this._card('⚡ الدخول السريع');

    card.innerHTML += `
      <div style="padding:12px 14px;background:rgba(99,102,241,.07);border:1px solid rgba(99,102,241,.2);
        border-radius:10px;margin-bottom:16px;">
        <p style="font-size:.84rem;color:var(--text-primary);font-weight:600;margin:0 0 6px;">
          ما هو الدخول السريع؟
        </p>
        <p style="font-size:.82rem;color:var(--text-secondary);margin:0;line-height:1.7;">
          بدلاً من كتابة كلمة مرور، تُدخل <strong>معادلة رياضية</strong> في حاسبة الشاشة الرئيسية.
          مثال: إذا كانت معادلتك <code style="background:rgba(99,102,241,.12);padding:1px 6px;border-radius:4px;">12+88</code>
          فتكتبها في الحاسبة وتضغط = فيدخل النظام مباشرة.
        </p>
      </div>

      <div id="psc-quick-status" style="display:flex;align-items:center;gap:10px;
        padding:10px 14px;border-radius:10px;margin-bottom:16px;
        background:${hasQuick ? '#dcfce7' : '#fff3cd'};
        border:1px solid ${hasQuick ? '#86efac' : '#fcd34d'};">
        <span style="font-size:1.3rem;">${hasQuick ? '✅' : '⚠️'}</span>
        <div>
          <div style="font-weight:600;font-size:.87rem;color:${hasQuick ? '#15803d' : '#92400e'};">
            ${hasQuick ? 'الدخول السريع مفعّل على هذا الجهاز' : 'الدخول السريع غير مفعّل بعد'}
          </div>
          <div style="font-size:.78rem;color:${hasQuick ? '#16a34a' : '#b45309'};margin-top:2px;">
            ${hasQuick
              ? 'يمكنك تغيير المعادلة في أي وقت من النموذج أدناه'
              : 'فعّله الآن لدخول أسرع وأسهل في المرة القادمة'}
          </div>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">
          ${hasQuick ? '🔄 تغيير المعادلة' : '➕ إنشاء معادلة جديدة'}
        </label>
        <div style="position:relative;">
          <input id="psc-eq-input" type="text" class="form-control"
            dir="ltr" style="font-family:monospace;font-size:1rem;letter-spacing:.05em;padding-left:44px;"
            placeholder="مثال: 15+85  أو  3*50  أو  200-50" autocomplete="off" spellcheck="false" />
          <span style="position:absolute;left:13px;top:50%;transform:translateY(-50%);
            font-size:1.1rem;pointer-events:none;">🧮</span>
        </div>
      </div>

      <div id="psc-eq-preview" style="
        min-height:36px;padding:8px 14px;border-radius:8px;margin-bottom:14px;
        background:var(--bg-secondary);border:1px dashed var(--border);
        font-family:monospace;font-size:.9rem;color:var(--text-muted);
        display:flex;align-items:center;gap:8px;transition:all .2s;">
        <span style="opacity:.5;">النتيجة ستظهر هنا...</span>
      </div>

      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="psc-eq-save" class="btn btn-primary btn-sm" style="min-width:140px;">
          <i data-lucide="zap" style="width:13px;height:13px;"></i>
          ${hasQuick ? 'تحديث المعادلة' : 'تفعيل الدخول السريع'}
        </button>
        ${hasQuick ? `
        <button id="psc-eq-disable" class="btn btn-sm"
          style="background:rgba(220,38,38,.08);color:#dc2626;border:1px solid rgba(220,38,38,.25);min-width:120px;">
          <i data-lucide="zap-off" style="width:13px;height:13px;"></i>
          إزالة الدخول السريع
        </button>` : ''}
      </div>
      <div id="psc-eq-err" style="display:none;padding:8px 12px;background:#fee2e2;
        border:1px solid #fca5a5;border-radius:8px;color:#dc2626;font-size:.83rem;margin-top:10px;"></div>`;

    return card;
  },

  // ────────────────────────────────────────────────────────
  // _bindEvents (معدل لإضافة حدث نسخ رقم الحساب)
  // ────────────────────────────────────────────────────────
  _bindEvents(user) {
    // عداد الحروف
    document.getElementById('psc-name')?.addEventListener('input', e => {
      const len = e.target.value.length;
      const el  = document.getElementById('psc-name-chars');
      if (el) el.textContent = `${len}/60`;
    });

    // حفظ الاسم
    document.getElementById('psc-name-save')?.addEventListener('click', () => this._saveName());

    // معاينة المعادلة
    document.getElementById('psc-eq-input')?.addEventListener('input', e => {
      this._previewEquation(e.target.value.trim());
    });

    // حفظ المعادلة
    document.getElementById('psc-eq-save')?.addEventListener('click', () => this._saveEquation());

    // إزالة الدخول السريع
    document.getElementById('psc-eq-disable')?.addEventListener('click', () => this._disableQuickLogin());

    // ✅ نسخ رقم الحساب
    document.getElementById('copy-account-number-btn')?.addEventListener('click', () => {
      const user = AuthService.getCurrentUser();
      const accountNumber = user?.account_number;
      if (accountNumber) {
        copyToClipboard(accountNumber, `تم نسخ رقم الحساب: ${accountNumber}`);
      } else {
        showToast('لا يوجد رقم حساب مسجل', 'warning');
      }
    });
  },

  // ────────────────────────────────────────────────────────
  // _previewEquation — معاينة فورية
  // ────────────────────────────────────────────────────────
  _previewEquation(eq) {
    const preview = document.getElementById('psc-eq-preview');
    if (!preview) return;

    if (!eq) {
      preview.innerHTML = '<span style="opacity:.45;">النتيجة ستظهر هنا...</span>';
      preview.style.borderColor = 'var(--border)';
      preview.style.background  = 'var(--bg-secondary)';
      return;
    }

    try {
      const parser = new window.exprEval.Parser();
      const result = parser.evaluate(eq);

      if (typeof result !== 'number' || !isFinite(result)) throw new Error('ليس رقماً');

      preview.innerHTML = `
        <span style="color:var(--text-muted);font-size:.8rem;">النتيجة:</span>
        <span style="font-size:1.1rem;font-weight:700;color:#16a34a;">${result}</span>
        <span style="margin-right:auto;font-size:.73rem;color:var(--text-muted);">✅ معادلة صالحة</span>`;
      preview.style.borderColor = '#86efac';
      preview.style.background  = '#f0fdf4';
    } catch {
      preview.innerHTML = `
        <span style="color:#dc2626;font-size:.84rem;">❌ معادلة غير صالحة — تأكد من الصيغة الرياضية</span>`;
      preview.style.borderColor = '#fca5a5';
      preview.style.background  = '#fff5f5';
    }
  },

  // ────────────────────────────────────────────────────────
  // _saveName
  // ────────────────────────────────────────────────────────
  async _saveName() {
    const input  = document.getElementById('psc-name');
    const errEl  = document.getElementById('psc-name-err');
    const saveBtn= document.getElementById('psc-name-save');
    const name   = input?.value.trim();

    this._hideErr('psc-name-err');

    if (!name || name.length < 2) {
      this._showErr('psc-name-err', 'الاسم يجب أن يكون حرفين على الأقل');
      return;
    }

    const origText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '⏳ جاري الحفظ...';

    try {
      const uid = AuthService.getCurrentUserId();
      const { error } = await supabaseClient
        .from(TABLES.USERS)
        .update({ display_name: name, updated_at: new Date().toISOString() })
        .eq('id', uid);

      if (error) {
        this._showErr('psc-name-err', `فشل الحفظ: ${error.message}`);
        return;
      }

      if (AuthService._state?.currentUser) {
        AuthService._state.currentUser.display_name = name;
      }

      if (typeof db !== 'undefined' && db.isOpen()) {
        db.users.update(uid, { display_name: name }).catch(() => {});
      }

      const headerChip = document.querySelector('.header-user-name');
      if (headerChip) headerChip.textContent = name;

      showToast(`✅ تم تحديث الاسم إلى "${name}"`, 'success');

    } catch (e) {
      this._showErr('psc-name-err', `خطأ: ${e.message}`);
    } finally {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origText;
      if (window.lucide) lucide.createIcons();
    }
  },

  // ────────────────────────────────────────────────────────
  // _saveEquation
  // ────────────────────────────────────────────────────────
  async _saveEquation() {
    const input  = document.getElementById('psc-eq-input');
    const saveBtn= document.getElementById('psc-eq-save');
    const eq     = input?.value.trim();

    this._hideErr('psc-eq-err');

    if (!eq) {
      this._showErr('psc-eq-err', 'أدخل معادلة رياضية أولاً');
      return;
    }

    try {
      const parser = new window.exprEval.Parser();
      const result = parser.evaluate(eq);
      if (typeof result !== 'number' || !isFinite(result)) {
        this._showErr('psc-eq-err', 'المعادلة لا تُنتج رقماً صحيحاً');
        return;
      }
    } catch {
      this._showErr('psc-eq-err', 'معادلة غير صالحة رياضياً — تحقق من الصيغة');
      return;
    }

    const origText = saveBtn.innerHTML;
    saveBtn.disabled = true;
    saveBtn.innerHTML = '⏳ جاري التفعيل...';

    const result = await AuthService.enableQuickLogin(eq);

    saveBtn.disabled = false;
    saveBtn.innerHTML = origText;
    if (window.lucide) lucide.createIcons();

    if (isOk(result)) {
      const uid = AuthService.getCurrentUserId();
      if (!sessionStorage.getItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY)) {
        sessionStorage.setItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY, `quick_${uid}_${Date.now()}`);
      }

      showToast('⚡ تم تفعيل الدخول السريع بنجاح! احتفظ بمعادلتك.', 'success', 5000);
      input.value = '';
      this._previewEquation('');

      const user = { ...AuthService.getCurrentUser(), quick_equation_hash: 'set' };
      const qCard = document.querySelector('[data-psc-quick-card]');
      if (qCard) {
        const newCard = this._buildQuickLoginCard(user);
        newCard.setAttribute('data-psc-quick-card', '');
        qCard.replaceWith(newCard);
        this._bindEvents(user);
        if (window.lucide) lucide.createIcons();
      }
    } else {
      this._showErr('psc-eq-err', `فشل التفعيل: ${result.error}`);
    }
  },

  // ────────────────────────────────────────────────────────
  // _disableQuickLogin
  // ────────────────────────────────────────────────────────
  async _disableQuickLogin() {
    const confirmed = await confirmDialog(
      'إزالة الدخول السريع؟\n\nستحتاج إلى كلمة المرور في كل دخول حتى تُفعّله مجدداً.',
      'إزالة', 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    const btn = document.getElementById('psc-eq-disable');
    if (btn) { btn.disabled = true; btn.innerHTML = '⏳ جاري الإزالة...'; }

    const result = await AuthService.disableQuickLogin();

    if (isOk(result)) {
      try {
        const uid = AuthService.getCurrentUserId();
        sessionStorage.removeItem(SECURITY_CONFIG.DEVICE_TOKEN_KEY);
        localStorage.removeItem(`ahu_quick_${uid}`);
      } catch {}

      showToast('✅ تم إزالة الدخول السريع', 'success');

      const user = { ...AuthService.getCurrentUser(), quick_equation_hash: null };
      const qCard = document.querySelector('[data-psc-quick-card]');
      if (qCard) {
        const newCard = this._buildQuickLoginCard(user);
        newCard.setAttribute('data-psc-quick-card', '');
        qCard.replaceWith(newCard);
        this._bindEvents(user);
        if (window.lucide) lucide.createIcons();
      }
    } else {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="zap-off" style="width:13px;height:13px;"></i> إزالة الدخول السريع'; }
      showToast(`فشل الإزالة: ${result.error}`, 'error');
      if (window.lucide) lucide.createIcons();
    }
  },

  // ────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────
  _card(title) {
    const card = document.createElement('div');
    card.className = 'glass-card';
    card.style.marginBottom = '0';
    card.innerHTML = `
      <h3 style="font-size:.95rem;font-weight:700;color:var(--text-primary);
        margin:0 0 14px;display:flex;align-items:center;gap:6px;">${title}</h3>`;
    return card;
  },

  _infoItem(label, valueHtml) {
    return `
      <div style="padding:10px 12px;background:var(--bg-secondary);border-radius:9px;
        border:1px solid var(--border);">
        <div style="font-size:.73rem;color:var(--text-muted);margin-bottom:4px;font-weight:500;">
          ${escapeHtml(label)}
        </div>
        <div style="font-size:.87rem;color:var(--text-primary);">${valueHtml}</div>
      </div>`;
  },

  _showErr(id, msg) {
    const el = document.getElementById(id);
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  },
  _hideErr(id) {
    const el = document.getElementById(id);
    if (el) { el.textContent = ''; el.style.display = 'none'; }
  },
  _timeAgo(iso) {
    try {
      const d = Math.floor((Date.now() - new Date(iso)) / 1000);
      if (d < 60)     return 'الآن';
      if (d < 3600)   return `منذ ${Math.floor(d/60)} دقيقة`;
      if (d < 86400)  return `منذ ${Math.floor(d/3600)} ساعة`;
      if (d < 2592000)return `منذ ${Math.floor(d/86400)} يوم`;
      return `منذ ${Math.floor(d/2592000)} شهر`;
    } catch { return '—'; }
  },
};

window.ProfileSettingsComponent = ProfileSettingsComponent;
console.log('✅ ProfileSettingsComponent.js v1.1 — السلوك الرابع: عرض رقم الحساب الفعلي من users.account_number');
