const { Pool } = require('pg');

let pool;
function db() {
  if (!pool) {
    pool = new Pool({
      host: process.env.PG_HOST || 'pg-ha-rw.pg-ha.svc.cluster.local', port: Number(process.env.PG_PORT || 5432),
      user: process.env.PG_USER || 'postgres', password: process.env.PG_PASSWORD,
      database: process.env.SUPPLY_CHAIN_PG_DATABASE || process.env.PG_DATABASE || 'supply_chain',
      max: 6, idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

async function ensureTable() {
  await db().query(`CREATE TABLE IF NOT EXISTS public.supplier_applications (
    id BIGSERIAL PRIMARY KEY,
    external_application_id TEXT NOT NULL UNIQUE,
    source_project TEXT NOT NULL,
    applicant_zid TEXT NOT NULL,
    company_name TEXT NOT NULL,
    credit_code TEXT NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    review_note TEXT,
    supplier_id TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await db().query('CREATE INDEX IF NOT EXISTS idx_supplier_applications_status ON public.supplier_applications(status, updated_at DESC)');
}

async function receive(event) {
  await ensureTable();
  const payload = {
    mainBusiness: String(event.mainBusiness || ''), companyAddress: String(event.companyAddress || ''),
    contactName: String(event.contactName || ''), contactPhone: String(event.contactPhone || ''),
    jobTitle: String(event.jobTitle || ''), businessLicenseFiles: Array.isArray(event.businessLicenseFiles) ? event.businessLicenseFiles : [],
  };
  const result = await db().query(
    `INSERT INTO public.supplier_applications
     (external_application_id, source_project, applicant_zid, company_name, credit_code, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,'pending')
     ON CONFLICT (external_application_id) DO UPDATE SET
       company_name=EXCLUDED.company_name, credit_code=EXCLUDED.credit_code, payload=EXCLUDED.payload,
       status='pending', review_note=NULL, supplier_id=NULL, updated_at=now()
     RETURNING *`,
    [String(event.applicationId), String(event.sourceProject || 'plant-alliance'), String(event.applicantZid || ''), String(event.companyName || ''), String(event.creditCode || ''), JSON.stringify(payload)],
  );
  return result.rows[0];
}

async function list(status) {
  await ensureTable();
  const values = [];
  const where = status && status !== 'all' ? (values.push(status), `WHERE status=$${values.length}`) : '';
  const result = await db().query(`SELECT * FROM public.supplier_applications ${where} ORDER BY updated_at DESC LIMIT 300`, values);
  return result.rows;
}

async function get(id) {
  await ensureTable();
  const result = await db().query('SELECT * FROM public.supplier_applications WHERE id=$1', [id]);
  return result.rows[0] || null;
}

async function decide(id, status, reviewNote, supplierId) {
  const result = await db().query(
    `UPDATE public.supplier_applications SET status=$1, review_note=$2, supplier_id=$3, reviewed_at=now(), updated_at=now()
      WHERE id=$4 RETURNING *`,
    [status, reviewNote || null, supplierId || null, id],
  );
  return result.rows[0] || null;
}

module.exports = { ensureTable, receive, list, get, decide };
