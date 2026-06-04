/**
 * components/DebtorsComponent.js
 * العملاء المديونون — إضافة/تعديل/حذف + تعيين مناديب
 */
'use strict';

const DebtorsComponent = {
  _formModal: null,
  _editingId: null,
  _page: 1,
  _pageSize: 20,

  async render(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');

    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;';
    topBar.innerHTML = `<h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">العملاء المديونون</h2>`;

    if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary btn-sm';
      addBtn.innerHTML = '<i data-lucide="plus" style="width:14px;height:14px"></i> إضافة عميل';
      addBtn.addEventListener('click', () => this._openForm());
      topBar.appendChild(addBtn);
    }
    wrap.appendChild(topBar);

    const listEl = document.createElement('div');
    listEl.id = 'debtors-list';
    listEl.innerHTML = `<div class="skeleton" style="height:60px;border-radius:12px;margin-bottom:10px;"></div>`.repeat(4);
    wrap.appendChild(listEl);

    this._formModal = this._buildFormModal();
    wrap.appendChild(this._formModal);

    container.appendChild(wrap);
    await this._loadDebtors();
  },

  async _loadDebtors() {
    const listEl = document.getElementById('debtors-list');
    if (!listEl) return;
    try {
      const isAgent = AuthService.isAgent();
      const filters = isAgent
        ? { assigned_agents: { op: 'contains', val: AuthService.getCurrentUserId() } }
        : {};

      const result = await repo.query(TABLES.DEBTORS, {}, { orderBy: 'name', ascending: true, pageSize: 200 });
      let debtors  = isOk(result) ? (result.data.data || []) : [];

      if (isAgent) {
        const uid = AuthService.getCurrentUserId();
        debtors = debtors.filter(d => {
          const agents = Array.isArray(d.assigned_agents)
            ? d.assigned_agents
            : JSON.parse(d.assigned_agents || '[]');
          return agents.includes(uid);
        });
      }

      if (debtors.length === 0) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div>
          <div class="empty-state-text">لا يوجد عملاء مديونون</div></div>`;
        return;
      }

      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-wrapper';
      tableWrap.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>اسم العميل</th><th>المبلغ المستحق</th><th>المنطقة</th>
            ${!isAgent ? '<th>المناديب المخصصون</th><th>إجراءات</th>' : ''}
          </tr></thead>
          <tbody>
            ${debtors.map(d => {
              const agents = Array.isArray(d.assigned_agents) ? d.assigned_agents : JSON.parse(d.assigned_agents || '[]');
              const agentNames = agents.map(id => {
                const u = AppStore.getState('users').find(u => u.id === id);
                return u?.display_name || id.slice(0,8);
              }).join('، ');
              return `<tr>
                <td><strong>${escapeHtml(d.name)}</strong></td>
                <td style="color:${d.debt_amount > 0 ? 'var(--danger)' : 'var(--success)'};">
                  ${formatCurrency(d.debt_amount)}
                </td>
                <td>${escapeHtml(d.region || '—')}</td>
                ${!isAgent ? `
                  <td style="font-size:0.82rem;color:var(--text-muted);">${escapeHtml(agentNames || '—')}</td>
                  <td>
                    <div style="display:flex;gap:4px;">
                      <button class="btn btn-secondary btn-sm" onclick="DebtorsComponent._openForm(${JSON.stringify(d).split('"').join("'")})">
                        <i data-lucide="pencil" style="width:12px;height:12px"></i>
                      </button>
                      <button class="btn btn-secondary btn-sm" style="color:var(--danger);"
                        onclick="DebtorsComponent._deleteDebtor('${escapeHtml(d.id)}','${escapeHtml(d.name)}')">
                        <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                      </button>
                    </div>
                  </td>` : ''}
              </tr>`;
            }).join('')}
          </tbody>
        </table>`;
      listEl.innerHTML = '';
      listEl.appendChild(tableWrap);
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">خطأ: ${escapeHtml(e.message)}</div></div>`;
    }
  },

  _buildFormModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeForm(); });

    const box = document.createElement('div');
    box.className = 'modal-box';

    const agents = AppStore.getState('users').filter(u => u.role === ROLES.AGENT && u.is_active);

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" id="debtor-form-title">إضافة عميل مدين</h3>
        <button class="modal-close" onclick="DebtorsComponent._closeForm()">✕</button>
      </div>
      <div class="form-group">
        <label class="form-label">الاسم <span class="required">*</span></label>
        <input id="deb-name" type="text" class="form-control" placeholder="اسم العميل">
      </div>
      <div class="form-group">
        <label class="form-label">المبلغ المستحق</label>
        <input id="deb-amount" type="number" class="form-control" placeholder="0.00" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">المنطقة</label>
        <input id="deb-region" type="text" class="form-control" placeholder="المنطقة (اختياري)">
      </div>
      <div class="form-group">
        <label class="form-label">المناديب المخصصون</label>
        <div id="deb-agents-list" style="display:flex;flex-wrap:wrap;gap:8px;">
          ${agents.map(a => `
            <label style="display:flex;align-items:center;gap:4px;font-size:0.85rem;cursor:pointer;">
              <input type="checkbox" data-agent-id="${escapeHtml(a.id)}" value="${escapeHtml(a.id)}">
              ${escapeHtml(a.display_name)}
            </label>`).join('')}
        </div>
      </div>
      <div id="deb-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="deb-save-btn" class="btn btn-primary" style="flex:2;">حفظ</button>
        <button class="btn btn-secondary" style="flex:1;" onclick="DebtorsComponent._closeForm()">إلغاء</button>
      </div>`;

    document.getElementById('deb-save-btn')?.addEventListener('click', () => this._saveDebtor());
    overlay.appendChild(box);
    return overlay;
  },

  _openForm(debtor = null) {
    this._editingId = debtor?.id || null;
    const titleEl = document.getElementById('debtor-form-title');
    if (titleEl) titleEl.textContent = debtor ? 'تعديل عميل مدين' : 'إضافة عميل مدين';

    if (debtor) {
      document.getElementById('deb-name').value   = debtor.name || '';
      document.getElementById('deb-amount').value = debtor.debt_amount || '';
      document.getElementById('deb-region').value = debtor.region || '';
      const assigned = Array.isArray(debtor.assigned_agents)
        ? debtor.assigned_agents
        : JSON.parse(debtor.assigned_agents || '[]');
      document.querySelectorAll('#deb-agents-list input[type="checkbox"]').forEach(cb => {
        cb.checked = assigned.includes(cb.value);
      });
    } else {
      ['deb-name','deb-amount','deb-region'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
      document.querySelectorAll('#deb-agents-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    }
    document.getElementById('deb-error').textContent = '';
    this._formModal.style.display = 'flex';
  },

  _closeForm() { if (this._formModal) this._formModal.style.display = 'none'; this._editingId = null; },

  async _saveDebtor() {
    const name = document.getElementById('deb-name')?.value.trim();
    const errEl = document.getElementById('deb-error');
    if (!name) { if (errEl) errEl.textContent = 'الاسم مطلوب'; return; }

    const assigned = [];
    document.querySelectorAll('#deb-agents-list input[type="checkbox"]:checked').forEach(cb => assigned.push(cb.value));

    const data = {
      name            : name,
      debt_amount     : parseFloat(document.getElementById('deb-amount')?.value || '0') || 0,
      region          : document.getElementById('deb-region')?.value.trim() || null,
      assigned_agents : assigned,
    };

    const btn = document.getElementById('deb-save-btn');
    const restore = setButtonLoading(btn);
    const result = this._editingId ? await repo.update(TABLES.DEBTORS, this._editingId, data) : await repo.create(TABLES.DEBTORS, data);
    restore();

    if (isOk(result)) {
      showToast(this._editingId ? 'تم التعديل' : 'تم الإضافة', 'success');
      this._closeForm();
      await this._loadDebtors();
    } else { if (errEl) errEl.textContent = result.error; }
  },

  async _deleteDebtor(id, name) {
    const confirmed = await confirmDialog(`حذف العميل "${name}"؟`, 'حذف', 'إلغاء', 'danger');
    if (!confirmed) return;
    const result = await repo.delete(TABLES.DEBTORS, id);
    if (isOk(result)) { showToast('تم الحذف', 'success'); await this._loadDebtors(); }
    else showToast(`فشل الحذف: ${result.error}`, 'error');
  },
};

window.DebtorsComponent = DebtorsComponent;
console.log('✅ DebtorsComponent.js محمّل');
