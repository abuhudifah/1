/**
 * components/BankAccountsComponent.js — v2.0
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

    /* مودال إضافة/تعديل */
    this._modal = this._buildModal();
    wrap.appendChild(this._modal);

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
      /* المندوب: فقط الحسابات التي أودع فيها في التاريخ المحدد */
      let depositedIds = [];
      try {
        if (isOnline()) {
          const { data } = await supabaseClient.from('transactions')
            .select('bank_account_id')
            .eq('date',this._selectedDate).eq('type','deposit').eq('agent_id',uid);
          depositedIds = [...new Set((data||[]).map(d=>d.bank_account_id).filter(Boolean))];
        } else {
          const deps = await db.transactions.where('[date+agent_id]').equals([this._selectedDate,uid])
            .filter(t=>t.type==='deposit'&&t.bank_account_id).toArray();
          depositedIds = [...new Set(deps.map(d=>d.bank_account_id))];
        }
      } catch { }

      if (!depositedIds.length) {
        el.innerHTML=`<div class="empty-state" style="grid-column:1/-1;">
          <div class="empty-state-icon">🏦</div>
          <div class="empty-state-text">لا توجد إيداعات في ${escapeHtml(formatDateArabic(this._selectedDate))}</div>
        </div>`; return;
      }
      bankAccounts = (AppStore.getState('bankAccounts')||[]).filter(b=>depositedIds.includes(b.id));
    } else {
      bankAccounts = AppStore.getState('bankAccounts')||[];
    }

    if (!bankAccounts.length) {
      el.innerHTML=`<div class="empty-state" style="grid-column:1/-1;">
        <div class="empty-state-icon">🏦</div>
        <div class="empty-state-text">لا توجد حسابات بنكية</div>
      </div>`; return;
    }

    /* جلب إجماليات الإيداعات لكل حساب */
    let dayDeposits = {};
    try {
      if (isOnline()) {
        const { data } = await supabaseClient.from('transactions')
          .select('bank_account_id,amount,agent_id,created_at')
          .eq('date',this._selectedDate).eq('type','deposit').eq('is_reversed',false)
          .order('created_at',{ascending:false});
        (data||[]).forEach(d=>{
          if (!d.bank_account_id) return;
          if (!dayDeposits[d.bank_account_id]) dayDeposits[d.bank_account_id]={total:0,list:[]};
          dayDeposits[d.bank_account_id].total += Math.round(parseFloat(d.amount)||0);
          dayDeposits[d.bank_account_id].list.push(d);
        });
      }
    } catch { }

    /* ترتيب حسب آخر نشاط */
    const sorted = [...bankAccounts].sort((a,b)=>{
      const aLast = dayDeposits[a.id]?.list?.[0]?.created_at||'';
      const bLast = dayDeposits[b.id]?.list?.[0]?.created_at||'';
      return bLast.localeCompare(aLast);
    });

    el.innerHTML = '';
    const users = AppStore.getState('users');

    sorted.forEach(bank=>{
      const info    = dayDeposits[bank.id]||{total:0,list:[]};
      const ceiling = Math.round(bank.financial_ceiling||0);
      const total   = info.total;
      const pct     = ceiling>0?Math.min(100,Math.round(total/ceiling*100)):0;
      const remain  = Math.max(0,ceiling-total);
      const clr     = pct>=80?'#dc2626':pct>=50?'#d97706':'#059669';
      const showPin = this._showPins.has(bank.id);

      const card = document.createElement('div');
      card.style.cssText = `
        border-radius:20px;overflow:hidden;
        box-shadow:0 12px 40px rgba(0,0,0,0.18);
        transition:transform var(--transition-normal),box-shadow var(--transition-normal);
        cursor:default;`;
      card.addEventListener('mouseenter',()=>{ card.style.transform='translateY(-4px)'; card.style.boxShadow='0 20px 56px rgba(0,0,0,0.25)'; });
      card.addEventListener('mouseleave',()=>{ card.style.transform=''; card.style.boxShadow='0 12px 40px rgba(0,0,0,0.18)'; });

      /* ── وجه البطاقة (تصميم البنك الأهلي) ── */
      const front = document.createElement('div');
      front.style.cssText = `
        background:linear-gradient(135deg,#1a2942 0%,#243b6e 50%,#1a2942 100%);
        padding:22px 20px 18px;color:#fff;position:relative;min-height:190px;`;

      /* شبكة اللوغو */
      front.innerHTML = `
        <!-- خلفية شبكية ديكورية -->
        <div style="position:absolute;inset:0;opacity:0.05;
          background-image:repeating-linear-gradient(0deg,transparent,transparent 20px,rgba(255,255,255,0.3) 20px,rgba(255,255,255,0.3) 21px),
                           repeating-linear-gradient(90deg,transparent,transparent 20px,rgba(255,255,255,0.3) 20px,rgba(255,255,255,0.3) 21px);
          pointer-events:none;"></div>
        <!-- دائرة ديكورية -->
        <div style="position:absolute;top:-40px;right:-40px;width:160px;height:160px;border-radius:50%;
          background:rgba(255,255,255,0.04);pointer-events:none;"></div>
        <div style="position:absolute;bottom:-30px;left:-30px;width:120px;height:120px;border-radius:50%;
          background:rgba(255,255,255,0.03);pointer-events:none;"></div>

        <!-- رأس البطاقة -->
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;position:relative;">
          <div>
            <div style="font-size:0.68rem;opacity:0.55;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:2px;">
              نظام أبو حذيفة
            </div>
            <div style="font-size:0.9rem;font-weight:700;max-width:180px;line-height:1.3;">
              ${escapeHtml(bank.name)}
            </div>
          </div>
          <div style="text-align:left;direction:ltr;">
            <div style="font-size:0.55rem;opacity:0.5;margin-bottom:2px;">DEBIT</div>
            <div style="font-size:1.1rem;font-weight:900;color:#f0c040;letter-spacing:0.05em;">◈</div>
          </div>
        </div>

        <!-- رقم الحساب -->
        ${bank.account_number?`
        <div style="font-size:0.88rem;letter-spacing:0.18em;direction:ltr;
          font-family:monospace;opacity:0.75;margin-bottom:12px;">
          •••• •••• ${escapeHtml(bank.account_number.slice(-4))}
        </div>`:''}

        <!-- رقم البطاقة -->
        ${bank.card_number?`
        <div style="font-size:0.75rem;letter-spacing:0.12em;direction:ltr;
          font-family:monospace;opacity:0.6;margin-bottom:8px;">
          ${escapeHtml(bank.card_number.replace(/(.{4})/g,'$1 ').trim())}
        </div>`:''}

        <!-- PIN + حامل البطاقة -->
        <div style="display:flex;justify-content:space-between;align-items:center;position:relative;">
          <div>
            <div style="font-size:0.62rem;opacity:0.5;margin-bottom:2px;">صاحب البطاقة</div>
            <div style="font-size:0.78rem;font-weight:600;text-transform:uppercase;">
              ${escapeHtml(bank.card_holder||'—')}
            </div>
          </div>
          ${bank.card_pin?`
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
                ${showPin?'إخفاء':'إظهار'}
              </button>
            </div>
          </div>`:''}
        </div>`;

      card.appendChild(front);

      /* ── قسم التقدم والإحصائيات ── */
      const stats = document.createElement('div');
      stats.style.cssText = 'background:var(--glass-bg);backdrop-filter:blur(12px);padding:14px 18px;';

      /* شريط التقدم */
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
        </div>`;

      /* آخر 5 إيداعات */
      const depList = info.list.slice(0,5);
      if (depList.length) {
        const depHTML = depList.map(d=>{
          const agent = users.find(u=>u.id===d.agent_id);
          return `
            <div style="display:flex;justify-content:space-between;align-items:center;
              padding:5px 0;border-bottom:1px solid var(--border-color);font-size:0.75rem;">
              <span style="color:var(--text-secondary);">${escapeHtml(agent?.display_name||'—')}</span>
              <span style="font-weight:700;color:var(--info);direction:ltr;">
                ${Math.round(parseFloat(d.amount)||0).toLocaleString('en-US')}
              </span>
            </div>`;
        }).join('');

        stats.innerHTML += `
          <div style="margin-bottom:8px;">
            <div style="font-size:0.72rem;font-weight:700;color:var(--text-muted);margin-bottom:6px;">
              آخر ${depList.length} إيداعات اليوم
            </div>
            ${depHTML}
          </div>`;

        if (info.list.length>5) {
          stats.innerHTML += `
            <button class="show-more-btn btn btn-secondary btn-sm"
              data-bankid="${escapeHtml(bank.id)}"
              style="width:100%;font-size:0.75rem;margin-bottom:8px;">
              عرض كل الإيداعات (${info.list.length})
            </button>`;
        }
      }

      /* أزرار الإجراءات */
      const actRow = document.createElement('div');
      actRow.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';

      const mkBtn = (label, icon, color, fn)=>{
        const b = document.createElement('button');
        b.className = 'btn btn-secondary btn-sm';
        b.style.cssText = `flex:1;min-width:70px;font-size:0.72rem;justify-content:center;${color?'color:'+color+';':''}`;
        b.innerHTML = `<i data-lucide="${icon}" style="width:11px;height:11px;"></i> ${label}`;
        b.addEventListener('click', fn);
        return b;
      };

      actRow.appendChild(mkBtn('طباعة','printer','',()=>this._printStatement(bank,info.list,ceiling)));
      actRow.appendChild(mkBtn('مشاركة','share-2','var(--success)',()=>this._shareBank(bank,total,ceiling)));
      if (AuthService.isAdmin()||AuthService.isAdminAssistant()) {
        actRow.appendChild(mkBtn('تعديل','pencil','var(--info)',()=>this._openModal(bank)));
        actRow.appendChild(mkBtn('حذف','trash-2','var(--danger)',()=>this._delete(bank.id,bank.name)));
      }

      stats.appendChild(actRow);
      card.appendChild(stats);
      el.appendChild(card);
    });

    /* ربط أحداث PIN و "عرض المزيد" */
    el.querySelectorAll('.toggle-pin-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const bid = btn.dataset.bankid;
        if (this._showPins.has(bid)) this._showPins.delete(bid);
        else this._showPins.add(bid);
        this._load();
      });
    });

    el.querySelectorAll('.show-more-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const bid  = btn.dataset.bankid;
        const bank = bankAccounts.find(b=>b.id===bid);
        const info = dayDeposits[bid]||{list:[]};
        this._showAllDeposits(bank, info.list);
      });
    });

    if (window.lucide) lucide.createIcons();
  },

  // ─────────────────────────────────────────────
  // عرض جميع الإيداعات (مودال)
  // ─────────────────────────────────────────────
  _showAllDeposits(bank, list) {
    const users = AppStore.getState('users');
    const total = list.reduce((s,d)=>s+Math.round(parseFloat(d.amount)||0),0);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display='flex';
    overlay.addEventListener('click',e=>{if(e.target===overlay)document.body.removeChild(overlay);});

    const box = document.createElement('div');
    box.className='modal-box';
    box.style.maxWidth='500px';
    box.innerHTML=`
      <div class="modal-header">
        <h3 class="modal-title">جميع إيداعات ${escapeHtml(bank?.name||'')} — ${escapeHtml(formatDateArabic(this._selectedDate))}</h3>
        <button class="modal-close" id="all-dep-close">✕</button>
      </div>
      <div class="table-wrapper" style="max-height:380px;overflow-y:auto;">
        <table class="data-table">
          <thead><tr><th>#</th><th>المندوب</th><th>المبلغ</th><th>الوقت</th></tr></thead>
          <tbody>
            ${list.map((d,i)=>{
              const agent = users.find(u=>u.id===d.agent_id);
              return `<tr>
                <td style="font-size:0.75rem;color:var(--text-muted);">${i+1}</td>
                <td>${escapeHtml(agent?.display_name||'—')}</td>
                <td style="font-weight:700;color:var(--info);direction:ltr;">
                  ${Math.round(parseFloat(d.amount)||0).toLocaleString('en-US')}</td>
                <td style="font-size:0.75rem;color:var(--text-muted);">
                  ${d.created_at?new Date(d.created_at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'—'}
                </td>
              </tr>`;
            }).join('')}
          </tbody>
          <tfoot>
            <tr style="font-weight:800;background:var(--bg-hover);">
              <td colspan="2" style="text-align:center;">الإجمالي</td>
              <td style="color:var(--success);direction:ltr;">${total.toLocaleString('en-US')}</td>
              <td></td>
            </tr>
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
  _printStatement(bank, deposits, ceiling) {
    const users = AppStore.getState('users');
    const total = deposits.reduce((s,d)=>s+Math.round(parseFloat(d.amount)||0),0);
    const pct   = ceiling>0?Math.round(total/ceiling*100):0;

    const w = window.open('','_blank','width=800,height=600');
    w.document.write(`<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <title>كشف حساب بنكي — ${bank.name}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;600;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'IBM Plex Sans Arabic',sans-serif;padding:30px;color:#0f172a;direction:rtl;}
    .header{display:flex;justify-content:space-between;align-items:flex-start;
      border-bottom:3px solid #0f172a;padding-bottom:16px;margin-bottom:20px;}
    .header h1{font-size:18pt;font-weight:800;}
    .header p{font-size:9pt;color:#64748b;margin-top:4px;}
    .card-info{background:#f8fafc;border-radius:12px;padding:16px;
      display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:20px;}
    .info-item label{font-size:8pt;color:#64748b;display:block;}
    .info-item value{font-size:10pt;font-weight:700;}
    .progress-wrap{margin-bottom:20px;}
    .progress-bar{height:8px;background:#e2e8f0;border-radius:4px;margin-top:4px;}
    .progress-fill{height:100%;border-radius:4px;
      background:${pct>=80?'#dc2626':pct>=50?'#d97706':'#059669'};}
    table{width:100%;border-collapse:collapse;font-size:10pt;}
    thead{background:#0f172a;color:#fff;}
    th{padding:9px 12px;font-size:10pt;font-weight:700;text-align:right;}
    td{padding:8px 12px;border-bottom:1px solid #e2e8f0;}
    tfoot td{font-weight:800;background:#f1f5f9;}
    .footer{margin-top:20px;border-top:1px solid #e2e8f0;padding-top:10px;
      display:flex;justify-content:space-between;font-size:8pt;color:#64748b;}
    @media print{body{padding:15px;}}
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>كشف حساب بنكي</h1>
      <p>نظام أبو حذيفة المتكامل للصرافة والتحويلات</p>
    </div>
    <div style="text-align:left;">
      <p style="font-size:9pt;color:#64748b;">تاريخ الطباعة</p>
      <p style="font-size:10pt;font-weight:700;">${new Date().toLocaleDateString('ar-SA')}</p>
    </div>
  </div>

  <div class="card-info">
    <div class="info-item"><label>اسم الحساب</label><br><strong>${bank.name}</strong></div>
    <div class="info-item"><label>رقم الحساب</label><br><strong dir="ltr">${bank.account_number||'—'}</strong></div>
    <div class="info-item"><label>حامل البطاقة</label><br><strong>${bank.card_holder||'—'}</strong></div>
    <div class="info-item"><label>رقم البطاقة</label><br><strong dir="ltr">${bank.card_number||'—'}</strong></div>
    <div class="info-item"><label>السقف المالي اليومي</label><br><strong dir="ltr">${ceiling.toLocaleString('en-US')} ر.س</strong></div>
    <div class="info-item"><label>تاريخ الكشف</label><br><strong>${formatDateArabic(this._selectedDate)}</strong></div>
  </div>

  <div class="progress-wrap">
    <div style="display:flex;justify-content:space-between;font-size:9pt;margin-bottom:4px;">
      <span>نسبة استخدام السقف: <strong>${pct}%</strong></span>
      <span>المتبقي: <strong dir="ltr">${Math.max(0,ceiling-total).toLocaleString('en-US')} ر.س</strong></span>
    </div>
    <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;"></div></div>
  </div>

  <table>
    <thead><tr><th>#</th><th>المندوب</th><th>المبلغ (ر.س)</th><th>وقت الإيداع</th></tr></thead>
    <tbody>
      ${deposits.map((d,i)=>{
        const agent = users.find(u=>u.id===d.agent_id);
        const t = d.created_at?new Date(d.created_at).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'}):'—';
        return `<tr>
          <td>${i+1}</td>
          <td>${agent?.display_name||'—'}</td>
          <td dir="ltr">${Math.round(parseFloat(d.amount)||0).toLocaleString('en-US')}</td>
          <td>${t}</td>
        </tr>`;
      }).join('')}
    </tbody>
    <tfoot>
      <tr><td colspan="2"><strong>إجمالي الإيداعات</strong></td>
        <td dir="ltr"><strong>${total.toLocaleString('en-US')}</strong></td><td></td></tr>
    </tfoot>
  </table>

  <div class="footer">
    <span>نظام أبو حذيفة — ${bank.name}</span>
    <span>طُبع بتاريخ: ${new Date().toLocaleDateString('ar-SA')}</span>
  </div>
  <script>window.onload=()=>window.print();<\/script>
</body></html>`);
    w.document.close();
  },

  // ─────────────────────────────────────────────
  // مشاركة ملخص الحساب البنكي
  // ─────────────────────────────────────────────
  _shareBank(bank, total, ceiling) {
    const pct    = ceiling>0?Math.round(total/ceiling*100):0;
    const remain = Math.max(0,ceiling-total);
    const text   = `🏦 *${bank.name}*\n` +
      `📅 ${formatDateArabic(this._selectedDate)}\n` +
      `─────────────────\n` +
      `💰 إجمالي الإيداعات: *${total.toLocaleString('en-US')} ر.س*\n` +
      `📊 السقف اليومي: ${ceiling.toLocaleString('en-US')} ر.س\n` +
      `✅ نسبة الاستخدام: ${pct}%\n` +
      `🔹 المتبقي من السقف: *${remain.toLocaleString('en-US')} ر.س*\n` +
      `─────────────────\n` +
      `نظام أبو حذيفة 🔐`;
    copyToClipboard(text,'تم نسخ ملخص الحساب البنكي');
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
  },

  _closeModal() { if(this._modal) this._modal.style.display='none'; this._editId=null; },

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
};

window.BankAccountsComponent = BankAccountsComponent;
console.log('✅ BankAccountsComponent v2.0 محمّل');
