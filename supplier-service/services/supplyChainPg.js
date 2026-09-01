// PostgreSQL supply_chain connection — used only for read-side tag enrichment.
// All supplier writes go through models/Supplier.js (CNPG primary).
const { Pool } = require("pg");
let pool = null;
function getPool() {
  if (pool) return pool;
  pool = new Pool({
    host:     process.env.PG_HOST || "pg-ha-rw.pg-ha.svc.cluster.local",
    port:     Number(process.env.PG_PORT || 5432),
    user:     process.env.PG_USER || "postgres",
    password: process.env.PG_PASSWORD,
    database: process.env.SUPPLY_CHAIN_PG_DATABASE || process.env.PG_DATABASE || "supply_chain",
    max: 5, idleTimeoutMillis: 30000,
  });
  pool.on("error", (e) => console.error("[supply-chain-pg] pool error:", e.message));
  return pool;
}

async function filterMongoIdsByTags(tags) {
  const arr = Array.isArray(tags) ? tags.filter(Boolean) : [];
  if (!arr.length) return null;
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      "SELECT mongo_id FROM public.suppliers WHERE tags @> ::jsonb AND mongo_id IS NOT NULL",
      [JSON.stringify(arr)]
    );
    return rows.map(r => r.mongo_id);
  } catch (e) {
    console.warn("[supplyChainPg] filterMongoIdsByTags failed:", e.message);
    return [];
  }
}

module.exports = { getPool, filterMongoIdsByTags };
