/**
 * components/DailySummaryComponent.js — v3.0
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * إصلاحات:
 * 1. فلتر المندوب للمدير والمساعد يشمل جميع المناديب
 * 2. الأول في القائمة "جميع المناديب" لعرض إجمالي
 * 3. إصلاح الرصيد الافتتاحي ليعكس رصيد المندوب المختار
 * 4. تحسين بصري للبطاقات
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
'use strict';

const DailySummaryComponent = {
  _page       : 1,
  _pageSize   : 20,
  _typeFilter : '',
  _container  : null,
  _editModal  : null,

  async render(container) {
    this._container  = container;
    this._currentDate = getCurrentSaudiDate();
    this._page = 1;
    this._typeFilter = '';
    container.innerHTML = '';
    container.appendChild(await this._buildPage());
    await this._loadData();
  },

  async _buildPage() {
    const wrap = document.createElement('div');

    // شريط التحكم
    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px;';

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;';
    title.textContent = 'الملخص اليومي';
    topBar.appendChild(title);

    // فلتر التاريخ
    const dateInput = document.createElement('input');
    dateInput.type = 'date';
    dateInput.id = 'summary-date-input';
    dateInput.className = 'form-control';
    dateInput.style.cssText = 'width:155px;padding:8px 12px;font-size:0.88rem;';
    dateInput.value = AppStore.getState('selectedDate')||getCurrentSaudiDate();
    dateInput.addEventListener('change', () => {
      AppStore.setSelectedDate(dateInput.value);
      this._page = 1;
      this._loadData();
    });
    topBar.appendChild(dateInput);

    // فلتر المندوب للمدير والمساعد
    if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      const agentSelect = document.createElement('select');
      agentSelect.id = 'summary-agent-filter';
      agentSelect.className = 'form-control';
      agentSelect.style.cssText = 'width:175px;padding:8px 12px;font-size:0.88rem;';

      // الأول: جميع المناديب (لعرض الإجمالي)
      agentSelect.innerHTML = `<option value="">📊 إجمالي جميع المناديب</option>`;

      // جميع المناديب النشطين
      const allAgents = AppStore.getState('users').filter(u => u.role === ROLES.AGENT && u.is_active);
      allAgents.forEach(a => {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = `👤 ${a.display_name}`;
        agentSelect.appendChild(o);
      });

      const saved = AppStore.getState('selectedAgentId');
      if (saved) agentSelect.value = saved;

      agentSelect.addEventListener('change', () => {
        AppStore.setSelectedAgent(agentSelect.value||null);
        this._page = 1;
        this._loadData();
      });
      topBar.appendChild(agentSelect);
    }

    // فلتر نوع العملية
    const typeSelect = document.createElement('select');
    typeSelect.id = 'summary-type-filter';
    typeSelect.className = 'form-control';
    typeSelect.style.cssText = 'width:130px;padding:8px 12px;font-size:0.88rem;';
    typeSelect.innerHTML = `
      <option value="">الكل</option>
      <option value="collection">💰 تحصيل</option>
      <option value="deposit">🏦 إيداع</option>
      <option value="bank_withdrawal">💳 سحب بنكي</option>
      <option value="expense">💸 مصروف</option>
      <option value="receipt">🔄 تحويل</option>
      <option value="delivery">📤 تسليم عهدة</option>
      <option value="refund_settlement">↩️ تسوية استرداد</option>
      <option value="failed_deposit_refund">🔃 استرداد إيداع فاشل</option>
      <option value="journal_entry">📒 قيد محاسبي</option>
      <option value="external_handover">📤 تسليم عهدة</option>`;
    typeSelect.addEventListener('change', () => {
      this._typeFilter = typeSelect.value;
      this._page = 1;
      this._renderTransactionsList();
    });
    topBar.appendChild(typeSelect);

    // أزرار التقارير
    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

    const mkBtn = (icon, label, fn) => {
      const b = document.createElement('button');
      b.className = 'btn btn-secondary btn-sm';
      b.innerHTML = `<i data-lucide="${icon}" style="width:13px;height:13px;"></i> ${label}`;
      b.addEventListener('click', fn);
      return b;
    };
    btnGroup.appendChild(mkBtn('zap','سريع',()=>this._shareQuickSummary()));
    btnGroup.appendChild(mkBtn('file-text','مفصل',()=>this._showDetailedReport()));
    btnGroup.appendChild(mkBtn('printer','طباعة/PDF',()=>this._printSummary()));
    btnGroup.appendChild(mkBtn('table-2','Excel',()=>this._exportDailyExcel()));
    topBar.appendChild(btnGroup);

    wrap.appendChild(topBar);

    // بطاقات الإحصائيات
    const statsRow = document.createElement('div');
    statsRow.id = 'summary-stats';
    statsRow.className = 'kpi-grid';
    statsRow.style.marginBottom = '20px';
    statsRow.innerHTML = [1,2,3,4,5,6,7].map(()=>
      `<div class="kpi-card"><div class="skeleton" style="height:20px;width:60%;margin-bottom:8px;border-radius:4px;"></div>
       <div class="skeleton" style="height:28px;width:80%;border-radius:6px;"></div></div>`
    ).join('');
    wrap.appendChild(statsRow);

    // الرصيد الافتتاحي
    const openingWrap = document.createElement('div');
    openingWrap.id = 'summary-opening';
    openingWrap.className = 'glass-card-sm';
    openingWrap.style.cssText = 'margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;';
    openingWrap.innerHTML = `
      <div class="skeleton skeleton-text" style="width:45%;"></div>
      <div class="skeleton skeleton-text" style="width:28%;"></div>`;
    wrap.appendChild(openingWrap);

    // قائمة العمليات
    const listCard = document.createElement('div');
    listCard.className = 'glass-card';
    listCard.style.padding = '0';

    const listHeader = document.createElement('div');
    listHeader.style.cssText = 'padding:16px 20px;border-bottom:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;';
    listHeader.innerHTML = `
      <h3 style="font-size:0.9rem;font-weight:700;color:var(--text-secondary);">العمليات</h3>
      <span id="summary-count" style="font-size:0.78rem;color:var(--text-muted);"></span>`;
    listCard.appendChild(listHeader);

    const listEl = document.createElement('div');
    listEl.id = 'summary-tx-list';
    listEl.style.minHeight = '100px';
    listEl.innerHTML = `<div style="padding:12px 16px;">${renderSkeleton('row', 5)}</div>`;
    listCard.appendChild(listEl);

    const pagerEl = document.createElement('div');
    pagerEl.id = 'summary-pager';
    pagerEl.style.cssText = 'padding:12px 20px;display:flex;justify-content:center;gap:8px;border-top:1px solid var(--border-color);flex-wrap:wrap;';
    listCard.appendChild(pagerEl);

    wrap.appendChild(listCard);

    this._editModal = this._buildEditModal();
    wrap.appendChild(this._editModal);

    return wrap;
  },

  async _loadData() {
    const date    = AppStore.getState('selectedDate')||getCurrentSaudiDate();
    const agentId = AuthService.isAgent()
      ? AuthService.getCurrentUserId()
      : (AppStore.getState('selectedAgentId')||null);

    await AppStore.refreshTransactions(date, agentId);

    // رصيد الإغلاق من account_balances (المصدر الصحيح)
    let currentBalance = 0;
    // صافي حركة اليوم من account_ledger (المصدر الأمين للأرقام المالية)
    let ledgerNetToday = 0;

    if (agentId) {
      const [balResult, netResult] = await Promise.all([
        AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId)),
        AccountingService.getAgentDailyLedgerNet(agentId, date),
      ]);
      if (isOk(balResult)) currentBalance = balResult.data;
      if (isOk(netResult)) ledgerNetToday  = netResult.data;
    } else if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      const allAgents = AppStore.getState('users').filter(u => u.role === ROLES.AGENT && u.is_active);
      if (allAgents.length) {
        const [balResults, netResults] = await Promise.all([
          Promise.all(allAgents.map(a => AccountingService.getAccountBalance(AccountingService.AccountId.agent(a.id)))),
          Promise.all(allAgents.map(a => AccountingService.getAgentDailyLedgerNet(a.id, date))),
        ]);
        currentBalance = balResults.reduce((sum, r) => sum + (isOk(r) ? r.data : 0), 0);
        ledgerNetToday = netResults.reduce((sum, r) => sum + (isOk(r) ? r.data : 0), 0);
      }
    }

    this._renderStats(currentBalance, ledgerNetToday, agentId);
    this._renderTransactionsList();
  },

  _renderStats(currentBalance = 0, ledgerNetToday = 0, agentId = null) {
    const el = document.getElementById('summary-stats');
    if (!el) return;

    const openingEl = document.getElementById('summary-opening');
    if (openingEl) openingEl.style.display = 'none';

    // تفاصيل الأنواع من transactions (للعرض والعدد فقط — ليست للأرقام المالية)
    const txs = AppStore.getState('transactions').filter(tx => !tx.is_reversed);
    const s   = { collection:0, deposit:0, bank_withdrawal:0, expense:0, receipt:0, delivery:0,
                  refund_settlement:0, failed_deposit_refund:0, journal_entry:0, external_handover:0 };
    const cnt = { collection:0, deposit:0, bank_withdrawal:0, expense:0, receipt:0, delivery:0,
                  refund_settlement:0, failed_deposit_refund:0, journal_entry:0, external_handover:0 };
    txs.forEach(tx => {
      if (s.hasOwnProperty(tx.type)) {
        s[tx.type]   += parseFloat(tx.amount || 0);
        cnt[tx.type] += 1;
      }
    });

    // الأرقام الصحيحة من المصادر الأمينة (account_balances + account_ledger)
    const closing = currentBalance;                  // رصيد إغلاق من account_balances
    const opening = currentBalance - ledgerNetToday; // رصيد افتتاح = الإغلاق − صافي account_ledger

    const agentName = agentId
      ? (AppStore.getState('users').find(u => u.id === agentId)?.display_name || '')
      : null;

    const kpis = [
      // البطاقة الأولى: الرصيد السابق (بداية اليوم)
      { label:'الرصيد السابق',                value:opening,           icon:'landmark',          cls:'kpi-accent',
        subtitle: agentName || 'إجمالي المناديب', count:null, highlight:'var(--accent)' },
      // أنواع العمليات
      { label:'تحصيلات',              value:s.collection,          icon:'banknote',           cls:'kpi-success',  count:cnt.collection },
      { label:'إيداعات',              value:s.deposit,             icon:'building-2',         cls:'kpi-info',     count:cnt.deposit },
      { label:'سحب بنكي',            value:s.bank_withdrawal,     icon:'credit-card',        cls:'kpi-info',     count:cnt.bank_withdrawal },
      { label:'مصروفات',              value:s.expense,             icon:'receipt',            cls:'kpi-danger',   count:cnt.expense },
      { label:'حوالات واردة',        value:s.receipt,             icon:'arrow-down-circle',  cls:'kpi-success',  count:cnt.receipt },
      { label:'حوالات صادرة',        value:s.delivery,            icon:'arrow-up-circle',    cls:'kpi-warning',  count:cnt.delivery },
      ...(cnt.refund_settlement     > 0 ? [{ label:'تسوية استرداد',       value:s.refund_settlement,    icon:'rotate-ccw',        cls:'kpi-warning', count:cnt.refund_settlement }]    : []),
      ...(cnt.failed_deposit_refund > 0 ? [{ label:'استرداد إيداع فاشل', value:s.failed_deposit_refund, icon:'refresh-cw',         cls:'kpi-warning', count:cnt.failed_deposit_refund }] : []),
      ...(cnt.journal_entry         > 0 ? [{ label:'قيود محاسبية',         value:s.journal_entry,        icon:'book-open',          cls:'kpi-accent',  count:cnt.journal_entry }]         : []),
      ...(cnt.external_handover    > 0 ? [{ label:'تسليم عهدة',           value:s.external_handover,    icon:'arrow-up-circle',    cls:'kpi-warning', count:cnt.external_handover }]     : []),
      // البطاقة الأخيرة: الرصيد الفعلي
      { label:'الرصيد الفعلي في الصندوق', value:closing, icon:'bar-chart-2',
        cls:closing >= 0 ? 'kpi-success' : 'kpi-danger', count:null,
        highlight: closing >= 0 ? 'var(--success)' : 'var(--danger)' },
    ];

    el.innerHTML = kpis.map(k => `
      <div class="kpi-card ${escapeHtml(k.cls)}"
           style="${k.highlight ? `border:2px solid ${k.highlight};` : ''}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span class="kpi-lucide-icon"><i data-lucide="${k.icon}" style="width:22px;height:22px;"></i></span>
          <span class="kpi-label" style="font-size:0.76rem;">${escapeHtml(k.label)}</span>
        </div>
        ${k.subtitle ? `<div style="font-size:0.68rem;color:var(--text-muted);margin-bottom:4px;text-align:right;">${escapeHtml(k.subtitle)}</div>` : ''}
        <div class="kpi-value" style="font-size:1.1rem;direction:ltr;text-align:right;">
          ${k.value < 0 ? '−' : ''}${Math.abs(Math.round(k.value)).toLocaleString('en-US')}
          <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);margin-right:2px;">${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
        ${k.count !== null ? `<div style="font-size:0.68rem;color:var(--text-muted);text-align:right;margin-top:3px;">${k.count} عملية</div>` : ''}
      </div>`).join('');
  },

  _renderTransactionsList() {
    const listEl  = document.getElementById('summary-tx-list');
    const countEl = document.getElementById('summary-count');
    const pagerEl = document.getElementById('summary-pager');
    if (!listEl) return;

    let txs = AppStore.getState('transactions');
    if (this._typeFilter) txs = txs.filter(tx=>tx.type===this._typeFilter);

    if (countEl) countEl.textContent = `${txs.length} عملية`;

    const total = txs.length;
    const start = (this._page-1)*this._pageSize;
    const paged = txs.slice(start, start+this._pageSize);

    if (!paged.length) {
      listEl.innerHTML = `<div class="empty-state" style="padding:32px 0;">
        <div class="empty-state-icon"><i data-lucide="clipboard-x" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
        <div class="empty-state-text">لا توجد عمليات${this._typeFilter?' من هذا النوع':''} في هذا اليوم</div>
      </div>`;
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }

    const users = AppStore.getState('users');
    listEl.innerHTML = paged.map(tx => this._buildTxRow(tx, users)).join('');

    listEl.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tx = txs.find(t=>t.id===btn.dataset.id);
        if (!tx) return;
        if (btn.dataset.action==='edit')   this._openEditModal(tx);
        if (btn.dataset.action==='delete') this._handleDelete(tx);
        if (btn.dataset.action==='copy')   this._copyTransaction(tx);
      });
    });

    if (pagerEl && total>this._pageSize) {
      const pages = Math.ceil(total/this._pageSize);
      pagerEl.innerHTML = '';
      for (let p=1;p<=pages;p++) {
        const pbtn=document.createElement('button');
        pbtn.className=p===this._page?'btn btn-primary btn-sm':'btn btn-secondary btn-sm';
        pbtn.textContent=p; pbtn.style.minWidth='36px';
        pbtn.addEventListener('click',()=>{this._page=p;this._renderTransactionsList();});
        pagerEl.appendChild(pbtn);
      }
    } else if (pagerEl) pagerEl.innerHTML='';

    if (window.lucide) lucide.createIcons();
  },

  _resolveAccountName(tx) {
    if (tx.customer_name) return tx.customer_name;
    if (tx.bank_account_id) {
      const banks = AppStore.getState('bankAccounts') || [];
      const bank = banks.find(b => b.id === tx.bank_account_id);
      if (bank) return bank.name || bank.account_number || '';
    }
    if (tx.company_id) {
      const companies = AppStore.getState('companies') || [];
      const comp = companies.find(c => c.id === tx.company_id);
      if (comp) return comp.name || '';
    }
    if (tx.to_agent_id) {
      const users = AppStore.getState('users') || [];
      const toAgent = users.find(u => u.id === tx.to_agent_id);
      if (toAgent) return toAgent.display_name || '';
    }
    if (tx.type === 'expense' && tx.expense_type) return tx.expense_type;
    return '';
  },

  _buildTxRow(tx, users) {
    const color    = getTransactionColor(tx.type);
    const label    = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
    const _txIconMap = {collection:'banknote',deposit:'building-2',bank_withdrawal:'credit-card',expense:'receipt',receipt:'arrow-down-circle',delivery:'arrow-up-circle',refund_settlement:'rotate-ccw',failed_deposit_refund:'refresh-cw',journal_entry:'book-open',external_handover:'arrow-up-circle'};
    const typeIcon = `<i data-lucide="${_txIconMap[tx.type]||'circle'}" style="width:18px;height:18px;"></i>`;
    const isToday  = tx.date===getCurrentSaudiDate();
    const canEdit  = AuthService.isAdmin()||isToday;
    const canDelete = AuthService.isAdmin()||isToday;
    const isFailed        = tx.sync_status===SYNC_STATUS.PENDING && !!tx.error_message;
    const isPending       = tx.sync_status===SYNC_STATUS.PENDING && !tx.error_message;
    const isApprovalPending = tx.approval_status === 'pending';
    const isRejected      = tx.approval_status === 'rejected';
    const agent    = users.find(u=>u.id===tx.agent_id);
    const accountName = this._resolveAccountName(tx);

    return `
      <div style="display:flex;align-items:center;justify-content:space-between;
        padding:12px 20px;border-bottom:1px solid var(--border-color);
        transition:background var(--transition-fast);${tx.is_reversed?'opacity:0.45;':''}
        " onmouseenter="this.style.background='var(--bg-hover)'" onmouseleave="this.style.background=''">
        <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1;">
          <div style="width:36px;height:36px;border-radius:10px;flex-shrink:0;
            background:${color}18;display:flex;align-items:center;justify-content:center;
            font-size:1.1rem;">
            ${typeIcon}
          </div>
          <div style="min-width:0;">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
              <span style="font-weight:700;font-size:0.9rem;">${escapeHtml(label)}</span>
              ${accountName?`<span style="font-size:0.78rem;color:var(--text-muted);font-weight:500;">← ${escapeHtml(accountName)}</span>`:''}
              ${tx.is_reversed?'<span class="badge badge-danger" style="font-size:0.68rem;">مُعكوس</span>':''}
              ${isApprovalPending?'<span class="badge" style="font-size:0.68rem;background:rgba(217,119,6,0.15);color:var(--warning);">⏳ بانتظار الموافقة</span>':''}
              ${isRejected?'<span class="badge badge-danger" style="font-size:0.68rem;">مرفوض</span>':''}
              ${isFailed  ? '<span style="font-size:0.7rem;color:var(--danger);font-weight:700;" title="فشل المزامنة — سيُعاد المحاولة تلقائياً">❌</span>' : ''}
              ${isPending ? '<span class="sync-dot pending" title="معلق مزامنة — بانتظار الاتصال"></span>' : ''}
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
              ${AuthService.isAdmin()&&agent&&agent.id!==AuthService.getCurrentUserId()?`${escapeHtml(agent.display_name)} · `:''}
              ${escapeHtml(timeAgo(tx.created_at))}
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0;">
          <span style="font-weight:800;font-size:0.95rem;color:${color};">
            ${formatCurrency(tx.amount)}
          </span>
          <div style="display:flex;gap:4px;">
            ${canEdit&&!tx.is_reversed?`
              <button class="btn-icon" data-action="edit" data-id="${escapeHtml(tx.id)}" title="تعديل"
                style="width:32px;height:32px;font-size:0.9rem;">
                <i data-lucide="pencil" style="width:14px;height:14px;pointer-events:none;"></i>
              </button>`:''
            }
            ${canDelete&&!tx.is_reversed?`
              <button class="btn-icon" data-action="delete" data-id="${escapeHtml(tx.id)}" title="حذف"
                style="width:32px;height:32px;color:var(--danger);">
                <i data-lucide="trash-2" style="width:14px;height:14px;pointer-events:none;"></i>
              </button>`:''
            }
            <button class="btn-icon" data-action="copy" data-id="${escapeHtml(tx.id)}" title="نسخ"
              style="width:32px;height:32px;color:var(--accent);">
              <i data-lucide="copy" style="width:14px;height:14px;pointer-events:none;"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  async _handleDelete(tx) {
    const isPending = tx.sync_status === 'pending';
    const isAdmin   = AuthService.isAdmin();
    const isToday   = tx.date === getCurrentSaudiDate();
    const amtFmt    = formatCurrency(tx.amount);
    const label     = TRANSACTION_TYPE_LABELS[tx.type] || tx.type;

    // معاملة معلّقة (لم تُزامن) → حذف محلي مباشر
    if (isPending) {
      const confirmed = await confirmDialog(
        `هل تريد حذف عملية ${label} بمبلغ ${amtFmt}؟ (لم تُزامن بعد)`,
        'حذف', 'إلغاء', 'danger',
      );
      if (!confirmed) return;
      const result = await repo.delete(TABLES.TRANSACTIONS, tx.id);
      if (isOk(result)) {
        await AccountingService.cleanupLocalTransaction(tx.id);
        AppStore.deleteTransaction(tx.id);
        showToast('تم حذف العملية', 'success');
      } else showToast(`فشل: ${result.error}`, 'error');
      this._renderTransactionsList();
      return;
    }

    // المدير: قيد عكسي (يحفظ سجل التدقيق)
    if (isAdmin) {
      const confirmed = await confirmDialog(
        `هذه العملية مُزامنة. سيتم إنشاء قيد عكسي بدل الحذف. هل تريد المتابعة؟`,
        'عكس', 'إلغاء', 'danger',
      );
      if (!confirmed) return;
      const result = await AccountingService.reverseEntries(tx.id);
      if (isOk(result)) { AppStore.markTransactionReversed(tx.id); showToast('تم عكس العملية بنجاح', 'success'); }
      else showToast(`فشل: ${result.error}`, 'error');
      this._renderTransactionsList();
      return;
    }

    // المندوب: حذف نهائي لعمليات اليوم الحالي فقط
    if (!isToday) {
      showToast('يمكنك حذف عمليات اليوم الحالي فقط', 'error');
      return;
    }
    const confirmed = await confirmDialog(
      `حذف نهائي لعملية ${label} بمبلغ ${amtFmt}؟ سيُعكس أثرها على رصيدك ولا يمكن التراجع.`,
      'حذف نهائي', 'إلغاء', 'danger',
    );
    if (!confirmed) return;
    const result = await AccountingService.deleteTransactionCompletely(tx.id);
    if (isOk(result)) {
      AppStore.deleteTransaction(tx.id);
      showToast('تم حذف العملية نهائياً', 'success');
      await this._loadData();
    } else {
      showToast(`فشل: ${result.error}`, 'error');
      this._renderTransactionsList();
    }
  },

  _copyTransaction(tx) {
    const label = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
    const accountName = this._resolveAccountName(tx);
    const agent = (AppStore.getState('users')||[]).find(u=>u.id===tx.agent_id);
    const bankName = tx.bank_account_id
      ? ((AppStore.getState('bankAccounts')||[]).find(b=>b.id===tx.bank_account_id)?.name || '')
      : '';
    const companyName = tx.company_id
      ? ((AppStore.getState('companies')||[]).find(c=>c.id===tx.company_id)?.name || '')
      : '';
    const text = [
      `📊 *${label}*`,
      `💰 المبلغ: ${formatCurrency(tx.amount)}`,
      `📅 التاريخ: ${formatDateArabic(tx.date)}`,
      `⏰ الوقت: ${tx.time || '—'}`,
      accountName ? `🏷️ الحساب: ${accountName}` : '',
      tx.customer_name ? `👤 العميل: ${tx.customer_name}` : '',
      bankName ? `🏦 البنك: ${bankName}` : '',
      companyName ? `🏢 الشركة: ${companyName}` : '',
      agent && tx.type !== 'expense' ? `👤 المندوب: ${agent.display_name}` : '',
      tx.details && tx.type !== 'expense' ? `📝 ملاحظات: ${tx.details}` : '',
      tx.type === 'expense' ? `📋 التفاصيل: عليكم مصروفات نوع ${tx.expense_type || 'عام'} بواسطة ${agent?.display_name || '—'}${tx.details ? ` لغرض(${tx.details})` : ''}` : '',
      `🔖 رقم العملية: ${tx.id?.substring(0,8) || '—'}`,
      `— نظام أبو حذيفة 🔐`,
    ].filter(Boolean).join('\n');
    copyToClipboard(text, 'تم نسخ بيانات القيد');
  },

  async _exportDailyExcel() {
    const txs      = AppStore.getState('transactions').filter(t => !t.is_reversed);
    const date     = AppStore.getState('selectedDate') || getCurrentSaudiDate();
    const agentId  = AuthService.isAgent()
      ? AuthService.getCurrentUserId()
      : (AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId());
    const user     = AppStore.getState('users').find(u => u.id === agentId) || AuthService.getCurrentUser();

    // بيانات صفوف التفاصيل من transactions (للعرض)
    const pd = PrintService.buildStatementPrintData(txs, {
      date      : formatDateArabic(date),
      userName  : user?.display_name || '',
      companies : AppStore.getState('companies')    || [],
      banks     : AppStore.getState('bankAccounts') || [],
      users     : AppStore.getState('users')        || [],
    });

    // جلب الأرقام الصحيحة من account_ledger وaccount_balances
    const [balResult, netResult] = await Promise.all([
      agentId ? AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId)) : Promise.resolve(null),
      agentId ? AccountingService.getAgentDailyLedgerNet(agentId, date) : Promise.resolve(null),
    ]);
    const closingBal  = (balResult && isOk(balResult))  ? Math.round(balResult.data)  : null;
    const ledgerNet   = (netResult  && isOk(netResult))  ? Math.round(netResult.data)  : null;
    const openingBal  = (closingBal !== null && ledgerNet !== null) ? closingBal - ledgerNet : null;

    const fmt = n => Math.abs(Math.round(n)).toLocaleString('en-US');

    const headers = [...pd.columns, 'الحالة'];
    // خريطة id → صف pd لتجنب خلط الفهارس مع العمليات المعكوسة
    const pdRowMap = new Map(txs.map((tx, i) => [tx.id, pd.rows[i]]));
    const allTxs   = AppStore.getState('transactions');
    const rows     = allTxs.map(tx => {
      const base   = pdRowMap.get(tx.id) || [tx.date || '—', tx.time ? tx.time.substring(0, 5) : '—',
        (window.TRANSACTION_TYPE_LABELS?.[tx.type] || tx.type), '0', '0', '—'];
      const status = tx.is_reversed ? 'مُعكوس' : (tx.sync_status === SYNC_STATUS.PENDING ? 'معلق' : 'مزامَن');
      return [...base, status];
    });

    // صف الإجماليات — يُميّز بين أرقام account_ledger وأرقام transactions
    if (openingBal !== null)
      rows.push(['الرصيد الافتتاحي (account_ledger)', '', '', '', '', `${fmt(openingBal)} ر.س`, '']);
    rows.push(['الإجمالي (transactions)', '', `${txs.length} عملية`,
      `لكم: ${fmt(pd.totalLakum)}`, `عليكم: ${fmt(pd.totalAlaykum)}`,
      `الصافي: ${fmt(pd.net)} ${pd.netSign}`, '']);
    if (ledgerNet !== null)
      rows.push(['صافي اليوم (account_ledger)', '', '', '', '',
        `${ledgerNet >= 0 ? '' : '−'}${fmt(ledgerNet)} ر.س`, '']);
    if (closingBal !== null)
      rows.push(['الرصيد الختامي (account_balances)', '', '', '', '',
        `${closingBal >= 0 ? '' : '−'}${fmt(closingBal)} ر.س`, '']);

    const btn = document.querySelector('[data-lucide="table-2"]')?.closest('button');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ ...'; }
    try {
      await PrintService.exportToExcel(headers, rows, `ملخص ${date}`, `daily_summary_${date}`);
    } catch (e) {
      showToast(`❌ فشل التصدير: ${e.message}`, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.innerHTML = '<i data-lucide="table-2" style="width:13px;height:13px;"></i> Excel'; if (window.lucide) lucide.createIcons(); }
    }
  },

  async _shareQuickSummary() {
    const txs  = AppStore.getState('transactions').filter(t=>!t.is_reversed);
    const date = AppStore.getState('selectedDate')||getCurrentSaudiDate();
    const s    = {collection:0,deposit:0,bank_withdrawal:0,expense:0,receipt:0,delivery:0};
    txs.forEach(tx=>{if(s.hasOwnProperty(tx.type))s[tx.type]+=Math.round(parseFloat(tx.amount||0));});
    const net = s.collection+s.receipt+s.bank_withdrawal-s.deposit-s.expense-s.delivery;
    const agentId = AuthService.isAgent()
      ? AuthService.getCurrentUserId()
      : (AppStore.getState('selectedAgentId') || null);

    let bal = net;
    let user = AuthService.getCurrentUser();

    if (agentId) {
      // مندوب محدد — رصيده الفعلي من account_balances
      const balResult = await AccountingService.getAccountBalance(`AGT_${agentId}`);
      if (isOk(balResult)) bal = Math.round(balResult.data);
      user = AppStore.getState('users').find(u => u.id === agentId) || user;
    } else if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      // إجمالي جميع المناديب — مجموع أرصدتهم من account_balances
      const allAgents = AppStore.getState('users').filter(u => u.role === ROLES.AGENT && u.is_active);
      if (allAgents.length) {
        const results = await Promise.all(
          allAgents.map(a => AccountingService.getAccountBalance(`AGT_${a.id}`))
        );
        bal = results.reduce((sum, r) => sum + (isOk(r) ? Math.round(r.data) : 0), 0);
      }
      user = { display_name: 'إجمالي جميع المناديب' };
    }

    const text = [
      `📊 *ملخص يوم ${formatDateArabic(date)}*`,
      `👤 ${escapeHtml(user?.display_name||'')}`,
      `────────────────`,
      `📥 تحصيلات:  *${s.collection.toLocaleString('en-US')} ر.س*`,
      `🏦 إيداعات:  *${s.deposit.toLocaleString('en-US')} ر.س*`,
      s.bank_withdrawal?`💳 سحب بنكي: *${s.bank_withdrawal.toLocaleString('en-US')} ر.س*`:'',
      `💸 مصروفات:  *${s.expense.toLocaleString('en-US')} ر.س*`,
      s.receipt?`📥 حوالات واردة:  *${s.receipt.toLocaleString('en-US')} ر.س*`:'',
      s.delivery?`📤 حوالات صادرة: *${s.delivery.toLocaleString('en-US')} ر.س*`:'',
      `────────────────`,
      `💰 *الرصيد الفعلي في الصندوق: ${bal>=0?'':'−'}${Math.abs(bal).toLocaleString('en-US')} ر.س*`,
      `— نظام أبو حذيفة 🔐`,
    ].filter(Boolean).join('\n');

    const overlay=document.createElement('div');
    overlay.className='modal-overlay';overlay.style.cssText='display:flex;z-index:1200;';
    overlay.addEventListener('click',e=>{if(e.target===overlay)document.body.removeChild(overlay);});
    const box=document.createElement('div');
    box.className='modal-box';box.style.maxWidth='420px';
    box.innerHTML=`
      <div class="modal-header">
        <h3 class="modal-title">⚡ الملخص السريع</h3>
        <button class="modal-close" id="qs-close">✕</button>
      </div>
      <div style="background:var(--bg-hover);border-radius:12px;padding:14px;font-size:0.85rem;line-height:2;white-space:pre-wrap;direction:rtl;margin-bottom:14px;border:1px solid var(--border-color);max-height:300px;overflow-y:auto;">
        ${escapeHtml(text)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button id="qs-copy" class="btn btn-primary" style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <i data-lucide="copy" style="width:14px;height:14px;"></i> نسخ
        </button>
        <button id="qs-wa" class="btn btn-secondary" style="background:rgba(37,211,102,0.12);border-color:rgba(37,211,102,0.3);color:#25d366;">📱 واتساب</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    box.querySelector('#qs-close').addEventListener('click',()=>document.body.removeChild(overlay));
    box.querySelector('#qs-copy').addEventListener('click',()=>copyToClipboard(text,'تم نسخ الملخص'));
    box.querySelector('#qs-wa').addEventListener('click',()=>window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,'_blank'));
    if(window.lucide)lucide.createIcons();
  },

  _showDetailedReport() {
    const txs  = AppStore.getState('transactions').filter(t=>!t.is_reversed);
    const date = AppStore.getState('selectedDate')||getCurrentSaudiDate();
    const user = AuthService.getCurrentUser();
    const s    = {collection:0,deposit:0,bank_withdrawal:0,expense:0,receipt:0,delivery:0};
    txs.forEach(tx=>{if(s.hasOwnProperty(tx.type))s[tx.type]+=Math.round(parseFloat(tx.amount||0));});
    const net = s.collection+s.receipt+s.bank_withdrawal-s.deposit-s.expense-s.delivery;
    const lines = [
      `📋 *تقرير مفصل — ${formatDateArabic(date)}*`,
      `👤 ${user?.display_name||''}`,
      `────────────────`,
      ...txs.map((tx,i)=>{
        const icon  = {collection:'💰',deposit:'🏦',expense:'💸',receipt:'📥',delivery:'📤'}[tx.type]||'📋';
        const label = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
        const amt   = Math.round(parseFloat(tx.amount||0));
        const who   = tx.type === 'expense'
          ? `نوع ${tx.expense_type || 'عام'}${tx.details ? ` لغرض(${tx.details})` : ''}`
          : (tx.customer_name || tx.details || '');
        return `${i+1}. ${icon} ${label}: *${amt.toLocaleString('en-US')} ر.س*${who?` — ${who}`:''}`;
      }),
      `────────────────`,
      `💰 *الرصيد الفعلي: ${net>=0?'':'−'}${Math.abs(net).toLocaleString('en-US')} ر.س*`,
      `— نظام أبو حذيفة 🔐`,
    ].join('\n');
    const overlay=document.createElement('div');
    overlay.className='modal-overlay';overlay.style.cssText='display:flex;z-index:1200;';
    overlay.addEventListener('click',e=>{if(e.target===overlay)document.body.removeChild(overlay);});
    const box=document.createElement('div');box.className='modal-box';box.style.maxWidth='480px';
    box.innerHTML=`
      <div class="modal-header">
        <h3 class="modal-title">📋 التقرير المفصل (${txs.length} عملية)</h3>
        <button class="modal-close" id="dr-close">✕</button>
      </div>
      <div style="background:var(--bg-hover);border-radius:12px;padding:14px;font-size:0.82rem;line-height:1.9;white-space:pre-wrap;direction:rtl;margin-bottom:14px;border:1px solid var(--border-color);max-height:360px;overflow-y:auto;">
        ${escapeHtml(lines)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">
        <button id="dr-copy" class="btn btn-primary" style="font-size:0.82rem;display:flex;align-items:center;justify-content:center;gap:4px;"><i data-lucide="copy" style="width:12px;height:12px;"></i> نسخ</button>
        <button id="dr-wa" class="btn btn-secondary" style="font-size:0.82rem;background:rgba(37,211,102,0.12);border-color:rgba(37,211,102,0.3);color:#25d366;">📱 واتساب</button>
        <button id="dr-print" class="btn btn-secondary" style="font-size:0.82rem;display:flex;align-items:center;justify-content:center;gap:4px;"><i data-lucide="printer" style="width:12px;height:12px;"></i> طباعة</button>
      </div>`;
    overlay.appendChild(box);document.body.appendChild(overlay);
    box.querySelector('#dr-close').addEventListener('click',()=>document.body.removeChild(overlay));
    box.querySelector('#dr-copy').addEventListener('click',()=>copyToClipboard(lines,'تم نسخ التقرير'));
    box.querySelector('#dr-wa').addEventListener('click',()=>window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(lines)}`,'_blank'));
    box.querySelector('#dr-print').addEventListener('click',()=>{document.body.removeChild(overlay);this._printSummary();});
    if(window.lucide)lucide.createIcons();
  },

  async _printSummary() {
    const txs      = AppStore.getState('transactions').filter(t => !t.is_reversed);
    const date     = AppStore.getState('selectedDate') || getCurrentSaudiDate();
    const logo     = AppStore.getState('logoUrl') || '';
    const agentId  = AuthService.isAgent()
      ? AuthService.getCurrentUserId()
      : (AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId());
    const user     = AppStore.getState('users').find(u => u.id === agentId) || AuthService.getCurrentUser();
    const userName = user?.display_name || '';

    // صفوف التفاصيل من transactions
    const pd = PrintService.buildStatementPrintData(txs, {
      date      : formatDateArabic(date),
      userName,
      companies : AppStore.getState('companies')    || [],
      banks     : AppStore.getState('bankAccounts') || [],
      users     : AppStore.getState('users')        || [],
    });

    // جلب الأرقام المالية الصحيحة من account_ledger وaccount_balances
    const [balResult, netResult] = await Promise.all([
      agentId ? AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId)) : Promise.resolve(null),
      agentId ? AccountingService.getAgentDailyLedgerNet(agentId, date) : Promise.resolve(null),
    ]);
    const closingBal = (balResult && isOk(balResult)) ? Math.round(balResult.data) : null;
    const ledgerNet  = (netResult  && isOk(netResult))  ? Math.round(netResult.data)  : null;
    const openingBal = (closingBal !== null && ledgerNet !== null) ? closingBal - ledgerNet : null;

    const fmt = n => `${Math.abs(n).toLocaleString('en-US')} ر.س`;
    const ledgerTotalsLine = [
      pd.totalsLine,
      closingBal !== null
        ? `<span style="border-right:1px solid #cbd5e1;">الرصيد الختامي: <b style="color:#2563eb">${fmt(closingBal)}</b></span>`
        : '',
      openingBal !== null
        ? `<span style="border-right:1px solid #cbd5e1;">الرصيد الافتتاحي: <b style="color:#64748b">${fmt(openingBal)}</b></span>`
        : '',
    ].filter(Boolean).join('');

    PrintService.printStatementAdvanced({
      title      : `الملخص اليومي — ${userName}`,
      subtitle   : 'نظام أبو حذيفة للصرافة والتحويلات',
      periodText : formatDateArabic(date),
      userName,
      logo,
      columns    : pd.columns,
      rows       : pd.rows,
      totalsLine : ledgerTotalsLine,
      shareText  : pd.shareText,
    });
  },

  _buildEditModal() {
    const overlay = document.createElement('div');
    overlay.id = 'edit-tx-modal';
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click',e=>{if(e.target===overlay)this._closeEditModal();});
    const box = document.createElement('div');
    box.className = 'modal-box';
    const header = document.createElement('div');
    header.className = 'modal-header';
    header.innerHTML = `<h3 class="modal-title">تعديل العملية</h3><button class="modal-close" id="edit-modal-close">✕</button>`;
    box.appendChild(header);
    const body = document.createElement('div');
    body.id = 'edit-modal-body';
    box.appendChild(body);
    overlay.appendChild(box);
    return overlay;
  },

  _openEditModal(tx) {
    // القيود اليدوية تُبنى من سطور (_journal_entries) لا تُحفظ في الصف — يتعذّر
    // إعادة إنشاؤها تلقائياً، لذا لا تُعدَّل من هنا (تُصحَّح بالحذف/العكس).
    if (tx.type === TRANSACTION_TYPES.JOURNAL_ENTRY) {
      showToast('القيد اليدوي يُصحَّح بالحذف ثم إعادة الإدخال','info',4000);
      return;
    }
    // العملية المُزامنة تتطلب اتصالاً (الحذف النهائي على الخادم يعكس الأرصدة أولاً)
    if (tx.sync_status !== SYNC_STATUS.PENDING && (isOfflineMode() || !isOnline())) {
      showToast('تعديل عملية مُزامنة يتطلب اتصالاً بالإنترنت','warning',4000);
      return;
    }
    const body = document.getElementById('edit-modal-body');
    if (!body||!this._editModal) return;
    body.innerHTML = `
      <div class="form-group">
        <label class="form-label">المبلغ <span class="required">*</span></label>
        <input id="edit-amount" type="number" class="form-control" value="${escapeHtml(String(tx.amount))}" min="0.01" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">التاريخ</label>
        <input id="edit-date" type="date" class="form-control" value="${escapeHtml(tx.date)}">
      </div>
      <div class="form-group">
        <label class="form-label">ملاحظات</label>
        <textarea id="edit-details" class="form-control" rows="2">${escapeHtml(tx.details||'')}</textarea>
      </div>
      <div style="font-size:0.76rem;color:var(--text-muted);background:var(--bg-hover);border-radius:8px;padding:8px 10px;margin-bottom:10px;line-height:1.6;">
        ℹ️ سيُعاد ترحيل القيد بالقيم الجديدة ويُحدَّث تأثيره على جميع الحسابات والأرصدة في كل الواجهات.
      </div>
      <div id="edit-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="edit-save-btn" class="btn btn-primary" style="flex:2;">حفظ التعديل</button>
        <button id="edit-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;
    document.getElementById('edit-modal-close')?.addEventListener('click',()=>this._closeEditModal());
    document.getElementById('edit-cancel-btn')?.addEventListener('click',()=>this._closeEditModal());
    document.getElementById('edit-save-btn')?.addEventListener('click', async () => {
      const amount  = document.getElementById('edit-amount')?.value;
      const date    = document.getElementById('edit-date')?.value;
      const details = document.getElementById('edit-details')?.value;
      const errEl   = document.getElementById('edit-error');
      if (!isValidAmount(amount)) { if(errEl)errEl.textContent='المبلغ غير صالح'; return; }
      const btn = document.getElementById('edit-save-btn');
      const restore = setButtonLoading(btn);
      const result = await this._editTransaction(tx, { amount, date, details });
      restore();
      if (isOk(result)) {
        showToast('تم تعديل القيد وتحديث الأرصدة بنجاح','success');
        this._closeEditModal();
        await this._loadData();
      } else if (errEl) {
        errEl.textContent = result.error || 'تعذّر تعديل العملية';
      }
    });
    this._editModal.style.display='flex';
  },

  // تعديل فعلي للقيد: حذف العملية الأصلية كلياً (عكس الأرصدة + حذف قيودها) ثم
  // إعادة إنشائها بنفس خصائصها مع القيم المُعدَّلة — فتُبنى قيود محاسبية جديدة
  // صحيحة وينعكس الأثر على جميع الحسابات والواجهات (يستخدم المسارات المعتمدة).
  async _editTransaction(tx, { amount, date, details }) {
    const newAmount  = parseFloat(amount);
    const newDate    = date || tx.date;
    const newDetails = details?.trim() || null;

    // 1) حذف القيد الأصلي وعكس أثره على الأرصدة
    const wasPending = tx.sync_status === SYNC_STATUS.PENDING;
    let delResult;
    if (wasPending) {
      // لم تُزامن بعد → حذف محلي + إزالة من طابور المزامنة لمنع إعادة إنشائها لاحقاً
      delResult = await repo.delete(TABLES.TRANSACTIONS, tx.id);
      if (isOk(delResult)) {
        await AccountingService.cleanupLocalTransaction(tx.id);
        try {
          if (typeof db !== 'undefined' && db.isOpen()) {
            await db.sync_queue.where('record_id').equals(String(tx.id)).delete();
          }
        } catch (_e) { /* غير حرج — لن يُعاد الإنشاء لأن العملية حُذفت محلياً */ }
      }
    } else {
      delResult = await AccountingService.deleteTransactionCompletely(tx.id);
    }
    if (!isOk(delResult)) return delResult;
    AppStore.deleteTransaction(tx.id);

    // 2) إعادة إنشاء القيد بالقيم الجديدة (قيود محاسبية جديدة + تحديث الأرصدة)
    const newTxData = {
      type            : tx.type,
      amount          : newAmount,
      date            : newDate,
      agent_id        : tx.agent_id,
      company_id      : tx.company_id || null,
      bank_account_id : tx.bank_account_id || null,
      customer_id     : tx.customer_id || null,
      customer_name   : tx.customer_name || null,
      to_agent_id     : tx.to_agent_id || null,
      from_agent_id   : tx.from_agent_id || null,
      expense_type    : tx.expense_type || null,
      details         : newDetails,
    };
    if (tx.approval_status) newTxData.approval_status = tx.approval_status;

    return await AccountingService.createTransactionWithEntries(newTxData);
  },

  _closeEditModal() { if(this._editModal)this._editModal.style.display='none'; },

  async onResume() {
    // إذا تغيّر اليوم أثناء الغياب → إعادة تحميل تلقائية
    const today = getCurrentSaudiDate();
    if (this._currentDate && this._currentDate !== today) {
      await this.render(this._container);
    }
  },
};

window.DailySummaryComponent = DailySummaryComponent;
console.log('✅ DailySummaryComponent v3.1 — توحيد مصادر البيانات: الأرقام المالية من account_ledger/account_balances');
