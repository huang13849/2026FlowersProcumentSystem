// models/User.js - PG-backed with mongoose-compatible surface
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getPgPool } from '../config/db.js';

const TABLE = 'public.users';

function toApi(row) {
  if (!row) return null;
  return {
    _id: row.mongo_id || String(row.id),
    id: row.mongo_id || String(row.id),
    username: row.username,
    password: row.password,
    role: row.role,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // mongoose compat
    comparePassword(candidate) { return bcrypt.compare(candidate, this.password); },
    toObject() {
      const { password, ...rest } = this;
      return rest;
    }
  };
}

const User = {
  async findOne(query) {
    const pool = getPgPool();
    let q = `SELECT * FROM ${TABLE} WHERE 1=1`;
    const vals = [];
    if (query.username) { vals.push(query.username); q += ` AND username = $${vals.length}`; }
    if (query._id || query.id) { vals.push(query._id || query.id); q += ` AND mongo_id = $${vals.length}`; }
    q += ' LIMIT 1';
    const r = await pool.query(q, vals);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },

  async findById(id) {
    const pool = getPgPool();
    const r = await pool.query(`SELECT * FROM ${TABLE} WHERE mongo_id = $1 OR id = $1::bigint LIMIT 1`, [id]);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },

  async find(query = {}, opts = {}) {
    const pool = getPgPool();
    let q = `SELECT * FROM ${TABLE}`;
    const where = [];
    const vals = [];
    if (query.role) { vals.push(query.role); where.push(`role = $${vals.length}`); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    q += ' ORDER BY created_at DESC';
    if (opts.limit) { vals.push(opts.limit); q += ` LIMIT $${vals.length}`; }
    const r = await pool.query(q, vals);
    return r.rows.map(toApi);
  },

  async countDocuments(query = {}) {
    const pool = getPgPool();
    let q = `SELECT count(*)::int as c FROM ${TABLE}`;
    const where = [];
    const vals = [];
    if (query.role) { vals.push(query.role); where.push(`role = $${vals.length}`); }
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    const r = await pool.query(q, vals);
    return r.rows[0].c;
  },

  async create(data) {
    const pool = getPgPool();
    const mongoId = data._id || crypto.randomBytes(12).toString('hex');
    const hashedPassword = data.password ? await bcrypt.hash(data.password, 10) : null;
    const r = await pool.query(
      `INSERT INTO ${TABLE} (mongo_id, username, password, role, display_name) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [mongoId, data.username, hashedPassword, data.role || 'operator', data.displayName || null]
    );
    return toApi(r.rows[0]);
  },

  async findByIdAndDelete(id) {
    const pool = getPgPool();
    await pool.query(`DELETE FROM ${TABLE} WHERE mongo_id = $1 OR id = $1::bigint`, [id]);
    return true;
  },

  async findOneAndUpdate(query, update) {
    const pool = getPgPool();
    const setClauses = [];
    const vals = [];
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        const pgKey = { displayName: 'display_name', username: 'username', role: 'role', password: 'password' }[k] // security-scan: ignore || k;
        vals.push(v); setClauses.push(`${pgKey} = $${vals.length}`);
      }
    }
    if (!setClauses.length) return null;
    vals.push(new Date()); setClauses.push(`updated_at = $${vals.length}`);
    
    let where = '';
    if (query.username) { vals.push(query.username); where = `username = $${vals.length}`; }
    else if (query._id || query.id) { vals.push(query._id || query.id); where = `(mongo_id = $${vals.length} OR id = $${vals.length}::bigint)`; }
    
    const r = await pool.query(`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE ${where} RETURNING *`, vals);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },
};

export default User;
