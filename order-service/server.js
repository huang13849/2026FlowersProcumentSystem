/**
 * Order Service - 购买订单管理微服务
 * 通过 API Gateway CRUD 端点访问 PostgreSQL
 * JSONB 字段 (product_id, product_title) 直连 PG 写入
 */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');

async function axiosWithRetry(config, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await axios(config);
    } catch (err) {
      if (i === retries || !err.code || !['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET'].includes(err.code)) throw err;
      await new Promise(r => setTimeout(r, 500 * (i + 1)));
    }
  }
}

const app = express();
app.use(express.static('public'));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3007';
const API_KEY = process.env.API_KEY || '***REMOVED_API_KEY***';
const DB_NAME = process.env.PG_DATABASE || 'supply_chain';
const TABLE_NAME = 'purchase_orders';
const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

// Direct PG pool for JSONB operations (Gateway doesn't support JSONB writes)
const pgPool = new Pool({
  host: process.env.PG_HOST || '100.67.126.90',
  port: process.env.PG_PORT || 5432,
  database: DB_NAME,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || process.env.POSTGRES_PASSWORD || '***REMOVED_PG_PW***',
  max: 5,
  idleTimeoutMillis: 30000,
});

async function ensureOrderSchema() {
  const alters = [
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS income_amount NUMERIC(12,2) DEFAULT 0',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expense_amount NUMERIC(12,2) DEFAULT 0',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_order_id VARCHAR(80)',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS payment_channel VARCHAR(40)',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS product_subtotal NUMERIC(12,2) DEFAULT 0',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_fee NUMERIC(12,2) DEFAULT 0',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS coupon_code VARCHAR(80)',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS coupon_discount NUMERIC(12,2) DEFAULT 0',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS cost_amount NUMERIC(12,2) DEFAULT 0',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS profit_amount NUMERIC(12,2) DEFAULT 0',
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS region VARCHAR(20) DEFAULT 'cn'",
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source_table TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source_order_key TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source_order_id TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source_order_sn TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source_shop_id TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shop_name TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shop_phone TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS consignee TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS order_status TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS shipping_status TEXT',
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS pay_status TEXT',
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS synced_payload JSONB DEFAULT '{}'::jsonb",
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ'
  ];
  for (const sql of alters) await pgPool.query(sql);
}

function pickOrderFields(src = {}) {
  return {
    member_id: src.member_id || '',
    member_name: src.member_name || '',
    phone: src.phone || '',
    business_type: src.business_type || '未设置',
    purchase_time: src.purchase_time || new Date().toISOString(),
    delivery_address: src.delivery_address || '',
    personal_tag: src.personal_tag || '',
    income_amount: src.income_amount != null ? src.income_amount : 0,
    expense_amount: src.expense_amount != null ? src.expense_amount : 0,
    payment_order_id: src.payment_order_id || '',
    payment_channel: src.payment_channel || '',
    product_subtotal: src.product_subtotal != null ? src.product_subtotal : 0,
    shipping_fee: src.shipping_fee != null ? src.shipping_fee : 0,
    coupon_code: src.coupon_code || '',
    coupon_discount: src.coupon_discount != null ? src.coupon_discount : 0,
    cost_amount: src.cost_amount != null ? src.cost_amount : 0,
    profit_amount: src.profit_amount != null ? src.profit_amount : 0,
    region: src.region || 'cn',
    source_table: src.source_table || null,
    source_order_key: src.source_order_key || null,
    source_order_id: src.source_order_id || null,
    source_order_sn: src.source_order_sn || null,
    source_shop_id: src.source_shop_id || null,
    shop_name: src.shop_name || '',
    shop_phone: src.shop_phone || '',
    consignee: src.consignee || '',
    order_status: src.order_status || '',
    shipping_status: src.shipping_status || '',
    pay_status: src.pay_status || '',
    synced_at: src.synced_at || null,
  };
}


// Update JSONB fields directly via pg
async function updateJsonbFields(id, productId, productTitle) {
  const pid = Array.isArray(productId) ? productId : [];
  const ptitle = Array.isArray(productTitle) ? productTitle : [];
  await pgPool.query(
    'UPDATE purchase_orders SET product_id = $1::jsonb, product_title = $2::jsonb, updated_at = NOW() WHERE id = $3',
    [JSON.stringify(pid), JSON.stringify(ptitle), id]
  );
}

// Normalize JSONB fields: API Gateway may turn [] into {}
function normalizeOrder(o) {
  if (!o) return o;
  ['product_id', 'product_title'].forEach(k => {
    if (!o[k] || (typeof o[k] === 'object' && !Array.isArray(o[k]))) o[k] = [];
  });
  return o;
}

function normalizeOrderList(result) {
  if (result && result.data && Array.isArray(result.data)) {
    result.data.forEach(normalizeOrder);
  } else if (result && result.data && typeof result.data === 'object') {
    normalizeOrder(result.data);
  }
  return result;
}

async function queryOrders({ page = 1, limit = 20, search, business_type, region, shop_name, readFrom }) {
  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 200);
  const offset = (pageNum - 1) * limitNum;
  const conditions = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    conditions.push(`(member_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR consignee ILIKE $${params.length} OR source_order_sn ILIKE $${params.length} OR shop_name ILIKE $${params.length})`);
  }
  if (business_type && business_type !== '全部') { params.push(business_type); conditions.push(`business_type = $${params.length}`); }
  if (region && region !== 'all') { params.push(region); conditions.push(`region = $${params.length}`); }
  if (shop_name && shop_name !== '全部') { params.push(shop_name); conditions.push(`shop_name = $${params.length}`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const countSql = `SELECT COUNT(*)::int AS total FROM purchase_orders ${where}`;
  const dataSql = `SELECT * FROM purchase_orders ${where} ORDER BY COALESCE(purchase_time, created_at) DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const countResult = await pgPool.query(countSql, params);
  const dataResult = await pgPool.query(dataSql, [...params, limitNum, offset]);
  const total = countResult.rows[0]?.total || 0;
  const result = { data: dataResult.rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum), readFrom: 'primary' };
  return normalizeOrderList(result);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service', timestamp: new Date().toISOString() });
});

app.get('/api/orders', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, business_type, region, shop_name, readFrom } = req.query;
    const result = await queryOrders({ page, limit, search, business_type, region, shop_name, readFrom: readFrom || 'primary' });
    res.json(result);
  } catch (err) {
    console.error('GET /api/orders error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});


app.get('/api/orders/sync-status', async (req, res) => {
  try {
    const runSql = `
      SELECT source_table, scanned_count, matched_count, inserted_count, updated_count,
             status, started_at, finished_at, error_message, git_sha, image_tag
      FROM order_sync_runs
      ORDER BY started_at DESC
      LIMIT 1
    `;
    const stateSql = `
      SELECT source_table, last_seen_value, last_run_at
      FROM order_sync_state
      ORDER BY last_run_at DESC
      LIMIT 1
    `;
    const latestOrderSql = `
      SELECT source_table, source_order_sn, shop_name, consignee, purchase_time, synced_at, created_at
      FROM purchase_orders
      WHERE source_table IS NOT NULL
      ORDER BY COALESCE(synced_at, created_at) DESC
      LIMIT 1
    `;

    const [runResult, stateResult, latestOrderResult] = await Promise.all([
      pgPool.query(runSql).catch(err => ({ rows: [], error: err })),
      pgPool.query(stateSql).catch(err => ({ rows: [], error: err })),
      pgPool.query(latestOrderSql).catch(err => ({ rows: [], error: err })),
    ]);

    const latestRun = runResult.rows?.[0] || null;
    const state = stateResult.rows?.[0] || null;
    const latestOrder = latestOrderResult.rows?.[0] || null;
    res.json({
      latestRun,
      state,
      latestOrder,
      now: new Date().toISOString(),
      errors: {
        latestRun: runResult.error?.message,
        state: stateResult.error?.message,
        latestOrder: latestOrderResult.error?.message,
      },
    });
  } catch (err) {
    console.error('GET /api/orders/sync-status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/:id', async (req, res) => {
  try {
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${req.params.id}?readFrom=standby`;
    const result = await axiosWithRetry({ url, method: 'get', headers, timeout: 15000 });
    normalizeOrderList(result.data);
    res.json(result.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

app.post('/api/orders', async (req, res) => {
  try {
    const { product_id, product_title } = req.body;
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}`;
    const result = await axiosWithRetry({ url, method: 'post', data: pickOrderFields(req.body), headers, timeout: 15000 });
    const newId = result.data?.data?.id;
    // Write JSONB fields directly
    if (newId && Array.isArray(product_id) && product_id.length > 0) {
      await updateJsonbFields(newId, product_id, product_title);
    }
    normalizeOrder(result.data);
    res.status(201).json(result.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

app.post('/api/orders/batch', async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) return res.status(400).json({ error: '请提供订单数组' });
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}`;
    const results = []; const errors = [];
    for (const order of orders) {
      try {
        const { product_id, product_title } = order;
        const createResult = await axiosWithRetry({ url, method: 'post', data: pickOrderFields(order), headers, timeout: 15000 });
        const newId = createResult.data?.data?.id;
        if (newId && Array.isArray(product_id) && product_id.length > 0) {
          await updateJsonbFields(newId, product_id, product_title);
        }
        results.push(member_id);
      } catch (err) {
        errors.push({ member_id: order.member_id, error: err.response?.data?.error || err.message });
      }
    }
    res.status(201).json({ created: results.length, failed: errors.length, errors: errors.length > 0 ? errors : undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Duplicate selected order rows
app.post('/api/orders/duplicate', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请提供ID数组' });
    const created = [];
    for (const id of ids) {
      try {
        const getUrl = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${id}?readFrom=standby`;
        const getResult = await axiosWithRetry({ url: getUrl, method: 'get', headers, timeout: 15000 });
        const orig = getResult.data?.data || getResult.data;
        if (!orig) continue;
        const createUrl = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}`;
        const createResult = await axiosWithRetry({ url: createUrl, method: 'post', data: pickOrderFields({ ...orig, purchase_time: new Date().toISOString(), payment_order_id: orig.payment_order_id ? `${orig.payment_order_id}-COPY` : '' }), headers, timeout: 15000 });
        const newId = createResult.data?.data?.id;
        const pid = Array.isArray(orig.product_id) ? orig.product_id : [];
        const ptitle = Array.isArray(orig.product_title) ? orig.product_title : [];
        if (newId && pid.length > 0) {
          await updateJsonbFields(newId, pid, ptitle);
        }
        created.push(newId);
      } catch (err) {
        console.error(`Duplicate id=${id} error:`, err.message);
      }
    }
    res.status(201).json({ duplicated: created.length, ids: created });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = req.body;
    const hasJsonb = ('product_id' in body) || ('product_title' in body);

    if (hasJsonb) {
      // Update JSONB directly via pg
      await updateJsonbFields(id, body.product_id, body.product_title);

      // Update other fields via Gateway
      const otherFields = { ...body, updated_at: new Date().toISOString() };
      delete otherFields.product_id;
      delete otherFields.product_title;
      if (Object.keys(otherFields).length > 0) {
        const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${id}`;
        await axiosWithRetry({ url, method: 'put', data: otherFields, headers, timeout: 15000 });
      }

      // Fetch updated record from standby
      const getUrl = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${id}?readFrom=standby`;
      const getResult = await axiosWithRetry({ url: getUrl, method: 'get', headers, timeout: 15000 });
      normalizeOrderList(getResult.data);
      res.json(getResult.data);
    } else {
      const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${id}`;
      const result = await axiosWithRetry({ url, method: 'put', data: { ...body, updated_at: new Date().toISOString() }, headers, timeout: 15000 });
      normalizeOrder(result.data);
      res.json(result.data);
    }
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

app.delete('/api/orders/:id', async (req, res) => {
  try {
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${req.params.id}`;
    const result = await axiosWithRetry({ url, method: 'delete', headers, timeout: 15000 });
    res.json(result.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

app.post('/api/orders/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: '请提供ID数组' });
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',');
    await pgPool.query(`DELETE FROM purchase_orders WHERE id IN (${placeholders})`, ids);
    res.json({ deleted: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/stats/business-type', async (req, res) => {
  try {
    const { rows } = await pgPool.query('SELECT business_type, COUNT(*) as count FROM purchase_orders GROUP BY business_type ORDER BY count DESC');
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggregate sum of income_amount and expense_amount
app.get('/api/orders/stats/amount', async (req, res) => {
  try {
    const { search, business_type, region, shop_name } = req.query;
    const conditions = [];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(member_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR consignee ILIKE $${params.length} OR source_order_sn ILIKE $${params.length} OR shop_name ILIKE $${params.length})`);
    }
    if (business_type && business_type !== '全部') { params.push(business_type); conditions.push(`business_type = $${params.length}`); }
    if (region && region !== 'all') { params.push(region); conditions.push(`region = $${params.length}`); }
    if (shop_name && shop_name !== '全部') { params.push(shop_name); conditions.push(`shop_name = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pgPool.query(
      `SELECT COALESCE(SUM(income_amount),0)::float AS total_income, COALESCE(SUM(expense_amount),0)::float AS total_expense, COALESCE(SUM(shipping_fee),0)::float AS total_shipping, COALESCE(SUM(coupon_discount),0)::float AS total_coupon, COALESCE(SUM(profit_amount),0)::float AS total_profit, COUNT(*)::int AS row_count FROM purchase_orders ${where}`,
      params
    );
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders/stats/shop-name', async (req, res) => {
  try {
    const { rows } = await pgPool.query("SELECT COALESCE(NULLIF(shop_name,''),'未关联') AS shop_name, COUNT(*)::int AS count FROM purchase_orders GROUP BY COALESCE(NULLIF(shop_name,''),'未关联') ORDER BY count DESC");
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Proxy: search products from product-service
app.get('/api/products/search', async (req, res) => {
  try {
    const { keyword = '', page = 1, limit = 20 } = req.query;
    const productServiceUrl = process.env.PRODUCT_SERVICE_URL || 'http://localhost:3001';
    const params = new URLSearchParams({ page: String(page), limit: String(limit) });
    if (keyword) params.set('search', keyword);
    const url = `${productServiceUrl}/api/products?${params.toString()}`;
    const result = await axiosWithRetry({ url, method: 'get', timeout: 15000 });
    const json = result.data;
    res.json({ data: json.products || [], total: json.total || 0, page: json.page || 1 });
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

const PORT = process.env.PORT || 3008;
ensureOrderSchema()
  .then(() => console.log('✅ Order schema ready: payment/profit columns'))
  .catch(err => console.error('⚠️ Order schema ensure failed:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🛒 Order Service running on port ${PORT}`);
      console.log(`📡 API Gateway: ${GATEWAY_URL}`);
      console.log(`🗄️  Database: ${DB_NAME}.${TABLE_NAME}`);
      console.log(`🐘 Direct PG: ${process.env.PG_HOST || '100.67.126.90'}:5432`);
    });
  });
