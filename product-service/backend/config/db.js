// config/db.js - PG only, MongoDB dependency removed
import pg from 'pg';

const { Pool } = pg;

export let pgPool = null;

export function getPgPool() {
  if (!pgPool) {
    pgPool = new Pool({
      host: process.env.PG_HOST || '100.67.126.90',
      port: Number(process.env.PG_PORT || 5432),
      user: process.env.PG_USER || 'postgres',
      password: process.env.PG_PASSWORD,
      database: process.env.PG_DATABASE || 'supply_chain',
      max: 20,
      idleTimeoutMillis: 30_000,
    });
    pgPool.on('error', (err) => console.error('[pg-pool] idle client error:', err.message));
  }
  return pgPool;
}

export async function connectDB() {
  const p = getPgPool();
  await p.query('SELECT 1');
  console.log('[db] PG pool ready -> database=' + (process.env.PG_DATABASE || 'supply_chain'));
  // MongoDB connection removed - all data now in PostgreSQL
}
