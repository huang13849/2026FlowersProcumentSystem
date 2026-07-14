const router = require('express').Router();
const axios = require('axios');

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://100.96.54.109:31007';
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY || '***REMOVED_API_KEY***';
const DB = 'supply_chain';
const TABLE = 'flower_internet_supplier';

async function pgQuery(sql, params = []) {
  const resp = await axios.post(`${GATEWAY_URL}/api/pg/${DB}/query`, { sql, params }, {
    headers: { 'x-api-key': GATEWAY_API_KEY }
  });
  return resp.data.data || [];
}

function buildWhere(query) {
  const { search, website_name, province, city, is_used } = query;
  const clauses = [];
  const params = [];

  if (search) {
    const idx = params.length + 1;
    params.push(`%${search}%`);
    clauses.push(`(
      shop_name ILIKE $${idx} OR
      shop_owner ILIKE $${idx} OR
      shop_code ILIKE $${idx} OR
      owner_tell ILIKE $${idx} OR
      description ILIKE $${idx}
    )`);
  }
  if (website_name) {
    params.push(website_name);
    clauses.push(`website_name = $${params.length}`);
  }
  if (province) {
    params.push(`%${province}%`);
    clauses.push(`province ILIKE $${params.length}`);
  }
  if (city) {
    params.push(`%${city}%`);
    clauses.push(`city ILIKE $${params.length}`);
  }
  if (is_used !== undefined && is_used !== '') {
    params.push(Number(is_used));
    clauses.push(`is_used = $${params.length}`);
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '',
    params
  };
}

// 列表查询（数据库侧分页 + 搜索 + 筛选）
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const p = Math.max(1, parseInt(page) || 1);
    const l = Math.min(200, Math.max(1, parseInt(limit) || 20));
    const offset = (p - 1) * l;
    const { where, params } = buildWhere(req.query);

    // 注意：不要在 SQL 文本里写 create_date 字段名，API Gateway 的只读 SQL 防护会误判 CREATE。
    const totalRows = await pgQuery(
      `SELECT COUNT(*)::int AS total FROM ${TABLE} ${where}`,
      params
    );
    const total = Number(totalRows[0]?.total || 0);

    const data = await pgQuery(
      `SELECT * FROM ${TABLE} ${where} ORDER BY siteshop_id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, l, offset]
    );

    res.json({
      data,
      total,
      page: p,
      limit: l,
      pages: Math.ceil(total / l),
      filtered: data.length
    });
  } catch (err) {
    console.error('internetSuppliers list error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 获取所有平台名称/省份（数据库侧去重，避免只取前 10000 条漏平台）
router.get('/platforms', async (req, res) => {
  try {
    const platformRows = await pgQuery(`SELECT DISTINCT website_name FROM ${TABLE} WHERE website_name IS NOT NULL ORDER BY website_name`);
    const provinceRows = await pgQuery(`SELECT DISTINCT province FROM ${TABLE} WHERE province IS NOT NULL ORDER BY province`);
    res.json({
      platforms: platformRows.map(r => r.website_name).filter(Boolean),
      provinces: provinceRows.map(r => r.province).filter(Boolean)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 详情
router.get('/:id', async (req, res) => {
  try {
    const rows = await pgQuery(`SELECT * FROM ${TABLE} WHERE siteshop_id = $1 LIMIT 1`, [Number(req.params.id)]);
    const item = rows[0];
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// -------- 标签 / 自营商户扩展 (2026-07-14) --------
// PATCH /:id  — 编辑单条 (tags jsonb, attributes jsonb, source_project, zid, 基础字段)
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'invalid id' });
    const allowed = ['shop_name','shop_owner','shop_code','owner_tell','province','city','country','address','description','website_name','is_used','tags','attributes','source_project','zid'];
    const sets = [], params = [];
    for (const k of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, k)) {
        params.push(k === 'tags' || k === 'attributes' ? JSON.stringify(req.body[k]) : req.body[k]);
        const cast = (k === 'tags' || k === 'attributes') ? '::jsonb' : '';
        sets.push(`${k} = $${params.length}${cast}`);
      }
    }
    if (!sets.length) return res.status(400).json({ error: 'no fields' });
    params.push(id);
    const rows = await pgQuery(`UPDATE ${TABLE} SET ${sets.join(', ')} WHERE siteshop_id = $${params.length} RETURNING *`, params);
    res.json(rows[0] || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /  — 新增自营商户（默认 tags=['国际花展'], source_project='self-operated'）
router.post('/', async (req, res) => {
  try {
    const b = req.body || {};
    const tags       = Array.isArray(b.tags) && b.tags.length ? b.tags : ['国际花展'];
    const source     = b.source_project || 'self-operated';
    const attributes = b.attributes || {};
    const cols = ['shop_name','shop_owner','shop_code','owner_tell','province','city','country','address','description','website_name','is_used','tags','attributes','source_project','zid'];
    const vals = [
      b.shop_name || '', b.shop_owner || '', b.shop_code || '', b.owner_tell || '',
      b.province || '', b.city || '', b.country || '', b.address || '', b.description || '',
      b.website_name || '', b.is_used ?? 1,
      JSON.stringify(tags), JSON.stringify(attributes), source, b.zid || null
    ];
    const placeholders = vals.map((_, i) => `$${i+1}`);
    // 转 jsonb
    placeholders[cols.indexOf('tags')]       += '::jsonb';
    placeholders[cols.indexOf('attributes')] += '::jsonb';
    const rows = await pgQuery(
      `INSERT INTO ${TABLE} (${cols.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      vals
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /source-labels — 来源标签映射（前端可以下拉展示）
router.get('/source-labels', (req, res) => {
  res.json({
    'self-operated': '自营录入',
    'plant-share':   '植物共享自助',
    'peony':         '芍药联盟',
    'club':          '热植联盟',
  });
});


module.exports = router;
