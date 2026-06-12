/**
 * Order Service - 购买订单管理微服务
 * 通过 API Gateway CRUD 端点访问 PostgreSQL
 * 读操作路由到 Standby，写操作路由到 Primary
 */
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
app.use(express.static('public'));
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3007';
const API_KEY = process.env.API_KEY || '***REMOVED_API_KEY***';
const DB_NAME = process.env.PG_DATABASE || 'supply_chain';
const TABLE_NAME = 'purchase_orders';
const headers = { 'x-api-key': API_KEY, 'Content-Type': 'application/json' };

// Helper: 原生 SQL 查询（绕过路由问题，直接用 GET + filter）
async function queryOrders({ page = 1, limit = 20, search, business_type, readFrom }) {
  // 用 GET /:database/:table 端点 + filter 实现查询
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
    sort: '-created_at',
  });

  // 构建过滤条件
  const filter = {};
  if (search) {
    // API Gateway 不支持 OR 过滤，用 member_name LIKE 搜索
    filter.member_name = { $like: `%${search}%` };
  }
  if (business_type && business_type !== '全部') {
    filter.business_type = business_type;
  }

  if (Object.keys(filter).length > 0) {
    params.set('filter', JSON.stringify(filter));
  }
  if (readFrom) {
    params.set('readFrom', readFrom);
  }

  const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}?${params.toString()}`;
  const res = await axios.get(url, { headers, timeout: 15000 });
  return res.data;
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'order-service', timestamp: new Date().toISOString() });
});

// 获取订单列表
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

// 获取单条订单
app.get('/api/orders/:id', async (req, res) => {
  try {
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${req.params.id}?readFrom=standby`;
    const result = await axios.get(url, { headers, timeout: 15000 });
    res.json(result.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

// 创建订单
app.post('/api/orders', async (req, res) => {
  try {
    const { member_id, member_name, phone, business_type, purchase_time, delivery_address } = req.body;
    if (!member_id || !member_name || !phone) {
      return res.status(400).json({ error: '会员ID、会员名、手机号为必填项' });
    }
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}`;
    const result = await axios.post(url, {
      member_id, member_name, phone,
      business_type: business_type || '未设置',
      purchase_time: purchase_time || new Date().toISOString(),
      delivery_address: delivery_address || '',
    }, { headers, timeout: 15000 });
    res.status(201).json(result.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

// 批量创建
app.post('/api/orders/batch', async (req, res) => {
  try {
    const { orders } = req.body;
    if (!Array.isArray(orders) || orders.length === 0) {
      return res.status(400).json({ error: '请提供订单数组' });
    }
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}`;
    const results = [];
    const errors = [];
    for (const order of orders) {
      try {
        const { member_id, member_name, phone, business_type, purchase_time, delivery_address } = order;
        if (!member_id || !member_name || !phone) { errors.push({ member_id, error: '缺少必填字段' }); continue; }
        await axios.post(url, {
          member_id, member_name, phone,
          business_type: business_type || '未设置',
          purchase_time: purchase_time || new Date().toISOString(),
          delivery_address: delivery_address || '',
        }, { headers, timeout: 15000 });
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

// 更新订单
app.put('/api/orders/:id', async (req, res) => {
  try {
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${req.params.id}`;
    const result = await axios.put(url, { ...req.body, updated_at: new Date().toISOString() }, { headers, timeout: 15000 });
    res.json(result.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

// 删除订单
app.delete('/api/orders/:id', async (req, res) => {
  try {
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/${TABLE_NAME}/${req.params.id}`;
    const result = await axios.delete(url, { headers, timeout: 15000 });
    res.json(result.data);
  } catch (err) {
    res.status(err.response?.status || 500).json({ error: err.response?.data?.error || err.message });
  }
});

// 经营类型统计（使用 query 端点，简单 SQL）
app.get('/api/orders/stats/business-type', async (req, res) => {
  try {
    const url = `${GATEWAY_URL}/api/pg/${DB_NAME}/query`;
    const result = await axios.post(url, {
      sql: 'SELECT business_type, COUNT(*) as count FROM purchase_orders GROUP BY business_type ORDER BY count DESC',
      params: [],
      readFrom: 'standby',
    }, { headers, timeout: 15000 });
    res.json({ data: result.data.data });
  } catch (err) {
    res.status(500).json({ error: err.response?.data?.error || err.message });
  }
});

const PORT = process.env.PORT || 3008;
app.listen(PORT, () => {
  console.log(`🛒 Order Service running on port ${PORT}`);
  console.log(`📡 API Gateway: ${GATEWAY_URL}`);
  console.log(`🗄️  Database: ${DB_NAME}.${TABLE_NAME}`);
});
