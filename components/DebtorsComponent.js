/**
 * components/DebtorsComponent.js — v2.0
 * العملاء المديونون — إضافة/تعديل/حذف + تحديث الرصيد يدوياً
 *
 * الإصلاحات:
 * ✅ F1: إصلاح addEventListener على زر الحفظ (كان يُستدعى قبل إضافة العنصر للـ DOM)
 * ✅ F2: إنشاء حساب CUST_{id} في account_balances عند إضافة مدين جديد
 *
 * الميزات الجديدة:
 * ✅ تحديث الرصيد يدوياً للمدير مع قيد محاسبي مزدوج في account_ledger
 */
'use strict';

const DebtorsComponent = {
  _formModal   : null,
  _balanceModal: null,
  _editingId   : null,

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

    /* ✅ F1: بناء النموذج وإضافته للـ DOM أولاً قبل تسجيل الأحداث */
    this._formModal    = this._buildFormModal();
    this._balanceModal = this._buildBalanceModal();
    wrap.appendChild(this._formModal);
    wrap.appendChild(this._balanceModal);

    container.appendChild(wrap);
    await this._loadDebtors();
  },

  async _loadDebtors() {
    const listEl = document.getElementById('debtors-list');
    if (!listEl) return;
    try {
      const isAgent = AuthService.isAgent();

      const result  = await repo.query(TABLES.DEBTORS, {}, { orderBy: 'name', ascending: true, pageSize: 200 });
      let debtors   = isOk(result) ? (result.data.data || []) : [];

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

      const isAdmin = AuthService.isAdmin() || AuthService.isAdminAssistant();

      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-wrapper';
      tableWrap.innerHTML = `
        <table class="data-table">
          <thead><tr>
            <th>اسم العميل</th>
            <th>الرصيد المستحق</th>
            <th>المنطقة</th>
            ${isAdmin ? '<th>المناديب</th><th>إجراءات</th>' : ''}
          </tr></thead>
          <tbody>
            ${debtors.map(d => {
              const agents = Array.isArray(d.assigned_agents) ? d.assigned_agents : JSON.parse(d.assigned_agents || '[]');
              const agentNames = agents.map(id => {
                const u = AppStore.getState('users').find(u => u.id === id);
                return u?.display_name || id.slice(0, 8);
              }).join('، ');
              return `<tr>
                <td><strong>${escapeHtml(d.name)}</strong></td>
                <td style="color:${d.debt_amount > 0 ? 'var(--danger)' : 'var(--success)'};">
                  ${formatCurrency(d.debt_amount)}
                </td>
                <td>${escapeHtml(d.region || '—')}</td>
                ${isAdmin ? `
                  <td style="font-size:0.82rem;color:var(--text-muted);">${escapeHtml(agentNames || '—')}</td>
                  <td>
                    <div style="display:flex;gap:4px;flex-wrap:wrap;">
                      <button class="btn btn-secondary btn-sm"
                        title="تعديل بيانات العميل"
                        onclick="DebtorsComponent._openForm(${JSON.stringify(d).split('"').join("'")})">
                        <i data-lucide="pencil" style="width:12px;height:12px"></i>
                      </button>
                      <button class="btn btn-secondary btn-sm"
                        title="تحديث الرصيد"
                        style="color:var(--accent);"
                        onclick="DebtorsComponent._openBalanceModal('${escapeHtml(d.id)}','${escapeHtml(d.name)}',${parseFloat(d.debt_amount||0)})">
                        <i data-lucide="refresh-cw" style="width:12px;height:12px"></i>
                      </button>
                      <button class="btn btn-secondary btn-sm"
                        title="حذف العميل"
                        style="color:var(--danger);"
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

  /* ══════════════════════════════════════════════════════
     نموذج الإضافة / التعديل
  ══════════════════════════════════════════════════════ */

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
        <label class="form-label">الرصيد الافتتاحي</label>
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

    overlay.appendChild(box);

    /* ✅ F1: التسجيل بعد إضافة العنصر للـ DOM fragment */
    box.querySelector('#deb-save-btn').addEventListener('click', () => this._saveDebtor());

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
      ['deb-name', 'deb-amount', 'deb-region'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.querySelectorAll('#deb-agents-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    }
    document.getElementById('deb-error').textContent = '';
    this._formModal.style.display = 'flex';
  },

  _closeForm() {
    if (this._formModal) this._formModal.style.display = 'none';
    this._editingId = null;
  },

  async _saveDebtor() {
    const name  = document.getElementById('deb-name')?.value.trim();
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

    const btn     = document.getElementById('deb-save-btn');
    const restore = setButtonLoading(btn);

    const result = this._editingId
      ? await repo.update(TABLES.DEBTORS, this._editingId, data)
      : await repo.create(TABLES.DEBTORS, data);

    restore();

    if (!isOk(result)) {
      if (errEl) errEl.textContent = result.error;
      return;
    }

    /* ✅ F2: إنشاء حساب CUST_{id} في account_balances عند الإضافة */
    if (!this._editingId) {
      const newId = result.data?.id || result.data?.[0]?.id;
      if (newId && isOnline()) {
        try {
          await supabaseClient
            .from(TABLES.ACCOUNT_BALANCES)
            .upsert({ account_id: `CUST_${newId}`, balance: data.debt_amount, last_updated: new Date().toISOString() },
                    { onConflict: 'account_id' });
        } catch { /* لا نوقف العملية إذا فشل إنشاء الحساب */ }
      }
    }

    showToast(this._editingId ? 'تم التعديل' : 'تم إضافة العميل', 'success');
    this._closeForm();
    await AppStore.refreshData();
    await this._loadDebtors();
  },

  async _deleteDebtor(id, name) {
    const confirmed = await confirmDialog(`حذف العميل "${name}"؟`, 'حذف', 'إلغاء', 'danger');
    if (!confirmed) return;
    const result = await repo.delete(TABLES.DEBTORS, id);
    if (isOk(result)) { showToast('تم الحذف', 'success'); await this._loadDebtors(); }
    else showToast(`فشل الحذف: ${result.error}`, 'error');
  },

  /* ══════════════════════════════════════════════════════
     نافذة تحديث الرصيد يدوياً (للمدير فقط)
  ══════════════════════════════════════════════════════ */

  _buildBalanceModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', (e) => { if (e.target === overlay) this._closeBalanceModal(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '420px';

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">تحديث رصيد العميل</h3>
        <button class="modal-close" onclick="DebtorsComponent._closeBalanceModal()">✕</button>
      </div>
      <div style="padding:10px 0 4px;font-size:0.85rem;color:var(--text-secondary);">
        العميل: <strong id="bal-debtor-name" style="color:var(--text-primary);"></strong>
      </div>
      <div style="padding:4px 0 12px;font-size:0.85rem;color:var(--text-secondary);">
        الرصيد الحالي: <strong id="bal-current-display" style="color:var(--danger);"></strong>
      </div>
      <input type="hidden" id="bal-debtor-id">
      <input type="hidden" id="bal-current-amount">
      <div class="form-group">
        <label class="form-label">الرصيد الجديد <span class="required">*</span></label>
        <input id="bal-new-amount" type="number" class="form-control"
          placeholder="أدخل الرصيد الجديد" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">سبب التعديل (اختياري)</label>
        <input id="bal-reason" type="text" class="form-control"
          placeholder="مثال: تسوية ديون متراكمة">
      </div>
      <div id="bal-error" class="form-error"></div>
      <div id="bal-diff-info" style="display:none;margin-bottom:12px;padding:8px 12px;border-radius:8px;font-size:0.82rem;"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="bal-save-btn" class="btn btn-primary" style="flex:2;">حفظ التحديث</button>
        <button class="btn btn-secondary" style="flex:1;" onclick="DebtorsComponent._closeBalanceModal()">إلغاء</button>
      </div>`;

    overlay.appendChild(box);

    /* عرض الفرق في الوقت الفعلي */
    box.querySelector('#bal-new-amount').addEventListener('input', () => {
      const current = parseFloat(document.getElementById('bal-current-amount')?.value || '0') || 0;
      const newVal  = parseFloat(document.getElementById('bal-new-amount')?.value || '') || 0;
      const diff    = newVal - current;
      const info    = document.getElementById('bal-diff-info');
      if (document.getElementById('bal-new-amount').value === '') {
        info.style.display = 'none';
        return;
      }
      info.style.display = '';
      if (Math.abs(diff) < 0.01) {
        info.style.background = 'rgba(5,150,105,0.08)';
        info.style.border = '1px solid rgba(5,150,105,0.2)';
        info.style.color = 'var(--success)';
        info.textContent = 'الرصيد لم يتغير';
      } else if (diff > 0) {
        info.style.background = 'rgba(220,38,38,0.08)';
        info.style.border = '1px solid rgba(220,38,38,0.2)';
        info.style.color = 'var(--danger)';
        info.textContent = `زيادة الدين بمقدار: +${formatCurrency(diff)}`;
      } else {
        info.style.background = 'rgba(5,150,105,0.08)';
        info.style.border = '1px solid rgba(5,150,105,0.2)';
        info.style.color = 'var(--success)';
        info.textContent = `تخفيض الدين بمقدار: ${formatCurrency(diff)}`;
      }
    });

    box.querySelector('#bal-save-btn').addEventListener('click', () => this._saveBalanceUpdate());

    return overlay;
  },

  _openBalanceModal(debtorId, debtorName, currentAmount) {
    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) return;
    document.getElementById('bal-debtor-id').value      = debtorId;
    document.getElementById('bal-current-amount').value = currentAmount;
    document.getElementById('bal-debtor-name').textContent       = debtorName;
    document.getElementById('bal-current-display').textContent   = formatCurrency(currentAmount);
    document.getElementById('bal-new-amount').value  = '';
    document.getElementById('bal-reason').value      = '';
    document.getElementById('bal-error').textContent = '';
    document.getElementById('bal-diff-info').style.display = 'none';
    this._balanceModal.style.display = 'flex';
    setTimeout(() => document.getElementById('bal-new-amount')?.focus(), 100);
  },

  _closeBalanceModal() {
    if (this._balanceModal) this._balanceModal.style.display = 'none';
  },

  async _saveBalanceUpdate() {
    const debtorId   = document.getElementById('bal-debtor-id')?.value;
    const debtorName = document.getElementById('bal-debtor-name')?.textContent;
    const current    = parseFloat(document.getElementById('bal-current-amount')?.value || '0') || 0;
    const newVal     = parseFloat(document.getElementById('bal-new-amount')?.value || '');
    const reason     = document.getElementById('bal-reason')?.value.trim() || '';
    const errEl      = document.getElementById('bal-error');

    if (!debtorId)          { if (errEl) errEl.textContent = 'خطأ: معرف العميل مفقود'; return; }
    if (isNaN(newVal) || newVal < 0) { if (errEl) errEl.textContent = 'أدخل رقماً صحيحاً (صفر أو أكثر)'; return; }
    if (Math.abs(newVal - current) < 0.01) { showToast('الرصيد لم يتغير', 'info'); return; }
    if (!isOnline())        { showToast('يجب الاتصال بالإنترنت لتحديث الرصيد', 'error'); return; }

    const btn     = document.getElementById('bal-save-btn');
    const restore = setButtonLoading(btn);
    if (errEl) errEl.textContent = '';

    try {
      await this._updateDebtorBalance(debtorId, debtorName, current, newVal, reason);
      this._closeBalanceModal();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
    } finally {
      restore();
    }
  },

  async _updateDebtorBalance(debtorId, debtorName, oldBalance, newBalance, reason) {
    const difference = newBalance - oldBalance;
    const today      = getCurrentSaudiDate();
    const userId     = AuthService.getCurrentUserId();
    const custAcc    = `CUST_${debtorId}`;
    const adjAcc     = 'DEBTOR_ADJUSTMENT';
    const desc       = reason || 'تعديل رصيد يدوي';
    const absDiff    = Math.abs(difference);

    /* جلب رقم القيد */
    let voucher = `ADJ-${Date.now()}`;
    try {
      const vRes = await callRPC(RPC.GET_NEXT_VOUCHER_NUMBER, {});
      if (isOk(vRes) && vRes.data) voucher = vRes.data;
    } catch { /* استخدام الرقم الاحتياطي */ }

    /* بناء القيود المتوازنة */
    const entries = difference > 0
      ? [
          { voucher_number: voucher, date: today, account_id: custAcc, debit: absDiff, credit: 0,      description: desc },
          { voucher_number: voucher, date: today, account_id: adjAcc,  debit: 0,       credit: absDiff, description: desc },
        ]
      : [
          { voucher_number: voucher, date: today, account_id: custAcc, debit: 0,       credit: absDiff, description: desc },
          { voucher_number: voucher, date: today, account_id: adjAcc,  debit: absDiff, credit: 0,       description: desc },
        ];

    const txData = {
      type          : 'debtor_manual_adjustment',
      amount        : absDiff,
      date          : today,
      agent_id      : userId,
      customer_id   : debtorId,
      customer_name : debtorName,
      details       : `تعديل رصيد: من ${formatCurrency(oldBalance)} إلى ${formatCurrency(newBalance)}${reason ? ' — ' + reason : ''}`,
      approval_status: 'approved',
    };

    const rpcResult = await callRPC(RPC.CREATE_TRANSACTION_WITH_ENTRIES, {
      p_transaction : txData,
      p_entries     : entries,
    });

    if (!isOk(rpcResult)) {
      throw new Error(`فشل إنشاء القيد المحاسبي: ${rpcResult.error}`);
    }

    /* تحديث جدول debtors */
    const updateResult = await repo.update(TABLES.DEBTORS, debtorId, { debt_amount: newBalance });
    if (!isOk(updateResult)) {
      throw new Error(`تم إنشاء القيد لكن فشل تحديث الرصيد: ${updateResult.error}`);
    }

    showToast(`✅ تم تحديث رصيد "${debtorName}" إلى ${formatCurrency(newBalance)}`, 'success');

    await AppStore.refreshData();
    await this._loadDebtors();
  },
};

window.DebtorsComponent = DebtorsComponent;
console.log('✅ DebtorsComponent.js v2.0 — إصلاح الحفظ + تحديث الرصيد المحاسبي');
