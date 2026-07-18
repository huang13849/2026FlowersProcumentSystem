// models/AuditLog.js - PG-backed with mongoose-compatible surface
import crypto from 'crypto';
import { getPgPool } from '../config/db.js';

const TABLE = 'public.audit_logs';

async function ensureTable() {
  const pool = getPgPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id BIGSERIAL PRIMARY KEY,
    mongo_id TEXT UNIQUE,
    action TEXT NOT NULL,
    user_id TEXT,
    username TEXT,
    product_id TEXT,
    details JSONB DEFAULT '{}',
    ip TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

function toApi(row) {
  if (!row) return null;
  return {
    _id: row.mongo_id || String(row.id),
    id: row.mongo_id || String(row.id),
    action: row.action,
    userId: row.user_id,
    username: row.username,
    productId: row.product_id,
    details: row.details || {},
    ip: row.ip,
    createdAt: row.created_at,
    toObject() { return this; }
  };
}

const AuditLog = {
  async create(data) {
    await ensureTable();
    const pool = getPgPool();
    const mongoId = data._id || crypto.randomBytes(12).toString('hex');
    const r = await pool.query(
      `INSERT INTO ${TABLE} (mongo_id, action, user_id, username, product_id, details, ip) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [mongoId, data.action || 'unknown', data.userId || null, data.username || null, data.productId || null, JSON.stringify(data.details || data || {}), data.ip || null]
    );
    return toApi(r.rows[0]);
  },

  async countDocuments(query = {}) {
    await ensureTable();
    const pool = getPgPool();
    const r = await pool.query(`SELECT count(*)::int as c FROM ${TABLE}`);
    return r.rows[0].c;
  },

  async find(query = {}) {
    await ensureTable();
    const pool = getPgPool();
    const opts = query._options || {};
    let q = `SELECT * FROM ${TABLE}`;
    let order = 'created_at DESC';
    const vals = [];
    // Support sort('-createdAt') pattern
    if (opts.sort) {
      if (opts.sort === '-createdAt' || (typeof opts.sort === 'object' && opts.sort.createdAt === -1)) {
        order = 'created_at DESC';
      } else if (opts.sort === 'createdAt' || (typeof opts.sort === 'object' && opts.sort.createdAt === 1)) {
        order = 'created_at ASC';
      }
    }
    q += ` ORDER BY ${order}`;
    if (opts.skip) { vals.push(opts.skip); q += ` OFFSET $${vals.length}`; }
    if (opts.limit) { vals.push(opts.limit); q += ` LIMIT $${vals.length}`; }
    const r = await pool.query(q, vals);
    return r.rows.map(toApi);
  },

  // Chainable query builder for .find().sort().skip().limit() pattern
  find2() {
    let order = 'created_at DESC';
    let skipVal = 0;
    let limitVal = 0;
    const self = this;
    return {
      sort(s) {
        if (s === '-createdAt' || (typeof s === 'object' && s.createdAt === -1)) order = 'created_at DESC';
        else if (s === 'createdAt' || (typeof s === 'object' && s.createdAt === 1)) order = 'created_at ASC';
        return this;
      },
      skip(n) { skipVal = n; return this; },
      limit(n) { limitVal = n; return this; },
      async then(resolve, reject) {
        const pool = getPgPool();
        await ensureTable();
        let q = `SELECT * FROM ${TABLE} ORDER BY ${order}`;
        const vals = [];
        if (skipVal) { vals.push(skipVal); q += ` OFFSET $${vals.length}`; }
        if (limitVal) { vals.push(limitVal); q += ` LIMIT $${vals.length}`; }
        try {
          const r = await pool.query(q, vals);
          resolve(r.rows.map(toApi));
        } catch (e) { reject(e); }
      }
    };
  }
};

// Override find to support chainable pattern
AuditLog.find = function(query = {}) {
  // If called with no args or empty, return chainable
  if (!query || Object.keys(query).length === 0) {
    return AuditLog.find2();
  }
  // Direct find with query
  return AuditLog.find2();
};

export default AuditLog;
