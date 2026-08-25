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

function toMoneyNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function computeProfitAmount(src = {}) {
  return toMoneyNumber(src.income_amount) - toMoneyNumber(src.cost_amount) - toMoneyNumber(src.coupon_discount);
}

function pickOrderFields(src = {}) {
  const fields = {
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
  fields.profit_amount = computeProfitAmount(fields);
  return fields;
}

const ORDER_MUTABLE_FIELDS = new Set([
  ...Object.keys(pickOrderFields({})),
  'product_id',
  'product_title',
]);

function filterUpdateFields(src = {}) {
  const filtered = {};
  for (const [key, value] of Object.entries(src)) {
    if (ORDER_MUTABLE_FIELDS.has(key)) filtered[key] = value;
  }
  return filtered;
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
  o.profit_amount = computeProfitAmount(o).toFixed(2);
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
        r.profit_amount = computeProfitAmount({ ...r, cost_amount: total }).toFixed(2);
        r._cost_from_join = true;
      } else {
        r.profit_amount = computeProfitAmount(r).toFixed(2);
      }
    }
  } catch (e) {
    console.warn('[enrichCostProfit] failed:', e.message);
  }
  rows.forEach(row => {
    row.profit_amount = computeProfitAmount(row).toFixed(2);
  });
  return rows;
}

async function getOrderByIdDirect(id) {
  const { rows } = await pgPool.query('SELECT * FROM purchase_orders WHERE id = $1 LIMIT 1', [id]);
  return normalizeOrder(rows[0] || null);
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
    ? `WITH deduped AS (SELECT DISTINCT ON (COALESCE(NULLIF(source_order_sn,''), 'id-'||id)) * FROM purchase_orders ${where} ORDER BY COALESCE(NULLIF(source_order_sn,''), 'id-'||id), id DESC) SELECT * FROM deduped ORDER BY (shop_name IS NULL OR shop_name = '') DESC, COALESCE(purchase_time, created_at) DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`
    : `SELECT * FROM purchase_orders ${where} ORDER BY (shop_name IS NULL OR shop_name = '') DESC, COALESCE(purchase_time, created_at) DESC, id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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
    const row = await getOrderByIdDirect(req.params.id);
    if (!row) return res.status(404).json({ error: '订单不存在' });
    res.json({ data: row });
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
    const errors = [];
    for (const id of ids) {
      try {
        const orig = await getOrderByIdDirect(id);
        if (!orig) continue;
        const createUrl = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}`;
        const duplicateFields = pickOrderFields({
          ...orig,
          purchase_time: new Date().toISOString(),
          payment_order_id: orig.payment_order_id ? `${orig.payment_order_id}-COPY` : '',
          source_table: null,
          source_order_key: null,
          source_order_id: null,
          source_order_sn: null,
          source_shop_id: null,
          synced_at: null,
          tags: Array.isArray(orig.tags) ? orig.tags : [],
        });
        const duplicateTags = duplicateFields.tags;
        delete duplicateFields.tags;
        const createResult = await axiosWithRetry({ url: createUrl, method: 'post', data: duplicateFields, headers, timeout: 15000 });
        const newId = createResult.data?.data?.id;
        const pid = Array.isArray(orig.product_id) ? orig.product_id : [];
        const ptitle = Array.isArray(orig.product_title) ? orig.product_title : [];
        if (newId && duplicateTags.length > 0) {
          await updateTagsField(newId, duplicateTags);
        }
        if (newId && pid.length > 0) {
          await updateJsonbFields(newId, pid, ptitle);
        }
        created.push(newId);
      } catch (err) {
        console.error(`Duplicate id=${id} error:`, err.message);
        errors.push({ id, error: err.response?.data?.error || err.message });
      }
    }
    res.status(201).json({ duplicated: created.length, ids: created, errors });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/orders/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const body = filterUpdateFields(req.body);
    // Handle tags jsonb directly (avoid gateway PG array serialisation issue)
    if ('tags' in body) {
      await updateTagsField(id, body.tags);
      delete body.tags;
      // If tags-only update, return early
      if (Object.keys(body).length === 0) {
        const row = await getOrderByIdDirect(id);
        if (!row) return res.status(404).json({ error: '订单不存在' });
        return res.json({ data: row });
      }
    }
    if (['income_amount', 'cost_amount', 'coupon_discount', 'profit_amount'].some(key => key in body)) {
      const current = await getOrderByIdDirect(id);
      if (!current) return res.status(404).json({ error: '订单不存在' });
      body.profit_amount = computeProfitAmount({ ...current, ...body });
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

      const row = await getOrderByIdDirect(id);
      if (!row) return res.status(404).json({ error: '订单不存在' });
      res.json({ data: row });
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
      `SELECT COALESCE(SUM(income_amount),0)::float AS total_income, COALESCE(SUM(expense_amount),0)::float AS total_expense, COALESCE(SUM(shipping_fee),0)::float AS total_shipping, COALESCE(SUM(coupon_discount),0)::float AS total_coupon, COALESCE(SUM(COALESCE(income_amount,0) - COALESCE(cost_amount,0) - COALESCE(coupon_discount,0)),0)::float AS total_profit, COUNT(*)::int AS row_count FROM purchase_orders ${where}`,
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

// Monthly aggregate: 每月订单数 / 总价 / 总成本 / 总利润 / 总运费 / 总优惠 (可选 year/business_type/region/shop_name/tag 过滤)
app.get('/api/orders/stats/monthly', async (req, res) => {
  try {
    const { year, business_type, region, shop_name, tag } = req.query;
    const conditions = [`COALESCE(order_status,'') <> '关闭'`, `purchase_time IS NOT NULL`];
    const params = [];
    if (year && /^\d{4}$/.test(year)) {
      params.push(parseInt(year, 10));
      conditions.push(`EXTRACT(YEAR FROM purchase_time) = $${params.length}`);
    }
    if (business_type && business_type !== '全部') { params.push(business_type); conditions.push(`business_type = $${params.length}`); }
    if (region && region !== 'all') { params.push(region); conditions.push(`region = $${params.length}`); }
    if (shop_name && shop_name !== '全部') { params.push(shop_name); conditions.push(`shop_name = $${params.length}`); }
    if (tag && tag !== '全部') { params.push(tag); conditions.push(`tags @> to_jsonb(ARRAY[$${params.length}::text])`); }
    const where = `WHERE ${conditions.join(' AND ')}`;
    const { rows } = await pgPool.query(
      `SELECT TO_CHAR(purchase_time, 'YYYY-MM') AS month,
              COUNT(*)::int AS order_count,
              COALESCE(SUM(income_amount),0)::float AS total_income,
              COALESCE(SUM(cost_amount),0)::float AS total_cost,
              COALESCE(SUM(COALESCE(income_amount,0) - COALESCE(cost_amount,0) - COALESCE(coupon_discount,0)),0)::float AS total_profit,
              COALESCE(SUM(shipping_fee),0)::float AS total_shipping,
              COALESCE(SUM(coupon_discount),0)::float AS total_coupon,
              COALESCE(SUM(expense_amount),0)::float AS total_expense
         FROM purchase_orders ${where}
         GROUP BY TO_CHAR(purchase_time, 'YYYY-MM')
         ORDER BY month ASC`,
      params
    );
    // 汇总
    const totals = rows.reduce((acc, r) => {
      acc.order_count += r.order_count;
      acc.total_income += r.total_income;
      acc.total_cost += r.total_cost;
      acc.total_profit += r.total_profit;
      acc.total_shipping += r.total_shipping;
      acc.total_coupon += r.total_coupon;
      acc.total_expense += r.total_expense;
      return acc;
    }, { order_count: 0, total_income: 0, total_cost: 0, total_profit: 0, total_shipping: 0, total_coupon: 0, total_expense: 0 });
    res.json({ data: rows, totals, filters: { year, business_type, region, shop_name, tag } });
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

// ============== 外部订单同步 (花像花木 admin 页面 → purchase_orders) ==============
// 源页面: https://admin.huaxianghuamu.cn/#/statcenter/porder
// 源接口: http://adminapi.huaxianghuamu.cn/weidao/weidaoyun/admin/order/finds.jhtml?platformId=X
// 鉴权: header `token` + query `token&stoken` (值是 admin 页面 cookie ajaxtoken)
// 筛选条件 (顶部): 订单状态 orderStatus / 支付方式 paymentMethod / 日期范围 startTime-endTime
//                  / 商品名称 productName / 关键词 keyword+searchStatus / 排序 sort / platformId
// 同步策略: shops 表加 huaxiang_api_token / huaxiang_api_base / huaxiang_platform_id;
//           用户在店铺管理里手动录入(尤其是"北京花卉");
//           按 source_order_sn upsert 到 purchase_orders, source_table='huaxiang_porder'

const HUAXIANG_SOURCE_TABLE = 'huaxiang_porder';

async function fetchHuaxiangShop(shopId) {
  if (!shopId) return null;
  const num = /^[0-9]+$/.test(String(shopId));
  const r = await pgPool.query(
    `SELECT id, mongo_id, shop_name,
            api_base AS huaxiang_api_base,
            token_enc AS huaxiang_api_token,
            huaxiang_cookie,
            huaxiang_platform_id
       FROM shops
      WHERE (mongo_id = $1${num ? ' OR id = $1::bigint' : ''})
      LIMIT 1`,
    [shopId]
  );
  return r.rows[0] || null;
}

async function fetchMasterShop() {
  // 直接读 huaxiang_api_token (不再 alias 自 token_enc)
  const r = await pgPool.query(
    `SELECT id, shop_name,
            api_base AS huaxiang_api_base,
            huaxiang_api_token,
            huaxiang_cookie,
            huaxiang_platform_id
       FROM shops WHERE shop_name = '北京花卉' LIMIT 1`
  );
  return r.rows[0] || null;
}

async function callHuaxiangFinds(masterShop, targetPlatformId, filters, pageNumber = 1, pageSize = 50) {
  if (!masterShop || !masterShop.huaxiang_api_token) throw new Error('主账号(北京花卉)未配置 huaxiang_api_token');
  if (!targetPlatformId) throw new Error('目标店铺缺少 huaxiang_platform_id');
  const origin = (masterShop.huaxiang_api_base || 'https://admin.huaxianghuamu.cn').replace(/\/$/, '');
  const base = origin + '/';
  const token = masterShop.huaxiang_api_token;
  // 完整 cookie 串 (从 shops.huaxiang_cookie 读), fallback 至少带上 ajaxtoken
  const cookieExtra = masterShop.huaxiang_cookie && masterShop.huaxiang_cookie.trim()
    ? masterShop.huaxiang_cookie.trim()
    : 'ajaxtoken=' + token;
  const url = `${base}weidao/weidaoyun/admin/order/findPlatformOrders.jhtml?platformId=${encodeURIComponent(targetPlatformId)}&token=${encodeURIComponent(token)}&stoken=${encodeURIComponent(token)}`;

  // body: JSON 格式 (上游 huaxianghuamu.cn 只认 application/json,form-urlencoded 会 500)
  const body = {
    pageNumber: Number(pageNumber) || 1,
    pageSize: Number(pageSize) || 50,
    paymentMethod: Number(filters.paymentMethod || 0),
    orderStatus: filters.orderStatus === '' || filters.orderStatus == null ? 0 : Number(filters.orderStatus),
    needTotal: 1,
    shippingMethodName: filters.shippingMethodName || '',
  };
  if (filters.sort) body.sort = 1;
  if (filters.startTime) body.startTime = filters.startTime;
  if (filters.endTime) body.endTime = filters.endTime;
  if (filters.productName) body.productName = filters.productName;
  if (filters.keyword) {
    body.keyword = filters.keyword;
    body.searchStatus = Number(filters.searchStatus || 0);
  } else if (filters.searchStatus !== '' && filters.searchStatus != null) {
    body.searchStatus = Number(filters.searchStatus);
  }

  const res = await axios({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'token': token,
      'Cookie': cookieExtra,
      'Origin': origin,
      'Referer': origin + '/',
      'User-Agent': 'order-service/sync',
    },
    data: body,  // axios 会自动 JSON.stringify + 设 content-type (但我们上面已显式设了)
    timeout: 20000,
    validateStatus: () => true,
  });
  if (res.status !== 200) {
    throw new Error(`上游 HTTP ${res.status}: ${typeof res.data === 'string' ? res.data.slice(0,200) : ''}`);
  }
  return res.data || {};
}

// 上游状态数字 -> 中文
const HUAXIANG_ORDER_STATUS = { 0: '未确认', 1: '待确认', 2: '已确认', 3: '已完成', 4: '已取消', 5: '已退款' };
const HUAXIANG_PAYMENT_STATUS = { 0: '未支付', 1: '部分支付', 2: '已支付', 3: '已退款', 4: '已退款' };
const HUAXIANG_SHIPPING_STATUS = { 0: '未发货', 1: '部分发货', 2: '已发货', 3: '已签收', 4: '已退货' };
const mapHuaxiangStatus = (m, v) => (v == null || v === '') ? '' : (m[Number(v)] || String(v));

// 把上游 row 拍平到 purchase_orders 字段
// findPlatformOrders 新接口 shape: top-level { product, source, paymentInformation, order }
//   order: { id, sn, createDate/paymentDate(ms), paymentStatus/orderStatus/shippingStatus(数字),
//            consignee, phone/memberPhone, address, pfid, nickName, paymentMethod, ... }
//   paymentInformation: { amountPaid, freight, couponDiscount, promotionDiscount, paymentMethod, paymentDate(ms) }
//   source: 平台名 (取代旧 r.platformName)
//   product: [{ fullName, quantity, ... }] (新 shape)
function mapHuaxiangRow(row, shopName) {
  const o = row.order || {};
  const pi = row.paymentInformation || {};

  // ms 时间戳 -> ISO 字符串 (兼容 10位秒 或 13位毫秒)
  const tsToIso = (ts) => {
    if (ts == null || ts === '') return null;
    const n = Number(ts);
    if (!Number.isFinite(n)) return null;
    const ms = n > 1e12 ? n : n * 1000;
    return new Date(ms).toISOString();
  };

  const orderCreateMs = o.createDate ?? row.create_date;
  const paymentMs = pi.paymentDate ?? o.paymentDate;
  const purchaseTime = tsToIso(orderCreateMs) || tsToIso(paymentMs) || new Date().toISOString();

  const paymentChannel = pi.paymentMethod || o.paymentMethod || row.paymentMethodName || '';
  const orderStatus = mapHuaxiangStatus(HUAXIANG_ORDER_STATUS, row.orderStatus);
  const payStatus = mapHuaxiangStatus(HUAXIANG_PAYMENT_STATUS, row.paymentStatus ?? o.paymentStatus);
  const shippingStatus = mapHuaxiangStatus(HUAXIANG_SHIPPING_STATUS, row.shippingStatus ?? o.shippingStatus);

  const sourceOrderId = String(o.id || row.orderId || '');
  const sourceOrderSn = String(o.sn || row.orderSn || sourceOrderId);

  const income = Number(pi.amountPaid ?? row.payAmount ?? o.realPrice ?? o.amount ?? 0) || 0;
  const shippingFee = Number(pi.freight ?? row.freight ?? o.freight ?? 0) || 0;
  const couponDiscount = Number(pi.couponDiscount ?? row.couponDiscount ?? o.couponDiscount ?? 0) || 0;

  // 商品明细: 优先 row.product (新 shape), 否则 o.products / row.productName
  let productNames = [];
  if (Array.isArray(row.product)) {
    for (const p of row.product) {
      const t = p.fullName || p.name || p.productName || '';
      if (t) productNames.push(t);
    }
  }
  if (!productNames.length && Array.isArray(o.products)) {
    for (const p of o.products) {
      const t = p.fullName || p.name || p.productName || '';
      if (t) productNames.push(t);
    }
  }
  if (!productNames.length && row.productName) productNames = [String(row.productName)];

  const phone = o.phone || o.memberPhone || row.phone || '';
  const memberName = o.nickName || row.nickname || o.nickname || '';
  const consignee = o.consignee || row.consignee || '';
  const address = o.address || row.address || '';
  const memo = o.memo || row.memo || '';
  const platformName = row.source || row.platformName || '';
  const pfid = o.pfid || row.pfid || '';

  return {
    member_id: o.member ? String(o.member) : (o.memberId || row.memberId || ''),
    member_name: memberName,
    phone,
    consignee,
    delivery_address: address,
    personal_tag: memo,
    purchase_time: purchaseTime,
    income_amount: income,
    expense_amount: 0,
    product_subtotal: Math.max(income - shippingFee, 0),
    shipping_fee: shippingFee,
    coupon_discount: couponDiscount,
    cost_amount: Number(o.cost ?? row.cost ?? 0) || 0,
    profit_amount: 0,
    payment_channel: paymentChannel,
    payment_order_id: o.paymentSn || row.paymentSn || sourceOrderSn,
    business_type: paymentChannel || '外部订单',
    region: 'cn',
    source_table: HUAXIANG_SOURCE_TABLE,
    source_order_key: sourceOrderId || sourceOrderSn,
    source_order_id: sourceOrderId,
    source_order_sn: sourceOrderSn,
    source_shop_id: String(pfid),
    shop_name: shopName || platformName || '',
    shop_phone: phone,
    order_status: orderStatus,
    shipping_status: shippingStatus,
    pay_status: payStatus,
    tags: ['北京花卉订单'],
    product_id: [],
    product_title: productNames,
    synced_payload: {
      upstream: row,
      fetched_at: new Date().toISOString(),
    },
    synced_at: new Date().toISOString(),
  };
}

app.get('/api/orders/huaxiang/shops', async (req, res) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT id, mongo_id, shop_name, platform, api_base AS huaxiang_api_base, huaxiang_platform_id,
              (token_enc IS NOT NULL AND token_enc <> '') AS has_token
         FROM shops
        WHERE huaxiang_platform_id IS NOT NULL AND huaxiang_platform_id <> ''
        ORDER BY shop_name ASC`
    );
    res.json({ data: rows.map(r => ({ ...r, id: String(r.id), mongo_id: String(r.mongo_id) })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/orders/huaxiang/preview', async (req, res) => {
  try {
    const { shopId, startTime, endTime, orderStatus = '', paymentMethod = '0', productName = '', keyword = '', searchStatus = '', sort = 'false', pageNumber = '1', pageSize = '20', shippingMethodName = '' } = req.query;
    const master = await fetchMasterShop();
    if (!master) return res.status(500).json({ error: '主账号 "北京花卉" 不存在,请先在店铺管理创建' });
    if (!master.huaxiang_api_token) return res.status(500).json({ error: '主账号 "北京花卉" 未配置 huaxiang_api_token' });
    const shop = await fetchHuaxiangShop(shopId);
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    if (!shop.huaxiang_platform_id) return res.status(400).json({ error: '该店铺未配置 huaxiang_platform_id(花像花木 platformId),请先在店铺管理录入' });

    const data = await callHuaxiangFinds(master, shop.huaxiang_platform_id, {
      startTime, endTime, orderStatus, paymentMethod, productName, keyword, searchStatus,
      sort: sort === 'true' || sort === true || sort === '1',
      shippingMethodName,
    }, parseInt(pageNumber,10) || 1, Math.min(parseInt(pageSize,10) || 20, 100));

    if (data.code !== 200) {
      return res.status(400).json({ error: data.status || data.msg || `上游 code=${data.code}` });
    }
    const rows = Array.isArray(data.data) ? data.data : [];
    res.json({
      code: 200,
      total: data.count || rows.length,
      page: parseInt(pageNumber,10) || 1,
      pageSize: parseInt(pageSize,10) || 20,
      rows: rows.map(r => ({
        source_order_sn: r.order?.sn || r.orderSn || r.order?.id || '',
        order_sn: r.order?.sn || r.orderSn || '',
        order_id: r.order?.id,
        purchase_time: r.order?.createDate || r.create_date || '',
        consignee: r.order?.consignee || '',
        phone: r.order?.phone || r.order?.memberPhone || '',
        paymentMethod: r.paymentInformation?.paymentMethod || r.order?.paymentMethod || r.paymentMethodName || '',
        payAmount: Number(r.paymentInformation?.amountPaid ?? r.payAmount ?? r.order?.realPrice ?? r.order?.amount ?? 0),
        freight: Number(r.paymentInformation?.freight ?? r.freight ?? r.order?.freight ?? 0),
        orderStatus: r.orderStatus ?? '',
        paymentStatus: r.paymentStatus ?? r.order?.paymentStatus ?? '',
        shippingStatus: r.shippingStatus ?? r.order?.shippingStatus ?? '',
        productName: (Array.isArray(r.product) && r.product[0]?.fullName) || r.productName || '',
        address: r.order?.address || '',
        platformName: r.source || r.platformName || shop.shop_name || '',
        pfid: r.order?.pfid || '',
      })),
      shop: { id: String(shop.id), shop_name: shop.shop_name, huaxiang_platform_id: shop.huaxiang_platform_id },
      master: { id: String(master.id), shop_name: master.shop_name, huaxiang_platform_id: master.huaxiang_platform_id },
    });
  } catch (err) {
    console.error('huaxiang preview error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 店铺监控: 拉上游订单列表,关联 shops 表 shop_name,直接返回给前端展示 (不写库)
// 输入: shopId (shops.id 或 mongo_id), days(默认30), orderStatus(默认''全部), paymentMethod(默认'0'), maxPages(默认5)
// 输出: { shop, total, rows: [{source_order_sn, purchase_time, consignee, phone, address, productName, payAmount, freight, paymentMethod, orderStatus, paymentStatus, shippingStatus, shop_name, platform_name}] }
app.get('/api/orders/huaxiang/shop-monitor', async (req, res) => {
  try {
    const { shopId, days = '30', orderStatus = '', paymentMethod = '0', maxPages = '5', shippingMethodName = '' } = req.query;
    const master = await fetchMasterShop();
    if (!master) return res.status(500).json({ error: '主账号 "北京花卉" 不存在,请先在店铺管理创建' });
    if (!master.huaxiang_api_token) return res.status(500).json({ error: '主账号 "北京花卉" 未配置 huaxiang_api_token' });
    const shop = await fetchHuaxiangShop(shopId);
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    if (!shop.huaxiang_platform_id) return res.status(400).json({ error: '该店铺未配置 huaxiang_platform_id(花像花木 platformId),请先在店铺管理录入' });

    const d = parseInt(days, 10) || 30;
    const end = new Date();
    const start = new Date(); start.setDate(start.getDate() - d);
    const startTime = `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}-${String(start.getDate()).padStart(2,'0')} 00:00:00`;
    const endTime   = `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')} 23:59:59`;
    const pages = Math.min(Math.max(parseInt(maxPages, 10) || 5, 1), 20);
    const pageSize = 50;

    // 预拉 shops 表 shop_name 映射 (用于 r.source/platformName → shop_name)
    const { rows: shopRows } = await pgPool.query(
      `SELECT shop_name FROM shops WHERE shop_name IS NOT NULL AND shop_name <> ''`
    );
    const shopNames = shopRows.map(r => r.shop_name);

    let total = 0;
    const collected = [];
    for (let p = 1; p <= pages; p++) {
      const data = await callHuaxiangFinds(master, shop.huaxiang_platform_id, {
        startTime, endTime, orderStatus, paymentMethod, sort: false, shippingMethodName,
      }, p, pageSize);
      if (data.code !== 200) {
        return res.status(400).json({ error: data.status || data.msg || `上游 code=${data.code}` });
      }
      const rows = Array.isArray(data.data) ? data.data : [];
      if (p === 1) total = data.count || rows.length;
      if (!rows.length) break;
      collected.push(...rows);
      if (rows.length < pageSize) break;
    }

    // 把 platformName 跟 shops.shop_name 关联 (用 trim + 小写匹配)
    const norm = s => String(s || '').replace(/[\s\-_·•・]+/g, '').toLowerCase();
    const shopNameMap = new Map();
    for (const sn of shopNames) shopNameMap.set(norm(sn), sn);

    const outRows = collected.map(r => {
      const platformName = r.source || r.platformName || '';
      const matchedShopName = shopNameMap.get(norm(platformName)) || '';
      return {
        source_order_sn: String(r.order?.sn || r.orderSn || r.order?.id || ''),
        purchase_time: r.order?.createDate || r.create_date || '',
        consignee: r.order?.consignee || '',
        phone: r.order?.phone || r.order?.memberPhone || '',
        address: r.order?.address || '',
        productName: (Array.isArray(r.product) && r.product[0]?.fullName) || r.productName || '',
        payAmount: Number(r.paymentInformation?.amountPaid ?? r.payAmount ?? r.order?.realPrice ?? r.order?.amount ?? 0),
        freight: Number(r.paymentInformation?.freight ?? r.freight ?? r.order?.freight ?? 0),
        coupon_discount: Number(r.paymentInformation?.couponDiscount ?? r.couponDiscount ?? r.order?.couponDiscount ?? 0),
        paymentMethod: r.paymentInformation?.paymentMethod || r.order?.paymentMethod || r.paymentMethodName || '',
        orderStatus: r.orderStatus ?? '',
        paymentStatus: r.paymentStatus ?? r.order?.paymentStatus ?? '',
        shippingStatus: r.shippingStatus ?? r.order?.shippingStatus ?? '',
        platform_name: platformName,
        shop_name: matchedShopName,
        pfid: r.order?.pfid || '',
      };
    });

    res.json({
      code: 200,
      total,
      count: outRows.length,
      shop: { id: String(shop.id), shop_name: shop.shop_name, huaxiang_platform_id: shop.huaxiang_platform_id },
      master: { id: String(master.id), shop_name: master.shop_name, huaxiang_platform_id: master.huaxiang_platform_id },
      rows: outRows,
    });
  } catch (err) {
    console.error('huaxiang shop-monitor error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/orders/sync-huaxiang', async (req, res) => {
  try {
    const { shopId, startTime, endTime, orderStatus = '', paymentMethod = '0', productName = '', keyword = '', searchStatus = '', sort = false, maxPages = 30, pageSize = 50, shippingMethodName = '' } = req.body || {};
    if (!shopId) return res.status(400).json({ error: 'shopId 必填' });
    const master = await fetchMasterShop();
    if (!master) return res.status(500).json({ error: '主账号 "北京花卉" 不存在,请先在店铺管理创建' });
    if (!master.huaxiang_api_token) return res.status(500).json({ error: '主账号 "北京花卉" 未配置 huaxiang_api_token' });
    const shop = await fetchHuaxiangShop(shopId);
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    if (!shop.huaxiang_platform_id) return res.status(400).json({ error: '该店铺未配置 huaxiang_platform_id, 请先在店铺管理录入' });

    const filters = { startTime, endTime, orderStatus, paymentMethod, productName, keyword, searchStatus, sort: !!sort, shippingMethodName: shippingMethodName || '' };

    let scanned = 0, inserted = 0, updated = 0, skipped = 0, errors = 0;
    const errorList = [];
    let lastTotal = 0;
    const shopName = shop.shop_name || '';
    const pagesLimit = Math.min(Math.max(parseInt(maxPages,10) || 30, 1), 200);
    const ps = Math.min(Math.max(parseInt(pageSize,10) || 50, 1), 100);

    for (let p = 1; p <= pagesLimit; p++) {
      const data = await callHuaxiangFinds(master, shop.huaxiang_platform_id, filters, p, ps);
      if (data.code !== 200) {
        errorList.push({ page: p, message: data.status || data.msg || `code=${data.code}` });
        break;
      }
      const rows = Array.isArray(data.data) ? data.data : [];
      lastTotal = data.count || lastTotal;
      if (!rows.length) break;

      for (const row of rows) {
        scanned++;
        try {
          const mapped = mapHuaxiangRow(row, shopName);
          if (!mapped.source_order_sn) { skipped++; continue; }

          // upsert by (source_table, source_order_sn)
          const { rows: exist } = await pgPool.query(
            `SELECT id FROM purchase_orders WHERE source_table = $1 AND source_order_sn = $2 LIMIT 1`,
            [HUAXIANG_SOURCE_TABLE, mapped.source_order_sn]
          );
          const jsonb = (v) => v == null ? null : JSON.stringify(v);
          if (exist.length) {
            const id = exist[0].id;
            await pgPool.query(
              `UPDATE purchase_orders SET
                 source_order_key = $2, source_order_id = $3, source_shop_id = $4,
                 shop_name = $5, shop_phone = $6, consignee = $7, order_status = $8,
                 shipping_status = $9, pay_status = $10,
                 purchase_time = COALESCE(NULLIF($11,'')::timestamptz, purchase_time),
                 income_amount = $12, shipping_fee = $13, coupon_discount = $14,
                 cost_amount = $15, payment_channel = $16, payment_order_id = $17,
                 member_id = $18, member_name = $19, phone = $20, delivery_address = $21,
                 product_subtotal = $22,
                 synced_payload = $23::jsonb, synced_at = NOW(), updated_at = NOW()
               WHERE id = $1`,
              [
                id, mapped.source_order_key, mapped.source_order_id, mapped.source_shop_id,
                mapped.shop_name, mapped.shop_phone, mapped.consignee, mapped.order_status,
                mapped.shipping_status, mapped.pay_status,
                mapped.purchase_time, mapped.income_amount, mapped.shipping_fee, mapped.coupon_discount,
                mapped.cost_amount, mapped.payment_channel, mapped.payment_order_id,
                mapped.member_id, mapped.member_name, mapped.phone, mapped.delivery_address,
                mapped.product_subtotal, jsonb(mapped.synced_payload),
              ]
            );
            updated++;
          } else {
            const ins = await pgPool.query(
              `INSERT INTO purchase_orders
                 (member_id, member_name, phone, business_type, region, purchase_time,
                  delivery_address, personal_tag, income_amount, expense_amount,
                  payment_order_id, payment_channel, product_subtotal, shipping_fee,
                  coupon_discount, cost_amount, profit_amount,
                  source_table, source_order_key, source_order_id, source_order_sn,
                  source_shop_id, shop_name, shop_phone, consignee,
                  order_status, shipping_status, pay_status, synced_at,
                  tags, synced_payload)
               VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb)
               RETURNING id`,
              [
                mapped.member_id, mapped.member_name, mapped.phone, mapped.business_type, mapped.region, mapped.purchase_time,
                mapped.delivery_address, mapped.personal_tag, mapped.income_amount, mapped.expense_amount,
                mapped.payment_order_id, mapped.payment_channel, mapped.product_subtotal, mapped.shipping_fee,
                mapped.coupon_discount, mapped.cost_amount, 0,
                mapped.source_table, mapped.source_order_key, mapped.source_order_id, mapped.source_order_sn,
                mapped.source_shop_id, mapped.shop_name, mapped.shop_phone, mapped.consignee,
                mapped.order_status, mapped.shipping_status, mapped.pay_status, mapped.synced_at,
                JSON.stringify(mapped.tags), JSON.stringify(mapped.synced_payload),
              ]
            );
            const newId = ins.rows[0]?.id;
            if (newId && Array.isArray(mapped.product_title) && mapped.product_title.length) {
              await pgPool.query(
                `UPDATE purchase_orders SET product_id = $1::jsonb, product_title = $2::jsonb WHERE id = $3`,
                [JSON.stringify(mapped.product_id || []), JSON.stringify(mapped.product_title), newId]
              );
            }
            inserted++;
          }
        } catch (e) {
          errors++;
          if (errorList.length < 5) errorList.push({ row: row?.order?.sn || row?.order?.id, message: e.message });
        }
      }
      if (rows.length < ps) break; // last page
    }

    res.json({
      success: true,
      scanned, inserted, updated, skipped, errors,
      total: lastTotal,
      pages: pagesLimit,
      shop: { id: String(shop.id), shop_name: shop.shop_name, huaxiang_platform_id: shop.huaxiang_platform_id },
      master: { id: String(master.id), shop_name: master.shop_name, huaxiang_platform_id: master.huaxiang_platform_id },
      filters,
      errorList,
    });
  } catch (err) {
    console.error('sync-huaxiang error:', err.message);
    res.status(500).json({ error: err.message });
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
