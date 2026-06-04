/**
 * components/AllOperationsComponent.js
 * نظام أبو حذيفة — جميع العمليات (للمدير فقط)
 * فلاتر متقدمة: نوع + مستخدم + يوم محدد + شهر محدد + فترة من-إلى
 */
'use strict';

const AllOperationsComponent = {
  _page    : 1,
  _pageSize: 20,
  _count   : 0,

  async render(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');

    /* ── عنوان ── */
    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);margin-bottom:16px;';
    title.textContent = 'جميع العمليات';
    wrap.appendChild(title);

    /* ── لوحة الفلاتر ── */
    const filterCard = document.createElement('div');
    filterCard.className = 'glass-card';
    filterCard.style.marginBottom = '16px';

    const users   = AppStore.getState('users').filter(u => u.role === ROLES.AGENT);

    filterCard.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">نوع العملية</label>
          <select id="ao-type" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الكل</option>
            ${Object.entries(TRANSACTION_TYPE_LABELS).map(([v,l]) =>
              `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">المستخدم</label>
          <select id="ao-agent" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الجميع</option>
            ${users.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">نوع التاريخ</label>
          <select id="ao-date-mode" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="range">فترة من–إلى</option>
            <option value="day">يوم محدد</option>
            <option value="month">شهر محدد</option>
          </select>
        </div>
        <!-- حقول التاريخ — تتغير بحسب النوع -->
        <div id="ao-date-range" style="display:contents;">
          <div class="form-group" style="margin:0;">
            <label class="form-label" style="font-size:0.78rem;">من</label>
            <input id="ao-from" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label" style="font-size:0.78rem;">إلى</label>
            <input id="ao-to" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
              value="${getCurrentSaudiDate()}">
          </div>
        </div>
        <div id="ao-date-day" style="display:none;" class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">اليوم</label>
          <input id="ao-day" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
            value="${getCurrentSaudiDate()}">
        </div>
        <div id="ao-date-month" style="display:none;" class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">الشهر</label>
          <input id="ao-month" type="month" class="form-control" style="padding:7px;font-size:0.85rem;">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;">
        <button id="ao-apply-btn" class="btn btn-primary btn-sm">
          <i data-lucide="filter" style="width:14px;height:14px"></i> تطبيق
        </button>
        <button id="ao-reset-btn" class="btn btn-secondary btn-sm">إعادة تعيين</button>
        <span id="ao-count-label" style="font-size:0.82rem;color:var(--text-muted);margin-right:auto;"></span>
      </div>`;

    wrap.appendChild(filterCard);

    /* ── منطقة النتائج ── */
    const listEl = document.createElement('div');
    listEl.id = 'ao-list';
    listEl.innerHTML = `<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);
    wrap.appendChild(listEl);

    const pagerEl = document.createElement('div');
    pagerEl.id = 'ao-pager';
    pagerEl.style.cssText = 'display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:16px;';
    wrap.appendChild(pagerEl);

    container.appendChild(wrap);

    /* ── ربط الأحداث ── */
    filterCard.querySelector('#ao-date-mode').addEventListener('change', e => {
      this._switchDateMode(e.target.value);
    });

    filterCard.querySelector('#ao-apply-btn').addEventListener('click', () => {
      this._page = 1;
      this._load();
    });

    filterCard.querySelector('#ao-reset-btn').addEventListener('click', () => {
      filterCard.querySelector('#ao-type').value      = '';
      filterCard.querySelector('#ao-agent').value     = '';
      filterCard.querySelector('#ao-date-mode').value = 'range';
      filterCard.querySelector('#ao-from').value      = '';
      filterCard.querySelector('#ao-to').value        = getCurrentSaudiDate();
      this._switchDateMode('range');
      this._page = 1;
      this._load();
    });

    if (window.lucide) lucide.createIcons();
    await this._load();
  },

  /* ── تبديل نمط التاريخ ── */
  _switchDateMode(mode) {
    const rangeEl = document.getElementById('ao-date-range');
    const dayEl   = document.getElementById('ao-date-day');
    const monthEl = document.getElementById('ao-date-month');
    if (!rangeEl) return;

    rangeEl.style.display = mode === 'range'  ? 'contents' : 'none';
    if (dayEl)   dayEl.style.display   = mode === 'day'   ? 'block' : 'none';
    if (monthEl) monthEl.style.display = mode === 'month' ? 'block' : 'none';
  },

  /* ── بناء فلاتر الاستعلام ── */
  _buildFilters() {
    const filters = {};
    const type    = document.getElementById('ao-type')?.value;
    const agent   = document.getElementById('ao-agent')?.value;
    const mode    = document.getElementById('ao-date-mode')?.value || 'range';

    if (type)  filters.type     = type;
    if (agent) filters.agent_id = agent;

    if (mode === 'day') {
      const day = document.getElementById('ao-day')?.value;
      if (day) filters.date = day;

    } else if (mode === 'month') {
      const month = document.getElementById('ao-month')?.value;
      if (month) {
        const [y, m] = month.split('-');
        const lastDay = new Date(+y, +m, 0).getDate();
        filters.date = { op: 'between', val: [`${month}-01`, `${month}-${lastDay}`] };
      }

    } else {
      const from = document.getElementById('ao-from')?.value;
      const to   = document.getElementById('ao-to')?.value;
      if (from && to)   filters.date = { op: 'between', val: [from, to] };
      else if (from)    filters.date = { op: 'gte', val: from };
      else if (to)      filters.date = { op: 'lte', val: to };
    }

    return filters;
  },

  /* ── تحميل النتائج ── */
  async _load() {
    const listEl  = document.getElementById('ao-list');
    const pagerEl = document.getElementById('ao-pager');
    const countEl = document.getElementById('ao-count-label');
    if (!listEl) return;

    listEl.innerHTML = `<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);

    const filters = this._buildFilters();
    const result  = await repo.query(TABLES.TRANSACTIONS, filters, {
      orderBy     : 'date',
      ascending   : false,
      page        : this._page,
      pageSize    : this._pageSize,
      forceRefresh: true,
    });

    const data  = isOk(result) ? (result.data.data  || []) : [];
    this._count = isOk(result) ? (result.data.count || 0)  : 0;

    if (countEl) countEl.textContent = `إجمالي النتائج: ${this._count}`;

    if (!data.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">لا توجد عمليات مطابقة للفلاتر</div></div>`;
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }

    const users = AppStore.getState('users');

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>التاريخ</th><th>النوع</th><th>المبلغ</th>
          <th>المندوب</th><th>العميل / الجهة</th><th>الحالة</th>
        </tr></thead>
        <tbody>
          ${data.map(tx => {
            const agent = users.find(u => u.id === tx.agent_id);
            const color = getTransactionColor(tx.type);
            return `<tr ${tx.is_reversed ? 'style="opacity:0.45;"' : ''}>
              <td style="font-size:0.85rem;">${escapeHtml(formatDateArabic(tx.date))}</td>
              <td>
                <span class="badge badge-neutral" style="font-size:0.78rem;">
                  ${getTransactionIcon(tx.type)} ${escapeHtml(TRANSACTION_TYPE_LABELS[tx.type] || tx.type)}
                </span>
              </td>
              <td style="font-weight:700;color:${color};">${formatCurrency(tx.amount)}</td>
              <td style="font-size:0.85rem;">${escapeHtml(agent?.display_name || '—')}</td>
              <td style="font-size:0.85rem;color:var(--text-secondary);">${escapeHtml(tx.customer_name || tx.details || '—')}</td>
              <td>
                ${tx.is_reversed
                  ? '<span class="badge badge-danger">مُعكوس</span>'
                  : tx.sync_status === SYNC_STATUS.PENDING
                    ? '<span class="sync-dot pending" title="معلق مزامنة"></span>'
                    : '<span class="sync-dot synced" title="مزامَن"></span>'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(table);

    /* ── ترقيم الصفحات ── */
    if (pagerEl) {
      pagerEl.innerHTML = '';
      const pages = Math.ceil(this._count / this._pageSize);
      if (pages > 1) {
        for (let p = 1; p <= Math.min(pages, 15); p++) {
          const pbtn = document.createElement('button');
          pbtn.className = p === this._page ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
          pbtn.textContent = p;
          pbtn.style.minWidth = '36px';
          pbtn.addEventListener('click', () => { this._page = p; this._load(); });
          pagerEl.appendChild(pbtn);
        }
        if (pages > 15) {
          const more = document.createElement('span');
          more.style.cssText = 'align-self:center;font-size:0.8rem;color:var(--text-muted);';
          more.textContent = `... ${pages} صفحة`;
          pagerEl.appendChild(more);
        }
      }
    }

    if (window.lucide) lucide.createIcons();
  },
};

window.AllOperationsComponent = AllOperationsComponent;
console.log('✅ AllOperationsComponent.js محمّل');
