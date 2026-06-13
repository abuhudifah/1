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

    // ── بطاقة المصادقة بدون إنترنت ──
    wrap.appendChild(this._buildOfflineAuthCard(user));

    // ── بطاقة الأجهزة النشطة ──
    wrap.appendChild(this._buildActiveDevicesCard(user));

    container.appendChild(wrap);

    this._bindEvents(user);
    this._bindDeviceEvents(user);
    this._bindOfflineAuthEvents(user);
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
    
    const hasQuick = !!user.quick_equation_hash;

    const card = this._card('🪪 بيانات الحساب');

    card.innerHTML += `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        ${this._infoItem('الاسم الكامل', escapeHtml(user.display_name || '—'))}
        ${this._infoItem('البريد الإلكتروني', `<span dir="ltr" style="font-family:monospace;font-size:.83rem;">${escapeHtml(user.username || '—')}</span>`)}
        ${this._infoItem('الدور', `<span style="display:inline-flex;align-items:center;gap:4px;padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:600;background:${roleColor}22;color:${roleColor};">${roleIcon} ${escapeHtml(ROLE_LABELS[user.role] || user.role)}</span>`)}
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
    card.setAttribute('data-psc-quick-card', '');

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
  // بطاقة الأجهزة النشطة (جديدة — المرحلة 1)
  // ────────────────────────────────────────────────────────
  _buildActiveDevicesCard(user) {
    const card = this._card('📱 الأجهزة النشطة');
    card.setAttribute('data-psc-devices-card', '');

    // استخراج معلومات الجهاز الحالي من userAgent
    const ua = navigator.userAgent;
    let browser = 'متصفح';
    if      (ua.includes('Edg'))     browser = 'Edge';
    else if (ua.includes('Chrome'))  browser = 'Chrome';
    else if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Safari'))  browser = 'Safari';
    let os = 'جهاز';
    if      (ua.includes('iPhone'))  os = 'iPhone';
    else if (ua.includes('iPad'))    os = 'iPad';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Mac'))     os = 'Mac';
    else if (ua.includes('Linux'))   os = 'Linux';

    const devPrefKey = `ahu_device_pref_${user.id}`;
    const devPref    = localStorage.getItem(devPrefKey) || 'persistent';
    const prefLabel  = devPref === 'temporary' ? 'جلسة مؤقتة' : 'جلسة دائمة';
    const prefColor  = devPref === 'temporary' ? '#f59e0b' : '#16a34a';

    card.innerHTML += `
      <p style="font-size:.83rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
        إدارة الجلسات النشطة لحسابك عبر الأجهزة المختلفة.
      </p>

      <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:16px;">
        <!-- الجهاز الحالي -->
        <div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:rgba(99,102,241,.06);">
          <div style="width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#8b5cf6);
            display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0;">
            💻
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:600;font-size:.88rem;color:var(--text-primary);">
              ${escapeHtml(browser)} على ${escapeHtml(os)}
            </div>
            <div style="font-size:.76rem;color:var(--text-muted);margin-top:2px;">
              هذا الجهاز · <span style="color:${prefColor};font-weight:500;">${escapeHtml(prefLabel)}</span>
            </div>
          </div>
          <span style="padding:3px 10px;background:rgba(99,102,241,.12);color:#6366f1;
            border-radius:20px;font-size:.73rem;font-weight:600;white-space:nowrap;">الجهاز الحالي</span>
        </div>
      </div>

      <!-- تغيير تفضيل الجهاز -->
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;
        padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border);border-radius:10px;">
        <div style="flex:1;">
          <div style="font-size:.85rem;font-weight:600;color:var(--text-primary);">تفضيل هذا الجهاز</div>
          <div style="font-size:.76rem;color:var(--text-muted);margin-top:2px;">
            ${devPref === 'temporary'
              ? 'جلسة مؤقتة — تُحذف عند إغلاق المتصفح'
              : 'جلسة دائمة — تبقى حتى بعد إغلاق المتصفح (8 ساعات)'}
          </div>
        </div>
        <button id="psc-toggle-pref" style="
          padding:7px 14px;border-radius:8px;font-size:.78rem;font-weight:600;
          border:1px solid var(--border);background:transparent;color:var(--text-secondary);
          cursor:pointer;font-family:inherit;white-space:nowrap;transition:background .15s;">
          ${devPref === 'temporary' ? 'تحويل لدائم' : 'تحويل لمؤقت'}
        </button>
      </div>

      <!-- أزرار الخروج -->
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <button id="psc-signout-others" class="btn btn-sm"
          style="flex:1;background:rgba(245,158,11,.08);color:#d97706;
            border:1px solid rgba(245,158,11,.25);min-width:160px;">
          <i data-lucide="log-out" style="width:13px;height:13px;"></i>
          تسجيل الخروج من الأجهزة الأخرى
        </button>
        <button id="psc-signout-all" class="btn btn-sm"
          style="background:rgba(220,38,38,.07);color:#dc2626;
            border:1px solid rgba(220,38,38,.2);min-width:130px;">
          <i data-lucide="shield-off" style="width:13px;height:13px;"></i>
          خروج من كل الأجهزة
        </button>
      </div>`;

    return card;
  },

  // ────────────────────────────────────────────────────────
  // _bindDeviceEvents
  // ────────────────────────────────────────────────────────
  _bindDeviceEvents(user) {
    // تبديل تفضيل الجهاز
    document.getElementById('psc-toggle-pref')?.addEventListener('click', () => {
      const key     = `ahu_device_pref_${user.id}`;
      const current = localStorage.getItem(key) || 'persistent';
      const next    = current === 'temporary' ? 'persistent' : 'temporary';
      localStorage.setItem(key, next);
      if (next === 'temporary') {
        localStorage.removeItem(`ahu_sess_exp_${user.id}`);
      } else {
        localStorage.setItem(`ahu_sess_exp_${user.id}`, String(Date.now() + 8 * 60 * 60 * 1000));
      }
      const label = next === 'temporary' ? 'جلسة مؤقتة' : 'جلسة دائمة';
      showToast(`✅ تم التغيير إلى ${label}`, 'success');
      // إعادة رسم البطاقة
      const card = document.querySelector('[data-psc-devices-card]');
      if (card) {
        const newCard = this._buildActiveDevicesCard(user);
        newCard.setAttribute('data-psc-devices-card', '');
        card.replaceWith(newCard);
        this._bindDeviceEvents(user);
        if (window.lucide) lucide.createIcons();
      }
    });

    // تسجيل الخروج من الأجهزة الأخرى
    document.getElementById('psc-signout-others')?.addEventListener('click', async () => {
      if (!isOnline()) { showToast('يتطلب اتصالاً بالإنترنت', 'warning'); return; }
      const btn = document.getElementById('psc-signout-others');
      if (btn) { btn.disabled = true; btn.innerHTML = '⏳ جارٍ...'; }
      const res = await AuthService.signOutOtherDevices();
      if (isOk(res)) {
        showToast('✅ تم تسجيل الخروج من جميع الأجهزة الأخرى', 'success');
      } else {
        showToast(res.error, 'error');
      }
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="log-out" style="width:13px;height:13px;"></i> تسجيل الخروج من الأجهزة الأخرى';
        if (window.lucide) lucide.createIcons();
      }
    });

    // تسجيل الخروج من جميع الأجهزة
    document.getElementById('psc-signout-all')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog(
        'تسجيل الخروج من جميع الأجهزة؟\n\nستحتاج لتسجيل الدخول مجدداً على هذا الجهاز أيضاً.',
        'تأكيد الخروج', 'إلغاء', 'danger'
      );
      if (!confirmed) return;
      if (!isOnline()) { showToast('يتطلب اتصالاً بالإنترنت', 'warning'); return; }
      const res = await AuthService.signOutAllDevices();
      if (!isOk(res)) showToast(res.error, 'error');
      // signOutAllDevices يُرسل auth:logout → App.js يعيد التوجيه لشاشة الدخول
    });
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
      } catch { /* storage cleanup — non-critical */ }

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
  // بطاقة المصادقة بدون إنترنت (PIN + البصمة أو Face ID)
  // ────────────────────────────────────────────────────────
  _buildOfflineAuthCard(user) {
    const session    = OfflineAuthService.getOfflineSession(user.id);
    const hasPin     = !!session?.hasPin;
    const hasWebAuthn= !!session?.hasWebAuthn;
    const supportsWA = !!window.PublicKeyCredential;

    const card = this._card('🔒 الدخول بدون إنترنت');
    card.setAttribute('data-psc-offline-card', '');

    card.innerHTML += `
      <p style="font-size:.83rem;color:var(--text-secondary);margin-bottom:14px;line-height:1.6;">
        أدخل بدون اتصال بالإنترنت عبر PIN أو البصمة أو Face ID.
      </p>

      <!-- PIN -->
      <div style="padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border);
        border-radius:10px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;">
            <div style="font-size:.85rem;font-weight:600;color:var(--text-primary);">PIN الدخول بدون إنترنت</div>
            <div style="font-size:.76rem;margin-top:2px;color:${hasPin ? '#16a34a' : 'var(--text-muted)'};">
              ${hasPin ? '✅ مفعّل على هذا الجهاز' : 'غير مفعّل'}
            </div>
          </div>
          ${!hasPin ? `
          <button id="psc-pin-enable" class="btn btn-primary btn-sm" style="white-space:nowrap;">
            تفعيل PIN الدخول بدون إنترنت
          </button>` : `
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="psc-pin-change" class="btn btn-sm"
              style="background:rgba(99,102,241,.1);color:#6366f1;border:1px solid rgba(99,102,241,.3);">
              تغيير PIN
            </button>
            <button id="psc-pin-delete" class="btn btn-sm"
              style="background:rgba(220,38,38,.08);color:#dc2626;border:1px solid rgba(220,38,38,.25);">
              حذف PIN
            </button>
          </div>`}
        </div>
      </div>

      <!-- البصمة أو Face ID -->
      <div style="padding:12px 14px;background:var(--bg-secondary);border:1px solid var(--border);
        border-radius:10px;">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
          <div style="flex:1;">
            <div style="font-size:.85rem;font-weight:600;color:var(--text-primary);">البصمة أو Face ID</div>
            <div style="font-size:.76rem;margin-top:2px;color:${hasWebAuthn ? '#16a34a' : 'var(--text-muted)'};">
              ${hasWebAuthn ? '✅ مفعّل على هذا الجهاز' : 'غير مفعّل'}
            </div>
          </div>
          ${!hasWebAuthn && supportsWA ? `
          <button id="psc-webauthn-enable" class="btn btn-primary btn-sm" style="white-space:nowrap;">
            تفعيل البصمة أو Face ID
          </button>` : ''}
          ${hasWebAuthn ? `
          <button id="psc-webauthn-disable" class="btn btn-sm"
            style="background:rgba(220,38,38,.08);color:#dc2626;border:1px solid rgba(220,38,38,.25);white-space:nowrap;">
            إلغاء البصمة أو Face ID
          </button>` : ''}
          ${!hasWebAuthn && !supportsWA ? `
          <span style="font-size:.75rem;color:var(--text-muted);">غير مدعوم في هذا المتصفح</span>` : ''}
        </div>
      </div>`;

    return card;
  },

  // ────────────────────────────────────────────────────────
  // _bindOfflineAuthEvents
  // ────────────────────────────────────────────────────────
  _bindOfflineAuthEvents(user) {
    // تفعيل PIN
    document.getElementById('psc-pin-enable')?.addEventListener('click', async () => {
      const pin = await PinDialog.showCreate({ minLength: 6, maxLength: 6, userId: user.id });
      if (!pin) return;
      const res = await OfflineAuthService.createOfflineSession(user.id, pin);
      if (isOk(res)) {
        showToast('✅ تم تفعيل PIN الدخول بدون إنترنت', 'success');
      } else {
        showToast(res.error || 'فشل تفعيل PIN', 'error');
      }
      this._rerenderOfflineCard(user);
    });

    // تغيير PIN
    document.getElementById('psc-pin-change')?.addEventListener('click', async () => {
      const oldPin = await PinDialog.show({ title: 'أدخل PIN الحالي', minLength: 6, maxLength: 6, userId: user.id });
      if (!oldPin) return;
      const verify = await OfflineAuthService.verifyOfflineSession(user.id, oldPin);
      if (!isOk(verify)) {
        showToast(verify.error || 'PIN غير صحيح', 'error');
        return;
      }
      const newPin = await PinDialog.showCreate({ minLength: 6, maxLength: 6, userId: user.id });
      if (!newPin) return;
      const res = await OfflineAuthService.createOfflineSession(user.id, newPin);
      if (isOk(res)) {
        showToast('✅ تم تغيير PIN بنجاح', 'success');
      } else {
        showToast(res.error || 'فشل تغيير PIN', 'error');
      }
      this._rerenderOfflineCard(user);
    });

    // حذف PIN
    document.getElementById('psc-pin-delete')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog(
        'حذف PIN الدخول بدون إنترنت؟\n\nلن تتمكن من الدخول بدون إنترنت حتى تُفعّله مجدداً.',
        'حذف', 'إلغاء', 'danger'
      );
      if (!confirmed) return;
      const res = await OfflineAuthService.endOfflineSession(user.id);
      if (isOk(res)) {
        showToast('✅ تم حذف PIN الدخول بدون إنترنت', 'success');
      } else {
        showToast(res.error || 'فشل حذف PIN', 'error');
      }
      this._rerenderOfflineCard(user);
    });

    // تفعيل البصمة أو Face ID
    document.getElementById('psc-webauthn-enable')?.addEventListener('click', async () => {
      const res = await OfflineAuthService.enableWebAuthn(user.id);
      if (isOk(res)) {
        showToast('✅ تم تفعيل البصمة أو Face ID', 'success');
      } else {
        showToast(res.error || 'فشل تفعيل البصمة أو Face ID', 'error');
      }
      this._rerenderOfflineCard(user);
    });

    // إلغاء البصمة أو Face ID
    document.getElementById('psc-webauthn-disable')?.addEventListener('click', async () => {
      const confirmed = await confirmDialog(
        'إلغاء البصمة أو Face ID؟\n\nيمكنك إعادة تفعيلها لاحقاً.',
        'إلغاء التفعيل', 'رجوع', 'danger'
      );
      if (!confirmed) return;
      try {
        const raw = localStorage.getItem(`ahu_offline_session_${user.id}`);
        if (raw) {
          const session = JSON.parse(raw);
          session.hasWebAuthn = false;
          localStorage.setItem(`ahu_offline_session_${user.id}`, JSON.stringify(session));
        }
      } catch { /* تجاهل */ }
      showToast('✅ تم إلغاء البصمة أو Face ID', 'success');
      this._rerenderOfflineCard(user);
    });
  },

  // ────────────────────────────────────────────────────────
  // _rerenderOfflineCard — إعادة رسم بطاقة المصادقة بدون إنترنت
  // ────────────────────────────────────────────────────────
  _rerenderOfflineCard(user) {
    const card = document.querySelector('[data-psc-offline-card]');
    if (card) {
      const newCard = this._buildOfflineAuthCard(user);
      newCard.setAttribute('data-psc-offline-card', '');
      card.replaceWith(newCard);
      this._bindOfflineAuthEvents(user);
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
console.log('✅ ProfileSettingsComponent.js v2.0 — إدارة الأجهزة النشطة + تفضيل الجلسة الدائمة/المؤقتة');
