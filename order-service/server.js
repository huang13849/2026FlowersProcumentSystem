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
  password: process.env.PG_PASSWORD || '***REMOVED_PG_PW***',
  max: 5,
  idleTimeoutMillis: 30000,
});

async function ensureOrderSchema() {
  await pgPool.query('ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS income_amount NUMERIC(12,2) DEFAULT 0');
  await pgPool.query('ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS expense_amount NUMERIC(12,2) DEFAULT 0');
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

async function queryOrders({ page = 1, limit = 20, search, business_type, readFrom }) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sort: '-created_at' });
  const filter = {};
  if (search) filter.member_name = { $like: `%${search}%` };
  if (business_type && business_type !== '全部') filter.business_type = business_type;
  if (Object.keys(filter).length > 0) params.set('filter', JSON.stringify(filter));
  if (readFrom) params.set('readFrom', readFrom);
  const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}?${params.toString()}`;
  const res = await axiosWithRetry({ url, method: 'get', headers, timeout: 15000 });
  return normalizeOrderList(res.data);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service', timestamp: new Date().toISOString() });
});

app.get('/api/orders', async (req, res) => {
  try {
    const { page = 1, limit = 20, search, business_type, readFrom } = req.query;
    const result = await queryOrders({ page, limit, search, business_type, readFrom: readFrom || 'standby' });
    res.json(result);
  } catch (err) {
    console.error('GET /api/orders error:', err.response?.status, err.response?.data || err.message);
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
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
    const { member_id, member_name, phone, business_type, purchase_time, delivery_address, product_id, product_title, personal_tag, income_amount, expense_amount } = req.body;
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}`;
    const result = await axiosWithRetry({ url, method: 'post', data: {
      member_id: member_id || '', member_name: member_name || '', phone: phone || '',
      business_type: business_type || '未设置',
      purchase_time: purchase_time || new Date().toISOString(),
      delivery_address: delivery_address || '',
      personal_tag: personal_tag || '',
      income_amount: income_amount != null ? income_amount : 0,
      expense_amount: expense_amount != null ? expense_amount : 0,
    }, headers, timeout: 15000 });
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
        const { member_id, member_name, phone, business_type, purchase_time, delivery_address, product_id, product_title, personal_tag, income_amount, expense_amount } = order;
        const createResult = await axiosWithRetry({ url, method: 'post', data: {
          member_id: member_id || '', member_name: member_name || '', phone: phone || '',
          business_type: business_type || '未设置',
          purchase_time: purchase_time || new Date().toISOString(),
          delivery_address: delivery_address || '',
          personal_tag: personal_tag || '',
          income_amount: income_amount != null ? income_amount : 0,
          expense_amount: expense_amount != null ? expense_amount : 0,
        }, headers, timeout: 15000 });
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
        const createResult = await axiosWithRetry({ url: createUrl, method: 'post', data: {
          member_id: orig.member_id || '', member_name: orig.member_name || '', phone: orig.phone || '',
          business_type: orig.business_type || '未设置',
          purchase_time: new Date().toISOString(),
          delivery_address: orig.delivery_address || '',
          personal_tag: orig.personal_tag || '',
          income_amount: orig.income_amount != null ? orig.income_amount : 0,
          expense_amount: orig.expense_amount != null ? orig.expense_amount : 0,
        }, headers, timeout: 15000 });
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
    const { search, business_type } = req.query;
    const conditions = [];
    const params = [];
    if (search) { params.push(`%${search}%`); conditions.push(`member_name ILIKE $${params.length}`); }
    if (business_type && business_type !== '全部') { params.push(business_type); conditions.push(`business_type = $${params.length}`); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const { rows } = await pgPool.query(
      `SELECT COALESCE(SUM(income_amount),0)::float AS total_income, COALESCE(SUM(expense_amount),0)::float AS total_expense, COUNT(*)::int AS row_count FROM purchase_orders ${where}`,
      params
    );
    res.json({ data: rows[0] });
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
  .then(() => console.log('✅ Order schema ready: income_amount, expense_amount'))
  .catch(err => console.error('⚠️ Order schema ensure failed:', err.message))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`🛒 Order Service running on port ${PORT}`);
      console.log(`📡 API Gateway: ${GATEWAY_URL}`);
      console.log(`🗄️  Database: ${DB_NAME}.${TABLE_NAME}`);
      console.log(`🐘 Direct PG: ${process.env.PG_HOST || '100.67.126.90'}:5432`);
    });
  });
