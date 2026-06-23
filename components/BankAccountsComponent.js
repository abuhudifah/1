/**
 * components/BankAccountsComponent.js — v3.0
 * بطاقات بنكية عصرية بتصميم البنك الأهلي السعودي
 * - شريط تقدم السقف الملوّن
 * - إخفاء/إظهار PIN
 * - آخر 5 إيداعات + "عرض المزيد"
 * - أزرار: طباعة، مشاركة، تعديل، حذف
 * - ترتيب حسب آخر نشاط
 * - نظام مشاركة بعد حفظ الإيداع
 */
'use strict';

const BankAccountsComponent = {
  _modal     : null,
  _editId    : null,
  _selectedDate: null,
  _showPins  : new Set(),
  _companyFilter : null,

  async render(container) {
    this._container  = container;
    this._selectedDate = getCurrentSaudiDate();
    container.innerHTML = '';
    const wrap = document.createElement('div');

    /* ── شريط العنوان ── */
    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:20px;';

    const titleEl = document.createElement('h2');
    titleEl.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;';
    titleEl.textContent = 'الحسابات البنكية';
    topBar.appendChild(titleEl);

    /* حقل التاريخ */
    const dateInput = document.createElement('input');
    dateInput.type  = 'date';
    dateInput.value = this._selectedDate;
    dateInput.className = 'form-control';
    dateInput.style.cssText = 'max-width:160px;padding:7px 12px;font-size:0.85rem;';
    dateInput.addEventListener('change', e=>{ this._selectedDate=e.target.value; this._load(); });
    topBar.appendChild(dateInput);

    if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      const companies = AppStore.getState('companies') || [];
      if (companies.length > 0) {
        const compSel = document.createElement('select');
        compSel.id = 'bank-company-filter';
        compSel.className = 'form-control';
        compSel.style.cssText = 'max-width:180px;padding:7px 12px;font-size:0.85rem;';
        compSel.innerHTML = `<option value="">كل الشركات</option>` +
          companies.map(c => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('');
        compSel.value = this._companyFilter || '';
        compSel.addEventListener('change', e => { this._companyFilter = e.target.value || null; this._load(); });
        topBar.appendChild(compSel);
      }
    }

    if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary btn-sm';
      addBtn.innerHTML = '<i data-lucide="plus" style="width:14px;height:14px"></i> إضافة حساب';
      addBtn.addEventListener('click', ()=>this._openModal());
      topBar.appendChild(addBtn);
    }
    wrap.appendChild(topBar);

    /* منطقة البطاقات */
    const cardsEl = document.createElement('div');
    cardsEl.id = 'bank-cards-area';
    cardsEl.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px;';
    cardsEl.innerHTML = [1,2,3].map(()=>`<div class="skeleton" style="height:220px;border-radius:20px;"></div>`).join('');
    wrap.appendChild(cardsEl);

    /* مودال إضافة/تعديل — مُضاف لـ body لتجنب كسر position:fixed على الجوال */
    if (this._modal) this._modal.remove();
    this._modal = this._buildModal();
    document.body.appendChild(this._modal);

    container.appendChild(wrap);
    await this._load();
    if (window.lucide) lucide.createIcons();
  },

  // ─────────────────────────────────────────────
  async _load() {
    const el = document.getElementById('bank-cards-area');
    if (!el) return;

    const isAgent = AuthService.isAgent();
    const uid     = AuthService.getCurrentUserId();
    let bankAccounts = [];

    if (isAgent) {
      // FIX: استخدام getAllowedBanks() كفلتر أساسي للصلاحيات بدلاً من النشاط اليومي فقط.
      // البنوك المصرح بها تظهر دائماً؛ ترتيبها يعتمد على النشاط (نشطة أولاً).
      const allowedBanks = AuthService.getAllowedBanks();
      let allBanks = AppStore.getState('bankAccounts') || [];

      if (allowedBanks && allowedBanks.length > 0) {
        bankAccounts = allBanks.filter(b => allowedBanks.includes(b.id));
      } else {
        // null = لا قيود مُحدَّدة → يرى المندوب جميع البنوك
        bankAccounts = allBanks;
      }

      if (!bankAccounts.length) {
        el.innerHTML=`<div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon"><i data-lucide="landmark" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
          <div class="empty-state-text">لا توجد حسابات بنكية مصرح بها</div>
        </div>`;
        if (window.lucide) lucide.createIcons();
        return;
      }

      // جلب البنوك التي أودع فيها المندوب في التاريخ المحدد
      this._agentActiveIds = new Set();
      try {
        if (!isOfflineMode() && isOnline()) {
          const { data } = await supabaseClient.from('transactions')
            .select('bank_account_id')
            .eq('date', this._selectedDate)
            .in('type', ['deposit', 'bank_withdrawal'])
            .eq('agent_id', uid);
          this._agentActiveIds = new Set((data||[]).map(d=>d.bank_account_id).filter(Boolean));
        } else {
          const txs = await db.transactions.where('[date+agent_id]').equals([this._selectedDate, uid])
            .filter(t => (t.type==='deposit' || t.type==='bank_withdrawal') && t.bank_account_id)
            .toArray();
          this._agentActiveIds = new Set(txs.map(d=>d.bank_account_id));
        }
      } catch (e) { console.warn('⚠️ BankAccounts: فشل تحميل الحسابات النشطة:', e.message); }

      // يعرض فقط البنوك التي أودع فيها المندوب في هذا التاريخ
      bankAccounts = bankAccounts.filter(b => this._agentActiveIds.has(b.id));

      if (!bankAccounts.length) {
        el.innerHTML=`<div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon"><i data-lucide="inbox" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
          <div class="empty-state-text">لا توجد إيداعات في هذا التاريخ</div>
        </div>`;
        if (window.lucide) lucide.createIcons();
        return;
      }
    } else {
      bankAccounts = AppStore.getState('bankAccounts')||[];
      // تطبيق فلتر الشركة إن وُجد
      if (this._companyFilter) {
        bankAccounts = bankAccounts.filter(b => b.company_id === this._companyFilter);
      }
    }

    if (!bankAccounts.length) {
      el.innerHTML=`<div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon"><i data-lucide="landmark" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
        <div class="empty-state-text">لا توجد حسابات بنكية</div>
      </div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    /* جلب إجماليات وآخر نشاط لكل حساب (إيداع + سحب) */
    let dayActivity = {}; // bank_id → { depositTotal, withdrawTotal, list[], lastTime }
    try {
      if (!isOfflineMode() && isOnline()) {
        const { data } = await supabaseClient.from('transactions')
          .select('bank_account_id,amount,type,agent_id,created_at')
          .eq('date', this._selectedDate)
          .in('type', ['deposit', 'bank_withdrawal'])
          .eq('is_reversed', false)
          .order('created_at', {ascending: false});
        (data||[]).forEach(d => {
          if (!d.bank_account_id) return;
          if (!dayActivity[d.bank_account_id]) {
            dayActivity[d.bank_account_id] = { depositTotal: 0, withdrawTotal: 0, list: [], lastTime: '' };
          }
          const amt = Math.round(parseFloat(d.amount)||0);
          if (d.type === 'deposit')          dayActivity[d.bank_account_id].depositTotal  += amt;
          else if (d.type === 'bank_withdrawal') dayActivity[d.bank_account_id].withdrawTotal += amt;
          dayActivity[d.bank_account_id].list.push(d);
          if (!dayActivity[d.bank_account_id].lastTime) {
            dayActivity[d.bank_account_id].lastTime = d.created_at || '';
          }
        });
      }
    } catch (e) { console.warn('⚠️ BankAccounts: فشل تحميل نشاط اليوم:', e.message); }

    el.innerHTML = '';
    const users     = AppStore.getState('users');
    const companies = AppStore.getState('companies') || [];

    if (isAgent) {
      /* المندوب: عرض بسيط بدون تجميع شركات */
      bankAccounts.forEach(bank => this._renderCard(el, bank, dayActivity, users, isAgent));
    } else {
      /* المدير: تجميع البنوك تحت شركتها */
      const companyMap = {};
      const noBankComp = [];

      bankAccounts.forEach(bank => {
        if (bank.company_id) {
          if (!companyMap[bank.company_id]) {
            companyMap[bank.company_id] = {
              company: companies.find(c => c.id === bank.company_id) || { id: bank.company_id, name: '—' },
              banks  : [],
            };
          }
          companyMap[bank.company_id].banks.push(bank);
        } else {
          noBankComp.push(bank);
        }
      });

      const sortByActivity = arr => [...arr].sort((a, b) => {
        const aT = dayActivity[a.id]?.lastTime || '';
        const bT = dayActivity[b.id]?.lastTime || '';
        if (!aT && !bT) return 0;
        if (!aT) return 1;
        if (!bT) return -1;
        return bT.localeCompare(aT);
      });

      const groups = [
        ...Object.values(companyMap).map(g => ({
          label  : g.company.name,
          banks  : sortByActivity(g.banks),
          depositTotal : g.banks.reduce((s,b) => s + (dayActivity[b.id]?.depositTotal || 0), 0),
          withdrawTotal: g.banks.reduce((s,b) => s + (dayActivity[b.id]?.withdrawTotal || 0), 0),
        })),
        ...(noBankComp.length ? [{
          label: 'بدون شركة',
          banks: sortByActivity(noBankComp),
          depositTotal: 0, withdrawTotal: 0,
        }] : []),
      ];

      groups.forEach(group => {
        if (groups.length > 1 || group.label !== 'بدون شركة') {
          const groupHeader = document.createElement('div');
          groupHeader.style.cssText = `
            grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;
            flex-wrap:wrap;gap:6px;
            padding:10px 4px 4px;border-bottom:2px solid var(--border-color);margin-bottom:4px;`;
          groupHeader.innerHTML = `
            <span style="font-weight:800;font-size:1rem;color:var(--text-primary);display:inline-flex;align-items:center;gap:5px;"><i data-lucide="building-2" style="width:16px;height:16px;"></i> ${escapeHtml(group.label)}</span>
            <span style="font-size:0.82rem;color:var(--text-muted);display:flex;gap:12px;flex-wrap:wrap;">
              <span>إيداعات: <strong style="color:var(--success);direction:ltr;display:inline-block;">
                ${group.depositTotal.toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}
              </strong></span>
              ${group.withdrawTotal > 0 ? `<span>سحوبات: <strong style="color:var(--danger);direction:ltr;display:inline-block;">
                ${group.withdrawTotal.toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}
              </strong></span>` : ''}
            </span>`;
          el.appendChild(groupHeader);
        }
        group.banks.forEach(bank => this._renderCard(el, bank, dayActivity, users, isAgent));
      });
    }

    /* ربط أحداث PIN و "عرض المزيد" */
    el.querySelectorAll('.toggle-pin-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const bid = btn.dataset.bankid;
        if (this._showPins.has(bid)) this._showPins.delete(bid);
        else this._showPins.add(bid);
        this._load();
      });
    });

    el.querySelectorAll('.show-more-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const bid  = btn.dataset.bankid;
        const bank = bankAccounts.find(b=>b.id===bid);
        const info = dayActivity[bid]||{list:[]};
        this._showAllDeposits(bank, info.list);
      });
    });

    if (window.lucide) lucide.createIcons();
  },

  // ─────────────────────────────────────────────
  // رسم بطاقة بنكية واحدة
  // ─────────────────────────────────────────────
  _renderCard(el, bank, dayActivity, users, isAgent) {
    const info     = dayActivity[bank.id] || { depositTotal: 0, withdrawTotal: 0, list: [], lastTime: '' };
    const isActive = info.list.length > 0;
    const ceiling  = Math.round(bank.financial_ceiling||0);
    const total    = info.depositTotal;
    const pct      = ceiling>0 ? Math.min(100, Math.round(total/ceiling*100)) : 0;
    const remain   = Math.max(0, ceiling-total);
    const clr      = pct>=80 ? '#dc2626' : pct>=50 ? '#d97706' : '#059669';
    const showPin  = this._showPins.has(bank.id);

    const card = document.createElement('div');
    card.style.cssText = `
      border-radius:20px;overflow:hidden;
      box-shadow:0 12px 40px rgba(0,0,0,0.18);
      transition:transform var(--transition-normal),box-shadow var(--transition-normal);
      cursor:default;
      ${!isActive ? 'opacity:0.6;filter:grayscale(0.45);' : ''}`;
    card.addEventListener('mouseenter', () => { card.style.transform='translateY(-4px)'; card.style.boxShadow='0 20px 56px rgba(0,0,0,0.25)'; });
    card.addEventListener('mouseleave', () => { card.style.transform=''; card.style.boxShadow='0 12px 40px rgba(0,0,0,0.18)'; });

    const front = document.createElement('div');
    front.style.cssText = `
      background:${isActive
        ? 'linear-gradient(135deg,#1a2942 0%,#243b6e 50%,#1a2942 100%)'
        : 'linear-gradient(135deg,#374151 0%,#4b5563 50%,#374151 100%)'};
      padding:22px 20px 18px;color:#fff;position:relative;min-height:190px;`;

    front.innerHTML = `
      <div style="position:absolute;inset:0;opacity:0.05;
        background-image:repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(255,255,255,0.3) 20px,rgba(255,255,255,0.3) 21px),
                         repeating-linear-gradient(90deg,transparent,transparent 20px,rgba(255,255,255,0.3) 20px,rgba(255,255,255,0.3) 21px);
        pointer-events:none;"></div>
      <div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;
        background:rgba(255,255,255,0.04);pointer-events:none;"></div>
      <div style="position:absolute;bottom:-30px;left:-30px;width:120px;height:120px;border-radius:50%;
        background:rgba(255,255,255,0.03);pointer-events:none;"></div>

      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;position:relative;">
        <div>
          ${!isAgent ? `<div style="font-size:0.68rem;opacity:0.55;letter-spacing:0.08em;margin-bottom:2px;">${isActive ? '● نشط' : '○ غير نشط'}</div>` : ''}
          <div style="font-size:0.9rem;font-weight:700;max-width:180px;line-height:1.3;">
            ${escapeHtml(bank.name)}
          </div>
        </div>
        <div style="text-align:left;direction:ltr;">
          <div style="font-size:0.55rem;opacity:0.5;margin-bottom:2px;">DEBIT</div>
          <div style="font-size:1.1rem;font-weight:900;color:#f0c040;letter-spacing:0.05em;">◈</div>
        </div>
      </div>

      ${bank.account_number ? `
      <div style="font-size:0.88rem;letter-spacing:0.18em;direction:ltr;
        font-family:monospace;opacity:0.75;margin-bottom:12px;">
        •••• •••• ${escapeHtml(bank.account_number.slice(-4))}
      </div>` : ''}

      ${bank.card_number ? `
      <div style="font-size:0.75rem;letter-spacing:0.12em;direction:ltr;
        font-family:monospace;opacity:0.6;margin-bottom:8px;">
        ${escapeHtml(bank.card_number.replace(/(.{4})/g,'$1 ').trim())}
      </div>` : ''}

      <div style="display:flex;justify-content:space-between;align-items:center;position:relative;">
        <div>
          <div style="font-size:0.62rem;opacity:0.5;margin-bottom:2px;">صاحب البطاقة</div>
          <div style="font-size:0.78rem;font-weight:600;text-transform:uppercase;">
            ${escapeHtml(bank.card_holder||'—')}
          </div>
        </div>
        ${bank.card_pin ? `
        <div style="text-align:center;">
          <div style="font-size:0.62rem;opacity:0.5;margin-bottom:2px;">PIN</div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span id="pin-${escapeHtml(bank.id)}"
              style="font-family:monospace;font-size:0.82rem;letter-spacing:0.12em;direction:ltr;">
              ${showPin ? escapeHtml(bank.card_pin) : '••••'}
            </span>
            <button class="toggle-pin-btn" data-bankid="${escapeHtml(bank.id)}"
              style="background:rgba(255,255,255,0.12);border:none;border-radius:6px;
                color:#fff;padding:2px 6px;font-size:0.65rem;cursor:pointer;
                transition:background var(--transition-fast);">
              ${showPin ? 'إخفاء' : 'إظهار'}
            </button>
          </div>
        </div>` : ''}
      </div>`;

    card.appendChild(front);

    const stats = document.createElement('div');
    stats.style.cssText = `background:${isActive ? 'var(--glass-bg)' : 'rgba(156,163,175,0.08)'};backdrop-filter:blur(12px);padding:14px 18px;`;

    stats.innerHTML = `
      <div style="margin-bottom:10px;">
        <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text-muted);margin-bottom:5px;">
          <span>السقف اليومي</span>
          <span style="direction:ltr;">${total.toLocaleString('en-US')} / ${ceiling.toLocaleString('en-US')} (${pct}%)</span>
        </div>
        <div class="progress-bar" style="height:7px;">
          <div style="height:100%;width:${pct}%;background:${clr};border-radius:4px;
            transition:width 0.8s ease;"></div>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:0.7rem;margin-top:4px;">
          <span style="color:${clr};font-weight:600;">${pct}%</span>
          <span style="color:var(--text-muted);">
            المتبقي: <strong style="color:var(--text-primary);direction:ltr;display:inline-block;">
              ${remain.toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}
            </strong>
          </span>
        </div>
      </div>
      ${info.withdrawTotal > 0 ? `
      <div style="font-size:0.72rem;color:var(--danger);margin-bottom:8px;">
        سحوبات اليوم: <strong>${info.withdrawTotal.toLocaleString('en-US')} ${APP_CONFIG.CURRENCY_SYMBOL}</strong>
      </div>` : ''}`;

    const recentList = info.list.slice(0, 5);
    if (recentList.length) {
      const txHTML = recentList.map(d => {
        const agent    = users.find(u=>u.id===d.agent_id);
        const isDeposit = d.type === 'deposit';
        const typeLabel = isDeposit ? 'إيداع' : 'سحب';
        const typeColor = isDeposit ? 'var(--success)' : 'var(--danger)';
        return `
          <div style="display:flex;justify-content:space-between;align-items:center;
            padding:5px 0;border-bottom:1px solid var(--border-color);font-size:0.75rem;">
            <span style="color:var(--text-secondary);">${escapeHtml(agent?.display_name||'—')}</span>
            <span style="font-size:0.68rem;color:${typeColor};font-weight:600;">${typeLabel}</span>
            <span style="font-weight:700;color:${typeColor};direction:ltr;">
              ${Math.round(parseFloat(d.amount)||0).toLocaleString('en-US')}
            </span>
          </div>`;
      }).join('');

      stats.innerHTML += `
        <div style="margin-bottom:8px;">
          <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;">
            آخر ${recentList.length} عمليات اليوم
          </div>
          ${txHTML}
        </div>`;

      if (info.list.length > 5) {
        stats.innerHTML += `
          <button class="show-more-btn btn btn-secondary btn-sm"
            data-bankid="${escapeHtml(bank.id)}"
            style="width:100%;font-size:0.75rem;margin-bottom:8px;">
            عرض كل العمليات (${info.list.length})
          </button>`;
      }
    }

    const actRow = document.createElement('div');
    actRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

    const mkBtn = (label, icon, color, fn) => {
      const b = document.createElement('button');
      b.className = 'btn btn-secondary btn-sm';
      b.style.cssText = `flex:1;min-width:70px;font-size:0.72rem;justify-content:center;${color?'color:'+color+';':''}`;
      b.innerHTML = `<i data-lucide="${icon}" style="width:11px;height:11px;"></i> ${label}`;
      b.addEventListener('click', fn);
      return b;
    };

    actRow.appendChild(mkBtn('طباعة', 'printer', '', () => this._printStatement(bank, info.list, ceiling)));
    actRow.appendChild(mkBtn('مشاركة', 'share-2', 'var(--success)', () => this._shareBank(bank, info.list, total, ceiling)));
    if (AuthService.isAdmin() || AuthService.isAdminAssistant()) {
      actRow.appendChild(mkBtn('تعديل', 'pencil', 'var(--info)', () => this._openModal(bank)));
      actRow.appendChild(mkBtn('حذف', 'trash-2', 'var(--danger)', () => this._delete(bank.id, bank.name)));
    }

    stats.appendChild(actRow);
    card.appendChild(stats);
    el.appendChild(card);
  },

  // ─────────────────────────────────────────────
  // عرض جميع الإيداعات (مودال)
  // ─────────────────────────────────────────────
  _showAllDeposits(bank, list) {
    const users    = AppStore.getState('users');
    const depTotal = list.filter(d=>d.type==='deposit').reduce((s,d)=>s+Math.round(parseFloat(d.amount)||0),0);
    const wdTotal  = list.filter(d=>d.type==='bank_withdrawal').reduce((s,d)=>s+Math.round(parseFloat(d.amount)||0),0);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display='flex';
    overlay.addEventListener('click',e=>{if(e.target===overlay)document.body.removeChild(overlay);});

    const box = document.createElement('div');
    box.className='modal-box';
    box.style.maxWidth='540px';
    box.innerHTML=`
      <div class="modal-header">
        <h3 class="modal-title">جميع عمليات ${escapeHtml(bank?.name||'')} — ${escapeHtml(formatDateArabic(this._selectedDate))}</h3>
        <button class="modal-close" id="all-dep-close">✕</button>
      </div>
      <div class="table-wrapper" style="max-height:380px;overflow-y:auto;">
        <table class="data-table">
          <thead><tr><th>#</th><th>المندوب</th><th>المبلغ</th><th>نوع العملية</th><th>الوقت</th></tr></thead>
          <tbody>
            ${list.map((d,i)=>{
              const agent      = users.find(u=>u.id===d.agent_id);
              const isDeposit  = d.type === 'deposit';
              const typeLabel  = isDeposit ? 'إيداع' : 'سحب';
              const typeColor  = isDeposit ? 'var(--success)' : 'var(--danger)';
              const amtColor   = isDeposit ? 'var(--success)' : 'var(--danger)';
              return `<tr>
                <td style="font-size:0.75rem;color:var(--text-muted);">${i+1}</td>
                <td>${escapeHtml(agent?.display_name||'—')}</td>
                <td style="font-weight:700;color:${amtColor};direction:ltr;">
                  ${Math.round(parseFloat(d.amount)||0).toLocaleString('en-US')}</td>
                <td><span style="color:${typeColor};font-weight:600;font-size:0.82rem;">${typeLabel}</span></td>
                <td style="font-size:0.75rem;color:var(--text-muted);">
                  ${d.created_at?new Date(d.created_at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'—'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="font-weight:800;background:var(--bg-hover);">
              <td colspan="2" style="text-align:center;">إيداعات</td>
              <td style="color:var(--success);direction:ltr;">${depTotal.toLocaleString('en-US')}</td>
              <td colspan="2"></td>
            </tr>
            ${wdTotal > 0 ? `<tr style="font-weight:800;background:var(--bg-hover);">
              <td colspan="2" style="text-align:center;">سحوبات</td>
              <td style="color:var(--danger);direction:ltr;">${wdTotal.toLocaleString('en-US')}</td>
              <td colspan="2"></td>
            </tr>` : ''}
          </tfoot>
        </table>
      </div>`;

    box.querySelector('#all-dep-close').addEventListener('click',()=>document.body.removeChild(overlay));
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  },

  // ─────────────────────────────────────────────
  // طباعة كشف الحساب البنكي
  // ─────────────────────────────────────────────
  _printStatement(bank, list, ceiling) {
    const users    = AppStore.getState('users');
    const logoUrl  = AppStore.getState('logoUrl') || '';
    const depTotal = list.filter(d=>d.type==='deposit').reduce((s,d)=>s+Math.round(parseFloat(d.amount)||0),0);
    const wdTotal  = list.filter(d=>d.type==='bank_withdrawal').reduce((s,d)=>s+Math.round(parseFloat(d.amount)||0),0);
    const openBal  = Math.round(bank.opening_balance || 0);
    const netBal   = openBal + depTotal - wdTotal;
    const pct      = ceiling > 0 ? Math.round(depTotal / ceiling * 100) : 0;
    const remain   = Math.max(0, ceiling - depTotal);
    const fillColor = pct >= 80 ? '#dc2626' : pct >= 50 ? '#d97706' : '#059669';
    const dateStr  = typeof formatDateArabic === 'function' ? formatDateArabic(this._selectedDate) : new Date().toLocaleDateString('ar-SA');

    const rowsHTML = list.map((d, i) => {
      const agent     = users.find(u => u.id === d.agent_id);
      const isDeposit = d.type === 'deposit';
      const typeLabel = isDeposit ? 'إيداع' : 'سحب';
      const typeColor = isDeposit ? '#059669' : '#dc2626';
      const t = d.created_at
        ? new Date(d.created_at).toLocaleTimeString('ar-SA', { hour: '2-digit', minute: '2-digit' })
        : '—';
      return `<tr class="${i % 2 === 1 ? 'ps-even' : ''}">
        <td style="direction:ltr">${i + 1}</td>
        <td>${agent?.display_name || '—'}</td>
        <td style="direction:ltr;font-weight:700;color:${typeColor}">${Math.round(parseFloat(d.amount) || 0).toLocaleString('en-US')}</td>
        <td><span style="color:${typeColor};font-weight:600;">${typeLabel}</span></td>
        <td>${t}</td>
      </tr>`;
    }).join('');

    const shareText = [
      `🏦 كشف حساب بنكي — ${bank.name}`,
      `📅 ${dateStr}`,
      '─────────────────',
      openBal > 0 ? `💼 الرصيد الافتتاحي: ${openBal.toLocaleString('en-US')} ر.س` : '',
      `💰 إجمالي الإيداعات: ${depTotal.toLocaleString('en-US')} ر.س`,
      wdTotal > 0 ? `💸 إجمالي السحوبات: ${wdTotal.toLocaleString('en-US')} ر.س` : '',
      `📊 السقف اليومي: ${ceiling.toLocaleString('en-US')} ر.س`,
      `✅ نسبة الاستخدام: ${pct}%`,
      `🔹 المتبقي من السقف: ${remain.toLocaleString('en-US')} ر.س`,
      `🏦 الرصيد الحالي: ${netBal.toLocaleString('en-US')} ر.س`,
      'نظام أبو حذيفة 🔐',
    ].filter(Boolean).join('\n');

    const ts = new Date().toLocaleString('ar-SA', {
      year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });

    const contentHTML = `
      <div class="doc-header">
        <div>
          <div class="doc-title">كشف حساب بنكي</div>
          <div class="doc-sub">نظام أبو حذيفة المتكامل للصرافة والتحويلات</div>
        </div>
        <div class="doc-meta">
          ${logoUrl ? `<img class="doc-logo" src="${logoUrl}" alt="شعار">` : ''}
          <div class="doc-period">${dateStr}</div>
        </div>
      </div>

      <div class="bank-card-info">
        <div><span class="bank-info-label">اسم الحساب</span><span class="bank-info-val">${bank.name}</span></div>
        <div><span class="bank-info-label">رقم الحساب</span><span class="bank-info-val" dir="ltr">${bank.account_number || '—'}</span></div>
        <div><span class="bank-info-label">حامل البطاقة</span><span class="bank-info-val">${bank.card_holder || '—'}</span></div>
        <div><span class="bank-info-label">رقم البطاقة</span><span class="bank-info-val" dir="ltr">${bank.card_number || '—'}</span></div>
        <div><span class="bank-info-label">السقف اليومي</span><span class="bank-info-val" dir="ltr">${ceiling.toLocaleString('en-US')} ر.س</span></div>
        ${openBal > 0 ? `<div><span class="bank-info-label">الرصيد الافتتاحي</span><span class="bank-info-val" dir="ltr">${openBal.toLocaleString('en-US')} ر.س</span></div>` : ''}
        <div><span class="bank-info-label">تاريخ الكشف</span><span class="bank-info-val">${dateStr}</span></div>
      </div>

      <div style="margin-bottom:18px;">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:6px;">
          <span>نسبة استخدام السقف (إيداعات): <strong>${pct}%</strong></span>
          <span>المتبقي: <strong dir="ltr">${remain.toLocaleString('en-US')} ر.س</strong></span>
        </div>
        <div class="bank-progress-bar">
          <div style="height:100%;width:${pct}%;background:${fillColor};border-radius:4px;
            -webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead><tr><th>#</th><th>المندوب</th><th>المبلغ (ر.س)</th><th>نوع العملية</th><th>الوقت</th></tr></thead>
          <tbody>${rowsHTML}</tbody>
          <tfoot>
            <tr class="totals" style="display:table-row;">
              <td colspan="2"><strong>إجمالي الإيداعات</strong></td>
              <td style="direction:ltr;font-weight:800;color:#059669">${depTotal.toLocaleString('en-US')}</td>
              <td colspan="2"></td>
            </tr>
            ${wdTotal > 0 ? `<tr class="totals" style="display:table-row;">
              <td colspan="2"><strong>إجمالي السحوبات</strong></td>
              <td style="direction:ltr;font-weight:800;color:#dc2626">${wdTotal.toLocaleString('en-US')}</td>
              <td colspan="2"></td>
            </tr>` : ''}
            <tr class="totals" style="display:table-row;background:#f0fdf4;">
              <td colspan="2"><strong>الرصيد الحالي</strong></td>
              <td style="direction:ltr;font-weight:800;color:#059669">${netBal.toLocaleString('en-US')}</td>
              <td colspan="2"></td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div class="doc-footer">
        <span><b>نظام أبو حذيفة — ${bank.name}</b></span>
        <span>طُبع: ${ts}</span>
      </div>`;

    if (typeof PrintService !== 'undefined' && PrintService.printHTML) {
      // FIX: عنوان محدد يشمل اسم البنك والتاريخ لاسم ملف PDF دلالي
      PrintService.printHTML(contentHTML, {
        title     : `كشف_بنكي_${bank.name}_${dateStr}`,
        logo      : logoUrl,
        shareText,
        periodText: dateStr,
      });
    } else if (window.showToast) {
      showToast('خدمة الطباعة غير متوفرة', 'error');
    }
  },

  // ─────────────────────────────────────────────
  // مشاركة كشف الحساب البنكي مع تفاصيل العمليات
  // ─────────────────────────────────────────────
  // FIX: إضافة list كمعامل ثانٍ لعرض تفاصيل العمليات (المندوب، الوقت، النوع، المبلغ)
  _shareBank(bank, list, total, ceiling) {
    if (!list || !list.length) {
      return this._shareBankSummary(bank, total, ceiling);
    }

    const users = AppStore.getState('users') || [];
    const date  = formatDateArabic(this._selectedDate);
    const tz    = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.TIMEZONE) ? APP_CONFIG.TIMEZONE : 'Asia/Riyadh';

    const rows = list.map((op, i) => {
      const time = op.created_at
        ? new Date(op.created_at).toLocaleTimeString('ar-SA', {
            hour: '2-digit', minute: '2-digit', hour12: true, timeZone: tz,
          })
        : '—';
      const type      = op.type === 'deposit' ? 'إيداع' : 'سحب';
      const agent     = users.find(u => u.id === op.agent_id);
      const agentName = agent?.display_name || '—';
      const amt       = Math.round(parseFloat(op.amount) || 0);
      return `${String(i + 1).padStart(2, ' ')}. ${time} | ${agentName} | ${type} | ${amt.toLocaleString('en-US')} ر.س`;
    });

    const deposits      = list.filter(o => o.type === 'deposit');
    const withdrawals   = list.filter(o => o.type !== 'deposit');
    const totalDep      = deposits.reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
    const totalWd       = withdrawals.reduce((s, o) => s + (parseFloat(o.amount) || 0), 0);
    const net           = totalDep - totalWd;
    const pct           = ceiling > 0 ? Math.round((totalDep / ceiling) * 100) : 0;
    const remain        = Math.max(0, ceiling - totalDep);

    const text = [
      `🏦 كشف حساب بنكي — ${bank.name}`,
      `📅 ${date}`,
      bank.account_number ? `🔢 رقم الحساب: ${bank.account_number}` : '',
      bank.card_number    ? `💳 رقم البطاقة: ${bank.card_number}`   : '',
      bank.card_holder    ? `👤 صاحب الحساب: ${bank.card_holder}`   : '',
      `─────────────────`,
      ...rows,
      `─────────────────`,
      `📥 إجمالي الإيداعات: ${Math.round(totalDep).toLocaleString('en-US')} ر.س`,
      `📤 إجمالي السحوبات: ${Math.round(totalWd).toLocaleString('en-US')} ر.س`,
      `💰 الصافي: ${Math.round(net).toLocaleString('en-US')} ر.س`,
      `🎯 السقف اليومي: ${Math.round(ceiling).toLocaleString('en-US')} ر.س`,
      `📊 نسبة الاستخدام: ${pct}%`,
      `✅ المتبقي: ${Math.round(remain).toLocaleString('en-US')} ر.س`,
      `─────────────────`,
      `نظام أبو حذيفة 🔐`,
    ].filter(Boolean).join('\n');

    copyToClipboard(text, 'تم نسخ كشف الحساب البنكي');
  },

  // ملخص مختصر عند غياب العمليات
  _shareBankSummary(bank, total, ceiling) {
    const pct    = ceiling > 0 ? Math.round((total / ceiling) * 100) : 0;
    const remain = Math.max(0, ceiling - total);
    const text   = [
      `🏦 ${bank.name}`,
      `📅 ${formatDateArabic(this._selectedDate)}`,
      bank.account_number ? `🔢 رقم الحساب: ${bank.account_number}` : '',
      bank.card_number    ? `💳 رقم البطاقة: ${bank.card_number}`   : '',
      bank.card_holder    ? `👤 صاحب الحساب: ${bank.card_holder}`   : '',
      `─────────────────`,
      `💰 إجمالي الإيداعات: ${Math.round(total).toLocaleString('en-US')} ر.س`,
      `🎯 السقف اليومي: ${Math.round(ceiling).toLocaleString('en-US')} ر.س`,
      `📊 نسبة الاستخدام: ${pct}%`,
      `✅ المتبقي: ${Math.round(remain).toLocaleString('en-US')} ر.س`,
      `─────────────────`,
      `نظام أبو حذيفة 🔐`,
    ].filter(Boolean).join('\n');
    copyToClipboard(text, 'تم نسخ ملخص الحساب البنكي');
  },

  // ─────────────────────────────────────────────
  // مودال إضافة/تعديل
  // ─────────────────────────────────────────────
  _buildModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e=>{ if(e.target===overlay)this._closeModal(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.id = 'bank-modal-box';

    const companies = AppStore.getState('companies');

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" id="bank-modal-title">إضافة حساب بنكي</h3>
        <button class="modal-close" id="bank-modal-close">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">اسم الحساب <span class="required">*</span></label>
          <input id="bk-name" type="text" class="form-control" placeholder="مثال: بنك الراجحي — شركة زغلول">
        </div>
        <div class="form-group">
          <label class="form-label">رقم الحساب</label>
          <input id="bk-acc-num" type="text" class="form-control" dir="ltr" placeholder="SA0000000000000000">
        </div>
        <div class="form-group">
          <label class="form-label">رقم البطاقة</label>
          <input id="bk-card-num" type="text" class="form-control" dir="ltr" placeholder="4444 3333 2222 1111">
        </div>
        <div class="form-group">
          <label class="form-label">حامل البطاقة</label>
          <input id="bk-card-holder" type="text" class="form-control" placeholder="الاسم">
        </div>
        <div class="form-group">
          <label class="form-label">الرمز السري (PIN)</label>
          <input id="bk-pin" type="text" class="form-control" dir="ltr" placeholder="••••" maxlength="10">
        </div>
        <div class="form-group">
          <label class="form-label">الشركة</label>
          <select id="bk-company" class="form-control">
            <option value="">— بدون شركة —</option>
            ${companies.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">السقف المالي اليومي <span class="required">*</span></label>
          <input id="bk-ceiling" type="number" class="form-control" placeholder="50000" min="1">
        </div>
        <div class="form-group">
          <label class="form-label">وقت تجديد السقف</label>
          <select id="bk-reset" class="form-control">
            <option value="00:00:00">منتصف الليل (00:00)</option>
            <option value="23:00:00">الحادية عشرة مساءً (23:00)</option>
          </select>
        </div>
      </div>
      <div id="bk-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="bk-save-btn" class="btn btn-primary" style="flex:2;">حفظ</button>
        <button id="bk-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    box.querySelector('#bank-modal-close').addEventListener('click', ()=>this._closeModal());
    box.querySelector('#bk-cancel-btn').addEventListener('click',   ()=>this._closeModal());
    box.querySelector('#bk-save-btn').addEventListener('click',     ()=>this._save());

    overlay.appendChild(box);
    return overlay;
  },

  _openModal(bank=null) {
    this._editId = bank?.id||null;
    const box = document.getElementById('bank-modal-box');
    if (!box) return;
    box.querySelector('#bank-modal-title').textContent = bank?'تعديل حساب بنكي':'إضافة حساب بنكي';
    box.querySelector('#bk-name').value        = bank?.name||'';
    box.querySelector('#bk-acc-num').value     = bank?.account_number||'';
    box.querySelector('#bk-card-num').value    = bank?.card_number||'';
    box.querySelector('#bk-card-holder').value = bank?.card_holder||'';
    box.querySelector('#bk-pin').value         = bank?.card_pin||'';
    box.querySelector('#bk-company').value     = bank?.company_id||'';
    box.querySelector('#bk-ceiling').value     = bank?.financial_ceiling||'';
    box.querySelector('#bk-reset').value       = bank?.reset_time||'00:00:00';
    box.querySelector('#bk-error').textContent = '';
    this._modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },

  _closeModal() {
    if (this._modal) {
      this._modal.classList.add('is-closing');
      setTimeout(() => {
        if (this._modal) {
          this._modal.style.display = 'none';
          this._modal.classList.remove('is-closing');
        }
        document.body.style.overflow = '';
      }, 220);
    }
    this._editId = null;
  },

  async _save() {
    const box    = document.getElementById('bank-modal-box');
    const errEl  = box.querySelector('#bk-error');
    const name   = box.querySelector('#bk-name').value.trim();
    const ceiling= parseFloat(box.querySelector('#bk-ceiling').value);

    if (!name)             { errEl.textContent='اسم الحساب مطلوب'; return; }
    if (!ceiling||ceiling<1){ errEl.textContent='السقف المالي مطلوب'; return; }

    const data = {
      name, financial_ceiling: ceiling,
      account_number : box.querySelector('#bk-acc-num').value.trim()||null,
      card_number    : box.querySelector('#bk-card-num').value.trim()||null,
      card_holder    : box.querySelector('#bk-card-holder').value.trim()||null,
      card_pin       : box.querySelector('#bk-pin').value.trim()||null,
      company_id     : box.querySelector('#bk-company').value||null,
      reset_time     : box.querySelector('#bk-reset').value,
    };

    const saveBtn = box.querySelector('#bk-save-btn');
    const restore = setButtonLoading(saveBtn);

    const result = this._editId
      ? await repo.update('bank_accounts', this._editId, data)
      : await repo.create('bank_accounts', data);
    restore();

    if (isOk(result)) {
      showToast(this._editId?'تم تعديل الحساب':'تم إضافة الحساب', 'success');
      await AppStore.refreshData();
      this._closeModal();
      await this._load();
    } else {
      errEl.textContent = result.error;
    }
  },

  async _delete(id, name) {
    const confirmed = await confirmDialog(
      `حذف الحساب "${name}"؟ ستُحذف جميع البيانات المرتبطة به.`,
      'حذف', 'إلغاء', 'danger'
    );
    if (!confirmed) return;
    const result = await repo.delete('bank_accounts', id);
    if (isOk(result)) {
      showToast('تم الحذف', 'success');
      await AppStore.refreshData();
      await this._load();
    } else {
      showToast(`فشل الحذف: ${result.error}`, 'error');
    }
  },

  async onResume() { await this._load(); },
};

window.BankAccountsComponent = BankAccountsComponent;
console.log('✅ BankAccountsComponent v3.0 محمّل');
