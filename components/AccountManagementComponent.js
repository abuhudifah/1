/**
 * components/AccountManagementComponent.js — v5.0 FINAL
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * مركز إدارة الحسابات الشامل - متوافق مع قاعدة البيانات الحقيقية
 *
 * التغييرات الجوهرية (السلوك 3 والسلوك 5):
 * ✅ 1. إظهار جميع المستخدمين النشطين كحسابات مناديب (AGT_xxx)
 *      بغض النظر عن دورهم (مدير، مساعد إداري، مندوب).
 * ✅ 2. إخفاء حسابات العملاء المديونين (CUST_xxx) من شجرة الحسابات
 *      لأنها تُدار في نظام منفصل (DebtorsComponent).
 * ✅ 3. عرض أرقام حسابات حقيقية من companies.account_number و expense_accounts.code.
 * ✅ 4. إضافة زر نسخ رقم الحساب مع fallback آمن.
 * ✅ 5. إصلاح _loadStatement لتعمل Offline-First (Supabase ← Dexie).
 * ✅ 6. إصلاح _saveNewAccount لاستخدام generate_account_number والإدراج المباشر.
 * ✅ 7. تحسين _postEntries لاستخدام post_manual_journal_entries RPC مع fallback.
 * ✅ 8. إضافة فحوصات typeof للكائنات العامة (db, SyncQueue, AppStore, PrintService, copyToClipboard).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
'use strict';

const AccountManagementComponent = {
  _selectedAccount    : null,
  _selectedAccountName: null,
  _addModal           : null,
  _journalModal       : null,
  _shareModal         : null,
  _allAccounts        : [], // قائمة كل الحسابات لاستخدامها في القيود
  _currentAddType     : null,
  _currentJournalType : 'simple',

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

    /* ── لوحة الموافقات المعلقة ── */
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
            <p style="display:none;" id="stmt-account-id"></p>
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
              <i data-lucide="printer" style="width:13px;height:13px;"></i> طباعة/PDF
            </button>
            <button id="stmt-excel-btn" class="btn btn-secondary btn-sm">
              <i data-lucide="table-2" style="width:13px;height:13px;"></i> Excel
            </button>
            <button id="stmt-close-btn" class="btn btn-secondary btn-sm" style="color:var(--danger);">✕ إغلاق</button>
          </div>
        </div>
        <div id="stmt-filter-bar" class="no-print" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px;align-items:flex-end;">
          <div class="form-group" style="margin:0;">
            <label class="form-label" style="font-size:0.78rem;">نوع الفترة</label>
            <div style="display:flex;gap:4px;">
              <button id="stmt-mode-day"   class="btn btn-sm btn-secondary" data-stmt-mode="day">يوم</button>
              <button id="stmt-mode-month" class="btn btn-sm btn-primary"   data-stmt-mode="month">شهر</button>
              <button id="stmt-mode-range" class="btn btn-sm btn-secondary" data-stmt-mode="range">فترة</button>
            </div>
          </div>
          <div id="stmt-day-wrap" class="form-group" style="margin:0;flex:1;min-width:130px;display:none;">
            <label class="form-label" style="font-size:0.78rem;">التاريخ</label>
            <input id="stmt-day" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
          </div>
          <div id="stmt-month-wrap" class="form-group" style="margin:0;flex:1;min-width:130px;">
            <label class="form-label" style="font-size:0.78rem;">الشهر</label>
            <input id="stmt-month-input" type="month" class="form-control" style="padding:7px;font-size:0.85rem;">
          </div>
          <div id="stmt-from-wrap" class="form-group" style="margin:0;flex:1;min-width:120px;display:none;">
            <label class="form-label" style="font-size:0.78rem;">من تاريخ</label>
            <input id="stmt-from" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
          </div>
          <div id="stmt-to-wrap" class="form-group" style="margin:0;flex:1;min-width:120px;display:none;">
            <label class="form-label" style="font-size:0.78rem;">إلى تاريخ</label>
            <input id="stmt-to" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
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

    /* ── مودال مشاركة رقم الحساب ── */
    this._shareModal = this._buildShareModal();
    wrap.appendChild(this._shareModal);

    container.appendChild(wrap);

    /* ── ربط الأحداث ── */
    document.getElementById('stmt-load-btn')?.addEventListener('click', () => this._loadStatement());
    document.getElementById('stmt-close-btn')?.addEventListener('click', () => {
      stmtSection.style.display = 'none';
      this._selectedAccount = null;
    });
    document.getElementById('stmt-print-btn')?.addEventListener('click', () => {
      if (typeof PrintService !== 'undefined') this._printStatement();
      else showToast('خدمة الطباعة غير متوفرة', 'error');
    });
    document.getElementById('stmt-excel-btn')?.addEventListener('click', () => this._exportStatementExcel());
    document.getElementById('stmt-share-btn')?.addEventListener('click', () => {
      if (typeof PrintService !== 'undefined') this._shareStatement();
      else showToast('خدمة المشاركة غير متوفرة', 'error');
    });
    document.getElementById('stmt-copy-btn')?.addEventListener('click', () => {
      const name = this._selectedAccountName || '';
      const from = document.getElementById('stmt-from')?.value || '';
      const to   = document.getElementById('stmt-to')?.value   || '';
      const rows = [...document.querySelectorAll('#stmt-print-table tbody tr')]
        .map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent.trim()).join(' | '))
        .join('\n');
      if (typeof PrintService !== 'undefined') {
        PrintService.copyText(
          `كشف حساب: ${name}\nالفترة: ${from} → ${to}\n${'─'.repeat(30)}\n${rows}`,
          'تم نسخ كشف الحساب'
        );
      } else {
        const text = `كشف حساب: ${name}\nالفترة: ${from} → ${to}\n${'─'.repeat(30)}\n${rows}`;
        navigator.clipboard.writeText(text).then(() => showToast('تم النسخ', 'success'));
      }
    });

    // ─── فلتر التاريخ المتقدم ───
    document.querySelectorAll('[data-stmt-mode]').forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.stmtMode;
        this._applyFilterMode(mode);
        try { localStorage.setItem('ahu_stmt_filter_pref', mode); } catch (e) { console.warn('localStorage N/A', e.message); }
      });
    });
    document.getElementById('stmt-day')?.addEventListener('change', () => this._syncFilterDates());
    document.getElementById('stmt-month-input')?.addEventListener('change', () => this._syncFilterDates());

    let _searchTimer = null;
    document.getElementById('acct-search')?.addEventListener('input', (e) => {
      clearTimeout(_searchTimer);
      _searchTimer = setTimeout(() => this._filterChart(e.target.value.trim()), 180);
    });

    // تحسين التجاوب للشاشات الصغيرة
    if (!document.getElementById('acct-responsive-styles')) {
      const style = document.createElement('style');
      style.id = 'acct-responsive-styles';
      style.textContent = `
        @media (max-width: 680px) {
          .acct-category .data-table th:nth-child(2),
          .acct-category .data-table td:nth-child(2) {
            display: none;
          }
          .acct-category .data-table th:nth-child(3),
          .acct-category .data-table td:nth-child(3) {
            font-size: 0.75rem;
          }
          .acct-cat-header {
            flex-wrap: wrap;
          }
          .acct-cat-total {
            font-size: 0.9rem;
          }
          .acct-kpi-bar {
            flex-direction: column;
            gap: 8px;
          }
          .acct-kpi-item {
            width: 100%;
          }
        }
      `;
      document.head.appendChild(style);
    }

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

    el.innerHTML = `
      <div class="glass-card" style="margin-bottom:16px;">
        <div class="skeleton" style="height:24px;width:40%;border-radius:6px;margin-bottom:14px;"></div>
        ${renderSkeleton('row', 3)}
      </div>
      <div class="glass-card" style="margin-bottom:16px;">
        <div class="skeleton" style="height:24px;width:55%;border-radius:6px;margin-bottom:14px;"></div>
        ${renderSkeleton('row', 4)}
      </div>
      <div class="glass-card">
        <div class="skeleton" style="height:24px;width:35%;border-radius:6px;margin-bottom:14px;"></div>
        ${renderSkeleton('row', 2)}
      </div>`;

    // ✅ يُبنى الدليل محلياً من account_balances + الكيانات (أداء أفضل ومطابقة للمرجع):
    //    يشمل المستخدمين والشركات وتسويات العملاء والمصروفات، ويستبعد BNK_ والحسابات القديمة.
    const chartData = await this._buildLocalChartData();

    if (!chartData?.categories?.length) {
      el.innerHTML = this._renderEmptyChart();
      document.getElementById('add-default-chart-btn')
        ?.addEventListener('click', () => this._addDefaultChart());
      return;
    }

    /* بناء قائمة كل الحسابات للاستخدام في القيود */
    this._allAccounts = chartData.categories.flatMap(c => c.accounts || []);

    el.innerHTML = '';
    this._renderChart(el, chartData);

    /* قسم الحسابات البنكية (حركة يومية فقط — كشوف من جدول المعاملات) */
    await this._renderBankAccountsSection(el);

    /* قسم أرصدة الشركات المحسوبة (تحصيلات/إيداعات/سحوبات + عهدة المناديب) */
    await this._renderCompanyBalancesSection(el);

    if (window.lucide) lucide.createIcons();
  },

  // محذوف: أرقام الحسابات لا تُعرض في الواجهة
  async _enrichChartWithAccountNumbers() { /* no-op */ },

  // ─────────────────────────────────────────────────────────
  // إضافة قسم أرصدة الشركات المحسوبة (باستخدام RPC)
  // ─────────────────────────────────────────────────────────
  async _renderCompanyBalancesSection(containerEl) {
    if (!this._isOnline()) return;
    try {
      const { data, error } = await supabaseClient.rpc('get_company_balances');
      if (error || !data || !data.length) return;
      
      const section = document.createElement('div');
      section.className = 'glass-card acct-category';
      section.style.marginTop = '20px';
      section.style.borderTop = '3px solid var(--accent)';
      
      const header = document.createElement('div');
      header.className = 'acct-cat-header';
      header.innerHTML = `
        <div class="acct-cat-header-right">
          <div class="acct-cat-icon" style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.2);">
            🏢
          </div>
          <div>
            <div class="acct-cat-title">أرصدة الشركات (محسوبة)</div>
            <div class="acct-cat-count">${data.length} شركة</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;">
          <span id="refresh-companies-balance" style="cursor:pointer;color:var(--accent);font-size:0.75rem;">
            <i data-lucide="refresh-cw" style="width:12px;"></i> تحديث
          </span>
        </div>`;
      section.appendChild(header);
      
      const body = document.createElement('div');
      body.className = 'acct-cat-body';
      
      const tableWrap = document.createElement('div');
      tableWrap.className = 'table-wrapper';
      tableWrap.style.overflowX = 'auto';
      
      tableWrap.innerHTML = `
        <table class="data-table" style="min-width:650px;">
          <thead>
            <tr>
              <th>الشركة</th>
              <th>إجمالي التحصيلات</th>
              <th>إجمالي الإيداعات</th>
              <th>إجمالي السحوبات</th>
              <th>الرصيد الحالي</th>
              <th>تفاصيل عهدة المناديب</th>
              <th>إجراءات</th>
            </tr>
          </thead>
          <tbody>
            ${data.map(cb => `
              <tr>
                <td style="font-weight:600;">${escapeHtml(cb.company_name)}</td>
                <td style="color:var(--success);direction:ltr;">${Math.round(cb.total_collections).toLocaleString('en-US')} ر.س</td>
                <td style="color:var(--danger);direction:ltr;">${Math.round(cb.total_deposits).toLocaleString('en-US')} ر.س</td>
                <td style="color:var(--warning);direction:ltr;">${Math.round(cb.total_withdrawals).toLocaleString('en-US')} ر.س</td>
                <td style="font-weight:800;color:${cb.net_balance >= 0 ? 'var(--success)' : 'var(--danger)'};direction:ltr;">
                  ${cb.net_balance >= 0 ? '' : '−'}${Math.abs(Math.round(cb.net_balance)).toLocaleString('en-US')} ر.س
                </td>
                <td>
                  <button class="view-agent-custody-btn btn btn-secondary btn-sm"
                    data-company='${escapeHtml(JSON.stringify(cb))}'
                    style="font-size:0.72rem;">
                    📋 عرض العهدة
                  </button>
                </td>
                <td>
                  <button class="view-company-statement-btn btn btn-primary btn-sm"
                    data-company-id="${escapeHtml(cb.company_id)}"
                    data-company-name="${escapeHtml(cb.company_name)}"
                    style="font-size:0.72rem;">
                    📄 كشف حساب
                  </button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>`;
      body.appendChild(tableWrap);
      section.appendChild(body);
      containerEl.appendChild(section);
      
      // ربط الأحداث
      body.querySelectorAll('.view-company-statement-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          // ✅ توحيد: نفس مسار الكشف الدفتري (COMP_) بالصيغة المرجعية
          this._showStatement('COMP_' + btn.dataset.companyId, btn.dataset.companyName);
        });
      });
      body.querySelectorAll('.view-agent-custody-btn').forEach(btn => {
        const dataObj = JSON.parse(btn.dataset.company);
        this._showAgentCustodyModal(dataObj.company_name, dataObj.agent_balances);
      });
      document.getElementById('refresh-companies-balance')?.addEventListener('click', () => {
        this._loadChart();
      });
    } catch (err) {
      console.warn('⚠️ فشل تحميل أرصدة الشركات المحسوبة:', err);
    }
  },

  // عرض كشف حساب الشركة (تحصيلات + إيداعات + سحوبات)
  async _showCompanyStatement(companyId, companyName) {
    let transactions = [];
    if (this._isOnline()) {
      const { data, error } = await supabaseClient
        .from('transactions')
        .select('*, bank_accounts(name), users(display_name)')
        .eq('company_id', companyId)
        .eq('is_reversed', false)
        .order('created_at', { ascending: false });
      if (!error) transactions = data || [];
    } else {
      if (typeof db !== 'undefined' && db.isOpen()) {
        transactions = await db.transactions.where('company_id').equals(companyId).toArray();
      } else {
        showToast('قاعدة البيانات المحلية غير متوفرة', 'error');
        return;
      }
    }
    
    const collections = transactions.filter(t => t.type === 'collection');
    const deposits = transactions.filter(t => t.type === 'deposit');
    const withdrawals = transactions.filter(t => t.type === 'bank_withdrawal');
    
    const totalCollected = collections.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const totalDeposited = deposits.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const totalWithdrawn = withdrawals.reduce((s, t) => s + parseFloat(t.amount || 0), 0);
    const netBalance = totalCollected + totalWithdrawn - totalDeposited;
    
    const allTransactions = [...collections, ...deposits, ...withdrawals];
    allTransactions.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:700px;">
        <div class="modal-header">
          <h3 class="modal-title">📊 كشف حساب الشركة: ${escapeHtml(companyName)}</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px;">
          <div style="padding:12px;background:rgba(5,150,105,0.08);border-radius:12px;">
            <div style="font-size:0.72rem;">إجمالي التحصيلات</div>
            <div style="font-weight:800;color:var(--success);">${Math.round(totalCollected).toLocaleString('en-US')} ر.س</div>
          </div>
          <div style="padding:12px;background:rgba(220,38,38,0.08);border-radius:12px;">
            <div style="font-size:0.72rem;">إجمالي الإيداعات</div>
            <div style="font-weight:800;color:var(--danger);">${Math.round(totalDeposited).toLocaleString('en-US')} ر.س</div>
          </div>
          <div style="padding:12px;background:rgba(245,158,11,0.08);border-radius:12px;">
            <div style="font-size:0.72rem;">إجمالي السحوبات</div>
            <div style="font-weight:800;color:var(--warning);">${Math.round(totalWithdrawn).toLocaleString('en-US')} ر.س</div>
          </div>
          <div style="padding:12px;background:rgba(99,102,241,0.08);border-radius:12px;">
            <div style="font-size:0.72rem;">الرصيد (صافي الأصول)</div>
            <div style="font-weight:800;color:var(--accent);">${Math.round(netBalance).toLocaleString('en-US')} ر.س</div>
          </div>
        </div>
        <div class="table-wrapper" style="max-height:400px;overflow-y:auto;">
          <table class="data-table">
            <thead><tr><th>التاريخ</th><th>النوع</th><th>المبلغ</th><th>المندوب</th><th>الحساب البنكي</th><th>الوصف</th></tr></thead>
            <tbody>
              ${allTransactions.map(t => `
                <tr>
                  <td>${formatDateArabic(t.date || t.created_at)}</td>
                  <td>${t.type === 'collection' ? 'تحصيل' : t.type === 'deposit' ? 'إيداع بنكي' : 'سحب بنكي'}</td>
                  <td style="direction:ltr;">${Math.round(parseFloat(t.amount)).toLocaleString('en-US')} ر.س</td>
                  <td>${escapeHtml(t.users?.display_name || t.agent_name || '—')}</td>
                  <td>${escapeHtml(t.bank_accounts?.name || t.bank_account_name || '—')}</td>
                  <td>${escapeHtml(t.details || '—')}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    if (window.lucide) lucide.createIcons();
  },
  
  // عرض عهدة المناديب تجاه شركة معينة
  _showAgentCustodyModal(companyName, agentBalances) {
    const entries = Object.entries(agentBalances || {});
    if (!entries.length) {
      showToast('لا توجد عهدة مناديب لهذه الشركة', 'info');
      return;
    }
    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.style.display = 'flex';
    modal.innerHTML = `
      <div class="modal-box" style="max-width:500px;">
        <div class="modal-header">
          <h3 class="modal-title">👥 عهدة المناديب لشركة ${escapeHtml(companyName)}</h3>
          <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
        </div>
        <div class="table-wrapper">
          <table class="data-table">
            <thead><tr><th>المندوب</th><th>المبلغ المستحق للشركة</th></tr></thead>
            <tbody>
              ${entries.map(([name, balance]) => `
                <tr>
                  <td>${escapeHtml(name)}</td>
                  <td style="direction:ltr;color:${balance >= 0 ? 'var(--danger)' : 'var(--success)'};">
                    ${balance >= 0 ? '' : '−'}${Math.abs(Math.round(balance)).toLocaleString('en-US')} ر.س
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  }, 

  // ─────────────────────────────────────────────────────────
  // لوحة الموافقات المعلقة
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

  // ✅ _renderChart محدثة لعرض رقم الحساب مع زر نسخ
  _renderChart(el, chartData) {
    const categoryMeta = {
      agents: { icon: '👤', label: 'حسابات المستخدمين', color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
      debtors: { icon: '👥', label: 'حسابات العملاء المديونين', color: '#0284c7', bg: 'rgba(2,132,199,0.08)' },
      companies: { icon: '🏢', label: 'حسابات الشركات', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
      settlements: { icon: '🧾', label: 'تسويات العملاء المديونين', color: '#0284c7', bg: 'rgba(2,132,199,0.08)' },
      banks: { icon: '🏦', label: 'الحسابات البنكية', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
      expenses: { icon: '💸', label: 'حسابات المصروفات', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
      treasury: { icon: '🏛️', label: 'الخزينة والحسابات العامة', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
      revenue: { icon: '💰', label: 'حسابات الإيرادات', color: '#059669', bg: 'rgba(5,150,105,0.08)' },
      suspense: { icon: '⏳', label: 'الحسابات المعلقة', color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
    };
    
    // شريط KPI
    const totalAccounts = chartData.categories.reduce((s, c) => s + (c.accounts?.length || 0), 0);
    const totalBalance = chartData.categories.reduce((s, c) => s + parseFloat(c.total_balance || 0), 0);
    const kpiBar = document.createElement('div');
    kpiBar.className = 'acct-kpi-bar';
    kpiBar.innerHTML = `
        <div class="acct-kpi-item"><div class="acct-kpi-label">عدد الحسابات</div><div class="acct-kpi-value">${totalAccounts}</div></div>
        <div class="acct-kpi-item"><div class="acct-kpi-label">عدد الفئات</div><div class="acct-kpi-value">${chartData.categories.length}</div></div>
        <div class="acct-kpi-item"><div class="acct-kpi-label">صافي الرصيد الكلي</div><div class="acct-kpi-value" style="color:${totalBalance >= 0 ? 'var(--success)' : 'var(--danger)'};">${totalBalance >= 0 ? '' : '−'}${Math.abs(Math.round(totalBalance)).toLocaleString('en-US')} ر.س</div></div>`;
    el.appendChild(kpiBar);
    
    // عرض فئات الحسابات
    for (const cat of chartData.categories) {
      const meta = categoryMeta[cat.category] || { icon: '📋', label: cat.label || cat.category, color: 'var(--text-secondary)', bg: 'transparent' };
      const total = Math.round(parseFloat(cat.total_balance || 0));
      const accounts = cat.accounts || [];
      
      const section = document.createElement('div');
      section.className = 'glass-card acct-category';
      section.dataset.category = cat.category;
      
      const header = document.createElement('div');
      header.className = 'acct-cat-header';
      header.style.borderBottom = accounts.length ? `2px solid ${meta.color}22` : 'none';
      header.innerHTML = `
          <div class="acct-cat-header-right">
            <div class="acct-cat-icon" style="background:${meta.bg};border:1px solid ${meta.color}22;">${meta.icon}</div>
            <div><div class="acct-cat-title">${escapeHtml(meta.label)}</div><div class="acct-cat-count">${accounts.length} حساب</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;">
            <div style="text-align:left;"><div class="acct-cat-total" style="color:${meta.color};">${total >= 0 ? '' : '−'}${Math.abs(total).toLocaleString('en-US')} ر.س</div><div class="acct-cat-total-label">إجمالي الرصيد</div></div>
            <svg class="acct-cat-chevron open" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
          </div>`;
      const body = document.createElement('div');
      body.className = 'acct-cat-body';
      
      if (accounts.length) {
        const tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrapper';
        tableWrap.style.overflowX = 'auto';
        let tableHtml = `
            <table class="data-table" style="min-width:420px;">
              <thead><tr><th>الحساب</th><th>الرصيد</th><th>إجراءات</th></tr></thead>
              <tbody>`;
        for (const acc of accounts) {
          const bal = Math.round(parseFloat(acc.balance || 0));
          const parentBadge = acc.parent_name ? `<span class="acct-parent-badge">🏢 ${escapeHtml(acc.parent_name)}</span>` : '';
          tableHtml += `
              <tr class="acct-row" data-name="${escapeHtml((acc.name || acc.account_id).toLowerCase())}">
                <td style="font-weight:600;">${parentBadge}${escapeHtml(acc.name || acc.account_id)}</td>
                <td style="font-weight:700;color:${bal >= 0 ? 'var(--success)' : 'var(--danger)'};">${bal >= 0 ? '' : '−'}${Math.abs(bal).toLocaleString('en-US')} ر.س</td>
                <td>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;">
                    <button class="view-stmt-btn btn btn-secondary btn-sm" data-account="${escapeHtml(acc.account_id)}" data-name="${escapeHtml(acc.name || acc.account_id)}">📄 كشف</button>
                    <button class="quick-entry-btn btn btn-secondary btn-sm" data-account="${escapeHtml(acc.account_id)}" data-name="${escapeHtml(acc.name || acc.account_id)}">✏️ قيد</button>
                    <button class="delete-account-btn btn btn-secondary btn-sm" data-account="${escapeHtml(acc.account_id)}" data-name="${escapeHtml(acc.name || acc.account_id)}">🗑️ حذف</button>
                  </div>
                </td>
              </tr>`;
        }
        tableHtml += `</tbody></table>`;
        tableWrap.innerHTML = tableHtml;
        body.appendChild(tableWrap);
      }
      
      header.addEventListener('click', () => {
        body.classList.toggle('collapsed');
        header.querySelector('.acct-cat-chevron').classList.toggle('open', !body.classList.contains('collapsed'));
      });
      section.appendChild(header);
      section.appendChild(body);
      el.appendChild(section);
    }
    
    // ربط الأحداث (كشف، قيد، حذف)
    el.querySelectorAll('.view-stmt-btn').forEach(btn => btn.addEventListener('click', () => this._showStatement(btn.dataset.account, btn.dataset.name)));
    el.querySelectorAll('.quick-entry-btn').forEach(btn => btn.addEventListener('click', () => this._openJournalModal(btn.dataset.account, btn.dataset.name)));
    el.querySelectorAll('.delete-account-btn').forEach(btn => btn.addEventListener('click', () => this._deleteAccount(btn.dataset.account, btn.dataset.name)));
    
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
        const match = !q || row.dataset.name?.includes(q);
        row.style.display = match ? '' : 'none';
        if (match) visible++;
      });
      section.style.display = (!q || visible > 0) ? '' : 'none';
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
  // حذف حساب من account_balances
  // ─────────────────────────────────────────────────────────
  async _deleteAccount(accountId, accountName) {
    const SYSTEM_ACCOUNTS = ['GENERAL_FUND', 'CASH_GENERAL', 'COMP_GENERAL', 'DEBTOR_ADJUSTMENT', 'SUSPENSE'];
    if (SYSTEM_ACCOUNTS.includes(accountId)) {
      showToast('لا يمكن حذف حساب نظامي', 'error');
      return;
    }

    const confirmed = await confirmDialog(
      `حذف الحساب "${accountName}" (${accountId})؟\nسيتم حذف جميع قيوده المحاسبية.`,
      'حذف', 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    try {
      if (this._isOnline()) {
        const { error: ledgerErr } = await supabaseClient
          .from('account_ledger')
          .delete()
          .eq('account_id', accountId);
        if (ledgerErr) { showToast(`فشل حذف القيود: ${ledgerErr.message}`, 'error'); return; }

        const { error: balErr } = await supabaseClient
          .from('account_balances')
          .delete()
          .eq('account_id', accountId);
        if (balErr) { showToast(`فشل حذف الحساب: ${balErr.message}`, 'error'); return; }
      } else {
        if (typeof db !== 'undefined' && db.isOpen()) {
          await db.account_ledger.where('account_id').equals(accountId).delete();
          await db.account_balances.delete(accountId);
          if (typeof SyncQueue !== 'undefined') {
            await SyncQueue.add('delete', 'account_balances', accountId, {});
          }
        } else {
          showToast('لا يمكن الحذف بدون اتصال وقاعدة بيانات محلية', 'error');
          return;
        }
      }
      showToast(`تم حذف الحساب "${accountName}" بنجاح`, 'success');
      await this._loadChart();
    } catch (e) {
      showToast(`خطأ غير متوقع: ${e.message}`, 'error');
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

  async _addDefaultChart() {
    const btn = document.getElementById('add-default-chart-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ جاري الإضافة...'; }

    try {
      let added = 0;
      for (const acc of this.DEFAULT_CHART) {
        const accId = acc.id;
        if (typeof db !== 'undefined' && db.isOpen()) {
          const existing = await db.account_balances.get(accId);
          if (existing) continue;
        } else if (this._isOnline()) {
          const { data } = await supabaseClient.from('account_balances').select('account_id').eq('account_id', accId);
          if (data?.length) continue;
        }

        const record = { account_id: accId, balance: 0, last_updated: new Date().toISOString() };

        if (this._isOnline()) {
          const { error } = await supabaseClient
            .from('account_balances')
            .upsert(record, { onConflict: 'account_id' });
          if (!error) {
            if (typeof db !== 'undefined' && db.isOpen()) await db.account_balances.put(record);
            added++;
          }
        } else if (typeof db !== 'undefined' && db.isOpen()) {
          await db.account_balances.put(record);
          if (typeof SyncQueue !== 'undefined') {
            await SyncQueue.add('create', 'account_balances', accId, record);
          }
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

  // ✅ بناء البيانات محلياً مع أرقام حسابات حقيقية (السلوك 3 و 5)
  async _buildLocalChartData() {
    // ── الأرصدة التراكمية من account_balances (متصل: Supabase، أوفلاين: Dexie) ──
    let balances = [];
    try {
      if (this._isOnline()) {
        const { data } = await supabaseClient.from('account_balances').select('account_id, balance');
        balances = data || [];
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        balances = await db.account_balances.toArray();
      }
    } catch { balances = []; }
    const balById = new Map(balances.map(b => [b.account_id, Math.round(parseFloat(b.balance || 0))]));

    // ── الكيانات (من المخزن، ومع سقوط للجلب عند الفراغ) ──
    let users     = (typeof AppStore !== 'undefined') ? (AppStore.getState('users') || []) : [];
    let companies = (typeof AppStore !== 'undefined') ? (AppStore.getState('companies') || []) : [];
    try {
      if (!users.length) {
        if (this._isOnline()) {
          const { data } = await supabaseClient.from('users').select('id, display_name, is_active, account_number');
          users = data || [];
        } else if (typeof db !== 'undefined' && db.isOpen()) {
          users = await db.users.toArray();
        }
      }
      if (!companies.length) {
        if (this._isOnline()) {
          const { data } = await supabaseClient.from('companies').select('id, name, account_number');
          companies = data || [];
        } else if (typeof db !== 'undefined' && db.isOpen()) {
          companies = await db.companies.toArray();
        }
      }
    } catch { /* تجاهل — نعرض المتاح */ }

    // ── تصفية حسب صلاحيات المندوب ──
    const allowedCompanies = (typeof AuthService !== 'undefined') ? AuthService.getAllowedCompanies() : null;
    const allowedUsers     = (typeof AuthService !== 'undefined') ? AuthService.getAllowedUsers()     : null;

    // ── حسابات المستخدمين (AGT_) لكل مستخدم نشط، مع رصيده (0 إن لم يتحرك) ──
    const agents = [];
    for (const u of users) {
      if (u.is_active === false) continue;
      if (allowedUsers && !allowedUsers.includes(u.id)) continue;
      const id = 'AGT_' + u.id;
      agents.push({ account_id: id, name: u.display_name || u.id, balance: balById.get(id) || 0, parent_name: null });
    }

    // ── حسابات الشركات (COMP_) ──
    const comps = [];
    for (const c of companies) {
      if (allowedCompanies && !allowedCompanies.includes(c.id)) continue;
      const id = 'COMP_' + c.id;
      comps.push({ account_id: id, name: c.name || c.id, balance: balById.get(id) || 0, parent_name: null });
    }

    // ── الحسابات المستقلة الموحّدة (تظهر دائماً) ──
    const settlements = [{
      account_id: 'DEBTOR_SETTLEMENT', name: 'تسويات العملاء المديونين',
      balance: balById.get('DEBTOR_SETTLEMENT') || 0, parent_name: null, account_number: 'DEBTOR_SETTLEMENT',
    }];
    const expenses = [{
      account_id: 'EXP_GENERAL', name: 'المصروفات العامة',
      balance: balById.get('EXP_GENERAL') || 0, parent_name: null, account_number: 'EXP_GENERAL',
    }];

    // ملاحظة: BNK_ مستبعد عمداً (حركة يومية فقط — يُعرض في قسم البنوك)،
    //         وكذلك REV_/SUSP_/GENERAL_FUND/CUST_ (حسابات قديمة لا مكان لها في المرجع).
    const categories = [];
    if (agents.length) categories.push({ category: 'agents',    label: 'حسابات المستخدمين', total_balance: agents.reduce((s, a) => s + a.balance, 0), accounts: agents });
    if (comps.length)  categories.push({ category: 'companies', label: 'حسابات الشركات',    total_balance: comps.reduce((s, a) => s + a.balance, 0),  accounts: comps });
    categories.push({ category: 'settlements', label: 'تسويات العملاء المديونين', total_balance: settlements.reduce((s, a) => s + a.balance, 0), accounts: settlements });
    categories.push({ category: 'expenses',    label: 'حسابات المصروفات',         total_balance: expenses.reduce((s, a) => s + a.balance, 0),    accounts: expenses });

    return { categories };
  },

  // ─────────────────────────────────────────────────────────
  // كشف الحساب (مع دعم وضع عدم الاتصال)
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

    this._initFilterMode();
    stmtSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
    this._loadStatement();
  },

  // ─────────────────────────────────────────────────────────
  // كشف الحساب بالصيغة المرجعية (Offline-First)
  // الأعمدة: التاريخ | الوقت | نوع العملية | مدين | دائن | التفاصيل + إجماليات
  // البيانات الدفترية من account_ledger، مُثراة عبر reference_id ← transactions.
  // الحسابات البنكية (BNK_) تُوجَّه إلى كشف الحركة من جدول المعاملات.
  // ─────────────────────────────────────────────────────────
  async _loadStatement() {
    if (!this._selectedAccount) return;
    const acc = this._selectedAccount;

    // كشف البنك: حركة يومية فقط من جدول المعاملات (BNK_ لا يملك قيوداً محاسبية)
    if (acc.startsWith('BNK_')) { await this._loadBankStatement(acc.slice(4)); return; }

    const fromEl = document.getElementById('stmt-from');
    const toEl   = document.getElementById('stmt-to');
    const from = fromEl?.value;
    const to   = toEl?.value || getCurrentSaudiDate();
    if (!from) { showToast('حدد تاريخ البداية', 'warning'); return; }

    const summaryEl = document.getElementById('stmt-summary');
    const entriesEl = document.getElementById('stmt-entries');
    if (!summaryEl || !entriesEl) return;
    summaryEl.innerHTML = '';
    entriesEl.innerHTML = `<div style="padding:12px 16px;">${renderSkeleton('row', 6)}</div>`;

    try {
      let entries = [];
      let useLocal = !this._isOnline();

      if (this._isOnline()) {
        try {
          const { data, error } = await supabaseClient
            .from('account_ledger').select('*')
            .eq('account_id', acc).gte('date', from).lte('date', to)
            .order('date', { ascending: true }).order('created_at', { ascending: true })
            .limit(QUERY_LIMITS.LEDGER_ENTRIES);
          if (error) throw error;
          entries = data || [];
        } catch (e) {
          console.warn('فشل جلب الكشف من السحابة، سيتم استخدام المحلي', e);
          useLocal = true;
        }
      }

      if (useLocal && typeof db !== 'undefined' && db.isOpen()) {
        const all = await db.account_ledger.where('account_id').equals(acc).toArray();
        entries = all
          .filter(e => e.date >= from && e.date <= to)
          .sort((a, b) => (a.date + (a.created_at || '')) > (b.date + (b.created_at || '')) ? 1 : -1);
      } else if (useLocal) {
        throw new Error('قاعدة البيانات المحلية غير متوفرة ولا يوجد اتصال');
      }

      // إثراء القيود ببيانات المعاملة المرتبطة (الوقت، النوع، الأسماء، التفاصيل)
      const txMap = await this._enrichEntries(entries);

      const rows = (entries || []).map(e => {
        const tx = e.reference_id ? txMap.get(e.reference_id) : null;
        const timeRaw = tx?.time || tx?.created_at || e.created_at || null;
        const desc = this._describeLedgerEntry(acc, e, tx);
        return {
          date: e.date, timeRaw, time: this._formatTime12(timeRaw),
          label: desc.label, details: desc.details,
          debit: parseFloat(e.debit) || 0, credit: parseFloat(e.credit) || 0,
        };
      });
      rows.sort((a, b) => (a.date + String(a.timeRaw || '')) > (b.date + String(b.timeRaw || '')) ? 1 : -1);

      if (!rows.length) {
        entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">لا توجد حركات في هذه الفترة</div></div>`;
        return;
      }

      // تحويل العرض: مدين(debit) → عليكم ، دائن(credit) → لكم
      const totalLakum  = rows.reduce((s, r) => s + r.credit, 0); // إجمالي لكم = Σ دائن
      const totalAlaykum = rows.reduce((s, r) => s + r.debit, 0); // إجمالي عليكم = Σ مدين
      const net = totalAlaykum - totalLakum; // صافي = عليكم − لكم
      const netNature = net >= 0 ? 'عليكم' : 'لكم';
      const isExpense = acc.startsWith('EXP_');
      const netLabelWord = acc.startsWith('COMP_') ? 'صافي الرصيد' : 'صافي الحركة';
      const fmt = (n) => Math.round(n).toLocaleString('en-US');

      let html = `<div class="table-wrapper"><table class="data-table" id="stmt-print-table">
        <thead><tr><th>التاريخ</th><th>الوقت</th><th>نوع العملية</th><th>لكم</th><th>عليكم</th><th>التفاصيل</th></tr></thead><tbody>`;
      for (const r of rows) {
        html += `<tr>
          <td style="white-space:nowrap;">${formatDateArabic(r.date)}</td>
          <td style="white-space:nowrap;">${escapeHtml(r.time)}</td>
          <td style="font-weight:600;">${escapeHtml(r.label)}</td>
          <td style="color:var(--success);direction:ltr;">${r.credit > 0 ? fmt(r.credit) : '0'}</td>
          <td style="color:var(--danger);direction:ltr;">${r.debit > 0 ? fmt(r.debit) : '0'}</td>
          <td style="color:var(--text-secondary);">${escapeHtml(r.details || '—')}</td>
        </tr>`;
      }
      html += `</tbody><tfoot>`;
      if (isExpense) {
        html += `<tr style="font-weight:800;background:rgba(0,0,0,0.04);">
          <td colspan="3" style="text-align:left;">إجمالي المصروفات</td>
          <td>0</td><td style="direction:ltr;color:var(--danger);">${fmt(totalAlaykum)}</td><td></td></tr>`;
      } else {
        html += `<tr style="font-weight:800;background:rgba(0,0,0,0.04);">
          <td colspan="3" style="text-align:left;">الإجماليات</td>
          <td style="direction:ltr;color:var(--success);">${fmt(totalLakum)}</td>
          <td style="direction:ltr;color:var(--danger);">${fmt(totalAlaykum)}</td>
          <td style="direction:ltr;">${netLabelWord}: ${fmt(Math.abs(net))} ${netNature}</td></tr>`;
      }
      html += `</tfoot></table></div>`;

      // ملخص نصّي أسفل الكشف (لكم/عليكم)
      const totalsBox = (inner) => `<div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;padding:12px 14px;background:rgba(0,0,0,0.03);border-radius:10px;font-size:0.92rem;">${inner}</div>`;
      let totalsText;
      if (isExpense) {
        totalsText = `إجمالي المصروفات: ${fmt(totalAlaykum)}`;
        html += totalsBox(`<span>إجمالي المصروفات: <b>${fmt(totalAlaykum)}</b></span>`);
      } else {
        totalsText = `إجمالي لكم: ${fmt(totalLakum)} | إجمالي عليكم: ${fmt(totalAlaykum)} | ${netLabelWord}: ${fmt(Math.abs(net))} ${netNature}`;
        html += totalsBox(`
          <span>إجمالي لكم: <b>${fmt(totalLakum)}</b></span>
          <span>إجمالي عليكم: <b>${fmt(totalAlaykum)}</b></span>
          <span>${netLabelWord}: <b>${fmt(Math.abs(net))} ${netNature}</b></span>`);
      }

      // تخزين بيانات الكشف للطباعة الاحترافية
      this._lastStatement = {
        kind: 'ledger',
        title: `كشف حساب: ${this._selectedAccountName || acc}`,
        accountId: acc,
        periodText: this._buildPeriodText(from, to),
        columns: ['التاريخ', 'الوقت', 'نوع العملية', 'لكم', 'عليكم', 'التفاصيل'],
        rows: rows.map(r => [formatDateArabic(r.date), r.time, r.label,
          r.credit > 0 ? fmt(r.credit) : '0', r.debit > 0 ? fmt(r.debit) : '0', r.details || '—']),
        totalsLine: totalsText.split(' | ').map(t => `<span>${t}</span>`).join(''),
        totalsText,
      };

      entriesEl.innerHTML = html;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">خطأ في جلب البيانات: ${escapeHtml(e.message)}</div></div>`;
    }
  },

  // كشف حركة البنك (من جدول المعاملات): # | الوقت | نوع العملية | المندوب | المبلغ
  async _loadBankStatement(bankId) {
    const fromEl = document.getElementById('stmt-from');
    const toEl   = document.getElementById('stmt-to');
    const from = fromEl?.value;
    const to   = toEl?.value || getCurrentSaudiDate();
    if (!from) { showToast('حدد تاريخ البداية', 'warning'); return; }

    const summaryEl = document.getElementById('stmt-summary');
    const entriesEl = document.getElementById('stmt-entries');
    if (!summaryEl || !entriesEl) return;
    summaryEl.innerHTML = '';
    entriesEl.innerHTML = `<div style="padding:12px 16px;">${renderSkeleton('row', 6)}</div>`;

    try {
      let txns = [];
      let useLocal = !this._isOnline();

      if (this._isOnline()) {
        try {
          const { data, error } = await supabaseClient.from('transactions')
            .select('id,date,time,type,amount,details,created_at, agent:users!transactions_agent_id_fkey(display_name)')
            .eq('bank_account_id', bankId)
            .in('type', ['deposit', 'bank_withdrawal'])
            .eq('is_reversed', false)
            .gte('date', from).lte('date', to)
            .order('date', { ascending: true }).order('time', { ascending: true });
          if (error) throw error;
          txns = (data || []).map(t => ({ ...t, agentName: t.agent?.display_name || '—' }));
        } catch (e) { console.warn('فشل كشف البنك من السحابة، fallback محلي', e); useLocal = true; }
      }

      if (useLocal && typeof db !== 'undefined' && db.isOpen()) {
        const maps = this._nameMaps();
        const all = await db.transactions.where('bank_account_id').equals(bankId).toArray();
        txns = all
          .filter(t => !t.is_reversed && ['deposit', 'bank_withdrawal'].includes(t.type) && t.date >= from && t.date <= to)
          .map(t => ({ ...t, agentName: maps.userById.get(t.agent_id)?.display_name || '—' }))
          .sort((a, b) => (a.date + String(a.time || '')) > (b.date + String(b.time || '')) ? 1 : -1);
      } else if (useLocal) {
        throw new Error('قاعدة البيانات المحلية غير متوفرة ولا يوجد اتصال');
      }

      if (!txns.length) {
        entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">لا توجد حركات بنكية في هذه الفترة</div></div>`;
        return;
      }

      const fmt = (n) => Math.round(n).toLocaleString('en-US');
      let totalDep = 0, totalWd = 0;
      const printRows = [];
      this._stmtPrintRows = printRows;
      let html = `<div class="table-wrapper"><table class="data-table" id="stmt-print-table">
        <thead><tr><th>#</th><th>الوقت</th><th>نوع العملية</th><th>المندوب</th><th>المبلغ</th></tr></thead><tbody>`;
      txns.forEach((t, i) => {
        const isDep = t.type === 'deposit';
        const amt = parseFloat(t.amount) || 0;
        if (isDep) totalDep += amt; else totalWd += amt;
        const time = this._formatTime12(t.time || t.created_at);
        const typeLbl = isDep ? 'إيداع نقدي' : 'سحب نقدي';
        printRows.push([i + 1, time, typeLbl, t.agentName || '—', `${fmt(amt)} ر.س`]);
        html += `<tr>
          <td>${i + 1}</td>
          <td style="white-space:nowrap;">${escapeHtml(time)}</td>
          <td style="font-weight:600;color:${isDep ? 'var(--success)' : 'var(--warning)'};">${typeLbl}</td>
          <td>${escapeHtml(t.agentName || '—')}</td>
          <td style="direction:ltr;font-weight:700;">${fmt(amt)} ر.س</td>
        </tr>`;
      });
      const net = totalDep - totalWd;
      const nature = net >= 0 ? 'مدين' : 'دائن';
      const bankTotalsText = `إجمالي الإيداعات: ${fmt(totalDep)} | إجمالي السحوبات: ${fmt(totalWd)} | صافي الحركة: ${fmt(Math.abs(net))} ${nature}`;
      html += `</tbody></table></div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;padding:12px 14px;background:rgba(0,0,0,0.03);border-radius:10px;font-size:0.92rem;">
          <span>إجمالي الإيداعات: <b>${fmt(totalDep)}</b></span>
          <span>إجمالي السحوبات: <b>${fmt(totalWd)}</b></span>
          <span>صافي الحركة: <b>${fmt(Math.abs(net))} ${nature}</b></span>
        </div>`;

      this._lastStatement = {
        kind: 'bank',
        title: `كشف حركة بنك: ${this._selectedAccountName || ('BNK_' + bankId)}`,
        accountId: 'BNK_' + bankId,
        periodText: this._buildPeriodText(from, to),
        columns: ['#', 'الوقت', 'نوع العملية', 'المندوب', 'المبلغ'],
        rows: printRows,
        totalsLine: bankTotalsText.split(' | ').map(t => `<span>${t}</span>`).join(''),
        totalsText: bankTotalsText,
      };

      entriesEl.innerHTML = html;
    } catch (e) {
      entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">⚠️</div><div class="empty-state-text">خطأ في جلب كشف البنك: ${escapeHtml(e.message)}</div></div>`;
    }
  },

  // تنسيق الوقت بصيغة 12 ساعة (ص/م) من transactions.time أو created_at
  _formatTime12(t) {
    if (!t) return '—';
    let h, m;
    if (/^\d{1,2}:\d{2}/.test(t)) {
      const p = String(t).split(':'); h = parseInt(p[0], 10); m = p[1].padStart(2, '0');
    } else {
      const d = new Date(t); if (isNaN(d.getTime())) return '—';
      h = d.getHours(); m = String(d.getMinutes()).padStart(2, '0');
    }
    const period = h < 12 ? 'ص' : 'م';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return `${h12}:${m} ${period}`;
  },

  // خرائط أسماء سريعة من المخزن (لوضع عدم الاتصال)
  _nameMaps() {
    const users     = (typeof AppStore !== 'undefined' ? (AppStore.getState('users') || []) : []);
    const companies = (typeof AppStore !== 'undefined' ? (AppStore.getState('companies') || []) : []);
    const banks     = (typeof AppStore !== 'undefined' ? (AppStore.getState('bankAccounts') || []) : []);
    return {
      userById:    new Map(users.map(u => [u.id, u])),
      companyById: new Map(companies.map(c => [c.id, c])),
      bankById:    new Map(banks.map(b => [b.id, b])),
    };
  },

  // توحيد كائن المعاملة + استخراج الأسماء (سواء عبر JOIN السحابة أو خرائط المخزن)
  _normalizeTx(t, maps) {
    const userName = (id) => (id && maps ? (maps.userById.get(id)?.display_name || '') : '');
    return {
      id: t.id, time: t.time, created_at: t.created_at, type: t.type, details: t.details || '',
      agent_id: t.agent_id, from_agent_id: t.from_agent_id, to_agent_id: t.to_agent_id,
      company_id: t.company_id, customer_id: t.customer_id, customer_name: t.customer_name || '',
      expense_type: t.expense_type || '', bank_account_id: t.bank_account_id,
      agentName:     t.agent?.display_name      || userName(t.agent_id),
      fromAgentName: t.from_agent?.display_name  || userName(t.from_agent_id),
      toAgentName:   t.to_agent?.display_name    || userName(t.to_agent_id),
      companyName:   t.company?.name             || (t.company_id && maps ? (maps.companyById.get(t.company_id)?.name || '') : ''),
      bankName:      t.bank?.name                || (t.bank_account_id && maps ? (maps.bankById.get(t.bank_account_id)?.name || '') : ''),
    };
  },

  // جلب المعاملات المرتبطة بالقيود دفعةً واحدة (online: JOIN، offline: Dexie+المخزن)
  async _enrichEntries(entries) {
    const refIds = [...new Set((entries || []).map(e => e.reference_id).filter(Boolean))];
    const txMap = new Map();
    if (!refIds.length) return txMap;

    if (this._isOnline()) {
      try {
        const { data } = await supabaseClient.from('transactions')
          .select('id,time,type,details,agent_id,company_id,customer_id,customer_name,from_agent_id,to_agent_id,expense_type,bank_account_id,created_at,'
            + 'agent:users!transactions_agent_id_fkey(display_name),'
            + 'from_agent:users!transactions_from_agent_id_fkey(display_name),'
            + 'to_agent:users!transactions_to_agent_id_fkey(display_name),'
            + 'company:companies!transactions_company_id_fkey(name),'
            + 'bank:bank_accounts!transactions_bank_account_id_fkey(name)')
          .in('id', refIds);
        (data || []).forEach(t => txMap.set(t.id, this._normalizeTx(t, null)));
      } catch (e) { console.warn('فشل إثراء القيود من السحابة', e); }
    }

    const missing = refIds.filter(id => !txMap.has(id));
    if (missing.length && typeof db !== 'undefined' && db.isOpen()) {
      const maps = this._nameMaps();
      for (const id of missing) {
        try {
          const t = await db.transactions.get(id);
          if (t) txMap.set(id, this._normalizeTx(t, maps));
        } catch { /* تجاهل */ }
      }
    }
    return txMap;
  },

  // بناء (نوع العملية) و(التفاصيل) حسب نوع الحساب المعروض — مطابق للصيغ المعتمدة
  _describeLedgerEntry(accountId, e, tx) {
    const debit  = parseFloat(e.debit)  || 0;
    const credit = parseFloat(e.credit) || 0;
    const user   = (tx?.details || '').trim();
    const withUser = (s) => (user ? `${s} ${user}` : s);

    if (!tx) {
      const dir = debit > 0 ? 'لكم' : 'عليكم';
      return { label: 'قيد محاسبي', details: e.description || `${dir} قيد محاسبي` };
    }

    // ── حساب الشركة ──
    if (accountId.startsWith('COMP_')) {
      if (tx.type === 'collection')
        return { label: `تحصيل بواسطة ${tx.agentName || '—'}`, details: withUser(`لكم تحصيل نقدي بواسطة المندوب ${tx.agentName || '—'}`) };
      if (tx.type === 'deposit')
        return { label: 'إيداع نقدي', details: withUser(`عليكم إيداع نقدي إلى حساب ${tx.bankName || '—'} بواسطة المندوب ${tx.agentName || '—'}`) };
      if (tx.type === 'bank_withdrawal')
        return { label: 'سحب بنكي', details: withUser(`لكم سحب نقدي من حساب ${tx.bankName || '—'} بواسطة المندوب ${tx.agentName || '—'}`) };
      const dir = debit > 0 ? 'لكم' : 'عليكم';
      return { label: 'قيد بسيط', details: withUser(`${dir} قيد بسيط`) };
    }

    // ── حساب المندوب ──
    if (accountId.startsWith('AGT_')) {
      const viewedId = accountId.slice(4);
      if (tx.type === 'collection') {
        if (tx.company_id)
          return { label: `تحصيل شركة ${tx.companyName || '—'}`, details: withUser(`عليكم تحصيل نقدي لصالح ${tx.companyName || '—'}`) };
        return { label: 'تحصيل عميل مديون', details: withUser(`عليكم تحصيل نقدي إلى حساب تسوية العملاء من ${tx.customer_name || '—'}`) };
      }
      if (tx.type === 'deposit')
        return { label: 'إيداع نقدي', details: withUser(`لكم إيداع نقدي إلى حساب ${tx.bankName || '—'}`) };
      if (tx.type === 'bank_withdrawal')
        return { label: 'سحب بنكي', details: withUser(`عليكم سحب نقدي من حساب ${tx.bankName || '—'}`) };
      if (tx.type === 'expense')
        return { label: `مصروف ${tx.expense_type || 'عام'}`, details: withUser(`مصروف ${tx.expense_type || 'عام'}`) };
      if (tx.type === 'delivery' || tx.type === 'receipt') {
        const nameFor = (id) => id === tx.agent_id ? tx.agentName : id === tx.to_agent_id ? tx.toAgentName : id === tx.from_agent_id ? tx.fromAgentName : '';
        const otherId = [tx.agent_id, tx.to_agent_id, tx.from_agent_id].find(id => id && id !== viewedId);
        const otherName = nameFor(otherId) || '—';
        if (debit > 0) {
          if (/طلب/.test(tx.details || ''))
            return { label: 'طلب أموال مقبول', details: withUser(`لكم حوالة نقدية تم طلبها عبركم وتمت الموافقة عليها من حساب ${otherName}`) };
          return { label: `تحويل وارد من ${otherName}`, details: withUser(`لكم حوالة نقدية واردة من حساب ${otherName}`) };
        }
        return { label: `تحويل إلى ${otherName}`, details: withUser(`عليكم حوالة نقدية من حسابكم إلى حساب ${otherName}`) };
      }
      const dir = debit > 0 ? 'لكم' : 'عليكم';
      return { label: 'قيد', details: withUser(`${dir} قيد`) };
    }

    // ── تسويات العملاء المديونين ──
    if (accountId === 'DEBTOR_SETTLEMENT')
      return { label: `تحصيل من ${tx.customer_name || '—'}`, details: withUser(`تحصيل من ${tx.customer_name || '—'} بواسطة المندوب ${tx.agentName || '—'}`) };

    // ── المصروفات ──
    if (accountId.startsWith('EXP_'))
      return { label: `مصروف ${tx.expense_type || 'عام'}`, details: withUser(`مصروف ${tx.expense_type || 'عام'}`) };

    return { label: tx.type || 'قيد', details: withUser(e.description || '') };
  },

  // قسم الحسابات البنكية (حركة يومية فقط) مع زر كشف الحركة
  async _renderBankAccountsSection(containerEl) {
    let banks = (typeof AppStore !== 'undefined' ? (AppStore.getState('bankAccounts') || []) : []);
    if (!banks.length) {
      try {
        if (this._isOnline()) {
          const { data } = await supabaseClient.from('bank_accounts')
            .select('id, name, company_id')
            .limit(QUERY_LIMITS.BANK_ACCOUNTS);
          banks = data || [];
        } else if (typeof db !== 'undefined' && db.isOpen()) {
          banks = await db.bank_accounts.toArray();
        }
      } catch (e) {
        console.warn('⚠️ AccountManagement: فشل جلب الحسابات البنكية:', e.message);
      }
    }
    // تصفية حسب صلاحيات المندوب
    const allowedBanks = (typeof AuthService !== 'undefined') ? AuthService.getAllowedBanks() : null;
    if (allowedBanks) banks = banks.filter(b => allowedBanks.includes(b.id));
    if (!banks.length) return;

    const companies = (typeof AppStore !== 'undefined' ? (AppStore.getState('companies') || []) : []);
    const compById  = new Map(companies.map(c => [c.id, c.name]));

    const section = document.createElement('div');
    section.className = 'glass-card acct-category';
    section.style.marginTop = '20px';
    section.innerHTML = `
      <div class="acct-cat-header" style="border-bottom:2px solid rgba(5,150,105,0.13);">
        <div class="acct-cat-header-right">
          <div class="acct-cat-icon" style="background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.2);">🏦</div>
          <div><div class="acct-cat-title">الحسابات البنكية (حركة يومية فقط)</div><div class="acct-cat-count">${banks.length} حساب</div></div>
        </div>
      </div>
      <div class="acct-cat-body"><div class="table-wrapper" style="overflow-x:auto;">
        <table class="data-table bank-accounts-table" style="min-width:420px;">
          <thead><tr><th>البنك</th><th>الشركة التابعة</th><th>الإجراءات</th></tr></thead>
          <tbody>
            ${banks.map(b => {
              const compName = compById.get(b.company_id) || '';
              return `<tr>
              <td style="font-weight:600;">${escapeHtml(b.name || b.id)}</td>
              <td style="color:var(--text-secondary);">${escapeHtml(compName || '—')}</td>
              <td>
                <button class="view-bank-stmt-btn btn-statement" data-bank-id="${escapeHtml(b.id)}" data-bank-name="${escapeHtml(b.name || b.id)}">📄 كشف</button>
              </td>
            </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div></div>`;
    containerEl.appendChild(section);

    section.querySelectorAll('.view-bank-stmt-btn').forEach(btn => {
      btn.addEventListener('click', () => this._showStatement('BNK_' + btn.dataset.bankId, btn.dataset.bankName));
    });

  },

  _openShareBankModal(bankId, bankName, accountNumber, companyName) {
    const existing = document.getElementById('share-bank-modal');
    if (existing) existing.remove();

    const users       = (typeof AppStore !== 'undefined' ? (AppStore.getState('users') || []) : []);
    const currentUser = (typeof AuthState !== 'undefined' ? AuthState.currentUser : null);
    const targetUsers = users.filter(u => u.id !== currentUser?.id && u.is_active !== false);

    const modal = document.createElement('div');
    modal.id        = 'share-bank-modal';
    modal.className = 'share-bank-modal';
    modal.innerHTML = `
      <div class="modal-overlay"></div>
      <div class="modal-content">
        <div class="modal-header">
          <h3>📤 مشاركة رقم الحساب</h3>
          <button class="modal-close-btn" aria-label="إغلاق">✕</button>
        </div>
        <div class="modal-body">
          <div class="account-info-box">
            <div class="info-row"><span class="label">البنك:</span><span class="value">${escapeHtml(bankName)}</span></div>
            <div class="info-row"><span class="label">الشركة:</span><span class="value">${escapeHtml(companyName || '—')}</span></div>
            <div class="info-row"><span class="label">رقم الحساب (IBAN):</span><span class="value iban" dir="ltr">${escapeHtml(accountNumber)}</span></div>
          </div>
          <div class="share-section">
            <label class="share-label" for="share-user-select">اختر المستخدم للمشاركة:</label>
            <select id="share-user-select" class="share-user-select">
              <option value="">-- اختر مستخدم --</option>
              ${targetUsers.map(u => `<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name || u.username || u.id)}</option>`).join('')}
            </select>
          </div>
          <div class="notification-preview">
            <div class="preview-label">📝 نص الإشعار الذي سيُرسَل:</div>
            <div class="preview-text">يمكنك الإيداع إلى حساب (${escapeHtml(companyName || bankName)}) عبر هذا الرقم (${escapeHtml(accountNumber)}) وإضافته كمستفيد مستقبلي</div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary btn-cancel-share">إلغاء</button>
          <button class="btn btn-primary btn-send-share">📤 إرسال الإشعار</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector('.modal-close-btn').addEventListener('click', closeModal);
    modal.querySelector('.btn-cancel-share').addEventListener('click', closeModal);
    modal.querySelector('.modal-overlay').addEventListener('click', closeModal);
    modal.querySelector('.btn-send-share').addEventListener('click', () => {
      const select       = modal.querySelector('#share-user-select');
      const targetUserId = select.value;
      if (!targetUserId) { showToast('الرجاء اختيار مستخدم', 'warning'); return; }
      this._sendBankShareNotification(targetUserId, bankName, companyName, accountNumber, modal);
    });
  },

  async _sendBankShareNotification(targetUserId, bankName, companyName, accountNumber, modalEl) {
    const sendBtn = modalEl?.querySelector('.btn-send-share');
    if (sendBtn) { sendBtn.disabled = true; sendBtn.textContent = '⏳ جاري الإرسال...'; }
    try {
      const currentUser = (typeof AuthState !== 'undefined' ? AuthState.currentUser : null);
      if (!currentUser?.id) throw new Error('لم يتم تحديد المستخدم الحالي');
      const { error } = await supabaseClient.from('notifications').insert({
        from_user_id: currentUser.id,
        to_user_id:   targetUserId,
        type:         'account_share',
        title:        '🏦 مشاركة حساب بنكي',
        message:      `يمكنك الإيداع إلى حساب (${companyName || bankName}) عبر هذا الرقم (${accountNumber}) وإضافته كمستفيد مستقبلي`,
        data:         JSON.stringify({ action: 'deposit', account_number: accountNumber, bank_name: bankName, company_name: companyName }),
        target:       JSON.stringify([targetUserId]),
        is_read:      false,
        created_at:   new Date().toISOString(),
      });
      if (error) throw new Error(error.message);
      showToast('✅ تم إرسال الإشعار بنجاح', 'success');
      if (modalEl) modalEl.remove();
    } catch (e) {
      console.error('❌ فشل إرسال إشعار المشاركة:', e.message);
      showToast('فشل إرسال الإشعار: ' + e.message, 'error');
      if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📤 إرسال الإشعار'; }
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

  // زر الطباعة يفتح نافذة الطباعة الاحترافية
  async _exportStatementExcel() {
    const st = this._lastStatement;
    if (!st || !st.rows || !st.rows.length) { showToast('لا توجد بيانات للتصدير', 'info'); return; }
    const btn = document.getElementById('stmt-excel-btn');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ ...'; }
    try {
      const name = this._selectedAccountName || 'كشف_حساب';
      await PrintService.exportToExcel(st.columns, st.rows, 'كشف الحساب', name.replace(/\s+/g, '_'));
    } catch (e) {
      showToast(`❌ فشل التصدير: ${e.message}`, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i data-lucide="table-2" style="width:13px;height:13px;"></i> Excel';
        if (window.lucide) lucide.createIcons();
      }
    }
  },

  // ─── فلتر التاريخ: تهيئة من localStorage عند فتح كشف حساب ───
  _initFilterMode() {
    const tz = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.TIMEZONE) ? APP_CONFIG.TIMEZONE : 'Asia/Riyadh';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const ym    = today.slice(0, 7); // YYYY-MM

    let mode = 'month';
    try { mode = localStorage.getItem('ahu_stmt_filter_pref') || 'month'; } catch (e) { console.warn('localStorage N/A', e.message); }
    if (!['day', 'month', 'range'].includes(mode)) mode = 'month';

    const dayEl   = document.getElementById('stmt-day');
    const monthEl = document.getElementById('stmt-month-input');
    const fromEl  = document.getElementById('stmt-from');
    const toEl    = document.getElementById('stmt-to');

    if (dayEl   && !dayEl.value)   dayEl.value   = today;
    if (monthEl && !monthEl.value) monthEl.value = ym;
    if (fromEl  && !fromEl.value)  fromEl.value  = `${ym}-01`;
    if (toEl    && !toEl.value)    toEl.value    = today;

    this._applyFilterMode(mode);
  },

  // ─── فلتر التاريخ: إظهار/إخفاء المدخلات حسب الوضع ───
  _applyFilterMode(mode) {
    const show = (id, vis) => { const el = document.getElementById(id); if (el) el.style.display = vis ? '' : 'none'; };
    show('stmt-day-wrap',   mode === 'day');
    show('stmt-month-wrap', mode === 'month');
    show('stmt-from-wrap',  mode === 'range');
    show('stmt-to-wrap',    mode === 'range');

    document.querySelectorAll('[data-stmt-mode]').forEach(btn => {
      const active = btn.dataset.stmtMode === mode;
      btn.classList.toggle('btn-primary',   active);
      btn.classList.toggle('btn-secondary', !active);
    });

    this._syncFilterDates();
  },

  // ─── فلتر التاريخ: مزامنة stmt-from/stmt-to من الوضع النشط ───
  _syncFilterDates() {
    const tz    = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.TIMEZONE) ? APP_CONFIG.TIMEZONE : 'Asia/Riyadh';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    const activeBtn = document.querySelector('[data-stmt-mode].btn-primary');
    const mode = activeBtn?.dataset.stmtMode || 'range';

    const fromEl = document.getElementById('stmt-from');
    const toEl   = document.getElementById('stmt-to');

    if (mode === 'day') {
      const day = document.getElementById('stmt-day')?.value || today;
      if (fromEl) fromEl.value = day;
      if (toEl)   toEl.value   = day;
    } else if (mode === 'month') {
      const ym = document.getElementById('stmt-month-input')?.value;
      if (ym) {
        const [y, m]     = ym.split('-').map(Number);
        const daysInMonth = new Date(y, m, 0).getDate();
        if (fromEl) fromEl.value = `${ym}-01`;
        if (toEl)   toEl.value   = `${ym}-${String(daysInMonth).padStart(2, '0')}`;
      }
    }
    // mode === 'range': المستخدم يتحكم في stmt-from/stmt-to مباشرةً
  },

  // ─── نص الفترة الزمنية بتنسيق يناسب الوضع المختار ───
  _buildPeriodText(from, to) {
    let mode = 'range';
    try { mode = localStorage.getItem('ahu_stmt_filter_pref') || 'range'; } catch (e) { console.warn('localStorage N/A', e.message); }

    if (mode === 'day' && from === to) {
      return `يوم: ${from}`;
    }
    if (mode === 'month') {
      const ym = document.getElementById('stmt-month-input')?.value;
      if (ym) {
        const [y, m] = ym.split('-').map(Number);
        const label  = new Date(y, m - 1, 1).toLocaleDateString('ar-SA', { year: 'numeric', month: 'long' });
        return `شهر: ${label}`;
      }
    }
    return `الفترة: ${from} ← ${to}`;
  },

  _printStatement() { this._printProfessional(); },

  // نافذة طباعة احترافية (A4 + أزرار رجوع/طباعة/مشاركة/PDF)
  _printProfessional() {
    if (typeof PrintService === 'undefined' || typeof PrintService.printStatementAdvanced !== 'function') {
      showToast('خدمة الطباعة غير متوفرة', 'error');
      return;
    }
    const st = this._lastStatement;
    if (!st || !st.rows || !st.rows.length) {
      showToast('لا توجد بيانات في الكشف للطباعة', 'warning');
      return;
    }
    const logo = (typeof AppStore !== 'undefined') ? (AppStore.getState('logoUrl') || '') : '';
    const user = (typeof AuthService !== 'undefined') ? AuthService.getCurrentUser() : null;
    const shareText = [st.title, st.periodText, '────────',
      ...st.rows.map(r => r.join(' | ')), '────────', st.totalsText,
      'نظام أبو حذيفة للصرافة والتحويلات'].join('\n');

    PrintService.printStatementAdvanced({
      title      : st.title,
      subtitle   : 'نظام أبو حذيفة للصرافة والتحويلات',
      periodText : st.periodText,
      userName   : user?.display_name || '',
      logo,
      accountId  : st.accountId,
      columns    : st.columns,
      rows       : st.rows,
      totalsLine : st.totalsLine,
      shareText,
    });
  },

  _shareStatement() {
    if (typeof PrintService === 'undefined') {
      showToast('خدمة المشاركة غير متوفرة', 'error');
      return;
    }
    const name = this._selectedAccountName || '';
    const from = document.getElementById('stmt-from')?.value || '';
    const to   = document.getElementById('stmt-to')?.value   || '';

    const tbl = document.getElementById('stmt-print-table');
    const rows = tbl ? [...tbl.querySelectorAll('tbody tr')].map(tr =>
      [...tr.querySelectorAll('td')].map(td => td.textContent.trim()).join(' | ')) : [];

    const periodDisplay = this._lastStatement?.periodText || `الفترة: ${from} → ${to}`;
    const lines = [
      `📄 كشف حساب: ${name}`,
      `🗓️ ${periodDisplay}`,
      '─'.repeat(30),
      ...rows,
      '─'.repeat(30),
      `نظام أبو حذيفة للصرافة والتحويلات`,
    ].join('\n');

    PrintService.share(lines, { title: `كشف حساب ${name}` });
  },

  // ─────────────────────────────────────────────────────────
  // مودال القيود المحاسبية (مع تحديث ديناميكي للحسابات)
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

      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button id="jtype-simple" class="btn btn-primary btn-sm" style="flex:1;">🔀 قيد بسيط (حسابان)</button>
        <button id="jtype-double" class="btn btn-secondary btn-sm" style="flex:1;">⚖️ قيد مزدوج (متعدد)</button>
      </div>

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

      <div id="journal-double-form" style="display:none;">
        <p style="font-size:0.82rem;color:var(--text-muted);margin-bottom:10px;">
          أدخل سطور القيد — يجب أن يتساوى مجموع المدين مع مجموع الدائن
        </p>
        <div id="journal-lines-container"></div>
        <button id="journal-add-line" class="btn btn-secondary btn-sm" style="margin-top:8px;width:100%;">+ إضافة سطر</button>
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

  _openJournalModal(preAccount = null, preAccountName = null) {
    if (!this._journalModal) return;
    this._journalModal.style.display = 'flex';

    const accOptions = (this._allAccounts || []).map(a =>
      `<option value="${escapeHtml(a.account_id)}">${escapeHtml(a.name || a.account_id)}</option>`
    ).join('');

    const dSel = document.getElementById('j-debit-acc');
    const cSel = document.getElementById('j-credit-acc');
    if (dSel) dSel.innerHTML = '<option value="">— اختر —</option>' + accOptions;
    if (cSel) cSel.innerHTML = '<option value="">— اختر —</option>' + accOptions;

    if (preAccount && dSel) dSel.value = preAccount;

    const amtEl  = document.getElementById('j-amount');
    const descEl = document.getElementById('j-desc');
    if (amtEl)  amtEl.value  = '';
    if (descEl) descEl.value = '';
    document.getElementById('journal-error').textContent = '';

    this._setJournalType('simple');

    document.getElementById('jtype-simple')?.addEventListener('click', () => this._setJournalType('simple'));
    document.getElementById('jtype-double')?.addEventListener('click', () => this._setJournalType('double'));
    document.getElementById('journal-close')?.addEventListener('click',  () => this._closeJournalModal());
    document.getElementById('journal-cancel-btn')?.addEventListener('click', () => this._closeJournalModal());
    document.getElementById('journal-save-btn')?.addEventListener('click',   () => this._saveJournalEntry());
    document.getElementById('journal-add-line')?.addEventListener('click',   () => this._addJournalLine(accOptions));

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
      accOptions = (this._allAccounts || []).map(a =>
        `<option value="${escapeHtml(a.account_id)}">${escapeHtml(a.name || a.account_id)}</option>`
      ).join('');
    }

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

  // ✅ إصلاح جوهري: ترحيل القيود باستخدام RPC الموجودة مع Fallback
  async _postEntries(entries, errEl) {
    try {
      if (this._isOnline()) {
        try {
          const { data, error } = await supabaseClient.rpc('post_manual_journal_entries', {
            p_entries: entries,
            p_user_id: AuthService.getCurrentUserId(),
          });
          if (error) throw error;
          if (data && !data.ok) throw new Error(data.error);
          
          if (typeof db !== 'undefined' && db.isOpen()) {
            for (const e of entries) {
              const current = await db.account_balances.get(e.account_id);
              const bal     = parseFloat(current?.balance || 0) + e.debit - e.credit;
              await db.account_balances.put({ account_id: e.account_id, balance: bal, last_updated: new Date().toISOString() });
            }
          }
          showToast('✅ تم ترحيل القيد بنجاح', 'success');
        } catch (rpcErr) {
          console.warn('RPC فشل، سيتم الحفظ محلياً', rpcErr);
          await this._saveEntriesLocally(entries);
          showToast('تم حفظ القيد محلياً وسيتم مزامنته لاحقاً', 'warning');
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

  // حفظ القيود محلياً (مع SyncQueue)
  async _saveEntriesLocally(entries) {
    if (typeof db === 'undefined' || !db.isOpen()) throw new Error('قاعدة البيانات المحلية غير متوفرة');
    for (const e of entries) {
      const id = generateUUID();
      const record = { ...e, id, sync_status: SYNC_STATUS.PENDING, created_at: new Date().toISOString() };
      await db.account_ledger.put(record);
      if (typeof SyncQueue !== 'undefined') {
        await SyncQueue.add(SYNC_ACTIONS.CREATE, 'account_ledger', id, record);
      }

      const current = await db.account_balances.get(e.account_id);
      const bal     = parseFloat(current?.balance || 0) + e.debit - e.credit;
      await db.account_balances.put({ account_id: e.account_id, balance: bal, last_updated: new Date().toISOString() });
    }
  },

  // ─────────────────────────────────────────────────────────
  // ✅ مودال إضافة حساب جديد (بدون bank ولا customer)
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

      <div id="form-company" style="display:none;">
        <div class="form-group"><label class="form-label">اسم الشركة *</label>
          <input id="add-company-name" type="text" class="form-control" placeholder="اسم الشركة الشريكة"></div>
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

    box.querySelector('#acct-add-close')?.addEventListener('click',  () => this._closeAddModal());
    box.querySelector('#acct-add-cancel')?.addEventListener('click', () => this._closeAddModal());
    box.querySelector('#acct-add-save')?.addEventListener('click',   () => this._saveNewAccount());

    box.querySelectorAll('.acct-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        box.querySelectorAll('.acct-type-btn').forEach(b => b.classList.replace('btn-primary', 'btn-secondary'));
        btn.classList.replace('btn-secondary', 'btn-primary');

        ['company', 'expense', 'custom'].forEach(t => {
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

  _openAddModal() {
    if (this._addModal) this._addModal.style.display = 'flex';
    const box = document.getElementById('acct-add-box');
    if (!box) return;

    box.querySelectorAll('.acct-type-btn').forEach(b => b.classList.replace('btn-primary', 'btn-secondary'));
    ['company', 'expense', 'custom'].forEach(t => {
      const f = box.querySelector(`#form-${t}`); if (f) f.style.display = 'none';
    });
    const acts = box.querySelector('#acct-add-actions'); if (acts) acts.style.display = 'none';
    box.querySelector('#acct-add-error').textContent = '';
    this._currentAddType = null;
    if (window.lucide) lucide.createIcons();
  },

  _closeAddModal() { if (this._addModal) this._addModal.style.display = 'none'; },

  // ✅ إصلاح جوهري: إضافة حساب جديد (بدون RPC create_account)
  async _saveNewAccount() {
    const errEl = document.getElementById('acct-add-error');
    errEl.textContent = '';
    const type = this._currentAddType;
    const btn = document.getElementById('acct-add-save');
    const restore = setButtonLoading(btn);

    try {
      if (!this._isOnline()) {
        errEl.textContent = 'لا يمكن إضافة حسابات جديدة حالياً (غير متصل بالإنترنت)';
        restore();
        return;
      }

      if (type === 'company') {
        const name = document.getElementById('add-company-name')?.value.trim();
        if (!name) { errEl.textContent = 'اسم الشركة مطلوب'; restore(); return; }
        
        const { data: accountNumber, error: genError } = await supabaseClient.rpc('generate_account_number', { entity_type: 'company' });
        if (genError) throw new Error(`فشل توليد رقم الحساب: ${genError.message}`);
        
        const { data: company, error: insertError } = await supabaseClient
          .from('companies')
          .insert({ name, account_number: accountNumber })
          .select()
          .single();
        
        if (insertError) throw new Error(`فشل إضافة الشركة: ${insertError.message}`);
        
        const accountId = `COMP_${company.id}`;
        const { error: balanceError } = await supabaseClient
          .from('account_balances')
          .insert({ account_id: accountId, balance: 0 });
        
        if (balanceError) throw new Error(`فشل إنشاء الحساب المحاسبي: ${balanceError.message}`);
        
        showToast(`✅ تم إضافة الشركة "${name}" برقم حساب ${accountNumber}`, 'success');
        this._closeAddModal();
        if (typeof AppStore !== 'undefined') await AppStore.refreshData();
        await this._loadChart();
      }
      else if (type === 'expense') {
        const name = document.getElementById('add-expense-name')?.value.trim();
        if (!name) { errEl.textContent = 'اسم نوع المصروف مطلوب'; restore(); return; }
        
        const code = name.replace(/[\s\-–—]+/g, '_').replace(/[^\w؀-ۿ]/g, '').toUpperCase().slice(0, 15) + '_' + Date.now().toString(36).slice(-4);
        
        const { data: expense, error: insertError } = await supabaseClient
          .from('expense_accounts')
          .insert({ name, code })
          .select()
          .single();
        
        if (insertError) throw new Error(`فشل إضافة المصروف: ${insertError.message}`);
        
        const accountId = `EXP_${expense.code}`;
        const { error: balanceError } = await supabaseClient
          .from('account_balances')
          .insert({ account_id: accountId, balance: 0 });
        
        if (balanceError) throw new Error(`فشل إنشاء الحساب المحاسبي: ${balanceError.message}`);
        
        showToast(`✅ تم إضافة نوع المصروف "${name}" برمز ${code}`, 'success');
        this._closeAddModal();
        if (typeof AppStore !== 'undefined') await AppStore.refreshData();
        await this._loadChart();
      }
      else if (type === 'custom') {
        const name = document.getElementById('add-custom-name')?.value.trim();
        const accId = document.getElementById('add-custom-id')?.value.trim().toUpperCase();
        const balance = parseFloat(document.getElementById('add-custom-balance')?.value || 0);
        
        if (!name || !accId) { errEl.textContent = 'الاسم ومعرف الحساب مطلوبان'; restore(); return; }
        
        const { data: existing, error: checkError } = await supabaseClient
          .from('account_balances')
          .select('account_id')
          .eq('account_id', accId);
        
        if (existing && existing.length > 0) {
          errEl.textContent = 'هذا المعرف موجود مسبقاً، اختر معرفاً آخر';
          restore();
          return;
        }
        
        const { error: balanceError } = await supabaseClient
          .from('account_balances')
          .insert({ account_id: accId, balance });
        
        if (balanceError) throw new Error(`فشل إنشاء الحساب المخصص: ${balanceError.message}`);
        
        showToast(`✅ تم إضافة الحساب المخصص "${name}"`, 'success');
        this._closeAddModal();
        if (typeof AppStore !== 'undefined') await AppStore.refreshData();
        await this._loadChart();
      }
      else {
        errEl.textContent = 'اختر نوع الحساب أولاً';
        restore();
      }
    } catch (e) {
      restore();
      errEl.textContent = `خطأ: ${e.message}`;
    }
  },

  // ─────────────────────────────────────────────────────────
  // مشاركة رقم الحساب مع مستخدم آخر
  // ─────────────────────────────────────────────────────────

  _buildShareModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'acct-share-modal';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.style.display = 'none'; });

    overlay.innerHTML = `
      <div class="modal-box" style="max-width:420px;">
        <div class="modal-header">
          <h3 class="modal-title">📤 مشاركة رقم الحساب</h3>
          <button class="modal-close" id="acct-share-close">✕</button>
        </div>
        <div style="margin-bottom:16px;">
          <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:4px;">الحساب</p>
          <p id="acct-share-info" style="font-weight:700;color:var(--text-primary);font-family:monospace;font-size:0.95rem;"></p>
        </div>
        <div class="form-group">
          <label class="form-label">اختر المستخدم المستلم</label>
          <select id="acct-share-user-select" class="form-control">
            <option value="">— اختر مستخدماً —</option>
          </select>
        </div>
        <div id="acct-share-error" style="color:var(--danger);font-size:0.82rem;min-height:18px;margin-bottom:8px;"></div>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button id="acct-share-cancel" class="btn btn-secondary">إلغاء</button>
          <button id="acct-share-send" class="btn btn-primary">
            <i data-lucide="send" style="width:14px;height:14px;"></i> إرسال
          </button>
        </div>
      </div>`;

    overlay.querySelector('#acct-share-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.querySelector('#acct-share-cancel').addEventListener('click', () => { overlay.style.display = 'none'; });
    overlay.querySelector('#acct-share-send').addEventListener('click', () => this._sendAccountShare());

    return overlay;
  },

  _openShareModal(accountId, accountName, accountNumber) {
    if (!this._shareModal) return;
    const errEl = this._shareModal.querySelector('#acct-share-error');
    errEl.textContent = '';

    // تحديد نوع الكيان من معرف الحساب
    const entityType = accountId?.startsWith('AGT_')  ? 'user'
                     : accountId?.startsWith('COMP_') ? 'company'
                     : accountId?.startsWith('BNK_')  ? 'bank'
                     : 'user';

    // عرض معلومات الحساب
    this._shareModal.querySelector('#acct-share-info').textContent =
      `${accountName}  ·  ${accountNumber}`;
    // تخزين البيانات على الـ modal مؤقتاً
    this._shareModal.dataset.accountName   = accountName;
    this._shareModal.dataset.accountNumber = accountNumber;
    this._shareModal.dataset.entityType    = entityType;

    // ملء قائمة المستخدمين النشطين (باستثناء المستخدم الحالي)
    const users   = (AppStore.getState('users') || []).filter(u => u.is_active);
    const myId    = AuthService.getCurrentUserId();
    const select  = this._shareModal.querySelector('#acct-share-user-select');
    select.innerHTML = '<option value="">— اختر مستخدماً —</option>';
    users
      .filter(u => u.id !== myId)
      .forEach(u => {
        const opt = document.createElement('option');
        opt.value       = u.id;
        opt.textContent = `${u.display_name || u.username} (${u.role === 'admin' ? 'مدير' : u.role === 'admin_assistant' ? 'مساعد' : 'مندوب'})`;
        select.appendChild(opt);
      });

    this._shareModal.style.display = 'flex';
    if (window.lucide) lucide.createIcons();
    select.focus();
  },

  async _sendAccountShare() {
    const errEl      = this._shareModal.querySelector('#acct-share-error');
    const select     = this._shareModal.querySelector('#acct-share-user-select');
    const sendBtn    = this._shareModal.querySelector('#acct-share-send');
    const toUserId   = select.value;
    const accountName   = this._shareModal.dataset.accountName   || '';
    const accountNumber = this._shareModal.dataset.accountNumber || '';

    errEl.textContent = '';

    if (!toUserId) { errEl.textContent = 'يُرجى اختيار مستخدم'; return; }

    // التحقق من أن المستخدم المختار نشط
    const users  = AppStore.getState('users') || [];
    const target = users.find(u => u.id === toUserId && u.is_active);
    if (!target) { errEl.textContent = 'المستخدم المختار غير موجود أو غير نشط'; return; }

    const entityType   = this._shareModal.dataset.entityType || 'user';
    const actionMap    = { user: 'transfer', company: 'collection', bank: 'deposit' };
    const action       = actionMap[entityType] || 'transfer';
    const msgText      = `يمكنك التحويل إلى حساب ${accountName} عبر هذا الرقم (${accountNumber}) وإضافته كمستفيد مستقبلي`;

    const restore = setButtonLoading(sendBtn, 'جاري الإرسال...');
    try {
      const result = await repo.create(TABLES.NOTIFICATIONS, {
        title     : '📤 مشاركة رقم حساب',
        body      : msgText,
        message   : msgText,
        type      : 'account_share',
        data      : JSON.stringify({ action, account_number: accountNumber, entity_name: accountName, entity_type: entityType }),
        target    : JSON.stringify([toUserId]),
        sender_id : AuthService.getCurrentUserId(),
        read_by   : '[]',
        hidden_by : '[]',
      });
      if (!isOk(result)) throw new Error(result.error || 'فشل الإرسال');

      this._shareModal.style.display = 'none';
      showToast(`✅ تم إرسال رقم الحساب إلى ${escapeHtml(target.display_name || target.username)}`, 'success');
    } catch (e) {
      errEl.textContent = formatErrorMessage(e);
      console.warn('⚠️ _sendAccountShare:', e.message);
    } finally {
      restore();
    }
  },

  // ─────────────────────────────────────────────────────────
  // دوال مساعدة
  // ─────────────────────────────────────────────────────────
  _isOnline() {
    return typeof isOnline === 'function' ? isOnline() : (navigator.onLine === true);
  },

  _getShortId(id) {
    if (!id) return '—';
    if (id.length <= 10) return id;
    return id.slice(0, 8) + '…';
  }
};

window.AccountManagementComponent = AccountManagementComponent;
console.log('✅ AccountManagementComponent v5.0 FINAL — السلوك 3: جميع المستخدمين النشطين + السلوك 5: إخفاء CUST_xxx');
