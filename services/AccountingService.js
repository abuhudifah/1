/**
 * services/AccountingService.js — v4.0 (REFERENCE-ALIGNED)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * المرحلة 1 — تصحيح محرك القيود ليطابق المرجع المحاسبي المعتمد:
 * ─────────────────────────────────────────────────────────
 * المصفوفة النهائية المعتمدة (مدين ← دائن):
 *   تحصيل لصالح شركة      : AGT_ ← COMP_
 *   تحصيل من عميل مديون    : AGT_ ← DEBTOR_SETTLEMENT (حساب موحّد مستقل)
 *   إيداع بنكي            : COMP_ ← AGT_
 *   سحب بنكي             : AGT_ ← COMP_
 *   مصروف                : EXP_GENERAL ← AGT_
 *   تحويل بين مندوبين     : AGT_(المستلم) ← AGT_(المرسل)
 *
 * قواعد ملزمة:
 *   • BNK_ لا يظهر في أي قيد محاسبي إطلاقاً — مجرد وسم في transactions.bank_account_id.
 *   • الإيداع/السحب يشتقّان الشركة من bank_accounts.company_id؛ بلا شركة مرتبطة → خطأ
 *     صريح (ممنوع استخدام GENERAL_FUND كبديل).
 *   • تحصيل المديون يذهب دائماً إلى DEBTOR_SETTLEMENT، لا إلى الشركة ولا لحساب عميل فردي.
 *   • المصروفات تُجمّع في EXP_GENERAL (لا تجزئة حسب النوع — يبقى النوع في الوصف فقط).
 * ─────────────────────────────────────────────────────────
 */

'use strict';

// ============================================================
// الحساب العام — يبقى معرّفاً للتوافق مع مسارات الاستلام/التسليم القديمة فقط،
// ولا يُستخدم إطلاقاً في الإيداع/السحب/التحصيل بعد توضيح المرجع.
// ============================================================
const GENERAL_ACCOUNT_ID = 'GENERAL_FUND';

// ============================================================
// الحسابات المستقلة الموحّدة (مطابقة للمرجع)
// ============================================================
const DEBTOR_SETTLEMENT_ID = 'DEBTOR_SETTLEMENT';            // تسويات العملاء المديونين — حساب موحّد مستقل
const EXPENSE_ACCOUNT_ID   = `${ACCOUNT_PREFIXES.EXPENSE}GENERAL`; // EXP_GENERAL — المصروفات العامة

// يحذف الحقول التي تبدأ بـ _ (حقول مؤقتة لا تُحفظ في DB)
function _stripEphemeral(obj) {
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!k.startsWith('_')) clean[k] = v;
  }
  return clean;
}

// ============================================================
// مولّد أرقام القيود
// ============================================================

async function _generateVoucherNumber() {
  if (!isOfflineMode() && isOnline()) {
    try {
      const { data, error } = await supabaseClient.rpc(RPC.GET_NEXT_VOUCHER_NUMBER);
      if (!error && data) return data;
    } catch (e) { console.warn('⚠️ _generateVoucherNumber RPC فشل، يُستخدم الرقم المحلي:', e.message); }
  }
  const today = getCurrentSaudiDate().replace(/-/g, '');
  return `V${today}-LOCAL-${Date.now()}`;
}

// ============================================================
// بناء معرفات الحسابات المحاسبية
// ============================================================

const AccountId = {
  agent    : (id)   => `${ACCOUNT_PREFIXES.AGENT}${id}`,
  company  : (id)   => `${ACCOUNT_PREFIXES.COMPANY}${id}`,
  bank     : (id)   => `${ACCOUNT_PREFIXES.BANK}${id}`,
  customer : (id)   => `${ACCOUNT_PREFIXES.CUSTOMER}${id}`,
  expense  : (code) => `${ACCOUNT_PREFIXES.EXPENSE}${code}`,
  revenue  : (code) => `${ACCOUNT_PREFIXES.REVENUE}${code}`,
  suspense : (txId) => `${ACCOUNT_PREFIXES.SUSPENSE}${txId}`,
};

// ============================================================
// بناء القيود لكل نوع عملية
// ============================================================

function _buildCollectionEntries(tx, voucher) {
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const entries  = [];

  if (tx.company_id) {
    // تحصيل لصالح شركة: AGT_ مدين ← COMP_ دائن
    const compAcc = AccountId.company(tx.company_id);
    entries.push(
      { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
        description: `تحصيل من عميل${tx.customer_name ? ': ' + tx.customer_name : ''} — لصالح الشركة` },
      { voucher_number: voucher, date, account_id: compAcc,  debit: 0, credit: tx.amount,
        description: 'تحصيل من عميل لصالح الشركة' }
    );
  } else if (tx.customer_id) {
    // تحصيل من عميل مديون: AGT_ مدين ← DEBTOR_SETTLEMENT دائن (حساب موحّد مستقل — لا حساب فردي)
    entries.push(
      { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
        description: `تحصيل من مدين: ${tx.customer_name || tx.customer_id}` },
      { voucher_number: voucher, date, account_id: DEBTOR_SETTLEMENT_ID, debit: 0, credit: tx.amount,
        description: `تسوية دين العميل: ${tx.customer_name || tx.customer_id}` }
    );
  } else {
    // ممنوع التحصيل بلا جهة محدّدة (شركة أو عميل مديون) — لا بديل عام
    return err('التحصيل يتطلب تحديد شركة أو عميل مديون');
  }

  return entries;
}

// الإيداع البنكي — قيد بين COMP (مدين) و AGT (دائن) فقط. BNK_ وسم لا يدخل القيد.
// companyId مُشتَقّ مسبقاً في buildEntries من tx.company_id أو bank_accounts.company_id.
function _buildDepositEntries(tx, companyId, voucher) {
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const compAcc  = AccountId.company(companyId);

  return [
    { voucher_number: voucher, date, account_id: compAcc,  debit: tx.amount, credit: 0,
      description: 'إيداع بنكي — خروج المال من عهدة الشركة إلى البنك' },
    { voucher_number: voucher, date, account_id: agentAcc, debit: 0, credit: tx.amount,
      description: 'إيداع بنكي — إخلاء عهدة المندوب' },
  ];
}

// المصروف: EXP_GENERAL مدين ← AGT_ دائن. نوع المصروف يبقى في الوصف فقط (بلا تجزئة حسابات).
function _buildExpenseEntries(tx, voucher) {
  const date      = tx.date || getCurrentSaudiDate();
  const agentAcc  = AccountId.agent(tx.agent_id);
  const agentName = tx.agent_name || 'المندوب';
  const expType   = tx.expense_type || 'عام';
  const desc      = `مصروف ${expType} من عهدة ${agentName}`;

  return [
    { voucher_number: voucher, date, account_id: EXPENSE_ACCOUNT_ID, debit: tx.amount, credit: 0,
      description: desc },
    { voucher_number: voucher, date, account_id: agentAcc, debit: 0, credit: tx.amount,
      description: desc },
  ];
}

function _buildReceiptEntries(tx, voucher) {
  const date = tx.date || getCurrentSaudiDate();

  // الاستلام المعلّق (بانتظار موافقة المدير) — يُحجز مؤقتاً ثم يُرحّل عند الموافقة
  if (tx.approval_status === APPROVAL_STATUS.PENDING) {
    const suspAcc   = AccountId.suspense(tx.id);
    const senderAcc = tx.from_agent_id ? AccountId.agent(tx.from_agent_id) : suspAcc;
    return [
      { voucher_number: voucher, date, account_id: suspAcc,   debit: tx.amount, credit: 0,
        description: `استلام معلق — بانتظار موافقة المدير` },
      { voucher_number: voucher, date, account_id: senderAcc, debit: 0, credit: tx.amount,
        description: 'استلام معلق — خصم مؤقت من المرسِل' },
    ];
  }

  // تحويل بين مندوبين (مستلم): AGT_(المستلم) مدين ← AGT_(المرسِل) دائن — بلا حساب وسيط
  if (!tx.from_agent_id) return err('الاستلام يتطلب تحديد المندوب المرسِل');
  return [
    { voucher_number: voucher, date, account_id: AccountId.agent(tx.agent_id), debit: tx.amount, credit: 0,
      description: 'استلام حوالة من مندوب' },
    { voucher_number: voucher, date, account_id: AccountId.agent(tx.from_agent_id), debit: 0, credit: tx.amount,
      description: 'تسليم حوالة للمندوب المستلم' },
  ];
}

function _buildDeliveryEntries(tx, voucher) {
  const date = tx.date || getCurrentSaudiDate();
  if (!tx.to_agent_id) return err('التسليم يتطلب تحديد المندوب المستلم');

  const senderName   = tx._sender_name   || 'المرسِل';
  const receiverName = tx._receiver_name || 'المستلم';
  const notesStr     = tx.details ? ` (${tx.details})` : '';

  return [
    // حساب المستلم: مدين (يزيد رصيده)
    { voucher_number: voucher, date, account_id: AccountId.agent(tx.to_agent_id), debit: tx.amount, credit: 0,
      description: `عليكم حوالة نقدية واردة نقل عهدة من حساب ${senderName} إلى حسابكم${notesStr}` },
    // حساب المرسل: دائن (ينقص رصيده)
    { voucher_number: voucher, date, account_id: AccountId.agent(tx.agent_id), debit: 0, credit: tx.amount,
      description: `لكم حوالة نقدية نقل عهدة من حسابكم إلى حساب ${receiverName} تحويل مباشر${notesStr}` },
  ];
}

// استرداد الإيداع الفاشل — نفس اتجاه الإيداع البنكي تماماً (COMP مدين ← AGT دائن).
// في كشف الشركة: عليكم | في كشف المندوب: لكم
// companyId مُشتَقّ من bank_accounts.company_id (نفس آلية الإيداع).
function _buildFailedDepositRefundEntries(tx, companyId, voucher) {
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const compAcc  = AccountId.company(companyId);
  const partial  = tx._partial ? 'جزئي' : 'كلي';
  const fdRef    = tx._fd_id ? ` — مرجع: ${tx._fd_id.slice(0, 8)}` : '';
  const remain   = (tx._remaining > 0) ? ` — المتبقي: ${tx._remaining.toLocaleString('en-US')} ر.س` : '';

  return [
    { voucher_number: voucher, date, account_id: compAcc,  debit: tx.amount, credit: 0,
      description: `استرداد إيداع فاشل ${partial}${fdRef}${remain}` },
    { voucher_number: voucher, date, account_id: agentAcc, debit: 0, credit: tx.amount,
      description: `استرداد إيداع فاشل ${partial} — إخلاء عهدة المندوب${fdRef}${remain}` },
  ];
}

// السحب البنكي — قيد بين AGT (مدين) و COMP (دائن) فقط. BNK_ وسم لا يدخل القيد.
// companyId مُشتَقّ مسبقاً في buildEntries من tx.company_id أو bank_accounts.company_id.
function _buildBankWithdrawalEntries(tx, companyId, voucher) {
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const compAcc  = AccountId.company(companyId);

  return [
    { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
      description: 'سحب بنكي — زيادة عهدة المندوب (استلم نقداً من البنك)' },
    { voucher_number: voucher, date, account_id: compAcc,  debit: 0, credit: tx.amount,
      description: 'سحب بنكي — الشركة استلمت من البنك عبر المندوب' },
  ];
}

// القيد اليدوي — الحسابات المدينة والدائنة يحددها المستخدم في tx._journal_entries
// tx._journal_entries: [{ account_id, debit, credit, description }]
// tx.amount: إجمالي المدين (= إجمالي الدائن للقيد المتوازن)
function _buildJournalEntryEntries(tx, voucher) {
  const rawEntries = tx._journal_entries;
  if (!Array.isArray(rawEntries) || rawEntries.length < 2) {
    return err('القيد اليدوي يتطلب سطرين على الأقل في _journal_entries');
  }
  const date = tx.date || getCurrentSaudiDate();
  return rawEntries.map(e => ({
    voucher_number: voucher,
    date,
    account_id : e.account_id,
    debit      : parseFloat(e.debit  || 0),
    credit     : parseFloat(e.credit || 0),
    description: e.description || tx.details || 'قيد محاسبي يدوي',
  }));
}

// تسليم عهدة لطرف خارجي — عكس التحصيل من مديون تماماً
// الوجهة إما DEBTOR_SETTLEMENT أو GENERAL_FUND حسب tx.handover_destination
function _buildExternalHandoverEntries(tx, voucher) {
  const date      = tx.date || getCurrentSaudiDate();
  const agentAcc  = AccountId.agent(tx.agent_id);
  const agentName = tx.agent_name || 'المندوب';
  const party     = tx.details   || 'طرف خارجي';

  const destAcc = tx.handover_destination === 'general_fund'
    ? GENERAL_ACCOUNT_ID
    : DEBTOR_SETTLEMENT_ID;

  const destLabel = tx.handover_destination === 'general_fund'
    ? 'الصندوق الرئيسي'
    : 'حساب تسوية العملاء';

  return [
    { voucher_number: voucher, date, account_id: destAcc,  debit: tx.amount, credit: 0,
      description: `تسليم عهدة إلى ${destLabel} — ${party}` },
    { voucher_number: voucher, date, account_id: agentAcc, debit: 0, credit: tx.amount,
      description: `إخلاء عهدة ${agentName} — تسليم إلى ${destLabel}` },
  ];
}

function _buildRefundSettlementEntries(tx, voucher) {
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const compAcc  = tx.company_id ? AccountId.company(tx.company_id) : GENERAL_ACCOUNT_ID;

  return [
    { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
      description: 'استرداد مبلغ — تسوية' },
    { voucher_number: voucher, date, account_id: compAcc,  debit: 0, credit: tx.amount,
      description: 'استرداد مبلغ للشركة' },
  ];
}

// ============================================================
// اشتقاق شركة الحساب البنكي (للإيداع/السحب)
// يُفضّل tx.company_id إن وُجد، وإلا يُقرأ من bank_accounts.company_id.
// يُعيد null إذا لم تكن هناك شركة مرتبطة (لا بديل عام).
// ============================================================
async function _resolveCompanyFromBank(tx) {
  if (tx.company_id) return tx.company_id;
  if (!tx.bank_account_id) return null;

  // محلياً أولاً (Dexie) لدعم وضع عدم الاتصال
  try {
    if (typeof db !== 'undefined' && db.isOpen()) {
      const ba = await db.bank_accounts.get(tx.bank_account_id);
      if (ba && ba.company_id) return ba.company_id;
    }
  } catch { /* تجاهل ونحاول عبر الشبكة */ }

  if (!isOfflineMode() && isOnline()) {
    try {
      const { data, error } = await supabaseClient
        .from(TABLES.BANK_ACCOUNTS)
        .select('company_id')
        .eq('id', tx.bank_account_id)
        .single();
      if (!error && data && data.company_id) return data.company_id;
    } catch { /* تجاهل */ }
  }

  return null;
}

// ============================================================
// الدالة الرئيسية: buildEntries
// ============================================================

async function buildEntries(tx) {
  try {
    if (!tx.type)     return err('نوع العملية مطلوب');
    if (!tx.amount)   return err('المبلغ مطلوب');
    if (!tx.agent_id) return err('معرف المندوب مطلوب');

    let entries;

    switch (tx.type) {
      case TRANSACTION_TYPES.COLLECTION:
        entries = _buildCollectionEntries(tx, await _generateVoucherNumber());
        break;
      case TRANSACTION_TYPES.DEPOSIT: {
        if (!tx.bank_account_id) return err('الحساب البنكي مطلوب للإيداع');
        const depCompanyId = await _resolveCompanyFromBank(tx);
        if (!depCompanyId) return err('الحساب البنكي غير مرتبط بشركة — لا يمكن ترحيل الإيداع');
        entries = _buildDepositEntries(tx, depCompanyId, await _generateVoucherNumber());
        break;
      }
      case TRANSACTION_TYPES.BANK_WITHDRAWAL: {
        if (!tx.bank_account_id) return err('الحساب البنكي مطلوب للسحب البنكي');
        const wdCompanyId = await _resolveCompanyFromBank(tx);
        if (!wdCompanyId) return err('الحساب البنكي غير مرتبط بشركة — لا يمكن ترحيل السحب');
        entries = _buildBankWithdrawalEntries(tx, wdCompanyId, await _generateVoucherNumber());
        break;
      }
      case TRANSACTION_TYPES.EXPENSE:
        entries = _buildExpenseEntries(tx, await _generateVoucherNumber());
        break;
      case TRANSACTION_TYPES.RECEIPT:
        entries = _buildReceiptEntries(tx, await _generateVoucherNumber());
        break;
      case TRANSACTION_TYPES.DELIVERY:
        entries = _buildDeliveryEntries(tx, await _generateVoucherNumber());
        break;
      case TRANSACTION_TYPES.JOURNAL_ENTRY:
        entries = _buildJournalEntryEntries(tx, await _generateVoucherNumber());
        break;
      case TRANSACTION_TYPES.EXTERNAL_HANDOVER:
        entries = _buildExternalHandoverEntries(tx, await _generateVoucherNumber());
        break;
      case TRANSACTION_TYPES.REFUND_SETTLEMENT:
        entries = _buildRefundSettlementEntries(tx, await _generateVoucherNumber());
        break;
      case TRANSACTION_TYPES.FAILED_DEPOSIT_REFUND: {
        if (!tx.bank_account_id) return err('الحساب البنكي مطلوب لاسترداد الإيداع الفاشل');
        const fdCompanyId = await _resolveCompanyFromBank(tx);
        if (!fdCompanyId) return err('الحساب البنكي غير مرتبط بشركة — لا يمكن ترحيل الاسترداد');
        entries = _buildFailedDepositRefundEntries(tx, fdCompanyId, await _generateVoucherNumber());
        break;
      }
      default:
        return err(`نوع عملية غير معروف: ${tx.type}`);
    }

    // بعض دوال البناء قد تُعيد نتيجة خطأ (err) بدل مصفوفة قيود — نمرّرها كما هي
    if (entries && entries.ok === false) return entries;

    const validation = validateLedger(entries);
    if (!isOk(validation)) return validation;

    return ok(entries);

  } catch (e) {
    return err(`خطأ في بناء القيود: ${e.message}`);
  }
}

// ============================================================
// تصنيف أخطاء RPC: دائم (لا يُجدي إعادة المحاولة) أم مؤقت (شبكة)
// ============================================================

// 42883/42804 مضافان لمنع إدخال أخطاء نوع UUID→TEXT في الطابور بدلاً من رفعها فوراً
const _FATAL_PG_CODES = new Set(['23502', '23514', '42703', '42501', 'P0001', '22P02', '23503', '22003', '42883', '42804']);

function _isFatalRpcError(error) {
  return _FATAL_PG_CODES.has(error?.code);
}

function _humanizeRpcError(error) {
  switch (error?.code) {
    case '42501': return 'ليس لديك صلاحية لتنفيذ هذه العملية — تواصل مع المدير';
    case '23502': return 'حقل مطلوب مفقود في بيانات العملية — تحقق من اكتمال البيانات';
    case '23503': return 'مرجع غير موجود — تحقق من ارتباط الحساب البنكي بالشركة';
    case '23514': return `قيد بيانات مخالَف: ${error.message}`;
    case 'P0001': return error.message;
    default:      return `خطأ في الخادم: ${error.message}`;
  }
}

// ============================================================
// إنشاء معاملة مالية مع قيودها
// ============================================================

async function createTransactionWithEntries(txData) {
  try {
    if (!isValidAmount(txData.amount)) {
      return err('المبلغ يجب أن يكون رقماً موجباً');
    }
    if (!isValidDate(txData.date || getCurrentSaudiDate())) {
      return err('التاريخ غير صالح');
    }

    const isReceiptByAgent = txData.type === TRANSACTION_TYPES.RECEIPT
      && AuthService.getCurrentUser()?.role === ROLES.AGENT;

    const transaction = {
      ...txData,
      // ✅ UUID حقيقي دائماً (حتى أوفلاين). Postgres يقبل المعرّف المُولّد من
      //    العميل، فيُلغى نظام TEMP_ID و replaceTempId ومعه فئة أعطال FK
      //    (transactions_customer_id_fkey / account_ledger.reference_id).
      id              : txData.id || generateUUID(),
      date            : txData.date || getCurrentSaudiDate(),
      time            : txData.time || getCurrentSaudiTime(),
      created_at      : new Date().toISOString(),
      updated_at      : new Date().toISOString(),
      sync_status     : (!isOfflineMode() && isOnline()) ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
      approval_status : txData.approval_status
        || (isReceiptByAgent ? APPROVAL_STATUS.PENDING : APPROVAL_STATUS.APPROVED),
    };
    // نسخة نظيفة بدون الحقول الوقتية (تُستخدم للحفظ في DB وإرسال للـ RPC)
    const cleanTransaction = _stripEphemeral(transaction);

    const entriesResult = await buildEntries(transaction);
    if (!isOk(entriesResult)) return entriesResult;
    const entries = entriesResult.data;

    const enrichedEntries = entries.map(e => ({
      ...e,
      id         : generateUUID(),
      created_at : new Date().toISOString(),
    }));

    if (!isOfflineMode() && isOnline()) {
      // استدعاء مباشر للحصول على كود الخطأ (callRPC يفقد الكود)
      const { data: rpcData, error: rpcError } = await supabaseClient.rpc(
        RPC.CREATE_TRANSACTION_WITH_ENTRIES,
        { p_transaction: cleanTransaction, p_entries: enrichedEntries }
      );

      if (!rpcError) {
        const realTxId = rpcData?.transaction_id;

        if (typeof db !== 'undefined' && db.isOpen()) {
          await db.transactions.put({
            ...cleanTransaction,
            id          : realTxId || transaction.id,
            sync_status : SYNC_STATUS.SYNCED,
          });

          for (const entry of enrichedEntries) {
            await db.account_ledger.put({
              ...entry,
              reference_id: realTxId || transaction.id,
              sync_status : SYNC_STATUS.SYNCED,
            });
          }
        }

        await _updateLocalBalances(enrichedEntries);

        if (txData.type === TRANSACTION_TYPES.COLLECTION && txData.customer_id) {
          await callRPC(RPC.UPDATE_DEBTOR_BALANCE, {
            p_debtor_id        : txData.customer_id,
            p_collected_amount : txData.amount,
          });
        }

        window.dispatchEvent(new CustomEvent('accounting:transactionCreated', {
          detail: { transaction: { ...transaction, id: realTxId }, entries: enrichedEntries },
        }));

        return ok({
          transaction : { ...transaction, id: realTxId || transaction.id },
          entries     : enrichedEntries,
          confirmed   : true,
        });
      }

      // خطأ دائم في البيانات أو الصلاحيات — لا يُجدي قائمة الانتظار
      if (_isFatalRpcError(rpcError)) {
        console.error(`❌ AccountingService: خطأ دائم (${rpcError.code}): ${rpcError.message}`);
        return err(_humanizeRpcError(rpcError));
      }

      // خطأ مؤقت (شبكة / خادم) — يُحفظ للمزامنة لاحقاً
      console.warn(`⚠️ RPC فشل مؤقتاً (${rpcError.code || 'شبكة'}) — الحفظ في الطابور: ${rpcError.message}`);
    }

    const pendingTransaction = { ...cleanTransaction, sync_status: SYNC_STATUS.PENDING };

    if (typeof db !== 'undefined' && db.isOpen()) {
      await db.transactions.put(pendingTransaction);
      for (const entry of enrichedEntries) {
        await db.account_ledger.put({
          ...entry,
          reference_id: transaction.id,
          sync_status : SYNC_STATUS.PENDING,
        });
      }
    }

    await _updateLocalBalances(enrichedEntries);

    const _batchPayload = {
      id         : transaction.id,    // id === idempotency_key (Phase 3)
      operations : [
        { action: SYNC_ACTIONS.CREATE, table: TABLES.TRANSACTIONS, data: cleanTransaction },
        ...enrichedEntries.map(e => ({
          action : SYNC_ACTIONS.CREATE,
          table  : TABLES.ACCOUNT_LEDGER,
          data   : { ...e, reference_id: transaction.id },
        })),
      ],
    };

    if (typeof OutboxService !== 'undefined') {
      // Phase 3: OutboxService يضمن 23505=نجاح + FIFO + id===idempotency_key
      await OutboxService.addToOutbox(_batchPayload, SYNC_ACTIONS.BATCH, 'batch');
    } else {
      // LEGACY: To be removed in Phase 6
      await SyncQueue.add(SYNC_ACTIONS.BATCH, 'batch', transaction.id, _batchPayload);
    }

    window.dispatchEvent(new CustomEvent('accounting:transactionCreated', {
      detail: { transaction: pendingTransaction, entries: enrichedEntries, pending: true },
    }));

    return ok({ transaction: pendingTransaction, entries: enrichedEntries, pending: true, confirmed: false });

  } catch (e) {
    console.error('❌ AccountingService.createTransactionWithEntries():', e);
    return err(`فشل إنشاء المعاملة: ${e.message}`);
  }
}

// ============================================================
// جلب رصيد حساب محاسبي
// ============================================================

async function getAccountBalance(accountId) {
  try {
    if (!isOfflineMode() && isOnline()) {
      const { data, error } = await supabaseClient
        .from(TABLES.ACCOUNT_BALANCES)
        .select('balance')
        .eq('account_id', accountId)
        .single();

      if (!error && data) {
        await setLocalAccountBalance(accountId, parseFloat(data.balance));
        return ok(parseFloat(data.balance));
      }
    }

    // Offline fallback
    if (typeof db !== 'undefined' && db.isOpen()) {
      const localBalance = await getLocalAccountBalance(accountId);
      return ok(localBalance);
    }

    return ok(0);
  } catch (e) {
    return err(`فشل جلب الرصيد: ${e.message}`);
  }
}

// ============================================================
// كشف حساب
// ============================================================

async function getStatement(accountId, fromDate, toDate, options = {}) {
  try {
    const { page = 1, pageSize = PAGINATION_CONFIG.DEFAULT_PAGE_SIZE } = options;

    let openingBalance = 0;
    if (!isOfflineMode() && isOnline()) {
      const { data: balanceData, error: balanceErr } = await supabaseClient
        .rpc(RPC.GET_OPENING_BALANCE, { p_account_id: accountId, p_from_date: fromDate });
      if (!balanceErr && balanceData !== null) {
        openingBalance = parseFloat(balanceData) || 0;
      }
    }

    const result = await repo.query(
      TABLES.ACCOUNT_LEDGER,
      {
        account_id : accountId,
        date       : { op: 'between', val: [fromDate, toDate] },
      },
      { orderBy: 'date', ascending: true, page, pageSize }
    );

    if (!isOk(result)) return result;

    const entries = result.data.data || [];
    const totalCount = result.data.count || entries.length;

    let pageDebit = 0, pageCredit = 0;
    for (const entry of entries) {
      pageDebit  += parseFloat(entry.debit  || 0);
      pageCredit += parseFloat(entry.credit || 0);
    }

    let closingBalance = openingBalance + pageDebit - pageCredit;
    if (!isOfflineMode() && isOnline() && page > 1) {
      try {
        const { data: stmtData } = await supabaseClient.rpc(RPC.GET_ACCOUNT_STATEMENT, {
          p_account_id : accountId,
          p_from_date  : fromDate,
          p_to_date    : toDate,
          p_page       : page - 1,
          p_limit      : pageSize,
        });
        if (stmtData?.closing_balance !== undefined) {
          closingBalance = parseFloat(stmtData.closing_balance) + pageDebit - pageCredit;
        }
      } catch { /* الـ RPC قد لا يسمح للوكيل — نبقى على التقدير */ }
    }

    return ok({
      entries,
      count         : totalCount,
      openingBalance,
      closingBalance,
      totalDebit    : pageDebit,
      totalCredit   : pageCredit,
    });

  } catch (e) {
    return err(`فشل جلب كشف الحساب: ${e.message}`);
  }
}

// ============================================================
// الإقفال اليومي (محتفظ به للتوافق)
// ============================================================

async function dailyClose(date = null) {
  try {
    const closeDate = date || getYesterdaySaudiDate();
    if (!AuthService.isAdmin()) return err('الإقفال اليومي مسموح للمدير فقط');
    if (isOfflineMode() || !isOnline()) return err('يجب الاتصال بالإنترنت لتنفيذ الإقفال اليومي');

    const result = await callRPC(RPC.PERFORM_DAILY_CLOSE, { p_date: closeDate });
    if (!isOk(result)) return result;

    await setLocalSetting('daily_close_time', {
      ...(await getLocalSettings()).get('daily_close_time') || {},
      lastClosedDate: closeDate,
    });

    showToast(`تم إقفال يوم ${formatDateArabic(closeDate)} بنجاح`, 'success');
    return result;

  } catch (e) {
    return err(`فشل الإقفال اليومي: ${e.message}`);
  }
}

// ============================================================
// تصدير بيانات الفترة (قبل الإقفال) — يُعيد JSON كاملاً
// ============================================================

async function exportPeriodData(periodStart, periodEnd) {
  try {
    if (isOfflineMode() || !isOnline()) return err('يجب الاتصال بالإنترنت للتصدير');

    // جلب المعاملات
    const { data: transactions, error: txErr } = await supabaseClient
      .from(TABLES.TRANSACTIONS)
      .select('*')
      .gte('date', periodStart)
      .lte('date', periodEnd)
      .order('date', { ascending: true });
    if (txErr) return err(`فشل جلب المعاملات: ${txErr.message}`);

    // جلب القيود المحاسبية
    const { data: ledger, error: ledgerErr } = await supabaseClient
      .from(TABLES.ACCOUNT_LEDGER)
      .select('*')
      .gte('date', periodStart)
      .lte('date', periodEnd)
      .order('date', { ascending: true });
    if (ledgerErr) return err(`فشل جلب دفتر الأستاذ: ${ledgerErr.message}`);

    // جلب الأرصدة الحالية
    const { data: balances, error: balErr } = await supabaseClient
      .from(TABLES.ACCOUNT_BALANCES)
      .select('*');
    if (balErr) return err(`فشل جلب الأرصدة: ${balErr.message}`);

    // حساب ملخصات الحسابات من القيود
    const summaryMap = {};
    for (const entry of (ledger || [])) {
      if (!summaryMap[entry.account_id]) {
        summaryMap[entry.account_id] = { account_id: entry.account_id, total_debit: 0, total_credit: 0 };
      }
      summaryMap[entry.account_id].total_debit  += parseFloat(entry.debit  || 0);
      summaryMap[entry.account_id].total_credit += parseFloat(entry.credit || 0);
    }
    for (const bal of (balances || [])) {
      if (summaryMap[bal.account_id]) {
        const net = summaryMap[bal.account_id].total_debit - summaryMap[bal.account_id].total_credit;
        summaryMap[bal.account_id].closing_balance  = parseFloat(bal.balance || 0);
        summaryMap[bal.account_id].opening_balance  = parseFloat(bal.balance || 0) - net;
      }
    }

    // البيانات المرجعية
    const users     = (typeof AppStore !== 'undefined') ? (AppStore.getState('users')        || []) : [];
    const companies = (typeof AppStore !== 'undefined') ? (AppStore.getState('companies')    || []) : [];
    const banks     = (typeof AppStore !== 'undefined') ? (AppStore.getState('bankAccounts') || []) : [];

    // خريطة الأرصدة {account_id → balance} لعارض الأرشيف
    const balanceMap = {};
    for (const b of (balances || [])) balanceMap[b.account_id] = b.balance;

    const exportData = {
      metadata: {
        version      : '2.0',
        exported_at  : new Date().toISOString(),
        period_start : periodStart,
        period_end   : periodEnd,
        exported_by  : AuthService.getCurrentUser()?.display_name || '',
        system       : 'نظام أبو حذيفة',
      },
      period_start     : periodStart,
      period_end       : periodEnd,
      account_balances : balanceMap,
      account_ledger   : ledger || [],
      monthly_summaries: Object.values(summaryMap),
      transactions     : transactions || [],
      ledger_entries   : ledger || [],
      reference        : { users, companies, bank_accounts: banks },
    };

    return ok(exportData);
  } catch (e) {
    return err(`فشل التصدير: ${e.message}`);
  }
}

// ============================================================
// الإقفال الدوري — يصدّر البيانات ثم يُقفل الفترة على الخادم
// ============================================================

async function performPeriodClose(periodStart, periodEnd, notes = '') {
  try {
    if (!AuthService.isAdmin()) return err('الإقفال الدوري مسموح للمدير فقط');
    if (isOfflineMode() || !isOnline()) return err('يجب الاتصال بالإنترنت لتنفيذ الإقفال');

    const result = await callRPC(RPC.PERFORM_PERIOD_CLOSE, {
      p_period_start: periodStart,
      p_period_end  : periodEnd,
      p_notes       : notes || null,
    });
    return result;
  } catch (e) {
    return err(`فشل الإقفال الدوري: ${e.message}`);
  }
}

// ============================================================
// جلب سجل الإقفالات السابقة
// ============================================================

async function getPeriodClosings() {
  try {
    if (isOfflineMode() || !isOnline()) return ok([]);
    const result = await callRPC(RPC.GET_PERIOD_CLOSINGS, {});
    if (!isOk(result)) return ok([]);
    return ok(Array.isArray(result.data) ? result.data : []);
  } catch (e) {
    return ok([]);
  }
}

// ============================================================
// قياس استخدام قاعدة البيانات والتخزين (خطة Supabase المجانية)
// ============================================================

async function getDatabaseUsage() {
  try {
    if (isOfflineMode() || !isOnline()) return err('يجب الاتصال بالإنترنت لقياس الاستخدام');
    const result = await callRPC(RPC.GET_DATABASE_USAGE, {});
    if (!isOk(result)) return err(result.error || 'فشل قياس استخدام قاعدة البيانات');
    return ok(result.data);
  } catch (e) {
    return err(`فشل قياس الاستخدام: ${e.message}`);
  }
}

// ============================================================
// عكس معاملة
// ============================================================

async function reverseEntries(transactionId) {
  try {
    if (!AuthService.isAdmin()) return err('عكس المعاملات مسموح للمدير فقط');

    const txResult = await repo.getById(TABLES.TRANSACTIONS, transactionId);
    if (!isOk(txResult) || !txResult.data) return err('المعاملة غير موجودة');

    const tx = txResult.data;
    if (tx.is_reversed) return err('هذه المعاملة تم عكسها مسبقاً');

    if (!isOfflineMode() && isOnline()) {
      const result = await callRPC(RPC.REVERSE_TRANSACTION, { p_transaction_id: transactionId });
      if (!isOk(result)) return result;

      if (typeof db !== 'undefined' && db.isOpen()) {
        await db.transactions.update(transactionId, { is_reversed: true });

        const { data: reversalEntries } = await supabaseClient
          .from(TABLES.ACCOUNT_LEDGER)
          .select('*')
          .like('voucher_number', `REV_${transactionId}%`)
          .limit(QUERY_LIMITS.REVERSAL_ENTRIES);

        if (reversalEntries && reversalEntries.length > 0) {
          await db.account_ledger.bulkPut(
            reversalEntries.map(e => ({ ...e, sync_status: SYNC_STATUS.SYNCED }))
          );
          await _updateLocalBalances(reversalEntries);
        }

        await db.audit_logs.put({
          id          : generateUUID(),
          user_id     : AuthService.getCurrentUserId(),
          action      : 'update',
          record_type : 'transaction',
          record_id   : transactionId,
          old_value   : JSON.stringify({ is_reversed: false }),
          new_value   : JSON.stringify({ is_reversed: true }),
          timestamp   : new Date().toISOString(),
        });
      }

      showToast('تم عكس المعاملة بنجاح', 'success');
      window.dispatchEvent(new CustomEvent('accounting:transactionReversed', { detail: { transactionId } }));
      return result;
    }

    return err('يجب الاتصال بالإنترنت لعكس المعاملات');

  } catch (e) {
    return err(`فشل عكس المعاملة: ${e.message}`);
  }
}

// ============================================================
// الحذف الكامل — يحذف المعاملة وقيودها ويعكس أثرها على الأرصدة
// التفويض على الخادم: المدير دائماً | المندوب لعملياته في نفس اليوم فقط
// ============================================================

async function deleteTransactionCompletely(transactionId) {
  try {
    if (!isOfflineMode() && isOnline()) {
      const { data, error } = await supabaseClient.rpc(
        RPC.DELETE_TRANSACTION_COMPLETELY,
        { p_transaction_id: transactionId }
      );
      if (error) return err(_humanizeRpcError(error));

      // تنظيف محلي: عكس الأرصدة + حذف القيود + حذف المعاملة من Dexie
      await cleanupLocalTransaction(transactionId);
      if (typeof db !== 'undefined' && db.isOpen()) {
        await db.transactions.delete(transactionId).catch(() => {});
      }

      window.dispatchEvent(new CustomEvent('accounting:transactionDeleted', {
        detail: { transactionId },
      }));
      return ok(data || { success: true });
    }

    return err('يجب الاتصال بالإنترنت للحذف النهائي');

  } catch (e) {
    return err(`فشل حذف المعاملة: ${e.message}`);
  }
}

// ============================================================
// تنظيف معاملة محلية (Dexie): عكس أثر قيودها على الأرصدة ثم حذف القيود
// يُستخدم بعد حذف معاملة معلّقة لم تُزامن، أو ضمن الحذف الكامل.
// ملاحظة: لا يحذف صف المعاملة نفسه — يترك ذلك للمُستدعي.
// ============================================================

async function cleanupLocalTransaction(transactionId) {
  try {
    if (typeof db === 'undefined' || !db.isOpen()) return;

    const entries = await db.account_ledger
      .where('reference_id').equals(transactionId).toArray();

    // عكس أثر القيود على الأرصدة المحلية
    for (const e of entries) {
      const debit  = parseFloat(e.debit  || 0);
      const credit = parseFloat(e.credit || 0);
      const existing = await db.account_balances.get(e.account_id);
      const current  = existing ? parseFloat(existing.balance || 0) : 0;
      await db.account_balances.put({
        account_id  : e.account_id,
        balance     : current - debit + credit,
        last_updated: new Date().toISOString(),
      });
    }

    await db.account_ledger.where('reference_id').equals(transactionId).delete();
  } catch (e) {
    console.warn('⚠️ cleanupLocalTransaction:', e.message);
  }
}

// ============================================================
// التحقق من توازن القيود
// ============================================================

function validateLedger(entries) {
  if (!entries || entries.length === 0) return err('لا توجد قيود للتحقق منها');

  let totalDebit = 0, totalCredit = 0;
  for (const entry of entries) {
    const d = parseFloat(entry.debit  || 0);
    const c = parseFloat(entry.credit || 0);
    if (d < 0 || c < 0) return err('المبالغ لا يمكن أن تكون سالبة في دفتر الأستاذ');
    if (d > 0 && c > 0)  return err('كل سطر يجب أن يكون مديناً أو دائناً فقط، ليس كليهما');
    totalDebit  += d;
    totalCredit += c;
  }

  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) {
    return err(
      `القيود غير متوازنة: مجموع المدين (${formatCurrency(totalDebit, false)}) ≠ مجموع الدائن (${formatCurrency(totalCredit, false)})`
    );
  }
  return ok({ totalDebit, totalCredit });
}

// ============================================================
// دوال مساعدة
// ============================================================

async function _updateLocalBalances(entries) {
  if (typeof db === 'undefined') return;
  for (const entry of entries) {
    const current = await getLocalAccountBalance(entry.account_id);
    const debit   = parseFloat(entry.debit  || 0);
    const credit  = parseFloat(entry.credit || 0);
    const newBal  = current + debit - credit;
    await setLocalAccountBalance(entry.account_id, newBal);
  }
}

async function getDailyDepositsTotal(bankAccountId, date) {
  try {
    if (!isOfflineMode() && isOnline()) {
      const { data, error } = await supabaseClient
        .from(TABLES.TRANSACTIONS)
        .select('amount')
        .eq('bank_account_id', bankAccountId)
        .eq('type', TRANSACTION_TYPES.DEPOSIT)
        .eq('date', date)
        .eq('is_reversed', false);

      if (!error && data) {
        return data.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);
      }
    }

    if (typeof db === 'undefined' || !db.isOpen()) return 0;
    const local = await db.transactions
      .where('[date+type]')
      .equals([date, TRANSACTION_TYPES.DEPOSIT])
      .filter(tx => tx.bank_account_id === bankAccountId && !tx.is_reversed)
      .toArray();

    return local.reduce((sum, tx) => sum + parseFloat(tx.amount || 0), 0);

  } catch {
    return 0;
  }
}

async function getAgentDailySummary(agentId, date) {
  try {
    let transactions = [];

    if (!isOfflineMode() && isOnline()) {
      const { data } = await supabaseClient
        .from(TABLES.TRANSACTIONS)
        .select('type, amount')
        .eq('agent_id', agentId)
        .eq('date', date)
        .eq('is_reversed', false);
      transactions = data || [];
    } else if (typeof db !== 'undefined' && db.isOpen()) {
      transactions = await db.transactions
        .where('[date+agent_id]')
        .equals([date, agentId])
        .filter(tx => !tx.is_reversed)
        .toArray();
    }

    const summary = { collection: 0, deposit: 0, bank_withdrawal: 0, expense: 0, receipt: 0, delivery: 0 };
    for (const tx of transactions) {
      if (Object.prototype.hasOwnProperty.call(summary, tx.type)) {
        summary[tx.type] += parseFloat(tx.amount || 0);
      }
    }
    summary.net = summary.collection + summary.receipt + summary.bank_withdrawal
                - summary.deposit - summary.expense - summary.delivery;

    return ok(summary);

  } catch (e) {
    return err(`فشل جلب ملخص المندوب: ${e.message}`);
  }
}

// ============================================================
// صافي حركة عهدة المندوب ليوم محدّد — من دفتر الأستاذ مباشرة
// (المصدر الوحيد الصحيح: يشمل التحويلات الواردة، ومطابق لـ account_balances)
// net = Σ(مدين) − Σ(دائن) لحساب AGT_<id> في ذلك اليوم
// ============================================================
async function getAgentDailyLedgerNet(agentId, date) {
  try {
    const accId = AccountId.agent(agentId);
    let entries = [];

    if (!isOfflineMode() && isOnline()) {
      const { data, error } = await supabaseClient
        .from(TABLES.ACCOUNT_LEDGER)
        .select('debit, credit')
        .eq('account_id', accId)
        .eq('date', date);
      if (!error && data) entries = data;
    } else if (typeof db !== 'undefined' && db.isOpen()) {
      entries = await db.account_ledger
        .where('account_id').equals(accId)
        .filter(e => e.date === date)
        .toArray();
    }

    let net = 0;
    for (const e of entries) net += (parseFloat(e.debit) || 0) - (parseFloat(e.credit) || 0);
    return ok(Math.round(net));
  } catch (e) {
    return err(`فشل حساب صافي العهدة: ${e.message}`);
  }
}

// ============================================================
// الموافقة على المعاملات المعلقة
// ============================================================

async function approveTransaction(transactionId) {
  try {
    if (isOfflineMode() || !isOnline()) return err('يجب الاتصال بالإنترنت للموافقة على المعاملات');

    const result = await callRPC(RPC.APPROVE_TRANSACTION, { p_transaction_id: transactionId });
    if (!isOk(result)) return result;

    if (typeof db !== 'undefined' && db.isOpen()) {
      await db.transactions.update(transactionId, { approval_status: APPROVAL_STATUS.APPROVED });
    }

    window.dispatchEvent(new CustomEvent('accounting:transactionApproved', { detail: { transactionId } }));
    return result;
  } catch (e) {
    return err(`فشل الموافقة: ${e.message}`);
  }
}

async function rejectTransaction(transactionId, reason = '') {
  try {
    if (isOfflineMode() || !isOnline()) return err('يجب الاتصال بالإنترنت لرفض المعاملات');

    const result = await callRPC(RPC.REJECT_TRANSACTION, {
      p_transaction_id : transactionId,
      p_reason         : reason,
    });
    if (!isOk(result)) return result;

    if (typeof db !== 'undefined' && db.isOpen()) {
      await db.transactions.update(transactionId, { approval_status: APPROVAL_STATUS.REJECTED });
    }

    window.dispatchEvent(new CustomEvent('accounting:transactionRejected', { detail: { transactionId, reason } }));
    return result;
  } catch (e) {
    return err(`فشل الرفض: ${e.message}`);
  }
}

async function getPendingApprovals() {
  try {
    if (isOfflineMode() || !isOnline()) return ok([]);
    const result = await callRPC(RPC.GET_PENDING_APPROVALS, {});
    if (!isOk(result)) return ok([]);
    return ok(Array.isArray(result.data) ? result.data : []);
  } catch {
    return ok([]);
  }
}

// ============================================================
// إنشاء معاملة مالية من طلب تحويل (بعد قبوله)
// ============================================================
async function createTransferFromRequest(requestId) {
  try {
    if (isOfflineMode() || !isOnline()) {
      return err('يجب الاتصال بالإنترنت لقبول طلب التحويل');
    }

    const requestResult = await repo.getById(TABLES.TRANSFER_REQUESTS, requestId);
    if (!isOk(requestResult) || !requestResult.data) {
      return err('طلب التحويل غير موجود');
    }
    const request = requestResult.data;

    if (request.status !== 'pending') {
      return err(`لا يمكن قبول طلب بحالة ${request.status}`);
    }

    const currentUserId = AuthService.getCurrentUserId();
    const isReceiver = (request.to_user_id === currentUserId);
    const isAdmin = AuthService.isAdmin() || AuthService.isAdminAssistant();

    if (!isReceiver && !isAdmin) {
      return err('ليس لديك صلاحية لقبول هذا الطلب');
    }

    const date = getCurrentSaudiDate();

    // B = الدافع (to_user_id = currentUserId) يدفع → A = الطالب (from_user_id) يستلم
    const senderName   = AuthService.getCurrentUser()?.display_name || 'المدفوع';
    const receiverUser = (typeof AppStore !== 'undefined')
      ? AppStore.getState('users')?.find(u => u.id === request.from_user_id)
      : null;
    const receiverName = receiverUser?.display_name || 'الطالب';

    const txData = {
      type           : TRANSACTION_TYPES.DELIVERY,   // B يدفع → A يستلم (مباشر)
      amount         : parseFloat(request.amount),
      date           : date,
      agent_id       : currentUserId,                // B = الدافع (ينقص رصيده)
      to_agent_id    : request.from_user_id,         // A = المستلم (يزيد رصيده)
      from_agent_id  : currentUserId,
      details        : request.reason || `قبول طلب أموال`,
      _sender_name   : senderName,
      _receiver_name : receiverName,
      approval_status: APPROVAL_STATUS.APPROVED,
    };

    const result = await createTransactionWithEntries(txData);
    if (!isOk(result)) {
      return err(`فشل إنشاء المعاملة: ${result.error}`);
    }

    const updateResult = await repo.update(TABLES.TRANSFER_REQUESTS, requestId, {
      status: 'approved',
      updated_at: new Date().toISOString(),
    });
    if (!isOk(updateResult)) {
      console.warn('⚠️ تم إنشاء المعاملة ولكن فشل تحديث حالة الطلب:', updateResult.error);
    }

    const senderId = request.from_user_id;
    if (senderId && senderId !== currentUserId) {
      const notifData = {
        title: 'تم قبول طلب التحويل',
        body: `${AuthService.getCurrentUser()?.display_name || 'المستخدم'} قبل طلب تحويل مبلغ ${formatCurrency(request.amount)} إليك.`,
        type: 'success',
        target: JSON.stringify([senderId]),
        sender_id: currentUserId,
        read_by: '[]',
        hidden_by: '[]',
      };
      await repo.create(TABLES.NOTIFICATIONS, notifData).catch(e => console.warn('فشل إرسال الإشعار:', e));
    }

    return ok({ transaction: result.data.transaction, request });
  } catch (e) {
    console.error('❌ AccountingService.createTransferFromRequest():', e);
    return err(`خطأ: ${e.message}`);
  }
}

// ============================================================
// تصدير
// ============================================================

const AccountingService = {
  buildEntries,
  createTransactionWithEntries,
  getAccountBalance,
  getStatement,
  dailyClose,
  performPeriodClose,
  exportPeriodData,
  getPeriodClosings,
  getDatabaseUsage,
  reverseEntries,
  deleteTransactionCompletely,
  cleanupLocalTransaction,
  validateLedger,
  getDailyDepositsTotal,
  getAgentDailySummary,
  getAgentDailyLedgerNet,
  approveTransaction,
  rejectTransaction,
  getPendingApprovals,
  createTransferFromRequest,
  AccountId,
  GENERAL_ACCOUNT_ID,
  DEBTOR_SETTLEMENT_ID,
  EXPENSE_ACCOUNT_ID,
};

window.AccountingService = AccountingService;
console.log('✅ AccountingService.js v4.0 — القيود مطابقة للمرجع (إيداع: COMP←AGT، سحب: AGT←COMP، مديون: AGT←DEBTOR_SETTLEMENT، مصروف: EXP_GENERAL←AGT)');
