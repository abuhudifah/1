/**
 * components/FailedDepositsComponent.js
 * نظام أبو حذيفة — الإيداعات الفاشلة
 * عرض + إضافة + تعديل + حذف + تحديث الحالة + نسخ التفاصيل
 */
'use strict';

const FailedDepositsComponent = {
  _modal  : null,
  _editId : null,

  async render(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');

    /* ── شريط العنوان ── */
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;';
    bar.innerHTML = `<h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">
      الإيداعات الفاشلة</h2>`;

    if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary btn-sm';
      addBtn.innerHTML = '<i data-lucide="plus" style="width:14px;height:14px"></i> إضافة';
      addBtn.addEventListener('click', () => this._openForm());
      bar.appendChild(addBtn);
    }
    wrap.appendChild(bar);

    const listEl = document.createElement('div');
    listEl.id = 'fd-list';
    listEl.innerHTML = `<div class="skeleton" style="height:56px;border-radius:10px;margin-bottom:8px;"></div>`.repeat(4);
    wrap.appendChild(listEl);

    this._modal = this._buildModal();
    wrap.appendChild(this._modal);

    container.appendChild(wrap);
    await this._load();
    if (window.lucide) lucide.createIcons();
  },

  async _load() {
    const listEl = document.getElementById('fd-list');
    if (!listEl) return;

    const isAgent = AuthService.isAgent();
    const filters = isAgent ? { agent_id: AuthService.getCurrentUserId() } : {};
    const result  = await repo.query(TABLES.FAILED_DEPOSITS, filters, {
      orderBy: 'date', ascending: false, pageSize: 100,
    });
    const items = isOk(result) ? (result.data.data || []) : [];

    if (!items.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">💸</div>
        <div class="empty-state-text">لا توجد إيداعات فاشلة</div></div>`;
      return;
    }

    const bankAccounts = AppStore.getState('bankAccounts');
    const users        = AppStore.getState('users');

    const statusColors = {
      pending  : 'warning',
      claimed  : 'info',
      refunded : 'success',
      rejected : 'danger',
    };

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>التاريخ</th><th>الحساب البنكي</th><th>المبلغ</th>
          <th>الحالة</th><th>المندوب</th><th>إجراءات</th>
        </tr></thead>
        <tbody>
          ${items.map(fd => {
            const bank  = bankAccounts.find(b => b.id === fd.bank_account_id);
            const agent = users.find(u => u.id === fd.agent_id);
            const stLbl = FAILED_DEPOSIT_STATUS_LABELS[fd.status] || fd.status;
            return `<tr id="fd-row-${fd.id}">
              <td>${escapeHtml(formatDateArabic(fd.date))}</td>
              <td>${escapeHtml(bank?.name || fd.account_number || '—')}</td>
              <td style="font-weight:700;color:var(--danger);">${formatCurrency(fd.amount)}</td>
              <td><span class="badge badge-${statusColors[fd.status] || 'neutral'}">${escapeHtml(stLbl)}</span></td>
              <td style="font-size:0.85rem;">${escapeHtml(agent?.display_name || '—')}</td>
              <td>
                <div style="display:flex;gap:4px;flex-wrap:wrap;">
                  <button class="btn btn-secondary btn-sm copy-fd-btn"
                    data-id="${escapeHtml(fd.id)}" title="نسخ التفاصيل">
                    <i data-lucide="copy" style="width:12px;height:12px"></i>
                  </button>
                  ${!isAgent ? `
                    <button class="btn btn-secondary btn-sm edit-fd-btn"
                      data-id="${escapeHtml(fd.id)}" title="تعديل">
                      <i data-lucide="pencil" style="width:12px;height:12px"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm status-fd-btn"
                      data-id="${escapeHtml(fd.id)}" title="تحديث الحالة">
                      <i data-lucide="refresh-cw" style="width:12px;height:12px"></i>
                    </button>
                    <button class="btn btn-secondary btn-sm delete-fd-btn"
                      style="color:var(--danger);" data-id="${escapeHtml(fd.id)}"
                      data-amount="${fd.amount}" title="حذف">
                      <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                    </button>` : ''}
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(table);

    /* ── أحداث الأزرار ── */
    listEl.querySelectorAll('.copy-fd-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fd   = items.find(f => f.id === btn.dataset.id);
        const bank = bankAccounts.find(b => b.id === fd?.bank_account_id);
        if (!fd) return;
        const text = `إيداع فاشل\nالتاريخ: ${formatDateArabic(fd.date)}\nالبنك: ${bank?.name || '—'}\nالمبلغ: ${formatCurrency(fd.amount)}\nالحالة: ${FAILED_DEPOSIT_STATUS_LABELS[fd.status]}\n${fd.rejection_reason ? 'سبب الرفض: ' + fd.rejection_reason : ''}`;
        copyToClipboard(text, 'تم نسخ تفاصيل الإيداع الفاشل');
      });
    });

    listEl.querySelectorAll('.edit-fd-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fd = items.find(f => f.id === btn.dataset.id);
        if (fd) this._openForm(fd);
      });
    });

    listEl.querySelectorAll('.status-fd-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const fd = items.find(f => f.id === btn.dataset.id);
        if (fd) this._updateStatus(fd);
      });
    });

    listEl.querySelectorAll('.delete-fd-btn').forEach(btn => {
      btn.addEventListener('click', () =>
        this._delete(btn.dataset.id, btn.dataset.amount));
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
    box.id = 'fd-modal-box';

    const banks = AppStore.getState('bankAccounts');

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" id="fd-modal-title">إضافة إيداع فاشل</h3>
        <button class="modal-close" id="fd-close-btn">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label class="form-label">التاريخ <span class="required">*</span></label>
          <input id="fd-date" type="date" class="form-control" value="${getCurrentSaudiDate()}">
        </div>
        <div class="form-group">
          <label class="form-label">المبلغ <span class="required">*</span></label>
          <input id="fd-amount" type="number" class="form-control" placeholder="0.00" min="0.01" step="0.01">
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">الحساب البنكي</label>
          <select id="fd-bank" class="form-control">
            <option value="">— اختر الحساب —</option>
            ${banks.map(b => `<option value="${escapeHtml(b.id)}">${escapeHtml(b.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">رقم الحساب المُدخَل</label>
          <input id="fd-acc-num" type="text" class="form-control" dir="ltr" placeholder="رقم الحساب">
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">رد البنك النصي</label>
          <input id="fd-bank-resp" type="text" class="form-control" placeholder="رسالة البنك">
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">الحالة</label>
          <select id="fd-status" class="form-control">
            ${Object.entries(FAILED_DEPOSIT_STATUS_LABELS).map(([v,l]) =>
              `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">سبب الاعتذار (إن وجد)</label>
          <input id="fd-reject-reason" type="text" class="form-control" placeholder="سبب الرفض">
        </div>
      </div>
      <div id="fd-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="fd-save-btn" class="btn btn-primary" style="flex:2;">حفظ</button>
        <button id="fd-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    box.querySelector('#fd-close-btn').addEventListener('click',  () => this._closeForm());
    box.querySelector('#fd-cancel-btn').addEventListener('click', () => this._closeForm());
    box.querySelector('#fd-save-btn').addEventListener('click',   () => this._save());

    overlay.appendChild(box);
    return overlay;
  },

  _openForm(fd = null) {
    this._editId = fd?.id || null;
    const box = document.getElementById('fd-modal-box');
    if (!box) return;

    box.querySelector('#fd-modal-title').textContent = fd ? 'تعديل إيداع فاشل' : 'إضافة إيداع فاشل';
    box.querySelector('#fd-date').value         = fd?.date              || getCurrentSaudiDate();
    box.querySelector('#fd-amount').value       = fd?.amount            || '';
    box.querySelector('#fd-bank').value         = fd?.bank_account_id  || '';
    box.querySelector('#fd-acc-num').value      = fd?.account_number   || '';
    box.querySelector('#fd-bank-resp').value    = fd?.bank_response_text || '';
    box.querySelector('#fd-status').value       = fd?.status           || FAILED_DEPOSIT_STATUS.PENDING;
    box.querySelector('#fd-reject-reason').value= fd?.rejection_reason || '';
    box.querySelector('#fd-error').textContent  = '';

    this._modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },

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

  async _save() {
    const box    = document.getElementById('fd-modal-box');
    const errEl  = box.querySelector('#fd-error');
    const amount = parseFloat(box.querySelector('#fd-amount').value);
    const date   = box.querySelector('#fd-date').value;

    if (!amount || amount <= 0) { errEl.textContent = 'المبلغ مطلوب وأكبر من صفر'; return; }
    if (!date)                   { errEl.textContent = 'التاريخ مطلوب';              return; }

    const data = {
      date              : date,
      amount,
      bank_account_id   : box.querySelector('#fd-bank').value         || null,
      account_number    : box.querySelector('#fd-acc-num').value.trim() || null,
      bank_response_text: box.querySelector('#fd-bank-resp').value.trim() || null,
      status            : box.querySelector('#fd-status').value,
      rejection_reason  : box.querySelector('#fd-reject-reason').value.trim() || null,
      agent_id          : AuthService.getCurrentUserId(),
    };

    const saveBtn = box.querySelector('#fd-save-btn');
    const restore = setButtonLoading(saveBtn);

    const result = this._editId
      ? await repo.update(TABLES.FAILED_DEPOSITS, this._editId, data)
      : await repo.create(TABLES.FAILED_DEPOSITS, data);
    restore();

    if (isOk(result)) {
      showToast(this._editId ? 'تم التعديل' : 'تم الإضافة', 'success');
      this._closeForm();
      await this._load();
    } else {
      errEl.textContent = result.error;
    }
  },

  /* ── تحديث الحالة — مودال سريع ── */
  async _updateStatus(fd) {
    const options = Object.entries(FAILED_DEPOSIT_STATUS_LABELS)
      .filter(([v]) => v !== fd.status);

    const choice = await new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.display = 'flex';

      const box = document.createElement('div');
      box.className = 'modal-box';
      box.style.maxWidth = '320px';
      box.innerHTML = `<h3 style="font-size:1rem;font-weight:700;margin-bottom:16px;">تحديث حالة الإيداع الفاشل</h3>
        <p style="font-size:0.85rem;margin-bottom:12px;">الحالة الحالية: <strong>${FAILED_DEPOSIT_STATUS_LABELS[fd.status]}</strong></p>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${options.map(([v,l]) =>
            `<button class="btn btn-secondary" data-val="${v}">${l}</button>`).join('')}
        </div>
        <button class="btn btn-secondary" style="width:100%;margin-top:12px;" id="fd-status-cancel">إلغاء</button>`;

      overlay.appendChild(box);
      document.body.appendChild(overlay);
      document.body.style.overflow = 'hidden';

      const closeStatusModal = () => {
        overlay.classList.add('is-closing');
        setTimeout(() => {
          overlay.remove();
          document.body.style.overflow = '';
        }, 220);
      };

      box.querySelectorAll('[data-val]').forEach(btn => {
        btn.addEventListener('click', () => { closeStatusModal(); resolve(btn.dataset.val); });
      });
      box.querySelector('#fd-status-cancel').addEventListener('click', () => {
        closeStatusModal(); resolve(null);
      });
    });

    if (!choice) return;
    const result = await repo.update(TABLES.FAILED_DEPOSITS, fd.id, { status: choice });
    if (!isOk(result)) { showToast(`فشل: ${result.error}`, 'error'); return; }

    // قيد محاسبي عند الاسترداد: يُنشئ إيداعاً عادياً يتبع المصفوفة الجديدة (COMP_ مدين / AGT_ دائن).
    // الشركة تُشتقّ تلقائياً من bank_accounts.company_id داخل buildEntries.
    if (choice === FAILED_DEPOSIT_STATUS.REFUNDED && fd.bank_account_id) {
      await AccountingService.createTransactionWithEntries({
        type            : TRANSACTION_TYPES.DEPOSIT,
        amount          : fd.amount,
        agent_id        : fd.agent_id,
        bank_account_id : fd.bank_account_id,
        date            : getCurrentSaudiDate(),
        details         : `تسوية إيداع فاشل — ${fd.id}`,
      });
    }

    showToast('تم تحديث الحالة', 'success');
    await this._load();
  },

  async _delete(id, amount) {
    const confirmed = await confirmDialog(
      `حذف الإيداع الفاشل بمبلغ ${formatCurrency(amount)}؟`, 'حذف', 'إلغاء', 'danger'
    );
    if (!confirmed) return;
    const result = await repo.delete(TABLES.FAILED_DEPOSITS, id);
    if (isOk(result)) { showToast('تم الحذف', 'success'); await this._load(); }
    else showToast(`فشل الحذف: ${result.error}`, 'error');
  },
};

window.FailedDepositsComponent = FailedDepositsComponent;
console.log('✅ FailedDepositsComponent.js محمّل');
