const express = require('express');
const { Pool } = require('pg');
const { resolveServiceBase } = require('./nacosResolver');

const app = express();
app.use(express.json({ limit: '2mb' }));

// CORS
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

const pg = new Pool({
  host: process.env.PG_HOST || '100.67.126.90',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || (function(){throw new Error('PG_PASSWORD env required')}()),
  database: process.env.PG_DATABASE || 'supply_chain',
});

// Health
app.get('/health', (req, res) => res.json({ ok: true, service: 'purchase-list-service' }));

// ============================================================================
// Core: given a list of order IDs (or arbitrary items), return normalized rows
// suitable for purchase-list rendering.
//
// Input variants:
//   { source: 'purchase_orders', ids: [10187, 10150] }
//   { source: 'plant_collector.orders', order_nos: ['PAY17839...'] }
//   { items: [{ title, image, qty, amount, consignee, phone, address, delivery_time }] }
// ============================================================================
async function fetchRows({ source, ids, order_nos, items }) {
  // Direct items array — no DB needed
  if (Array.isArray(items) && items.length) {
    return items.map((it, i) => ({
      order_no: it.order_no || `ITEM-${i + 1}`,
      consignee: it.consignee || '',
      phone: it.phone || '',
      address: it.address || it.delivery_address || '',
      amount: Number(it.amount || it.payment || 0),
      delivery_time: it.delivery_time || it.purchase_time || '',
      items: Array.isArray(it.products) ? it.products : [{
        title: it.title || '', image: it.image || '', qty: it.qty || 1,
      }],
    }));
  }

  if (source === 'plant_collector.orders' && Array.isArray(order_nos) && order_nos.length) {
    const { rows } = await pg.query(`
      SELECT o.order_no, o.total AS amount, o.shipping_address, o.paid_at, o.delivered_at,
             (SELECT jsonb_agg(jsonb_build_object(
                'title', oi.title, 'qty', oi.qty,
                'image', COALESCE(oi.snapshot->>'image', oi.snapshot->'snapshot'->>'image')
              )) FROM plant_collector.order_items oi WHERE oi.order_id = o.id) AS items
        FROM plant_collector.orders o
       WHERE o.order_no = ANY($1) AND o.status='paid'
    `, [order_nos]);
    return rows.map(r => {
      const a = r.shipping_address || {};
      return {
        order_no: r.order_no,
        consignee: a.memberName || a.name || '',
        phone: a.phone || '',
        address: a.text || a.address || '',
        amount: Number(r.amount || 0),
        delivery_time: r.delivered_at || r.paid_at,
        items: r.items || [],
      };
    });
  }

  // default: purchase_orders
  if (Array.isArray(ids) && ids.length) {
    const { rows } = await pg.query(`
      SELECT id, source_order_sn, consignee, phone, delivery_address,
             product_subtotal, purchase_time, synced_at, product_title, product_id, synced_payload
        FROM purchase_orders WHERE id = ANY($1::int[])
        ORDER BY purchase_time DESC
    `, [ids]);
    const mapped = rows.map(r => {
      const p = r.synced_payload || {};
      let items = Array.isArray(p.items) && p.items.length ? p.items : null;
      if (!items) {
        const titles = Array.isArray(r.product_title) ? r.product_title : [];
        items = titles.map(t => ({ title: t, image: '', qty: 1 }));
      }
      return {
        order_no: r.source_order_sn || String(r.id),
        consignee: r.consignee || '',
        phone: r.phone || '',
        address: r.delivery_address || '',
        amount: Number(r.product_subtotal || 0),
        delivery_time: r.purchase_time,
        items,
        _product_ids: Array.isArray(r.product_id) ? r.product_id : [],
      };
    });
    // Enrich items with product main images
    const productIdsByRow = mapped.map(m => m._product_ids || []);
    await enrichItemsWithProductImages(mapped, productIdsByRow);
    mapped.forEach(m => delete m._product_ids);
    return mapped;
  }

  return [];
}

// Data endpoint — returns normalized JSON
app.post('/purchase-list/data', async (req, res) => {
  try {
    const rows = await fetchRows(req.body || {});
    res.json({ success: true, count: rows.length, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
});

// ------------- HTML renderer -------------
// Priority chain for main image; returns the first URL found.
const PRODUCT_API = process.env.PRODUCT_API_URL || 'http://product-api-service.supply-chain.svc.cluster.local:3000';
const PRODUCT_SERVICE_NAME = process.env.PRODUCT_SERVICE_NAME || 'k8s.supply-chain.product-api-service';
async function fetchProductMainImages(ids) {
  const out = {};
  const uniq = [...new Set(ids.filter(x => x != null && x !== ''))];
  if (!uniq.length) return out;
  const productBase = await resolveServiceBase({ serviceName: PRODUCT_SERVICE_NAME, fallbackUrl: PRODUCT_API });
  await Promise.all(uniq.map(async (id) => {
    try {
      const r = await fetch(productBase + '/api/products/' + encodeURIComponent(id), { signal: AbortSignal.timeout(3000) });
      if (!r.ok) return;
      const j = await r.json();
      const prod = j.data || j.product || j;
      // Priority: images -> package_images -> panorama_images -> detail_images -> scene_images
      const priority = ['images','package_images','panorama_images','detail_images','scene_images'];
      for (const k of priority) {
        const arr = prod && prod[k];
        if (Array.isArray(arr) && arr.length) { out[id] = arr[0]; return; }
      }
    } catch (_) {}
  }));
  return out;
}

// Enrich items array with main image URLs if items[i].image is missing
async function enrichItemsWithProductImages(rows, productIdsByRow) {
  const allIds = [];
  productIdsByRow.forEach(list => (list || []).forEach(id => allIds.push(id)));
  if (!allIds.length) return rows;
  const imgMap = await fetchProductMainImages(allIds);
  rows.forEach((row, idx) => {
    const ids = productIdsByRow[idx] || [];
    if (!row.items || !row.items.length) return;
    row.items.forEach((it, i) => {
      if (it.image) return;
      const pid = it.productId || it.product_id || ids[i] || ids[0];
      if (pid && imgMap[pid]) it.image = imgMap[pid];
    });
  });
  return rows;
}

function normalizeImg(img) {
  if (!img) return '';
  if (img.startsWith('\ud83c')) return '';
  if (img.startsWith('http')) return img;
  return `http://100.96.54.109${img}`;
}

function renderHTML(rows, opts = {}) {
  const title = opts.title || '\u91c7\u8d2d\u5355';
  const brand = opts.brand || '\u9c9c\u82b1\u4f9b\u5e94\u94fe \u00b7 \u5b50\u5bab\u9879\u76ee';
  const trs = rows.map(r => {
    const items = (r.items || []).map(it => {
      const img = normalizeImg(it.image);
      return `<div class="item">${img ? `<img src="${img}" onerror="this.style.display='none'"/>` : '<span class="ph">\ud83c\udf38</span>'}<span class="t">${(it.title || '').replace(/</g, '&lt;')}${it.qty > 1 ? ' \u00d7' + it.qty : ''}</span></div>`;
    }).join('') || '\u2014';
    const dt = r.delivery_time ? new Date(r.delivery_time).toLocaleString('zh-CN') : '';
    return `<tr>
      <td class="prods">${items}</td>
      <td class="money">\u00a5${Number(r.amount || 0).toFixed(2)}</td>
      <td>${(r.consignee || '').replace(/</g, '&lt;')}<br/><span class="sub">${(r.phone || '').replace(/</g, '&lt;')}</span></td>
      <td>${(r.address || '').replace(/</g, '&lt;')}</td>
      <td>${dt}<br/><span class="sub">\u5355\u53f7 ${r.order_no}</span></td>
    </tr>`;
  }).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,'PingFang SC','Microsoft YaHei',sans-serif;padding:24px;color:#333;background:#fff}
  h1{margin:0 0 4px;color:#722ed1;font-size:16px}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #722ed1;padding-bottom:8px;margin-bottom:16px}
  .meta{font-size:12px;color:#888}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#f9f0ff;color:#722ed1;padding:10px;text-align:left;font-weight:600;border:1px solid #d3adf7}
  td{padding:10px;border:1px solid #eee;vertical-align:top}
  .item{display:flex;align-items:center;gap:8px;margin:4px 0}
  .item img{width:32px;height:32px;object-fit:cover;border-radius:6px;border:1px solid #eee}
  .item .ph{display:inline-flex;width:32px;height:32px;background:#fff0f6;border-radius:6px;align-items:center;justify-content:center;font-size:16px}
  .item .t{flex:1;font-size:12px;line-height:1.4}
  .money{color:#c41d7f;font-weight:600;font-size:14px}
  .sub{color:#999;font-size:11px}
  .toolbar{position:fixed;top:10px;right:10px;background:#722ed1;color:#fff;padding:8px 16px;border-radius:6px;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.15);font-size:13px;user-select:none}
  @media print{.toolbar{display:none}}
</style></head><body>
  <div class="toolbar" onclick="window.print()">\ud83d\udda8\ufe0f \u6253\u5370 / \u53e6\u5b58\u4e3a PDF</div>
  <div class="head">
    <div><h1>\ud83c\udf38 ${title} &nbsp; <span style="font-size:14px;color:#888">Purchase List</span></h1><div class="meta">\u5171 ${rows.length} \u6761\u8ba2\u5355 \u00b7 \u5bfc\u51fa\u65f6\u95f4 ${new Date().toLocaleString('zh-CN')}</div></div>
    <div class="meta">${brand}</div>
  </div>
  <table>
    <thead><tr>
      <th style="width:32%">\u5546\u54c1</th>
      <th style="width:12%">\u652f\u4ed8\u91d1\u989d</th>
      <th style="width:14%">\u6536\u4ef6\u4eba</th>
      <th style="width:28%">\u6536\u4ef6\u5730\u5740</th>
      <th style="width:14%">\u4ea4\u4ed8\u65f6\u95f4</th>
    </tr></thead>
    <tbody>${trs}</tbody>
  </table>
</body></html>`;
}

// HTML endpoint — returns full printable page
app.post('/purchase-list/render', async (req, res) => {
  try {
    const rows = await fetchRows(req.body || {});
    const html = renderHTML(rows, req.body || {});
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send(`<pre>${e.message}</pre>`);
  }
});

// GET variant for direct browser hit: /purchase-list/render?source=purchase_orders&ids=10,20
app.get('/purchase-list/render', async (req, res) => {
  try {
    const body = {
      source: req.query.source || 'purchase_orders',
      ids: req.query.ids ? String(req.query.ids).split(',').map(x => parseInt(x, 10)).filter(Boolean) : [],
      order_nos: req.query.order_nos ? String(req.query.order_nos).split(',') : [],
      title: req.query.title,
      brand: req.query.brand,
    };
    const rows = await fetchRows(body);
    const html = renderHTML(rows, body);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) {
    res.status(500).send(`<pre>${e.message}</pre>`);
  }
});

const port = process.env.PORT || 3013;
app.listen(port, () => console.log(`\u{1F4E5} purchase-list-service on ${port}`));
