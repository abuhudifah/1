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
  _realtimeSub : null,
  _dashData    : null,
  _selectedDate: null,
  _viewMode    : 'day',
  // FIX-5b: تتبع هل الـ subscription نشطة لمنع التكرار
  _isSubscribed: false,

  async render(container) {
    this._container    = container;
    this._selectedDate = getCurrentSaudiDate();
    this._viewMode     = 'day';

    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">لوحة المعلومات للمدير فقط</div></div>`;
      return;
    }

    container.innerHTML = `
      <div id="dash-root">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
          <div>
            <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);">لوحة المعلومات</h2>
            <p style="font-size:0.78rem;color:var(--text-muted);margin-top:2px;" id="dash-subtitle">
              جميع المستخدمين — ${formatDateArabic(getCurrentSaudiDate())}
            </p>
          </div>
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <div style="display:flex;background:var(--bg-input);border-radius:10px;padding:3px;gap:2px;">
              <button id="dash-mode-day" class="btn btn-sm"
                style="padding:5px 12px;border-radius:8px;font-size:0.78rem;background:var(--accent);color:#fff;">
                يوم
              </button>
              <button id="dash-mode-month" class="btn btn-sm"
                style="padding:5px 12px;border-radius:8px;font-size:0.78rem;background:transparent;color:var(--text-secondary);">
                شهر
              </button>
            </div>
            <input id="dash-date-picker" type="date"
              value="${getCurrentSaudiDate()}"
              max="${getCurrentSaudiDate()}"
              class="form-control"
              style="padding:6px 10px;font-size:0.82rem;width:auto;min-width:140px;">
            <button id="dash-refresh-btn" class="btn btn-secondary btn-sm"
              style="display:flex;align-items:center;gap:4px;font-size:0.78rem;">
              <i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> تحديث
            </button>
          </div>
        </div>

        <div class="kpi-grid" id="kpi-grid">
          ${[1,2,3,4].map(() => `<div class="skeleton" style="height:95px;border-radius:16px;"></div>`).join('')}
        </div>

        <div class="grid-2" style="margin-bottom:24px;">
          <div class="glass-card">
            <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:12px;color:var(--text-secondary);">
              📈 حركة آخر 7 أيام
            </h3>
            <div style="position:relative;height:190px;">
              <canvas id="chart-weekly"></canvas>
            </div>
          </div>
          <div class="glass-card">
            <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:12px;color:var(--text-secondary);">
              🥧 توزيع العمليات
            </h3>
            <div style="position:relative;height:190px;">
              <canvas id="chart-pie"></canvas>
            </div>
          </div>
        </div>

        <div class="glass-card" style="margin-bottom:24px;">
          <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:16px;color:var(--text-secondary);">
            🏦 الحسابات البنكية — السقف اليومي
          </h3>
          <div id="bank-progress-list">
            ${[1,2].map(() => `<div class="skeleton" style="height:56px;border-radius:12px;margin-bottom:10px;"></div>`).join('')}
          </div>
        </div>

        <div class="glass-card" style="margin-bottom:24px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h3 style="font-size:0.88rem;font-weight:700;color:var(--text-secondary);">👤 صناديق المناديب</h3>
            <span id="agents-date-label" style="font-size:0.78rem;color:var(--text-muted);"></span>
          </div>
          <div id="agents-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">
            ${[1,2].map(() => `<div class="skeleton" style="height:180px;border-radius:14px;"></div>`).join('')}
          </div>
        </div>

        <div class="glass-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <h3 style="font-size:0.88rem;font-weight:700;color:var(--text-secondary);">⏱ أحدث العمليات</h3>
            <button id="dash-view-all-btn"
              style="font-size:0.78rem;color:var(--accent);background:none;border:none;cursor:pointer;
                     display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;
                     transition:background var(--transition-fast);">
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
    if (btnDay) {
      btnDay.style.background = this._viewMode === 'day' ? 'var(--accent)' : 'transparent';
      btnDay.style.color      = this._viewMode === 'day' ? '#fff' : 'var(--text-secondary)';
    }
    if (btnMonth) {
      btnMonth.style.background = this._viewMode === 'month' ? 'var(--accent)' : 'transparent';
      btnMonth.style.color      = this._viewMode === 'month' ? '#fff' : 'var(--text-secondary)';
    }
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

      if (isOnline()) {
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
    const net = (totals.total_collections || 0) + (totals.total_receipts || 0)
              - (totals.total_deposits || 0) - (totals.total_expenses || 0) - (totals.total_deliveries || 0);

    const kpis = [
      { label:'التحصيلات', value: totals.total_collections || 0, icon:'💰', color:'var(--success)', bg:'rgba(5,150,105,0.10)'  },
      { label:'الإيداعات', value: totals.total_deposits    || 0, icon:'🏦', color:'var(--info)',    bg:'rgba(2,132,199,0.10)'  },
      { label:'المصروفات', value: totals.total_expenses    || 0, icon:'💸', color:'var(--danger)',  bg:'rgba(220,38,38,0.10)'  },
      { label:'صافي الفترة', value: net,                         icon:'📊',
        color: net >= 0 ? 'var(--success)' : 'var(--danger)',
        bg:    net >= 0 ? 'rgba(5,150,105,0.10)' : 'rgba(220,38,38,0.10)' },
    ];

    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.innerHTML = kpis.map(k => `
      <div class="glass-card kpi-card" style="border-right:3px solid ${k.color};background:${k.bg};">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <span style="font-size:1.5rem;">${k.icon}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600;">${escapeHtml(k.label)}</span>
        </div>
        <div class="kpi-value" style="font-size:1.45rem;font-weight:800;color:${k.color};direction:ltr;text-align:right;">
          ${k.value < 0 ? '−' : ''}${Math.abs(Math.round(k.value)).toLocaleString('en-US')}
          <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);margin-right:2px;">${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">${totals.total_tx_count || 0} عملية</div>
      </div>`).join('');
  },

  async _loadKPI(from, to) {
    let txs = [];
    try {
      if (isOnline()) {
        // FIX-3: استخدام supabaseClient
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

    const totals = {
      total_collections : sum('collection'),
      total_deposits    : sum('deposit'),
      total_expenses    : sum('expense'),
      total_receipts    : sum('receipt'),
      total_deliveries  : sum('delivery'),
      total_tx_count    : txs.length,
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

    let cData = [], dData = [];
    try {
      if (isOnline()) {
        // FIX-3: استخدام supabaseClient
        const { data } = await supabaseClient
          .from(TABLES.TRANSACTIONS).select('date,type,amount').in('date', days7).eq('is_reversed', false);
        cData = days7.map(d => (data||[]).filter(t=>t.date===d&&t.type==='collection').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
        dData = days7.map(d => (data||[]).filter(t=>t.date===d&&t.type==='deposit').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        const weekStart = days7[0];
        const weekEnd   = days7[days7.length - 1];
        const allTxs    = await db.transactions
          .where('date').between(weekStart, weekEnd, true, true)
          .filter(t => !t.is_reversed)
          .toArray();
        cData = days7.map(d => allTxs.filter(t=>t.date===d&&t.type==='collection').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
        dData = days7.map(d => allTxs.filter(t=>t.date===d&&t.type==='deposit').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
      }
    } catch { cData = days7.map(()=>0); dData = days7.map(()=>0); }

    if (this._chart1) { this._chart1.destroy(); this._chart1 = null; }
    this._chart1 = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: days7.map(d => { const dt = new Date(d+'T12:00:00'); return dt.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric'}); }),
        datasets: [
          { label:'تحصيل', data:cData, borderColor:'#059669', backgroundColor:'rgba(5,150,105,0.08)', tension:0.4, fill:true, pointRadius:3, pointHoverRadius:5 },
          { label:'إيداع',  data:dData, borderColor:'#0284c7', backgroundColor:'rgba(2,132,199,0.08)', tension:0.4, fill:true, pointRadius:3, pointHoverRadius:5 },
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
      el.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">لا توجد إيداعات في هذه الفترة</div>`;
      return;
    }
    el.innerHTML = banks.map(b => {
      const used = Math.round(b.used_today || 0);
      const ceil = Math.round(b.financial_ceiling || 0);
      const pct  = ceil > 0 ? Math.min(100, Math.round(used / ceil * 100)) : 0;
      const cls  = pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low';
      return `
        <div style="margin-bottom:14px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;">
            <span style="font-size:0.85rem;font-weight:600;">🏦 ${escapeHtml(b.name||'—')}</span>
            <span style="font-size:0.75rem;color:var(--text-muted);">${used.toLocaleString('en-US')} / ${ceil.toLocaleString('en-US')} ر.س (${pct}%)</span>
          </div>
          <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
        </div>`;
    }).join('');
  },

  async _loadBankProgress(from, to) {
    const el = document.getElementById('bank-progress-list');
    if (!el) return;
    try {
      let banks = AppStore.getState('bankAccounts') || [];
      let totals = {};

      if (isOnline()) {
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
      el.innerHTML = `<div style="color:var(--text-muted);text-align:center;padding:16px;">فشل جلب بيانات البنوك</div>`;
    }
  },

  _renderAgentsBoxes(agents) {
    const el = document.getElementById('agents-grid');
    if (!el) return;
    if (!agents.length) {
      el.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;padding:16px;grid-column:1/-1;">لا يوجد مناديب نشطون</div>`;
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
        <div class="glass-card" style="padding:14px 16px;border-right:3px solid ${colors[colIdx]};
          transition:transform var(--transition-spring),box-shadow var(--transition-normal);"
          onmouseenter="this.style.transform='translateY(-3px)';this.style.boxShadow='var(--shadow-md)'"
          onmouseleave="this.style.transform='';this.style.boxShadow=''">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div style="width:40px;height:40px;border-radius:50%;flex-shrink:0;
              background:linear-gradient(135deg,${colors[colIdx]},${colors[(colIdx+1)%colors.length]});
              display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1rem;">
              ${escapeHtml(initial)}
            </div>
            <div>
              <div style="font-weight:700;font-size:0.92rem;color:var(--text-primary);">${escapeHtml(a.agent_name||'—')}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);">${a.tx_count||0} عملية</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:0.78rem;margin-bottom:12px;">
            <div style="color:var(--text-muted);">رصيد الصندوق</div>
            <div style="text-align:left;direction:ltr;font-weight:700;color:var(--info);">${balance>=0?'':'−'}${Math.abs(balance).toLocaleString('en-US')}</div>
            ${col>0?`<div style="color:var(--text-muted);">تحصيل</div><div style="text-align:left;direction:ltr;color:var(--success);font-weight:600;">+${col.toLocaleString('en-US')}</div>`:''}
            ${dep>0?`<div style="color:var(--text-muted);">إيداع</div><div style="text-align:left;direction:ltr;color:var(--info);font-weight:600;">−${dep.toLocaleString('en-US')}</div>`:''}
            ${exp>0?`<div style="color:var(--text-muted);">مصروف</div><div style="text-align:left;direction:ltr;color:var(--danger);font-weight:600;">−${exp.toLocaleString('en-US')}</div>`:''}
            ${rec>0?`<div style="color:var(--text-muted);">استلام</div><div style="text-align:left;direction:ltr;color:var(--warning);font-weight:600;">+${rec.toLocaleString('en-US')}</div>`:''}
          </div>
          <div style="padding-top:10px;border-top:1px solid var(--border-color);display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.75rem;color:var(--text-muted);font-weight:600;">الرصيد الحالي</span>
            <span style="font-size:1.05rem;font-weight:800;color:${balance>=0?'var(--success)':'var(--danger)'};direction:ltr;">
              ${balance>=0?'':'−'}${Math.abs(balance).toLocaleString('en-US')}
              <span style="font-size:0.65rem;font-weight:500;margin-right:2px;">${APP_CONFIG.CURRENCY_SYMBOL}</span>
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
    if (!agents.length) { el.innerHTML = `<div style="color:var(--text-muted);padding:16px;">لا يوجد مناديب</div>`; return; }

    let txs = [], balances = {};
    try {
      if (isOnline()) {
        // FIX-3: استخدام supabaseClient
        const [txRes, balRes] = await Promise.all([
          supabaseClient.from(TABLES.TRANSACTIONS).select('agent_id,type,amount')
            .gte('date',from).lte('date',to).eq('is_reversed',false),
          supabaseClient.from('account_balances').select('account_id,balance')
            .in('account_id', agents.map(a=>`AGT_${a.id}`)),
        ]);
        txs = txRes.data || [];
        (balRes.data||[]).forEach(b => { balances[b.account_id] = Math.round(parseFloat(b.balance)||0); });
      } else if (typeof db !== 'undefined' && db.isOpen()) {
        txs = await db.transactions.where('date').between(from,to,true,true).filter(t=>!t.is_reversed).toArray();
        const balArr = await db.account_balances.where('account_id').anyOf(agents.map(a=>`AGT_${a.id}`)).toArray();
        balArr.forEach(b => { balances[b.account_id] = Math.round(parseFloat(b.balance)||0); });
      }
    } catch {}

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
      el.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">لا توجد عمليات في هذه الفترة</div>`;
      return;
    }
    const typeIcons = { collection:'💰', deposit:'🏦', expense:'💸', receipt:'📥', delivery:'📤', refund_settlement:'🔄' };
    el.innerHTML = recent.map(tx => {
      const amt   = Math.round(parseFloat(tx.amount)||0);
      const icon  = typeIcons[tx.type]||'📋';
      const color = getTransactionColor ? getTransactionColor(tx.type) : 'var(--text-primary)';
      const label = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
      const secondary = tx.customer_name||tx.bank_name||tx.company_name||tx.details||'';
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:10px;
          transition:background var(--transition-fast);"
          onmouseenter="this.style.background='var(--bg-hover)'"
          onmouseleave="this.style.background=''">
          <div style="width:36px;height:36px;border-radius:10px;flex-shrink:0;
            background:${color}18;display:flex;align-items:center;justify-content:center;font-size:1.1rem;">
            ${icon}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.84rem;font-weight:600;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
              ${escapeHtml(label)}
              ${secondary?`<span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;">— ${escapeHtml(secondary)}</span>`:''}
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);">
              ${escapeHtml(tx.agent_name||'—')}
              ${tx.time?`· ${String(tx.time).substring(0,5)}`:''}
            </div>
          </div>
          <div style="font-size:0.90rem;font-weight:800;color:${color};direction:ltr;flex-shrink:0;">
            ${amt.toLocaleString('en-US')}
            <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);">${APP_CONFIG.CURRENCY_SYMBOL}</span>
          </div>
        </div>`;
    }).join('');
  },

  async _loadRecentTx(from, to) {
    const el = document.getElementById('recent-tx-list');
    if (!el) return;
    let txs = [];
    try {
      if (isOnline()) {
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
      el.innerHTML = `<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">لا توجد عمليات</div>`;
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
    // FIX-5b: إلغاء أي subscription قديمة قبل إنشاء جديدة
    if (this._realtimeSub) {
      try {
        supabaseClient.removeChannel(this._realtimeSub);
      } catch (e) {
        console.warn('⚠️ DashboardComponent: خطأ في إلغاء subscription القديمة:', e.message);
      }
      this._realtimeSub = null;
      this._isSubscribed = false;
    }

    if (this._isSubscribed) return; // حماية إضافية

    let _debounceTimer = null;

    // FIX-3: استخدام supabaseClient المُوحَّد
    this._realtimeSub = supabaseClient
      .channel('dash-realtime-v4-1') // رقم إصدار جديد لتجنب تعارض channel القديم
      .on('postgres_changes', { event: '*', schema: 'public', table: 'transactions' }, () => {
        clearTimeout(_debounceTimer);
        _debounceTimer = setTimeout(() => {
          // التحقق أن المكوّن لا يزال مُثبَّتاً
          if (!document.getElementById('dash-root')) return;
          const { from, to } = this._getDateRange();
          this._loadKPI(from, to);
          this._loadAgentsBoxes(from, to);
          this._loadRecentTx(from, to);
        }, 1500);
      })
      .subscribe();

    this._isSubscribed = true;
    console.log('📡 DashboardComponent: Realtime subscription نشطة');
  },

  // ============================================================
  // FIX-5b: destroy() — تُلغي الـ subscription وتُدمر الـ charts
  //         App.js يستدعيها تلقائياً عند كل تغيير تبويب
  // ============================================================
  destroy() {
    console.log('🧹 DashboardComponent.destroy(): تنظيف الموارد');

    // إلغاء Realtime subscription
    if (this._realtimeSub) {
      try {
        // FIX-3: استخدام supabaseClient المُوحَّد
        supabaseClient.removeChannel(this._realtimeSub);
        console.log('✅ DashboardComponent: Realtime subscription أُلغيت');
      } catch (e) {
        console.warn('⚠️ DashboardComponent: خطأ في إلغاء subscription:', e.message);
      }
      this._realtimeSub = null;
      this._isSubscribed = false;
    }

    // تدمير Chart.js لتحرير ذاكرة Canvas
    if (this._chart1) {
      try { this._chart1.destroy(); } catch { }
      this._chart1 = null;
    }
    if (this._chart2) {
      try { this._chart2.destroy(); } catch { }
      this._chart2 = null;
    }

    // مسح البيانات المخزنة
    this._dashData  = null;
    this._container = null;
  },
};

window.DashboardComponent = DashboardComponent;
console.log('✅ DashboardComponent v4.1 — FIX-5b: destroy() يُلغي Realtime + Charts | FIX-3: supabaseClient موحَّد');
