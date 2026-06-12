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
    this._container = container;
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
      <option value="receipt">📥 استلام</option>
      <option value="delivery">📤 تسليم</option>`;
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
    btnGroup.appendChild(mkBtn('printer','طباعة',()=>this._printSummary()));
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

    let opening = 0;
    if (agentId) {
      const bal = await AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId));
      if (isOk(bal)) opening = bal.data;
    }

    this._renderStats(opening, agentId);
    this._renderTransactionsList();
  },

  _renderStats(opening = 0, agentId = null) {
    const el = document.getElementById('summary-stats');
    if (!el) return;

    // إخفاء عنصر الرصيد الافتتاحي المنفصل (مدمج الآن في الشبكة)
    const openingEl = document.getElementById('summary-opening');
    if (openingEl) openingEl.style.display = 'none';

    const txs = AppStore.getState('transactions').filter(tx => !tx.is_reversed);
    const s   = { collection:0, deposit:0, bank_withdrawal:0, expense:0, receipt:0, delivery:0 };
    const cnt = { collection:0, deposit:0, bank_withdrawal:0, expense:0, receipt:0, delivery:0 };
    txs.forEach(tx => {
      if (s.hasOwnProperty(tx.type)) {
        s[tx.type]   += parseFloat(tx.amount || 0);
        cnt[tx.type] += 1;
      }
    });

    // الرصيد المتبقي الفعلي = السابق + واردات − صادرات
    const closing = opening + s.collection + s.receipt + s.bank_withdrawal
                            - s.deposit  - s.expense  - s.delivery;

    const agentName = agentId
      ? (AppStore.getState('users').find(u => u.id === agentId)?.display_name || '')
      : null;

    const kpis = [
      // البطاقة الأولى: الرصيد السابق
      { label:'الرصيد السابق',                value:opening,           icon:'🏦', cls:'kpi-accent',
        subtitle: agentName || 'إجمالي المناديب', count:null, highlight:'var(--accent)' },
      // أنواع العمليات
      { label:'تحصيلات',       value:s.collection,     icon:'💰', cls:'kpi-success',  count:cnt.collection },
      { label:'إيداعات',       value:s.deposit,         icon:'🏧', cls:'kpi-info',     count:cnt.deposit },
      { label:'سحب بنكي',     value:s.bank_withdrawal, icon:'💳', cls:'kpi-info',     count:cnt.bank_withdrawal },
      { label:'مصروفات',       value:s.expense,         icon:'💸', cls:'kpi-danger',   count:cnt.expense },
      { label:'حوالات واردة', value:s.receipt,         icon:'📥', cls:'kpi-success',  count:cnt.receipt },
      { label:'حوالات صادرة', value:s.delivery,        icon:'📤', cls:'kpi-warning',  count:cnt.delivery },
      // البطاقة الأخيرة: الرصيد الفعلي
      { label:'الرصيد الفعلي في الصندوق', value:closing, icon:'📊',
        cls:closing >= 0 ? 'kpi-success' : 'kpi-danger', count:null,
        highlight: closing >= 0 ? 'var(--success)' : 'var(--danger)' },
    ];

    el.innerHTML = kpis.map(k => `
      <div class="kpi-card ${escapeHtml(k.cls)}"
           style="${k.highlight ? `border:2px solid ${k.highlight};` : ''}">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
          <span style="font-size:1.2rem;">${k.icon}</span>
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

  async _renderOpeningBalance(date, agentId) {
    const el = document.getElementById('summary-opening');
    if (!el) return;
    let opening = 0;
    if (agentId) {
      const bal = await AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId));
      if (isOk(bal)) opening = bal.data;
    }
    const agentName = agentId ? (AppStore.getState('users').find(u=>u.id===agentId)?.display_name||'') : 'إجمالي المناديب';
    el.innerHTML = `
      <span style="font-size:0.85rem;color:var(--text-secondary);">
        ${agentId?`رصيد صندوق ${escapeHtml(agentName)}`:'الرصيد الإجمالي'}
      </span>
      <span style="font-size:1rem;font-weight:700;color:${opening>=0?'var(--success)':'var(--danger)'};">
        ${formatCurrency(opening)}
      </span>`;
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
        <div class="empty-state-icon">📋</div>
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
        if (btn.dataset.action==='share')  this._shareTransaction(tx);
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

  _buildTxRow(tx, users) {
    const color    = getTransactionColor(tx.type);
    const label    = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
    const typeIcon = {collection:'💰',deposit:'🏦',bank_withdrawal:'💳',expense:'💸',receipt:'📥',delivery:'📤',refund_settlement:'🔄'}[tx.type]||'📋';
    const isToday  = tx.date===getCurrentSaudiDate();
    const canEdit  = AuthService.isAdmin()||isToday;
    const isPending       = tx.sync_status===SYNC_STATUS.PENDING;
    const isApprovalPending = tx.approval_status === 'pending';
    const isRejected      = tx.approval_status === 'rejected';
    const agent    = users.find(u=>u.id===tx.agent_id);

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
              ${tx.is_reversed?'<span class="badge badge-danger" style="font-size:0.68rem;">مُعكوس</span>':''}
              ${isApprovalPending?'<span class="badge" style="font-size:0.68rem;background:rgba(217,119,6,0.15);color:var(--warning);">⏳ بانتظار الموافقة</span>':''}
              ${isRejected?'<span class="badge badge-danger" style="font-size:0.68rem;">مرفوض</span>':''}
              ${isPending?'<span class="sync-dot pending" title="معلق مزامنة"></span>':''}
            </div>
            <div style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;">
              ${tx.customer_name?escapeHtml(tx.customer_name)+' · ':''}
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
            ${AuthService.isAdmin()&&!tx.is_reversed?`
              <button class="btn-icon" data-action="delete" data-id="${escapeHtml(tx.id)}" title="حذف"
                style="width:32px;height:32px;color:var(--danger);">
                <i data-lucide="trash-2" style="width:14px;height:14px;pointer-events:none;"></i>
              </button>`:''
            }
            <button class="btn-icon" data-action="share" data-id="${escapeHtml(tx.id)}" title="مشاركة"
              style="width:32px;height:32px;color:var(--success);">
              <i data-lucide="share-2" style="width:14px;height:14px;pointer-events:none;"></i>
            </button>
          </div>
        </div>
      </div>`;
  },

  async _handleDelete(tx) {
    const isToday = tx.date===getCurrentSaudiDate();
    const msg = isToday
      ? `هل تريد حذف عملية ${TRANSACTION_TYPE_LABELS[tx.type]} بمبلغ ${formatCurrency(tx.amount)}؟`
      : `هذه العملية من تاريخ ${formatDateArabic(tx.date)}. سيتم إنشاء قيد عكسي. هل تريد المتابعة؟`;
    const confirmed = await confirmDialog(msg,'حذف','إلغاء','danger');
    if (!confirmed) return;
    if (isToday) {
      const result = await repo.delete(TABLES.TRANSACTIONS,tx.id);
      if(isOk(result)){AppStore.deleteTransaction(tx.id);showToast('تم حذف العملية','success');}
      else showToast(`فشل: ${result.error}`,'error');
    } else {
      const result = await AccountingService.reverseEntries(tx.id);
      if(isOk(result)){AppStore.markTransactionReversed(tx.id);showToast('تم عكس العملية بنجاح','success');}
      else showToast(`فشل: ${result.error}`,'error');
    }
    this._renderTransactionsList();
  },

  _shareTransaction(tx) {
    const label = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
    const text = [
      `📊 *${label}*`,
      `💰 المبلغ: ${formatCurrency(tx.amount)}`,
      `📅 التاريخ: ${formatDateArabic(tx.date)}`,
      tx.customer_name?`👤 العميل: ${tx.customer_name}`:'',
      tx.details?`📝 ${tx.details}`:'',
      `— نظام أبو حذيفة 🔐`,
    ].filter(Boolean).join('\n');
    shareText(text,'تفاصيل العملية');
  },

  async _shareQuickSummary() {
    const txs  = AppStore.getState('transactions').filter(t=>!t.is_reversed);
    const date = AppStore.getState('selectedDate')||getCurrentSaudiDate();
    const s    = {collection:0,deposit:0,bank_withdrawal:0,expense:0,receipt:0,delivery:0};
    txs.forEach(tx=>{if(s.hasOwnProperty(tx.type))s[tx.type]+=Math.round(parseFloat(tx.amount||0));});
    const net = s.collection+s.receipt+s.bank_withdrawal-s.deposit-s.expense-s.delivery;
    const agentId = AuthService.isAgent()
      ? AuthService.getCurrentUserId()
      : (AppStore.getState('selectedAgentId')||AuthService.getCurrentUserId());
    const balResult = await AccountingService.getAccountBalance(`AGT_${agentId}`);
    const bal = isOk(balResult)?Math.round(balResult.data):net;
    const user = AppStore.getState('users').find(u=>u.id===agentId)||AuthService.getCurrentUser();

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
        const who   = tx.customer_name||tx.details||'';
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

  _printSummary() {
    const txs  = AppStore.getState('transactions').filter(t => !t.is_reversed);
    const date = AppStore.getState('selectedDate') || getCurrentSaudiDate();
    const user = AuthService.getCurrentUser();
    const logo = AppStore.getState('logoUrl') || '';
    const s    = { collection:0, deposit:0, bank_withdrawal:0, expense:0, receipt:0, delivery:0 };
    txs.forEach(tx => { if (s.hasOwnProperty(tx.type)) s[tx.type] += Math.round(parseFloat(tx.amount || 0)); });
    const net   = s.collection + s.receipt + s.bank_withdrawal - s.deposit - s.expense - s.delivery;
    const total = Math.round(txs.reduce((acc, t) => acc + parseFloat(t.amount || 0), 0));

    const tableHTML = PrintService.buildTable(
      ['#', 'النوع', 'المبلغ (ر.س)', 'التفاصيل', 'الوقت'],
      txs.map((tx, i) => [
        i + 1,
        TRANSACTION_TYPE_LABELS[tx.type] || tx.type,
        Math.round(parseFloat(tx.amount || 0)).toLocaleString('en-US'),
        tx.customer_name || tx.details || '—',
        tx.created_at
          ? new Date(tx.created_at).toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' })
          : '—',
      ]),
      [`الإجمالي (${txs.length} عملية)`, '', total.toLocaleString('en-US'), '', ''],
    );

    PrintService.print({
      title    : 'الملخص اليومي',
      subtitle : 'نظام أبو حذيفة للصرافة والتحويلات',
      date     : formatDateArabic(date),
      userName : user?.display_name || '',
      logo,
      statsCards: [
        { label:'📥 التحصيلات',  value:`+${s.collection.toLocaleString('en-US')} ر.س`, color:'#059669' },
        { label:'🏦 الإيداعات',   value:`−${s.deposit.toLocaleString('en-US')} ر.س`,   color:'#0284c7' },
        { label:'💳 السحب البنكي', value:`+${s.bank_withdrawal.toLocaleString('en-US')} ر.س`, color:'#0284c7' },
        { label:'💸 المصروفات',   value:`−${s.expense.toLocaleString('en-US')} ر.س`,   color:'#dc2626' },
        { label:'📥 الحوالات الواردة',  value:`+${s.receipt.toLocaleString('en-US')} ر.س`,  color:'#0284c7' },
        { label:'📤 الحوالات الصادرة', value:`−${s.delivery.toLocaleString('en-US')} ر.س`, color:'#dc2626' },
        { label:'💰 الرصيد الفعلي',    value:`${net>=0?'+':'−'}${Math.abs(net).toLocaleString('en-US')} ر.س`, color: net>=0?'#059669':'#dc2626' },
      ],
      tableHTML,
      footerExtra: user?.display_name || '',
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
      const result = await repo.update(TABLES.TRANSACTIONS,tx.id,{
        amount:parseFloat(amount), date:date||tx.date, details:details?.trim()||null,
      });
      restore();
      if(isOk(result)){
        AppStore.updateTransaction(tx.id,{amount:parseFloat(amount),date,details});
        showToast('تم تعديل العملية بنجاح','success');
        this._closeEditModal();
        this._renderTransactionsList();
      } else { if(errEl)errEl.textContent=result.error; }
    });
    this._editModal.style.display='flex';
  },

  _closeEditModal() { if(this._editModal)this._editModal.style.display='none'; },
};

window.DailySummaryComponent = DailySummaryComponent;
console.log('✅ DailySummaryComponent v3.0 — فلتر كل المناديب للمدير');
