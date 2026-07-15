/**
 * api-gateway 兼容层：/api/mongo/products* → product-api-service
 *
 * flower-api / new-e-commerce 前后端调用形态：
 *   GET    /api/mongo/products?filter=<json>&sort=<json>&page=&limit=&fields=&countOnly=true
 *   GET    /api/mongo/products/:id
 *   POST   /api/mongo/products                (create)
 *   POST   /api/mongo/products/aggregate      (pipeline in body)
 *   PUT    /api/mongo/products/:id            (update)
 *   DELETE /api/mongo/products/:id            (delete)
 *
 * 目标：把上述所有请求转到 product-api-service，剥离对 Mongo 的直连依赖。
 *
 * 环境变量：
 *   PRODUCT_API_URL   缺省 http://product-api-service.supply-chain.svc.cluster.local:3000
 */
const express = require('express');
const router = express.Router();

const DEFAULT_URL = 'http://product-api-service.supply-chain.svc.cluster.local:3000';
const BASE = (process.env.PRODUCT_API_URL || DEFAULT_URL).replace(/\/+$/, '');

// —— util：转发请求 ——
async function fwd(method, path, { body, timeoutMs = 20000 } = {}) {
  const url = BASE + path;
  const init = { method, headers: { 'Content-Type': 'application/json' } };
  if (body != null) init.body = typeof body === 'string' ? body : JSON.stringify(body);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
    return { ok: r.ok, status: r.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// —— util：把 mongo filter/sort 转成 product-api-service 的 query params ——
// product-api-service `/api/products` 支持：
//   page, limit, search, category, isListed, sellerName, sort, supplier_id, createdBy,
//   tradeType, floweringMonths, matchAll, inStock, sceneTags, excludeTags
function mongoFilterToParams(filter = {}, extra = {}) {
  const p = {};
  if (filter.title) {
    if (typeof filter.title === 'string') p.search = filter.title;
    else if (filter.title.$regex) p.search = filter.title.$regex;
  }
  if (filter.category) p.category = String(filter.category);
  if (filter.sellerName) p.sellerName = String(filter.sellerName);
  if (filter.createdBy) p.createdBy = String(filter.createdBy);
  if (filter.supplier_id) p.supplier_id = String(filter.supplier_id);
  if (filter.isListed !== undefined) p.isListed = String(!!filter.isListed);
  if (filter.tradeType) {
    if (Array.isArray(filter.tradeType?.$in)) p.tradeType = filter.tradeType.$in.join(',');
    else p.tradeType = String(filter.tradeType);
  }
  if (filter.stock && filter.stock.$gt !== undefined) p.inStock = 'true';
  if (filter.sceneTags) {
    if (Array.isArray(filter.sceneTags?.$in)) p.sceneTags = filter.sceneTags.$in.join(',');
    else if (Array.isArray(filter.sceneTags?.$nin)) p.excludeTags = filter.sceneTags.$nin.join(',');
    else p.sceneTags = String(filter.sceneTags);
  }
  if (filter.floweringMonths) {
    if (Array.isArray(filter.floweringMonths?.$in)) p.floweringMonths = filter.floweringMonths.$in.join(',');
    else if (Array.isArray(filter.floweringMonths?.$all)) {
      p.floweringMonths = filter.floweringMonths.$all.join(',');
      p.matchAll = 'true';
    } else if (Array.isArray(filter.floweringMonths)) p.floweringMonths = filter.floweringMonths.join(',');
  }
  Object.assign(p, extra);
  return p;
}

function sortObjToString(sortObj) {
  if (!sortObj || typeof sortObj !== 'object') return '';
  const parts = [];
  for (const [k, v] of Object.entries(sortObj)) {
    parts.push(Number(v) < 0 ? `-${k}` : k);
  }
  return parts.join(',');
}

// ── 1. LIST：GET /api/mongo/products
router.get('/', async (req, res) => {
  try {
    const filter = safeJson(req.query.filter) || {};
    const sort = safeJson(req.query.sort) || {};
    const params = mongoFilterToParams(filter);
    if (req.query.page) params.page = req.query.page;
    if (req.query.limit) params.limit = req.query.limit;
    if (req.query.fields) params.fields = req.query.fields;
    const sortStr = sortObjToString(sort);
    if (sortStr) params.sort = sortStr;

    const qs = new URLSearchParams(params).toString();
    const r = await fwd('GET', `/api/products?${qs}`);
    if (!r.ok) return res.status(r.status).json(r.data);

    // product-api-service list 返回 { products, total, page, totalPages }
    // 我们要保持 /api/mongo/:collection 的响应形状：{ collection, total, page, limit, pages, data }
    if (req.query.countOnly === 'true') {
      return res.json({ collection: 'products', total: r.data.total || 0 });
    }
    return res.json({
      collection: 'products',
      total: r.data.total || 0,
      page: r.data.page || Number(req.query.page || 1),
      limit: Number(req.query.limit || 50),
      pages: r.data.totalPages || 1,
      data: r.data.products || [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 2. AGGREGATE：POST /api/mongo/products/aggregate
// flower-api lib/db.js 里 distinct 用的是 aggregate {$match,$group,$project}
router.post('/aggregate', async (req, res) => {
  try {
    const pipeline = req.body;
    if (!Array.isArray(pipeline)) return res.status(400).json({ error: 'pipeline 必须是数组' });

    // 识别 distinct 模式：[{$match: {...}}, {$group: {_id: '$field'}}, {$project: {_id:0, value: '$_id'}}]
    const match = pipeline.find(s => s.$match)?.$match || {};
    const group = pipeline.find(s => s.$group)?.$group;
    if (group && typeof group._id === 'string' && group._id.startsWith('$')) {
      const field = group._id.slice(1);
      // 目前只处理 category / sellerName 两个已支持的 meta 端点
      if (field === 'category' || field === 'sellerName') {
        const endpoint = field === 'category' ? '/api/products/meta/categories' : '/api/products/meta/sellers';
        const r = await fwd('GET', endpoint);
        if (!r.ok) return res.status(r.status).json(r.data);
        const values = Array.isArray(r.data) ? r.data : [];
        // 恢复 aggregate 响应格式：[{ _id: value }] 或 [{ value }]
        const project = pipeline.find(s => s.$project)?.$project;
        let rows;
        if (project && project.value) rows = values.map(v => ({ value: v }));
        else rows = values.map(v => ({ _id: v }));
        return res.json({ collection: 'products', count: rows.length, data: rows });
      }
    }

    // 其他 aggregate 场景暂不支持
    return res.status(501).json({
      error: 'aggregate on products only supports distinct-like pipelines via api-gateway compat layer',
      hint: 'call product-api-service directly for complex aggregations',
      pipeline,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 3. FIND BY ID：GET /api/mongo/products/:id
router.get('/:id', async (req, res) => {
  try {
    const r = await fwd('GET', `/api/products/${encodeURIComponent(req.params.id)}`);
    if (!r.ok) return res.status(r.status).json(r.data);
    return res.json({ collection: 'products', data: r.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 4. CREATE：POST /api/mongo/products
router.post('/', async (req, res) => {
  try {
    const r = await fwd('POST', '/api/products', { body: req.body || {} });
    if (!r.ok) return res.status(r.status).json(r.data);
    return res.status(201).json({ collection: 'products', data: r.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 5. UPDATE：PUT /api/mongo/products/:id
router.put('/:id', async (req, res) => {
  try {
    const r = await fwd('PUT', `/api/products/${encodeURIComponent(req.params.id)}`, { body: req.body || {} });
    if (!r.ok) return res.status(r.status).json(r.data);
    return res.json({ collection: 'products', data: r.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── 6. DELETE：DELETE /api/mongo/products/:id
router.delete('/:id', async (req, res) => {
  try {
    const r = await fwd('DELETE', `/api/products/${encodeURIComponent(req.params.id)}`);
    if (!r.ok) return res.status(r.status).json(r.data);
    return res.json({ collection: 'products', deleted: 1, data: r.data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── util：安全 JSON.parse ──
function safeJson(s) {
  if (!s) return null;
  if (typeof s === 'object') return s;
  try { return JSON.parse(s); } catch { return null; }
}

module.exports = router;
