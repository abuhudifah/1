/**
 * components/AccountManagementComponent.js — v3.0
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * إضافات:
 * 1. زر "إضافة حساب جديد" مع مودال واضح
 * 2. شجرة حسابات افتراضية احترافية عند الإنشاء الأول
 * 3. دليل حسابات شجري منظم بـ 5 فئات
 * 4. كشف حساب احترافي بالرصيد الجاري
 * 5. تحسين بصري شامل
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
'use strict';

const AccountManagementComponent = {
  _selectedAccount    : null,
  _selectedAccountName: null,
  _addModal           : null,

  // شجرة الحسابات الافتراضية الاحترافية
  DEFAULT_CHART : [
    { category:'treasury', name:'الصندوق العام',         id:'GENERAL_FUND',   icon:'🏛️', desc:'الخزينة الرئيسية للنظام' },
    { category:'treasury', name:'الخزينة النقدية',        id:'CASH_GENERAL',   icon:'💵', desc:'النقد المتوفر يدوياً' },
    { category:'treasury', name:'حساب الشركات العام',     id:'COMP_GENERAL',   icon:'🏢', desc:'حساب تسوية الشركات' },
  ],

  async render(container) {
    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">إدارة الحسابات للمدير والمساعد الإداري فقط</div></div>`;
      return;
    }

    container.innerHTML = '';
    const wrap = document.createElement('div');

    // شريط العنوان
    const titleRow = document.createElement('div');
    titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;';

    const titleLeft = document.createElement('div');
    titleLeft.innerHTML = `
      <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);">📊 دليل الحسابات المحاسبية</h2>
      <p style="font-size:0.80rem;color:var(--text-muted);margin-top:3px;">إدارة الحسابات والقيود المحاسبية</p>`;
    titleRow.appendChild(titleLeft);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;';

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

    // حاوية دليل الحسابات
    const chartEl = document.createElement('div');
    chartEl.id = 'acct-chart';
    chartEl.innerHTML = [1,2,3,4].map(()=>`
      <div class="glass-card" style="margin-bottom:16px;">
        <div class="skeleton" style="height:32px;border-radius:8px;margin-bottom:12px;"></div>
        <div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:8px;"></div>
        <div class="skeleton" style="height:44px;border-radius:8px;"></div>
      </div>`).join('');
    wrap.appendChild(chartEl);

    // قسم كشف الحساب
    const stmtSection = document.createElement('div');
    stmtSection.id = 'acct-stmt-section';
    stmtSection.style.display = 'none';
    stmtSection.innerHTML = `
      <div class="glass-card" style="margin-bottom:16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px;">
          <div>
            <h3 style="font-size:1rem;font-weight:700;color:var(--text-primary);" id="stmt-account-title">📄 كشف الحساب</h3>
            <p style="font-size:0.75rem;color:var(--text-muted);margin-top:2px;font-family:monospace;" id="stmt-account-id"></p>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;">
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

    // مودال الإضافة
    this._addModal = this._buildAddModal();
    wrap.appendChild(this._addModal);

    container.appendChild(wrap);

    // ربط الأحداث
    document.getElementById('stmt-load-btn')?.addEventListener('click', () => this._loadStatement());
    document.getElementById('stmt-close-btn')?.addEventListener('click', () => {
      stmtSection.style.display='none';
      this._selectedAccount=null;
    });
    document.getElementById('stmt-print-btn')?.addEventListener('click', () => window.print());

    if (window.lucide) lucide.createIcons();
    await this._loadChart();
  },

  // ─── مودال إضافة حساب جديد ───
  _buildAddModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'acct-add-modal';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e=>{if(e.target===overlay)this._closeAddModal();});

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.id = 'acct-add-box';
    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">➕ إضافة حساب محاسبي جديد</h3>
        <button class="modal-close" id="acct-add-close">✕</button>
      </div>

      <div style="margin-bottom:16px;">
        <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:12px;">
          اختر نوع الحساب الذي تريد إضافته:
        </p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;" id="acct-type-grid">
          ${[
            {type:'company',  icon:'🏢', label:'حساب شركة',     desc:'شركة شريكة في التحويلات'},
            {type:'bank',     icon:'🏦', label:'حساب بنكي',      desc:'حساب لاستلام الإيداعات'},
            {type:'expense',  icon:'💸', label:'نوع مصروف',      desc:'فئة مصاريف جديدة'},
            {type:'custom',   icon:'📋', label:'حساب مخصص',      desc:'رصيد ابتدائي يدوي'},
          ].map(t=>`
            <button class="acct-type-btn btn btn-secondary" data-type="${t.type}"
              style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 10px;
                border-radius:14px;cursor:pointer;transition:all 0.18s;height:auto;">
              <span style="font-size:1.8rem;">${t.icon}</span>
              <span style="font-size:0.82rem;font-weight:700;">${t.label}</span>
              <span style="font-size:0.70rem;color:var(--text-muted);text-align:center;">${t.desc}</span>
            </button>`).join('')}
        </div>
      </div>

      <!-- نموذج الشركة -->
      <div id="form-company" style="display:none;">
        <div class="form-group">
          <label class="form-label">اسم الشركة <span class="required">*</span></label>
          <input id="add-company-name" type="text" class="form-control" placeholder="مثال: شركة زغلول للتجارة">
        </div>
        <div class="form-group">
          <label class="form-label">بادئة الحساب <span class="required">*</span></label>
          <input id="add-company-prefix" type="text" class="form-control" placeholder="مثال: COMP_ZAGHLOUL" dir="ltr">
          <div class="form-hint">تُستخدم كمعرف فريد في النظام المحاسبي</div>
        </div>
      </div>

      <!-- نموذج البنك -->
      <div id="form-bank" style="display:none;">
        <div class="form-group">
          <label class="form-label">اسم الحساب البنكي <span class="required">*</span></label>
          <input id="add-bank-name" type="text" class="form-control" placeholder="مثال: بنك الراجحي — شركة زغلول">
        </div>
        <div class="form-group">
          <label class="form-label">السقف اليومي <span class="required">*</span></label>
          <input id="add-bank-ceiling" type="number" class="form-control" placeholder="50000" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">رقم الحساب</label>
          <input id="add-bank-acc" type="text" class="form-control" dir="ltr" placeholder="SA00...">
        </div>
        <div class="form-group">
          <label class="form-label">حامل البطاقة</label>
          <input id="add-bank-holder" type="text" class="form-control">
        </div>
      </div>

      <!-- نموذج نوع المصروف -->
      <div id="form-expense" style="display:none;">
        <div class="form-group">
          <label class="form-label">اسم نوع المصروف <span class="required">*</span></label>
          <input id="add-exp-name" type="text" class="form-control" placeholder="مثال: وقود">
        </div>
        <div class="form-group">
          <label class="form-label">رمز الحساب <span class="required">*</span></label>
          <input id="add-exp-code" type="text" class="form-control" dir="ltr" placeholder="مثال: EXP_FUEL">
          <div class="form-hint">يجب أن يبدأ بـ EXP_ ويكون فريداً</div>
        </div>
      </div>

      <!-- نموذج حساب مخصص -->
      <div id="form-custom" style="display:none;">
        <div class="form-group">
          <label class="form-label">اسم الحساب <span class="required">*</span></label>
          <input id="add-custom-name" type="text" class="form-control" placeholder="مثال: صندوق احتياطي">
        </div>
        <div class="form-group">
          <label class="form-label">معرف الحساب <span class="required">*</span></label>
          <input id="add-custom-id" type="text" class="form-control" dir="ltr" placeholder="مثال: RESERVE_FUND">
        </div>
        <div class="form-group">
          <label class="form-label">الرصيد الافتتاحي</label>
          <input id="add-custom-balance" type="number" class="form-control" placeholder="0" value="0">
        </div>
      </div>

      <div id="acct-add-error" class="form-error" style="margin-top:8px;"></div>

      <div style="display:flex;gap:10px;margin-top:16px;" id="acct-add-actions" style="display:none;">
        <button id="acct-add-save" class="btn btn-primary" style="flex:2;">💾 حفظ الحساب</button>
        <button id="acct-add-cancel" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    box.querySelector('#acct-add-close').addEventListener('click', ()=>this._closeAddModal());
    box.querySelector('#acct-add-cancel')?.addEventListener('click', ()=>this._closeAddModal());

    // عند اختيار النوع
    box.querySelectorAll('.acct-type-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        box.querySelectorAll('.acct-type-btn').forEach(b=>{
          b.style.background='';b.style.borderColor='';b.style.color='';
        });
        btn.style.background='rgba(37,99,235,0.15)';
        btn.style.borderColor='rgba(37,99,235,0.4)';
        btn.style.color='var(--accent)';
        ['company','bank','expense','custom'].forEach(t=>{
          const f=box.querySelector(`#form-${t}`);
          if(f) f.style.display = t===type?'block':'none';
        });
        const actionsEl = box.querySelector('#acct-add-actions');
        if(actionsEl) actionsEl.style.display='flex';
        this._currentAddType = type;
      });
    });

    box.querySelector('#acct-add-save').addEventListener('click', ()=>this._saveNewAccount());

    // تحديث رمز المصروف تلقائياً من الاسم
    box.querySelector('#add-exp-name')?.addEventListener('input', e=>{
      const codeEl = box.querySelector('#add-exp-code');
      if(!codeEl) return;
      const raw = e.target.value.trim().toUpperCase().replace(/\s+/g,'_').replace(/[^A-Z0-9_]/g,'');
      codeEl.value = raw ? `EXP_${raw}` : '';
    });

    overlay.appendChild(box);
    return overlay;
  },

  _currentAddType: null,

  _openAddModal() {
    if (this._addModal) this._addModal.style.display='flex';
    const box = document.getElementById('acct-add-box');
    if(!box) return;
    // إعادة تعيين
    box.querySelectorAll('.acct-type-btn').forEach(b=>{b.style.background='';b.style.borderColor='';b.style.color='';});
    ['company','bank','expense','custom'].forEach(t=>{
      const f=box.querySelector(`#form-${t}`); if(f)f.style.display='none';
    });
    const acts=box.querySelector('#acct-add-actions'); if(acts)acts.style.display='none';
    box.querySelector('#acct-add-error').textContent='';
    this._currentAddType=null;
    if(window.lucide)lucide.createIcons();
  },

  _closeAddModal() { if(this._addModal)this._addModal.style.display='none'; },

  async _saveNewAccount() {
    const errEl = document.getElementById('acct-add-error');
    errEl.textContent='';
    const type = this._currentAddType;
    const btn = document.getElementById('acct-add-save');
    const restore = setButtonLoading(btn);

    let result;
    try {
      if (type==='company') {
        const name   = document.getElementById('add-company-name')?.value.trim();
        const prefix = document.getElementById('add-company-prefix')?.value.trim();
        if (!name||!prefix) { errEl.textContent='الاسم والبادئة مطلوبان'; restore(); return; }
        result = await repo.create('companies',{name,account_prefix:prefix});
        if(isOk(result)) await AppStore.refreshData();

      } else if (type==='bank') {
        const name    = document.getElementById('add-bank-name')?.value.trim();
        const ceiling = parseFloat(document.getElementById('add-bank-ceiling')?.value);
        if (!name||!ceiling||ceiling<1) { errEl.textContent='الاسم والسقف مطلوبان'; restore(); return; }
        result = await repo.create('bank_accounts',{
          name, financial_ceiling:ceiling,
          account_number:document.getElementById('add-bank-acc')?.value.trim()||null,
          card_holder:document.getElementById('add-bank-holder')?.value.trim()||null,
          reset_time:'00:00:00',
        });
        if(isOk(result)) await AppStore.refreshData();

      } else if (type==='expense') {
        const name = document.getElementById('add-exp-name')?.value.trim();
        const code = document.getElementById('add-exp-code')?.value.trim();
        if (!name||!code) { errEl.textContent='الاسم والرمز مطلوبان'; restore(); return; }
        if (!code.startsWith('EXP_')) { errEl.textContent='الرمز يجب أن يبدأ بـ EXP_'; restore(); return; }
        result = await repo.create('expense_accounts',{name,code});
        if(isOk(result)) await AppStore.refreshData();

      } else if (type==='custom') {
        const name    = document.getElementById('add-custom-name')?.value.trim();
        const accId   = document.getElementById('add-custom-id')?.value.trim();
        const balance = parseFloat(document.getElementById('add-custom-balance')?.value)||0;
        if (!name||!accId) { errEl.textContent='الاسم والمعرف مطلوبان'; restore(); return; }
        // إنشاء رصيد في account_balances
        if (navigator.onLine) {
          const { error } = await supabaseClient
            .from('account_balances')
            .upsert({ account_id:accId, balance, last_updated:new Date().toISOString() });
          result = error ? {ok:false,error:error.message} : {ok:true,data:{}};
        } else {
          await db.account_balances.put({account_id:accId, balance, last_updated:new Date().toISOString()});
          result = {ok:true,data:{}};
        }
      } else {
        errEl.textContent='اختر نوع الحساب أولاً';
        restore(); return;
      }

      restore();
      if (isOk(result)) {
        showToast('✅ تم إضافة الحساب بنجاح','success');
        this._closeAddModal();
        await this._loadChart();
      } else {
        errEl.textContent = result.error||'فشل الحفظ';
      }
    } catch(e) {
      restore();
      errEl.textContent = `خطأ: ${e.message}`;
    }
  },

  // ─── تحميل دليل الحسابات ───
  async _loadChart() {
    const el = document.getElementById('acct-chart');
    if (!el) return;

    el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:40px;"><div class="spinner spinner-dark"></div></div>`;

    let chartData = null;
    try {
      if (navigator.onLine) {
        const { data, error } = await supabaseClient.rpc('get_chart_of_accounts');
        if (!error && data) chartData = data;
      }
    } catch {}

    if (!chartData) chartData = await this._buildLocalChartData();

    if (!chartData?.categories?.length) {
      el.innerHTML = this._renderEmptyChart();
      return;
    }

    el.innerHTML = '';

    const categoryMeta = {
      agents  :{ icon:'👤', label:'حسابات المناديب',         color:'var(--accent)',   bg:'rgba(37,99,235,0.06)'   },
      companies:{ icon:'🏢', label:'حسابات الشركات',          color:'var(--info)',     bg:'rgba(2,132,199,0.06)'   },
      banks    :{ icon:'🏦', label:'الحسابات البنكية',         color:'var(--success)',  bg:'rgba(5,150,105,0.06)'   },
      expenses :{ icon:'💸', label:'حسابات المصروفات',         color:'var(--danger)',   bg:'rgba(220,38,38,0.06)'   },
      treasury :{ icon:'🏛️', label:'الخزينة والحسابات العامة',color:'var(--warning)',  bg:'rgba(217,119,6,0.06)'   },
    };

    for (const cat of chartData.categories) {
      const meta     = categoryMeta[cat.category]||{icon:'📋',label:cat.label||cat.category,color:'var(--text-secondary)',bg:'transparent'};
      const total    = Math.round(parseFloat(cat.total_balance||0));
      const accounts = cat.accounts||[];

      const section = document.createElement('div');
      section.className = 'glass-card';
      section.style.marginBottom = '16px';

      section.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;
          margin-bottom:${accounts.length?'14px':'0'};padding-bottom:${accounts.length?'12px':'0'};
          ${accounts.length?'border-bottom:2px solid '+meta.color+'22;':''}">
          <div style="display:flex;align-items:center;gap:10px;">
            <div style="width:40px;height:40px;border-radius:12px;
              background:${meta.bg};border:1px solid ${meta.color}22;
              display:flex;align-items:center;justify-content:center;font-size:1.3rem;">
              ${meta.icon}
            </div>
            <div>
              <div style="font-weight:700;font-size:0.95rem;color:var(--text-primary);">${escapeHtml(meta.label)}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${accounts.length} حساب</div>
            </div>
          </div>
          <div style="text-align:left;direction:ltr;">
            <div style="font-weight:800;font-size:1.1rem;color:${meta.color};">
              ${total>=0?'':'−'}${Math.abs(total).toLocaleString('en-US')}
              <span style="font-size:0.65rem;color:var(--text-muted);">${APP_CONFIG.CURRENCY_SYMBOL}</span>
            </div>
            <div style="font-size:0.70rem;color:var(--text-muted);">إجمالي الرصيد</div>
          </div>
        </div>`;

      if (accounts.length) {
        const tableWrap = document.createElement('div');
        tableWrap.className = 'table-wrapper';
        tableWrap.innerHTML = `
          <table class="data-table">
            <thead><tr>
              <th>الحساب</th>
              <th>معرف الحساب</th>
              <th>الرصيد</th>
              <th>كشف</th>
            </tr></thead>
            <tbody>
              ${accounts.map(acc=>{
                const bal=Math.round(parseFloat(acc.balance||0));
                return `<tr>
                  <td style="font-weight:600;">${escapeHtml(acc.name||acc.account_id)}</td>
                  <td style="direction:ltr;font-family:monospace;font-size:0.72rem;color:var(--text-muted);">
                    ${escapeHtml(acc.account_id)}
                  </td>
                  <td style="font-weight:700;direction:ltr;color:${bal>=0?'var(--success)':'var(--danger)'};">
                    ${bal>=0?'':'−'}${Math.abs(bal).toLocaleString('en-US')} ر.س
                  </td>
                  <td>
                    <button class="view-stmt-btn btn btn-secondary btn-sm"
                      data-account="${escapeHtml(acc.account_id)}"
                      data-name="${escapeHtml(acc.name||acc.account_id)}"
                      style="display:flex;align-items:center;gap:4px;font-size:0.78rem;">
                      <i data-lucide="file-text" style="width:12px;height:12px;"></i> كشف
                    </button>
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>`;
        section.appendChild(tableWrap);
      }

      el.appendChild(section);
    }

    // إجمالي عام
    if (chartData.total_assets!==undefined) {
      const totals = document.createElement('div');
      totals.className = 'glass-card';
      totals.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:14px;';
      totals.innerHTML = `
        <div style="text-align:center;padding:14px;background:rgba(5,150,105,0.08);border-radius:12px;border:1px solid rgba(5,150,105,0.18);">
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px;">📈 إجمالي الأصول (مدين)</div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--success);direction:ltr;">
            ${Math.round(parseFloat(chartData.total_assets||0)).toLocaleString('en-US')} ر.س
          </div>
        </div>
        <div style="text-align:center;padding:14px;background:rgba(220,38,38,0.08);border-radius:12px;border:1px solid rgba(220,38,38,0.18);">
          <div style="font-size:0.75rem;color:var(--text-muted);margin-bottom:5px;">📉 إجمالي الالتزامات (دائن)</div>
          <div style="font-size:1.3rem;font-weight:800;color:var(--danger);direction:ltr;">
            ${Math.round(parseFloat(chartData.total_liabilities||0)).toLocaleString('en-US')} ر.س
          </div>
        </div>`;
      el.appendChild(totals);
    }

    el.querySelectorAll('.view-stmt-btn').forEach(btn=>{
      btn.addEventListener('click',()=>this._showStatement(btn.dataset.account,btn.dataset.name));
    });

    if (window.lucide) lucide.createIcons();
  },

  _renderEmptyChart() {
    return `
      <div class="glass-card" style="text-align:center;padding:40px 20px;">
        <div style="font-size:3rem;margin-bottom:16px;opacity:0.5;">📊</div>
        <h3 style="font-weight:700;margin-bottom:8px;">لا توجد حسابات بعد</h3>
        <p style="font-size:0.85rem;color:var(--text-muted);margin-bottom:20px;">
          انقر على "إضافة حساب" لإنشاء حسابك الأول، أو أضف شجرة الحسابات الافتراضية
        </p>
        <button id="add-default-chart-btn" class="btn btn-primary">
          🌳 إضافة شجرة الحسابات الافتراضية
        </button>
      </div>`;
  },

  async _buildLocalChartData() {
    let balances=[];
    try {
      if(navigator.onLine){const{data}=await supabaseClient.from('account_balances').select('*').order('account_id');balances=data||[];}
      else balances=await db.account_balances.toArray();
    } catch { balances=[]; }
    if(!balances.length) return null;

    const users=AppStore.getState('users');
    const banks=AppStore.getState('bankAccounts');
    const companies=AppStore.getState('companies');
    const cats={agents:[],companies:[],banks:[],expenses:[],treasury:[]};

    for(const b of balances){
      const bal=Math.round(parseFloat(b.balance||0));
      let name=b.account_id,cat='treasury';
      if(b.account_id.startsWith('AGT_')){
        const id=b.account_id.slice(4);
        const u=users.find(u=>u.id===id);
        name=u?.display_name||id; cat='agents';
      } else if(b.account_id.startsWith('COMP_')){
        const p=b.account_id.slice(5);
        const c=companies.find(c=>c.account_prefix===p);
        name=c?.name||p; cat='companies';
      } else if(b.account_id.startsWith('BNK_')){
        const id=b.account_id.slice(4);
        const bk=banks.find(bk=>bk.id===id);
        name=bk?.name||id; cat='banks';
      } else if(b.account_id.startsWith('EXP_')){
        name=b.account_id.slice(4); cat='expenses';
      }
      cats[cat].push({account_id:b.account_id,name,balance:bal});
    }

    return {
      categories:Object.entries(cats).map(([key,accs])=>({
        category:key,
        label:{agents:'المناديب',companies:'الشركات',banks:'البنوك',expenses:'المصروفات',treasury:'الخزينة'}[key]||key,
        total_balance:accs.reduce((s,a)=>s+a.balance,0),
        accounts:accs,
      })).filter(c=>c.accounts.length>0),
    };
  },

  _showStatement(accountId, accountName) {
    this._selectedAccount      = accountId;
    this._selectedAccountName  = accountName;
    const stmtSection = document.getElementById('acct-stmt-section');
    if (stmtSection) stmtSection.style.display='block';
    const titleEl = document.getElementById('stmt-account-title');
    const idEl    = document.getElementById('stmt-account-id');
    if(titleEl) titleEl.textContent=`📄 كشف حساب: ${accountName}`;
    if(idEl)    idEl.textContent=accountId;
    const firstOfMonth=new Date();firstOfMonth.setDate(1);
    const fromEl=document.getElementById('stmt-from');
    if(fromEl&&!fromEl.value) fromEl.value=firstOfMonth.toLocaleDateString('en-CA',{timeZone:APP_CONFIG.TIMEZONE});
    stmtSection.scrollIntoView({behavior:'smooth',block:'start'});
    this._loadStatement();
  },

  async _loadStatement() {
    if (!this._selectedAccount) return;
    const entriesEl = document.getElementById('stmt-entries');
    const summaryEl = document.getElementById('stmt-summary');
    if (!entriesEl) return;

    const from=document.getElementById('stmt-from')?.value||'2020-01-01';
    const to  =document.getElementById('stmt-to')?.value  ||getCurrentSaudiDate();

    entriesEl.innerHTML=`<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(4);
    if(summaryEl)summaryEl.innerHTML='';

    let stmtData=null;
    try {
      if(navigator.onLine){
        const{data,error}=await supabaseClient.rpc('get_account_statement',{p_account_id:this._selectedAccount,p_from_date:from,p_to_date:to});
        if(!error&&data)stmtData=data;
      }
    } catch {}

    if(!stmtData){
      const result=await AccountingService.getStatement(this._selectedAccount,from,to,{page:1,pageSize:500});
      if(isOk(result))stmtData={
        opening_balance:result.data.openingBalance,closing_balance:result.data.closingBalance,
        total_debit:result.data.totalDebit,total_credit:result.data.totalCredit,entries:result.data.entries,
      };
    }

    if(!stmtData){entriesEl.innerHTML=`<div class="empty-state"><div class="empty-state-text">فشل تحميل كشف الحساب</div></div>`;return;}

    const ob=Math.round(parseFloat(stmtData.opening_balance||0));
    const cb=Math.round(parseFloat(stmtData.closing_balance||0));
    const td=Math.round(parseFloat(stmtData.total_debit||0));
    const tc=Math.round(parseFloat(stmtData.total_credit||0));

    if(summaryEl){
      summaryEl.innerHTML=`
        ${this._stmtCard('الرصيد الافتتاحي',ob,'var(--info)')}
        ${this._stmtCard('إجمالي المدين',td,'var(--success)')}
        ${this._stmtCard('إجمالي الدائن',tc,'var(--danger)')}
        ${this._stmtCard('الرصيد الختامي',cb,cb>=0?'var(--success)':'var(--danger)')}`;
    }

    const entries=stmtData.entries||[];
    if(!entries.length){
      entriesEl.innerHTML=`<div class="empty-state"><div class="empty-state-icon">📄</div><div class="empty-state-text">لا توجد قيود في هذه الفترة</div></div>`;
      return;
    }

    let runBal=ob;
    const table=document.createElement('div');table.className='table-wrapper';
    table.innerHTML=`
      <table class="data-table">
        <thead><tr><th>التاريخ</th><th>رقم القيد</th><th>البيان</th><th>المندوب</th><th>مدين</th><th>دائن</th><th>الرصيد</th></tr></thead>
        <tbody>
          <tr style="background:rgba(2,132,199,0.06);">
            <td colspan="6" style="font-weight:700;color:var(--info);text-align:center;">رصيد افتتاحي</td>
            <td style="font-weight:800;color:var(--info);direction:ltr;">${ob>=0?'':'−'}${Math.abs(ob).toLocaleString('en-US')} ر.س</td>
          </tr>
          ${entries.map(e=>{
            const d=Math.round(parseFloat(e.debit||0));
            const c=Math.round(parseFloat(e.credit||0));
            runBal+=d-c;
            return `<tr>
              <td style="font-size:0.82rem;white-space:nowrap;">${escapeHtml(formatDateArabic(e.date))}</td>
              <td style="font-family:monospace;font-size:0.72rem;color:var(--text-muted);direction:ltr;">${escapeHtml(e.voucher_number||'—')}</td>
              <td style="font-size:0.85rem;max-width:170px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(e.description||'—')}</td>
              <td style="font-size:0.80rem;color:var(--text-secondary);">${escapeHtml(e.agent_name||'—')}</td>
              <td style="color:var(--success);font-weight:${d>0?'700':'400'};direction:ltr;">${d>0?d.toLocaleString('en-US')+' ر.س':'—'}</td>
              <td style="color:var(--danger);font-weight:${c>0?'700':'400'};direction:ltr;">${c>0?c.toLocaleString('en-US')+' ر.س':'—'}</td>
              <td style="font-weight:700;color:${runBal>=0?'var(--success)':'var(--danger)'};direction:ltr;">${runBal>=0?'':'−'}${Math.abs(runBal).toLocaleString('en-US')} ر.س</td>
            </tr>`;
          }).join('')}
          <tr style="background:rgba(5,150,105,0.06);border-top:2px solid var(--success)22;">
            <td colspan="6" style="font-weight:700;color:${cb>=0?'var(--success)':'var(--danger)'};text-align:center;">رصيد ختامي</td>
            <td style="font-weight:800;color:${cb>=0?'var(--success)':'var(--danger)'};direction:ltr;">${cb>=0?'':'−'}${Math.abs(cb).toLocaleString('en-US')} ر.س</td>
          </tr>
        </tbody>
      </table>`;
    entriesEl.innerHTML='';
    entriesEl.appendChild(table);
    if(window.lucide)lucide.createIcons();
  },

  _stmtCard(label, value, color) {
    return `
      <div style="text-align:center;padding:12px;background:${color}12;border-radius:12px;border:1px solid ${color}22;">
        <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:4px;">${label}</div>
        <div style="font-weight:800;font-size:1rem;color:${color};direction:ltr;">
          ${value>=0?'':'−'}${Math.abs(value).toLocaleString('en-US')} ر.س
        </div>
      </div>`;
  },
};

window.AccountManagementComponent = AccountManagementComponent;
console.log('✅ AccountManagementComponent v3.0 — إضافة حساب + شجرة افتراضية + كشف احترافي');
