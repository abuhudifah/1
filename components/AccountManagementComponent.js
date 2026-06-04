/**
 * components/AccountManagementComponent.js
 * نظام أبو حذيفة — إدارة الحسابات المحاسبية (للمدير فقط)
 * عرض account_balances + account_ledger مع كشف حساب لكل حساب
 */
'use strict';

const AccountManagementComponent = {
  _selectedAccount: null,
  _stmtPage       : 1,
  _stmtPageSize   : 30,

  async render(container) {
    if (!AuthService.isAdmin()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">إدارة الحسابات للمدير فقط</div></div>`;
      return;
    }

    container.innerHTML = '';
    const wrap = document.createElement('div');

    const title = document.createElement('h2');
    title.style.cssText = 'font-size:1.2rem;font-weight:700;color:var(--text-primary);margin-bottom:20px;';
    title.textContent = 'إدارة الحسابات المحاسبية';
    wrap.appendChild(title);

    /* ── بطاقة ملخص الأرصدة ── */
    const balancesCard = document.createElement('div');
    balancesCard.className = 'glass-card';
    balancesCard.style.marginBottom = '20px';

    const balTitle = document.createElement('h3');
    balTitle.style.cssText = 'font-size:0.95rem;font-weight:700;margin-bottom:12px;';
    balTitle.textContent = '📊 الأرصدة الحالية لجميع الحسابات';
    balancesCard.appendChild(balTitle);

    const balancesEl = document.createElement('div');
    balancesEl.id = 'acct-balances';
    balancesEl.innerHTML = `<div class="skeleton" style="height:50px;border-radius:10px;margin-bottom:8px;"></div>`.repeat(3);
    balancesCard.appendChild(balancesEl);
    wrap.appendChild(balancesCard);

    /* ── كشف الحساب ── */
    const stmtCard = document.createElement('div');
    stmtCard.className = 'glass-card';
    stmtCard.id = 'acct-stmt-card';
    stmtCard.style.display = 'none';

    stmtCard.innerHTML = `
      <h3 style="font-size:0.95rem;font-weight:700;margin-bottom:12px;">📄 كشف الحساب</h3>
      <div style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:12px;align-items:flex-end;">
        <div class="form-group" style="margin:0;flex:1;min-width:120px;">
          <label class="form-label" style="font-size:0.78rem;">من تاريخ</label>
          <input id="acct-stmt-from" type="date" class="form-control" style="padding:7px;font-size:0.85rem;">
        </div>
        <div class="form-group" style="margin:0;flex:1;min-width:120px;">
          <label class="form-label" style="font-size:0.78rem;">إلى تاريخ</label>
          <input id="acct-stmt-to" type="date" class="form-control"
            style="padding:7px;font-size:0.85rem;" value="${getCurrentSaudiDate()}">
        </div>
        <button id="acct-stmt-btn" class="btn btn-primary btn-sm">عرض الكشف</button>
        <button id="acct-stmt-print" class="btn btn-secondary btn-sm">
          <i data-lucide="printer" style="width:14px;height:14px"></i> طباعة
        </button>
      </div>
      <div id="acct-stmt-list"></div>
      <div id="acct-stmt-pager" style="display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:12px;"></div>`;

    wrap.appendChild(stmtCard);
    container.appendChild(wrap);

    await this._loadBalances();
    if (window.lucide) lucide.createIcons();
  },

  /* ── تحميل الأرصدة ── */
  async _loadBalances() {
    const el = document.getElementById('acct-balances');
    if (!el) return;

    let balances = [];
    if (isOnline()) {
      const { data } = await supabaseClient
        .from(TABLES.ACCOUNT_BALANCES)
        .select('*')
        .order('account_id');
      balances = data || [];
    } else {
      balances = await db.account_balances.toArray();
    }

    if (!balances.length) {
      el.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📒</div>
        <div class="empty-state-text">لا توجد حسابات محاسبية بعد</div></div>`;
      return;
    }

    const prefixMeta = {
      [ACCOUNT_PREFIXES.AGENT]    : { label: 'مندوب',   icon: '👤' },
      [ACCOUNT_PREFIXES.COMPANY]  : { label: 'شركة',    icon: '🏢' },
      [ACCOUNT_PREFIXES.BANK]     : { label: 'بنك',     icon: '🏦' },
      [ACCOUNT_PREFIXES.CUSTOMER] : { label: 'عميل',    icon: '👥' },
      [ACCOUNT_PREFIXES.EXPENSE]  : { label: 'مصروف',   icon: '💸' },
    };

    const users       = AppStore.getState('users');
    const bankAccounts= AppStore.getState('bankAccounts');

    /* عنوان بشري للحساب */
    const resolveAccountName = (accountId) => {
      const prefix = Object.keys(prefixMeta).find(p => accountId.startsWith(p));
      if (!prefix) return { name: accountId, meta: { label: 'عام', icon: '📌' } };

      const rawId = accountId.slice(prefix.length);
      let name = rawId;

      if (prefix === ACCOUNT_PREFIXES.AGENT) {
        const u = users.find(u => u.id === rawId);
        if (u) name = u.display_name;
      } else if (prefix === ACCOUNT_PREFIXES.BANK) {
        const b = bankAccounts.find(b => b.id === rawId);
        if (b) name = b.name;
      }

      return { name, meta: prefixMeta[prefix] };
    };

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>معرف الحساب</th><th>النوع</th><th>الاسم</th>
          <th>الرصيد</th><th>آخر تحديث</th><th></th>
        </tr></thead>
        <tbody>
          ${balances.map(b => {
            const { name, meta } = resolveAccountName(b.account_id);
            const bal = parseFloat(b.balance);
            return `<tr>
              <td style="direction:ltr;font-family:monospace;font-size:0.75rem;color:var(--text-muted);">
                ${escapeHtml(b.account_id)}
              </td>
              <td><span style="font-size:0.88rem;">${meta.icon} ${escapeHtml(meta.label)}</span></td>
              <td style="font-weight:600;">${escapeHtml(name)}</td>
              <td style="font-weight:700;color:${bal >= 0 ? 'var(--success)' : 'var(--danger)'};">
                ${formatCurrency(bal)}
              </td>
              <td style="font-size:0.78rem;color:var(--text-muted);">${timeAgo(b.last_updated)}</td>
              <td>
                <button class="btn btn-secondary btn-sm view-stmt-btn"
                  data-account="${escapeHtml(b.account_id)}" title="عرض الكشف">
                  <i data-lucide="file-text" style="width:12px;height:12px"></i>
                </button>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    el.innerHTML = '';
    el.appendChild(table);

    el.querySelectorAll('.view-stmt-btn').forEach(btn => {
      btn.addEventListener('click', () => this._showStatement(btn.dataset.account));
    });

    if (window.lucide) lucide.createIcons();
  },

  /* ── عرض كشف الحساب ── */
  async _showStatement(accountId) {
    this._selectedAccount = accountId;
    this._stmtPage        = 1;

    const stmtCard = document.getElementById('acct-stmt-card');
    if (stmtCard) stmtCard.style.display = 'block';

    document.getElementById('acct-stmt-btn')?.addEventListener('click', () => this._loadStatement());
    document.getElementById('acct-stmt-print')?.addEventListener('click', () => window.print());

    stmtCard?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    await this._loadStatement();
  },

  async _loadStatement() {
    const listEl  = document.getElementById('acct-stmt-list');
    const pagerEl = document.getElementById('acct-stmt-pager');
    if (!listEl || !this._selectedAccount) return;

    const from = document.getElementById('acct-stmt-from')?.value || '2020-01-01';
    const to   = document.getElementById('acct-stmt-to')?.value   || getCurrentSaudiDate();

    listEl.innerHTML = `<div class="skeleton" style="height:44px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(4);

    const result = await AccountingService.getStatement(
      this._selectedAccount, from, to,
      { page: this._stmtPage, pageSize: this._stmtPageSize }
    );

    if (!isOk(result)) {
      listEl.innerHTML = `<div class="empty-state"><div class="empty-state-text">${escapeHtml(result.error)}</div></div>`;
      return;
    }

    const { entries, openingBalance, closingBalance, totalDebit, totalCredit, count } = result.data;

    /* ملخص الكشف */
    const summary = document.createElement('div');
    summary.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:14px;';
    summary.innerHTML = `
      <div class="glass-card" style="padding:10px;text-align:center;">
        <div style="font-size:0.75rem;color:var(--text-muted);">الرصيد الافتتاحي</div>
        <div style="font-weight:700;color:var(--info);">${formatCurrency(openingBalance)}</div>
      </div>
      <div class="glass-card" style="padding:10px;text-align:center;">
        <div style="font-size:0.75rem;color:var(--text-muted);">إجمالي المدين</div>
        <div style="font-weight:700;color:var(--success);">${formatCurrency(totalDebit)}</div>
      </div>
      <div class="glass-card" style="padding:10px;text-align:center;">
        <div style="font-size:0.75rem;color:var(--text-muted);">إجمالي الدائن</div>
        <div style="font-weight:700;color:var(--danger);">${formatCurrency(totalCredit)}</div>
      </div>
      <div class="glass-card" style="padding:10px;text-align:center;">
        <div style="font-size:0.75rem;color:var(--text-muted);">الرصيد الختامي</div>
        <div style="font-weight:700;color:${closingBalance >= 0 ? 'var(--success)' : 'var(--danger)'};">
          ${formatCurrency(closingBalance)}</div>
      </div>`;

    if (!entries.length) {
      listEl.innerHTML = '';
      listEl.appendChild(summary);
      const empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `<div class="empty-state-icon">📄</div>
        <div class="empty-state-text">لا توجد قيود في هذه الفترة</div>`;
      listEl.appendChild(empty);
      return;
    }

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>التاريخ</th><th>رقم القيد</th><th>البيان</th>
          <th>مدين</th><th>دائن</th>
        </tr></thead>
        <tbody>
          ${entries.map(e => `<tr>
            <td style="font-size:0.82rem;">${escapeHtml(formatDateArabic(e.date))}</td>
            <td style="font-family:monospace;font-size:0.75rem;direction:ltr;color:var(--text-muted);">
              ${escapeHtml(e.voucher_number || '—')}
            </td>
            <td style="font-size:0.85rem;">${escapeHtml(e.description || '—')}</td>
            <td style="color:var(--success);font-weight:${e.debit > 0 ? '700' : '400'};">
              ${e.debit > 0 ? formatCurrency(e.debit) : '—'}
            </td>
            <td style="color:var(--danger);font-weight:${e.credit > 0 ? '700' : '400'};">
              ${e.credit > 0 ? formatCurrency(e.credit) : '—'}
            </td>
          </tr>`).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(summary);
    listEl.appendChild(table);

    /* ترقيم */
    if (pagerEl) {
      pagerEl.innerHTML = '';
      const pages = Math.ceil((count || entries.length) / this._stmtPageSize);
      if (pages > 1) {
        for (let p = 1; p <= Math.min(pages, 10); p++) {
          const pbtn = document.createElement('button');
          pbtn.className = p === this._stmtPage ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
          pbtn.textContent = p;
          pbtn.style.minWidth = '36px';
          pbtn.addEventListener('click', () => { this._stmtPage = p; this._loadStatement(); });
          pagerEl.appendChild(pbtn);
        }
      }
    }

    if (window.lucide) lucide.createIcons();
  },
};

window.AccountManagementComponent = AccountManagementComponent;
console.log('✅ AccountManagementComponent.js محمّل');
