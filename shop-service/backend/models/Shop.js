// models/Shop.js - Direct PG connection (pg Pool). Writes must NOT go through
// api-gateway /api/pg/:db/query which is SELECT-only (returns 403 on INSERT/UPDATE/DELETE).
const { Pool } = require('pg');
const crypto = require('crypto');

const TABLE = 'shops';

// 自动迁移: 花像花木外部订单同步需要的 3 个列
async function ensureHuaxiangSchema() {
  const alters = [
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS huaxiang_api_base TEXT DEFAULT 'http://adminapi.huaxianghuamu.cn/'",
    'ALTER TABLE shops ADD COLUMN IF NOT EXISTS huaxiang_api_token TEXT',
    'ALTER TABLE shops ADD COLUMN IF NOT EXISTS huaxiang_platform_id TEXT',
    'ALTER TABLE shops ADD COLUMN IF NOT EXISTS huaxiang_cookie TEXT',
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT ''",
    "CREATE INDEX IF NOT EXISTS idx_shops_platform ON shops(platform) WHERE platform <> ''",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT ''",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS username TEXT DEFAULT ''",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS freight_mode TEXT DEFAULT 'uniform'",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS freight_template_id INTEGER DEFAULT 216",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS uniform_postage NUMERIC(10,2) DEFAULT 0",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''",
    "ALTER TABLE shops ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb",
    "CREATE INDEX IF NOT EXISTS idx_shops_tags ON shops USING gin (tags jsonb_path_ops)",
  ];
  for (const sql of alters) {
    try { await getPool().query(sql); } catch (e) { console.warn('[huaxiang schema]', e.message); }
  }
}
// 启动时同步迁移 (延迟到 Pool 创建后, 详见底部)

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
    supplierId: row.supplier_id != null ? Number(row.supplier_id) : null,
    // 花像花木外部订单同步 (admin 页面 → purchase_orders)
    huaxiangApiBase: row.huaxiang_api_base || 'http://adminapi.huaxianghuamu.cn/',
    huaxiangApiToken: row.huaxiang_api_token || '',
    huaxiangCookie: row.huaxiang_cookie || '',
    huaxiangPlatformId: row.huaxiang_platform_id || '',
    platform: row.platform || '',
    displayName: row.display_name || '',
    username: row.username || '',
    isDefault: !!row.is_default,
    status: row.status || 'active',
    freightMode: row.freight_mode || 'uniform',
    freightTemplateId: row.freight_template_id || 216,
    uniformPostage: Number(row.uniform_postage || 0),
    notes: row.notes || '',
    tags: Array.isArray(row.tags) ? row.tags : (typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : []),
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
    if (query.platform) {
      vals.push(String(query.platform));
      where.push(`platform = $${vals.length}`);
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
    const fieldMap = { shopName:'shop_name', lakalaShopNo:'lakala_shop_no', terminalNo:'terminal_no', wechatMerchantNo:'wechat_merchant_no', alipayMerchantNo:'alipay_merchant_no', phone:'phone', contactName:'contact_name', date:'date', idNumber:'id_number', idCardImages:'id_card_images', bankCardImages:'bank_card_images', qrCodeImages:'qr_code_images', businessCategory:'business_category', sortOrder:'sort_order', address:'address', longitude:'longitude', latitude:'latitude', supplierId:'supplier_id', huaxiangApiBase:'huaxiang_api_base', huaxiangApiToken:'huaxiang_api_token', huaxiangCookie:'huaxiang_cookie', huaxiangPlatformId:'huaxiang_platform_id', tags:'tags', platform:'platform',
   apiBase:'huaxiang_api_base', token:'huaxiang_api_token', cookie:'huaxiang_cookie',
   displayName:'display_name', username:'username', isDefault:'is_default', status:'status', notes:'notes',
   freightMode:'freight_mode', freightTemplateId:'freight_template_id', uniformPostage:'uniform_postage' };
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
      `INSERT INTO ${TABLE} (mongo_id, shop_name, lakala_shop_no, terminal_no, wechat_merchant_no, alipay_merchant_no, phone, contact_name, date, id_number, id_card_images, bank_card_images, qr_code_images, business_category, sort_order, address, longitude, latitude, supplier_id, huaxiang_api_base, huaxiang_api_token, huaxiang_cookie, huaxiang_platform_id, tags, platform, display_name, username, is_default, status, freight_mode, freight_template_id, uniform_postage, notes)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23) RETURNING *`,
      [mongoId, data.shopName||'', data.lakalaShopNo||'', data.terminalNo||'', data.wechatMerchantNo||'', data.alipayMerchantNo||'', data.phone||'', data.contactName||'', data.date||'', data.idNumber||'', JSON.stringify(data.idCardImages||[]), JSON.stringify(data.bankCardImages||[]), JSON.stringify(data.qrCodeImages||[]), data.businessCategory||'', data.sortOrder||0, data.address||'', data.longitude||null, data.latitude||null, data.supplierId||null, data.huaxiangApiBase||'http://adminapi.huaxianghuamu.cn/', data.huaxiangApiToken||'', data.huaxiangCookie||'', data.huaxiangPlatformId||'', JSON.stringify(data.tags||[]), data.platform||'',
   data.displayName||'', data.username||'', data.isDefault===true, data.status||'active',
   data.freightMode||'uniform', data.freightTemplateId||216, data.uniformPostage||0, data.notes||'']
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

  // ── Tag operations ──
  async setTags(id, tags) {
    const arr = Array.isArray(tags) ? tags : [];
    const num = isNumId(id);
    const r = await pgQuery(
      `UPDATE ${TABLE} SET tags = $1::jsonb, updated_at = NOW() WHERE mongo_id = $2${num ? ' OR id = $2::bigint' : ''} RETURNING *`,
      [JSON.stringify(arr), id]);
    const rows = r.data || r.rows || [];
    return rows[0] ? toApi(rows[0]) : null;
  },

  async batchSetTags(ids, tags, mode = 'add') {
    if (!Array.isArray(ids) || !ids.length) return { updated: 0 };
    const tagArr = Array.isArray(tags) ? tags : [];
    const numIds = ids.filter(isNumId);
    const strIds = ids.filter(id => !isNumId(id));
    let r;
    if (mode === 'set') {
      r = await pgQuery(
        `UPDATE ${TABLE} SET tags = $1::jsonb, updated_at = NOW()
          WHERE (mongo_id = ANY($2::text[]) OR id = ANY($3::bigint[]))
          RETURNING id`,
        [JSON.stringify(tagArr), strIds, numIds]);
    } else if (mode === 'add') {
      r = await pgQuery(
        `UPDATE ${TABLE} SET tags = (COALESCE(tags, '[]'::jsonb) || $1::jsonb), updated_at = NOW()
          WHERE (mongo_id = ANY($2::text[]) OR id = ANY($3::bigint[]))
          RETURNING id`,
        [JSON.stringify(tagArr), strIds, numIds]);
    } else {
      r = await pgQuery(
        `UPDATE ${TABLE} SET tags = (COALESCE(tags, '[]'::jsonb) - $1::text[]), updated_at = NOW()
          WHERE (mongo_id = ANY($2::text[]) OR id = ANY($3::bigint[]))
          RETURNING id`,
        [tagArr, strIds, numIds]);
    }
    const rows = r.data || r.rows || [];
    return { updated: rows.length };
  },

  async batchDelete(ids) {
    if (!Array.isArray(ids) || !ids.length) return { deleted: 0 };
    const numIds = ids.filter(isNumId);
    const strIds = ids.filter(id => !isNumId(id));
    const r = await pgQuery(
      `DELETE FROM ${TABLE}
        WHERE (mongo_id = ANY($1::text[]) OR id = ANY($2::bigint[]))
        RETURNING id`,
      [strIds, numIds]);
    const rows = r.data || r.rows || [];
    return { deleted: rows.length, ids: rows.map(rr => String(rr.id)) };
  },

  // ── Publish credentials (read-only) ──
  // 公开给同集群内的 publish-service 调用: 列出所有 huaxiang 平台凭证
  async listHuaxiangCredentials() {
    const r = await pgQuery(
      `SELECT id, mongo_id, shop_name, huaxiang_api_base, huaxiang_api_token, huaxiang_cookie, huaxiang_platform_id
         FROM ${TABLE}
        WHERE huaxiang_platform_id IS NOT NULL AND huaxiang_platform_id <> ''
        ORDER BY shop_name`);
    const rows = r.data || r.rows || [];
    return rows.map(row => ({
      shopId: row.mongo_id || String(row.id),
      shopName: row.shop_name,
      platformId: row.huaxiang_platform_id,
      apiBase: row.huaxiang_api_base || 'http://adminapi.huaxianghuamu.cn/',
      token: row.huaxiang_api_token || '',
      cookie: row.huaxiang_cookie || '',
    }));
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

// 延迟到下个事件循环 (此时 getPool 已被 require 过, Pool 已就绪)
setImmediate(() => {
  ensureHuaxiangSchema().catch(e => console.warn('[huaxiang schema] init failed:', e.message));
});

module.exports = { ShopSchema: {}, createShopModel: () => Shop, Shop, pgQuery };
