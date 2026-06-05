/**
 * services/AccountingService.js — v1.1 (FIXED)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * الإصلاحات:
 * ✅ FIX-5a: استبدال 'CASH_GENERAL' المجهول بـ 'GENERAL_FUND' الموجود فعلاً
 *    في DEFAULT_CHART الخاص بـ AccountManagementComponent.
 *    CASH_GENERAL لا يُنشأ تلقائياً في account_balances، مما كان يُفشل
 *    القيود المحاسبية عند التحصيل العام بدون شركة أو عميل مديون.
 *
 *    قبل الإصلاح:
 *      { account_id: 'CASH_GENERAL', ... } ← قد لا يوجد في الجدول
 *    بعد الإصلاح:
 *      { account_id: 'GENERAL_FUND', ... } ← موجود في DEFAULT_CHART
 */

'use strict';

// ============================================================
// الحساب العام المُستخدَم كطرف ثانٍ في القيود العامة
// FIX-5a: توحيد اسم الحساب العام — كان 'CASH_GENERAL' الذي لا يُنشأ تلقائياً
// ============================================================
const GENERAL_ACCOUNT_ID = 'GENERAL_FUND';

// ============================================================
// مولّد أرقام القيود
// ============================================================

let _voucherCounter = null;
let _voucherDate    = null;

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
  agent    : (id)   => `${ACCOUNT_PREFIXES.AGENT}${id}`,
  company  : (id)   => `${ACCOUNT_PREFIXES.COMPANY}${id}`,
  bank     : (id)   => `${ACCOUNT_PREFIXES.BANK}${id}`,
  customer : (id)   => `${ACCOUNT_PREFIXES.CUSTOMER}${id}`,
  expense  : (code) => `${ACCOUNT_PREFIXES.EXPENSE}${code}`,
};

// ============================================================
// بناء القيود لكل نوع عملية
// ============================================================

function _buildCollectionEntries(tx) {
  const voucher  = _generateVoucherNumber();
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const entries  = [];

  if (tx.company_id) {
    const compAcc = AccountId.company(tx.company_id);
    entries.push(
      { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
        description: `تحصيل من عميل${tx.customer_name ? ': ' + tx.customer_name : ''} — لصالح الشركة` },
      { voucher_number: voucher, date, account_id: compAcc,  debit: 0, credit: tx.amount,
        description: 'تحصيل من عميل لصالح الشركة' }
    );
  } else if (tx.customer_id) {
    const custAcc = AccountId.customer(tx.customer_id);
    entries.push(
      { voucher_number: voucher, date, account_id: custAcc,  debit: tx.amount, credit: 0,
        description: `تخفيض دين العميل: ${tx.customer_name || tx.customer_id}` },
      { voucher_number: voucher, date, account_id: agentAcc, debit: 0, credit: tx.amount,
        description: 'استلام من عميل مديون' }
    );
  } else {
    // FIX-5a: كان account_id: 'CASH_GENERAL' ← غير موجود في account_balances
    //         الآن: GENERAL_FUND الموجود في DEFAULT_CHART
    entries.push(
      { voucher_number: voucher, date, account_id: agentAcc,         debit: tx.amount, credit: 0,
        description: `تحصيل نقدي${tx.customer_name ? ' من: ' + tx.customer_name : ''}` },
      { voucher_number: voucher, date, account_id: GENERAL_ACCOUNT_ID, debit: 0, credit: tx.amount,
        description: 'مقابل التحصيل النقدي العام' }
    );
  }

  return entries;
}

function _buildDepositEntries(tx) {
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const bankAcc  = AccountId.bank(tx.bank_account_id);
  // FIX-5a: كان 'COMP_GENERAL' — استبدلناه بـ GENERAL_ACCOUNT_ID عند غياب company_id
  const compAcc  = tx.company_id ? AccountId.company(tx.company_id) : GENERAL_ACCOUNT_ID;

  const voucher2 = _generateVoucherNumber();
  const voucher3 = _generateVoucherNumber();

  return [
    { voucher_number: voucher2, date, account_id: bankAcc,  debit: tx.amount, credit: 0,
      description: 'إيداع بنكي' },
    { voucher_number: voucher2, date, account_id: compAcc,  debit: 0, credit: tx.amount,
      description: 'إيداع بنكي — خصم من رصيد الشركة' },
    { voucher_number: voucher3, date, account_id: compAcc,  debit: tx.amount, credit: 0,
      description: 'تسوية دين المندوب — برأت ذمة الشركة' },
    { voucher_number: voucher3, date, account_id: agentAcc, debit: 0, credit: tx.amount,
      description: 'تسوية عهدة المندوب — برأت ذمته' },
  ];
}

function _buildExpenseEntries(tx) {
  const voucher  = _generateVoucherNumber();
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  const expCode  = tx.expense_type || 'MISC';
  const expAcc   = AccountId.expense(expCode);

  return [
    { voucher_number: voucher, date, account_id: expAcc,   debit: tx.amount, credit: 0,
      description: `مصروف ${tx.expense_type || 'عام'}${tx.details ? ': ' + tx.details : ''}` },
    { voucher_number: voucher, date, account_id: agentAcc, debit: 0, credit: tx.amount,
      description: 'صرف من حساب المندوب' },
  ];
}

function _buildReceiptEntries(tx) {
  const voucher     = _generateVoucherNumber();
  const date        = tx.date || getCurrentSaudiDate();
  const receiverAcc = AccountId.agent(tx.agent_id);
  // FIX-5a: كان يستخدم 'GENERAL_FUND' مباشرة بدون ثابت — الآن موحَّد
  const senderAcc   = tx.from_agent_id
    ? AccountId.agent(tx.from_agent_id)
    : (tx.company_id ? AccountId.company(tx.company_id) : GENERAL_ACCOUNT_ID);

  return [
    { voucher_number: voucher, date, account_id: receiverAcc, debit: tx.amount, credit: 0,
      description: `استلام من ${tx.from_agent_id ? 'مندوب' : 'الشركة'}` },
    { voucher_number: voucher, date, account_id: senderAcc,   debit: 0, credit: tx.amount,
      description: 'تسليم إلى المندوب' },
  ];
}

function _buildDeliveryEntries(tx) {
  const voucher     = _generateVoucherNumber();
  const date        = tx.date || getCurrentSaudiDate();
  const giverAcc    = AccountId.agent(tx.agent_id);
  // FIX-5a: موحَّد باستخدام GENERAL_ACCOUNT_ID
  const receiverAcc = tx.to_agent_id
    ? AccountId.agent(tx.to_agent_id)
    : (tx.company_id ? AccountId.company(tx.company_id) : GENERAL_ACCOUNT_ID);

  return [
    { voucher_number: voucher, date, account_id: receiverAcc, debit: tx.amount, credit: 0,
      description: 'استلام من مندوب' },
    { voucher_number: voucher, date, account_id: giverAcc,    debit: 0, credit: tx.amount,
      description: 'تسليم إلى مندوب آخر' },
  ];
}

function _buildRefundSettlementEntries(tx) {
  const voucher  = _generateVoucherNumber();
  const date     = tx.date || getCurrentSaudiDate();
  const agentAcc = AccountId.agent(tx.agent_id);
  // FIX-5a: موحَّد باستخدام GENERAL_ACCOUNT_ID
  const compAcc  = tx.company_id ? AccountId.company(tx.company_id) : GENERAL_ACCOUNT_ID;

  return [
    { voucher_number: voucher, date, account_id: agentAcc, debit: tx.amount, credit: 0,
      description: 'استرداد مبلغ — تسوية' },
    { voucher_number: voucher, date, account_id: compAcc,  debit: 0, credit: tx.amount,
      description: 'استرداد مبلغ للشركة' },
  ];
}

// ============================================================
// الدالة الرئيسية: buildEntries
// ============================================================

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

    const validation = validateLedger(entries);
    if (!isOk(validation)) return validation;

    return ok(entries);

  } catch (e) {
    return err(`خطأ في بناء القيود: ${e.message}`);
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

    const transaction = {
      ...txData,
      id          : txData.id || (isOnline() ? generateUUID() : generateTempId()),
      date        : txData.date || getCurrentSaudiDate(),
      time        : txData.time || getCurrentSaudiTime(),
      created_at  : new Date().toISOString(),
      updated_at  : new Date().toISOString(),
      sync_status : isOnline() ? SYNC_STATUS.SYNCED : SYNC_STATUS.PENDING,
    };

    const entriesResult = buildEntries(transaction);
    if (!isOk(entriesResult)) return entriesResult;
    const entries = entriesResult.data;

    const enrichedEntries = entries.map(e => ({
      ...e,
      id         : generateUUID(),
      created_at : new Date().toISOString(),
    }));

    if (isOnline()) {
      const rpcResult = await callRPC(RPC.CREATE_TRANSACTION_WITH_ENTRIES, {
        p_transaction : transaction,
        p_entries     : enrichedEntries,
      });

      if (isOk(rpcResult)) {
        const realTxId = rpcResult.data?.transaction_id;

        // FIX-3: التحقق من وجود db
        if (typeof db !== 'undefined' && db.isOpen()) {
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
        });
      }

      console.warn('⚠️  RPC فشل، الحفظ في الطابور:', rpcResult.error);
    }

    // وضع عدم الاتصال أو فشل RPC
    const pendingTransaction = { ...transaction, sync_status: SYNC_STATUS.PENDING };

    // FIX-3: التحقق من وجود db
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

    await SyncQueue.add(SYNC_ACTIONS.BATCH, 'batch', transaction.id, {
      operations: [
        { action: SYNC_ACTIONS.CREATE, table: TABLES.TRANSACTIONS,   data: transaction },
        ...enrichedEntries.map(e => ({
          action: SYNC_ACTIONS.CREATE,
          table : TABLES.ACCOUNT_LEDGER,
          data  : { ...e, reference_id: transaction.id },
        })),
      ],
    });

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

async function getAccountBalance(accountId) {
  try {
    // FIX-3: التحقق من وجود db
    if (typeof db !== 'undefined' && db.isOpen()) {
      const localBalance = await getLocalAccountBalance(accountId);
      if (localBalance !== 0) return ok(localBalance);
    }

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

async function getStatement(accountId, fromDate, toDate, options = {}) {
  try {
    const { page = 1, pageSize = PAGINATION_CONFIG.DEFAULT_PAGE_SIZE } = options;

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
    let totalDebit = 0, totalCredit = 0;
    for (const entry of entries) {
      totalDebit  += parseFloat(entry.debit  || 0);
      totalCredit += parseFloat(entry.credit || 0);
    }

    let openingBalance = 0;
    if (isOnline()) {
      const { data: priorEntries } = await supabaseClient
        .from(TABLES.ACCOUNT_LEDGER)
        .select('debit, credit')
        .eq('account_id', accountId)
        .lt('date', fromDate);

      if (priorEntries) {
        for (const e of priorEntries) {
          openingBalance += parseFloat(e.debit || 0) - parseFloat(e.credit || 0);
        }
      }
    }

    const closingBalance = openingBalance + totalDebit - totalCredit;

    return ok({ entries, count: result.data.count || entries.length, openingBalance, closingBalance, totalDebit, totalCredit });

  } catch (e) {
    return err(`فشل جلب كشف الحساب: ${e.message}`);
  }
}

// ============================================================
// الإقفال اليومي
// ============================================================

async function dailyClose(date = null) {
  try {
    const closeDate = date || getYesterdaySaudiDate();
    if (!AuthService.isAdmin()) return err('الإقفال اليومي مسموح للمدير فقط');
    if (!isOnline()) return err('يجب الاتصال بالإنترنت لتنفيذ الإقفال اليومي');

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
// عكس معاملة
// ============================================================

async function reverseEntries(transactionId) {
  try {
    if (!AuthService.isAdmin()) return err('عكس المعاملات مسموح للمدير فقط');

    const txResult = await repo.getById(TABLES.TRANSACTIONS, transactionId);
    if (!isOk(txResult) || !txResult.data) return err('المعاملة غير موجودة');

    const tx = txResult.data;
    if (tx.is_reversed) return err('هذه المعاملة تم عكسها مسبقاً');

    if (isOnline()) {
      const result = await callRPC(RPC.REVERSE_TRANSACTION, { p_transaction_id: transactionId });
      if (!isOk(result)) return result;

      // FIX-3: التحقق من وجود db
      if (typeof db !== 'undefined' && db.isOpen()) {
        await db.transactions.update(transactionId, { is_reversed: true });

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
  // FIX-3: التحقق من وجود db
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

    // FIX-3: التحقق من وجود db
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

    if (isOnline()) {
      const { data } = await supabaseClient
        .from(TABLES.TRANSACTIONS)
        .select('type, amount')
        .eq('agent_id', agentId)
        .eq('date', date)
        .eq('is_reversed', false);
      transactions = data || [];
    } else if (typeof db !== 'undefined' && db.isOpen()) {
      // FIX-3: التحقق من وجود db
      transactions = await db.transactions
        .where('[date+agent_id]')
        .equals([date, agentId])
        .filter(tx => !tx.is_reversed)
        .toArray();
    }

    const summary = { collection: 0, deposit: 0, expense: 0, receipt: 0, delivery: 0 };
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
// تصدير
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
  // FIX-5a: تصدير الثابت للاستخدام في مكونات أخرى
  GENERAL_ACCOUNT_ID,
};

window.AccountingService = AccountingService;
console.log('✅ AccountingService.js v1.1 — FIX-5a: CASH_GENERAL → GENERAL_FUND | FIX-3: حماية typeof db');
