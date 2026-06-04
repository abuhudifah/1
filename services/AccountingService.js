
/**
 * services/AccountingService.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * خدمة نظام القيد المزدوج المحاسبي
 *
 * المبادئ:
 * - كل عملية → قيدين على الأقل (مدين = دائن)
 * - الذرية: القيود والمعاملة تُحفظ دفعة واحدة (batch)
 * - الأرصدة التراكمية: account_balances يُحدَّث فوراً
 * - الترقيم: V{سنة}{رقم تسلسلي} مثل V20250001
 *
 * بادئات الحسابات:
 * - AGT_{uuid}  : حساب المندوب
 * - COMP_{uuid} : حساب الشركة
 * - BNK_{uuid}  : الحساب البنكي
 * - CUST_{uuid} : حساب العميل المدين
 * - EXP_{code}  : حساب المصروف الفرعي
 */

'use strict';

// ============================================================
// مولّد أرقام القيود (Voucher Numbers)
// ============================================================

/** عداد محلي للقيود (يُعاد تعيينه يومياً) */
let _voucherCounter = null;
let _voucherDate    = null;

/**
 * يُولّد رقم قيد فريداً بصيغة V{YYYYMMDD}{4أرقام}
 * @returns {string} مثل V202506030001
 */
function _generateVoucherNumber() {
  const today = getCurrentSaudiDate().replace(/-/g, '');
  if (_voucherDate !== today) {
    _voucherDate    = today;
    _voucherCounter = 1;
  } else {
    _voucherCounter = (_voucherCounter || 0) + 1;
  }
  return `V${today}${String(_voucherCounter).padStart(4, '0')}`;
}

// ============================================================
// بناء معرفات الحسابات المحاسبية
// ============================================================

const AccountId = {
  agent    : (id) => `${ACCOUNT_PREFIXES.AGENT}${id}`,
  company  : (id) => `${ACCOUNT_PREFIXES.COMPANY}${id}`,
  bank     : (id) => `${ACCOUNT_PREFIXES.BANK}${id}`,
  customer : (id) => `${ACCOUNT_PREFIXES.CUSTOMER}${id}`,
  expense  : (code) => `${ACCOUNT_PREFIXES.EXPENSE}${code}`,
};

// ============================================================
// بناء القيود (buildEntries) لكل نوع عملية
// ============================================================

/**
 * يبني مصفوفة القيود المحاسبية لعملية تحصيل
 * نقدي أو سحب بطاقة من عميل
 *
 * حالة 1 — تحصيل لصالح الشركة (customer_id → company_id):
 *   القيد 1: AGT مدين, COMP دائن (المندوب استلم → الشركة مستحقة)
 *
 * حالة 2 — تحصيل من عميل مديون (customer_id → debt reduction):
 *   القيد 1: CUST مدين (ينقص الدين), AGT دائن (يزيد رصيد المندوب)
 *   [ملاحظة: AGT مدين يعني عهدة عليه، CUST دائن يعني الشركة مستحقة الدين]
 *   الحل الأبسط: قيد واحد CUST مدين + AGT دائن
 *
 * @param {object} tx - بيانات المعاملة
 * @returns {Array<object>} قيود
 */
function _buildCollectionEntries(tx) {
  const voucher = _generateVoucherNumber();
  const date    = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const entries  = [];

  if (tx.company_id) {
    // تحصيل لصالح شركة
    const compAcc = AccountId.company(tx.company_id);
    entries.push(
      { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
        description: `تحصيل من عميل${tx.customer_name ? ': ' + tx.customer_name : ''} — لصالح الشركة` },
      { voucher_number: voucher, date, account_id: compAcc,  debit: 0, credit: tx.amount,
        description: `تحصيل من عميل لصالح الشركة` }
    );
  } else if (tx.customer_id) {
    // تحصيل من عميل مديون — تخفيض دينه
    const custAcc = AccountId.customer(tx.customer_id);
    entries.push(
      { voucher_number: voucher, date, account_id: custAcc,  debit: tx.amount, credit: 0,
        description: `تخفيض دين العميل: ${tx.customer_name || tx.customer_id}` },
      { voucher_number: voucher, date, account_id: agentAcc, debit: 0, credit: tx.amount,
        description: `استلام من عميل مديون` }
    );
  } else {
    // تحصيل عام (بدون شركة أو عميل مديون)
    entries.push(
      { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
        description: `تحصيل نقدي${tx.customer_name ? ' من: ' + tx.customer_name : ''}` },
      { voucher_number: voucher, date, account_id: `CASH_GENERAL`, debit: 0, credit: tx.amount,
        description: `مقابل التحصيل` }
    );
  }

  return entries;
}

/**
 * يبني قيود عملية إيداع بنكي (3 قيود)
 *
 * القيد 1 (تحصيل سابق): AGT مدين, COMP دائن — يُفترض أنه حدث مسبقاً
 * القيد 2 (الإيداع في البنك): BNK مدين, COMP دائن
 * القيد 3 (تسوية دين المندوب): COMP مدين, AGT دائن
 *
 * النتيجة النهائية: AGT صفر, COMP صفر, BNK +المبلغ
 *
 * @param {object} tx
 * @returns {Array<object>}
 */
function _buildDepositEntries(tx) {
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const bankAcc  = AccountId.bank(tx.bank_account_id);
  const compAcc  = tx.company_id ? AccountId.company(tx.company_id) : 'COMP_GENERAL';

  const voucher2 = _generateVoucherNumber();
  const voucher3 = _generateVoucherNumber();

  return [
    // القيد 2: الإيداع الفعلي في البنك
    { voucher_number: voucher2, date, account_id: bankAcc,  debit: tx.amount, credit: 0,
      description: `إيداع بنكي` },
    { voucher_number: voucher2, date, account_id: compAcc,  debit: 0, credit: tx.amount,
      description: `إيداع بنكي — خصم من رصيد الشركة` },

    // القيد 3: تسوية دين المندوب
    { voucher_number: voucher3, date, account_id: compAcc,  debit: tx.amount, credit: 0,
      description: `تسوية دين المندوب — برأت ذمة الشركة` },
    { voucher_number: voucher3, date, account_id: agentAcc, debit: 0, credit: tx.amount,
      description: `تسوية عهدة المندوب — برأت ذمته` },
  ];
}

/**
 * يبني قيود عملية مصروف
 *
 * القيد: EXP مدين, AGT دائن
 * (المصروف يزيد، رصيد المندوب يقل)
 *
 * @param {object} tx
 * @returns {Array<object>}
 */
function _buildExpenseEntries(tx) {
  const voucher  = _generateVoucherNumber();
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const expCode  = tx.expense_type || 'MISC';
  const expAcc   = AccountId.expense(expCode);

  return [
    { voucher_number: voucher, date, account_id: expAcc,    debit: tx.amount, credit: 0,
      description: `مصروف ${tx.expense_type || 'عام'}${tx.details ? ': ' + tx.details : ''}` },
    { voucher_number: voucher, date, account_id: agentAcc,  debit: 0, credit: tx.amount,
      description: `صرف من حساب المندوب` },
  ];
}

/**
 * يبني قيود عملية استلام (مندوب يستلم من مندوب آخر أو من الشركة)
 *
 * القيد: AGT_المستلم مدين, AGT_المصدر دائن
 *
 * @param {object} tx
 * @returns {Array<object>}
 */
function _buildReceiptEntries(tx) {
  const voucher     = _generateVoucherNumber();
  const date        = tx.date || getCurrentSaudiDate();
  const receiverAcc = AccountId.agent(tx.agent_id);          // المستلم (agent_id)
  const senderAcc   = tx.from_agent_id
    ? AccountId.agent(tx.from_agent_id)
    : (tx.company_id ? AccountId.company(tx.company_id) : 'GENERAL_FUND');

  return [
    { voucher_number: voucher, date, account_id: receiverAcc, debit: tx.amount, credit: 0,
      description: `استلام من ${tx.from_agent_id ? 'مندوب' : 'الشركة'}` },
    { voucher_number: voucher, date, account_id: senderAcc,   debit: 0, credit: tx.amount,
      description: `تسليم إلى المندوب` },
  ];
}

/**
 * يبني قيود عملية تسليم (مندوب يسلّم لمندوب آخر)
 *
 * القيد: AGT_المستلم مدين, AGT_المسلّم دائن
 *
 * @param {object} tx
 * @returns {Array<object>}
 */
function _buildDeliveryEntries(tx) {
  const voucher     = _generateVoucherNumber();
  const date        = tx.date || getCurrentSaudiDate();
  const giverAcc    = AccountId.agent(tx.agent_id);          // المسلّم
  const receiverAcc = tx.to_agent_id
    ? AccountId.agent(tx.to_agent_id)
    : (tx.company_id ? AccountId.company(tx.company_id) : 'GENERAL_FUND');

  return [
    { voucher_number: voucher, date, account_id: receiverAcc, debit: tx.amount, credit: 0,
      description: `استلام من مندوب` },
    { voucher_number: voucher, date, account_id: giverAcc,    debit: 0, credit: tx.amount,
      description: `تسليم إلى مندوب آخر` },
  ];
}

/**
 * يبني قيود عملية تسوية استرداد (Refund Settlement)
 * @param {object} tx
 * @returns {Array<object>}
 */
function _buildRefundSettlementEntries(tx) {
  const voucher  = _generateVoucherNumber();
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const compAcc  = tx.company_id ? AccountId.company(tx.company_id) : 'COMP_GENERAL';

  return [
    { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
      description: `استرداد مبلغ — تسوية` },
    { voucher_number: voucher, date, account_id: compAcc,  debit: 0, credit: tx.amount,
      description: `استرداد مبلغ للشركة` },
  ];
}

// ============================================================
// الدالة الرئيسية: buildEntries
// ============================================================

/**
 * يبني القيود المحاسبية لأي نوع عملية
 * @param {object} tx - بيانات المعاملة
 * @returns {{ok: boolean, data?: Array, error?: string}}
 */
function buildEntries(tx) {
  try {
    if (!tx.type)     return err('نوع العملية مطلوب');
    if (!tx.amount)   return err('المبلغ مطلوب');
    if (!tx.agent_id) return err('معرف المندوب مطلوب');

    let entries;

    switch (tx.type) {
      case TRANSACTION_TYPES.COLLECTION:
        entries = _buildCollectionEntries(tx);
        break;
      case TRANSACTION_TYPES.DEPOSIT:
        if (!tx.bank_account_id) return err('الحساب البنكي مطلوب للإيداع');
        entries = _buildDepositEntries(tx);
        break;
      case TRANSACTION_TYPES.EXPENSE:
        entries = _buildExpenseEntries(tx);
        break;
      case TRANSACTION_TYPES.RECEIPT:
        entries = _buildReceiptEntries(tx);
        break;
      case TRANSACTION_TYPES.DELIVERY:
        entries = _buildDeliveryEntries(tx);
        break;
      case TRANSACTION_TYPES.REFUND_SETTLEMENT:
        entries = _buildRefundSettlementEntries(tx);
        break;
      default:
        return err(`نوع عملية غير معروف: ${tx.type}`);
    }

    // التحقق من توازن القيود قبل الإرجاع
    const validation = validateLedger(entries);
    if (!isOk(validation)) return validation;

    return ok(entries);

  } catch (e) {
    return err(`خطأ في بناء القيود: ${e.message}`);
  }
}

// ============================================================
// إنشاء معاملة مالية مع قيودها (ذري)
// ============================================================

/**
 * يُنشئ معاملة مالية مع قيودها المحاسبية دفعة واحدة
 * يُطبّق مبدأ الذرية: الكل ينجح أو الكل يفشل
 *
 * @param {object} txData - بيانات المعاملة (بدون id وcreated_at)
 * @returns {Promise<{ok: boolean, data?: {transaction, entries}, error?: string}>}
 */
async function createTransactionWithEntries(txData) {
  try {
    // التحقق من المدخلات الأساسية
    if (!isValidAmount(txData.amount)) {
      return err('المبلغ يجب أن يكون رقماً موجباً');
    }
    if (!isValidDate(txData.date || getCurrentSaudiDate())) {
      return err('التاريخ غير صالح');
    }

    // تجهيز بيانات المعاملة
    const transaction = {
      ...txData,
      id          : txData.id || (isOnline() ? generateUUID() : generateTempId()),
      date        : txData.date || getCurrentSaudiDate(),
      time        : txData.time || getCurrentSaudiTime(),
      created_at  : new Date().toISOString(),
      updated_at  : new Date().toISOString(),
      sync_status : isOnline() ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    };

    // بناء القيود
    const entriesResult = buildEntries(transaction);
    if (!isOk(entriesResult)) return entriesResult;
    const entries = entriesResult.data;

    // إضافة بيانات القيود
    const enrichedEntries = entries.map(e => ({
      ...e,
      id         : generateUUID(),
      created_at : new Date().toISOString(),
    }));

    // إذا كان متصلاً — استخدم RPC الذري على Supabase
    if (isOnline()) {
      const rpcResult = await callRPC(RPC.CREATE_TRANSACTION_WITH_ENTRIES, {
        p_transaction : transaction,
        p_entries     : enrichedEntries,
      });

      if (isOk(rpcResult)) {
        const realTxId = rpcResult.data?.transaction_id;

        // حفظ في Dexie بالمعرف الحقيقي
        await db.transactions.put({
          ...transaction,
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

        // تحديث أرصدة account_balances محلياً
        await _updateLocalBalances(enrichedEntries);

        // إذا كانت عملية تحصيل من عميل مديون — تحديث رصيده
        if (txData.type === TRANSACTION_TYPES.COLLECTION && txData.customer_id) {
          await callRPC(RPC.UPDATE_DEBTOR_BALANCE, {
            p_debtor_id        : txData.customer_id,
            p_collected_amount : txData.amount,
          });
        }

        // إعلام AppStore
        window.dispatchEvent(new CustomEvent('accounting:transactionCreated', {
          detail: { transaction: { ...transaction, id: realTxId }, entries: enrichedEntries },
        }));

        return ok({
          transaction : { ...transaction, id: realTxId || transaction.id },
          entries     : enrichedEntries,
        });
      }

      // RPC فشل — fallback لطابور المزامنة
      console.warn('⚠️  RPC فشل، الحفظ في الطابور:', rpcResult.error);
    }

    // وضع عدم الاتصال أو فشل RPC:
    // حفظ المعاملة محلياً مع معرف مؤقت
    const pendingTransaction = {
      ...transaction,
      sync_status: SYNC_STATUS.PENDING,
    };

    await db.transactions.put(pendingTransaction);

    for (const entry of enrichedEntries) {
      await db.account_ledger.put({
        ...entry,
        reference_id: transaction.id,
        sync_status : SYNC_STATUS.PENDING,
      });
    }

    // تحديث الأرصدة محلياً فوراً
    await _updateLocalBalances(enrichedEntries);

    // إضافة للطابور كدفعة ذرية واحدة
    await SyncQueue.add(SYNC_ACTIONS.BATCH, 'batch', transaction.id, {
      operations: [
        { action: SYNC_ACTIONS.CREATE, table: TABLES.TRANSACTIONS,    data: transaction },
        ...enrichedEntries.map(e => ({
          action: SYNC_ACTIONS.CREATE,
          table : TABLES.ACCOUNT_LEDGER,
          data  : { ...e, reference_id: transaction.id },
        })),
      ],
    });

    // إعلام AppStore
    window.dispatchEvent(new CustomEvent('accounting:transactionCreated', {
      detail: { transaction: pendingTransaction, entries: enrichedEntries, pending: true },
    }));

    return ok({ transaction: pendingTransaction, entries: enrichedEntries, pending: true });

  } catch (e) {
    console.error('❌ AccountingService.createTransactionWithEntries():', e);
    return err(`فشل إنشاء المعاملة: ${e.message}`);
  }
}

// ============================================================
// جلب رصيد حساب محاسبي
// ============================================================

/**
 * يجلب الرصيد الحالي لحساب محاسبي
 * @param {string} accountId - مثل AGT_uuid
 * @returns {Promise<{ok: boolean, data?: number, error?: string}>}
 */
async function getAccountBalance(accountId) {
  try {
    // من Dexie أولاً (أسرع)
    const localBalance = await getLocalAccountBalance(accountId);
    if (localBalance !== 0) return ok(localBalance);

    // من Supabase
    if (isOnline()) {
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

    return ok(0);
  } catch (e) {
    return err(`فشل جلب الرصيد: ${e.message}`);
  }
}

// ============================================================
// كشف حساب
// ============================================================

/**
 * يجلب كشف حساب لحساب محاسبي في فترة زمنية
 * @param {string} accountId - مثل AGT_uuid أو BNK_uuid
 * @param {string} fromDate - YYYY-MM-DD
 * @param {string} toDate - YYYY-MM-DD
 * @param {object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.pageSize=20]
 * @returns {Promise<{ok: boolean, data?: {entries, openingBalance, closingBalance, totalDebit, totalCredit}}}>}
 */
async function getStatement(accountId, fromDate, toDate, options = {}) {
  try {
    const { page = 1, pageSize = PAGINATION_CONFIG.DEFAULT_PAGE_SIZE } = options;

    // جلب القيود في الفترة من Supabase
    const result = await repo.query(
      TABLES.ACCOUNT_LEDGER,
      {
        account_id : accountId,
        date       : { op: 'between', val: [fromDate, toDate] },
      },
      {
        orderBy  : 'date',
        ascending: true,
        page,
        pageSize,
      }
    );

    if (!isOk(result)) return result;

    const entries = result.data.data || [];
    let totalDebit  = 0;
    let totalCredit = 0;

    for (const entry of entries) {
      totalDebit  += parseFloat(entry.debit  || 0);
      totalCredit += parseFloat(entry.credit || 0);
    }

    // الرصيد الافتتاحي: مجموع كل القيود قبل fromDate
    let openingBalance = 0;
    if (isOnline()) {
      const { data: priorEntries } = await supabaseClient
        .from(TABLES.ACCOUNT_LEDGER)
        .select('debit, credit')
        .eq('account_id', accountId)
        .lt('date', fromDate);

      if (priorEntries) {
        for (const e of priorEntries) {
          openingBalance += parseFloat(e.debit  || 0) - parseFloat(e.credit || 0);
        }
      }
    }

    const closingBalance = openingBalance + totalDebit - totalCredit;

    return ok({
      entries,
      count          : result.data.count || entries.length,
      openingBalance,
      closingBalance,
      totalDebit,
      totalCredit,
    });

  } catch (e) {
    return err(`فشل جلب كشف الحساب: ${e.message}`);
  }
}

// ============================================================
// الإقفال اليومي
// ============================================================

/**
 * يُنفّذ الإقفال اليومي
 * @param {string} [date] - تاريخ الإقفال (افتراضي: الأمس)
 * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
 */
async function dailyClose(date = null) {
  try {
    const closeDate = date || getYesterdaySaudiDate();

    if (!AuthService.isAdmin()) {
      return err('الإقفال اليومي مسموح للمدير فقط');
    }

    if (!isOnline()) {
      return err('يجب الاتصال بالإنترنت لتنفيذ الإقفال اليومي');
    }

    const result = await callRPC(RPC.PERFORM_DAILY_CLOSE, { p_date: closeDate });

    if (!isOk(result)) return result;

    // تحديث إعداد آخر إقفال محلياً
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
// عكس معاملة (Reversal)
// ============================================================

/**
 * يعكس معاملة مالية بإنشاء قيود معاكسة
 * @param {string} transactionId
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
async function reverseEntries(transactionId) {
  try {
    if (!AuthService.isAdmin()) {
      return err('عكس المعاملات مسموح للمدير فقط');
    }

    // جلب المعاملة الأصلية
    const txResult = await repo.getById(TABLES.TRANSACTIONS, transactionId);
    if (!isOk(txResult) || !txResult.data) {
      return err('المعاملة غير موجودة');
    }

    const tx = txResult.data;
    if (tx.is_reversed) return err('هذه المعاملة تم عكسها مسبقاً');

    if (isOnline()) {
      const result = await callRPC(RPC.REVERSE_TRANSACTION, {
        p_transaction_id: transactionId,
      });

      if (!isOk(result)) return result;

      // تحديث Dexie
      await db.transactions.update(transactionId, { is_reversed: true });

      // جلب القيود العكسية وتخزينها محلياً
      const { data: reversalEntries } = await supabaseClient
        .from(TABLES.ACCOUNT_LEDGER)
        .select('*')
        .like('voucher_number', `REV_${transactionId}%`);

      if (reversalEntries && reversalEntries.length > 0) {
        await db.account_ledger.bulkPut(
          reversalEntries.map(e => ({ ...e, sync_status: SYNC_STATUS.SYNCED }))
        );
        await _updateLocalBalances(reversalEntries);
      }

      // تسجيل في سجل التدقيق محلياً
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

      showToast('تم عكس المعاملة بنجاح', 'success');

      window.dispatchEvent(new CustomEvent('accounting:transactionReversed', {
        detail: { transactionId },
      }));

      return result;
    }

    return err('يجب الاتصال بالإنترنت لعكس المعاملات');

  } catch (e) {
    return err(`فشل عكس المعاملة: ${e.message}`);
  }
}

// ============================================================
// التحقق من توازن القيود
// ============================================================

/**
 * يتحقق من أن مجموع المدين = مجموع الدائن
 * @param {Array<{debit: number, credit: number}>} entries
 * @returns {{ok: boolean, error?: string}}
 */
function validateLedger(entries) {
  if (!entries || entries.length === 0) {
    return err('لا توجد قيود للتحقق منها');
  }

  let totalDebit  = 0;
  let totalCredit = 0;

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
// دوال مساعدة داخلية
// ============================================================

/**
 * يُحدّث الأرصدة التراكمية محلياً في Dexie
 * debit يزيد الرصيد (+)، credit ينقصه (-)
 * @param {Array} entries
 * @returns {Promise<void>}
 */
async function _updateLocalBalances(entries) {
  for (const entry of entries) {
    const current = await getLocalAccountBalance(entry.account_id);
    const debit   = parseFloat(entry.debit  || 0);
    const credit  = parseFloat(entry.credit || 0);
    const newBal  = current + debit - credit;
    await setLocalAccountBalance(entry.account_id, newBal);
  }
}

/**
 * يجلب إجمالي إيداعات اليوم لحساب بنكي محدد
 * @param {string} bankAccountId
 * @param {string} date - YYYY-MM-DD
 * @returns {Promise<number>}
 */
async function getDailyDepositsTotal(bankAccountId, date) {
  try {
    if (isOnline()) {
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

    // من Dexie محلياً
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

/**
 * يجلب إجمالي عمليات المندوب لتاريخ محدد مصنفةً حسب النوع
 * @param {string} agentId
 * @param {string} date
 * @returns {Promise<{collection, deposit, expense, receipt, delivery, net}>}
 */
async function getAgentDailySummary(agentId, date) {
  try {
    let transactions = [];

    if (isOnline()) {
      const { data } = await supabaseClient
        .from(TABLES.TRANSACTIONS)
        .select('type, amount')
        .eq('agent_id', agentId)
        .eq('date', date)
        .eq('is_reversed', false);
      transactions = data || [];
    } else {
      transactions = await db.transactions
        .where('[date+agent_id]')
        .equals([date, agentId])
        .filter(tx => !tx.is_reversed)
        .toArray();
    }

    const summary = {
      collection : 0,
      deposit    : 0,
      expense    : 0,
      receipt    : 0,
      delivery   : 0,
    };

    for (const tx of transactions) {
      if (summary.hasOwnProperty(tx.type)) {
        summary[tx.type] += parseFloat(tx.amount || 0);
      }
    }

    summary.net = summary.collection + summary.receipt - summary.deposit - summary.expense - summary.delivery;

    return ok(summary);

  } catch (e) {
    return err(`فشل جلب ملخص المندوب: ${e.message}`);
  }
}

// ============================================================
// تصدير الخدمة
// ============================================================

const AccountingService = {
  buildEntries,
  createTransactionWithEntries,
  getAccountBalance,
  getStatement,
  dailyClose,
  reverseEntries,
  validateLedger,
  getDailyDepositsTotal,
  getAgentDailySummary,
  AccountId,
};

window.AccountingService = AccountingService;

console.log('✅ AccountingService.js محمّل — خدمة القيد المزدوج جاهزة');
