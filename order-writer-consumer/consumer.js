// order-writer-consumer
// 从 NATS ORDERS stream (subject orders.paid.>) 消费 → upsert 到 purchase_orders 表
// 替换掉 order-service 里的 syncPaymentOrders setInterval

import pg from 'pg';
import { connect as natsConnect, StringCodec, AckPolicy, DeliverPolicy } from 'nats';

const { Pool } = pg;
const sc = StringCodec();

const PG_CONFIG = {
  host: process.env.PG_HOST || '100.67.126.90',
  port: parseInt(process.env.PG_PORT || '5432', 10),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || (function(){throw new Error('PG_PASSWORD env required')}()),
  database: process.env.PG_DATABASE || 'supply_chain',
};
const NATS_URL = process.env.NATS_URL || 'nats://nats.messaging.svc.cluster.local:4222';

const pool = new Pool(PG_CONFIG);

async function upsertPurchaseOrder(order, region) {
  const addr = order.shipping_address || {};
  const items = order.items || [];
  const titles = items.map(x => x.title || '');
  const ids = items.map(x => x.sku_id || '').filter(Boolean);
  const shopName = order.origin_site === 'horiculture.space' ? '植物收藏家(国际)' : '植物收藏家';
  const payload = { items, origin_site: order.origin_site, source: order.source, zid: order.zid, currency: order.currency };

  const exist = await pool.query(
    `SELECT id FROM purchase_orders WHERE source_table='plant_collector.orders' AND source_order_sn=$1 LIMIT 1`,
    [order.order_no]
  );

  if (exist.rows.length) {
    await pool.query(`
      UPDATE purchase_orders
         SET product_subtotal=$2, consignee=$3, phone=$4, delivery_address=$5,
             product_id=$6::jsonb, product_title=$7::jsonb,
             synced_payload=$8::jsonb, synced_at=NOW(),
             pay_status='paid', order_status='paid', updated_at=NOW()
       WHERE id=$1::int
    `, [
      exist.rows[0].id, order.total, addr.memberName || addr.name || '', addr.phone || '',
      addr.text || addr.address || '',
      JSON.stringify(ids), JSON.stringify(titles), JSON.stringify(payload)
    ]);
    return { action: 'update', id: exist.rows[0].id };
  } else {
    const r = await pool.query(`
      INSERT INTO purchase_orders
        (member_id, member_name, source_table, source_order_sn, payment_order_id, consignee, phone, delivery_address,
         product_subtotal, product_id, product_title,
         purchase_time, order_status, pay_status, shop_name, synced_payload, synced_at,
         business_type, region, tags, created_at, updated_at)
      VALUES ('', '', 'plant_collector.orders', $1::text, $1::text, $2, $3, $4, $5,
              $6::jsonb, $7::jsonb, $8, 'paid', 'paid', $9, $10::jsonb, NOW(),
              '植物收藏家', $11, $12::jsonb, $13, NOW())
      RETURNING id
    `, [
      order.order_no, addr.memberName || addr.name || '', addr.phone || '',
      addr.text || addr.address || '', order.total,
      JSON.stringify(ids), JSON.stringify(titles), order.paid_at || order.created_at,
      shopName, JSON.stringify(payload), region,
      JSON.stringify(['植物收藏家订单']), order.created_at
    ]);
    return { action: 'insert', id: r.rows[0].id };
  }
}

async function healthServer() {
  const http = await import('http');
  http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); res.end('ok'); }
    else { res.writeHead(404); res.end(); }
  }).listen(3021, '0.0.0.0', () => console.log('[health] :3021'));
}

async function main() {
  console.log('[boot] order-writer-consumer starting');
  await healthServer();

  const nc = await natsConnect({ servers: NATS_URL });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();

  // 创建/更新 durable consumer
  const consumerName = 'order-writer';
  try {
    await jsm.consumers.info('ORDERS', consumerName);
    console.log(`[nats] consumer ${consumerName} exists`);
  } catch {
    await jsm.consumers.add('ORDERS', {
      durable_name: consumerName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
      filter_subject: 'orders.paid.>',
      max_deliver: 5,
      ack_wait: 30 * 1e9,
    });
    console.log(`[nats] consumer ${consumerName} created`);
  }

  const consumer = await js.consumers.get('ORDERS', consumerName);
  const msgs = await consumer.consume({ max_messages: 10 });

  console.log('[loop] consuming orders.paid.>');
  for await (const m of msgs) {
    try {
      const data = JSON.parse(sc.decode(m.data));
      const { order, region } = data;
      const r = await upsertPurchaseOrder(order, region);
      console.log(`[${r.action}] order_no=${order.order_no} purchase_id=${r.id} nats_seq=${m.seq}`);
      m.ack();
    } catch (e) {
      console.error(`[error] seq=${m.seq}: ${e.message}`);
      m.nak();
    }
  }
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
