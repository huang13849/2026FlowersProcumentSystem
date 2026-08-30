import { Router } from 'express';
import { getPgPool } from '../config/db.js';
import Product from '../models/Product.js';
import { addSubmissionEventClient, emitSubmissionEvent } from '../services/submissionEvents.js';

const router = Router();
let ready;
const DEFAULT_SOURCES = ['plant-alliance', 'peony-alliance', 'tropical-alliance'];
const ALLOWED_SOURCES = (process.env.ALLIANCE_SUBMISSION_SOURCES || DEFAULT_SOURCES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SYSTEM_PRODUCT_FIELDS = new Set(['id', '_id', 'createdAt', 'updatedAt', 'created_at', 'updated_at', 'status']);

async function ensureTable() {
  if (!ready) ready = getPgPool().query(`
    CREATE TABLE IF NOT EXISTS public.product_submissions (
      id BIGSERIAL PRIMARY KEY,
      source_project TEXT NOT NULL,
      submitter_id TEXT NOT NULL,
      submitter_name TEXT,
      submitter_email TEXT,
      payload JSONB NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft','pending','approved','rejected')),
      review_note TEXT,
      reviewed_by TEXT,
      reviewed_at TIMESTAMPTZ,
      approved_product_id BIGINT REFERENCES public.products(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS product_submissions_queue_idx ON public.product_submissions(status, created_at DESC);
    CREATE INDEX IF NOT EXISTS product_submissions_owner_idx ON public.product_submissions(source_project, submitter_id, updated_at DESC);
  `);
  return ready;
}

function actor(req) {
  // The alliance backend must authenticate to this endpoint.  The key is only
  // used for service-to-service traffic and must not be exposed in browsers.
  if (process.env.ALLIANCE_SUBMISSION_KEY && req.get('x-alliance-submission-key') !== process.env.ALLIANCE_SUBMISSION_KEY) return null;
  const id = String(req.get('x-submitter-id') || '').trim();
  if (!id) return null;
  return { id, name: String(req.get('x-submitter-name') || '').trim() || null, email: String(req.get('x-submitter-email') || '').trim() || null };
}

function normalizeSourceProject(value) {
  const source = String(value || 'plant-alliance').trim();
  if (!ALLOWED_SOURCES.includes(source)) return null;
  return source;
}

function cleanProduct(product) {
  const out = {};
  for (const [key, value] of Object.entries(product || {})) {
    if (SYSTEM_PRODUCT_FIELDS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

router.post('/', async (req, res) => {
  const a = actor(req);
  if (!a) return res.status(401).json({ error: '投稿身份无效' });
  const { sourceProject = 'plant-alliance', product, status = 'pending' } = req.body || {};
  const source = normalizeSourceProject(sourceProject);
  if (!source) return res.status(400).json({ error: '投稿来源无效' });
  const payload = cleanProduct(product);
  if (!String(payload.title || '').trim()) return res.status(400).json({ error: '请填写商品名称' });
  if (!['draft', 'pending'].includes(status)) return res.status(400).json({ error: '投稿状态无效' });
  try {
    await ensureTable();
    const { rows } = await getPgPool().query(
      `INSERT INTO public.product_submissions(source_project,submitter_id,submitter_name,submitter_email,payload,status)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [source, a.id, a.name, a.email, payload, status],
    );
    await emitSubmissionEvent({ action: 'created', submissionId: rows[0].id, status: rows[0].status, sourceProject: source });
    res.status(201).json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/mine', async (req, res) => {
  const a = actor(req);
  if (!a) return res.status(401).json({ error: '投稿身份无效' });
  try {
    await ensureTable();
    const source = normalizeSourceProject(req.query.sourceProject);
    if (!source) return res.status(400).json({ error: '投稿来源无效' });
    const { rows } = await getPgPool().query(
      `SELECT * FROM public.product_submissions WHERE source_project=$1 AND submitter_id=$2 ORDER BY updated_at DESC`,
      [source, a.id],
    );
    res.json({ submissions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/:id', async (req, res) => {
  const a = actor(req);
  if (!a) return res.status(401).json({ error: '投稿身份无效' });
  const { product, status = 'pending', sourceProject = 'plant-alliance' } = req.body || {};
  const source = normalizeSourceProject(sourceProject);
  const payload = cleanProduct(product);
  if (!source || !String(payload.title || '').trim() || !['draft', 'pending'].includes(status)) return res.status(400).json({ error: '投稿内容无效' });
  try {
    await ensureTable();
    const { rows } = await getPgPool().query(
      `UPDATE public.product_submissions SET payload=$1,status=$2,updated_at=now()
       WHERE id=$3 AND source_project=$4 AND submitter_id=$5 AND status IN ('draft','pending','rejected') RETURNING *`,
      [payload, status, req.params.id, source, a.id],
    );
    if (!rows[0]) return res.status(404).json({ error: '投稿不存在或不可修改' });
    await emitSubmissionEvent({ action: 'updated', submissionId: rows[0].id, status: rows[0].status, sourceProject: source });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/count', async (req, res) => {
  try {
    await ensureTable();
    const status = String(req.query.status || 'pending');
    const { rows } = await getPgPool().query(
      `SELECT count(*)::int AS count FROM public.product_submissions WHERE status=$1`,
      [status],
    );
    res.json({ status, count: rows[0]?.count || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/events', async (_req, res) => {
  try {
    await ensureTable();
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    await addSubmissionEventClient(res);
  } catch (e) {
    res.write(`event: error\ndata: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// 31001 is an intranet console by design; review does not use a separate role.
router.get('/', async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await getPgPool().query(`SELECT * FROM public.product_submissions WHERE status=$1 ORDER BY created_at ASC`, [req.query.status || 'pending']);
    res.json({ submissions: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/:id/approve', async (req, res) => {
  const client = await getPgPool().connect();
  try {
    await ensureTable();
    await client.query('BEGIN');
    const { rows } = await client.query('SELECT * FROM public.product_submissions WHERE id=$1 FOR UPDATE', [req.params.id]);
    const submission = rows[0];
    if (!submission) throw new Error('投稿不存在');
    if (submission.status === 'approved') throw new Error('该投稿已入库');
    if (submission.status !== 'pending') throw new Error('仅待审核投稿可以通过');
    const product = await Product.create({ ...submission.payload, createdBy: submission.submitter_id }, client);
    const result = await client.query(
      `UPDATE public.product_submissions SET status='approved', reviewed_by=$1, reviewed_at=now(), review_note=$2, approved_product_id=$3, updated_at=now() WHERE id=$4 RETURNING *`,
      [String(req.get('x-reviewer') || 'intranet-reviewer'), req.body?.reviewNote || null, product.id, submission.id],
    );
    await client.query('COMMIT');
    await emitSubmissionEvent({ action: 'approved', submissionId: submission.id, status: 'approved', productId: product.id, sourceProject: submission.source_project });
    res.json({ submission: result.rows[0], product });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(e.message.includes('投稿') ? 400 : 500).json({ error: e.message });
  } finally { client.release(); }
});

router.post('/:id/reject', async (req, res) => {
  try {
    await ensureTable();
    const { rows } = await getPgPool().query(
      `UPDATE public.product_submissions SET status='rejected',reviewed_by=$1,reviewed_at=now(),review_note=$2,updated_at=now()
       WHERE id=$3 AND status='pending' RETURNING *`,
      [String(req.get('x-reviewer') || 'intranet-reviewer'), req.body?.reviewNote || null, req.params.id],
    );
    if (!rows[0]) return res.status(404).json({ error: '待审核投稿不存在' });
    await emitSubmissionEvent({ action: 'rejected', submissionId: rows[0].id, status: 'rejected', sourceProject: rows[0].source_project });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
