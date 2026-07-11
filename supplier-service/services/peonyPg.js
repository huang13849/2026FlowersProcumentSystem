// PostgreSQL new_ecommerce connection for Peony Alliance domain
const { Pool } = require('pg');
let pool = null;
function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host:     process.env.PG_HOST || '100.67.126.90',
    port:     Number(process.env.PG_PORT || 5432),
    user:     process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD,
    database: process.env.NEW_ECOMMERCE_PG_DATABASE || 'new_ecommerce',
    max: 5, idleTimeoutMillis: 30000,
  });
  pool.on('error', (e) => console.error('[peony-pg] pool error:', e.message));
  return pool;
}
module.exports = { getPool };
