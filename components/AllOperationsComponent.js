/**
 * components/AllOperationsComponent.js — v2.0
 * إصلاحات:
 * 1. استخدام transactions_detailed view لعرض اسم المندوب والمنفذ
 * 2. عرض بيانات مفهومة: العميل / البنك / الشركة / نوع المصروف
 * 3. فلتر حسب المندوب
 * 4. عرض اسم المنفذ الفعلي (executed_by)
 * 5. تحسين بصري للجدول
 */
'use strict';

const AllOperationsComponent = {
  _page       : 1,
  _pageSize   : 20,
  _count      : 0,
  _ops        : [],
  _detailedMap: {},

  async render(container) {
    this._injectStyles();
    container.innerHTML = '';
    const wrap = document.createElement('div');

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);margin-bottom:16px;';
    title.textContent = '📋 جميع العمليات';
    wrap.appendChild(title);

    const users  = AppStore.getState('users') || [];
    const agents = users.filter(u=>u.role==='agent'&&u.is_active);

    // لوحة الفلاتر
    const filterCard = document.createElement('div');
    filterCard.className = 'glass-card';
    filterCard.style.marginBottom = '16px';
    filterCard.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">نوع العملية</label>
          <select id="ao-type" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الكل</option>
            ${Object.entries(TRANSACTION_TYPE_LABELS).map(([v,l])=>
              `<option value="${v}">${l}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">المندوب</label>
          <select id="ao-agent" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الجميع</option>
            ${agents.map(u=>`<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">نمط التاريخ</label>
          <select id="ao-date-mode" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="day">يوم محدد</option>
            <option value="range">فترة من–إلى</option>
            <option value="month">شهر محدد</option>
          </select>
        </div>
        <div id="ao-date-day" class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">اليوم</label>
          <input id="ao-day" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
            value="${getCurrentSaudiDate()}">
        </div>
        <div id="ao-date-from" class="form-group" style="margin:0;display:none;">
          <label class="form-label" style="font-size:0.78rem;">من</label>
          <input id="ao-from" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
        </div>
        <div id="ao-date-to" class="form-group" style="margin:0;display:none;">
          <label class="form-label" style="font-size:0.78rem;">إلى</label>
          <input id="ao-to" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
            value="${getCurrentSaudiDate()}">
        </div>
        <div id="ao-date-month-wrap" class="form-group" style="margin:0;display:none;">
          <label class="form-label" style="font-size:0.78rem;">الشهر</label>
          <input id="ao-month" type="month" class="form-control" style="padding:7px;font-size:0.85rem;">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button id="ao-apply-btn" class="btn btn-primary btn-sm">
          <i data-lucide="filter" style="width:14px;height:14px"></i> تطبيق
        </button>
        <button id="ao-reset-btn" class="btn btn-secondary btn-sm">إعادة تعيين</button>
        <button id="ao-export-btn" class="btn btn-secondary btn-sm">
          <i data-lucide="table-2" style="width:14px;height:14px"></i> Excel
        </button>
        <span id="ao-count-label" style="font-size:0.82rem;color:var(--text-muted);margin-right:auto;"></span>
      </div>`;
    wrap.appendChild(filterCard);

    const listEl = document.createElement('div');
    listEl.id = 'ao-list';
    listEl.innerHTML = `<div class="skeleton" style="height:52px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);
    wrap.appendChild(listEl);

    const pagerEl = document.createElement('div');
    pagerEl.id = 'ao-pager';
    pagerEl.style.cssText = 'display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:16px;';
    wrap.appendChild(pagerEl);

    container.appendChild(wrap);

    // ربط الأحداث
    filterCard.querySelector('#ao-date-mode').addEventListener('change',e=>this._switchDateMode(e.target.value));
    filterCard.querySelector('#ao-apply-btn').addEventListener('click',()=>{ this._page=1; this._load(); });
    filterCard.querySelector('#ao-export-btn').addEventListener('click',()=>this._exportOperationsExcel());
    filterCard.querySelector('#ao-reset-btn').addEventListener('click',()=>{
      filterCard.querySelector('#ao-type').value     = '';
      filterCard.querySelector('#ao-agent').value    = '';
      filterCard.querySelector('#ao-date-mode').value= 'day';
      filterCard.querySelector('#ao-day').value      = getCurrentSaudiDate();
      this._switchDateMode('day');
      this._page=1; this._load();
    });

    if (window.lucide) lucide.createIcons();
    await this._load();
  },

  _switchDateMode(mode) {
    document.getElementById('ao-date-day').style.display         = mode==='day'   ?'block':'none';
    document.getElementById('ao-date-from').style.display        = mode==='range' ?'block':'none';
    document.getElementById('ao-date-to').style.display          = mode==='range' ?'block':'none';
    document.getElementById('ao-date-month-wrap').style.display  = mode==='month' ?'block':'none';
  },

  _buildFilters() {
    const filters = {};
    const type    = document.getElementById('ao-type')?.value;
    const agent   = document.getElementById('ao-agent')?.value;
    const mode    = document.getElementById('ao-date-mode')?.value||'day';

    if (type)  filters.type     = type;
    if (agent) filters.agent_id = agent;

    if (mode==='day') {
      const day = document.getElementById('ao-day')?.value;
      if (day) filters.date = day;
    } else if (mode==='month') {
      const month = document.getElementById('ao-month')?.value;
      if (month) {
        const [y,m] = month.split('-');
        const lastDay = new Date(+y,+m,0).getDate();
        filters.date = { op:'between', val:[`${month}-01`,`${month}-${lastDay}`] };
      }
    } else {
      const from = document.getElementById('ao-from')?.value;
      const to   = document.getElementById('ao-to')?.value;
      if (from&&to) filters.date={op:'between',val:[from,to]};
      else if (from) filters.date={op:'gte',val:from};
      else if (to)   filters.date={op:'lte',val:to};
    }

    return filters;
  },

  async _load() {
    const listEl  = document.getElementById('ao-list');
    const pagerEl = document.getElementById('ao-pager');
    const countEl = document.getElementById('ao-count-label');
    if (!listEl) return;

    listEl.innerHTML = `<div class="skeleton" style="height:52px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);

    const filters = this._buildFilters();
    const result  = await repo.query(TABLES.TRANSACTIONS, filters, {
      orderBy     : 'date',
      ascending   : false,
      page        : this._page,
      pageSize    : this._pageSize,
      forceRefresh: true,
    });

    const data  = isOk(result) ? (result.data.data||[])  : [];
    this._count = isOk(result) ? (result.data.count||0) : 0;
    this._ops   = data;

    if (countEl) countEl.textContent = `${this._count} عملية`;

    if (!data.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div class="empty-state-text">لا توجد عمليات مطابقة</div></div>`;
      if (pagerEl) pagerEl.innerHTML='';
      return;
    }

    // جلب بيانات مرتبطة
    const users        = AppStore.getState('users');
    const bankAccounts = AppStore.getState('bankAccounts');
    const companies    = AppStore.getState('companies');

    // للمدير: محاولة جلب بيانات من transactions_detailed عبر Supabase
    let detailedMap = {};
    if (isOnline() && AuthService.isAdmin()) {
      try {
        const ids = data.map(t=>t.id);
        const { data: detailed } = await supabaseClient
          .from('transactions_detailed')
          .select('id,agent_name,executed_by_name,bank_account_name,bank_company_name,company_name,debtor_name,expense_account_name,customer_name')
          .in('id', ids);
        (detailed||[]).forEach(d=>{ detailedMap[d.id]=d; });
      } catch (e) { console.warn('⚠️ AllOperations: تفاصيل العمليات غير متاحة:', e.message); }
    }

    this._detailedMap = detailedMap;
    const currentRole = AuthService.getCurrentUser()?.role;
    const currentUid  = AuthService.getCurrentUserId();
    const canEdit     = currentRole === 'admin' || currentRole === 'admin_assistant';
    const canDelete   = currentRole === 'admin';

    const typeIcons = {
      collection:'💰', deposit:'🏦', expense:'💸',
      receipt:'📥', delivery:'📤', refund_settlement:'🔄'
    };

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>التاريخ والوقت</th>
          <th>النوع</th>
          <th>المبلغ</th>
          <th>المندوب</th>
          <th>التفاصيل</th>
          <th>الحالة</th>
          <th>الإجراءات</th>
        </tr></thead>
        <tbody>
          ${data.map(tx=>{
            const det    = detailedMap[tx.id] || {};
            const agent  = det.agent_name || users.find(u=>u.id===tx.agent_id)?.display_name || '—';
            const execBy = det.executed_by_name || null;
            const color  = getTransactionColor(tx.type);
            const icon   = typeIcons[tx.type]||'📋';
            const amt    = Math.round(parseFloat(tx.amount)||0);
            const label  = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;

            // التفاصيل حسب نوع العملية
            let details = '';
            if (tx.type==='collection' || tx.type==='refund_settlement') {
              const cust = det.debtor_name||tx.customer_name||'—';
              const comp = det.company_name||companies.find(c=>c.id===tx.company_id)?.name||'';
              details = `<div style="font-weight:600;font-size:0.82rem;">${escapeHtml(cust)}</div>
                ${comp?`<div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(comp)}</div>`:''}`;
            } else if (tx.type==='deposit') {
              const bank = det.bank_account_name||bankAccounts.find(b=>b.id===tx.bank_account_id)?.name||'—';
              const co   = det.bank_company_name||'';
              details = `<div style="font-weight:600;font-size:0.82rem;">${escapeHtml(bank)}</div>
                ${co?`<div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(co)}</div>`:''}`;
            } else if (tx.type==='expense') {
              const expName = det.expense_account_name||tx.expense_type||'—';
              const expDet  = tx.details||'';
              details = `<div style="font-weight:600;font-size:0.82rem;">${escapeHtml(expName)}</div>
                ${expDet?`<div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(expDet)}</div>`:''}`;
            } else if (tx.type==='receipt'||tx.type==='delivery') {
              const comp = det.company_name||companies.find(c=>c.id===tx.company_id)?.name||'—';
              details = `<div style="font-size:0.82rem;">${escapeHtml(comp)}</div>`;
            } else {
              details = `<div style="font-size:0.82rem;color:var(--text-muted);">${escapeHtml(tx.details||'—')}</div>`;
            }

            const timeStr     = tx.time ? tx.time.substring(0,5) : '';
            const showActions = currentRole === 'agent' ? tx.agent_id === currentUid : true;

            return `<tr ${tx.is_reversed?'class="tx-reversed"':''}>
              <td style="white-space:nowrap;">
                <div style="font-size:0.82rem;">${escapeHtml(formatDateArabic(tx.date))}</div>
                ${timeStr?`<div style="font-size:0.72rem;color:var(--text-muted);direction:ltr;">${timeStr}</div>`:''}
              </td>
              <td>
                <span class="badge badge-neutral" style="font-size:0.78rem;white-space:nowrap;">
                  ${icon} ${escapeHtml(label)}
                </span>
              </td>
              <td style="font-weight:800;color:${color};direction:ltr;white-space:nowrap;">
                ${amt.toLocaleString('en-US')}
                <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);">${APP_CONFIG.CURRENCY_SYMBOL}</span>
              </td>
              <td>
                <div style="font-size:0.84rem;font-weight:600;">${escapeHtml(agent)}</div>
                ${execBy&&execBy!==agent?`<div style="font-size:0.72rem;color:var(--text-muted);">نفّذه: ${escapeHtml(execBy)}</div>`:''}
              </td>
              <td>${details}</td>
              <td>
                ${tx.is_reversed
                  ? '<span class="badge badge-danger" style="font-size:0.72rem;">مُعكوس</span>'
                  : tx.sync_status===SYNC_STATUS.PENDING
                    ? '<span class="sync-dot pending" title="معلق مزامنة" style="width:10px;height:10px;"></span>'
                    : '<span class="sync-dot synced" title="مزامَن" style="width:10px;height:10px;"></span>'}
              </td>
              <td style="white-space:nowrap;">
                ${showActions ? `
                  <button class="ao-action-btn ao-action-btn--view" data-tx-id="${tx.id}" data-action="view" title="عرض التفاصيل">👁️</button>
                  ${canEdit && !tx.is_reversed ? `<button class="ao-action-btn ao-action-btn--edit" data-tx-id="${tx.id}" data-action="edit" title="تعديل">✏️</button>` : ''}
                  ${canDelete && !tx.is_reversed ? `<button class="ao-action-btn ao-action-btn--delete" data-tx-id="${tx.id}" data-action="delete" title="حذف">🗑️</button>` : ''}
                ` : '—'}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML='';
    listEl.appendChild(table);

    table.querySelector('table').addEventListener('click', e => {
      const btn = e.target.closest('.ao-action-btn');
      if (!btn) return;
      const txId = btn.dataset.txId;
      const tx   = this._ops.find(t => t.id === txId);
      if (!tx) return;
      const action = btn.dataset.action;
      if (action === 'view')        this._openOperationDetails(tx);
      else if (action === 'edit')   this._openEditModal(tx);
      else if (action === 'delete') this._handleDelete(tx);
    });

    // ترقيم الصفحات
    if (pagerEl) {
      pagerEl.innerHTML='';
      const pages = Math.ceil(this._count/this._pageSize);
      if (pages>1) {
        // زر السابق
        if (this._page>1) {
          const prev = document.createElement('button');
          prev.className='btn btn-secondary btn-sm';
          prev.textContent='← السابق';
          prev.addEventListener('click',()=>{ this._page--; this._load(); });
          pagerEl.appendChild(prev);
        }
        for (let p=Math.max(1,this._page-2);p<=Math.min(pages,this._page+2);p++) {
          const pbtn=document.createElement('button');
          pbtn.className=p===this._page?'btn btn-primary btn-sm':'btn btn-secondary btn-sm';
          pbtn.textContent=p;
          pbtn.style.minWidth='36px';
          pbtn.addEventListener('click',()=>{ this._page=p; this._load(); });
          pagerEl.appendChild(pbtn);
        }
        // زر التالي
        if (this._page<pages) {
          const next=document.createElement('button');
          next.className='btn btn-secondary btn-sm';
          next.textContent='التالي →';
          next.addEventListener('click',()=>{ this._page++; this._load(); });
          pagerEl.appendChild(next);
        }
        const info=document.createElement('span');
        info.style.cssText='align-self:center;font-size:0.78rem;color:var(--text-muted);';
        info.textContent=`صفحة ${this._page} من ${pages}`;
        pagerEl.appendChild(info);
      }
    }

    if (window.lucide) lucide.createIcons();
  },

  async _exportOperationsExcel() {
    const exportBtn = document.getElementById('ao-export-btn');
    if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = '⏳ ...'; }
    try {
      const filters = this._buildFilters();
      const result  = await repo.query(TABLES.TRANSACTIONS, filters, {
        orderBy: 'date', ascending: false, pageSize: 5000, forceRefresh: true,
      });
      const data  = isOk(result) ? (result.data.data || []) : [];
      const users = AppStore.getState('users');

      const headers = ['التاريخ', 'الوقت', 'النوع', 'المبلغ (ر.س)', 'المندوب', 'التفاصيل', 'الحالة'];
      const rows = data.map(tx => [
        tx.date || '—',
        tx.time ? tx.time.substring(0, 5) : '—',
        TRANSACTION_TYPE_LABELS[tx.type] || tx.type,
        Math.round(parseFloat(tx.amount || 0)),
        users.find(u => u.id === tx.agent_id)?.display_name || '—',
        tx.customer_name || tx.details || '—',
        tx.is_reversed ? 'مُعكوس' : 'نشط',
      ]);

      const dateLabel = (typeof filters.date === 'string' ? filters.date : null) || getCurrentSaudiDate();
      await PrintService.exportToExcel(headers, rows, 'العمليات', `operations_${dateLabel}`);
    } catch (e) {
      showToast(`❌ فشل التصدير: ${e.message}`, 'error');
    } finally {
      if (exportBtn) {
        exportBtn.disabled = false;
        exportBtn.innerHTML = '<i data-lucide="table-2" style="width:14px;height:14px"></i> Excel';
        if (window.lucide) lucide.createIcons();
      }
    }
  },

  _injectStyles() {
    if (document.getElementById('ao-action-btn-styles')) return;
    const style = document.createElement('style');
    style.id = 'ao-action-btn-styles';
    style.textContent = `
      .ao-action-btn{padding:4px 8px;margin:0 2px;border:none;border-radius:4px;cursor:pointer;font-size:0.875rem;transition:transform 0.1s;}
      .ao-action-btn--view{background:#e3f2fd;color:#1976d2;}
      .ao-action-btn--edit{background:#fff3e0;color:#f57c00;}
      .ao-action-btn--delete{background:#ffebee;color:#d32f2f;}
      .ao-action-btn:hover{transform:scale(1.1);}
      .ao-action-btn:disabled{opacity:0.5;cursor:not-allowed;}
    `;
    document.head.appendChild(style);
  },

  _openOperationDetails(tx) {
    const det    = this._detailedMap[tx.id] || {};
    const users  = AppStore.getState('users');
    const agent  = det.agent_name || users.find(u => u.id === tx.agent_id)?.display_name || '—';
    const execBy = det.executed_by_name || null;
    const label  = TRANSACTION_TYPE_LABELS[tx.type] || tx.type;
    const amt    = Math.round(parseFloat(tx.amount) || 0).toLocaleString('en-US');

    let counterparty = '—';
    if (tx.type === 'collection' || tx.type === 'refund_settlement') {
      counterparty = det.debtor_name || tx.customer_name || '—';
    } else if (tx.type === 'deposit' || tx.type === 'bank_withdrawal') {
      counterparty = det.bank_account_name || '—';
    } else if (tx.type === 'expense') {
      counterparty = det.expense_account_name || tx.expense_type || '—';
    } else if (tx.type === 'receipt' || tx.type === 'delivery') {
      counterparty = det.company_name || '—';
    }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:9999;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '460px';
    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">🔍 تفاصيل العملية</h3>
        <button class="modal-close" id="ao-detail-close-x">✕</button>
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:0.88rem;direction:rtl;">
        <tr><td style="padding:7px 4px;color:var(--text-muted);width:40%;">رقم العملية</td><td style="padding:7px 4px;font-family:monospace;font-size:0.72rem;word-break:break-all;">${escapeHtml(tx.id)}</td></tr>
        <tr style="background:var(--bg-input);"><td style="padding:7px 4px;color:var(--text-muted);">النوع</td><td style="padding:7px 4px;">${escapeHtml(label)}</td></tr>
        <tr><td style="padding:7px 4px;color:var(--text-muted);">المبلغ</td><td style="padding:7px 4px;font-weight:700;">${amt} ${escapeHtml(APP_CONFIG.CURRENCY_SYMBOL)}</td></tr>
        <tr style="background:var(--bg-input);"><td style="padding:7px 4px;color:var(--text-muted);">التاريخ</td><td style="padding:7px 4px;">${escapeHtml(tx.date || '—')}</td></tr>
        <tr><td style="padding:7px 4px;color:var(--text-muted);">الوقت</td><td style="padding:7px 4px;">${escapeHtml(tx.time ? tx.time.substring(0,5) : '—')}</td></tr>
        <tr style="background:var(--bg-input);"><td style="padding:7px 4px;color:var(--text-muted);">المندوب</td><td style="padding:7px 4px;">${escapeHtml(agent)}</td></tr>
        ${execBy && execBy !== agent ? `<tr><td style="padding:7px 4px;color:var(--text-muted);">المنفذ</td><td style="padding:7px 4px;">${escapeHtml(execBy)}</td></tr>` : ''}
        <tr><td style="padding:7px 4px;color:var(--text-muted);">الطرف الآخر</td><td style="padding:7px 4px;">${escapeHtml(counterparty)}</td></tr>
        ${tx.details ? `<tr style="background:var(--bg-input);"><td style="padding:7px 4px;color:var(--text-muted);">ملاحظات</td><td style="padding:7px 4px;">${escapeHtml(tx.details)}</td></tr>` : ''}
        <tr style="background:var(--bg-input);"><td style="padding:7px 4px;color:var(--text-muted);">الحالة</td><td style="padding:7px 4px;">${tx.is_reversed ? '<span style="color:#d32f2f;">مُعكوس</span>' : escapeHtml(tx.approval_status || '—')}</td></tr>
      </table>
      <div style="margin-top:16px;text-align:center;">
        <button class="btn btn-secondary" id="ao-detail-close-btn">إغلاق</button>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector('#ao-detail-close-x').addEventListener('click', () => overlay.remove());
    box.querySelector('#ao-detail-close-btn').addEventListener('click', () => overlay.remove());
  },

  _openEditModal(tx) {
    if (tx.is_reversed) { showToast('لا يمكن تعديل عملية مُعكوسة', 'error'); return; }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:9999;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '380px';
    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">✏️ تعديل العملية</h3>
        <button class="modal-close" id="ao-edit-close-x">✕</button>
      </div>
      <div class="form-group">
        <label class="form-label">المبلغ</label>
        <input id="ao-edit-amount" type="number" class="form-control" value="${parseFloat(tx.amount)||0}" min="0" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">التاريخ</label>
        <input id="ao-edit-date" type="date" class="form-control" value="${escapeHtml(tx.date||'')}">
      </div>
      <div class="form-group">
        <label class="form-label">ملاحظات</label>
        <textarea id="ao-edit-details" class="form-control" rows="2">${escapeHtml(tx.details||'')}</textarea>
      </div>
      <div style="display:flex;gap:8px;margin-top:8px;">
        <button class="btn btn-primary" style="flex:1;" id="ao-edit-save">💾 حفظ التعديلات</button>
        <button class="btn btn-secondary" id="ao-edit-cancel">إلغاء</button>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#ao-edit-close-x').addEventListener('click', () => overlay.remove());
    box.querySelector('#ao-edit-cancel').addEventListener('click', () => overlay.remove());
    box.querySelector('#ao-edit-save').addEventListener('click', async () => {
      const amount  = parseFloat(box.querySelector('#ao-edit-amount').value);
      const date    = box.querySelector('#ao-edit-date').value.trim();
      const details = box.querySelector('#ao-edit-details').value.trim();

      if (!isValidAmount(amount)) { showToast('المبلغ غير صالح', 'error'); return; }
      if (!date) { showToast('التاريخ مطلوب', 'error'); return; }

      const saveBtn = box.querySelector('#ao-edit-save');
      saveBtn.disabled = true;
      saveBtn.textContent = '⏳ جارٍ الحفظ...';

      const result = await repo.update(TABLES.TRANSACTIONS, tx.id, { amount, date, details: details || null });
      if (isOk(result)) {
        showToast('✅ تم حفظ التعديلات', 'success');
        overlay.remove();
        await this._load();
      } else {
        saveBtn.disabled = false;
        saveBtn.textContent = '💾 حفظ التعديلات';
        showToast(`❌ ${result.error}`, 'error');
      }
    });
  },

  async _handleDelete(tx) {
    if (tx.is_reversed) { showToast('لا يمكن حذف عملية مُعكوسة', 'error'); return; }

    const confirmed = await confirmDialog(
      `هل أنت متأكد من حذف هذه العملية؟\nالنوع: ${TRANSACTION_TYPE_LABELS[tx.type] || tx.type}\nالمبلغ: ${Math.round(parseFloat(tx.amount)||0).toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}\n\nلا يمكن التراجع عن هذا الإجراء.`,
      'حذف', 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    const result = await repo.delete(TABLES.TRANSACTIONS, tx.id);
    if (isOk(result)) {
      showToast('✅ تم حذف العملية', 'success');
      await this._load();
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },
};

window.AllOperationsComponent = AllOperationsComponent;
console.log('✅ AllOperationsComponent v2.0 محمّل — مع بيانات مفهومة وكاملة');
