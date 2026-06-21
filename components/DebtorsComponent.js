/**
 * components/DebtorsComponent.js — v3.0
 * نظام العملاء المديونين الكامل
 *
 * ✅ إدارة (مدير/مساعد): جدول + فلترة منطقة + إحصائيات + إضافة/تعديل/حذف/تحديث رصيد
 * ✅ مندوب: بطاقات عملاءه فقط + أزرار اتصال/واتساب/موقع + ضغط للتحصيل
 * ✅ تحديث الرصيد: استبدال مباشر بدون قيود محاسبية + إشعار للمناديب
 * ✅ إضافة عميل: لا CUST_ ولا قيود محاسبية + إشعار للمناديب المُعيَّنين
 */
'use strict';

const DebtorsComponent = {
  _formModal    : null,
  _balanceModal : null,
  _editingId    : null,
  _regionFilter : '',
  _searchTerm   : '',

  async render(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');

    const isAdmin = AuthService.isAdmin() || AuthService.isAdminAssistant();
    const isAgent = AuthService.isAgent();

    /* ── شريط العنوان ── */
    const topBar = document.createElement('div');
    topBar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;';
    topBar.innerHTML = `<h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">العملاء المديونون</h2>`;

    if (isAdmin) {
      const addBtn = document.createElement('button');
      addBtn.className = 'btn btn-primary btn-sm';
      addBtn.innerHTML = '<i data-lucide="plus" style="width:14px;height:14px"></i> إضافة عميل';
      addBtn.addEventListener('click', () => this._openForm());
      topBar.appendChild(addBtn);
    }

    /* ── مربع البحث بالاسم ── */
    const searchWrap = document.createElement('div');
    searchWrap.style.cssText = 'position:relative;display:flex;align-items:center;';
    const searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.placeholder = 'بحث بالاسم…';
    searchInput.value = this._searchTerm;
    searchInput.style.cssText = 'padding:6px 32px 6px 12px;border:1px solid var(--border-color);border-radius:8px;background:var(--bg-card);color:var(--text-primary);font-size:0.85rem;outline:none;width:180px;direction:rtl;';
    const searchIcon = document.createElement('i');
    searchIcon.setAttribute('data-lucide', 'search');
    searchIcon.style.cssText = 'position:absolute;left:9px;width:14px;height:14px;color:var(--text-muted);pointer-events:none;';
    searchWrap.appendChild(searchInput);
    searchWrap.appendChild(searchIcon);
    searchInput.addEventListener('input', () => {
      this._searchTerm = searchInput.value.trim();
      this._applySearch();
    });
    topBar.appendChild(searchWrap);

    wrap.appendChild(topBar);

    /* ── منطقة الإحصائيات (للإدارة فقط) ── */
    if (isAdmin) {
      const statsEl = document.createElement('div');
      statsEl.id = 'debtors-stats';
      wrap.appendChild(statsEl);
    }

    /* ── فلتر المنطقة (للإدارة والمندوب) ── */
    const filterWrap = document.createElement('div');
    filterWrap.id = 'debtors-filter';
    filterWrap.style.cssText = 'margin-bottom:16px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;';
    wrap.appendChild(filterWrap);

    /* ── منطقة القائمة ── */
    const listEl = document.createElement('div');
    listEl.id = 'debtors-list';
    listEl.innerHTML = `<div class="skeleton" style="height:${isAgent?'120':'60'}px;border-radius:12px;margin-bottom:10px;"></div>`.repeat(4);
    wrap.appendChild(listEl);

    /* ── النوافذ المنبثقة — مُضافة لـ body لتجنب كسر position:fixed على الجوال ── */
    if (this._formModal)    this._formModal.remove();
    if (this._balanceModal) this._balanceModal.remove();
    this._formModal    = this._buildFormModal();
    this._balanceModal = this._buildBalanceModal();
    document.body.appendChild(this._formModal);
    document.body.appendChild(this._balanceModal);

    container.appendChild(wrap);
    if (window.lucide) lucide.createIcons();

    await this._loadDebtors();
  },

  /* ══════════════════════════════════════════════════════
     تحميل وعرض البيانات
  ══════════════════════════════════════════════════════ */
  async _loadDebtors() {
    const listEl = document.getElementById('debtors-list');
    if (!listEl) return;

    try {
      const isAdmin = AuthService.isAdmin() || AuthService.isAdminAssistant();
      const isAgent = AuthService.isAgent();
      const uid     = AuthService.getCurrentUserId();

      let debtors = [];

      if (isAgent && !isOfflineMode() && isOnline()) {
        // FIX: للمندوب online — استعلام مباشر بفلتر JSONB @> لتجنب تحميل كل المدينين
        // وتجاوز حد pageSize:500 الذي قد يُفوِّت مدينين في صفحات لاحقة
        const { data, error: qErr } = await supabaseClient
          .from(TABLES.DEBTORS)
          .select('*')
          .filter('assigned_agents', 'cs', JSON.stringify([uid]))
          .order('name', { ascending: true });
        if (qErr) throw new Error(qErr.message);
        debtors = data || [];
      } else {
        const result = await repo.query(TABLES.DEBTORS, {}, { orderBy: 'name', ascending: true, pageSize: 500 });
        debtors = isOk(result) ? (result.data.data || []) : [];
        // FIX offline: الفلترة المحلية مع تحليل assigned_agents (Array أو JSON string)
        if (isAgent) {
          debtors = debtors.filter(d => {
            if (d.assigned_agents == null) return false;
            const agents = Array.isArray(d.assigned_agents)
              ? d.assigned_agents
              : (() => { try { return JSON.parse(d.assigned_agents); } catch { return []; } })();
            return agents.includes(uid);
          });
        }
      }

      if (debtors.length === 0) {
        listEl.innerHTML = `<div class="empty-state">
          <div class="empty-state-icon">👥</div>
          <div class="empty-state-text">${isAgent ? 'لا يوجد عملاء مُعيَّنون لك' : 'لا يوجد عملاء مديونون'}</div>
        </div>`;
        if (isAdmin) this._renderStats([], null);
        return;
      }

      this._debtorsCache = debtors;

      this._renderRegionFilter(debtors);

      if (isAdmin) {
        this._renderStats(debtors, this._regionFilter);
        this._renderAdminTable(listEl, this._applySearchFilter(debtors));
      } else {
        this._renderAgentCards(listEl, this._applySearchFilter(debtors));
      }

      if (window.lucide) lucide.createIcons();

    } catch (e) {
      const listEl2 = document.getElementById('debtors-list');
      if (listEl2) listEl2.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">⚠️</div>
        <div class="empty-state-text">خطأ: ${escapeHtml(e.message)}</div>
      </div>`;
    }
  },

  /* ── إحصائيات (للإدارة) ── */
  _renderStats(debtors, regionFilter) {
    const statsEl = document.getElementById('debtors-stats');
    if (!statsEl) return;

    const filtered = regionFilter
      ? debtors.filter(d => (d.region || '').trim() === regionFilter)
      : debtors;

    const totalDebtors = filtered.length;
    const totalDebt    = filtered.reduce((s, d) => s + (parseFloat(d.debt_amount) || 0), 0);
    const withDebt     = filtered.filter(d => (parseFloat(d.debt_amount) || 0) > 0).length;

    statsEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:16px;">
        <div class="glass-card" style="padding:14px;text-align:center;">
          <div style="font-size:1.6rem;font-weight:800;color:var(--accent);">${totalDebtors}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">${regionFilter ? 'عملاء المنطقة' : 'إجمالي العملاء'}</div>
        </div>
        <div class="glass-card" style="padding:14px;text-align:center;">
          <div style="font-size:1.4rem;font-weight:800;color:var(--danger);">${formatCurrency(totalDebt)}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">إجمالي المديونيات</div>
        </div>
        <div class="glass-card" style="padding:14px;text-align:center;">
          <div style="font-size:1.6rem;font-weight:800;color:var(--warning);">${withDebt}</div>
          <div style="font-size:0.78rem;color:var(--text-muted);">عملاء برصيد مستحق</div>
        </div>
      </div>`;
  },

  /* ── فلتر المنطقة ── */
  _renderRegionFilter(debtors) {
    const filterEl = document.getElementById('debtors-filter');
    if (!filterEl) return;

    const regions = [...new Set(debtors.map(d => (d.region || '').trim()).filter(Boolean))].sort();
    if (!regions.length) { filterEl.style.display = 'none'; return; }

    filterEl.style.display = '';
    filterEl.innerHTML = `<span style="font-size:0.85rem;color:var(--text-secondary);">فلترة بالمنطقة:</span>`;

    const allBtn = document.createElement('button');
    allBtn.className = `btn btn-sm ${!this._regionFilter ? 'btn-primary' : 'btn-secondary'}`;
    allBtn.textContent = 'الكل';
    allBtn.addEventListener('click', () => { this._regionFilter = ''; this._loadDebtors(); });
    filterEl.appendChild(allBtn);

    regions.forEach(r => {
      const count = debtors.filter(d => (d.region || '').trim() === r).length;
      const btn = document.createElement('button');
      btn.className = `btn btn-sm ${this._regionFilter === r ? 'btn-primary' : 'btn-secondary'}`;
      btn.textContent = `${r} (${count})`;
      btn.addEventListener('click', () => { this._regionFilter = r; this._loadDebtors(); });
      filterEl.appendChild(btn);
    });
  },

  /* ── فلتر البحث بالاسم ── */
  _applySearchFilter(debtors) {
    if (!this._searchTerm) return debtors;
    const term = this._searchTerm.toLowerCase();
    return debtors.filter(d => (d.name || '').toLowerCase().includes(term));
  },

  /* ── إعادة عرض فوري عند الكتابة في البحث (بدون fetch) ── */
  _applySearch() {
    const listEl = document.getElementById('debtors-list');
    if (!listEl || !this._debtorsCache) return;
    const isAdmin = AuthService.isAdmin() || AuthService.isAdminAssistant();
    const filtered = this._applySearchFilter(this._debtorsCache);
    if (isAdmin) {
      this._renderAdminTable(listEl, filtered);
    } else {
      this._renderAgentCards(listEl, filtered);
    }
    if (window.lucide) lucide.createIcons();
  },

  /* ── جدول الإدارة ── */
  _renderAdminTable(listEl, allDebtors) {
    const debtors = this._regionFilter
      ? allDebtors.filter(d => (d.region || '').trim() === this._regionFilter)
      : allDebtors;

    if (debtors.length === 0) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">لا يوجد عملاء في منطقة "${escapeHtml(this._regionFilter)}"</div>
      </div>`;
      return;
    }

    const tableWrap = document.createElement('div');
    tableWrap.className = 'table-wrapper';
    tableWrap.style.overflowX = 'auto';
    tableWrap.innerHTML = `
      <table class="data-table" style="table-layout:fixed;width:100%;">
        <colgroup>
          <col style="width:auto;min-width:130px;">
          <col style="width:110px;">
          <col style="width:80px;">
          <col style="width:110px;">
          <col style="width:46px;">
        </colgroup>
        <thead><tr>
          <th>اسم العميل</th>
          <th>الرصيد المستحق</th>
          <th>المنطقة</th>
          <th>المناديب</th>
          <th>إجراءات</th>
        </tr></thead>
        <tbody>
          ${debtors.map(d => {
            const agents = Array.isArray(d.assigned_agents)
              ? d.assigned_agents
              : (typeof d.assigned_agents === 'string' ? JSON.parse(d.assigned_agents || '[]') : []);
            const agentNames = agents.map(id => {
              const users = AppStore.getState('users') || [];
              const u = users.find(u => u.id === id);
              return u?.display_name || id.slice(0, 8);
            }).join('، ');

            return `<tr>
              <td>
                <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(d.name)}</div>
                ${d.phone ? `<div style="font-size:0.75rem;color:var(--text-muted);">📞 ${escapeHtml(d.phone)}</div>` : ''}
              </td>
              <td style="font-weight:700;color:${parseFloat(d.debt_amount||0) > 0 ? 'var(--danger)' : 'var(--success)'};">
                ${formatCurrency(d.debt_amount || 0)}
              </td>
              <td style="color:var(--text-muted);font-size:0.82rem;">${escapeHtml(d.region || '—')}</td>
              <td style="font-size:0.78rem;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${escapeHtml(agentNames)}">
                ${escapeHtml(agentNames || '—')}
              </td>
              <td style="padding:4px 6px;">
                <div class="debtors-action-col">
                  <button class="btn btn-secondary btn-sm" title="تعديل"
                    data-debtor-id="${escapeHtml(d.id)}" data-debtor-action="edit"
                    style="padding:4px;width:30px;height:30px;">
                    <i data-lucide="pencil" style="width:12px;height:12px"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm" title="تحديث الرصيد" style="color:var(--accent);padding:4px;width:30px;height:30px;"
                    data-debtor-id="${escapeHtml(d.id)}" data-debtor-action="balance">
                    <i data-lucide="refresh-cw" style="width:12px;height:12px"></i>
                  </button>
                  <button class="btn btn-secondary btn-sm" title="حذف" style="color:var(--danger);padding:4px;width:30px;height:30px;"
                    data-debtor-id="${escapeHtml(d.id)}" data-debtor-action="delete">
                    <i data-lucide="trash-2" style="width:12px;height:12px"></i>
                  </button>
                </div>
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>`;

    listEl.innerHTML = '';
    listEl.appendChild(tableWrap);

    tableWrap.querySelector('table').addEventListener('click', e => {
      const btn = e.target.closest('[data-debtor-action]');
      if (!btn) return;
      const id     = btn.dataset.debtorId;
      const action = btn.dataset.debtorAction;
      const d      = (this._debtorsCache || []).find(x => x.id === id);
      if (action === 'edit')              this._openFormById(id);
      else if (action === 'balance' && d) this._openBalanceModal(id, d.name, parseFloat(d.debt_amount || 0));
      else if (action === 'delete'  && d) this._deleteDebtor(id, d.name);
    });

  },

  /* ── بطاقات المندوب ── */
  _renderAgentCards(listEl, allDebtors) {
    const debtors = this._regionFilter
      ? allDebtors.filter(d => (d.region || '').trim() === this._regionFilter)
      : allDebtors;
    listEl.innerHTML = '';
    if (debtors.length === 0) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔍</div>
        <div class="empty-state-text">${this._regionFilter ? `لا يوجد عملاء في منطقة "${escapeHtml(this._regionFilter)}"` : 'لا يوجد عملاء مطابقين'}</div>
      </div>`;
      return;
    }
    const grid = document.createElement('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;';

    debtors.forEach(d => {
      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.cssText = 'padding:16px;cursor:pointer;transition:transform 0.15s,box-shadow 0.15s;position:relative;';

      const balColor = parseFloat(d.debt_amount || 0) > 0 ? 'var(--danger)' : 'var(--success)';

      card.innerHTML = `
        <div style="margin-bottom:12px;">
          <div style="font-weight:700;font-size:1rem;color:var(--text-primary);margin-bottom:4px;">${escapeHtml(d.name)}</div>
          ${d.region ? `<div style="font-size:0.78rem;color:var(--text-muted);">📍 ${escapeHtml(d.region)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
          <span style="font-size:0.82rem;color:var(--text-secondary);">الرصيد المستحق</span>
          <span style="font-size:1.1rem;font-weight:800;color:${balColor};">${formatCurrency(d.debt_amount || 0)}</span>
        </div>
        <div style="display:flex;gap:8px;">
          ${d.phone ? `<a href="tel:${escapeHtml(d.phone)}" onclick="event.stopPropagation()"
              class="btn btn-secondary btn-sm" style="flex:1;text-align:center;" title="اتصال">
              📞
            </a>` : ''}
          ${d.whatsapp ? `<a href="https://wa.me/${escapeHtml(d.whatsapp.replace(/\D/g,''))}" target="_blank" onclick="event.stopPropagation()"
              class="btn btn-secondary btn-sm" style="flex:1;text-align:center;" title="واتساب">
              💬
            </a>` : ''}
          ${d.website ? `<a href="${escapeHtml(d.website)}" target="_blank" onclick="event.stopPropagation()"
              class="btn btn-secondary btn-sm" style="flex:1;text-align:center;" title="موقع">
              🌐
            </a>` : ''}
          <button class="btn btn-primary btn-sm deb-col-btn" style="flex:2;">
            💰 تحصيل
          </button>
        </div>`;

      card.querySelector('.deb-col-btn').addEventListener('click', e => {
        e.stopPropagation();
        this._openCollectionForDebtor(d.id, d.name, parseFloat(d.debt_amount || 0));
      });
      card.addEventListener('mouseenter', () => { card.style.transform = 'translateY(-2px)'; card.style.boxShadow = 'var(--shadow-lg)'; });
      card.addEventListener('mouseleave', () => { card.style.transform = ''; card.style.boxShadow = ''; });
      grid.appendChild(card);
    });

    listEl.appendChild(grid);
  },

  /* فتح نموذج التحصيل من بطاقة المندوب */
  _openCollectionForDebtor(debtorId, debtorName, debtAmount) {
    /* الانتقال لتبويب إدخال البيانات وتحديد العميل */
    const tab = document.querySelector('[data-tab="data-entry"]') || document.querySelector('button[onclick*="data-entry"]');
    if (tab) tab.click();
    setTimeout(() => {
      const colTab = document.getElementById('form-tab-collection');
      if (colTab) colTab.click();
      setTimeout(() => {
        const inp = document.getElementById('col-customer-search');
        const hid = document.getElementById('col-debtor-id');
        if (inp) inp.value = debtorName;
        if (hid) hid.value = debtorId;
        const debtDisp = document.getElementById('col-debt-display');
        if (debtDisp) {
          debtDisp.style.display = '';
          debtDisp.innerHTML = `💳 المديونية: <strong style="color:var(--danger);">${formatCurrency(debtAmount)}</strong>`;
        }
        inp?.focus();
      }, 200);
    }, 300);
  },

  /* ══════════════════════════════════════════════════════
     نموذج الإضافة / التعديل
  ══════════════════════════════════════════════════════ */
  _buildFormModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeForm(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '520px';

    const agents = AppStore.getState('users').filter(u => u.role === ROLES.AGENT && u.is_active);

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title" id="debtor-form-title">إضافة عميل مدين</h3>
        <button class="modal-close" id="deb-close-x">✕</button>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">الاسم الثلاثي <span class="required">*</span></label>
          <input id="deb-name" type="text" class="form-control" placeholder="اسم العميل كاملاً">
        </div>
        <div class="form-group">
          <label class="form-label">الرصيد الابتدائي</label>
          <input id="deb-amount" type="number" class="form-control" placeholder="0.00" min="0" step="0.01">
        </div>
        <div class="form-group">
          <label class="form-label">المنطقة</label>
          <input id="deb-region" type="text" class="form-control" placeholder="اختياري">
        </div>
        <div class="form-group">
          <label class="form-label">رقم الهاتف</label>
          <input id="deb-phone" type="tel" class="form-control" placeholder="05xxxxxxxx">
        </div>
        <div class="form-group">
          <label class="form-label">رقم واتساب</label>
          <input id="deb-whatsapp" type="tel" class="form-control" placeholder="05xxxxxxxx">
        </div>
        <div class="form-group" style="grid-column:1/-1;">
          <label class="form-label">رابط الموقع</label>
          <input id="deb-website" type="url" class="form-control" placeholder="https://...">
        </div>
      </div>

      <div class="form-group">
        <label class="form-label">المناديب المخصصون</label>
        <div id="deb-agents-list" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px;background:var(--bg-input);border-radius:8px;min-height:36px;">
          ${agents.length
            ? agents.map(a => `
              <label style="display:flex;align-items:center;gap:5px;font-size:0.85rem;cursor:pointer;padding:4px 8px;background:var(--glass-bg);border-radius:6px;border:1px solid var(--border-color);">
                <input type="checkbox" data-agent-id="${escapeHtml(a.id)}" value="${escapeHtml(a.id)}">
                ${escapeHtml(a.display_name)}
              </label>`).join('')
            : '<span style="font-size:0.82rem;color:var(--text-muted);">لا يوجد مناديب نشطون</span>'
          }
        </div>
      </div>

      <div id="deb-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="deb-save-btn" class="btn btn-primary" style="flex:2;">حفظ</button>
        <button class="btn btn-secondary" style="flex:1;" id="deb-close-cancel">إلغاء</button>
      </div>`;

    overlay.appendChild(box);
    box.querySelector('#deb-save-btn').addEventListener('click', () => this._saveDebtor());
    box.querySelector('#deb-close-x').addEventListener('click', () => this._closeForm());
    box.querySelector('#deb-close-cancel').addEventListener('click', () => this._closeForm());
    return overlay;
  },

  /* فتح نموذج التعديل بمعرف (من الجدول) */
  _openFormById(id) {
    const d = (this._debtorsCache || []).find(x => x.id === id);
    if (d) this._openForm(d);
    else this._openForm();
  },

  _openForm(debtor = null) {
    this._editingId = debtor?.id || null;
    const titleEl = document.getElementById('debtor-form-title');
    if (titleEl) titleEl.textContent = debtor ? 'تعديل بيانات العميل' : 'إضافة عميل مدين';

    if (debtor) {
      document.getElementById('deb-name').value     = debtor.name || '';
      document.getElementById('deb-amount').value   = debtor.debt_amount || '';
      document.getElementById('deb-region').value   = debtor.region || '';
      document.getElementById('deb-phone').value    = debtor.phone || '';
      document.getElementById('deb-whatsapp').value = debtor.whatsapp || '';
      document.getElementById('deb-website').value  = debtor.website || '';
      const assigned = Array.isArray(debtor.assigned_agents)
        ? debtor.assigned_agents
        : (typeof debtor.assigned_agents === 'string' ? JSON.parse(debtor.assigned_agents || '[]') : []);
      document.querySelectorAll('#deb-agents-list input[type="checkbox"]').forEach(cb => {
        cb.checked = assigned.includes(cb.value);
      });
    } else {
      ['deb-name','deb-amount','deb-region','deb-phone','deb-whatsapp','deb-website'].forEach(id => {
        const el = document.getElementById(id); if (el) el.value = '';
      });
      document.querySelectorAll('#deb-agents-list input[type="checkbox"]').forEach(cb => { cb.checked = false; });
    }
    document.getElementById('deb-error').textContent = '';
    this._formModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  },

  _closeForm() {
    if (this._formModal) {
      this._formModal.classList.add('is-closing');
      setTimeout(() => {
        if (this._formModal) {
          this._formModal.style.display = 'none';
          this._formModal.classList.remove('is-closing');
        }
        document.body.style.overflow = '';
      }, 220);
    }
    this._editingId = null;
  },

  async _saveDebtor() {
    const name  = document.getElementById('deb-name')?.value.trim();
    const errEl = document.getElementById('deb-error');
    if (!name) { if (errEl) errEl.textContent = 'الاسم مطلوب'; return; }

    const assigned = [];
    document.querySelectorAll('#deb-agents-list input[type="checkbox"]:checked').forEach(cb => assigned.push(cb.value));

    /* المناديب الجدد المُضافون (للإشعار) */
    let prevAgents = [];
    if (this._editingId) {
      const prev = (this._debtorsCache || []).find(d => d.id === this._editingId);
      if (prev) {
        prevAgents = Array.isArray(prev.assigned_agents)
          ? prev.assigned_agents
          : (typeof prev.assigned_agents === 'string' ? JSON.parse(prev.assigned_agents || '[]') : []);
      }
    }
    const newAgents = assigned.filter(id => !prevAgents.includes(id));

    const data = {
      name            : name,
      debt_amount     : parseFloat(document.getElementById('deb-amount')?.value || '0') || 0,
      region          : document.getElementById('deb-region')?.value.trim() || null,
      phone           : document.getElementById('deb-phone')?.value.trim() || null,
      whatsapp        : document.getElementById('deb-whatsapp')?.value.trim() || null,
      website         : document.getElementById('deb-website')?.value.trim() || null,
      assigned_agents : assigned,
    };

    const btn     = document.getElementById('deb-save-btn');
    const restore = setButtonLoading(btn);

    const result = this._editingId
      ? await repo.update(TABLES.DEBTORS, this._editingId, data)
      : await repo.create(TABLES.DEBTORS, data);

    restore();

    if (!isOk(result)) {
      if (errEl) errEl.textContent = result.error;
      return;
    }

    /* إرسال إشعار للمناديب الجدد */
    if (newAgents.length) {
      this._sendNotification(
        `تم تعيينك لعميل مدين: ${name}`,
        `لديك عميل مدين جديد مُعيَّن لك: ${name}${data.region ? ' — المنطقة: ' + data.region : ''}`,
        newAgents
      );
    }

    showToast(this._editingId ? 'تم التعديل' : 'تم إضافة العميل', 'success');
    this._closeForm();
    await this._loadDebtors();
  },

  async _deleteDebtor(id, name) {
    const confirmed = await confirmDialog(`حذف العميل "${name}"؟`, 'حذف', 'إلغاء', 'danger');
    if (!confirmed) return;
    const result = await repo.delete(TABLES.DEBTORS, id);
    if (isOk(result)) { showToast('تم الحذف', 'success'); await this._loadDebtors(); }
    else showToast(`فشل الحذف: ${result.error}`, 'error');
  },

  /* ══════════════════════════════════════════════════════
     نافذة تحديث الرصيد يدوياً
  ══════════════════════════════════════════════════════ */
  _buildBalanceModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeBalanceModal(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '420px';

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">تحديث رصيد العميل</h3>
        <button class="modal-close" id="bal-close-x">✕</button>
      </div>
      <div style="padding:10px 0 4px;font-size:0.85rem;color:var(--text-secondary);">
        العميل: <strong id="bal-debtor-name" style="color:var(--text-primary);"></strong>
      </div>
      <div style="padding:4px 0 12px;font-size:0.85rem;color:var(--text-secondary);">
        الرصيد الحالي: <strong id="bal-current-display" style="color:var(--danger);"></strong>
      </div>
      <input type="hidden" id="bal-debtor-id">
      <input type="hidden" id="bal-current-amount">
      <div class="form-group">
        <label class="form-label">الرصيد الجديد <span class="required">*</span></label>
        <input id="bal-new-amount" type="number" class="form-control"
          placeholder="أدخل الرصيد الجديد (يستبدل القديم)" min="0" step="0.01">
        <div style="font-size:0.76rem;color:var(--text-muted);margin-top:4px;">
          💡 سيُستبدل الرصيد الحالي بهذا الرقم مباشرةً
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">سبب التحديث (اختياري)</label>
        <input id="bal-reason" type="text" class="form-control" placeholder="مثال: تسوية شهرية">
      </div>
      <div id="bal-diff-info" style="display:none;margin-bottom:12px;padding:8px 12px;border-radius:8px;font-size:0.82rem;"></div>
      <div id="bal-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="bal-save-btn" class="btn btn-primary" style="flex:2;">حفظ التحديث</button>
        <button class="btn btn-secondary" style="flex:1;" id="bal-close-cancel">إلغاء</button>
      </div>`;

    overlay.appendChild(box);

    box.querySelector('#bal-close-x').addEventListener('click', () => this._closeBalanceModal());
    box.querySelector('#bal-close-cancel').addEventListener('click', () => this._closeBalanceModal());

    box.querySelector('#bal-new-amount').addEventListener('input', () => {
      const current = parseFloat(document.getElementById('bal-current-amount')?.value || '0') || 0;
      const newVal  = parseFloat(document.getElementById('bal-new-amount')?.value || '') || 0;
      const diff    = newVal - current;
      const info    = document.getElementById('bal-diff-info');
      if (!document.getElementById('bal-new-amount').value) { info.style.display = 'none'; return; }
      info.style.display = '';
      if (Math.abs(diff) < 0.01) {
        info.style.cssText = 'display:;margin-bottom:12px;padding:8px 12px;border-radius:8px;font-size:0.82rem;background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.2);color:var(--success);';
        info.textContent = 'الرصيد لم يتغير';
      } else if (diff > 0) {
        info.style.cssText = 'display:;margin-bottom:12px;padding:8px 12px;border-radius:8px;font-size:0.82rem;background:rgba(220,38,38,0.08);border:1px solid rgba(220,38,38,0.2);color:var(--danger);';
        info.textContent = `زيادة الدين بمقدار: +${formatCurrency(diff)}`;
      } else {
        info.style.cssText = 'display:;margin-bottom:12px;padding:8px 12px;border-radius:8px;font-size:0.82rem;background:rgba(5,150,105,0.08);border:1px solid rgba(5,150,105,0.2);color:var(--success);';
        info.textContent = `تخفيض الدين بمقدار: ${formatCurrency(Math.abs(diff))}`;
      }
    });

    box.querySelector('#bal-save-btn').addEventListener('click', () => this._saveBalanceUpdate());
    return overlay;
  },

  _openBalanceModal(debtorId, debtorName, currentAmount) {
    if (!AuthService.isAdmin() && !AuthService.isAdminAssistant()) return;
    document.getElementById('bal-debtor-id').value      = debtorId;
    document.getElementById('bal-current-amount').value = currentAmount;
    document.getElementById('bal-debtor-name').textContent     = debtorName;
    document.getElementById('bal-current-display').textContent = formatCurrency(currentAmount);
    document.getElementById('bal-new-amount').value  = '';
    document.getElementById('bal-reason').value      = '';
    document.getElementById('bal-error').textContent = '';
    document.getElementById('bal-diff-info').style.display = 'none';
    this._balanceModal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
    setTimeout(() => document.getElementById('bal-new-amount')?.focus(), 100);
  },

  _closeBalanceModal() {
    if (this._balanceModal) {
      this._balanceModal.classList.add('is-closing');
      setTimeout(() => {
        if (this._balanceModal) {
          this._balanceModal.style.display = 'none';
          this._balanceModal.classList.remove('is-closing');
        }
        document.body.style.overflow = '';
      }, 220);
    }
  },

  async _saveBalanceUpdate() {
    const debtorId   = document.getElementById('bal-debtor-id')?.value;
    const debtorName = document.getElementById('bal-debtor-name')?.textContent;
    const current    = parseFloat(document.getElementById('bal-current-amount')?.value || '0') || 0;
    const newVal     = parseFloat(document.getElementById('bal-new-amount')?.value || '');
    const reason     = document.getElementById('bal-reason')?.value.trim() || '';
    const errEl      = document.getElementById('bal-error');

    if (!debtorId)               { if (errEl) errEl.textContent = 'خطأ: معرف العميل مفقود'; return; }
    if (isNaN(newVal) || newVal < 0) { if (errEl) errEl.textContent = 'أدخل رقماً صحيحاً (صفر أو أكثر)'; return; }
    if (Math.abs(newVal - current) < 0.01) { showToast('الرصيد لم يتغير', 'info'); return; }

    const btn     = document.getElementById('bal-save-btn');
    const restore = setButtonLoading(btn);
    if (errEl) errEl.textContent = '';

    try {
      /* تحديث مباشر — لا قيود محاسبية */
      const updateResult = await repo.update(TABLES.DEBTORS, debtorId, { debt_amount: newVal });
      if (!isOk(updateResult)) throw new Error(updateResult.error);

      /* إشعار للمناديب المُعيَّنين */
      const debtor = (this._debtorsCache || []).find(d => d.id === debtorId);
      if (debtor) {
        const agents = Array.isArray(debtor.assigned_agents)
          ? debtor.assigned_agents
          : (typeof debtor.assigned_agents === 'string' ? JSON.parse(debtor.assigned_agents || '[]') : []);
        if (agents.length) {
          this._sendNotification(
            `تحديث رصيد: ${debtorName}`,
            `تم تحديث رصيد العميل "${debtorName}" من ${formatCurrency(current)} إلى ${formatCurrency(newVal)}${reason ? ' — ' + reason : ''}`,
            agents
          );
        }
      }

      showToast(`✅ تم تحديث رصيد "${debtorName}" إلى ${formatCurrency(newVal)}`, 'success');
      this._closeBalanceModal();
      await this._loadDebtors();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
    } finally {
      restore();
    }
  },

  /* ══════════════════════════════════════════════════════
     إرسال إشعار داخلي
  ══════════════════════════════════════════════════════ */
  async _sendNotification(title, body, targetUserIds) {
    try {
      await repo.create(TABLES.NOTIFICATIONS, {
        title,
        body,
        type      : 'info',
        target    : JSON.stringify(targetUserIds),
        sender_id : AuthService.getCurrentUserId(),
        read_by   : '[]',
        hidden_by : '[]',
      });
    } catch (e) { console.warn('⚠️ DebtorsComponent: فشل إرسال الإشعار:', e.message); }
  },

  async onResume() {
    if (typeof this._load === 'function') await this._load();
  },
};

window.DebtorsComponent = DebtorsComponent;
console.log('✅ DebtorsComponent.js v3.0 — نظام العملاء المديونين الكامل');
