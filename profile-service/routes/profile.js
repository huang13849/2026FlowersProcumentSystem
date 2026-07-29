/**
 * Profile Service Routes - 业务档案 CRUD
 */
const express = require('express');
const router = express.Router();
const { getPgPool } = require('../services/connections');

// GET /profile/users  返回全量档案索引 (BFF 一次拉走)
router.get('/users', async (_req, res) => {
  try {
    const pg = getPgPool();
    const p = await pg.query(`
      SELECT p.zid, p.one_id AS oneid, p.gender AS pg_gender, p.user_type,
             p.source_project, p.tags, p.email AS pg_email, p.phone AS pg_phone,
             p.updated_at AS pg_updated_at,
             (SELECT count(*) FROM plant_collector.user_addresses a WHERE a.zid = p.zid) AS address_count
      FROM plant_collector.user_profiles p
    `);
    // 默认地址富化
    const ar = await pg.query(`
      SELECT DISTINCT ON (zid) zid, name, phone, country, province, city, district, detail, postal_code
      FROM plant_collector.user_addresses
      ORDER BY zid, is_default DESC NULLS LAST, created_at DESC
    `);
    const addrMap = new Map();
    for (const row of ar.rows) {
      const parts = [row.country, row.province, row.city, row.district, row.detail].filter(Boolean);
      addrMap.set(String(row.zid), {
        text: parts.join(' '),
        consignee: row.name || null,
        consignee_phone: row.phone || null,
        postal_code: row.postal_code || null,
      });
    }
    const data = p.rows.map(r => ({
      zid: r.zid,
      oneid: r.oneid,
      pg_gender: r.pg_gender,
      user_type: r.user_type,
      source_project: r.source_project,
      tags: r.tags || [],
      pg_email: r.pg_email,
      pg_phone: r.pg_phone,
      pg_updated_at: r.pg_updated_at,
      address_count: Number(r.address_count || 0),
      default_address: addrMap.get(String(r.zid)) || null,
    }));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[profile/users]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /profile/users/:zid
router.get('/users/:zid', async (req, res) => {
  const zid = String(req.params.zid);
  try {
    const pg = getPgPool();
    const r = await pg.query(
      `SELECT zid, one_id AS oneid, source_project, user_type, tags, gender, email, phone, created_at, updated_at
       FROM plant_collector.user_profiles WHERE zid=$1`, [zid]
    );
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'not_found' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /profile/users/:zid  (创建或更新档案)
router.patch('/users/:zid', async (req, res) => {
  const zid = String(req.params.zid);
  const { source_project, user_type, tags, gender } = req.body || {};
  try {
    const pg = getPgPool();
    const now = new Date();
    const existing = await pg.query('SELECT id FROM plant_collector.user_profiles WHERE zid=$1', [zid]);
    if (existing.rowCount === 0) {
      const src = source_project || 'shopclub';
      const srcCode = src.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const dayKey = now.toISOString().slice(0, 10).replace(/-/g, '');
      const nextSeq = await pg.query("SELECT nextval('plant_collector.user_profiles_id_seq') AS n");
      const oneid = `U-${dayKey}-${srcCode}-${String(nextSeq.rows[0].n).padStart(4, '0')}`;
      await pg.query(
        `INSERT INTO plant_collector.user_profiles (zid, one_id, source_project, user_type, tags, gender, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [zid, oneid, src, user_type || null, tags || [], gender || null]
      );
    } else {
      await pg.query(
        `UPDATE plant_collector.user_profiles
           SET source_project = COALESCE($2, source_project),
               user_type      = COALESCE($3, user_type),
               tags           = COALESCE($4, tags),
               gender         = COALESCE($5, gender),
               updated_at     = now()
         WHERE zid = $1`,
        [zid, source_project || null, user_type || null, tags || null, gender || null]
      );
    }
    const r = await pg.query(
      'SELECT zid, one_id AS oneid, source_project, user_type, tags, gender, updated_at FROM plant_collector.user_profiles WHERE zid=$1',
      [zid]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[profile PATCH]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /profile/users/:zid
router.delete('/users/:zid', async (req, res) => {
  const zid = String(req.params.zid);
  try {
    const pg = getPgPool();
    await pg.query('DELETE FROM plant_collector.user_profiles WHERE zid=$1', [zid]);
    res.json({ success: true, zid });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /profile/users/:zid/addresses
router.get('/users/:zid/addresses', async (req, res) => {
  const zid = String(req.params.zid);
  try {
    const pg = getPgPool();
    const r = await pg.query(
      `SELECT * FROM plant_collector.user_addresses WHERE zid=$1
       ORDER BY is_default DESC NULLS LAST, created_at DESC`, [zid]
    );
    res.json({ success: true, count: r.rowCount, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /profile/users/:zid/addresses
router.post('/users/:zid/addresses', async (req, res) => {
  const zid = String(req.params.zid);
  const b = req.body || {};
  try {
    const pg = getPgPool();
    const r = await pg.query(
      `INSERT INTO plant_collector.user_addresses
       (zid, name, phone, country, province, city, district, detail, postal_code, is_default, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *`,
      [zid, b.name || null, b.phone || null, b.country || null, b.province || null,
       b.city || null, b.district || null, b.detail || null, b.postal_code || null, !!b.is_default]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /profile/tags
router.get('/tags', async (req, res) => {
  const scope = req.query.scope || null;
  try {
    const pg = getPgPool();
    const sql = scope
      ? `SELECT * FROM plant_collector.tags WHERE $1 = ANY(scope) AND deprecated_at IS NULL ORDER BY usage_count DESC NULLS LAST, name`
      : `SELECT * FROM plant_collector.tags WHERE deprecated_at IS NULL ORDER BY usage_count DESC NULLS LAST, name`;
    const params = scope ? [scope] : [];
    const r = await pg.query(sql, params);
    res.json({ success: true, count: r.rowCount, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /profile/tags  { name, color, bg, border, scope: [...] }
router.post('/tags', async (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ success: false, error: 'name required' });
  const scope = Array.isArray(b.scope) ? b.scope : (b.scope ? [b.scope] : ['product']);
  try {
    const pg = getPgPool();
    const r = await pg.query(
      `INSERT INTO plant_collector.tags (name, color, bg, border, scope, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::text[],now(),now())
       ON CONFLICT (name) DO NOTHING RETURNING *`,
      [b.name, b.color || '#666', b.bg || '#eee', b.border || '#ccc', scope]
    );
    if (!r.rowCount) return res.status(409).json({ success: false, error: 'exists' });
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /profile/tags/:name  (软删)
router.delete('/tags/:name', async (req, res) => {
  const name = String(req.params.name);
  try {
    const pg = getPgPool();
    await pg.query(`UPDATE plant_collector.tags SET deprecated_at=now() WHERE name=$1`, [name]);
    res.json({ success: true, name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;


// PATCH /profile/users/:zid/avatar - Update avatar_url in profile
router.patch('/users/:zid/avatar', async (req, res) => {
  const zid = String(req.params.zid);
  const { avatar_url } = req.body || {};
  try {
    const pg = getPgPool();
    const now = new Date();
    const existing = await pg.query('SELECT id FROM plant_collector.user_profiles WHERE zid=$1', [zid]);
    if (existing.rowCount === 0) {
      return res.status(404).json({ success: false, error: 'user_profile_not_found' });
    }
    await pg.query(
      'UPDATE plant_collector.user_profiles SET avatar_url = COALESCE($2, avatar_url), updated_at = now() WHERE zid = $1',
      [zid, avatar_url || null]
    );
    const r = await pg.query(
      'SELECT zid, avatar_url FROM plant_collector.user_profiles WHERE zid=$1', [zid]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[profile PATCH avatar]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /profile/users/:zid/avatar/get-upload-url - Get presigned upload URL for MinIO
router.post('/users/:zid/avatar/get-upload-url', async (req, res) => {
  const zid = String(req.params.zid);
  try {
    const minio = getMinioClient();
    const bucket = getMinioBucket();
    const objectName = 'avatars/' + zid + '-' + Date.now() + '.png';
    const presignedUrl = await minio.presignedPutObject(bucket, objectName, 60 * 5); // 5 minutes expiry
    const publicUrl = getMinioPublicUrl() + '/' + bucket + '/' + objectName;
    res.json({
      success: true,
      data: {
        upload_url: presignedUrl,
        public_url: publicUrl,
        object_name: objectName
      }
    });
  } catch (err) {
    console.error('[profile avatar get-upload-url]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});
