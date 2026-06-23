/**
 * components/DashboardComponent.js — v4.1 (FIXED)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * الإصلاحات:
 * ✅ FIX-5b: تسريب الذاكرة — Realtime subscription
 *    المشكلة: عند التنقل من Dashboard → تبويب آخر → العودة،
 *    كانت _subscribeRealtime() تُنشئ subscription جديدة بدون إلغاء القديمة.
 *    مع مرور الوقت: عشرات الـ subscriptions المتراكمة = استهلاك ذاكرة + طلبات مكررة.
 *
 *    الحل: destroy() تُلغي الـ subscriptions وتُدمر الـ charts تماماً.
 *    App.js (المُصحَّح) يستدعي destroy() تلقائياً عند كل تغيير تبويب.
 *
 * ✅ FIX-3: استخدام supabaseClient المُوحَّد (لا supabase الخام)
 */

'use strict';

const DashboardComponent = {
  _chart1      : null,
  _chart2      : null,
  _container   : null,
  _unsubscribeRealtime: null, // دالة إلغاء الاشتراك من RealtimeChannelManager
  _isSubscribed       : false,
  _dashData           : null,
  _selectedDate       : null,
  _viewMode           : 'day',

  async render(container) {
    this._container    = container;
    this._selectedDate = getCurrentSaudiDate();
    this._viewMode     = 'day';

    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="lock" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
        <div class="empty-state-text">لوحة المعلومات للمدير فقط</div></div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    container.innerHTML = `
      <div id="dash-root">
        <div class="dash-header">
          <div>
            <h2 class="dash-title">لوحة المعلومات</h2>
            <p class="dash-subtitle" id="dash-subtitle">
              جميع المستخدمين — ${formatDateArabic(getCurrentSaudiDate())}
            </p>
          </div>
          <div class="dash-controls">
            <div class="dash-mode-group">
              <button id="dash-mode-day" class="btn btn-sm dash-mode-btn active">
                يوم
              </button>
              <button id="dash-mode-month" class="btn btn-sm dash-mode-btn">
                شهر
              </button>
            </div>
            <input id="dash-date-picker" type="date"
              value="${getCurrentSaudiDate()}"
              max="${getCurrentSaudiDate()}"
              class="form-control dash-date">
            <button id="dash-refresh-btn" class="btn btn-secondary btn-sm dash-refresh-btn">
              <i data-lucide="refresh-cw" class="dash-icon-sm"></i> تحديث
            </button>
          </div>
        </div>

        <div class="kpi-grid" id="kpi-grid">
          ${[1,2,3,4].map(() => `<div class="skeleton" style="height:95px;border-radius:16px;"></div>`).join('')}
        </div>

        <div class="grid-2 dash-section">
          <div class="glass-card">
            <h3 class="dash-section-title">
              <i data-lucide="trending-up" style="width:16px;height:16px;vertical-align:middle;stroke:var(--primary,#2563eb);"></i> حركة آخر 7 أيام
            </h3>
            <div class="dash-chart-wrap">
              <canvas id="chart-weekly" role="img" aria-label="رسم بياني لحركة المبالغ خلال آخر 7 أيام"></canvas>
            </div>
          </div>
          <div class="glass-card">
            <h3 class="dash-section-title">
              <i data-lucide="pie-chart" style="width:16px;height:16px;vertical-align:middle;stroke:var(--primary,#2563eb);"></i> توزيع العمليات
            </h3>
            <div class="dash-chart-wrap">
              <canvas id="chart-pie" role="img" aria-label="رسم بياني دائري لتوزيع أنواع العمليات"></canvas>
            </div>
          </div>
        </div>

        <div class="glass-card dash-section">
          <h3 class="dash-section-title">
            <i data-lucide="landmark" style="width:16px;height:16px;vertical-align:middle;stroke:var(--primary,#2563eb);"></i> الحسابات البنكية — السقف اليومي
          </h3>
          <div id="bank-progress-list">
            ${[1,2].map(() => `<div class="skeleton" style="height:56px;border-radius:12px;margin-bottom:10px;"></div>`).join('')}
          </div>
        </div>

        <div class="glass-card dash-section">
          <div class="dash-section-header">
            <h3 class="dash-section-title"><i data-lucide="users" style="width:16px;height:16px;vertical-align:middle;stroke:var(--primary,#2563eb);"></i> صناديق المناديب</h3>
            <span id="agents-date-label" class="dash-date-label"></span>
          </div>
          <div id="agents-grid" class="dash-agents-grid">
            ${[1,2].map(() => `<div class="skeleton" style="height:180px;border-radius:14px;"></div>`).join('')}
          </div>
        </div>

        <div class="glass-card">
          <div class="dash-section-header" style="margin-bottom:14px;">
            <h3 class="dash-section-title"><i data-lucide="clock" style="width:16px;height:16px;vertical-align:middle;stroke:var(--primary,#2563eb);"></i> أحدث العمليات</h3>
            <button id="dash-view-all-btn" class="dash-view-all-btn">
              عرض الكل ←
            </button>
          </div>
          <div id="recent-tx-list">
            ${[1,2,3,4,5].map(() => `<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`).join('')}
          </div>
        </div>
      </div>`;

    document.getElementById('dash-refresh-btn')?.addEventListener('click', () => this._loadAll());
    document.getElementById('dash-view-all-btn')?.addEventListener('click', () => window._appNavigateTo?.('all-operations'));

    document.getElementById('dash-date-picker')?.addEventListener('change', (e) => {
      this._selectedDate = e.target.value || getCurrentSaudiDate();
      this._updateSubtitle();
      this._loadAll();
    });

    document.getElementById('dash-mode-day')?.addEventListener('click', () => {
      this._viewMode = 'day';
      this._applyModeStyle();
      this._loadAll();
    });
    document.getElementById('dash-mode-month')?.addEventListener('click', () => {
      this._viewMode = 'month';
      this._applyModeStyle();
      this._loadAll();
    });

    this._updateSubtitle();
    if (window.lucide) lucide.createIcons();
    await this._loadAll();
    this._subscribeRealtime();
  },

  _updateSubtitle() {
    const sub    = document.getElementById('dash-subtitle');
    const picker = document.getElementById('dash-date-picker');
    if (!sub) return;

    let label = '';
    if (this._viewMode === 'month') {
      const d  = new Date(this._selectedDate + 'T12:00:00');
      const mo = d.toLocaleString('ar-SA', { month: 'long', year: 'numeric', timeZone: APP_CONFIG.TIMEZONE });
      label = `جميع المستخدمين — شهر ${mo}`;
      if (picker) { picker.type = 'month'; picker.value = this._selectedDate.slice(0, 7); }
    } else {
      label = `جميع المستخدمين — ${formatDateArabic(this._selectedDate)}`;
      if (picker) { picker.type = 'date'; picker.value = this._selectedDate; }
    }
    sub.textContent = label;

    const agentsLabel = document.getElementById('agents-date-label');
    if (agentsLabel) agentsLabel.textContent = label;
  },

  _applyModeStyle() {
    const btnDay   = document.getElementById('dash-mode-day');
    const btnMonth = document.getElementById('dash-mode-month');
    if (btnDay)   btnDay.classList.toggle('active', this._viewMode === 'day');
    if (btnMonth) btnMonth.classList.toggle('active', this._viewMode === 'month');
  },

  _getDateRange() {
    if (this._viewMode === 'month') {
      const prefix = this._selectedDate.slice(0, 7);
      const from   = `${prefix}-01`;
      const d      = new Date(this._selectedDate + 'T12:00:00');
      const last   = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      const to     = `${prefix}-${String(last).padStart(2, '0')}`;
      return { from, to };
    }
    return { from: this._selectedDate, to: this._selectedDate };
  },

  async _loadAll() {
    const btn = document.getElementById('dash-refresh-btn');
    if (btn) { btn.disabled = true; btn.querySelector('i')?.classList.add('animate-spin'); }

    try {
      const { from, to } = this._getDateRange();

      if (!isOfflineMode() && isOnline()) {
        // FIX-3: استخدام supabaseClient المُوحَّد
        const { data, error } = await supabaseClient.rpc(RPC.GET_ADMIN_DASHBOARD, {
          p_date: this._selectedDate, p_from: from, p_to: to,
        });

        if (!error && data) {
          this._dashData = data;
          this._renderFromDashData(data);
          await this._loadWeeklyChart();
          return;
        }
      }

      await Promise.allSettled([
        this._loadKPI(from, to),
        this._loadBankProgress(from, to),
        this._loadAgentsBoxes(from, to),
        this._loadRecentTx(from, to),
      ]);
      await this._loadWeeklyChart();

    } finally {
      if (btn) { btn.disabled = false; btn.querySelector('i')?.classList.remove('animate-spin'); }
    }
  },

  _renderFromDashData(data) {
    this._renderKPI(data.totals);
    this._renderBankProgress(data.banks  || []);
    this._renderAgentsBoxes(data.agents  || []);
    this._renderRecentTx(data.recent     || []);
    this._renderPieChart(data.totals);
  },

  _renderKPI(totals) {
    if (!totals) return;
    // صافي عهدة المناديب: يُفضَّل من account_balances (عبر _ledger_net) إذا توفّر
    const txNet = (totals.total_collections || 0) + (totals.total_receipts || 0) + (totals.total_bank_withdrawals || 0)
                - (totals.total_deposits || 0) - (totals.total_expenses || 0) - (totals.total_deliveries || 0);
    const net = (totals._ledger_net !== undefined && totals._ledger_net !== null)
              ? totals._ledger_net
              : txNet;

    const _kSz = 'width:20px;height:20px;vertical-align:middle;';
    const kpis = [
      { label:'التحصيلات', value: totals.total_collections || 0, icon:`<i data-lucide="banknote"      style="${_kSz}stroke:var(--success);"></i>`, color:'var(--success)', bg:'rgba(5,150,105,0.10)'  },
      { label:'الإيداعات', value: totals.total_deposits    || 0, icon:`<i data-lucide="landmark"      style="${_kSz}stroke:var(--info);"></i>`,    color:'var(--info)',    bg:'rgba(2,132,199,0.10)'  },
      { label:'المصروفات', value: totals.total_expenses    || 0, icon:`<i data-lucide="trending-down" style="${_kSz}stroke:var(--danger);"></i>`,  color:'var(--danger)',  bg:'rgba(220,38,38,0.10)'  },
      { label:'صافي الفترة', value: net,
        icon: net >= 0
          ? `<i data-lucide="bar-chart-2" style="${_kSz}stroke:var(--success);"></i>`
          : `<i data-lucide="bar-chart-2" style="${_kSz}stroke:var(--danger);"></i>`,
        color: net >= 0 ? 'var(--success)' : 'var(--danger)',
        bg:    net >= 0 ? 'rgba(5,150,105,0.10)' : 'rgba(220,38,38,0.10)' },
    ];

    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.innerHTML = kpis.map(k => `
      <div class="glass-card kpi-card" style="border-right:3px solid ${k.color};background:${k.bg};">
        <div class="kpi-header">
          <span class="kpi-icon">${k.icon}</span>
          <span class="kpi-label">${escapeHtml(k.label)}</span>
        </div>
        <div class="kpi-value" style="color:${k.color};">
          ${k.value < 0 ? '−' : ''}${Math.abs(Math.round(k.value)).toLocaleString('en-US')}
          <span class="kpi-currency">${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
        <div class="kpi-count">${totals.total_tx_count || 0} عملية</div>
      </div>`).join('');
    if (window.lucide) lucide.createIcons();
  },

  async _loadKPI(from, to) {
    let txs = [];
    try {
      if (!isOfflineMode() && isOnline()) {
        const { data } = await supabaseClient
          .from(TABLES.TRANSACTIONS).select('type,amount,is_reversed')
          .gte('date', from).lte('date', to).eq('is_reversed', false);
        txs = data || [];
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        txs = await db.transactions.where('date').between(from, to, true, true)
          .filter(t => !t.is_reversed).toArray();
      }
    } catch { txs = []; }

    const sum = (type) => txs.filter(t => t.type === type)
      .reduce((s, t) => s + Math.round(parseFloat(t.amount) || 0), 0);

    // حساب الصافي من account_balances (أدق من مجموع transactions)
    let ledgerNet = null;
    try {
      if (!isOfflineMode() && isOnline()) {
        const { data: balData } = await supabaseClient
          .from(TABLES.ACCOUNT_BALANCES).select('balance')
          .like('account_id', 'AGT_%');
        if (balData?.length) {
          ledgerNet = balData.reduce((s, b) => s + Math.round(parseFloat(b.balance) || 0), 0);
        }
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        const balArr = await db.account_balances
          .filter(b => b.account_id && b.account_id.startsWith('AGT_')).toArray();
        if (balArr.length) {
          ledgerNet = balArr.reduce((s, b) => s + Math.round(parseFloat(b.balance) || 0), 0);
        }
      }
    } catch { /* استخدام حساب transactions كبديل */ }

    const totals = {
      total_collections      : sum('collection'),
      total_deposits         : sum('deposit'),
      total_bank_withdrawals : sum('bank_withdrawal'),
      total_expenses         : sum('expense'),
      total_receipts         : sum('receipt'),
      total_deliveries       : sum('delivery'),
      total_tx_count         : txs.length,
      // net من account_balances إذا توفّر، وإلا يُحسب من transactions
      _ledger_net            : ledgerNet,
    };
    this._renderKPI(totals);
    this._renderPieChart(totals);
  },

  _renderPieChart(totals) {
    const pieCtx = document.getElementById('chart-pie');
    if (!pieCtx) return;
    const values = [
      totals.total_collections || 0,
      totals.total_deposits    || 0,
      totals.total_expenses    || 0,
      totals.total_receipts    || 0,
      totals.total_deliveries  || 0,
    ];
    if (this._chart2) { this._chart2.destroy(); this._chart2 = null; }
    if (values.every(v => v === 0)) {
      pieCtx.parentElement.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:190px;color:var(--text-muted);font-size:0.85rem;">لا توجد عمليات</div>`;
      return;
    }
    this._chart2 = new Chart(pieCtx, {
      type: 'doughnut',
      data: {
        labels: ['تحصيل','إيداع','مصروف','استلام','تسليم'],
        datasets: [{
          data: values,
          backgroundColor: ['#059669','#0284c7','#dc2626','#7c3aed','#d97706'],
          borderWidth: 2, borderColor: 'rgba(255,255,255,0.1)', hoverOffset: 8,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position:'bottom', labels:{ font:{ family:'IBM Plex Sans Arabic', size:10 }, color:'#94a3b8', padding:10 } } },
      },
    });
  },

  async _loadWeeklyChart() {
    const lineCtx = document.getElementById('chart-weekly');
    if (!lineCtx) return;

    const days7 = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - 6 + i);
      return d.toLocaleDateString('en-CA', { timeZone: APP_CONFIG.TIMEZONE });
    });

    // BND-3.1.2: قراءة من account_ledger (AGT_) بدلاً من transactions
    // مدين = دخل إجمالي للمناديب | دائن = خروج إجمالي من المناديب
    let debitData = [], creditData = [];
    try {
      if (!isOfflineMode() && isOnline()) {
        const { data } = await supabaseClient
          .from(TABLES.ACCOUNT_LEDGER)
          .select('date,debit,credit')
          .in('date', days7)
          .like('account_id', 'AGT_%');
        debitData  = days7.map(d => (data||[]).filter(e=>e.date===d).reduce((s,e)=>s+Math.round(parseFloat(e.debit) ||0),0));
        creditData = days7.map(d => (data||[]).filter(e=>e.date===d).reduce((s,e)=>s+Math.round(parseFloat(e.credit)||0),0));
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        const weekStart = days7[0];
        const weekEnd   = days7[days7.length - 1];
        const entries   = await db.account_ledger
          .where('date').between(weekStart, weekEnd, true, true)
          .filter(e => e.account_id && e.account_id.startsWith('AGT_'))
          .toArray();
        debitData  = days7.map(d => entries.filter(e=>e.date===d).reduce((s,e)=>s+Math.round(parseFloat(e.debit) ||0),0));
        creditData = days7.map(d => entries.filter(e=>e.date===d).reduce((s,e)=>s+Math.round(parseFloat(e.credit)||0),0));
      }
    } catch { debitData = days7.map(()=>0); creditData = days7.map(()=>0); }

    if (this._chart1) { this._chart1.destroy(); this._chart1 = null; }
    this._chart1 = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: days7.map(d => { const dt = new Date(d+'T12:00:00'); return dt.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric'}); }),
        datasets: [
          { label:'دخل العهدة (مدين)', data:debitData,  borderColor:'#059669', backgroundColor:'rgba(5,150,105,0.08)', tension:0.4, fill:true, pointRadius:3, pointHoverRadius:5 },
          { label:'خروج العهدة (دائن)', data:creditData, borderColor:'#dc2626', backgroundColor:'rgba(220,38,38,0.08)', tension:0.4, fill:true, pointRadius:3, pointHoverRadius:5 },
        ],
      },
      options: {
        responsive:true, maintainAspectRatio:false,
        interaction:{ mode:'index', intersect:false },
        scales: {
          x:{ ticks:{ font:{ family:'IBM Plex Sans Arabic', size:10 }, color:'#94a3b8' }, grid:{ display:false } },
          y:{ ticks:{ font:{ family:'IBM Plex Sans Arabic', size:10 }, color:'#94a3b8', callback: v=>v.toLocaleString('en-US') }, grid:{ color:'rgba(148,163,184,0.08)' }, beginAtZero:true },
        },
        plugins: { legend:{ labels:{ font:{ family:'IBM Plex Sans Arabic', size:10 }, color:'#94a3b8' } } },
      },
    });
  },

  _renderBankProgress(banks) {
    const el = document.getElementById('bank-progress-list');
    if (!el) return;
    if (!banks.length) {
      el.innerHTML = `<div class="dash-empty">لا توجد إيداعات في هذه الفترة</div>`;
      return;
    }
    el.innerHTML = banks.map(b => {
      const used = Math.round(b.used_today || 0);
      const ceil = Math.round(b.financial_ceiling || 0);
      const pct  = ceil > 0 ? Math.min(100, Math.round(used / ceil * 100)) : 0;
      const cls  = pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low';
      return `
        <div class="bank-item">
          <div class="bank-item-header">
            <span class="bank-name"><i data-lucide="landmark" style="width:14px;height:14px;vertical-align:middle;"></i> ${escapeHtml(b.name||'—')}</span>
            <span class="bank-stats">${used.toLocaleString('en-US')} / ${ceil.toLocaleString('en-US')} ر.س (${pct}%)</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
        </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  async _loadBankProgress(from, to) {
    const el = document.getElementById('bank-progress-list');
    if (!el) return;
    try {
      let banks = AppStore.getState('bankAccounts') || [];
      let totals = {};

      if (!isOfflineMode() && isOnline()) {
        // FIX-3: استخدام supabaseClient
        const { data } = await supabaseClient
          .from(TABLES.TRANSACTIONS).select('bank_account_id,amount')
          .eq('type','deposit').gte('date',from).lte('date',to).eq('is_reversed',false)
          .not('bank_account_id','is',null);
        (data||[]).forEach(t => { totals[t.bank_account_id] = (totals[t.bank_account_id]||0) + Math.round(parseFloat(t.amount)||0); });
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        const txs = await db.transactions.where('date').between(from,to,true,true)
          .filter(t=>t.type==='deposit'&&!t.is_reversed&&t.bank_account_id).toArray();
        txs.forEach(t => { totals[t.bank_account_id] = (totals[t.bank_account_id]||0) + Math.round(parseFloat(t.amount)||0); });
      }

      const banksWithData = banks.map(b => ({ ...b, used_today: totals[b.id]||0 }))
        .filter(b => b.used_today > 0 || banks.length <= 5);
      this._renderBankProgress(banksWithData);
    } catch (e) {
      el.innerHTML = `<div class="dash-empty">فشل جلب بيانات البنوك</div>`;
    }
  },

  _renderAgentsBoxes(agents) {
    const el = document.getElementById('agents-grid');
    if (!el) return;
    if (!agents.length) {
      el.innerHTML = `<div class="dash-empty" style="grid-column:1/-1;">لا يوجد مناديب نشطون</div>`;
      return;
    }
    const colors = ['#2563eb','#059669','#7c3aed','#d97706','#0284c7'];
    el.innerHTML = agents.map(a => {
      const balance = Math.round(a.balance||0);
      const col     = Math.round(a.collections||0);
      const dep     = Math.round(a.deposits||0);
      const exp     = Math.round(a.expenses||0);
      const rec     = Math.round(a.receipts||0);
      const initial = (a.agent_name||'؟').charAt(0);
      const colIdx  = (a.agent_name||'').charCodeAt(0) % colors.length;
      return `
        <div class="glass-card agent-card" style="border-right:3px solid ${colors[colIdx]};">
          <div class="agent-card-header">
            <div class="agent-avatar" style="background:linear-gradient(135deg,${colors[colIdx]},${colors[(colIdx+1)%colors.length]});">
              ${escapeHtml(initial)}
            </div>
            <div>
              <div class="agent-name">${escapeHtml(a.agent_name||'—')}</div>
              <div class="agent-tx-count">${a.tx_count||0} عملية</div>
            </div>
          </div>
          <div class="agent-stats">
            <div class="agent-stat-label">رصيد الصندوق</div>
            <div class="agent-stat-value" style="font-weight:700;color:var(--info);">${balance>=0?'':'−'}${Math.abs(balance).toLocaleString('en-US')}</div>
            ${col>0?`<div class="agent-stat-label">تحصيل</div><div class="agent-stat-value" style="color:var(--success);">+${col.toLocaleString('en-US')}</div>`:''}
            ${dep>0?`<div class="agent-stat-label">إيداع</div><div class="agent-stat-value" style="color:var(--info);">−${dep.toLocaleString('en-US')}</div>`:''}
            ${exp>0?`<div class="agent-stat-label">مصروف</div><div class="agent-stat-value" style="color:var(--danger);">−${exp.toLocaleString('en-US')}</div>`:''}
            ${rec>0?`<div class="agent-stat-label">استلام</div><div class="agent-stat-value" style="color:var(--warning);">+${rec.toLocaleString('en-US')}</div>`:''}
          </div>
          <div class="agent-balance-footer">
            <span class="agent-balance-label">الرصيد الحالي</span>
            <span class="agent-balance-value" style="color:${balance>=0?'var(--success)':'var(--danger)'};">
              ${balance>=0?'':'−'}${Math.abs(balance).toLocaleString('en-US')}
              <span class="kpi-currency">${APP_CONFIG.CURRENCY_SYMBOL}</span>
            </span>
          </div>
        </div>`;
    }).join('');
  },

  async _loadAgentsBoxes(from, to) {
    const el = document.getElementById('agents-grid');
    if (!el) return;
    const allUsers = AppStore.getState('users');
    const agents   = allUsers.filter(u => u.role === 'agent' && u.is_active);
    if (!agents.length) { el.innerHTML = `<div class="dash-empty">لا يوجد مناديب</div>`; return; }

    let txs = [], balances = {};
    const agentAccountIds = agents.map(a => `AGT_${a.id}`);
    try {
      if (!isOfflineMode() && isOnline()) {
        // الرصيد دائماً من account_balances (المصدر الأمين) + التجميعات من transactions للعرض
        const [txRes, balRes] = await Promise.all([
          supabaseClient.from(TABLES.TRANSACTIONS).select('agent_id,type,amount')
            .gte('date',from).lte('date',to).eq('is_reversed',false),
          supabaseClient.from(TABLES.ACCOUNT_BALANCES).select('account_id,balance')
            .in('account_id', agentAccountIds),
        ]);
        txs = txRes.data || [];
        (balRes.data||[]).forEach(b => { balances[b.account_id] = Math.round(parseFloat(b.balance)||0); });
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        txs = await db.transactions.where('date').between(from,to,true,true).filter(t=>!t.is_reversed).toArray();
        // الرصيد من account_balances في Dexie (أكثر دقة من تجميع transactions)
        const balArr = await db.account_balances.where('account_id').anyOf(agentAccountIds).toArray();
        balArr.forEach(b => { balances[b.account_id] = Math.round(parseFloat(b.balance)||0); });
      }
    } catch (e) { console.warn('⚠️ Dashboard: فشل تحميل البيانات:', e.message); }

    const agentsData = agents.map(a => ({
      agent_id    : a.id,
      agent_name  : a.display_name,
      balance     : balances[`AGT_${a.id}`] || 0,
      collections : txs.filter(t=>t.agent_id===a.id&&t.type==='collection').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      deposits    : txs.filter(t=>t.agent_id===a.id&&t.type==='deposit').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      expenses    : txs.filter(t=>t.agent_id===a.id&&t.type==='expense').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      receipts    : txs.filter(t=>t.agent_id===a.id&&t.type==='receipt').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      tx_count    : txs.filter(t=>t.agent_id===a.id).length,
    }));
    this._renderAgentsBoxes(agentsData);
  },

  _renderRecentTx(recent) {
    const el = document.getElementById('recent-tx-list');
    if (!el) return;
    if (!recent.length) {
      el.innerHTML = `<div class="dash-empty">لا توجد عمليات في هذه الفترة</div>`;
      return;
    }
    const _tiSz = 'width:16px;height:16px;vertical-align:middle;';
    const typeIcons = {
      collection          : `<i data-lucide="banknote"      style="${_tiSz}stroke:var(--success);"></i>`,
      deposit             : `<i data-lucide="landmark"      style="${_tiSz}stroke:var(--info);"></i>`,
      bank_withdrawal     : `<i data-lucide="credit-card"   style="${_tiSz}stroke:var(--warning);"></i>`,
      expense             : `<i data-lucide="trending-down" style="${_tiSz}stroke:var(--danger);"></i>`,
      receipt             : `<i data-lucide="inbox"         style="${_tiSz}stroke:var(--accent,#8b5cf6);"></i>`,
      delivery            : `<i data-lucide="send"          style="${_tiSz}stroke:var(--info);"></i>`,
      refund_settlement   : `<i data-lucide="rotate-ccw"    style="${_tiSz}stroke:var(--warning);"></i>`,
      failed_deposit_refund:`<i data-lucide="repeat"        style="${_tiSz}stroke:var(--warning);"></i>`,
      journal_entry       : `<i data-lucide="book-open"     style="${_tiSz}stroke:var(--text-secondary,#64748b);"></i>`,
    };
    el.innerHTML = recent.map(tx => {
      const amt   = Math.round(parseFloat(tx.amount)||0);
      const icon  = typeIcons[tx.type] || `<i data-lucide="file-text" style="${_tiSz}"></i>`;
      const color = getTransactionColor ? getTransactionColor(tx.type) : 'var(--text-primary)';
      const label = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
      const secondary = tx.customer_name||tx.bank_name||tx.company_name||tx.details||'';
      return `
        <div class="tx-item">
          <div class="tx-icon-wrap" style="background:${color}18;">
            ${icon}
          </div>
          <div class="tx-details">
            <div class="tx-label-row">
              ${escapeHtml(label)}
              ${secondary?`<span class="tx-secondary">— ${escapeHtml(secondary)}</span>`:''}
            </div>
            <div class="tx-meta">
              ${escapeHtml(tx.agent_name||'—')}
              ${tx.time?`· ${String(tx.time).substring(0,5)}`:''}
            </div>
          </div>
          <div class="tx-amount" style="color:${color};">
            ${amt.toLocaleString('en-US')}
            <span class="kpi-currency">${APP_CONFIG.CURRENCY_SYMBOL}</span>
          </div>
        </div>`;
    }).join('');
    if (window.lucide) lucide.createIcons();
  },

  async _loadRecentTx(from, to) {
    const el = document.getElementById('recent-tx-list');
    if (!el) return;
    let txs = [];
    try {
      if (!isOfflineMode() && isOnline()) {
        // FIX-3: استخدام supabaseClient
        const { data } = await supabaseClient
          .from(TABLES.TRANSACTIONS)
          .select('id,type,amount,date,time,agent_id,customer_name,details,is_reversed,company_id,bank_account_id')
          .gte('date',from).lte('date',to)
          .order('created_at',{ascending:false}).limit(10);
        txs = data||[];
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        txs = await db.transactions.where('date').between(from,to,true,true)
          .filter(t=>!t.is_reversed).reverse().limit(10).toArray();
      }
    } catch { txs = []; }

    if (!txs.length) {
      el.innerHTML = `<div class="dash-empty">لا توجد عمليات</div>`;
      return;
    }
    const users        = AppStore.getState('users');
    const bankAccounts = AppStore.getState('bankAccounts');
    const companies    = AppStore.getState('companies');
    const recent = txs.map(tx => ({
      ...tx,
      agent_name   : users.find(u=>u.id===tx.agent_id)?.display_name||'—',
      bank_name    : bankAccounts.find(b=>b.id===tx.bank_account_id)?.name||null,
      company_name : companies.find(c=>c.id===tx.company_id)?.name||null,
    }));
    this._renderRecentTx(recent);
  },

  // ============================================================
  // FIX-5b: Realtime Subscription — مع منع التكرار
  // ============================================================

  _subscribeRealtime() {
    if (this._isSubscribed) return;

    let _debounceTimer = null;

    // تسجيل عبر ChannelManager — يمنع التكرار تلقائياً
    this._unsubscribeRealtime = RealtimeChannelManager.subscribe(
      'dash-transactions',
      'transactions',
      { event: '*' },
      () => {
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
          if (!document.getElementById('dash-root')) return;
          const { from, to } = this._getDateRange();
          this._loadKPI(from, to);
          this._loadAgentsBoxes(from, to);
          this._loadRecentTx(from, to);
        }, 1500);
      }
    );

    this._isSubscribed = true;
  },

  destroy() {
    console.log('🧹 DashboardComponent.destroy(): تنظيف الموارد');

    if (typeof this._unsubscribeRealtime === 'function') {
      this._unsubscribeRealtime();
      this._unsubscribeRealtime = null;
    }
    this._isSubscribed = false;

    if (this._chart1) {
      try { this._chart1.destroy(); } catch { }
      this._chart1 = null;
    }
    if (this._chart2) {
      try { this._chart2.destroy(); } catch { }
      this._chart2 = null;
    }

    this._dashData  = null;
    this._container = null;
  },

  onSleep() {
    if (typeof this._unsubscribeRealtime === 'function') {
      this._unsubscribeRealtime();
      this._unsubscribeRealtime = null;
    }
    this._isSubscribed = false;
  },

  // ============================================================
  // onResume — يُستدعى من Tab Panel Manager عند إظهار التبويب
  // يُعيد تفعيل Realtime ويُحدّث البيانات إن تغيّر التاريخ
  // ============================================================
  async onResume() {
    const todayDate = getCurrentSaudiDate();
    const staleDate = this._selectedDate !== todayDate;

    // إذا تغيّر اليوم (جلسة ليلية طويلة) → تحديث تلقائي
    if (staleDate) {
      this._selectedDate = todayDate;
      const datePicker = document.getElementById('dash-date-picker');
      if (datePicker) datePicker.value = todayDate;
      await this._loadAll();
    }

    // إعادة تفعيل Realtime دائماً عند العودة
    this._subscribeRealtime();
    console.log('▶️ DashboardComponent.onResume()');
  },
};

window.DashboardComponent = DashboardComponent;
console.log('✅ DashboardComponent v4.3 — Tab Panel Manager: onSleep/onResume | TTL-aware');
