import { connect, JSONCodec, RetentionPolicy, StorageType } from 'nats';
import { getPgPool } from '../config/db.js';

const SUBJECT = process.env.PRODUCT_SUBMISSION_EVENTS_SUBJECT || 'product.submissions.changed';
const STREAM = process.env.PRODUCT_SUBMISSION_EVENTS_STREAM || 'PRODUCT_SUBMISSIONS';
const NATS_URL = process.env.NATS_URL || 'nats://nats.messaging.svc.cluster.local:4222';
const jc = JSONCodec();
const clients = new Set();
let ncPromise = null;

async function pendingCount() {
  const { rows } = await getPgPool().query(
    `SELECT count(*)::int AS count FROM public.product_submissions WHERE status='pending'`,
  );
  return rows[0]?.count || 0;
}

export async function submissionSnapshot(extra = {}) {
  return {
    type: 'product-submissions.changed',
    pendingCount: await pendingCount(),
    at: new Date().toISOString(),
    ...extra,
  };
}

function writeSse(res, event) {
  res.write(`event: ${event.type || 'message'}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export async function addSubmissionEventClient(res) {
  clients.add(res);
  writeSse(res, await submissionSnapshot({ reason: 'connected' }));
  res.on('close', () => clients.delete(res));
}

export async function emitSubmissionEvent(extra = {}) {
  const event = await submissionSnapshot(extra);
  for (const res of Array.from(clients)) {
    try { writeSse(res, event); } catch { clients.delete(res); }
  }
  try {
    const nc = await nats();
    try {
      await nc.jetstream().publish(SUBJECT, jc.encode(event));
    } catch (e) {
      console.warn('[submission-events] jetstream publish fallback:', e.message);
      nc.publish(SUBJECT, jc.encode(event));
    }
  } catch (e) {
    console.warn('[submission-events] nats publish skipped:', e.message);
  }
  return event;
}

async function nats() {
  if (!ncPromise) {
    ncPromise = connect({ servers: NATS_URL, name: 'product-api-submission-events', timeout: 2000 })
      .then((nc) => {
        console.log('[submission-events] connected to ' + NATS_URL);
        ensureStream(nc).catch((e) => console.warn('[submission-events] jetstream stream skipped:', e.message));
        const sub = nc.subscribe(SUBJECT);
        (async () => {
          for await (const msg of sub) {
            try {
              const event = jc.decode(msg.data);
              for (const res of Array.from(clients)) writeSse(res, event);
            } catch (e) {
              console.warn('[submission-events] nats decode skipped:', e.message);
            }
          }
        })();
        nc.closed().then((err) => {
          if (err) console.warn('[submission-events] nats closed:', err.message);
          ncPromise = null;
        });
        return nc;
      })
      .catch((e) => {
        ncPromise = null;
        throw e;
      });
  }
  return ncPromise;
}

export function startSubmissionEventBus() {
  nats().catch((e) => console.warn('[submission-events] nats connect skipped:', e.message));
}

async function ensureStream(nc) {
  const jsm = await nc.jetstreamManager();
  try {
    await jsm.streams.info(STREAM);
  } catch {
    await jsm.streams.add({
      name: STREAM,
      subjects: [SUBJECT],
      retention: RetentionPolicy.Limits,
      storage: StorageType.File,
      max_msgs: 10000,
      max_age: 7 * 24 * 60 * 60 * 1_000_000_000,
    });
    console.log('[submission-events] jetstream stream created: ' + STREAM);
  }
}
