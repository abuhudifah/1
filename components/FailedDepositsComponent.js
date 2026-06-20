/**
 * components/FailedDepositsComponent.js — v2.0
 * نظام الإيداعات الفاشلة المتكامل
 *
 * ✅ مندوب: إضافة إيداع فاشل + تعبئة تلقائية من بنوكه المصرح بها + بطاقات تفصيلية
 * ✅ إدارة: إضافة + تعديل + حذف + تحديث حالة ذكي + لوحة إحصائيات + فلتر بالمندوب
 * ✅ قيد محاسبي عند الاسترداد (جزئي/كلي): COMP_ مدين ← AGT_ دائن (نفس اتجاه الإيداع)
 * ✅ تدفق الحالات: pending → claimed → bank_processing → partial_refund/refunded/rejected
 */
'use strict';

const FailedDepositsComponent = {
  _modal       : null,
  _editId      : null,
  _agentFilter : '',

  // ══════════════════════════════════════════════════════════
  // العرض الرئيسي
  // ══════════════════════════════════════════════════════════
  async render(container) {
    container.innerHTML = '';
    const isAdmin = AuthService.isAdmin() || AuthService.isAdminAssistant();
    const wrap = document.createElement('div');

    /* ── شريط العنوان ── */
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;';
    bar.innerHTML = `<h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">الإيداعات الفاشلة</h2>`;

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.innerHTML = '<i data-lucide="plus" style="width:14px;height:14px"></i> إضافة إيداع فاشل';
    addBtn.addEventListener('click', () => this._openForm());
    bar.appendChild(addBtn);
    wrap.appendChild(bar);

    /* ── إحصائيات + فلتر المندوب (للإدارة) ── */
    if (isAdmin) {
      const statsEl = document.createElement('div');
      statsEl.id = 'fd-stats';
      wrap.appendChild(statsEl);

      const filterEl = document.createElement('div');
      filterEl.id = 'fd-agent-filter';
      filterEl.style.cssText = 'margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
      wrap.appendChild(filterEl);
    }

    /* ── قائمة السجلات ── */
    const listEl = document.createElement('div');
    listEl.id = 'fd-list';
    listEl.innerHTML = `<div class="skeleton" style="height:56px;border-radius:10px;margin-bottom:8px;"></div>`.repeat(4);
    wrap.appendChild(listEl);

    /* ── المودال — مُضاف لـ body لتجنب كسر position:fixed على الجوال ── */
    if (this._modal) this._modal.remove();
    this._modal = this._buildModal(isAdmin);
    document.body.appendChild(this._modal);

    container.appendChild(wrap);
    await this._load();
    if (window.lucide) lucide.createIcons();
  },

  // ══════════════════════════════════════════════════════════
  // تحميل البيانات
  // ══════════════════════════════════════════════════════════
  async _load() {
    const listEl = document.getElementById('fd-list');
    if (!listEl) return;

    const isAdmin = AuthService.isAdmin() || AuthService.isAdminAssistant();
    const isAgent = AuthService.isAgent();
    const uid     = AuthService.getCurrentUserId();

    const filters = {};
    if (isAgent) filters.agent_id = uid;
    else if (this._agentFilter) filters.agent_id = this._agentFilter;

    try {
      const result = await repo.query(TABLES.FAILED_DEPOSITS, filters, {
        orderBy: 'date', ascending: false, pageSize: 200,
      });
      const items       = isOk(result) ? (result.data.data || []) : [];
      const bankAccounts = AppStore.getState('bankAccounts') || [];
      const users        = AppStore.getState('users') || [];

      if (isAdmin) {
        this._renderStats(items, bankAccounts, users);
        this._renderAgentFilter(users);
      }

      if (!items.length) {
        listEl.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">💸</div>
          <div class="empty-state-text">${isAgent ? 'لا توجد إيداعات فاشلة لك' : 'لا توجد إيداعات فاشلة'}</div>
        </div>`;
        return;
      }

      if (isAdmin) this._renderAdminTable(listEl, items, bankAccounts, users);
      else         this._renderAgentCards(listEl, items, bankAccounts);

    } catch (e) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">خطأ: ${escapeHtml(e.message)}</div>
      </div>`;
    }

    if (window.lucide) lucide.createIcons();
  },

  // ══════════════════════════════════════════════════════════
  // لوحة الإحصائيات (الإدارة)
  // ══════════════════════════════════════════════════════════
  _renderStats(items, bankAccounts, users) {
    const el = document.getElementById('fd-stats');
    if (!el) return;

    const filtered = this._agentFilter
      ? items.filter(i => i.agent_id === this._agentFilter)
      : items;

    const totalCount     = filtered.length;
    const totalAmount    = filtered.reduce((s, i) => s + (parseFloat(i.amount)        || 0), 0);
    const totalRefunded  = filtered.reduce((s, i) => s + (parseFloat(i.refund_amount) || 0), 0);
    const totalRemaining = totalAmount - totalRefunded;

    const byStatus = {};
    for (const s of Object.values(FAILED_DEPOSIT_STATUS)) byStatus[s] = 0;
    filtered.forEach(i => { if (byStatus[i.status] !== undefined) byStatus[i.status]++; });

    const statusColors = {
      pending        : 'var(--warning)',
      claimed        : 'var(--info,#3b82f6)',
      bank_processing: 'var(--accent)',
      partial_refund : 'var(--warning)',
      refunded       : 'var(--success)',
      rejected       : 'var(--danger)',
    };

    const fmt = n => Math.round(n).toLocaleString('en-US');

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:16px;">
        <div class="glass-card" style="padding:14px;text-align:center;">
          <div style="font-size:1.6rem;font-weight:800;color:var(--accent);">${totalCount}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">إجمالي السجلات</div>
        </div>
        <div class="glass-card" style="padding:14px;text-align:center;">
          <div style="font-size:1.2rem;font-weight:800;color:var(--danger);">${fmt(totalAmount)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">إجمالي المبالغ</div>
        </div>
        <div class="glass-card" style="padding:14px;text-align:center;">
          <div style="font-size:1.2rem;font-weight:800;color:var(--success);">${fmt(totalRefunded)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">إجمالي المسترد</div>
        </div>
        <div class="glass-card" style="padding:14px;text-align:center;">
          <div style="font-size:1.2rem;font-weight:800;color:var(--warning);">${fmt(totalRemaining)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">في عهدة المناديب</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px;">
        ${Object.entries(FAILED_DEPOSIT_STATUS_LABELS).map(([v, l]) =>
          `<span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:20px;font-size:0.78rem;background:rgba(0,0,0,0.04);border:1px solid var(--border-color);">
            <span style="width:8px;height:8px;border-radius:50%;background:${statusColors[v] || 'var(--text-muted)'};display:inline-block;"></span>
            ${escapeHtml(l)}: <strong>${byStatus[v] || 0}</strong>
          </span>`
        ).join('')}
      </div>`;
  },

  // ══════════════════════════════════════════════════════════
  // فلتر المندوب (الإدارة)
  // ══════════════════════════════════════════════════════════
  _renderAgentFilter(users) {
    const el = document.getElementById('fd-agent-filter');
    if (!el) return;

    const agents = (users || []).filter(u => u.role === 'agent' && u.is_active !== false);
    if (!agents.length) return;

    el.innerHTML = `<span style="font-size:0.85rem;color:var(--text-secondary);">فلترة بالمندوب:</span>`;

    const allBtn = document.createElement('button');
    allBtn.className = `btn btn-sm ${!this._agentFilter ? 'btn-primary' : 'btn-secondary'}`;
    allBtn.textContent = 'الكل';
    allBtn.addEventListener('click', () => { this._agentFilter = ''; this._load(); });
    el.appendChild(allBtn);

    agents.forEach(u => {
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${this._agentFilter === u.id ? 'btn-primary' : 'btn-secondary'}`;
      btn.textContent = u.display_name || u.username;
      btn.addEventListener('click', () => { this._agentFilter = u.id; this._load(); });
      el.appendChild(btn);
    });
  },

  // ══════════════════════════════════════════════════════════
  // جدول الإدارة
  // ══════════════════════════════════════════════════════════
  _renderAdminTable(listEl, items, bankAccounts, users) {
    const statusColors = {
      pending        : 'warning',
      claimed        : 'info',
      bank_processing: 'neutral',
      partial_refund : 'warning',
      refunded       : 'success',
      rejected       : 'danger',
    };

    const wrap = document.createElement('div');
    wrap.className = 'table-wrapper';
    wrap.style.overflowX = 'auto';
    wrap.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>التاريخ / الوقت</th>
          <th>الحساب البنكي</th>
          <th>المبلغ</th>
          <th>المسترد</th>
          <th>المتبقي</th>
          <th>الحالة</th>
          <th>المندوب</th>
          <th>الفرع</th>
          <th>إجراءات</th>
        </tr></thead>
        <tbody>
          ${items.map(fd => {
            const bank      = (bankAccounts || []).find(b => b.id === fd.bank_account_id);
            const agent     = (users || []).find(u => u.id === fd.agent_id);
            const refunded  = parseFloat(fd.refund_amount) || 0;
            const remaining = (parseFloat(fd.amount) || 0) - refunded;
            const stLbl     = FAILED_DEPOSIT_STATUS_LABELS[fd.status] || fd.status;
            const stColor   = statusColors[fd.status] || 'neutral';
            const timeStr   = fd.time ? fd.time.slice(0, 5) : '';
            return `<tr>
              <td style="white-space:nowrap;">
                <div>${escapeHtml(formatDateArabic(fd.date))}</div>
                ${timeStr ? `<div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(timeStr)}</div>` : ''}
              </td>
              <td>
                <div style="font-weight:600;white-space:nowrap;">${escapeHtml(bank?.name || '—')}</div>
                ${fd.account_number ? `<div style="font-size:0.72rem;color:var(--text-muted);" dir="ltr">${escapeHtml(fd.account_number)}</div>` : ''}
              </td>
              <td style="font-weight:700;color:var(--danger);white-space:nowrap;">${formatCurrency(fd.amount)}</td>
              <td style="font-weight:600;color:var(--success);white-space:nowrap;">${refunded > 0 ? formatCurrency(refunded) : '—'}</td>
              <td style="font-weight:600;color:${remaining > 0 ? 'var(--warning)' : 'var(--text-muted)'};white-space:nowrap;">
                ${remaining > 0 ? formatCurrency(remaining) : '—'}
              </td>
              <td><span class="badge badge-${stColor}">${escapeHtml(stLbl)}</span></td>
              <td style="font-size:0.82rem;">${escapeHtml(agent?.display_name || agent?.username || '—')}</td>
              <td style="font-size:0.78rem;color:var(--text-muted);">
                ${fd.branch_name ? escapeHtml(fd.branch_name) : '—'}
                ${fd.branch_number ? `<br><span style="font-size:0.72rem;">#${escapeHtml(fd.branch_number)}</span>` : ''}
              </td>
              <td>
                <div style="display:flex;gap:3px;flex-wrap:wrap;">
                  <button class="btn btn-secondary btn-sm fd-copy" data-id="${escapeHtml(fd.id)}" title="نسخ">
                    <i data-lucide="copy" style="width:12px;height:12px"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm fd-edit" data-id="${escapeHtml(fd.id)}" title="تعديل">
                    <i data-lucide="pencil" style="width:12px;height:12px"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm fd-status" data-id="${escapeHtml(fd.id)}"
                    title="تحديث الحالة" style="color:var(--accent);">
                    <i data-lucide="refresh-cw" style="width:12px;height:12px"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm fd-delete" data-id="${escapeHtml(fd.id)}"
                    data-amount="${escapeHtml(String(fd.amount))}" title="حذف" style="color:var(--danger);">
                    <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                  </button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(wrap);

    wrap.querySelectorAll('.fd-copy').forEach(btn => {
      btn.addEventListener('click', () => {
        const fd   = items.find(f => f.id === btn.dataset.id);
        const bank = (bankAccounts || []).find(b => b.id === fd?.bank_account_id);
        if (fd) this._copyDetails(fd, bank);
      });
    });
    wrap.querySelectorAll('.fd-edit').forEach(btn => {
      btn.addEventListener('click', () => {
        const fd = items.find(f => f.id === btn.dataset.id);
        if (fd) this._openForm(fd);
      });
    });
    wrap.querySelectorAll('.fd-status').forEach(btn => {
      btn.addEventListener('click', () => {
        const fd = items.find(f => f.id === btn.dataset.id);
        if (fd) this._openStatusModal(fd, bankAccounts);
      });
    });
    wrap.querySelectorAll('.fd-delete').forEach(btn => {
      btn.addEventListener('click', () => this._delete(btn.dataset.id, btn.dataset.amount));
    });

    if (window.lucide) lucide.createIcons();
  },

  // ══════════════════════════════════════════════════════════
  // بطاقات المندوب
  // ══════════════════════════════════════════════════════════
  _renderAgentCards(listEl, items, bankAccounts) {
    const statusColors = {
      pending        : '#f59e0b',
      claimed        : '#3b82f6',
      bank_processing: '#8b5cf6',
      partial_refund : '#f97316',
      refunded       : '#10b981',
      rejected       : '#ef4444',
    };

    listEl.innerHTML = '';
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;';

    items.forEach(fd => {
      const bank      = (bankAccounts || []).find(b => b.id === fd.bank_account_id);
      const refunded  = parseFloat(fd.refund_amount) || 0;
      const remaining = (parseFloat(fd.amount) || 0) - refunded;
      const stLbl     = FAILED_DEPOSIT_STATUS_LABELS[fd.status] || fd.status;
      const stColor   = statusColors[fd.status] || '#6b7280';
      const timeStr   = fd.time ? fd.time.slice(0, 5) : '';

      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.cssText = 'padding:16px;position:relative;';

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px;">
          <div>
            <div style="font-weight:700;font-size:0.95rem;color:var(--text-primary);">${escapeHtml(bank?.name || 'بنك غير محدد')}</div>
            ${fd.account_number ? `<div style="font-size:0.72rem;color:var(--text-muted);" dir="ltr">${escapeHtml(fd.account_number)}</div>` : ''}
          </div>
          <span style="padding:3px 10px;border-radius:20px;font-size:0.74rem;font-weight:700;
            background:${stColor}20;color:${stColor};border:1px solid ${stColor}40;">
            ${escapeHtml(stLbl)}
          </span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px;">
          <div style="background:rgba(239,68,68,0.06);border-radius:8px;padding:8px;">
            <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:2px;">المبلغ الكلي</div>
            <div style="font-weight:800;color:var(--danger);font-size:0.95rem;">${formatCurrency(fd.amount)}</div>
          </div>
          ${refunded > 0 ? `
            <div style="background:rgba(16,185,129,0.06);border-radius:8px;padding:8px;">
              <div style="font-size:0.7rem;color:var(--text-muted);margin-bottom:2px;">المسترد</div>
              <div style="font-weight:800;color:var(--success);font-size:0.95rem;">${formatCurrency(refunded)}</div>
            </div>` : `<div></div>`}
        </div>

        ${remaining > 0 && refunded > 0 ? `
          <div style="background:rgba(245,158,11,0.06);border-radius:8px;padding:8px;margin-bottom:12px;">
            <span style="font-size:0.75rem;color:var(--text-muted);">المتبقي قيد المطالبة: </span>
            <span style="font-weight:700;color:var(--warning);">${formatCurrency(remaining)}</span>
          </div>` : ''}

        ${fd.bank_response_text ? `
          <div style="background:rgba(0,0,0,0.03);border-radius:8px;padding:8px;margin-bottom:12px;font-size:0.78rem;color:var(--text-secondary);">
            <span style="font-size:0.7rem;color:var(--text-muted);display:block;margin-bottom:3px;">رد البنك:</span>
            ${escapeHtml(fd.bank_response_text)}
          </div>` : ''}

        ${fd.rejection_reason ? `
          <div style="background:rgba(239,68,68,0.05);border-radius:8px;padding:8px;margin-bottom:12px;font-size:0.78rem;color:var(--danger);">
            <span style="font-size:0.7rem;display:block;margin-bottom:3px;">سبب الرفض:</span>
            ${escapeHtml(fd.rejection_reason)}
          </div>` : ''}

        <div style="display:flex;justify-content:space-between;align-items:center;font-size:0.74rem;color:var(--text-muted);">
          <span>${escapeHtml(formatDateArabic(fd.date))}${timeStr ? ' — ' + escapeHtml(timeStr) : ''}</span>
          ${fd.branch_name ? `<span>📍 ${escapeHtml(fd.branch_name)}</span>` : ''}
        </div>

        <div style="margin-top:12px;display:flex;gap:6px;">
          <button class="btn btn-secondary btn-sm fd-card-copy" style="flex:1;">
            <i data-lucide="copy" style="width:12px;height:12px"></i> نسخ
          </button>
        </div>`;

      card.querySelector('.fd-card-copy').addEventListener('click', () => {
        this._copyDetails(fd, bank);
      });

      grid.appendChild(card);
    });

    listEl.appendChild(grid);
    if (window.lucide) lucide.createIcons();
  },

  // ══════════════════════════════════════════════════════════
  // بناء المودال (إضافة / تعديل)
  // ══════════════════════════════════════════════════════════
  _buildModal(isAdmin) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeForm(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.id = 'fd-modal-box';

    const allBanks     = AppStore.getState('bankAccounts') || [];
    const allowedBanks = AuthService.getAllowedBanks();
    const banks        = allowedBanks ? allBanks.filter(b => allowedBanks.includes(b.id)) : allBanks;

    const users  = AppStore.getState('users') || [];
    const agents = users.filter(u => u.role === 'agent' && u.is_active !== false);

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" id="fd-modal-title">إضافة إيداع فاشل</h3>
        <button class="modal-close" id="fd-close-btn">✕</button>
      </div>

      ${isAdmin ? `
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">المندوب <span class="required">*</span></label>
          <select id="fd-agent" class="form-control">
            <option value="">— اختر المندوب —</option>
            ${agents.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name || u.username)}</option>`).join('')}
          </select>
        </div>` : ''}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">

        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">الحساب البنكي <span class="required">*</span></label>
          <select id="fd-bank" class="form-control">
            <option value="">— اختر الحساب —</option>
            ${banks.map(b => `<option value="${escapeHtml(b.id)}"
              data-account-number="${escapeHtml(b.account_number || '')}"
              data-bank-name="${escapeHtml(b.bank_name || b.name || '')}"
              >${escapeHtml(b.name)}</option>`).join('')}
          </select>
        </div>

        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">رقم الحساب (تعبئة تلقائية)</label>
          <input id="fd-acc-num" type="text" class="form-control" dir="ltr"
            placeholder="يُعبَّأ تلقائياً عند اختيار الحساب" readonly
            style="background:var(--bg-input,rgba(0,0,0,0.03));cursor:default;">
        </div>

        <div class="form-group">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input id="fd-date" type="date" class="form-control">
        </div>

        <div class="form-group">
          <label class="form-label">الوقت</label>
          <input id="fd-time" type="time" class="form-control">
        </div>

        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">المبلغ <span class="required">*</span></label>
          <input id="fd-amount" type="number" class="form-control" placeholder="0.00" min="0.01" step="0.01">
        </div>

        <div class="form-group">
          <label class="form-label">اسم الفرع</label>
          <input id="fd-branch-name" type="text" class="form-control" placeholder="مثال: فرع الرياض">
        </div>

        <div class="form-group">
          <label class="form-label">رقم الفرع</label>
          <input id="fd-branch-number" type="text" class="form-control" dir="ltr" placeholder="مثال: 042">
        </div>

        <div class="form-group">
          <label class="form-label">المنطقة</label>
          <input id="fd-region" type="text" class="form-control" placeholder="مثال: الرياض">
        </div>

        <div class="form-group">
          <label class="form-label">رقم الجهاز</label>
          <input id="fd-device-number" type="text" class="form-control" dir="ltr" placeholder="مثال: ATM-001">
        </div>

      </div>

      <div id="fd-error" class="form-error" style="margin-top:8px;"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="fd-save-btn" class="btn btn-primary" style="flex:2;">حفظ</button>
        <button id="fd-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    /* التعبئة التلقائية عند اختيار الحساب */
    const bankSel = box.querySelector('#fd-bank');
    const accNum  = box.querySelector('#fd-acc-num');
    bankSel.addEventListener('change', () => {
      const opt = bankSel.options[bankSel.selectedIndex];
      if (opt && opt.value) {
        accNum.value = opt.dataset.accountNumber || '';
      } else {
        accNum.value = '';
      }
    });

    box.querySelector('#fd-close-btn').addEventListener('click',  () => this._closeForm());
    box.querySelector('#fd-cancel-btn').addEventListener('click', () => this._closeForm());
    box.querySelector('#fd-save-btn').addEventListener('click',   () => this._save());

    overlay.appendChild(box);
    return overlay;
  },

  // ══════════════════════════════════════════════════════════
  // فتح المودال
  // ══════════════════════════════════════════════════════════
  _openForm(fd = null) {
    this._editId = fd?.id || null;
    const box = document.getElementById('fd-modal-box');
    if (!box) return;

    box.querySelector('#fd-modal-title').textContent = fd ? 'تعديل إيداع فاشل' : 'إضافة إيداع فاشل';

    const agentSel = box.querySelector('#fd-agent');
    if (agentSel) agentSel.value = fd?.agent_id || '';

    const bankSel  = box.querySelector('#fd-bank');
    bankSel.value  = fd?.bank_account_id || '';

    /* تعبئة رقم الحساب عند التعديل */
    const accNum = box.querySelector('#fd-acc-num');
    if (fd?.bank_account_id) {
      const opt = [...bankSel.options].find(o => o.value === fd.bank_account_id);
      accNum.value = opt?.dataset.accountNumber || fd?.account_number || '';
    } else {
      accNum.value = fd?.account_number || '';
    }

    box.querySelector('#fd-date').value          = fd?.date          || getCurrentSaudiDate();
    box.querySelector('#fd-time').value          = fd?.time          ? fd.time.slice(0, 5) : (getCurrentSaudiTime?.() || '').slice(0, 5);
    box.querySelector('#fd-amount').value        = fd?.amount        || '';
    box.querySelector('#fd-branch-name').value   = fd?.branch_name   || '';
    box.querySelector('#fd-branch-number').value = fd?.branch_number || '';
    box.querySelector('#fd-region').value        = fd?.region        || '';
    box.querySelector('#fd-device-number').value = fd?.device_number || '';
    box.querySelector('#fd-error').textContent   = '';

    this._modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },

  // ══════════════════════════════════════════════════════════
  // إغلاق المودال
  // ══════════════════════════════════════════════════════════
  _closeForm() {
    if (this._modal) {
      this._modal.classList.add('is-closing');
      setTimeout(() => {
        if (this._modal) {
          this._modal.style.display = 'none';
          this._modal.classList.remove('is-closing');
        }
        document.body.style.overflow = '';
      }, 220);
    }
    this._editId = null;
  },

  // ══════════════════════════════════════════════════════════
  // حفظ (إضافة / تعديل)
  // ══════════════════════════════════════════════════════════
  async _save() {
    const box    = document.getElementById('fd-modal-box');
    const errEl  = box.querySelector('#fd-error');
    const amount = parseFloat(box.querySelector('#fd-amount').value);
    const date   = box.querySelector('#fd-date').value;
    const bankId = box.querySelector('#fd-bank').value;

    if (!bankId)             { errEl.textContent = 'الحساب البنكي مطلوب';        return; }
    if (!amount || amount <= 0) { errEl.textContent = 'المبلغ مطلوب وأكبر من صفر'; return; }
    if (!date)               { errEl.textContent = 'التاريخ مطلوب';             return; }

    const isAdmin  = AuthService.isAdmin() || AuthService.isAdminAssistant();
    const agentSel = box.querySelector('#fd-agent');
    const agentId  = isAdmin && agentSel ? agentSel.value : AuthService.getCurrentUserId();

    if (isAdmin && !agentId) { errEl.textContent = 'يجب تحديد المندوب'; return; }

    const bankSel  = box.querySelector('#fd-bank');
    const opt      = bankSel.options[bankSel.selectedIndex];
    const accNum   = box.querySelector('#fd-acc-num').value.trim()
                  || (opt?.dataset.accountNumber || '');

    const timeVal  = box.querySelector('#fd-time').value.trim();

    const data = {
      date,
      amount,
      bank_account_id: bankId,
      account_number : accNum || null,
      time           : timeVal || null,
      agent_id       : agentId,
      branch_name    : box.querySelector('#fd-branch-name').value.trim()   || null,
      branch_number  : box.querySelector('#fd-branch-number').value.trim() || null,
      region         : box.querySelector('#fd-region').value.trim()        || null,
      device_number  : box.querySelector('#fd-device-number').value.trim() || null,
    };
    if (!this._editId) data.status = FAILED_DEPOSIT_STATUS.PENDING;

    const saveBtn = box.querySelector('#fd-save-btn');
    const restore = setButtonLoading(saveBtn);

    const result = this._editId
      ? await repo.update(TABLES.FAILED_DEPOSITS, this._editId, data)
      : await repo.create(TABLES.FAILED_DEPOSITS, data);

    restore();

    if (isOk(result)) {
      showToast(this._editId ? 'تم التعديل' : 'تم الإضافة بنجاح', 'success');
      this._closeForm();
      await this._load();
    } else {
      errEl.textContent = result.error || 'فشلت العملية';
    }
  },

  // ══════════════════════════════════════════════════════════
  // مودال تحديث الحالة (ذكي — الإدارة فقط)
  // ══════════════════════════════════════════════════════════
  async _openStatusModal(fd, bankAccounts) {
    const S = FAILED_DEPOSIT_STATUS;

    /* تدفق الحالات المتاح */
    const transitions = {
      [S.PENDING]        : [S.CLAIMED],
      [S.CLAIMED]        : [S.BANK_PROCESSING],
      [S.BANK_PROCESSING]: [S.PARTIAL_REFUND, S.REFUNDED, S.REJECTED],
      [S.PARTIAL_REFUND] : [S.CLAIMED],
      [S.REFUNDED]       : [],
      [S.REJECTED]       : [],
    };

    const available = transitions[fd.status] || [];
    if (!available.length) {
      showToast('هذه الحالة نهائية ولا يمكن تغييرها', 'warning');
      return;
    }

    const refunded  = parseFloat(fd.refund_amount) || 0;
    const remaining = (parseFloat(fd.amount) || 0) - refunded;

    const stLabels = FAILED_DEPOSIT_STATUS_LABELS;

    const choice = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';
      document.body.style.overflow = 'hidden';

      const box = document.createElement('div');
      box.className = 'modal-box';
      box.style.maxWidth = '440px';

      const closeModal = (val = null) => {
        overlay.classList.add('is-closing');
        setTimeout(() => { overlay.remove(); document.body.style.overflow = ''; }, 220);
        resolve(val);
      };

      /* محتوى المودال الديناميكي */
      let extraFields = '';
      if (available.includes(S.BANK_PROCESSING)) {
        extraFields = `
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">رد البنك النصي (اختياري)</label>
            <input id="fds-bank-resp" type="text" class="form-control" placeholder="رسالة أو مرجع من البنك">
          </div>`;
      }
      if (available.includes(S.PARTIAL_REFUND) || available.includes(S.REFUNDED)) {
        extraFields = `
          <div class="form-group" style="margin-top:12px;">
            <label class="form-label">رد البنك النصي (اختياري)</label>
            <input id="fds-bank-resp" type="text" class="form-control" placeholder="رسالة أو مرجع من البنك">
          </div>
          <div class="form-group" style="margin-top:8px;">
            <label class="form-label">المبلغ المسترد <span class="required">*</span>
              <span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;">
                (المتبقي: ${formatCurrency(remaining)})
              </span>
            </label>
            <input id="fds-refund-amount" type="number" class="form-control"
              placeholder="أدخل المبلغ المسترد" min="0.01" step="0.01"
              value="${remaining > 0 ? remaining : ''}">
          </div>`;
      }
      if (available.includes(S.REJECTED)) {
        extraFields += `
          <div class="form-group" style="margin-top:8px;">
            <label class="form-label">سبب الرفض (اختياري)</label>
            <input id="fds-reject-reason" type="text" class="form-control" placeholder="سبب رفض البنك">
          </div>`;
      }

      box.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">تحديث حالة الإيداع الفاشل</h3>
          <button class="modal-close" id="fds-close">✕</button>
        </div>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:4px;">
          المبلغ: <strong>${formatCurrency(fd.amount)}</strong>
          ${refunded > 0 ? ` | المسترد: <strong style="color:var(--success)">${formatCurrency(refunded)}</strong>` : ''}
        </p>
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">
          الحالة الحالية: <strong>${stLabels[fd.status] || fd.status}</strong>
        </p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${available.map(v => `
            <button class="btn btn-secondary fds-choice-btn" data-val="${v}"
              style="text-align:right;justify-content:flex-start;padding:10px 14px;font-size:0.88rem;">
              ← ${escapeHtml(stLabels[v] || v)}
            </button>`).join('')}
        </div>
        ${extraFields}
        <div id="fds-error" class="form-error" style="margin-top:8px;"></div>
        <button class="btn btn-secondary" style="width:100%;margin-top:14px;" id="fds-cancel">إلغاء</button>`;

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      box.querySelector('#fds-close').addEventListener('click',  () => closeModal(null));
      box.querySelector('#fds-cancel').addEventListener('click', () => closeModal(null));

      box.querySelectorAll('.fds-choice-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const newStatus   = btn.dataset.val;
          const bankResp    = box.querySelector('#fds-bank-resp')?.value.trim()    || null;
          const refundAmt   = parseFloat(box.querySelector('#fds-refund-amount')?.value) || null;
          const rejectReason= box.querySelector('#fds-reject-reason')?.value.trim() || null;
          const errEl       = box.querySelector('#fds-error');

          /* تحقق من المبلغ إذا كان مطلوباً */
          if ((newStatus === S.PARTIAL_REFUND || newStatus === S.REFUNDED)) {
            if (!refundAmt || refundAmt <= 0) {
              errEl.textContent = 'يجب إدخال المبلغ المسترد';
              return;
            }
            if (refundAmt > remaining + 0.01) {
              errEl.textContent = `المبلغ المسترد (${formatCurrency(refundAmt)}) أكبر من المتبقي (${formatCurrency(remaining)})`;
              return;
            }
            if (newStatus === S.PARTIAL_REFUND && refundAmt >= remaining - 0.01) {
              errEl.textContent = 'إذا كان المبلغ المسترد يساوي المتبقي استخدم حالة "مُستردّ" بدلاً من "استرداد جزئي"';
              return;
            }
          }

          closeModal({ newStatus, bankResp, refundAmt, rejectReason });
        });
      });
    });

    if (!choice) return;
    await this._applyStatusUpdate(fd, choice, bankAccounts);
  },

  // ══════════════════════════════════════════════════════════
  // تطبيق تحديث الحالة + القيد المحاسبي عند الاسترداد
  // ══════════════════════════════════════════════════════════
  async _applyStatusUpdate(fd, choice, bankAccounts) {
    const { newStatus, bankResp, refundAmt, rejectReason } = choice;
    const S       = FAILED_DEPOSIT_STATUS;
    const refunded = parseFloat(fd.refund_amount) || 0;
    const remaining = (parseFloat(fd.amount) || 0) - refunded;

    const updateData = { status: newStatus };
    if (bankResp)     updateData.bank_response_text = bankResp;
    if (rejectReason) updateData.rejection_reason   = rejectReason;

    /* القيد المحاسبي عند الاسترداد الجزئي أو الكلي */
    if (newStatus === S.PARTIAL_REFUND || newStatus === S.REFUNDED) {
      if (!fd.bank_account_id) {
        showToast('لا يمكن تنفيذ القيد: الإيداع الفاشل غير مرتبط بحساب بنكي', 'error');
        return;
      }

      const isPartial      = newStatus === S.PARTIAL_REFUND;
      const newRefundTotal = refunded + refundAmt;
      updateData.refund_amount = newRefundTotal;

      const txResult = await AccountingService.createTransactionWithEntries({
        type            : TRANSACTION_TYPES.FAILED_DEPOSIT_REFUND,
        amount          : refundAmt,
        agent_id        : fd.agent_id,
        bank_account_id : fd.bank_account_id,
        date            : getCurrentSaudiDate(),
        details         : `استرداد إيداع فاشل ${isPartial ? 'جزئي' : 'كلي'} — ${fd.id.slice(0, 8)}`,
        _partial        : isPartial,
        _fd_id          : fd.id,
        _remaining      : Math.max(0, remaining - refundAmt),
      });

      if (!isOk(txResult)) {
        showToast(`فشل تنفيذ القيد المحاسبي: ${txResult.error}`, 'error');
        return;
      }
    }

    const result = await repo.update(TABLES.FAILED_DEPOSITS, fd.id, updateData);
    if (!isOk(result)) {
      showToast(`فشل تحديث الحالة: ${result.error}`, 'error');
      return;
    }

    showToast('تم تحديث الحالة بنجاح', 'success');
    await this._load();
  },

  // ══════════════════════════════════════════════════════════
  // حذف
  // ══════════════════════════════════════════════════════════
  async _delete(id, amount) {
    const confirmed = await confirmDialog(
      `حذف الإيداع الفاشل بمبلغ ${formatCurrency(amount)}؟`, 'حذف', 'إلغاء', 'danger'
    );
    if (!confirmed) return;
    const result = await repo.delete(TABLES.FAILED_DEPOSITS, id);
    if (isOk(result)) { showToast('تم الحذف', 'success'); await this._load(); }
    else showToast(`فشل الحذف: ${result.error}`, 'error');
  },

  // ══════════════════════════════════════════════════════════
  // نسخ التفاصيل
  // ══════════════════════════════════════════════════════════
  _copyDetails(fd, bank) {
    const SEP      = '──────────────────';
    const refunded  = parseFloat(fd.refund_amount) || 0;
    const remaining = (parseFloat(fd.amount) || 0) - refunded;
    const users     = AppStore.getState('users') || [];
    const agent     = users.find(u => u.id === fd.agent_id);
    const lines = [
      `إيداع فاشل`,
      SEP,
      `المندوب: ${agent?.display_name || '—'}`,
      `التاريخ: ${formatDateArabic(fd.date)}`,
      fd.time ? `الوقت: ${fd.time.slice(0, 5)}` : null,
      `اسم الحساب البنكي: ${bank?.name || '—'}`,
      (fd.account_number || bank?.account_number) ? `رقم الحساب: ${fd.account_number || bank?.account_number}` : null,
      bank?.card_number   ? `رقم البطاقة: ${bank.card_number}` : null,
      (bank?.card_holder || bank?.card_holder_name) ? `صاحب البطاقة: ${bank.card_holder || bank.card_holder_name}` : null,
      bank?.pin           ? `كلمة السر: ${bank.pin}` : null,
      `المبلغ: ${formatCurrency(fd.amount)}`,
      refunded > 0 ? `المسترد: ${formatCurrency(refunded)}` : null,
      refunded > 0 && remaining > 0 ? `المتبقي: ${formatCurrency(remaining)}` : null,
      fd.branch_name   ? `الفرع: ${fd.branch_name}` : null,
      fd.branch_number ? `رقم الفرع: ${fd.branch_number}` : null,
      fd.region        ? `المنطقة: ${fd.region}` : null,
      fd.device_number ? `رقم الجهاز: ${fd.device_number}` : null,
      SEP,
      `الحالة: ${FAILED_DEPOSIT_STATUS_LABELS[fd.status] || fd.status}`,
      fd.bank_response_text ? `رد البنك: ${fd.bank_response_text}` : null,
      fd.rejection_reason   ? `سبب الرفض: ${fd.rejection_reason}` : null,
    ].filter(Boolean).join('\n');

    copyToClipboard(lines, 'تم نسخ تفاصيل الإيداع الفاشل');
  },
};

window.FailedDepositsComponent = FailedDepositsComponent;
console.log('✅ FailedDepositsComponent.js v2.0 محمّل');
