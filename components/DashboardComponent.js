/**
 * components/DashboardComponent.js — v2.0
 * لوحة المعلومات — للمدير فقط
 * - تحديث فوري Realtime بدون reload
 * - تنسيق أرقام إنجليزي صحيح (1,234) بدون كسور
 * - صناديق المناديب: رصيد سابق + تحصيل + إيداع + مصروف + استلام + تسليم + المتبقي
 * - أشرطة تقدم بنكية ملوّنة
 * - مخططات Chart.js محدَّثة تلقائياً
 */
'use strict';

const DashboardComponent = {
  _chart1      : null,
  _chart2      : null,
  _container   : null,
  _realtimeSub : null,
  _refreshTimer: null,

  // ─────────────────────────────────────────────
  async render(container) {
    this._container = container;
    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">لوحة المعلومات للمدير فقط</div></div>`;
      return;
    }

    container.innerHTML = `
      <div id="dash-root">
        <!-- العنوان -->
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px;">
          <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);">لوحة المعلومات</h2>
          <div style="display:flex;align-items:center;gap:10px;">
            <span id="dash-date" style="font-size:0.82rem;color:var(--text-muted);"></span>
            <button id="dash-refresh-btn" class="btn btn-secondary btn-sm"
              title="تحديث البيانات"
              style="display:flex;align-items:center;gap:4px;font-size:0.78rem;">
              <i data-lucide="refresh-cw" style="width:13px;height:13px;"></i>
              تحديث
            </button>
          </div>
        </div>

        <!-- KPI -->
        <div class="kpi-grid" id="kpi-grid">
          ${this._buildKpiSkeleton()}
        </div>

        <!-- مخططات -->
        <div class="grid-2" style="margin-bottom:24px;">
          <div class="glass-card">
            <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:12px;color:var(--text-secondary);">حركة آخر 7 أيام</h3>
            <div style="position:relative;height:190px;">
              <canvas id="chart-weekly"></canvas>
            </div>
          </div>
          <div class="glass-card">
            <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:12px;color:var(--text-secondary);">توزيع العمليات اليوم</h3>
            <div style="position:relative;height:190px;">
              <canvas id="chart-pie"></canvas>
            </div>
          </div>
        </div>

        <!-- الحسابات البنكية -->
        <div class="glass-card" style="margin-bottom:24px;">
          <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:16px;color:var(--text-secondary);">
            🏦 الحسابات البنكية النشطة اليوم
          </h3>
          <div id="bank-progress-list">
            ${[1,2].map(()=>`<div class="skeleton" style="height:52px;border-radius:12px;margin-bottom:10px;"></div>`).join('')}
          </div>
        </div>

        <!-- صناديق المناديب -->
        <div class="glass-card" style="margin-bottom:24px;">
          <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:16px;color:var(--text-secondary);">
            👤 صناديق المناديب — <span style="color:var(--text-muted);font-weight:400;font-size:0.78rem;" id="agents-date-label"></span>
          </h3>
          <div id="agents-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">
            ${[1,2,3].map(()=>`<div class="skeleton" style="height:150px;border-radius:14px;"></div>`).join('')}
          </div>
        </div>

        <!-- أحدث العمليات -->
        <div class="glass-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
            <h3 style="font-size:0.88rem;font-weight:700;color:var(--text-secondary);">أحدث العمليات</h3>
            <button id="dash-view-all-btn"
              style="font-size:0.78rem;color:var(--accent);background:none;border:none;cursor:pointer;
                     display:flex;align-items:center;gap:4px;padding:4px 8px;border-radius:8px;
                     transition:background var(--transition-fast);">
              عرض الكل ←
            </button>
          </div>
          <div id="recent-tx-list">
            ${[1,2,3,4,5].map(()=>`<div class="skeleton" style="height:40px;border-radius:8px;margin-bottom:6px;"></div>`).join('')}
          </div>
        </div>
      </div>`;

    document.getElementById('dash-date').textContent     = formatDateArabic(getCurrentSaudiDate());
    document.getElementById('agents-date-label').textContent = formatDateArabic(getCurrentSaudiDate());
    document.getElementById('dash-refresh-btn')?.addEventListener('click', ()=>this._loadAll());
    document.getElementById('dash-view-all-btn')?.addEventListener('click', ()=>{
      window._appNavigateTo?.('all-operations');
    });

    if (window.lucide) lucide.createIcons();
    await this._loadAll();
    this._subscribeRealtime();
  },

  // ─────────────────────────────────────────────
  // تحميل كل البيانات
  // ─────────────────────────────────────────────
  async _loadAll() {
    const btn = document.getElementById('dash-refresh-btn');
    if (btn) { btn.disabled=true; btn.querySelector('i')?.classList.add('animate-spin'); }
    await Promise.allSettled([
      this._loadKPI(),
      this._loadBankProgress(),
      this._loadAgentsBoxes(),
      this._loadRecentTx(),
    ]);
    if (btn) { btn.disabled=false; btn.querySelector('i')?.classList.remove('animate-spin'); }
  },

  // ─────────────────────────────────────────────
  // KPI
  // ─────────────────────────────────────────────
  async _loadKPI() {
    const today = getCurrentSaudiDate();
    let txs = [];
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('type,amount,is_reversed')
          .eq('date', today).eq('is_reversed',false);
        txs = data || [];
      } else {
        txs = await db.transactions.where('date').equals(today).filter(t=>!t.is_reversed).toArray();
      }
    } catch { txs=[]; }

    const sum = (type) => txs.filter(t=>t.type===type).reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0);
    const collection = sum('collection');
    const deposit    = sum('deposit');
    const expense    = sum('expense');
    const receipt    = sum('receipt');
    const delivery   = sum('delivery');
    const net = collection + receipt - deposit - expense - delivery;

    const kpis = [
      { label:'التحصيلات',  value:collection, icon:'💰', color:'var(--success)', bg:'rgba(5,150,105,0.10)' },
      { label:'الإيداعات',  value:deposit,    icon:'🏦', color:'var(--info)',    bg:'rgba(2,132,199,0.10)' },
      { label:'المصروفات',  value:expense,    icon:'💸', color:'var(--danger)',  bg:'rgba(220,38,38,0.10)' },
      { label:'صافي اليوم', value:net,        icon:'📊', color: net>=0?'var(--success)':'var(--danger)',
        bg: net>=0?'rgba(5,150,105,0.10)':'rgba(220,38,38,0.10)' },
    ];

    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.innerHTML = kpis.map(k=>`
      <div class="glass-card kpi-card" style="border-right:3px solid ${k.color};background:${k.bg};">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
          <span style="font-size:1.3rem;">${k.icon}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600;letter-spacing:0.03em;">
            ${escapeHtml(k.label)}
          </span>
        </div>
        <div class="kpi-value" style="font-size:1.45rem;font-weight:800;color:${k.color};direction:ltr;text-align:right;">
          ${k.value<0?'−':''}${Math.abs(k.value).toLocaleString('en-US')}
          <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);margin-right:2px;">${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
      </div>`).join('');

    /* تحديث المخططات */
    await this._updateCharts(txs);
  },

  // ─────────────────────────────────────────────
  // المخططات
  // ─────────────────────────────────────────────
  async _updateCharts(todayTxs) {
    /* مخطط دائري */
    const pieCtx = document.getElementById('chart-pie');
    if (pieCtx) {
      const labels = ['تحصيل','إيداع','مصروف','استلام','تسليم'];
      const keys   = ['collection','deposit','expense','receipt','delivery'];
      const values = keys.map(k=>todayTxs.filter(t=>t.type===k).reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
      const colors = ['#059669','#0284c7','#dc2626','#7c3aed','#d97706'];

      if (this._chart2) this._chart2.destroy();
      this._chart2 = new Chart(pieCtx, {
        type:'doughnut',
        data:{ labels, datasets:[{ data:values, backgroundColor:colors, borderWidth:2,
          borderColor:'rgba(255,255,255,0.1)', hoverOffset:6 }] },
        options:{ responsive:true, maintainAspectRatio:false,
          plugins:{ legend:{ position:'bottom', labels:{ font:{family:'IBM Plex Sans Arabic',size:10},
            color:'#94a3b8', padding:10 } } } }
      });
    }

    /* مخطط خطي — آخر 7 أيام */
    const lineCtx = document.getElementById('chart-weekly');
    if (!lineCtx) return;

    const days7 = Array.from({length:7},(_,i)=>{
      const d = new Date(); d.setDate(d.getDate()-6+i);
      return d.toLocaleDateString('en-CA',{timeZone:APP_CONFIG.TIMEZONE});
    });

    let weekData = {collection:[],deposit:[]};
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('date,type,amount')
          .in('date', days7).eq('is_reversed',false);
        weekData.collection = days7.map(d=>(data||[]).filter(t=>t.date===d&&t.type==='collection').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
        weekData.deposit    = days7.map(d=>(data||[]).filter(t=>t.date===d&&t.type==='deposit').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
      }
    } catch { weekData.collection=days7.map(()=>0); weekData.deposit=days7.map(()=>0); }

    if (this._chart1) this._chart1.destroy();
    this._chart1 = new Chart(lineCtx, {
      type:'line',
      data:{
        labels: days7.map(d=>{const dt=new Date(d+'T12:00:00'); return dt.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric'});}),
        datasets:[
          {label:'تحصيل',data:weekData.collection,borderColor:'#059669',backgroundColor:'rgba(5,150,105,0.08)',
           tension:0.4,fill:true,pointRadius:3,pointHoverRadius:5},
          {label:'إيداع',data:weekData.deposit,borderColor:'#0284c7',backgroundColor:'rgba(2,132,199,0.08)',
           tension:0.4,fill:true,pointRadius:3,pointHoverRadius:5},
        ]
      },
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        scales:{
          x:{ticks:{font:{family:'IBM Plex Sans Arabic',size:10},color:'#94a3b8'},grid:{display:false}},
          y:{ticks:{font:{family:'IBM Plex Sans Arabic',size:10},color:'#94a3b8',
            callback:v=>v.toLocaleString('en-US')},grid:{color:'rgba(148,163,184,0.08)'},beginAtZero:true}
        },
        plugins:{legend:{labels:{font:{family:'IBM Plex Sans Arabic',size:10},color:'#94a3b8'}}}}
    });
  },

  // ─────────────────────────────────────────────
  // أشرطة تقدم الحسابات البنكية
  // ─────────────────────────────────────────────
  async _loadBankProgress() {
    const el = document.getElementById('bank-progress-list');
    if (!el) return;

    const today = getCurrentSaudiDate();
    let deposits = [];
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('bank_account_id,amount')
          .eq('date',today).eq('type','deposit').eq('is_reversed',false);
        deposits = data||[];
      } else {
        deposits = await db.transactions.where('date').equals(today)
          .filter(t=>t.type==='deposit'&&!t.is_reversed).toArray();
      }
    } catch { deposits=[]; }

    if (!deposits.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">
        لا توجد إيداعات اليوم</div>`; return;
    }

    const bankTotals = {};
    deposits.forEach(d=>{ if(d.bank_account_id) bankTotals[d.bank_account_id]=(bankTotals[d.bank_account_id]||0)+Math.round(parseFloat(d.amount)||0); });

    const bankAccounts = AppStore.getState('bankAccounts');
    const rows = Object.entries(bankTotals).map(([bId, total])=>{
      const bank    = bankAccounts.find(b=>b.id===bId);
      const ceiling = Math.round(bank?.financial_ceiling||0);
      const pct     = ceiling>0 ? Math.min(100,Math.round(total/ceiling*100)) : 0;
      const cls     = pct>=80?'high':pct>=50?'medium':'low';
      const clrMap  = {low:'var(--success)',medium:'var(--warning)',high:'var(--danger)'};
      return `
        <div style="margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
            <span style="font-size:0.85rem;font-weight:600;color:var(--text-primary);">
              ${escapeHtml(bank?.name||bId)}
            </span>
            <span style="font-size:0.78rem;color:var(--text-muted);direction:ltr;">
              ${total.toLocaleString('en-US')} / ${ceiling.toLocaleString('en-US')} — ${pct}%
            </span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${cls}" style="width:${pct}%;transition:width 0.6s ease;
              background:${clrMap[cls]};"></div>
          </div>
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:3px;text-align:left;direction:ltr;">
            المتبقي: ${Math.max(0,ceiling-total).toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}
          </div>
        </div>`;
    }).join('');

    el.innerHTML = rows || `<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">
      لا توجد حسابات بنكية نشطة اليوم</div>`;
  },

  // ─────────────────────────────────────────────
  // صناديق المناديب
  // ─────────────────────────────────────────────
  async _loadAgentsBoxes() {
    const el = document.getElementById('agents-grid');
    if (!el) return;

    const today    = getCurrentSaudiDate();
    const allUsers = AppStore.getState('users');
    const agents   = allUsers.filter(u=>u.role==='agent'&&u.is_active);

    if (!agents.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;padding:16px;">
        لا يوجد مناديب</div>`; return;
    }

    let txs = [];
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('agent_id,type,amount,is_reversed')
          .eq('date',today).eq('is_reversed',false);
        txs = data||[];
      } else {
        txs = await db.transactions.where('date').equals(today).filter(t=>!t.is_reversed).toArray();
      }
    } catch { txs=[]; }

    /* الرصيد السابق من account_balances */
    let balances = {};
    try {
      if (navigator.onLine) {
        const ids = agents.map(a=>`AGT_${a.id}`);
        const { data } = await supabaseClient.from('account_balances')
          .select('account_id,balance').in('account_id',ids);
        (data||[]).forEach(b=>{ balances[b.account_id]=Math.round(parseFloat(b.balance)||0); });
      }
    } catch { }

    const cards = agents.map(agent=>{
      const agTxs  = txs.filter(t=>t.agent_id===agent.id);
      const sum    = (type)=>agTxs.filter(t=>t.type===type).reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0);
      const col    = sum('collection');
      const dep    = sum('deposit');
      const exp    = sum('expense');
      const rec    = sum('receipt');
      const del    = sum('delivery');
      const prev   = balances[`AGT_${agent.id}`]||0;
      const remain = col + rec - dep - exp - del;
      const total  = prev + remain;

      return `
        <div class="glass-card" style="padding:14px;border-right:3px solid var(--accent);">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;">
            <div style="
              width:38px;height:38px;border-radius:50%;
              background:linear-gradient(135deg,var(--accent),var(--accent-light));
              display:flex;align-items:center;justify-content:center;
              color:#fff;font-weight:800;font-size:1rem;flex-shrink:0;">
              ${escapeHtml((agent.display_name||'؟').charAt(0))}
            </div>
            <div>
              <div style="font-weight:700;font-size:0.9rem;color:var(--text-primary);">${escapeHtml(agent.display_name)}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);">مندوب</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:0.78rem;">
            <div style="color:var(--text-muted);">رصيد سابق</div>
            <div style="text-align:left;direction:ltr;font-weight:600;color:var(--info);">
              ${prev>=0?'':'−'}${Math.abs(prev).toLocaleString('en-US')}</div>
            <div style="color:var(--text-muted);">تحصيل</div>
            <div style="text-align:left;direction:ltr;color:var(--success);">+${col.toLocaleString('en-US')}</div>
            <div style="color:var(--text-muted);">إيداع</div>
            <div style="text-align:left;direction:ltr;color:var(--info);">−${dep.toLocaleString('en-US')}</div>
            <div style="color:var(--text-muted);">مصروف</div>
            <div style="text-align:left;direction:ltr;color:var(--danger);">−${exp.toLocaleString('en-US')}</div>
            ${rec>0||del>0?`
              <div style="color:var(--text-muted);">استلام/تسليم</div>
              <div style="text-align:left;direction:ltr;color:var(--warning);">
                +${rec.toLocaleString('en-US')} / −${del.toLocaleString('en-US')}</div>`:''}
          </div>
          <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border-color);
            display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.78rem;font-weight:600;color:var(--text-muted);">المتبقي في الصندوق</span>
            <span style="font-size:1rem;font-weight:800;
              color:${total>=0?'var(--success)':'var(--danger)'};
              direction:ltr;">
              ${total>=0?'':'−'}${Math.abs(total).toLocaleString('en-US')}
              <span style="font-size:0.65rem;font-weight:500;margin-right:2px;">${APP_CONFIG.CURRENCY_SYMBOL}</span>
            </span>
          </div>
        </div>`;
    }).join('');

    el.innerHTML = cards;
  },

  // ─────────────────────────────────────────────
  // أحدث العمليات
  // ─────────────────────────────────────────────
  async _loadRecentTx() {
    const el = document.getElementById('recent-tx-list');
    if (!el) return;

    let txs = [];
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('id,type,amount,date,agent_id,customer_name,details,is_reversed')
          .order('created_at',{ascending:false}).limit(8);
        txs = data||[];
      } else {
        txs = await db.transactions.orderBy('created_at').reverse().limit(8).toArray();
      }
    } catch { txs=[]; }

    if (!txs.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">
        لا توجد عمليات بعد</div>`; return;
    }

    const users = AppStore.getState('users');
    el.innerHTML = txs.map(tx=>{
      const agent = users.find(u=>u.id===tx.agent_id);
      const icon  = getTransactionIcon(tx.type);
      const color = getTransactionColor(tx.type);
      const amt   = Math.round(parseFloat(tx.amount)||0);
      return `
        <div style="display:flex;align-items:center;gap:10px;
          padding:9px 10px;border-radius:10px;
          border-bottom:1px solid var(--border-color);
          opacity:${tx.is_reversed?'0.45':'1'};
          transition:background var(--transition-fast);"
          onmouseenter="this.style.background='var(--bg-hover)'"
          onmouseleave="this.style.background=''">
          <span style="font-size:1.1rem;flex-shrink:0;">${icon}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.84rem;font-weight:600;color:var(--text-primary);">
              ${escapeHtml(TRANSACTION_TYPE_LABELS[tx.type]||tx.type)}
              ${tx.customer_name?`<span style="font-size:0.76rem;color:var(--text-muted);"> — ${escapeHtml(tx.customer_name)}</span>`:''}
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);">
              ${escapeHtml(agent?.display_name||'—')} · ${escapeHtml(formatDateArabic(tx.date))}
            </div>
          </div>
          <div style="font-size:0.88rem;font-weight:700;color:${color};direction:ltr;flex-shrink:0;">
            ${amt.toLocaleString('en-US')}
          </div>
        </div>`;
    }).join('');
  },

  // ─────────────────────────────────────────────
  // Realtime — تحديث فوري بدون reload
  // ─────────────────────────────────────────────
  _subscribeRealtime() {
    if (this._realtimeSub) {
      supabaseClient.removeChannel(this._realtimeSub);
    }
    this._realtimeSub = supabaseClient
      .channel('dash-realtime')
      .on('postgres_changes',
        { event:'*', schema:'public', table:'transactions' },
        ()=>this._loadAll()
      )
      .subscribe();
  },

  // ─────────────────────────────────────────────
  _buildKpiSkeleton() {
    return [1,2,3,4].map(()=>
      `<div class="skeleton" style="height:90px;border-radius:16px;"></div>`
    ).join('');
  },

  // يُنظّف عند مغادرة التبويب
  destroy() {
    if (this._chart1)       this._chart1.destroy();
    if (this._chart2)       this._chart2.destroy();
    if (this._realtimeSub)  supabaseClient.removeChannel(this._realtimeSub);
    if (this._refreshTimer) clearInterval(this._refreshTimer);
    this._chart1 = this._chart2 = this._realtimeSub = this._refreshTimer = null;
  },
};

window.DashboardComponent = DashboardComponent;
console.log('✅ DashboardComponent v2.0 محمّل');
