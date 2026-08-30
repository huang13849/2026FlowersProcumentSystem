import { getPgPool } from '../config/db.js';
import { emitSubmissionEvent } from './submissionEvents.js';

let schemaReady;

// Product submissions are the durable link between an alliance post and the
// corresponding primary product.  Keep the lifecycle vocabulary explicit so
// a deleted primary product cannot leave a published community post behind.
export async function ensureSubmissionLifecycleSchema() {
  if (!schemaReady) {
    schemaReady = getPgPool().query(`
      ALTER TABLE public.product_submissions
        DROP CONSTRAINT IF EXISTS product_submissions_status_check;
      ALTER TABLE public.product_submissions
        ADD CONSTRAINT product_submissions_status_check
        CHECK (status IN ('draft','pending','approved','rejected','deleted'));
    `);
  }
  return schemaReady;
}

function eventMeta(submission, extra = {}) {
  const payload = submission.payload || {};
  return {
    submissionId: submission.id,
    status: submission.status,
    sourceProject: submission.source_project,
    submitterId: submission.submitter_id,
    sourcePostId: payload.plantAlliancePostId || payload.sourcePostId || payload.postId || null,
    ...extra,
  };
}

export async function markApprovedProductsDeleted(productIds, client = null) {
  if (!productIds.length) return [];
  await ensureSubmissionLifecycleSchema();
  const db = client || getPgPool();
  const { rows } = await db.query(
    `UPDATE public.product_submissions
        SET status='deleted', approved_product_id=NULL, updated_at=now(), review_note=COALESCE(review_note, '主商品已删除')
      WHERE approved_product_id = ANY($1::bigint[]) AND status='approved'
      RETURNING *`,
    [productIds.map(Number).filter(Number.isFinite)],
  );
  return rows;
}

export async function syncApprovedProductUpdate(product, client = null) {
  if (!product || !product.id) return [];
  await ensureSubmissionLifecycleSchema();
  const db = client || getPgPool();
  // JSONB merge retains sourcePostId / plantAlliancePostId while propagating
  // editable primary-product fields to the alliance-facing record.
  const { rows } = await db.query(
    `UPDATE public.product_submissions
        SET payload = payload || $1::jsonb, updated_at=now()
      WHERE approved_product_id=$2 AND status='approved'
      RETURNING *`,
    [JSON.stringify(product.toObject ? product.toObject() : product), Number(product.id)],
  );
  return rows;
}

export async function emitLifecycleEvents(submissions, action) {
  for (const submission of submissions || []) {
    await emitSubmissionEvent(eventMeta(submission, { action, productId: submission.approved_product_id }));
  }
}
