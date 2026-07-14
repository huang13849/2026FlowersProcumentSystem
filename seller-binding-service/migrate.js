const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({
  host: process.env.PG_HOST || '100.67.126.90',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD,
  database: process.env.NEW_ECOMMERCE_PG_DATABASE || 'new_ecommerce',
  max: 5,
});
(async () => {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(sql);
    await c.query('COMMIT');
    console.log('[seller-binding] schema migrated OK');
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('[seller-binding] migrate FAILED:', e.message);
    process.exit(1);
  } finally { c.release(); await pool.end(); }
})();
