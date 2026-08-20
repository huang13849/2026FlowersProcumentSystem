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
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  pool.on('error', (e) => console.error('[shop-pg] pool error:', e.message));
  return pool;
}
async function pgQuery(sql, params = []) {
  const startedAt = Date.now();
  console.log('[shop-pg] query start:', sql.replace(/\s+/g, ' ').trim().slice(0, 180));
  const r = await getPool().query(sql, params);
  console.log('[shop-pg] query ok:', Date.now() - startedAt + 'ms');
  return { data: r.rows, rows: r.rows };
}

function normalizeWriteValue(key, value) {
  if (value === undefined) return undefined;
  if (key === 'isDefault') return Boolean(value);
  if (key === 'productCategory') return value === null || value === '' ? null : Number(value);
  if (key === 'uniformPostage') return (value === null || value === undefined || value === '' || Number.isNaN(value)) ? 0 : Number(value);
  if (typeof value === 'object' && !Array.isArray(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return JSON.stringify(value);
  return value;
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
    supplierId: row.supplier_id != null ? Number(row.supplier_id) : null,
    platform: row.platform || '',
    displayName: row.display_name || '',
    status: row.status || '',
    isDefault: !!row.is_default,
    username: row.username || '',
    apiBase: row.api_base || '',
    tokenEnc: row.token_enc || '',
    cookieEnc: row.cookie_enc || '',
    appKeyEnc: row.app_key_enc || '',
    appSecretEnc: row.app_secret_enc || '',
    freightMode: row.freight_mode || '',
    freightTemplateId: row.freight_template_id || '',
    uniformPostage: row.uniform_postage != null ? String(row.uniform_postage) : '',
    afterSaleAddressId: row.after_sale_address_id || '',
    productCategory: row.product_category != null ? Number(row.product_category) : null,
    notes: row.notes || '',
    extraConfig: row.extra_config || {},
    deletedAt: row.deleted_at,
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
    if (query.platform) {
      vals.push(String(query.platform));
      where.push(`platform = $${vals.length}`);
    }
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
    sql += ' ORDER BY updated_at DESC NULLS LAST, sort_order ASC';
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
    const fieldMap = { shopName:'shop_name', lakalaShopNo:'lakala_shop_no', terminalNo:'terminal_no', wechatMerchantNo:'wechat_merchant_no', alipayMerchantNo:'alipay_merchant_no', phone:'phone', contactName:'contact_name', date:'date', idNumber:'id_number', idCardImages:'id_card_images', bankCardImages:'bank_card_images', qrCodeImages:'qr_code_images', businessCategory:'business_category', sortOrder:'sort_order', address:'address', longitude:'longitude', latitude:'latitude', supplierId:'supplier_id', platform:'platform', displayName:'display_name', status:'status', isDefault:'is_default', username:'username', apiBase:'api_base', token:'token_enc', tokenEnc:'token_enc', cookie:'cookie_enc', cookieEnc:'cookie_enc', appKey:'app_key_enc', appKeyEnc:'app_key_enc', appSecret:'app_secret_enc', appSecretEnc:'app_secret_enc', freightMode:'freight_mode', freightTemplateId:'freight_template_id', uniformPostage:'uniform_postage', afterSaleAddressId:'after_sale_address_id', productCategory:'product_category', notes:'notes', extraConfig:'extra_config', deletedAt:'deleted_at' };
    for (const [k, v] of Object.entries(update)) {
      if (fieldMap[k] !== undefined) {
        const val = normalizeWriteValue(k, v);
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
      `INSERT INTO ${TABLE} (
        mongo_id, shop_name, lakala_shop_no, terminal_no, wechat_merchant_no, alipay_merchant_no,
        phone, contact_name, date, id_number, id_card_images, bank_card_images, qr_code_images,
        business_category, sort_order, address, longitude, latitude, supplier_id, platform,
        display_name, status, is_default, username, api_base, token_enc, cookie_enc, app_key_enc,
        app_secret_enc, freight_mode, freight_template_id, uniform_postage, after_sale_address_id,
        product_category, notes, extra_config
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36
      ) RETURNING *`,
      [
        mongoId,
        data.shopName || '',
        data.lakalaShopNo || '',
        data.terminalNo || '',
        data.wechatMerchantNo || '',
        data.alipayMerchantNo || '',
        data.phone || '',
        data.contactName || '',
        data.date || '',
        data.idNumber || '',
        JSON.stringify(data.idCardImages || []),
        JSON.stringify(data.bankCardImages || []),
        JSON.stringify(data.qrCodeImages || []),
        data.businessCategory || '',
        data.sortOrder || 0,
        data.address || '',
        data.longitude || null,
        data.latitude || null,
        data.supplierId || null,
        data.platform || 'legacy',
        data.displayName || '',
        data.status || 'active',
        Boolean(data.isDefault),
        data.username || '',
        data.apiBase || '',
        data.token || data.tokenEnc || '',
        data.cookie || data.cookieEnc || '',
        data.appKey || data.appKeyEnc || '',
        data.appSecret || data.appSecretEnc || '',
        data.freightMode || 'uniform',
        data.freightTemplateId || '',
        normalizeWriteValue('uniformPostage', data.uniformPostage),
        data.afterSaleAddressId || '',
        normalizeWriteValue('productCategory', data.productCategory),
        data.notes || '',
        JSON.stringify(data.extraConfig || {}),
      ]
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

  // ── Supplier ↔ Shop 关联 (PG 原生整数 FK, 不用 mongo_id) ──
  async findBySupplierId(supplierId) {
    const r = await pgQuery(`SELECT * FROM ${TABLE} WHERE supplier_id = $1 LIMIT 1`, [supplierId]);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },

  // 查供应商信息 (suppliers 表, 同库)
  async getSupplier(supplierId) {
    const r = await pgQuery('SELECT id, name, shop_name, contact FROM public.suppliers WHERE id = $1 LIMIT 1', [supplierId]);
    const rows = r.data || r.rows || [];
    return rows[0] || null;
  },

  // 把某个已存在的 shop 关联到 supplier
  async setShopSupplier(shopId, supplierId) {
    const num = isNumId(shopId);
    const r = await pgQuery(
      `UPDATE ${TABLE} SET supplier_id = $1, updated_at = NOW() WHERE mongo_id = $2${num ? ' OR id = $2::bigint' : ''} RETURNING *`,
      [supplierId, shopId]);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },

  // 核心: 按 supplier.id 查/建/关联 shop, 一步到位
  // 返回 { shop, action: 'linked'|'matched'|'created' }
  async linkBySupplier(supplierId) {
    // 1) 已关联?
    const existing = await this.findBySupplierId(supplierId);
    if (existing) return { shop: existing, action: 'linked' };
    // 2) 供应商信息
    const sup = await this.getSupplier(supplierId);
    if (!sup) return { error: '供应商不存在', code: 404 };
    const shopName = (sup.shop_name || sup.name || '').trim();
    if (!shopName) return { error: '供应商没有店铺名/名称, 无法关联店铺', code: 400 };
    // 3) 按同名 shop 匹配 (未被别的 supplier 占用的)
    const m = await pgQuery(
      `SELECT * FROM ${TABLE} WHERE shop_name = $1 AND supplier_id IS NULL ORDER BY sort_order ASC LIMIT 1`,
      [shopName]);
    const mrows = m.data || m.rows || [];
    if (mrows[0]) {
      const linked = await this.setShopSupplier(mrows[0].mongo_id || String(mrows[0].id), supplierId);
      return { shop: linked, action: 'matched' };
    }
    // 4) 新建 shop + 关联
    let contact = {};
    try { contact = typeof sup.contact === 'string' ? JSON.parse(sup.contact) : (sup.contact || {}); } catch (e) { contact = {}; }
    const created = await this.create({
      shopName,
      contactName: contact.name || '',
      phone: contact.phone || '',
      supplierId,
    });
    return { shop: created, action: 'created' };
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
