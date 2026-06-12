/**
 * components/UsersComponent.js — v3.1 (إصلاح نهائي متوافق مع قاعدة البيانات)
 * نظام أبو حذيفة — إدارة المستخدمين (للمدير فقط)
 *
 * ═══════════════════════════════════════════════════════════════
 * ملخص الإصلاحات (بعد الفحص المباشر لقاعدة البيانات):
 * ═══════════════════════════════════════════════════════════════
 *
 * 🔴 إصلاح 1 — السبب الجذري:
 *    الدوال القديمة كانت تُعيد { ok, error } لكن الكود يفحص { success }
 *    → الدوال في قاعدة البيانات تم تحديثها لتُعيد { success, ok, error }
 *    → الكود هنا يفحص: isOk(result) && result.data?.ok !== false
 *
 * 🔴 إصلاح 2 — signUp يُحوّل جلسة المدير:
 *    → نحفظ جلسة المدير قبل signUp ونستعيدها بعده
 *
 * 🔴 إصلاح 3 — Email Confirmation:
 *    → رسالة خطأ واضحة إذا authData.user كان null
 *
 * 🟡 تحسين 4 — جدول احترافي:
 *    → بحث فوري، ترتيب، last_login، ألوان الأدوار
 *
 * 🟡 تحسين 5 — استعلام مباشر عبر supabaseClient (بدون cache)
 * ═══════════════════════════════════════════════════════════════
 */
'use strict';

const UsersComponent = {
  _modal       : null,
  _editId      : null,
  _users       : [],
  _filtered    : [],
  _searchQuery : '',
  _sortCol     : 'display_name',
  _sortAsc     : true,

  // ────────────────────────────────────────────────────────────
  // render
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

    // شريط العنوان
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

    // بحث
    const searchWrap = document.createElement('div');
    searchWrap.innerHTML = `
      <input id="uc-search" type="text" class="form-control"
        placeholder="🔍  بحث بالاسم أو البريد أو الدور..."
        style="font-size:0.9rem;" />`;
    wrap.appendChild(searchWrap);

    // الجدول
    const tableWrap = document.createElement('div');
    tableWrap.id = 'uc-table-wrap';
    tableWrap.innerHTML = this._skeleton(5);
    wrap.appendChild(tableWrap);

    // المودال
    this._modal = this._buildModal();
    wrap.appendChild(this._modal);

    container.appendChild(wrap);

    document.getElementById('uc-search')?.addEventListener('input', e => {
      this._searchQuery = e.target.value.trim().toLowerCase();
      this._applyFilterAndRender();
    });

    await this._load();
    if (window.lucide) lucide.createIcons();
  },

  // ────────────────────────────────────────────────────────────
  // _load — استعلام مباشر بدون cache
  // ────────────────────────────────────────────────────────────
  async _load() {
    console.log('[UsersComponent] _load...');
    try {
      if (isOnline()) {
        const { data, error } = await supabaseClient
          .from(TABLES.USERS)
          .select('id, username, display_name, role, is_active, allowed_tabs, last_login, created_at')
          .order('display_name', { ascending: true });

        if (!error && data) {
          this._users = data;
          console.log(`[UsersComponent] ✅ جُلب ${data.length} مستخدم`);
          if (window.AppStore) AppStore.setState('users', data);
          // Dexie في الخلفية
          if (typeof db !== 'undefined' && db.isOpen()) {
            db.users.bulkPut(data.map(u => ({ ...u, sync_status: SYNC_STATUS.SYNCED }))).catch(() => {});
          }
          this._applyFilterAndRender();
          return;
        }
        console.warn('[UsersComponent] فشل Supabase:', error?.message);
      }

      // احتياط: repo
      const result = await repo.query(TABLES.USERS, {}, {
        orderBy: 'display_name', ascending: true, pageSize: 200, forceRefresh: true,
      });
      this._users = isOk(result) ? (result.data?.data || result.data || []) : [];

    } catch (e) {
      console.error('[UsersComponent] _load خطأ:', e);
      this._users = [];
    }
    this._applyFilterAndRender();
  },

  // ────────────────────────────────────────────────────────────
  // _applyFilterAndRender
  // ────────────────────────────────────────────────────────────
  _applyFilterAndRender() {
    const q = this._searchQuery;
    this._filtered = q
      ? this._users.filter(u =>
          (u.display_name || '').toLowerCase().includes(q) ||
          (u.username     || '').toLowerCase().includes(q) ||
          (ROLE_LABELS[u.role] || u.role || '').toLowerCase().includes(q))
      : [...this._users];

    const col = this._sortCol;
    const asc = this._sortAsc;
    this._filtered.sort((a, b) => {
      const va = String(a[col] ?? '').toLowerCase();
      const vb = String(b[col] ?? '').toLowerCase();
      return asc ? va.localeCompare(vb, 'ar') : vb.localeCompare(va, 'ar');
    });

    this._renderTable();

    const countEl = document.getElementById('uc-count');
    if (countEl) countEl.textContent = q
      ? `${this._filtered.length} من ${this._users.length} مستخدم`
      : `${this._users.length} مستخدم`;
  },

  // ────────────────────────────────────────────────────────────
  // _renderTable
  // ────────────────────────────────────────────────────────────
  _renderTable() {
    const wrap = document.getElementById('uc-table-wrap');
    if (!wrap) return;

    if (!this._filtered.length) {
      wrap.innerHTML = `
        <div class="empty-state" style="padding:40px 0;">
          <div class="empty-state-icon">${this._searchQuery ? '🔍' : '👤'}</div>
          <div class="empty-state-text">${this._searchQuery ? 'لا توجد نتائج' : 'لا يوجد مستخدمون'}</div>
        </div>`;
      return;
    }

    const me = AuthService.getCurrentUserId();
    const roleStyle = {
      admin           : { bg: '#dcfce7', color: '#16a34a', icon: '👑' },
      admin_assistant : { bg: '#dbeafe', color: '#1d4ed8', icon: '🛡️' },
      agent           : { bg: '#f3f4f6', color: '#374151', icon: '👤' },
    };

    const arrow = col => this._sortCol !== col
      ? '<span style="opacity:.3">↕</span>'
      : (this._sortAsc ? '↑' : '↓');

    const th = (col, lbl) =>
      `<th style="cursor:pointer;user-select:none;white-space:nowrap;padding:10px 12px;
        background:var(--bg-secondary);font-size:0.82rem;font-weight:600;color:var(--text-secondary);"
        onclick="UsersComponent._sort('${col}')">${lbl} ${arrow(col)}</th>`;

    wrap.innerHTML = `
      <div style="overflow-x:auto;border-radius:12px;border:1px solid var(--border);box-shadow:0 1px 4px rgba(0,0,0,.06);">
        <table style="min-width:700px;border-collapse:collapse;width:100%;">
          <thead>
            <tr>
              ${th('display_name','الاسم')}
              ${th('username','البريد الإلكتروني')}
              ${th('role','الدور')}
              <th style="padding:10px 12px;background:var(--bg-secondary);font-size:0.82rem;font-weight:600;color:var(--text-secondary);white-space:nowrap;">آخر دخول</th>
              ${th('is_active','الحالة')}
              <th style="padding:10px 12px;background:var(--bg-secondary);font-size:0.82rem;font-weight:600;color:var(--text-secondary);text-align:center;">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${this._filtered.map(u => {
              const isSelf = u.id === me;
              const rs = roleStyle[u.role] || roleStyle.agent;
              const initial = (u.display_name || u.username || '?').charAt(0).toUpperCase();
              return `
              <tr style="border-bottom:1px solid var(--border);${isSelf?'background:rgba(99,102,241,.04);':''}">
                <td style="padding:12px;">
                  <div style="display:flex;align-items:center;gap:9px;">
                    <div style="width:34px;height:34px;border-radius:50%;background:${rs.bg};color:${rs.color};
                      display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.9rem;flex-shrink:0;">
                      ${escapeHtml(initial)}
                    </div>
                    <div>
                      <div style="font-weight:600;font-size:.88rem;">
                        ${escapeHtml(u.display_name||'—')}
                        ${isSelf?'<span style="font-size:.7rem;background:#6366f1;color:#fff;border-radius:4px;padding:1px 5px;margin-right:3px;">أنا</span>':''}
                      </div>
                      <div style="font-size:.73rem;color:var(--text-muted);">${escapeHtml((u.id||'').slice(0,8))}…</div>
                    </div>
                  </div>
                </td>
                <td style="padding:12px;font-family:monospace;font-size:.82rem;color:var(--text-secondary);direction:ltr;">
                  ${escapeHtml(u.username||'—')}
                </td>
                <td style="padding:12px;">
                  <span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;
                    font-size:.78rem;font-weight:600;background:${rs.bg};color:${rs.color};">
                    ${rs.icon} ${escapeHtml(ROLE_LABELS[u.role]||u.role)}
                  </span>
                </td>
                <td style="padding:12px;font-size:.82rem;color:var(--text-secondary);">
                  ${u.last_login ? this._timeAgo(u.last_login) : '<span style="opacity:.45;">لم يسجّل بعد</span>'}
                </td>
                <td style="padding:12px;">
                  <button class="uc-toggle-btn"
                    data-uid="${escapeHtml(u.id)}" data-active="${u.is_active}"
                    style="display:inline-flex;align-items:center;gap:5px;padding:4px 12px;border-radius:20px;
                      border:none;cursor:pointer;font-size:.78rem;font-weight:600;
                      background:${u.is_active?'#dcfce7':'#fee2e2'};
                      color:${u.is_active?'#16a34a':'#dc2626'};
                      ${isSelf?'opacity:.4;pointer-events:none;':''}"
                    ${isSelf?'disabled':''}>
                    <span style="width:7px;height:7px;border-radius:50%;background:currentColor;"></span>
                    ${u.is_active?'نشط':'معطّل'}
                  </button>
                </td>
                <td style="padding:12px;text-align:center;">
                  <div style="display:flex;gap:5px;justify-content:center;">
                    <button class="uc-edit-btn btn btn-secondary btn-sm" data-uid="${escapeHtml(u.id)}"
                      title="تعديل" style="padding:5px 9px;">
                      <i data-lucide="pencil" style="width:12px;height:12px;"></i>
                    </button>
                    <button class="uc-delete-btn btn btn-sm"
                      data-uid="${escapeHtml(u.id)}"
                      data-name="${escapeHtml(u.display_name||u.username||u.id)}"
                      title="حذف"
                      style="padding:5px 9px;background:#fee2e2;color:#dc2626;border:1px solid #fca5a5;
                        ${isSelf?'opacity:.3;pointer-events:none;':''}"
                      ${isSelf?'disabled':''}>
                      <i data-lucide="trash-2" style="width:12px;height:12px;"></i>
                    </button>
                  </div>
                </td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>`;

    wrap.querySelectorAll('.uc-toggle-btn').forEach(b =>
      b.addEventListener('click', () => this._toggleActive(b.dataset.uid, b.dataset.active === 'true')));
    wrap.querySelectorAll('.uc-edit-btn').forEach(b =>
      b.addEventListener('click', () => this._openForm(this._users.find(x => x.id === b.dataset.uid))));
    wrap.querySelectorAll('.uc-delete-btn').forEach(b =>
      b.addEventListener('click', () => this._deleteUser(b.dataset.uid, b.dataset.name)));

    if (window.lucide) lucide.createIcons();
  },

  _sort(col) {
    this._sortAsc = this._sortCol === col ? !this._sortAsc : true;
    this._sortCol = col;
    this._applyFilterAndRender();
  },

  // ────────────────────────────────────────────────────────────
  // _buildModal
  // ────────────────────────────────────────────────────────────
  _buildModal() {
    const allTabs = Object.entries(TAB_LABELS).filter(([id]) => id !== TABS.USERS);
    const overlay = document.createElement('div');
    overlay.id = 'uc-modal-overlay';
    overlay.style.cssText = `display:none;position:fixed;inset:0;z-index:1000;
      background:rgba(0,0,0,.5);backdrop-filter:blur(3px);
      align-items:center;justify-content:center;padding:16px;`;
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeForm(); });

    const box = document.createElement('div');
    box.id = 'uc-modal-box';
    box.style.cssText = `background:var(--bg-primary);border-radius:16px;
      padding:24px;width:100%;max-width:460px;
      box-shadow:0 20px 60px rgba(0,0,0,.25);max-height:90vh;overflow-y:auto;`;

    box.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h3 id="uc-modal-title" style="font-size:1.1rem;font-weight:700;margin:0;"></h3>
        <button id="uc-close-btn" class="btn btn-secondary btn-sm" style="padding:4px 10px;">✕</button>
      </div>

      <div id="uc-email-hint" style="display:none;margin-bottom:14px;padding:10px 13px;
        background:#fff3cd;border:1px solid #ffc107;border-radius:8px;font-size:.81rem;color:#856404;line-height:1.6;">
        ⚠️ <strong>قبل الإضافة:</strong> تأكد من تعطيل <strong>Email Confirmation</strong> في:<br>
        Supabase → Authentication → Providers → Email → أوقف «Confirm email»
      </div>

      <div class="form-group">
        <label class="form-label">الاسم الكامل <span style="color:var(--danger)">*</span></label>
        <input id="uc-display-name" type="text" class="form-control" placeholder="مثال: محمد أحمد" />
      </div>

      <div class="form-group">
        <label class="form-label">البريد الإلكتروني <span style="color:var(--danger)">*</span></label>
        <input id="uc-username" type="email" class="form-control" placeholder="user@example.com" dir="ltr" />
      </div>

      <div class="form-group">
        <label class="form-label">
          كلمة المرور
          <span id="uc-pass-required" style="color:var(--danger)">*</span>
          <span id="uc-pass-hint" style="display:none;font-size:.77rem;color:var(--text-muted);font-weight:400;">
            (فارغة = بدون تغيير)
          </span>
        </label>
        <input id="uc-password" type="password" class="form-control"
          placeholder="6 أحرف على الأقل" dir="ltr" autocomplete="new-password" />
      </div>

      <div class="form-group">
        <label class="form-label">الدور <span style="color:var(--danger)">*</span></label>
        <select id="uc-role" class="form-control">
          ${Object.entries(ROLE_LABELS).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}
        </select>
      </div>

      <div id="uc-tabs-section" style="display:none;margin-bottom:14px;">
        <label class="form-label">التبويبات المسموحة</label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;padding:12px;
          background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border);">
          ${allTabs.map(([id,lbl]) => `
            <label style="display:flex;align-items:center;gap:6px;font-size:.82rem;cursor:pointer;">
              <input type="checkbox" class="uc-tab-cb" value="${id}" />
              ${escapeHtml(lbl)}
            </label>`).join('')}
        </div>
      </div>

      <div id="uc-agent-section" style="display:none;margin-bottom:14px;">
        <div style="font-size:.82rem;color:var(--text-muted);margin-bottom:10px;padding:8px 12px;background:var(--bg-secondary);border-radius:8px;">
          ⚙️ صلاحيات المندوب — اتركها فارغة للسماح بالكل
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label" style="font-size:.82rem;">الشركات المسموحة</label>
          <div id="uc-companies-list" style="max-height:140px;overflow-y:auto;padding:8px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:4px;"></div>
        </div>
        <div class="form-group" style="margin-bottom:10px;">
          <label class="form-label" style="font-size:.82rem;">الحسابات البنكية المسموحة</label>
          <div id="uc-banks-list" style="max-height:140px;overflow-y:auto;padding:8px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:4px;"></div>
        </div>
        <div class="form-group">
          <label class="form-label" style="font-size:.82rem;">المستخدمون المسموح التحويل إليهم</label>
          <div id="uc-users-list" style="max-height:140px;overflow-y:auto;padding:8px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border);display:grid;grid-template-columns:1fr 1fr;gap:4px;"></div>
        </div>
      </div>

      <div id="uc-error" style="display:none;padding:10px 13px;background:#fee2e2;
        border:1px solid #fca5a5;border-radius:8px;color:#dc2626;
        font-size:.84rem;margin-bottom:12px;white-space:pre-wrap;line-height:1.5;"></div>

      <div style="display:flex;gap:10px;margin-top:4px;">
        <button id="uc-save-btn" class="btn btn-primary" style="flex:2;">
          <span id="uc-save-label">💾 حفظ</span>
        </button>
        <button id="uc-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    overlay.appendChild(box);
    box.querySelector('#uc-close-btn').addEventListener('click',  () => this._closeForm());
    box.querySelector('#uc-cancel-btn').addEventListener('click', () => this._closeForm());
    box.querySelector('#uc-save-btn').addEventListener('click',   () => this._save());
    box.querySelector('#uc-role').addEventListener('change', e => {
      const role = e.target.value;
      box.querySelector('#uc-tabs-section').style.display   = role === ROLES.ADMIN_ASSISTANT ? 'block' : 'none';
      box.querySelector('#uc-agent-section').style.display  = role === ROLES.AGENT           ? 'block' : 'none';
      if (role === ROLES.AGENT) this._loadAgentPermissionLists(box);
    });
    return overlay;
  },

  // ────────────────────────────────────────────────────────────
  // _openForm / _closeForm
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

    box.querySelector('#uc-pass-hint').style.display     = isEdit ? 'inline' : 'none';
    box.querySelector('#uc-pass-required').style.display = isEdit ? 'none'   : 'inline';
    box.querySelector('#uc-email-hint').style.display    = isEdit ? 'none'   : 'block';

    const sec = box.querySelector('#uc-tabs-section');
    sec.style.display = user?.role === ROLES.ADMIN_ASSISTANT ? 'block' : 'none';
    box.querySelector('#uc-agent-section').style.display = user?.role === ROLES.AGENT ? 'block' : 'none';

    const savedTabs = Array.isArray(user?.allowed_tabs)
      ? user.allowed_tabs
      : this._safeJson(user?.allowed_tabs, []);
    box.querySelectorAll('.uc-tab-cb').forEach(cb => { cb.checked = savedTabs.includes(cb.value); });

    if (user?.role === ROLES.AGENT) {
      await this._loadAgentPermissionLists(box, user);
    }

    const lbl = box.querySelector('#uc-save-label');
    if (lbl) lbl.textContent = isEdit ? '💾 تحديث' : '💾 إنشاء المستخدم';

    this._setErr('');
    overlay.style.display = 'flex';
    box.querySelector('#uc-display-name').focus();
  },

  _closeForm() {
    const o = document.getElementById('uc-modal-overlay');
    if (o) o.style.display = 'none';
    this._editId = null;
  },

  // ────────────────────────────────────────────────────────────
  // _save
  // ────────────────────────────────────────────────────────────
  async _save() {
    const box = document.getElementById('uc-modal-box');
    if (!box) return;

    const name     = box.querySelector('#uc-display-name').value.trim();
    const username = box.querySelector('#uc-username').value.trim().toLowerCase();
    const password = box.querySelector('#uc-password').value;
    const role     = box.querySelector('#uc-role').value;
    const tabs     = role === ROLES.ADMIN_ASSISTANT
      ? [...box.querySelectorAll('.uc-tab-cb:checked')].map(c => c.value)
      : [];

    const allowedCompanies = role === ROLES.AGENT ? this._getSelectedPermissions(box, 'uc-companies-list') : [];
    const allowedBanks     = role === ROLES.AGENT ? this._getSelectedPermissions(box, 'uc-banks-list')     : [];
    const allowedUsers     = role === ROLES.AGENT ? this._getSelectedPermissions(box, 'uc-users-list')     : [];

    if (!name || name.length < 2)           { this._setErr('الاسم مطلوب (حرفان على الأقل)'); return; }
    if (!username)                           { this._setErr('البريد الإلكتروني مطلوب'); return; }
    if (!isValidEmail(username))             { this._setErr('البريد الإلكتروني غير صالح'); return; }
    if (!this._editId && password.length < 6){ this._setErr('كلمة المرور مطلوبة (6 أحرف على الأقل)'); return; }
    if (password && password.length > 0 && password.length < 6){ this._setErr('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }

    const saveBtn = box.querySelector('#uc-save-btn');
    const saveLabel = box.querySelector('#uc-save-label');
    const origLabel = saveLabel?.textContent || '💾 حفظ';
    saveBtn.disabled = true;
    if (saveLabel) saveLabel.textContent = '⏳ جارٍ الحفظ...';
    this._setErr('');

    try {
      if (this._editId) {
        await this._doUpdate(username, name, role, tabs, password, allowedCompanies, allowedBanks, allowedUsers);
      } else {
        if (!isOnline()) { this._setErr('يجب الاتصال بالإنترنت لإنشاء مستخدم جديد'); return; }
        await this._doCreate(username, name, role, tabs, password, allowedCompanies, allowedBanks, allowedUsers);
      }
    } catch (e) {
      console.error('[UsersComponent] _save خطأ:', e);
      this._setErr(`خطأ غير متوقع: ${e.message}`);
    } finally {
      saveBtn.disabled = false;
      if (saveLabel) saveLabel.textContent = origLabel;
    }
  },

  // ────────────────────────────────────────────────────────────
  // _doCreate — الخطوات الخمس النهائية
  // ────────────────────────────────────────────────────────────
  async _doCreate(username, name, role, tabs, password, allowedCompanies = [], allowedBanks = [], allowedUsers = []) {

    // 1. حفظ جلسة المدير
    const { data: { session: adminSession } } = await supabaseClient.auth.getSession();
    if (!adminSession) { this._setErr('انتهت جلسة المدير. سجّل الدخول مجدداً.'); return; }
    console.log('[UsersComponent] ✅ جلسة المدير محفوظة');

    // 2. signUp
    console.log('[UsersComponent] ⏳ signUp...');
    const { data: authData, error: authErr } = await supabaseClient.auth.signUp({
      email: username, password,
    });

    if (authErr) {
      await this._restoreSession(adminSession);
      let msg = authErr.message;
      if (msg.includes('already registered') || msg.includes('already been registered'))
        msg = 'هذا البريد مسجّل مسبقاً في النظام';
      else if (msg.includes('Password should'))
        msg = 'كلمة المرور ضعيفة. استخدم حروفاً وأرقاماً';
      this._setErr(`فشل إنشاء الحساب: ${msg}`);
      return;
    }

    if (!authData?.user?.id) {
      await this._restoreSession(adminSession);
      this._setErr(
        'فشل إنشاء الحساب: لم يُعاد معرف المستخدم.\n\n' +
        'الحل: Supabase → Authentication → Providers → Email → أوقف «Confirm email»'
      );
      return;
    }

    const newUserId = authData.user.id;
    console.log('[UsersComponent] ✅ signUp نجح، id:', newUserId);

    // 3. استعادة جلسة المدير (حرجة جداً قبل RPC)
    const restored = await this._restoreSession(adminSession);
    console.log('[UsersComponent]', restored ? '✅ جلسة المدير استُعيدت' : '⚠️ تعذّر استعادة الجلسة');

    // 4. إنشاء السجل في public.users عبر RPC
    console.log('[UsersComponent] ⏳ callRPC create_user_profile...');
    const rpcResult = await callRPC('create_user_profile', {
      p_profile: { id: newUserId, username, display_name: name, role, allowed_tabs: tabs,
        allowed_companies: allowedCompanies, allowed_banks: allowedBanks, allowed_users: allowedUsers },
    });

    console.log('[UsersComponent] نتيجة RPC:', JSON.stringify(rpcResult));

    // فحص مزدوج: isOk (HTTP) + data.ok أو data.success (منطق الدالة)
    const rpcOk = isOk(rpcResult) && (rpcResult.data?.ok !== false) && (rpcResult.data?.success !== false);

    if (!rpcOk) {
      const rpcErr = rpcResult.data?.error || rpcResult.error || 'خطأ غير معروف من RPC';
      console.error('[UsersComponent] ❌ فشل create_user_profile:', rpcErr);
      this._setErr(`فشل إنشاء سجل المستخدم:\n${rpcErr}`);
      // تنظيف حساب Auth اليتيم
      callRPC('delete_auth_user', { p_user_id: newUserId }).catch(e =>
        console.warn('[UsersComponent] تنظيف Auth فشل:', e.message));
      return;
    }

    console.log('[UsersComponent] ✅ تم إنشاء المستخدم بنجاح!');

    // 5. إغلاق + تحديث
    this._closeForm();
    showToast(`✅ تم إنشاء "${name}" بنجاح`, 'success', 4000);
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // _doUpdate — تعديل مستخدم موجود
  // ────────────────────────────────────────────────────────────
  async _doUpdate(username, name, role, tabs, password, allowedCompanies = [], allowedBanks = [], allowedUsers = []) {
    console.log('[UsersComponent] _doUpdate:', this._editId);

    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({
        username, display_name: name, role, allowed_tabs: tabs,
        allowed_companies: allowedCompanies, allowed_banks: allowedBanks, allowed_users: allowedUsers,
        updated_at: new Date().toISOString(),
      })
      .eq('id', this._editId);

    if (error) { this._setErr(`فشل التحديث: ${error.message}`); return; }

    if (password && password.length >= 6) {
      const pwRes = await callRPC('admin_update_user_password', {
        p_user_id: this._editId, p_password: password,
      });
      const pwOk = isOk(pwRes) && pwRes.data?.ok !== false && pwRes.data?.success !== false;
      if (!pwOk) {
        const pwErr = pwRes.data?.error || pwRes.error || 'خطأ';
        showToast(`⚠️ تم تحديث البيانات لكن فشل تغيير كلمة المرور: ${pwErr}`, 'warning', 6000);
      }
    }

    this._closeForm();
    showToast(`✅ تم تعديل "${name}" بنجاح`, 'success');
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // _loadAgentPermissionLists — يملأ قوائم الشركات/البنوك/المستخدمين
  // ────────────────────────────────────────────────────────────
  async _loadAgentPermissionLists(box, editUser = null) {
    const savedCompanies = editUser ? this._safeJson(editUser.allowed_companies, []) : [];
    const savedBanks     = editUser ? this._safeJson(editUser.allowed_banks,     []) : [];
    const savedUsers     = editUser ? this._safeJson(editUser.allowed_users,     []) : [];

    const [companiesRes, banksRes] = await Promise.allSettled([
      supabaseClient.from(TABLES.COMPANIES).select('id,name').order('name').limit(QUERY_LIMITS.COMPANIES),
      supabaseClient.from(TABLES.BANK_ACCOUNTS).select('id,name').order('name').limit(QUERY_LIMITS.BANK_ACCOUNTS),
    ]);

    const companies = companiesRes.status === 'fulfilled' ? (companiesRes.value.data || []) : (AppStore.getState('companies') || []);
    const banks     = banksRes.status     === 'fulfilled' ? (banksRes.value.data     || []) : (AppStore.getState('bankAccounts') || []);
    const users     = (AppStore.getState('users') || []).filter(u => u.id !== (editUser?.id));

    const makeCheckboxList = (containerId, items, savedIds, labelKey = 'name') => {
      const container = box.querySelector(`#${containerId}`);
      if (!container) return;
      const allChecked = savedIds.length === 0;
      container.innerHTML = `
        <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;cursor:pointer;grid-column:1/-1;font-weight:600;color:var(--accent);">
          <input type="checkbox" class="uc-select-all-cb" data-target="${containerId}" ${allChecked ? 'checked' : ''} />
          تحديد الكل (افتراضي)
        </label>` +
        items.map(item => `
          <label style="display:flex;align-items:center;gap:6px;font-size:.78rem;cursor:pointer;">
            <input type="checkbox" class="uc-perm-cb" data-list="${containerId}" value="${escapeHtml(item.id)}" ${savedIds.includes(item.id) ? 'checked' : ''} />
            ${escapeHtml(item[labelKey] || item.id)}
          </label>`
        ).join('');

      container.querySelector('.uc-select-all-cb')?.addEventListener('change', e => {
        container.querySelectorAll('.uc-perm-cb').forEach(cb => { cb.checked = false; cb.disabled = e.target.checked; });
      });
      if (allChecked) {
        container.querySelectorAll('.uc-perm-cb').forEach(cb => { cb.disabled = true; });
      }
    };

    makeCheckboxList('uc-companies-list', companies, savedCompanies);
    makeCheckboxList('uc-banks-list',     banks,     savedBanks);
    makeCheckboxList('uc-users-list',     users,     savedUsers, 'display_name');
  },

  // قراءة الصلاحيات المحددة من قائمة معينة
  _getSelectedPermissions(box, containerId) {
    const selectAll = box.querySelector(`#${containerId} .uc-select-all-cb`);
    if (selectAll?.checked) return [];
    return [...box.querySelectorAll(`#${containerId} .uc-perm-cb:checked`)].map(cb => cb.value);
  },

  // ────────────────────────────────────────────────────────────
  // _restoreSession
  // ────────────────────────────────────────────────────────────
  async _restoreSession(session) {
    if (!session) return false;
    try {
      const { error } = await supabaseClient.auth.setSession({
        access_token : session.access_token,
        refresh_token: session.refresh_token,
      });
      return !error;
    } catch { return false; }
  },

  // ────────────────────────────────────────────────────────────
  // _toggleActive
  // ────────────────────────────────────────────────────────────
  async _toggleActive(uid, currentlyActive) {
    if (uid === AuthService.getCurrentUserId()) { showToast('لا يمكنك تعطيل حسابك الخاص', 'error'); return; }
    const u = this._users.find(x => x.id === uid);
    const label = currentlyActive ? 'تعطيل' : 'تفعيل';
    const confirmed = await confirmDialog(
      `${label} حساب "${u?.display_name || uid}"؟`, label, 'إلغاء', 'danger');
    if (!confirmed) return;

    const { error } = await supabaseClient
      .from(TABLES.USERS)
      .update({ is_active: !currentlyActive, updated_at: new Date().toISOString() })
      .eq('id', uid);

    error
      ? showToast(`فشل ${label}: ${error.message}`, 'error')
      : showToast(`✅ تم ${label} الحساب`, 'success');
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // _deleteUser
  // ────────────────────────────────────────────────────────────
  async _deleteUser(uid, name) {
    if (uid === AuthService.getCurrentUserId()) { showToast('لا يمكنك حذف حسابك الخاص', 'error'); return; }
    const confirmed = await confirmDialog(
      `⚠️ حذف "${name}" نهائياً؟ لا يمكن التراجع.`,
      'حذف نهائياً', 'إلغاء', 'danger');
    if (!confirmed) return;

    console.log('[UsersComponent] _deleteUser:', uid);
    const result = await callRPC('delete_auth_user', { p_user_id: uid });
    const ok2 = isOk(result) && result.data?.ok !== false && result.data?.success !== false;

    if (!ok2) {
      const msg = result.data?.error || result.error || 'خطأ';
      showToast(`فشل الحذف: ${msg}`, 'error');
      return;
    }

    if (typeof db !== 'undefined' && db.isOpen()) db.users.delete(uid).catch(() => {});
    showToast(`✅ تم حذف "${name}"`, 'success');
    await this._load();
  },

  // ────────────────────────────────────────────────────────────
  // helpers
  // ────────────────────────────────────────────────────────────
  _setErr(msg) {
    const el = document.getElementById('uc-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = msg ? 'block' : 'none';
  },
  _safeJson(v, fb) {
    if (Array.isArray(v)) return v;
    try { return JSON.parse(v || '[]'); } catch { return fb; }
  },
  _skeleton(n) {
    return Array(n).fill(0).map(() =>
      `<div class="skeleton" style="height:62px;border-radius:10px;margin-bottom:8px;"></div>`
    ).join('');
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

window.UsersComponent = UsersComponent;
console.log('✅ UsersComponent.js v3.1 محمّل — إصلاح نهائي متوافق مع قاعدة البيانات');
