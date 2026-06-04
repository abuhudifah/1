/**
 * components/AuditLogComponent.js
 * نظام أبو حذيفة — سجل التدقيق (للمدير فقط)
 * عرض مع فلاتر + ترقيم صفحات + مسح السجل
 */
'use strict';

const AuditLogComponent = {
  _page    : 1,
  _pageSize: 30,
  _count   : 0,

  async render(container) {
    if (!AuthService.isAdmin()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">سجل التدقيق للمدير فقط</div></div>`;
      return;
    }

    container.innerHTML = '';
    const wrap = document.createElement('div');

    /* ── شريط العنوان ── */
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;';
    bar.innerHTML = `
      <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">سجل التدقيق</h2>
      <span id="audit-count" style="font-size:0.82rem;color:var(--text-muted);"></span>`;

    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn btn-secondary btn-sm';
    clearBtn.style.color = 'var(--danger)';
    clearBtn.innerHTML = '<i data-lucide="trash-2" style="width:14px;height:14px"></i> مسح السجل';
    clearBtn.addEventListener('click', () => this._clearLog());
    bar.appendChild(clearBtn);
    wrap.appendChild(bar);

    /* ── فلاتر ── */
    const filterCard = document.createElement('div');
    filterCard.className = 'glass-card';
    filterCard.style.marginBottom = '16px';

    const users = AppStore.getState('users');

    filterCard.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">الإجراء</label>
          <select id="audit-action" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الكل</option>
            <option value="create">إنشاء</option>
            <option value="update">تعديل</option>
            <option value="delete">حذف</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">نوع السجل</label>
          <select id="audit-record-type" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الكل</option>
            <option value="transaction">معاملة</option>
            <option value="user">مستخدم</option>
            <option value="bank_account">حساب بنكي</option>
            <option value="debtor">عميل مدين</option>
            <option value="failed_deposit">إيداع فاشل</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">المستخدم</label>
          <select id="audit-user" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الجميع</option>
            ${users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">من تاريخ</label>
          <input id="audit-from" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">إلى تاريخ</label>
          <input id="audit-to" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
            value="${getCurrentSaudiDate()}">
        </div>
      </div>
      <button id="audit-apply-btn" class="btn btn-primary btn-sm">
        <i data-lucide="filter" style="width:14px;height:14px"></i> تطبيق
      </button>`;

    filterCard.querySelector('#audit-apply-btn').addEventListener('click', () => {
      this._page = 1;
      this._load();
    });
    wrap.appendChild(filterCard);

    /* ── القائمة ── */
    const listEl = document.createElement('div');
    listEl.id = 'audit-list';
    listEl.innerHTML = `<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);
    wrap.appendChild(listEl);

    const pagerEl = document.createElement('div');
    pagerEl.id = 'audit-pager';
    pagerEl.style.cssText = 'display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:16px;';
    wrap.appendChild(pagerEl);

    container.appendChild(wrap);
    if (window.lucide) lucide.createIcons();
    await this._load();
  },

  async _load() {
    const listEl  = document.getElementById('audit-list');
    const pagerEl = document.getElementById('audit-pager');
    const countEl = document.getElementById('audit-count');
    if (!listEl) return;

    listEl.innerHTML = `<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);

    /* بناء الفلاتر */
    const filters = {};
    const action      = document.getElementById('audit-action')?.value;
    const recordType  = document.getElementById('audit-record-type')?.value;
    const userId      = document.getElementById('audit-user')?.value;
    const from        = document.getElementById('audit-from')?.value;
    const to          = document.getElementById('audit-to')?.value;

    if (action)     filters.action      = action;
    if (recordType) filters.record_type = recordType;
    if (userId)     filters.user_id     = userId;
    if (from && to) filters.timestamp   = { op: 'between', val: [`${from}T00:00:00`, `${to}T23:59:59`] };
    else if (from)  filters.timestamp   = { op: 'gte', val: `${from}T00:00:00` };
    else if (to)    filters.timestamp   = { op: 'lte', val: `${to}T23:59:59` };

    const result = await repo.query(TABLES.AUDIT_LOGS, filters, {
      orderBy : 'timestamp',
      ascending: false,
      page    : this._page,
      pageSize: this._pageSize,
    });

    const data  = isOk(result) ? (result.data.data  || []) : [];
    this._count = isOk(result) ? (result.data.count || 0)  : 0;

    if (countEl) countEl.textContent = `إجمالي: ${this._count} سجل`;

    if (!data.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <div class="empty-state-text">لا توجد سجلات مطابقة</div></div>`;
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }

    const users        = AppStore.getState('users');
    const actionColors = { create:'success', update:'info', delete:'danger' };
    const actionLabels = { create:'إنشاء', update:'تعديل', delete:'حذف' };

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الوقت</th><th>الإجراء</th><th>النوع</th>
          <th>المعرف</th><th>المستخدم</th><th>التفاصيل</th>
        </tr></thead>
        <tbody>
          ${data.map(log => {
            const u       = users.find(u => u.id === log.user_id);
            const clr     = actionColors[log.action] || 'neutral';
            const lbl     = actionLabels[log.action]  || log.action;
            const newVal  = log.new_value ? JSON.stringify(JSON.parse(log.new_value || '{}'), null, 0).slice(0,60) : '—';
            return `<tr>
              <td style="font-size:0.78rem;white-space:nowrap;">${escapeHtml(formatDateTimeArabic(log.timestamp))}</td>
              <td><span class="badge badge-${clr}">${escapeHtml(lbl)}</span></td>
              <td style="font-size:0.82rem;">${escapeHtml(log.record_type)}</td>
              <td style="font-family:monospace;font-size:0.75rem;direction:ltr;color:var(--text-muted);">
                ${escapeHtml((log.record_id || '').slice(0,8))}…
              </td>
              <td style="font-size:0.82rem;">${escapeHtml(u?.display_name || '—')}</td>
              <td style="font-size:0.75rem;color:var(--text-muted);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                title="${escapeHtml(newVal)}">${escapeHtml(newVal)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(table);

    /* ترقيم الصفحات */
    if (pagerEl) {
      pagerEl.innerHTML = '';
      const pages = Math.ceil(this._count / this._pageSize);
      if (pages > 1) {
        for (let p = 1; p <= Math.min(pages, 10); p++) {
          const pbtn = document.createElement('button');
          pbtn.className = p === this._page ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
          pbtn.textContent = p;
          pbtn.style.minWidth = '36px';
          pbtn.addEventListener('click', () => { this._page = p; this._load(); });
          pagerEl.appendChild(pbtn);
        }
      }
    }

    if (window.lucide) lucide.createIcons();
  },

  async _clearLog() {
    const confirmed = await confirmDialog(
      'مسح جميع سجلات التدقيق؟ هذا الإجراء لا يمكن التراجع عنه.',
      'مسح', 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    try {
      await db.audit_logs.clear();
      if (isOnline()) {
        await supabaseClient.from(TABLES.AUDIT_LOGS).delete().gte('timestamp', '2000-01-01');
      }
      showToast('تم مسح سجل التدقيق بنجاح', 'success');
      this._page  = 1;
      this._count = 0;
      await this._load();
    } catch (e) {
      showToast(`فشل المسح: ${e.message}`, 'error');
    }
  },
};

window.AuditLogComponent = AuditLogComponent;
console.log('✅ AuditLogComponent.js محمّل');
