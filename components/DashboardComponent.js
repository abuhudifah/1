/**
 * components/DashboardComponent.js — v3.0
 * إصلاحات:
 * 1. استخدام RPC get_admin_dashboard بدلاً من استعلامات متعددة
 * 2. صناديق المندوبين تظهر للمدير دائماً
 * 3. عرض اسم المندوب في كل العمليات الأخيرة
 * 4. تحسين بصري شامل للبطاقات والأيقونات
 * 5. KPI تعرض الإجماليات الصحيحة
 */
'use strict';

const DashboardComponent = {
  _chart1      : null,
  _chart2      : null,
  _container   : null,
  _realtimeSub : null,
  _dashData    : null,

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
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px;">
          <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);">لوحة المعلومات</h2>
          <div style="display:flex;align-items:center;gap:10px;">
            <span id="dash-date" style="font-size:0.82rem;color:var(--text-muted);"></span>
            <button id="dash-refresh-btn" class="btn btn-secondary btn-sm"
              style="display:flex;align-items:center;gap:4px;font-size:0.78rem;">
              <i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> تحديث
            </button>
          </div>
        </div>

        <!-- KPI -->
        <div class="kpi-grid" id="kpi-grid">
          ${[1,2,3,4].map(()=>`<div class="skeleton" style="height:95px;border-radius:16px;"></div>`).join('')}
        </div>

        <!-- مخططات -->
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
              🥧 توزيع العمليات اليوم
            </h3>
            <div style="position:relative;height:190px;">
              <canvas id="chart-pie"></canvas>
            </div>
          </div>
        </div>

        <!-- الحسابات البنكية -->
        <div class="glass-card" style="margin-bottom:24px;">
          <h3 style="font-size:0.88rem;font-weight:700;margin-bottom:16px;color:var(--text-secondary);">
            🏦 الحسابات البنكية — السقف اليومي
          </h3>
          <div id="bank-progress-list">
            ${[1,2].map(()=>`<div class="skeleton" style="height:56px;border-radius:12px;margin-bottom:10px;"></div>`).join('')}
          </div>
        </div>

        <!-- صناديق المناديب -->
        <div class="glass-card" style="margin-bottom:24px;">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
            <h3 style="font-size:0.88rem;font-weight:700;color:var(--text-secondary);">
              👤 صناديق المناديب
            </h3>
            <span id="agents-date-label" style="font-size:0.78rem;color:var(--text-muted);"></span>
          </div>
          <div id="agents-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;">
            ${[1,2].map(()=>`<div class="skeleton" style="height:180px;border-radius:14px;"></div>`).join('')}
          </div>
        </div>

        <!-- أحدث العمليات -->
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
            ${[1,2,3,4,5].map(()=>`<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`).join('')}
          </div>
        </div>
      </div>`;

    document.getElementById('dash-date').textContent       = formatDateArabic(getCurrentSaudiDate());
    document.getElementById('agents-date-label').textContent= `اليوم — ${formatDateArabic(getCurrentSaudiDate())}`;
    document.getElementById('dash-refresh-btn')?.addEventListener('click',()=>this._loadAll());
    document.getElementById('dash-view-all-btn')?.addEventListener('click',()=>window._appNavigateTo?.('all-operations'));

    if (window.lucide) lucide.createIcons();
    await this._loadAll();
    this._subscribeRealtime();
  },

  // ─── تحميل كل البيانات عبر RPC الجديد ───
  async _loadAll() {
    const btn = document.getElementById('dash-refresh-btn');
    if (btn) { btn.disabled=true; btn.querySelector('i')?.classList.add('animate-spin'); }

    try {
      // استخدام الدالة الجديدة get_admin_dashboard لجلب كل البيانات دفعة واحدة
      if (navigator.onLine) {
        const { data, error } = await supabaseClient.rpc('get_admin_dashboard', {
          p_date: getCurrentSaudiDate()
        });

        if (!error && data) {
          this._dashData = data;
          this._renderFromDashData(data);
          await this._loadWeeklyChart();
          return;
        }
      }

      // fallback: الاستعلام المباشر
      await Promise.allSettled([
        this._loadKPI(),
        this._loadBankProgress(),
        this._loadAgentsBoxes(),
        this._loadRecentTx(),
      ]);

    } finally {
      if (btn) { btn.disabled=false; btn.querySelector('i')?.classList.remove('animate-spin'); }
    }
  },

  // ─── رسم البيانات من RPC ───
  _renderFromDashData(data) {
    this._renderKPI(data.totals);
    this._renderBankProgress(data.banks || []);
    this._renderAgentsBoxes(data.agents || []);
    this._renderRecentTx(data.recent || []);
    this._renderPieChart(data.totals);
  },

  // ─── KPI من RPC ───
  _renderKPI(totals) {
    if (!totals) return;
    const net = (totals.total_collections||0) + (totals.total_receipts||0)
              - (totals.total_deposits||0) - (totals.total_expenses||0) - (totals.total_deliveries||0);

    const kpis = [
      { label:'التحصيلات',  value:totals.total_collections||0, icon:'💰', color:'var(--success)', bg:'rgba(5,150,105,0.10)' },
      { label:'الإيداعات',  value:totals.total_deposits||0,    icon:'🏦', color:'var(--info)',    bg:'rgba(2,132,199,0.10)' },
      { label:'المصروفات',  value:totals.total_expenses||0,    icon:'💸', color:'var(--danger)',  bg:'rgba(220,38,38,0.10)' },
      { label:'صافي اليوم', value:net,                          icon:'📊',
        color: net>=0?'var(--success)':'var(--danger)',
        bg:    net>=0?'rgba(5,150,105,0.10)':'rgba(220,38,38,0.10)' },
    ];

    const grid = document.getElementById('kpi-grid');
    if (!grid) return;
    grid.innerHTML = kpis.map(k=>`
      <div class="glass-card kpi-card" style="border-right:3px solid ${k.color};background:${k.bg};position:relative;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
          <div style="
            width:42px;height:42px;border-radius:12px;
            background:${k.color};opacity:0.15;
            display:flex;align-items:center;justify-content:center;
            font-size:1.4rem;position:absolute;left:14px;bottom:14px;">
          </div>
          <span style="font-size:1.5rem;">${k.icon}</span>
          <span style="font-size:0.72rem;color:var(--text-muted);font-weight:600;letter-spacing:0.03em;">
            ${escapeHtml(k.label)}
          </span>
        </div>
        <div class="kpi-value" style="font-size:1.45rem;font-weight:800;color:${k.color};direction:ltr;text-align:right;">
          ${k.value<0?'−':''}${Math.abs(Math.round(k.value)).toLocaleString('en-US')}
          <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);margin-right:2px;">${APP_CONFIG.CURRENCY_SYMBOL}</span>
        </div>
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:4px;">
          ${totals.total_tx_count||0} عملية اليوم
        </div>
      </div>`).join('');
  },

  // ─── KPI من استعلام مباشر (fallback) ───
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
    const totals = {
      total_collections: sum('collection'),
      total_deposits:    sum('deposit'),
      total_expenses:    sum('expense'),
      total_receipts:    sum('receipt'),
      total_deliveries:  sum('delivery'),
      total_tx_count:    txs.length,
    };
    this._renderKPI(totals);
    await this._renderPieChart(totals, txs);
    await this._loadWeeklyChart();
  },

  // ─── مخطط دائري ───
  _renderPieChart(totals, txs=null) {
    const pieCtx = document.getElementById('chart-pie');
    if (!pieCtx) return;
    const values = [
      totals.total_collections||0,
      totals.total_deposits||0,
      totals.total_expenses||0,
      totals.total_receipts||0,
      totals.total_deliveries||0,
    ];
    if (this._chart2) this._chart2.destroy();
    if (values.every(v=>v===0)) { pieCtx.parentElement.innerHTML='<div style="display:flex;align-items:center;justify-content:center;height:190px;color:var(--text-muted);font-size:0.85rem;">لا توجد عمليات اليوم</div>'; return; }
    this._chart2 = new Chart(pieCtx, {
      type:'doughnut',
      data:{
        labels:['تحصيل','إيداع','مصروف','استلام','تسليم'],
        datasets:[{
          data:values,
          backgroundColor:['#059669','#0284c7','#dc2626','#7c3aed','#d97706'],
          borderWidth:2, borderColor:'rgba(255,255,255,0.1)', hoverOffset:8
        }]
      },
      options:{
        responsive:true, maintainAspectRatio:false,
        plugins:{legend:{position:'bottom',labels:{font:{family:'IBM Plex Sans Arabic',size:10},color:'#94a3b8',padding:10}}}
      }
    });
  },

  // ─── مخطط خطي 7 أيام ───
  async _loadWeeklyChart() {
    const lineCtx = document.getElementById('chart-weekly');
    if (!lineCtx) return;
    const days7 = Array.from({length:7},(_,i)=>{
      const d=new Date(); d.setDate(d.getDate()-6+i);
      return d.toLocaleDateString('en-CA',{timeZone:APP_CONFIG.TIMEZONE});
    });
    let cData=[],dData=[];
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('date,type,amount').in('date',days7).eq('is_reversed',false);
        cData = days7.map(d=>(data||[]).filter(t=>t.date===d&&t.type==='collection').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
        dData = days7.map(d=>(data||[]).filter(t=>t.date===d&&t.type==='deposit').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0));
      }
    } catch { cData=days7.map(()=>0); dData=days7.map(()=>0); }
    if (this._chart1) this._chart1.destroy();
    this._chart1 = new Chart(lineCtx, {
      type:'line',
      data:{
        labels:days7.map(d=>{const dt=new Date(d+'T12:00:00');return dt.toLocaleDateString('ar-SA',{weekday:'short',day:'numeric'});}),
        datasets:[
          {label:'تحصيل',data:cData,borderColor:'#059669',backgroundColor:'rgba(5,150,105,0.08)',tension:0.4,fill:true,pointRadius:3,pointHoverRadius:5},
          {label:'إيداع', data:dData,borderColor:'#0284c7',backgroundColor:'rgba(2,132,199,0.08)',tension:0.4,fill:true,pointRadius:3,pointHoverRadius:5},
        ]
      },
      options:{
        responsive:true,maintainAspectRatio:false,
        interaction:{mode:'index',intersect:false},
        scales:{
          x:{ticks:{font:{family:'IBM Plex Sans Arabic',size:10},color:'#94a3b8'},grid:{display:false}},
          y:{ticks:{font:{family:'IBM Plex Sans Arabic',size:10},color:'#94a3b8',callback:v=>v.toLocaleString('en-US')},
             grid:{color:'rgba(148,163,184,0.08)'},beginAtZero:true}
        },
        plugins:{legend:{labels:{font:{family:'IBM Plex Sans Arabic',size:10},color:'#94a3b8'}}}
      }
    });
  },

  // ─── أشرطة البنوك من RPC ───
  _renderBankProgress(banks) {
    const el = document.getElementById('bank-progress-list');
    if (!el) return;
    if (!banks.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">
        لا توجد إيداعات اليوم</div>`; return;
    }
    el.innerHTML = banks.map(b=>{
      const used = Math.round(b.used_today||0);
      const ceil = Math.round(b.financial_ceiling||0);
      const pct  = ceil>0 ? Math.min(100,Math.round(used/ceil*100)) : 0;
      const cls  = pct>=80?'high':pct>=50?'medium':'low';
      const clrMap = {low:'var(--success)',medium:'var(--warning)',high:'var(--danger)'};
      return `
        <div style="margin-bottom:14px;padding:12px;background:var(--bg-hover);border-radius:12px;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div>
              <span style="font-size:0.88rem;font-weight:700;color:var(--text-primary);">${escapeHtml(b.name||'—')}</span>
              ${b.company_name?`<span style="display:block;font-size:0.72rem;color:var(--text-muted);">${escapeHtml(b.company_name)}</span>`:''}
            </div>
            <span style="font-size:0.78rem;color:var(--text-muted);direction:ltr;font-weight:600;">
              ${used.toLocaleString('en-US')} / ${ceil.toLocaleString('en-US')} — <span style="color:${clrMap[cls]}">${pct}%</span>
            </span>
          </div>
          <div class="progress-bar">
            <div class="progress-fill ${cls}" style="width:${pct}%;"></div>
          </div>
          <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-top:4px;">
            <span>المستخدم: ${formatCurrency(used)}</span>
            <span style="color:${Math.max(0,ceil-used)<ceil*0.1?'var(--danger)':'var(--success)'};">
              متبقي: ${formatCurrency(Math.max(0,ceil-used))}
            </span>
          </div>
        </div>`;
    }).join('');
  },

  // ─── أشرطة البنوك من استعلام مباشر (fallback) ───
  async _loadBankProgress() {
    const el = document.getElementById('bank-progress-list');
    if (!el) return;
    const today = getCurrentSaudiDate();
    let deposits=[];
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('bank_account_id,amount')
          .eq('date',today).eq('type','deposit').eq('is_reversed',false);
        deposits=data||[];
      }
    } catch { deposits=[]; }
    const bankAccounts = AppStore.getState('bankAccounts');
    if (!deposits.length||!bankAccounts.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">لا توجد إيداعات اليوم</div>`; return;
    }
    const totals={};
    deposits.forEach(d=>{ if(d.bank_account_id) totals[d.bank_account_id]=(totals[d.bank_account_id]||0)+Math.round(parseFloat(d.amount)||0); });
    const banks = bankAccounts.map(b=>({
      id: b.id, name: b.name, financial_ceiling: b.financial_ceiling,
      used_today: totals[b.id]||0, company_name: null,
    })).filter(b=>b.used_today>0);
    this._renderBankProgress(banks);
  },

  // ─── صناديق المناديب من RPC ───
  _renderAgentsBoxes(agents) {
    const el = document.getElementById('agents-grid');
    if (!el) return;
    if (!agents.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;padding:16px;grid-column:1/-1;">لا يوجد مناديب نشطون</div>`;
      return;
    }
    el.innerHTML = agents.map(a=>{
      const balance = Math.round(a.balance||0);
      const col     = Math.round(a.collections||0);
      const dep     = Math.round(a.deposits||0);
      const exp     = Math.round(a.expenses||0);
      const rec     = Math.round(a.receipts||0);
      const initial = (a.agent_name||'؟').charAt(0);
      const colors  = ['#2563eb','#059669','#7c3aed','#d97706','#0284c7'];
      const colIdx  = (a.agent_name||'').charCodeAt(0) % colors.length;
      return `
        <div class="glass-card" style="padding:14px 16px;border-right:3px solid ${colors[colIdx]};transition:transform var(--transition-spring),box-shadow var(--transition-normal);"
          onmouseenter="this.style.transform='translateY(-3px)';this.style.boxShadow='var(--shadow-md)'"
          onmouseleave="this.style.transform='';this.style.boxShadow=''">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div style="
              width:40px;height:40px;border-radius:50%;flex-shrink:0;
              background:linear-gradient(135deg,${colors[colIdx]},${colors[(colIdx+1)%colors.length]});
              display:flex;align-items:center;justify-content:center;
              color:#fff;font-weight:800;font-size:1rem;
              box-shadow:0 4px 12px ${colors[colIdx]}40;">
              ${escapeHtml(initial)}
            </div>
            <div>
              <div style="font-weight:700;font-size:0.92rem;color:var(--text-primary);">${escapeHtml(a.agent_name||'—')}</div>
              <div style="font-size:0.72rem;color:var(--text-muted);">${a.tx_count||0} عملية اليوم</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:5px;font-size:0.78rem;margin-bottom:12px;">
            <div style="color:var(--text-muted);">رصيد الصندوق</div>
            <div style="text-align:left;direction:ltr;font-weight:700;color:var(--info);">${balance>=0?'':'−'}${Math.abs(balance).toLocaleString('en-US')}</div>
            ${col>0?`<div style="color:var(--text-muted);">تحصيل اليوم</div><div style="text-align:left;direction:ltr;color:var(--success);font-weight:600;">+${col.toLocaleString('en-US')}</div>`:''}
            ${dep>0?`<div style="color:var(--text-muted);">إيداع اليوم</div><div style="text-align:left;direction:ltr;color:var(--info);font-weight:600;">−${dep.toLocaleString('en-US')}</div>`:''}
            ${exp>0?`<div style="color:var(--text-muted);">مصروف اليوم</div><div style="text-align:left;direction:ltr;color:var(--danger);font-weight:600;">−${exp.toLocaleString('en-US')}</div>`:''}
            ${rec>0?`<div style="color:var(--text-muted);">استلام اليوم</div><div style="text-align:left;direction:ltr;color:var(--warning);font-weight:600;">+${rec.toLocaleString('en-US')}</div>`:''}
          </div>
          <div style="padding-top:10px;border-top:1px solid var(--border-color);
            display:flex;justify-content:space-between;align-items:center;">
            <span style="font-size:0.75rem;color:var(--text-muted);font-weight:600;">الرصيد الحالي</span>
            <span style="font-size:1.05rem;font-weight:800;
              color:${balance>=0?'var(--success)':'var(--danger)'};direction:ltr;">
              ${balance>=0?'':'−'}${Math.abs(balance).toLocaleString('en-US')}
              <span style="font-size:0.65rem;font-weight:500;margin-right:2px;">${APP_CONFIG.CURRENCY_SYMBOL}</span>
            </span>
          </div>
        </div>`;
    }).join('');
  },

  // ─── صناديق المناديب من استعلام مباشر (fallback) ───
  async _loadAgentsBoxes() {
    const el = document.getElementById('agents-grid');
    if (!el) return;
    const today    = getCurrentSaudiDate();
    const allUsers = AppStore.getState('users');
    const agents   = allUsers.filter(u=>u.role==='agent'&&u.is_active);
    if (!agents.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;padding:16px;">لا يوجد مناديب</div>`;return;
    }
    let txs=[], balances={};
    try {
      if (navigator.onLine) {
        const [txRes, balRes] = await Promise.all([
          supabaseClient.from('transactions').select('agent_id,type,amount').eq('date',today).eq('is_reversed',false),
          supabaseClient.from('account_balances').select('account_id,balance').in('account_id',agents.map(a=>`AGT_${a.id}`))
        ]);
        txs = txRes.data||[];
        (balRes.data||[]).forEach(b=>{ balances[b.account_id]=Math.round(parseFloat(b.balance)||0); });
      }
    } catch {}
    const agentsData = agents.map(a=>({
      agent_id: a.id, agent_name: a.display_name,
      balance: balances[`AGT_${a.id}`]||0,
      collections: txs.filter(t=>t.agent_id===a.id&&t.type==='collection').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      deposits:    txs.filter(t=>t.agent_id===a.id&&t.type==='deposit').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      expenses:    txs.filter(t=>t.agent_id===a.id&&t.type==='expense').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      receipts:    txs.filter(t=>t.agent_id===a.id&&t.type==='receipt').reduce((s,t)=>s+Math.round(parseFloat(t.amount)||0),0),
      tx_count:    txs.filter(t=>t.agent_id===a.id).length,
    }));
    this._renderAgentsBoxes(agentsData);
  },

  // ─── أحدث العمليات من RPC ───
  _renderRecentTx(recent) {
    const el = document.getElementById('recent-tx-list');
    if (!el) return;
    if (!recent.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">لا توجد عمليات بعد</div>`;return;
    }
    const typeIcons = {collection:'💰',deposit:'🏦',expense:'💸',receipt:'📥',delivery:'📤',refund_settlement:'🔄'};
    el.innerHTML = recent.map(tx=>{
      const amt   = Math.round(parseFloat(tx.amount)||0);
      const icon  = typeIcons[tx.type]||'📋';
      const color = getTransactionColor(tx.type);
      const label = TRANSACTION_TYPE_LABELS[tx.type]||tx.type;
      // تفاصيل ثانوية حسب النوع
      let secondary = '';
      if (tx.customer_name) secondary = tx.customer_name;
      else if (tx.bank_name) secondary = tx.bank_name;
      else if (tx.company_name) secondary = tx.company_name;
      else if (tx.details) secondary = tx.details;
      return `
        <div style="display:flex;align-items:center;gap:10px;
          padding:10px 12px;border-radius:10px;
          transition:background var(--transition-fast);cursor:default;"
          onmouseenter="this.style.background='var(--bg-hover)'"
          onmouseleave="this.style.background=''">
          <div style="
            width:36px;height:36px;border-radius:10px;flex-shrink:0;
            background:${color}18;
            display:flex;align-items:center;justify-content:center;
            font-size:1.1rem;">
            ${icon}
          </div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:0.84rem;font-weight:600;color:var(--text-primary);
              display:flex;align-items:center;gap:6px;">
              ${escapeHtml(label)}
              ${secondary?`<span style="font-size:0.75rem;color:var(--text-muted);font-weight:400;">— ${escapeHtml(secondary)}</span>`:''}
            </div>
            <div style="font-size:0.72rem;color:var(--text-muted);">
              ${escapeHtml(tx.agent_name||'—')}
              ${tx.time?`· ${tx.time.substring(0,5)}`:''}
            </div>
          </div>
          <div style="font-size:0.90rem;font-weight:800;color:${color};direction:ltr;flex-shrink:0;">
            ${amt.toLocaleString('en-US')}
            <span style="font-size:0.65rem;font-weight:500;color:var(--text-muted);">${APP_CONFIG.CURRENCY_SYMBOL}</span>
          </div>
        </div>`;
    }).join('');
  },

  // ─── أحدث العمليات من استعلام مباشر (fallback) ───
  async _loadRecentTx() {
    const el = document.getElementById('recent-tx-list');
    if (!el) return;
    let txs=[];
    try {
      if (navigator.onLine) {
        const { data } = await supabaseClient.from('transactions')
          .select('id,type,amount,date,time,agent_id,customer_name,details,is_reversed,company_id,bank_account_id')
          .order('created_at',{ascending:false}).limit(8);
        txs = data||[];
      }
    } catch { txs=[]; }
    if (!txs.length) {
      el.innerHTML=`<div style="color:var(--text-muted);font-size:0.85rem;text-align:center;padding:16px;">لا توجد عمليات بعد</div>`;return;
    }
    const users        = AppStore.getState('users');
    const bankAccounts = AppStore.getState('bankAccounts');
    const companies    = AppStore.getState('companies');
    const recent = txs.map(tx=>({
      ...tx,
      agent_name:   users.find(u=>u.id===tx.agent_id)?.display_name||'—',
      bank_name:    bankAccounts.find(b=>b.id===tx.bank_account_id)?.name||null,
      company_name: companies.find(c=>c.id===tx.company_id)?.name||null,
    }));
    this._renderRecentTx(recent);
  },

  // ─── Realtime ───
  _subscribeRealtime() {
    if (this._realtimeSub) supabaseClient.removeChannel(this._realtimeSub);
    this._realtimeSub = supabaseClient
      .channel('dash-realtime-v3')
      .on('postgres_changes',{event:'*',schema:'public',table:'transactions'},()=>this._loadAll())
      .subscribe();
  },

  destroy() {
    if (this._chart1)      this._chart1.destroy();
    if (this._chart2)      this._chart2.destroy();
    if (this._realtimeSub) supabaseClient.removeChannel(this._realtimeSub);
    this._chart1 = this._chart2 = this._realtimeSub = this._dashData = null;
  },
};

window.DashboardComponent = DashboardComponent;
console.log('✅ DashboardComponent v3.0 محمّل — مع دعم get_admin_dashboard RPC');
