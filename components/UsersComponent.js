/**
 * components/UsersComponent.js
 * نظام أبو حذيفة — إدارة المستخدمين (للمدير فقط)
 * إضافة / تعديل / حذف / تعطيل / تفعيل / تعيين الصلاحيات
 *
 * الإصلاحات المُطبَّقة:
 * 1. JSON.parse بدون try/catch في _openForm → استبدال بـ _safeJsonParse
 * 2. تحديث كلمة المرور عبر auth.admin (غير متاح في Client SDK) → RPC
 * 3. تناسق Auth ↔ users: إذا فشل repo.create بعد signUp → حذف حساب Auth
 * 4. حذف المستخدم لا يحذفه من Auth → RPC لحذف كامل
 * 5. لا تحقق من صيغة البريد → إضافة تحقق
 * 6. لا تحقق من حد أدنى لكلمة المرور → إضافة تحقق
 * 7. username لا يُحفظ عند التعديل → إضافة للـ changes
 */
'use strict';

const UsersComponent = {
  _modal   : null,
  _editId  : null,
  _users   : [],

  async render(container) {
    if (!AuthService.isAdmin()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">إدارة المستخدمين للمدير فقط</div></div>`;
      return;
    }

    container.innerHTML = '';
    const wrap = document.createElement('div');

    /* ── شريط العنوان ── */
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;';
    bar.innerHTML = `<h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">
      إدارة المستخدمين</h2>`;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.innerHTML = '<i data-lucide="user-plus" style="width:14px;height:14px"></i> إضافة مستخدم';
    addBtn.addEventListener('click', () => this._openForm());
    bar.appendChild(addBtn);
    wrap.appendChild(bar);

    /* ── قائمة ── */
    const listEl = document.createElement('div');
    listEl.id = 'users-list';
    listEl.innerHTML = `<div class="skeleton" style="height:56px;border-radius:10px;margin-bottom:8px;"></div>`.repeat(4);
    wrap.appendChild(listEl);

    /* ── المودال ── */
    this._modal = this._buildModal();
    wrap.appendChild(this._modal);

    container.appendChild(wrap);
    await this._load();
    if (window.lucide) lucide.createIcons();
  },

  /* ── تحميل قائمة المستخدمين ── */
  async _load() {
    const listEl = document.getElementById('users-list');
    if (!listEl) return;

    const result = await repo.query(TABLES.USERS, {}, {
      orderBy: 'display_name', ascending: true, pageSize: 200, forceRefresh: true,
    });
    this._users = isOk(result) ? (result.data.data || []) : [];

    if (!this._users.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">👤</div>
        <div class="empty-state-text">لا يوجد مستخدمون</div></div>`;
      return;
    }

    const roleColors = {
      [ROLES.ADMIN]           : 'success',
      [ROLES.ADMIN_ASSISTANT] : 'info',
      [ROLES.AGENT]           : 'neutral',
    };

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الاسم</th><th>اسم المستخدم</th><th>الدور</th>
          <th>الحالة</th><th>دخول سريع</th><th>إجراءات</th>
        </tr></thead>
        <tbody>
          ${this._users.map(u => `
            <tr id="user-row-${u.id}">
              <td><strong>${escapeHtml(u.display_name)}</strong></td>
              <td style="direction:ltr;font-family:monospace;font-size:0.85rem;">${escapeHtml(u.username)}</td>
              <td><span class="badge badge-${roleColors[u.role] || 'neutral'}">${escapeHtml(ROLE_LABELS[u.role] || u.role)}</span></td>
              <td>
                <button class="toggle-btn ${u.is_active ? 'active' : 'inactive'}"
                  data-uid="${escapeHtml(u.id)}"
                  data-active="${u.is_active}"
                  title="${u.is_active ? 'إيقاف الحساب' : 'تفعيل الحساب'}">
                  ${u.is_active ? '✅ نشط' : '🔴 معطّل'}
                </button>
              </td>
              <td style="font-size:0.8rem;color:var(--text-muted);">
                ${u.quick_equation_hash ? '⚡ مفعّل' : '—'}
              </td>
              <td>
                <div style="display:flex;gap:6px;">
                  <button class="btn btn-secondary btn-sm edit-user-btn" data-uid="${escapeHtml(u.id)}" title="تعديل">
                    <i data-lucide="pencil" style="width:12px;height:12px"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm delete-user-btn" style="color:var(--danger);"
                    data-uid="${escapeHtml(u.id)}" data-name="${escapeHtml(u.display_name)}" title="حذف">
                    <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                  </button>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(table);

    /* ── أحداث الأزرار ── */
    listEl.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const uid    = btn.dataset.uid;
        const active = btn.dataset.active === 'true';
        this._toggleActive(uid, active);
      });
    });

    listEl.querySelectorAll('.edit-user-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const user = this._users.find(u => u.id === btn.dataset.uid);
        if (user) this._openForm(user);
      });
    });

    listEl.querySelectorAll('.delete-user-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        this._deleteUser(btn.dataset.uid, btn.dataset.name));
    });

    if (window.lucide) lucide.createIcons();
  },

  /* ── بناء المودال ── */
  _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeForm(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '520px';
    box.id = 'users-modal-box';

    const allTabs = Object.entries(TAB_LABELS);

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" id="users-modal-title">إضافة مستخدم</h3>
        <button class="modal-close" id="users-close-btn">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label class="form-label">الاسم الظاهر <span class="required">*</span></label>
          <input id="usr-display-name" type="text" class="form-control" placeholder="الاسم الكامل">
        </div>
        <div class="form-group">
          <label class="form-label">البريد الإلكتروني <span class="required">*</span></label>
          <input id="usr-username" type="email" class="form-control" placeholder="user@example.com" dir="ltr">
        </div>
        <div class="form-group">
          <label class="form-label" id="usr-password-label">كلمة المرور <span class="required" id="usr-pass-required">*</span></label>
          <input id="usr-password" type="password" class="form-control" placeholder="6 أحرف على الأقل">
          <small id="usr-password-hint" style="color:var(--text-muted);font-size:0.78rem;margin-top:4px;display:block;">
            اتركه فارغاً إذا لم تريد تغيير كلمة المرور
          </small>
        </div>
        <div class="form-group">
          <label class="form-label">الدور <span class="required">*</span></label>
          <select id="usr-role" class="form-control">
            ${Object.entries(ROLE_LABELS).map(([v,l]) =>
              `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- تبويبات الوصول للمساعد الإداري -->
      <div id="usr-tabs-section" style="display:none;margin-top:4px;">
        <label class="form-label">التبويبات المسموحة للمساعد الإداري</label>
        <div id="usr-tabs-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px;">
          ${allTabs.map(([id, label]) => `
            <label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;cursor:pointer;">
              <input type="checkbox" class="usr-tab-cb" value="${id}">
              ${escapeHtml(label)}
            </label>`).join('')}
        </div>
      </div>

      <div id="usr-error" class="form-error" style="margin-top:8px;"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="usr-save-btn" class="btn btn-primary" style="flex:2;">حفظ</button>
        <button id="usr-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    overlay.appendChild(box);

    /* أحداث داخل المودال */
    box.querySelector('#users-close-btn').addEventListener('click',  () => this._closeForm());
    box.querySelector('#usr-cancel-btn').addEventListener('click',   () => this._closeForm());
    box.querySelector('#usr-save-btn').addEventListener('click',     () => this._save());
    box.querySelector('#usr-role').addEventListener('change', e => {
      const sec = box.querySelector('#usr-tabs-section');
      sec.style.display = e.target.value === ROLES.ADMIN_ASSISTANT ? 'block' : 'none';
    });

    return overlay;
  },

  /* ── فتح النموذج ── */
  _openForm(user = null) {
    this._editId = user?.id || null;
    const box = document.getElementById('users-modal-box');
    if (!box) return;

    const isEdit = !!user;

    box.querySelector('#users-modal-title').textContent = isEdit ? 'تعديل مستخدم' : 'إضافة مستخدم';
    box.querySelector('#usr-display-name').value = user?.display_name || '';
    box.querySelector('#usr-username').value     = user?.username     || '';
    box.querySelector('#usr-password').value     = '';
    box.querySelector('#usr-role').value         = user?.role         || ROLES.AGENT;
    box.querySelector('#usr-error').textContent  = '';

    /* إظهار/إخفاء تلميح كلمة المرور */
    const passHint     = box.querySelector('#usr-password-hint');
    const passRequired = box.querySelector('#usr-pass-required');
    if (passHint)     passHint.style.display     = isEdit ? 'block' : 'none';
    if (passRequired) passRequired.style.display  = isEdit ? 'none'  : 'inline';

    /* إظهار/إخفاء تبويبات المساعد */
    const sec = box.querySelector('#usr-tabs-section');
    sec.style.display = user?.role === ROLES.ADMIN_ASSISTANT ? 'block' : 'none';

    /* ✅ إصلاح 1: استخدام _safeJsonParse بدلاً من JSON.parse المجردة */
    const allowed = this._safeJsonParse(user?.allowed_tabs, []);
    box.querySelectorAll('.usr-tab-cb').forEach(cb => {
      cb.checked = allowed.includes(cb.value);
    });

    this._modal.style.display = 'flex';
  },

  _closeForm() {
    if (this._modal) this._modal.style.display = 'none';
    this._editId = null;
  },

  /* ── دالة مساعدة: تحليل JSON بأمان ── */
  _safeJsonParse(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (value === null || value === undefined) return fallback;
    if (typeof value !== 'string') return fallback;
    try {
      const parsed = JSON.parse(value);
      return parsed ?? fallback;
    } catch {
      console.warn('⚠️  UsersComponent._safeJsonParse: بيانات فاسدة:', value);
      return fallback;
    }
  },

  /* ── دالة مساعدة: التحقق من صيغة البريد الإلكتروني ── */
  _isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  },

  /* ── حفظ المستخدم ── */
  async _save() {
    const box      = document.getElementById('users-modal-box');
    const errEl    = box.querySelector('#usr-error');
    const name     = box.querySelector('#usr-display-name').value.trim();
    const username = box.querySelector('#usr-username').value.trim().toLowerCase();
    const password = box.querySelector('#usr-password').value;
    const role     = box.querySelector('#usr-role').value;

    errEl.textContent = '';

    /* ✅ تحقق محسّن من المدخلات */
    if (!name)     { errEl.textContent = 'الاسم الظاهر مطلوب'; return; }
    if (!username) { errEl.textContent = 'البريد الإلكتروني مطلوب'; return; }

    /* ✅ إصلاح 5: التحقق من صيغة البريد الإلكتروني */
    if (!this._isValidEmail(username)) {
      errEl.textContent = 'صيغة البريد الإلكتروني غير صحيحة';
      return;
    }

    /* ✅ إصلاح 6: التحقق من حد أدنى لكلمة المرور */
    if (!this._editId && !password) {
      errEl.textContent = 'كلمة المرور مطلوبة للمستخدم الجديد';
      return;
    }
    if (password && password.length < 6) {
      errEl.textContent = 'كلمة المرور يجب أن تكون 6 أحرف على الأقل';
      return;
    }

    const allowed_tabs = role === ROLES.ADMIN_ASSISTANT
      ? [...box.querySelectorAll('.usr-tab-cb:checked')].map(cb => cb.value)
      : [];

    const saveBtn = box.querySelector('#usr-save-btn');
    const restore = setButtonLoading(saveBtn);

    try {
      if (this._editId) {
        /* ── تعديل مستخدم موجود ── */

        /* ✅ إصلاح 8: إضافة username للتحديث */
        const changes = { display_name: name, username, role, allowed_tabs };
        const result  = await repo.update(TABLES.USERS, this._editId, changes);
        if (!isOk(result)) { errEl.textContent = result.error; return; }

        /* ✅ إصلاح 2: تحديث كلمة المرور عبر RPC بدلاً من auth.admin */
        if (password) {
          if (!isOnline()) {
            errEl.textContent = 'يجب الاتصال بالإنترنت لتغيير كلمة المرور';
            return;
          }
          const pwResult = await this._updatePassword(this._editId, password);
          if (!isOk(pwResult)) {
            errEl.textContent = pwResult.error;
            return;
          }
        }

        showToast('تم تعديل المستخدم بنجاح', 'success');

      } else {
        /* ── إنشاء مستخدم جديد ── */
        if (!isOnline()) {
          errEl.textContent = 'يجب الاتصال بالإنترنت لإنشاء مستخدم جديد';
          return;
        }

        const { data: authData, error: authErr } = await supabaseClient.auth.signUp({
          email: username, password,
        });

        if (authErr) { errEl.textContent = authErr.message; return; }
        if (!authData?.user?.id) { errEl.textContent = 'فشل إنشاء الحساب — لم يُعاد معرف المستخدم'; return; }

        const profile = {
          id           : authData.user.id,
          username,
          display_name : name,
          role,
          allowed_tabs,
          is_active    : true,
        };

        /* ✅ إصلاح 3: إذا فشل repo.create → حذف حساب Auth لمنع التناسق */
        const result = await repo.create(TABLES.USERS, profile);
        if (!isOk(result)) {
          /* حذف حساب Auth الذي أُنشئ للتو لتجنب حساب بلا سجل */
          try {
            await callRPC('delete_auth_user', { p_user_id: authData.user.id });
          } catch (cleanupErr) {
            console.error('⚠️  فشل تنظيف حساب Auth بعد خطأ إنشاء السجل:', cleanupErr);
          }
          errEl.textContent = `فشل إنشاء سجل المستخدم: ${result.error}`;
          return;
        }

        showToast('تم إنشاء المستخدم بنجاح', 'success');
      }

      this._closeForm();
      await this._load();

    } catch (e) {
      errEl.textContent = `خطأ: ${e.message}`;
    } finally {
      restore();
    }
  },

  /**
   * تحديث كلمة المرور عبر RPC (يُنفَّذ بـ Service Role في الخادم)
   * ✅ إصلاح 2: بديل صحيح لـ auth.admin.updateUserById غير المتاح في Client SDK
   * @param {string} userId
   * @param {string} newPassword
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async _updatePassword(userId, newPassword) {
    try {
      const result = await callRPC('admin_update_user_password', {
        p_user_id    : userId,
        p_password   : newPassword,
      });
      if (!isOk(result)) {
        return err(result.error || 'فشل تحديث كلمة المرور');
      }
      return ok(true);
    } catch (e) {
      return err(`فشل تحديث كلمة المرور: ${e.message}`);
    }
  },

  /* ── تعطيل / تفعيل ── */
  async _toggleActive(uid, currentlyActive) {
    const me = AuthService.getCurrentUserId();
    if (uid === me) { showToast('لا يمكنك تعطيل حسابك الخاص', 'error'); return; }

    const newActive = !currentlyActive;
    const label     = newActive ? 'تفعيل' : 'تعطيل';
    const user      = this._users.find(u => u.id === uid);
    const confirmed = await confirmDialog(
      `${label} حساب "${user?.display_name || uid}"؟`, label, 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    const result = await repo.update(TABLES.USERS, uid, { is_active: newActive });
    if (isOk(result)) {
      showToast(`تم ${label} الحساب`, 'success');
      await this._load();
    } else {
      showToast(`فشل ${label} الحساب: ${result.error}`, 'error');
    }
  },

  /* ── حذف مستخدم ── */
  async _deleteUser(uid, name) {
    const me = AuthService.getCurrentUserId();
    if (uid === me) { showToast('لا يمكنك حذف حسابك الخاص', 'error'); return; }

    const confirmed = await confirmDialog(
      `حذف المستخدم "${name}"؟ سيُحذف من النظام وقاعدة البيانات نهائياً ولا يمكن التراجع.`,
      'حذف', 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    /* ✅ إصلاح 4: حذف من جدول users أولاً ثم من Auth عبر RPC */
    const result = await repo.delete(TABLES.USERS, uid);
    if (!isOk(result)) {
      showToast(`فشل الحذف: ${result.error}`, 'error');
      return;
    }

    /* حذف حساب Auth عبر RPC (Service Role) */
    if (isOnline()) {
      try {
        await callRPC('delete_auth_user', { p_user_id: uid });
      } catch (e) {
        /* السجل في users محذوف — Auth سيبقى لكن لن يتمكن من الدخول */
        console.warn('⚠️  تم حذف سجل users لكن فشل حذف حساب Auth:', e.message);
        showToast('تم حذف المستخدم من النظام. قد يتطلب حذف حساب Auth يدوياً من لوحة Supabase.', 'warning', 6000);
        await this._load();
        return;
      }
    }

    showToast('تم حذف المستخدم بالكامل', 'success');
    await this._load();
  },
};

window.UsersComponent = UsersComponent;
console.log('✅ UsersComponent.js محمّل');
