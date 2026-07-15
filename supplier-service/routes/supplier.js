const router = require('express').Router();
const { Supplier } = require('../models/Supplier');
const { fromReq } = require('../services/supplierService');
const { filterMongoIdsByTags } = require('../services/supplyChainPg');
const axios = require('axios');


// ── PG tags enrichment ────────────────────────────────────
const PG_GW = process.env.PG_GATEWAY_URL || 'http://api-gateway:3007';
const PG_KEY = process.env.PG_API_KEY || '***REMOVED_API_KEY***';
async function fetchPgSupplierMeta(mongoIds) {
  if (!mongoIds || !mongoIds.length) return {};
  try {
    const sql = "SELECT mongo_id, tags, source_project, attributes FROM public.suppliers WHERE mongo_id = ANY($1::text[])";
    const resp = await axios.post(`${PG_GW}/api/pg/supply_chain/query`,
      { sql, params: [mongoIds] }, { headers: { 'x-api-key': PG_KEY }, timeout: 5000 });
    const map = {};
    (resp.data.data || []).forEach(r => { map[r.mongo_id] = r; });
    return map;
  } catch (e) { console.warn('pg tag fetch failed:', e.message); return {}; }
}

function supplierModel(req, role) {
  return req.app.locals[role] || Supplier;
}

// ── Batch reorder (MUST be before /:id) ──
router.post('/reorder', async (req, res) => {
  try {
    const svc = fromReq(req);
    const result = await svc.reorder(req.body.orders);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Batch delete (MUST be before /:id) ──
router.post('/batch-delete', async (req, res) => {
  try {
    const svc = fromReq(req);
    const result = await svc.batchDelete(req.body.ids);
    res.json(result);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

// ── Batch import from Excel ──
router.post('/import', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const multer = require('multer');
    const XLSX = require('xlsx');

    // We expect a multipart upload; use memory storage
    const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }).single('file');
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: '缺少文件' });
      try {
        const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
        if (!rows || rows.length < 2) return res.status(400).json({ error: 'Excel 为空或格式不正确' });
        const headers = rows[0].map(h => String(h).trim());
        const nameIdx = headers.indexOf('供应商名称');
        if (nameIdx < 0) return res.status(400).json({ error: 'Excel 缺少“供应商名称”列' });

        let inserted = 0, updated = 0, skipped = 0;
        const validStatuses = ['已完成', '待整理', '合同异常'];
        const normalizeStatus = (s) => {
          const st = String(s).trim();
          if (validStatuses.includes(st)) return st;
          if (st.includes('完成') || st.includes('已')) return '已完成';
          if (st.includes('异常') || st.includes('错')) return '合同异常';
          return '待整理';
        };

        const getCell = (row, title) => {
          const idx = headers.indexOf(title);
          return idx >= 0 ? String(row[idx] || '').trim() : '';
        };

        for (let i = 1; i < rows.length; i++) {
          const row = rows[i];
          const name = getCell(row, '供应商名称');
          if (!name) { skipped++; continue; }
          const existing = await SupplierWrite.findOne({ name });
          const st = normalizeStatus(getCell(row, '状态'));
          const contactName = getCell(row, '联系人');
          const contactPhone = getCell(row, '联系电话');
          const taxId = getCell(row, '税号');
          const companyAddress = getCell(row, '公司地址');
          const mainBusiness = getCell(row, '主营业务');
          const address = getCell(row, '栽培地址');
          const areaStr = getCell(row, '面积(亩)');
          const area = areaStr ? Number(areaStr) : null;
          const inventoryStr = getCell(row, '库存');
          const inventory = inventoryStr ? Number(inventoryStr) : null;
          const salesPeriod = getCell(row, '销售期');
          const notes = getCell(row, '备注');

          const payload = {
            status: st,
            contact: { name: contactName, phone: contactPhone },
            contacts: contactName ? [{ name: contactName, phone: contactPhone, title: '', gender: '' }] : [],
            company_info: { tax_id: taxId, address: companyAddress, main_business: mainBusiness },
            business_items: (mainBusiness || address || areaStr || inventoryStr || salesPeriod)
              ? [{ main_business: mainBusiness, address: address, planting_area: area, estimated_inventory: inventory, sales_period: salesPeriod }]
              : [],
            address: address || '',
            planting_area: area,
            estimated_inventory: inventory,
            sales_period: salesPeriod ? [salesPeriod] : [],
            notes: notes || undefined,
          };
          if (!existing) {
            payload.name = name;
            payload.sortOrder = -Math.abs(Date.now());
            await SupplierWrite.create(payload);
            inserted++;
          } else {
            await SupplierWrite.findByIdAndUpdate(existing._id, payload);
            updated++;
          }
        }
        res.json({ success: true, inserted, updated, skipped });
      } catch (innerErr) {
        res.status(500).json({ error: innerErr.message });
      }
    });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Product shop names ──
router.get('/shop-names', async (req, res) => {
  try {
    const db = req.app.locals.SupplierRead.db;
    const names = await db.collection('products').distinct('sellerName', { sellerName: { $ne: null, $ne: '' } });
    res.json(names.filter(Boolean));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Product count stats by shop_name ──
router.get('/product-stats', async (req, res) => {
  try {
    const db = req.app.locals.SupplierRead.db;
    const pipeline = [
      { $match: { sellerName: { $ne: null, $ne: '' } } },
      { $group: { _id: '$sellerName', count: { $sum: 1 } } }
    ];
    if (req.query.names) {
      const names = req.query.names.split(',').map(n => n.trim()).filter(Boolean);
      pipeline[0].$match.sellerName = { $in: names };
    }
    const result = await db.collection('products').aggregate(pipeline).toArray();
    const map = {};
    result.forEach(r => { map[r._id] = r.count; });
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  try {
    const svc = fromReq(req);
    // 支持按 tags 筛选（逗号分隔），命中 tags @> [...] 的 mongo_id 集合再交给 mongo 查
    let filterIds;
    if (req.query.tags) {
      const wants = String(req.query.tags).split(',').map(t => t.trim()).filter(Boolean);
      if (wants.length) filterIds = await filterMongoIdsByTags(wants);
    }
    const listArgs = { ...req.query };
    if (filterIds !== undefined) listArgs.filterIds = filterIds;
    const result = await svc.list(listArgs);
    // enrich each supplier with tags/source_project from PG
    const arr = result.suppliers || result.items || result.data || [];
    const ids = arr.map(x => String(x._id));
    const meta = await fetchPgSupplierMeta(ids);
    const plain = arr.map(x => {
      const o = (x && x.toObject) ? x.toObject() : x;
      const m = meta[String(o._id)];
      o.tags = (m && m.tags) || [];
      o.source_project = (m && m.source_project) || 'self-operated';
      o.pg_attributes = (m && m.attributes) || {};
      return o;
    });
    if (result.suppliers) result.suppliers = plain;
    else if (result.items) result.items = plain;
    else if (result.data) result.data = plain;
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const svc = fromReq(req);
    const supplier = await svc.get(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const svc = fromReq(req);
    const s = await svc.create(req.body);
    res.status(201).json(s);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const svc = fromReq(req);
    const s = await svc.update(req.params.id, req.body);
    res.json(s);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const svc = fromReq(req);
    const r = await svc.remove(req.params.id);
    res.json(r);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── V2.3: 地址转经纬度（高德首选 + Nominatim备选） ──
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // 强制 IPv4 优先


// Nominatim 限流：同一时间只允许一个请求，且间隔 >= 1.2s
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
        const gaodeResult = await new Promise((resolve, reject) => {
          const gaodeUrl = `https://restapi.amap.com/v3/geocode/geo?key=${encodeURIComponent(gaodeKey)}&address=${encodeURIComponent(address)}&output=JSON`;
          const parsedUrl = new URL(gaodeUrl);
          // 先 DNS 解析 IPv4
          dns.resolve4(parsedUrl.hostname, (dnsErr, addresses) => {
            if (dnsErr) return reject(dnsErr);
            const ip = addresses[0];
            const req = require('https').request({
              hostname: ip,
              port: 443,
              path: parsedUrl.pathname + parsedUrl.search,
              method: 'GET',
              headers: { 'Host': parsedUrl.hostname },
              timeout: 8000,
            }, (res) => {
              let body = '';
              res.on('data', c => body += c);
              res.on('end', () => {
                try {
                  const data = JSON.parse(body);
                  if (data.status === '1' && data.geocodes?.length) {
                    const g = data.geocodes[0];
                    const [lng, lat] = g.location.split(',').map(Number);
                    resolve({ address: g.formatted_address, longitude: lng, latitude: lat, level: g.level, source: 'gaode' });
                  } else {
                    reject(new Error('Gaode no result: ' + (data.info || '')));
                  }
                } catch (e) { reject(e); }
              });
            });
            req.on('error', reject);
            req.on('timeout', () => { req.destroy(); reject(new Error('Gaode request timeout')); });
            req.end();
          });
        });
        return res.json(gaodeResult);
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

        const nr = await axios.get('https://nominatim.openstreetmap.org/search', {
          params: { q: address, format: 'json', limit: 3, countrycodes: 'cn', accept_language: 'zh-CN' },
          headers: { 'User-Agent': 'SupplyChainPlatform/2.0 (geocoding service)' },
          timeout: 10000,
        });
        if (nr.data?.length) {
          const hit = nr.data[0];
          return res.json({ address: hit.display_name, longitude: parseFloat(hit.lon), latitude: parseFloat(hit.lat), level: hit.type, source: 'nominatim' });
        }
      } catch (nomErr) {
        console.log(`Nominatim attempt ${attempt + 1} failed:`, nomErr.message);
        if (attempt < 1) await new Promise(r => setTimeout(r, 1500));
      }
    }

    res.status(400).json({ error: '地址解析失败，请尝试输入更完整的地址（如：XX省XX市XX区）' });
  } catch (err) {
    console.error('Geocode fatal error:', err);
    res.status(500).json({ error: err.message || '地址解析异常' });
  }
});

module.exports = router;
