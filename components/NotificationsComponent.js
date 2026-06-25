/**
 * components/NotificationsComponent.js
 * نظام أبو حذيفة — الإشعارات
 * عرض + تحديد كمقروء + إخفاء + إرسال إشعار جديد (للمدير)
 * تبويبات: الكل | طلبات العهدة | إشعارات عامة
 */
'use strict';

const NotificationsComponent = {
  _sendModal: null,
  _activeTab: 'all', // 'all' | 'requests' | 'general'

  async render(container) {
    container.innerHTML = '';

    /* ─── الإشعارات موقوفة مؤقتاً ─── */
    if (typeof NOTIFICATIONS_PAUSED !== 'undefined' && NOTIFICATIONS_PAUSED) {
      container.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;
                    padding:60px 20px;text-align:center;gap:16px;">
          <div style="font-size:2.5rem;"><i data-lucide="bell-off" style="width:2.5rem;height:2.5rem;opacity:0.55;"></i></div>
          <h3 style="font-size:1.1rem;font-weight:700;color:var(--text-primary);margin:0;">
            الإشعارات موقوفة مؤقتاً
          </h3>
          <p style="font-size:0.88rem;color:var(--text-secondary);margin:0;max-width:340px;line-height:1.6;">
            تم تجميد هذا التبويب مؤقتاً لتوفير مساحة قاعدة البيانات.
            سيتم إعادة تفعيله لاحقاً.
          </p>
        </div>`;
      return;
    }
    /* ─────────────────────────────────────── */

    const wrap = document.createElement('div');

    // ── شريط العنوان والأزرار ──
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;';
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

    // ── تبويبات التصفية ──
    const tabsBar = document.createElement('div');
    tabsBar.id = 'notif-tabs';
    tabsBar.style.cssText = 'display:flex;gap:8px;margin-bottom:16px;border-bottom:2px solid var(--border-color);padding-bottom:0;';

    const tabDefs = [
      { key: 'all',      label: 'الكل' },
      { key: 'requests', label: 'طلبات العهدة' },
      { key: 'general',  label: 'إشعارات' },
    ];

    tabDefs.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.dataset.tabKey = key;
      btn.textContent = label;
      btn.style.cssText = `
        background:none;border:none;cursor:pointer;padding:8px 14px;font-size:0.88rem;
        font-weight:600;color:var(--text-secondary);border-bottom:2px solid transparent;
        margin-bottom:-2px;transition:color .15s,border-color .15s;
      `;
      if (key === this._activeTab) {
        btn.style.color = 'var(--accent)';
        btn.style.borderBottomColor = 'var(--accent)';
      }
      btn.addEventListener('click', () => {
        this._activeTab = key;
        tabsBar.querySelectorAll('button').forEach(b => {
          b.style.color = 'var(--text-secondary)';
          b.style.borderBottomColor = 'transparent';
        });
        btn.style.color = 'var(--accent)';
        btn.style.borderBottomColor = 'var(--accent)';
        this._load();
      });
      tabsBar.appendChild(btn);
    });

    wrap.appendChild(tabsBar);

    const listEl = document.createElement('div');
    listEl.id = 'notif-list';
    listEl.innerHTML = `<div class="skeleton" style="height:70px;border-radius:10px;margin-bottom:8px;"></div>`.repeat(3);
    wrap.appendChild(listEl);

    // أزل أي مودال قديم من body قبل إنشاء جديد (حالة إعادة الرسم)
    const _staleModal = document.getElementById('notif-send-box');
    if (_staleModal) _staleModal.parentElement?.remove();

    this._sendModal = this._buildSendModal();
    document.body.appendChild(this._sendModal);

    container.appendChild(wrap);

    // جلب بيانات حديثة من الخادم قبل العرض
    if (AppStore.refreshNotifications) await AppStore.refreshNotifications();

    await this._load();
    if (window.lucide) lucide.createIcons();
  },

  async _load() {
    const listEl = document.getElementById('notif-list');
    if (!listEl) return;

    const uid    = AuthService.getCurrentUserId();
    const all    = AppStore.getState('notifications') || [];

    // تصفية حسب التبويب النشط
    const notifs = all.filter(n => {
      let meta = {};
      try { meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : (n.metadata || {}); } catch { meta = {}; }
      const isRequest = meta.type === 'transfer_request';
      if (this._activeTab === 'requests') return isRequest;
      if (this._activeTab === 'general')  return !isRequest;
      return true; // 'all'
    });

    if (!notifs.length) {
      const emptyMsg = {
        all:      'لا توجد إشعارات',
        requests: 'لا توجد طلبات عهدة',
        general:  'لا توجد إشعارات عامة',
      }[this._activeTab] || 'لا توجد إشعارات';

      listEl.innerHTML = `<div class="empty-state">
        <div class="empty-state-icon"><i data-lucide="bell-off" style="width:3rem;height:3rem;opacity:0.45;"></i></div>
        <div class="empty-state-text">${emptyMsg}</div></div>`;
      if (window.lucide) lucide.createIcons();
      return;
    }

    const typeColors = { info:'info', warning:'warning', success:'success', error:'danger' };
    const _niSize = 'width:20px;height:20px;vertical-align:middle;';
    const typeIcons = {
      info   : `<i data-lucide="info" style="${_niSize}stroke:var(--info);"></i>`,
      warning: `<i data-lucide="alert-triangle" style="${_niSize}stroke:var(--warning);"></i>`,
      success: `<i data-lucide="check-circle" style="${_niSize}stroke:var(--success);"></i>`,
      error  : `<i data-lucide="x-circle" style="${_niSize}stroke:var(--danger);"></i>`,
    };

    const wrap = document.createElement('div');
    wrap.style.display = 'flex';
    wrap.style.flexDirection = 'column';
    wrap.style.gap = '10px';

    for (const n of notifs) {
      const readBy = Array.isArray(n.read_by) ? n.read_by : JSON.parse(n.read_by || '[]');
      const isRead = readBy.includes(uid);
      const color  = typeColors[n.type] || 'neutral';
      const text   = n.message || n.body || '';

      // استخراج metadata للإشعارات التفاعلية
      let meta = {};
      try { meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : (n.metadata || {}); } catch { meta = {}; }
      const isTransferRequest  = meta.type === 'transfer_request';
      const isActionPending    = isTransferRequest && !isRead;

      const card = document.createElement('div');
      card.className = 'glass-card';
      card.style.cssText = `padding:14px 16px;border-right:4px solid var(--${isActionPending ? 'warning' : color});opacity:${isRead ? '0.7' : '1'};`;

      card.innerHTML = `
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <span style="flex-shrink:0;display:inline-flex;align-items:center;">${isTransferRequest ? `<i data-lucide="mail" style="width:20px;height:20px;stroke:var(--accent);"></i>` : (typeIcons[n.type] || typeIcons.info)}</span>
          <div style="flex:1;min-width:0;">
            <div style="font-weight:${isRead ? '500' : '700'};margin-bottom:4px;">${escapeHtml(n.title)}</div>
            <div style="font-size:0.88rem;color:var(--text-secondary);white-space:pre-line;">${escapeHtml(text)}</div>
            ${isActionPending ? `
              <div class="notif-action-row" style="display:flex;gap:8px;margin-top:10px;" data-notif-id="${escapeHtml(n.id)}">
                <button class="btn btn-primary btn-sm notif-accept-btn" style="flex:1;"
                  data-meta-type="${escapeHtml(meta.type || '')}"
                  data-transaction-id="${escapeHtml(meta.transaction_id || '')}"
                  data-request-id="${escapeHtml(meta.request_id || '')}">
                  <i data-lucide="check" style="width:13px;height:13px;vertical-align:middle;pointer-events:none;"></i> قبول
                </button>
                <button class="btn btn-secondary btn-sm notif-reject-btn" style="flex:1;color:var(--danger);"
                  data-meta-type="${escapeHtml(meta.type || '')}"
                  data-transaction-id="${escapeHtml(meta.transaction_id || '')}"
                  data-request-id="${escapeHtml(meta.request_id || '')}">
                  <i data-lucide="x" style="width:13px;height:13px;vertical-align:middle;pointer-events:none;"></i> رفض
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
    const result = await repo.update(TABLES.NOTIFICATIONS, notifId, { read_by: newReadBy });
    if (isOk(result)) {
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

    if (!unread.length) { showToast('لا يوجد إشعارات غير مقروءة', 'info'); return; }

    const results = await Promise.all(
      unread.map(n => {
        const rb = Array.isArray(n.read_by) ? n.read_by : JSON.parse(n.read_by || '[]');
        return repo.update(TABLES.NOTIFICATIONS, n.id, { read_by: [...rb, uid] });
      })
    );

    const failed = results.filter(r => !isOk(r)).length;
    if (failed > 0) showToast(`تم تحديد معظمها — ${failed} فشل`, 'warning');
    else showToast('تم تحديد الكل كمقروء', 'success');

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
          border:1px solid var(--border-color);border-radius:8px;padding:8px;margin-top:6px;">
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
    if (this._sendModal) {
      this._sendModal.style.display = 'flex';
      document.body.style.overflow = 'hidden';
    }
  },

  _closeSendModal() {
    if (this._sendModal) {
      this._sendModal.classList.add('is-closing');
      setTimeout(() => {
        if (this._sendModal) {
          this._sendModal.style.display = 'none';
          this._sendModal.classList.remove('is-closing');
        }
        document.body.style.overflow = '';
      }, 220);
    }
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
      target,
      sender_id  : AuthService.getCurrentUserId(),
      read_by    : [],
      hidden_by  : [],
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

  /* ── معالجة أزرار قبول/رفض طلبات العهدة ── */
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
      // طلب عهدة: الطرف المطلوب منه يوافق أو يرفض
      if (action === 'accept') {
        result = await AccountingService.createTransferFromRequest(requestId);
      } else {
        // جلب الطلب للحصول على from_user_id قبل التحديث
        const reqResult = await repo.getById(TABLES.TRANSFER_REQUESTS, requestId);
        result = await repo.update(TABLES.TRANSFER_REQUESTS, requestId, {
          status    : 'rejected',
          updated_at: new Date().toISOString(),
        });
        // إشعار رفض للطالب
        if (isOk(result) && isOk(reqResult)) {
          const req = reqResult.data;
          const currentUser = AuthService.getCurrentUser();
          const senderId = req.from_user_id;
          if (senderId && senderId !== currentUser?.id) {
            const notifData = {
              title    : '❌ رُفض طلب العهدة',
              body     : `${currentUser?.display_name || 'المستخدم'} رفض طلب عهدة بمبلغ ${formatCurrency(req.amount)}.`,
              type     : 'warning',
              target   : JSON.stringify([senderId]),
              sender_id: currentUser?.id,
              read_by  : '[]',
              hidden_by: '[]',
            };
            await repo.create(TABLES.NOTIFICATIONS, notifData)
              .catch(e => console.warn('فشل إرسال إشعار الرفض:', e));
          }
        }
      }
    } else {
      showToast('لا يمكن تحديد نوع الطلب', 'error');
      return;
    }

    if (isOk(result)) {
      showToast(action === 'accept' ? '✅ تم القبول بنجاح' : '✅ تم الرفض', 'success');
      if (notifId) await this._markRead(notifId);
    } else {
      showToast(`❌ ${result.error}`, 'error');
    }
  },
};

window.NotificationsComponent = NotificationsComponent;
console.log('✅ NotificationsComponent.js محمّل');
