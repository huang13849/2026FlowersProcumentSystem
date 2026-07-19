// models/Template.js - PG via API Gateway (no pg dependency needed)
import axios from 'axios';
import crypto from 'crypto';

const GATEWAY = process.env.GATEWAY_URL || 'http://api-gateway.supply-chain.svc.cluster.local:3007';
const API_KEY = process.env.API_KEY || (function(){throw new Error('API_KEY env required')}());
const PG_BASE = `${GATEWAY}/api/pg`;
const TABLE = 'contract_templates';

const client = axios.create({ timeout: 15000, headers: { 'X-API-Key': API_KEY } });

function toApi(row) {
  if (!row) return null;
  return {
    _id: row.mongo_id || String(row.id),
    id: row.mongo_id || String(row.id),
    type: row.type,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    toObject() { return this; }
  };
}

const Template = {
  async find() {
    try {
      const r = await client.post(`${PG_BASE}/query`, { query: `SELECT * FROM ${TABLE} ORDER BY type` });
      return r.data.rows.map(toApi);
    } catch(e) { return []; }
  },

  async findOne(query) {
    if (query.type) {
      try {
        const r = await client.post(`${PG_BASE}/query`, { query: `SELECT * FROM ${TABLE} WHERE type = $1 LIMIT 1`, params: [query.type] });
        return r.data.rows[0] ? toApi(r.data.rows[0]) : null;
      } catch(e) { return null; }
    }
    return null;
  },

  async create(data) {
    const mongoId = crypto.randomBytes(12).toString('hex');
    const r = await client.post(`${PG_BASE}/query`, {
      query: `INSERT INTO ${TABLE} (mongo_id, type, name, content) VALUES ($1, $2, $3, $4) RETURNING *`,
      params: [mongoId, data.type, data.name, data.content]
    });
    return toApi(r.data.rows[0]);
  },

  async findOneAndUpdate(query, update, opts = {}) {
    const type = query.type;
    const setClauses = ['updated_at = NOW()'];
    const vals = [];
    if (update.content !== undefined) { vals.push(update.content); setClauses.push(`content = $${vals.length}`); }
    if (update.name !== undefined) { vals.push(update.name); setClauses.push(`name = $${vals.length}`); }
    vals.push(type);
    try {
      const r = await client.post(`${PG_BASE}/query`, {
        query: `UPDATE ${TABLE} SET ${setClauses.join(', ')} WHERE type = $${vals.length} RETURNING *`,
        params: vals
      });
      if (r.data.rows[0]) return toApi(r.data.rows[0]);
      
      if (opts.upsert) {
        const mongoId = crypto.randomBytes(12).toString('hex');
        const r2 = await client.post(`${PG_BASE}/query`, {
          query: `INSERT INTO ${TABLE} (mongo_id, type, name, content) VALUES ($1, $2, $3, $4) RETURNING *`,
          params: [mongoId, type, update.name || type, update.content || '']
        });
        return toApi(r2.data.rows[0]);
      }
    } catch(e) { console.error('Template.findOneAndUpdate error:', e.message); }
    return null;
  },
};

export default Template;
