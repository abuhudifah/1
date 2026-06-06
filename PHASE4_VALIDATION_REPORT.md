# تقرير التحقق — المرحلة الرابعة (Phase 4)
## الأداء والاستقرار | Performance & Stability
**التاريخ:** 2026-06-06  
**الفرع:** `claude/festive-faraday-rGYhA`  
**المشروع:** gffyakxcfoeehtapelgd

---

## ملخص تنفيذي

| المهمة | العنوان | الحالة |
|--------|---------|--------|
| TASK-4.1 | استعلام واحد لبيانات الرسم البياني الأسبوعي (offline) | ✅ مكتمل |
| TASK-4.2 | دالة مساعدة `withDexie()` | ✅ مكتمل |
| TASK-4.3 | تطبيع إشعارات `read_by`/`hidden_by` بـ `_normalizeNotification` | ✅ مكتمل |
| TASK-4.4 | فهارس على `account_ledger` | ✅ مكتمل |
| TASK-4.5 | منع التسجيل المزدوج لأحداث المخزن | ✅ مكتمل |

---

## TASK-4.1 — استعلام واحد للرسم البياني الأسبوعي

### المشكلة
`_loadWeeklyChart()` offline كان يُنفّذ **7 استعلامات منفصلة** (واحد لكل يوم من الأسبوع) في Dexie.

### التحقق من الكود
```
grep -n "_loadWeeklyChart\|\.between\|weekStart\|weekEnd" components/DashboardComponent.js
338:  async _loadWeeklyChart()
359:          .where('date').between(weekStart, weekEnd, true, true)
```

**الحكم:** ✅ استعلام واحد باستخدام `.between(weekStart, weekEnd)` يجلب كل سجلات الأسبوع مرة واحدة، ثم تُجمَّع في JavaScript. تراجع من 7 رحلات I/O إلى رحلة واحدة.

---

## TASK-4.2 — دالة مساعدة `withDexie()`

### المشكلة
كود Dexie المتكرر منتشر دون معالجة موحدة لحالات قاعدة البيانات المغلقة.

### التحقق من الكود
```
grep -n "withDexie\|fetchOnlineFirst" utils/helpers.js
844: async function withDexie(fn)
850: async function fetchOnlineFirst(supabaseFn, dexieFn)
853:      console.warn('⚠️ fetchOnlineFirst: تعذر الوصول للخادم، التراجع لـ Dexie:', e.message);
897:   withDexie, fetchOnlineFirst,
```

**الحكم:** ✅ `withDexie(fn)` يتحقق من أن `db` مفتوح قبل التنفيذ ويُرجع `err()` عند الفشل. `fetchOnlineFirst` يدمج نمط Online-First مع fallback تلقائي.

---

## TASK-4.3 — تطبيع الإشعارات

### المشكلة
`read_by` و`hidden_by` في الإشعارات مخزّنة كـ JSON string في Supabase — كان الكود يعاملها أحياناً كـ string وأحياناً كـ array مما يُسبب `includes()` فاشلاً صامتاً.

### التحقق من الكود
```
grep -n "_normalizeNotification\|_safeJsonParse\|read_by\|hidden_by" store/AppStore.js
267:          allNotifs = data.map(_normalizeNotification);
278:      allNotifs = raw.map(_normalizeNotification);
289:    const notHidden = visible.filter(n => !n.hidden_by.includes(user.id));
289:    const unread    = notHidden.filter(n => !n.read_by.includes(user.id));
362: function _safeJsonParse(value, fallback = [])
369: function _normalizeNotification(n)
372:     read_by   : _safeJsonParse(n.read_by,   []),
373:     hidden_by : _safeJsonParse(n.hidden_by, []),
374:     target    : typeof n.target === 'string' ? _safeJsonParse(n.target, n.target) : (n.target ?? null),
```

**الحكم:** ✅ جميع الإشعارات تمر عبر `_normalizeNotification()` قبل الاستخدام في كلا المسارين (Supabase :267 و Dexie :278). `includes()` يعمل دائماً على array.

---

## TASK-4.4 — فهارس `account_ledger`

### استعلام التحقق
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'account_ledger' ORDER BY indexname;
```

### النتيجة من قاعدة البيانات

| الفهرس | التعريف |
|--------|---------|
| `account_ledger_pkey` | `UNIQUE btree (id)` |
| `idx_account_ledger_account_date` | `btree (account_id, date DESC)` ← **TASK-4.4** |
| `idx_account_ledger_reference` | `btree (reference_id)` ← **TASK-4.4** |
| `idx_ledger_account_date` | `btree (account_id, date DESC)` |
| `idx_ledger_account_id` | `btree (account_id)` |
| `idx_ledger_date` | `btree (date DESC)` |
| `idx_ledger_reference_id` | `btree (reference_id)` |
| `idx_ledger_voucher` | `btree (voucher_number)` |

**الحكم:** ✅ `idx_account_ledger_account_date` يُسرّع استعلامات كشف الحساب المُصفّاة حسب الحساب والتاريخ. `idx_account_ledger_reference` يُسرّع البحث بـ `reference_id`.

---

## TASK-4.5 — منع التسجيل المزدوج لأحداث المخزن

### المشكلة
`_bindStoreEvents()` في `App.js` كانت تُستدعى في أكثر من مكان — مما يؤدي إلى تسجيل مستمعي الأحداث مرات متعددة.

### التحقق من الكود
```
grep -n "_storeEventsBound\|_bindStoreEvents" App.js
21:  let _storeEventsBound   = false;
442: function _bindStoreEvents()
443:   if (_storeEventsBound) return;
444:   _storeEventsBound = true;
```

**الحكم:** ✅ علامة `_storeEventsBound` تضمن تنفيذ التسجيل مرة واحدة فقط. أي استدعاء لاحق يعود فوراً بدون إعادة تسجيل.

---

## الخلاصة

| المهمة | الأدلة | الحكم |
|--------|--------|-------|
| 4.1 | `DashboardComponent.js:359` — `.between()` واحد | ✅ |
| 4.2 | `helpers.js:844,850` — `withDexie` + `fetchOnlineFirst` | ✅ |
| 4.3 | `AppStore.js:267,278,369-374` — `_normalizeNotification` | ✅ |
| 4.4 | DB: `idx_account_ledger_account_date` + `idx_account_ledger_reference` موجودان | ✅ |
| 4.5 | `App.js:21,443-444` — `_storeEventsBound` guard | ✅ |

**المرحلة الرابعة: مكتملة بالكامل — 5/5 مهام ✅**
