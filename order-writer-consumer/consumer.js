// order-writer-consumer
// 从 NATS ORDERS stream (subject orders.paid.>) 消费 → upsert 到 purchase_orders 表
// 支持两种来源:
//   - source='plant_collector' (subject orders.paid.<region>.<order_no>)
//   - source='huaxiang'         (subject orders.paid.huaxiang.<platform_id>.<order_no>)

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

// plant_collector (new-e-commerce flower-app) upsert
async function upsertPlantCollectorOrder(order, region) {
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

// huaxiang (external 花像花木) upsert
async function upsertHuaxiangOrder(order) {
  const sourceTable = 'huaxiang_porder';
  const orderSn = order.order_no;
  const shopId = order.shop_id || null;
  const shopName = order.shop_name || '未关联';
  const purchaseTime = order.created_at || order.paid_at || new Date().toISOString();
  const productSubtotal = order.total || 0;
  const shippingFee = order.shipping_fee || 0;
  const couponDiscount = order.coupon_discount || 0;
  const paymentChannel = order.payment_channel || '';
  const memberId = order.member_id || '';
  const memberName = order.member_name || '微信用户';
  const consignee = order.consignee || '';
  const phone = order.phone || '';
  const address = (order.shipping_address && (order.shipping_address.text || order.shipping_address.address)) || '';
  const titles = order.product_titles || [];
  const payStatus = order.pay_status || '已支付';
  const orderStatus = order.order_status || '';
  const shippingStatus = order.shipping_status || '';
  const cost = order.cost || 0;
  const memo = order.memo || '';
  const platformName = order.platform_name || '';
  const payload = {
    source: order.source || 'huaxiang',
    shop_id: shopId,
    shop_name: shopName,
    huaxiang_platform_id: order.huaxiang_platform_id,
    payment_channel: paymentChannel,
    shipping_fee: shippingFee,
    coupon_discount: couponDiscount,
    pay_status: payStatus,
    order_status: orderStatus,
    shipping_status: shippingStatus,
    platform_name: platformName,
    upstream: order.upstream,
    fetched_at: order.fetched_at || new Date().toISOString(),
  };

  // UPSERT 用 UNIQUE INDEX (source_table='huaxiang_porder', source_order_sn) 避免重复
  const r = await pool.query(`
    INSERT INTO purchase_orders
      (member_id, member_name, phone, business_type, region, purchase_time,
       delivery_address, personal_tag, income_amount, expense_amount,
       payment_order_id, payment_channel, product_subtotal, shipping_fee,
       coupon_discount, cost_amount, profit_amount,
       source_table, source_order_key, source_order_id, source_order_sn,
       source_shop_id, shop_id, shop_name, shop_phone, consignee,
       order_status, shipping_status, pay_status, synced_at,
       tags, synced_payload)
    VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
            $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW(),$30::jsonb,$31::jsonb)
    ON CONFLICT (source_order_sn) WHERE source_table='huaxiang_porder' DO UPDATE SET
       source_order_key = EXCLUDED.source_order_key,
       source_order_id = EXCLUDED.source_order_id,
       source_shop_id = EXCLUDED.source_shop_id,
       shop_id = EXCLUDED.shop_id,
       shop_name = EXCLUDED.shop_name,
       shop_phone = EXCLUDED.shop_phone,
       consignee = EXCLUDED.consignee,
       order_status = EXCLUDED.order_status,
       shipping_status = EXCLUDED.shipping_status,
       pay_status = EXCLUDED.pay_status,
       purchase_time = COALESCE(EXCLUDED.purchase_time, purchase_orders.purchase_time),
       income_amount = EXCLUDED.income_amount,
       shipping_fee = EXCLUDED.shipping_fee,
       coupon_discount = EXCLUDED.coupon_discount,
       cost_amount = CASE WHEN EXCLUDED.cost_amount > 0 THEN EXCLUDED.cost_amount ELSE purchase_orders.cost_amount END,
       profit_amount = GREATEST(EXCLUDED.income_amount - COALESCE(NULLIF(EXCLUDED.cost_amount, 0), purchase_orders.cost_amount), 0),
       payment_channel = EXCLUDED.payment_channel,
       payment_order_id = EXCLUDED.payment_order_id,
       member_id = EXCLUDED.member_id,
       member_name = EXCLUDED.member_name,
       phone = EXCLUDED.phone,
       delivery_address = EXCLUDED.delivery_address,
       product_subtotal = EXCLUDED.product_subtotal,
       synced_payload = EXCLUDED.synced_payload,
       synced_at = NOW(),
       updated_at = NOW()
    RETURNING id, (xmax = 0) AS inserted
  `, [
    memberId, memberName, phone, paymentChannel || '外部订单', 'cn', purchaseTime,
    address, memo, productSubtotal, 0,
    orderSn, paymentChannel, productSubtotal, shippingFee,
    couponDiscount, cost, 0,
    sourceTable, orderSn, orderSn, orderSn,
    order.huaxiang_platform_id || '', shopId, shopName, phone, consignee,
    orderStatus, shippingStatus, payStatus,
    JSON.stringify(['北京花卉订单']), JSON.stringify(payload),
  ]);
  const id = r.rows[0]?.id;
  const inserted = r.rows[0]?.inserted;
  return { action: inserted ? 'insert' : 'update', id };
}

async function healthServer() {
  const http = await import('http');
  http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); res.end('ok'); }
    else { res.writeHead(404); res.end(); }
  }).listen(3021, '0.0.0.0', () => console.log('[health] :3021'));
}

async function main() {
  console.log('[boot] order-writer-consumer starting (plant_collector + huaxiang)');
  await healthServer();

  const nc = await natsConnect({ servers: NATS_URL });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();

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
      // 按 subject 前缀判断来源: orders.paid.huaxiang.> → huaxiang upsert
      const subj = m.subject || '';
      const source = subj.startsWith('orders.paid.huaxiang.') ? 'huaxiang' : (order?.source || 'plant_collector');
      let r;
      if (source === 'huaxiang') {
        r = await upsertHuaxiangOrder(order);
      } else {
        r = await upsertPlantCollectorOrder(order, region);
      }
      console.log(`[${r.action}] subject=${subj} source=${source} order_no=${order?.order_no} purchase_id=${r.id} nats_seq=${m.seq}`);
      m.ack();
    } catch (e) {
      console.error(`[error] seq=${m.seq}: ${e.message}`);
      m.nak();
    }
  }
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });