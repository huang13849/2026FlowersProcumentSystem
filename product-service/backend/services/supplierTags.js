
// Runtime supplier-tags loader (cached 60s)
// Given product's sellerName (or supplier_name), look up PG public.suppliers.tags
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST || '100.67.126.90',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres123',
  database: process.env.PG_DATABASE || 'supply_chain',
  max: 5,
});

let cache = { at: 0, map: new Map() };  // name -> tags[]
const TTL = 60_000;

async function refresh() {
  const r = await pool.query(
    `SELECT name, shop_name, tags FROM public.suppliers WHERE tags IS NOT NULL AND jsonb_typeof(tags) = 'array' AND jsonb_array_length(tags) > 0`
  );
  const m = new Map();
  for (const row of r.rows) {
    const tags = Array.isArray(row.tags) ? row.tags : [];
    if (row.name) m.set(row.name, tags);
    if (row.shop_name && !m.has(row.shop_name)) m.set(row.shop_name, tags);
  }
  cache = { at: Date.now(), map: m };
}

export async function getSupplierTagsMap() {
  if (Date.now() - cache.at > TTL) {
    try { await refresh(); }
    catch (e) { console.warn('[supplier-tags] refresh failed:', e.message); }
  }
  return cache.map;
}

export async function getInheritedTags(product) {
  const map = await getSupplierTagsMap();
  const keys = [product.sellerName, product.supplier_name].filter(Boolean);
  for (const k of keys) {
    if (map.has(k)) return map.get(k);
  }
  return [];
}

/**
 * Return list of supplier names whose tags include ANY of tagList
 */
export async function suppliersWithTags(tagList) {
  const map = await getSupplierTagsMap();
  const set = new Set();
  for (const [name, tags] of map.entries()) {
    if (tags.some(t => tagList.includes(t))) set.add(name);
  }
  return Array.from(set);
}
