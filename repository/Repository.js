/**
 * repository/Repository.js
 * نظام أبو حذيفة المتكامل للصرافة والتحويلات
 * طبقة CRUD الموحدة — Offline-First
 *
 * المبدأ الأساسي (Offline-First):
 * 1. كل عملية كتابة → تُحفظ في Dexie أولاً
 * 2. إذا كان الاتصال متاحاً → تُرسل لـ Supabase فوراً
 * 3. إذا لم يكن متاحاً → تُضاف لطابور المزامنة
 * 4. كل عملية قراءة → من Dexie أولاً (إذا كانت صالحة)،
 *    وإلا من Supabase ثم تُخزّن في Dexie
 *
 * الدوال الرئيسية:
 * - repo.create(table, data)
 * - repo.update(table, id, changes)
 * - repo.delete(table, id)
 * - repo.getById(table, id)
 * - repo.query(table, filters, options)
 * - repo.batch(operations)
 * - repo.upsert(table, data, conflictColumns)
 * - repo.count(table, filters)
 */

'use strict';

// ============================================================
// دوال مساعدة داخلية لـ Repository
// ============================================================

/**
 * يبني كائن فلتر نظيف من معاملات الاستعلام
 * @param {object} filters - كائن الفلاتر { column: value, ... }
 * @returns {Array<{column, operator, value}>}
 */
function _parseFilters(filters = {}) {
  return Object.entries(filters)
    .filter(([, val]) => val !== undefined && val !== null && val !== '')
    .map(([column, value]) => {
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // فلتر مركب { op, val } مثل { op: 'gte', val: '2025-01-01' }
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
 * @param {object} query - استعلام Supabase
 * @param {Array} parsedFilters
 * @returns {object} query مع الفلاتر مطبقة
 */
function _applyFiltersToSupabase(query, parsedFilters) {
  for (const { column, operator, value } of parsedFilters) {
    switch (operator) {
      case 'eq'       : query = query.eq(column, value);                  break;
      case 'neq'      : query = query.neq(column, value);                 break;
      case 'gt'       : query = query.gt(column, value);                  break;
      case 'gte'      : query = query.gte(column, value);                 break;
      case 'lt'       : query = query.lt(column, value);                  break;
      case 'lte'      : query = query.lte(column, value);                 break;
      case 'like'     : query = query.like(column, `%${value}%`);         break;
      case 'ilike'    : query = query.ilike(column, `%${value}%`);        break;
      case 'in'       : query = query.in(column, value);                  break;
      case 'is'       : query = query.is(column, value);                  break;
      case 'contains' : query = query.contains(column, value);            break;
      case 'between': {
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
 * يُطبّق فلاتر على مجموعة Dexie
 * @param {object} collection - Dexie Collection
 * @param {Array} parsedFilters
 * @returns {object} collection مع الفلاتر
 */
function _applyFiltersToDexie(collection, parsedFilters) {
  for (const { column, operator, value } of parsedFilters) {
    collection = collection.and((record) => {
      const fieldVal = record[column];
      switch (operator) {
        case 'eq'  : return fieldVal === value;
        case 'neq' : return fieldVal !== value;
        case 'gt'  : return fieldVal > value;
        case 'gte' : return fieldVal >= value;
        case 'lt'  : return fieldVal < value;
        case 'lte' : return fieldVal <= value;
        case 'like':
        case 'ilike': return String(fieldVal || '').toLowerCase().includes(String(value).toLowerCase());
        case 'in'  : return Array.isArray(value) && value.includes(fieldVal);
        case 'is'  : return value === null ? fieldVal == null : fieldVal === value;
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

  /**
   * ينشئ سجلاً جديداً (Offline-First)
   * @param {string} tableName - اسم الجدول
   * @param {object} data - بيانات السجل الجديد
   * @param {object} [options]
   * @param {boolean} [options.skipQueue=false] - تجاوز طابور المزامنة
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  async create(tableName, data, options = {}) {
    try {
      // توليد ID إذا لم يكن موجوداً
      const record = {
        ...data,
        id         : data.id || generateUUID(),
        created_at : data.created_at || new Date().toISOString(),
        updated_at : data.updated_at || new Date().toISOString(),
      };

      // حفظ في Dexie أولاً (فوري)
      const dexieTable = db[tableName];
      if (dexieTable) {
        await dexieTable.put(record);
      }

      // إبطال الكاش ذي الصلة
      await invalidateCacheByPrefix(tableName);

      // إرسال لـ Supabase إن كان متصلاً
      if (isOnline() && !options.skipQueue) {
        const { data: saved, error } = await supabaseClient
          .from(tableName)
          .insert(record)
          .select()
          .single();

        if (error) {
          // إضافة لطابور المزامنة عند الفشل
          await SyncQueue.add(SYNC_ACTIONS.CREATE, tableName, record.id, record);
          console.warn(`⚠️  فشل الحفظ في Supabase (${tableName}), أُضيف للطابور:`, error.message);
          return ok({ ...record, sync_status: SYNC_STATUS.PENDING });
        }

        // تحديث Dexie بالبيانات المُعادة من Supabase
        if (dexieTable && saved) {
          await dexieTable.put({ ...saved, sync_status: SYNC_STATUS.SYNCED });
        }

        return ok(saved || record);
      }

      // غير متصل — أضف للطابور
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

  /**
   * يُحدّث سجلاً موجوداً (Offline-First)
   * @param {string} tableName
   * @param {string} id - معرف السجل
   * @param {object} changes - التغييرات فقط
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
  async update(tableName, id, changes) {
    try {
      const updatedChanges = {
        ...changes,
        updated_at: new Date().toISOString(),
      };

      // تحديث Dexie أولاً
      const dexieTable = db[tableName];
      if (dexieTable) {
        await dexieTable.update(id, updatedChanges);
      }

      await invalidateCacheByPrefix(tableName);

      // إرسال لـ Supabase إن كان متصلاً
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

      // غير متصل
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

  /**
   * يحذف سجلاً (Offline-First — يحذف محلياً فوراً)
   * @param {string} tableName
   * @param {string} id
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async delete(tableName, id) {
    try {
      // حذف من Dexie أولاً
      const dexieTable = db[tableName];
      if (dexieTable) {
        await dexieTable.delete(id);
      }

      await invalidateCacheByPrefix(tableName);

      // حذف من Supabase إن كان متصلاً
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

      // غير متصل
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

  /**
   * يجلب سجلاً بمعرفه
   * يقرأ من Dexie أولاً، ثم Supabase إذا لم يجده
   * @param {string} tableName
   * @param {string} id
   * @returns {Promise<{ok: boolean, data?: object|null, error?: string}>}
   */
  async getById(tableName, id) {
    try {
      // من Dexie أولاً
      const dexieTable = db[tableName];
      if (dexieTable) {
        const local = await dexieTable.get(id);
        if (local) return ok(local);
      }

      // من Supabase إذا لم يوجد محلياً
      if (!isOnline()) return ok(null);

      const { data, error } = await supabaseClient
        .from(tableName)
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        if (error.code === 'PGRST116') return ok(null); // غير موجود
        return err(error.message);
      }

      // تخزين في Dexie للمرة القادمة
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

  /**
   * يُنفّذ استعلاماً مع دعم الفلاتر والترقيم والترتيب
   * @param {string} tableName
   * @param {object} [filters={}] - فلاتر { column: value }
   * @param {object} [options={}]
   * @param {string[]} [options.select='*'] - الأعمدة المطلوبة
   * @param {string} [options.orderBy='created_at'] - عمود الترتيب
   * @param {boolean} [options.ascending=false] - تصاعدي؟
   * @param {number} [options.page=1] - رقم الصفحة
   * @param {number} [options.pageSize] - حجم الصفحة
   * @param {boolean} [options.fromCache=false] - من الكاش فقط؟
   * @param {boolean} [options.forceRefresh=false] - تجاهل الكاش؟
   * @returns {Promise<{ok: boolean, data?: Array, count?: number, error?: string}>}
   */
  async query(tableName, filters = {}, options = {}) {
    const {
      select       = '*',
      orderBy      = 'created_at',
      ascending    = false,
      page         = 1,
      pageSize     = PAGINATION_CONFIG.DEFAULT_PAGE_SIZE,
      fromCache    = false,
      forceRefresh = false,
    } = options;

    const offset = (page - 1) * pageSize;
    const cacheKey = `${tableName}:${JSON.stringify(filters)}:${page}:${pageSize}:${orderBy}`;

    try {
      // قراءة من Dexie إذا كان الكاش صالحاً وليس هناك طلب تحديث
      if (!forceRefresh && await isCacheValid(cacheKey)) {
        const localData = await this._queryFromDexie(
          tableName, filters, { orderBy, ascending, offset, pageSize }
        );
        if (localData.length > 0 || fromCache) {
          return ok({ data: localData, count: localData.length, fromCache: true });
        }
      }

      // إذا كان offline وليس هناك كاش — أرجع ما هو موجود محلياً
      if (!isOnline()) {
        const localData = await this._queryFromDexie(
          tableName, filters, { orderBy, ascending, offset, pageSize }
        );
        return ok({ data: localData, count: localData.length, fromCache: true, offline: true });
      }

      // جلب من Supabase
      const parsedFilters = _parseFilters(filters);

      let supabaseQuery = supabaseClient
        .from(tableName)
        .select(select, { count: 'exact' })
        .order(orderBy, { ascending })
        .range(offset, offset + pageSize - 1);

      supabaseQuery = _applyFiltersToSupabase(supabaseQuery, parsedFilters);

      const { data, error, count } = await supabaseQuery;

      if (error) {
        // fallback للكاش المحلي عند خطأ الشبكة
        console.warn(`⚠️  Supabase query error (${tableName}), falling back to local:`, error.message);
        const localData = await this._queryFromDexie(
          tableName, filters, { orderBy, ascending, offset, pageSize }
        );
        return ok({ data: localData, count: localData.length, fromCache: true });
      }

      // تخزين النتائج في Dexie
      const dexieTable = db[tableName];
      if (dexieTable && data && data.length > 0) {
        const records = data.map(r => ({ ...r, sync_status: SYNC_STATUS.SYNCED }));
        await dexieTable.bulkPut(records);
        await setCacheMeta(cacheKey);
      }

      return ok({ data: data || [], count: count || 0, fromCache: false });

    } catch (e) {
      console.error(`❌ repo.query(${tableName}):`, e);
      // آخر محاولة: من Dexie
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
   * استعلام داخلي من Dexie مع تطبيق الفلاتر
   * @private
   */
  async _queryFromDexie(tableName, filters, { orderBy, ascending, offset, pageSize }) {
    const dexieTable = db[tableName];
    if (!dexieTable) return [];

    const parsedFilters = _parseFilters(filters);

    let collection = dexieTable.toCollection();
    if (parsedFilters.length > 0) {
      collection = _applyFiltersToDexie(collection, parsedFilters);
    }

    let records = await collection.toArray();

    // الترتيب
    records.sort((a, b) => {
      const aVal = a[orderBy] ?? '';
      const bVal = b[orderBy] ?? '';
      if (aVal < bVal) return ascending ? -1 : 1;
      if (aVal > bVal) return ascending ? 1 : -1;
      return 0;
    });

    // ترقيم الصفحات
    if (offset !== undefined && pageSize) {
      records = records.slice(offset, offset + pageSize);
    }

    return records;
  },

  // ==========================================================
  // COUNT — عد السجلات
  // ==========================================================

  /**
   * يُعيد عدد السجلات المطابقة للفلاتر
   * @param {string} tableName
   * @param {object} [filters={}]
   * @returns {Promise<{ok: boolean, data?: number, error?: string}>}
   */
  async count(tableName, filters = {}) {
    try {
      if (!isOnline()) {
        const dexieTable = db[tableName];
        if (!dexieTable) return ok(0);
        const parsedFilters = _parseFilters(filters);
        let collection = dexieTable.toCollection();
        if (parsedFilters.length > 0) {
          collection = _applyFiltersToDexie(collection, parsedFilters);
        }
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

  /**
   * يُنشئ سجلاً أو يُحدّثه إذا كان موجوداً
   * @param {string} tableName
   * @param {object} data
   * @param {string[]} [conflictColumns=['id']] - أعمدة التعارض
   * @returns {Promise<{ok: boolean, data?: object, error?: string}>}
   */
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

  /**
   * يُنفّذ دفعة من العمليات دفعة واحدة (Atomicity)
   * مثال:
   * await repo.batch([
   *   { action: 'create', table: 'transactions', data: {...} },
   *   { action: 'create', table: 'account_ledger', data: {...} },
   *   { action: 'update', table: 'account_balances', id: 'AGT_x', data: {...} },
   * ])
   *
   * @param {Array<{action, table, id?, data}>} operations
   * @returns {Promise<{ok: boolean, results?: Array, error?: string}>}
   */
  async batch(operations) {
    if (!operations || operations.length === 0) {
      return ok({ results: [] });
    }

    try {
      // تنفيذ محلي في Dexie أولاً (كل العمليات)
      await db.transaction('rw', this._getTablesForBatch(operations), async () => {
        for (const op of operations) {
          const dexieTable = db[op.table];
          if (!dexieTable) continue;

          const now = new Date().toISOString();

          if (op.action === SYNC_ACTIONS.CREATE) {
            const record = {
              ...op.data,
              id         : op.data.id || generateUUID(),
              created_at : op.data.created_at || now,
              updated_at : op.data.updated_at || now,
              sync_status: SYNC_STATUS.PENDING,
            };
            await dexieTable.put(record);
          } else if (op.action === SYNC_ACTIONS.UPDATE) {
            await dexieTable.update(op.id || op.data?.id, {
              ...op.data,
              updated_at  : now,
              sync_status : SYNC_STATUS.PENDING,
            });
          } else if (op.action === SYNC_ACTIONS.DELETE) {
            await dexieTable.delete(op.id || op.data?.id);
          }
        }
      });

      // إبطال الكاش لكل الجداول المتأثرة
      const tables = [...new Set(operations.map(op => op.table))];
      await Promise.all(tables.map(t => invalidateCacheByPrefix(t)));

      // إرسال الدفعة لـ Supabase عبر RPC إن كان متصلاً
      if (isOnline()) {
        const result = await this._sendBatchToSupabase(operations);
        if (isOk(result)) {
          // تحديث sync_status في Dexie
          await db.transaction('rw', this._getTablesForBatch(operations), async () => {
            for (const op of operations) {
              const dexieTable = db[op.table];
              if (!dexieTable) continue;
              const id = op.data?.id || op.id;
              if (id) {
                await dexieTable.update(id, { sync_status: SYNC_STATUS.SYNCED });
              }
            }
          });
          return ok({ results: result.data, synced: true });
        }
      }

      // إضافة الدفعة كوحدة واحدة لطابور المزامنة
      await SyncQueue.add(SYNC_ACTIONS.BATCH, 'batch', generateUUID(), { operations });
      return ok({ results: operations, synced: false, pending: true });

    } catch (e) {
      console.error('❌ repo.batch():', e);
      return err(`فشل تنفيذ الدفعة: ${e.message}`);
    }
  },

  /**
   * يُرسل دفعة العمليات لـ Supabase
   * @private
   */
  async _sendBatchToSupabase(operations) {
    try {
      // استخدام RPC لضمان الذرية على الخادم
      const { data, error } = await supabaseClient.rpc('execute_batch', {
        p_operations: JSON.stringify(operations),
      }).single();

      if (error) {
        // الدفعة تحتوي على معاملة مالية — استخدم RPC المخصص
        const txOp      = operations.find(op => op.table === TABLES.TRANSACTIONS);
        const entryOps  = operations.filter(op => op.table === TABLES.ACCOUNT_LEDGER);

        if (txOp && entryOps.length > 0) {
          return await callRPC(RPC.CREATE_TRANSACTION_WITH_ENTRIES, {
            p_transaction : txOp.data,
            p_entries     : entryOps.map(op => op.data),
          });
        }

        // دفعة عامة: تنفيذ كل عملية على حدة
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
      }

      return ok(data);
    } catch (e) {
      return err(e.message);
    }
  },

  /**
   * يُعيد مصفوفة كائنات Dexie للجداول المستخدمة في الدفعة
   * @private
   */
  _getTablesForBatch(operations) {
    const tableNames = [...new Set(operations.map(op => op.table))];
    return tableNames
      .map(name => db[name])
      .filter(Boolean);
  },

  // ==========================================================
  // SAVE TO CACHE — تخزين بيانات في الكاش
  // ==========================================================

  /**
   * يُخزّن مصفوفة سجلات في Dexie ويُسجّل صلاحية الكاش
   * @param {string} tableName
   * @param {Array} records
   * @param {string} [cacheKey]
   * @returns {Promise<void>}
   */
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
  // FETCH FROM CACHE — جلب من الكاش مباشرة
  // ==========================================================

  /**
   * يجلب سجلات من Dexie مباشرة بدون استعلام Supabase
   * @param {string} tableName
   * @param {object} [filters={}]
   * @returns {Promise<Array>}
   */
  async fetchFromCache(tableName, filters = {}) {
    try {
      const dexieTable = db[tableName];
      if (!dexieTable) return [];
      const parsedFilters = _parseFilters(filters);
      let collection = dexieTable.toCollection();
      if (parsedFilters.length > 0) {
        collection = _applyFiltersToDexie(collection, parsedFilters);
      }
      return await collection.toArray();
    } catch (e) {
      console.warn(`تحذير: فشل جلب من الكاش (${tableName}):`, e.message);
      return [];
    }
  },

  // ==========================================================
  // SYNC PENDING — مزامنة السجلات المعلقة
  // ==========================================================

  /**
   * يُزامن جميع السجلات ذات sync_status = 'pending' لجدول محدد
   * @param {string} tableName
   * @returns {Promise<{ok: boolean, synced: number, failed: number}>}
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

      let synced = 0;
      let failed = 0;

      for (const record of pending) {
        // تجاهل المعرفات المؤقتة (TEMP_) — يتولاها SyncQueue
        if (isTempId(record.id)) {
          failed++;
          continue;
        }

        const { error } = await supabaseClient
          .from(tableName)
          .upsert({ ...record, sync_status: SYNC_STATUS.SYNCED })
          .select()
          .single();

        if (!error) {
          await dexieTable.update(record.id, { sync_status: SYNC_STATUS.SYNCED });
          synced++;
        } else {
          failed++;
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

console.log('✅ Repository.js محمّل — طبقة CRUD الموحدة جاهزة');
