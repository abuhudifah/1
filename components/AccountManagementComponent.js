/**
 * components/AccountManagementComponent.js — v4.0
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * مركز إدارة الحسابات الشامل
 *
 * الإصلاحات:
 * ✅ 1. _addDefaultChart غير معرّفة → تعريفها الآن وربطها بعد innerHTML
 *
 * الميزات الجديدة:
 * ✅ 2. دليل حسابات يشمل المستخدمين + العملاء + الشركات + البنوك + المصروفات
 * ✅ 3. كشف حساب من فترة إلى فترة مع طباعة احترافية
 * ✅ 4. قيد بسيط بين حسابين (Simple Journal Entry)
 * ✅ 5. قيد مزدوج (Double Entry) — مدين/دائن متعدد
 * ✅ 6. بحث سريع في الحسابات
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
'use strict';

const AccountManagementComponent = {
  _selectedAccount    : null,
  _selectedAccountName: null,
  _addModal           : null,
  _journalModal       : null,
  _allAccounts        : [], // قائمة كل الحسابات لاستخدامها في القيود

  // شجرة الحسابات الافتراضية
  DEFAULT_CHART : [
    { category:'treasury', name:'الصندوق العام',      id:'GENERAL_FUND',  icon:'🏛️', desc:'الخزينة الرئيسية للنظام' },
    { category:'treasury', name:'الخزينة النقدية',     id:'CASH_GENERAL',  icon:'💵', desc:'النقد المتوفر يدوياً'    },
    { category:'treasury', name:'حساب الشركات العام',  id:'COMP_GENERAL',  icon:'🏢', desc:'حساب تسوية الشركات'     },
  ],

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  async render(container) {
    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">إدارة الحسابات للمدير والمساعد الإداري فقط</div></div>`;
      return;
    }

    container.innerHTML = '';
    const wrap = document.createElement('div');

    /* ── Fix #12: لوحة الموافقات المعلقة ── */
    const pendingSection = document.createElement('div');
    pendingSection.id = 'acct-pending-section';
    wrap.appendChild(pendingSection);

    /* ── شريط العنوان ── */
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;';

    const titleLeft = document.createElement('div');
    titleLeft.innerHTML = `
      <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);">📊 مركز إدارة الحسابات</h2>
      <p style="font-size:0.80rem;color:var(--text-muted);margin-top:3px;">دليل الحسابات · كشف الحساب · القيود المحاسبية</p>`;
    titleRow.appendChild(titleLeft);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

    const journalBtn = document.createElement('button');
    journalBtn.className = 'btn btn-secondary btn-sm';
    journalBtn.innerHTML = '<i data-lucide="git-branch" style="width:14px;height:14px;"></i> قيد محاسبي';
    journalBtn.addEventListener('click', () => this._openJournalModal());
    btnGroup.appendChild(journalBtn);

    const addBtn = document.createElement('button');
    addBtn.className = 'btn btn-primary btn-sm';
    addBtn.innerHTML = '<i data-lucide="plus-circle" style="width:14px;height:14px;"></i> إضافة حساب';
    addBtn.addEventListener('click', () => this._openAddModal());
    btnGroup.appendChild(addBtn);

    const refreshBtn = document.createElement('button');
    refreshBtn.className = 'btn btn-secondary btn-sm';
    refreshBtn.innerHTML = '<i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> تحديث';
    refreshBtn.addEventListener('click', () => this._loadChart());
    btnGroup.appendChild(refreshBtn);

    titleRow.appendChild(btnGroup);
    wrap.appendChild(titleRow);

    /* ── بحث سريع ── */
    const searchBar = document.createElement('div');
    searchBar.className = 'acct-search-bar';
    searchBar.innerHTML = `
      <div class="acct-search-wrap">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <input id="acct-search" type="text" class="acct-search-input"
          placeholder="بحث في الحسابات باسم أو المعرّف...">
      </div>
      <span id="acct-result-count" class="acct-result-count" style="display:none;"></span>`;
    wrap.appendChild(searchBar);

    /* ── دليل الحسابات ── */
    const chartEl = document.createElement('div');
    chartEl.id = 'acct-chart';
    chartEl.innerHTML = [1,2,3,4].map(() => `
      <div class="glass-card" style="margin-bottom:16px;">
        <div class="skeleton" style="height:32px;border-radius:8px;margin-bottom:12px;"></div>
        <div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:8px;"></div>
        <div class="skeleton" style="height:44px;border-radius:8px;"></div>
      </div>`).join('');
    wrap.appendChild(chartEl);

    /* ── قسم كشف الحساب ── */
    const stmtSection = document.createElement('div');
    stmtSection.id = 'acct-stmt-section';
    stmtSection.style.display = 'none';
    stmtSection.innerHTML = `
      <div class="glass-card" style="margin-bottom:16px;" id="acct-stmt-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 style="font-size:1rem;font-weight:700;color:var(--text-primary);" id="stmt-account-title">📄 كشف الحساب</h3>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;font-family:monospace;" id="stmt-account-id"></p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <button id="stmt-share-btn" class="btn btn-secondary btn-sm"
              style="background:rgba(37,211,102,0.10);border-color:rgba(37,211,102,0.30);color:#25d366;">
              <i data-lucide="share-2" style="width:13px;height:13px;"></i> مشاركة
            </button>
            <button id="stmt-copy-btn" class="btn btn-secondary btn-sm">
              <i data-lucide="copy" style="width:13px;height:13px;"></i> نسخ
            </button>
            <button id="stmt-print-btn" class="btn btn-secondary btn-sm">
              <i data-lucide="printer" style="width:13px;height:13px;"></i> طباعة
            </button>
            <button id="stmt-close-btn" class="btn btn-secondary btn-sm" style="color:var(--danger);">✕ إغلاق</button>
          </div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;align-items:flex-end;">
          <div class="form-group" style="margin:0;flex:1;min-width:120px;">
            <label class="form-label" style="font-size:0.78rem;">من تاريخ</label>
            <input id="stmt-from" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
          </div>
          <div class="form-group" style="margin:0;flex:1;min-width:120px;">
            <label class="form-label" style="font-size:0.78rem;">إلى تاريخ</label>
            <input id="stmt-to" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
              value="${getCurrentSaudiDate()}">
          </div>
          <button id="stmt-load-btn" class="btn btn-primary btn-sm">عرض الكشف</button>
        </div>
        <div id="stmt-summary" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:10px;margin-bottom:16px;"></div>
        <div id="stmt-entries"></div>
      </div>`;
    wrap.appendChild(stmtSection);

    /* ── مودال إضافة حساب ── */
    this._addModal = this._buildAddModal();
    wrap.appendChild(this._addModal);

    /* ── مودال القيود المحاسبية ── */
    this._journalModal = this._buildJournalModal();
    wrap.appendChild(this._journalModal);

    container.appendChild(wrap);

    /* ── ربط الأحداث ── */
    document.getElementById('stmt-load-btn')?.addEventListener('click', () => this._loadStatement());
    document.getElementById('stmt-close-btn')?.addEventListener('click', () => {
      stmtSection.style.display = 'none';
      this._selectedAccount = null;
    });
    document.getElementById('stmt-print-btn')?.addEventListener('click', () => this._printStatement());
    document.getElementById('stmt-share-btn')?.addEventListener('click', () => this._shareStatement());
    document.getElementById('stmt-copy-btn')?.addEventListener('click', () => {
      const name = this._selectedAccountName || '';
      const from = document.getElementById('stmt-from')?.value || '';
      const to   = document.getElementById('stmt-to')?.value   || '';
      const rows = [...document.querySelectorAll('#stmt-print-table tbody tr')]
        .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()).join(' | '))
        .join('\n');
      PrintService.copyText(
        `كشف حساب: ${name}\nالفترة: ${from} → ${to}\n${'─'.repeat(30)}\n${rows}`,
        'تم نسخ كشف الحساب'
      );
    });

    let _searchTimer = null;
    document.getElementById('acct-search')?.addEventListener('input', (e) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => this._filterChart(e.target.value.trim()), 180);
    });

    if (window.lucide) lucide.createIcons();
    await Promise.all([
      this._loadChart(),
      this._loadPendingApprovals(),
    ]);

    /* استمع لأحداث الموافقة لتحديث اللوحة تلقائياً */
    window.addEventListener('accounting:transactionApproved',  () => this._loadPendingApprovals());
    window.addEventListener('accounting:transactionRejected',  () => this._loadPendingApprovals());
  },

  // ─────────────────────────────────────────────────────────
  // تحميل دليل الحسابات
  // ─────────────────────────────────────────────────────────
  async _loadChart() {
    const el = document.getElementById('acct-chart');
    if (!el) return;

    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:40px;">
      <div class="spinner spinner-dark"></div></div>`;

    let chartData = null;
    try {
      if (isOnline()) {
        const { data, error } = await supabaseClient.rpc('get_chart_of_accounts');
        if (!error && data) chartData = data;
      }
    } catch { /* سقوط إلى البيانات المحلية */ }

    if (!chartData) chartData = await this._buildLocalChartData();

    if (!chartData?.categories?.length) {
      el.innerHTML = this._renderEmptyChart();
      /* ✅ الإصلاح الرئيسي: ربط حدث الزر بعد إدراجه في DOM مباشرةً */
      document.getElementById('add-default-chart-btn')
        ?.addEventListener('click', () => this._addDefaultChart());
      return;
    }

    /* بناء قائمة كل الحسابات للاستخدام في القيود */
    this._allAccounts = chartData.categories.flatMap(c => c.accounts || []);

    el.innerHTML = '';
    this._renderChart(el, chartData);
    if (window.lucide) lucide.createIcons();
  },

  // ─────────────────────────────────────────────────────────
  // Fix #12: لوحة الموافقات المعلقة
  // ─────────────────────────────────────────────────────────
  async _loadPendingApprovals() {
    const el = document.getElementById('acct-pending-section');
    if (!el) return;

    const result = await AccountingService.getPendingApprovals();
    const pending = isOk(result) ? result.data : [];

    if (!pending.length) { el.innerHTML = ''; return; }

    el.innerHTML = `
      <div class="glass-card" style="margin-bottom:20px;border:2px solid var(--warning);border-radius:16px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
          <div style="width:36px;height:36px;border-radius:10px;background:rgba(217,119,6,0.12);
            display:flex;align-items:center;justify-content:center;font-size:1.2rem;">⏳</div>
          <div>
            <div style="font-weight:700;color:var(--warning);">معاملات بانتظار الموافقة</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${pending.length} معاملة تحتاج مراجعة</div>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;" id="pending-list">
          ${pending.map(tx => `
            <div style="display:flex;align-items:center;justify-content:space-between;
              padding:10px 14px;background:rgba(217,119,6,0.06);border-radius:10px;
              border:1px solid rgba(217,119,6,0.15);flex-wrap:wrap;gap:8px;">
              <div>
                <div style="font-weight:600;font-size:0.9rem;">
                  ${escapeHtml(tx.agent_name || '—')}
                  <span style="font-size:0.72rem;color:var(--text-muted);margin-right:6px;">${escapeHtml(tx.date || '')}</span>
                </div>
                <div style="font-size:0.78rem;color:var(--text-muted);">
                  استلام · ${escapeHtml(tx.details || '')}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:8px;">
                <div style="font-weight:700;font-size:1rem;color:var(--warning);direction:ltr;">
                  ${Math.round(parseFloat(tx.amount||0)).toLocaleString('en-US')} ر.س
                </div>
                <button class="btn btn-sm approve-btn"
                  style="background:var(--success);color:#fff;font-size:0.78rem;"
                  data-id="${escapeHtml(tx.id)}">✓ موافقة</button>
                <button class="btn btn-secondary btn-sm reject-btn"
                  style="color:var(--danger);font-size:0.78rem;"
                  data-id="${escapeHtml(tx.id)}">✕ رفض</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;

    el.querySelectorAll('.approve-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true; btn.textContent = '⏳';
        const result = await AccountingService.approveTransaction(btn.dataset.id);
        if (isOk(result)) {
          showToast('تمت الموافقة وتحديث القيود', 'success');
          await this._loadPendingApprovals();
          await this._loadChart();
        } else {
          showToast(result.error, 'error');
          btn.disabled = false; btn.textContent = '✓ موافقة';
        }
      });
    });

    el.querySelectorAll('.reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const reason = prompt('سبب الرفض (اختياري):') ?? '';
        btn.disabled = true; btn.textContent = '⏳';
        const result = await AccountingService.rejectTransaction(btn.dataset.id, reason);
        if (isOk(result)) {
          showToast('تم الرفض وعكس القيود', 'warning');
          await this._loadPendingApprovals();
        } else {
          showToast(result.error, 'error');
          btn.disabled = false; btn.textContent = '✕ رفض';
        }
      });
    });
  },

  _renderChart(el, chartData) {
    const categoryMeta = {
      agents   : { icon:'👤', label:'حسابات المناديب',          color:'#2563eb', bg:'rgba(37,99,235,0.08)'  },
      debtors  : { icon:'👥', label:'حسابات العملاء المديونين',  color:'#0284c7', bg:'rgba(2,132,199,0.08)'  },
      companies: { icon:'🏢', label:'حسابات الشركات',            color:'#7c3aed', bg:'rgba(124,58,237,0.08)' },
      banks    : { icon:'🏦', label:'الحسابات البنكية',           color:'#059669', bg:'rgba(5,150,105,0.08)'  },
      expenses : { icon:'💸', label:'حسابات المصروفات',           color:'#dc2626', bg:'rgba(220,38,38,0.08)'  },
      treasury : { icon:'🏛️', label:'الخزينة والحسابات العامة', color:'#d97706', bg:'rgba(217,119,6,0.08)'  },
      revenue  : { icon:'💰', label:'حسابات الإيرادات',          color:'#059669', bg:'rgba(5,150,105,0.08)'  },
      suspense : { icon:'⏳', label:'الحسابات المعلقة',          color:'#d97706', bg:'rgba(217,119,6,0.08)'  },
    };

    /* ── شريط KPI الإجماليات ── */
    const totalAccounts = chartData.categories.reduce((s, c) => s + (c.accounts?.length || 0), 0);
    const totalBalance  = chartData.categories.reduce((s, c) => s + parseFloat(c.total_balance || 0), 0);
    const kpiBar = document.createElement('div');
    kpiBar.className = 'acct-kpi-bar';
    kpiBar.innerHTML = `
      <div class="acct-kpi-item">
        <div class="acct-kpi-label">عدد الحسابات</div>
        <div class="acct-kpi-value" style="color:var(--accent);">${totalAccounts}</div>
      </div>
      <div class="acct-kpi-item">
        <div class="acct-kpi-label">عدد الفئات</div>
        <div class="acct-kpi-value" style="color:#7c3aed;">${chartData.categories.length}</div>
      </div>
      ${chartData.total_assets !== undefined ? `
      <div class="acct-kpi-item">
        <div class="acct-kpi-label">إجمالي الأصول (مدين)</div>
        <div class="acct-kpi-value" style="color:var(--success);">
          ${Math.round(parseFloat(chartData.total_assets || 0)).toLocaleString('en-US')}
          <span style="font-size:0.65rem;color:var(--text-muted);"> ${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
      </div>
      <div class="acct-kpi-item">
        <div class="acct-kpi-label">إجمالي الالتزامات (دائن)</div>
        <div class="acct-kpi-value" style="color:var(--danger);">
          ${Math.round(parseFloat(chartData.total_liabilities || 0)).toLocaleString('en-US')}
          <span style="font-size:0.65rem;color:var(--text-muted);"> ${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
      </div>` : `
      <div class="acct-kpi-item">
        <div class="acct-kpi-label">صافي الرصيد الكلي</div>
        <div class="acct-kpi-value" style="color:${totalBalance >= 0 ? 'var(--success)' : 'var(--danger)'};">
          ${totalBalance >= 0 ? '' : '−'}${Math.abs(Math.round(totalBalance)).toLocaleString('en-US')}
          <span style="font-size:0.65rem;color:var(--text-muted);"> ${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
      </div>`}`;
    el.appendChild(kpiBar);

    /* ── أقسام الفئات ── */
    for (const cat of chartData.categories) {
      const meta     = categoryMeta[cat.category] || { icon:'📋', label:cat.label||cat.category, color:'var(--text-secondary)', bg:'transparent' };
      const total    = Math.round(parseFloat(cat.total_balance || 0));
      const accounts = cat.accounts || [];

      const section = document.createElement('div');
      section.className = 'glass-card acct-category';
      section.dataset.category = cat.category;

      const header = document.createElement('div');
      header.className = 'acct-cat-header';
      header.style.borderBottom = accounts.length ? `2px solid ${meta.color}22` : 'none';
      header.innerHTML = `
        <div class="acct-cat-header-right">
          <div class="acct-cat-icon" style="background:${meta.bg};border:1px solid ${meta.color}22;">
            ${meta.icon}
          </div>
          <div>
            <div class="acct-cat-title">${escapeHtml(meta.label)}</div>
            <div class="acct-cat-count">${accounts.length} حساب</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:14px;">
          <div style="text-align:left;">
            <div class="acct-cat-total" style="color:${meta.color};">
              ${total >= 0 ? '' : '−'}${Math.abs(total).toLocaleString('en-US')}
              <span style="font-size:0.65rem;color:var(--text-muted);"> ${APP_CONFIG.CURRENCY_SYMBOL}</span>
            </div>
            <div class="acct-cat-total-label">إجمالي الرصيد</div>
          </div>
          <svg class="acct-cat-chevron open" width="16" height="16" viewBox="0 0 24 24"
            fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>`;

      const body = document.createElement('div');
      body.className = 'acct-cat-body';

      if (accounts.length) {
        const tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrapper';
        tableWrap.innerHTML = `
          <table class="data-table">
            <thead><tr>
              <th>الحساب</th>
              <th>معرف الحساب</th>
              <th>الرصيد</th>
              <th>إجراءات</th>
            </tr></thead>
            <tbody>
              ${accounts.map(acc => {
                const bal = Math.round(parseFloat(acc.balance || 0));
                const parentBadge = acc.parent_name
                  ? `<span class="acct-parent-badge">🏢 ${escapeHtml(acc.parent_name)}</span>`
                  : '';
                return `<tr class="acct-row" data-name="${escapeHtml((acc.name || acc.account_id).toLowerCase())}">
                  <td style="font-weight:600;">${parentBadge}${escapeHtml(acc.name || acc.account_id)}</td>
                  <td style="direction:ltr;font-family:monospace;font-size:0.72rem;color:var(--text-muted);">${escapeHtml(acc.account_id)}</td>
                  <td style="font-weight:700;direction:ltr;color:${bal >= 0 ? 'var(--success)' : 'var(--danger)'};">
                    ${bal >= 0 ? '' : '−'}${Math.abs(bal).toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}
                  </td>
                  <td>
                    <div style="display:flex;gap:4px;">
                      <button class="view-stmt-btn btn btn-secondary btn-sm"
                        data-account="${escapeHtml(acc.account_id)}"
                        data-name="${escapeHtml(acc.name || acc.account_id)}"
                        style="font-size:0.78rem;">
                        <i data-lucide="file-text" style="width:12px;height:12px;"></i> كشف
                      </button>
                      <button class="quick-entry-btn btn btn-secondary btn-sm"
                        data-account="${escapeHtml(acc.account_id)}"
                        data-name="${escapeHtml(acc.name || acc.account_id)}"
                        style="font-size:0.78rem;">
                        <i data-lucide="pen-line" style="width:12px;height:12px;"></i> قيد
                      </button>
                    </div>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`;
        body.appendChild(tableWrap);
      }

      /* toggle collapse */
      const chevron = header.querySelector('.acct-cat-chevron');
      header.addEventListener('click', () => {
        const collapsed = body.classList.toggle('collapsed');
        chevron.classList.toggle('open', !collapsed);
      });

      section.appendChild(header);
      section.appendChild(body);
      el.appendChild(section);
    }

    /* ── إجمالي عام (إذا كانت البيانات قادمة من RPC) ── */
    if (chartData.total_assets !== undefined) {
      const totals = document.createElement('div');
      totals.className = 'glass-card acct-totals-grid';
      totals.innerHTML = `
        <div class="acct-total-card" style="background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.18);">
          <div class="acct-total-card-label">📈 إجمالي الأصول (مدين)</div>
          <div class="acct-total-card-value" style="color:var(--success);">
            ${Math.round(parseFloat(chartData.total_assets || 0)).toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}
          </div>
        </div>
        <div class="acct-total-card" style="background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.18);">
          <div class="acct-total-card-label">📉 إجمالي الالتزامات (دائن)</div>
          <div class="acct-total-card-value" style="color:var(--danger);">
            ${Math.round(parseFloat(chartData.total_liabilities || 0)).toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}
          </div>
        </div>`;
      el.appendChild(totals);
    }

    /* ربط أحداث الأزرار */
    el.querySelectorAll('.view-stmt-btn').forEach(btn => {
      btn.addEventListener('click', () => this._showStatement(btn.dataset.account, btn.dataset.name));
    });
    el.querySelectorAll('.quick-entry-btn').forEach(btn => {
      btn.addEventListener('click', () => this._openJournalModal(btn.dataset.account, btn.dataset.name));
    });

    if (window.lucide) lucide.createIcons();
  },

  // ─────────────────────────────────────────────────────────
  // بحث سريع في الحسابات
  // ─────────────────────────────────────────────────────────
  _filterChart(query) {
    const q = query.toLowerCase();
    let totalVisible = 0;
    document.querySelectorAll('.acct-category').forEach(section => {
      const rows = section.querySelectorAll('.acct-row');
      let visible = 0;
      rows.forEach(row => {
        const match = !q || row.dataset.name?.includes(q) ||
          row.querySelector('td:nth-child(2)')?.textContent.toLowerCase().includes(q);
        row.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      section.style.display = (!q || visible > 0) ? '' : 'none';
      /* افتح القسم تلقائياً عند البحث */
      if (q && visible > 0) {
        section.querySelector('.acct-cat-body')?.classList.remove('collapsed');
        section.querySelector('.acct-cat-chevron')?.classList.add('open');
      }
      totalVisible += visible;
    });
    const countEl = document.getElementById('acct-result-count');
    if (countEl) {
      if (q) {
        countEl.style.display = '';
        countEl.textContent   = `${totalVisible} نتيجة`;
      } else {
        countEl.style.display = 'none';
      }
    }
  },

  // ─────────────────────────────────────────────────────────
  // شاشة فارغة
  // ─────────────────────────────────────────────────────────
  _renderEmptyChart() {
    return `
      <div class="glass-card" style="text-align:center;padding:40px 20px;">
        <div style="font-size:3rem;margin-bottom:16px;opacity:0.5;">📊</div>
        <h3 style="font-weight:700;margin-bottom:8px;">لا توجد حسابات بعد</h3>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:20px;">
          انقر على "إضافة حساب" لإنشاء حسابك الأول،<br>أو أضف شجرة الحسابات الافتراضية دفعةً واحدة
        </p>
        <button id="add-default-chart-btn" class="btn btn-primary">
          🌳 إضافة شجرة الحسابات الافتراضية
        </button>
      </div>`;
  },

  // ─────────────────────────────────────────────────────────
  // ✅ الإصلاح: _addDefaultChart معرّفة الآن
  // ─────────────────────────────────────────────────────────
  async _addDefaultChart() {
    const btn = document.getElementById('add-default-chart-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإضافة...'; }

    try {
      let added = 0;
      for (const acc of this.DEFAULT_CHART) {
        const accId = acc.id;
        /* التحقق من عدم وجود الحساب مسبقاً */
        const existing = await db.account_balances.get(accId);
        if (existing) continue;

        const record = { account_id: accId, balance: 0, last_updated: new Date().toISOString() };

        if (isOnline()) {
          const { error } = await supabaseClient
            .from('account_balances')
            .upsert(record, { onConflict: 'account_id' });
          if (!error) {
            await db.account_balances.put(record);
            added++;
          }
        } else {
          await db.account_balances.put(record);
          await SyncQueue.add('create', 'account_balances', accId, record);
          added++;
        }
      }

      showToast(`✅ تمت إضافة ${added} حساب افتراضي`, 'success');
      await this._loadChart();
    } catch (e) {
      showToast(`فشل إضافة الحسابات الافتراضية: ${e.message}`, 'error');
      if (btn) { btn.disabled = false; btn.textContent = '🌳 إضافة شجرة الحسابات الافتراضية'; }
    }
  },

  // ─────────────────────────────────────────────────────────
  // بناء البيانات محلياً من Dexie
  // ─────────────────────────────────────────────────────────
  async _buildLocalChartData() {
    let balances = [];
    try {
      if (isOnline()) {
        const { data } = await supabaseClient.from('account_balances').select('*').order('account_id');
        balances = data || [];
      } else {
        balances = await db.account_balances.toArray();
      }
    } catch { balances = []; }

    if (!balances.length) return null;

    const users     = AppStore.getState('users');
    const banks     = AppStore.getState('bankAccounts');
    const companies = AppStore.getState('companies');
    const debtors   = AppStore.getState('debtors') || [];

    const cats = { agents:[], debtors:[], companies:[], banks:[], expenses:[], revenue:[], suspense:[], treasury:[] };
    const catLabels = {
      agents:'حسابات المناديب', debtors:'حسابات العملاء المديونين',
      companies:'حسابات الشركات', banks:'الحسابات البنكية',
      expenses:'حسابات المصروفات', revenue:'حسابات الإيرادات',
      suspense:'الحسابات المعلقة', treasury:'الخزينة والحسابات العامة',
    };

    for (const b of balances) {
      const bal = Math.round(parseFloat(b.balance || 0));
      let name = b.account_id, cat = 'treasury', parent_name = null;

      if (b.account_id.startsWith('AGT_')) {
        const id = b.account_id.slice(4);
        const u  = users.find(u => u.id === id);
        name = u?.display_name || id; cat = 'agents';
      } else if (b.account_id.startsWith('DBT_') || b.account_id.startsWith('CUST_')) {
        const id = b.account_id.slice(b.account_id.startsWith('DBT_') ? 4 : 5);
        const d  = debtors.find(d => d.id === id);
        name = d?.name || id; cat = 'debtors';
      } else if (b.account_id.startsWith('COMP_')) {
        const p = b.account_id.slice(5);
        const c = companies.find(c => c.account_prefix === p);
        name = c?.name || p; cat = 'companies';
      } else if (b.account_id.startsWith('BNK_')) {
        const id = b.account_id.slice(4);
        const bk = banks.find(bk => bk.id === id);
        if (bk) {
          name = bk.name;
          const co = companies.find(c => c.id === bk.company_id);
          parent_name = co?.name || null;
        } else { name = id; }
        cat = 'banks';
      } else if (b.account_id.startsWith('EXP_')) {
        name = b.account_id.slice(4); cat = 'expenses';
      } else if (b.account_id.startsWith('REV_')) {
        name = b.account_id.slice(4); cat = 'revenue';
      } else if (b.account_id.startsWith('SUSP_')) {
        if (bal === 0) continue;  // لا تعرض المعلقة المغلقة
        name = 'معلق: ' + b.account_id.slice(5); cat = 'suspense';
      }

      cats[cat].push({ account_id: b.account_id, name, balance: bal, parent_name });
    }

    return {
      categories: Object.entries(cats).map(([key, accs]) => ({
        category      : key,
        label         : catLabels[key] || key,
        total_balance : accs.reduce((s, a) => s + a.balance, 0),
        accounts      : accs,
      })).filter(c => c.accounts.length > 0),
    };
  },

  // ─────────────────────────────────────────────────────────
  // كشف الحساب
  // ─────────────────────────────────────────────────────────
  _showStatement(accountId, accountName) {
    this._selectedAccount     = accountId;
    this._selectedAccountName = accountName;

    const stmtSection = document.getElementById('acct-stmt-section');
    if (stmtSection) stmtSection.style.display = 'block';

    const titleEl = document.getElementById('stmt-account-title');
    const idEl    = document.getElementById('stmt-account-id');
    if (titleEl) titleEl.textContent = `📄 كشف حساب: ${accountName}`;
    if (idEl)    idEl.textContent    = accountId;

    /* تعيين نطاق افتراضي: بداية الشهر الحالي → اليوم */
    const firstOfMonth = new Date();
    firstOfMonth.setDate(1);
    const fromEl = document.getElementById('stmt-from');
    if (fromEl && !fromEl.value) {
      fromEl.value = firstOfMonth.toLocaleDateString('en-CA', { timeZone: APP_CONFIG.TIMEZONE });
    }

    stmtSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this._loadStatement();
  },

  async _loadStatement() {
    if (!this._selectedAccount) return;

    const fromEl = document.getElementById('stmt-from');
    const toEl   = document.getElementById('stmt-to');
    const from   = fromEl?.value;
    const to     = toEl?.value || getCurrentSaudiDate();

    if (!from) { showToast('حدد تاريخ البداية', 'warning'); return; }

    const summaryEl = document.getElementById('stmt-summary');
    const entriesEl = document.getElementById('stmt-entries');
    if (!summaryEl || !entriesEl) return;

    summaryEl.innerHTML = '<div class="skeleton" style="height:70px;border-radius:10px;"></div>'.repeat(3);
    entriesEl.innerHTML = '<div style="text-align:center;padding:20px;"><div class="spinner spinner-dark"></div></div>';

    try {
      let entries = [], openingBalance = 0;

      if (isOnline()) {
        const { data, error } = await supabaseClient.rpc('get_account_statement', {
          p_account_id : this._selectedAccount,
          p_from       : from,
          p_to         : to,
        });
        if (!error && data) {
          entries        = data.entries        || [];
          openingBalance = data.opening_balance || 0;
        }
      }

      /* Fallback: من Dexie مباشرة */
      if (!entries.length) {
        const local = await db.account_ledger
          .where('account_id').equals(this._selectedAccount)
          .and(e => e.date >= from && e.date <= to)
          .toArray();
        entries = local.sort((a, b) => a.date.localeCompare(b.date));
      }

      const totalDebit  = entries.reduce((s, e) => s + parseFloat(e.debit  || 0), 0);
      const totalCredit = entries.reduce((s, e) => s + parseFloat(e.credit || 0), 0);
      const closingBal  = openingBalance + totalDebit - totalCredit;

      /* ملخص أرقام */
      summaryEl.innerHTML = `
        ${this._stmtCard('رصيد افتتاحي', Math.round(openingBalance), 'var(--text-secondary)')}
        ${this._stmtCard('إجمالي مدين',  Math.round(totalDebit),     'var(--success)')}
        ${this._stmtCard('إجمالي دائن',  Math.round(totalCredit),    'var(--danger)')}
        ${this._stmtCard('رصيد ختامي',   Math.round(closingBal),     closingBal >= 0 ? 'var(--success)' : 'var(--danger)')}`;

      if (!entries.length) {
        entriesEl.innerHTML = `<div class="empty-state" style="padding:30px;">
          <div class="empty-state-icon" style="font-size:2rem;">📭</div>
          <div class="empty-state-text">لا توجد حركات في هذه الفترة</div>
        </div>`;
        return;
      }

      /* جدول الحركات مع الرصيد الجاري */
      let runBal = openingBalance;
      const ob   = Math.round(openingBalance);
      const cb   = Math.round(closingBal);

      const table = document.createElement('div');
      table.className = 'table-wrapper';
      table.innerHTML = `
        <table class="data-table" id="stmt-print-table">
          <thead><tr>
            <th>التاريخ</th>
            <th>رقم القيد</th>
            <th>البيان</th>
            <th>المنفذ</th>
            <th>مدين</th>
            <th>دائن</th>
            <th>الرصيد</th>
          </tr></thead>
          <tbody>
            <tr style="background:rgba(217,119,6,0.06);">
              <td colspan="6" style="font-weight:700;color:var(--warning);">رصيد افتتاحي</td>
              <td style="font-weight:800;color:${ob >= 0 ? 'var(--success)' : 'var(--danger)'};direction:ltr;">
                ${ob >= 0 ? '' : '−'}${Math.abs(ob).toLocaleString('en-US')} ر.س
              </td>
            </tr>
            ${entries.map(e => {
              const d = Math.round(parseFloat(e.debit  || 0));
              const c = Math.round(parseFloat(e.credit || 0));
              runBal += d - c;
              return `<tr>
                <td style="font-size:0.82rem;white-space:nowrap;">${escapeHtml(formatDateArabic ? formatDateArabic(e.date) : e.date)}</td>
                <td style="font-family:monospace;font-size:0.72rem;color:var(--text-muted);direction:ltr;">${escapeHtml(e.voucher_number || '—')}</td>
                <td style="font-size:0.85rem;max-width:170px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.description || '—')}</td>
                <td style="font-size:0.80rem;color:var(--text-secondary);">${escapeHtml(e.agent_name || '—')}</td>
                <td style="color:var(--success);font-weight:${d > 0 ? '700' : '400'};direction:ltr;">${d > 0 ? d.toLocaleString('en-US') + ' ر.س' : '—'}</td>
                <td style="color:var(--danger);font-weight:${c > 0 ? '700' : '400'};direction:ltr;">${c > 0 ? c.toLocaleString('en-US') + ' ر.س' : '—'}</td>
                <td style="font-weight:700;color:${runBal >= 0 ? 'var(--success)' : 'var(--danger)'};direction:ltr;">
                  ${runBal >= 0 ? '' : '−'}${Math.abs(Math.round(runBal)).toLocaleString('en-US')} ر.س
                </td>
              </tr>`;
            }).join('')}
            <tr style="background:rgba(5,150,105,0.06);border-top:2px solid rgba(5,150,105,0.22);">
              <td colspan="6" style="font-weight:700;color:${cb >= 0 ? 'var(--success)' : 'var(--danger)'};text-align:center;">رصيد ختامي</td>
              <td style="font-weight:800;color:${cb >= 0 ? 'var(--success)' : 'var(--danger)'};direction:ltr;">
                ${cb >= 0 ? '' : '−'}${Math.abs(cb).toLocaleString('en-US')} ر.س
              </td>
            </tr>
          </tbody>
        </table>`;

      entriesEl.innerHTML = '';
      entriesEl.appendChild(table);
      if (window.lucide) lucide.createIcons();

    } catch (e) {
      entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">خطأ في جلب البيانات: ${escapeHtml(e.message)}</div></div>`;
    }
  },

  _stmtCard(label, value, color) {
    return `
      <div style="text-align:center;padding:12px;background:${color}12;border-radius:12px;border:1px solid ${color}22;">
        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;">${label}</div>
        <div style="font-weight:800;font-size:1rem;color:${color};direction:ltr;">
          ${value >= 0 ? '' : '−'}${Math.abs(value).toLocaleString('en-US')} ر.س
        </div>
      </div>`;
  },

  /* طباعة كشف الحساب */
  _printStatement() {
    const name = this._selectedAccountName || '';
    const from = document.getElementById('stmt-from')?.value || '';
    const to   = document.getElementById('stmt-to')?.value   || '';
    const logo = AppStore.getState('logoUrl') || '';
    const user = AuthService.getCurrentUser();

    /* استخراج بيانات الصفوف من الجدول الحالي */
    const tbl     = document.getElementById('stmt-print-table');
    const headers = tbl ? [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim()) : [];
    const rows    = tbl
      ? [...tbl.querySelectorAll('tbody tr')].map(tr =>
          [...tr.querySelectorAll('td')].map(td => td.textContent.trim()))
      : [];
    const footerCells = tbl
      ? [...(tbl.querySelector('tfoot tr')?.querySelectorAll('td') || [])].map(td => td.textContent.trim())
      : [];

    const tableHTML = headers.length
      ? PrintService.buildTable(headers, rows, footerCells.length ? footerCells : null)
      : '<p style="color:#64748b;text-align:center;padding:20px;">لا توجد بيانات في الكشف</p>';

    PrintService.print({
      title      : `كشف حساب: ${name}`,
      subtitle   : `معرف الحساب: ${this._selectedAccount || ''} &nbsp;|&nbsp; الفترة: ${from} → ${to}`,
      date       : from ? `${from} — ${to}` : '',
      userName   : user?.display_name || '',
      logo,
      tableHTML,
      footerExtra: `${name} · ${this._selectedAccount || ''}`,
    });
  },

  /* مشاركة كشف الحساب (نص) */
  _shareStatement(entries) {
    const name = this._selectedAccountName || '';
    const from = document.getElementById('stmt-from')?.value || '';
    const to   = document.getElementById('stmt-to')?.value   || '';

    const lines = [
      `📄 كشف حساب: ${name}`,
      `🗓️ الفترة: ${from} → ${to}`,
      '─'.repeat(30),
      ...(entries || []).map(e =>
        `${e.date || ''} | ${e.type || ''} | ${e.amount ? Math.round(e.amount).toLocaleString('en-US') + ' ر.س' : ''} | ${e.description || ''}`
      ),
      '─'.repeat(30),
      `نظام أبو حذيفة للصرافة والتحويلات`,
    ].join('\n');

    PrintService.share(lines, { title: `كشف حساب ${name}` });
  },

  // ─────────────────────────────────────────────────────────
  // مودال القيود المحاسبية (بسيط + مزدوج)
  // ─────────────────────────────────────────────────────────
  _buildJournalModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeJournalModal(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '580px';
    box.id = 'journal-box';

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">📝 قيد محاسبي</h3>
        <button class="modal-close" id="journal-close">✕</button>
      </div>

      <!-- نوع القيد -->
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button id="jtype-simple" class="btn btn-primary btn-sm" style="flex:1;">
          🔀 قيد بسيط (حسابان)
        </button>
        <button id="jtype-double" class="btn btn-secondary btn-sm" style="flex:1;">
          ⚖️ قيد مزدوج (متعدد)
        </button>
      </div>

      <!-- القيد البسيط -->
      <div id="journal-simple-form">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">الحساب المدين <span class="required">*</span></label>
            <select id="j-debit-acc" class="form-control"></select>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">الحساب الدائن <span class="required">*</span></label>
            <select id="j-credit-acc" class="form-control"></select>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">المبلغ (ر.س) <span class="required">*</span></label>
            <input id="j-amount" type="number" min="0.01" step="0.01" class="form-control" placeholder="0.00">
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">تاريخ القيد</label>
            <input id="j-date" type="date" class="form-control" value="${getCurrentSaudiDate()}">
          </div>
        </div>
        <div class="form-group" style="margin-bottom:12px;">
          <label class="form-label">البيان / الوصف</label>
          <input id="j-desc" type="text" class="form-control" placeholder="سبب القيد المحاسبي">
        </div>
      </div>

      <!-- القيد المزدوج -->
      <div id="journal-double-form" style="display:none;">
        <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;">
          أدخل سطور القيد — يجب أن يتساوى مجموع المدين مع مجموع الدائن
        </p>
        <div id="journal-lines-container"></div>
        <button id="journal-add-line" class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%;">
          + إضافة سطر
        </button>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">تاريخ القيد</label>
            <input id="jd-date" type="date" class="form-control" value="${getCurrentSaudiDate()}">
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">البيان العام</label>
            <input id="jd-desc" type="text" class="form-control" placeholder="وصف القيد">
          </div>
        </div>
        <div id="journal-balance-indicator" style="margin-top:10px;padding:8px 12px;border-radius:8px;font-size:0.82rem;font-weight:600;text-align:center;"></div>
      </div>

      <div id="journal-error" class="form-error" style="margin-top:8px;"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="journal-save-btn" class="btn btn-primary" style="flex:2;">✅ ترحيل القيد</button>
        <button id="journal-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    overlay.appendChild(box);
    return overlay;
  },

  _currentJournalType: 'simple',

  _openJournalModal(preAccount = null, preAccountName = null) {
    if (!this._journalModal) return;
    this._journalModal.style.display = 'flex';

    /* بناء قائمة الحسابات */
    const accOptions = this._allAccounts.map(a =>
      `<option value="${escapeHtml(a.account_id)}">${escapeHtml(a.name || a.account_id)}</option>`
    ).join('');

    const dSel = document.getElementById('j-debit-acc');
    const cSel = document.getElementById('j-credit-acc');
    if (dSel) dSel.innerHTML = '<option value="">— اختر —</option>' + accOptions;
    if (cSel) cSel.innerHTML = '<option value="">— اختر —</option>' + accOptions;

    /* تعيين الحساب المحدد مسبقاً */
    if (preAccount && dSel) dSel.value = preAccount;

    /* إعادة تعيين الحقول */
    const amtEl  = document.getElementById('j-amount');
    const descEl = document.getElementById('j-desc');
    if (amtEl)  amtEl.value  = '';
    if (descEl) descEl.value = '';
    document.getElementById('journal-error').textContent = '';

    /* نوع القيد: بسيط افتراضياً */
    this._setJournalType('simple');

    /* أحداث تبديل النوع */
    document.getElementById('jtype-simple')?.addEventListener('click', () => this._setJournalType('simple'));
    document.getElementById('jtype-double')?.addEventListener('click', () => this._setJournalType('double'));
    document.getElementById('journal-close')?.addEventListener('click',  () => this._closeJournalModal());
    document.getElementById('journal-cancel-btn')?.addEventListener('click', () => this._closeJournalModal());
    document.getElementById('journal-save-btn')?.addEventListener('click',   () => this._saveJournalEntry());
    document.getElementById('journal-add-line')?.addEventListener('click',   () => this._addJournalLine());

    /* سطران افتراضيان للمزدوج */
    this._initDoubleLines(accOptions);

    if (window.lucide) lucide.createIcons();
  },

  _closeJournalModal() {
    if (this._journalModal) this._journalModal.style.display = 'none';
  },

  _setJournalType(type) {
    this._currentJournalType = type;
    const simple = document.getElementById('journal-simple-form');
    const double = document.getElementById('journal-double-form');
    const btnS   = document.getElementById('jtype-simple');
    const btnD   = document.getElementById('jtype-double');

    if (type === 'simple') {
      if (simple) simple.style.display = '';
      if (double) double.style.display = 'none';
      btnS?.classList.replace('btn-secondary', 'btn-primary');
      btnD?.classList.replace('btn-primary', 'btn-secondary');
    } else {
      if (simple) simple.style.display = 'none';
      if (double) double.style.display = '';
      btnD?.classList.replace('btn-secondary', 'btn-primary');
      btnS?.classList.replace('btn-primary', 'btn-secondary');
    }
  },

  _initDoubleLines(accOptions) {
    const container = document.getElementById('journal-lines-container');
    if (!container) return;
    container.innerHTML = '';
    this._addJournalLine(accOptions);
    this._addJournalLine(accOptions);
  },

  _addJournalLine(accOptions = null) {
    const container = document.getElementById('journal-lines-container');
    if (!container) return;

    if (!accOptions) {
      accOptions = this._allAccounts.map(a =>
        `<option value="${escapeHtml(a.account_id)}">${escapeHtml(a.name || a.account_id)}</option>`
      ).join('');
    }

    const lineIdx = container.children.length;
    const line    = document.createElement('div');
    line.className   = 'journal-line';
    line.style.cssText = 'display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:8px;margin-bottom:8px;align-items:center;';
    line.innerHTML = `
      <select class="jl-account form-control" style="font-size:0.82rem;">
        <option value="">— اختر حساباً —</option>${accOptions}
      </select>
      <input type="number" class="jl-debit form-control" placeholder="مدين" min="0" step="0.01" style="font-size:0.82rem;">
      <input type="number" class="jl-credit form-control" placeholder="دائن" min="0" step="0.01" style="font-size:0.82rem;">
      <button class="btn btn-secondary btn-sm remove-line-btn" title="حذف السطر" style="color:var(--danger);padding:6px 8px;">✕</button>`;

    line.querySelector('.remove-line-btn').addEventListener('click', () => {
      if (container.children.length > 2) {
        line.remove();
        this._updateBalanceIndicator();
      }
    });

    line.querySelector('.jl-debit').addEventListener('input',  () => this._updateBalanceIndicator());
    line.querySelector('.jl-credit').addEventListener('input', () => this._updateBalanceIndicator());

    container.appendChild(line);
  },

  _updateBalanceIndicator() {
    const lines     = document.querySelectorAll('.journal-line');
    let totalDebit  = 0, totalCredit = 0;

    lines.forEach(line => {
      totalDebit  += parseFloat(line.querySelector('.jl-debit')?.value  || 0);
      totalCredit += parseFloat(line.querySelector('.jl-credit')?.value || 0);
    });

    const indicator = document.getElementById('journal-balance-indicator');
    if (!indicator) return;

    const diff = Math.abs(totalDebit - totalCredit);
    if (diff < 0.01) {
      indicator.style.cssText = 'background:rgba(5,150,105,0.1);color:var(--success);border:1px solid rgba(5,150,105,0.3);margin-top:10px;padding:8px 12px;border-radius:8px;font-size:0.82rem;font-weight:600;text-align:center;';
      indicator.textContent = `✅ القيد متوازن — مجموع المدين = مجموع الدائن = ${Math.round(totalDebit).toLocaleString('en-US')} ر.س`;
    } else {
      indicator.style.cssText = 'background:rgba(220,38,38,0.1);color:var(--danger);border:1px solid rgba(220,38,38,0.3);margin-top:10px;padding:8px 12px;border-radius:8px;font-size:0.82rem;font-weight:600;text-align:center;';
      indicator.textContent = `⚠️ غير متوازن — الفرق: ${Math.round(diff).toLocaleString('en-US')} ر.س`;
    }
  },

  async _saveJournalEntry() {
    const errEl   = document.getElementById('journal-error');
    errEl.textContent = '';
    const saveBtn = document.getElementById('journal-save-btn');
    const restore = setButtonLoading(saveBtn);

    try {
      if (this._currentJournalType === 'simple') {
        await this._saveSimpleEntry(errEl);
      } else {
        await this._saveDoubleEntry(errEl);
      }
    } finally {
      restore();
    }
  },

  async _saveSimpleEntry(errEl) {
    const debitAcc  = document.getElementById('j-debit-acc')?.value;
    const creditAcc = document.getElementById('j-credit-acc')?.value;
    const amount    = parseFloat(document.getElementById('j-amount')?.value || 0);
    const date      = document.getElementById('j-date')?.value      || getCurrentSaudiDate();
    const desc      = document.getElementById('j-desc')?.value?.trim() || '';

    if (!debitAcc)         { errEl.textContent = 'اختر الحساب المدين'; return; }
    if (!creditAcc)        { errEl.textContent = 'اختر الحساب الدائن'; return; }
    if (debitAcc === creditAcc) { errEl.textContent = 'لا يمكن أن يكون الحساب المدين والدائن نفسه'; return; }
    if (!amount || amount <= 0) { errEl.textContent = 'المبلغ يجب أن يكون أكبر من صفر'; return; }

    const voucherNum = `JV-${Date.now()}`;
    const entries = [
      { account_id: debitAcc,  debit: amount, credit: 0,      description: desc, date, voucher_number: voucherNum },
      { account_id: creditAcc, debit: 0,      credit: amount, description: desc, date, voucher_number: voucherNum },
    ];

    await this._postEntries(entries, errEl);
  },

  async _saveDoubleEntry(errEl) {
    const lines     = [...document.querySelectorAll('.journal-line')];
    const date      = document.getElementById('jd-date')?.value  || getCurrentSaudiDate();
    const desc      = document.getElementById('jd-desc')?.value?.trim() || '';
    const voucherNum = `JV-${Date.now()}`;

    const entries = [];
    let totalDebit = 0, totalCredit = 0;

    for (const line of lines) {
      const accId  = line.querySelector('.jl-account')?.value;
      const debit  = parseFloat(line.querySelector('.jl-debit')?.value  || 0);
      const credit = parseFloat(line.querySelector('.jl-credit')?.value || 0);

      if (!accId) continue;
      if (debit > 0 && credit > 0) { errEl.textContent = 'كل سطر يجب أن يكون مدين أو دائن فقط، ليس كليهما'; return; }

      entries.push({ account_id: accId, debit, credit, description: desc, date, voucher_number: voucherNum });
      totalDebit  += debit;
      totalCredit += credit;
    }

    if (entries.length < 2)  { errEl.textContent = 'القيد يجب أن يحتوي سطرين على الأقل'; return; }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      errEl.textContent = `القيد غير متوازن — المدين (${Math.round(totalDebit).toLocaleString('en-US')}) ≠ الدائن (${Math.round(totalCredit).toLocaleString('en-US')})`;
      return;
    }

    await this._postEntries(entries, errEl);
  },

  async _postEntries(entries, errEl) {
    try {
      if (isOnline()) {
        /* إرسال عبر RPC ذري */
        const { error } = await supabaseClient.rpc('post_manual_journal_entries', {
          p_entries: entries,
          p_user_id: AuthService.getCurrentUserId(),
        });

        if (error) {
          /* fallback: حفظ محلي وطابور */
          await this._saveEntriesLocally(entries);
          showToast('تم حفظ القيد محلياً وسيُرسل عند الاتصال', 'warning');
        } else {
          /* تحديث الأرصدة المحلية */
          for (const e of entries) {
            const current = await db.account_balances.get(e.account_id);
            const bal     = parseFloat(current?.balance || 0) + e.debit - e.credit;
            await db.account_balances.put({ account_id: e.account_id, balance: bal, last_updated: new Date().toISOString() });
          }
          showToast('✅ تم ترحيل القيد بنجاح', 'success');
        }
      } else {
        await this._saveEntriesLocally(entries);
        showToast('تم حفظ القيد محلياً (غير متصل)', 'warning');
      }

      this._closeJournalModal();
      await this._loadChart();

    } catch (e) {
      errEl.textContent = `فشل ترحيل القيد: ${e.message}`;
    }
  },

  async _saveEntriesLocally(entries) {
    for (const e of entries) {
      const id = generateUUID();
      const record = { ...e, id, sync_status: SYNC_STATUS.PENDING, created_at: new Date().toISOString() };
      await db.account_ledger.put(record);
      await SyncQueue.add(SYNC_ACTIONS.CREATE, 'account_ledger', id, record);

      /* تحديث الرصيد المحلي */
      const current = await db.account_balances.get(e.account_id);
      const bal     = parseFloat(current?.balance || 0) + e.debit - e.credit;
      await db.account_balances.put({ account_id: e.account_id, balance: bal, last_updated: new Date().toISOString() });
    }
  },

  // ─────────────────────────────────────────────────────────
  // مودال إضافة حساب جديد
  // ─────────────────────────────────────────────────────────
  _buildAddModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeAddModal(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '500px';
    box.id = 'acct-add-box';

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">➕ إضافة حساب محاسبي جديد</h3>
        <button class="modal-close" id="acct-add-close">✕</button>
      </div>
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">اختر نوع الحساب:</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-bottom:16px;" id="acct-type-grid">
        ${[
          { type:'company', icon:'🏢', label:'حساب شركة',     desc:'شركة شريكة' },
          { type:'bank',    icon:'🏦', label:'حساب بنكي',      desc:'حساب إيداعات' },
          { type:'expense', icon:'💸', label:'نوع مصروف',      desc:'فئة مصاريف' },
          { type:'custom',  icon:'📋', label:'حساب مخصص',      desc:'رصيد يدوي' },
        ].map(t => `
          <button class="acct-type-btn btn btn-secondary" data-type="${t.type}"
            style="flex-direction:column;padding:12px 8px;gap:4px;height:auto;text-align:center;">
            <span style="font-size:1.5rem;">${t.icon}</span>
            <strong style="font-size:0.82rem;">${t.label}</strong>
            <span style="font-size:0.72rem;color:var(--text-muted);">${t.desc}</span>
          </button>`).join('')}
      </div>

      <!-- نماذج كل نوع -->
      <div id="form-company" style="display:none;">
        <div class="form-group"><label class="form-label">اسم الشركة *</label>
          <input id="add-company-name" type="text" class="form-control" placeholder="اسم الشركة الشريكة"></div>
        <div class="form-group"><label class="form-label">بادئة الحساب (COMP_...) *</label>
          <input id="add-company-prefix" type="text" class="form-control" placeholder="مثال: ARAMCO" dir="ltr" style="text-transform:uppercase;"></div>
      </div>

      <div id="form-bank" style="display:none;">
        <div class="form-group"><label class="form-label">اسم الحساب البنكي *</label>
          <input id="add-bank-name" type="text" class="form-control" placeholder="مثال: بنك الراجحي - فرع الرياض"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group"><label class="form-label">السقف المالي *</label>
            <input id="add-bank-ceiling" type="number" class="form-control" placeholder="0"></div>
          <div class="form-group"><label class="form-label">رقم الحساب</label>
            <input id="add-bank-acc" type="text" class="form-control" dir="ltr"></div>
        </div>
        <div class="form-group"><label class="form-label">اسم حامل البطاقة</label>
          <input id="add-bank-holder" type="text" class="form-control"></div>
      </div>

      <div id="form-expense" style="display:none;">
        <div class="form-group"><label class="form-label">اسم نوع المصروف *</label>
          <input id="add-expense-name" type="text" class="form-control" placeholder="مثال: وقود، إيجار، صيانة"></div>
      </div>

      <div id="form-custom" style="display:none;">
        <div class="form-group"><label class="form-label">اسم الحساب *</label>
          <input id="add-custom-name" type="text" class="form-control" placeholder="اسم وصفي للحساب"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
          <div class="form-group"><label class="form-label">معرف الحساب (ID) *</label>
            <input id="add-custom-id" type="text" class="form-control" dir="ltr" placeholder="CUSTOM_001"
              style="text-transform:uppercase;"></div>
          <div class="form-group"><label class="form-label">رصيد ابتدائي</label>
            <input id="add-custom-balance" type="number" class="form-control" value="0"></div>
        </div>
      </div>

      <div id="acct-add-actions" style="display:none;">
        <div id="acct-add-error" class="form-error" style="margin-bottom:8px;"></div>
        <div style="display:flex;gap:10px;">
          <button id="acct-add-save" class="btn btn-primary" style="flex:2;">حفظ الحساب</button>
          <button id="acct-add-cancel" class="btn btn-secondary" style="flex:1;">إلغاء</button>
        </div>
      </div>`;

    overlay.appendChild(box);

    /* أحداث */
    box.querySelector('#acct-add-close')?.addEventListener('click',  () => this._closeAddModal());
    box.querySelector('#acct-add-cancel')?.addEventListener('click', () => this._closeAddModal());
    box.querySelector('#acct-add-save')?.addEventListener('click',   () => this._saveNewAccount());

    box.querySelectorAll('.acct-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        /* إبراز المحدد */
        box.querySelectorAll('.acct-type-btn').forEach(b => {
          b.classList.replace('btn-primary', 'btn-secondary');
        });
        btn.classList.replace('btn-secondary', 'btn-primary');

        /* إظهار النموذج المناسب */
        ['company', 'bank', 'expense', 'custom'].forEach(t => {
          const f = box.querySelector(`#form-${t}`);
          if (f) f.style.display = t === btn.dataset.type ? '' : 'none';
        });

        const acts = box.querySelector('#acct-add-actions');
        if (acts) acts.style.display = '';
        box.querySelector('#acct-add-error').textContent = '';
        this._currentAddType = btn.dataset.type;
      });
    });

    return overlay;
  },

  _currentAddType: null,

  _openAddModal() {
    if (this._addModal) this._addModal.style.display = 'flex';
    const box = document.getElementById('acct-add-box');
    if (!box) return;

    box.querySelectorAll('.acct-type-btn').forEach(b => b.classList.replace('btn-primary', 'btn-secondary'));
    ['company', 'bank', 'expense', 'custom'].forEach(t => {
      const f = box.querySelector(`#form-${t}`); if (f) f.style.display = 'none';
    });
    const acts = box.querySelector('#acct-add-actions'); if (acts) acts.style.display = 'none';
    box.querySelector('#acct-add-error').textContent = '';
    this._currentAddType = null;
    if (window.lucide) lucide.createIcons();
  },

  _closeAddModal() { if (this._addModal) this._addModal.style.display = 'none'; },

  async _saveNewAccount() {
    const errEl  = document.getElementById('acct-add-error');
    errEl.textContent = '';
    const type   = this._currentAddType;
    const btn    = document.getElementById('acct-add-save');
    const restore = setButtonLoading(btn);

    let result;
    try {
      if (type === 'company') {
        const name   = document.getElementById('add-company-name')?.value.trim();
        const prefix = document.getElementById('add-company-prefix')?.value.trim().toUpperCase();
        if (!name || !prefix) { errEl.textContent = 'الاسم والبادئة مطلوبان'; restore(); return; }
        result = await repo.create('companies', { name, account_prefix: prefix });
        if (isOk(result)) await AppStore.refreshData();

      } else if (type === 'bank') {
        const name    = document.getElementById('add-bank-name')?.value.trim();
        const ceiling = parseFloat(document.getElementById('add-bank-ceiling')?.value);
        if (!name || !ceiling || ceiling < 1) { errEl.textContent = 'الاسم والسقف المالي مطلوبان'; restore(); return; }
        result = await repo.create('bank_accounts', {
          name, financial_ceiling: ceiling,
          account_number: document.getElementById('add-bank-acc')?.value.trim()    || null,
          card_holder   : document.getElementById('add-bank-holder')?.value.trim() || null,
          reset_time    : '00:00:00',
        });
        if (isOk(result)) await AppStore.refreshData();

      } else if (type === 'expense') {
        const name = document.getElementById('add-expense-name')?.value.trim();
        if (!name) { errEl.textContent = 'اسم نوع المصروف مطلوب'; restore(); return; }
        result = await repo.create('expense_accounts', { name });
        if (isOk(result)) await AppStore.refreshData();

      } else if (type === 'custom') {
        const name    = document.getElementById('add-custom-name')?.value.trim();
        const accId   = document.getElementById('add-custom-id')?.value.trim().toUpperCase();
        const balance = parseFloat(document.getElementById('add-custom-balance')?.value || 0);
        if (!name || !accId) { errEl.textContent = 'الاسم والمعرف مطلوبان'; restore(); return; }

        const record = { account_id: accId, balance, last_updated: new Date().toISOString() };
        if (isOnline()) {
          const { error } = await supabaseClient
            .from('account_balances')
            .upsert(record, { onConflict: 'account_id' });
          result = error ? { ok: false, error: error.message } : { ok: true, data: {} };
        } else {
          await db.account_balances.put(record);
          await SyncQueue.add(SYNC_ACTIONS.CREATE, 'account_balances', accId, record);
          result = { ok: true, data: {} };
        }
      } else {
        errEl.textContent = 'اختر نوع الحساب أولاً';
        restore(); return;
      }

      restore();
      if (isOk(result)) {
        showToast('✅ تم إضافة الحساب بنجاح', 'success');
        this._closeAddModal();
        await this._loadChart();
      } else {
        errEl.textContent = result.error || 'فشل الحفظ';
      }
    } catch (e) {
      restore();
      errEl.textContent = `خطأ: ${e.message}`;
    }
  },
};

window.AccountManagementComponent = AccountManagementComponent;
console.log('✅ AccountManagementComponent v4.0 — مركز الحسابات الشامل');
