/**
 * components/DataEntryComponent.js — v4.0
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * الإصلاحات:
 * ✅ 1. استبدال navigator.onLine بـ isOnline() الموحدة (كل المواضع)
 * ✅ 2. المدير يختار أي مستخدم مسجل لإدخال البيانات بدلاً عنه
 * ✅ 3. التحصيل: عند "سحب من بطاقة" تظهر قائمة الحسابات البنكية
 *         وينعكس الأمر على الحساب البنكي مباشرةً (سحب نقدي)
 * ✅ 4. الإيداع: قائمة الحسابات البنكية تعرض السقف والمتبقي
 * ✅ 5. لا يُسمح بالحفظ بدون اختيار بنك عند payType='card' أو 'deposit'
 * ✅ 6. إضافة placeholder واضح لحقول المبلغ
 * ✅ 7. مسح النموذج بعد الحفظ بشكل صحيح
 */
'use strict';

const DataEntryComponent = {
  _activeForm  : 'collection',
  _container   : null,
  _sortedBanks : [],

  async render(container) {
    this._container = container;
    container.innerHTML = '';
    await this._prepareSortedBanks();
    container.appendChild(await this._buildPage());
  },

  /* ── جلب البنوك وترتيبها ── */
  async _prepareSortedBanks() {
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    let allBanks  = [];
    try {
      /* ✅ isOnline() */
      if (isOnline()) {
        const { data } = await supabaseClient
          .from('bank_accounts')
          .select('id,name,financial_ceiling,company_id,reset_time')
          .order('name');
        allBanks = data || [];
      } else {
        allBanks = await db.bank_accounts.toArray();
      }
    } catch {
      allBanks = AppStore.getState('bankAccounts') || [];
    }
    if (!allBanks.length) allBanks = AppStore.getState('bankAccounts') || [];

    /* ترتيب حسب آخر نشاط للمندوب */
    let lastActivityMap = {};
    try {
      if (isOnline() && agentId) {
        const { data } = await supabaseClient
          .from('transactions')
          .select('bank_account_id,created_at')
          .eq('agent_id', agentId)
          .eq('type', 'deposit')
          .not('bank_account_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(100);
        (data || []).forEach(d => {
          if (d.bank_account_id && !lastActivityMap[d.bank_account_id])
            lastActivityMap[d.bank_account_id] = d.created_at;
        });
      }
    } catch {}

    this._sortedBanks = [...allBanks].sort((a, b) => {
      const aT = lastActivityMap[a.id] || '';
      const bT = lastActivityMap[b.id] || '';
      if (aT && bT) return bT.localeCompare(aT);
      if (aT) return -1;
      if (bT) return  1;
      return (a.name || '').localeCompare(b.name || '');
    });
  },

  async _buildPage() {
    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;';

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);';
    title.textContent = 'إدخال البيانات';
    header.appendChild(title);

    /* ✅ المدير يختار أي مستخدم مسجل */
    if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      const agentFilter = this._buildAgentFilter();
      header.appendChild(agentFilter);
    }

    wrap.appendChild(header);
    wrap.appendChild(this._buildFormTabs());

    const formArea = document.createElement('div');
    formArea.id = 'data-entry-form-area';
    wrap.appendChild(formArea);

    this._renderForm(this._activeForm, formArea);
    return wrap;
  },

  /* ✅ فلتر المستخدم المحسَّن — يشمل جميع المستخدمين المسجلين */
  _buildAgentFilter() {
    const wrap  = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;flex-wrap:wrap;';

    const label = document.createElement('label');
    label.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);white-space:nowrap;';
    label.textContent = 'إدخال بدلاً عن:';
    wrap.appendChild(label);

    const select = document.createElement('select');
    select.id = 'agent-filter-select';
    select.className = 'form-control';
    select.style.cssText = 'min-width:200px;max-width:240px;padding:8px 12px;font-size:0.88rem;';

    const currentUser = AuthService.getCurrentUser();

    /* الخيار الافتراضي: نفسه */
    const selfOpt = document.createElement('option');
    selfOpt.value = '';
    selfOpt.textContent = `👤 ${currentUser?.display_name || 'نفسي'} (أنا)`;
    select.appendChild(selfOpt);

    /* ✅ جميع المستخدمين النشطين (ليس فقط المناديب) */
    const allUsers = AppStore.getState('users').filter(u =>
      u.is_active && u.id !== currentUser?.id
    );

    /* تجميع حسب الدور */
    const agents    = allUsers.filter(u => u.role === ROLES.AGENT);
    const admins    = allUsers.filter(u => u.role !== ROLES.AGENT);

    if (agents.length) {
      const grpAgent = document.createElement('optgroup');
      grpAgent.label = '— المناديب —';
      agents.forEach(a => {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = a.display_name;
        grpAgent.appendChild(o);
      });
      select.appendChild(grpAgent);
    }

    if (admins.length) {
      const grpAdmin = document.createElement('optgroup');
      grpAdmin.label = '— الإدارة —';
      admins.forEach(a => {
        const o = document.createElement('option');
        o.value = a.id;
        o.textContent = `${a.display_name} (${ROLE_LABELS[a.role] || a.role})`;
        grpAdmin.appendChild(o);
      });
      select.appendChild(grpAdmin);
    }

    /* تعيين القيمة المحفوظة */
    const savedAgent = AppStore.getState('selectedAgentId');
    if (savedAgent) select.value = savedAgent;

    select.addEventListener('change', async () => {
      AppStore.setSelectedAgent(select.value || null);
      await this._prepareSortedBanks();
      const area = document.getElementById('data-entry-form-area');
      if (area) this._renderForm(this._activeForm, area);
    });

    wrap.appendChild(select);
    return wrap;
  },

  _buildFormTabs() {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      display:flex;gap:8px;margin-bottom:20px;
      padding:6px;background:var(--bg-input);
      border-radius:16px;overflow-x:auto;`;

    const forms = [
      { id:'collection', label:'تحصيل',       icon:'💰' },
      { id:'deposit',    label:'إيداع',        icon:'🏦' },
      { id:'expense',    label:'مصروف',        icon:'💸' },
      { id:'transfer',   label:'استلام/تسليم', icon:'🔄' },
    ];

    forms.forEach(f => {
      const btn = document.createElement('button');
      btn.id = `form-tab-${f.id}`;
      btn.style.cssText = `
        flex:1;min-width:90px;padding:10px 8px;border:none;border-radius:12px;
        background:${this._activeForm === f.id ? 'var(--accent)' : 'transparent'};
        color:${this._activeForm === f.id ? '#fff' : 'var(--text-secondary)'};
        font-family:inherit;font-size:0.85rem;font-weight:600;
        cursor:pointer;transition:all 0.18s;white-space:nowrap;
        display:flex;align-items:center;justify-content:center;gap:6px;`;
      btn.innerHTML = `<span>${f.icon}</span><span>${escapeHtml(f.label)}</span>`;
      btn.addEventListener('click', () => {
        this._activeForm = f.id;
        wrap.querySelectorAll('button').forEach(b => {
          const active = b.id === `form-tab-${f.id}`;
          b.style.background = active ? 'var(--accent)' : 'transparent';
          b.style.color      = active ? '#fff' : 'var(--text-secondary)';
        });
        const area = document.getElementById('data-entry-form-area');
        if (area) this._renderForm(f.id, area);
      });
      wrap.appendChild(btn);
    });
    return wrap;
  },

  _renderForm(formId, container) {
    container.innerHTML = '';
    const card = document.createElement('div');
    card.className = 'glass-card animate-fade-in';
    switch (formId) {
      case 'collection': card.appendChild(this._buildCollectionForm()); break;
      case 'deposit':    card.appendChild(this._buildDepositForm());    break;
      case 'expense':    card.appendChild(this._buildExpenseForm());    break;
      case 'transfer':   card.appendChild(this._buildTransferForm());   break;
    }
    container.appendChild(card);
  },

  /* ── دوال مساعدة للنموذج ── */
  _field(id, label, required = false) {
    const wrap = document.createElement('div');
    wrap.className = 'form-group';
    const lbl = document.createElement('label');
    lbl.className = 'form-label';
    lbl.htmlFor = id;
    lbl.innerHTML = escapeHtml(label) + (required ? ' <span class="required">*</span>' : '');
    wrap.appendChild(lbl);
    return wrap;
  },

  _input(id, type = 'text', placeholder = '', attrs = {}) {
    const el = document.createElement('input');
    el.id = id; el.type = type; el.placeholder = placeholder;
    el.className = 'form-control';
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  },

  _errMsg(id) {
    const el = document.createElement('div');
    el.id = id; el.className = 'form-error';
    return el;
  },

  /* ── بناء قائمة الحسابات البنكية مع السقف ── */
  _buildBankSelect(selectId, placeholder = '— اختر الحساب البنكي —') {
    const select = document.createElement('select');
    select.id = selectId;
    select.className = 'form-control';

    const defaultOpt = document.createElement('option');
    defaultOpt.value = '';
    defaultOpt.textContent = placeholder;
    select.appendChild(defaultOpt);

    this._sortedBanks.forEach((b, idx) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      const star  = (idx === 0 && this._sortedBanks.length > 1) ? '★ ' : '';
      const ceil  = b.financial_ceiling ? ` — سقف: ${Math.round(b.financial_ceiling).toLocaleString('en-US')}` : '';
      opt.textContent = `${star}${b.name}${ceil}`;
      select.appendChild(opt);
    });

    return select;
  },

  /* ═══════════════════════════════════════════════
     1. نموذج التحصيل
  ═══════════════════════════════════════════════ */
  _buildCollectionForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--success);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>💰</span><span>تحصيل</span>';
    frag.appendChild(title);

    /* نوع الدفع */
    const typeField = this._field('col-pay-type', 'نوع الدفع', true);
    const typeSelect = document.createElement('select');
    typeSelect.id = 'col-pay-type';
    typeSelect.className = 'form-control';
    typeSelect.innerHTML = `
      <option value="cash">نقدي</option>
      <option value="card">سحب من بطاقة (يُسجَّل على الحساب البنكي)</option>`;
    typeField.appendChild(typeSelect);
    frag.appendChild(typeField);

    /* ✅ قائمة الحسابات البنكية — تظهر دائماً لكن مطلوبة فقط عند card */
    const bankField = this._field('col-bank-account', 'الحساب البنكي للسحب');
    const bankSelect = this._buildBankSelect('col-bank-account', '— اختر حساب السحب —');
    bankField.appendChild(bankSelect);
    bankField.appendChild(this._errMsg('col-bank-account-err'));
    /* تُخفى في البداية */
    bankField.style.display = 'none';
    frag.appendChild(bankField);

    /* معلومات الحساب المختار */
    const bankInfo = document.createElement('div');
    bankInfo.id = 'col-bank-info';
    bankInfo.style.cssText = 'display:none;margin:-8px 0 12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);font-size:0.82rem;border:1px solid var(--border-color);';
    frag.appendChild(bankInfo);

    /* إظهار/إخفاء قائمة البنوك حسب نوع الدفع */
    typeSelect.addEventListener('change', async () => {
      const isCard = typeSelect.value === 'card';
      bankField.style.display = isCard ? '' : 'none';
      bankInfo.style.display  = (isCard && bankSelect.value) ? '' : 'none';
      const errEl = document.getElementById('col-bank-account-err');
      if (errEl) errEl.textContent = '';
    });

    /* عرض معلومات البنك عند الاختيار */
    bankSelect.addEventListener('change', async () => {
      const bank = this._sortedBanks.find(b => b.id === bankSelect.value);
      if (!bank) { bankInfo.style.display = 'none'; return; }
      const today    = getCurrentSaudiDate();
      const total    = await AccountingService.getDailyDepositsTotal(bank.id, today);
      const ceil     = parseFloat(bank.financial_ceiling) || 0;
      const pct      = ceil > 0 ? Math.min(100, (total / ceil) * 100) : 0;
      const rem      = Math.max(0, ceil - total);
      const cls      = getProgressClass ? getProgressClass(pct) : (pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low');
      bankInfo.style.display = '';
      bankInfo.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
          <span style="color:var(--text-secondary);">الإيداعات اليومية</span>
          <span style="font-weight:700;">${formatCurrency(total)}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--text-muted);font-size:0.76rem;">
          <span>السقف: ${formatCurrency(ceil)}</span>
          <span style="color:${rem < ceil * 0.1 ? 'var(--danger)' : 'var(--success)'};">المتبقي: ${formatCurrency(rem)}</span>
        </div>`;
    });

    /* المبلغ */
    const amtField = this._field('col-amount', 'المبلغ', true);
    const amtInput = this._input('col-amount', 'number', 'أدخل المبلغ بالريال', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('col-amount-err'));
    frag.appendChild(amtField);

    /* البحث عن العميل */
    frag.appendChild(this._buildCustomerSearch());

    /* الشركة */
    const compField = this._field('col-company', 'لصالح شركة (اختياري)');
    const compSelect = document.createElement('select');
    compSelect.id = 'col-company'; compSelect.className = 'form-control';
    compSelect.innerHTML = `<option value="">— اختر شركة —</option>`;
    AppStore.getState('companies').forEach(c => {
      const o = document.createElement('option');
      o.value = c.id; o.textContent = c.name; compSelect.appendChild(o);
    });
    compField.appendChild(compSelect);
    frag.appendChild(compField);

    frag.appendChild(this._saveBtn('col-save-btn', '💾 حفظ التحصيل', async () => {
      await this._saveCollection({
        payType   : typeSelect.value,
        bankId    : typeSelect.value === 'card' ? bankSelect.value : null,
        amount    : amtInput.value,
        customer  : document.getElementById('col-customer-search')?.value?.trim() || '',
        customerId: document.getElementById('col-debtor-id')?.value || null,
        companyId : compSelect.value || null,
      });
    }));

    return frag;
  },

  /* ── بحث العملاء المديونين ── */
  _buildCustomerSearch() {
    const field = this._field('col-customer-search', 'بحث عن عميل');
    const wrap  = document.createElement('div');
    wrap.style.position = 'relative';

    const input = document.createElement('input');
    input.id = 'col-customer-search'; input.type = 'text';
    input.className = 'form-control';
    input.placeholder = 'اكتب اسم العميل...'; input.autocomplete = 'off';

    const dd = document.createElement('div');
    dd.id = 'col-customer-dropdown';
    dd.style.cssText = `
      position:absolute;top:100%;right:0;left:0;z-index:500;
      background:var(--glass-bg-heavy);border:1px solid var(--border-color);
      border-radius:12px;box-shadow:var(--shadow-lg);
      max-height:220px;overflow-y:auto;display:none;
      backdrop-filter:blur(16px);margin-top:4px;`;

    const custId   = document.createElement('input');
    custId.type = 'hidden'; custId.id = 'col-debtor-id';

    const debtInfo = document.createElement('div');
    debtInfo.id = 'col-debt-display';
    debtInfo.style.cssText = 'display:none;margin-top:6px;padding:8px 12px;background:rgba(220,38,38,0.08);border-radius:8px;font-size:0.82rem;';

    const allDebtors = AppStore.getState('debtors');

    const render = q => {
      const trimQ = q.trim().toLowerCase();
      dd.innerHTML = '';
      const matches = trimQ
        ? allDebtors.filter(d => d.name?.toLowerCase().includes(trimQ))
        : allDebtors.slice(0, 10);
      if (!matches.length) { dd.style.display = 'none'; return; }
      matches.forEach(d => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color);transition:background 150ms;';
        item.innerHTML = `
          <div>
            <div style="font-weight:600;font-size:0.88rem;">${escapeHtml(d.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(d.region || '—')}</div>
          </div>
          <div style="font-weight:700;color:${d.debt_amount > 0 ? 'var(--danger)' : 'var(--success)'};">
            ${formatCurrency(d.debt_amount || 0)}
          </div>`;
        item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-hover)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
          input.value   = d.name;
          custId.value  = d.id;
          dd.style.display = 'none';
          debtInfo.style.display = '';
          debtInfo.innerHTML = `💳 المديونية: <strong style="color:var(--danger);">${formatCurrency(d.debt_amount || 0)}</strong>`;
        });
        dd.appendChild(item);
      });
      dd.style.display = '';
    };

    input.addEventListener('input', () => { custId.value = ''; debtInfo.style.display = 'none'; render(input.value); });
    input.addEventListener('focus', () => render(input.value));
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) dd.style.display = 'none'; });

    wrap.appendChild(input); wrap.appendChild(dd); wrap.appendChild(custId);
    field.appendChild(wrap); field.appendChild(debtInfo);
    return field;
  },

  /* ═══════════════════════════════════════════════
     2. نموذج الإيداع
  ═══════════════════════════════════════════════ */
  _buildDepositForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--accent);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>🏦</span><span>إيداع بنكي</span>';
    frag.appendChild(title);

    /* ✅ قائمة البنوك مع السقف والمتبقي */
    const bankField = this._field('dep-bank', 'الحساب البنكي للإيداع', true);
    const bankSelect = this._buildBankSelect('dep-bank', '— اختر الحساب البنكي —');
    bankField.appendChild(bankSelect);
    bankField.appendChild(this._errMsg('dep-bank-err'));
    frag.appendChild(bankField);

    const ceilingInfo = document.createElement('div');
    ceilingInfo.id = 'dep-ceiling-info';
    ceilingInfo.style.cssText = 'margin:-8px 0 12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);font-size:0.82rem;display:none;border:1px solid var(--border-color);';
    frag.appendChild(ceilingInfo);

    bankSelect.addEventListener('change', async () => {
      const bank = this._sortedBanks.find(b => b.id === bankSelect.value);
      if (!bank) { ceilingInfo.style.display = 'none'; return; }
      const today = getCurrentSaudiDate();
      const total = await AccountingService.getDailyDepositsTotal(bank.id, today);
      const ceil  = parseFloat(bank.financial_ceiling) || 0;
      const pct   = ceil > 0 ? Math.min(100, (total / ceil) * 100) : 0;
      const rem   = Math.max(0, ceil - total);
      const cls   = getProgressClass ? getProgressClass(pct) : (pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low');
      ceilingInfo.style.display = '';
      ceilingInfo.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="color:var(--text-secondary);">إيداعات اليوم</span>
          <span style="font-weight:700;">${formatCurrency(total)}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:5px;color:var(--text-muted);font-size:0.76rem;">
          <span>السقف: ${formatCurrency(ceil)}</span>
          <span style="color:${rem < ceil * 0.1 ? 'var(--danger)' : 'var(--success)'};">المتبقي: ${formatCurrency(rem)}</span>
        </div>`;
    });

    /* المبلغ */
    const amtField = this._field('dep-amount', 'المبلغ', true);
    const amtInput = this._input('dep-amount', 'number', 'أدخل مبلغ الإيداع', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('dep-amount-err'));
    frag.appendChild(amtField);

    /* ملاحظات */
    const notesField = this._field('dep-notes', 'ملاحظات (اختياري)');
    const notesInput = document.createElement('textarea');
    notesInput.id = 'dep-notes'; notesInput.className = 'form-control';
    notesInput.rows = 2; notesInput.placeholder = 'أي تفاصيل إضافية';
    notesField.appendChild(notesInput);
    frag.appendChild(notesField);

    const hint = document.createElement('div');
    hint.style.cssText = 'padding:10px 14px;border-radius:10px;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.15);font-size:0.78rem;color:var(--accent);margin-bottom:16px;line-height:1.7;';
    hint.textContent = 'ℹ️ سيتم تسجيل قيدين محاسبيين تلقائياً: إيداع في البنك + براءة ذمة المندوب.';
    frag.appendChild(hint);

    frag.appendChild(this._saveBtn('dep-save-btn', '💾 حفظ الإيداع', async () => {
      await this._saveDeposit({
        bankId : bankSelect.value,
        amount : amtInput.value,
        notes  : notesInput.value.trim(),
      });
    }));

    return frag;
  },

  /* ═══════════════════════════════════════════════
     3. نموذج المصروف
  ═══════════════════════════════════════════════ */
  _buildExpenseForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--danger);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>💸</span><span>مصروف</span>';
    frag.appendChild(title);

    /* نوع المصروف */
    const typeField = this._field('exp-type', 'نوع المصروف', true);
    const typeSelect = document.createElement('select');
    typeSelect.id = 'exp-type'; typeSelect.className = 'form-control';
    typeSelect.innerHTML = '<option value="">— اختر النوع —</option>';
    AppStore.getState('expenseAccounts').forEach(e => {
      const o = document.createElement('option');
      o.value = e.code; o.textContent = e.name; typeSelect.appendChild(o);
    });
    const newOpt = document.createElement('option');
    newOpt.value = '__new__'; newOpt.textContent = '+ إضافة نوع جديد';
    typeSelect.appendChild(newOpt);
    typeField.appendChild(typeSelect);
    typeField.appendChild(this._errMsg('exp-type-err'));
    frag.appendChild(typeField);

    /* نوع جديد */
    const newTypeWrap = document.createElement('div');
    newTypeWrap.style.display = 'none';
    const newTypeField = this._field('exp-new-type', 'اسم النوع الجديد');
    const newTypeInput = this._input('exp-new-type', 'text', 'مثال: غرامات');
    newTypeField.appendChild(newTypeInput);
    newTypeWrap.appendChild(newTypeField);
    frag.appendChild(newTypeWrap);
    typeSelect.addEventListener('change', () => {
      newTypeWrap.style.display = typeSelect.value === '__new__' ? '' : 'none';
    });

    /* المبلغ */
    const amtField = this._field('exp-amount', 'المبلغ', true);
    const amtInput = this._input('exp-amount', 'number', 'أدخل مبلغ المصروف', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('exp-amount-err'));
    frag.appendChild(amtField);

    /* التفاصيل */
    const detField = this._field('exp-details', 'التفاصيل (اختياري)');
    const detInput = document.createElement('textarea');
    detInput.id = 'exp-details'; detInput.className = 'form-control';
    detInput.rows = 2; detInput.placeholder = 'وصف المصروف';
    detField.appendChild(detInput);
    frag.appendChild(detField);

    frag.appendChild(this._saveBtn('exp-save-btn', '💾 حفظ المصروف', async () => {
      let expType = typeSelect.value;
      if (expType === '__new__') {
        const name = newTypeInput.value.trim();
        if (!name) { showToast('أدخل اسم النوع', 'warning'); return; }
        // منع double prefix: expense_code يُخزَّن بدون بادئة EXP_ — البادئة تُضاف تلقائياً في AccountId.expense()
        expType = name.toUpperCase().replace(/\s/g, '_').replace(/^EXP_/, '');
        await repo.create(TABLES.EXPENSE_ACCOUNTS, { name, code: expType });
      }
      await this._saveExpense({ expenseType:expType, amount:amtInput.value, details:detInput.value.trim() });
    }));

    return frag;
  },

  /* ═══════════════════════════════════════════════
     4. نموذج الاستلام / التسليم
  ═══════════════════════════════════════════════ */
  _buildTransferForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--info);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>🔄</span><span>استلام / تسليم</span>';
    frag.appendChild(title);

    /* نوع العملية */
    const txTypeField = this._field('tr-type', 'نوع العملية', true);
    const txTypeSelect = document.createElement('select');
    txTypeSelect.id = 'tr-type'; txTypeSelect.className = 'form-control';
    txTypeSelect.innerHTML = `
      <option value="receipt">استلام (أستلم من جهة)</option>
      <option value="delivery">تسليم (أسلّم لجهة)</option>`;
    txTypeField.appendChild(txTypeSelect);
    frag.appendChild(txTypeField);

    /* المصدر / الوجهة */
    const srcField = this._field('tr-source-type', 'المصدر / الوجهة', true);
    const srcSelect = document.createElement('select');
    srcSelect.id = 'tr-source-type'; srcSelect.className = 'form-control';
    srcSelect.innerHTML = `<option value="agent">مندوب</option><option value="company">شركة</option>`;
    srcField.appendChild(srcSelect);
    frag.appendChild(srcField);

    /* البحث عن مندوب */
    const agentWrap = document.createElement('div');
    agentWrap.id = 'tr-agent-wrap';
    const agentSearchWrap = document.createElement('div');
    agentSearchWrap.style.cssText = 'position:relative;margin-bottom:8px;';
    const agentInput = document.createElement('input');
    agentInput.id = 'tr-agent-search'; agentInput.type = 'text'; agentInput.className = 'form-control';
    agentInput.placeholder = 'اسم المندوب / الجهة...'; agentInput.autocomplete = 'off';
    const agentAccInput = document.createElement('input');
    agentAccInput.type = 'text'; agentAccInput.className = 'form-control'; agentAccInput.id = 'tr-agent-account';
    agentAccInput.placeholder = 'رقم الحساب (اختياري)'; agentAccInput.style.cssText = 'margin-top:8px;direction:ltr;';
    const agentIdHidden = document.createElement('input');
    agentIdHidden.type = 'hidden'; agentIdHidden.id = 'tr-agent-id';

    const agentDd = document.createElement('div');
    agentDd.style.cssText = `position:absolute;top:100%;right:0;left:0;z-index:500;background:var(--glass-bg-heavy);border:1px solid var(--border-color);border-radius:12px;box-shadow:var(--shadow-lg);max-height:240px;overflow-y:auto;display:none;backdrop-filter:blur(16px);margin-top:4px;`;

    const sysAgents = AppStore.getState('users').filter(u => u.role === ROLES.AGENT && u.is_active && u.id !== AuthService.getCurrentUserId());
    const BKEY = 'ahu_beneficiaries';
    const getBen = () => { try { return JSON.parse(localStorage.getItem(BKEY) || '[]'); } catch { return []; } };
    const saveBen = (n, a) => {
      const l = getBen(); const i = l.findIndex(b => b.name === n);
      if (i >= 0) { l[i].accountNum = a || l[i].accountNum; l[i].usedAt = Date.now(); }
      else l.unshift({ name:n, accountNum:a, usedAt:Date.now() });
      localStorage.setItem(BKEY, JSON.stringify(l.slice(0, 50)));
    };

    const renderAd = q => {
      const trimQ = q.trim().toLowerCase();
      agentDd.innerHTML = '';
      const sm = trimQ ? sysAgents.filter(a => a.display_name.toLowerCase().includes(trimQ)) : sysAgents;
      const bn = trimQ ? getBen().filter(b => b.name.toLowerCase().includes(trimQ)) : [];
      const allItems = [...sm.map(a => ({ label:a.display_name, sub:'مندوب', isSystem:true, id:a.id })),
                       ...bn.map(b => ({ label:b.name, sub:b.accountNum||'خارجي', isSystem:false }))];
      if (!allItems.length) { agentDd.style.display = 'none'; return; }
      allItems.forEach(it => {
        const el = document.createElement('div');
        el.style.cssText = 'padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color);transition:background 150ms;';
        el.innerHTML = `<div><span style="font-weight:600;font-size:0.88rem;">${escapeHtml(it.label)}</span><span style="font-size:0.72rem;color:var(--text-muted);margin-right:6px;">— ${escapeHtml(it.sub)}</span></div>`;
        el.addEventListener('mouseenter', () => { el.style.background = 'var(--bg-hover)'; });
        el.addEventListener('mouseleave', () => { el.style.background = ''; });
        el.addEventListener('click', () => {
          agentInput.value = it.label;
          agentIdHidden.value = it.isSystem ? it.id : '';
          agentDd.style.display = 'none';
        });
        agentDd.appendChild(el);
      });
      agentDd.style.display = '';
    };

    agentInput.addEventListener('input', () => { agentIdHidden.value = ''; renderAd(agentInput.value); });
    agentInput.addEventListener('focus', () => renderAd(agentInput.value));
    agentInput.addEventListener('blur', () => {
      const n = agentInput.value.trim();
      if (n && !agentIdHidden.value) saveBen(n, agentAccInput.value.trim());
    });
    document.addEventListener('click', e => { if (!agentSearchWrap.contains(e.target)) agentDd.style.display = 'none'; });

    agentSearchWrap.appendChild(agentInput);
    agentSearchWrap.appendChild(agentDd);
    agentSearchWrap.appendChild(agentIdHidden);
    const agentLbl = document.createElement('label');
    agentLbl.className = 'form-label'; agentLbl.textContent = 'المندوب / الجهة';
    agentWrap.appendChild(agentLbl);
    agentWrap.appendChild(agentSearchWrap);
    agentWrap.appendChild(agentAccInput);
    frag.appendChild(agentWrap);

    /* الشركة */
    const compWrap = document.createElement('div');
    compWrap.id = 'tr-company-wrap'; compWrap.style.display = 'none';
    const compField = this._field('tr-company', 'اختر الشركة', true);
    const compSelect = document.createElement('select');
    compSelect.id = 'tr-company'; compSelect.className = 'form-control';
    compSelect.innerHTML = '<option value="">— اختر شركة —</option>';
    AppStore.getState('companies').forEach(c => {
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.name; compSelect.appendChild(o);
    });
    compField.appendChild(compSelect);
    compWrap.appendChild(compField);
    frag.appendChild(compWrap);

    srcSelect.addEventListener('change', () => {
      agentWrap.style.display = srcSelect.value === 'agent' ? '' : 'none';
      compWrap.style.display  = srcSelect.value === 'company' ? '' : 'none';
    });

    /* المبلغ */
    const amtField = this._field('tr-amount', 'المبلغ', true);
    const amtInput = this._input('tr-amount', 'number', 'أدخل المبلغ', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('tr-amount-err'));
    frag.appendChild(amtField);

    frag.appendChild(this._saveBtn('tr-save-btn', '💾 حفظ العملية', async () => {
      const txType  = txTypeSelect.value;
      const srcType = srcSelect.value;
      const agentId = srcType === 'agent' ? (agentIdHidden.value || null) : null;
      const compId  = srcType === 'company' ? compSelect.value : null;
      if (srcType === 'agent' && agentInput.value.trim() && !agentIdHidden.value)
        saveBen(agentInput.value.trim(), agentAccInput.value.trim());
      await this._saveTransfer({
        txType,
        fromAgentId : txType === 'receipt'  ? agentId : null,
        toAgentId   : txType === 'delivery' ? agentId : null,
        companyId   : compId,
        amount      : amtInput.value,
      });
    }));

    return frag;
  },

  _saveBtn(id, label, handler) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'btn btn-primary btn-full btn-lg';
    btn.style.cssText = 'margin-top:8px;font-size:1rem;letter-spacing:0.02em;';
    btn.textContent = label;
    btn.addEventListener('click', handler);
    return btn;
  },

  /* ═══════════════ منطق الحفظ ═══════════════ */

  async _saveCollection({ payType, bankId, amount, customer, customerId, companyId }) {
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }

    /* ✅ التحقق من اختيار البنك عند السحب من بطاقة */
    if (payType === 'card') {
      if (!bankId) {
        const errEl = document.getElementById('col-bank-account-err');
        if (errEl) errEl.textContent = 'يجب اختيار الحساب البنكي عند سحب البطاقة';
        showToast('اختر الحساب البنكي لإتمام عملية سحب البطاقة', 'error');
        return;
      }
      const errEl = document.getElementById('col-bank-account-err');
      if (errEl) errEl.textContent = '';
    }

    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('col-save-btn');
    const restore = setButtonLoading(btn);

    const txData = {
      type            : 'collection',
      amount          : rounded,
      date            : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id        : agentId,
      company_id      : companyId || null,
      customer_name   : customer  || null,
      customer_id     : customerId || null,
      /* ✅ bank_account_id يُسجَّل فقط عند السحب من بطاقة */
      bank_account_id : payType === 'card' ? (bankId || null) : null,
    };

    const result = await AccountingService.createTransactionWithEntries(txData);
    restore();
    if (isOk(result)) {
      showToast('✅ تم حفظ التحصيل', 'success');
      this._resetForm('col');
      await this._showShareModal({ type:'تحصيل', amount:rounded, customer, agentId, date:txData.date });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveDeposit({ bankId, amount, notes }) {
    if (!bankId) { showToast('اختر الحساب البنكي', 'error'); return; }
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }

    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const bank    = this._sortedBanks.find(b => b.id === bankId)
                 || AppStore.getState('bankAccounts').find(b => b.id === bankId);

    /* التحقق من تجاوز السقف */
    if (bank) {
      const prevTotal = await AccountingService.getDailyDepositsTotal(bankId, getCurrentSaudiDate());
      const ceil      = Math.round(bank.financial_ceiling || 0);
      if (ceil > 0 && prevTotal + rounded > ceil) {
        const confirmed = await confirmDialog(
          `⚠️ تجاوز السقف!\nالإجمالي بعد العملية: ${(prevTotal + rounded).toLocaleString('en-US')} ر.س\nالسقف اليومي: ${ceil.toLocaleString('en-US')} ر.س\nهل تريد المتابعة؟`,
          'متابعة', 'إلغاء', 'warning'
        );
        if (!confirmed) return;
      }
    }

    const btn     = document.getElementById('dep-save-btn');
    const restore = setButtonLoading(btn);
    const txData  = {
      type            : 'deposit',
      amount          : rounded,
      date            : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id        : agentId,
      bank_account_id : bankId,
      company_id      : bank?.company_id || null,
      details         : notes || null,
    };

    const result = await AccountingService.createTransactionWithEntries(txData);
    restore();
    if (isOk(result)) {
      showToast('✅ تم حفظ الإيداع', 'success');
      this._resetForm('dep');
      const ceil = Math.round(bank?.financial_ceiling || 0);
      const used = await AccountingService.getDailyDepositsTotal(bankId, getCurrentSaudiDate());
      await this._showShareModal({
        type:'إيداع', amount:rounded, bankName:bank?.name, agentId, date:txData.date,
        ceilingRemain: Math.max(0, ceil - used),
      });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveExpense({ expenseType, amount, details }) {
    if (!expenseType) { showToast('اختر نوع المصروف', 'error'); return; }
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }

    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('exp-save-btn');
    const restore = setButtonLoading(btn);

    const result  = await AccountingService.createTransactionWithEntries({
      type        : 'expense',
      amount      : rounded,
      date        : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id    : agentId,
      expense_type: expenseType,
      details     : details || null,
    });
    restore();
    if (isOk(result)) {
      showToast('✅ تم حفظ المصروف', 'success');
      this._resetForm('exp');
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveTransfer({ txType, fromAgentId, toAgentId, companyId, amount }) {
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }
    if (!fromAgentId && !toAgentId && !companyId) { showToast('حدد المصدر أو الوجهة', 'error'); return; }

    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('tr-save-btn');
    const restore = setButtonLoading(btn);

    const result  = await AccountingService.createTransactionWithEntries({
      type          : txType,
      amount        : rounded,
      date          : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id      : agentId,
      from_agent_id : fromAgentId || null,
      to_agent_id   : toAgentId   || null,
      company_id    : companyId   || null,
    });
    restore();
    if (isOk(result)) {
      showToast('✅ تم حفظ العملية', 'success');
      this._resetForm('tr');
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  /* ✅ إعادة تعيين النماذج بشكل صحيح */
  _resetForm(prefix) {
    const numericIds = [`${prefix}-amount`];
    const selectIds  = [`${prefix}-bank`, `${prefix}-pay-type`, `${prefix}-type`, `${prefix}-company`];
    const textIds    = [`${prefix}-customer-search`, `${prefix}-notes`, `${prefix}-details`];
    const hiddenIds  = [`${prefix}-debtor-id`];

    numericIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = '0'; });
    selectIds.forEach(id  => { const el = document.getElementById(id); if (el) el.selectedIndex = 0; });
    textIds.forEach(id    => { const el = document.getElementById(id); if (el) el.value = ''; });
    hiddenIds.forEach(id  => { const el = document.getElementById(id); if (el) el.value = ''; });

    /* إخفاء الحقول الشرطية */
    ['col-bank-account-err', `${prefix}-bank-err`, `${prefix}-type-err`].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = '';
    });
    const bankInfo = document.getElementById('col-bank-info');
    if (bankInfo) bankInfo.style.display = 'none';
    const bankFieldCard = document.getElementById('col-bank-account')?.closest('.form-group');
    if (bankFieldCard && prefix === 'col') bankFieldCard.style.display = 'none';
    const ceilInfo = document.getElementById('dep-ceiling-info');
    if (ceilInfo) ceilInfo.style.display = 'none';
    const debtDisplay = document.getElementById('col-debt-display');
    if (debtDisplay) debtDisplay.style.display = 'none';
  },

  /* ── مودال المشاركة ── */
  async _showShareModal({ type, amount, bankName, customer, agentId, date, ceilingRemain }) {
    const users   = AppStore.getState('users');
    const agent   = users.find(u => u.id === agentId);
    const agentNm = agent?.display_name || '—';
    const amtStr  = Math.round(amount).toLocaleString('en-US');

    let text = `✅ ${type}: ${amtStr} ر.س`;
    if (customer) text += `\n👤 العميل: ${customer}`;
    if (bankName) text += `\n🏦 البنك: ${bankName}`;
    if (ceilingRemain !== undefined) text += `\n📊 المتبقي: ${Math.round(ceilingRemain).toLocaleString('en-US')} ر.س`;
    text += `\n👨‍💼 المندوب: ${agentNm}`;
    text += `\n📅 التاريخ: ${date}`;

    if (navigator.share) {
      try { await navigator.share({ text }); } catch { /* المستخدم رفض */ }
    } else {
      try { await navigator.clipboard.writeText(text); showToast('تم نسخ التفاصيل للحافظة', 'info'); }
      catch { /* لا يدعم الحافظة */ }
    }
  },
};

window.DataEntryComponent = DataEntryComponent;
console.log('✅ DataEntryComponent v4.0 — isOnline() + فلتر مستخدم كامل + بنوك محسّنة');
