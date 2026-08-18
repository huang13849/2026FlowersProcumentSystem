/**
 * Order Service - 购买订单管理微服务
 * 通过 API Gateway CRUD 端点访问 PostgreSQL
 * JSONB 字段 (product_id, product_title) 直连 PG 写入
 */
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { Pool } = require('pg');
const { resolveServiceBase } = require('./nacosResolver');

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
const API_KEY = process.env.API_KEY || (function(){throw new Error('API_KEY env required')}());
const DB_NAME = process.env.PG_DATABASE || 'supply_chain';
const TABLE_NAME = 'purchase_orders';
const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

// Direct PG pool for JSONB operations (Gateway doesn't support JSONB writes)
const pgPool = new Pool({
  host: process.env.PG_HOST || '100.67.126.90',
  port: process.env.PG_PORT || 5432,
  database: DB_NAME,
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || (function(){throw new Error('PG_PASSWORD env required')}()),
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
    'ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS synced_at TIMESTAMPTZ',
    "ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS tags JSONB DEFAULT '[]'::jsonb",
    "CREATE UNIQUE INDEX IF NOT EXISTS ux_purchase_orders_plant_collector ON purchase_orders(source_order_sn) WHERE source_table='plant_collector.orders'"
  ];
  for (const sql of alters) await pgPool.query(sql);
}

function autoDefaultTags(src = {}) {
  const inbound = Array.isArray(src.tags) ? src.tags.slice() : [];
  // Auto-tags:
  //  - 来自 all_*_order 源表 -> 北京花卉订单
  //  - 手工新增(无 source_table) -> 线下资源
  if (typeof src.source_table === 'string' && /^all_.*_order/.test(src.source_table)) {
    if (!inbound.includes('北京花卉订单')) inbound.push('北京花卉订单');
  }
  if (!src.source_table) {
    if (!inbound.includes('线下资源')) inbound.push('线下资源');
  }
  return inbound;
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
    tags: autoDefaultTags(src),
  };
}


// Update JSONB fields directly via pg

// NOTE: payment sync 已迁移到 payment-sync-worker (LISTEN pg_notify) + order-writer-consumer (NATS JetStream). 见 skill supply-chain-platform-deploy-ops §34.
async function updateJsonbFields(id, productId, productTitle) {
  const pid = Array.isArray(productId) ? productId : [];
  const ptitle = Array.isArray(productTitle) ? productTitle : [];
  await pgPool.query(
    'UPDATE purchase_orders SET product_id = $1::jsonb, product_title = $2::jsonb, updated_at = NOW() WHERE id = $3',
    [JSON.stringify(pid), JSON.stringify(ptitle), id]
  );
}

async function updateTagsField(id, tags) {
  const arr = Array.isArray(tags) ? tags : [];
  await pgPool.query(
    'UPDATE purchase_orders SET tags = $1::jsonb, updated_at = NOW() WHERE id = $2',
    [JSON.stringify(arr), id]
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

async function enrichCostProfit(rows) {
  // 收集所有需要补 cost 的 mongo_id / product_id
  const need = rows.filter(r => (Number(r.cost_amount || 0) === 0) && Array.isArray(r.product_id) && r.product_id.length);
  if (!need.length) return rows;
  const ids = [...new Set(need.flatMap(r => r.product_id.filter(Boolean)))];
  if (!ids.length) return rows;
  try {
    const q = await pgPool.query(
      `SELECT mongo_id, product_id, id::text AS pid, cost_price, sell_price, settlement_price
         FROM products
        WHERE mongo_id = ANY($1::text[]) OR product_id = ANY($1::text[]) OR id::text = ANY($1::text[])`,
      [ids]
    );
    const map = new Map();
    for (const row of q.rows) {
      const cost = Number(row.cost_price || row.settlement_price || 0);
      [row.mongo_id, row.product_id, row.pid].forEach(k => { if (k && !map.has(k)) map.set(k, cost); });
    }
    for (const r of need) {
      let total = 0;
      for (const pid of r.product_id) { if (map.has(pid)) total += map.get(pid); }
      if (total > 0) {
        r.cost_amount = total.toFixed(2);
        // 利润只在未手动填过 (=0) 时重算; 否则保留用户填的值
        if (Number(r.profit_amount || 0) === 0) {
          r.profit_amount = (Number(r.income_amount || r.product_subtotal || 0) - total).toFixed(2);
        }
        r._cost_from_join = true;
      }
    }
  } catch (e) {
    console.warn('[enrichCostProfit] failed:', e.message);
  }
  return rows;
}

async function queryOrders({ page = 1, limit = 20, search, business_type, region, shop_name, month, tag, dedupe = 'true', readFrom }) {
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
  if (month && /^\d{4}-\d{2}$/.test(month)) {
    params.push(month + '-01');
    conditions.push(`purchase_time >= $${params.length}::date AND purchase_time < ($${params.length}::date + INTERVAL '1 month')`);
  }
  if (tag && tag !== '全部') { params.push(tag); conditions.push(`tags @> to_jsonb(ARRAY[$${params.length}::text])`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const useDedupe = String(dedupe) !== 'false';
  const countSql = useDedupe
    ? `SELECT COUNT(*)::int AS total FROM (SELECT DISTINCT ON (COALESCE(NULLIF(source_order_sn,''), 'id-'||id)) id FROM purchase_orders ${where} ORDER BY COALESCE(NULLIF(source_order_sn,''), 'id-'||id), id DESC) t`
    : `SELECT COUNT(*)::int AS total FROM purchase_orders ${where}`;
  const dataSql = useDedupe
    ? `WITH deduped AS (SELECT DISTINCT ON (COALESCE(NULLIF(source_order_sn,''), 'id-'||id)) * FROM purchase_orders ${where} ORDER BY COALESCE(NULLIF(source_order_sn,''), 'id-'||id), id DESC) SELECT * FROM deduped ORDER BY COALESCE(purchase_time, created_at) DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    : `SELECT * FROM purchase_orders ${where} ORDER BY COALESCE(purchase_time, created_at) DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
  const countResult = await pgPool.query(countSql, params);
  const dataResult = await pgPool.query(dataSql, [...params, limitNum, offset]);
  const total = countResult.rows[0]?.total || 0;
  await enrichCostProfit(dataResult.rows);
  const result = { data: dataResult.rows, total, page: pageNum, limit: limitNum, pages: Math.ceil(total / limitNum), readFrom: 'primary' };
  return normalizeOrderList(result);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service', timestamp: new Date().toISOString() });
});

app.get('/api/orders', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, business_type, region, shop_name, month, tag, dedupe, readFrom } = req.query;
    const result = await queryOrders({ page, limit, search, business_type, region, shop_name, month, tag, dedupe, readFrom: readFrom || 'primary' });
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
    const fields = pickOrderFields(req.body);
    const defaultTags = fields.tags;
    delete fields.tags;  // gateway PG POST can't serialise jsonb array; write directly
    const result = await axiosWithRetry({ url, method: 'post', data: fields, headers, timeout: 15000 });
    const newId = result.data?.data?.id;
    if (newId && Array.isArray(defaultTags) && defaultTags.length) {
      await updateTagsField(newId, defaultTags);
      if (result.data?.data) result.data.data.tags = defaultTags;
    }
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
    // Handle tags jsonb directly (avoid gateway PG array serialisation issue)
    if ('tags' in body) {
      await updateTagsField(id, body.tags);
      delete body.tags;
      // If tags-only update, return early
      if (Object.keys(body).length === 0) {
        const getUrl = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${id}?readFrom=standby`;
        const getResult = await axiosWithRetry({ url: getUrl, method: 'get', headers, timeout: 15000 });
        normalizeOrderList(getResult.data);
        return res.json(getResult.data);
      }
    }
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

app.get('/api/orders/stats/tags', async (req, res) => {
  try {
    const { rows } = await pgPool.query(`
      SELECT tag, COUNT(DISTINCT order_key)::int AS count FROM (
        SELECT COALESCE(NULLIF(source_order_sn,''), 'id-'||id) AS order_key,
               jsonb_array_elements_text(COALESCE(tags,'[]'::jsonb)) AS tag
          FROM purchase_orders
      ) t
      WHERE tag IS NOT NULL AND tag <> ''
      GROUP BY tag ORDER BY count DESC
    `);
    res.json({ success: true, data: rows });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/orders/stats/business-type', async (req, res) => {
  try {
    const { rows } = await pgPool.query(`
      SELECT business_type, COUNT(*)::int AS count
        FROM purchase_orders
       WHERE COALESCE(order_status,'') <> '关闭'
       GROUP BY business_type
       ORDER BY count DESC`);
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Aggregate sum of income_amount and expense_amount
app.get('/api/orders/stats/amount', async (req, res) => {
  try {
    const { search, business_type, region, shop_name, month, tag } = req.query;
    const conditions = [`COALESCE(order_status,'') <> '关闭'`];
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      conditions.push(`(member_name ILIKE $${params.length} OR phone ILIKE $${params.length} OR consignee ILIKE $${params.length} OR source_order_sn ILIKE $${params.length} OR shop_name ILIKE $${params.length})`);
    }
    if (business_type && business_type !== '全部') { params.push(business_type); conditions.push(`business_type = $${params.length}`); }
    if (region && region !== 'all') { params.push(region); conditions.push(`region = $${params.length}`); }
    if (shop_name && shop_name !== '全部') { params.push(shop_name); conditions.push(`shop_name = $${params.length}`); }
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      params.push(month + '-01');
      conditions.push(`purchase_time >= $${params.length}::date AND purchase_time < ($${params.length}::date + INTERVAL '1 month')`);
    }
    if (tag && tag !== '全部') { params.push(tag); conditions.push(`tags @> to_jsonb(ARRAY[$${params.length}::text])`); }
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
    const productServiceUrl = await resolveServiceBase({ serviceName: process.env.PRODUCT_SERVICE_NAME || 'k8s.supply-chain.product-api-service', fallbackUrl: process.env.PRODUCT_SERVICE_URL || 'http://product-service.supply-chain.svc.cluster.local:3000' });
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
    
// ============ 同步 plant_collector.orders(paid) → purchase_orders ============
app.post('/api/orders/export-settlement', async (req, res) => {
  try {
    const { ids, filter } = req.body || {};
    const params = [];
    const clauses = [];
    if (Array.isArray(ids) && ids.length) {
      params.push(ids);
      clauses.push(`id = ANY($${params.length}::int[])`);
    } else if (filter) {
      if (filter.region) { params.push(filter.region); clauses.push(`region = $${params.length}`); }
      if (filter.business_type && filter.business_type !== '全部') { params.push(filter.business_type); clauses.push(`business_type = $${params.length}`); }
      if (filter.shop_name && filter.shop_name !== '全部') { params.push(filter.shop_name); clauses.push(`shop_name = $${params.length}`); }
      if (filter.month) {
        params.push(filter.month + '-01'); clauses.push(`purchase_time >= $${params.length}::timestamp`);
        params.push(filter.month + '-01'); clauses.push(`purchase_time < ($${params.length}::timestamp + interval '1 month')`);
      }
      if (filter.search) {
        params.push('%' + filter.search + '%');
        const idx = params.length;
        clauses.push(`(shop_name ILIKE $${idx} OR consignee ILIKE $${idx} OR member_name ILIKE $${idx} OR phone ILIKE $${idx} OR payment_order_id ILIKE $${idx})`);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const sql = `SELECT id, payment_order_id, source_order_sn, member_id, member_name, consignee, phone, delivery_address, shop_name, business_type, product_title, product_id, product_subtotal, shipping_fee, coupon_discount, income_amount, cost_amount, profit_amount, payment_channel, order_status, shipping_status, pay_status, personal_tag, tags, region, purchase_time FROM purchase_orders ${where} ORDER BY purchase_time DESC LIMIT 5000`;
    const { rows } = await pgPool.query(sql, params);
    await enrichCostProfit(rows);
    res.json({ success: true, data: rows, count: rows.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/orders/export-purchase-list', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids[] required' });
    const { rows } = await pgPool.query(
      `SELECT id, source_order_sn, consignee, phone, delivery_address, product_subtotal,
              purchase_time, synced_at, shop_name, product_title, synced_payload
         FROM purchase_orders WHERE id = ANY($1::int[]) ORDER BY purchase_time DESC`,
      [ids]
    );
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// periodic payment→purchase sync

app.listen(PORT, () => {
      console.log(`🛒 Order Service running on port ${PORT}`);
      console.log(`📡 API Gateway: ${GATEWAY_URL}`);
      console.log(`🗄️  Database: ${DB_NAME}.${TABLE_NAME}`);
      console.log(`🐘 Direct PG: ${process.env.PG_HOST || '100.67.126.90'}:5432`);
    });
  });
