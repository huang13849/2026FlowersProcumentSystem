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

module.exports = router;
