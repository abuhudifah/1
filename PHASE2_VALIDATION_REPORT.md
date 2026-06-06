# تقرير التحقق — المرحلة الثانية (Phase 2)
## الأمان والمصادقة | Security & Authentication
**التاريخ:** 2026-06-06  
**الفرع:** `claude/festive-faraday-rGYhA`  
**المشروع:** gffyakxcfoeehtapelgd

---

## ملخص تنفيذي

| المهمة | العنوان | الحالة |
|--------|---------|--------|
| TASK-2.1 | حذف حقل `eq` من تخزين الدخول السريع | ✅ مكتمل |
| TASK-2.2 | تقييد سياسات RLS على `users` للمستخدمين المصادقين فقط | ✅ مكتمل |
| TASK-2.3 | التحقق من حالة `is_active` عند كل تنقل | ✅ مكتمل |
| TASK-2.4 | تمييز مهلة الخمول حسب الدور | ✅ مكتمل |
| TASK-2.5 | حذف `quick_equation_hash` من استعلامات قائمة المستخدمين | ✅ مكتمل |
| TASK-2.6 | التحقق من حدود المبلغ عبر `AMOUNT_CONFIG` | ✅ مكتمل |

---

## TASK-2.1 — حذف `eq` من localStorage

### المشكلة
كان `enableQuickLogin()` يحفظ `{ hash, userId, eq: trimmed }` في `localStorage` — أي النص الخام للمعادلة مخزّن محلياً بدون تشفير.

### الإصلاح
**الملف:** `services/AuthService.js:218`

```
grep -n "localStorage.setItem.*ahu_quick" services/AuthService.js
218: localStorage.setItem(`ahu_quick_${uid}`, JSON.stringify({ hash, userId: uid }))
```

**النتيجة:** لا يوجد حقل `eq` في القيمة المحفوظة. الهاش فقط.

### دالة الترحيل
```
grep -n "_migrateQuickLoginStorage" services/AuthService.js
146:    _migrateQuickLoginStorage();
466: function _migrateQuickLoginStorage()
```

الدالة تُستدعى تلقائياً في `checkSession()` (سطر 146) لتنظيف أي إدخالات قديمة تحتوي على `eq`.

### تسجيل الدخول بدون اتصال
```
grep -n "stored\.hash\|stored\.userId\|stored\.eq" services/AuthService.js
304:        if (stored.hash !== hash) continue;
305:        if (stored.userId && typeof db !== 'undefined' && db.isOpen()) {
306:          offlineProfile = await db.users.get(stored.userId);
```

**الحكم:** ✅ لا يُقرأ `stored.eq` في أي مسار.

---

## TASK-2.2 — RLS على جدول `users`

### استعلام التحقق
```sql
SELECT policyname, cmd, roles FROM pg_policies WHERE tablename = 'users' ORDER BY policyname;
```

### النتيجة من قاعدة البيانات

| السياسة | الأمر | الأدوار |
|---------|-------|---------|
| users_delete_admin | DELETE | `{authenticated}` |
| users_insert_admin | INSERT | `{authenticated}` |
| users_select_admin | SELECT | `{authenticated}` |
| users_select_assistant | SELECT | `{authenticated}` |
| users_select_own | SELECT | `{authenticated}` |
| users_update_admin | UPDATE | `{authenticated}` |
| users_update_own | UPDATE | `{authenticated}` |

**الحكم:** ✅ جميع السياسات السبع مقيدة بدور `authenticated` — لا توجد سياسة بدور `public`.

---

## TASK-2.3 — التحقق من `is_active` عند التنقل

### الدالة في AuthService
```
grep -n "verifyIsActive\|_lastActiveCheckTs\|_ACTIVE_CHECK_INTERVAL_MS" services/AuthService.js
521: let _lastActiveCheckTs = 0;
522: const _ACTIVE_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 دقائق
524: async function verifyIsActive()
529:   const useCache = !isOnline() || (now - _lastActiveCheckTs) < _ACTIVE_CHECK_INTERVAL_MS;
535:     _lastActiveCheckTs = now;
583:   verifyIsActive,
```

### الاستدعاء في App.js
```
grep -n "verifyIsActive" App.js
352:  const activeResult = await AuthService.verifyIsActive();
```

**السلوك:** كل `_navigateTo()` يستدعي `verifyIsActive()`. إذا عاد بخطأ → toast + logout + شاشة تسجيل الدخول.

**آلية التخزين المؤقت:** يستعلم Supabase مرة واحدة كل 5 دقائق فقط (عند الاتصال). بدون اتصال: يستخدم الحالة المحلية.

**الحكم:** ✅ فعّال. حساب معطّل لن يتمكن من الوصول لأي تبويب.

---

## TASK-2.4 — مهلة الخمول حسب الدور

### IdleTimer.js
```
grep -n "AGENT_IDLE\|ADMIN_IDLE\|_timeoutMs\|start(" services/IdleTimer.js
28:  const AGENT_IDLE_TIMEOUT_MS = 5 * 60 * 1000;   // 5 دقائق
31:  const ADMIN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;  // 30 دقيقة
55:  let _timeoutMs = AGENT_IDLE_TIMEOUT_MS;
253:  function start(timeoutMs)
254:    _timeoutMs = (typeof timeoutMs === 'number' && timeoutMs > 0)
324:    AGENT_IDLE_TIMEOUT_MS,
325:    ADMIN_IDLE_TIMEOUT_MS,
```

### App.js — استدعاء start()
```
grep -n "idleMs\|AGENT_IDLE_TIMEOUT\|ADMIN_IDLE_TIMEOUT" App.js
100:    const idleMs = profile.role === ROLES.AGENT
101:      ? IdleTimer.AGENT_IDLE_TIMEOUT_MS
102:      : IdleTimer.ADMIN_IDLE_TIMEOUT_MS;
103:    IdleTimer.start(idleMs);
562:      const idleMs = user.role === ROLES.AGENT
563:        ? IdleTimer.AGENT_IDLE_TIMEOUT_MS
564:        : IdleTimer.ADMIN_IDLE_TIMEOUT_MS;
565:      IdleTimer.start(idleMs);
```

**الحكم:** ✅ المندوب: 5 دقائق | المدير/المساعد: 30 دقيقة. المهلة تُعاد تعيينها أيضاً عند إلغاء تسجيل الخروج.

---

## TASK-2.5 — حذف `quick_equation_hash` من قوائم المستخدمين

### AppStore.js
```
grep -n "quick_equation_hash" store/AppStore.js
# لا نتائج
```

`_loadUsers()` لا يجلب `quick_equation_hash` — فقط الحقول الإدارية.

### UsersComponent.js
```
grep -n "quick_equation_hash" components/UsersComponent.js
# لا نتائج
```

### AuthService.js — الاستعلام الخاص
```
grep -n "quick_equation_hash" services/AuthService.js
401:    ... select('...quick_equation_hash...')
```

يُجلب فقط عند استعلام ملف المستخدم الشخصي الخاص به.

**الحكم:** ✅ لا يُنقل الهاش إلى أي مكوّن عرض أو مخزن مشترك.

---

## TASK-2.6 — حدود المبلغ عبر `AMOUNT_CONFIG`

### config.js
```
grep -n "AMOUNT_CONFIG" config.js
272: const AMOUNT_CONFIG = Object.freeze({
335: window.AMOUNT_CONFIG = AMOUNT_CONFIG;
```

القيم: `MIN: 0.01` و `MAX: 10_000_000`.

### helpers.js
```
grep -n "isValidAmount\|AMOUNT_CONFIG" utils/helpers.js
664: function isValidAmount(value)
666:   const min = window.AMOUNT_CONFIG?.MIN ?? 0.01;
667:   const max = window.AMOUNT_CONFIG?.MAX ?? 10_000_000;
```

**الحكم:** ✅ حدود المبلغ مُدارة مركزياً. تغيير قيمة `AMOUNT_CONFIG` يؤثر فورياً على كل نقاط التحقق.

---

## الخلاصة

| المهمة | الأدلة | الحكم |
|--------|--------|-------|
| 2.1 | `AuthService.js:218` — لا `eq`؛ `:466` — دالة ترحيل | ✅ |
| 2.2 | DB: 7 سياسات، جميعها `{authenticated}` | ✅ |
| 2.3 | `AuthService.js:524` + `App.js:352` | ✅ |
| 2.4 | `IdleTimer.js:28,31` + `App.js:100-103` | ✅ |
| 2.5 | لا `quick_equation_hash` في AppStore أو UsersComponent | ✅ |
| 2.6 | `config.js:272` + `helpers.js:666-667` | ✅ |

**المرحلة الثانية: مكتملة بالكامل — 6/6 مهام ✅**
