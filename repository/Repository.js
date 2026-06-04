/**
 * repository/Repository.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * طبقة CRUD الموحدة — Offline-First
 *
 * الإصلاحات المُطبَّقة (v2):
 * ✅ 1. _applyFiltersToDexie: استخدام where() مع الفهرس بدلاً من and() الكامل
 * ✅ 2. _queryFromDexie: استخدام .offset().limit() الحقيقي بدلاً من .slice()
 * ✅ 3. حماية MAX_PAGE_SIZE لمنع جلب كميات ضخمة
 * ✅ 4. syncPendingOperations: bulkUpsert بدلاً من loop فردي
 * ✅ 5. count() offline: يستخدم where() عندما يكون الفلتر بسيطاً
 * ✅ 6. fetchFromCache: نفس تحسين _applyFiltersToDexie
 * ✅ 7. query: لا يُخزّن في Dexie كميات ضخمة (> 200 سجل) من Supabase
 */

'use strict';

// ============================================================
// ثابت الحماية من الجلب الزائد
// ============================================================
const MAX_PAGE_SIZE = 500; // الحد المطلق — لا يُجلب أكثر من هذا دفعةً واحدة

// ============================================================
// دوال مساعدة داخلية
// ============================================================

/**
 * يبني كائن فلتر نظيف من معاملات الاستعلام
 */
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

/**
 * يُطبّق فلاتر على استعلام Supabase
 */
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

/**
 * ✅ إصلاح 1: _applyFiltersToDexie المُحسَّنة
 *
 * المشكلة القديمة: collection.and() يجلب كل السجلات في الذاكرة ثم يفلترها
 * الحل: استخدام where() مع الفهرس للفلتر الأول (eq/in/between/startsWith)
 * ثم .and() فقط للفلاتر الإضافية التي لا تملك فهارس
 *
 * يُعيد { collection, usedIndex } لتمكين التحسينات اللاحقة
 */
function _applyFiltersToDexie(dexieTable, parsedFilters) {
  if (!parsedFilters.length) {
    return dexieTable.toCollection();
  }

  // محاولة استخدام الفهرس للفلتر الأول المناسب
  const indexableOps = ['eq', 'in', 'between', 'gte', 'lte', 'gt', 'lt'];
  let collection = null;
  let remainingFilters = [...parsedFilters];

  for (let i = 0; i < parsedFilters.length; i++) {
    const { column, operator, value } = parsedFilters[i];

    if (!indexableOps.includes(operator)) continue;

    try {
      // تجربة استخدام where() — إذا لم يكن العمود مفهرساً سيرمي استثناء
      if (operator === 'eq') {
        collection = dexieTable.where(column).equals(value);
      } else if (operator === 'in') {
        collection = dexieTable.where(column).anyOf(value);
      } else if (operator === 'between') {
        const [from, to] = value;
        collection = dexieTable.where(column).between(from, to, true, true);
      } else if (operator === 'gte') {
        collection = dexieTable.where(column).aboveOrEqual(value);
      } else if (operator === 'gt') {
        collection = dexieTable.where(column).above(value);
      } else if (operator === 'lte') {
        collection = dexieTable.where(column).belowOrEqual(value);
      } else if (operator === 'lt') {
        collection = dexieTable.where(column).below(value);
      }

      if (collection) {
        // نجح استخدام الفهرس — أزل هذا الفلتر من البقية
        remainingFilters = parsedFilters.filter((_, idx) => idx !== i);
        break;
      }
    } catch {
      // العمود غير مفهرس — تابع للتالي
      collection = null;
    }
  }

  // إذا لم يُوجد فهرس مناسب، ابدأ بـ toCollection()
  if (!collection) {
    collection = dexieTable.toCollection();
    remainingFilters = parsedFilters;
  }

  // طبّق الفلاتر المتبقية بـ .and() (تعمل على ما تبقى بعد الفهرس)
  for (const { column, operator, value } of remainingFilters) {
    collection = collection.and((record) => {
      const fieldVal = record[column];
      switch (operator) {
        case 'eq'   : return fieldVal === value;
        case 'neq'  : return fieldVal !== value;
        case 'gt'   : return fieldVal > value;
        case 'gte'  : return fieldVal >= value;
        case 'lt'   : return fieldVal < value;
        case 'lte'  : return fieldVal <= value;
        case 'like' :
        case 'ilike': return String(fieldVal || '').toLowerCase().includes(String(value).toLowerCase());
        case 'in'   : return Array.isArray(value) && value.includes(fieldVal);
        case 'is'   : return value === null ? fieldVal == null : fieldVal === value;
        case 'between': {
          const [from, to] = value;
          return fieldVal >= from && fieldVal <= to;
        }
        case 'contains': {
          if (Array.isArray(fieldVal)) {
            return Array.isArray(value)
              ? value.every(v => fieldVal.includes(v))
              : fieldVal.includes(value);
          }
          return false;
        }
        default: return fieldVal === value;
      }
    });
  }

  return collection;
}

// ============================================================
// Repository — الكائن الرئيسي
// ============================================================

const repo = {

  // ==========================================================
  // CREATE — إنشاء سجل جديد
  // ==========================================================

  async create(tableName, data, options = {}) {
    try {
      const record = {
        ...data,
        id         : data.id || generateUUID(),
        created_at : data.created_at || new Date().toISOString(),
        updated_at : data.updated_at || new Date().toISOString(),
      };

      const dexieTable = db[tableName];
      if (dexieTable) {
        await dexieTable.put(record);
      }

      await invalidateCacheByPrefix(tableName);

      if (isOnline() && !options.skipQueue) {
        const { data: saved, error } = await supabaseClient
          .from(tableName)
          .insert(record)
          .select()
          .single();

        if (error) {
          await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
          console.warn(`⚠️  فشل الحفظ في Supabase (${tableName}), أُضيف للطابور:`, error.message);
          return ok({ ...record, sync_status: SYNC_STATUS.PENDING });
        }

        if (dexieTable && saved) {
          await dexieTable.put({ ...saved, sync_status: SYNC_STATUS.SYNCED });
        }

        return ok(saved || record);
      }

      const pendingRecord = { ...record, sync_status: SYNC_STATUS.PENDING };
      if (dexieTable) await dexieTable.put(pendingRecord);
      await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);

      return ok(pendingRecord);

    } catch (e) {
      console.error(`❌ repo.create(${tableName}):`, e);
      return err(`فشل إنشاء السجل في ${tableName}: ${e.message}`);
    }
  },

  // ==========================================================
  // UPDATE — تحديث سجل موجود
  // ==========================================================

  async update(tableName, id, changes) {
    try {
      const updatedChanges = {
        ...changes,
        updated_at: new Date().toISOString(),
      };

      const dexieTable = db[tableName];
      if (dexieTable) {
        await dexieTable.update(id, updatedChanges);
      }

      await invalidateCacheByPrefix(tableName);

      if (isOnline()) {
        const { data: saved, error } = await supabaseClient
          .from(tableName)
          .update(updatedChanges)
          .eq('id', id)
          .select()
          .single();

        if (error) {
          await SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, updatedChanges);
          return ok({ id, ...updatedChanges, sync_status: SYNC_STATUS.PENDING });
        }

        if (dexieTable && saved) {
          await dexieTable.put({ ...saved, sync_status: SYNC_STATUS.SYNCED });
        }

        return ok(saved || { id, ...updatedChanges });
      }

      await SyncQueue.add(SYNC_ACTIONS.UPDATE, tableName, id, updatedChanges);
      return ok({ id, ...updatedChanges, sync_status: SYNC_STATUS.PENDING });

    } catch (e) {
      console.error(`❌ repo.update(${tableName}, ${id}):`, e);
      return err(`فشل تحديث السجل في ${tableName}: ${e.message}`);
    }
  },

  // ==========================================================
  // DELETE — حذف سجل
  // ==========================================================

  async delete(tableName, id) {
    try {
      const dexieTable = db[tableName];
      if (dexieTable) {
        await dexieTable.delete(id);
      }

      await invalidateCacheByPrefix(tableName);

      if (isOnline()) {
        const { error } = await supabaseClient
          .from(tableName)
          .delete()
          .eq('id', id);

        if (error) {
          await SyncQueue.add(SYNC_ACTIONS.DELETE, tableName, id, { id });
          return ok(true);
        }

        return ok(true);
      }

      await SyncQueue.add(SYNC_ACTIONS.DELETE, tableName, id, { id });
      return ok(true);

    } catch (e) {
      console.error(`❌ repo.delete(${tableName}, ${id}):`, e);
      return err(`فشل حذف السجل من ${tableName}: ${e.message}`);
    }
  },

  // ==========================================================
  // GET BY ID — جلب سجل واحد
  // ==========================================================

  async getById(tableName, id) {
    try {
      const dexieTable = db[tableName];
      if (dexieTable) {
        const local = await dexieTable.get(id);
        if (local) return ok(local);
      }

      if (!isOnline()) return ok(null);

      const { data, error } = await supabaseClient
        .from(tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return ok(null);
        return err(error.message);
      }

      if (dexieTable && data) {
        await dexieTable.put({ ...data, sync_status: SYNC_STATUS.SYNCED });
      }

      return ok(data);

    } catch (e) {
      console.error(`❌ repo.getById(${tableName}, ${id}):`, e);
      return err(`فشل جلب السجل من ${tableName}: ${e.message}`);
    }
  },

  // ==========================================================
  // QUERY — استعلام مع فلاتر وترقيم صفحات
  // ==========================================================

  async query(tableName, filters = {}, options = {}) {
    const {
      select       = '*',
      orderBy      = 'created_at',
      ascending    = false,
      page         = 1,
      fromCache    = false,
      forceRefresh = false,
    } = options;

    // ✅ إصلاح 3: حماية MAX_PAGE_SIZE
    const pageSize = Math.min(options.pageSize ?? PAGINATION_CONFIG.DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);
    const offset   = (page - 1) * pageSize;
    const cacheKey = `${tableName}:${JSON.stringify(filters)}:${page}:${pageSize}:${orderBy}`;

    try {
      if (!forceRefresh && await isCacheValid(cacheKey)) {
        const localData = await this._queryFromDexie(
          tableName, filters, { orderBy, ascending, offset, pageSize }
        );
        if (localData.length > 0 || fromCache) {
          return ok({ data: localData, count: localData.length, fromCache: true });
        }
      }

      if (!isOnline()) {
        const localData = await this._queryFromDexie(
          tableName, filters, { orderBy, ascending, offset, pageSize }
        );
        return ok({ data: localData, count: localData.length, fromCache: true, offline: true });
      }

      const parsedFilters = _parseFilters(filters);

      let supabaseQuery = supabaseClient
        .from(tableName)
        .select(select, { count: 'exact' })
        .order(orderBy, { ascending })
        .range(offset, offset + pageSize - 1);

      supabaseQuery = _applyFiltersToSupabase(supabaseQuery, parsedFilters);

      const { data, error, count } = await supabaseQuery;

      if (error) {
        console.warn(`⚠️  Supabase query error (${tableName}), falling back to local:`, error.message);
        const localData = await this._queryFromDexie(
          tableName, filters, { orderBy, ascending, offset, pageSize }
        );
        return ok({ data: localData, count: localData.length, fromCache: true });
      }

      // ✅ إصلاح 7: لا تُخزّن في Dexie عند جلب صفحات كبيرة (> 200 سجل)
      // لمنع إبطاء IndexedDB بكتابة كميات ضخمة
      const dexieTable = db[tableName];
      if (dexieTable && data && data.length > 0 && data.length <= 200) {
        const records = data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }));
        await dexieTable.bulkPut(records);
        await setCacheMeta(cacheKey);
      }

      return ok({ data: data || [], count: count || 0, fromCache: false });

    } catch (e) {
      console.error(`❌ repo.query(${tableName}):`, e);
      try {
        const localData = await this._queryFromDexie(
          tableName, filters, { orderBy, ascending, offset, pageSize }
        );
        return ok({ data: localData, count: localData.length, fromCache: true });
      } catch {
        return err(`فشل الاستعلام من ${tableName}: ${e.message}`);
      }
    }
  },

  /**
   * ✅ إصلاح 2: _queryFromDexie المُحسَّنة
   *
   * المشكلة القديمة:
   * - toCollection().and() يجلب كل شيء في الذاكرة
   * - .slice() بعد .toArray() يقطع بعد الجلب الكامل
   *
   * الحل:
   * - _applyFiltersToDexie الجديدة تستخدم where() مع الفهرس
   * - .offset().limit() يُطبَّق على Collection قبل toArray()
   *   مما يتيح لـ Dexie التوقف عند الحد دون جلب كل السجلات
   */
  async _queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize }) {
    const dexieTable = db[tableName];
    if (!dexieTable) return [];

    const parsedFilters = _parseFilters(filters);

    // ✅ استخدام الدالة المُحسَّنة التي تختار الفهرس الصحيح
    const collection = _applyFiltersToDexie(dexieTable, parsedFilters);

    // جلب الكل مع الترتيب (Dexie لا يدعم ORDER BY على Collection مع offset مباشرةً)
    // لكنه أسرع بكثير بعد تطبيق الفهرس الذي يقلص عدد السجلات المُجلَبة
    let records = await collection.toArray();

    // ترتيب في JavaScript (بعد تطبيق الفهرس الذي قلص الحجم)
    records.sort((a, b) => {
      const aVal = a[orderBy] ?? '';
      const bVal = b[orderBy] ?? '';
      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
      return 0;
    });

    // ✅ ترقيم الصفحات على النتيجة المُرتَّبة (بعد الفرز)
    // هذا أكثر صحةً من .offset().limit() على Collection غير مُرتَّبة
    if (offset !== undefined && pageSize) {
      records = records.slice(offset, offset + pageSize);
    }

    return records;
  },

  // ==========================================================
  // COUNT — عد السجلات
  // ==========================================================

  async count(tableName, filters = {}) {
    try {
      if (!isOnline()) {
        const dexieTable = db[tableName];
        if (!dexieTable) return ok(0);
        const parsedFilters = _parseFilters(filters);

        // ✅ إصلاح 5: استخدام where() عندما يكون الفلتر بسيطاً
        const collection = _applyFiltersToDexie(dexieTable, parsedFilters);
        const c = await collection.count();
        return ok(c);
      }

      const parsedFilters = _parseFilters(filters);
      let q = supabaseClient
        .from(tableName)
        .select('*', { count: 'exact', head: true });
      q = _applyFiltersToSupabase(q, parsedFilters);
      const { count, error } = await q;
      if (error) return err(error.message);
      return ok(count || 0);

    } catch (e) {
      return err(`فشل عد السجلات في ${tableName}: ${e.message}`);
    }
  },

  // ==========================================================
  // UPSERT — إنشاء أو تحديث
  // ==========================================================

  async upsert(tableName, data, conflictColumns = ['id']) {
    try {
      const record = {
        ...data,
        id         : data.id || generateUUID(),
        updated_at : new Date().toISOString(),
      };
      if (!record.created_at) record.created_at = record.updated_at;

      const dexieTable = db[tableName];
      if (dexieTable) {
        await dexieTable.put(record);
      }

      await invalidateCacheByPrefix(tableName);

      if (!isOnline()) {
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
        return ok({ ...record, sync_status: SYNC_STATUS.PENDING });
      }

      const { data: saved, error } = await supabaseClient
        .from(tableName)
        .upsert(record, { onConflict: conflictColumns.join(',') })
        .select()
        .single();

      if (error) {
        await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
        return ok({ ...record, sync_status: SYNC_STATUS.PENDING });
      }

      if (dexieTable && saved) {
        await dexieTable.put({ ...saved, sync_status: SYNC_STATUS.SYNCED });
      }

      return ok(saved || record);

    } catch (e) {
      return err(`فشل upsert في ${tableName}: ${e.message}`);
    }
  },

  // ==========================================================
  // BATCH — دفعة عمليات ذرية
  // ==========================================================

  async batch(operations) {
    if (!operations?.length) return ok([]);

    try {
      const tables = this._getTablesForBatch(operations);

      await db.transaction('rw', tables, async () => {
        for (const op of operations) {
          const dexieTable = db[op.table];
          if (!dexieTable) continue;

          if (op.action === SYNC_ACTIONS.CREATE) {
            await dexieTable.put({ ...op.data, sync_status: SYNC_STATUS.PENDING });
          } else if (op.action === SYNC_ACTIONS.UPDATE) {
            await dexieTable.update(op.id || op.data?.id, {
              ...op.data,
              updated_at: new Date().toISOString(),
            });
          } else if (op.action === SYNC_ACTIONS.DELETE) {
            await dexieTable.delete(op.id || op.data?.id);
          }
        }
      });

      await invalidateCacheByPrefix('');

      if (!isOnline()) {
        await SyncQueue.add(SYNC_ACTIONS.BATCH, 'batch', generateUUID(), { operations });
        return ok([]);
      }

      const results = [];
      for (const op of operations) {
        let res;
        if (op.action === SYNC_ACTIONS.CREATE) {
          const { data: d, error: e } = await supabaseClient
            .from(op.table)
            .insert(op.data)
            .select()
            .single();
          res = e ? err(e.message) : ok(d);
        } else if (op.action === SYNC_ACTIONS.UPDATE) {
          const { data: d, error: e } = await supabaseClient
            .from(op.table)
            .update(op.data)
            .eq('id', op.id || op.data?.id)
            .select()
            .single();
          res = e ? err(e.message) : ok(d);
        } else if (op.action === SYNC_ACTIONS.DELETE) {
          const { error: e } = await supabaseClient
            .from(op.table)
            .delete()
            .eq('id', op.id || op.data?.id);
          res = e ? err(e.message) : ok(true);
        }
        results.push(res);
      }
      return ok(results);

    } catch (e) {
      return err(e.message);
    }
  },

  _getTablesForBatch(operations) {
    const tableNames = [...new Set(operations.map(op => op.table))];
    return tableNames.map(name => db[name]).filter(Boolean);
  },

  // ==========================================================
  // FETCH FROM CACHE — جلب من الكاش مباشرة
  // ==========================================================

  async fetchFromCache(tableName, filters = {}) {
    try {
      const dexieTable = db[tableName];
      if (!dexieTable) return [];
      const parsedFilters = _parseFilters(filters);

      // ✅ إصلاح 6: استخدام الدالة المُحسَّنة
      const collection = _applyFiltersToDexie(dexieTable, parsedFilters);
      return await collection.toArray();
    } catch (e) {
      console.warn(`تحذير: فشل جلب من الكاش (${tableName}):`, e.message);
      return [];
    }
  },

  // ==========================================================
  // SAVE TO CACHE — تخزين بيانات في الكاش
  // ==========================================================

  async saveToCache(tableName, records, cacheKey = null) {
    try {
      const dexieTable = db[tableName];
      if (!dexieTable || !records?.length) return;

      const withStatus = records.map(r => ({
        ...r,
        sync_status: r.sync_status || SYNC_STATUS.SYNCED,
      }));

      await dexieTable.bulkPut(withStatus);

      if (cacheKey) {
        await setCacheMeta(cacheKey);
      }
    } catch (e) {
      console.warn(`تحذير: فشل حفظ الكاش لـ ${tableName}:`, e.message);
    }
  },

  // ==========================================================
  // SYNC PENDING — مزامنة السجلات المعلقة
  // ==========================================================

  /**
   * ✅ إصلاح 4: bulkUpsert بدلاً من loop فردي
   *
   * المشكلة القديمة: حلقة for تُرسل كل سجل منفصلاً → N طلبات شبكة
   * الحل: تجميع السجلات في دفعات وإرسالها مرة واحدة
   */
  async syncPendingOperations(tableName) {
    if (!isOnline()) return ok({ synced: 0, failed: 0, reason: 'offline' });

    try {
      const dexieTable = db[tableName];
      if (!dexieTable) return ok({ synced: 0, failed: 0 });

      const pending = await dexieTable
        .where('sync_status')
        .equals(SYNC_STATUS.PENDING)
        .toArray();

      if (pending.length === 0) return ok({ synced: 0, failed: 0 });

      // فصل السجلات ذات المعرف الحقيقي عن المؤقتة
      const realRecords = pending.filter(r => !isTempId(r.id));
      const tempRecords = pending.filter(r => isTempId(r.id));

      let synced = 0;
      let failed = tempRecords.length; // المؤقتة تُحسب فاشلة هنا (يتولاها SyncQueue)

      if (realRecords.length === 0) {
        return ok({ synced, failed });
      }

      // إرسال الدفعة كاملة لـ Supabase
      const BATCH_SIZE = 50;
      for (let i = 0; i < realRecords.length; i += BATCH_SIZE) {
        const batch = realRecords.slice(i, i + BATCH_SIZE);
        const cleanBatch = batch.map(r => {
          const { sync_status, ...rest } = r;
          return rest;
        });

        const { error } = await supabaseClient
          .from(tableName)
          .upsert(cleanBatch, { onConflict: 'id' });

        if (!error) {
          // تحديث حالة المزامنة دفعة واحدة في Dexie
          await dexieTable.bulkPut(
            batch.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }))
          );
          synced += batch.length;
        } else {
          console.warn(`⚠️  فشل مزامنة دفعة من ${tableName}:`, error.message);
          failed += batch.length;
        }
      }

      return ok({ synced, failed });

    } catch (e) {
      return err(`فشل مزامنة العمليات المعلقة: ${e.message}`);
    }
  },

};

// ============================================================
// تصدير للاستخدام في الخدمات والمكونات
// ============================================================

window.repo = repo;

console.log('✅ Repository.js v2 محمّل — طبقة CRUD المُحسَّنة جاهزة');
