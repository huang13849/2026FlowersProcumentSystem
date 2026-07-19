// models/Contract.js - PG via API Gateway (no pg dependency needed)
import axios from 'axios';
import crypto from 'crypto';

const GATEWAY = process.env.GATEWAY_URL || 'http://api-gateway.supply-chain.svc.cluster.local:3007';
const API_KEY = process.env.API_KEY || (function(){throw new Error('API_KEY env required')}());
const PG_BASE = `${GATEWAY}/api/pg`;
const TABLE = 'contracts';

const client = axios.create({ timeout: 15000, headers: { 'X-API-Key': API_KEY } });

function toApi(row) {
  if (!row) return null;
  return {
    _id: row.mongo_id || String(row.id),
    id: row.mongo_id || String(row.id),
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    supplierTaxId: row.supplier_tax_id || '',
    contractType: row.contract_type || 'supply',
    status: row.status || 'draft',
    templateContent: row.template_content || '',
    pdfUrl: row.pdf_url || '',
    signedAt: row.signed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    async save() {
      // Use raw PG via gateway
      try {
        await client.post(`${PG_BASE}/query`, {
          query: `UPDATE ${TABLE} SET supplier_name=$1, supplier_tax_id=$2, status=$3, template_content=$4, pdf_url=$5, updated_at=NOW() WHERE id=$6`,
          params: [this.supplierName, this.supplierTaxId, this.status, this.templateContent, this.pdfUrl, row.id]
        });
      } catch(e) { console.error('Contract.save error:', e.message); }
      return this;
    },
    toObject() { return this; }
  };
}

const Contract = {
  async find(query = {}) {
    const where = [];
    const vals = [];
    if (query.supplierId) { vals.push(query.supplierId); where.push(`supplier_id = $${vals.length}`); }
    if (query.status) { vals.push(query.status); where.push(`status = $${vals.length}`); }
    if (query.contractType) { vals.push(query.contractType); where.push(`contract_type = $${vals.length}`); }
    let sql = `SELECT * FROM ${TABLE}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    sql += ' ORDER BY created_at DESC';
    try {
      const r = await client.post(`${PG_BASE}/query`, { query: sql, params: vals });
      return r.data.rows.map(toApi);
    } catch(e) {
      console.error('Contract.find error:', e.message);
      return [];
    }
  },

  async findById(id) {
    try {
      const r = await client.post(`${PG_BASE}/query`, {
        query: `SELECT * FROM ${TABLE} WHERE mongo_id = $1 OR id = $1::bigint LIMIT 1`,
        params: [id]
      });
      return r.data.rows[0] ? toApi(r.data.rows[0]) : null;
    } catch(e) { return null; }
  },

  async findByIdAndDelete(id) {
    try {
      const r = await client.post(`${PG_BASE}/query`, {
        query: `DELETE FROM ${TABLE} WHERE mongo_id = $1 OR id = $1::bigint RETURNING *`,
        params: [id]
      });
      return r.data.rows[0] ? toApi(r.data.rows[0]) : null;
    } catch(e) { return null; }
  },

  async countDocuments(query = {}) {
    const where = [];
    const vals = [];
    if (query.contractType) { vals.push(query.contractType); where.push(`contract_type = $${vals.length}`); }
    let sql = `SELECT count(*)::int as c FROM ${TABLE}`;
    if (where.length) sql += ' WHERE ' + where.join(' AND ');
    try {
      const r = await client.post(`${PG_BASE}/query`, { query: sql, params: vals });
      return r.data.rows[0].c;
    } catch(e) { return 0; }
  },

  async create(data) {
    const mongoId = data._id || crypto.randomBytes(12).toString('hex');
    try {
      const r = await client.post(`${PG_BASE}/query`, {
        query: `INSERT INTO ${TABLE} (mongo_id, supplier_id, supplier_name, supplier_tax_id, contract_type, status, template_content, pdf_url, signed_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        params: [mongoId, data.supplierId, data.supplierName, data.supplierTaxId || '', data.contractType || 'supply', data.status || 'draft', data.templateContent || '', data.pdfUrl || '', data.signedAt || null]
      });
      return toApi(r.data.rows[0]);
    } catch(e) {
      console.error('Contract.create error:', e.message);
      throw e;
    }
  },
};

// Chainable .find().sort()
const origFind = Contract.find;
Contract.find = function(query = {}) {
  const promise = origFind(query);
  return {
    sort() { return this; },
    then(resolve, reject) { promise.then(resolve, reject); }
  };
};

export default Contract;
