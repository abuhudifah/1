/**
 * components/AllOperationsComponent.js — v3.1
 *
 * v3.0 — استعلام موحّد (Single-Query Architecture)
 * v3.1 — Keyset Pagination (بدل OFFSET):
 * ─────────────────────────────────────────────────────────
 * OFFSET يتدهور عند 50k+ سجل (full table scan).
 * Keyset: WHERE (date, created_at) < (cursor) → O(log n) دائماً.
 *
 * _cursors[]: stack من المؤشرات — يتيح السابق/التالي بدون إعادة حساب.
 * العدد الكلي يُحسب مرة واحدة (الصفحة الأولى) ويُحفظ في _count.
 * Fallback (Offline): يبقى OFFSET عبر repo.query (بيانات محلية محدودة).
 */
'use strict';

// الأعمدة المطلوبة من transactions_detailed — تُحدَّد هنا مرة واحدة
// created_at مطلوب لـ Keyset Pagination كمفتاح ثانوي للترتيب
const _DETAIL_COLS = [
  'id','date','time','created_at','type','amount','details',
  'agent_id','agent_name',
  'executed_by_name',
  'customer_name',
  'company_id','company_name',
  'bank_account_id','bank_account_name','bank_company_name',
  'expense_type','expense_account_name',
  'debtor_name',
  'from_agent_id','to_agent_id',
  'is_reversed','sync_status',
].join(',');

const AllOperationsComponent = {
  _pageSize   : 20,
  _count      : 0,       // العدد الكلي — يُحسب مرة واحدة (الصفحة الأولى)
  _cursors    : [null],  // stack: null = الصفحة الأولى، cursor = { date, created_at }
  _cursorIdx  : 0,       // موضعنا الحالي في الـ stack
  _hasNext    : false,
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

    const users    = AppStore.getState('users') || [];
    // جميع المستخدمين النشطين بجميع الأدوار (مناديب + مديرون + مساعدون)
    const allUsers = users.filter(u => u.is_active).sort((a, b) => {
      const order = { agent: 0, admin_assistant: 1, admin: 2 };
      const oa = order[a.role] ?? 3, ob = order[b.role] ?? 3;
      if (oa !== ob) return oa - ob;
      return (a.display_name || '').localeCompare(b.display_name || '', 'ar');
    });

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
          <label class="form-label" style="font-size:0.78rem;">المستخدم</label>
          <select id="ao-agent" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الجميع</option>
            ${allUsers.map(u => {
              const suffix = u.role === 'admin' ? ' (مدير)' : u.role === 'admin_assistant' ? ' (مساعد)' : '';
              return `<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name)}${suffix}</option>`;
            }).join('')}
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

    const totalsEl = document.createElement('div');
    totalsEl.id = 'ao-totals';
    totalsEl.innerHTML = `<div class="ao-totals-grid">${[1,2,3,4].map(()=>'<div class="skeleton" style="height:76px;border-radius:14px;"></div>').join('')}</div>`;
    wrap.appendChild(totalsEl);

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
    filterCard.querySelector('#ao-apply-btn').addEventListener('click',()=>{ this._resetPagination(); this._load(); });
    filterCard.querySelector('#ao-export-btn').addEventListener('click',()=>this._exportOperationsExcel());
    filterCard.querySelector('#ao-reset-btn').addEventListener('click',()=>{
      filterCard.querySelector('#ao-type').value     = '';
      filterCard.querySelector('#ao-agent').value    = '';
      filterCard.querySelector('#ao-date-mode').value= 'day';
      filterCard.querySelector('#ao-day').value      = getCurrentSaudiDate();
      this._switchDateMode('day');
      this._resetPagination(); this._load();
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

  // ==========================================================
  // _queryDetailedView — Keyset Pagination على transactions_detailed
  //
  // cursor = null        → الصفحة الأولى + count:exact
  // cursor = {date, created_at} → الصفحات التالية بدون count (أسرع)
  //
  // يجلب pageSize+1 سجلاً لاكتشاف وجود صفحة تالية (_hasNext).
  // ==========================================================
  async _queryDetailedView(filters, pageSize, cursor = null) {
    const needCount = cursor === null;
    let q = supabaseClient
      .from('transactions_detailed')
      .select(_DETAIL_COLS, { count: needCount ? 'exact' : 'none' })
      .order('date',       { ascending: false })
      .order('created_at', { ascending: false })
      .limit(pageSize + 1); // +1 لاكتشاف hasNext

    // ── Keyset filter (الصفحات 2+) ──
    // WHERE date < cursor.date OR (date = cursor.date AND created_at < cursor.created_at)
    if (cursor) {
      q = q.or(
        `date.lt.${cursor.date},and(date.eq.${cursor.date},created_at.lt.${cursor.created_at})`
      );
    }

    // ── فلاتر المستخدم ──
    if (filters.type)     q = q.eq('type',     filters.type);
    if (filters.agent_id) q = q.eq('agent_id', filters.agent_id);

    if (filters.date) {
      if (typeof filters.date === 'string') {
        q = q.eq('date', filters.date);
      } else if (filters.date.op === 'between') {
        q = q.gte('date', filters.date.val[0]).lte('date', filters.date.val[1]);
      } else if (filters.date.op === 'gte') {
        q = q.gte('date', filters.date.val);
      } else if (filters.date.op === 'lte') {
        q = q.lte('date', filters.date.val);
      }
    }

    // المندوب: يرى عملياته فقط
    const currentUser = AuthService.getCurrentUser();
    if (currentUser?.role === ROLES.AGENT) {
      q = q.eq('agent_id', currentUser.id);
    }

    const { data, error, count } = await q;
    if (error) throw new Error(error.message);

    const rows    = data || [];
    const hasNext = rows.length > pageSize;
    if (hasNext) rows.pop(); // أزل السجل الاستكشافي الزائد

    return { data: rows, count: count ?? null, hasNext };
  },

  // إعادة تعيين حالة الصفحات عند تغيير الفلاتر
  _resetPagination() {
    this._cursors   = [null];
    this._cursorIdx = 0;
    this._hasNext   = false;
    this._count     = 0;
  },

  // ==========================================================
  // _load — Keyset Pagination (v3.1)
  // ==========================================================
  async _load() {
    const listEl  = document.getElementById('ao-list');
    const pagerEl = document.getElementById('ao-pager');
    const countEl = document.getElementById('ao-count-label');
    if (!listEl) return;

    listEl.innerHTML = `<div class="skeleton" style="height:52px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);

    const totalsEl = document.getElementById('ao-totals');
    if (totalsEl) {
      totalsEl.innerHTML = `<div class="ao-totals-grid">${[1,2,3,4].map(()=>'<div class="skeleton" style="height:76px;border-radius:14px;"></div>').join('')}</div>`;
    }

    const filters  = this._buildFilters();

    // جلب الإجماليات بالتوازي مع بيانات الصفحة
    this._fetchTotals(filters).then(t => this._renderTotals(t)).catch(() => {});

    const cursor   = this._cursors[this._cursorIdx]; // null = صفحة 1
    let   data     = [];
    let   useLocal = false;

    if (!isOfflineMode() && isOnline()) {
      // ── المسار الأمثل: Keyset على transactions_detailed ──
      try {
        const res = await this._queryDetailedView(filters, this._pageSize, cursor);
        data           = res.data;
        this._hasNext  = res.hasNext;
        // العدد الكلي: احفظه من الصفحة الأولى فقط (لا تُصفّره في الصفحات التالية)
        if (res.count !== null) this._count = res.count;
        this._ops      = data;
        this._detailedMap = Object.fromEntries(data.map(r => [r.id, r]));
      } catch (e) {
        console.warn('⚠️ AllOperations: transactions_detailed غير متاحة، fallback:', e.message);
        useLocal = true;
      }
    } else {
      useLocal = true;
    }

    // ── مسار الـ Fallback (Offline أو فشل الـ view) — OFFSET مقبول لبيانات محلية ──
    if (useLocal) {
      const result = await repo.query(TABLES.TRANSACTIONS, filters, {
        orderBy  : 'date',
        ascending: false,
        page     : this._cursorIdx + 1,
        pageSize : this._pageSize,
      });
      data          = isOk(result) ? (result.data.data  || []) : [];
      this._count   = isOk(result) ? (result.data.count || 0)  : 0;
      this._hasNext = data.length === this._pageSize;
      this._ops     = data;
      this._detailedMap = {};
    }

    if (countEl) countEl.textContent = `${this._count} عملية`;

    if (!data.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="search-x" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
        <div class="empty-state-text">لا توجد عمليات مطابقة</div></div>`;
      if (pagerEl) pagerEl.innerHTML='';
      return;
    }

    // بيانات المستخدمين والبنوك — دائماً من AppStore لضمان تسمية الأطراف
    const users        = AppStore.getState('users')        || [];
    const bankAccounts = AppStore.getState('bankAccounts') || [];
    const companies    = AppStore.getState('companies')    || [];
    const usersMap     = new Map(users.map(u => [u.id, u.display_name]));

    this._detailedMap = this._detailedMap || {};
    const currentRole = AuthService.getCurrentUser()?.role;
    const currentUid  = AuthService.getCurrentUserId();
    const canEdit     = currentRole === 'admin' || currentRole === 'admin_assistant';
    const canDelete   = currentRole === 'admin';

    const typeIcons = {
      collection:'💰', deposit:'🏦', bank_withdrawal:'💳', expense:'💸',
      receipt:'📥', delivery:'📤', refund_settlement:'↩️',
      failed_deposit_refund:'🔃', journal_entry:'📒',
    };

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>التاريخ والوقت</th>
          <th>النوع</th>
          <th>المبلغ</th>
          <th>التفاصيل</th>
          <th>الحالة</th>
          <th>الإجراءات</th>
        </tr></thead>
        <tbody>
          ${data.map(tx=>{
            const det    = this._detailedMap[tx.id] || {};
            const agentName = det.agent_name || usersMap.get(tx.agent_id) || '—';
            const execBy    = det.executed_by_name;
            const color  = getTransactionColor(tx.type);
            const icon   = typeIcons[tx.type]||'📋';
            const amt    = Math.round(parseFloat(tx.amount)||0);
            const label  = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
            const timeStr= tx.time ? tx.time.substring(0,5) : '';

            // ── بناء خلية التفاصيل بمنظور محايد (المدير لا طرف دائن/مدين) ──
            const _line = (html) => `<div style="font-size:0.82rem;line-height:1.55;">${html}</div>`;
            const _muted = (t) => `<span style="color:var(--text-muted);font-size:0.75rem;">${escapeHtml(t)}</span>`;
            const _bold  = (t) => `<b>${escapeHtml(t)}</b>`;

            let details = '';
            if (tx.type==='delivery') {
              const toName = usersMap.get(tx.to_agent_id) || '—';
              details = _line(`من حساب: ${_bold(agentName)}`) +
                        _line(`إلى حساب: ${_bold(toName)}`);
            } else if (tx.type==='receipt') {
              const fromName = usersMap.get(tx.from_agent_id) || agentName;
              details = _line(`من حساب: ${_bold(fromName)}`) +
                        _line(`إلى حساب: ${_bold(agentName)}`);
            } else if (tx.type==='deposit') {
              const bank = det.bank_account_name || bankAccounts.find(b=>b.id===tx.bank_account_id)?.name || '—';
              const co   = det.bank_company_name || '';
              details = _line(`من حساب: ${_bold(agentName)}`) +
                        _line(`إلى بنك: ${_bold(bank)}${co?' '+_muted(`(${co})`):''}`)
            } else if (tx.type==='bank_withdrawal') {
              const bank = det.bank_account_name || bankAccounts.find(b=>b.id===tx.bank_account_id)?.name || '—';
              const co   = det.bank_company_name || '';
              details = _line(`من بنك: ${_bold(bank)}${co?' '+_muted(`(${co})`):''}`) +
                        _line(`إلى حساب: ${_bold(agentName)}`);
            } else if (tx.type==='collection' || tx.type==='refund_settlement') {
              const cust = det.debtor_name || tx.customer_name || '—';
              const comp = det.company_name || companies.find(c=>c.id===tx.company_id)?.name || '';
              details = _line(`المنفذ: ${_bold(agentName)}`) +
                        _line(`العميل: ${_bold(cust)}${comp?' | الشركة: '+_muted(comp):''}`)
            } else if (tx.type==='expense') {
              const expName = det.expense_account_name || tx.expense_type || '—';
              details = _line(`المنفذ: ${_bold(agentName)}`) +
                        _line(`المصروف: ${_bold(expName)}`);
            } else {
              details = _line(`المنفذ: ${_bold(agentName)}`);
            }

            // إضافة سطر المنفذ إن اختلف + ملاحظات
            if (execBy && execBy !== agentName)
              details += _line(`نفّذه: ${_muted(execBy)}`);
            if (tx.details)
              details += _line(_muted(tx.details));

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
              <td>${details}</td>
              <td>
                ${tx.is_reversed
                  ? '<span class="badge badge-danger" style="font-size:0.72rem;">مُعكوس</span>'
                  : tx.sync_status===SYNC_STATUS.PENDING && tx.error_message
                    ? '<span style="font-size:0.72rem;color:var(--danger);font-weight:700;" title="فشل المزامنة — سيُعاد المحاولة تلقائياً">❌ فشل</span>'
                    : tx.sync_status===SYNC_STATUS.PENDING
                      ? '<span class="sync-dot pending" title="معلق مزامنة" style="width:10px;height:10px;"></span>'
                      : '<span class="sync-dot synced" title="مزامَن" style="width:10px;height:10px;"></span>'}
              </td>
              <td style="white-space:nowrap;">
                ${showActions ? `
                  <button class="ao-action-btn ao-action-btn--view" data-tx-id="${tx.id}" data-action="view" title="عرض التفاصيل"><i data-lucide="eye" style="width:14px;height:14px;pointer-events:none;"></i></button>
                  ${canEdit && !tx.is_reversed ? `<button class="ao-action-btn ao-action-btn--edit" data-tx-id="${tx.id}" data-action="edit" title="تعديل"><i data-lucide="pencil" style="width:14px;height:14px;pointer-events:none;"></i></button>` : ''}
                  ${canDelete && !tx.is_reversed ? `<button class="ao-action-btn ao-action-btn--delete" data-tx-id="${tx.id}" data-action="delete" title="حذف"><i data-lucide="trash-2" style="width:14px;height:14px;pointer-events:none;"></i></button>` : ''}
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

    // ── ترقيم الصفحات (Keyset: السابق / التالي) ──
    if (pagerEl) {
      pagerEl.innerHTML = '';
      const hasPrev = this._cursorIdx > 0;

      if (hasPrev || this._hasNext) {
        if (hasPrev) {
          const prev = document.createElement('button');
          prev.className = 'btn btn-secondary btn-sm';
          prev.textContent = '← السابق';
          prev.addEventListener('click', () => {
            this._cursorIdx--;
            this._load();
          });
          pagerEl.appendChild(prev);
        }

        const info = document.createElement('span');
        info.style.cssText = 'align-self:center;font-size:0.78rem;color:var(--text-muted);';
        const pageNum = this._cursorIdx + 1;
        const totalPages = this._count ? Math.ceil(this._count / this._pageSize) : '?';
        info.textContent = `صفحة ${pageNum}${this._count ? ` من ${totalPages}` : ''} (${this._count} عملية)`;
        pagerEl.appendChild(info);

        if (this._hasNext) {
          const next = document.createElement('button');
          next.className = 'btn btn-secondary btn-sm';
          next.textContent = 'التالي →';
          next.addEventListener('click', () => {
            // احفظ cursor من آخر سجل في الصفحة الحالية
            const lastRow = this._ops[this._ops.length - 1];
            if (lastRow) {
              const newCursor = { date: lastRow.date, created_at: lastRow.created_at };
              // إذا كنا نتقدم لصفحة لم نزرها بعد، أضف cursor جديد
              if (this._cursorIdx + 1 >= this._cursors.length) {
                this._cursors.push(newCursor);
              }
            }
            this._cursorIdx++;
            this._load();
          });
          pagerEl.appendChild(next);
        }
      }
    }

    if (window.lucide) lucide.createIcons();
  },

  async _exportOperationsExcel() {
    const exportBtn = document.getElementById('ao-export-btn');
    if (exportBtn) { exportBtn.disabled = true; exportBtn.textContent = '⏳ ...'; }
    try {
      const filters = this._buildFilters();
      let data = [];

      if (!isOfflineMode() && isOnline()) {
        try {
          const res = await this._queryDetailedView(filters, 5000, null);
          data = res.data;
        } catch (e) {
          console.warn('⚠️ Export fallback:', e.message);
        }
      }

      if (!data.length) {
        const result = await repo.query(TABLES.TRANSACTIONS, filters, {
          orderBy: 'date', ascending: false, pageSize: 5000, forceRefresh: true,
        });
        data = isOk(result) ? (result.data.data || []) : [];
      }

      const users    = AppStore.getState('users') || [];
      const uMap     = new Map(users.map(u => [u.id, u.display_name]));
      const headers  = ['التاريخ', 'الوقت', 'النوع', 'المبلغ (ر.س)', 'من حساب', 'إلى حساب', 'تفاصيل إضافية', 'الحالة'];
      const rows = data.map(tx => {
        const agent = tx.agent_name || uMap.get(tx.agent_id) || '—';
        let from = agent, to = '—', extra = tx.details || '';
        if (tx.type === 'delivery')       { from = agent; to = uMap.get(tx.to_agent_id) || '—'; }
        else if (tx.type === 'receipt')   { from = uMap.get(tx.from_agent_id) || agent; to = agent; }
        else if (tx.type === 'deposit')   { from = agent; to = tx.bank_account_name || '—'; }
        else if (tx.type === 'bank_withdrawal') { from = tx.bank_account_name || '—'; to = agent; }
        else if (tx.type === 'collection' || tx.type === 'refund_settlement') {
          from = tx.debtor_name || tx.customer_name || '—'; to = agent;
          extra = tx.company_name || tx.details || '';
        } else if (tx.type === 'expense') { from = agent; to = tx.expense_account_name || tx.expense_type || '—'; }
        return [
          tx.date || '—',
          tx.time ? tx.time.substring(0, 5) : '—',
          TRANSACTION_TYPE_LABELS[tx.type] || tx.type,
          Math.round(parseFloat(tx.amount || 0)),
          from, to, extra,
          tx.is_reversed ? 'مُعكوس' : 'نشط',
        ];
      });

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

  // ─── إجماليات العمليات حسب الفلتر ───────────────────────────
  async _fetchTotals(filters) {
    const totals = { collection: 0, delivery: 0, deposit: 0, expense: 0 };
    try {
      if (!isOfflineMode() && isOnline()) {
        let q = supabaseClient
          .from('transactions_detailed')
          .select('type,amount')
          .eq('is_reversed', false);

        if (filters.type)     q = q.eq('type',     filters.type);
        if (filters.agent_id) q = q.eq('agent_id', filters.agent_id);

        if (filters.date) {
          if (typeof filters.date === 'string') {
            q = q.eq('date', filters.date);
          } else if (filters.date.op === 'between') {
            q = q.gte('date', filters.date.val[0]).lte('date', filters.date.val[1]);
          } else if (filters.date.op === 'gte') {
            q = q.gte('date', filters.date.val);
          } else if (filters.date.op === 'lte') {
            q = q.lte('date', filters.date.val);
          }
        }

        const currentUser = AuthService.getCurrentUser();
        if (currentUser?.role === ROLES.AGENT) {
          q = q.eq('agent_id', currentUser.id);
        }

        const { data, error } = await q;
        if (!error && data) {
          data.forEach(row => {
            if (row.type in totals) totals[row.type] += Math.round(parseFloat(row.amount) || 0);
          });
        }
      } else {
        const result = await repo.query(TABLES.TRANSACTIONS, filters, { pageSize: 5000 });
        const rows   = isOk(result) ? (result.data.data || []) : [];
        rows.filter(r => !r.is_reversed).forEach(row => {
          if (row.type in totals) totals[row.type] += Math.round(parseFloat(row.amount) || 0);
        });
      }
    } catch (e) {
      console.warn('⚠️ AllOperations: totals fetch failed:', e.message);
    }
    return totals;
  },

  _renderTotals(totals) {
    const el = document.getElementById('ao-totals');
    if (!el) return;
    const fmt = n => n.toLocaleString('en-US');
    const cur = APP_CONFIG.CURRENCY_SYMBOL;
    const cards = [
      {
        key  : 'collection',
        icon : 'inbox',
        label: 'إجمالي العهد المستلمة',
        cls  : 'ao-total-card--collection',
      },
      {
        key  : 'delivery',
        icon : 'upload',
        label: 'إجمالي العهد المُخلاة',
        cls  : 'ao-total-card--delivery',
      },
      {
        key  : 'deposit',
        icon : 'landmark',
        label: 'إجمالي الإيداعات',
        cls  : 'ao-total-card--deposit',
      },
      {
        key  : 'expense',
        icon : 'trending-down',
        label: 'إجمالي المصروفات',
        cls  : 'ao-total-card--expense',
      },
    ];
    el.innerHTML = `
      <div class="ao-totals-grid">
        ${cards.map(c => `
          <div class="ao-total-card ${escapeHtml(c.cls)}">
            <div class="ao-total-icon">
              <i data-lucide="${escapeHtml(c.icon)}" style="width:22px;height:22px;stroke:currentColor;flex-shrink:0;"></i>
            </div>
            <div class="ao-total-body">
              <div class="ao-total-label">${escapeHtml(c.label)}</div>
              <div class="ao-total-value">
                ${fmt(totals[c.key])}
                <span class="ao-total-cur">${escapeHtml(cur)}</span>
              </div>
            </div>
          </div>`).join('')}
      </div>`;
    if (window.lucide) lucide.createIcons();
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

      /* ── بطاقات الإجماليات ── */
      .ao-totals-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px;margin-bottom:16px;}
      .ao-total-card{display:flex;align-items:center;gap:14px;padding:14px 16px;border-radius:14px;background:var(--bg-card,#fff);border:1px solid var(--border-color,#e2e8f0);box-shadow:0 1px 4px rgba(0,0,0,.06);transition:transform .15s,box-shadow .15s;}
      .ao-total-card:hover{transform:translateY(-2px);box-shadow:0 4px 14px rgba(0,0,0,.10);}
      .ao-total-icon{display:flex;align-items:center;justify-content:center;width:46px;height:46px;border-radius:12px;flex-shrink:0;}
      .ao-total-body{flex:1;min-width:0;}
      .ao-total-label{font-size:0.73rem;color:var(--text-muted,#64748b);margin-bottom:5px;font-weight:600;}
      .ao-total-value{font-size:1.28rem;font-weight:800;direction:ltr;text-align:right;color:var(--text-primary,#0f172a);line-height:1.2;}
      .ao-total-cur{font-size:0.68rem;font-weight:500;color:var(--text-muted,#64748b);margin-right:3px;}

      .ao-total-card--collection .ao-total-icon{background:#dcfce7;color:#16a34a;}
      .ao-total-card--delivery   .ao-total-icon{background:#dbeafe;color:#2563eb;}
      .ao-total-card--deposit    .ao-total-icon{background:#ede9fe;color:#7c3aed;}
      .ao-total-card--expense    .ao-total-icon{background:#fee2e2;color:#dc2626;}

      body.dark-mode .ao-total-card--collection .ao-total-icon{background:rgba(22,163,74,.18);color:#4ade80;}
      body.dark-mode .ao-total-card--delivery   .ao-total-icon{background:rgba(37,99,235,.18);color:#60a5fa;}
      body.dark-mode .ao-total-card--deposit    .ao-total-icon{background:rgba(124,58,237,.18);color:#a78bfa;}
      body.dark-mode .ao-total-card--expense    .ao-total-icon{background:rgba(220,38,38,.18);color:#f87171;}
    `;
    document.head.appendChild(style);
  },

  _openOperationDetails(tx) {
    const det       = this._detailedMap[tx.id] || {};
    const users     = AppStore.getState('users') || [];
    const usersMap  = new Map(users.map(u => [u.id, u.display_name]));
    const agentName = det.agent_name || usersMap.get(tx.agent_id) || '—';
    const execBy    = det.executed_by_name || null;
    const label     = TRANSACTION_TYPE_LABELS[tx.type] || tx.type;
    const amtNum    = Math.round(parseFloat(tx.amount) || 0);
    const amtFmt    = amtNum.toLocaleString('en-US');
    const cur       = APP_CONFIG.CURRENCY_SYMBOL;
    const timeStr   = tx.time ? tx.time.substring(0, 5) : '—';

    // ── تحديد الطرفين بحسب نوع العملية (منظور محايد) ──
    let fromLabel = 'من حساب', fromVal = '—';
    let toLabel   = 'إلى حساب', toVal = '—';
    let extraRows = [];

    if (tx.type === 'delivery') {
      fromVal = agentName;
      toVal   = usersMap.get(tx.to_agent_id) || '—';
    } else if (tx.type === 'receipt') {
      fromVal = usersMap.get(tx.from_agent_id) || agentName;
      toVal   = agentName;
    } else if (tx.type === 'deposit') {
      fromVal   = agentName;
      toLabel   = 'إلى بنك';
      toVal     = det.bank_account_name || '—';
      if (det.bank_company_name) extraRows.push(['الشركة', det.bank_company_name]);
    } else if (tx.type === 'bank_withdrawal') {
      fromLabel = 'من بنك';
      fromVal   = det.bank_account_name || '—';
      toVal     = agentName;
      if (det.bank_company_name) extraRows.push(['الشركة', det.bank_company_name]);
    } else if (tx.type === 'collection' || tx.type === 'refund_settlement') {
      fromLabel = 'العميل';
      fromVal   = det.debtor_name || tx.customer_name || '—';
      toLabel   = 'المنفذ';
      toVal     = agentName;
      const comp = det.company_name || '';
      if (comp) extraRows.push(['الشركة', comp]);
    } else if (tx.type === 'expense') {
      fromLabel = 'المنفذ';
      fromVal   = agentName;
      toLabel   = 'نوع المصروف';
      toVal     = det.expense_account_name || tx.expense_type || '—';
    } else {
      fromLabel = 'المنفذ';
      fromVal   = agentName;
      toLabel   = 'التفاصيل';
      toVal     = tx.details || '—';
    }

    if (execBy && execBy !== agentName) extraRows.push(['نفّذه', execBy]);
    if (tx.details && !['collection','refund_settlement','expense'].includes(tx.type) && tx.type !== 'receipt' && tx.type !== 'delivery') {
      // already shown in toVal for default case — skip
    } else if (tx.details && (tx.type === 'delivery' || tx.type === 'receipt' || tx.type === 'deposit' || tx.type === 'bank_withdrawal' || tx.type === 'collection' || tx.type === 'refund_settlement')) {
      extraRows.push(['ملاحظات', tx.details]);
    }

    const statusText = tx.is_reversed ? 'مُعكوس' : (tx.approval_status || 'نشط');

    // ── نص النسخ ──
    const copyLines = [
      `رقم العملية: ${tx.id}`,
      `النوع: ${label}`,
      `المبلغ: ${amtFmt} ${cur}`,
      `التاريخ: ${tx.date || '—'}`,
      `الوقت: ${timeStr}`,
      `${fromLabel}: ${fromVal}`,
      `${toLabel}: ${toVal}`,
      ...extraRows.map(([k, v]) => `${k}: ${v}`),
      `الحالة: ${statusText}`,
    ].join('\n');

    const _row = (label, val, bg) =>
      `<tr${bg ? ' style="background:var(--bg-input);"' : ''}>
        <td style="padding:8px 6px;color:var(--text-muted);width:38%;font-size:0.84rem;">${escapeHtml(label)}</td>
        <td style="padding:8px 6px;font-size:0.87rem;">${val}</td>
      </tr>`;

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:9999;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '480px';
    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">🔍 تفاصيل العملية</h3>
        <button class="modal-close" id="ao-detail-close-x">✕</button>
      </div>
      <table style="width:100%;border-collapse:collapse;direction:rtl;">
        ${_row('رقم العملية', `<span style="font-family:monospace;font-size:0.72rem;word-break:break-all;">${escapeHtml(tx.id)}</span>`, false)}
        ${_row('النوع',       escapeHtml(label), true)}
        ${_row('المبلغ',      `<b style="font-size:0.95rem;">${amtFmt} <span style="font-size:0.72rem;font-weight:500;">${escapeHtml(cur)}</span></b>`, false)}
        ${_row('التاريخ',     escapeHtml(tx.date || '—'), true)}
        ${_row('الوقت',       escapeHtml(timeStr), false)}
        ${_row(fromLabel,     `<b>${escapeHtml(fromVal)}</b>`, true)}
        ${_row(toLabel,       `<b>${escapeHtml(toVal)}</b>`, false)}
        ${extraRows.map(([k, v], i) => _row(k, escapeHtml(v), (i % 2 === 0))).join('')}
        ${_row('الحالة', tx.is_reversed
          ? '<span style="color:#d32f2f;font-weight:600;">مُعكوس</span>'
          : `<span style="color:var(--success);font-weight:600;">${escapeHtml(statusText)}</span>`,
          extraRows.length % 2 === 0)}
      </table>
      <div style="display:flex;gap:8px;margin-top:16px;justify-content:center;">
        <button class="btn btn-secondary" id="ao-detail-copy-btn" style="flex:1;">
          <i data-lucide="copy" style="width:14px;height:14px;vertical-align:middle;pointer-events:none;"></i> نسخ بيانات القيد
        </button>
        <button class="btn btn-secondary" id="ao-detail-close-btn" style="flex:1;">إغلاق</button>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();

    box.querySelector('#ao-detail-close-x').addEventListener('click',   () => overlay.remove());
    box.querySelector('#ao-detail-close-btn').addEventListener('click', () => overlay.remove());
    box.querySelector('#ao-detail-copy-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copyLines);
        showToast('✅ تم نسخ بيانات القيد', 'success');
      } catch {
        showToast('❌ تعذّر النسخ — الصق يدوياً', 'warning');
      }
    });
  },

  _openEditModal(tx) {
    if (tx.is_reversed) { showToast('لا يمكن تعديل عملية مُعكوسة', 'error'); return; }
    if (tx.sync_status !== SYNC_STATUS.PENDING) {
      showToast('هذه العملية مُزامنة ونهائية — للتصحيح استخدم "عكس" (قيد عكسي في دفتر الأستاذ)', 'info', 4500);
      return;
    }

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

    const isPending = tx.sync_status === SYNC_STATUS.PENDING;
    const label     = TRANSACTION_TYPE_LABELS[tx.type] || tx.type;
    const amtFmt    = `${Math.round(parseFloat(tx.amount)||0).toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}`;

    if (isPending) {
      // معاملة لم تُزامن: حذف مباشر (لا قيود في account_ledger على الخادم)
      const confirmed = await confirmDialog(
        `هل تريد حذف عملية "${label}" بمبلغ ${amtFmt}؟ (لم تُزامن بعد)`,
        'حذف', 'إلغاء', 'danger',
      );
      if (!confirmed) return;
      const result = await repo.delete(TABLES.TRANSACTIONS, tx.id);
      if (isOk(result)) {
        // حذف القيود المحلية وعكس تأثيرها على account_balances في Dexie
        await AccountingService.cleanupLocalTransaction(tx.id);
        showToast('✅ تم حذف العملية', 'success');
        await this._load();
      } else {
        showToast(`❌ ${result.error}`, 'error');
      }
      return;
    }

    // معاملة مُزامنة: اختيار بين الحذف النهائي أو القيد العكسي
    const choice = await this._chooseDeleteAction(label, amtFmt);
    if (!choice) return;

    if (choice === 'delete') {
      const result = await AccountingService.deleteTransactionCompletely(tx.id);
      if (isOk(result)) {
        showToast('✅ تم حذف العملية نهائياً وعكس أثرها على الأرصدة', 'success');
        await this._load();
      } else {
        showToast(`❌ ${result.error}`, 'error');
      }
    } else {
      // قيد عكسي يحفظ سجل التدقيق ويعكس account_ledger
      const result = await AccountingService.reverseEntries(tx.id);
      if (isOk(result)) {
        showToast('✅ تم عكس العملية وتسجيل القيد العكسي', 'success');
        await this._load();
      } else {
        showToast(`❌ ${result.error}`, 'error');
      }
    }
  },

  // نافذة اختيار: حذف نهائي / عكس / إلغاء — تُعيد 'delete' | 'reverse' | null
  _chooseDeleteAction(label, amtFmt) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.style.cssText = 'display:flex;z-index:99999;';
      const done = (v) => { overlay.remove(); resolve(v); };
      overlay.addEventListener('click', e => { if (e.target === overlay) done(null); });

      const box = document.createElement('div');
      box.className = 'modal-box';
      box.style.maxWidth = '440px';
      box.innerHTML = `
        <div class="modal-header">
          <h3 class="modal-title">🗑️ حذف العملية</h3>
          <button class="modal-close" data-act="cancel">✕</button>
        </div>
        <div style="padding:4px 2px 14px;font-size:0.9rem;line-height:1.8;color:var(--text-secondary);">
          العملية: <b style="color:var(--text-primary);">${escapeHtml(label)}</b> — ${escapeHtml(amtFmt)}<br>
          اختر طريقة المعالجة:
          <div style="margin-top:10px;font-size:0.8rem;color:var(--text-muted);line-height:1.9;">
            • <b style="color:var(--danger);">حذف نهائي:</b> يزيل العملية وقيودها ويعكس أثرها على الأرصدة (لا يُمكن التراجع).<br>
            • <b style="color:var(--warning);">قيد عكسي:</b> يبقي العملية ويضيف قيداً معاكساً (يحفظ سجل التدقيق).
          </div>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn" data-act="delete" style="flex:1;min-width:120px;background:var(--danger);color:#fff;border:none;">حذف نهائي</button>
          <button class="btn" data-act="reverse" style="flex:1;min-width:120px;background:var(--warning);color:#fff;border:none;">قيد عكسي</button>
          <button class="btn btn-secondary" data-act="cancel" style="flex:1;min-width:90px;">إلغاء</button>
        </div>`;
      overlay.appendChild(box);
      document.body.appendChild(overlay);

      box.querySelectorAll('[data-act]').forEach(b => {
        b.addEventListener('click', () => {
          const act = b.dataset.act;
          done(act === 'delete' ? 'delete' : act === 'reverse' ? 'reverse' : null);
        });
      });
    });
  },

  async onResume() {
    this._resetPagination();
    await this._load();
  },
};

window.AllOperationsComponent = AllOperationsComponent;
console.log('✅ AllOperationsComponent v3.1 — Keyset Pagination: O(log n) بدل OFFSET');
