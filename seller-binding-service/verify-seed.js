// verify seed — password 从 env
const { Pool } = require('pg');
const password = process.env.PG_PASSWORD;
if (!password) { console.error('FATAL: PG_PASSWORD env not set'); process.exit(2); }
const p = new Pool({
  host: process.env.PG_HOST || '100.67.126.90',
  user: process.env.PG_USER || 'postgres',
  password,
  database: process.env.PG_DATABASE || 'new_ecommerce',
  port: parseInt(process.env.PG_PORT || '5432', 10),
});
(async () => {
  const r = await p.query('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=current_schema()');
  console.log('table count:', r.rows[0].count);
  await p.end();
})();
