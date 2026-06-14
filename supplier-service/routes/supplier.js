const router = require('express').Router();
const { Supplier } = require('../models/Supplier');

function supplierModel(req, role) {
  return req.app.locals[role] || Supplier;
}

// ── Batch reorder (MUST be before /:id) ──
router.post('/reorder', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const { orders } = req.body;
    if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders must be an array' });
    const bulkOps = orders.map(({ id, sortOrder }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sortOrder } } }
    }));
    await SupplierWrite.bulkWrite(bulkOps);
    res.json({ success: true, updated: orders.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Batch delete (MUST be before /:id) ──
router.post('/batch-delete', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids must be a non-empty array' });
    const result = await SupplierWrite.deleteMany({ _id: { $in: ids } });
    res.json({ success: true, deleted: result.deletedCount });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
    const SupplierRead = supplierModel(req, 'SupplierRead');
    const { search, status } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { shop_name: { $regex: search, $options: 'i' } },
        { 'contact.name': { $regex: search, $options: 'i' } },
        { 'company_info.tax_id': { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) query.status = status;
    const data = await SupplierRead.find(query).sort({ updatedAt: -1 });
    res.json({ suppliers: data, total: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const SupplierRead = supplierModel(req, 'SupplierRead');
    const supplier = await SupplierRead.findById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const body = { ...req.body };
    if (body.sortOrder === undefined) {
      const last = await SupplierWrite.findOne().sort({ sortOrder: -1 }).select('sortOrder');
      body.sortOrder = (last?.sortOrder ?? 0) + 10;
    }
    const s = await SupplierWrite.create(body);
    res.status(201).json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const s = await SupplierWrite.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(s);
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    await SupplierWrite.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// ── V2.3: 地址转经纬度（高德首选 + Nominatim备选） ──
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); // 强制 IPv4 优先
const axios = require('axios');


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
