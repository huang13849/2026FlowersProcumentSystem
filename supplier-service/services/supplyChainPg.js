// PostgreSQL supply_chain connection for self-op supplier mirror
const { Pool } = require('pg');
let pool = null;
function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host:     process.env.PG_HOST || '100.67.126.90',
    port:     Number(process.env.PG_PORT || 5432),
    user:     process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD,
    database: process.env.SUPPLY_CHAIN_PG_DATABASE || 'supply_chain',
    max: 5, idleTimeoutMillis: 30000,
  });
  pool.on('error', (e) => console.error('[supply-chain-pg] pool error:', e.message));
  return pool;
}

async function mirrorUpsert(doc) {
  if (!doc) return;
  const mid = String(doc._id);
  try {
    const p = getPool();
    await p.query(`
      INSERT INTO public.suppliers
        (mongo_id, project, name, shop_name, status, contact, contacts, company_info, business_items,
         address, planting_area, estimated_inventory, sales_period, location, contract_files,
         license_files, dispatch_files, notes, product_count, product_ids, sort_order, peony_alliance, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
      ON CONFLICT (mongo_id) DO UPDATE SET
        project=EXCLUDED.project, name=EXCLUDED.name, shop_name=EXCLUDED.shop_name, status=EXCLUDED.status,
        contact=EXCLUDED.contact, contacts=EXCLUDED.contacts, company_info=EXCLUDED.company_info,
        business_items=EXCLUDED.business_items, address=EXCLUDED.address,
        planting_area=EXCLUDED.planting_area, estimated_inventory=EXCLUDED.estimated_inventory,
        sales_period=EXCLUDED.sales_period, location=EXCLUDED.location,
        contract_files=EXCLUDED.contract_files, license_files=EXCLUDED.license_files,
        dispatch_files=EXCLUDED.dispatch_files, notes=EXCLUDED.notes,
        product_count=EXCLUDED.product_count, product_ids=EXCLUDED.product_ids,
        sort_order=EXCLUDED.sort_order, peony_alliance=EXCLUDED.peony_alliance,
        updated_at=NOW()`,
      [mid, doc.project || '', doc.name || '', doc.shop_name || null, doc.status || '待整理',
       doc.contact || {}, doc.contacts || [], doc.company_info || {}, doc.business_items || [],
       doc.address || '',
       doc.planting_area, doc.estimated_inventory,
       doc.sales_period || [], doc.location || {}, doc.contract_files || [],
       doc.license_files || [], doc.dispatch_files || [], doc.notes || null,
       doc.product_count || 0, doc.product_ids || [], doc.sortOrder || 0, doc.peony_alliance || {}]
    );
  } catch (e) { console.warn('[pg-mirror upsert] fail', mid, e.message); }
}
async function mirrorDelete(mongoId) {
  try {
    await getPool().query('DELETE FROM public.suppliers WHERE mongo_id=$1', [String(mongoId)]);
  } catch (e) { console.warn('[pg-mirror delete] fail', mongoId, e.message); }
}

async function filterMongoIdsByTags(tags) {
  const arr = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!arr.length) return null;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT mongo_id FROM public.suppliers WHERE tags @> $1::jsonb AND mongo_id IS NOT NULL",
      [JSON.stringify(arr)]
    );
    return rows.map(r => r.mongo_id);
  } catch (e) {
    console.warn('[supplyChainPg] filterMongoIdsByTags failed:', e.message);
    return [];
  }
}

module.exports = { getPool, mirrorUpsert, mirrorDelete, filterMongoIdsByTags };
