/**
 * components/DataEntryComponent.js — v5.0 (BEHAVIOR FIXED)
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * التغييرات الجوهرية (السلوك الثاني):
 * ─────────────────────────────────────────────────────────
 * ✅ 1. التحصيل من شركة: استبدال القائمة المنسدلة بحقل بحث
 *      عن رقم حساب الشركة (companies.account_number) مع حفظ كمستفيد.
 *
 * ✅ 2. الإيداع البنكي: استبدال القائمة المنسدلة بحقل بحث
 *      عن رقم الحساب البنكي الفعلي (bank_accounts.account_number)
 *      مع حفظ كمستفيد.
 *
 * ✅ 3. السحب البنكي: نفس تعديل الإيداع البنكي.
 *
 * ✅ 4. المصروفات: تثبيت حساب مصروف واحد (EXP_GENERAL) وإزالة
 *      القائمة المنسدلة لأنواع المصروفات، مع تضمين نوع المصروف
 *      في وصف القيد فقط.
 * ─────────────────────────────────────────────────────────
 */
'use strict';

const DataEntryComponent = {
  _activeForm  : 'collection',
  _container   : null,
  _sortedBanks : [],
  _beneficiariesCache: [], // مستفيدو الإيداع/السحب (حسابات بنكية)
  _companyBeneficiaries: [], // مستفيدو التحصيل من شركة

  async render(container) {
    this._container = container;
    container.innerHTML = `<div style="padding:20px;">
      <div class="skeleton skeleton-card" style="height:48px;margin-bottom:16px;"></div>
      ${renderSkeleton('card', 1)}
      ${renderSkeleton('row', 4)}
    </div>`;
    await this._prepareSortedBanks();
    await this._loadBeneficiaries();
    container.innerHTML = '';
    container.appendChild(await this._buildPage());
  },

  // جلب المستفيدين المحفوظين (بنوك وشركات) من Supabase
  async _loadBeneficiaries() {
    try {
      const userId = AuthService.getCurrentUserId();
      if (!userId) return;
      const result = await repo.query(TABLES.USER_BENEFICIARIES, { user_id: userId });
      if (isOk(result)) {
        const all = result.data.data || [];
        this._beneficiariesCache     = all.filter(b => b.beneficiary_type === 'bank');
        this._companyBeneficiaries   = all.filter(b => b.beneficiary_type === 'company');
        // ترحيل: نقل الشركات المحفوظة في localStorage إلى Supabase
        this._migrateLocalStorageBeneficiaries(userId, all);
      }
    } catch (e) {
      console.warn('⚠️ DataEntry: فشل تحميل المستفيدين:', e.message);
      this._beneficiariesCache     = [];
      this._companyBeneficiaries   = [];
    }
  },

  // ترحيل بيانات المستفيدين من localStorage إلى Supabase (يُشغَّل مرة واحدة)
  _migrateLocalStorageBeneficiaries(userId, existingInDB) {
    const legacyKey = `company_beneficiaries_${userId}`;
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return;
    try {
      const legacy = JSON.parse(raw);
      legacy.forEach(b => {
        const alreadySaved = existingInDB.some(
          e => e.beneficiary_id === b.id && e.beneficiary_type === 'company'
        );
        if (!alreadySaved && b.id) {
          repo.create(TABLES.USER_BENEFICIARIES, {
            user_id          : userId,
            beneficiary_id   : b.id,
            beneficiary_type : 'company',
            beneficiary_name : b.name,
            beneficiary_account: b.account_number,
          }).catch(e => console.warn('⚠️ ترحيل مستفيد شركة:', e.message));
        }
      });
      localStorage.removeItem(legacyKey);
    } catch (e) { console.warn('⚠️ _migrateLocalStorageBeneficiaries:', e.message); }
  },

  // حفظ مستفيد عام (بنك أو شركة) في Supabase
  async _saveBeneficiary(referenceId, displayName, accountNumber, type) {
    const userId = AuthService.getCurrentUserId();
    if (!userId || !referenceId) return;
    const cache = type === 'bank' ? this._beneficiariesCache : this._companyBeneficiaries;
    const exists = cache.some(b => b.beneficiary_id === referenceId);
    if (exists) return;
    try {
      await repo.create(TABLES.USER_BENEFICIARIES, {
        user_id          : userId,
        beneficiary_id   : referenceId,
        beneficiary_type : type,
        beneficiary_name : displayName,
        beneficiary_account: accountNumber,
      });
      await this._loadBeneficiaries();
    } catch (e) { console.warn(`⚠️ _saveBeneficiary(${type}):`, e.message); }
  },

  // دوال مساعدة للتوافق مع الكود القديم
  async _saveCompanyBeneficiary(companyId, companyName, accountNumber) {
    await this._saveBeneficiary(companyId, companyName, accountNumber, 'company');
  },

  async _saveBankBeneficiary(bankId, bankName, accountNumber) {
    await this._saveBeneficiary(bankId, bankName, accountNumber, 'bank');
  },

  /* ── جلب البنوك وترتيبها ── */
  async _prepareSortedBanks() {
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    let allBanks  = [];
    try {
      if (isOnline()) {
        const { data } = await supabaseClient
          .from('bank_accounts')
          .select('id,name,financial_ceiling,company_id,reset_time,account_number,internal_account_number')
          .order('name');
        allBanks = data || [];
      } else {
        allBanks = await db.bank_accounts.toArray();
      }
    } catch (e) {
      console.warn('⚠️ DataEntry: فشل جلب البنوك:', e.message);
      allBanks = AppStore.getState('bankAccounts') || [];
    }
    if (!allBanks.length) allBanks = AppStore.getState('bankAccounts') || [];

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
    } catch (e) { console.warn('⚠️ DataEntry: فشل تحميل آخر نشاط:', e.message); }

    this._sortedBanks = [...allBanks].sort((a, b) => {
      const favs = this._getFavoriteBanks();
      const aFav = favs.includes(a.id) ? 1 : 0;
      const bFav = favs.includes(b.id) ? 1 : 0;
      if (bFav !== aFav) return bFav - aFav;
      const aT = lastActivityMap[a.id] || '';
      const bT = lastActivityMap[b.id] || '';
      if (aT && bT) return bT.localeCompare(aT);
      if (aT) return -1;
      if (bT) return  1;
      return (a.name || '').localeCompare(b.name || '');
    });
  },

  _favKey() {
    return `favBanks_${AuthService.getCurrentUserId() || 'anon'}`;
  },
  _getFavoriteBanks() {
    try { return JSON.parse(localStorage.getItem(this._favKey()) || '[]'); } catch { return []; }
  },
  _toggleFavoriteBank(bankId) {
    const favs = this._getFavoriteBanks();
    const idx  = favs.indexOf(bankId);
    if (idx === -1) favs.push(bankId); else favs.splice(idx, 1);
    localStorage.setItem(this._favKey(), JSON.stringify(favs));
    return favs.includes(bankId);
  },

  async _buildPage() {
    const wrap = document.createElement('div');

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px;';

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);';
    title.textContent = 'إدخال البيانات';
    header.appendChild(title);

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

    const selfOpt = document.createElement('option');
    selfOpt.value = '';
    selfOpt.textContent = `👤 ${currentUser?.display_name || 'نفسي'} (أنا)`;
    select.appendChild(selfOpt);

    const allUsers = AppStore.getState('users').filter(u =>
      u.is_active && u.id !== currentUser?.id
    );

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
      { id:'collection',      label:'تحصيل',       icon:'💰' },
      { id:'deposit',         label:'إيداع بنكي',   icon:'🏦' },
      { id:'bank_withdrawal', label:'سحب بنكي',     icon:'💳' },
      { id:'expense',         label:'مصروف',        icon:'💸' },
      { id:'transfer', label:'تحويل / طلب أموال', icon:'🔄'},
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
      case 'collection':      card.appendChild(this._buildCollectionForm());     break;
      case 'deposit':         card.appendChild(this._buildDepositForm());        break;
      case 'bank_withdrawal': card.appendChild(this._buildBankWithdrawalForm()); break;
      case 'expense':         card.appendChild(this._buildExpenseForm());        break;
      case 'transfer':        card.appendChild(this._buildTransferForm());       break;
    }
    container.appendChild(card);
  },

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

  // ✅ مكون بحث رقم الحساب البنكي (للإيداع/السحب)
  _buildBankAccountSearch(fieldId, placeholder, onSelect) {
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';

    const input = document.createElement('input');
    input.id = fieldId;
    input.type = 'text';
    input.className = 'form-control';
    input.placeholder = placeholder;
    input.autocomplete = 'off';

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position:absolute;top:100%;right:0;left:0;z-index:500;
      background:var(--glass-bg-heavy);border:1px solid var(--border-color);
      border-radius:12px;box-shadow:var(--shadow-lg);
      max-height:240px;overflow-y:auto;display:none;
      backdrop-filter:blur(16px);margin-top:4px;`;

    const hiddenId = document.createElement('input');
    hiddenId.type = 'hidden';
    hiddenId.id = `${fieldId}-id`;

    const resultDisplay = document.createElement('div');
    resultDisplay.id = `${fieldId}-result`;
    resultDisplay.style.cssText = 'display:none;margin-top:6px;padding:8px 12px;border-radius:8px;font-size:0.82rem;';

    let allBanks = this._sortedBanks;

    const renderDropdown = (query) => {
      const q = query.trim().toLowerCase();
      dropdown.innerHTML = '';
      
      let matches = [];
      if (q) {
        matches = allBanks.filter(b =>
          b.name?.toLowerCase().includes(q) ||
          b.account_number?.toLowerCase().includes(q) ||
          b.internal_account_number?.toLowerCase().includes(q)
        );
      } else {
        matches = allBanks.slice(0, 10);
      }

      if (matches.length === 0 && q) {
        const noResult = document.createElement('div');
        noResult.style.cssText = 'padding:10px 14px;color:var(--text-muted);font-size:0.82rem;';
        noResult.textContent = 'لا توجد نتائج';
        dropdown.appendChild(noResult);
      }

      matches.forEach(bank => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-color);transition:background 150ms;';
        item.innerHTML = `
          <div style="font-weight:600;font-size:0.85rem;">${escapeHtml(bank.name)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);direction:ltr;">${escapeHtml(bank.internal_account_number || bank.account_number || 'لا يوجد رقم')}</div>
        `;
        item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-hover)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('click', () => {
          input.value = bank.name;
          hiddenId.value = bank.id;
          resultDisplay.style.display = '';
          resultDisplay.style.background = 'rgba(99,102,241,0.08)';
          resultDisplay.innerHTML = `🏦 ${escapeHtml(bank.name)}<br><span style="font-size:0.7rem;color:var(--text-muted);">الرقم الداخلي: ${escapeHtml(bank.internal_account_number || bank.account_number || '—')}</span>`;
          dropdown.style.display = 'none';
          if (onSelect) onSelect(bank);
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = matches.length ? '' : 'none';
    };

    input.addEventListener('input', () => {
      hiddenId.value = '';
      resultDisplay.style.display = 'none';
      renderDropdown(input.value);
    });
    input.addEventListener('focus', () => renderDropdown(input.value));
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) dropdown.style.display = 'none'; });

    wrap.appendChild(input);
    wrap.appendChild(dropdown);
    wrap.appendChild(hiddenId);
    wrap.appendChild(resultDisplay);
    return wrap;
  },

  // ✅ مكون بحث رقم حساب الشركة (للتحصيل)
  _buildCompanySearch(onSelect) {
    const wrap = document.createElement('div');
    wrap.style.position = 'relative';

    const input = document.createElement('input');
    input.id = 'col-company-search';
    input.type = 'text';
    input.className = 'form-control';
    input.placeholder = 'ابحث برقم حساب الشركة أو الاسم';
    input.autocomplete = 'off';

    const dropdown = document.createElement('div');
    dropdown.style.cssText = `
      position:absolute;top:100%;right:0;left:0;z-index:500;
      background:var(--glass-bg-heavy);border:1px solid var(--border-color);
      border-radius:12px;box-shadow:var(--shadow-lg);
      max-height:240px;overflow-y:auto;display:none;
      backdrop-filter:blur(16px);margin-top:4px;`;

    const hiddenId = document.createElement('input');
    hiddenId.type = 'hidden';
    hiddenId.id = 'col-company-id';

    const resultDisplay = document.createElement('div');
    resultDisplay.id = 'col-company-result';
    resultDisplay.style.cssText = 'display:none;margin-top:6px;padding:8px 12px;border-radius:8px;font-size:0.82rem;';

    const companies = AppStore.getState('companies') || [];

    const renderDropdown = (query) => {
      const q = query.trim().toLowerCase();
      dropdown.innerHTML = '';
      
      let matches = [];
      if (q) {
        matches = companies.filter(c => 
          c.name?.toLowerCase().includes(q) || 
          c.account_number?.toLowerCase().includes(q)
        );
      } else {
        matches = companies.slice(0, 10);
      }

      if (matches.length === 0 && q) {
        const noResult = document.createElement('div');
        noResult.style.cssText = 'padding:10px 14px;color:var(--text-muted);font-size:0.82rem;';
        noResult.textContent = 'لا توجد شركات تطابق البحث';
        dropdown.appendChild(noResult);
      }

      matches.forEach(company => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 14px;cursor:pointer;border-bottom:1px solid var(--border-color);transition:background 150ms;';
        item.innerHTML = `
          <div style="font-weight:600;font-size:0.85rem;">${escapeHtml(company.name)}</div>
          <div style="font-size:0.72rem;color:var(--text-muted);direction:ltr;">رقم الحساب: ${escapeHtml(company.account_number || '—')}</div>
        `;
        item.addEventListener('mouseenter', () => item.style.background = 'var(--bg-hover)');
        item.addEventListener('mouseleave', () => item.style.background = '');
        item.addEventListener('click', () => {
          input.value = company.name;
          hiddenId.value = company.id;
          resultDisplay.style.display = '';
          resultDisplay.style.background = 'rgba(99,102,241,0.08)';
          resultDisplay.innerHTML = `🏢 ${escapeHtml(company.name)}<br><span style="font-size:0.7rem;color:var(--text-muted);">رقم الحساب: ${escapeHtml(company.account_number || '—')}</span>`;
          dropdown.style.display = 'none';
          if (onSelect) onSelect(company);
        });
        dropdown.appendChild(item);
      });
      dropdown.style.display = matches.length ? '' : 'none';
    };

    input.addEventListener('input', () => {
      hiddenId.value = '';
      resultDisplay.style.display = 'none';
      renderDropdown(input.value);
    });
    input.addEventListener('focus', () => renderDropdown(input.value));
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) dropdown.style.display = 'none'; });

    wrap.appendChild(input);
    wrap.appendChild(dropdown);
    wrap.appendChild(hiddenId);
    wrap.appendChild(resultDisplay);
    return wrap;
  },

  // ✅ قائمة المستفيدين من الشركات
  _buildCompanyBeneficiariesList(onSelect) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '12px';
    
    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;';
    label.textContent = 'الشركات المحفوظة:';
    wrap.appendChild(label);
    
    const listDiv = document.createElement('div');
    listDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    
    const refreshList = () => {
      listDiv.innerHTML = '';
      if (this._companyBeneficiaries.length === 0) {
        listDiv.innerHTML = '<span style="font-size:0.72rem;color:var(--text-muted);">لا توجد شركات محفوظة</span>';
        return;
      }
      this._companyBeneficiaries.forEach(b => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'btn btn-secondary btn-sm';
        chip.style.cssText = 'font-size:0.72rem;padding:4px 10px;border-radius:20px;';
        chip.textContent = b.name;
        chip.addEventListener('click', () => {
          const company = AppStore.getState('companies').find(c => c.id === b.id);
          if (company) onSelect(company);
        });
        listDiv.appendChild(chip);
      });
    };
    
    refreshList();
    wrap.appendChild(listDiv);
    return wrap;
  },

  // ✅ قائمة المستفيدين من البنوك (للإيداع/السحب)
  _buildBankBeneficiariesList(onSelect) {
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '12px';
    
    const label = document.createElement('div');
    label.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;';
    label.textContent = 'الحسابات البنكية المحفوظة:';
    wrap.appendChild(label);
    
    const listDiv = document.createElement('div');
    listDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    
    const refreshList = () => {
      listDiv.innerHTML = '';
      if (this._beneficiariesCache.length === 0 && this._sortedBanks.length === 0) {
        listDiv.innerHTML = '<span style="font-size:0.72rem;color:var(--text-muted);">لا توجد حسابات بنكية محفوظة</span>';
        return;
      }
      // عرض جميع البنوك المتاحة (وليس فقط المحفوظة)
      this._sortedBanks.slice(0, 8).forEach(bank => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'btn btn-secondary btn-sm';
        chip.style.cssText = 'font-size:0.72rem;padding:4px 10px;border-radius:20px;';
        chip.textContent = bank.name.length > 20 ? bank.name.slice(0, 18) + '…' : bank.name;
        chip.title = bank.account_number || '';
        chip.addEventListener('click', () => onSelect(bank));
        listDiv.appendChild(chip);
      });
    };
    
    refreshList();
    wrap.appendChild(listDiv);
    return wrap;
  },

  // ═══════════════════════════════════════════════════════════
  // 1. نموذج التحصيل (معدل: دعم البحث برقم حساب الشركة)
  // ═══════════════════════════════════════════════════════════
  _buildCollectionForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:16px;color:var(--success);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>💰</span><span>تحصيل نقدي</span>';
    frag.appendChild(title);

    const toggleWrap = document.createElement('div');
    toggleWrap.style.cssText = 'display:flex;gap:6px;margin-bottom:18px;padding:5px;background:var(--bg-input);border-radius:14px;';

    let colMode = 'customer';

    const customerSection = document.createElement('div');
    const companySection  = document.createElement('div');

    const btnCust = document.createElement('button');
    btnCust.type = 'button'; btnCust.textContent = '👤 عميل مدين';
    btnCust.style.cssText = 'flex:1;padding:8px;border:none;border-radius:10px;font-family:inherit;font-size:0.88rem;font-weight:600;cursor:pointer;transition:all 0.18s;';

    const btnComp = document.createElement('button');
    btnComp.type = 'button'; btnComp.textContent = '🏢 شركة';
    btnComp.style.cssText = 'flex:1;padding:8px;border:none;border-radius:10px;font-family:inherit;font-size:0.88rem;font-weight:600;cursor:pointer;transition:all 0.18s;';

    const refreshToggle = () => {
      btnCust.style.background = colMode === 'customer' ? 'var(--accent)' : 'transparent';
      btnCust.style.color      = colMode === 'customer' ? '#fff' : 'var(--text-secondary)';
      btnComp.style.background = colMode === 'company'  ? 'var(--accent)' : 'transparent';
      btnComp.style.color      = colMode === 'company'  ? '#fff' : 'var(--text-secondary)';
      customerSection.style.display = colMode === 'customer' ? '' : 'none';
      companySection.style.display  = colMode === 'company'  ? '' : 'none';
    };

    btnCust.addEventListener('click', () => { colMode = 'customer'; refreshToggle(); });
    btnComp.addEventListener('click', () => { colMode = 'company';  refreshToggle(); });
    toggleWrap.appendChild(btnCust);
    toggleWrap.appendChild(btnComp);
    frag.appendChild(toggleWrap);

    // قسم العميل المدين (يبقى كما هو)
    customerSection.appendChild(this._buildCustomerSearch());
    frag.appendChild(customerSection);

    // ✅ قسم الشركة (جديد: بحث برقم الحساب + مستفيدين)
    const compField = this._field('col-company-search-label', 'البحث عن شركة', true);
    const companySearch = this._buildCompanySearch((company) => {
      const hiddenId = document.getElementById('col-company-id');
      if (hiddenId) hiddenId.value = company.id;
    });
    compField.appendChild(companySearch);
    compField.appendChild(this._errMsg('col-company-err'));
    companySection.appendChild(compField);

    // قائمة المستفيدين من الشركات
    const beneficiariesList = this._buildCompanyBeneficiariesList((company) => {
      const searchInput = document.getElementById('col-company-search');
      const hiddenId = document.getElementById('col-company-id');
      const resultDisplay = document.getElementById('col-company-result');
      if (searchInput) searchInput.value = company.name;
      if (hiddenId) hiddenId.value = company.id;
      if (resultDisplay) {
        resultDisplay.style.display = '';
        resultDisplay.style.background = 'rgba(99,102,241,0.08)';
        resultDisplay.innerHTML = `🏢 ${escapeHtml(company.name)}<br><span style="font-size:0.7rem;color:var(--text-muted);">رقم الحساب: ${escapeHtml(company.account_number || '—')}</span>`;
      }
    });
    companySection.appendChild(beneficiariesList);

    // حفظ كمستفيد
    const saveBeneficiaryWrap = document.createElement('div');
    saveBeneficiaryWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 12px;';
    const saveBeneficiaryCheck = document.createElement('input');
    saveBeneficiaryCheck.type = 'checkbox';
    saveBeneficiaryCheck.id = 'col-save-beneficiary';
    saveBeneficiaryCheck.style.margin = '0';
    const saveBeneficiaryLabel = document.createElement('label');
    saveBeneficiaryLabel.htmlFor = 'col-save-beneficiary';
    saveBeneficiaryLabel.textContent = 'حفظ هذه الشركة في قائمة المستفيدين';
    saveBeneficiaryLabel.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);';
    saveBeneficiaryWrap.appendChild(saveBeneficiaryCheck);
    saveBeneficiaryWrap.appendChild(saveBeneficiaryLabel);
    companySection.appendChild(saveBeneficiaryWrap);

    frag.appendChild(companySection);

    // المبلغ
    const amtField = this._field('col-amount', 'المبلغ', true);
    const amtInput = this._input('col-amount', 'number', 'أدخل المبلغ بالريال', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('col-amount-err'));
    frag.appendChild(amtField);

    // ملاحظات
    const notesField = this._field('col-notes', 'ملاحظات (اختياري)');
    const notesInput = document.createElement('textarea');
    notesInput.id = 'col-notes'; notesInput.className = 'form-control';
    notesInput.rows = 2; notesInput.placeholder = 'أي تفاصيل إضافية';
    notesField.appendChild(notesInput);
    frag.appendChild(notesField);

    refreshToggle();

    frag.appendChild(this._saveBtn('col-save-btn', '💾 حفظ التحصيل', async () => {
      const companyId = document.getElementById('col-company-id')?.value;
      const saveBeneficiary = document.getElementById('col-save-beneficiary')?.checked;
      let companyToSave = null;
      if (saveBeneficiary && companyId) {
        const companies = AppStore.getState('companies') || [];
        companyToSave = companies.find(c => c.id === companyId);
        if (companyToSave) {
          await this._saveCompanyBeneficiary(companyToSave.id, companyToSave.name, companyToSave.account_number);
        }
      }
      await this._saveCollection({
        mode      : colMode,
        amount    : amtInput.value,
        customer  : document.getElementById('col-customer-search')?.value?.trim() || '',
        customerId: document.getElementById('col-debtor-id')?.value || null,
        companyId : colMode === 'company' ? (companyId || null) : null,
        notes     : notesInput.value.trim(),
      });
    }));

    return frag;
  },

  // ── بحث العملاء المديونين (يبقى كما هو) ──
  _buildCustomerSearch() {
    const field = this._field('col-customer-search', 'بحث عن عميل مدين');
    const wrap  = document.createElement('div');
    wrap.style.position = 'relative';

    const input = document.createElement('input');
    input.id = 'col-customer-search'; input.type = 'text';
    input.className = 'form-control';
    input.placeholder = 'اكتب اسم العميل للبحث أو إضافة جديد...'; input.autocomplete = 'off';

    const dd = document.createElement('div');
    dd.id = 'col-customer-dropdown';
    dd.style.cssText = `
      position:absolute;top:100%;right:0;left:0;z-index:500;
      background:var(--glass-bg-heavy);border:1px solid var(--border-color);
      border-radius:12px;box-shadow:var(--shadow-lg);
      max-height:240px;overflow-y:auto;display:none;
      backdrop-filter:blur(16px);margin-top:4px;`;

    const custId = document.createElement('input');
    custId.type = 'hidden'; custId.id = 'col-debtor-id';

    const debtInfo = document.createElement('div');
    debtInfo.id = 'col-debt-display';
    debtInfo.style.cssText = 'display:none;margin-top:6px;padding:8px 12px;background:rgba(220,38,38,0.08);border-radius:8px;font-size:0.82rem;';

    const isAgent = AuthService.isAgent();
    const uid     = AuthService.getCurrentUserId();
    let allDebtors = AppStore.getState('debtors') || [];

    if (isAgent) {
      allDebtors = allDebtors.filter(d => {
        const agents = Array.isArray(d.assigned_agents)
          ? d.assigned_agents
          : (typeof d.assigned_agents === 'string' ? JSON.parse(d.assigned_agents || '[]') : []);
        return agents.includes(uid);
      });
    }

    const render = q => {
      const trimQ = q.trim().toLowerCase();
      dd.innerHTML = '';
      const matches = trimQ
        ? allDebtors.filter(d => d.name?.toLowerCase().includes(trimQ))
        : allDebtors.slice(0, 12);

      if (trimQ && !matches.find(d => d.name?.toLowerCase() === trimQ)) {
        const newItem = document.createElement('div');
        newItem.style.cssText = 'padding:10px 14px;cursor:pointer;display:flex;align-items:center;gap:8px;border-bottom:1px solid var(--border-color);color:var(--accent);font-size:0.88rem;font-weight:600;';
        newItem.innerHTML = `<span>➕</span><span>إضافة عميل جديد: <strong>${escapeHtml(q.trim())}</strong></span>`;
        newItem.addEventListener('click', async () => {
          dd.style.display = 'none';
          input.disabled = true;
          const newDebtor = { name: q.trim(), debt_amount: 0, assigned_agents: isAgent ? [uid] : [] };
          try {
            const r = await repo.create(TABLES.DEBTORS, newDebtor);
            if (isOk(r)) {
              const created = r.data?.[0] || r.data;
              input.value  = q.trim();
              custId.value = created?.id || '';
              debtInfo.style.display = '';
              debtInfo.style.background = 'rgba(5,150,105,0.08)';
              debtInfo.innerHTML = `✅ تم إنشاء عميل جديد: <strong>${escapeHtml(q.trim())}</strong>`;
              allDebtors.push({ ...newDebtor, id: created?.id });
            } else { showToast(`فشل إضافة العميل: ${r.error}`, 'error'); }
          } catch(e) { showToast(`خطأ: ${e.message}`, 'error'); }
          input.disabled = false;
        });
        dd.appendChild(newItem);
      }

      matches.forEach(d => {
        const item = document.createElement('div');
        item.style.cssText = 'padding:10px 14px;cursor:pointer;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border-color);transition:background 150ms;';
        item.innerHTML = `
          <div>
            <div style="font-weight:600;font-size:0.88rem;">${escapeHtml(d.name)}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);">${escapeHtml(d.region || '—')}</div>
          </div>
          <div style="font-weight:700;color:${(d.debt_amount||0) > 0 ? 'var(--danger)' : 'var(--success)'};">
            ${formatCurrency(d.debt_amount || 0)}
          </div>`;
        item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg-hover)'; });
        item.addEventListener('mouseleave', () => { item.style.background = ''; });
        item.addEventListener('click', () => {
          input.value  = d.name;
          custId.value = d.id;
          dd.style.display = 'none';
          debtInfo.style.display = '';
          debtInfo.style.background = 'rgba(220,38,38,0.08)';
          debtInfo.innerHTML = `💳 المديونية: <strong style="color:var(--danger);">${formatCurrency(d.debt_amount || 0)}</strong>`;
        });
        dd.appendChild(item);
      });

      dd.style.display = (matches.length || trimQ) ? '' : 'none';
    };

    input.addEventListener('input', () => { custId.value = ''; debtInfo.style.display = 'none'; render(input.value); });
    input.addEventListener('focus', () => render(input.value));
    document.addEventListener('click', e => { if (!wrap.contains(e.target)) dd.style.display = 'none'; });

    wrap.appendChild(input); wrap.appendChild(dd); wrap.appendChild(custId);
    field.appendChild(wrap); field.appendChild(debtInfo);
    return field;
  },

  // ═══════════════════════════════════════════════════════════
  // 2. نموذج السحب البنكي (معدل: بحث برقم الحساب + مستفيدين)
  // ═══════════════════════════════════════════════════════════
  _buildBankWithdrawalForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--warning);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>💳</span><span>سحب بنكي</span>';
    frag.appendChild(title);

    // ✅ حقل بحث رقم الحساب البنكي
    const bankField = this._field('wd-bank-search', 'البحث عن حساب بنكي', true);
    let selectedBank = null;
    const bankSearch = this._buildBankAccountSearch('wd-bank-search', 'ابحث باسم البنك أو رقم الحساب', (bank) => {
      selectedBank = bank;
      const ceilingInfo = document.getElementById('wd-ceiling-info');
      if (ceilingInfo && bank) {
        this._updateBankCeilingInfo(ceilingInfo, bank, 'wd');
      }
    });
    bankField.appendChild(bankSearch);
    bankField.appendChild(this._errMsg('wd-bank-err'));
    frag.appendChild(bankField);

    // قائمة المستفيدين
    const beneficiariesList = this._buildBankBeneficiariesList((bank) => {
      const searchInput = document.getElementById('wd-bank-search');
      const hiddenId = document.getElementById('wd-bank-search-id');
      if (searchInput) searchInput.value = bank.name;
      if (hiddenId) hiddenId.value = bank.id;
      const ceilingInfo = document.getElementById('wd-ceiling-info');
      if (ceilingInfo) this._updateBankCeilingInfo(ceilingInfo, bank, 'wd');
      selectedBank = bank;
    });
    frag.appendChild(beneficiariesList);

    // حفظ كمستفيد
    const saveBeneficiaryWrap = document.createElement('div');
    saveBeneficiaryWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 12px;';
    const saveBeneficiaryCheck = document.createElement('input');
    saveBeneficiaryCheck.type = 'checkbox';
    saveBeneficiaryCheck.id = 'wd-save-beneficiary';
    saveBeneficiaryCheck.style.margin = '0';
    const saveBeneficiaryLabel = document.createElement('label');
    saveBeneficiaryLabel.htmlFor = 'wd-save-beneficiary';
    saveBeneficiaryLabel.textContent = 'حفظ هذا الحساب في قائمة المستفيدين';
    saveBeneficiaryLabel.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);';
    saveBeneficiaryWrap.appendChild(saveBeneficiaryCheck);
    saveBeneficiaryWrap.appendChild(saveBeneficiaryLabel);
    frag.appendChild(saveBeneficiaryWrap);

    const ceilingInfo = document.createElement('div');
    ceilingInfo.id = 'wd-ceiling-info';
    ceilingInfo.style.cssText = 'display:none;margin:-8px 0 12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);font-size:0.82rem;border:1px solid var(--border-color);';
    frag.appendChild(ceilingInfo);

    const amtField = this._field('wd-amount', 'مبلغ السحب', true);
    const amtInput = this._input('wd-amount', 'number', 'أدخل المبلغ بالريال', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('wd-amount-err'));
    frag.appendChild(amtField);

    const notesField = this._field('wd-notes', 'ملاحظات (اختياري)');
    const notesInput = document.createElement('textarea');
    notesInput.id = 'wd-notes'; notesInput.className = 'form-control';
    notesInput.rows = 2; notesInput.placeholder = 'سبب السحب أو أي تفاصيل';
    notesField.appendChild(notesInput);
    frag.appendChild(notesField);

    const hint = document.createElement('div');
    hint.style.cssText = 'padding:9px 13px;border-radius:9px;background:rgba(245,158,11,0.07);border:1px solid rgba(245,158,11,0.15);font-size:0.78rem;color:var(--warning);margin-bottom:14px;';
    hint.textContent = 'ℹ️ السحب البنكي: يُدخل النقد في صندوق المندوب ويُخصم من رصيد الشركة (عبر القيد المحاسبي). الحساب البنكي يُستخدم لأغراض التقارير فقط.';
    frag.appendChild(hint);

    frag.appendChild(this._saveBtn('wd-save-btn', '💾 حفظ السحب البنكي', async () => {
      const bankId = document.getElementById('wd-bank-search-id')?.value;
      const saveBeneficiary = document.getElementById('wd-save-beneficiary')?.checked;
      if (saveBeneficiary && bankId && selectedBank) {
        await this._saveBankBeneficiary(bankId, selectedBank.name, selectedBank.internal_account_number || selectedBank.account_number);
      }
      await this._saveBankWithdrawal({
        bankId: bankId,
        bank: selectedBank,
        amount: amtInput.value,
        notes: notesInput.value.trim(),
      });
    }));

    return frag;
  },

  async _updateBankCeilingInfo(element, bank, prefix) {
    const today = getCurrentSaudiDate();
    let total = 0;
    try {
      total = await AccountingService.getDailyDepositsTotal(bank.id, today);
    } catch { total = 0; }
    const ceil = parseFloat(bank.financial_ceiling) || 0;
    const pct = ceil > 0 ? Math.min(100, (total / ceil) * 100) : 0;
    const rem = Math.max(0, ceil - total);
    const cls = getProgressClass ? getProgressClass(pct) : (pct >= 80 ? 'high' : pct >= 50 ? 'medium' : 'low');
    element.style.display = '';
    element.innerHTML = `
      <div style="display:flex;justify-content:space-between;margin-bottom:5px;">
        <span style="color:var(--text-secondary);">الإيداعات اليومية في هذا الحساب</span>
        <span style="font-weight:700;">${formatCurrency(total)}</span>
      </div>
      <div class="progress-bar"><div class="progress-fill ${cls}" style="width:${pct}%;"></div></div>
      <div style="display:flex;justify-content:space-between;margin-top:4px;color:var(--text-muted);font-size:0.76rem;">
        <span>السقف: ${formatCurrency(ceil)}</span>
        <span>المتبقي: ${formatCurrency(rem)}</span>
      </div>`;
  },

  // ═══════════════════════════════════════════════════════════
  // 3. نموذج الإيداع البنكي (معدل: بحث برقم الحساب + مستفيدين)
  // ═══════════════════════════════════════════════════════════
  _buildDepositForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--accent);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>🏦</span><span>إيداع بنكي</span>';
    frag.appendChild(title);

    // ✅ حقل بحث رقم الحساب البنكي
    const bankField = this._field('dep-bank-search', 'البحث عن حساب بنكي', true);
    let selectedBank = null;
    const bankSearch = this._buildBankAccountSearch('dep-bank-search', 'ابحث باسم البنك أو رقم الحساب', (bank) => {
      selectedBank = bank;
      const ceilingInfo = document.getElementById('dep-ceiling-info');
      if (ceilingInfo && bank) {
        this._updateBankCeilingInfo(ceilingInfo, bank, 'dep');
      }
    });
    bankField.appendChild(bankSearch);
    bankField.appendChild(this._errMsg('dep-bank-err'));
    frag.appendChild(bankField);

    // قائمة المستفيدين
    const beneficiariesList = this._buildBankBeneficiariesList((bank) => {
      const searchInput = document.getElementById('dep-bank-search');
      const hiddenId = document.getElementById('dep-bank-search-id');
      if (searchInput) searchInput.value = bank.name;
      if (hiddenId) hiddenId.value = bank.id;
      const ceilingInfo = document.getElementById('dep-ceiling-info');
      if (ceilingInfo) this._updateBankCeilingInfo(ceilingInfo, bank, 'dep');
      selectedBank = bank;
    });
    frag.appendChild(beneficiariesList);

    // حفظ كمستفيد
    const saveBeneficiaryWrap = document.createElement('div');
    saveBeneficiaryWrap.style.cssText = 'display:flex;align-items:center;gap:8px;margin:8px 0 12px;';
    const saveBeneficiaryCheck = document.createElement('input');
    saveBeneficiaryCheck.type = 'checkbox';
    saveBeneficiaryCheck.id = 'dep-save-beneficiary';
    saveBeneficiaryCheck.style.margin = '0';
    const saveBeneficiaryLabel = document.createElement('label');
    saveBeneficiaryLabel.htmlFor = 'dep-save-beneficiary';
    saveBeneficiaryLabel.textContent = 'حفظ هذا الحساب في قائمة المستفيدين';
    saveBeneficiaryLabel.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);';
    saveBeneficiaryWrap.appendChild(saveBeneficiaryCheck);
    saveBeneficiaryWrap.appendChild(saveBeneficiaryLabel);
    frag.appendChild(saveBeneficiaryWrap);

    const ceilingInfo = document.createElement('div');
    ceilingInfo.id = 'dep-ceiling-info';
    ceilingInfo.style.cssText = 'display:none;margin:-8px 0 12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);font-size:0.82rem;border:1px solid var(--border-color);';
    frag.appendChild(ceilingInfo);

    const amtField = this._field('dep-amount', 'المبلغ', true);
    const amtInput = this._input('dep-amount', 'number', 'أدخل مبلغ الإيداع', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('dep-amount-err'));
    frag.appendChild(amtField);

    const notesField = this._field('dep-notes', 'ملاحظات (اختياري)');
    const notesInput = document.createElement('textarea');
    notesInput.id = 'dep-notes'; notesInput.className = 'form-control';
    notesInput.rows = 2; notesInput.placeholder = 'أي تفاصيل إضافية';
    notesField.appendChild(notesInput);
    frag.appendChild(notesField);

    const hint = document.createElement('div');
    hint.style.cssText = 'padding:10px 14px;border-radius:10px;background:rgba(37,99,235,0.08);border:1px solid rgba(37,99,235,0.15);font-size:0.78rem;color:var(--accent);margin-bottom:16px;line-height:1.7;';
    hint.textContent = 'ℹ️ سيتم تسجيل قيد محاسبي واحد: إخلاء عهدة المندوب (دائن) واستلام الشركة (مدين). الحساب البنكي يُستخدم لأغراض التقارير فقط.';
    frag.appendChild(hint);

    frag.appendChild(this._saveBtn('dep-save-btn', '💾 حفظ الإيداع', async () => {
      const bankId = document.getElementById('dep-bank-search-id')?.value;
      const saveBeneficiary = document.getElementById('dep-save-beneficiary')?.checked;
      if (saveBeneficiary && bankId && selectedBank) {
        await this._saveBankBeneficiary(bankId, selectedBank.name, selectedBank.internal_account_number || selectedBank.account_number);
      }
      await this._saveDeposit({
        bankId: bankId,
        bank: selectedBank,
        amount: amtInput.value,
        notes: notesInput.value.trim(),
      });
    }));

    return frag;
  },

  // ═══════════════════════════════════════════════════════════
  // 4. نموذج المصروف (معدل: تثبيت حساب EXP_GENERAL)
  // ═══════════════════════════════════════════════════════════
  _buildExpenseForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--danger);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>💸</span><span>مصروف</span>';
    frag.appendChild(title);

    // ✅ تثبيت حساب المصروف (EXP_GENERAL) وإزالة القائمة المنسدلة
    const typeField = this._field('exp-type', 'نوع المصروف', true);
    const typeSelect = document.createElement('select');
    typeSelect.id = 'exp-type';
    typeSelect.className = 'form-control';
    typeSelect.innerHTML = `
      <option value="GENERAL">عام</option>
      <option value="TRANSPORT">مواصلات</option>
      <option value="MAINTENANCE">صيانة</option>
      <option value="SUPPLIES">قرطاسية</option>
      <option value="OTHER">أخرى</option>
    `;
    typeField.appendChild(typeSelect);
    typeField.appendChild(this._errMsg('exp-type-err'));
    frag.appendChild(typeField);

    // حقل نوع آخر (يظهر عند اختيار OTHER)
    const otherWrap = document.createElement('div');
    otherWrap.style.display = 'none';
    const otherField = this._field('exp-other-type', 'نوع المصروف (مخصص)');
    const otherInput = this._input('exp-other-type', 'text', 'أدخل وصف المصروف');
    otherField.appendChild(otherInput);
    otherWrap.appendChild(otherField);
    frag.appendChild(otherWrap);

    typeSelect.addEventListener('change', () => {
      otherWrap.style.display = typeSelect.value === 'OTHER' ? '' : 'none';
    });

    // المبلغ
    const amtField = this._field('exp-amount', 'المبلغ', true);
    const amtInput = this._input('exp-amount', 'number', 'أدخل مبلغ المصروف', { min:'1', step:'1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('exp-amount-err'));
    frag.appendChild(amtField);

    // التفاصيل
    const detField = this._field('exp-details', 'التفاصيل (اختياري)');
    const detInput = document.createElement('textarea');
    detInput.id = 'exp-details'; detInput.className = 'form-control';
    detInput.rows = 2; detInput.placeholder = 'وصف المصروف';
    detField.appendChild(detInput);
    frag.appendChild(detField);

    const hint = document.createElement('div');
    hint.style.cssText = 'padding:9px 13px;border-radius:9px;background:rgba(220,38,38,0.07);border:1px solid rgba(220,38,38,0.15);font-size:0.78rem;color:var(--danger);margin-bottom:14px;';
    hint.textContent = 'ℹ️ يتم تسجيل المصروف على حساب EXP_GENERAL، مع تضمين نوع المصروف في وصف القيد.';
    frag.appendChild(hint);

    frag.appendChild(this._saveBtn('exp-save-btn', '💾 حفظ المصروف', async () => {
      let expenseType = typeSelect.value;
      if (expenseType === 'OTHER') {
        expenseType = otherInput.value.trim().toUpperCase().replace(/\s/g, '_') || 'MISC';
      }
      await this._saveExpense({ expenseType: expenseType, amount: amtInput.value, details: detInput.value.trim() });
    }));

    return frag;
  },

  // ═══════════════════════════════════════════════════════════
  // 5. نموذج التحويل / طلب أموال (يبقى كما هو)
  // ═══════════════════════════════════════════════════════════
  _buildTransferForm() {
    const frag = document.createDocumentFragment();

    const title = document.createElement('h3');
    title.style.cssText = 'font-size:1rem;font-weight:700;margin-bottom:20px;color:var(--info);display:flex;align-items:center;gap:8px;';
    title.innerHTML = '<span>🔄</span><span>تحويل / طلب أموال (بين المستخدمين)</span>';
    frag.appendChild(title);

    const modeField = this._field('tr-mode', 'نوع العملية', true);
    const modeSelect = document.createElement('select');
    modeSelect.id = 'tr-mode';
    modeSelect.className = 'form-control';
    modeSelect.innerHTML = `
      <option value="transfer">تحويل مباشر (أرسل أموالاً إلى مستخدم آخر)</option>
      <option value="request">طلب أموال (اطلب أموالاً من مستخدم آخر)</option>
    `;
    modeField.appendChild(modeSelect);
    frag.appendChild(modeField);

    const reasonField = this._field('tr-reason', 'سبب الطلب (للطلب فقط)');
    const reasonInput = document.createElement('textarea');
    reasonInput.id = 'tr-reason';
    reasonInput.className = 'form-control';
    reasonInput.rows = 2;
    reasonInput.placeholder = 'اذكر سبب طلب التحويل...';
    reasonField.appendChild(reasonInput);
    frag.appendChild(reasonField);
    reasonField.style.display = 'none';

    modeSelect.addEventListener('change', () => {
      reasonField.style.display = modeSelect.value === 'request' ? 'block' : 'none';
    });

    const acctField = this._field('tr-account-num', 'رقم حساب المستلم (مثل AGT-XXXX)', true);
    const acctRow = document.createElement('div');
    acctRow.style.cssText = 'display:flex;gap:8px;';
    const acctInput = this._input('tr-account-num', 'text', 'AGT-XXXX', { dir: 'ltr', autocomplete: 'off' });
    acctInput.style.flex = '1';
    const acctLookupBtn = document.createElement('button');
    acctLookupBtn.type = 'button';
    acctLookupBtn.className = 'btn btn-secondary';
    acctLookupBtn.style.cssText = 'white-space:nowrap;padding:0 14px;';
    acctLookupBtn.textContent = '🔍 بحث';
    acctRow.appendChild(acctInput);
    acctRow.appendChild(acctLookupBtn);
    acctField.appendChild(acctRow);
    acctField.appendChild(this._errMsg('tr-account-num-err'));
    frag.appendChild(acctField);

    const acctResult = document.createElement('div');
    acctResult.id = 'tr-account-result';
    acctResult.style.cssText = 'display:none;margin:-6px 0 12px;padding:10px 14px;border-radius:10px;background:var(--bg-input);font-size:0.85rem;border:1px solid var(--border-color);';
    frag.appendChild(acctResult);

    const hiddenRecipientId = document.createElement('input');
    hiddenRecipientId.type = 'hidden';
    hiddenRecipientId.id = 'tr-recipient-id';
    frag.appendChild(hiddenRecipientId);

    const saveBeneficiaryWrap = document.createElement('div');
    saveBeneficiaryWrap.style.cssText = 'display:none;margin:8px 0 12px;';
    const saveBeneficiaryCheck = document.createElement('input');
    saveBeneficiaryCheck.type = 'checkbox';
    saveBeneficiaryCheck.id = 'tr-save-beneficiary';
    saveBeneficiaryCheck.style.marginLeft = '8px';
    const saveBeneficiaryLabel = document.createElement('label');
    saveBeneficiaryLabel.htmlFor = 'tr-save-beneficiary';
    saveBeneficiaryLabel.textContent = 'حفظ هذا المستلم في قائمة المستفيدين';
    saveBeneficiaryLabel.style.cssText = 'font-size:0.85rem;color:var(--text-secondary);';
    saveBeneficiaryWrap.appendChild(saveBeneficiaryCheck);
    saveBeneficiaryWrap.appendChild(saveBeneficiaryLabel);
    frag.appendChild(saveBeneficiaryWrap);

    const recentWrap = document.createElement('div');
    recentWrap.style.cssText = 'margin-bottom:12px;';
    const recentLabel = document.createElement('div');
    recentLabel.style.cssText = 'font-size:0.75rem;color:var(--text-muted);margin-bottom:6px;';
    recentLabel.textContent = 'المستفيدون المحفوظون:';
    recentWrap.appendChild(recentLabel);
    const recentList = document.createElement('div');
    recentList.id = 'tr-beneficiaries-list';
    recentList.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
    recentWrap.appendChild(recentList);
    frag.appendChild(recentWrap);

    const refreshBeneficiariesList = () => {
      const beneficiaries = AppStore.getState('beneficiaries') || [];
      recentList.innerHTML = '';
      if (beneficiaries.length === 0) {
        recentList.innerHTML = '<span style="font-size:0.72rem;color:var(--text-muted);">لا يوجد مستفيدون محفوظون</span>';
        return;
      }
      beneficiaries.forEach(b => {
        const chip = document.createElement('button');
        chip.type = 'button';
        chip.className = 'btn btn-secondary btn-sm';
        chip.style.cssText = 'font-size:0.72rem;padding:4px 10px;border-radius:20px;';
        chip.textContent = b.display_name;
        chip.addEventListener('click', () => {
          acctInput.value = `AGT-${b.beneficiary_id.slice(0,6)}`;
          hiddenRecipientId.value = b.beneficiary_id;
          acctResult.style.display = '';
          acctResult.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div>
                <span style="font-weight:700;">${escapeHtml(b.display_name)}</span>
                <span style="font-size:0.72rem;color:var(--text-muted);margin-right:6px;">(مندوب)</span>
              </div>
              <span style="color:var(--success);font-size:0.75rem;">✓ مستفيد محفوظ</span>
            </div>`;
          saveBeneficiaryWrap.style.display = 'none';
        });
        recentList.appendChild(chip);
      });
    };

    refreshBeneficiariesList();
    AppStore.addEventListener('store:beneficiariesLoaded', refreshBeneficiariesList);

    const lookupRecipient = async () => {
      const num = acctInput.value.trim();
      if (!num) {
        document.getElementById('tr-account-num-err').textContent = 'أدخل رقم الحساب';
        return;
      }
      const match = num.match(/AGT-([a-f0-9]+)/i) || num.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
      let searchId = match ? (match[1] || match[0]) : num;
      const users = AppStore.getState('users') || [];
      const foundUser = users.find(u => u.id === searchId || u.id.startsWith(searchId) || (u.account_number && u.account_number === num));
      if (!foundUser) {
        document.getElementById('tr-account-num-err').textContent = 'لم يتم العثور على مستخدم بهذا الرقم';
        acctResult.style.display = 'none';
        hiddenRecipientId.value = '';
        saveBeneficiaryWrap.style.display = 'none';
        return;
      }
      if (foundUser.id === AuthService.getCurrentUserId()) {
        document.getElementById('tr-account-num-err').textContent = 'لا يمكن التحويل إلى نفس المستخدم';
        acctResult.style.display = 'none';
        hiddenRecipientId.value = '';
        return;
      }
      hiddenRecipientId.value = foundUser.id;
      acctResult.style.display = '';
      acctResult.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <span style="font-weight:700;">${escapeHtml(foundUser.display_name)}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);margin-right:6px;">(${ROLE_LABELS[foundUser.role] || foundUser.role})</span>
          </div>
          <span style="color:var(--success);font-size:0.75rem;">✓ تم العثور عليه</span>
        </div>`;
      document.getElementById('tr-account-num-err').textContent = '';
      saveBeneficiaryWrap.style.display = 'block';
    };

    acctLookupBtn.addEventListener('click', lookupRecipient);
    acctInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); lookupRecipient(); } });

    const amtField = this._field('tr-amount', 'المبلغ', true);
    const amtInput = this._input('tr-amount', 'number', 'أدخل المبلغ', { min: '1', step: '1' });
    amtField.appendChild(amtInput);
    amtField.appendChild(this._errMsg('tr-amount-err'));
    frag.appendChild(amtField);

    frag.appendChild(this._saveBtn('tr-save-btn', '💾 تنفيذ', async () => {
      const mode = modeSelect.value;
      const recipientId = hiddenRecipientId.value;
      const amount = amtInput.value;
      const reason = reasonInput.value.trim();
      const saveBeneficiary = saveBeneficiaryCheck.checked;

      if (!recipientId) {
        showToast('يرجى البحث عن رقم حساب المستلم أولاً', 'error');
        return;
      }
      if (!isValidAmount(amount)) {
        showToast('المبلغ يجب أن يكون رقماً موجباً', 'error');
        return;
      }
      if (mode === 'request' && !reason) {
        showToast('السبب مطلوب لطلب الأموال', 'error');
        return;
      }

      await this._saveTransfer({
        mode,
        recipientId,
        amount: roundAmount(amount),
        reason,
        saveBeneficiary,
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

  // ═══════════════ منطق الحفظ (معدل لدعم البنوك والشركات التي تم البحث عنها) ═══════════════

  async _saveCollection({ mode, amount, customer, customerId, companyId, notes }) {
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }

    if (mode === 'company' && !companyId) { showToast('اختر شركة (ابحث برقم الحساب)', 'error'); return; }
    if (mode === 'customer' && !customer)  { showToast('أدخل اسم العميل', 'error'); return; }

    const rounded = roundAmount(amount);

    let debtorRecord = null;
    if (customerId) {
      debtorRecord = AppStore.getState('debtors')?.find(d => d.id === customerId);
      const debtRemaining = parseFloat(debtorRecord?.debt_amount || 0);
      if (debtRemaining > 0 && rounded > debtRemaining) {
        const confirmed = await confirmDialog(
          `⚠️ المبلغ يتجاوز الدين المسجَّل!\nالدين المتبقي: ${formatCurrency(debtRemaining)}\nالمبلغ المُدخَل: ${formatCurrency(rounded)}\n\nهل تريد المتابعة؟`,
          'متابعة', 'مراجعة', 'warning'
        );
        if (!confirmed) return;
      }
    }

    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('col-save-btn');
    const restore = setButtonLoading(btn);

    const txData = {
      type          : 'collection',
      amount        : rounded,
      date          : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id      : agentId,
      company_id    : companyId || null,
      customer_name : customer  || null,
      customer_id   : customerId || null,
      details       : notes || null,
    };

    const result = await AccountingService.createTransactionWithEntries(txData);
    restore();

    if (isOk(result)) {
      if (customerId && debtorRecord) {
        const newDebt = Math.max(0, parseFloat(debtorRecord.debt_amount || 0) - rounded);
        try { await repo.update(TABLES.DEBTORS, customerId, { debt_amount: newDebt }); } catch (e) { console.warn('⚠️ DataEntry: فشل تحديث رصيد المدين:', e.message); }
      }
      showToast('✅ تم حفظ التحصيل', 'success');
      this._resetForm('col');
      const colBalRes = await AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId));
      await this._showResultModal({
        title        : '✅ تم تسجيل تحصيل جديد',
        type         : 'تحصيل',
        amount       : rounded,
        customer     : customer || null,
        newDebt      : customerId && debtorRecord ? Math.max(0, parseFloat(debtorRecord.debt_amount||0) - rounded) : null,
        agentId,
        date         : txData.date,
        agentBalance : isOk(colBalRes) ? colBalRes.data : null,
      });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveBankWithdrawal({ bankId, bank, amount, notes }) {
    if (!bankId) { showToast('اختر الحساب البنكي (ابحث برقم الحساب)', 'error'); return; }
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }

    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();
    const btn     = document.getElementById('wd-save-btn');
    const restore = setButtonLoading(btn);

    // تحديد company_id من البنك
    const companyId = bank?.company_id || null;

    const result = await AccountingService.createTransactionWithEntries({
      type            : 'bank_withdrawal',
      amount          : rounded,
      date            : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id        : agentId,
      bank_account_id : bankId,
      company_id      : companyId,
      details         : notes || null,
    });
    restore();
    if (isOk(result)) {
      showToast('✅ تم حفظ السحب البنكي', 'success');
      this._resetForm('wd');
      const wdBalRes = await AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId));
      await this._showResultModal({ title:'✅ تم تسجيل سحب بنكي', type:'سحب بنكي', amount:rounded, bankName:bank?.name, agentId, date:AppStore.getState('selectedDate') || getCurrentSaudiDate(), agentBalance: isOk(wdBalRes) ? wdBalRes.data : null });
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveDeposit({ bankId, bank, amount, notes }) {
    if (!bankId) { showToast('اختر الحساب البنكي (ابحث برقم الحساب)', 'error'); return; }
    if (!isValidAmount(amount)) { showToast('المبلغ يجب أن يكون رقماً موجباً', 'error'); return; }

    const rounded = roundAmount(amount);
    const agentId = AppStore.getState('selectedAgentId') || AuthService.getCurrentUserId();

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

    const companyId = bank?.company_id || null;
    const btn     = document.getElementById('dep-save-btn');
    const restore = setButtonLoading(btn);
    const txData  = {
      type            : 'deposit',
      amount          : rounded,
      date            : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id        : agentId,
      bank_account_id : bankId,
      company_id      : companyId,
      details         : notes || null,
    };

    const result = await AccountingService.createTransactionWithEntries(txData);
    restore();
    if (isOk(result)) {
      showToast('✅ تم حفظ الإيداع', 'success');
      this._resetForm('dep');
      const ceil = Math.round(bank?.financial_ceiling || 0);
      const used = await AccountingService.getDailyDepositsTotal(bankId, getCurrentSaudiDate());
      const depBalRes = await AccountingService.getAccountBalance(AccountingService.AccountId.agent(agentId));
      await this._showResultModal({ title:'✅ تم تسجيل إيداع بنكي', type:'إيداع بنكي', amount:rounded, bankName:bank?.name, agentId, date:txData.date, ceilingRemain: Math.max(0, ceil - used), agentBalance: isOk(depBalRes) ? depBalRes.data : null });
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

    // ✅ استخدام حساب EXP_GENERAL الثابت، مع تضمين نوع المصروف في الوصف
    const result  = await AccountingService.createTransactionWithEntries({
      type        : 'expense',
      amount      : rounded,
      date        : AppStore.getState('selectedDate') || getCurrentSaudiDate(),
      agent_id    : agentId,
      expense_type: expenseType,
      details     : details ? `${details} (نوع: ${expenseType})` : `مصروف من نوع ${expenseType}`,
    });
    restore();
    if (isOk(result)) {
      showToast('✅ تم حفظ المصروف', 'success');
      this._resetForm('exp');
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },

  async _saveTransfer({ mode, recipientId, amount, reason, saveBeneficiary }) {
    const btn = document.getElementById('tr-save-btn');
    const restore = setButtonLoading(btn);

    try {
      const myUserId = AuthService.getCurrentUserId();
      const myName = AuthService.getCurrentUser()?.display_name || 'مستخدم';
      const recipient = AppStore.getState('users').find(u => u.id === recipientId);
      const recipientName = recipient?.display_name || 'المستخدم الآخر';

      if (saveBeneficiary && mode === 'transfer') {
        const addResult = await AppStore.addBeneficiary(myUserId, recipientId);
        if (isOk(addResult)) {
          console.log('تم حفظ المستفيد بنجاح');
        }
      }

      const txDate = AppStore.getState('selectedDate') || getCurrentSaudiDate();

      const confirmMessage = mode === 'transfer'
        ? `⚠️ هل أنت متأكد من تحويل ${formatCurrency(amount)} إلى المستلم المحدد؟`
        : `⚠️ هل أنت متأكد من إرسال طلب أموال بمبلغ ${formatCurrency(amount)} إلى المستخدم المحدد؟`;
      const confirmed = await confirmDialog(confirmMessage, 'تأكيد', 'إلغاء', 'warning');
      if (!confirmed) return;

      if (mode === 'transfer') {
        const txData = {
          type: 'receipt',
          amount: amount,
          date: txDate,
          agent_id: myUserId,
          from_agent_id: myUserId,
          to_agent_id: recipientId,
          details: `تحويل مباشر من ${myName} إلى ${recipientName}`,
          approval_status: 'pending',
        };
        const result = await AccountingService.createTransactionWithEntries(txData);
        if (!isOk(result)) throw new Error(result.error);

        const notifData = {
          title: '💰 طلب تحويل وارد',
          body: `${myName} قام بتحويل ${formatCurrency(amount)} إليك. اضغط قبول لإضافتها إلى رصيدك.`,
          type: 'info',
          target: JSON.stringify([recipientId]),
          metadata: { transaction_id: result.data.transaction.id, type: 'transfer_approval', amount: amount },
          sender_id: myUserId,
          read_by: '[]',
          hidden_by: '[]',
        };
        await repo.create(TABLES.NOTIFICATIONS, notifData);
        showToast(`✅ تم إرسال طلب التحويل إلى ${recipientName}. بانتظار الموافقة.`, 'success');
      } 
      else {
        const requestData = {
          from_user_id: myUserId,
          to_user_id: recipientId,
          amount: amount,
          reason: reason,
          status: 'pending',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const createResult = await repo.create(TABLES.TRANSFER_REQUESTS, requestData);
        if (!isOk(createResult)) throw new Error(createResult.error);

        const notifData = {
          title: '📨 طلب أموال',
          body: `${myName} يطلب منك مبلغ ${formatCurrency(amount)}. السبب: ${reason || 'غير محدد'}`,
          type: 'info',
          target: JSON.stringify([recipientId]),
          metadata: { request_id: createResult.data.id, type: 'transfer_request', amount: amount },
          sender_id: myUserId,
          read_by: '[]',
          hidden_by: '[]',
        };
        await repo.create(TABLES.NOTIFICATIONS, notifData);
        showToast(`✅ تم إرسال طلب الأموال إلى ${recipientName}. بانتظار الموافقة.`, 'success');
      }

      this._resetForm('tr');
    } catch (err) {
      console.error('❌ _saveTransfer error:', err);
      showToast(`❌ فشل العملية: ${err.message}`, 'error');
    } finally {
      restore();
    }
  },

  _resetForm(prefix) {
    const numericIds = [`${prefix}-amount`];
    const textIds    = [`${prefix}-notes`, `${prefix}-details`];
    const hiddenIds  = [`${prefix}-debtor-id`, `${prefix}-bank-search-id`, `${prefix}-company-id`];
    const searchIds  = [`${prefix}-customer-search`, `${prefix}-bank-search`, `${prefix}-company-search`];

    numericIds.forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
    textIds.forEach(id    => { const el = document.getElementById(id); if (el) el.value = ''; });
    hiddenIds.forEach(id  => { const el = document.getElementById(id); if (el) el.value = ''; });
    searchIds.forEach(id  => { const el = document.getElementById(id); if (el) el.value = ''; });

    const resultDisplays = [`${prefix}-result`, `${prefix}-company-result`, `${prefix}-debt-display`, `${prefix}-ceiling-info`];
    resultDisplays.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.style.display = 'none'; el.innerHTML = ''; }
    });

    if (prefix === 'col') {
      const debtDisplay = document.getElementById('col-debt-display');
      if (debtDisplay) debtDisplay.style.display = 'none';
    }
    if (prefix === 'dep') {
      const ceilInfo = document.getElementById('dep-ceiling-info');
      if (ceilInfo) ceilInfo.style.display = 'none';
    }
    if (prefix === 'wd') {
      const ceilInfo = document.getElementById('wd-ceiling-info');
      if (ceilInfo) ceilInfo.style.display = 'none';
    }
    if (prefix === 'tr') {
      const modeSelect = document.getElementById('tr-mode');
      if (modeSelect) modeSelect.value = 'transfer';
      const reasonField = document.getElementById('tr-reason');
      if (reasonField) reasonField.value = '';
      const acctInput = document.getElementById('tr-account-num');
      if (acctInput) acctInput.value = '';
      const acctResult = document.getElementById('tr-account-result');
      if (acctResult) acctResult.style.display = 'none';
      const hiddenRecipientId = document.getElementById('tr-recipient-id');
      if (hiddenRecipientId) hiddenRecipientId.value = '';
      const saveBeneficiaryCheck = document.getElementById('tr-save-beneficiary');
      if (saveBeneficiaryCheck) saveBeneficiaryCheck.checked = false;
    }
  },

  async _showResultModal(data) {
    const users   = AppStore.getState('users');
    const agent   = users.find(u => u.id === data.agentId);
    const agentNm = agent?.display_name || '—';
    const now     = new Date();
    const timeStr = now.toLocaleTimeString('ar-SA', { hour:'2-digit', minute:'2-digit' });

    let lines = [];
    lines.push(data.title || '✅ تمت العملية');
    lines.push('');
    lines.push(`📌 نوع العملية: ${data.type}`);
    lines.push(`💰 المبلغ: ${formatCurrency(data.amount)}`);
    if (data.customer) lines.push(`👤 العميل: ${data.customer}`);
    if (data.newDebt !== null && data.newDebt !== undefined) lines.push(`💰 الرصيد المتبقي عند العميل: ${formatCurrency(data.newDebt)}`);
    if (data.bankName) lines.push(`🏦 الحساب البنكي: ${data.bankName}`);
    if (data.ceilingRemain !== undefined && data.ceilingRemain !== null) lines.push(`🏦 المتبقي من السقف المالي: ${formatCurrency(data.ceilingRemain)}`);
    lines.push(`📅 التاريخ: ${data.date}`);
    lines.push(`⏰ الوقت: ${timeStr}`);
    lines.push(`👤 المندوب: ${agentNm}`);
    lines.push('');
    lines.push('─────────────────────');
    if (data.agentBalance !== undefined && data.agentBalance !== null) lines.push(`💵 المبلغ المتبقي في الصندوق: ${formatCurrency(data.agentBalance)}`);
    if (data.status) lines.push(`⏳ حالة الطلب: ${data.status}`);

    const text = lines.join('\n');

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'display:flex;z-index:9999;';
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '420px';

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" style="color:var(--success);">${escapeHtml(data.title || '✅ تمت العملية')}</h3>
        <button class="modal-close" id="result-close-x">✕</button>
      </div>
      <pre style="white-space:pre-wrap;font-family:inherit;font-size:0.88rem;line-height:1.8;padding:12px;background:var(--bg-input);border-radius:10px;margin-bottom:16px;direction:rtl;text-align:right;">${escapeHtml(lines.slice(1).join('\n'))}</pre>
      <div style="display:flex;gap:8px;">
        <button class="btn btn-primary" style="flex:1;" id="result-copy-btn">📋 نسخ</button>
        <button class="btn btn-secondary" style="flex:1;" id="result-share-btn">📤 مشاركة</button>
        <button class="btn btn-secondary" style="flex:1;" id="result-close-btn">✖️ إغلاق</button>
      </div>`;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    box.querySelector('#result-close-x').addEventListener('click', () => overlay.remove());
    box.querySelector('#result-close-btn').addEventListener('click', () => overlay.remove());

    box.querySelector('#result-copy-btn').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(text); showToast('تم النسخ', 'success'); }
      catch { showToast('لا يدعم النسخ التلقائي', 'error'); }
    });

    box.querySelector('#result-share-btn').addEventListener('click', async () => {
      if (navigator.share) {
        try { await navigator.share({ text }); }
        catch { /* المستخدم ألغى */ }
      } else {
        try { await navigator.clipboard.writeText(text); showToast('تم نسخ النص للمشاركة اليدوية', 'info'); }
        catch { showToast('انسخ النص يدوياً', 'info'); }
      }
    });
  },
};

window.DataEntryComponent = DataEntryComponent;

// اختصار Ctrl+S: ينقر على زر الحفظ الظاهر حالياً في نموذج إدخال البيانات
window.saveCurrentOperation = function () {
  const btn = document.querySelector('#app-content button[id$="-save-btn"]:not([disabled])');
  if (btn) btn.click();
};

console.log('✅ DataEntryComponent v5.0 — السلوك الثاني: بحث برقم الحساب + تثبيت حساب المصروف');
