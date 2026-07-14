const {Pool} = require('pg');
const p = new Pool({
  host: '100.67.126.90', user: 'postgres', password: '***REMOVED_PG_PW***',
  database: 'new_ecommerce', port: 5432
});
(async () => {
  const s = await p.query('SELECT id, shop_key, name, source_project, source_label, peony_org_id, zitadel_org_id, status FROM seller_shops');
  console.log('=== shops ===', s.rows);
  const b = await p.query('SELECT b.id, b.shop_id, b.phone, b.role, s.name shop_name, s.source_label FROM seller_user_bindings b JOIN seller_shops s ON s.id=b.shop_id');
  console.log('=== bindings ===', b.rows);
  const pl = await p.query('SELECT count(*)::int c FROM seller_product_links');
  console.log('=== product links ===', pl.rows[0].c);
  process.exit(0);
})();