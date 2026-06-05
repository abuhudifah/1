/**
 * repository/Repository.js — v3.0 (Online-First)
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * طبقة CRUD الموحدة
 *
 * مبدأ Online-First:
 * - متصل  → Supabase مصدر الحقيقة الوحيد، Dexie يُحدَّث في الخلفية
 * - غير متصل → Dexie كمخزن طوارئ فقط
 *
 * التغييرات v3:
 * ✅ query(): يقرأ من Supabase مباشرة دون التحقق من الكاش أولاً
 * ✅ getById(): Supabase أولاً، Dexie احتياطي عند offline فقط
 * ✅ إزالة منطق isCacheValid من المسار الرئيسي
 * ✅ Dexie يُكتب فقط في الخلفية بعد نجاح Supabase
 */

'use strict';

const MAX_PAGE_SIZE = 500;

// ============================================================
// دوال مساعدة
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
        case 'is'      : return value === null ? v == null : v === value;
        case 'between' : { const [f,t]=value; return v>=f && v<=t; }
        case 'contains': return Array.isArray(v) && (Array.isArray(value) ? value.every(i=>v.includes(i)) : v.includes(value));
        default        : return v === value;
      }
    });
  }
  return collection;
}

// كتابة Dexie في الخلفية (لا تنتظرها)
function _writeToDexieBackground(tableName, records) {
  (async () => {
    try {
      if (!db.isOpen()) return;
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
      const record = {
        ...data,
        id         : data.id || generateUUID(),
        created_at : data.created_at || new Date().toISOString(),
        updated_at : data.updated_at || new Date().toISOString(),
      };

      if (!isOnline() || options.skipQueue) {
        // Offline: حفظ محلي + طابور
        const pending = { ...record, sync_status: SYNC_STATUS.PENDING };
        try { if (db.isOpen()) await db[tableName]?.put(pending); } catch { /* تجاهل */ }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
        return ok(pending);
      }

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .insert(record)
        .select()
        .single();

      if (error) {
        // فشل Supabase: حفظ محلي + طابور
        console.warn(`⚠️ repo.create(${tableName}): Supabase فشل، أُضيف للطابور`);
        const pending = { ...record, sync_status: SYNC_STATUS.PENDING };
        try { if (db.isOpen()) await db[tableName]?.put(pending); } catch { }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
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
  // UPDATE
  // ==========================================================
  async update(tableName, id, changes) {
    try {
      const updatedChanges = { ...changes, updated_at: new Date().toISOString() };

      if (!isOnline()) {
        try { if (db.isOpen()) await db[tableName]?.update(id, updatedChanges); } catch { }
        await SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, updatedChanges);
        return ok({ id, ...updatedChanges, sync_status: SYNC_STATUS.PENDING });
      }

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .update(updatedChanges)
        .eq('id', id)
        .select()
        .single();

      if (error) {
        try { if (db.isOpen()) await db[tableName]?.update(id, updatedChanges); } catch { }
        await SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, updatedChanges);
        return ok({ id, ...updatedChanges, sync_status: SYNC_STATUS.PENDING });
      }

      await invalidateCacheByPrefix(tableName);
      _writeToDexieBackground(tableName, saved);
      return ok(saved || { id, ...updatedChanges });

    } catch (e) {
      console.error(`❌ repo.update(${tableName}, ${id}):`, e);
      return err(`فشل تحديث السجل: ${e.message}`);
    }
  },

  // ==========================================================
  // DELETE
  // ==========================================================
  async delete(tableName, id) {
    try {
      try { if (db.isOpen()) await db[tableName]?.delete(id); } catch { }
      await invalidateCacheByPrefix(tableName);

      if (!isOnline()) {
        await SyncQueue.add(SYNC_ACTIONS.DELETE, tableName, id, { id });
        return ok(true);
      }

      const { error } = await supabaseClient.from(tableName).delete().eq('id', id);
      if (error) {
        await SyncQueue.add(SYNC_ACTIONS.DELETE, tableName, id, { id });
      }
      return ok(true);

    } catch (e) {
      console.error(`❌ repo.delete(${tableName}, ${id}):`, e);
      return err(`فشل حذف السجل: ${e.message}`);
    }
  },

  // ==========================================================
  // GET BY ID — Online-First
  // ==========================================================
  async getById(tableName, id) {
    try {
      // متصل: Supabase أولاً
      if (isOnline()) {
        const { data, error } = await supabaseClient
          .from(tableName).select('*').eq('id', id).single();

        if (!error && data) {
          _writeToDexieBackground(tableName, data);
          return ok(data);
        }
        if (error?.code === 'PGRST116') return ok(null);
        // فشل: سقوط إلى Dexie
        console.warn(`⚠️ repo.getById(${tableName}): Supabase فشل، محاولة Dexie`);
      }

      // Offline أو فشل Supabase: Dexie
      if (db.isOpen()) {
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
  // QUERY — Online-First (الإصلاح الجوهري)
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

    // ─── Offline: Dexie مباشرة ───
    if (!isOnline()) {
      const localData = await this._queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize });
      return ok({ data: localData, count: localData.length, fromCache: true, offline: true });
    }

    // ─── Online: Supabase مباشرة (بدون تحقق من الكاش) ───
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
        // فشل Supabase: سقوط إلى Dexie
        console.warn(`⚠️ repo.query(${tableName}): Supabase فشل، سقوط إلى Dexie:`, error.message);
        const localData = await this._queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize });
        return ok({ data: localData, count: localData.length, fromCache: true });
      }

      // ✅ كتابة Dexie في الخلفية فقط (لا تنتظرها)
      if (data?.length && data.length <= 200) {
        _writeToDexieBackground(tableName, data);
      }

      return ok({ data: data || [], count: count || 0, fromCache: false });

    } catch (e) {
      console.error(`❌ repo.query(${tableName}):`, e);
      // Fallback نهائي إلى Dexie
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
      const dexieTable = db[tableName];
      if (!dexieTable || !db.isOpen()) return [];
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
  // COUNT — Online-First
  // ==========================================================
  async count(tableName, filters = {}) {
    try {
      if (!isOnline()) {
        if (!db.isOpen()) return ok(0);
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
  // UPSERT
  // ==========================================================
  async upsert(tableName, data, conflictColumns = ['id']) {
    try {
      const record = {
        ...data,
        id         : data.id || generateUUID(),
        updated_at : new Date().toISOString(),
        created_at : data.created_at || new Date().toISOString(),
      };

      if (!isOnline()) {
        try { if (db.isOpen()) await db[tableName]?.put(record); } catch { }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
        return ok({ ...record, sync_status: SYNC_STATUS.PENDING });
      }

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .upsert(record, { onConflict: conflictColumns.join(',') })
        .select()
        .single();

      if (error) {
        try { if (db.isOpen()) await db[tableName]?.put(record); } catch { }
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
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
      // كتابة Dexie أولاً (للعرض الفوري)
      const tables = [...new Set(operations.map(op => op.table))]
        .map(n => db[n]).filter(Boolean);

      if (db.isOpen()) {
        await db.transaction('rw', tables, async () => {
          for (const op of operations) {
            const t = db[op.table];
            if (!t) continue;
            if (op.action === SYNC_ACTIONS.CREATE) await t.put({ ...op.data, sync_status: SYNC_STATUS.PENDING });
            else if (op.action === SYNC_ACTIONS.UPDATE) await t.update(op.id||op.data?.id, { ...op.data, updated_at: new Date().toISOString() });
            else if (op.action === SYNC_ACTIONS.DELETE) await t.delete(op.id||op.data?.id);
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
        let res;
        if (op.action === SYNC_ACTIONS.CREATE) {
          const { data:d, error:e } = await supabaseClient.from(op.table).insert(op.data).select().single();
          res = e ? err(e.message) : ok(d);
          if (!e && d) _writeToDexieBackground(op.table, d);
        } else if (op.action === SYNC_ACTIONS.UPDATE) {
          const { data:d, error:e } = await supabaseClient.from(op.table).update(op.data).eq('id', op.id||op.data?.id).select().single();
          res = e ? err(e.message) : ok(d);
          if (!e && d) _writeToDexieBackground(op.table, d);
        } else if (op.action === SYNC_ACTIONS.DELETE) {
          const { error:e } = await supabaseClient.from(op.table).delete().eq('id', op.id||op.data?.id);
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
  // FETCH FROM CACHE (Dexie مباشرة — للطوارئ)
  // ==========================================================
  async fetchFromCache(tableName, filters = {}) {
    try {
      if (!db.isOpen()) return [];
      const dexieTable = db[tableName];
      if (!dexieTable) return [];
      const col = _applyFiltersToDexie(dexieTable, _parseFilters(filters));
      return await col.toArray();
    } catch { return []; }
  },

  // ==========================================================
  // SAVE TO CACHE (للمزامنة)
  // ==========================================================
  async saveToCache(tableName, records) {
    if (!records?.length || !db.isOpen()) return;
    try {
      const withStatus = records.map(r => ({ ...r, sync_status: r.sync_status || SYNC_STATUS.SYNCED }));
      await db[tableName]?.bulkPut(withStatus);
    } catch { }
  },

  // ==========================================================
  // SYNC PENDING — bulkUpsert
  // ==========================================================
  async syncPendingOperations(tableName) {
    if (!isOnline()) return ok({ synced: 0, failed: 0, reason: 'offline' });
    try {
      if (!db.isOpen()) return ok({ synced: 0, failed: 0 });
      const dexieTable = db[tableName];
      if (!dexieTable) return ok({ synced: 0, failed: 0 });

      const pending = await dexieTable
        .where('sync_status').equals(SYNC_STATUS.PENDING).toArray();
      if (!pending.length) return ok({ synced: 0, failed: 0 });

      const realRecords = pending.filter(r => !isTempId(r.id));
      if (!realRecords.length) return ok({ synced: 0, failed: pending.length });

      let synced = 0, failed = 0;
      const BATCH = 50;

      for (let i = 0; i < realRecords.length; i += BATCH) {
        const batch = realRecords.slice(i, i + BATCH);
        const clean = batch.map(({ sync_status, ...rest }) => rest);
        const { error } = await supabaseClient.from(tableName).upsert(clean, { onConflict: 'id' });
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

window.repo = repo;
console.log('✅ Repository.js v3.0 — Online-First: Supabase مصدر الحقيقة الوحيد');
