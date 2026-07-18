// wecom-notifier
// 从 NATS ORDERS stream 消费 orders.paid.> → 推企业微信群机器人
// 用独立 durable consumer 与 order-writer 完全解耦（一个挂了不影响另一个）

import { connect as natsConnect, StringCodec, AckPolicy, DeliverPolicy } from 'nats';

const sc = StringCodec();

const NATS_URL = process.env.NATS_URL || 'nats://nats.messaging.svc.cluster.local:4222';
const WECOM_WEBHOOK_URL = process.env.WECOM_WEBHOOK_URL;

if (!WECOM_WEBHOOK_URL) {
  console.error('[fatal] WECOM_WEBHOOK_URL not set');
  process.exit(1);
}

function formatMoney(v, cur='CNY') {
  const sym = cur === 'USD' ? '$' : '¥';
  return sym + Number(v || 0).toFixed(2);
}

function buildMarkdown(data) {
  const { order, region } = data;
  const addr = order.shipping_address || {};
  const items = order.items || [];
  const shopName = order.origin_site === 'horiculture.space' ? '植物收藏家(国际)' : '植物收藏家';
  const flag = region === 'global' ? '🌐 国际' : '🇨🇳 国内';
  const totalStr = formatMoney(order.total, order.currency || 'CNY');

  const itemsMd = items.slice(0, 5).map(it =>
    `> ${it.title || '未命名'} × ${it.qty || 1}  ${formatMoney(it.unit_price, order.currency)}`
  ).join('\n');
  const more = items.length > 5 ? `\n> ...另 ${items.length - 5} 件` : '';

  return {
    msgtype: 'markdown',
    markdown: {
      content:
`💰 **新订单支付成功** ${flag}
> **店铺**: ${shopName}
> **单号**: \`${order.order_no}\`
> **金额**: <font color="warning">${totalStr}</font>
> **收货人**: ${addr.memberName || addr.name || '(未填)'}
> **电话**: ${addr.phone || '(未填)'}
> **地址**: ${(addr.text || addr.address || '').slice(0, 60)}
> **商品**:
${itemsMd}${more}
> **支付时间**: ${new Date(order.paid_at || order.created_at).toLocaleString('zh-CN', {timeZone:'Asia/Shanghai'})}`
    }
  };
}

async function sendWecom(payload) {
  const res = await fetch(WECOM_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${body}`);
  const j = JSON.parse(body);
  if (j.errcode !== 0) throw new Error(`wecom errcode=${j.errcode} ${j.errmsg}`);
  return j;
}

async function healthServer() {
  const http = await import('http');
  http.createServer((req, res) => {
    if (req.url === '/health') { res.writeHead(200); res.end('ok'); }
    else { res.writeHead(404); res.end(); }
  }).listen(3022, '0.0.0.0', () => console.log('[health] :3022'));
}

async function main() {
  console.log('[boot] wecom-notifier starting');
  await healthServer();

  const nc = await natsConnect({ servers: NATS_URL });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();

  const consumerName = 'wecom-notifier';
  try {
    await jsm.consumers.info('ORDERS', consumerName);
  } catch {
    await jsm.consumers.add('ORDERS', {
      durable_name: consumerName,
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.New,   // 只推新消息, 不 backfill 历史 (避免炸群)
      filter_subject: 'orders.paid.>',
      max_deliver: 3,
      ack_wait: 60 * 1e9,
    });
    console.log('[nats] consumer created (DeliverPolicy=New)');
  }

  const consumer = await js.consumers.get('ORDERS', consumerName);
  const msgs = await consumer.consume({ max_messages: 5 });

  console.log('[loop] consuming orders.paid.> → wecom');
  for await (const m of msgs) {
    try {
      const data = JSON.parse(sc.decode(m.data));
      const payload = buildMarkdown(data);
      const r = await sendWecom(payload);
      console.log(`[sent] order_no=${data.order.order_no} nats_seq=${m.seq} wecom=${r.errcode}`);
      m.ack();
    } catch (e) {
      console.error(`[error] seq=${m.seq}: ${e.message}`);
      m.nak(10 * 1000); // 10s 后重试
    }
  }
}

main().catch(e => { console.error('[fatal]', e); process.exit(1); });
