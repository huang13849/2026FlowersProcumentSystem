// Dual-store connector: PG (products domain, primary)  +  Mongo (aux: AuditLog/Tag/User/ProductPublishTask).
// See ~/.hermes/skills/openclaw-imports/supply-chain-platform/ for migration playbook.
import mongoose from 'mongoose';
import pg from 'pg';

const { Pool } = pg;

let mongoConnected = false;
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
  // 1. PG (primary for products)
  const p = getPgPool();
  await p.query('SELECT 1');
  console.log('[db] PG pool ready → database=' + (process.env.PG_DATABASE || 'supply_chain'));

  // 2. Mongo (aux — still hosts audit_logs, tags, users, product_publish_tasks)
  if (mongoConnected) return;
  const uri = process.env.MONGODB_URI || 'mongodb://100.67.126.90:27017/supply_chain';
  try {
    await mongoose.connect(uri, {});
    mongoConnected = true;
    console.log('[db] Mongo connected (aux: AuditLog/Tag/User/ProductPublishTask)');
  } catch (err) {
    console.error('[db] MongoDB connection error:', err.message);
    // Not fatal — Product API can still serve if Mongo dies; audit logs will just warn.
    // But existing code has process.exit — preserve that until aux stores are migrated.
    process.exit(1);
  }
  mongoose.connection.on('disconnected', () => { mongoConnected = false; });
}
