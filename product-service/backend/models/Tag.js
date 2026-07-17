// ─────────────────────────────────────────────────────────────────────────
//  models/Tag.js — PG-backed with mongoose-compatible surface.
//
//  Data lives in plant_collector.tags (PG). All callers still expect a
//  Mongoose model API (find/findOneAndUpdate/deleteOne), so this shim
//  keeps the wire contract. Only the methods actually used by the
//  product-service route layer are implemented.
//
//  Historical Mongo `tags` collection is deprecated; a one-shot migration
//  script folds any Mongo-only names into plant_collector.tags.
// ─────────────────────────────────────────────────────────────────────────
import { getPgPool } from '../config/db.js';

const TABLE = 'plant_collector.tags';

// Camel ↔ snake mapping. PG has more columns than the old Mongo schema —
// we surface the historical Mongo fields and ignore the rest for callers.
function toApi(row) {
  if (!row) return null;
  return {
    _id: row.name,                 // legacy code expected a stable id — use name as pk
    name: row.name,
    color: row.color || '',
    bg: row.bg || '',
    border: row.border || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageCount: Number(row.usage_count || 0),
    category: row.category || '',
    scope: row.scope || [],
    isSystem: !!row.is_system,
    visibility: row.visibility || 'public',
  };
}

// Query shim — supports the chain used in routes/tags.js:
//   Tag.find({}).sort({...}).lean()
class Query {
  constructor(filter = {}) {
    this._filter = filter;
    this._sort = null;
    this._lean = false;
  }
  sort(spec) { this._sort = spec; return this; }
  lean() { this._lean = true; return this; }
  select() { return this; }
  limit(n) { this._limit = n; return this; }
  async exec() { return this._run(); }
  then(res, rej) { return this._run().then(res, rej); }
  catch(rej) { return this._run().catch(rej); }

  async _run() {
    const params = [];
    const where = [];
    // Only simple equality filters are used; fall back to no-op otherwise.
    for (const [k, v] of Object.entries(this._filter || {})) {
      if (v === undefined) continue;
      params.push(v);
      if (k === 'name') where.push(`name = $${params.length}`);
    }
    // Filter out soft-deleted rows
    let sql = `SELECT * FROM ${TABLE} WHERE deprecated_at IS NULL`;
    if (where.length) sql += ` AND ${where.join(' AND ')}`;
    // Sort mapping: mongoose keys → PG columns. Map keys we know; ignore rest.
    if (this._sort) {
      const parts = [];
      for (const [k, dir] of Object.entries(this._sort)) {
        const col = k === 'usageCount' ? 'usage_count'
                  : k === 'createdAt' ? 'created_at'
                  : k === 'updatedAt' ? 'updated_at'
                  : k === 'sortOrder' ? 'sort_order'
                  : null;
        if (col) parts.push(`${col} ${dir < 0 ? 'DESC' : 'ASC'}`);
      }
      if (parts.length) sql += ` ORDER BY ${parts.join(', ')}`;
    }
    if (this._limit) sql += ` LIMIT ${Number(this._limit)}`;
    const r = await getPgPool().query(sql, params);
    return r.rows.map(toApi);
  }
}

const Tag = {
  find(filter = {}) { return new Query(filter); },

  // findOneAndUpdate({name:x}, {$setOnInsert:{...}}, {upsert:true, new:true})
  async findOneAndUpdate(filter, update, opts = {}) {
    const name = String(filter?.name || '').trim();
    if (!name) return null;
    const setOnInsert = update?.$setOnInsert || {};
    const set = update?.$set || {};
    const pool = getPgPool();
    if (opts.upsert) {
      // Try insert; on conflict do nothing; then select.
      const params = [
        name,
        setOnInsert.color ?? set.color ?? '',
        setOnInsert.bg ?? set.bg ?? '',
        setOnInsert.border ?? set.border ?? '',
        setOnInsert.createdBy ?? set.createdBy ?? '',
      ];
      await pool.query(
        `INSERT INTO ${TABLE}
           (name, color, bg, border, created_by, scope, usage_count, created_at, updated_at, visibility, is_system)
         VALUES ($1, $2, $3, $4, $5, ARRAY['product']::text[], 0, NOW(), NOW(), 'public', false)
         ON CONFLICT (name) DO NOTHING`,
        params,
      );
    }
    // Apply $set if any
    if (Object.keys(set).length) {
      const cols = [];
      const params = [name];
      const map = { color: 'color', bg: 'bg', border: 'border', createdBy: 'created_by' };
      for (const [k, v] of Object.entries(set)) {
        if (map[k]) { params.push(v); cols.push(`${map[k]} = $${params.length}`); }
      }
      if (cols.length) {
        cols.push('updated_at = NOW()');
        await pool.query(`UPDATE ${TABLE} SET ${cols.join(', ')} WHERE name = $1`, params);
      }
    }
    const r = await pool.query(`SELECT * FROM ${TABLE} WHERE name = $1`, [name]);
    return toApi(r.rows[0]);
  },

  async deleteOne(filter) {
    const name = String(filter?.name || '').trim();
    if (!name) return { deletedCount: 0 };
    // Soft delete via deprecated_at, keeping history & downstream referential safety.
    const r = await getPgPool().query(
      `UPDATE ${TABLE} SET deprecated_at = NOW(), updated_at = NOW() WHERE name = $1 AND deprecated_at IS NULL`,
      [name],
    );
    return { deletedCount: r.rowCount || 0 };
  },
};

export default Tag;
