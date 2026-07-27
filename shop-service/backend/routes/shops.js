// routes/shops.js - PG mode (uses Shop model directly, no mongoose connection)
const router = require('express').Router();
const { Shop } = require('../models/Shop');
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
    const data = await Shop.find(query, { sort: { sortOrder: 1 } });
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
