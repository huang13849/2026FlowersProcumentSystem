// routes/shops.js - PG mode (uses Shop model directly, no mongoose connection)
const router = require('express').Router();
const { Shop, pgQuery } = require('../models/Shop');
const dns = require('dns');
const https = require('https');

// ── List all shops ──
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { shopName: search },
        { contactName: search },
        { phone: search },
      ];
    }
    // tags 过滤 (publish-service 用 ?tags=代运营 查花像花木代运营店铺)
    // 多个 tag 用英文逗号分隔, 语义: 店铺包含任一指定 tag 即命中
    const tagsRaw = req.query.tags;
    let data = await Shop.find(query, { sort: { sortOrder: 1 } });
    if (tagsRaw) {
      const wanted = String(tagsRaw).split(',').map(s => s.trim()).filter(Boolean);
      if (wanted.length) {
        data = data.filter(s => Array.isArray(s.tags) && s.tags.some(t => wanted.includes(t)));
      }
    }
    res.json({ shops: data, total: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Supplier ↔ Shop 关联 (PG 原生整数 FK; MUST be before /:id) ──
router.get('/link/supplier/:supplierId', async (req, res) => {
  try {
    const sid = parseInt(req.params.supplierId, 10);
    if (!Number.isInteger(sid)) return res.status(400).json({ error: 'supplierId 必须是整数' });
    const shop = await Shop.findBySupplierId(sid);
    if (!shop) return res.status(404).json({ error: '该供应商尚未关联店铺', linked: false });
    res.json({ shop, linked: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/link/supplier/:supplierId', async (req, res) => {
  try {
    const sid = parseInt(req.params.supplierId, 10);
    if (!Number.isInteger(sid)) return res.status(400).json({ error: 'supplierId 必须是整数' });
    const r = await Shop.linkBySupplier(sid);
    if (r.error) return res.status(r.code || 400).json({ error: r.error });
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/link/supplier/:supplierId', async (req, res) => {
  try {
    const sid = parseInt(req.params.supplierId, 10);
    if (!Number.isInteger(sid)) return res.status(400).json({ error: 'supplierId 必须是整数' });
    const shop = await Shop.findBySupplierId(sid);
    if (!shop) return res.status(404).json({ error: '无关联' });
    const upd = await Shop.setShopSupplier(shop._id, null);
    res.json({ shop: upd, unlinked: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get one shop ──
router.get('/:id', async (req, res) => {
  try {
    const shop = await Shop.findById(req.params.id);
    if (!shop) return res.status(404).json({ error: '经销商不存在' });
    res.json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create shop ──
router.post('/', async (req, res) => {
  try {
    const body = { ...req.body };
    if (body.sortOrder === undefined) {
      const last = await Shop.findOne({}, { sort: { sortOrder: -1 } });
      body.sortOrder = (last?.sortOrder ?? 0) + 10;
    }
    const s = await Shop.create(body);
    res.status(201).json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update shop ──
router.put('/:id', async (req, res) => {
  try {
    const s = await Shop.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!s) return res.status(404).json({ error: '经销商不存在' });
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete shop ──
router.delete('/:id', async (req, res) => {
  try {
    await Shop.findByIdAndDelete(req.params.id);
    res.json({ message: '已删除' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Batch delete shops ──
router.post('/batch-delete', async (req, res) => {
  try {
    const { ids } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '请提供 ids[] 数组' });
    const r = await Shop.batchDelete(ids);
    res.json({ success: true, ...r });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Set tags on a single shop (replace all) ──
router.put('/:id/tags', async (req, res) => {
  try {
    const { tags } = req.body || {};
    if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags 必须是数组' });
    const r = await Shop.setTags(req.params.id, tags);
    if (!r) return res.status(404).json({ error: '店铺不存在' });
    res.json({ success: true, shop: r });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Batch apply tags (add / remove / set) ──
router.post('/batch-tags', async (req, res) => {
  try {
    const { ids, tags, mode = 'add' } = req.body || {};
    if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: '请提供 ids[] 数组' });
    if (!Array.isArray(tags) || !tags.length) return res.status(400).json({ error: '请提供 tags[] 数组' });
    const r = await Shop.batchSetTags(ids, tags, mode);
    res.json({ success: true, ...r });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Tag pool (all unique tags across all shops) ──
router.get('/tags/pool', async (req, res) => {
  try {
    const r = await pgQuery(
      `SELECT tag, COUNT(*)::int AS count FROM (
         SELECT jsonb_array_elements_text(COALESCE(tags, '[]'::jsonb)) AS tag FROM shops
       ) t WHERE tag <> '' GROUP BY tag ORDER BY count DESC, tag ASC`
    );
    res.json({ data: (r.data || r.rows || []).map(x => ({ name: x.tag, count: x.count })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Publish credentials (publish-service 调用) ──
// 返回所有 huaxiang 平台凭证 (api_base / token / cookie / platformId), publish-service 用 platformId 匹配
router.get('/publish/huaxiang-credentials', async (req, res) => {
  try {
    const creds = await Shop.listHuaxiangCredentials();
    res.json({ data: creds });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Geocode (unchanged) ──
function httpsGet(hostname, path, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    dns.resolve4(hostname, (dnsErr, addresses) => {
      if (dnsErr) return reject(dnsErr);
      const ip = addresses[0];
      const r = https.request({
        hostname: ip, port: 443, path, method: 'GET',
        headers: { 'Host': hostname, ...headers },
        timeout: timeoutMs || 8000,
      }, (resp) => {
        let body = '';
        resp.on('data', c => body += c);
        resp.on('end', () => resolve(body));
      });
      r.on('error', reject);
      r.on('timeout', () => { r.destroy(); reject(new Error('Request timeout')); });
      r.end();
    });
  });
}

let lastNominatimCall = 0;
const NOMINATIM_MIN_INTERVAL = 1200;

router.post('/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: '缺少address参数' });
    const gaodeKey = process.env.GAODE_KEY || '';
    if (gaodeKey) {
      try {
        const gaodePath = '/v3/geocode/geo?key=' + encodeURIComponent(gaodeKey) + '&address=' + encodeURIComponent(address) + '&output=JSON';
        const body = await httpsGet('restapi.amap.com', gaodePath, {}, 8000);
        const data = JSON.parse(body);
        if (data.status === '1' && data.geocodes && data.geocodes.length) {
          const g = data.geocodes[0];
          const parts = g.location.split(',').map(Number);
          return res.json({ address: g.formatted_address, longitude: parts[0], latitude: parts[1], level: g.level, source: 'gaode' });
        }
      } catch (gaodeErr) { console.log('Gaode error:', gaodeErr.message); }
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const now = Date.now();
        const wait = NOMINATIM_MIN_INTERVAL - (now - lastNominatimCall);
        if (wait > 0) await new Promise(r => setTimeout(r, wait));
        lastNominatimCall = Date.now();
        const nomPath = '/search?q=' + encodeURIComponent(address) + '&format=json&limit=3&countrycodes=cn&accept-language=zh-CN';
        const nomBody = await httpsGet('nominatim.openstreetmap.org', nomPath, { 'User-Agent': 'SupplyChainPlatform/2.0 (geocoding service)' }, 10000);
        const nomData = JSON.parse(nomBody);
        if (nomData && nomData.length) {
          const hit = nomData[0];
          return res.json({ address: hit.display_name, longitude: parseFloat(hit.lon), latitude: parseFloat(hit.lat), level: hit.type, source: 'nominatim' });
        }
      } catch (nomErr) { if (attempt < 1) await new Promise(r => setTimeout(r, 1500)); }
    }
    res.status(404).json({ error: '无法解析地址: ' + address });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
