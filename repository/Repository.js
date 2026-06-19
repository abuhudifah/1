/**
 * repository/Repository.js — v3.1 (FIXED)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 *
 * الإصلاحات:
 * ✅ FIX-4: دعم Primary Keys مختلفة عن 'id'
 *    كان update() و delete() و getById() تفترض دائماً أن PK هو 'id'.
 *    هذا يُفشل العمليات على جداول مثل:
 *      - account_balances  (PK = account_id)
 *      - system_settings   (PK = key)
 *      - cache_meta        (PK = key)
 *    الآن: جميع الدوال تقبل pkColumn اختيارياً (افتراضي 'id' للتوافق).
 *
 *    جدول PKs المعروفة في النظام:
 *    ┌─────────────────────┬──────────────┐
 *    │ الجدول              │ Primary Key  │
 *    ├─────────────────────┼──────────────┤
 *    │ transactions        │ id           │
 *    │ users               │ id           │
 *    │ bank_accounts       │ id           │
 *    │ companies           │ id           │
 *    │ expense_accounts    │ id           │
 *    │ debtors             │ id           │
 *    │ failed_deposits     │ id           │
 *    │ notifications       │ id           │
 *    │ audit_logs          │ id           │
 *    │ account_ledger      │ id           │
 *    │ daily_closings      │ id           │
 *    │ account_balances    │ account_id ← │
 *    │ system_settings     │ key        ← │
 *    │ cache_meta          │ key        ← │
 *    └─────────────────────┴──────────────┘
 */

'use strict';

const MAX_PAGE_SIZE = 500;

// ============================================================
// FIX-4: خريطة PKs للجداول التي لا تستخدم 'id'
// ============================================================
const TABLE_PRIMARY_KEYS = Object.freeze({
  account_balances : 'account_id',
  system_settings  : 'key',
  cache_meta       : 'key',
  // باقي الجداول تستخدم 'id' (الافتراضي)
});

/**
 * يُعيد اسم عمود المفتاح الأساسي لجدول معين
 * @param {string} tableName
 * @returns {string}
 */
function _getPKColumn(tableName) {
  return TABLE_PRIMARY_KEYS[tableName] || 'id';
}

// الجداول التي لا تحتوي على عمود updated_at في Supabase
// يجب إبقاء هذه القائمة متزامنة مع _TABLES_WITHOUT_UPDATED_AT في SyncQueue.js و OutboxService.js
const _REPO_TABLES_WITHOUT_UPDATED_AT = new Set([
  'account_balances',
  'accounts',
  'audit_logs',
  'companies',              // لا يوجد عمود updated_at في Supabase
  'daily_closings',
  'notifications',          // لا يوجد عمود updated_at في Supabase
  'quick_login_rate_limit',
  'user_beneficiaries',
]);

// الجداول التي تملك عمود version في Supabase (Optimistic Locking)
// يجب إبقاء هذه القائمة متزامنة مع _TABLES_WITH_VERSION في SyncQueue.js
// المصدر: migration 20260612000000_phase_0_schema_enhancement.sql → trg_increment_version
const _REPO_TABLES_WITH_VERSION = new Set([
  'accounts',
  'bank_accounts',
  'companies',
  'debtors',
  'failed_deposits',
  'transactions',
  'users',
]);

// ============================================================
// دوال مساعدة للفلاتر
// ============================================================

function _parseFilters(filters = {}) {
  return Object.entries(filters)
    .filter(([, val]) => val !== undefined && val !== null && val !== '')
    .map(([column, value]) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        return { column, operator: value.op || 'eq', value: value.val };
      }
      if (Array.isArray(value)) {
        return { column, operator: 'in', value };
      }
      return { column, operator: 'eq', value };
    });
}

function _applyFiltersToSupabase(query, parsedFilters) {
  for (const { column, operator, value } of parsedFilters) {
    switch (operator) {
      case 'eq'      : query = query.eq(column, value);              break;
      case 'neq'     : query = query.neq(column, value);             break;
      case 'gt'      : query = query.gt(column, value);              break;
      case 'gte'     : query = query.gte(column, value);             break;
      case 'lt'      : query = query.lt(column, value);              break;
      case 'lte'     : query = query.lte(column, value);             break;
      case 'like'    : query = query.like(column, `%${value}%`);     break;
      case 'ilike'   : query = query.ilike(column, `%${value}%`);    break;
      case 'in'      : query = query.in(column, value);              break;
      case 'is'      : query = query.is(column, value);              break;
      case 'contains': query = query.contains(column, value);        break;
      case 'between' : {
        const [from, to] = value;
        query = query.gte(column, from).lte(column, to);
        break;
      }
      default: query = query.eq(column, value);
    }
  }
  return query;
}

function _applyFiltersToDexie(dexieTable, parsedFilters) {
  if (!parsedFilters.length) return dexieTable.toCollection();

  const indexableOps = ['eq', 'in', 'between', 'gte', 'lte', 'gt', 'lt'];
  let collection = null;
  let remainingFilters = [...parsedFilters];

  for (let i = 0; i < parsedFilters.length; i++) {
    const { column, operator, value } = parsedFilters[i];
    if (!indexableOps.includes(operator)) continue;
    try {
      if      (operator === 'eq')      collection = dexieTable.where(column).equals(value);
      else if (operator === 'in')      collection = dexieTable.where(column).anyOf(value);
      else if (operator === 'between') { const [f,t]=value; collection = dexieTable.where(column).between(f,t,true,true); }
      else if (operator === 'gte')     collection = dexieTable.where(column).aboveOrEqual(value);
      else if (operator === 'gt')      collection = dexieTable.where(column).above(value);
      else if (operator === 'lte')     collection = dexieTable.where(column).belowOrEqual(value);
      else if (operator === 'lt')      collection = dexieTable.where(column).below(value);

      if (collection) { remainingFilters = parsedFilters.filter((_,idx) => idx !== i); break; }
    } catch { collection = null; }
  }

  if (!collection) { collection = dexieTable.toCollection(); remainingFilters = parsedFilters; }

  for (const { column, operator, value } of remainingFilters) {
    collection = collection.and(record => {
      const v = record[column];
      switch (operator) {
        case 'eq'      : return v === value;
        case 'neq'     : return v !== value;
        case 'gt'      : return v >  value;
        case 'gte'     : return v >= value;
        case 'lt'      : return v <  value;
        case 'lte'     : return v <= value;
        case 'like'    :
        case 'ilike'   : return String(v||'').toLowerCase().includes(String(value).toLowerCase());
        case 'in'      : return Array.isArray(value) && value.includes(v);
        case 'is'      : return value === null ? (v === null || v === undefined) : v === value;
        case 'between' : { const [f,t]=value; return v>=f && v<=t; }
        case 'contains': return Array.isArray(v) && (Array.isArray(value) ? value.every(i=>v.includes(i)) : v.includes(value));
        default        : return v === value;
      }
    });
  }
  return collection;
}

// كتابة Dexie في الخلفية
function _writeToDexieBackground(tableName, records) {
  (async () => {
    try {
      // FIX-3: التحقق من وجود db
      if (typeof db === 'undefined' || !db.isOpen()) return;
      const dexieTable = db[tableName];
      if (!dexieTable) return;
      const withStatus = (Array.isArray(records) ? records : [records])
        .map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }));
      await dexieTable.bulkPut(withStatus);
    } catch { /* تجاهل — Dexie ليست مصدر الحقيقة */ }
  })();
}

// ============================================================
// Repository
// ============================================================

const repo = {

  // ==========================================================
  // CREATE
  // ==========================================================
  async create(tableName, data, options = {}) {
    try {
      const pkColumn = _getPKColumn(tableName);
      const pkValue  = data[pkColumn] || (pkColumn === 'id' ? generateUUID() : data[pkColumn]);

      const hasUpdatedAt = !_REPO_TABLES_WITHOUT_UPDATED_AT.has(tableName);
      const record = {
        ...data,
        [pkColumn] : pkValue,
        created_at : data.created_at || new Date().toISOString(),
        ...(hasUpdatedAt ? { updated_at: data.updated_at || new Date().toISOString() } : {}),
      };
      // إذا أحضر ...data عمود updated_at لجدول لا يملكه، نحذفه صراحةً
      if (!hasUpdatedAt) delete record.updated_at;

      // للتوافق مع الكود القديم الذي يتوقع record.id
      if (pkColumn !== 'id' && !record.id) {
        record.id = pkValue;
      }

      if (!isOnline() || options.skipQueue) {
        const pending = { ...record, sync_status: SYNC_STATUS.PENDING };
        try {
          if (typeof db !== 'undefined' && db.isOpen()) await db[tableName]?.put(pending);
        } catch { /* تجاهل */ }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, pkValue, record);
        return ok(pending);
      }

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .insert(record)
        .select()
        .single();

      if (error) {
        console.warn(`⚠️ repo.create(${tableName}): Supabase فشل، أُضيف للطابور`);
        const pending = { ...record, sync_status: SYNC_STATUS.PENDING };
        try {
          if (typeof db !== 'undefined' && db.isOpen()) await db[tableName]?.put(pending);
        } catch (e) { console.warn(`⚠️ Dexie put fallback (${tableName}):`, e.message); }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, pkValue, record);
        return ok(pending);
      }

      await invalidateCacheByPrefix(tableName);
      _writeToDexieBackground(tableName, saved);
      return ok(saved || record);

    } catch (e) {
      console.error(`❌ repo.create(${tableName}):`, e);
      return err(`فشل إنشاء السجل: ${e.message}`);
    }
  },

  // ==========================================================
  // UPDATE — FIX-4: يستخدم _getPKColumn
  // ==========================================================
  async update(tableName, id, changes) {
    try {
      // FIX-4: تحديد عمود PK الصحيح
      const pkColumn = _getPKColumn(tableName);
      const hasUpdatedAt = !_REPO_TABLES_WITHOUT_UPDATED_AT.has(tableName);

      const hasVersion = _REPO_TABLES_WITH_VERSION.has(tableName);

      // التقاط لقطة updated_at و version قبل التعديل من Dexie (للكشف عن التعارض الحقيقي لاحقاً)
      let preEditUpdatedAt = null;
      let preEditVersion   = null;
      if (hasUpdatedAt || hasVersion) {
        try {
          if (typeof db !== 'undefined' && db.isOpen() && db[tableName]) {
            const existing  = await db[tableName].get(id);
            preEditUpdatedAt = hasUpdatedAt ? (existing?.updated_at || null) : null;
            preEditVersion   = hasVersion   ? (existing?.version    ?? null) : null;
          }
        } catch { /* تجاهل — Dexie ليست مصدر الحقيقة */ }
      }

      const updatedChanges = {
        ...changes,
        ...(hasUpdatedAt      ? { updated_at        : new Date().toISOString() } : {}),
        ...(preEditUpdatedAt  ? { _preEditUpdatedAt : preEditUpdatedAt          } : {}),
        ...(preEditVersion !== null ? { _preEditVersion : preEditVersion        } : {}),
      };

      if (!isOnline()) {
        try {
          if (typeof db !== 'undefined' && db.isOpen()) {
            await db[tableName]?.update(id, updatedChanges);
          }
        } catch (e) { console.warn(`⚠️ Dexie update offline (${tableName}):`, e.message); }
        await SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, updatedChanges);
        return ok({ [pkColumn]: id, ...updatedChanges, sync_status: SYNC_STATUS.PENDING });
      }

      // FIX-4: استخدام pkColumn الصحيح بدلاً من 'id' الثابت
      // حذف حقول الـ metadata الداخلية قبل إرسالها لـ Supabase
      const { _preEditUpdatedAt: _strip, _preEditVersion: _stripV, ...supabaseChanges } = updatedChanges;
      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .update(supabaseChanges)
        .eq(pkColumn, id)    // ← الإصلاح الجوهري
        .select()
        .single();

      if (error) {
        try {
          if (typeof db !== 'undefined' && db.isOpen()) {
            await db[tableName]?.update(id, updatedChanges);
          }
        } catch (e) { console.warn(`⚠️ Dexie update fallback (${tableName}):`, e.message); }
        await SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, updatedChanges);
        return ok({ [pkColumn]: id, ...updatedChanges, sync_status: SYNC_STATUS.PENDING });
      }

      await invalidateCacheByPrefix(tableName);
      _writeToDexieBackground(tableName, saved);
      return ok(saved || { [pkColumn]: id, ...updatedChanges });

    } catch (e) {
      console.error(`❌ repo.update(${tableName}, ${id}):`, e);
      return err(`فشل تحديث السجل: ${e.message}`);
    }
  },

  // ==========================================================
  // DELETE — FIX-4: يستخدم _getPKColumn
  // ==========================================================
  async delete(tableName, id) {
    try {
      // FIX-4: تحديد عمود PK الصحيح
      const pkColumn = _getPKColumn(tableName);

      try {
        if (typeof db !== 'undefined' && db.isOpen()) {
          await db[tableName]?.delete(id);
        }
      } catch (e) { console.warn(`⚠️ Dexie delete (${tableName}):`, e.message); }
      await invalidateCacheByPrefix(tableName);

      if (!isOnline()) {
        await SyncQueue.add(SYNC_ACTIONS.DELETE, tableName, id, { [pkColumn]: id });
        return ok(true);
      }

      // FIX-4: استخدام pkColumn الصحيح
      const { error } = await supabaseClient
        .from(tableName)
        .delete()
        .eq(pkColumn, id);   // ← الإصلاح الجوهري

      if (error) {
        await SyncQueue.add(SYNC_ACTIONS.DELETE, tableName, id, { [pkColumn]: id });
      }
      return ok(true);

    } catch (e) {
      console.error(`❌ repo.delete(${tableName}, ${id}):`, e);
      return err(`فشل حذف السجل: ${e.message}`);
    }
  },

  // ==========================================================
  // GET BY ID — FIX-4: يستخدم _getPKColumn
  // ==========================================================
  async getById(tableName, id) {
    try {
      // FIX-4: تحديد عمود PK الصحيح
      const pkColumn = _getPKColumn(tableName);

      if (isOnline()) {
        // FIX-4: استخدام pkColumn الصحيح
        const { data, error } = await supabaseClient
          .from(tableName)
          .select('*')
          .eq(pkColumn, id)  // ← الإصلاح الجوهري
          .single();

        if (!error && data) {
          _writeToDexieBackground(tableName, data);
          return ok(data);
        }
        if (error?.code === 'PGRST116') return ok(null);
        console.warn(`⚠️ repo.getById(${tableName}): Supabase فشل، محاولة Dexie`);
      }

      // Offline أو فشل Supabase
      if (typeof db !== 'undefined' && db.isOpen()) {
        const local = await db[tableName]?.get(id);
        if (local) return ok(local);
      }
      return ok(null);

    } catch (e) {
      console.error(`❌ repo.getById(${tableName}, ${id}):`, e);
      return err(e.message);
    }
  },

  // ==========================================================
  // QUERY
  // ==========================================================
  async query(tableName, filters = {}, options = {}) {
    const {
      select       = '*',
      orderBy      = 'created_at',
      ascending    = false,
      page         = 1,
    } = options;

    const pageSize = Math.min(options.pageSize ?? PAGINATION_CONFIG.DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset   = (page - 1) * pageSize;

    if (!isOnline()) {
      const localData = await this._queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize });
      return ok({ data: localData, count: localData.length, fromCache: true, offline: true });
    }

    try {
      const parsedFilters = _parseFilters(filters);

      let q = supabaseClient
        .from(tableName)
        .select(select, { count: 'exact' })
        .order(orderBy, { ascending })
        .range(offset, offset + pageSize - 1);

      q = _applyFiltersToSupabase(q, parsedFilters);

      const { data, error, count } = await q;

      if (error) {
        console.warn(`⚠️ repo.query(${tableName}): Supabase فشل، سقوط إلى Dexie:`, error.message);
        const localData = await this._queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize });
        return ok({ data: localData, count: localData.length, fromCache: true });
      }

      if (data?.length && data.length <= 200) {
        _writeToDexieBackground(tableName, data);
      }

      return ok({ data: data || [], count: count || 0, fromCache: false });

    } catch (e) {
      console.error(`❌ repo.query(${tableName}):`, e);
      try {
        const localData = await this._queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize });
        return ok({ data: localData, count: localData.length, fromCache: true });
      } catch {
        return err(`فشل الاستعلام: ${e.message}`);
      }
    }
  },

  async _queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize }) {
    try {
      // FIX-3: التحقق من وجود db
      if (typeof db === 'undefined' || !db.isOpen()) return [];
      const dexieTable = db[tableName];
      if (!dexieTable) return [];
      const parsedFilters = _parseFilters(filters);
      const collection = _applyFiltersToDexie(dexieTable, parsedFilters);
      let records = await collection.toArray();
      records.sort((a, b) => {
        const av = a[orderBy] ?? '', bv = b[orderBy] ?? '';
        if (av < bv) return ascending ? -1 :  1;
        if (av > bv) return ascending ?  1 : -1;
        return 0;
      });
      if (offset !== undefined && pageSize) records = records.slice(offset, offset + pageSize);
      return records;
    } catch { return []; }
  },

  // ==========================================================
  // COUNT
  // ==========================================================
  async count(tableName, filters = {}) {
    try {
      if (!isOnline()) {
        // FIX-3: التحقق من وجود db
        if (typeof db === 'undefined' || !db.isOpen()) return ok(0);
        const col = _applyFiltersToDexie(db[tableName], _parseFilters(filters));
        return ok(await col.count());
      }
      let q = supabaseClient.from(tableName).select('*', { count: 'exact', head: true });
      q = _applyFiltersToSupabase(q, _parseFilters(filters));
      const { count, error } = await q;
      if (error) return err(error.message);
      return ok(count || 0);
    } catch (e) {
      return err(e.message);
    }
  },

  // ==========================================================
  // UPSERT — FIX-4: يستخدم _getPKColumn
  // ==========================================================
  async upsert(tableName, data, conflictColumns = null) {
    try {
      const pkColumn = _getPKColumn(tableName);
      // FIX-4: استخدام pkColumn كعمود تعارض افتراضي إذا لم يُحدَّد
      const resolvedConflictColumns = conflictColumns || [pkColumn];

      const hasUpdatedAt = !_REPO_TABLES_WITHOUT_UPDATED_AT.has(tableName);
      const record = {
        ...data,
        created_at : data.created_at || new Date().toISOString(),
      };
      // يُضاف updated_at فقط للجداول التي تملكه فعلياً في Supabase
      if (hasUpdatedAt) record.updated_at = new Date().toISOString();
      else              delete record.updated_at; // يُزال حتى لو أحضره ...data

      // ضمان وجود قيمة PK
      if (!record[pkColumn] && pkColumn === 'id') {
        record[pkColumn] = generateUUID();
      }

      if (!isOnline()) {
        try {
          if (typeof db !== 'undefined' && db.isOpen()) await db[tableName]?.put(record);
        } catch (e) { console.warn(`⚠️ Dexie upsert offline (${tableName}):`, e.message); }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record[pkColumn], record);
        return ok({ ...record, sync_status: SYNC_STATUS.PENDING });
      }

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .upsert(record, { onConflict: resolvedConflictColumns.join(',') })
        .select()
        .single();

      if (error) {
        try {
          if (typeof db !== 'undefined' && db.isOpen()) await db[tableName]?.put(record);
        } catch (e) { console.warn(`⚠️ Dexie upsert fallback (${tableName}):`, e.message); }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record[pkColumn], record);
        return ok({ ...record, sync_status: SYNC_STATUS.PENDING });
      }

      await invalidateCacheByPrefix(tableName);
      _writeToDexieBackground(tableName, saved);
      return ok(saved || record);

    } catch (e) {
      return err(`فشل upsert: ${e.message}`);
    }
  },

  // ==========================================================
  // BATCH
  // ==========================================================
  async batch(operations) {
    if (!operations?.length) return ok([]);
    try {
      // FIX-3: التحقق من وجود db قبل المعاملة
      if (typeof db !== 'undefined' && db.isOpen()) {
        const tables = [...new Set(operations.map(op => op.table))]
          .map(n => db[n]).filter(Boolean);

        await db.transaction('rw', tables, async () => {
          for (const op of operations) {
            const t = db[op.table];
            if (!t) continue;
            const pkCol = _getPKColumn(op.table);
            const pkVal = op.data?.[pkCol] || op.id;
            if (op.action === SYNC_ACTIONS.CREATE) {
              await t.put({ ...op.data, sync_status: SYNC_STATUS.PENDING });
            } else if (op.action === SYNC_ACTIONS.UPDATE) {
              await t.update(pkVal, { ...op.data, updated_at: new Date().toISOString() });
            } else if (op.action === SYNC_ACTIONS.DELETE) {
              await t.delete(pkVal);
            }
          }
        });
      }

      await invalidateCacheByPrefix('');

      if (!isOnline()) {
        await SyncQueue.add(SYNC_ACTIONS.BATCH, 'batch', generateUUID(), { operations });
        return ok([]);
      }

      const results = [];
      for (const op of operations) {
        const pkCol = _getPKColumn(op.table);
        const pkVal = op.id || op.data?.[pkCol];
        let res;
        if (op.action === SYNC_ACTIONS.CREATE) {
          const { data:d, error:e } = await supabaseClient.from(op.table).insert(op.data).select().single();
          res = e ? err(e.message) : ok(d);
          if (!e && d) _writeToDexieBackground(op.table, d);
        } else if (op.action === SYNC_ACTIONS.UPDATE) {
          // FIX-4: استخدام pkCol الصحيح
          const { data:d, error:e } = await supabaseClient.from(op.table).update(op.data).eq(pkCol, pkVal).select().single();
          res = e ? err(e.message) : ok(d);
          if (!e && d) _writeToDexieBackground(op.table, d);
        } else if (op.action === SYNC_ACTIONS.DELETE) {
          // FIX-4: استخدام pkCol الصحيح
          const { error:e } = await supabaseClient.from(op.table).delete().eq(pkCol, pkVal);
          res = e ? err(e.message) : ok(true);
        }
        results.push(res);
      }
      return ok(results);
    } catch (e) {
      return err(e.message);
    }
  },

  // ==========================================================
  // FETCH FROM CACHE
  // ==========================================================
  async fetchFromCache(tableName, filters = {}) {
    try {
      // FIX-3: التحقق من وجود db
      if (typeof db === 'undefined' || !db.isOpen()) return [];
      const dexieTable = db[tableName];
      if (!dexieTable) return [];
      const col = _applyFiltersToDexie(dexieTable, _parseFilters(filters));
      return await col.toArray();
    } catch { return []; }
  },

  // ==========================================================
  // SAVE TO CACHE
  // ==========================================================
  async saveToCache(tableName, records) {
    if (!records?.length) return;
    // FIX-3: التحقق من وجود db
    if (typeof db === 'undefined' || !db.isOpen()) return;
    try {
      const withStatus = records.map(r => ({ ...r, sync_status: r.sync_status || SYNC_STATUS.SYNCED }));
      await db[tableName]?.bulkPut(withStatus);
    } catch (e) { console.warn(`⚠️ Dexie saveToCache (${tableName}):`, e.message); }
  },

  // ==========================================================
  // SYNC PENDING
  // ==========================================================
  async syncPendingOperations(tableName) {
    if (!isOnline()) return ok({ synced: 0, failed: 0, reason: 'offline' });
    try {
      // FIX-3: التحقق من وجود db
      if (typeof db === 'undefined' || !db.isOpen()) return ok({ synced: 0, failed: 0 });
      const dexieTable = db[tableName];
      if (!dexieTable) return ok({ synced: 0, failed: 0 });

      const pending = await dexieTable
        .where('sync_status').equals(SYNC_STATUS.PENDING).toArray();
      if (!pending.length) return ok({ synced: 0, failed: 0 });

      const pkColumn = _getPKColumn(tableName);
      // Phase 6: لا TEMP_ID — كل المعرفات حقيقية (UUID) منذ المرحلة 3
      const realRecords = pending;
      if (!realRecords.length) return ok({ synced: 0, failed: pending.length });

      let synced = 0, failed = 0;
      const BATCH = 50;

      // الحقول المحلية التي لا يجب إرسالها لـ Supabase
      const _LOCAL_FIELDS = [
        'sync_status', 'idempotency_key', 'local_timestamp', 'device_id',
        'synced_at', '_local_only', 'error_message', '_preEditUpdatedAt', '_preEditVersion',
      ];
      const _stripLocalFields = (r) => {
        const c = { ...r };
        for (const f of _LOCAL_FIELDS) delete c[f];
        if (_REPO_TABLES_WITHOUT_UPDATED_AT.has(tableName)) delete c.updated_at;
        return c;
      };

      for (let i = 0; i < realRecords.length; i += BATCH) {
        const batch = realRecords.slice(i, i + BATCH);
        const clean = batch.map(_stripLocalFields);
        // FIX-4: استخدام pkColumn الصحيح في onConflict
        const { error } = await supabaseClient
          .from(tableName)
          .upsert(clean, { onConflict: pkColumn });

        if (!error) {
          await dexieTable.bulkPut(batch.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED })));
          synced += batch.length;
        } else {
          console.warn(`⚠️ syncPendingOperations(${tableName}):`, error.message);
          failed += batch.length;
        }
      }
      return ok({ synced, failed });
    } catch (e) {
      return err(e.message);
    }
  },
};

// تصدير خريطة PKs للاستخدام في ملفات أخرى
window.TABLE_PRIMARY_KEYS = TABLE_PRIMARY_KEYS;
window.repo = repo;

console.log('✅ Repository.js v3.1 — FIX-4: دعم PKs المختلفة (account_id, key, ...) | FIX-3: حماية typeof db');
