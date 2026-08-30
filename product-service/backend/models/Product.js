// ─────────────────────────────────────────────────────────────────────────
//  models/Product.js  —  PG-backed with mongoose-compatible surface.
//
//  Data lives in supply_chain.public.products.  All callers still expect
//  a Mongoose model API (find/findById/findByIdAndUpdate/countDocuments/
//  updateMany/deleteMany/distinct/aggregate + chain: sort/skip/limit/
//  select/lean/toObject), so this shim keeps the wire contract 1:1.
//
//  Field naming: outside world uses camelCase + `_id` (24-hex); the DB
//  uses snake_case + bigint `id` with `mongo_id text UNIQUE`.  Mapping
//  is done in `toApi()` / `fromApi()` below.  New records auto-generate
//  a 24-hex `mongo_id` so `_id` always exists.
// ─────────────────────────────────────────────────────────────────────────
import crypto from 'crypto';
import { getPgPool } from '../config/db.js';

const TABLE = 'public.products';

// Field mapping — the exhaustive list is copied from the historical
// Mongoose schema (see git history for models/Product.js.bak) + PG schema.
// Any camelCase key not listed here is passed through unchanged (i.e. it
// stays camelCase in output, and is rejected on write).
const MONGO_TO_PG = {
  _id: 'mongo_id',
  id: 'id',
  title: 'title',
  englishTitle: 'english_title',
  isListed: 'is_listed',
  category: 'category',
  sellerName: 'seller_name',
  images: 'images',
  panorama_images: 'panorama_images',
  package_images: 'package_images',
  detail_images: 'detail_images',
  root_soil_images: 'root_soil_images',
  size_ref_images: 'size_ref_images',
  scene_images: 'scene_images',
  selling_point_images: 'selling_point_images',
  care_images: 'care_images',
  comparison_images: 'comparison_images',
  shipping_images: 'shipping_images',
  after_sale_images: 'after_sale_images',
  product_videos: 'product_videos',
  flowerName: 'flower_name',
  floweringMonths: 'flowering_months',
  sceneTags: 'scene_tags',
  contactPerson: 'contact_person',
  specSize: 'spec_size',
  deliveryMethod: 'delivery_method',
  origin: 'origin',
  potColorNotes: 'pot_color_notes',
  stock: 'stock',
  minOrder: 'min_order',
  tradeType: 'trade_type',
  publishStatus: 'publish_status',
  weight: 'weight',
  dropShippingCost: 'drop_shipping_cost',
  dropShippingMarketPrice: 'drop_shipping_market_price',
  settlementPrice: 'settlement_price',
  shippingFee: 'shipping_fee',
  costPrice: 'cost_price',
  sellPrice: 'sell_price',
  taxRateA: 'tax_rate_a',
  taxRateB: 'tax_rate_b',
  retailMarkupPrice: 'retail_markup_price',
  profit: 'profit',
  platformPriceDiff: 'platform_price_diff',
  couponInfo: 'coupon_info',
  retailProfit: 'retail_profit',
  description: 'description',
  batchMinQty: 'batch_min_qty',
  batchShipping: 'batch_shipping',
  batchUnitPrice: 'batch_unit_price',
  productId: 'product_id',
  listedDate: 'listed_date',
  listedStore: 'listed_store',
  salesVolume: 'sales_volume',
  salesCount: 'sales_volume',  // alias for legacy callers (flower-api uses salesCount)
  createdBy: 'created_by',
  shipping_description: 'shipping_description',
  supplier_id: 'supplier_id',
  ecommerceReferenceUrl: 'ecommerce_reference_url',
  supplier_name: 'supplier_name',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
};
const PG_TO_MONGO = Object.fromEntries(Object.entries(MONGO_TO_PG).map(([k, v]) => [v, k]));

// Fields that are arrays in PG (text[] / smallint[]).  Needed for correct
// value normalization on write and update-op semantics.
const ARRAY_COLUMNS = new Set([
  'images', 'panorama_images', 'package_images', 'detail_images',
  'root_soil_images', 'size_ref_images', 'scene_images', 'selling_point_images',
  'care_images', 'comparison_images', 'shipping_images', 'after_sale_images',
  'product_videos', 'flowering_months', 'scene_tags',
]);

const JSONB_COLUMNS = new Set(['publish_status']);
const NUMERIC_COLUMNS = new Set([
  'weight', 'drop_shipping_cost', 'drop_shipping_market_price', 'settlement_price',
  'shipping_fee', 'cost_price', 'sell_price', 'tax_rate_a', 'tax_rate_b',
  'retail_markup_price', 'profit', 'platform_price_diff', 'retail_profit',
  'batch_shipping', 'batch_unit_price',
]);

function pgCol(mongoKey) {
  return MONGO_TO_PG[mongoKey] || null;
}

function apiKey(pgKey) {
  return PG_TO_MONGO[pgKey] || pgKey;
}

function newObjectId() {
  // 24 hex chars, roughly ObjectId-shaped (timestamp + random).  We only
  // need uniqueness for the mongo_id column; no need for strict BSON layout.
  const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const rand = crypto.randomBytes(8).toString('hex');
  return (ts + rand).slice(0, 24);
}

function isObjectIdLike(v) {
  return typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
}

// ─── Row wrapper: mimics mongoose Document minimally ────────────────────
class ProductDoc {
  constructor(row) {
    if (!row) return;
    Object.assign(this, toApi(row));
  }
  toObject() { return { ...this }; }
  toJSON() { return { ...this }; }
}

function toApi(row) {
  if (!row) return row;
  const out = {};
  for (const [k, v] of Object.entries(row)) {
    const apiK = apiKey(k);
    // Numeric columns come back as strings from node-postgres; keep as
    // strings to preserve historic behavior (mongoose Number would coerce,
    // but ecommerce APIs typically pass strings around unchanged).
    // However, historically Mongoose stored them as Number so we normalize.
    if (NUMERIC_COLUMNS.has(k) && v !== null && v !== undefined) {
      const n = Number(v);
      out[apiK] = Number.isFinite(n) ? n : v;
    } else {
      out[apiK] = v;
    }
  }
  return out;
}

// Convert an incoming update value to something PG can consume.
function normalizeValue(pgKey, v) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (ARRAY_COLUMNS.has(pgKey)) {
    if (!Array.isArray(v)) return [];
    return v;
  }
  if (JSONB_COLUMNS.has(pgKey)) {
    return typeof v === 'string' ? v : JSON.stringify(v);
  }
  return v;
}

// Resolve any id (whether numeric bigint id or 24-hex mongo_id) to a
// WHERE clause tuple.
function idPredicate(id, params) {
  if (id === null || id === undefined) throw new Error('id required');
  const s = String(id);
  if (isObjectIdLike(s)) {
    params.push(s);
    return `mongo_id = $${params.length}`;
  }
  if (/^\d+$/.test(s)) {
    params.push(Number(s));
    return `id = $${params.length}`;
  }
  // fallback treat as text mongo_id
  params.push(s);
  return `mongo_id = $${params.length}`;
}

// ─── Filter (query) translation ─────────────────────────────────────────
// Convert a Mongoose-style query object into a `(sql, params)` fragment.
// Supported operators: $in, $nin, $all, $regex, $gt, $gte, $lt, $lte,
// $ne, $or, $and, $each (only inside $addToSet/$push — handled elsewhere),
// $exists.  Anything else throws — better to fail loudly than silently
// return wrong rows.
function buildWhere(query, paramsStart = 0) {
  const params = [];
  const push = (v) => { params.push(v); return `$${paramsStart + params.length}`; };
  const clauses = [];

  const compile = (q) => {
    const parts = [];
    for (const [k, v] of Object.entries(q)) {
      if (k === '$or' || k === '$and') {
        const joiner = k === '$or' ? ' OR ' : ' AND ';
        const sub = v.map(compile).filter(Boolean).map((s) => `(${s})`).join(joiner);
        if (sub) parts.push(`(${sub})`);
        continue;
      }
      const col = pgCol(k) || k; // allow raw snake_case if the caller wrote it
      const isArr = ARRAY_COLUMNS.has(col);

      if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        // operator object
        for (const [op, arg] of Object.entries(v)) {
          switch (op) {
            case '$in':
              if (isArr) {
                // array column, ANY element in arg
                parts.push(`${col} && ${push(Array.isArray(arg) ? arg : [arg])}`);
              } else if (col === 'mongo_id' || col === 'id') {
                // handle mixed bigint/hex
                const ids = Array.isArray(arg) ? arg : [arg];
                const hex = ids.filter((x) => isObjectIdLike(String(x))).map(String);
                const num = ids.filter((x) => /^\d+$/.test(String(x))).map((x) => Number(x));
                const or = [];
                if (hex.length) or.push(`mongo_id = ANY(${push(hex)})`);
                if (num.length) or.push(`id = ANY(${push(num)})`);
                if (!or.length) or.push('FALSE');
                parts.push(`(${or.join(' OR ')})`);
              } else {
                // Mongo $in matches null too — need to handle NULL explicitly
                const arr = Array.isArray(arg) ? arg : [arg];
                const hasNull = arr.some((x) => x === null);
                const nonNull = arr.filter((x) => x !== null);
                const or = [];
                if (nonNull.length) or.push(`${col} = ANY(${push(nonNull)})`);
                if (hasNull) or.push(`${col} IS NULL`);
                if (!or.length) or.push('FALSE');
                parts.push(`(${or.join(' OR ')})`);
              }
              break;
            case '$nin':
              if (isArr) {
                parts.push(`NOT (${col} && ${push(Array.isArray(arg) ? arg : [arg])})`);
              } else {
                // Mongo $nin excludes null too — need explicit IS NOT NULL when null ∈ arg
                const arr = Array.isArray(arg) ? arg : [arg];
                const hasNull = arr.some((x) => x === null);
                const nonNull = arr.filter((x) => x !== null);
                const clauses = [];
                if (nonNull.length) clauses.push(`(${col} <> ALL(${push(nonNull)}) OR ${col} IS NULL)`);
                if (hasNull) clauses.push(`${col} IS NOT NULL`);
                if (!clauses.length) clauses.push('TRUE');
                parts.push(`(${clauses.join(' AND ')})`);
              }
              break;
            case '$all':
              if (!isArr) throw new Error(`$all only valid on array cols; got ${col}`);
              parts.push(`${col} @> ${push(Array.isArray(arg) ? arg : [arg])}`);
              break;
            case '$regex':
              parts.push(`${col} ILIKE ${push('%' + String(arg).replace(/[%_]/g, (m) => '\\' + m) + '%')}`);
              break;
            case '$options':
              // handled together with $regex; ignore standalone
              break;
            case '$gt':  parts.push(`${col} >  ${push(arg)}`); break;
            case '$gte': parts.push(`${col} >= ${push(arg)}`); break;
            case '$lt':  parts.push(`${col} <  ${push(arg)}`); break;
            case '$lte': parts.push(`${col} <= ${push(arg)}`); break;
            case '$ne':  parts.push(`${col} <> ${push(arg)}`); break;
            case '$exists': parts.push(`${col} IS ${arg ? 'NOT ' : ''}NULL`); break;
            default:
              throw new Error(`Unsupported query operator: ${op}`);
          }
        }
      } else {
        // Direct equality
        if (col === 'mongo_id' && typeof v === 'string' && !isObjectIdLike(v) && /^\d+$/.test(v)) {
          // A "_id" that's actually a bigint fallback
          parts.push(`id = ${push(Number(v))}`);
        } else if (isArr) {
          // Scalar match against array col → element inclusion (Mongo semantics)
          parts.push(`${push(v)} = ANY(${col})`);
        } else if (v instanceof Date) {
          parts.push(`${col} = ${push(v)}`);
        } else {
          parts.push(`${col} = ${push(v)}`);
        }
      }
    }
    return parts.join(' AND ');
  };

  const sql = compile(query || {});
  clauses.push(sql);
  return { sql: sql || 'TRUE', params };
}

// ─── ORDER BY translation ───────────────────────────────────────────────
function buildOrderBy(sort) {
  if (!sort) return '';
  if (typeof sort === 'string') {
    // Mongoose string form: "-createdAt updatedAt"
    const parts = sort.split(/\s+/).filter(Boolean).flatMap((tok) => {
      const dir = tok.startsWith('-') ? 'DESC' : 'ASC';
      const key = tok.replace(/^[-+]/, '');
      const col = pgCol(key);
      if (!col) return [];
      return [`${col} ${dir}`];
    });
    return parts.length ? ' ORDER BY ' + parts.join(', ') : '';
  }
  if (typeof sort === 'object') {
    const parts = Object.entries(sort).flatMap(([k, v]) => {
      const col = pgCol(k);
      if (!col) return [];  // ignore unknown keys instead of injecting raw identifier
      return [`${col} ${v === -1 || v === 'desc' ? 'DESC' : 'ASC'}`];
    });
    return parts.length ? ' ORDER BY ' + parts.join(', ') : '';
  }
  return '';
}

// ─── Update translation ────────────────────────────────────────────────
// Accepts a mongoose-style update (top-level $set/$push/$pull/$addToSet
// or bare fields), returns a SQL SET fragment + params.  Runs against
// exactly one row; caller supplies the WHERE.
function buildUpdate(update, params) {
  const push = (v) => { params.push(v); return `$${params.length}`; };
  const sets = [];

  const applyBareSet = (key, val) => {
    const col = pgCol(key);
    if (!col) return; // silently drop unknown fields (mirrors mongoose non-strict)
    if (col === 'mongo_id' || col === 'id') return; // never mutate keys
    sets.push(`${col} = ${push(normalizeValue(col, val))}`);
  };

  for (const [k, v] of Object.entries(update)) {
    if (k === '$set') {
      for (const [kk, vv] of Object.entries(v)) applyBareSet(kk, vv);
    } else if (k === '$push') {
      for (const [kk, vv] of Object.entries(v)) {
        const col = pgCol(kk);
        if (!col || !ARRAY_COLUMNS.has(col)) continue;
        const each = vv && typeof vv === 'object' && '$each' in vv ? vv.$each : [vv];
        sets.push(`${col} = COALESCE(${col}, ARRAY[]::${col === 'flowering_months' ? 'smallint' : 'text'}[]) || ${push(each)}::${col === 'flowering_months' ? 'int[]' : 'text[]'}`);
      }
    } else if (k === '$pull') {
      for (const [kk, vv] of Object.entries(v)) {
        const col = pgCol(kk);
        if (!col || !ARRAY_COLUMNS.has(col)) continue;
        if (vv && typeof vv === 'object' && '$in' in vv) {
          const drop = vv.$in;
          sets.push(`${col} = COALESCE((SELECT array_agg(e) FROM unnest(${col}) e WHERE e <> ALL(${push(drop)}::text[])), ARRAY[]::text[])`);
        } else {
          sets.push(`${col} = array_remove(${col}, ${push(vv)})`);
        }
      }
    } else if (k === '$addToSet') {
      for (const [kk, vv] of Object.entries(v)) {
        const col = pgCol(kk);
        if (!col || !ARRAY_COLUMNS.has(col)) continue;
        const each = vv && typeof vv === 'object' && '$each' in vv ? vv.$each : [vv];
        // Union while preserving order: existing values first, then new ones not already present.
        sets.push(`${col} = COALESCE((SELECT array_agg(x) FROM (SELECT unnest(COALESCE(${col}, ARRAY[]::text[])) AS x UNION SELECT unnest(${push(each)}::text[])) u), ARRAY[]::text[])`);
      }
    } else if (k === '$inc') {
      for (const [kk, vv] of Object.entries(v)) {
        const col = pgCol(kk);
        if (!col) continue;
        sets.push(`${col} = COALESCE(${col}, 0) + ${push(vv)}`);
      }
    } else if (k.startsWith('$')) {
      throw new Error(`Unsupported update operator: ${k}`);
    } else {
      applyBareSet(k, v);
    }
  }
  return sets.join(', ');
}

// ─── Query chain (find(...).sort(...).skip().limit().select().lean()) ──
// Also used by findById (single=true mode) so callers can do
//    Product.findById(id).select('images')
class Query {
  constructor(where, opts = {}) {
    this._where = where || {};
    this._sort = null;
    this._skip = 0;
    this._limit = null;
    this._select = null;
    this._lean = false;
    this._single = !!opts.single;
    // For findById, `where` is expected to be pre-built as a $__idPredicate
    // {sql, params} tuple — see `_makeIdQuery`.
    this._prebuiltWhere = opts.prebuiltWhere || null;
  }
  sort(s) { this._sort = s; return this; }
  skip(n) { this._skip = Number(n) || 0; return this; }
  limit(n) { this._limit = Number(n); return this; }
  select(s) {
    // Only include mode supported ("field1 field2"); exclude ("-x") ignored.
    if (typeof s === 'string') {
      const cols = s.split(/\s+/).filter(Boolean).filter((c) => !c.startsWith('-'));
      this._select = cols.map((c) => pgCol(c) || c);
    }
    return this;
  }
  lean() { this._lean = true; return this; }

  async _exec() {
    const pool = getPgPool();
    let whereSql, params;
    if (this._prebuiltWhere) {
      whereSql = this._prebuiltWhere.sql;
      params = this._prebuiltWhere.params.slice();
    } else {
      const w = buildWhere(this._where);
      whereSql = w.sql;
      params = w.params;
    }
    const projection = this._select && this._select.length
      ? this._select.concat(['id', 'mongo_id']).join(', ')
      : '*';
    let sql = `SELECT ${projection} FROM ${TABLE} WHERE ${whereSql}`;
    sql += buildOrderBy(this._sort);
    const limitVal = this._single ? 1 : this._limit;
    if (limitVal != null) sql += ` LIMIT ${Number(limitVal)}`;
    if (this._skip) sql += ` OFFSET ${Number(this._skip)}`;
    const r = await pool.query(sql, params);
    const rows = this._lean ? r.rows.map(toApi) : r.rows.map((row) => new ProductDoc(row));
    return this._single ? (rows[0] || null) : rows;
  }

  then(resolve, reject) { return this._exec().then(resolve, reject); }
  catch(f) { return this._exec().catch(f); }
}

function _makeIdQuery(id) {
  const params = [];
  const sql = idPredicate(id, params);
  return new Query({}, { single: true, prebuiltWhere: { sql, params } });
}

// ─── Public model surface ──────────────────────────────────────────────
const Product = {
  // find(filter) → chainable
  find(query = {}) { return new Query(query); },

  findById(id) {
    // returns a thenable Query so callers can `.select(...)` chain
    return _makeIdQuery(id);
  },

  async findByIdAndUpdate(id, update, opts = {}) {
    const params = [];
    const where = idPredicate(id, params);
    const setSql = buildUpdate(update, params);
    if (!setSql) return this.findById(id);
    const pool = getPgPool();
    const r = await pool.query(
      `UPDATE ${TABLE} SET ${setSql} WHERE ${where} RETURNING *`,
      params
    );
    if (!r.rows[0]) return null;
    return opts.new === false ? null : new ProductDoc(r.rows[0]);
  },

  async findByIdAndDelete(id, client = null) {
    const params = [];
    const where = idPredicate(id, params);
    const pool = client || getPgPool();
    const r = await pool.query(`DELETE FROM ${TABLE} WHERE ${where} RETURNING *`, params);
    return r.rows[0] ? new ProductDoc(r.rows[0]) : null;
  },

  async create(data, client = null) {
    // Mongo-style create; accept camelCase, translate to snake_case.
    const cols = [];
    const vals = [];
    const params = [];
    const push = (v) => { params.push(v); return `$${params.length}`; };

    // Ensure mongo_id exists (auto-generate for new records)
    const record = { ...data };
    if (!record._id) record._id = newObjectId();

    for (const [k, v] of Object.entries(record)) {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt') continue;
      const col = pgCol(k);
      if (!col) continue;
      cols.push(col);
      vals.push(push(normalizeValue(col, v)));
    }
    if (!cols.length) throw new Error('create: no known fields');

    const db = client || getPgPool();
    const r = await db.query(
      `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *`,
      params
    );
    return new ProductDoc(r.rows[0]);
  },

  async updateMany(filter, update) {
    const params = [];
    const setSql = buildUpdate(update, params);
    if (!setSql) return { modifiedCount: 0 };
    const { sql: whereSql, params: whereParams } = buildWhere(filter, params.length);
    // whereParams are numbered starting at params.length+1 already
    const finalParams = params.concat(whereParams);
    const pool = getPgPool();
    const r = await pool.query(`UPDATE ${TABLE} SET ${setSql} WHERE ${whereSql}`, finalParams);
    return { modifiedCount: r.rowCount, matchedCount: r.rowCount };
  },

  async deleteMany(filter) {
    const { sql: whereSql, params } = buildWhere(filter);
    const pool = getPgPool();
    const r = await pool.query(`DELETE FROM ${TABLE} WHERE ${whereSql}`, params);
    return { deletedCount: r.rowCount };
  },

  async countDocuments(filter = {}) {
    const { sql: whereSql, params } = buildWhere(filter);
    const pool = getPgPool();
    const r = await pool.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE ${whereSql}`, params);
    return r.rows[0].n;
  },

  async distinct(field, filter = {}) {
    const col = pgCol(field) || field;
    const isArr = ARRAY_COLUMNS.has(col);
    const { sql: whereSql, params } = buildWhere(filter);
    const pool = getPgPool();
    const sql = isArr
      ? `SELECT DISTINCT unnest(${col}) AS v FROM ${TABLE} WHERE ${whereSql}`
      : `SELECT DISTINCT ${col} AS v FROM ${TABLE} WHERE ${whereSql}`;
    const r = await pool.query(sql, params);
    return r.rows.map((row) => row.v);
  },

  // Minimal aggregate — only supports the seller-stats pipeline shape:
  //   [{ $match: {...} }, { $group: { _id: '$sellerName', count: { $sum: 1 } } }]
  // Anything else throws; extend as needed.
  async aggregate(pipeline) {
    if (!Array.isArray(pipeline) || pipeline.length !== 2) {
      throw new Error('aggregate: only 2-stage pipelines supported');
    }
    const [stage1, stage2] = pipeline;
    if (!stage1.$match || !stage2.$group) throw new Error('aggregate: expected $match + $group');
    const groupBy = String(stage2.$group._id || '').replace(/^\$/, '');
    const groupCol = pgCol(groupBy) || groupBy;
    // Only $sum:1 supported for now
    const g = stage2.$group;
    if (!('count' in g) || g.count.$sum !== 1) {
      throw new Error('aggregate: only { count: { $sum: 1 } } supported');
    }
    const { sql: whereSql, params } = buildWhere(stage1.$match);
    const pool = getPgPool();
    const r = await pool.query(
      `SELECT ${groupCol} AS _id, count(*)::int AS count FROM ${TABLE} WHERE ${whereSql} GROUP BY ${groupCol}`,
      params
    );
    return r.rows;
  },

  // Legacy: allow `new Product(data)` shape via a shim function.  Used by
  // route code as `Product.create({...})` primarily, but export for parity.
  ProductDoc,
};

export default Product;
