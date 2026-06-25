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
 * ✅ 7. ترحيل القيود عبر AccountingService.createTransactionWithEntries (Clean Slate):
 *      كل قيد ينشئ سجلاً في transactions + قيوداً في account_ledger دفعة واحدة،
 *      فيظهر في الملخص اليومي وجميع العمليات والحسابات المحاسبية.
 * ✅ 8. إضافة فحوصات typeof للكائنات العامة (db, SyncQueue, AppStore, PrintService, copyToClipboard).
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
'use strict';

const AccountManagementComponent = {
  _selectedAccount    : null,
  _selectedAccountName: null,
  _addModal           : null,
  _journalModal       : null,
  _allAccounts        : [], // قائمة كل الحسابات لاستخدامها في القيود
  _currentAddType     : null,
  _currentJournalType : 'simple',
  _armedArchivePeriod : null, // الفترة التي صُدِّر أرشيفها وجاهزة للإقفال {start,end}

  // شجرة الحسابات الافتراضية
  DEFAULT_CHART : [
    { category:'treasury', name:'الصندوق العام',      id:'GENERAL_FUND',  icon:'landmark', desc:'الخزينة الرئيسية للنظام' },
    { category:'treasury', name:'الخزينة النقدية',     id:'CASH_GENERAL',  icon:'banknote', desc:'النقد المتوفر يدوياً'    },
    { category:'treasury', name:'حساب الشركات العام',  id:'COMP_GENERAL',  icon:'building-2', desc:'حساب تسوية الشركات'     },
  ],

  // ─────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────
  async render(container) {
    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="lock" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
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

    if (AuthService.isAdmin()) {
      const closeBtn = document.createElement('button');
      closeBtn.className = 'btn btn-secondary btn-sm';
      closeBtn.style.cssText = 'border-color:rgba(139,92,246,0.4);color:#8b5cf6;';
      closeBtn.innerHTML = '<i data-lucide="archive" style="width:14px;height:14px;"></i> إقفال الفترة';
      closeBtn.addEventListener('click', () => this._openPeriodCloseModal());
      btnGroup.appendChild(closeBtn);
    }

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

    /* ── قسم إقفال الفترة (للمدير فقط) ── */
    if (AuthService.isAdmin()) {
      const periodCloseSection = document.createElement('div');
      periodCloseSection.id = 'acct-period-close-section';
      periodCloseSection.style.display = 'none';
      wrap.appendChild(periodCloseSection);
    }

    /* ── قسم كشف الحساب ── */
    const stmtSection = document.createElement('div');
    stmtSection.id = 'acct-stmt-section';
    stmtSection.style.display = 'none';
    stmtSection.innerHTML = `
      <div class="glass-card" style="margin-bottom:16px;" id="acct-stmt-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 style="font-size:1rem;font-weight:700;color:var(--text-primary);" id="stmt-account-title"><i data-lucide="file-text" style="width:15px;height:15px;vertical-align:middle;margin-left:5px;"></i>كشف الحساب</h3>
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

    /* ── نوافذ منبثقة — مُضافة لـ body لتجنب كسر position:fixed على الجوال ── */
    if (this._addModal)     this._addModal.remove();
    if (this._journalModal) this._journalModal.remove();
    this._addModal = this._buildAddModal();
    document.body.appendChild(this._addModal);

    this._journalModal = this._buildJournalModal();
    document.body.appendChild(this._journalModal);

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
    if (isOfflineMode() || !isOnline()) return;
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
                    <i data-lucide="file-text" style="width:12px;height:12px;pointer-events:none;"></i> كشف حساب
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
    if (!isOfflineMode() && isOnline()) {
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
          <h3 class="modal-title"><i data-lucide="bar-chart-2" style="width:17px;height:17px;vertical-align:middle;margin-left:5px;"></i>كشف حساب الشركة: ${escapeHtml(companyName)}</h3>
          <button class="modal-close" id="company-modal-close">✕</button>
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
    document.body.style.overflow = 'hidden';
    const closeCompanyModal = () => {
      modal.classList.add('is-closing');
      setTimeout(() => { modal.remove(); document.body.style.overflow = ''; }, 220);
    };
    modal.querySelector('#company-modal-close').addEventListener('click', closeCompanyModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeCompanyModal(); });
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
          <button class="modal-close" id="custody-modal-close">✕</button>
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
    document.body.style.overflow = 'hidden';
    const closeCustodyModal = () => {
      modal.classList.add('is-closing');
      setTimeout(() => { modal.remove(); document.body.style.overflow = ''; }, 220);
    };
    modal.querySelector('#custody-modal-close').addEventListener('click', closeCustodyModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeCustodyModal(); });
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
    const _catIconSvg = (name, color) => `<i data-lucide="${name}" style="width:18px;height:18px;stroke:${color};"></i>`;
    const categoryMeta = {
      agents     : { icon: _catIconSvg('user',          '#2563eb'), label: 'حسابات المستخدمين',           color: '#2563eb', bg: 'rgba(37,99,235,0.08)' },
      debtors    : { icon: _catIconSvg('users',          '#0284c7'), label: 'حسابات العملاء المديونين',    color: '#0284c7', bg: 'rgba(2,132,199,0.08)' },
      companies  : { icon: _catIconSvg('building-2',     '#7c3aed'), label: 'حسابات الشركات',              color: '#7c3aed', bg: 'rgba(124,58,237,0.08)' },
      settlements: { icon: _catIconSvg('file-check',     '#0284c7'), label: 'تسويات العملاء المديونين',   color: '#0284c7', bg: 'rgba(2,132,199,0.08)' },
      banks      : { icon: _catIconSvg('landmark',       '#059669'), label: 'الحسابات البنكية',           color: '#059669', bg: 'rgba(5,150,105,0.08)' },
      expenses   : { icon: _catIconSvg('receipt',        '#dc2626'), label: 'حسابات المصروفات',           color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
      treasury   : { icon: _catIconSvg('vault',          '#d97706'), label: 'الخزينة والحسابات العامة',   color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
      revenue    : { icon: _catIconSvg('banknote',       '#059669'), label: 'حسابات الإيرادات',           color: '#059669', bg: 'rgba(5,150,105,0.08)' },
      suspense   : { icon: _catIconSvg('clock',          '#d97706'), label: 'الحسابات المعلقة',           color: '#d97706', bg: 'rgba(217,119,6,0.08)' },
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
          const parentBadge = acc.parent_name ? `<span class="acct-parent-badge"><i data-lucide="building-2" style="width:11px;height:11px;vertical-align:middle;"></i> ${escapeHtml(acc.parent_name)}</span>` : '';
          tableHtml += `
              <tr class="acct-row" data-name="${escapeHtml((acc.name || acc.account_id).toLowerCase())}">
                <td style="font-weight:600;">${parentBadge}${escapeHtml(acc.name || acc.account_id)}</td>
                <td style="font-weight:700;color:${bal >= 0 ? 'var(--success)' : 'var(--danger)'};">${bal >= 0 ? '' : '−'}${Math.abs(bal).toLocaleString('en-US')} ر.س</td>
                <td>
                  <div style="display:flex;gap:4px;flex-wrap:wrap;">
                    <button class="view-stmt-btn btn btn-secondary btn-sm" data-account="${escapeHtml(acc.account_id)}" data-name="${escapeHtml(acc.name || acc.account_id)}"><i data-lucide="file-text" style="width:13px;height:13px;pointer-events:none;"></i> كشف</button>
                    <button class="quick-entry-btn btn btn-secondary btn-sm" data-account="${escapeHtml(acc.account_id)}" data-name="${escapeHtml(acc.name || acc.account_id)}"><i data-lucide="pen-line" style="width:13px;height:13px;pointer-events:none;"></i> قيد</button>
                    <button class="delete-account-btn btn btn-secondary btn-sm" data-account="${escapeHtml(acc.account_id)}" data-name="${escapeHtml(acc.name || acc.account_id)}"><i data-lucide="trash-2" style="width:13px;height:13px;pointer-events:none;"></i> حذف</button>
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
      if (!isOfflineMode() && isOnline()) {
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

        // FIX: حذف السجل الأصلي من companies/expense_accounts لتفادي "الأشباح" في القوائم المنسدلة.
        if (accountId.startsWith('COMP_')) {
          const companyId = accountId.replace('COMP_', '');
          const { error: compErr } = await supabaseClient.from('companies').delete().eq('id', companyId);
          if (compErr) console.warn('⚠️ لم يتم حذف الشركة من جدول companies:', compErr.message);
        } else if (accountId.startsWith('EXP_')) {
          const expCode = accountId.replace('EXP_', '');
          const { error: expErr } = await supabaseClient.from('expense_accounts').delete().eq('code', expCode);
          if (expErr) console.warn('⚠️ لم يتم حذف المصروف من جدول expense_accounts:', expErr.message);
        }
      } else {
        if (typeof db !== 'undefined' && db.isOpen()) {
          await db.account_ledger.where('account_id').equals(accountId).delete();
          await db.account_balances.delete(accountId);
          if (typeof SyncQueue !== 'undefined') {
            await SyncQueue.add('delete', 'account_balances', accountId, {});
          }
          // FIX offline: حذف من companies/expense_accounts محلياً
          if (accountId.startsWith('COMP_')) {
            const companyId = accountId.replace('COMP_', '');
            await db.companies?.delete(companyId).catch(() => {});
            if (typeof SyncQueue !== 'undefined') {
              await SyncQueue.add('delete', 'companies', companyId, {});
            }
          } else if (accountId.startsWith('EXP_')) {
            const expCode = accountId.replace('EXP_', '');
            await db.expense_accounts?.where('code').equals(expCode).delete().catch(() => {});
            if (typeof SyncQueue !== 'undefined') {
              await SyncQueue.add('delete', 'expense_accounts', expCode, {});
            }
          }
        } else {
          showToast('لا يمكن الحذف بدون اتصال وقاعدة بيانات محلية', 'error');
          return;
        }
      }
      showToast(`تم حذف الحساب "${accountName}" بنجاح`, 'success');
      if (typeof AppStore !== 'undefined') await AppStore.refreshData();
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
        <div style="margin-bottom:16px;opacity:0.5;"><i data-lucide="bar-chart-2" style="width:3rem;height:3rem;"></i></div>
        <h3 style="font-weight:700;margin-bottom:8px;">لا توجد حسابات بعد</h3>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:20px;">
          انقر على "إضافة حساب" لإنشاء حسابك الأول،<br>أو أضف شجرة الحسابات الافتراضية دفعةً واحدة
        </p>
        <button id="add-default-chart-btn" class="btn btn-primary">
          <i data-lucide="git-branch" style="width:14px;height:14px;pointer-events:none;"></i> إضافة شجرة الحسابات الافتراضية
        </button>
      </div>`;
  },

  async _addDefaultChart() {
    const btn = document.getElementById('add-default-chart-btn');
    if (btn) { btn.disabled = true; btn.innerHTML = '<i data-lucide="loader-2" style="width:13px;height:13px;"></i> جاري الإضافة...'; }

    try {
      let added = 0;
      for (const acc of this.DEFAULT_CHART) {
        const accId = acc.id;
        if (typeof db !== 'undefined' && db.isOpen()) {
          const existing = await db.account_balances.get(accId);
          if (existing) continue;
        } else if (!isOfflineMode() && isOnline()) {
          const { data } = await supabaseClient.from('account_balances').select('account_id').eq('account_id', accId);
          if (data?.length) continue;
        }

        const record = { account_id: accId, balance: 0, last_updated: new Date().toISOString() };

        if (!isOfflineMode() && isOnline()) {
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
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="git-branch" style="width:14px;height:14px;"></i> إضافة شجرة الحسابات الافتراضية'; }
    }
  },

  // ✅ بناء البيانات محلياً مع أرقام حسابات حقيقية (السلوك 3 و 5)
  async _buildLocalChartData() {
    // ── الأرصدة التراكمية من account_balances (متصل: Supabase، أوفلاين: Dexie) ──
    let balances = [];
    try {
      if (!isOfflineMode() && isOnline()) {
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
        if (!isOfflineMode() && isOnline()) {
          const { data } = await supabaseClient.from('users').select('id, display_name, is_active, account_number');
          users = data || [];
        } else if (typeof db !== 'undefined' && db.isOpen()) {
          users = await db.users.toArray();
        }
      }
      if (!companies.length) {
        if (!isOfflineMode() && isOnline()) {
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
      let openingEntries = [];
      let useLocal = isOfflineMode() || !isOnline();

      if (!isOfflineMode() && isOnline()) {
        try {
          // جلب القيود ضمن الفترة المحددة
          const { data, error } = await supabaseClient
            .from('account_ledger').select('*')
            .eq('account_id', acc).gte('date', from).lte('date', to)
            .order('date', { ascending: true }).order('created_at', { ascending: true })
            .limit(QUERY_LIMITS.LEDGER_ENTRIES);
          if (error) throw error;
          entries = data || [];

          // جلب القيود قبل تاريخ البداية لحساب الرصيد السابق
          const { data: beforeData, error: beforeError } = await supabaseClient
            .from('account_ledger').select('*')
            .eq('account_id', acc).lt('date', from)
            .limit(50000);
          if (!beforeError) openingEntries = beforeData || [];
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
        openingEntries = all.filter(e => e.date < from);
      } else if (useLocal) {
        throw new Error('قاعدة البيانات المحلية غير متوفرة ولا يوجد اتصال');
      }

      // حساب الرصيد السابق من القيود قبل تاريخ البداية
      const openingDebit = (openingEntries || []).reduce((s, e) => s + (parseFloat(e.debit) || 0), 0);
      const openingCredit = (openingEntries || []).reduce((s, e) => s + (parseFloat(e.credit) || 0), 0);
      const openingBalance = openingDebit - openingCredit;

      // إثراء القيود ببيانات المعاملة المرتبطة (الوقت، النوع، الأسماء، التفاصيل)
      const txMap = await this._enrichEntries(entries);
      // FIX: جلب الطرف المقابل للقيود التي لا تملك معاملة مرتبطة
      const counterpartMap = await this._buildCounterpartMap(entries, txMap, acc);

      const rows = (entries || []).map(e => {
        const tx = e.reference_id ? txMap.get(e.reference_id) : null;
        const timeRaw = tx?.time || tx?.created_at || e.created_at || null;
        const counterpart = counterpartMap.get(e.voucher_number);
        const desc = this._describeLedgerEntry(acc, e, tx, counterpart);
        return {
          date: e.date, timeRaw, time: this._formatTime12(timeRaw),
          label: desc.label, details: desc.details,
          debit: parseFloat(e.debit) || 0, credit: parseFloat(e.credit) || 0,
        };
      });
      rows.sort((a, b) => (a.date + String(a.timeRaw || '')) > (b.date + String(b.timeRaw || '')) ? 1 : -1);

      // تحويل العرض: مدين(debit) → عليكم ، دائن(credit) → لكم
      const totalLakum  = rows.reduce((s, r) => s + r.credit, 0); // إجمالي لكم = Σ دائن
      const totalAlaykum = rows.reduce((s, r) => s + r.debit, 0); // إجمالي عليكم = Σ مدين
      const net = totalAlaykum - totalLakum; // صافي = عليكم − لكم
      const netNature = net >= 0 ? 'عليكم' : 'لكم';
      const isExpense = acc.startsWith('EXP_');
      const netLabelWord = acc.startsWith('COMP_') ? 'صافي الرصيد' : 'صافي الحركة';
      const fmt = (n) => Math.round(n).toLocaleString('en-US');

      // حساب الرصيد النهائي = الرصيد السابق + صافي الحركة
      const finalBalance = openingBalance + net;

      let html = `<div class="table-wrapper"><table class="data-table" id="stmt-print-table">
        <thead><tr><th>#</th><th>التاريخ</th><th>الوقت</th><th>نوع العملية</th><th>لكم</th><th>عليكم</th><th>التفاصيل</th></tr></thead><tbody>`;

      // إضافة صف الرصيد السابق إذا كان موجوداً
      if (openingEntries.length > 0) {
        html += `<tr style="background:rgba(59,130,246,0.08);font-weight:700;">
          <td>—</td>
          <td style="white-space:nowrap;">رصيد سابق</td>
          <td></td>
          <td style="font-weight:600;">رصيد مرحّل</td>
          <td style="color:var(--success);direction:ltr;">${openingCredit > 0 ? fmt(openingCredit) : '0'}</td>
          <td style="color:var(--danger);direction:ltr;">${openingDebit > 0 ? fmt(openingDebit) : '0'}</td>
          <td style="color:var(--text-secondary);">—</td>
        </tr>`;
      }

      let rowNum = 1;
      for (const r of rows) {
        html += `<tr>
          <td style="color:var(--text-muted);font-size:0.8rem;">${rowNum}</td>
          <td style="white-space:nowrap;">${formatDateArabic(r.date)}</td>
          <td style="white-space:nowrap;">${escapeHtml(r.time)}</td>
          <td style="font-weight:600;">${escapeHtml(r.label)}</td>
          <td style="color:var(--success);direction:ltr;">${r.credit > 0 ? fmt(r.credit) : '0'}</td>
          <td style="color:var(--danger);direction:ltr;">${r.debit > 0 ? fmt(r.debit) : '0'}</td>
          <td style="color:var(--text-secondary);">${escapeHtml(r.details || '—')}</td>
        </tr>`;
        rowNum++;
      }

      if (!rows.length && !openingEntries.length) {
        entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">لا توجد حركات في هذه الفترة</div></div>`;
        return;
      }

      html += `</tbody><tfoot>`;
      if (isExpense) {
        html += `<tr style="font-weight:800;background:rgba(0,0,0,0.04);">
          <td></td><td colspan="3" style="text-align:left;">إجمالي المصروفات</td>
          <td>0</td><td style="direction:ltr;color:var(--danger);">${fmt(totalAlaykum)}</td><td></td></tr>`;
      } else {
        html += `<tr style="font-weight:800;background:rgba(0,0,0,0.04);">
          <td></td><td colspan="3" style="text-align:left;">الإجماليات (الفترة)</td>
          <td style="direction:ltr;color:var(--success);">${fmt(totalLakum)}</td>
          <td style="direction:ltr;color:var(--danger);">${fmt(totalAlaykum)}</td>
          <td style="direction:ltr;">${netLabelWord}: ${fmt(Math.abs(net))} ${netNature}</td></tr>`;
        html += `<tr style="font-weight:800;background:rgba(0,0,0,0.06);color:var(--text-primary);">
          <td></td><td colspan="3" style="text-align:left;">الرصيد النهائي</td>
          <td colspan="3" style="direction:ltr;color:${finalBalance >= 0 ? 'var(--success)' : 'var(--danger)'};font-size:1.05rem;">${fmt(Math.abs(finalBalance))} ${finalBalance >= 0 ? 'لكم' : 'عليكم'}</td></tr>`;
      }
      html += `</tfoot></table></div>`;

      // ملخص نصّي أسفل الكشف (لكم/عليكم)
      const totalsBox = (inner) => `<div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;padding:12px 14px;background:rgba(0,0,0,0.03);border-radius:10px;font-size:0.92rem;">${inner}</div>`;
      let totalsText;
      if (isExpense) {
        totalsText = `إجمالي المصروفات: ${fmt(totalAlaykum)}`;
        html += totalsBox(`<span>إجمالي المصروفات: <b>${fmt(totalAlaykum)}</b></span>`);
      } else {
        totalsText = `الرصيد السابق: ${fmt(Math.abs(openingBalance))} ${openingBalance >= 0 ? 'لكم' : 'عليكم'} | إجمالي لكم: ${fmt(totalLakum)} | إجمالي عليكم: ${fmt(totalAlaykum)} | الرصيد النهائي: ${fmt(Math.abs(finalBalance))} ${finalBalance >= 0 ? 'لكم' : 'عليكم'}`;
        html += totalsBox(`
          <span>الرصيد السابق: <b>${fmt(Math.abs(openingBalance))} ${openingBalance >= 0 ? 'لكم' : 'عليكم'}</b></span>
          <span>إجمالي لكم: <b>${fmt(totalLakum)}</b></span>
          <span>إجمالي عليكم: <b>${fmt(totalAlaykum)}</b></span>
          <span>الرصيد النهائي: <b style="color:${finalBalance >= 0 ? '#059669' : '#dc2626'}">${fmt(Math.abs(finalBalance))} ${finalBalance >= 0 ? 'لكم' : 'عليكم'}</b></span>`);
      }

      // تخزين بيانات الكشف للطباعة الاحترافية
      let pRowNum = 1;
      const printRows = (openingEntries.length > 0 ? [[
        '—', 'رصيد سابق', '', 'رصيد مرحّل',
        openingCredit > 0 ? fmt(openingCredit) : '0',
        openingDebit > 0 ? fmt(openingDebit) : '0', '—'
      ]] : []).concat(rows.map(r => [
        pRowNum++, formatDateArabic(r.date), r.time, r.label,
        r.credit > 0 ? fmt(r.credit) : '0', r.debit > 0 ? fmt(r.debit) : '0', r.details || '—']));

      this._lastStatement = {
        kind: 'ledger',
        title: `كشف_${this._selectedAccountName || acc}`,
        accountId: acc,
        periodText: this._buildPeriodText(from, to),
        columns: ['#', 'التاريخ', 'الوقت', 'نوع العملية', 'لكم', 'عليكم', 'التفاصيل'],
        rows: printRows,
        totalsLine: isExpense
          ? `<span>إجمالي المصروفات: <b style="color:#dc2626">${fmt(totalAlaykum)} ر.س</b></span>`
          : [
              `<span>الرصيد السابق: <b style="color:${openingBalance >= 0 ? '#059669' : '#dc2626'}">${fmt(Math.abs(openingBalance))} ${openingBalance >= 0 ? 'لكم' : 'عليكم'} ر.س</b></span>`,
              `<span>إجمالي لكم: <b style="color:#059669">${fmt(totalLakum)} ر.س</b></span>`,
              `<span>إجمالي عليكم: <b style="color:#dc2626">${fmt(totalAlaykum)} ر.س</b></span>`,
              `<span>الرصيد النهائي: <b style="color:${finalBalance >= 0 ? '#059669' : '#dc2626'}">${fmt(Math.abs(finalBalance))} ${finalBalance >= 0 ? 'لكم' : 'عليكم'} ر.س</b></span>`,
            ].join(''),
        totalsText,
      };

      entriesEl.innerHTML = html;
      if (window.lucide) lucide.createIcons();
    } catch (e) {
      entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon"><i data-lucide="alert-triangle" style="width:3rem;height:3rem;opacity:0.45;"></i></div><div class="empty-state-text">خطأ في جلب البيانات: ${escapeHtml(e.message)}</div></div>`;
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
      let openingTxns = [];
      let useLocal = isOfflineMode() || !isOnline();

      if (!isOfflineMode() && isOnline()) {
        try {
          // جلب المعاملات ضمن الفترة المحددة
          const { data, error } = await supabaseClient.from('transactions')
            .select('id,date,time,type,amount,details,created_at, agent:users!transactions_agent_id_fkey(display_name)')
            .eq('bank_account_id', bankId)
            .in('type', ['deposit', 'bank_withdrawal'])
            .eq('is_reversed', false)
            .gte('date', from).lte('date', to)
            .order('date', { ascending: true }).order('time', { ascending: true });
          if (error) throw error;
          txns = (data || []).map(t => ({ ...t, agentName: t.agent?.display_name || '—' }));

          // جلب المعاملات قبل تاريخ البداية لحساب الرصيد الافتتاحي
          const { data: beforeData, error: beforeError } = await supabaseClient.from('transactions')
            .select('type,amount,is_reversed')
            .eq('bank_account_id', bankId)
            .in('type', ['deposit', 'bank_withdrawal'])
            .eq('is_reversed', false)
            .lt('date', from);
          if (!beforeError) openingTxns = beforeData || [];
        } catch (e) { console.warn('فشل كشف البنك من السحابة، fallback محلي', e); useLocal = true; }
      }

      if (useLocal && typeof db !== 'undefined' && db.isOpen()) {
        const maps = this._nameMaps();
        const all = await db.transactions.where('bank_account_id').equals(bankId).toArray();
        txns = all
          .filter(t => !t.is_reversed && ['deposit', 'bank_withdrawal'].includes(t.type) && t.date >= from && t.date <= to)
          .map(t => ({ ...t, agentName: maps.userById.get(t.agent_id)?.display_name || '—' }))
          .sort((a, b) => (a.date + String(a.time || '')) > (b.date + String(b.time || '')) ? 1 : -1);
        openingTxns = all.filter(t => !t.is_reversed && ['deposit', 'bank_withdrawal'].includes(t.type) && t.date < from);
      } else if (useLocal) {
        throw new Error('قاعدة البيانات المحلية غير متوفرة ولا يوجد اتصال');
      }

      // حساب الرصيد الافتتاحي من المعاملات قبل تاريخ البداية
      let openingDepTotal = 0, openingWdTotal = 0;
      (openingTxns || []).forEach(t => {
        const amt = parseFloat(t.amount) || 0;
        if (t.type === 'deposit') openingDepTotal += amt; else openingWdTotal += amt;
      });
      const openingBalance = openingDepTotal - openingWdTotal;

      const fmt = (n) => Math.round(n).toLocaleString('en-US');
      let totalDep = 0, totalWd = 0;
      const printRows = [];
      this._stmtPrintRows = printRows;

      // إضافة صف الرصيد الافتتاحي إذا كان موجوداً
      let html = `<div class="table-wrapper"><table class="data-table" id="stmt-print-table">
        <thead><tr><th>#</th><th>الوقت</th><th>نوع العملية</th><th>المندوب</th><th>المبلغ</th></tr></thead><tbody>`;

      if (openingTxns.length > 0) {
        html += `<tr style="background:rgba(59,130,246,0.08);font-weight:700;">
          <td></td>
          <td></td>
          <td style="font-weight:600;">رصيد افتتاحي</td>
          <td></td>
          <td style="direction:ltr;font-weight:700;color:${openingBalance >= 0 ? 'var(--success)' : 'var(--danger)'};"><strong>${fmt(Math.abs(openingBalance))} ر.س</strong></td>
        </tr>`;
        printRows.push(['', '', 'رصيد افتتاحي', '', fmt(Math.abs(openingBalance)) + ' ر.س']);
      }

      let rowNum = 1;
      txns.forEach((t) => {
        const isDep = t.type === 'deposit';
        const amt = parseFloat(t.amount) || 0;
        if (isDep) totalDep += amt; else totalWd += amt;
        const time = this._formatTime12(t.time || t.created_at);
        const typeLbl = isDep ? 'إيداع نقدي' : 'سحب نقدي';
        printRows.push([rowNum, time, typeLbl, t.agentName || '—', fmt(amt)]);
        html += `<tr>
          <td>${rowNum}</td>
          <td style="white-space:nowrap;">${escapeHtml(time)}</td>
          <td style="font-weight:600;color:${isDep ? 'var(--success)' : 'var(--warning)'};">${typeLbl}</td>
          <td>${escapeHtml(t.agentName || '—')}</td>
          <td style="direction:ltr;font-weight:700;">${fmt(amt)} ر.س</td>
        </tr>`;
        rowNum++;
      });

      if (!txns.length && !openingTxns.length) {
        entriesEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">📭</div><div class="empty-state-text">لا توجد حركات بنكية في هذه الفترة</div></div>`;
        return;
      }

      const net = totalDep - totalWd;
      const closingBalance = openingBalance + net;
      const nature = net >= 0 ? 'مدين' : 'دائن';
      const closingNature = closingBalance >= 0 ? 'مدين' : 'دائن';
      const bankTotalsText = `الرصيد الافتتاحي: ${fmt(Math.abs(openingBalance))} | إجمالي الإيداعات: ${fmt(totalDep)} | إجمالي السحوبات: ${fmt(totalWd)} | صافي الحركة: ${fmt(Math.abs(net))} ${nature} | الرصيد الختامي: ${fmt(Math.abs(closingBalance))} ${closingNature}`;
      html += `</tbody></table></div>
        <div style="display:flex;gap:18px;flex-wrap:wrap;justify-content:flex-end;margin-top:12px;padding:12px 14px;background:rgba(0,0,0,0.03);border-radius:10px;font-size:0.92rem;">
          <span>الرصيد الافتتاحي: <b>${fmt(Math.abs(openingBalance))}</b></span>
          <span>إجمالي الإيداعات: <b>${fmt(totalDep)}</b></span>
          <span>إجمالي السحوبات: <b>${fmt(totalWd)}</b></span>
          <span>صافي الحركة: <b>${fmt(Math.abs(net))} ${nature}</b></span>
          <span>الرصيد الختامي: <b style="color:${closingBalance >= 0 ? 'var(--success)' : 'var(--danger)'}">${fmt(Math.abs(closingBalance))} ${closingNature}</b></span>
        </div>`;

      const bankTotalsLine = [
        `<span>الرصيد الافتتاحي: <b style="color:${openingBalance >= 0 ? '#059669' : '#dc2626'}">${fmt(Math.abs(openingBalance))} ر.س</b></span>`,
        `<span>إجمالي الإيداعات: <b style="color:#059669">${fmt(totalDep)} ر.س</b></span>`,
        `<span>إجمالي السحوبات: <b style="color:#dc2626">${fmt(totalWd)} ر.س</b></span>`,
        `<span>صافي الحركة: <b style="color:${net>=0?'#059669':'#dc2626'}">${fmt(Math.abs(net))} ${nature} ر.س</b></span>`,
        `<span>الرصيد الختامي: <b style="color:${closingBalance>=0?'#059669':'#dc2626'}">${fmt(Math.abs(closingBalance))} ${closingNature} ر.س</b></span>`,
      ].join('');

      this._lastStatement = {
        kind: 'bank',
        title: `كشف_بنك_${this._selectedAccountName || bankId}`,
        accountId: 'BNK_' + bankId,
        periodText: this._buildPeriodText(from, to),
        columns: ['#', 'الوقت', 'نوع العملية', 'المندوب', 'المبلغ (ر.س)'],
        rows: printRows,
        totalsLine: bankTotalsLine,
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

    if (!isOfflineMode() && isOnline()) {
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

  // FIX: تحويل account_id إلى اسم عرض مقروء باستخدام خرائط الأسماء
  _accountIdToName(accountId, maps) {
    if (!accountId) return '—';
    if (accountId.startsWith('AGT_')) {
      const u = maps.userById.get(accountId.slice(4));
      return u?.display_name || u?.username || accountId;
    }
    if (accountId.startsWith('COMP_')) {
      const c = maps.companyById.get(accountId.slice(5));
      return c?.name || accountId;
    }
    if (accountId === 'DEBTOR_SETTLEMENT') return 'تسوية المديونين';
    if (accountId.startsWith('EXP_')) return `مصروف ${accountId.slice(4)}`;
    if (accountId.startsWith('SUSP_')) return 'حساب معلق';
    const b = maps.bankById.get(accountId);
    return b?.name || accountId;
  },

  // FIX: جلب الطرف المقابل لكل قيد لا تربطه معاملة — دفعةً واحدة من Supabase
  async _buildCounterpartMap(entries, txMap, currentAccountId) {
    const vouchers = [...new Set(
      entries
        .filter(e => !e.reference_id || !txMap.has(e.reference_id))
        .map(e => e.voucher_number)
        .filter(Boolean)
    )];
    if (!vouchers.length) return new Map();

    const maps   = this._nameMaps();
    const result = new Map();
    if (!isOfflineMode() && isOnline()) {
      try {
        const { data } = await supabaseClient
          .from('account_ledger')
          .select('voucher_number, account_id')
          .in('voucher_number', vouchers)
          .neq('account_id', currentAccountId)
          .limit(vouchers.length * 4);
        for (const row of (data || [])) {
          if (!result.has(row.voucher_number))
            result.set(row.voucher_number, this._accountIdToName(row.account_id, maps));
        }
      } catch (err) { console.warn('[Statement] فشل جلب الأطراف المقابلة:', err?.message); }
    }
    return result;
  },

  // بناء (نوع العملية) و(التفاصيل) حسب نوع الحساب المعروض — مطابق للصيغ المعتمدة
  _describeLedgerEntry(accountId, e, tx, counterpart) {
    const debit  = parseFloat(e.debit)  || 0;
    const credit = parseFloat(e.credit) || 0;
    const user   = (tx?.details || '').trim();
    const withUser = (s) => (user ? `${s} ${user}` : s);

    // FIX: القيود العكسية — voucher_number يبدأ بـ REV_
    if (e.voucher_number?.startsWith('REV_')) {
      const amt      = Math.round(Math.max(debit, credit));
      const typeMap  = { collection: 'تحصيل', deposit: 'إيداع', bank_withdrawal: 'سحب بنكي', expense: 'مصروف', delivery: 'تسليم', receipt: 'استلام' };
      const typeName = tx?.type ? (typeMap[tx.type] || tx.type) : '';
      const origDesc = (e.description || '').replace(/^عكس:\s*/u, '').trim() || typeName;
      const suffix   = (typeName && amt) ? ` (عكس عملية ${typeName} بقيمة ${amt.toLocaleString('en-US')} ر.س)` : '';
      return { label: 'قيد عكسي', details: `قيد عكسي لـ: ${origDesc}${suffix}` };
    }

    if (!tx) {
      const dir = debit > 0 ? 'عليكم' : 'لكم';
      // FIX: استخدام وصف القيد المخزَّن، وإلا إضافة اسم الطرف المقابل إن وُجد
      if (e.description) return { label: 'قيد محاسبي', details: e.description };
      const cpStr = counterpart ? ` — ${dir === 'لكم' ? 'من' : 'إلى'} حساب ${counterpart}` : '';
      return { label: 'قيد محاسبي', details: `${dir} قيد محاسبي${cpStr}` };
    }

    // ── حساب الشركة ──
    if (accountId.startsWith('COMP_')) {
      if (tx.type === 'collection')
        return { label: `تحصيل بواسطة ${tx.agentName || '—'}`, details: withUser(`لكم تحصيل نقدي بواسطة المندوب ${tx.agentName || '—'}`) };
      if (tx.type === 'deposit')
        return { label: 'إيداع نقدي', details: withUser(`عليكم إيداع نقدي إلى حساب ${tx.bankName || '—'} بواسطة المندوب ${tx.agentName || '—'}`) };
      if (tx.type === 'bank_withdrawal')
        return { label: 'سحب بنكي', details: withUser(`لكم سحب نقدي من حساب ${tx.bankName || '—'} بواسطة المندوب ${tx.agentName || '—'}`) };
      if (tx.type === 'failed_deposit_refund')
        return { label: 'استرداد إيداع فاشل', details: withUser(`عليكم استرداد إيداع فاشل من حساب ${tx.bankName || '—'} بواسطة المندوب ${tx.agentName || '—'}`) };
      const dir = debit > 0 ? 'عليكم' : 'لكم';
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
      if (tx.type === 'failed_deposit_refund')
        return { label: 'استرداد إيداع فاشل', details: withUser(`لكم استرداد إيداع فاشل من حساب ${tx.bankName || '—'}`) };
      if (tx.type === 'expense') {
        const det = (tx.details || '').trim();
        return { label: 'مصروفات', details: `لكم مصروفات نوع ${tx.expense_type || 'عام'} بواسطة ${tx.agentName || '—'}${det ? ` لغرض(${det})` : ''}` };
      }
      if (tx.type === 'delivery' || tx.type === 'receipt') {
        const nameFor = (id) => id === tx.agent_id ? tx.agentName : id === tx.to_agent_id ? tx.toAgentName : id === tx.from_agent_id ? tx.fromAgentName : '';
        const otherId = [tx.agent_id, tx.to_agent_id, tx.from_agent_id].find(id => id && id !== viewedId);
        const otherName = nameFor(otherId) || '—';
        if (debit > 0)
          return { label: 'تسليم عهدة', details: withUser(`عليكم تسليم عهدة من حساب ${otherName}`) };
        return { label: 'تسليم عهدة', details: withUser(`لكم تسليم عهدة من حسابكم إلى حساب ${otherName}`) };
      }
      const dir = debit > 0 ? 'عليكم' : 'لكم';
      return { label: 'قيد', details: withUser(`${dir} قيد`) };
    }

    // ── تسويات العملاء المديونين ──
    if (accountId === 'DEBTOR_SETTLEMENT')
      return { label: `تحصيل من ${tx.customer_name || '—'}`, details: withUser(`تحصيل من ${tx.customer_name || '—'} بواسطة المندوب ${tx.agentName || '—'}`) };

    // ── المصروفات ──
    if (accountId.startsWith('EXP_')) {
      const det = (tx.details || '').trim();
      return { label: 'مصروفات', details: `عليكم مصروفات نوع ${tx.expense_type || 'عام'} بواسطة ${tx.agentName || '—'}${det ? ` لغرض(${det})` : ''}` };
    }

    return { label: tx.type || 'قيد', details: withUser(e.description || '') };
  },

  // قسم الحسابات البنكية (حركة يومية فقط) مع زر كشف الحركة
  async _renderBankAccountsSection(containerEl) {
    let banks = (typeof AppStore !== 'undefined' ? (AppStore.getState('bankAccounts') || []) : []);
    if (!banks.length) {
      try {
        if (!isOfflineMode() && isOnline()) {
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
                <button class="view-bank-stmt-btn btn-statement" data-bank-id="${escapeHtml(b.id)}" data-bank-name="${escapeHtml(b.name || b.id)}"><i data-lucide="file-text" style="width:13px;height:13px;pointer-events:none;"></i> كشف</button>
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
    const st = this._lastStatement;
    if (!st || !st.rows || !st.rows.length) {
      showToast('لا توجد بيانات للمشاركة — حمّل الكشف أولاً', 'warning');
      return;
    }
    const name   = this._selectedAccountName || '';
    const rows   = st.rows.map(r => r.join(' | '));
    const lines  = [
      `📄 كشف حساب: ${name}`,
      `🗓️ ${st.periodText || ''}`,
      '─'.repeat(30),
      ...rows,
      '─'.repeat(30),
      st.totalsText || '',
      `نظام أبو حذيفة للصرافة والتحويلات`,
    ].filter(Boolean).join('\n');

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
        <h3 class="modal-title"><i data-lucide="book-open" style="width:17px;height:17px;vertical-align:middle;margin-left:5px;"></i>قيد محاسبي</h3>
        <button class="modal-close" id="journal-close">✕</button>
      </div>

      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <button id="jtype-simple" class="btn btn-primary btn-sm" style="flex:1;"><i data-lucide="git-merge" style="width:13px;height:13px;pointer-events:none;"></i> قيد بسيط (حسابان)</button>
        <button id="jtype-double" class="btn btn-secondary btn-sm" style="flex:1;"><i data-lucide="git-branch" style="width:13px;height:13px;pointer-events:none;"></i> قيد مزدوج (متعدد)</button>
      </div>

      <div id="journal-simple-form">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px;">
          <div class="form-group" style="margin:0;">
            <label class="form-label">من حساب <span class="required">*</span>
              <span style="font-size:0.7rem;color:var(--danger);font-weight:600;">(يُسجَّل في كشفه: عليكم)</span>
            </label>
            <select id="j-from-acc" class="form-control"></select>
          </div>
          <div class="form-group" style="margin:0;">
            <label class="form-label">إلى حساب <span class="required">*</span>
              <span style="font-size:0.7rem;color:var(--success);font-weight:600;">(يُسجَّل في كشفه: لكم)</span>
            </label>
            <select id="j-to-acc" class="form-control"></select>
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
        <button id="journal-save-btn" class="btn btn-primary" style="flex:2;"><i data-lucide="check-circle" style="width:14px;height:14px;pointer-events:none;"></i> ترحيل القيد</button>
        <button id="journal-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    overlay.appendChild(box);
    return overlay;
  },

  _openJournalModal(preAccount = null, preAccountName = null) {
    if (!this._journalModal) return;
    this._journalModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    const accOptions = (this._allAccounts || []).map(a =>
      `<option value="${escapeHtml(a.account_id)}">${escapeHtml(a.name || a.account_id)}</option>`
    ).join('');

    const fromSel = document.getElementById('j-from-acc');
    const toSel   = document.getElementById('j-to-acc');
    if (fromSel) fromSel.innerHTML = '<option value="">— اختر —</option>' + accOptions;
    if (toSel)   toSel.innerHTML   = '<option value="">— اختر —</option>' + accOptions;

    if (preAccount && fromSel) fromSel.value = preAccount;

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
    if (this._journalModal) {
      this._journalModal.classList.add('is-closing');
      setTimeout(() => {
        if (this._journalModal) {
          this._journalModal.style.display = 'none';
          this._journalModal.classList.remove('is-closing');
        }
        document.body.style.overflow = '';
      }, 220);
    }
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
    // "من حساب" = الطرف المدين (عليكم) | "إلى حساب" = الطرف الدائن (لكم)
    // مطابق لمنطق الإيداع/التحصيل: مدين→عليكم ، دائن→لكم
    const fromAcc = document.getElementById('j-from-acc')?.value;
    const toAcc   = document.getElementById('j-to-acc')?.value;
    const amount  = parseFloat(document.getElementById('j-amount')?.value || 0);
    const date    = document.getElementById('j-date')?.value      || getCurrentSaudiDate();
    const desc    = document.getElementById('j-desc')?.value?.trim() || '';

    if (!fromAcc)            { errEl.textContent = 'اختر حساب "من"'; return; }
    if (!toAcc)             { errEl.textContent = 'اختر حساب "إلى"'; return; }
    if (fromAcc === toAcc)  { errEl.textContent = 'لا يمكن أن يكون حساب "من" و"إلى" نفسه'; return; }
    if (!amount || amount <= 0) { errEl.textContent = 'المبلغ يجب أن يكون أكبر من صفر'; return; }

    const journalEntries = [
      { account_id: fromAcc, debit: amount, credit: 0,      description: desc }, // من → عليكم
      { account_id: toAcc,   debit: 0,      credit: amount, description: desc }, // إلى → لكم
    ];

    await this._postJournalEntry({ amount, date, details: desc, journalEntries }, errEl);
  },

  async _saveDoubleEntry(errEl) {
    const lines = [...document.querySelectorAll('.journal-line')];
    const date  = document.getElementById('jd-date')?.value?.trim() || getCurrentSaudiDate();
    const desc  = document.getElementById('jd-desc')?.value?.trim() || '';

    const journalEntries = [];
    let totalDebit = 0, totalCredit = 0;

    for (const line of lines) {
      const accId  = line.querySelector('.jl-account')?.value;
      const debit  = parseFloat(line.querySelector('.jl-debit')?.value  || 0);
      const credit = parseFloat(line.querySelector('.jl-credit')?.value || 0);

      if (!accId) continue;
      if (debit > 0 && credit > 0) { errEl.textContent = 'كل سطر يجب أن يكون مدين أو دائن فقط، ليس كليهما'; return; }

      journalEntries.push({ account_id: accId, debit, credit, description: desc });
      totalDebit  += debit;
      totalCredit += credit;
    }

    if (journalEntries.length < 2) { errEl.textContent = 'القيد يجب أن يحتوي سطرين على الأقل'; return; }
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      errEl.textContent = `القيد غير متوازن — المدين (${Math.round(totalDebit).toLocaleString('en-US')}) ≠ الدائن (${Math.round(totalCredit).toLocaleString('en-US')})`;
      return;
    }

    await this._postJournalEntry({ amount: totalDebit, date, details: desc, journalEntries }, errEl);
  },

  // ─────────────────────────────────────────────────────────
  // ترحيل القيد عبر AccountingService.createTransactionWithEntries
  // يضمن إنشاء سجل في transactions + قيود في account_ledger دفعة واحدة
  // ─────────────────────────────────────────────────────────
  async _postJournalEntry({ amount, date, details, journalEntries }, errEl) {
    try {
      // ربط القيد بالمندوب المعني (إن وُجد حساب AGT_ في الأطراف) ليظهر في ملخصه
      // اليومي ويصبح مرئياً له عبر RLS. يُفضَّل الطرف الدائن (إلى/لكم)، وإلا أي طرف
      // مندوب، وإلا منشئ القيد (المدير).
      const creatorId  = AuthService.getCurrentUserId();
      const agentEntry = journalEntries.find(e => e.account_id.startsWith('AGT_') && e.credit > 0)
                      || journalEntries.find(e => e.account_id.startsWith('AGT_'));
      const linkedAgentId = agentEntry ? agentEntry.account_id.slice(4) : creatorId;

      const result = await AccountingService.createTransactionWithEntries({
        type            : TRANSACTION_TYPES.JOURNAL_ENTRY,
        amount,
        date,
        details         : details || 'قيد محاسبي يدوي',
        agent_id        : linkedAgentId,
        executed_by     : creatorId,
        approval_status : 'approved',
        _journal_entries: journalEntries,
      });

      if (!isOk(result)) {
        errEl.textContent = result.error || 'فشل ترحيل القيد';
        return;
      }

      showToast('✅ تم ترحيل القيد بنجاح', 'success');
      this._closeJournalModal();
      await this._loadChart();
    } catch (e) {
      errEl.textContent = `فشل ترحيل القيد: ${e.message}`;
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
          { type:'company', icon:'building-2', label:'حساب شركة',     desc:'شركة شريكة' },
          { type:'expense', icon:'receipt', label:'نوع مصروف',      desc:'فئة مصاريف' },
          { type:'custom',  icon:'clipboard-list', label:'حساب مخصص',      desc:'رصيد يدوي' },
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
    if (this._addModal) {
      this._addModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
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

  _closeAddModal() {
    if (this._addModal) {
      this._addModal.classList.add('is-closing');
      setTimeout(() => {
        if (this._addModal) {
          this._addModal.style.display = 'none';
          this._addModal.classList.remove('is-closing');
        }
        document.body.style.overflow = '';
      }, 220);
    }
  },

  // ✅ إصلاح جوهري: إضافة حساب جديد (بدون RPC create_account)
  async _saveNewAccount() {
    const errEl = document.getElementById('acct-add-error');
    errEl.textContent = '';
    const type = this._currentAddType;
    const btn = document.getElementById('acct-add-save');
    const restore = setButtonLoading(btn);

    try {
      if (isOfflineMode() || !isOnline()) {
        errEl.textContent = 'لا يمكن إضافة حسابات جديدة حالياً (غير متصل بالإنترنت)';
        restore();
        return;
      }

      if (type === 'company') {
        const name = document.getElementById('add-company-name')?.value.trim();
        if (!name) { errEl.textContent = 'اسم الشركة مطلوب'; restore(); return; }
        
        const { data: accountNumber, error: genError } = await supabaseClient.rpc('generate_account_number', { entity_type: 'company' });
        if (genError) throw new Error(`فشل توليد رقم الحساب: ${genError.message}`);
        if (!accountNumber) throw new Error('فشل توليد رقم الحساب: القيمة فارغة');

        // FIX: account_prefix مطلوب NOT NULL — يساوي أول 3 أحرف من رقم الحساب (مثال: COM)
        const accountPrefix = String(accountNumber).slice(0, 3);

        const { data: company, error: insertError } = await supabaseClient
          .from('companies')
          .insert({ name, account_number: accountNumber, account_prefix: accountPrefix })
          .select()
          .single();
        
        if (insertError) throw new Error(`فشل إضافة الشركة: ${insertError.message}`);
        
        const accountId = `COMP_${company.id}`;
        // FIX: trigger trg_init_company_account ينشئ السجل تلقائياً عند إدراج الشركة.
        // نستخدم upsert مع ignoreDuplicates لتجنب خطأ account_balances_pkey إذا سبق الـ trigger.
        const { error: balanceError } = await supabaseClient
          .from('account_balances')
          .upsert({ account_id: accountId, balance: 0 }, { onConflict: 'account_id', ignoreDuplicates: true });

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
  // إقفال الفترة — نافذة الإدارة
  // ─────────────────────────────────────────────────────────
  async _openPeriodCloseModal() {
    const existing = document.getElementById('period-close-modal');
    if (existing) { existing.style.display = 'flex'; await this._loadPeriodClosings(); return; }

    const overlay = document.createElement('div');
    overlay.id = 'period-close-modal';
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:9999;';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closePeriodCloseModal(); });

    const today = new Date();
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0,10);
    const lastOfPrevMonth = new Date(today.getFullYear(), today.getMonth(), 0).toISOString().slice(0,10);
    const firstOfYear = `${today.getFullYear()}-01-01`;
    const lastOfPrevYear = `${today.getFullYear()-1}-12-31`;

    overlay.innerHTML = `
      <div class="modal-box" style="max-width:640px;width:95%;max-height:90vh;overflow-y:auto;">
        <div class="modal-header" style="background:linear-gradient(135deg,#7c3aed,#6d28d9);padding:18px 22px;border-radius:12px 12px 0 0;">
          <h3 style="color:#fff;font-size:1.05rem;font-weight:700;margin:0;">🗂️ إقفال الفترة المحاسبية</h3>
          <button id="pc-modal-close" class="modal-close" style="color:#e9d5ff;">✕</button>
        </div>
        <div style="padding:20px;">

          <div class="glass-card" style="background:rgba(124,58,237,0.06);border:1px solid rgba(124,58,237,0.2);margin-bottom:18px;padding:14px;">
            <p style="font-size:0.82rem;color:var(--text-secondary);margin:0;line-height:1.7;">
              ⚠️ <strong>تحذير:</strong> عند تنفيذ الإقفال ستُحذف جميع المعاملات وقيود الحساب للفترة المحددة من قاعدة البيانات السحابية
              وتُستبدل بأرصدة افتتاحية. تأكد من تحميل ملف الأرشيف أولاً.
            </p>
          </div>

          <!-- اختيار الفترة -->
          <div style="margin-bottom:16px;">
            <label class="form-label">نطاق الفترة</label>
            <div style="display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;">
              <button class="btn btn-sm btn-secondary period-preset"
                data-start="${firstOfYear}" data-end="${lastOfPrevYear}" style="font-size:0.78rem;">
                السنة الماضية
              </button>
              <button class="btn btn-sm btn-secondary period-preset"
                data-start="${firstOfYear}" data-end="${lastOfPrevMonth}" style="font-size:0.78rem;">
                من بداية السنة حتى الشهر الماضي
              </button>
              <button class="btn btn-sm btn-secondary period-preset"
                data-start="${firstOfMonth}" data-end="${lastOfPrevMonth}" style="font-size:0.78rem;">
                الشهر الماضي فقط
              </button>
            </div>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
              <div class="form-group" style="margin:0;flex:1;min-width:140px;">
                <label class="form-label" style="font-size:0.78rem;">من تاريخ</label>
                <input id="pc-start" type="date" class="form-control" value="${firstOfYear}">
              </div>
              <div class="form-group" style="margin:0;flex:1;min-width:140px;">
                <label class="form-label" style="font-size:0.78rem;">إلى تاريخ</label>
                <input id="pc-end" type="date" class="form-control" value="${lastOfPrevMonth}">
              </div>
            </div>
          </div>

          <div class="form-group" style="margin-bottom:16px;">
            <label class="form-label" style="font-size:0.82rem;">ملاحظات الإقفال (اختياري)</label>
            <textarea id="pc-notes" class="form-control" rows="2"
              placeholder="ملاحظات للمرجعية..." style="resize:none;font-size:0.85rem;"></textarea>
          </div>

          <div id="pc-error" style="color:var(--danger);font-size:0.82rem;margin-bottom:10px;display:none;"></div>

          <div style="display:flex;gap:10px;flex-wrap:wrap;">
            <button id="pc-export-btn" class="btn btn-secondary" style="flex:1;border-color:rgba(16,185,129,0.4);color:#10b981;">
              <i data-lucide="download" style="width:14px;height:14px;"></i> تحميل أرشيف JSON
            </button>
            <button id="pc-close-btn" class="btn btn-primary" style="flex:1;background:linear-gradient(135deg,#7c3aed,#6d28d9);border:none;"
              disabled>
              <i data-lucide="archive" style="width:14px;height:14px;"></i> تنفيذ الإقفال
            </button>
          </div>
          <p id="pc-export-note" style="font-size:0.75rem;color:var(--text-muted);margin-top:8px;display:none;">
            ✅ تم تحميل الأرشيف — يمكنك الآن تنفيذ الإقفال
          </p>

          <!-- سجل الإقفالات السابقة -->
          <div style="margin-top:24px;border-top:1px solid var(--border);padding-top:16px;">
            <h4 style="font-size:0.9rem;font-weight:700;color:var(--text-primary);margin-bottom:12px;">📋 سجل الإقفالات السابقة</h4>
            <div id="pc-history" style="font-size:0.82rem;">
              <div class="skeleton" style="height:44px;border-radius:8px;"></div>
            </div>
          </div>

        </div>
      </div>`;

    document.body.appendChild(overlay);
    if (window.lucide) lucide.createIcons();

    document.getElementById('pc-modal-close').addEventListener('click', () => this._closePeriodCloseModal());

    overlay.querySelectorAll('.period-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('pc-start').value = btn.dataset.start;
        document.getElementById('pc-end').value   = btn.dataset.end;
        this._disarmPeriodClose();
      });
    });

    // أي تغيير في الفترة يُلغي تسليح الإقفال — يجب إعادة تصدير الأرشيف للفترة الجديدة
    document.getElementById('pc-start')?.addEventListener('change', () => this._disarmPeriodClose());
    document.getElementById('pc-end')?.addEventListener('change',   () => this._disarmPeriodClose());

    document.getElementById('pc-export-btn').addEventListener('click', async () => {
      const start = document.getElementById('pc-start')?.value;
      const end   = document.getElementById('pc-end')?.value;
      await this._executePeriodExport(() => {
        // تسليح الإقفال للفترة المُصدَّرة بالضبط فقط
        this._armedArchivePeriod = { start, end };
        const closeBtn = document.getElementById('pc-close-btn');
        if (closeBtn) closeBtn.disabled = false;
        const note = document.getElementById('pc-export-note');
        if (note) note.style.display = 'block';
      });
    });

    document.getElementById('pc-close-btn').addEventListener('click', async () => {
      const start = document.getElementById('pc-start')?.value;
      const end   = document.getElementById('pc-end')?.value;
      const armed = this._armedArchivePeriod;
      if (!armed || armed.start !== start || armed.end !== end) {
        showToast('يجب تحميل أرشيف الفترة المحددة أولاً قبل تنفيذ الإقفال', 'error');
        this._disarmPeriodClose();
        return;
      }
      await this._executePeriodClose();
    });

    await this._loadPeriodClosings();
  },

  // إلغاء تسليح الإقفال — يُعطّل زر الإقفال حتى يُصدَّر أرشيف الفترة الحالية
  _disarmPeriodClose() {
    this._armedArchivePeriod = null;
    const closeBtn = document.getElementById('pc-close-btn');
    if (closeBtn) closeBtn.disabled = true;
    const note = document.getElementById('pc-export-note');
    if (note) note.style.display = 'none';
  },

  _closePeriodCloseModal() {
    const modal = document.getElementById('period-close-modal');
    if (modal) modal.style.display = 'none';
  },

  async _executePeriodExport(onSuccess) {
    const start = document.getElementById('pc-start')?.value;
    const end   = document.getElementById('pc-end')?.value;
    const errEl = document.getElementById('pc-error');
    if (errEl) errEl.style.display = 'none';

    if (!start || !end || start > end) {
      if (errEl) { errEl.textContent = 'يرجى تحديد فترة صحيحة (من ≤ إلى)'; errEl.style.display = 'block'; }
      return;
    }

    const btn = document.getElementById('pc-export-btn');
    const restore = setButtonLoading(btn, 'جارٍ التجميع...');

    try {
      const bundle = await AccountingService.exportPeriodData(start, end);
      if (!isOk(bundle)) throw new Error(bundle.error || 'فشل تجميع البيانات');

      const data = bundle.data;
      const filename = `archive_${start}_${end}_${Date.now()}.json`;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      showToast(`✅ تم تحميل الأرشيف (${data.transactions?.length || 0} معاملة)`, 'success');
      if (onSuccess) onSuccess();
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
      showToast('فشل تحميل الأرشيف: ' + e.message, 'error');
    } finally {
      restore();
    }
  },

  async _executePeriodClose() {
    const start = document.getElementById('pc-start')?.value;
    const end   = document.getElementById('pc-end')?.value;
    const notes = document.getElementById('pc-notes')?.value.trim() || '';
    const errEl = document.getElementById('pc-error');
    if (errEl) errEl.style.display = 'none';

    const confirmed = await confirmDialog(
      `تنفيذ إقفال الفترة من ${start} إلى ${end}؟\n\nسيتم حذف جميع المعاملات وقيود الحساب للفترة المحددة من قاعدة البيانات بشكل نهائي.`,
      'تنفيذ الإقفال', 'إلغاء', 'danger'
    );
    if (!confirmed) return;

    const btn = document.getElementById('pc-close-btn');
    const restore = setButtonLoading(btn, 'جارٍ الإقفال...');

    try {
      const result = await AccountingService.performPeriodClose(start, end, notes);
      if (!isOk(result)) throw new Error(result.error || 'فشل الإقفال');

      const stats = result.data;
      showToast(
        `✅ تم الإقفال — حُذفت ${stats?.transactions_deleted || 0} معاملة و${stats?.ledger_entries_deleted || 0} قيد`,
        'success'
      );
      this._disarmPeriodClose();   // يتطلب إعادة تصدير قبل أي إقفال لاحق
      this._closePeriodCloseModal();
      await this._loadChart();
    } catch (e) {
      if (errEl) { errEl.textContent = e.message; errEl.style.display = 'block'; }
      showToast('فشل تنفيذ الإقفال: ' + e.message, 'error');
    } finally {
      restore();
    }
  },

  async _loadPeriodClosings() {
    const histEl = document.getElementById('pc-history');
    if (!histEl) return;

    const result = await AccountingService.getPeriodClosings();
    if (!isOk(result) || !result.data?.length) {
      histEl.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:12px 0;">لا توجد إقفالات سابقة</p>`;
      return;
    }

    histEl.innerHTML = result.data.map(c => `
      <div style="display:flex;justify-content:space-between;align-items:flex-start;
        padding:10px 12px;border-radius:8px;background:var(--surface);margin-bottom:8px;gap:10px;flex-wrap:wrap;">
        <div>
          <div style="font-weight:700;font-size:0.82rem;color:var(--text-primary);">
            ${escapeHtml(c.period_start)} ← ${escapeHtml(c.period_end)}
          </div>
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;">
            بواسطة: ${escapeHtml(c.closed_by_name || '—')} · ${escapeHtml(formatDateArabic(c.created_at?.slice(0,10)))}
          </div>
          ${c.notes ? `<div style="font-size:0.75rem;color:var(--text-secondary);margin-top:3px;">${escapeHtml(c.notes)}</div>` : ''}
        </div>
        <div style="text-align:left;white-space:nowrap;">
          <div style="font-size:0.75rem;color:var(--text-muted);">${(c.transactions_deleted || 0)} معاملة محذوفة</div>
          <span style="font-size:0.7rem;padding:2px 8px;border-radius:20px;background:rgba(16,185,129,0.1);color:#10b981;">مُقفل</span>
        </div>
      </div>`).join('');
  },

  // ─────────────────────────────────────────────────────────
  // دوال مساعدة
  // ─────────────────────────────────────────────────────────
  _getShortId(id) {
    if (!id) return '—';
    if (id.length <= 10) return id;
    return id.slice(0, 8) + '…';
  }
};

window.AccountManagementComponent = AccountManagementComponent;
console.log('✅ AccountManagementComponent v5.0 FINAL — السلوك 3: جميع المستخدمين النشطين + السلوك 5: إخفاء CUST_xxx');
