// models/Shop.js - PG via API Gateway using native http (no axios/pg dependency)
const http = require('http');
const crypto = require('crypto');

const GATEWAY_HOST = process.env.GATEWAY_HOST || 'api-gateway.supply-chain.svc.cluster.local';
const GATEWAY_PORT = Number(process.env.GATEWAY_PORT || 3007);
const API_KEY = process.env.GATEWAY_API_KEY || '***REMOVED_API_KEY***';
const TABLE = 'shops';

function pgQuery(query, params) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ sql: query, params });
    const req = http.request({
      hostname: GATEWAY_HOST,
      port: GATEWAY_PORT,
      path: '/api/pg/supply_chain/query',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY, 'Content-Length': Buffer.byteLength(body) },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Gateway timeout')); });
    req.write(body);
    req.end();
  });
}

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
    const r = await pgQuery(`SELECT * FROM ${TABLE} WHERE mongo_id = $1 OR id = $1::bigint LIMIT 1`, [id]);
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
    const r = await pgQuery(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE mongo_id = $${vals.length} OR id = $${vals.length}::bigint RETURNING *`, vals);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },

  async findByIdAndDelete(id) {
    const r = await pgQuery(`DELETE FROM ${TABLE} WHERE mongo_id = $1 OR id = $1::bigint RETURNING *`, [id]);
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
    let sql = `SELECT * FROM ${TABLE} ORDER BY sort_order DESC LIMIT 1`;
    const r = await pgQuery(sql, []);
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
