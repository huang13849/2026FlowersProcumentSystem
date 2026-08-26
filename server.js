// huaxiang-sync-service
// 独立的 huaxiang 外部订单同步服务 (从 order-service 拆出)
// 职责:
//   1) 定时 (每 SYNC_INTERVAL_MS, 默认 30m) 全店扫描拉上游订单
//   2) HTTP POST /sync/:shopId 手动触发
//   3) HTTP POST /sync-all 全店批量
//   4) HTTP GET /health /status 探针
//
// 数据流:
//   - 拉上游 huaxiang (用 master account 北京花卉)
//   - 每条 publish 到 NATS subject: orders.paid.huaxiang.<platform_id>.<order_sn>
//     msgId = huaxiang-<platform_id>-<order_sn>  (JetStream dedupe 2m)
//   - huaxiang-writer-consumer (或 order-writer-consumer 加 source) 监听 orders.paid.huaxiang.>
//     upsert 到 purchase_orders (source_table='huaxiang_porder')
//
// 防重复 (3 重保护):
//   - NATS JetStream msgId dedupe (短期 2 分钟窗口)
//   - huaxiang_sync_state.last_synced_at: 下次只拉 (last_synced_at, NOW] 区间
//   - PG purchase_orders 上 UNIQUE INDEX ux_purchase_orders_huaxiang_porder (兜底)
//   - fetcher 只发不写, consumer 用 ON CONFLICT (source_table, source_order_sn) DO UPDATE

import http from 'node:http';
import axios from 'axios';
import pg from 'pg';
import { connect as natsConnect, StringCodec, headers } from 'nats';

const { Pool } = pg;
const sc = StringCodec();

const PG_CONFIG = {
  host: process.env.PG_HOST || '100.67.126.90',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || (() => { throw new Error('PG_PASSWORD env required'); })(),
  database: process.env.PG_DATABASE || 'supply_chain',
};
const NATS_URL = process.env.NATS_URL || 'nats://nats.messaging.svc.cluster.local:4222';
const SYNC_INTERVAL_MS = parseInt(process.env.SYNC_INTERVAL_MS || '1800000', 10); // 30min
const LOOKBACK_HOURS = parseInt(process.env.LOOKBACK_HOURS || '168', 10);          // 7d
const MAX_PAGES_PER_SHOP = parseInt(process.env.MAX_PAGES_PER_SHOP || '30', 10);
const PAGE_SIZE = parseInt(process.env.PAGE_SIZE || '50', 10);
const HTTP_PORT = parseInt(process.env.HTTP_PORT || '3030', 10);

const HUAXIANG_SOURCE_TABLE = 'huaxiang_porder';
const pool = new Pool(PG_CONFIG);

// ---------- upstream huaxiang API ----------
async function fetchMasterShop() {
  const { rows } = await pool.query(
    `SELECT id, shop_name, huaxiang_api_base, huaxiang_platform_id, huaxiang_api_token, huaxiang_cookie
       FROM shops WHERE shop_name = '北京花卉' LIMIT 1`
  );
  return rows[0] || null;
}

async function fetchShopsWithHuaxiang() {
  const { rows } = await pool.query(
    `SELECT id, shop_name, huaxiang_api_base, huaxiang_platform_id
       FROM shops
      WHERE huaxiang_platform_id IS NOT NULL AND huaxiang_platform_id <> ''
      ORDER BY shop_name ASC`
  );
  return rows;
}

async function callHuaxiangFinds(master, targetPlatformId, filters, pageNumber, pageSize) {
  const origin = (master.huaxiang_api_base || 'https://admin.huaxianghuamu.cn').replace(/\/$/, '');
  const base = origin + '/';
  const token = master.huaxiang_api_token;
  const cookieExtra = master.huaxiang_cookie && master.huaxiang_cookie.trim()
    ? master.huaxiang_cookie.trim()
    : 'ajaxtoken=' + token;
  const url = `${base}weidao/weidaoyun/admin/order/findPlatformOrders.jhtml?platformId=${encodeURIComponent(targetPlatformId)}&token=${encodeURIComponent(token)}&stoken=${encodeURIComponent(token)}`;

  const body = {
    pageNumber: Number(pageNumber) || 1,
    pageSize: Number(pageSize) || 50,
    paymentMethod: 0,
    orderStatus: 0,
    needTotal: 1,
    shippingMethodName: filters.shippingMethodName || '',
  };
  if (filters.startTime) body.startTime = filters.startTime;
  if (filters.endTime) body.endTime = filters.endTime;
  if (filters.productName) body.productName = filters.productName;
  if (filters.keyword) {
    body.keyword = filters.keyword;
    body.searchStatus = Number(filters.searchStatus || 0);
  } else if (filters.searchStatus !== '' && filters.searchStatus != null) {
    body.searchStatus = Number(filters.searchStatus);
  }

  const res = await axios({
    method: 'POST',
    url,
    headers: {
      'Content-Type': 'application/json;charset=UTF-8',
      'token': token,
      'Cookie': cookieExtra,
      'Origin': origin,
      'Referer': origin + '/',
      'User-Agent': 'huaxiang-sync-service/1.0',
    },
    data: body,
    validateStatus: () => true,
    timeout: 20000,
  });
  if (res.status !== 200) {
    throw new Error(`upstream HTTP ${res.status}: ${typeof res.data === 'string' ? res.data.slice(0, 200) : ''}`);
  }
  return res.data || {};
}

const HUAXIANG_PAYMENT_STATUS = { 0: '未支付', 1: '部分支付', 2: '已支付', 3: '已退款', 4: '已退款' };
const HUAXIANG_SHIPPING_STATUS = { 0: '未发货', 1: '部分发货', 2: '已发货', 3: '已签收', 4: '已退货' };
const HUAXIANG_ORDER_STATUS = { 0: '未确认', 1: '待确认', 2: '已确认', 3: '已完成', 4: '已取消', 5: '已退款' };
const mapStatus = (m, v) => (v == null || v === '') ? '' : (m[Number(v)] || String(v));

function tsToIso(ts) {
  if (ts == null || ts === '') return null;
  const n = Number(ts);
  if (!Number.isFinite(n)) return null;
  const ms = n > 1e12 ? n : n * 1000;
  return new Date(ms).toISOString();
}

// ---------- cost lookup: 上游商品标题 → PG products.cost_price ----------
// 策略 (顺序, 第一个命中即返回):
//   1) 精确匹配 products.title = upstream_title
//   2) products.title ILIKE '%upstream_title%' (上游 title 是 products title 的子串)
//   3) upstream_title ILIKE '%products.title%' AND length(products.title) >= 8 (反向: products title 短, 是 upstream 的子串)
//   4) 多关键词 (split on 空格/'-') 全部命中 products.title
async function lookupProductCost(productTitles) {
  if (!Array.isArray(productTitles) || !productTitles.length) return 0;
  let total = 0;
  const matched = [];
  for (const title of productTitles) {
    if (!title || !title.trim()) continue;
    let row = null;
    let strategy = '';
    // 1) 精确
    let r = await pool.query(`SELECT title, cost_price FROM products WHERE title = $1 LIMIT 1`, [title]);
    if (r.rows.length) { row = r.rows[0]; strategy = 'exact'; }
    // 2) products.title LIKE %upstream%
    if (!row) {
      r = await pool.query(`SELECT title, cost_price FROM products WHERE title ILIKE '%' || $1 || '%' LIMIT 1`, [title]);
      if (r.rows.length) { row = r.rows[0]; strategy = 'upstream-in-products'; }
    }
    // 3) upstream LIKE %products% (反向, products.title 较长且内容是 upstream 子串)
    if (!row) {
      r = await pool.query(
        `SELECT title, cost_price FROM products WHERE length(title) >= 6 AND $1 ILIKE '%' || title || '%' LIMIT 1`,
        [title]
      );
      if (r.rows.length) { row = r.rows[0]; strategy = 'products-in-upstream'; }
    }
    // 4) 多关键词 (>=2 字符) OR 任一 in products.title, 优先最完整 title (length DESC); 二次过滤命中 >=2 token
    if (!row) {
      const tokens = title.split(/[\s\-()]+/).filter(t => t.length >= 2).slice(0, 8);
      if (tokens.length >= 2) {
        const conds = tokens.map((_, i) => `title ILIKE '%' || $${i + 1} || '%'`).join(' OR ');
        r = await pool.query(
          `SELECT title, cost_price FROM products
             WHERE ${conds}
             ORDER BY length(title) DESC LIMIT 50`,
          tokens
        );
        // 过滤: PG title 包含上游 >= 2 个 token
        const filtered = r.rows.filter(p => {
          const hits = tokens.filter(t => p.title.includes(t));
          return hits.length >= 2;
        });
        if (filtered.length) { row = filtered[0]; strategy = 'multi-token'; }
      }
    }
    if (row && row.cost_price != null) {
      total += Number(row.cost_price) || 0;
      matched.push({ strategy, upstream: title, matched: row.title, cost: row.cost_price });
    }
  }
  if (matched.length) {
    console.log(`[cost] ${matched.length}/${productTitles.length} matched: ${JSON.stringify(matched)}`);
  } else if (productTitles.length) {
    console.log(`[cost] 0/${productTitles.length} matched for: ${JSON.stringify(productTitles)}`);
  }
  return total;
}

async function mapRowToOrder(row, shop, shopId) {
  const o = row.order || {};
  const pi = row.paymentInformation || {};

  const orderCreateMs = o.createDate ?? row.create_date;
  const paymentMs = pi.paymentDate ?? o.paymentDate;
  const purchaseTime = tsToIso(orderCreateMs) || tsToIso(paymentMs) || new Date().toISOString();

  const income = Number(pi.amountPaid ?? row.payAmount ?? o.realPrice ?? o.amount ?? 0) || 0;
  const shippingFee = Number(pi.freight ?? row.freight ?? o.freight ?? 0) || 0;
  const couponDiscount = Number(pi.couponDiscount ?? row.couponDiscount ?? o.couponDiscount ?? 0) || 0;
  const productSubtotal = Math.max(income - shippingFee, 0);

  let productTitles = [];
  if (Array.isArray(row.product)) {
    for (const p of row.product) {
      const t = p.fullName || p.name || p.productName || '';
      if (t) productTitles.push(t);
    }
  } else if (Array.isArray(o.products)) {
    for (const p of o.products) {
      const t = p.fullName || p.name || p.productName || '';
      if (t) productTitles.push(t);
    }
  } else if (row.productName) {
    productTitles = [String(row.productName)];
  }

  const paymentChannel = pi.paymentMethod || o.paymentMethod || row.paymentMethodName || '';
  const orderSn = String(o.sn || row.orderSn || o.id || row.orderId || '');
  const memberId = o.member ? String(o.member) : (o.memberId || row.memberId || '');
  const memberName = o.nickName || row.nickname || o.nickname || '微信用户';
  const consignee = o.consignee || row.consignee || '';
  const phone = o.phone || o.memberPhone || row.phone || '';
  const address = o.address || row.address || '';
  const memo = o.memo || row.memo || '';
  const platformName = row.source || row.platformName || '';
  const pfid = o.pfid || row.pfid || '';

  // 成本: 按上游商品标题匹配 products.title → cost_price (优先 cost_price, fallback o.cost/row.cost)
  const upstreamCost = Number(o.cost ?? row.cost ?? 0) || 0;
  const productCost = await lookupProductCost(productTitles);
  const cost = productCost > 0 ? productCost : upstreamCost;

  return {
    source: 'huaxiang',
    source_table: HUAXIANG_SOURCE_TABLE,
    shop_id: Number(shopId),
    shop_name: shop.shop_name,
    huaxiang_platform_id: String(pfid || shop.huaxiang_platform_id),
    order_no: orderSn,
    member_id: memberId,
    member_name: memberName,
    consignee,
    phone,
    shipping_address: { name: consignee, phone, text: address },
    items: productTitles.map((t) => ({ title: t, sku_id: '', qty: 1, unit_price: productSubtotal, subtotal: productSubtotal })),
    total: income,
    paid_at: tsToIso(paymentMs) || purchaseTime,
    created_at: purchaseTime,
    origin_site: 'huaxiang.cn',
    region: 'cn',
    payment_channel: paymentChannel,
    shipping_fee: shippingFee,
    coupon_discount: couponDiscount,
    cost: cost,
    pay_status: mapStatus(HUAXIANG_PAYMENT_STATUS, row.paymentStatus ?? o.paymentStatus),
    order_status: mapStatus(HUAXIANG_ORDER_STATUS, row.orderStatus),
    shipping_status: mapStatus(HUAXIANG_SHIPPING_STATUS, row.shippingStatus ?? o.shippingStatus),
    product_titles: productTitles,
    memo,
    platform_name: platformName,
    upstream: row,
    fetched_at: new Date().toISOString(),
  };
}

// ---------- sync state ----------
async function getSyncState(shopId) {
  const { rows } = await pool.query(
    `SELECT shop_id, last_synced_at, last_run_at, last_run_status, last_synced_count
       FROM huaxiang_sync_state WHERE shop_id = $1 LIMIT 1`,
    [shopId]
  );
  return rows[0] || null;
}

async function upsertSyncState(shopId, patch) {
  await pool.query(`
    INSERT INTO huaxiang_sync_state (shop_id, last_synced_at, last_run_at, last_run_status, last_synced_count, last_error)
    VALUES ($1, $2, NOW(), $3, $4, $5)
    ON CONFLICT (shop_id) DO UPDATE SET
      last_synced_at = COALESCE(EXCLUDED.last_synced_at, huaxiang_sync_state.last_synced_at),
      last_run_at = NOW(),
      last_run_status = EXCLUDED.last_run_status,
      last_synced_count = EXCLUDED.last_synced_count,
      last_error = EXCLUDED.last_error
  `, [
    shopId,
    patch.last_synced_at || null,
    patch.last_run_status || 'ok',
    patch.last_synced_count || 0,
    patch.last_error || null,
  ]);
}

// ---------- main sync per shop ----------
async function syncShop(shop, opts = {}) {
  const master = await fetchMasterShop();
  if (!master) throw new Error('master account "北京花卉" not found');
  if (!master.huaxiang_api_token) throw new Error('master account "北京花卉" missing huaxiang_api_token');

  const state = opts.fullSync ? null : await getSyncState(shop.id);
  const lookbackMs = LOOKBACK_HOURS * 3600 * 1000;
  const startTime = state?.last_synced_at
    ? new Date(new Date(state.last_synced_at).getTime() - 5 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19)
    : new Date(Date.now() - lookbackMs).toISOString().replace('T', ' ').slice(0, 19);
  const endTime = new Date().toISOString().replace('T', ' ').slice(0, 19);

  const filters = { startTime, endTime };
  let scanned = 0, published = 0, errors = 0;
  const errorList = [];
  let lastTotal = 0;
  let maxPurchaseTime = state?.last_synced_at || null;

  for (let p = 1; p <= MAX_PAGES_PER_SHOP; p++) {
    let resp;
    try {
      resp = await callHuaxiangFinds(master, shop.huaxiang_platform_id, filters, p, PAGE_SIZE);
    } catch (e) {
      errorList.push({ page: p, message: e.message });
      errors++;
      break;
    }
    if (resp.code !== 200) {
      errorList.push({ page: p, message: resp.status || resp.msg || `code=${resp.code}` });
      errors++;
      break;
    }
    const rows = Array.isArray(resp.data) ? resp.data : [];
    lastTotal = resp.count || lastTotal;
    if (!rows.length) break;

    for (const row of rows) {
      scanned++;
      try {
        const order = await mapRowToOrder(row, shop, shop.id);
        if (!order.order_no) continue;
        if (!nc) throw new Error('NATS not connected');
        const subject = `orders.paid.huaxiang.${shop.huaxiang_platform_id}.${order.order_no}`;
        const h = headers();
        h.append('Nats-Msg-Id', `huaxiang-${shop.huaxiang_platform_id}-${order.order_no}`);
        await nc.publish(subject, sc.encode(JSON.stringify({ order, region: 'cn' })), { headers: h });
        published++;
        const ts = order.created_at;
        if (ts && (!maxPurchaseTime || ts > maxPurchaseTime)) maxPurchaseTime = ts;
      } catch (e) {
        errors++;
        if (errorList.length < 5) errorList.push({ row: row?.order?.sn, message: e.message });
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }

  await upsertSyncState(shop.id, {
    last_synced_at: maxPurchaseTime,
    last_run_status: errors > 0 ? 'partial' : 'ok',
    last_synced_count: published,
    last_error: errors > 0 ? JSON.stringify(errorList) : null,
  });

  return { shopId: shop.id, shopName: shop.shop_name, scanned, published, errors, total: lastTotal, errorList, startTime, endTime };
}

async function syncAllShops() {
  const shops = await fetchShopsWithHuaxiang();
  const results = [];
  for (const shop of shops) {
    try {
      const r = await syncShop(shop);
      results.push(r);
      console.log(`[sync-all] ${shop.shop_name}: scanned=${r.scanned} published=${r.published} errors=${r.errors}`);
    } catch (e) {
      console.error(`[sync-all] ${shop.shop_name} failed: ${e.message}`);
      results.push({ shopId: shop.id, shopName: shop.shop_name, error: e.message });
      try { await upsertSyncState(shop.id, { last_run_status: 'failed', last_synced_count: 0, last_error: e.message }); } catch (_) {}
    }
  }
  return results;
}

// ---------- ensure schema ----------
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS huaxiang_sync_state (
      shop_id BIGINT PRIMARY KEY,
      last_synced_at TIMESTAMPTZ,
      last_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_run_status TEXT NOT NULL DEFAULT 'pending',
      last_synced_count INT NOT NULL DEFAULT 0,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS ix_huaxiang_sync_state_run_at ON huaxiang_sync_state(last_run_at DESC);
  `);
}

// ---------- HTTP API ----------
let nc = null;
let lastAutoRun = null;
let lastAutoResult = null;

function readJsonBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); } catch (e) { resolve({}); }
    });
  });
}

async function startHttpServer() {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const send = (code, body) => { res.writeHead(code); res.end(JSON.stringify(body)); };
    try {
      if (req.url === '/health') return send(200, { status: 'ok', service: 'huaxiang-sync-service' });
      if (req.url === '/status') {
        const { rows } = await pool.query(`SELECT shop_id, last_synced_at, last_run_at, last_run_status, last_synced_count, last_error FROM huaxiang_sync_state ORDER BY last_run_at DESC NULLS LAST`);
        return send(200, { lastAutoRun, lastAutoResult, states: rows });
      }
      const syncMatch = req.url.match(/^\/sync\/(\d+)$/);
      if (req.method === 'POST' && syncMatch) {
        const shopId = parseInt(syncMatch[1], 10);
        const body = await readJsonBody(req);
        const fullSync = !!body.fullSync;
        const { rows } = await pool.query(`SELECT id, shop_name, huaxiang_platform_id, huaxiang_api_base FROM shops WHERE id = $1 AND huaxiang_platform_id IS NOT NULL LIMIT 1`, [shopId]);
        if (!rows.length) return send(404, { error: `shop ${shopId} missing huaxiang_platform_id` });
        const result = await syncShop(rows[0], { fullSync });
        return send(200, result);
      }
      if (req.method === 'POST' && req.url === '/sync-all') {
        const results = await syncAllShops();
        return send(200, { results });
      }
      return send(404, { error: 'not found' });
    } catch (e) {
      console.error('[http]', e.message);
      return send(500, { error: e.message });
    }
  });
  server.listen(HTTP_PORT, '0.0.0.0', () => console.log(`[http] listening on :${HTTP_PORT}`));
}

// ---------- main ----------
async function main() {
  console.log('[boot] huaxiang-sync-service starting');
  await ensureSchema();
  await startHttpServer();
  nc = await natsConnect({ servers: NATS_URL });
  console.log(`[nats] connected ${NATS_URL}`);

  const runAuto = async () => {
    if (!nc) return;
    console.log(`[auto] running sync-all at ${new Date().toISOString()}`);
    lastAutoRun = new Date().toISOString();
    try {
      lastAutoResult = await syncAllShops();
    } catch (e) {
      console.error('[auto] failed:', e.message);
      lastAutoResult = { error: e.message };
    }
  };
  await runAuto();
  setInterval(runAuto, SYNC_INTERVAL_MS);

  process.on('SIGTERM', async () => {
    console.log('[shutdown] SIGTERM');
    try { if (nc) await nc.close(); } catch (_) {}
    try { await pool.end(); } catch (_) {}
    process.exit(0);
  });
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });