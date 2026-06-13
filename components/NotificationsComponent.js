/**
 * components/NotificationsComponent.js
 * نظام أبو حذيفة — الإشعارات
 * عرض + تحديد كمقروء + إخفاء + إرسال إشعار جديد (للمدير)
 */
'use strict';

const NotificationsComponent = {
  _sendModal: null,

  async render(container) {
    container.innerHTML = '';
    const wrap = document.createElement('div');

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:20px;';
    bar.innerHTML = `<h2 style="font-size:1.2rem;font-weight:700;color:var(--text-primary);flex:1;">الإشعارات</h2>`;

    if (AuthService.isAdmin()) {
      const sendBtn = document.createElement('button');
      sendBtn.className = 'btn btn-primary btn-sm';
      sendBtn.innerHTML = '<i data-lucide="send" style="width:14px;height:14px"></i> إرسال إشعار';
      sendBtn.addEventListener('click', () => this._openSendModal());
      bar.appendChild(sendBtn);
    }

    const markAllBtn = document.createElement('button');
    markAllBtn.className = 'btn btn-secondary btn-sm';
    markAllBtn.innerHTML = '<i data-lucide="check-check" style="width:14px;height:14px"></i> تحديد الكل كمقروء';
    markAllBtn.addEventListener('click', () => this._markAllRead());
    bar.appendChild(markAllBtn);

    wrap.appendChild(bar);

    const listEl = document.createElement('div');
    listEl.id = 'notif-list';
    listEl.innerHTML = `<div class="skeleton" style="height:70px;border-radius:10px;margin-bottom:8px;"></div>`.repeat(3);
    wrap.appendChild(listEl);

    this._sendModal = this._buildSendModal();
    wrap.appendChild(this._sendModal);

    container.appendChild(wrap);
    await this._load();
    if (window.lucide) lucide.createIcons();
  },

  async _load() {
    const listEl = document.getElementById('notif-list');
    if (!listEl) return;

    const uid    = AuthService.getCurrentUserId();
    const notifs = AppStore.getState('notifications') || [];

    if (!notifs.length) {
      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon">🔔</div>
        <div class="empty-state-text">لا توجد إشعارات</div></div>`;
      return;
    }

    const typeColors = { info:'info', warning:'warning', success:'success', error:'danger', account_share:'success' };
    const typeIcons  = { info:'ℹ️', warning:'⚠️', success:'✅', error:'❌', account_share:'🏦' };

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '10px';

    for (const n of notifs) {
      const readBy   = Array.isArray(n.read_by)   ? n.read_by   : JSON.parse(n.read_by   || '[]');
      const hiddenBy = Array.isArray(n.hidden_by) ? n.hidden_by : JSON.parse(n.hidden_by || '[]');
      const isRead   = readBy.includes(uid);
      const color    = typeColors[n.type] || 'neutral';
      const text     = n.message || n.body || '';
      const isShare  = n.type === 'account_share';

      // استخراج metadata للإشعارات التفاعلية
      let meta = {};
      try { meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : (n.metadata || {}); } catch { meta = {}; }
      const isTransferApproval = meta.type === 'transfer_approval';
      const isTransferRequest  = meta.type === 'transfer_request';
      const isActionPending    = (isTransferApproval || isTransferRequest) && !isRead;

      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.cssText = `padding:14px 16px;border-right:4px solid var(--${isActionPending ? 'warning' : color});opacity:${isRead ? '0.7' : '1'};`;

      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="font-size:1.2rem;flex-shrink:0;">${isTransferApproval ? '💸' : isTransferRequest ? '📨' : (typeIcons[n.type] || 'ℹ️')}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:${isRead ? '500' : '700'};margin-bottom:4px;">${escapeHtml(n.title)}</div>
            <div style="font-size:0.88rem;color:var(--text-secondary);white-space:pre-line;">${escapeHtml(text)}</div>
            ${isShare ? `<button class="notif-open-deposit-btn btn btn-primary btn-sm" data-notif-id="${escapeHtml(n.id)}" style="margin-top:8px;">📋 فتح نموذج الإيداع</button>` : ''}
            ${isActionPending ? `
              <div class="notif-action-row" style="display:flex;gap:8px;margin-top:10px;" data-notif-id="${escapeHtml(n.id)}">
                <button class="btn btn-primary btn-sm notif-accept-btn" style="flex:1;"
                  data-meta-type="${escapeHtml(meta.type || '')}"
                  data-transaction-id="${escapeHtml(meta.transaction_id || '')}"
                  data-request-id="${escapeHtml(meta.request_id || '')}">
                  ✅ قبول
                </button>
                <button class="btn btn-secondary btn-sm notif-reject-btn" style="flex:1;color:var(--danger);"
                  data-meta-type="${escapeHtml(meta.type || '')}"
                  data-transaction-id="${escapeHtml(meta.transaction_id || '')}"
                  data-request-id="${escapeHtml(meta.request_id || '')}">
                  ❌ رفض
                </button>
              </div>` : ''}
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:6px;">${timeAgo(n.created_at)}</div>
          </div>
          <div style="display:flex;gap:6px;flex-shrink:0;">
            ${!isRead ? `<button class="btn btn-secondary btn-sm mark-read-btn" data-id="${escapeHtml(n.id)}" title="تحديد كمقروء">
              <i data-lucide="check" style="width:12px;height:12px"></i>
            </button>` : ''}
            <button class="btn btn-secondary btn-sm hide-notif-btn" data-id="${escapeHtml(n.id)}"
              style="color:var(--text-muted);" title="إخفاء">
              <i data-lucide="eye-off" style="width:12px;height:12px"></i>
            </button>
          </div>
        </div>`;

      wrap.appendChild(card);
    }

    listEl.innerHTML = '';
    listEl.appendChild(wrap);

    listEl.querySelectorAll('.mark-read-btn').forEach(btn => {
      btn.addEventListener('click', () => this._markRead(btn.dataset.id));
    });
    listEl.querySelectorAll('.hide-notif-btn').forEach(btn => {
      btn.addEventListener('click', () => this._hide(btn.dataset.id));
    });
    listEl.querySelectorAll('.notif-open-deposit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const notif = notifs.find(n => n.id === btn.dataset.notifId);
        if (notif) this._handleNotificationClick(notif);
      });
    });
    listEl.querySelectorAll('.notif-accept-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row    = btn.closest('.notif-action-row');
        const notifId = row?.dataset.notifId;
        await this._handleTransferAction('accept', btn.dataset, notifId);
      });
    });
    listEl.querySelectorAll('.notif-reject-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const row    = btn.closest('.notif-action-row');
        const notifId = row?.dataset.notifId;
        await this._handleTransferAction('reject', btn.dataset, notifId);
      });
    });

    if (window.lucide) lucide.createIcons();
  },

  async _markRead(notifId) {
    const uid  = AuthService.getCurrentUserId();
    const notif = AppStore.getState('notifications').find(n => n.id === notifId);
    if (!notif) return;

    const readBy = Array.isArray(notif.read_by) ? notif.read_by : JSON.parse(notif.read_by || '[]');
    if (readBy.includes(uid)) return;

    const newReadBy = [...readBy, uid];
    const result    = await repo.update(TABLES.NOTIFICATIONS, notifId, { read_by: newReadBy });
    if (isOk(result)) {
      AppStore.decrementUnreadCount();
      await AppStore.refreshData();
      await this._load();
    }
  },

  async _markAllRead() {
    const uid    = AuthService.getCurrentUserId();
    const notifs = AppStore.getState('notifications') || [];
    const unread = notifs.filter(n => {
      const rb = Array.isArray(n.read_by) ? n.read_by : JSON.parse(n.read_by || '[]');
      return !rb.includes(uid);
    });

    for (const n of unread) {
      const rb  = Array.isArray(n.read_by) ? n.read_by : JSON.parse(n.read_by || '[]');
      await repo.update(TABLES.NOTIFICATIONS, n.id, { read_by: [...rb, uid] });
    }

    showToast('تم تحديد الكل كمقروء', 'success');
    await AppStore.refreshData();
    await this._load();
  },

  async _hide(notifId) {
    const uid   = AuthService.getCurrentUserId();
    const notif = AppStore.getState('notifications').find(n => n.id === notifId);
    if (!notif) return;

    const hiddenBy    = Array.isArray(notif.hidden_by) ? notif.hidden_by : JSON.parse(notif.hidden_by || '[]');
    const newHiddenBy = [...hiddenBy, uid];
    const result      = await repo.update(TABLES.NOTIFICATIONS, notifId, { hidden_by: newHiddenBy });
    if (isOk(result)) {
      await AppStore.refreshData();
      await this._load();
    }
  },

  /* ── معالجة النقر على إشعار account_share ── */
  async _handleNotificationClick(notification) {
    if (notification.type !== 'account_share') return;
    try {
      const data = JSON.parse(notification.data || '{}');
      if (!data.action || !data.entity_name) {
        console.warn('⚠️ _handleNotificationClick: بيانات الإشعار غير مكتملة', notification.id);
        return;
      }

      // خريطة العمليات المدعومة → معرّفات DOM الفعلية في DataEntryComponent
      const operationMap = {
        deposit    : { formTabId: 'form-tab-deposit',    searchId: 'dep-bank-search' },
        collection : { formTabId: 'form-tab-collection', searchId: 'col-company-search' },
      };
      const config = operationMap[data.action];

      // 1. الانتقال إلى تبويب إدخال البيانات
      if (typeof _navigateTo === 'function') {
        await _navigateTo('data-entry');
      } else {
        const tabBtn = document.querySelector('[data-tab="data-entry"]');
        if (tabBtn) tabBtn.click();
        await new Promise(r => setTimeout(r, 400));
      }

      // نوع غير مدعوم حالياً (transfer…): انتقل فقط واعرض الرقم للبحث اليدوي
      if (!config) {
        showToast(`📋 انتقل إلى إدخال البيانات وابحث عن: ${data.entity_name || ''}`, 'info');
        return;
      }

      // 2. تفعيل نموذج العملية المناسب
      const formTabBtn = document.getElementById(config.formTabId);
      if (formTabBtn) {
        formTabBtn.click();
        await new Promise(r => setTimeout(r, 200));
      }

      // 3. تعبئة حقل البحث باسم الكيان
      const input = document.getElementById(config.searchId);
      if (!input) {
        showToast('⚠️ افتح النموذج يدوياً', 'warning');
        return;
      }

      input.value = data.entity_name || '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => setTimeout(r, 150));

      // 4. اختيار أول نتيجة تلقائياً
      const dropdown  = input.nextElementSibling;
      const firstItem = dropdown?.firstElementChild;
      if (firstItem && dropdown?.style.display !== 'none') {
        firstItem.click();
        const typeNames = { deposit: 'الإيداع', collection: 'التحصيل' };
        showToast(`✅ تم تعبئة نموذج ${typeNames[data.action] || 'العملية'}`, 'success');
      } else {
        showToast('⚠️ لم يُعثر على الحساب، ابحث يدوياً', 'warning');
      }
    } catch (e) {
      console.warn('⚠️ _handleNotificationClick:', e.message);
      showToast('تعذّر فتح النموذج', 'warning');
    }
  },

  /* ── مودال إرسال إشعار (للمدير) ── */
  _buildSendModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.display = 'none';
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeSendModal(); });

    const box = document.createElement('div');
    box.className = 'modal-box';
    box.style.maxWidth = '460px';
    box.id = 'notif-send-box';

    const users = AppStore.getState('users');

    box.innerHTML = `
      <div class="modal-header">
        <h3 class="modal-title">إرسال إشعار جديد</h3>
        <button class="modal-close" id="notif-send-close">✕</button>
      </div>
      <div class="form-group">
        <label class="form-label">العنوان <span class="required">*</span></label>
        <input id="ns-title" type="text" class="form-control" placeholder="عنوان الإشعار">
      </div>
      <div class="form-group">
        <label class="form-label">النص <span class="required">*</span></label>
        <textarea id="ns-body" class="form-control" rows="3" placeholder="نص الإشعار"></textarea>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-group">
          <label class="form-label">النوع</label>
          <select id="ns-type" class="form-control">
            <option value="info">معلومات</option>
            <option value="warning">تحذير</option>
            <option value="success">نجاح</option>
            <option value="error">خطأ</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">الموجَّه إلى</label>
          <select id="ns-target-type" class="form-control">
            <option value="all">الجميع</option>
            <option value="specific">مستخدمون محددون</option>
          </select>
        </div>
      </div>
      <div id="ns-users-section" style="display:none;margin-bottom:12px;">
        <label class="form-label">اختر المستخدمين</label>
        <div style="display:flex;flex-direction:column;gap:6px;max-height:160px;overflow-y:auto;
          border:1px solid var(--border);border-radius:8px;padding:8px;margin-top:6px;">
          ${users.map(u => `
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
              <input type="checkbox" class="ns-user-cb" value="${escapeHtml(u.id)}">
              <span style="font-size:0.85rem;">${escapeHtml(u.display_name)}
                <span style="color:var(--text-muted);font-size:0.75rem;">(${ROLE_LABELS[u.role] || u.role})</span>
              </span>
            </label>`).join('')}
        </div>
      </div>
      <div id="ns-error" class="form-error"></div>
      <div style="display:flex;gap:10px;margin-top:16px;">
        <button id="ns-send-btn" class="btn btn-primary" style="flex:2;">إرسال</button>
        <button id="ns-cancel-btn" class="btn btn-secondary" style="flex:1;">إلغاء</button>
      </div>`;

    box.querySelector('#notif-send-close').addEventListener('click', () => this._closeSendModal());
    box.querySelector('#ns-cancel-btn').addEventListener('click',    () => this._closeSendModal());
    box.querySelector('#ns-send-btn').addEventListener('click',      () => this._send());
    box.querySelector('#ns-target-type').addEventListener('change', e => {
      box.querySelector('#ns-users-section').style.display =
        e.target.value === 'specific' ? 'block' : 'none';
    });

    overlay.appendChild(box);
    return overlay;
  },

  _openSendModal() {
    const box = document.getElementById('notif-send-box');
    if (box) {
      ['#ns-title','#ns-body'].forEach(s => { const el = box.querySelector(s); if (el) el.value = ''; });
      box.querySelector('#ns-error').textContent = '';
      box.querySelectorAll('.ns-user-cb').forEach(cb => { cb.checked = false; });
      box.querySelector('#ns-target-type').value = 'all';
      box.querySelector('#ns-users-section').style.display = 'none';
    }
    if (this._sendModal) this._sendModal.style.display = 'flex';
  },

  _closeSendModal() {
    if (this._sendModal) this._sendModal.style.display = 'none';
  },

  async _send() {
    const box     = document.getElementById('notif-send-box');
    const errEl   = box.querySelector('#ns-error');
    const title   = box.querySelector('#ns-title').value.trim();
    const body    = box.querySelector('#ns-body').value.trim();
    const type    = box.querySelector('#ns-type').value;
    const ttype   = box.querySelector('#ns-target-type').value;

    if (!title) { errEl.textContent = 'العنوان مطلوب'; return; }
    if (!body)  { errEl.textContent = 'النص مطلوب';    return; }

    let target;
    if (ttype === 'specific') {
      const ids = [...box.querySelectorAll('.ns-user-cb:checked')].map(cb => cb.value);
      if (!ids.length) { errEl.textContent = 'اختر مستخدماً واحداً على الأقل'; return; }
      target = ids;
    } else {
      target = 'all';
    }

    const sendBtn = box.querySelector('#ns-send-btn');
    const restore = setButtonLoading(sendBtn, 'جاري الإرسال...');

    const data = {
      title,
      body,
      type,
      target     : JSON.stringify(target),
      sender_id  : AuthService.getCurrentUserId(),
      read_by    : '[]',
      hidden_by  : '[]',
    };

    const result = await repo.create(TABLES.NOTIFICATIONS, data);
    restore();

    if (isOk(result)) {
      showToast('تم إرسال الإشعار بنجاح', 'success');
      this._closeSendModal();
      await AppStore.refreshData();
      await this._load();
    } else {
      errEl.textContent = result.error;
    }
  },

  /* ── معالجة أزرار قبول/رفض طلبات التحويل ── */
  async _handleTransferAction(action, btnData, notifId) {
    const { metaType, transactionId, requestId } = btnData;

    const label = action === 'accept' ? 'قبول' : 'رفض';
    const confirmed = await confirmDialog(
      `هل أنت متأكد من ${label} هذا الطلب؟`,
      label, 'إلغاء', 'warning'
    );
    if (!confirmed) return;

    let result;

    if (metaType === 'transfer_request' && requestId) {
      // طلب أموال: الطرف المطلوب منه يوافق أو يرفض
      if (action === 'accept') {
        result = await AccountingService.createTransferFromRequest(requestId);
      } else {
        result = await repo.update(TABLES.TRANSFER_REQUESTS, requestId, {
          status    : 'rejected',
          updated_at: new Date().toISOString(),
        });
      }
    } else if (metaType === 'transfer_approval' && transactionId) {
      // تحويل قديم بانتظار موافقة (backward compat)
      result = action === 'accept'
        ? await AccountingService.approveTransaction(transactionId)
        : await AccountingService.rejectTransaction(transactionId);
    } else {
      showToast('لا يمكن تحديد نوع الطلب', 'error');
      return;
    }

    if (isOk(result)) {
      showToast(action === 'accept' ? '✅ تم القبول بنجاح' : '✅ تم الرفض', 'success');
      if (notifId) await this._markRead(notifId);
      await AppStore.refreshData();
      await this._load();
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },
};

window.NotificationsComponent = NotificationsComponent;
console.log('✅ NotificationsComponent.js محمّل');
