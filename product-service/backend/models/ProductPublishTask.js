// models/ProductPublishTask.js - PG-backed with mongoose-compatible surface
import crypto from 'crypto';
import { getPgPool } from '../config/db.js';

const TABLE = 'public.product_publish_tasks';

async function ensureTable() {
  const pool = getPgPool();
  await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    id BIGSERIAL PRIMARY KEY,
    mongo_id TEXT UNIQUE,
    task_id TEXT UNIQUE NOT NULL,
    product_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_product_id TEXT,
    operator TEXT DEFAULT 'admin',
    status TEXT DEFAULT 'pending',
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    publish_time TIMESTAMPTZ,
    offline_time TIMESTAMPTZ,
    restore_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`);
}

function toApi(row) {
  if (!row) return null;
  return {
    _id: row.mongo_id || String(row.id),
    id: row.mongo_id || String(row.id),
    taskId: row.task_id,
    productId: row.product_id,
    platform: row.platform,
    platformProductId: row.platform_product_id,
    operator: row.operator,
    status: row.status,
    errorMessage: row.error_message,
    retryCount: row.retry_count || 0,
    publishTime: row.publish_time,
    offlineTime: row.offline_time,
    restoreTime: row.restore_time,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    toObject() { return this; }
  };
}

const ProductPublishTask = {
  async create(data) {
    await ensureTable();
    const pool = getPgPool();
    const mongoId = data._id || crypto.randomBytes(12).toString('hex');
    const r = await pool.query(
      `INSERT INTO ${TABLE} (mongo_id, task_id, product_id, platform, platform_product_id, operator, status, error_message, retry_count, publish_time, offline_time, restore_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [mongoId, data.taskId, data.productId, data.platform, data.platformProductId || '', data.operator || 'admin', data.status || 'pending', data.errorMessage || null, data.retryCount || 0, data.publishTime || null, data.offlineTime || null, data.restoreTime || null]
    );
    return toApi(r.rows[0]);
  },

  async countDocuments(query = {}) {
    await ensureTable();
    const pool = getPgPool();
    const where = [];
    const vals = [];
    if (query.status) { vals.push(query.status); where.push(`status = $${vals.length}`); }
    if (query.platform) { vals.push(query.platform); where.push(`platform = $${vals.length}`); }
    if (query.productId) { vals.push(query.productId); where.push(`product_id = $${vals.length}`); }
    let q = `SELECT count(*)::int as c FROM ${TABLE}`;
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    const r = await pool.query(q, vals);
    return r.rows[0].c;
  },

  find(query = {}) {
    const where = [];
    const vals = [];
    if (query.status) { vals.push(query.status); where.push(`status = $${vals.length}`); }
    if (query.platform) { vals.push(query.platform); where.push(`platform = $${vals.length}`); }
    if (query.productId) { vals.push(query.productId); where.push(`product_id = $${vals.length}`); }
    let order = 'created_at DESC';
    let skipVal = 0;
    let limitVal = 0;

    return {
      sort(s) {
        if (s && typeof s === 'object') {
          if (s.createdAt === -1) order = 'created_at DESC';
          else if (s.createdAt === 1) order = 'created_at ASC';
        }
        return this;
      },
      skip(n) { skipVal = n; return this; },
      limit(n) { limitVal = n; return this; },
      async then(resolve, reject) {
        await ensureTable();
        const pool = getPgPool();
        let q = `SELECT * FROM ${TABLE}`;
        if (where.length) q += ' WHERE ' + where.join(' AND ');
        q += ` ORDER BY ${order}`;
        if (skipVal) { vals.push(skipVal); q += ` OFFSET $${vals.length}`; }
        if (limitVal) { vals.push(limitVal); q += ` LIMIT $${vals.length}`; }
        try {
          const r = await pool.query(q, vals);
          resolve(r.rows.map(toApi));
        } catch (e) { reject(e); }
      }
    };
  },

  async findOne(query) {
    await ensureTable();
    const pool = getPgPool();
    if (query.taskId) {
      const r = await pool.query(`SELECT * FROM ${TABLE} WHERE task_id = $1 LIMIT 1`, [query.taskId]);
      return r.rows[0] ? toApi(r.rows[0]) : null;
    }
    const where = [];
    const vals = [];
    if (query.status) { vals.push(query.status); where.push(`status = $${vals.length}`); }
    if (query.productId) { vals.push(query.productId); where.push(`product_id = $${vals.length}`); }
    let q = `SELECT * FROM ${TABLE}`;
    if (where.length) q += ' WHERE ' + where.join(' AND ');
    q += ' ORDER BY created_at DESC LIMIT 1';
    const r = await pool.query(q, vals);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },

  async findOneAndUpdate(query, update, opts = {}) {
    await ensureTable();
    const pool = getPgPool();
    const setClauses = ['updated_at = NOW()'];
    const vals = [];
    if (update.$set) {
      for (const [k, v] of Object.entries(update.$set)) {
        const pgKey = {
          status: 'status', platformProductId: 'platform_product_id', errorMessage: 'error_message',
          retryCount: 'retry_count', publishTime: 'publish_time', offlineTime: 'offline_time', restoreTime: 'restore_time'
        }[k] || k;
        if (pgKey === 'updated_at') continue;
        vals.push(v); setClauses.push(`${pgKey} = $${vals.length}`);
      }
    }
    let where = '';
    if (query.taskId) { vals.push(query.taskId); where = `task_id = $${vals.length}`; }
    
    const r = await pool.query(`UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE ${where} RETURNING *`, vals);
    return r.rows[0] ? toApi(r.rows[0]) : null;
  },
};

export default ProductPublishTask;
