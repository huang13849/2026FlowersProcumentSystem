const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { Pool } = require('pg');
const { resolveServiceBase } = require('./nacosResolver');

const PORT = process.env.PORT || 3013;

const pool = new Pool({
  host: process.env.PG_HOST || '100.67.126.90',
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD,
  database: process.env.NEW_ECOMMERCE_PG_DATABASE || 'new_ecommerce',
  max: 10,
  idleTimeoutMillis: 30000,
});
pool.on('error', e => console.error('[sbs] pool error:', e.message));

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '4mb' }));

// ── Health ──
app.get('/api/health', (_, res) => res.json({ ok: true, service: 'seller-binding' }));

// ── Shops ──
app.get('/api/seller/shops', async (req, res) => {
  try {
    const { source, status, search } = req.query;
    const where = []; const params = []; let idx = 1;
    if (source) { where.push(`source_project=$${idx++}`); params.push(source); }
    if (status) { where.push(`status=$${idx++}`); params.push(status); }
    if (search) { where.push(`(name ILIKE $${idx} OR contact_phone ILIKE $${idx})`); params.push(`%${search}%`); idx++; }
    const wh = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await pool.query(`SELECT * FROM seller_shops ${wh} ORDER BY created_at DESC`);
    res.json({ items: r.rows, total: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/seller/shops/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT * FROM seller_shops WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/seller/shops', async (req, res) => {
  try {
    const b = req.body;
    if (!b.shop_key || !b.name || !b.source_project) return res.status(400).json({ error: 'shop_key, name, source_project required' });
    const r = await pool.query(
      `INSERT INTO seller_shops (shop_key, name, source_project, source_label, peony_org_id, mongo_supplier_id, zitadel_org_id, contact_name, contact_phone, address, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [b.shop_key, b.name, b.source_project, b.source_label || null, b.peony_org_id || null, b.mongo_supplier_id || null, b.zitadel_org_id || null, b.contact_name || null, b.contact_phone || null, b.address || null, b.status || 'active', b.metadata || {}]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'shop_key already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.patch('/api/seller/shops/:id', async (req, res) => {
  try {
    const allowed = ['name','status','contact_name','contact_phone','address','metadata','source_label','zitadel_org_id','mongo_supplier_id'];
    const sets = []; const params = []; let idx = 1;
    for (const k of allowed) {
      if (req.body[k] !== undefined) { sets.push(`${k}=$${idx++}`); params.push(req.body[k]); }
    }
    if (!sets.length) return res.status(400).json({ error: 'no_fields' });
    sets.push('updated_at=NOW()');
    params.push(req.params.id);
    const r = await pool.query(`UPDATE seller_shops SET ${sets.join(',')} WHERE id=$${idx} RETURNING *`, params);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── User Bindings ──
app.get('/api/seller/bindings', async (req, res) => {
  try {
    const { phone, shop_id, zitadel_user_id, role } = req.query;
    const where = []; const params = []; let idx = 1;
    if (phone) { where.push(`b.phone=$${idx++}`); params.push(phone); }
    if (shop_id) { where.push(`b.shop_id=$${idx++}`); params.push(shop_id); }
    if (zitadel_user_id) { where.push(`b.zitadel_user_id=$${idx++}`); params.push(zitadel_user_id); }
    if (role) { where.push(`b.role=$${idx++}`); params.push(role); }
    const wh = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await pool.query(
      `SELECT b.*, s.name AS shop_name, s.source_project, s.source_label
       FROM seller_user_bindings b LEFT JOIN seller_shops s ON s.id = b.shop_id
       ${wh} ORDER BY b.created_at DESC`
    );
    res.json({ items: r.rows, total: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/seller/bindings', async (req, res) => {
  try {
    const b = req.body;
    if (!b.shop_id || !b.phone) return res.status(400).json({ error: 'shop_id, phone required' });
    const r = await pool.query(
      `INSERT INTO seller_user_bindings (shop_id, phone, zitadel_user_id, role, source_project, status, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.shop_id, b.phone, b.zitadel_user_id || null, b.role || 'staff', b.source_project || null, b.status || 'active', b.metadata || {}]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'binding already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/seller/bindings/:id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM seller_user_bindings WHERE id=$1 RETURNING id', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Product Links ──
app.get('/api/seller/products', async (req, res) => {
  try {
    const { shop_id, phone, source, days } = req.query;
    const where = []; const params = []; let idx = 1;
    if (shop_id) { where.push(`p.shop_id=$${idx++}`); params.push(shop_id); }
    if (phone) { where.push(`p.created_by_phone=$${idx++}`); params.push(phone); }
    if (source) { where.push(`p.source_project=$${idx++}`); params.push(source); }
    if (days) {
      const since = new Date(Date.now() - parseInt(days) * 86400000).toISOString();
      where.push(`p.created_at >= $${idx++}`); params.push(since);
    }
    const wh = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const r = await pool.query(
      `SELECT p.*, s.name AS shop_name, s.source_project AS shop_source, s.source_label AS shop_label
       FROM seller_product_links p LEFT JOIN seller_shops s ON s.id = p.shop_id
       ${wh} ORDER BY p.created_at DESC LIMIT 200`
    );
    res.json({ items: r.rows, total: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/seller/products', async (req, res) => {
  try {
    const b = req.body;
    if (!b.shop_id || !b.product_id || !b.source_project) return res.status(400).json({ error: 'shop_id, product_id, source_project required' });
    const r = await pool.query(
      `INSERT INTO seller_product_links (shop_id, product_id, source_project, source_label, created_by_phone, listed_at, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [b.shop_id, b.product_id, b.source_project, b.source_label || null, b.created_by_phone || null, b.listed_at || new Date().toISOString(), b.metadata || {}]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'product already linked' });
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/seller/products/:product_id', async (req, res) => {
  try {
    const r = await pool.query('DELETE FROM seller_product_links WHERE product_id=$1 RETURNING id', [req.params.product_id]);
    if (!r.rowCount) return res.status(404).json({ error: 'not_found' });
    res.json({ deleted: r.rows[0].id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── My Products (for peony/club) ──
// GET /api/seller/products/mine?phone=xxx&days=7
app.get('/api/seller/products/mine', async (req, res) => {
  try {
    const { phone, days } = req.query;
    if (!phone) return res.status(400).json({ error: 'phone required' });
    const bindings = await pool.query(
      `SELECT b.shop_id, s.name AS shop_name, s.source_project, s.source_label
       FROM seller_user_bindings b JOIN seller_shops s ON s.id = b.shop_id
       WHERE b.phone=$1 AND b.status='active'`, [phone]
    );
    if (!bindings.rowCount) return res.json({ items: [], shops: [], total: 0, note: 'no_binding' });
    const shopIds = bindings.rows.map(r => r.shop_id);
    const daysClause = days ? `AND p.created_at >= NOW() - INTERVAL '${Math.max(1, parseInt(days))} days'` : '';
    const r = await pool.query(
      `SELECT p.*, s.name AS shop_name, s.source_project AS shop_source, s.source_label AS shop_label
       FROM seller_product_links p JOIN seller_shops s ON s.id = p.shop_id
       WHERE p.shop_id = ANY($1::bigint[]) ${daysClause}
       ORDER BY p.created_at DESC LIMIT 200`,
      [shopIds]
    );
    res.json({ items: r.rows, shops: bindings.rows, total: r.rowCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Seed: import peony approved registrations ──
app.post('/api/seller/seed/peony', async (req, res) => {
  const client = await pool.connect();
  try {
    const regs = await client.query(
      `SELECT r.id AS reg_id, r.phone, r.identity, r.positions, r.org_id,
              o.id AS org_pg_id, o.entity_name, o.zitadel_org_id
       FROM peony_registrations r JOIN peony_organizations o ON o.id = r.org_id
       WHERE r.status = 'approved'`
    );
    if (!regs.rowCount) return res.json({ note: 'no_approved_registrations', created_shops: 0, bindings: 0 });
    const orgMap = {};
    for (const row of regs.rows) {
      if (!orgMap[row.org_pg_id]) orgMap[row.org_pg_id] = { org: row, users: [] };
      orgMap[row.org_pg_id].users.push(row);
    }
    let created_shops = 0, created_bindings = 0;
    for (const [orgId, group] of Object.entries(orgMap)) {
      const org = group.org;
      const shopKey = `peony:${orgId}`;
      const existing = await client.query('SELECT id FROM seller_shops WHERE shop_key=$1', [shopKey]);
      let shopId;
      if (existing.rowCount) {
        shopId = existing.rows[0].id;
      } else {
        const ins = await client.query(
          `INSERT INTO seller_shops (shop_key, name, source_project, source_label, peony_org_id, zitadel_org_id, contact_name, status, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active',$8) RETURNING id`,
          [shopKey, org.entity_name, 'peony', '芍药联盟', org.org_pg_id, org.zitadel_org_id, org.phone || '', JSON.stringify({ seeded_at: new Date().toISOString() })]
        );
        shopId = ins.rows[0].id;
        created_shops++;
      }
      for (const u of group.users) {
        await client.query(
          `INSERT INTO seller_user_bindings (shop_id, phone, role, source_project, status, metadata)
           VALUES ($1,$2,$3,'peony','active',$4) ON CONFLICT (shop_id, phone) DO NOTHING`,
          [shopId, u.phone, u.identity === 'admin' ? 'owner' : 'staff', JSON.stringify({ reg_id: u.reg_id, positions: u.positions })]
        );
        created_bindings++;
      }
    }
    res.json({ ok: true, created_shops, created_bindings, total_orgs: Object.keys(orgMap).length });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ── Backfill: link existing products by phone ──
app.post('/api/seller/backfill/products', async (req, res) => {
  const { phone } = req.query;
  const PRODUCT_SVC = await resolveServiceBase({ serviceName: process.env.PRODUCT_SERVICE_NAME || 'k8s.supply-chain.product-api-service', fallbackUrl: process.env.PRODUCT_SVC_URL || 'http://product-api-service.supply-chain.svc.cluster.local:3000' });
  try {
    let bindings;
    if (phone) {
      bindings = await pool.query(
        `SELECT b.shop_id, b.phone, s.name AS shop_name, s.source_project
         FROM seller_user_bindings b JOIN seller_shops s ON s.id = b.shop_id
         WHERE b.phone=$1 AND b.status='active'`, [phone]
      );
    } else {
      bindings = await pool.query(
        `SELECT b.shop_id, b.phone, s.name AS shop_name, s.source_project
         FROM seller_user_bindings b JOIN seller_shops s ON s.id = b.shop_id
         WHERE b.status='active'`
      );
    }
    if (!bindings.rowCount) return res.json({ items: [], total: 0, note: 'no_bindings' });
    let linked = 0, skipped = 0;
    for (const b of bindings.rows) {
      const url = `${PRODUCT_SVC}/api/products?createdBy=${encodeURIComponent(b.phone)}&limit=200`;
      const resp = await fetch(url);
      if (!resp.ok) { skipped++; continue; }
      const data = await resp.json();
      const products = data.products || [];
      for (const p of products) {
        try {
          await pool.query(
            `INSERT INTO seller_product_links (shop_id, product_id, source_project, source_label, created_by_phone, listed_at)
             VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (product_id) DO NOTHING`,
            [b.shop_id, p._id, b.source_project, '芍药联盟', b.phone, p.createdAt || new Date().toISOString()]
          );
          linked++;
        } catch { skipped++; }
      }
    }
    res.json({ ok: true, linked, skipped, bindings: bindings.rowCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(parseInt(PORT, 10), '0.0.0.0', () => console.log(`[seller-binding] listening on :${PORT}`));