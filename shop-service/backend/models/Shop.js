// models/Shop.js - Direct PG connection (pg Pool). Writes must NOT go through
// api-gateway /api/pg/:db/query which is SELECT-only (returns 403 on INSERT/UPDATE/DELETE).
const { Pool } = require('pg');
const crypto = require('crypto');

const TABLE = 'shops';
let pool = null;
function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host:     process.env.PG_HOST || 'pg-primary.pg-cluster.svc.cluster.local',
    port:     Number(process.env.PG_PORT || 5432),
    user:     process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD,
    database: process.env.PG_DATABASE || 'supply_chain',
    max: 5, idleTimeoutMillis: 30000,
  });
  pool.on('error', (e) => console.error('[shop-pg] pool error:', e.message));
  return pool;
}
async function pgQuery(sql, params = []) {
  const r = await getPool().query(sql, params);
  return { data: r.rows, rows: r.rows };
}
// Only append `OR id = $N::bigint` when id is all-digits, else mongo ObjectId
// (24 hex chars) would blow up the bigint cast.
const isNumId = (id) => /^[0-9]+$/.test(String(id));

function toApi(row) {
  if (!row) return null;
  return {
    _id: row.mongo_id || String(row.id),
    id: row.mongo_id || String(row.id),
    shopName: row.shop_name || '',
    lakalaShopNo: row.lakala_shop_no || '',
    terminalNo: row.terminal_no || '',
    wechatMerchantNo: row.wechat_merchant_no || '',
    alipayMerchantNo: row.alipay_merchant_no || '',
    phone: row.phone || '',
    contactName: row.contact_name || '',
    date: row.date || '',
    idNumber: row.id_number || '',
    idCardImages: row.id_card_images || [],
    bankCardImages: row.bank_card_images || [],
    qrCodeImages: row.qr_code_images || [],
    businessCategory: row.business_category || '',
    sortOrder: row.sort_order || 0,
    address: row.address || '',
    longitude: row.longitude,
    latitude: row.latitude,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    async save() {
      await pgQuery(`UPDATE ${TABLE} SET shop_name=$1, phone=$2, contact_name=$3, sort_order=$4, updated_at=NOW() WHERE id=$5`,
        [this.shopName, this.phone, this.contactName, this.sortOrder, row.id]);
      return this;
    },
    toObject() { return this; }
  };
}

const Shop = {
  async find(query = {}, opts = {}) {
    const where = [];
    const vals = [];
    if (query.$or) {
      const ors = query.$or.map(c => {
        const k = Object.keys(c)[0];
        const v = c[k];
        const colMap = { shopName: 'shop_name', contactName: 'contact_name', phone: 'phone' };
        vals.push(`%${v.$regex || v}%`);
        return `${colMap[k] || k} ILIKE $${vals.length}`;
      });
      where.push(`(${ors.join(' OR ')})`);
    }
    let sql = `SELECT * FROM ${TABLE}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY sort_order ASC';
    const r = await pgQuery(sql, vals);
    return (r.data || r.rows || []).map(toApi);
  },

  async findById(id) {
    const num = isNumId(id);
    const r = await pgQuery(
      `SELECT * FROM ${TABLE} WHERE mongo_id = $1${num ? ' OR id = $1::bigint' : ''} LIMIT 1`,
      [id]);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },

  async findByIdAndUpdate(id, update, opts = {}) {
    const sets = ['updated_at = NOW()'];
    const vals = [];
    const fieldMap = { shopName:'shop_name', lakalaShopNo:'lakala_shop_no', terminalNo:'terminal_no', wechatMerchantNo:'wechat_merchant_no', alipayMerchantNo:'alipay_merchant_no', phone:'phone', contactName:'contact_name', date:'date', idNumber:'id_number', idCardImages:'id_card_images', bankCardImages:'bank_card_images', qrCodeImages:'qr_code_images', businessCategory:'business_category', sortOrder:'sort_order', address:'address', longitude:'longitude', latitude:'latitude' };
    for (const [k, v] of Object.entries(update)) {
      if (fieldMap[k] !== undefined) {
        const val = (typeof v === 'object' && !Array.isArray(v)) ? JSON.stringify(v) : (Array.isArray(v) ? JSON.stringify(v) : v);
        vals.push(val);
        sets.push(`${fieldMap[k]} = $${vals.length}`);
      }
    }
    vals.push(id);
    const num = isNumId(id);
    const r = await pgQuery(
      `UPDATE ${TABLE} SET ${sets.join(', ')} WHERE mongo_id = $${vals.length}${num ? ` OR id = $${vals.length}::bigint` : ''} RETURNING *`,
      vals);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },

  async findByIdAndDelete(id) {
    const num = isNumId(id);
    const r = await pgQuery(
      `DELETE FROM ${TABLE} WHERE mongo_id = $1${num ? ' OR id = $1::bigint' : ''} RETURNING *`,
      [id]);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },

  async create(data) {
    const mongoId = data._id || crypto.randomBytes(12).toString('hex');
    const r = await pgQuery(
      `INSERT INTO ${TABLE} (mongo_id, shop_name, lakala_shop_no, terminal_no, wechat_merchant_no, alipay_merchant_no, phone, contact_name, date, id_number, id_card_images, bank_card_images, qr_code_images, business_category, sort_order, address, longitude, latitude)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
      [mongoId, data.shopName||'', data.lakalaShopNo||'', data.terminalNo||'', data.wechatMerchantNo||'', data.alipayMerchantNo||'', data.phone||'', data.contactName||'', data.date||'', data.idNumber||'', JSON.stringify(data.idCardImages||[]), JSON.stringify(data.bankCardImages||[]), JSON.stringify(data.qrCodeImages||[]), data.businessCategory||'', data.sortOrder||0, data.address||'', data.longitude||null, data.latitude||null]
    );
    const rows = r.data || r.rows || [];
    return toApi(rows[0]);
  },

  async findOne(query = {}, opts = {}) {
    // opts.sort supports { sortOrder: -1 } used by shops route to compute next sortOrder
    const dir = (opts && opts.sort && opts.sort.sortOrder === -1) ? 'DESC' : 'ASC';
    const r = await pgQuery(`SELECT * FROM ${TABLE} ORDER BY sort_order ${dir} LIMIT 1`, []);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },
};

// Chainable .find().sort()
const origFind = Shop.find;
Shop.find = function(query = {}) {
  const promise = origFind(query);
  const chainable = {
    sort() { return chainable; },
    then(resolve, reject) { return promise.then(resolve, reject); },
    catch(reject) { return promise.catch(reject); },
  };
  return chainable;
};

module.exports = { ShopSchema: {}, createShopModel: () => Shop, Shop };
