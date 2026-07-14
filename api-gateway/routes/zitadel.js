/**
 * API Gateway - 全部用户聚合（Zitadel 身份 + plant_collector 业务扩展）
 * 只读 Zitadel projections + 读/写 supply_chain.plant_collector.user_profiles
 */
const express = require('express');
const router = express.Router();
const { getZitadelPgPool, getPgPool } = require('../services/connections');

// source_project → 中文来源显示
const SOURCE_LABEL = {
  peony:            '芍药联盟',
  club:             '热植联盟',
  'space-cn':       '植物收藏家-国内',
  'space-en':       '植物收藏家-海外',
  space:            '植物收藏家',
  edu:              '幼植学校',
  wholesale:        '批发',
  'plant-share':    '植物共享自助',
  'self-operated':  '自营录入',
};

// instance/org 名 → 默认来源推断（缺 source_project 时兜底）
function inferSource(instanceName, orgName, orgDomain) {
  const n = (instanceName || '') + ' ' + (orgName || '') + ' ' + (orgDomain || '');
  if (/plant.?share|植物共享/i.test(n)) return 'plant-share';
  if (/peony|芍药/i.test(n)) return 'peony';
  if (/school|youzhi|幼植/i.test(n)) return 'edu';
  if (/space|收藏家/i.test(n)) return 'space';
  return 'club';
}

// GET /api/zitadel/users  —— 跨 instance 全量用户 + plant_collector 富化
router.get('/users', async (req, res) => {
  try {
    const zpool = getZitadelPgPool();
    const sql = `
      SELECT
        u.id, u.instance_id, i.name AS instance_name,
        u.resource_owner AS org_id, o.name AS org_name, o.primary_domain AS org_domain,
        u.username, u.state, u.type,
        u.creation_date, u.change_date,
        h.first_name, h.last_name, h.display_name, h.nick_name,
        h.email, h.is_email_verified,
        h.phone, h.is_phone_verified,
        h.preferred_language, h.gender, h.avatar_key
      FROM projections.users14 u
      LEFT JOIN projections.instances i     ON i.id = u.instance_id
      LEFT JOIN projections.orgs1 o         ON o.id = u.resource_owner AND o.instance_id = u.instance_id
      LEFT JOIN projections.users14_humans h ON h.user_id = u.id       AND h.instance_id = u.instance_id
      ORDER BY i.name, o.name, u.creation_date DESC
    `;
    const r = await zpool.query(sql);
    const STATE = { 1: 'active', 2: 'inactive', 3: 'deleted', 4: 'locked', 5: 'suspend', 6: 'initial' };
    const TYPE  = { 1: 'human', 2: 'machine' };

    // 一次性拉 plant_collector.user_profiles，本地 map，避免 N+1
    let profByZid = new Map();
    try {
      const pgpool = getPgPool();
      const p = await pgpool.query(`
        SELECT p.zid, p.one_id AS oneid, p.gender AS pg_gender, p.user_type,
               p.source_project, p.tags, p.email AS pg_email, p.phone AS pg_phone,
               p.updated_at AS pg_updated_at,
               (SELECT count(*) FROM plant_collector.user_addresses a WHERE a.zid = p.zid) AS address_count
        FROM plant_collector.user_profiles p
      `);
      for (const row of p.rows) profByZid.set(String(row.zid), row);
    } catch (e) {
      console.warn('[zitadel/users] plant_collector enrich skipped:', e.message);
    }

    const data = r.rows.map(u => {
      const prof = profByZid.get(String(u.id)) || null;
      const source_project = (prof && prof.source_project) || inferSource(u.instance_name, u.org_name, u.org_domain);
      return {
        ...u,
        state_label: STATE[u.state] || String(u.state),
        type_label: TYPE[u.type] || String(u.type),
        // plant_collector 富化
        oneid: prof && prof.oneid || null,
        user_type: prof && prof.user_type || null,
        tags: prof && prof.tags || [],
        address_count: prof ? Number(prof.address_count || 0) : 0,
        source_project,
        source_label: SOURCE_LABEL[source_project] || source_project,
        pg_synced: !!prof,
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[zitadel/users]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/zitadel/users/:zid  —— 修改业务扩展字段（写入 plant_collector.user_profiles）
// body: { source_project?, user_type?, tags?, gender? }
router.patch('/users/:zid', async (req, res) => {
  const zid = String(req.params.zid);
  const { source_project, user_type, tags, gender } = req.body || {};
  try {
    const pgpool = getPgPool();
    // upsert（若无 profile 则先创建骨架）
    const now = new Date();
    const existing = await pgpool.query('SELECT id FROM plant_collector.user_profiles WHERE zid=$1', [zid]);
    if (existing.rowCount === 0) {
      const src = source_project || 'club';
      const srcCode = src.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const dayKey = now.toISOString().slice(0, 10).replace(/-/g, '');
      const nextSeq = await pgpool.query("SELECT nextval('plant_collector.user_profiles_id_seq') AS n");
      const oneid = `U-${dayKey}-${srcCode}-${String(nextSeq.rows[0].n).padStart(4, '0')}`;
      await pgpool.query(
        `INSERT INTO plant_collector.user_profiles (zid, one_id, source_project, user_type, tags, gender, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,now(),now())`,
        [zid, oneid, src, user_type || null, tags || [], gender || null]
      );
    } else {
      await pgpool.query(
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
    const r = await pgpool.query(
      'SELECT zid, one_id AS oneid, source_project, user_type, tags, gender, updated_at FROM plant_collector.user_profiles WHERE zid=$1',
      [zid]
    );
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[zitadel/users PATCH]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/zitadel/instances
router.get('/instances', async (req, res) => {
  try {
    const pool = getZitadelPgPool();
    const inst = await pool.query('SELECT id, name, default_org_id, iam_project_id FROM projections.instances ORDER BY name');
    const orgs = await pool.query('SELECT id, instance_id, name, primary_domain, org_state FROM projections.orgs1 ORDER BY instance_id, name');
    res.json({ success: true, instances: inst.rows, orgs: orgs.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/zitadel/stats
router.get('/stats', async (req, res) => {
  try {
    const pool = getZitadelPgPool();
    const r = await pool.query(`
      SELECT i.name AS instance_name,
             COUNT(*) FILTER (WHERE u.type=1) AS humans,
             COUNT(*) FILTER (WHERE u.type=2) AS machines,
             COUNT(*) FILTER (WHERE u.state=1) AS active_users,
             COUNT(*) AS total
      FROM projections.users14 u
      LEFT JOIN projections.instances i ON i.id = u.instance_id
      GROUP BY i.name
      ORDER BY i.name
    `);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
