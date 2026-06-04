/**
 * components/DataEntryComponent.js
 * نظام أبو حذيفة — إدخال البيانات
 *
 * المواصفات (الجزء السادس - البنود 8.1 إلى 8.4):
 * - 4 نماذج: تحصيل | إيداع | مصروف | استلام/تسليم
 * - فلتر المندوب (للمدير فقط) لإدخال بيانات بالنيابة
 * - التحقق من الصحة قبل الحفظ
 * - حالة التحميل على زر الحفظ
 * - Offline-First: الحفظ يعمل بدون اتصال
 * - إيداع بدون حقل "مساهمة الشركة"
 */

'use strict';

const DataEntryComponent = {

  _activeForm : 'collection',
  _container  : null,

  async render(container) {
    this._container = container;
    container.innerHTML = '';
    container.appendChild(await this._buildPage());
  },

  async _buildPage() {
    const wrap = document.createElement('div');

    // --- عنوان + فلتر المندوب (للمدير فقط) ---
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;';

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);';
    title.textContent = 'إدخال البيانات';
    header.appendChild(title);

    if (AuthService.isAdmin()) {
      const agentFilter = await this._buildAgentFilter();
      header.appendChild(agentFilter);
    }

    wrap.appendChild(header);

    // --- أزرار اختيار النموذج ---
    const formTabs = this._buildFormTabs();
    wrap.appendChild(formTabs);

    // --- حاوية النموذج ---
    const formArea = document.createElement('div');
    formArea.id = 'data-entry-form-area';
    wrap.appendChild(formArea);

    // عرض النموذج الافتراضي
    this._renderForm(this._activeForm, formArea);

    return wrap;
  },

  // ============================================================
  // فلتر اختيار المندوب (للمدير)
  // ============================================================

  async _buildAgentFilter() {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;align-items:center;gap:8px;';

    const label = document.createElement('label');
    label.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);';
    label.textContent = 'إدخال نيابة عن:';

    const select = document.createElement('select');
    select.id = 'agent-filter-select';
    select.className = 'form-control';
    select.style.cssText = 'width:180px;padding:8px 12px;font-size:0.88rem;';

    select.innerHTML = `<option value="">— نفسي (${escapeHtml(AuthService.getCurrentUser()?.display_name || 'مدير')})</option>`;

    const agents = AppStore.getState('users').filter(u => u.role === ROLES.AGENT && u.is_active);
    agents.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.id;
      opt.textContent = a.display_name;
      select.appendChild(opt);
    });

    // استعادة القيمة المحفوظة
    const savedAgent = AppStore.getState('selectedAgentId');
    if (savedAgent) select.value = savedAgent;

    select.addEventListener('change', () => {
      AppStore.setSelectedAgent(select.value || null);
    });

    wrap.appendChild(label);
    wrap.appendChild(select);
    return wrap;
  },

  // ============================================================
  // أزرار اختيار نوع النموذج
  // ============================================================

  _buildFormTabs() {
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      display:flex;gap:8px;margin-bottom:20px;
      padding:6px;background:var(--bg-input);
      border-radius:16px;overflow-x:auto;
    `;

    const forms = [
      { id: 'collection', label: 'تحصيل',        icon: '📥' },
      { id: 'deposit',    label: 'إيداع',         icon: '🏦' },
      { id: 'expense',    label: 'مصروف',         icon: '💸' },
      { id: 'transfer',   label: 'استلام/تسليم',  icon: '🔄' },
    ];

    forms.forEach(f => {
      const btn = document.createElement('button');
      btn.id = `form-tab-${f.id}`;
      btn.style.cssText = `
        flex:1;min-width:100px;padding:10px 8px;border:none;border-radius:12px;
        background:${this._activeForm === f.id ? 'var(--accent)' : 'transparent'};
        color:${this._activeForm === f.id ? '#fff' : 'var(--text-secondary)'};
        font-family:inherit;font-size:0.85rem;font-weight:600;
        cursor:pointer;transition:all 0.18s;white-space:nowrap;
        display:flex;align-items:center;justify-content:center;gap:6px;
      `;
      btn.innerHTML = `<span>${f.icon}</span><span>${escapeHtml(f.label)}</span>`;
      btn.addEventListener('click', () => {
        this._activeForm = f.id;
        // تحديث الأزرار
        wrap.querySelectorAll('button').forEach(b => {
          const isActive = b.id === `form-tab-${f.id}`;
          b.style.background = isActive ? 'var(--accent)' : 'transparent';
          b.style.color = isActive ? '#fff' : 'var(--text-secondary)';
        });
        // عرض النموذج
        const area = document.getElementById('data-entry-form-area');
        if (area) this._renderForm(f.id, area);
      });
      wrap.appendChild(btn);
    });

    return wrap;
  },

  // ============================================================
  // عرض النموذج المطلوب
  // ============================================================

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

  // ============================================================
  // بناء حقل النموذج (مساعد)
  // ============================================================

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
    el.id = id;
    el.type = type;
    el.placeholder = placeholder;
    el.className = 'form-control';
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  },

  _select(id, options = []) {
    const el = document.createElement('select');
    el.id = id;
    el.className = 'form-control';
    options.forEach(opt => {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      el.appendChild(o);
    });
    return el;
  },

  _errMsg(id) {
    const el = document.createElement('div');
    el.id = id;
    el.className = 'form-error';
    return el;
  },

  // ============================================================
  // 1. نموذج التحصيل
  // ============================================================

  _buildCollectionForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--success);';
    title.innerHTML = '📥 تحصيل';
    frag.appendChild(title);

    // نوع التحصيل
    const typeField = this._field('col-type', 'نوع التحصيل', true);
    const typeSelect = this._select('col-type', [
      { value: 'cash', label: 'نقدي' },
      { value: 'card', label: 'سحب بطاقة' },
    ]);
    typeField.appendChild(typeSelect);
    frag.appendChild(typeField);

    // حقل البطاقة البنكية (عند سحب بطاقة)
    const bankFieldWrap = document.createElement('div');
    bankFieldWrap.id = 'col-bank-wrap';
    bankFieldWrap.style.display = 'none';
    const bankField = this._field('col-bank-account', 'الحساب البنكي');
    const bankSelect = this._select('col-bank-account', [{ value: '', label: '— اختر الحساب —' }]);
    AppStore.getState('bankAccounts').forEach(b => {
      const o = document.createElement('option'); o.value = b.id; o.textContent = b.name;
      bankSelect.appendChild(o);
    });
    bankField.appendChild(bankSelect);
    bankFieldWrap.appendChild(bankField);
    frag.appendChild(bankFieldWrap);
    typeSelect.addEventListener('change', () => {
      bankFieldWrap.style.display = typeSelect.value === 'card' ? 'block' : 'none';
    });

    // المبلغ
    const amtField = this._field('col-amount', 'المبلغ', true);
    const amtInput = this._input('col-amount', 'number', '0', { min: '1', step: '1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('col-amount-err'));
    frag.appendChild(amtField);

    // ──────────────────────────────────────────────────────────
    // بحث العملاء الذكي (يشمل المديونين + إنشاء تلقائي)
    // ──────────────────────────────────────────────────────────
    const searchField = this._field('col-customer-search', 'بحث عن عميل');
    const searchWrap  = document.createElement('div');
    searchWrap.style.cssText = 'position:relative;';

    const searchInput = document.createElement('input');
    searchInput.id = 'col-customer-search';
    searchInput.type = 'text';
    searchInput.className = 'form-control';
    searchInput.placeholder = 'اكتب اسم العميل للبحث أو الإنشاء...';
    searchInput.autocomplete = 'off';

    const dropdown = document.createElement('div');
    dropdown.id = 'col-customer-dropdown';
    dropdown.style.cssText = `
      position:absolute;top:100%;right:0;left:0;z-index:500;
      background:var(--glass-bg-heavy);
      border:1px solid var(--border-color);border-radius:12px;
      box-shadow:var(--shadow-lg);
      max-height:220px;overflow-y:auto;display:none;
      backdrop-filter:blur(16px);margin-top:4px;`;

    // حقل مخفي للـ id والدين
    const custIdInput  = document.createElement('input');
    custIdInput.type   = 'hidden'; custIdInput.id = 'col-debtor-id';
    const debtAmtEl    = document.createElement('div');
    debtAmtEl.id = 'col-debt-display';
    debtAmtEl.style.cssText = 'display:none;margin-top:6px;padding:8px 12px;background:rgba(220,38,38,0.08);border-radius:8px;font-size:0.82rem;';

    const allDebtors = AppStore.getState('debtors');

    const renderDropdown = (q) => {
      const trimQ = q.trim().toLowerCase();
      dropdown.innerHTML = '';

      const matches = trimQ
        ? allDebtors.filter(d => d.name.toLowerCase().includes(trimQ))
        : allDebtors.slice(0, 8);

      matches.forEach(d => {
        const item = document.createElement('div');
        item.style.cssText = `
          padding:10px 14px;cursor:pointer;
          display:flex;justify-content:space-between;align-items:center;
          border-bottom:1px solid var(--border-color);
          transition:background var(--transition-fast);`;
        item.innerHTML = `
          <span style="font-weight:600;font-size:0.88rem;">${escapeHtml(d.name)}</span>
          <span style="font-size:0.78rem;color:var(--danger);direction:ltr;font-weight:700;">
            ${Math.round(d.debt_amount||0).toLocaleString('en-US')} ر.س
          </span>`;
        item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-hover)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          searchInput.value    = d.name;
          custIdInput.value    = d.id;
          const debtAmt        = Math.round(d.debt_amount||0);
          debtAmtEl.style.display = 'block';
          debtAmtEl.innerHTML  = `💳 مديونية العميل الحالية: <strong style="color:var(--danger);">${debtAmt.toLocaleString('en-US')} ر.س</strong>`;
          dropdown.style.display = 'none';
        });
        dropdown.appendChild(item);
      });

      // خيار "إنشاء عميل جديد"
      if (trimQ && !matches.find(d => d.name.toLowerCase() === trimQ)) {
        const newItem = document.createElement('div');
        newItem.style.cssText = `
          padding:10px 14px;cursor:pointer;
          display:flex;align-items:center;gap:8px;
          color:var(--accent);font-weight:600;font-size:0.85rem;
          transition:background var(--transition-fast);`;
        newItem.innerHTML = `<span style="font-size:1rem;">➕</span><span>إنشاء عميل جديد: "${escapeHtml(q.trim())}"</span>`;
        newItem.addEventListener('mouseenter', () => { newItem.style.background = 'var(--bg-hover)'; });
        newItem.addEventListener('mouseleave', () => { newItem.style.background = ''; });
        newItem.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          // إنشاء تلقائي للعميل في جدول debtors
          const newDebtor = await repo.create(TABLES.DEBTORS, {
            name           : q.trim(),
            debt_amount    : 0,
            assigned_agents: [AuthService.getCurrentUserId()],
          });
          if (isOk(newDebtor)) {
            custIdInput.value = newDebtor.data.id || newDebtor.data?.id || '';
            debtAmtEl.style.display = 'block';
            debtAmtEl.innerHTML = `✅ تم إنشاء حساب جديد للعميل "<strong>${escapeHtml(q.trim())}</strong>"`;
            debtAmtEl.style.background = 'rgba(5,150,105,0.08)';
            showToast(`✅ تم إنشاء حساب للعميل ${q.trim()}`, 'success');
          }
          dropdown.style.display = 'none';
        });
        dropdown.appendChild(newItem);
      }

      dropdown.style.display = (matches.length > 0 || trimQ) ? 'block' : 'none';
    };

    searchInput.addEventListener('input', () => {
      custIdInput.value = '';
      debtAmtEl.style.display = 'none';
      renderDropdown(searchInput.value);
    });
    searchInput.addEventListener('focus', () => renderDropdown(searchInput.value));
    document.addEventListener('click', (e) => {
      if (!searchWrap.contains(e.target)) dropdown.style.display = 'none';
    });

    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(dropdown);
    searchField.appendChild(searchWrap);
    searchField.appendChild(custIdInput);
    searchField.appendChild(debtAmtEl);
    frag.appendChild(searchField);

    // الشركة (اختياري)
    const compField = this._field('col-company', 'لصالح شركة (اختياري)');
    const compSelect = this._select('col-company', [{ value: '', label: '— اختر شركة —' }]);
    AppStore.getState('companies').forEach(c => {
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.name;
      compSelect.appendChild(o);
    });
    compField.appendChild(compSelect);
    frag.appendChild(compField);

    // زر الحفظ
    frag.appendChild(this._buildSaveBtn('col-save-btn', 'حفظ التحصيل', async () => {
      await this._saveCollection({
        payType    : typeSelect.value,
        bankId     : document.getElementById('col-bank-account')?.value || null,
        amount     : amtInput.value,
        customer   : searchInput.value.trim(),
        customerId : custIdInput.value || null,
        companyId  : compSelect.value || null,
      });
    }));

    return frag;
  },

  // ============================================================
  // 2. نموذج الإيداع (بدون حقل مساهمة الشركة)
  // ============================================================

  _buildDepositForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--accent);';
    title.innerHTML = '🏦 إيداع بنكي';
    frag.appendChild(title);

    // الحساب البنكي
    const bankField = this._field('dep-bank', 'الحساب البنكي', true);
    const bankSelect = this._select('dep-bank', [{ value: '', label: '— اختر الحساب البنكي —' }]);
    AppStore.getState('bankAccounts').forEach(b => {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = b.name;
      bankSelect.appendChild(o);
    });
    bankField.appendChild(bankSelect);
    bankField.appendChild(this._errMsg('dep-bank-err'));
    frag.appendChild(bankField);

    // مؤشر السقف (يظهر عند اختيار حساب)
    const ceilingInfo = document.createElement('div');
    ceilingInfo.id = 'dep-ceiling-info';
    ceilingInfo.style.cssText = 'margin:-8px 0 12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);font-size:0.82rem;display:none;';
    frag.appendChild(ceilingInfo);

    bankSelect.addEventListener('change', async () => {
      const bank = AppStore.getState('bankAccounts').find(b => b.id === bankSelect.value);
      if (!bank) { ceilingInfo.style.display = 'none'; return; }

      const total = await AccountingService.getDailyDepositsTotal(bank.id, getCurrentSaudiDate());
      const ceil  = parseFloat(bank.financial_ceiling) || 0;
      const pct   = Math.min(100, (total / ceil) * 100);
      const cls   = getProgressClass(pct);
      const rem   = Math.max(0, ceil - total);

      ceilingInfo.style.display = 'block';
      ceilingInfo.innerHTML = `
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
          <span style="color:var(--text-secondary);">إجمالي إيداعات اليوم</span>
          <span style="font-weight:600;">${formatCurrency(total)}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--text-muted);font-size:0.76rem;">
          <span>السقف: ${formatCurrency(ceil)}</span>
          <span style="color:${rem < ceil*0.1 ? 'var(--danger)' : 'var(--success)'};">متبقي: ${formatCurrency(rem)}</span>
        </div>`;
    });

    // المبلغ
    const amtField = this._field('dep-amount', 'المبلغ', true);
    const amtInput = this._input('dep-amount', 'number', '0.00', { min: '0.01', step: '0.01' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('dep-amount-err'));
    frag.appendChild(amtField);

    // ملاحظات
    const notesField = this._field('dep-notes', 'ملاحظات (اختياري)');
    const notesInput = document.createElement('textarea');
    notesInput.id = 'dep-notes';
    notesInput.className = 'form-control';
    notesInput.rows = 2;
    notesInput.placeholder = 'أي تفاصيل إضافية';
    notesField.appendChild(notesInput);
    frag.appendChild(notesField);

    // تنبيه القيد المزدوج
    const hint = document.createElement('div');
    hint.style.cssText = 'padding:10px 14px;border-radius:10px;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.15);font-size:0.78rem;color:var(--accent);margin-bottom:16px;line-height:1.6;';
    hint.textContent = 'ℹ️  سيتم تطبيق 3 قيود محاسبية تلقائياً: إيداع في البنك + تسوية حساب الشركة + براءة ذمة المندوب.';
    frag.appendChild(hint);

    frag.appendChild(this._buildSaveBtn('dep-save-btn', 'حفظ الإيداع', async () => {
      await this._saveDeposit({
        bankId : bankSelect.value,
        amount : amtInput.value,
        notes  : notesInput.value.trim(),
      });
    }));

    return frag;
  },

  // ============================================================
  // 3. نموذج المصروف
  // ============================================================

  _buildExpenseForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--danger);';
    title.innerHTML = '💸 مصروف';
    frag.appendChild(title);

    // نوع المصروف
    const typeField = this._field('exp-type', 'نوع المصروف', true);
    const typeSelect = this._select('exp-type', [{ value: '', label: '— اختر النوع —' }]);
    AppStore.getState('expenseAccounts').forEach(e => {
      const o = document.createElement('option');
      o.value = e.code;
      o.textContent = e.name;
      typeSelect.appendChild(o);
    });
    // خيار إضافة نوع جديد
    const newOpt = document.createElement('option');
    newOpt.value = '__new__';
    newOpt.textContent = '+ إضافة نوع جديد';
    typeSelect.appendChild(newOpt);
    typeField.appendChild(typeSelect);
    typeField.appendChild(this._errMsg('exp-type-err'));
    frag.appendChild(typeField);

    // حقل النوع الجديد (يظهر عند اختيار "إضافة نوع جديد")
    const newTypeWrap = document.createElement('div');
    newTypeWrap.style.display = 'none';
    const newTypeField = this._field('exp-new-type', 'اسم النوع الجديد');
    const newTypeInput = this._input('exp-new-type', 'text', 'مثال: غرامات');
    newTypeField.appendChild(newTypeInput);
    newTypeWrap.appendChild(newTypeField);
    frag.appendChild(newTypeWrap);

    typeSelect.addEventListener('change', () => {
      newTypeWrap.style.display = typeSelect.value === '__new__' ? 'block' : 'none';
    });

    // المبلغ
    const amtField = this._field('exp-amount', 'المبلغ', true);
    const amtInput = this._input('exp-amount', 'number', '0.00', { min: '0.01', step: '0.01' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('exp-amount-err'));
    frag.appendChild(amtField);

    // التفاصيل
    const detField = this._field('exp-details', 'التفاصيل (اختياري)');
    const detInput = document.createElement('textarea');
    detInput.id = 'exp-details';
    detInput.className = 'form-control';
    detInput.rows = 2;
    detInput.placeholder = 'وصف المصروف';
    detField.appendChild(detInput);
    frag.appendChild(detField);

    frag.appendChild(this._buildSaveBtn('exp-save-btn', 'حفظ المصروف', async () => {
      let expType = typeSelect.value;
      if (expType === '__new__') {
        const name = newTypeInput.value.trim();
        if (!name) { showToast('أدخل اسم النوع الجديد', 'warning'); return; }
        expType = 'EXP_' + name.toUpperCase().replace(/\s/g, '_');
        await repo.create(TABLES.EXPENSE_ACCOUNTS, { name, code: expType });
      }
      await this._saveExpense({
        expenseType: expType,
        amount     : amtInput.value,
        details    : detInput.value.trim(),
      });
    }));

    return frag;
  },

  // ============================================================
  // 4. نموذج الاستلام / التسليم — مع Autocomplete المستفيدين
  // ============================================================

  _buildTransferForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--info);';
    title.innerHTML = '🔄 استلام / تسليم';
    frag.appendChild(title);

    // نوع العملية
    const txTypeField = this._field('tr-type', 'نوع العملية', true);
    const txTypeSelect = this._select('tr-type', [
      { value: 'receipt',  label: 'استلام (أستلم من شخص آخر)' },
      { value: 'delivery', label: 'تسليم (أسلّم لشخص آخر)'  },
    ]);
    txTypeField.appendChild(txTypeSelect);
    frag.appendChild(txTypeField);

    // المصدر / الوجهة
    const srcField = this._field('tr-source-type', 'المصدر / الوجهة', true);
    const srcSelect = this._select('tr-source-type', [
      { value: 'agent',   label: 'مندوب' },
      { value: 'company', label: 'شركة'  },
    ]);
    srcField.appendChild(srcSelect);
    frag.appendChild(srcField);

    // ──────────────────────────────────────────────────────────
    // اختيار المندوب مع Autocomplete
    // ──────────────────────────────────────────────────────────
    const agentWrap = document.createElement('div');
    agentWrap.id = 'tr-agent-wrap';

    // المناديب من النظام
    const systemAgents = AppStore.getState('users')
      .filter(u => u.role === ROLES.AGENT && u.is_active && u.id !== AuthService.getCurrentUserId());

    // المستفيدون المحفوظون محلياً
    const BENEFICIARY_KEY = 'ahu_beneficiaries';
    const getBeneficiaries = () => {
      try { return JSON.parse(localStorage.getItem(BENEFICIARY_KEY) || '[]'); }
      catch { return []; }
    };
    const saveBeneficiary = (name, accountNum) => {
      const list = getBeneficiaries();
      const exists = list.findIndex(b => b.name === name);
      if (exists >= 0) {
        list[exists].accountNum = accountNum || list[exists].accountNum;
        list[exists].usedAt = Date.now();
      } else {
        list.push({ name, accountNum, usedAt: Date.now() });
      }
      // الاحتفاظ بآخر 50 مستفيد
      list.sort((a,b)=>b.usedAt-a.usedAt);
      localStorage.setItem(BENEFICIARY_KEY, JSON.stringify(list.slice(0,50)));
    };

    // حقل بحث المندوب
    const agentSearchWrap = document.createElement('div');
    agentSearchWrap.style.cssText = 'position:relative;margin-bottom:12px;';

    const agentSearchInput = document.createElement('input');
    agentSearchInput.id = 'tr-agent-search';
    agentSearchInput.type = 'text';
    agentSearchInput.className = 'form-control';
    agentSearchInput.placeholder = 'اسم المندوب / الجهة...';
    agentSearchInput.autocomplete = 'off';

    const agentAccountInput = document.createElement('input');
    agentAccountInput.type = 'text';
    agentAccountInput.className = 'form-control';
    agentAccountInput.id = 'tr-agent-account';
    agentAccountInput.placeholder = 'رقم الحساب (اختياري)';
    agentAccountInput.style.cssText = 'margin-top:8px;direction:ltr;';

    const agentIdHidden = document.createElement('input');
    agentIdHidden.type = 'hidden'; agentIdHidden.id = 'tr-agent-id';

    // زر تحديث بيانات المستفيد
    const updateBenefBtn = document.createElement('button');
    updateBenefBtn.type = 'button';
    updateBenefBtn.style.cssText = `
      display:none;margin-top:6px;font-size:0.78rem;
      background:rgba(2,132,199,0.10);border:1px solid rgba(2,132,199,0.25);
      border-radius:8px;padding:5px 10px;color:var(--info);cursor:pointer;
      transition:background var(--transition-fast);`;
    updateBenefBtn.textContent = '🔄 تحديث بيانات المستفيد';
    updateBenefBtn.addEventListener('click', () => {
      const name = agentSearchInput.value.trim();
      const acc  = agentAccountInput.value.trim();
      if (name) {
        saveBeneficiary(name, acc);
        showToast('تم تحديث بيانات المستفيد', 'success');
        updateBenefBtn.style.display = 'none';
      }
    });

    const agentDropdown = document.createElement('div');
    agentDropdown.style.cssText = `
      position:absolute;top:100%;right:0;left:0;z-index:500;
      background:var(--glass-bg-heavy);
      border:1px solid var(--border-color);border-radius:12px;
      box-shadow:var(--shadow-lg);max-height:240px;overflow-y:auto;
      display:none;backdrop-filter:blur(16px);margin-top:4px;`;

    const renderAgentDropdown = (q) => {
      const trimQ = q.trim().toLowerCase();
      agentDropdown.innerHTML = '';

      // أولاً: المناديب من النظام
      const sysMatches = trimQ
        ? systemAgents.filter(a => a.display_name.toLowerCase().includes(trimQ))
        : systemAgents;

      sysMatches.forEach(a => {
        const item = document.createElement('div');
        item.style.cssText = `padding:10px 14px;cursor:pointer;
          display:flex;justify-content:space-between;align-items:center;
          border-bottom:1px solid var(--border-color);
          transition:background var(--transition-fast);`;
        item.innerHTML = `
          <div>
            <span style="font-weight:600;font-size:0.88rem;">${escapeHtml(a.display_name)}</span>
            <span style="display:block;font-size:0.72rem;color:var(--text-muted);">مندوب في النظام</span>
          </div>
          <span style="font-size:0.72rem;background:var(--accent);color:#fff;
            border-radius:6px;padding:2px 6px;">موثّق</span>`;
        item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-hover)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          agentSearchInput.value = a.display_name;
          agentIdHidden.value    = a.id;
          agentDropdown.style.display = 'none';
          updateBenefBtn.style.display = 'none';
        });
        agentDropdown.appendChild(item);
      });

      // ثانياً: المستفيدون المحفوظون محلياً
      const localBenefs = getBeneficiaries();
      const localMatches = trimQ
        ? localBenefs.filter(b => b.name.toLowerCase().includes(trimQ))
        : localBenefs.slice(0, 6);

      localMatches.forEach(b => {
        const item = document.createElement('div');
        item.style.cssText = `padding:10px 14px;cursor:pointer;
          display:flex;justify-content:space-between;align-items:center;
          border-bottom:1px solid var(--border-color);
          transition:background var(--transition-fast);`;
        item.innerHTML = `
          <div>
            <span style="font-weight:600;font-size:0.88rem;">${escapeHtml(b.name)}</span>
            ${b.accountNum ? `<span style="display:block;font-size:0.72rem;color:var(--text-muted);direction:ltr;">${escapeHtml(b.accountNum)}</span>` : ''}
          </div>
          <span style="font-size:0.72rem;color:var(--text-muted);">محفوظ</span>`;
        item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-hover)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('mousedown', (e) => {
          e.preventDefault();
          agentSearchInput.value  = b.name;
          agentAccountInput.value = b.accountNum || '';
          agentIdHidden.value     = '';
          agentDropdown.style.display = 'none';
          updateBenefBtn.style.display = 'inline-block';
        });
        agentDropdown.appendChild(item);
      });

      agentDropdown.style.display =
        (sysMatches.length > 0 || localMatches.length > 0) ? 'block' : 'none';
    };

    agentSearchInput.addEventListener('input', () => {
      agentIdHidden.value = '';
      renderAgentDropdown(agentSearchInput.value);
      updateBenefBtn.style.display = agentSearchInput.value.trim() ? 'inline-block' : 'none';
    });
    agentSearchInput.addEventListener('focus', () => renderAgentDropdown(agentSearchInput.value));
    document.addEventListener('click', (e) => {
      if (!agentSearchWrap.contains(e.target)) agentDropdown.style.display = 'none';
    });

    // حفظ المستفيد عند الكتابة المباشرة (بدون اختيار)
    agentSearchInput.addEventListener('blur', () => {
      const name = agentSearchInput.value.trim();
      const acc  = agentAccountInput.value.trim();
      if (name && !agentIdHidden.value) {
        saveBeneficiary(name, acc);
      }
    });

    agentSearchWrap.appendChild(agentSearchInput);
    agentSearchWrap.appendChild(agentDropdown);
    agentSearchWrap.appendChild(agentIdHidden);

    const agentLabel = document.createElement('label');
    agentLabel.className = 'form-label';
    agentLabel.textContent = 'المندوب / الجهة';
    agentWrap.appendChild(agentLabel);
    agentWrap.appendChild(agentSearchWrap);
    agentWrap.appendChild(agentAccountInput);
    agentWrap.appendChild(updateBenefBtn);
    frag.appendChild(agentWrap);

    // اختيار الشركة
    const compWrap = document.createElement('div');
    compWrap.id = 'tr-company-wrap';
    compWrap.style.display = 'none';
    const compField = this._field('tr-company', 'اختر الشركة', true);
    const compSelect = this._select('tr-company', [{ value: '', label: '— اختر شركة —' }]);
    AppStore.getState('companies').forEach(c => {
      const o = document.createElement('option'); o.value = c.id; o.textContent = c.name;
      compSelect.appendChild(o);
    });
    compField.appendChild(compSelect);
    compWrap.appendChild(compField);
    frag.appendChild(compWrap);

    srcSelect.addEventListener('change', () => {
      agentWrap.style.display  = srcSelect.value === 'agent'   ? 'block' : 'none';
      compWrap.style.display   = srcSelect.value === 'company' ? 'block' : 'none';
    });

    // المبلغ
    const amtField = this._field('tr-amount', 'المبلغ', true);
    const amtInput = this._input('tr-amount', 'number', '0', { min: '1', step: '1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('tr-amount-err'));
    frag.appendChild(amtField);

    frag.appendChild(this._buildSaveBtn('tr-save-btn', 'حفظ العملية', async () => {
      const txType    = txTypeSelect.value;
      const srcType   = srcSelect.value;
      const agentId   = srcType === 'agent' ? (agentIdHidden.value || null) : null;
      const compId    = srcType === 'company' ? compSelect.value : null;

      // حفظ المستفيد محلياً
      if (srcType === 'agent' && agentSearchInput.value.trim() && !agentIdHidden.value) {
        const BENEFICIARY_KEY = 'ahu_beneficiaries';
        const getBeneficiaries = () => {
          try { return JSON.parse(localStorage.getItem(BENEFICIARY_KEY) || '[]'); } catch { return []; }
        };
        const list = getBeneficiaries();
        const name = agentSearchInput.value.trim();
        const acc  = agentAccountInput.value.trim();
        if (!list.find(b => b.name === name)) {
          list.unshift({ name, accountNum: acc, usedAt: Date.now() });
          localStorage.setItem(BENEFICIARY_KEY, JSON.stringify(list.slice(0,50)));
        }
      }

      await this._saveTransfer({
        txType,
        fromAgentId  : txType === 'receipt'  ? agentId : null,
        toAgentId    : txType === 'delivery'  ? agentId : null,
        companyId    : compId,
        amount       : amtInput.value,
        beneficiaryName: agentSearchInput.value.trim() || null,
      });
    }));

    return frag;
  },

  // ============================================================
  // زر الحفظ المشترك
  // ============================================================

  _buildSaveBtn(id, label, handler) {
    const btn = document.createElement('button');
    btn.id = id;
    btn.className = 'btn btn-primary btn-full btn-lg';
    btn.textContent = label;
    btn.addEventListener('click', handler);
    return btn;
  },

  // ============================================================
  // معالجات الحفظ
  // ============================================================

  async _saveCollection({ payType, bankId, amount, customer, customerId, companyId }) {
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }
    const rounded = roundAmount(amount); // تقريب لعدد صحيح
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('col-save-btn');
    const restore = setButtonLoading(btn);

    const txData = {
      type           : TRANSACTION_TYPES.COLLECTION,
      amount         : rounded,
      date           : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id       : agentId,
      company_id     : companyId || null,
      customer_name  : customer || null,
      customer_id    : customerId || null,
      bank_account_id: payType === 'card' ? (bankId || null) : null,
    };

    const result = await AccountingService.createTransactionWithEntries(txData);
    restore();

    if (isOk(result)) {
      showToast('✅ تم حفظ التحصيل', 'success');
      this._resetForm('col');
      await this._showShareModal({
        type: 'تحصيل', amount: rounded, customer,
        agentId, date: txData.date,
      });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveDeposit({ bankId, amount, notes }) {
    if (!bankId) { showToast('اختر الحساب البنكي', 'error'); return; }
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }
    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const bank    = AppStore.getState('bankAccounts').find(b => b.id === bankId);

    if (bank) {
      const prevTotal = await AccountingService.getDailyDepositsTotal(bankId, getCurrentSaudiDate());
      const ceil      = Math.round(bank.financial_ceiling || 0);
      if (prevTotal + rounded > ceil) {
        const confirmed = await confirmDialog(
          `⚠️ تجاوز السقف!\nإجمالي الإيداعات بعد العملية: ${(prevTotal+rounded).toLocaleString('en-US')} ر.س\nالسقف اليومي: ${ceil.toLocaleString('en-US')} ر.س\nهل تريد المتابعة رغم ذلك؟`,
          'متابعة', 'إلغاء', 'warning'
        );
        if (!confirmed) return;
      }
    }

    const btn     = document.getElementById('dep-save-btn');
    const restore = setButtonLoading(btn);

    const txData = {
      type            : TRANSACTION_TYPES.DEPOSIT,
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
      const ceil      = Math.round(bank?.financial_ceiling||0);
      const prevTotal = await AccountingService.getDailyDepositsTotal(bankId, getCurrentSaudiDate());
      await this._showShareModal({
        type: 'إيداع', amount: rounded, bankName: bank?.name,
        agentId, date: txData.date,
        ceilingRemain: Math.max(0, ceil - prevTotal),
      });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveExpense({ expenseType, amount, details }) {
    if (!expenseType || expenseType === '') { showToast('اختر نوع المصروف', 'error'); return; }
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }
    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('exp-save-btn');
    const restore = setButtonLoading(btn);

    const txData = {
      type         : TRANSACTION_TYPES.EXPENSE,
      amount       : rounded,
      date         : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id     : agentId,
      expense_type : expenseType,
      details      : details || null,
    };

    const result = await AccountingService.createTransactionWithEntries(txData);
    restore();

    if (isOk(result)) {
      showToast('✅ تم حفظ المصروف', 'success');
      this._resetForm('exp');
      await this._showShareModal({ type:'مصروف', amount:rounded, agentId, date:txData.date, details });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveTransfer({ txType, fromAgentId, toAgentId, companyId, amount }) {
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }
    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('tr-save-btn');
    const restore = setButtonLoading(btn);

    const txData = {
      type          : txType,
      amount        : rounded,
      date          : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id      : agentId,
      from_agent_id : fromAgentId || null,
      to_agent_id   : toAgentId   || null,
      company_id    : companyId   || null,
    };

    const result = await AccountingService.createTransactionWithEntries(txData);
    restore();

    if (isOk(result)) {
      showToast('✅ تم حفظ العملية', 'success');
      this._resetForm('tr');
      await this._showShareModal({ type: TRANSACTION_TYPE_LABELS[txType]||txType, amount:rounded, agentId, date:txData.date });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  // ─────────────────────────────────────────────
  // نظام المشاركة بعد حفظ العملية
  // ─────────────────────────────────────────────
  async _showShareModal({ type, amount, agentId, date, customer, bankName, ceilingRemain, details }) {
    /* جلب رصيد المندوب المتبقي */
    const balance = await AccountingService.getAccountBalance(`AGT_${agentId}`);
    const balVal  = isOk(balance) ? balance.data : 0;
    const users   = AppStore.getState('users');
    const agent   = users.find(u=>u.id===agentId);

    const lines = [
      `✅ *${escapeHtml(type)}*`,
      `💰 المبلغ: *${amount.toLocaleString('en-US')} ر.س*`,
      `📅 ${escapeHtml(formatDateArabic(date))}`,
    ];
    if (customer) lines.push(`👤 العميل: ${escapeHtml(customer)}`);
    if (bankName) lines.push(`🏦 الحساب: ${escapeHtml(bankName)}`);
    if (details)  lines.push(`📝 ${escapeHtml(details)}`);
    lines.push(`─────────────────`);
    lines.push(`📊 رصيد الصندوق المتبقي: *${Math.abs(Math.round(balVal)).toLocaleString('en-US')} ر.س${Math.round(balVal)<0?' (مدين)':''}*`);
    if (ceilingRemain !== undefined) {
      lines.push(`🔹 المتبقي من السقف البنكي: *${ceilingRemain.toLocaleString('en-US')} ر.س*`);
    }
    lines.push(`─────────────────`);
    lines.push(`نظام أبو حذيفة 🔐`);

    const text = lines.join('\n');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:1200;';
    overlay.addEventListener('click', e=>{ if(e.target===overlay) document.body.removeChild(overlay); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '420px';
    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">📤 مشاركة ملخص العملية</h3>
        <button class="modal-close" id="share-close-btn">✕</button>
      </div>
      <div style="
        background:var(--bg-hover);border-radius:12px;padding:14px;
        font-size:0.85rem;line-height:1.9;white-space:pre-wrap;
        direction:rtl;margin-bottom:14px;border:1px solid var(--border-color);
        max-height:280px;overflow-y:auto;font-family:inherit;">
        ${escapeHtml(text)}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <button id="share-copy-btn" class="btn btn-primary"
          style="display:flex;align-items:center;justify-content:center;gap:6px;">
          <i data-lucide="copy" style="width:14px;height:14px;"></i> نسخ التقرير
        </button>
        <button id="share-whatsapp-btn" class="btn btn-secondary"
          style="display:flex;align-items:center;justify-content:center;gap:6px;
                 background:rgba(37,211,102,0.15);border-color:rgba(37,211,102,0.3);color:#25d366;">
          <span>📱</span> واتساب
        </button>
      </div>
      <button id="share-dismiss-btn" class="btn btn-secondary"
        style="width:100%;margin-top:8px;font-size:0.82rem;color:var(--text-muted);">
        إغلاق بدون مشاركة
      </button>`;

    document.body.appendChild(overlay);
    overlay.appendChild(box);

    box.querySelector('#share-close-btn').addEventListener('click',   ()=>document.body.removeChild(overlay));
    box.querySelector('#share-dismiss-btn').addEventListener('click', ()=>document.body.removeChild(overlay));
    box.querySelector('#share-copy-btn').addEventListener('click', async ()=>{
      await copyToClipboard(text, 'تم نسخ الملخص — الصقه في واتساب أو البريد');
    });
    box.querySelector('#share-whatsapp-btn').addEventListener('click', ()=>{
      window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
    });

    if (window.lucide) lucide.createIcons();
  },

  // ============================================================
  // إعادة تعيين النموذج
  // ============================================================

  _resetForm(prefix) {
    const selectors = `#${prefix}-amount, #${prefix}-notes, #${prefix}-details,
      #${prefix}-customer, #${prefix}-new-type`;
    document.querySelectorAll(selectors).forEach(el => { el.value = ''; });
    // إعادة اختيار القوائم لأول خيار
    document.querySelectorAll(`select[id^="${prefix}-"]`).forEach(s => { s.selectedIndex = 0; });
    // إخفاء الحقول الديناميكية
    ['col-bank-wrap','dep-ceiling-info','tr-agent-wrap','tr-company-wrap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = id === 'tr-agent-wrap' ? 'block' : 'none';
    });
  },
};

window.DataEntryComponent = DataEntryComponent;
console.log('✅ DataEntryComponent.js محمّل');
