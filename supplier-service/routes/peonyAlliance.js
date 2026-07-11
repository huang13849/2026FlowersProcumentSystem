// Peony Alliance registration / invite / approval / badge endpoints
const express = require('express');
const crypto = require('crypto');
const { getPool } = require('../services/peonyPg');
const Supplier = require('../models/Supplier');

const router = express.Router();

// ---------- helpers ----------
function genCode() {
  return crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
}
async function pg() { return getPool(); }

// ---------- CREATE registration ----------
// POST /peony-alliance/registrations
// body: {phone, zitadel_user_id, alliance_type, identity, positions[],
//        org: {entity_name, office_province, office_city, office_district, office_address, business_license_url}?,
//        invite_code?, main_species[]?, capacity_mu?}
router.post('/registrations', async (req, res) => {
  const P = await pg();
  const client = await P.connect();
  try {
    const b = req.body || {};
    const {
      phone, zitadel_user_id, alliance_type, identity, positions = [],
      invite_code, main_species = [], capacity_mu,
      org = null,
    } = b;
    if (!phone || !alliance_type || !identity) {
      return res.status(400).json({ error: 'missing_required', need: ['phone','alliance_type','identity'] });
    }

    await client.query('BEGIN');
    let orgId = null;
    let zitadelOrgId = null;

    if (identity === 'admin') {
      // create organization row (pending)
      if (!org || !org.entity_name) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'admin_needs_entity_name' });
      }
      const orgIns = await client.query(
        `INSERT INTO peony_organizations
          (zitadel_instance_id, entity_name, alliance_type,
           office_province, office_city, office_district, office_address,
           business_license_url, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
         RETURNING id`,
        ['381066489660178661', org.entity_name, alliance_type,
         org.office_province || null, org.office_city || null, org.office_district || null,
         org.office_address || null, org.business_license_url || null]
      );
      orgId = orgIns.rows[0].id;
    } else if (identity === 'staff') {
      if (!invite_code) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'staff_needs_invite_code' });
      }
      const icRes = await client.query(
        `SELECT c.code, c.org_id, c.max_use, c.used_count, c.expires_at, c.active, o.zitadel_org_id
           FROM peony_invite_codes c
           JOIN peony_organizations o ON o.id = c.org_id
          WHERE c.code = $1`, [invite_code.toUpperCase()]
      );
      if (icRes.rowCount === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'invalid_invite_code' });
      }
      const ic = icRes.rows[0];
      if (!ic.active || (ic.expires_at && new Date(ic.expires_at) < new Date()) || ic.used_count >= ic.max_use) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'expired_or_exhausted_code' });
      }
      orgId = ic.org_id;
      zitadelOrgId = ic.zitadel_org_id;
      await client.query('UPDATE peony_invite_codes SET used_count = used_count + 1 WHERE code=$1', [ic.code]);
    }

    // status rule: staff w/ invite -> approved immediately; admin -> pending
    const status = identity === 'staff' ? 'approved' : 'pending';
    const regIns = await client.query(
      `INSERT INTO peony_registrations
        (phone, zitadel_user_id, alliance_type, identity, positions, org_id,
         invite_code, main_species, capacity_mu, status, approved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $10='approved' THEN NOW() ELSE NULL END)
       RETURNING id, created_at`,
      [phone, zitadel_user_id || null, alliance_type, identity, positions, orgId,
       invite_code ? invite_code.toUpperCase() : null, main_species,
       capacity_mu ?? null, status]
    );
    const regId = regIns.rows[0].id;

    // award seedling badge for new user
    await client.query(
      `INSERT INTO peony_badges (registration_id, level, name)
       VALUES ($1, 'seedling', '花开新芽')`, [regId]);

    await client.query('COMMIT');

    // Also write to mongo supplier for admin identity
    let supplierId = null;
    if (identity === 'admin') {
      try {
        const supDoc = await Supplier.create({
          name: org.entity_name,
          shop_name: org.entity_name,
          status: '待整理',
          contact: { name: '', phone },
          company_info: {
            address: [org.office_province, org.office_city, org.office_district, org.office_address].filter(Boolean).join(' '),
          },
          license_files: org.business_license_url ? [{ name: '营业执照', url: org.business_license_url }] : [],
          peony_alliance: {
            alliance_type, identity, positions,
            entity_name: org.entity_name,
            office_province: org.office_province,
            office_city: org.office_city,
            office_district: org.office_district,
            office_address: org.office_address,
            business_license_url: org.business_license_url,
            main_species, capacity_mu,
            zitadel_org_id: null, // filled on approval
            zitadel_instance_id: '381066489660178661',
            registration_id: regId,
            status: 'pending',
            submitted_at: new Date(),
          },
        });
        supplierId = supDoc._id.toString();
      } catch (e) {
        console.error('[peony] supplier create failed:', e.message);
      }
    }

    res.status(201).json({
      registration_id: regId,
      status,
      org_id: orgId,
      zitadel_org_id: zitadelOrgId,
      supplier_id: supplierId,
      badge: { level: 'seedling', name: '花开新芽' },
      created_at: regIns.rows[0].created_at,
    });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[peony/registrations] error:', e);
    res.status(500).json({ error: 'server_error', detail: e.message });
  } finally {
    client.release();
  }
});

// ---------- LIST registrations (admin审核用) ----------
router.get('/registrations', async (req, res) => {
  const P = await pg();
  const status = req.query.status;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE r.status = $1'; }
  const r = await P.query(
    `SELECT r.*, o.entity_name, o.alliance_type AS org_alliance_type
       FROM peony_registrations r
       LEFT JOIN peony_organizations o ON o.id = r.org_id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT 200`, params);
  res.json({ items: r.rows });
});

// ---------- APPROVE registration (admin only, mostly for admin identity) ----------
router.post('/registrations/:id/approve', async (req, res) => {
  const P = await pg();
  const id = Number(req.params.id);
  const { zitadel_org_id, approved_by } = req.body || {};
  const client = await P.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query('SELECT * FROM peony_registrations WHERE id=$1', [id]);
    if (r.rowCount === 0) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'not_found' }); }
    const reg = r.rows[0];
    await client.query(
      `UPDATE peony_registrations SET status='approved', approved_at=NOW(), approved_by=$2 WHERE id=$1`,
      [id, approved_by || 'system']);
    if (reg.org_id && zitadel_org_id) {
      await client.query(
        `UPDATE peony_organizations SET status='approved', approved_at=NOW(), zitadel_org_id=$2 WHERE id=$1`,
        [reg.org_id, zitadel_org_id]);
    }
    await client.query('COMMIT');
    // update supplier
    if (reg.identity === 'admin') {
      await Supplier.updateOne(
        { 'peony_alliance.registration_id': id },
        { $set: {
          'peony_alliance.status': 'approved',
          'peony_alliance.approved_at': new Date(),
          'peony_alliance.zitadel_org_id': zitadel_org_id || null,
        }}
      );
    }
    res.json({ ok: true, id, zitadel_org_id: zitadel_org_id || null });
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    console.error('[peony/approve]', e);
    res.status(500).json({ error: 'server_error', detail: e.message });
  } finally {
    client.release();
  }
});

// ---------- REJECT ----------
router.post('/registrations/:id/reject', async (req, res) => {
  const P = await pg();
  const id = Number(req.params.id);
  const { reason, approved_by } = req.body || {};
  await P.query(
    `UPDATE peony_registrations SET status='rejected', reject_reason=$2, approved_by=$3, approved_at=NOW() WHERE id=$1`,
    [id, reason || '', approved_by || 'system']);
  await Supplier.updateOne(
    { 'peony_alliance.registration_id': id },
    { $set: { 'peony_alliance.status': 'rejected' } });
  res.json({ ok: true });
});

// ---------- GENERATE invite code ----------
router.post('/invite-codes', async (req, res) => {
  const P = await pg();
  const { org_id, created_by, max_use = 20, expires_at = null } = req.body || {};
  if (!org_id || !created_by) return res.status(400).json({ error: 'missing_required' });
  let code, ok = false, attempts = 0;
  while (!ok && attempts++ < 5) {
    code = genCode();
    try {
      await P.query(
        `INSERT INTO peony_invite_codes (code, org_id, created_by, max_use, expires_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [code, org_id, created_by, max_use, expires_at]);
      ok = true;
    } catch (e) {
      if (!/duplicate/.test(e.message)) throw e;
    }
  }
  res.json({ code, org_id, max_use });
});

// ---------- LIST invite codes for an org ----------
router.get('/invite-codes', async (req, res) => {
  const P = await pg();
  const orgId = req.query.org_id;
  if (!orgId) return res.status(400).json({ error: 'need_org_id' });
  const r = await P.query('SELECT * FROM peony_invite_codes WHERE org_id=$1 ORDER BY created_at DESC', [orgId]);
  res.json({ items: r.rows });
});

// ---------- ORG lookup (for staff invite validation UI) ----------
router.get('/organizations', async (req, res) => {
  const P = await pg();
  const r = await P.query(
    `SELECT id, entity_name, alliance_type, status, zitadel_org_id, created_at
     FROM peony_organizations ORDER BY created_at DESC LIMIT 200`);
  res.json({ items: r.rows });
});

// ---------- USER info by phone (for home page after login) ----------
router.get('/me/:phone', async (req, res) => {
  const P = await pg();
  const phone = req.params.phone;
  const rr = await P.query(
    `SELECT r.*, o.entity_name, o.alliance_type AS org_alliance_type,
            o.zitadel_org_id
       FROM peony_registrations r
       LEFT JOIN peony_organizations o ON o.id = r.org_id
      WHERE r.phone = $1
      ORDER BY r.created_at DESC LIMIT 1`, [phone]);
  if (rr.rowCount === 0) return res.status(404).json({ error: 'not_registered' });
  const reg = rr.rows[0];
  const bb = await P.query('SELECT level, name, awarded_at FROM peony_badges WHERE registration_id=$1 ORDER BY awarded_at', [reg.id]);
  res.json({ ...reg, badges: bb.rows });
});

module.exports = router;
