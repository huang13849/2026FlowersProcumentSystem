const router = require('express').Router();
const { createShopModel } = require('../models/Shop');
const dns = require('dns');
const https = require('https');

function shopModel(req, role) {
  return req.app.locals[role];
}

// ── List all shops ──
router.get('/', async (req, res) => {
  try {
    const ShopRead = shopModel(req, 'ShopRead');
    const { search } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { shopName: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    const data = await ShopRead.find(query).sort({ sortOrder: 1, updatedAt: -1 });
    res.json({ shops: data, total: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get one shop ──
router.get('/:id', async (req, res) => {
  try {
    const ShopRead = shopModel(req, 'ShopRead');
    const shop = await ShopRead.findById(req.params.id);
    if (!shop) return res.status(404).json({ error: '经销商不存在' });
    res.json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create shop ──
router.post('/', async (req, res) => {
  try {
    const ShopWrite = shopModel(req, 'ShopWrite');
    const body = { ...req.body };
    if (body.sortOrder === undefined) {
      const last = await ShopWrite.findOne().sort({ sortOrder: -1 }).select('sortOrder');
      body.sortOrder = (last?.sortOrder ?? 0) + 10;
    }
    const s = await ShopWrite.create(body);
    res.status(201).json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update shop ──
router.put('/:id', async (req, res) => {
  try {
    const ShopWrite = shopModel(req, 'ShopWrite');
    const s = await ShopWrite.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!s) return res.status(404).json({ error: '经销商不存在' });
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete shop ──
router.delete('/:id', async (req, res) => {
  try {
    const ShopWrite = shopModel(req, 'ShopWrite');
    await ShopWrite.findByIdAndDelete(req.params.id);
    res.json({ message: '已删除' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Helper: HTTPS GET with DNS pre-resolve (IPv4 only) ──
function httpsGet(hostname, path, headers, timeoutMs) {
  return new Promise((resolve, reject) => {
    dns.resolve4(hostname, (dnsErr, addresses) => {
      if (dnsErr) return reject(dnsErr);
      const ip = addresses[0];
      const r = https.request({
        hostname: ip,
        port: 443,
        path: path,
        method: 'GET',
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

// ── Geocode: address -> longitude/latitude (高德优先, Nominatim fallback) ──
let lastNominatimCall = 0;
const NOMINATIM_MIN_INTERVAL = 1200;

router.post('/geocode', async (req, res) => {
  try {
    const { address } = req.body;
    if (!address) return res.status(400).json({ error: '缺少address参数' });

    // 1) 高德地图（首选，中国地址精准）
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
        console.log('Gaode no result:', data.info || '');
      } catch (gaodeErr) {
        console.log('Gaode geocode error:', gaodeErr.message);
      }
    }

    // 2) Fallback: Nominatim (OpenStreetMap)
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
      } catch (nomErr) {
        console.log('Nominatim attempt ' + (attempt + 1) + ' failed:', nomErr.message);
        if (attempt < 1) await new Promise(r => setTimeout(r, 1500));
      }
    }

    res.status(404).json({ error: '无法解析地址: ' + address });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
