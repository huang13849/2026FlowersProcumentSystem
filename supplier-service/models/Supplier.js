

// models/Supplier.js - PG-backed with mongoose-compatible surface
// No mongoose dependency; uses pg Pool directly (same as supplyChainPg.js)
const { Pool } = require('pg');
const crypto = require('crypto');

let pool = null;
function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host: process.env.PG_HOST || '100.67.126.90',
    port: Number(process.env.PG_PORT || 5432),
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD,
    database: process.env.SUPPLY_CHAIN_PG_DATABASE || process.env.PG_DATABASE || 'supply_chain',
    max: 10, idleTimeoutMillis: 30000,
  });
  pool.on('error', (e) => console.error('[Supplier PG] pool error:', e.message));
  return pool;
}

const TABLE = 'public.suppliers';

function ensureArray(v) { return Array.isArray(v) ? v : []; }
function ensureObj(v) { return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; }

function toApi(row) {
  if (!row) return null;
  const obj = {
    _id: row.mongo_id || String(row.id),
    id: row.mongo_id || String(row.id),
    project: row.project || '',
    name: row.name || '',
    shop_name: row.shop_name || '',
    status: row.status || '待整理',
    contact: ensureObj(row.contact),
    contacts: ensureArray(row.contacts),
    company_info: ensureObj(row.company_info),
    business_items: ensureArray(row.business_items),
    address: row.address || '',
    planting_area: row.planting_area,
    estimated_inventory: row.estimated_inventory,
    sales_period: ensureArray(row.sales_period),
    location: ensureObj(row.location),
    contract_files: ensureArray(row.contract_files),
    license_files: ensureArray(row.license_files),
    dispatch_files: ensureArray(row.dispatch_files),
    notes: row.notes || '',
    product_count: row.product_count || 0,
    product_ids: ensureArray(row.product_ids),
    sortOrder: row.sort_order || 0,
    peony_alliance: ensureObj(row.peony_alliance),
    tags: ensureArray(row.tags),
    attributes: ensureObj(row.attributes),
    source_project: row.source_project || '',
    zid: row.zid || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  // Add mongoose-like methods
  obj.toObject = function() { return this; };
  obj.save = async function() {
    const p = getPool();
    // Update based on row id
    await p.query(`UPDATE ${TABLE} SET name=$1, shop_name=$2, status=$3, notes=$4, sort_order=$5, updated_at=NOW() WHERE id=$6`,
      [this.name, this.shop_name, this.status, this.notes, this.sortOrder, row.id]);
    return this;
  };
  return obj;
}

// Mongoose-compatible query builder
function buildWhere(query) {
  const where = [];
  const vals = [];
  
  if (query.$or) {
    const ors = query.$or.map(c => {
      const k = Object.keys(c)[0];
      const v = c[k];
      const colMap = { name: 'name', shop_name: 'shop_name', 'contact.name': "contact->>'name'", 'company_info.tax_id': "company_info->>'tax_id'", notes: 'notes' };
      const col = colMap[k] || k;
      vals.push(`%${v.$regex || v}%`);
      return `${col} ILIKE $${vals.length}`;
    });
    where.push(`(${ors.join(' OR ')})`);
  }
  if (query.status) { vals.push(query.status); where.push(`status = $${vals.length}`); }
  if (query._id && query._id.$in) {
    vals.push(query._id.$in);
    where.push(`mongo_id = ANY($${vals.length}::text[])`);
  }
  if (query.shop_name) { vals.push(query.shop_name); where.push(`shop_name = $${vals.length}`); }
  
  return { where: where.length ? 'WHERE ' + where.join(' AND ') : '', vals };
}

const Supplier = {
  async find(query = {}) {
    const p = getPool();
    const { where, vals } = buildWhere(query);
    const r = await p.query(`SELECT * FROM ${TABLE} ${where} ORDER BY updated_at DESC`, vals);
    return r.rows.map(toApi);
  },

  async findById(id) {
    const p = getPool();
    const _numId = /^[0-9]+$/.test(String(id));
    const r = await p.query(
      `SELECT * FROM ${TABLE} WHERE mongo_id = $1${_numId ? ' OR id = $1::bigint' : ''} LIMIT 1`,
      [id]);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },

  async findByIdAndUpdate(id, update, opts = {}) {
    const p = getPool();
    const sets = ['updated_at = NOW()'];
    const vals = [];
    const fieldMap = {
      name: 'name', shop_name: 'shop_name', status: 'status', notes: 'notes', sortOrder: 'sort_order',
      project: 'project', address: 'address', product_count: 'product_count',
      contact: 'contact', contacts: 'contacts', company_info: 'company_info',
      business_items: 'business_items', planting_area: 'planting_area',
      estimated_inventory: 'estimated_inventory', sales_period: 'sales_period',
      location: 'location', contract_files: 'contract_files', license_files: 'license_files',
      dispatch_files: 'dispatch_files', product_ids: 'product_ids', peony_alliance: 'peony_alliance',
      tags: 'tags', attributes: 'attributes', source_project: 'source_project', zid: 'zid',
    };
    for (const [k, v] of Object.entries(update)) {
      if (fieldMap[k] !== undefined) {
        const val = (typeof v === 'object' && !Array.isArray(v) && v !== null) ? JSON.stringify(v) : (Array.isArray(v) ? JSON.stringify(v) : v);
        vals.push(val);
        sets.push(`${fieldMap[k]} = $${vals.length}`);
      }
    }
    vals.push(id);
    const _numIdU = /^[0-9]+$/.test(String(id));
    const r = await p.query(
      `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE mongo_id = $${vals.length}${_numIdU ? ` OR id = $${vals.length}::bigint` : ''} RETURNING *`,
      vals);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },

  async findByIdAndDelete(id) {
    const p = getPool();
    const _numIdD = /^[0-9]+$/.test(String(id));
    const r = await p.query(
      `DELETE FROM ${TABLE} WHERE mongo_id = $1${_numIdD ? ' OR id = $1::bigint' : ''} RETURNING *`,
      [id]);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },

  async create(data) {
    const p = getPool();
    const mongoId = data._id || crypto.randomBytes(12).toString('hex');
    const r = await p.query(
      `INSERT INTO ${TABLE} (mongo_id, project, name, shop_name, status, contact, contacts, company_info, business_items,
        address, planting_area, estimated_inventory, sales_period, location, contract_files, license_files,
        dispatch_files, notes, product_count, product_ids, sort_order, peony_alliance, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW(),NOW()) RETURNING *`,
      [mongoId, data.project||'', data.name||'', data.shop_name||null, data.status||'待整理',
       JSON.stringify(data.contact||{}), JSON.stringify(data.contacts||[]), JSON.stringify(data.company_info||{}), JSON.stringify(data.business_items||[]),
       data.address||'', data.planting_area||null, data.estimated_inventory||null, JSON.stringify(data.sales_period||[]),
       JSON.stringify(data.location||{type:'Point',coordinates:[0,0]}), JSON.stringify(data.contract_files||[]), JSON.stringify(data.license_files||[]),
       JSON.stringify(data.dispatch_files||[]), data.notes||null, data.product_count||0, JSON.stringify(data.product_ids||[]), data.sortOrder||0,
       JSON.stringify(data.peony_alliance||{})]
    );
    return toApi(r.rows[0]);
  },

  async findOne(query = {}, opts = {}) {
    const p = getPool();
    const { where, vals } = buildWhere(query);
    let sql = `SELECT * FROM ${TABLE} ${where}`;
    if (opts.sort && opts.sort.sortOrder === -1) sql += ' ORDER BY sort_order DESC';
    else sql += ' ORDER BY created_at DESC';
    sql += ' LIMIT 1';
    const r = await p.query(sql, vals);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },

  async countDocuments(query = {}) {
    const p = getPool();
    const { where, vals } = buildWhere(query);
    const r = await p.query(`SELECT count(*)::int as c FROM ${TABLE} ${where}`, vals);
    return r.rows[0].c;
  },

  async deleteMany(query = {}) {
    const p = getPool();
    if (query._id && query._id.$in) {
      const r = await p.query(`DELETE FROM ${TABLE} WHERE mongo_id = ANY($1::text[]) RETURNING mongo_id`, [query._id.$in]);
      return { deletedCount: r.rows.length };
    }
    return { deletedCount: 0 };
  },

  async bulkWrite(ops) {
    const p = getPool();
    let updated = 0;
    for (const op of ops) {
      if (op.updateOne) {
        const { filter, update } = op.updateOne;
        const id = filter._id;
        const so = update.$set?.sortOrder;
        if (so !== undefined) {
          await p.query(`UPDATE ${TABLE} SET sort_order = $1, updated_at = NOW() WHERE mongo_id = $2`, [so, id]);
          updated++;
        }
      }
    }
    return { modifiedCount: updated };
  },
};

// Chainable find
const origFind = Supplier.find;
Supplier.find = function(query = {}) {
  const promise = origFind(query);
  const chainable = {
    sort() { return chainable; },
    select() { return chainable; },
    then(resolve, reject) { return promise.then(resolve, reject); },
    catch(reject) { return promise.catch(reject); },
  };
  return chainable;
};

// Chainable findOne
const origFindOne = Supplier.findOne;
Supplier.findOne = function(query = {}, opts = {}) {
  const promise = origFindOne(query, opts);
  const chainable = {
    sort() { return chainable; },
    select() { return chainable; },
    then(resolve, reject) { return promise.then(resolve, reject); },
    catch(reject) { return promise.catch(reject); },
  };
  return chainable;
};

// Export mongoose-compatible interface
module.exports = {
  SupplierSchema: {},
  createSupplierModel: (conn) => Supplier,
  normalizeGeoPayload: (payload) => payload,
  isValidCoord: (lng, lat) => typeof lng === 'number' && typeof lat === 'number' && !Number.isNaN(lng) && !Number.isNaN(lat),
  Supplier,
};
