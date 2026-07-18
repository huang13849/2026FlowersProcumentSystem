// payment-sync-worker
// 职责: 监听 PG plant_collector.orders 支付事件 → publish 到 NATS orders.paid.<region>.<order_no>
// - 事件驱动: LISTEN order_paid
// - 兼底: 启动时 + 每 5 分钟 poll 一次 synced_at IS NULL 的历史订单
// - 幂等: NATS msgId = order_no + Nats-Msg-Id header + dupe-window
//         同时 plant_collector.orders.synced_at 打点, 避免下次 poll 重复推

import pg from 'pg';
import { connect as natsConnect, headers, StringCodec } from 'nats';

const { Pool } = pg;
const sc = StringCodec();

const PG_CONFIG = {
  host: process.env.PG_HOST || '100.67.126.90',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || '***REMOVED_PG_PW***',
  database: process.env.PG_DATABASE || 'supply_chain',
};
const NATS_URL = process.env.NATS_URL || 'nats://nats.messaging.svc.cluster.local:4222';
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '300000', 10); // 5min

const pool = new Pool(PG_CONFIG);
let nc, js;

async function fetchOrderDetail(order_no) {
  const { rows } = await pool.query(`
    SELECT o.id, o.order_no, o.status, o.total, o.currency, o.shipping_address,
           o.paid_at, o.created_at, o.zid, o.source, o.origin_site,
           (SELECT jsonb_agg(jsonb_build_object(
              'title', oi.title, 'qty', oi.qty,
              'unit_price', oi.unit_price, 'subtotal', oi.subtotal,
              'sku_id', oi.sku_id,
              'image', COALESCE(oi.snapshot->>'image', oi.snapshot->'snapshot'->>'image')
            )) FROM plant_collector.order_items oi WHERE oi.order_id = o.id) AS items
      FROM plant_collector.orders o
     WHERE o.order_no = $1
     LIMIT 1
  `, [order_no]);
  return rows[0] || null;
}

async function publishOrder(row) {
  const region = row.origin_site === 'horiculture.space' ? 'global' : 'cn';
  const subject = `orders.paid.${region}.${row.order_no}`;
  const h = headers();
  h.append('Nats-Msg-Id', `paid-${row.order_no}`); // JetStream 幂等 (dupe-window 2m)
  const payload = {
    event: 'order.paid',
    order: row,
    region,
    ts: new Date().toISOString(),
  };
  const ack = await js.publish(subject, sc.encode(JSON.stringify(payload)), { headers: h });
  return { subject, seq: ack.seq, duplicate: ack.duplicate };
}

async function markSynced(order_no) {
  await pool.query(
    `UPDATE plant_collector.orders SET synced_at = NOW() WHERE order_no = $1`,
    [order_no]
  );
}

async function handleOrderPaid(order_no, reason='event') {
  try {
    const row = await fetchOrderDetail(order_no);
    if (!row) { console.warn(`[skip] order_no=${order_no} not found`); return; }
    if (row.status !== 'paid') { console.warn(`[skip] order_no=${order_no} status=${row.status}`); return; }
    const info = await publishOrder(row);
    await markSynced(order_no);
    console.log(`[publish/${reason}] order_no=${order_no} → ${info.subject} seq=${info.seq} dup=${info.duplicate}`);
  } catch (e) {
    console.error(`[error/${reason}] order_no=${order_no}: ${e.message}`);
  }
}

async function backfillPoll() {
  try {
    const { rows } = await pool.query(`
      SELECT order_no FROM plant_collector.orders
       WHERE status='paid' AND synced_at IS NULL
       ORDER BY paid_at NULLS LAST, id
       LIMIT 200
    `);
    if (rows.length) console.log(`[poll] backfill ${rows.length} orders`);
    for (const r of rows) await handleOrderPaid(r.order_no, 'poll');
  } catch (e) {
    console.error(`[poll error] ${e.message}`);
  }
}

async function startListener() {
  const client = await pool.connect();
  client.on('notification', async (msg) => {
    try {
      const data = JSON.parse(msg.payload);
      await handleOrderPaid(data.order_no, 'listen');
    } catch (e) {
      console.error('[listen parse] ', e.message, msg.payload);
    }
  });
  client.on('error', (e) => console.error('[pg client error]', e.message));
  await client.query('LISTEN order_paid');
  console.log('[listen] subscribed to order_paid channel');
  return client;
}

async function healthServer() {
  const http = await import('http');
  http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); res.end('ok'); }
    else { res.writeHead(404); res.end(); }
  }).listen(3020, '0.0.0.0', () => console.log('[health] :3020'));
}

async function main() {
  console.log('[boot] payment-sync-worker starting');
  nc = await natsConnect({ servers: NATS_URL });
  js = nc.jetstream();
  console.log(`[nats] connected ${NATS_URL}`);

  await healthServer();

  // 启动 backfill (兼底: 补齐历史 + 上次掉线期间的漏消息)
  await backfillPoll();

  // PG LISTEN
  const listener = await startListener();

  // 定期 backfill
  setInterval(backfillPoll, POLL_INTERVAL_MS);

  // graceful shutdown
  const shutdown = async () => {
    console.log('[shutdown]');
    try { listener.release(); } catch {}
    try { await nc.drain(); } catch {}
    try { await pool.end(); } catch {}
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
