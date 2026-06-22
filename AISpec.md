# AISpec — المواصفات الكاملة للنظام
## نظام أبو حذيفة المتكامل للصرافة والتحويلات

> **الإصدار:** 2.1 (مبني على الكود المصدري حصرًا)  
> **تاريخ الاستخراج:** 2026-06-22  
> **المصادر:** config.js، App.js، جميع Services، جميع Components، جميع ملفات SQL (27 migration)  
> **السياسة:** لا شيء من هذه الوثيقة مصدره ملفات التوثيق — كل قيمة مستخرجة مباشرةً من الكود

---

# الجزء الأول: رؤية النظام ونطاقه

## 1.1 الملخص التنفيذي

منصة إدارة مالية لشركات الصرافة والتحويلات، تعمل بواجهة عربية RTL بالكامل. تُمكِّن المندوبين الميدانيين من تسجيل العمليات أثناء انقطاع الإنترنت، وتضمن المزامنة التلقائية مع الخادم عند استعادة الاتصال، مع محاسبة بالقيد المزدوج لكل عملية.

## 1.2 نطاق الحل

### داخل النطاق
- تسجيل 10 أنواع من العمليات المالية (تحصيل، إيداع، سحب، مصروف، تحويل، تسليم، تسوية استرداد، استرداد إيداع فاشل، قيد محاسبي، تسليم عهدة)
- محاسبة بالقيد المزدوج مع دفتر أستاذ كامل
- إدارة حسابات بنكية مرتبطة بشركات
- إدارة عملاء مديونين مع تتبع الديون
- تتبع الإيداعات الفاشلة بحالاتها الأربع
- إشعارات داخلية مع تحديث فوري عبر Supabase Realtime
- سجل تدقيق لكل تعديل أو حذف على الجداول الحرجة
- تشغيل كامل دون اتصال (3 تبويبات) مع مزامنة تلقائية
- تصدير تقارير (Excel + PDF)
- أوامر نظام مركزية يُصدرها المدير لجميع الأجهزة
- سجل الأجهزة المتصلة مع إمكانية الإلغاء عن بُعد

### خارج النطاق
- تنفيذ تحويلات بنكية فعلية (النظام يسجّل فقط)
- تكامل مع أنظمة بنكية خارجية
- محاسبة ضريبية أو تقارير حكومية
- إدارة مخزون أو أصول ثابتة

## 1.3 السياق التشغيلي

| المتغير | الواقع (من الكود) |
|---------|-------------------|
| اللغة | العربية بالكامل، RTL |
| المنطقة الزمنية | Asia/Riyadh (دالة `getCurrentSaudiDate()`) |
| العملة | ريال سعودي، حدود المبلغ: 0.01 – 10,000,000 (`AMOUNT_CONFIG`) |
| الاتصال | متقطع — يعمل الجزء الأساسي offline |
| قاعدة البيانات المحلية | IndexedDB عبر Dexie.js، اسم القاعدة: `AbuHudhaifaDB` |
| قاعدة البيانات السحابية | Supabase (PostgreSQL) |

## 1.4 الأدوار

ثلاثة أدوار محددة في `config.js`:

| المعرّف | التسمية |
|---------|---------|
| `admin` | مدير |
| `admin_assistant` | مساعد إداري |
| `agent` | مندوب |

---

# الجزء الثاني: نماذج البيانات

## 2.1 الجداول الأصلية (موجودة قبل الـ migrations)

هذه الجداول موجودة بالأصل في Supabase ولا تحتوي عليها ملفات الـ migrations بشكل كامل. يُستنتج هيكلها من استعلامات الكود:

### `users`
| الحقل | المصدر |
|-------|--------|
| `id` | UUID, PK — من Supabase Auth |
| `username` | TEXT |
| `display_name` | TEXT |
| `role` | TEXT — `admin` \| `admin_assistant` \| `agent` |
| `is_active` | BOOLEAN |
| `account_number` | TEXT — صيغة `AGT000001` (مولَّد بـ `generate_account_number`) |
| `allowed_tabs` | JSONB أو TEXT[] — مُخصَّص للمساعد الإداري فقط |
| `allowed_companies` | TEXT[] DEFAULT `{}` — مُضاف في migration 20260612000008 |
| `allowed_banks` | TEXT[] DEFAULT `{}` — مُضاف في migration 20260612000008 |
| `allowed_users` | TEXT[] DEFAULT `{}` — مُضاف في migration 20260612000008 |
| `quick_login_enabled` | BOOLEAN DEFAULT false — مُضاف في migration 20260619000003 |
| `quick_equation_hash` | TEXT — هاش معادلة الدخول السريع |
| `assigned_debtors` | مصفوفة — معرّفات المدينين المُعيَّنين للمندوب |
| `last_login` | TIMESTAMPTZ |
| `version` | INTEGER DEFAULT 1 — مُضاف في migration 20260612000000 |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |

**ملاحظة حول `allowed_tabs` للمساعد الإداري:** يُقرأ من `users.allowed_tabs` ويُحوَّل من JSON إذا كان نصًا. إذا كانت المصفوفة فارغة → يحصل على `AGENT_TABS` افتراضيًا (من `getAllowedTabs()` في AuthService.js:1840-1844).

---

### `transactions`
| الحقل | النوع والقيود | المصدر |
|-------|--------------|--------|
| `id` | UUID PK | أصلي |
| `type` | TEXT — قيم محددة (انظر 2.5) | أصلي |
| `amount` | NUMERIC — 0.01 إلى 10,000,000 | أصلي |
| `date` | DATE | أصلي |
| `agent_id` | UUID FK → users | أصلي |
| `company_id` | UUID FK → companies | أصلي |
| `bank_account_id` | UUID FK → bank_accounts | أصلي |
| `customer_id` | UUID FK → debtors | أصلي |
| `customer_name` | TEXT | أصلي |
| `from_agent_id` | UUID FK → users | أصلي |
| `to_agent_id` | UUID FK → users | أصلي |
| `description` | TEXT | أصلي |
| `expense_type` | TEXT | أصلي |
| `approval_status` | TEXT — `approved` \| `pending` \| `rejected` | أصلي |
| `approved_by` | UUID FK → users | أصلي |
| `approved_at` | TIMESTAMPTZ | أصلي |
| `status` | TEXT | أصلي |
| `idempotency_key` | UUID — UNIQUE partial (WHERE NOT NULL) | migration 20260612000000 |
| `device_id` | TEXT | migration 20260612000000 |
| `local_timestamp` | TIMESTAMPTZ | migration 20260612000000 |
| `version` | INTEGER NOT NULL DEFAULT 1 | migration 20260612000000 |
| `reverses_id` | UUID FK → transactions (self-ref, ON DELETE SET NULL) | migration 20260615000002 |

**فهرس:** `idx_transactions_idempotency_key` — partial UNIQUE WHERE NOT NULL

---

### `bank_accounts`
| الحقل | النوع | المصدر |
|-------|-------|--------|
| `id` | UUID PK | أصلي |
| `name` | TEXT | أصلي |
| `account_number` | TEXT | أصلي — مُحسَّن في migration 20260612000006/7 |
| `bank_name` | TEXT | أصلي |
| `company_id` | UUID FK → companies | أصلي |
| `opening_balance` | NUMERIC — مُضاف في migration 20260617000004 | migration |
| `is_active` | BOOLEAN | أصلي |
| `version` | INTEGER NOT NULL DEFAULT 1 | migration 20260612000000 |

---

### `companies`
| الحقل | النوع | المصدر |
|-------|-------|--------|
| `id` | UUID PK | أصلي |
| `name` | TEXT | أصلي |
| `account_number` | TEXT — صيغة `COM000001` | migration 20260612000008 |
| `account_prefix` | TEXT — كان UNIQUE، أُزيل القيد في migration 20260617000005 | أصلي |
| `is_active` | BOOLEAN | أصلي |
| `version` | INTEGER NOT NULL DEFAULT 1 | migration 20260612000000 |

---

### `debtors`
| الحقل | النوع | المصدر |
|-------|-------|--------|
| `id` | UUID PK | أصلي |
| `name` | TEXT NOT NULL | أصلي |
| `phone` | TEXT | أصلي |
| `amount_owed` | NUMERIC | أصلي |
| `assigned_agents` | UUID[] أو JSONB | أصلي |
| `notes` | TEXT | أصلي |
| `is_active` | BOOLEAN | أصلي |
| `version` | INTEGER NOT NULL DEFAULT 1 | migration 20260612000000 |

**RLS:** المدير فقط يرى الكل (migration 20260617000002)؛ المندوب يرى ويضيف مدينيه فقط (migration 20260617000003).

---

### `failed_deposits`
| الحقل | النوع | المصدر |
|-------|-------|--------|
| `id` | UUID PK | أصلي |
| `agent_id` | UUID FK → users | أصلي |
| `company_id` | UUID FK → companies | أصلي |
| `amount` | NUMERIC | أصلي |
| `date` | DATE | أصلي |
| `reason` | TEXT | أصلي |
| `status` | TEXT — `pending` \| `claimed` \| `refunded` \| `rejected` | أصلي (config.js:215-220) |
| `version` | INTEGER NOT NULL DEFAULT 1 | migration 20260612000000 |

---

### `notifications`
| الحقل | النوع | المصدر |
|-------|-------|--------|
| `id` | UUID PK | أصلي |
| `title` | TEXT | أصلي |
| `body` | TEXT | أصلي |
| `type` | TEXT — `info` \| `warning` \| `success` \| `error` | أصلي (config.js:233-238) |
| `target` | TEXT أو JSONB — `all` أو مصفوفة user IDs | أصلي |
| `read_by` | JSONB أو UUID[] | أصلي |
| `hidden_by` | JSONB أو UUID[] | أصلي |
| `created_by` | UUID FK → users | أصلي |
| `created_at` | TIMESTAMPTZ | أصلي |

**Realtime:** اشتراك Supabase postgres_changes على هذا الجدول — القناة: `notifications-realtime-<userId>` (App.js:1159).

---

### `audit_logs`
| الحقل | النوع | المصدر |
|-------|-------|--------|
| `id` | UUID PK | أصلي |
| `table_name` | TEXT | أصلي |
| `record_id` | UUID | أصلي |
| `operation` | TEXT — `UPDATE` \| `DELETE` | أصلي |
| `old_value` | JSONB — مُضاف في migration 20260612000000 | migration |
| `new_value` | JSONB — مُضاف في migration 20260612000000 | migration |
| `changed_fields` | JSONB — `{"حقل": {"old": v1, "new": v2}}` — مُضاف في migration 20260612000000 | migration |
| `changed_by` | UUID FK → users | أصلي |
| `changed_at` / `timestamp` | TIMESTAMPTZ | أصلي |

**آلية التشغيل:** Trigger `trg_write_audit_log()` على UPDATE/DELETE. يسجّل الحقول المتغيرة فقط في `changed_fields` (توفير ~97% من الحجم). يتجاهل: `version, updated_at, created_at, sync_status, last_login`.

---

### `account_ledger`
| الحقل | النوع | المصدر |
|-------|-------|--------|
| `id` | UUID PK | أصلي |
| `voucher_number` | TEXT NOT NULL | أصلي |
| `date` | DATE NOT NULL | أصلي |
| `account_id` | TEXT NOT NULL — مثل `AGT_<uuid>`, `COMP_<uuid>`, `EXP_GENERAL` | أصلي |
| `debit` | NUMERIC DEFAULT 0 | أصلي |
| `credit` | NUMERIC DEFAULT 0 | أصلي |
| `description` | TEXT | أصلي |
| `transaction_id` | UUID FK → transactions | أصلي |
| `idempotency_key` | UUID — UNIQUE partial — مُضاف في migration 20260619000004 | migration |

**فهارس محسَّنة:** مُضافة في migration 20260617000001.

---

### `account_balances`
| الحقل | النوع | ملاحظة |
|-------|-------|--------|
| `account_id` | TEXT **PK** — ليس `id` | يتطلب معالجة خاصة في Repository.js |
| `balance` | NUMERIC | |
| `last_updated` | TIMESTAMPTZ | |

---

### `daily_closings`
| الحقل | النوع |
|-------|-------|
| `id` | UUID PK |
| `date` | DATE UNIQUE |
| `closed_at` | TIMESTAMPTZ |
| `closed_by_id` | UUID FK → users |

---

### `system_settings`
| الحقل | النوع | ملاحظة |
|-------|-------|--------|
| `key` | TEXT **PK** — ليس `id` | يتطلب معالجة خاصة في Repository.js |
| `value` | JSONB | |
| `updated_at` | TIMESTAMPTZ | |

---

### `expense_accounts`
| الحقل | النوع |
|-------|-------|
| `id` | UUID PK |
| `code` | TEXT |
| `name` | TEXT |

---

## 2.2 الجداول المُضافة في الـ Migrations

### `offline_sessions` (migration 20260612000000)
| الحقل | النوع |
|-------|-------|
| `id` | UUID PK |
| `user_id` | UUID FK → users ON DELETE CASCADE |
| `device_id` | TEXT NOT NULL |
| `pin_hash` | TEXT — هاش مُشفَّر، لا يُخزَّن في النص الواضح |
| `webauthn_credential_id` | TEXT |
| `expires_at` | TIMESTAMPTZ NOT NULL DEFAULT now()+90d |
| `is_active` | BOOLEAN DEFAULT true |
| `created_at` | TIMESTAMPTZ |
| `updated_at` | TIMESTAMPTZ |

**قيد فريد:** `(user_id, device_id)` — جلسة واحدة نشطة لكل مستخدم لكل جهاز.

---

### `quick_login_tokens` (migration 20260612000001)
| الحقل | النوع |
|-------|-------|
| `id` | UUID PK |
| `user_id` | UUID FK → users |
| `token_hash` | TEXT — SHA-256 |
| `equation` | TEXT |
| `device_id` | TEXT |
| `expires_at` | TIMESTAMPTZ — 30 يومًا (AuthService.js:859) |
| `is_active` | BOOLEAN DEFAULT true |
| `created_at` | TIMESTAMPTZ |

---

### `quick_login_temp_passwords` (migration 20260612000002)
جدول مؤقت لإدارة كلمات مرور مؤقتة أثناء عملية الدخول السريع. مرتبط بـ JWT session.

---

### `user_devices` (migration 20260615000002)
| الحقل | النوع |
|-------|-------|
| `device_id` | TEXT **PK** |
| `user_id` | UUID FK → users ON DELETE CASCADE |
| `label` | TEXT |
| `user_agent` | TEXT |
| `created_at` | TIMESTAMPTZ DEFAULT now() |
| `last_seen_at` | TIMESTAMPTZ DEFAULT now() |
| `revoked_at` | TIMESTAMPTZ — NULL = نشط، تاريخ = مُلغَى |

**RLS:** المستخدم يدير أجهزته؛ المدير يرى الكل.

---

### `user_beneficiaries` (Dexie.js v3 + config.js)
| الحقل | النوع |
|-------|-------|
| `id` | UUID |
| `user_id` | UUID |
| `beneficiary_id` | UUID |
| `beneficiary_type` | TEXT |

**ملاحظة:** موجود في Dexie (IndexedDB محلي) وفي `TABLES` في config.js. يُستخدم لتخزين التحديدات السريعة الأخيرة (شركات/بنوك/مستخدمين).

---

### `system_commands` (مُشار إليه في config.js + App.js)
| الحقل | النوع |
|-------|-------|
| `id` | UUID |
| `command` | TEXT — `RESET_ALL_DATA` |
| `issued_at` | TIMESTAMPTZ |
| `executed_at` | TIMESTAMPTZ — NULL = لم يُنفَّذ بعد |

**السلوك:** App.js يستطلعه كل 30 ثانية. عند وجود `RESET_ALL_DATA` بـ `executed_at = null` → يمسح Dexie وlocalStorage ويُعيد تحميل الصفحة ثم يُحدِّث `executed_at`.

---

### `transfer_requests` (مُشار إليه في config.js)
جدول طلبات التحويل بين المندوبين — لا migrations صريحة له في المستودع الحالي.

---

## 2.3 مخطط قاعدة البيانات المحلية (Dexie / IndexedDB)

```
db.version(DEXIE_CONFIG.DB_VERSION).stores({
  transactions      : 'id, date, type, agent_id, sync_status, [date+agent_id], [date+type], bank_account_id, created_at',
  users             : 'id, username, role, is_active, sync_status',
  bank_accounts     : 'id, company_id, name, sync_status',
  companies         : 'id, account_prefix, sync_status',
  expense_accounts  : 'id, code, sync_status',
  debtors           : 'id, name, sync_status',
  failed_deposits   : 'id, agent_id, status, date, sync_status',
  notifications     : 'id, created_at, type, sync_status',
  audit_logs        : 'id, timestamp, ...',
  account_ledger    : 'id, account_id, date, transaction_id, ...',
  account_balances  : 'account_id, ...',
  daily_closings    : 'id, date',
  sync_queue        : 'id, ...',
  sync_conflicts    : 'id, ...',
  cache_meta        : 'key, ...',
  user_beneficiaries: 'id, user_id, beneficiary_id, beneficiary_type, [user_id+beneficiary_type]',  // v3
})
```

---

## 2.4 بادئات معرّفات الحسابات المحاسبية

من `config.js:244-252`:

| البادئة | المعنى |
|---------|--------|
| `AGT_` | حساب مندوب |
| `COMP_` | حساب شركة |
| `BNK_` | وسم حساب بنكي — **لا يدخل دفتر الأستاذ أبدًا** |
| `CUST_` | حساب عميل |
| `EXP_` | حساب مصروفات |
| `REV_` | حساب إيرادات |
| `SUSP_` | حساب تعليق مؤقت |

**حسابات ثابتة خاصة:**
- `DEBTOR_SETTLEMENT` — تسويات جميع العملاء المدينين (حساب موحَّد)
- `EXP_GENERAL` — جميع المصروفات (حساب موحَّد)
- `GENERAL_FUND` — يُستخدم فقط في `refund_settlement` حين لا توجد شركة مرتبطة

---

## 2.5 أنواع العمليات

من `config.js:109-120` (TRANSACTION_TYPES + TRANSACTION_TYPE_LABELS):

| القيمة | التسمية العربية |
|--------|----------------|
| `collection` | تحصيل |
| `deposit` | إيداع بنكي |
| `bank_withdrawal` | سحب بنكي |
| `expense` | مصروف |
| `receipt` | تحويل |
| `delivery` | تسليم مباشر |
| `refund_settlement` | تسوية استرداد |
| `failed_deposit_refund` | استرداد إيداع فاشل |
| `journal_entry` | قيد محاسبي |
| `external_handover` | تسليم عهدة |

---

## 2.6 القيم الثابتة الأخرى

**حالات الموافقة** (`config.js:255-258`): `approved` | `pending` | `rejected`

**حالات الإيداع الفاشل** (`config.js:215-220`): `pending` (معلق) | `claimed` (مطالب به) | `refunded` (مسترد) | `rejected` (مرفوض)

**حالات المزامنة** (`config.js:197-201`): `synced` | `pending` | `conflict`

**أنواع إجراءات طابور المزامنة** (`config.js:204-209`): `create` | `update` | `delete` | `batch`

**أنواع الإشعارات** (`config.js:233-238`): `info` | `warning` | `success` | `error`

---

# الجزء الثالث: منطق الأعمال وقواعده

## 3.1 محرك القيد المزدوج

كل عملية تُولِّد قيدين متوازنين (مدين = دائن) في `account_ledger`. منطق البناء في `AccountingService.js`.

### مصفوفة القيود الكاملة

| نوع العملية | الحساب المدين | الحساب الدائن | قيود وملاحظات |
|-------------|--------------|--------------|---------------|
| `collection` + `company_id` | `AGT_<agent_id>` | `COMP_<company_id>` | يجب وجود `company_id` |
| `collection` + `customer_id` | `AGT_<agent_id>` | `DEBTOR_SETTLEMENT` | حساب موحَّد — لا حساب فردي للمدين |
| `collection` بلا جهة | — | — | **خطأ صريح** — مرفوض |
| `deposit` | `COMP_<company_id>` | `AGT_<agent_id>` | `company_id` مشتَق من `bank_accounts.company_id`؛ بلا شركة → **خطأ صريح** |
| `bank_withdrawal` | `AGT_<agent_id>` | `COMP_<company_id>` | نفس الاشتقاق |
| `expense` | `EXP_GENERAL` | `AGT_<agent_id>` | نوع المصروف في الوصف فقط — لا تجزئة |
| `receipt` (معتمد) | `AGT_<to/receiver>` | `AGT_<from/sender>` | |
| `receipt` (معلّق) | `SUSP_<tx_id>` | `AGT_<from_agent_id>` | مؤقت ريثما تتم الموافقة |
| `delivery` | `AGT_<to_agent_id>` | `AGT_<from_agent_id>` | مباشر بلا موافقة |
| `refund_settlement` + `company_id` | `AGT_<agent_id>` | `COMP_<company_id>` | |
| `refund_settlement` بلا شركة | `AGT_<agent_id>` | `GENERAL_FUND` | الحالة الوحيدة التي يُستخدم فيها `GENERAL_FUND` |
| `failed_deposit_refund` | `AGT_<agent_id>` | `COMP_<company_id>` | استرداد مبلغ إيداع فاشل من الشركة للمندوب |
| `journal_entry` | `AGT_<agent_id>` | `COMP_<company_id>` | قيد تسوية يدوي — يتطلب شركة |
| `external_handover` + `debtor_settlement` | `DEBTOR_SETTLEMENT` | `AGT_<agent_id>` | الوجهة الافتراضية — تسوية ديون |
| `external_handover` + `general_fund` | `GENERAL_FUND` | `AGT_<agent_id>` | وجهة الصندوق العام — مُحدَّدة في `expense_type` |

**قاعدة ملزمة:** `BNK_*` لا يظهر في أي قيد أبدًا. الحساب البنكي وسم في `transactions.bank_account_id` فقط.

---

## 3.2 رقم القيد (Voucher Number)

- Online: يُولَّد من RPC `get_next_voucher_number`
- Offline: `V{YYYYMMDD}-LOCAL-{timestamp}` (AccountingService.js:_generateVoucherNumber)

---

## 3.3 عكس العمليات (Reversal)

العكس يُنشئ **عملية جديدة** في `transactions` برابط `reverses_id = original_tx_id` — لا UPDATE على العملية الأصلية. يُبنى قيد معاكس (مدين ↔ دائن مقلوبان). العمود `reverses_id` مُضاف في migration 20260615000002.

---

## 3.4 دورة حياة العملية

```
إنشاء عملية جديدة
    ↓
IF type = 'receipt' AND يحتاج موافقة:
    approval_status = 'pending'
    قيد: SUSP_<tx_id> ← AGT_<sender>
ELSE:
    approval_status = 'approved'
    قيد طبيعي حسب النوع
    ↓
IF موافقة على receipt المعلّق:
    قيد تحويل: AGT_<receiver> ← SUSP_<tx_id>
IF رفض:
    قيد عكسي على SUSP
IF عكس (reversal):
    عملية جديدة بـ reverses_id
    قيود معاكسة
```

---

## 3.5 صلاحيات التبويبات

### المدير `admin` — ثابت، لا يُخصَّص:
من `ADMIN_TABS` في config.js:178-191:
1. `dashboard` — لوحة المعلومات
2. `data-entry` — إدخال البيانات
3. `daily-summary` — الملخص اليومي
4. `bank-accounts` — الحسابات البنكية
5. `debtors` — العملاء المديونين
6. `failed-deposits` — الإيداعات الفاشلة
7. `notifications` — الإشعارات
8. `all-operations` — جميع العمليات
9. `audit-log` — سجل التدقيق
10. `users` — إدارة المستخدمين
11. `account-management` — إدارة الحسابات
12. `settings` — الإعدادات

### المساعد الإداري `admin_assistant` — قابل للتخصيص:
يُقرأ من `users.allowed_tabs` (مصفوفة). إذا كانت فارغة أو null → يحصل على `AGENT_TABS` افتراضيًا (AuthService.js:1840-1844). يمكن للمدير تخصيص أي تبويبات من القائمة الكاملة.

### المندوب `agent` — ثابت، لا يُخصَّص:
من `AGENT_TABS` في config.js:167-175:
1. `data-entry`
2. `daily-summary`
3. `bank-accounts`
4. `debtors`
5. `failed-deposits`
6. `notifications`
7. `settings`

### وضع Offline — بغض النظر عن الدور:
3 تبويبات فقط (AuthService.js:1820-1826):
1. `data-entry`
2. `failed-deposits`
3. `notifications`

---

## 3.6 صلاحيات البيانات للمندوب

من `users` جدول — حقول الصلاحيات (migration 20260612000008):

| الحقل | المعنى | قاعدة القراءة |
|-------|--------|--------------|
| `allowed_companies` | TEXT[] | مصفوفة فارغة `{}` = كل الشركات مسموحة |
| `allowed_banks` | TEXT[] | مصفوفة فارغة `{}` = كل البنوك مسموحة |
| `allowed_users` | TEXT[] | مصفوفة فارغة `{}` = كل المستخدمين مسموحون |

المدير والمساعد الإداري: `null` → كل الشركات/البنوك/المستخدمين مسموحون (AuthService.js:1803-1815).

---

## 3.7 صلاحيات RLS الفعلية (من migrations)

**transactions** (migration 20260619000001):
- المدير/المساعد: SELECT/INSERT/UPDATE/DELETE كامل
- المندوب SELECT: عملياته الخاصة `agent_id = auth.uid()`
- المندوب SELECT إيداع/سحب: عمليات اليوم الحالي فقط `date = CURRENT_DATE AND type IN ('deposit','bank_withdrawal')`
- المندوب INSERT: `agent_id = auth.uid()`
- المندوب UPDATE: `sync_status, synced_at` فقط
- المندوب DELETE: ❌ ممنوع تمامًا

**account_ledger** (migration 20260619000001):
- المندوب SELECT: `account_id = 'AGT_' || auth.uid()::text` فقط

**account_balances** (migration 20260619000001):
- المندوب SELECT: `account_id = 'AGT_' || auth.uid()::text` فقط

**debtors:**
- المدير فقط: CRUD كامل (migration 20260617000002)
- المندوب: INSERT فقط للمدينين المُعيَّنين له (migration 20260617000003)

**audit_log:** Admin فقط (لا RLS صريح في المستودع — يُستنتج من UI)

---

## 3.8 إعدادات الأداء والمزامنة (config.js)

```javascript
SYNC_CONFIG = {
  MAX_RETRIES      : 5,
  CHUNK_SIZE       : 20,        // عمليات لكل دفعة
  CHUNK_DELAY_MS   : 50,        // ms بين الدفعات
  BASE_BACKOFF_MS  : 1_000,
  MAX_BACKOFF_MS   : 60_000,
  JITTER_PERCENT   : 0.2,       // ±20%
  MAX_QUEUE_SIZE   : 5_000,
  STALE_QUEUE_DAYS : 30,
}

CACHE_CONFIG = {
  TTL_MINUTES     : 5,
  MAX_TRANSACTIONS: 10_000,
  STALE_DAYS      : 90,
  MAX_STORAGE_MB  : 50,
}

PAGINATION_CONFIG = {
  DEFAULT_PAGE_SIZE : 20,
  PAGE_SIZE_OPTIONS : [20, 50, 100],
}

AMOUNT_CONFIG = { MIN: 0.01, MAX: 10_000_000 }

SECURITY_CONFIG = {
  MAX_LOGIN_ATTEMPTS : 5,
  LOCKOUT_MINUTES    : 15,      // المرجع العام — المنطق الفعلي أدق (انظر 3.9)
}
```

---

## 3.9 حدود المزامنة في الاستعلامات (config.js:298-317)

| المجموعة | الحد |
|---------|------|
| `BANK_ACCOUNTS` | 200 |
| `COMPANIES` | 200 |
| `EXPENSE_ACCOUNTS` | 200 |
| `DEBTORS` | 500 |
| `SYSTEM_SETTINGS` | 100 |
| `USERS` | 200 |
| `TRANSACTIONS_SYNC` | 200 |
| `NOTIFICATIONS_SYNC` | 50 |
| `LEDGER_ENTRIES` | 1,000 |
| `REVERSAL_ENTRIES` | 20 |
| `CONFLICTS` | 100 |

---

## 3.10 منطق قفل الحسابات

### تسجيل الدخول بالبريد وكلمة المرور (AuthService.js:124-126)
| عدد المحاولات الفاشلة | مدة القفل |
|----------------------|----------|
| ≥ 5 | 5 دقائق |
| ≥ 10 | 15 دقيقة |
| ≥ 20 | 60 دقيقة |

التخزين: localStorage (يبقى عبر الجلسات).

### الدخول السريع (AuthService.js:112-113)
| عدد المحاولات الفاشلة | مدة القفل |
|----------------------|----------|
| ≥ 5 | 10 دقائق |
| ≥ 10 | 60 دقيقة |

التخزين: localStorage، مُتتَبَّع بـ `ahu_quick_attempts_<userId>`.

### PIN الـ Offline (OfflineAuthService.js)
| عدد المحاولات الفاشلة | مدة القفل |
|----------------------|----------|
| ≥ 3 | 5 دقائق |
| ≥ 5 | 15 دقيقة |
| ≥ 10 | **قفل دائم** (~100 سنة) |

التخزين: sessionStorage + localStorage (مزدوج).

---

## 3.11 مهل الخمول التلقائي (IdleTimer.js)

| الدور | المهلة | المصدر |
|-------|--------|--------|
| `agent` | **30 دقيقة** (`AGENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000` ms) | IdleTimer.js:12 |
| `admin` أو `admin_assistant` | **90 دقيقة** (`ADMIN_IDLE_TIMEOUT_MS = 90 * 60 * 1000` ms) | IdleTimer.js:15 |

**لا يوجد تحذير مسبق** — عند انتهاء المهلة يتم تسجيل الخروج مباشرةً ويظهر إشعار toast يُعلم المستخدم.

أحداث النشاط التي تُعيد المهلة: `mousemove, keydown, click, scroll, touchstart, touchmove`

---

## 3.12 صلاحية الجلسة

- جلسة Supabase JWT: **8 ساعات** (AuthService.js:1111: `now + 8*60*60*1000`)
- Offline session (PIN): تنتهي بعد **90 يومًا** (migration 20260612000000: `DEFAULT now()+90d`)
- Quick Login token: تنتهي بعد **30 يومًا** (AuthService.js:859)
- إعادة مصادقة Offline بعد: **30 دقيقة** من آخر تحقق (`_OFFLINE_REAUTH_MS = 30 * 60 * 1000`)

---

## 3.13 معادلة هاش الدخول السريع

```
normalize(equation) → إزالة المسافات: "12 + 88" → "12+88"
token = SHA-256( userId + ":" + normalize(equation) + ":" + "ahu_secure_salt_v1_2024" )
```

الـ salt ثابت في الكود. يُدوَّر الرمز (token rotation) عند كل دخول ناجح.

---

## 3.14 أوامر النظام المركزية

- يستطلع App.js جدول `system_commands` كل **30 ثانية** (App.js:1143)
- أيضًا عند حدث `online` فورًا
- الأمر الوحيد المُنفَّذ حاليًا: `RESET_ALL_DATA`
  - يمسح Dexie
  - يمسح مفاتيح localStorage المحددة (`ahu_stmt_filter_pref`, `ahu_quick_banner_dismissed`, `favBanks_*`)
  - يُحدِّث `executed_at` لمنع إعادة التنفيذ
  - يُعيد تحميل الصفحة بعد 2.5 ثانية

---

# الجزء الرابع: تدفقات المستخدم وسيناريوهات التشغيل

## السيناريو 1: تسجيل الدخول بالبريد وكلمة المرور

**الشرط المسبق:** الجهاز متصل بالإنترنت.

**الخطوات:**
1. يُدخل البريد الإلكتروني وكلمة المرور
2. التحقق من قفل الحساب (localStorage)
3. إرسال لـ Supabase Auth
4. عند النجاح: جلب بيانات المستخدم من `users` بما فيها `allowed_tabs, allowed_companies, allowed_banks, allowed_users, quick_login_enabled`
5. تسجيل الجهاز في `user_devices` عبر RPC `register_device`
6. تحديث `last_login` في الخلفية
7. إذا `quick_login_enabled = false`: يظهر banner لتفعيل الدخول السريع (QuickLoginBanner.js)
8. تحديد مهلة الخمول حسب الدور

**شرط لاحق:** مستخدم مسجَّل دخوله، JWT صالح 8 ساعات.

**الفشل:**
- ≥5 محاولات: قفل 5 دقائق
- ≥10: قفل 15 دقيقة
- ≥20: قفل 60 دقيقة

---

## السيناريو 2: تسجيل الدخول السريع (Quick Login)

**الشرط المسبق:** `quick_login_enabled = true`، رمز نشط في `quick_login_tokens`.

**الخطوات:**
1. يُدخل اسم المستخدم (أو يُختار)
2. يُدخل المعادلة الرياضية
3. النظام يحسب: `SHA-256(userId:normalize(equation):salt)`
4. يُرسَل الهاش لـ RPC `verify_quick_login`
5. الـ RPC يتحقق من الهاش ويُدوِّر الرمز ويُصدر JWT
6. جلب بيانات المستخدم كاملة

**الفشل:**
- ≥5 محاولات: قفل 10 دقائق
- ≥10: قفل 60 دقيقة

---

## السيناريو 3: الدخول بدون اتصال (PIN)

**الشرط المسبق:** `offline_sessions` نشطة، SessionVault يحتوي بيانات مشفَّرة.

**الخطوات:**
1. الجهاز يكتشف غياب الاتصال (`navigator.onLine = false` أو فشل fetch)
2. يُعرَض حقل PIN (4-6 أرقام) أو WebAuthn passkey
3. PIN يُشفَّر ويُقارَن بـ SessionVault (PBKDF2 + AES-GCM)
4. `AuthState.isOffline = true`
5. المتاح: 3 تبويبات فقط (`data-entry`, `failed-deposits`, `notifications`)

**الفشل:**
- ≥3: قفل 5 دقائق
- ≥5: قفل 15 دقيقة
- ≥10: قفل دائم

---

## السيناريو 4: إدخال عملية مالية

**الممثل:** أي مستخدم مسجَّل دخوله لديه `data-entry`

**الخطوات:**
1. اختيار النوع من 10 أنواع
2. إدخال البيانات المطلوبة (تتغير حسب النوع)
3. التحقق المحلي من الصحة (المبلغ 0.01-10,000,000)
4. `Ctrl+S` أو زر الحفظ
5. IF online: إرسال لـ RPC `create_transaction_with_entries` (ذري)
6. IF offline: حفظ في Dexie مع `sync_status='pending'`, `idempotency_key=UUID جديد`

**شرط لاحق online:** قيود محاسبية مُولَّدة، `account_balances` مُحدَّث.

**أخطاء خادم:**
- `42501`: ليس لديك صلاحية
- `23502`: حقل مطلوب مفقود
- `23503`: الحساب البنكي غير مرتبط بشركة
- `P0001`: رسالة الخادم مباشرةً

---

## السيناريو 5: المزامنة عند استعادة الاتصال

**المُشغِّل:** حدث `app:onlineStatusChange` أو `online`

**الخطوات:**
1. عرض نافذة "تم استعادة الاتصال"
2. IF انتهت جلسة JWT: إعادة مصادقة
3. `OutboxService.processOutbox()` يعالج الانتظار FIFO:
   - دفعات 20 عملية، تأخير 50ms بين الدفعات
   - IF خطأ `23505` (idempotency_key موجود): تخطّ (مكرر)
   - IF تعارض version: علامة `conflict`
   - IF خطأ مؤقت: retry حتى 5 مرات (backoff تربيعي + jitter ±20%)
   - IF خطأ دائم (`23502`,`23514`,`42703`,`42501`,`P0001`,`22P02`,`23503`,`22003`): لا إعادة محاولة
4. تحديث `account_balances` من الخادم
5. `AppStore.refreshData()`

---

## السيناريو 6: إغلاق اليومية

**الممثل:** admin فقط (تبويب `daily-summary`)

**الشرط المسبق:** لا توجد عمليات `approval_status='pending'` في اليوم المطلوب.

**الخطوات:**
1. اختيار التاريخ في `DailySummaryComponent`
2. مراجعة الملخص
3. النقر على "إغلاق اليومية"
4. RPC `perform_daily_close(p_date)` يُنفَّذ ذريًا
5. يُنشأ سجل في `daily_closings` (UNIQUE على `date`)
6. إشعار للمستخدمين

---

## السيناريو 7: الموافقة على عملية استلام

**الممثل:** admin أو admin_assistant (إذا كان لديه `all-operations`)

**الخطوات:**
1. في `AllOperationsComponent` → فلتر `approval_status='pending'`
2. اختيار العملية
3. "موافقة" → RPC `approve_transaction`
   - قيد: `AGT_<receiver>` مدين ← `SUSP_<tx_id>` دائن
4. أو "رفض" → RPC `reject_transaction` مع السبب
   - قيد عكسي على `SUSP`

---

## السيناريو 8: إدارة المدينين

**الممثل:** admin (CRUD كامل)؛ agent (يرى ويضيف مدينيه فقط)

**تحصيل من مدين:**
1. `data-entry` → نوع `collection`
2. اختيار مدين من القائمة (بدلًا من شركة)
3. قيد: `AGT_<agent>` مدين ← `DEBTOR_SETTLEMENT` دائن
4. `amount_owed` للمدين يُخفَّض بالمبلغ المحصَّل

---

## السيناريو 9: صلاحيات الحسابات البنكية للمندوب

- المندوب يرى فقط البنوك الواردة في `allowed_banks` (إذا غير فارغة)
- يرى إيداعات/سحوبات اليوم الحالي فقط (RLS: `date = CURRENT_DATE AND type IN ('deposit','bank_withdrawal')`)

---

# الجزء الخامس: واجهة المستخدم وسلوكها

## 5.1 شاشة الدخول (`LoginComponent.js`)

**التبويبات:**
- الدخول بالبريد وكلمة المرور
- الدخول السريع (يظهر إذا `quick_login_enabled = true`)
- الدخول بدون اتصال (PIN / WebAuthn)

**السلوك:**
- اكتشاف تلقائي لحالة الاتصال عند الفتح
- عرض banner تفعيل الدخول السريع بعد أول دخول ناجح

---

## 5.2 الهيكل العام للتطبيق (App.js)

```
<header>
  شعار النظام (من system_settings)
  اسم المستخدم + دوره
  مؤشر الاتصال (أخضر/أحمر)
  عداد الإشعارات
  زر تغيير المظهر (ThemeManager)
  زر تسجيل الخروج
</header>

<nav> تبويبات حسب الدور </nav>

<main> محتوى التبويب النشط </main>

<div> شريط Offline (يظهر عند انقطاع الاتصال) </div>
```

---

## 5.3 تبويب لوحة المعلومات (`DashboardComponent.js`)

متاح: admin فقط.

**المحتوى:**
- بطاقات KPI (مجموع التحصيل، الإيداع، المصروفات، ...)
- بيانات من RPC `get_admin_dashboard`
- رسوم بيانية (Chart.js)
- ملخصات أداء المندوبين

---

## 5.4 تبويب إدخال البيانات (`DataEntryComponent.js`)

**الحقول حسب نوع العملية:**

| النوع | الحقول |
|-------|--------|
| `collection` | المبلغ، التاريخ، الشركة أو المدين، اسم العميل، ملاحظات |
| `deposit` | المبلغ، التاريخ، الحساب البنكي، ملاحظات |
| `bank_withdrawal` | المبلغ، التاريخ، الحساب البنكي، ملاحظات |
| `expense` | المبلغ، التاريخ، نوع المصروف، ملاحظات |
| `receipt` | المبلغ، التاريخ، المندوب المُرسِل، ملاحظات |
| `delivery` | المبلغ، التاريخ، المندوب المُستلِم، ملاحظات |
| `refund_settlement` | المبلغ، التاريخ، الشركة (اختياري)، ملاحظات |
| `failed_deposit_refund` | المبلغ، التاريخ، الشركة، ملاحظات |
| `journal_entry` | المبلغ، التاريخ، الشركة، ملاحظات |
| `external_handover` | المبلغ، التاريخ، الوجهة (debtor_settlement/general_fund)، الجهة المستلمة، ملاحظات |

**حد المبلغ:** 0.01 – 10,000,000 SAR  
**اختصار:** `Ctrl+S` = حفظ

---

## 5.5 تبويب الملخص اليومي (`DailySummaryComponent.js`)

- منتقي تاريخ
- بطاقات KPI لليوم
- جدول تفصيل لكل مندوب
- أزرار تصدير (Excel عبر SheetJS، PDF عبر html2pdf)
- زر "إغلاق اليومية" — admin فقط، ويظهر فقط إذا لا توجد عمليات معلّقة

---

## 5.6 تبويب الحسابات البنكية (`BankAccountsComponent.js`)

**للمندوب:**
- يرى البنوك من `allowed_banks` فقط (إذا غير فارغة)
- يرى إيداعات/سحوبات اليوم الحالي فقط (RLS)
- إجمالي الإيداع اليومي
- مؤشر نسبة السقف اليومي

**للمدير/المساعد:**
- كل الحسابات
- إضافة/تعديل حساب (يجب ربطه بشركة)

---

## 5.7 تبويب الإيداعات الفاشلة (`FailedDepositsComponent.js`)

- جدول بالإيداعات وحالاتها: `pending` | `claimed` | `refunded` | `rejected`
- إمكانية تغيير الحالة حسب الصلاحية

---

## 5.8 تبويب جميع العمليات (`AllOperationsComponent.js`)

متاح: admin و admin_assistant (إذا في allowed_tabs).

- فلاتر: التاريخ، المندوب، النوع، حالة الموافقة، بحث نصي
- ترقيم: 20/50/100 لكل صفحة
- إجراءات: موافقة / رفض / عكس / تفاصيل (حسب الصلاحية)

---

## 5.9 تبويب سجل التدقيق (`AuditLogComponent.js`)

متاح: admin فقط.

- يعرض `changed_fields` من `audit_logs`
- فلتر بالتاريخ، المستخدم، نوع السجل
- يحذف حقول النظام (`version, updated_at, ...`) من العرض

---

## 5.10 تبويب إدارة المستخدمين (`UsersComponent.js`)

متاح: admin فقط.

- جدول المستخدمين: الاسم، الدور، الحالة، رقم الحساب
- إنشاء مستخدم جديد: بريد + كلمة مرور + اسم + دور
- تعيين التبويبات المسموحة للمساعد الإداري (`allowed_tabs`)
- تعيين الشركات/البنوك/المستخدمين المسموحين للمندوب
- تعطيل/تفعيل الحساب (soft toggle على `is_active`)

---

## 5.11 تبويب إدارة الحسابات (`AccountManagementComponent.js`)

متاح: admin فقط.

- هيكل الحسابات الهرمي من RPC `get_chart_of_accounts`
- كشف الحساب من RPC `get_account_statement` مع أرصدة افتتاحية/ختامية
- طباعة

---

## 5.12 تبويب الإعدادات (`SettingsComponent.js` + `ProfileSettingsComponent.js`)

- إعدادات النظام: شعار، اسم الشركة، ... (admin)
- إعدادات الملف الشخصي: تفعيل الدخول السريع، إعداد PIN، تغيير كلمة المرور
- تغيير المظهر (ThemeManager)

---

## 5.13 حالات الواجهة الخاصة

**شريط Offline:** يظهر أعلى الصفحة عند `AuthState.isOffline = true` أو `navigator.onLine = false`

**حالة التحميل:** هيكل عظمي (skeleton) مكان البيانات + مؤشر دوار في الأزرار

**حالة فارغة:** رسالة توضيحية + أيقونة

**Toast:** رسائل النجاح/الخطأ تظهر أعلى الشاشة مؤقتًا

**مربعات الحوار:** `PasswordDialog.js` لإدخال كلمة المرور، `PinDialog.js` لإدخال PIN

---

## 5.14 اختصارات لوحة المفاتيح (من App.js)

| الاختصار | الوظيفة |
|----------|---------|
| `Ctrl/Cmd + S` | حفظ العملية الحالية |
| `Ctrl/Cmd + F` | التركيز على البحث |
| `Ctrl/Cmd + O` | مزامنة فورية |
| `Ctrl/Cmd + L` | تسجيل الخروج |
| `Escape` | إغلاق النافذة المنبثقة |
| `F5` | تحديث البيانات |
| `?` | عرض قائمة الاختصارات |

---

# الجزء السادس: المتطلبات غير الوظيفية

## 6.1 الأداء (من config.js)

| القياس | القيمة |
|--------|--------|
| TTL كاش Supabase | 5 دقائق |
| حجم IndexedDB | أقصاه 50MB |
| أقصى معاملات في Dexie | 10,000 |
| حذف تلقائي للمعاملات القديمة | 90 يوم |
| حذف تلقائي للعمليات المعلّقة | 30 يوم |

## 6.2 الأمان (من الكود المصدري)

| الجانب | التنفيذ |
|--------|---------|
| JWT | Supabase Auth — 8 ساعات |
| PIN محلي | PBKDF2 + AES-GCM (SessionVault.js) |
| هاش الدخول السريع | SHA-256 |
| `eval()` | ممنوع تمامًا |
| XSS | كل إدراج DOM عبر `textContent` أو `escapeHtml()` |
| CSP | مُطبَّق في `<head>` |
| سجل التدقيق | كل UPDATE/DELETE على الجداول الحرجة |
| Supabase Keys | في `config.js` — يجب تأمينه في الإنتاج |

## 6.3 التوافق

التطبيق SPA (Single Page Application) بـ Vanilla JavaScript. لا bundler — المكتبات من CDN:

| المكتبة | الإصدار | المصدر |
|---------|---------|--------|
| Supabase JS | 2.x | CDN |
| Dexie.js | 3.2.4 | CDN |
| Chart.js | 4.4.0 | CDN |
| Lucide Icons | 0.263.0 | CDN |
| Tailwind CSS | — | CDN |
| expr-eval | 2.0.2 | CDN |
| SheetJS (xlsx) | 0.18.5 | CDN |
| html2pdf.js | 0.10.1 | CDN |

**المتطلبات الوظيفية:**
- IndexedDB مدعومة (offline)
- Web Crypto API (تشفير)

---

# الجزء السابع: تحليل الديون التقنية

## 7.1 معمارية

| المشكلة | التأثير |
|---------|---------|
| `App.js` 3000+ سطر يجمع التوجيه والحالة ومنطق الأعمال | صعوبة الصيانة وتعارضات merge |
| 15 Component كل منها يبني DOM يدويًا بلا template موحَّد | تكرار كود وعدم اتساق |
| المكتبات كلها من CDN | يفشل الجهاز في بيئات مغلقة الشبكة؛ لا تحكم في الإصدارات |
| لا bundler ولا build step | لا tree-shaking، لا minification |

## 7.2 كود

| المشكلة | التأثير |
|---------|---------|
| `config.js` يحتوي على Supabase keys كـ plain text مرفوعة في المستودع | خطر أمني إذا أصبح المستودع عامًا |
| اختبارات تغطي خدمات فقط — لا اختبارات UI أو E2E | أخطاء انحدار غير مكتشفة |
| لا CI/CD — نشر يدوي | خطر نشر نسخة خاطئة |
| لا error monitoring في الإنتاج | أخطاء صامتة |

## 7.3 بيانات

| المشكلة | التأثير |
|---------|---------|
| `account_balances.account_id` و `system_settings.key` كـ PK (ليس `id`) | يستلزم معالجة استثنائية في Repository.js |
| `debtors.assigned_agents` مصفوفة في عمود واحد (لا جدول وسيط) | لا FK constraints، استعلامات معقدة |
| `notifications.target` تخزين مرن (TEXT أو JSONB) | غموض في التعامل مع القيم |

## 7.4 عمليات

| المشكلة | التأثير |
|---------|---------|
| لا CI/CD | لا اختبارات تلقائية قبل النشر |
| لا مراقبة أخطاء (Sentry أو ما شابه) | صعوبة تتبع المشاكل في الإنتاج |

---

# الجزء الثامن: توصيات لإعادة البناء

## 8.1 المبادئ

1. فصل صارم: UI لا تعرف DB؛ Services لا تعرف DOM
2. TypeScript لمنع أخطاء الأنواع (خاصةً معرّفات الحسابات)
3. حزم المكتبات محليًا (npm + Vite) بدلًا من CDN
4. متغيرات بيئة (`.env`) بدلًا من keys في الكود
5. الإبقاء على Supabase + Dexie — البنية المحاسبية صحيحة، المشكلة في طبقة الـ UI

## 8.2 هيكل مشروع مقترح

```
src/
├── types/           # TypeScript: TransactionType, UserRole, AccountId, ...
├── config/          # ثوابت النظام (بدون keys)
├── db/
│   ├── local/       # Dexie schema + local repositories
│   └── remote/      # Supabase client + RPC wrappers
├── services/        # AccountingService, AuthService, SyncEngine, ...
├── store/           # إدارة الحالة المركزية
├── components/      # مكونات UI (بإطار عمل)
│   ├── ui/          # Button, Input, Table, Toast, Modal
│   ├── forms/       # TransactionForm (10 أنواع)
│   └── pages/       # كل تبويب كمكوّن منفصل
└── utils/           # helpers, formatters, validators
```

## 8.3 استراتيجية الاختبارات

| المستوى | الأداة | ما يُختبَر |
|---------|--------|-----------|
| وحدات | Vitest | AccountingService (مصفوفة القيود كاملة)، AuthService، validators |
| تكامل | Vitest | SyncEngine، OutboxService، Repository |
| E2E | Playwright | دخول، إدخال عملية offline، مزامنة، موافقة |

## 8.4 خريطة الطريق

| المرحلة | المحتوى |
|---------|---------|
| MVP | Auth (3 أنواع) + data-entry (10 أنواع) + offline + مزامنة |
| v1.1 | daily-summary + إغلاق + bank-accounts + debtors + failed-deposits |
| v1.2 | dashboard + all-operations + audit-log + users + account-management |
| v2.0 | PWA كامل + تقارير متقدمة |

---

# ملحق أ: دوال RPC المُنفَّذة في الـ Migrations

| الدالة | الغرض | المصدر |
|--------|--------|--------|
| `create_transaction_with_entries` | إنشاء عملية + قيود ذريًا | أصلي |
| `verify_quick_login` | تحقق + تدوير رمز الدخول السريع | migration 20260612000001 |
| `create_quick_login_token` | إنشاء رمز دخول سريع | migration 20260612000001 |
| `perform_daily_close` | إغلاق اليومية | أصلي |
| `reverse_transaction` | عكس عملية | أصلي |
| `delete_transaction_completely` | حذف عملية وقيودها نهائياً | migration 20260621000002 |
| `update_debtor_balance` | تحديث رصيد المدين | أصلي |
| `approve_transaction` | موافقة على receipt معلّق | أصلي |
| `reject_transaction` | رفض receipt معلّق | أصلي |
| `get_pending_approvals` | قائمة المعاملات المعلّقة | أصلي |
| `get_admin_dashboard` | KPIs للوحة التحكم | أصلي |
| `get_daily_summary` | ملخص يومي | أصلي |
| `get_chart_of_accounts` | هيكل الحسابات | أصلي |
| `get_account_statement` | كشف حساب | أصلي |
| `get_bank_statement` | كشف حساب بنكي | أصلي |
| `get_audit_logs` | سجل التدقيق | أصلي |
| `get_opening_balance` | الرصيد الافتتاحي لحساب | أصلي |
| `get_next_voucher_number` | رقم قيد جديد | أصلي |
| `clear_audit_logs` | حذف سجلات تدقيق قديمة | أصلي |
| `reset_all_operational_data` | إعادة تعيين كاملة | migration 20260612000004 |
| `perform_period_close` | إغلاق دوري | migration 20260621000001 |
| `get_period_closings` | قائمة الإغلاقات الدورية | migration 20260621000001 |
| `get_period_summaries` | ملخصات دورة معينة | migration 20260621000001 |
| `get_database_usage` | إحصائيات استخدام قاعدة البيانات | أصلي |
| `register_device` | تسجيل جهاز | migration 20260615000002 |
| `revoke_device` | إلغاء جهاز | migration 20260615000002 |
| `touch_device` | تحديث last_seen_at | migration 20260615000002 |
| `generate_account_number` | توليد رقم حساب | migration 20260612000008 |

---

# ملحق ب: ثوابت TypeScript المستخرجة من الكود

```typescript
type TransactionType = 
  | 'collection' | 'deposit' | 'bank_withdrawal'
  | 'expense' | 'receipt' | 'delivery' | 'refund_settlement'
  | 'failed_deposit_refund' | 'journal_entry' | 'external_handover';

type UserRole = 'admin' | 'admin_assistant' | 'agent';

type ApprovalStatus = 'approved' | 'pending' | 'rejected';

type SyncStatus = 'synced' | 'pending' | 'conflict';

type SyncAction = 'create' | 'update' | 'delete' | 'batch';

type FailedDepositStatus = 'pending' | 'claimed' | 'refunded' | 'rejected';

type NotificationType = 'info' | 'warning' | 'success' | 'error';

const ACCOUNT_PREFIXES = {
  AGENT    : 'AGT_',
  COMPANY  : 'COMP_',
  BANK     : 'BNK_',    // وسم فقط — لا يدخل دفتر الأستاذ
  CUSTOMER : 'CUST_',
  EXPENSE  : 'EXP_',
  REVENUE  : 'REV_',
  SUSPENSE : 'SUSP_',
} as const;

const SPECIAL_ACCOUNTS = {
  DEBTOR_SETTLEMENT : 'DEBTOR_SETTLEMENT',
  EXP_GENERAL       : 'EXP_GENERAL',
  GENERAL_FUND      : 'GENERAL_FUND',  // refund_settlement بلا شركة فقط
} as const;
```

---

> **نهاية AISpec v2.1**  
> كل قيمة في هذه الوثيقة مستخرجة مباشرةً من ملفات الكود المصدري — لا توثيق خارجي، لا افتراضات غير مُوسَّمة.
