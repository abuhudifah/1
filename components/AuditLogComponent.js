/**
 * components/AuditLogComponent.js — v2.0
 * إصلاحات:
 * 1. استخدام RPC get_audit_logs بدلاً من repo.query مباشرة
 * 2. عرض اسم المنفذ ودوره واسم المندوب ونوع العملية والمبلغ
 * 3. فلتر حسب المندوب (agent_id)
 * 4. تحسين بصري للجدول
 */
'use strict';

const AuditLogComponent = {
  _page    : 1,
  _pageSize: 50,
  _count   : 0,

  async render(container) {
    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔒</div>
        <div class="empty-state-text">سجل التدقيق للمدير والمساعد الإداري فقط</div></div>`;
      return;
    }

    const users = AppStore.getState('users');
    const agents = users.filter(u=>u.role==='agent'&&u.is_active);

    container.innerHTML = '';
    const wrap = document.createElement('div');

    // شريط العنوان
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;';
    bar.innerHTML = `
      <h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">
        🔍 سجل التدقيق
      </h2>
      <span id="audit-count" style="font-size:0.82rem;color:var(--text-muted);"></span>`;
    wrap.appendChild(bar);

    // الفلاتر
    const today30ago = new Date(); today30ago.setDate(today30ago.getDate()-7);
    const from7days  = today30ago.toLocaleDateString('en-CA',{timeZone:APP_CONFIG.TIMEZONE});

    const filterCard = document.createElement('div');
    filterCard.className = 'glass-card';
    filterCard.style.marginBottom = '16px';
    filterCard.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:10px;margin-bottom:12px;">
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">المندوب المنفذ</label>
          <select id="audit-agent" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الجميع</option>
            ${users.map(u=>`<option value="${escapeHtml(u.id)}">${escapeHtml(u.display_name)} (${escapeHtml(ROLE_LABELS[u.role]||u.role)})</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">نوع السجل</label>
          <select id="audit-record-type" class="form-control" style="padding:7px;font-size:0.85rem;">
            <option value="">الكل</option>
            <option value="transaction">معاملة مالية</option>
            <option value="user">مستخدم</option>
            <option value="bank_account">حساب بنكي</option>
            <option value="debtor">عميل مدين</option>
          </select>
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">من تاريخ</label>
          <input id="audit-from" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
            value="${from7days}">
        </div>
        <div class="form-group" style="margin:0;">
          <label class="form-label" style="font-size:0.78rem;">إلى تاريخ</label>
          <input id="audit-to" type="date" class="form-control" style="padding:7px;font-size:0.85rem;"
            value="${getCurrentSaudiDate()}">
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <button id="audit-apply-btn" class="btn btn-primary btn-sm">
          <i data-lucide="filter" style="width:14px;height:14px"></i> تطبيق الفلتر
        </button>
        <button id="audit-reset-btn" class="btn btn-secondary btn-sm">إعادة تعيين</button>
      </div>`;

    filterCard.querySelector('#audit-apply-btn').addEventListener('click',()=>{ this._page=1; this._load(); });
    filterCard.querySelector('#audit-reset-btn').addEventListener('click',()=>{
      filterCard.querySelector('#audit-agent').value      = '';
      filterCard.querySelector('#audit-record-type').value= '';
      filterCard.querySelector('#audit-from').value       = from7days;
      filterCard.querySelector('#audit-to').value         = getCurrentSaudiDate();
      this._page=1; this._load();
    });
    wrap.appendChild(filterCard);

    const listEl = document.createElement('div');
    listEl.id = 'audit-list';
    listEl.innerHTML = `<div class="skeleton" style="height:48px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);
    wrap.appendChild(listEl);

    const pagerEl = document.createElement('div');
    pagerEl.id = 'audit-pager';
    pagerEl.style.cssText = 'display:flex;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:16px;';
    wrap.appendChild(pagerEl);

    container.appendChild(wrap);
    if (window.lucide) lucide.createIcons();
    await this._load();
  },

  async _load() {
    const listEl  = document.getElementById('audit-list');
    const pagerEl = document.getElementById('audit-pager');
    const countEl = document.getElementById('audit-count');
    if (!listEl) return;

    listEl.innerHTML = `<div class="skeleton" style="height:48px;border-radius:8px;margin-bottom:6px;"></div>`.repeat(5);

    const agentId    = document.getElementById('audit-agent')?.value        || null;
    const recordType = document.getElementById('audit-record-type')?.value   || null;
    const from       = document.getElementById('audit-from')?.value          || null;
    const to         = document.getElementById('audit-to')?.value            || null;

    let logs = [];
    let total = 0;

    try {
      if (navigator.onLine) {
        // استخدام RPC get_audit_logs الجديدة
        const { data, error } = await supabaseClient.rpc('get_audit_logs', {
          p_from_date   : from || (()=>{ const d=new Date(); d.setDate(d.getDate()-7); return d.toLocaleDateString('en-CA',{timeZone:APP_CONFIG.TIMEZONE}); })(),
          p_to_date     : to   || getCurrentSaudiDate(),
          p_agent_id    : agentId   || null,
          p_record_type : recordType|| null,
          p_limit       : this._pageSize * 3,
        });
        if (!error && data) {
          logs  = data.logs  || [];
          total = data.count || 0;
        }
      } else {
        // fallback: قراءة من Dexie
        const all = await db.audit_logs.orderBy('timestamp').reverse().limit(200).toArray();
        logs = all.map(l=>({
          id: l.id, action: l.action, record_type: l.record_type, record_id: l.record_id,
          timestamp: l.timestamp, executor_name: null, executor_role: null,
          agent_name: null, transaction_type: null, amount: null,
          new_value: l.new_value, old_value: l.old_value,
        }));
        total = logs.length;
      }
    } catch(e) {
      console.error('AuditLog load error:', e);
      listEl.innerHTML = `<div class="empty-state"><div class="empty-state-text">فشل تحميل السجل: ${escapeHtml(e.message)}</div></div>`;
      return;
    }

    if (countEl) countEl.textContent = `إجمالي: ${total} سجل`;
    this._count = total;

    if (!logs.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">📜</div>
        <div class="empty-state-text">لا توجد سجلات في هذه الفترة</div></div>`;
      if (pagerEl) pagerEl.innerHTML = '';
      return;
    }

    // تقطيع محلي للصفحات
    const start   = (this._page-1)*this._pageSize;
    const pageLogs= logs.slice(start, start+this._pageSize);

    const actionColors = { create:'success', update:'info', delete:'danger' };
    const actionLabels = { create:'إنشاء', update:'تعديل', delete:'حذف' };
    const txTypeIcons  = { collection:'💰', deposit:'🏦', expense:'💸', receipt:'📥', delivery:'📤', refund_settlement:'🔄' };
    const txTypeLabels = TRANSACTION_TYPE_LABELS || {};

    const table = document.createElement('div');
    table.className = 'table-wrapper';
    table.innerHTML = `
      <table class="data-table">
        <thead><tr>
          <th>الوقت</th>
          <th>الإجراء</th>
          <th>النوع</th>
          <th>المنفذ</th>
          <th>المندوب</th>
          <th>تفاصيل العملية</th>
          <th>المبلغ</th>
        </tr></thead>
        <tbody>
          ${pageLogs.map(log=>{
            const clr = actionColors[log.action]||'neutral';
            const lbl = actionLabels[log.action]||log.action;
            const txType = log.transaction_type;
            const txIcon = txType ? (txTypeIcons[txType]||'📋') : '—';
            const txLabel= txType ? (txTypeLabels[txType]||txType) : '—';
            const amt    = log.amount ? `${Math.round(parseFloat(log.amount)||0).toLocaleString('en-US')} ر.س` : '—';
            const recordShort = (log.record_id||'').length>8 ? (log.record_id||'').slice(0,8)+'…' : (log.record_id||'—');

            return `<tr>
              <td style="font-size:0.78rem;white-space:nowrap;color:var(--text-secondary);">
                ${escapeHtml(formatDateTimeArabic(log.timestamp))}
              </td>
              <td>
                <span class="badge badge-${clr}" style="font-size:0.75rem;">${escapeHtml(lbl)}</span>
              </td>
              <td style="font-size:0.82rem;">
                ${log.record_type==='transaction'?'💳':'📋'}
                ${escapeHtml(log.record_type||'—')}
              </td>
              <td style="font-size:0.82rem;">
                <div style="font-weight:600;">${escapeHtml(log.executor_name||'—')}</div>
                ${log.executor_role?`<div style="font-size:0.72rem;color:var(--text-muted);">${escapeHtml(ROLE_LABELS[log.executor_role]||log.executor_role)}</div>`:''}
              </td>
              <td style="font-size:0.82rem;">${escapeHtml(log.agent_name||'—')}</td>
              <td style="font-size:0.82rem;">
                ${txType?`<span>${txIcon} ${escapeHtml(txLabel)}</span>`:
                  `<span style="color:var(--text-muted);font-family:monospace;font-size:0.75rem;">${escapeHtml(recordShort)}</span>`}
              </td>
              <td style="font-weight:700;direction:ltr;color:${txType?'var(--success)':'var(--text-secondary)'};">
                ${escapeHtml(amt)}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(table);

    // ترقيم الصفحات
    if (pagerEl) {
      pagerEl.innerHTML = '';
      const pages = Math.ceil(this._count/this._pageSize);
      if (pages>1) {
        for (let p=1;p<=Math.min(pages,10);p++) {
          const pbtn = document.createElement('button');
          pbtn.className = p===this._page ? 'btn btn-primary btn-sm' : 'btn btn-secondary btn-sm';
          pbtn.textContent = p;
          pbtn.style.minWidth='36px';
          pbtn.addEventListener('click',()=>{ this._page=p; this._load(); });
          pagerEl.appendChild(pbtn);
        }
      }
    }

    if (window.lucide) lucide.createIcons();
  },
};

window.AuditLogComponent = AuditLogComponent;
console.log('✅ AuditLogComponent v2.0 محمّل — مع RPC get_audit_logs');
