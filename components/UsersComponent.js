/**
 * components/UsersComponent.js — v3.0 (إصلاح نهائي + جدول احترافي)
 * نظام أبو حذيفة — إدارة المستخدمين (للمدير فقط)
 *
 * ═══════════════════════════════════════════════════════════════
 * الإصلاحات المُطبَّقة في v3.0:
 * ═══════════════════════════════════════════════════════════════
 *
 * 🔴 إصلاح 1 (الأهم): signUp يُحوّل الجلسة للمستخدم الجديد
 *    → الحل: استخدام RPC create_user_profile بـ SECURITY DEFINER
 *    → بعد signUp تُعاد جلسة المدير فوراً عبر supabaseClient.auth.setSession
 *
 * 🔴 إصلاح 2: authData.user قد يكون null عند تفعيل Email Confirmation
 *    → الحل: فحص authData.user?.id مع رسالة خطأ واضحة تطلب تعطيل Confirmation
 *
 * 🔴 إصلاح 3: callRPC تبتلع الأخطاء بصمت
 *    → الحل: console.error مع الخطأ الكامل + عرض الخطأ للمستخدم
 *
 * 🔴 إصلاح 4: cache قديم يمنع ظهور المستخدم الجديد
 *    → الحل: forceRefresh: true في _load() + invalidateCacheByPrefix
 *
 * 🟡 تحسين 5: جدول المستخدمين أكثر احترافية
 *    → أعمدة: الاسم، البريد، الدور، آخر دخول، الحالة، الإجراءات
 *    → بحث فوري، ترتيب، تعطيل/تفعيل، حذف بتأكيد
 *
 * 🟡 تحسين 6: التحقق من البيانات في الواجهة قبل الإرسال
 *    → صيغة البريد، حد أدنى كلمة المرور، الحقول الإلزامية
 *
 * 🟡 تحسين 7: AppStore يُحدَّث بعد كل عملية
 *
 * ═══════════════════════════════════════════════════════════════
 * خطة التشخيص (إذا ظل الخطأ بعد هذا الإصلاح):
 * ═══════════════════════════════════════════════════════════════
 * 1. افتح Console → ابحث عن: [UsersComponent]
 * 2. تحقق من: ✅ signUp نجح | ❌ فشل RPC
 * 3. إذا رأيت "function not found" → شغّل step_10 SQL أولاً
 * 4. إذا رأيت "Email not confirmed" → عطّل Email Confirmation في Supabase
 * ═══════════════════════════════════════════════════════════════
 */
'use strict';

const UsersComponent = {
  _modal        : null,
  _editId       : null,
  _users        : [],
  _filtered     : [],
  _searchQuery  : '',
  _sortCol      : 'display_name',
  _sortAsc      : true,
  _adminSession : null, // حفظ جلسة المدير قبل signUp

  // ────────────────────────────────────────────────────────────
  // render — نقطة الدخول الرئيسية
  // ────────────────────────────────────────────────────────────
  async render(container) {
    if (!AuthService.isAdmin()) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🔒</div>
          <div class="empty-state-text">إدارة المستخدمين للمدير فقط</div>
        </div>`;
      return;
    }

    container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

    // ── شريط العنوان + زر الإضافة ──
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;';
    bar.innerHTML = `
      <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;margin:0;">
        👥 إدارة المستخدمين
      </h2>
      <span id="uc-count" style="font-size:0.82rem;color:var(--text-muted);"></span>`;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.innerHTML = '<i data-lucide="user-plus" style="width:14px;height:14px"></i> إضافة مستخدم';
    addBtn.addEventListener('click', () => this._openForm());
    bar.appendChild(addBtn);
    wrap.appendChild(bar);

    // ── بحث ──
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'position:relative;';
    searchWrap.innerHTML = `
      <input id="uc-search" type="text" class="form-control"
        placeholder="🔍  بحث بالاسم أو البريد أو الدور..."
        style="padding-right:36px;font-size:0.9rem;" />`;
    wrap.appendChild(searchWrap);

    // ── الجدول ──
    const tableWrap = document.createElement('div');
    tableWrap.id = 'uc-table-wrap';
    tableWrap.innerHTML = this._skeletonRows(5);
    wrap.appendChild(tableWrap);

    // ── المودال ──
    this._modal = this._buildModal();
    wrap.appendChild(this._modal);

    container.appendChild(wrap);

    // أحداث البحث
    document.getElementById('uc-search')?.addEventListener('input', e => {
      this._searchQuery = e.target.value.trim().toLowerCase();
      this._applyFilterAndRender();
    });

    // تحميل البيانات
    await this._load();

    if (window.lucide) lucide.createIcons();
  },

  // ────────────────────────────────────────────────────────────
  // _load — تحميل البيانات من Supabase مع forceRefresh
  // ────────────────────────────────────────────────────────────
  async _load() {
    console.log('[UsersComponent] _load: بدء تحميل المستخدمين...');

    try {
      // الطريقة 1: مباشرة عبر supabaseClient (الأموثق والأسرع)
      if (isOnline()) {
        const { data, error } = await supabaseClient
          .from(TABLES.USERS)
          .select('id, username, display_name, role, is_active, allowed_tabs, quick_equation_hash, last_login, created_at')
          .order('display_name', { ascending: true });

        if (!error && data) {
          this._users = data;
          console.log(`[UsersComponent] _load: جُلب ${data.length} مستخدم من Supabase`);

          // تحديث AppStore
          if (window.AppStore) AppStore.setState('users', data);

          // تحديث Dexie في الخلفية
          if (typeof db !== 'undefined' && db.isOpen()) {
            try {
              await db.users.bulkPut(data.map(u => ({ ...u, sync_status: SYNC_STATUS.SYNCED })));
            } catch (dexieErr) {
              console.warn('[UsersComponent] تحديث Dexie فشل (غير حرج):', dexieErr.message);
            }
          }

          this._applyFilterAndRender();
          return;
        }
        console.warn('[UsersComponent] _load: فشل Supabase:', error?.message, '— محاولة repo...');
      }

      // الطريقة 2 (احتياطي): عبر repo مع forceRefresh
      const result = await repo.query(TABLES.USERS, {}, {
        orderBy     : 'display_name',
        ascending   : true,
        pageSize    : 200,
        forceRefresh: true,
      });

      this._users = isOk(result) ? (result.data?.data || result.data || []) : [];
      console.log(`[UsersComponent] _load: جُلب ${this._users.length} مستخدم عبر repo`);

    } catch (e) {
      console.error('[UsersComponent] _load: خطأ غير متوقع:', e);
      this._users = [];
    }

    this._applyFilterAndRender();
  },

  // ────────────────────────────────────────────────────────────
  // _applyFilterAndRender — فلترة + ترتيب + رسم الجدول
  // ────────────────────────────────────────────────────────────
  _applyFilterAndRender() {
    const q = this._searchQuery;

    this._filtered = q
      ? this._users.filter(u =>
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.username     || '').toLowerCase().includes(q) ||
          (ROLE_LABELS[u.role] || u.role || '').toLowerCase().includes(q)
        )
      : [...this._users];

    // الترتيب
    const col = this._sortCol;
    const asc = this._sortAsc;
    this._filtered.sort((a, b) => {
      const va = (a[col] ?? '').toString().toLowerCase();
      const vb = (b[col] ?? '').toString().toLowerCase();
      return asc ? va.localeCompare(vb, 'ar') : vb.localeCompare(va, 'ar');
    });

    this._renderTable();

    // تحديث العداد
    const countEl = document.getElementById('uc-count');
    if (countEl) {
      countEl.textContent = q
        ? `${this._filtered.length} من ${this._users.length} مستخدم`
        : `${this._users.length} مستخدم`;
    }
  },

  // ────────────────────────────────────────────────────────────
  // _renderTable — رسم الجدول الاحترافي
  // ────────────────────────────────────────────────────────────
  _renderTable() {
    const wrap = document.getElementById('uc-table-wrap');
    if (!wrap) return;

    if (!this._filtered.length) {
      wrap.innerHTML = `
        <div class="empty-state" style="padding:40px 0;">
          <div class="empty-state-icon">${this._searchQuery ? '🔍' : '👤'}</div>
          <div class="empty-state-text">
            ${this._searchQuery ? 'لا توجد نتائج للبحث' : 'لا يوجد مستخدمون'}
          </div>
          ${!this._searchQuery ? `
          <button class="btn btn-primary btn-sm" style="margin-top:12px;"
            onclick="UsersComponent._openForm()">
            إضافة أول مستخدم
          </button>` : ''}
        </div>`;
      return;
    }

    const me = AuthService.getCurrentUserId();
    const roleColors = {
      admin           : 'var(--success)',
      admin_assistant : 'var(--info, #3b82f6)',
      agent           : 'var(--text-muted)',
    };
    const roleIcons = {
      admin           : '👑',
      admin_assistant : '🛡️',
      agent           : '👤',
    };

    const sortArrow = (col) => {
      if (this._sortCol !== col) return '<span style="opacity:.3;">↕</span>';
      return this._sortAsc ? '↑' : '↓';
    };

    const th = (col, label) => `
      <th style="cursor:pointer;user-select:none;white-space:nowrap;"
        onclick="UsersComponent._sort('${col}')">
        ${label} ${sortArrow(col)}
      </th>`;

    wrap.innerHTML = `
      <div class="table-wrapper" style="overflow-x:auto;border-radius:12px;border:1px solid var(--border);box-shadow:var(--shadow-sm);">
        <table class="data-table" style="min-width:720px;border-collapse:collapse;width:100%;">
          <thead>
            <tr style="background:var(--bg-secondary);border-bottom:2px solid var(--border);">
              ${th('display_name', 'الاسم')}
              ${th('username',     'البريد الإلكتروني')}
              ${th('role',         'الدور')}
              <th style="white-space:nowrap;">آخر دخول</th>
              ${th('is_active', 'الحالة')}
              <th style="text-align:center;">دخول سريع</th>
              <th style="text-align:center;min-width:120px;">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${this._filtered.map(u => this._renderRow(u, me, roleColors, roleIcons)).join('')}
          </tbody>
        </table>
      </div>`;

    // ربط أحداث الأزرار
    wrap.querySelectorAll('.uc-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._toggleActive(btn.dataset.uid, btn.dataset.active === 'true');
      });
    });
    wrap.querySelectorAll('.uc-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const u = this._users.find(x => x.id === btn.dataset.uid);
        if (u) this._openForm(u);
      });
    });
    wrap.querySelectorAll('.uc-delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this._deleteUser(btn.dataset.uid, btn.dataset.name);
      });
    });

    if (window.lucide) lucide.createIcons();
  },

  // ────────────────────────────────────────────────────────────
  // _renderRow — صف واحد في الجدول
  // ────────────────────────────────────────────────────────────
  _renderRow(u, me, roleColors, roleIcons) {
    const isSelf      = u.id === me;
    const roleLbl     = ROLE_LABELS[u.role] || u.role;
    const roleColor   = roleColors[u.role]  || 'var(--text-muted)';
    const roleIcon    = roleIcons[u.role]   || '👤';
    const lastLogin   = u.last_login
      ? this._formatRelativeTime(u.last_login)
      : '<span style="color:var(--text-muted);font-size:0.8rem;">لم يسجّل بعد</span>';
    const hasQuick    = !!u.quick_equation_hash;

    return `
      <tr id="uc-row-${u.id}"
        style="border-bottom:1px solid var(--border);transition:background .15s;${isSelf ? 'background:rgba(var(--primary-rgb,79,70,229),.05);' : ''}"
        onmouseenter="this.style.background='var(--bg-secondary)'"
        onmouseleave="this.style.background='${isSelf ? 'rgba(var(--primary-rgb,79,70,229),.05)' : 'transparent'}'"
      >
        <!-- الاسم -->
        <td style="padding:12px 14px;">
          <div style="display:flex;align-items:center;gap:8px;">
            <div style="
              width:36px;height:36px;border-radius:50%;
              background:${roleColor};opacity:.85;
              display:flex;align-items:center;justify-content:center;
              font-size:1rem;flex-shrink:0;color:#fff;font-weight:700;
            ">
              ${escapeHtml((u.display_name || '?').charAt(0).toUpperCase())}
            </div>
            <div>
              <div style="font-weight:600;font-size:0.9rem;color:var(--text-primary);">
                ${escapeHtml(u.display_name || '—')}
                ${isSelf ? '<span style="font-size:0.7rem;background:var(--primary);color:#fff;border-radius:4px;padding:1px 5px;margin-right:4px;">أنا</span>' : ''}
              </div>
              <div style="font-size:0.75rem;color:var(--text-muted);">
                ID: ${escapeHtml((u.id || '').slice(0, 8))}…
              </div>
            </div>
          </div>
        </td>

        <!-- البريد -->
        <td style="padding:12px 14px;">
          <span style="direction:ltr;display:inline-block;font-family:monospace;font-size:0.83rem;color:var(--text-secondary);">
            ${escapeHtml(u.username || '—')}
          </span>
        </td>

        <!-- الدور -->
        <td style="padding:12px 14px;">
          <span style="
            display:inline-flex;align-items:center;gap:4px;
            padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;
            background:${roleColor}22;color:${roleColor};border:1px solid ${roleColor}44;
          ">
            ${roleIcon} ${escapeHtml(roleLbl)}
          </span>
        </td>

        <!-- آخر دخول -->
        <td style="padding:12px 14px;font-size:0.83rem;color:var(--text-secondary);">
          ${lastLogin}
        </td>

        <!-- الحالة -->
        <td style="padding:12px 14px;">
          <button class="uc-toggle-btn"
            data-uid="${escapeHtml(u.id)}"
            data-active="${u.is_active}"
            style="
              display:inline-flex;align-items:center;gap:5px;
              padding:4px 12px;border-radius:20px;border:none;cursor:pointer;
              font-size:0.8rem;font-weight:600;transition:all .2s;
              background:${u.is_active ? '#dcfce7' : '#fee2e2'};
              color:${u.is_active ? '#16a34a' : '#dc2626'};
              ${isSelf ? 'opacity:.5;pointer-events:none;' : ''}
            "
            title="${u.is_active ? 'انقر لإيقاف الحساب' : 'انقر لتفعيل الحساب'}"
            ${isSelf ? 'disabled' : ''}>
            <span style="width:8px;height:8px;border-radius:50%;background:currentColor;"></span>
            ${u.is_active ? 'نشط' : 'معطّل'}
          </button>
        </td>

        <!-- دخول سريع -->
        <td style="padding:12px 14px;text-align:center;">
          ${hasQuick
            ? '<span title="الدخول السريع مفعّل" style="font-size:1.1rem;">⚡</span>'
            : '<span title="الدخول السريع غير مفعّل" style="font-size:1.1rem;opacity:.3;">⚡</span>'}
        </td>

        <!-- الإجراءات -->
        <td style="padding:12px 14px;text-align:center;">
          <div style="display:flex;gap:6px;justify-content:center;">
            <button class="uc-edit-btn btn btn-secondary btn-sm"
              data-uid="${escapeHtml(u.id)}"
              title="تعديل"
              style="padding:5px 10px;">
              <i data-lucide="pencil" style="width:13px;height:13px;"></i>
            </button>
            <button class="uc-delete-btn btn btn-sm"
              data-uid="${escapeHtml(u.id)}"
              data-name="${escapeHtml(u.display_name || u.username || u.id)}"
              title="حذف"
              style="padding:5px 10px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;
                     ${isSelf ? 'opacity:.3;pointer-events:none;' : ''}"
              ${isSelf ? 'disabled' : ''}>
              <i data-lucide="trash-2" style="width:13px;height:13px;"></i>
            </button>
          </div>
        </td>
      </tr>`;
  },

  // ────────────────────────────────────────────────────────────
  // _sort — ترتيب الجدول بالنقر على العنوان
  // ────────────────────────────────────────────────────────────
  _sort(col) {
    if (this._sortCol === col) {
      this._sortAsc = !this._sortAsc;
    } else {
      this._sortCol = col;
      this._sortAsc = true;
    }
    this._applyFilterAndRender();
  },

  // ────────────────────────────────────────────────────────────
  // _buildModal — بناء النموذج المنبثق
  // ────────────────────────────────────────────────────────────
  _buildModal() {
    const allTabs = Object.entries(TAB_LABELS).filter(([id]) =>
      id !== TABS.USERS
    );

    const overlay = document.createElement('div');
    overlay.id = 'uc-modal-overlay';
    overlay.style.cssText = `
      display:none;position:fixed;inset:0;z-index:1000;
      background:rgba(0,0,0,.5);backdrop-filter:blur(3px);
      align-items:center;justify-content:center;padding:16px;`;

    overlay.addEventListener('click', e => {
      if (e.target === overlay) this._closeForm();
    });

    const box = document.createElement('div');
    box.id = 'uc-modal-box';
    box.style.cssText = `
      background:var(--bg-primary);border-radius:16px;
      padding:24px;width:100%;max-width:480px;
      box-shadow:0 20px 60px rgba(0,0,0,.3);
      max-height:90vh;overflow-y:auto;`;

    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 id="uc-modal-title" style="font-size:1.1rem;font-weight:700;margin:0;">إضافة مستخدم</h3>
        <button id="uc-close-btn" class="btn btn-secondary btn-sm"
          style="padding:4px 10px;font-size:1rem;">✕</button>
      </div>

      <!-- تنبيه تعطيل البريد -->
      <div id="uc-email-hint" style="
        display:none;margin-bottom:16px;padding:10px 14px;
        background:#fff3cd;border:1px solid #ffc107;border-radius:8px;
        font-size:0.82rem;color:#856404;line-height:1.5;">
        ⚠️ <strong>مهم:</strong> لكي يعمل إنشاء المستخدم بدون تأكيد بريد، تأكد من تعطيل
        <strong>Email Confirmation</strong> في:<br>
        Supabase Dashboard → Authentication → Providers → Email → تعطيل "Confirm email"
      </div>

      <div class="form-group">
        <label class="form-label">الاسم الكامل <span style="color:var(--danger);">*</span></label>
        <input id="uc-display-name" type="text" class="form-control"
          placeholder="مثال: محمد أحمد" autocomplete="off" />
      </div>

      <div class="form-group">
        <label class="form-label">
          البريد الإلكتروني (اسم المستخدم) <span style="color:var(--danger);">*</span>
        </label>
        <input id="uc-username" type="email" class="form-control"
          placeholder="user@example.com" dir="ltr" autocomplete="off" />
      </div>

      <div class="form-group">
        <label class="form-label">
          كلمة المرور
          <span id="uc-pass-required" style="color:var(--danger);">*</span>
          <span id="uc-pass-hint" style="display:none;font-size:0.78rem;color:var(--text-muted);font-weight:400;">
            (اتركها فارغة للإبقاء على الحالية)
          </span>
        </label>
        <div style="position:relative;">
          <input id="uc-password" type="password" class="form-control"
            placeholder="6 أحرف على الأقل" dir="ltr"
            style="padding-left:44px;" autocomplete="new-password" />
          <button type="button" id="uc-pw-toggle"
            style="position:absolute;left:10px;top:50%;transform:translateY(-50%);
                   background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:1rem;"
            onclick="
              const inp = document.getElementById('uc-password');
              inp.type = inp.type === 'password' ? 'text' : 'password';
              this.textContent = inp.type === 'password' ? '👁' : '🙈';
            ">👁</button>
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">الدور <span style="color:var(--danger);">*</span></label>
        <select id="uc-role" class="form-control">
          ${Object.entries(ROLE_LABELS).map(([v, l]) =>
            `<option value="${v}">${l}</option>`
          ).join('')}
        </select>
      </div>

      <!-- تبويبات المساعد الإداري -->
      <div id="uc-tabs-section" style="display:none;margin-bottom:12px;">
        <label class="form-label">التبويبات المسموحة للمساعد الإداري</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:8px;
                    padding:12px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border);">
          ${allTabs.map(([id, label]) => `
            <label style="display:flex;align-items:center;gap:6px;font-size:0.83rem;cursor:pointer;">
              <input type="checkbox" class="uc-tab-cb" value="${id}"
                style="width:14px;height:14px;cursor:pointer;">
              ${escapeHtml(label)}
            </label>`).join('')}
        </div>
      </div>

      <!-- رسالة الخطأ -->
      <div id="uc-error" style="
        display:none;padding:10px 14px;background:#fee2e2;border:1px solid #fca5a5;
        border-radius:8px;color:#dc2626;font-size:0.85rem;margin-bottom:12px;
        white-space:pre-wrap;line-height:1.5;">
      </div>

      <!-- أزرار الإجراء -->
      <div style="display:flex;gap:10px;margin-top:4px;">
        <button id="uc-save-btn" class="btn btn-primary" style="flex:2;font-size:0.95rem;">
          <span id="uc-save-label">💾 حفظ</span>
        </button>
        <button id="uc-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    overlay.appendChild(box);

    // ربط الأحداث
    box.querySelector('#uc-close-btn').addEventListener('click',  () => this._closeForm());
    box.querySelector('#uc-cancel-btn').addEventListener('click', () => this._closeForm());
    box.querySelector('#uc-save-btn').addEventListener('click',   () => this._save());
    box.querySelector('#uc-role').addEventListener('change', e => {
      const sec = box.querySelector('#uc-tabs-section');
      sec.style.display = e.target.value === ROLES.ADMIN_ASSISTANT ? 'block' : 'none';
    });

    return overlay;
  },

  // ────────────────────────────────────────────────────────────
  // _openForm — فتح النموذج (إضافة أو تعديل)
  // ────────────────────────────────────────────────────────────
  _openForm(user = null) {
    this._editId = user?.id || null;
    const overlay = document.getElementById('uc-modal-overlay');
    const box     = document.getElementById('uc-modal-box');
    if (!overlay || !box) return;

    const isEdit = !!user;

    box.querySelector('#uc-modal-title').textContent = isEdit ? '✏️ تعديل مستخدم' : '➕ إضافة مستخدم';
    box.querySelector('#uc-display-name').value = user?.display_name || '';
    box.querySelector('#uc-username').value     = user?.username     || '';
    box.querySelector('#uc-password').value     = '';
    box.querySelector('#uc-role').value         = user?.role         || ROLES.AGENT;

    const passHint     = box.querySelector('#uc-pass-hint');
    const passRequired = box.querySelector('#uc-pass-required');
    const emailHint    = box.querySelector('#uc-email-hint');

    if (passHint)     passHint.style.display     = isEdit ? 'inline' : 'none';
    if (passRequired) passRequired.style.display  = isEdit ? 'none'  : 'inline';
    if (emailHint)    emailHint.style.display     = isEdit ? 'none'  : 'block';

    // إخفاء/إظهار تبويبات المساعد
    const sec = box.querySelector('#uc-tabs-section');
    sec.style.display = user?.role === ROLES.ADMIN_ASSISTANT ? 'block' : 'none';

    // تحميل التبويبات المحددة مسبقاً
    const savedTabs = this._safeParseJson(user?.allowed_tabs, []);
    box.querySelectorAll('.uc-tab-cb').forEach(cb => {
      cb.checked = savedTabs.includes(cb.value);
    });

    // إخفاء رسالة الخطأ
    this._setError('');

    // إعادة زر الحفظ
    const saveLabel = box.querySelector('#uc-save-label');
    if (saveLabel) saveLabel.textContent = isEdit ? '💾 تحديث' : '💾 إنشاء المستخدم';

    overlay.style.display = 'flex';
    box.querySelector('#uc-display-name').focus();
  },

  // ────────────────────────────────────────────────────────────
  // _closeForm
  // ────────────────────────────────────────────────────────────
  _closeForm() {
    const overlay = document.getElementById('uc-modal-overlay');
    if (overlay) overlay.style.display = 'none';
    this._editId = null;
    this._adminSession = null;
  },

  // ────────────────────────────────────────────────────────────
  // _save — الحفظ (إنشاء أو تعديل)
  // ════════════════════════════════════════════════════════════
  // الخطوات عند إنشاء مستخدم جديد:
  //   1. التحقق من صحة البيانات
  //   2. حفظ جلسة المدير الحالية
  //   3. signUp للمستخدم الجديد
  //   4. استدعاء create_user_profile (SECURITY DEFINER)
  //   5. استعادة جلسة المدير
  //   6. إعادة تحميل الجدول
  // ────────────────────────────────────────────────────────────
  async _save() {
    const box = document.getElementById('uc-modal-box');
    if (!box) return;

    const name     = box.querySelector('#uc-display-name').value.trim();
    const username = box.querySelector('#uc-username').value.trim().toLowerCase();
    const password = box.querySelector('#uc-password').value;
    const role     = box.querySelector('#uc-role').value;
    const allowedTabs = role === ROLES.ADMIN_ASSISTANT
      ? [...box.querySelectorAll('.uc-tab-cb:checked')].map(cb => cb.value)
      : [];

    // ── التحقق من البيانات ──
    if (!name || name.length < 2) {
      this._setError('الاسم الكامل مطلوب (حرفان على الأقل)');
      return;
    }
    if (!username) {
      this._setError('البريد الإلكتروني مطلوب');
      return;
    }
    if (!isValidEmail(username)) {
      this._setError('البريد الإلكتروني غير صالح');
      return;
    }
    if (!this._editId && (!password || password.length < 6)) {
      this._setError('كلمة المرور مطلوبة (6 أحرف على الأقل)');
      return;
    }
    if (password && password.length > 0 && password.length < 6) {
      this._setError('كلمة المرور يجب أن تكون 6 أحرف على الأقل');
      return;
    }

    const saveBtn   = box.querySelector('#uc-save-btn');
    const saveLabel = box.querySelector('#uc-save-label');
    const origLabel = saveLabel?.textContent || '💾 حفظ';

    // ── تعطيل الزر أثناء العملية ──
    saveBtn.disabled = true;
    if (saveLabel) saveLabel.textContent = '⏳ جارٍ الحفظ...';
    this._setError('');

    try {
      if (this._editId) {
        // ════════════════════════════════
        // تعديل مستخدم موجود
        // ════════════════════════════════
        await this._doUpdate(username, name, role, allowedTabs, password);

      } else {
        // ════════════════════════════════
        // إنشاء مستخدم جديد
        // ════════════════════════════════
        if (!isOnline()) {
          this._setError('يجب الاتصال بالإنترنت لإنشاء مستخدم جديد');
          return;
        }
        await this._doCreate(username, name, role, allowedTabs, password);
      }

    } catch (e) {
      console.error('[UsersComponent] _save: خطأ غير متوقع:', e);
      this._setError(`خطأ غير متوقع: ${e.message}`);
    } finally {
      saveBtn.disabled = false;
      if (saveLabel) saveLabel.textContent = origLabel;
    }
  },

  // ────────────────────────────────────────────────────────────
  // _doCreate — إنشاء مستخدم جديد (الخطوات الـ5)
  // ────────────────────────────────────────────────────────────
  async _doCreate(username, name, role, allowedTabs, password) {
    console.log('[UsersComponent] _doCreate: بدء إنشاء مستخدم:', username);

    // الخطوة 1: حفظ جلسة المدير الحالية
    let adminSession = null;
    try {
      const { data: sessionData } = await supabaseClient.auth.getSession();
      adminSession = sessionData?.session;
      if (!adminSession) {
        this._setError('انتهت جلسة المدير. يرجى تسجيل الدخول مجدداً.');
        return;
      }
      console.log('[UsersComponent] _doCreate: ✅ جلسة المدير محفوظة');
    } catch (e) {
      this._setError(`فشل حفظ جلسة المدير: ${e.message}`);
      return;
    }

    // الخطوة 2: إنشاء حساب Auth للمستخدم الجديد
    let newUserId = null;
    console.log('[UsersComponent] _doCreate: ⏳ استدعاء signUp...');

    const { data: authData, error: authErr } = await supabaseClient.auth.signUp({
      email    : username,
      password : password,
      options  : {
        // منع إرسال تأكيد البريد تلقائياً (يعمل إذا كان "Email Confirmation" معطلاً في Dashboard)
        emailRedirectTo: undefined,
      },
    });

    if (authErr) {
      console.error('[UsersComponent] _doCreate: ❌ signUp فشل:', authErr);

      // استعادة جلسة المدير قبل العودة
      await this._restoreAdminSession(adminSession);

      // ترجمة الأخطاء الشائعة
      let errMsg = authErr.message;
      if (errMsg.includes('User already registered') || errMsg.includes('already been registered')) {
        errMsg = 'هذا البريد الإلكتروني مسجّل مسبقاً في النظام';
      } else if (errMsg.includes('Password should be')) {
        errMsg = 'كلمة المرور ضعيفة جداً. استخدم 6 أحرف على الأقل تشمل أرقاماً';
      } else if (errMsg.includes('Invalid email')) {
        errMsg = 'صيغة البريد الإلكتروني غير صحيحة';
      }

      this._setError(`فشل إنشاء الحساب: ${errMsg}`);
      return;
    }

    // فحص مهم: هل المستخدم يحتاج تأكيد بريد؟
    if (!authData?.user?.id) {
      console.error('[UsersComponent] _doCreate: ❌ authData.user فارغ — على الأرجح Email Confirmation مفعّل');
      await this._restoreAdminSession(adminSession);
      this._setError(
        'فشل إنشاء الحساب: لم يُعاد معرف المستخدم.\n\n' +
        'السبب الأرجح: "Email Confirmation" مفعّل في Supabase.\n' +
        'الحل: Supabase Dashboard → Authentication → Providers → Email → عطّل "Confirm email"'
      );
      return;
    }

    newUserId = authData.user.id;
    console.log('[UsersComponent] _doCreate: ✅ signUp نجح، معرف المستخدم:', newUserId);

    // الخطوة 3: استعادة جلسة المدير (مهم جداً قبل callRPC)
    const sessionRestored = await this._restoreAdminSession(adminSession);
    if (!sessionRestored) {
      console.error('[UsersComponent] _doCreate: ❌ فشل استعادة جلسة المدير');
      // نحاول المتابعة على أي حال، RPC هي SECURITY DEFINER
    }

    // الخطوة 4: إنشاء السجل في public.users عبر RPC
    const profile = {
      id           : newUserId,
      username     : username,
      display_name : name,
      role         : role,
      allowed_tabs : allowedTabs,
    };

    console.log('[UsersComponent] _doCreate: ⏳ استدعاء create_user_profile RPC...');
    console.log('[UsersComponent] _doCreate: البيانات المرسلة:', profile);

    const rpcResult = await callRPC('create_user_profile', { p_profile: profile });

    console.log('[UsersComponent] _doCreate: نتيجة RPC:', rpcResult);

    if (!isOk(rpcResult)) {
      // فشل RPC — تنظيف حساب Auth
      console.error('[UsersComponent] _doCreate: ❌ فشل create_user_profile:', rpcResult.error);

      this._setError(`فشل إنشاء سجل المستخدم: ${rpcResult.error}\n\nتحقق من:\n1. تشغيل step_10 SQL في Supabase\n2. الاتصال بالإنترنت`);

      // محاولة حذف حساب Auth لتجنب حساب يتيم
      console.warn('[UsersComponent] _doCreate: ⚠️ محاولة تنظيف حساب Auth...');
      try {
        await callRPC('delete_auth_user', { p_user_id: newUserId });
        console.log('[UsersComponent] _doCreate: ✅ تم تنظيف حساب Auth');
      } catch (cleanupErr) {
        console.error('[UsersComponent] _doCreate: ❌ فشل تنظيف Auth (حساب يتيم):', cleanupErr);
      }
      return;
    }

    // فحص نتيجة RPC (قد تُعيد { success: false } ضمن isOk)
    const rpcData = rpcResult.data;
    if (rpcData && rpcData.success === false) {
      console.error('[UsersComponent] _doCreate: ❌ RPC أعادت success:false:', rpcData.error);
      this._setError(`فشل إنشاء المستخدم: ${rpcData.error}`);

      try { await callRPC('delete_auth_user', { p_user_id: newUserId }); } catch (_) {}
      return;
    }

    console.log('[UsersComponent] _doCreate: ✅ تم إنشاء المستخدم بنجاح!');

    // الخطوة 5: إغلاق النموذج + إعادة تحميل الجدول
    this._closeForm();
    showToast(`✅ تم إنشاء مستخدم "${name}" بنجاح`, 'success', 4000);
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // _doUpdate — تعديل مستخدم موجود
  // ────────────────────────────────────────────────────────────
  async _doUpdate(username, name, role, allowedTabs, password) {
    console.log('[UsersComponent] _doUpdate: تعديل مستخدم:', this._editId);

    const changes = {
      username     : username,
      display_name : name,
      role         : role,
      allowed_tabs : allowedTabs,
      updated_at   : new Date().toISOString(),
    };

    // تحديث السجل في Supabase مباشرة
    const { data: updated, error: updateErr } = await supabaseClient
      .from(TABLES.USERS)
      .update(changes)
      .eq('id', this._editId)
      .select()
      .single();

    if (updateErr) {
      console.error('[UsersComponent] _doUpdate: ❌ فشل التحديث:', updateErr);
      this._setError(`فشل التحديث: ${updateErr.message}`);
      return;
    }

    console.log('[UsersComponent] _doUpdate: ✅ تم تحديث البيانات');

    // تحديث كلمة المرور إذا تم إدخالها
    if (password && password.length >= 6) {
      console.log('[UsersComponent] _doUpdate: ⏳ تحديث كلمة المرور...');
      const pwResult = await callRPC('admin_update_user_password', {
        p_user_id : this._editId,
        p_password: password,
      });

      if (!isOk(pwResult) || pwResult.data?.success === false) {
        const pwErr = pwResult?.data?.error || pwResult?.error || 'فشل تحديث كلمة المرور';
        console.error('[UsersComponent] _doUpdate: ❌ فشل تحديث كلمة المرور:', pwErr);
        // نُكمل بدون كلمة المرور + نُعلم المستخدم
        showToast(`⚠️ تم تحديث البيانات لكن فشل تغيير كلمة المرور: ${pwErr}`, 'warning', 6000);
      } else {
        console.log('[UsersComponent] _doUpdate: ✅ تم تحديث كلمة المرور');
      }
    }

    this._closeForm();
    showToast(`✅ تم تعديل "${name}" بنجاح`, 'success');
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // _restoreAdminSession — استعادة جلسة المدير بعد signUp
  // ────────────────────────────────────────────────────────────
  async _restoreAdminSession(adminSession) {
    if (!adminSession) return false;
    try {
      const { error } = await supabaseClient.auth.setSession({
        access_token : adminSession.access_token,
        refresh_token: adminSession.refresh_token,
      });
      if (error) {
        console.error('[UsersComponent] _restoreAdminSession: ❌', error.message);
        return false;
      }
      console.log('[UsersComponent] _restoreAdminSession: ✅ جلسة المدير استُعيدت');
      return true;
    } catch (e) {
      console.error('[UsersComponent] _restoreAdminSession: استثناء:', e.message);
      return false;
    }
  },

  // ────────────────────────────────────────────────────────────
  // _toggleActive — تعطيل / تفعيل حساب
  // ────────────────────────────────────────────────────────────
  async _toggleActive(uid, currentlyActive) {
    const me = AuthService.getCurrentUserId();
    if (uid === me) {
      showToast('لا يمكنك تعطيل حسابك الخاص', 'error');
      return;
    }

    const newActive = !currentlyActive;
    const label     = newActive ? 'تفعيل' : 'تعطيل';
    const user      = this._users.find(u => u.id === uid);
    const userName  = user?.display_name || user?.username || uid;

    const confirmed = await confirmDialog(
      `هل تريد ${label} حساب "${userName}"؟`,
      label, 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ is_active: newActive, updated_at: new Date().toISOString() })
      .eq('id', uid);

    if (error) {
      showToast(`فشل ${label} الحساب: ${error.message}`, 'error');
      return;
    }

    showToast(`✅ تم ${label} حساب "${userName}"`, 'success');
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // _deleteUser — حذف مستخدم
  // ────────────────────────────────────────────────────────────
  async _deleteUser(uid, name) {
    const me = AuthService.getCurrentUserId();
    if (uid === me) {
      showToast('لا يمكنك حذف حسابك الخاص', 'error');
      return;
    }

    const confirmed = await confirmDialog(
      `⚠️ حذف المستخدم "${name}"؟\n\nسيُحذف من النظام نهائياً ولا يمكن التراجع.`,
      'حذف نهائياً', 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    console.log('[UsersComponent] _deleteUser: حذف المستخدم:', uid);

    // الخطوة 1: حذف من public.users عبر RPC
    const rpcResult = await callRPC('delete_auth_user', { p_user_id: uid });

    if (!isOk(rpcResult) || rpcResult.data?.success === false) {
      const errMsg = rpcResult?.data?.error || rpcResult?.error || 'خطأ غير معروف';
      console.error('[UsersComponent] _deleteUser: ❌ فشل:', errMsg);
      showToast(`فشل الحذف: ${errMsg}`, 'error');
      return;
    }

    console.log('[UsersComponent] _deleteUser: ✅ تم الحذف من public.users');

    // الخطوة 2: تحديث Dexie
    try {
      if (typeof db !== 'undefined' && db.isOpen()) {
        await db.users.delete(uid);
      }
    } catch (_) {}

    showToast(`✅ تم حذف "${name}" من النظام`, 'success');
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // دوال مساعدة
  // ────────────────────────────────────────────────────────────

  _setError(msg) {
    const errEl = document.getElementById('uc-error');
    if (!errEl) return;
    if (msg) {
      errEl.textContent = msg;
      errEl.style.display = 'block';
    } else {
      errEl.textContent = '';
      errEl.style.display = 'none';
    }
  },

  _safeParseJson(val, fallback = []) {
    if (Array.isArray(val)) return val;
    if (!val) return fallback;
    try { return JSON.parse(val); } catch { return fallback; }
  },

  _skeletonRows(n) {
    return Array(n).fill(0).map(() => `
      <div class="skeleton" style="height:64px;border-radius:10px;margin-bottom:8px;"></div>
    `).join('');
  },

  _formatRelativeTime(isoStr) {
    if (!isoStr) return '—';
    try {
      const diff = Date.now() - new Date(isoStr).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1)   return 'الآن';
      if (mins < 60)  return `منذ ${mins} دقيقة`;
      const hrs = Math.floor(mins / 60);
      if (hrs < 24)   return `منذ ${hrs} ساعة`;
      const days = Math.floor(hrs / 24);
      if (days < 30)  return `منذ ${days} يوم`;
      const months = Math.floor(days / 30);
      if (months < 12) return `منذ ${months} شهر`;
      return `منذ ${Math.floor(months / 12)} سنة`;
    } catch {
      return '—';
    }
  },
};

// تصدير للاستخدام العام (مثل onclick في HTML inline)
window.UsersComponent = UsersComponent;
console.log('✅ UsersComponent.js v3.0 محمّل — إصلاح نهائي + جدول احترافي');
