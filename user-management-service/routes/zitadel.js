/**
 * API Gateway - 全部用户聚合（Zitadel 身份 + plant_collector 业务扩展）
 * - GET  /users                — 跨 instance 全量用户 + plant_collector 富化 + 密码状态
 * - PATCH /users/:zid          — 修改业务扩展字段
 * - DELETE /users/batch        — 批量删除（Zitadel + PG plant_collector.user_profiles）
 * - POST  /users/:zid/password-reset — 触发密码重置（生成 one-time code）
 * - GET  /instances / /stats
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const crypto = require('crypto');
const { getZitadelPgPool, getPgPool } = require('../services/connections');

// ===== 统一来源标签（以 instance_name 为权威）=====
// canonical source → {label, color}
const SOURCE_META = {
  peony:         { label: '芍药联盟',  color: '#c2185b' },  // 粉红
  shopclub:      { label: '植物收藏家', color: '#2e7d32' }, // 绿
  tropical:      { label: '热植联盟',  color: '#00695c' },  // 青绿
  edu:           { label: '幼植学校',  color: '#e65100' },  // 橙
  'plant-share': { label: '植物共享',  color: '#6a1b9a' },  // 紫
  system:        { label: '系统',      color: '#607d8b' },  // 灰
  'self-operated': { label: '自营录入', color: '#455a64' }, // 深灰
};

// instance_name → canonical source（权威映射，覆盖 PG 里可能写脏的 source_project）
const INSTANCE_TO_SOURCE = {
  'Peony Alliance':      'peony',
  'Shop Club':           'shopclub',
  'Hot Plant Alliance':  'tropical',
  'School Alliance':     'edu',
  'Plant Share Beijing': 'plant-share',
  'ZITADEL':             'system',
};

function resolveSource(instanceName, pgSourceProject) {
  // 优先按 instance_name 硬映射；找不到再看 PG source_project 是否是已知 canonical
  const byInst = INSTANCE_TO_SOURCE[instanceName];
  if (byInst) return byInst;
  if (pgSourceProject && SOURCE_META[pgSourceProject]) return pgSourceProject;
  // 部分老数据 pgSourceProject === 'club' → 归为 shopclub
  if (pgSourceProject === 'club' || pgSourceProject === 'shop-club') return 'shopclub';
  if (pgSourceProject === 'space' || pgSourceProject === 'space-cn' || pgSourceProject === 'space-en') return 'shopclub';
  if (pgSourceProject === 'shopclub-register') return 'shopclub';
  if (pgSourceProject === 'school-register') return 'edu';
  if (pgSourceProject === 'peony-register') return 'peony';
  if (pgSourceProject === 'tropical-register') return 'tropical';
  if (pgSourceProject === 'plantshare-register' || pgSourceProject === 'plant-share') return 'plant-share';
  return 'system';
}

// ===== Zitadel Admin API 调用（系统用户 JWT）=====
const KEY_PATH = process.env.ZITADEL_SYSTEM_KEY_PATH || '/system-key/systemuser.key';
const ZITADEL_URL = process.env.ZITADEL_URL || 'http://zitadel.identity.svc.cluster.local:8080';
const ZITADEL_AUD = process.env.ZITADEL_AUD || 'http://id.horiculture.club:443';

function b64url(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sysJwt() {
  const pem = fs.readFileSync(KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: 'systemuser', sub: 'systemuser', aud: ZITADEL_AUD, iat: now, exp: now + 300,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign(pem));
  return `${header}.${payload}.${sig}`;
}

// 通用 Zitadel 请求：需要按用户所属 instance 的 host 转发
async function zitadelReq(method, path, body, forwardHost) {
  const tok = sysJwt();
  const headers = {
    Authorization: `Bearer ${tok}`,
    'Content-Type': 'application/json',
  };
  if (forwardHost) {
    headers['x-forwarded-host'] = forwardHost;
    headers['x-forwarded-proto'] = 'https';
  }
  const r = await fetch(`${ZITADEL_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, text, json };
}

// instance_id → x-forwarded-host（用户所属实例的登录域名）
async function getInstanceHost(instanceId) {
  const zpool = getZitadelPgPool();
  const r = await zpool.query(
    `SELECT domain FROM projections.instance_domains WHERE instance_id=$1 AND is_primary=true LIMIT 1`,
    [instanceId]
  );
  return r.rows[0] && r.rows[0].domain;
}

// GET /api/zitadel/users
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
        h.preferred_language, h.gender, h.avatar_key,
        h.password_changed, h.password_change_required
      FROM projections.users14 u
      LEFT JOIN projections.instances i     ON i.id = u.instance_id
      LEFT JOIN projections.orgs1 o         ON o.id = u.resource_owner AND o.instance_id = u.instance_id
      LEFT JOIN projections.users14_humans h ON h.user_id = u.id       AND h.instance_id = u.instance_id
      ORDER BY i.name, o.name, u.creation_date DESC
    `;
    const r = await zpool.query(sql);
    const STATE = { 1: 'active', 2: 'inactive', 3: 'deleted', 4: 'locked', 5: 'suspend', 6: 'initial' };
    const TYPE  = { 1: 'human', 2: 'machine' };

    // 一次性拉 plant_collector.user_profiles
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

    // last login: MAX(password_checked_at) from Zitadel sessions
    let lastLoginByZid = new Map();
    try {
      const lr = await zpool.query(`
        SELECT user_id, MAX(password_checked_at) AS last_login
        FROM projections.sessions8
        WHERE user_id IS NOT NULL AND password_checked_at IS NOT NULL
        GROUP BY user_id
      `);
      for (const row of lr.rows) lastLoginByZid.set(String(row.user_id), row.last_login);
    } catch (e) {
      console.warn('[zitadel/users] last_login enrich skipped:', e.message);
    }

    // default address text
    let defaultAddrByZid = new Map();
    try {
      const pgpool2 = getPgPool();
      const ar = await pgpool2.query(`
        SELECT DISTINCT ON (zid) zid, name, phone, country, province, city, district, detail, postal_code
        FROM plant_collector.user_addresses
        ORDER BY zid, is_default DESC NULLS LAST, created_at DESC
      `);
      for (const row of ar.rows) {
        const parts = [row.country, row.province, row.city, row.district, row.detail].filter(Boolean);
        const text = parts.join(' ');
        defaultAddrByZid.set(String(row.zid), {
          text,
          consignee: row.name || null,
          consignee_phone: row.phone || null,
          postal_code: row.postal_code || null,
        });
      }
    } catch (e) {
      console.warn('[zitadel/users] default_address enrich skipped:', e.message);
    }

    const data = r.rows.map(u => {
      const prof = profByZid.get(String(u.id)) || null;
      const source = resolveSource(u.instance_name, prof && prof.source_project);
      const meta = SOURCE_META[source] || SOURCE_META.system;
      // 密码状态：password_changed 有值即视为已设置密码
      const hasPassword = !!u.password_changed;
      return {
        ...u,
        state_label: STATE[u.state] || String(u.state),
        type_label: TYPE[u.type] || String(u.type),
        oneid: prof && prof.oneid || null,
        user_type: prof && prof.user_type || null,
        tags: prof && prof.tags || [],
        address_count: prof ? Number(prof.address_count || 0) : 0,
        // 统一来源（前端只看这三个字段）
        source_project: source,
        source_label: meta.label,
        source_color: meta.color,
        pg_synced: !!prof,
        // 密码状态
        has_password: hasPassword,
        password_change_required: !!u.password_change_required,
        // 最后登录时间
        last_login_at: lastLoginByZid.get(String(u.id)) || null,
        // 默认收货地址（完整文本）
        default_address: defaultAddrByZid.get(String(u.id)) || null,
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[zitadel/users]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/zitadel/users/:zid
router.patch('/users/:zid', async (req, res) => {
  const zid = String(req.params.zid);
  const { source_project, user_type, tags, gender } = req.body || {};
  try {
    const pgpool = getPgPool();
    const now = new Date();
    const existing = await pgpool.query('SELECT id FROM plant_collector.user_profiles WHERE zid=$1', [zid]);
    if (existing.rowCount === 0) {
      const src = source_project || 'shopclub';
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

// POST /api/zitadel/users/batch-delete  { zids: [...] }
// 逐个调 Zitadel v2 DELETE /users/{userId} + 清 plant_collector.user_profiles
router.post('/users/batch-delete', async (req, res) => {
  const zids = Array.isArray(req.body && req.body.zids) ? req.body.zids.map(String) : [];
  if (!zids.length) return res.status(400).json({ success: false, error: 'zids required' });

  const zpool = getZitadelPgPool();
  const pgpool = getPgPool();
  // 拿到每个用户的 instance_id 以便正确设置 x-forwarded-host
  const infoR = await zpool.query(
    `SELECT u.id, u.instance_id, u.username, i.name AS instance_name
     FROM projections.users14 u
     LEFT JOIN projections.instances i ON i.id = u.instance_id
     WHERE u.id = ANY($1::text[])`,
    [zids]
  );
  const info = new Map();
  for (const r of infoR.rows) info.set(String(r.id), r);

  const results = [];
  for (const zid of zids) {
    const meta = info.get(zid);
    if (!meta) { results.push({ zid, ok: false, error: 'not_found' }); continue; }
    try {
      const host = await getInstanceHost(meta.instance_id) || undefined;
      const r = await zitadelReq('DELETE', `/v2/users/${encodeURIComponent(zid)}`, null, host);
      if (r.ok || r.status === 404) {
        // 同步清 PG profile
        try { await pgpool.query('DELETE FROM plant_collector.user_profiles WHERE zid=$1', [zid]); } catch {}
        results.push({ zid, ok: true, username: meta.username, instance: meta.instance_name });
      } else {
        results.push({ zid, ok: false, error: `zitadel_${r.status}`, detail: (r.text||'').slice(0,200) });
      }
    } catch (e) {
      results.push({ zid, ok: false, error: e.message });
    }
  }
  const okCount = results.filter(r => r.ok).length;
  res.json({ success: true, deleted: okCount, total: zids.length, results });
});

// POST /api/zitadel/users/:zid/password-reset
// 让用户下次登录必须改密码，并返回一次性 reset code（url 待前端拼接）
router.post('/users/:zid/password-reset', async (req, res) => {
  const zid = String(req.params.zid);
  try {
    const zpool = getZitadelPgPool();
    const r = await zpool.query(
      `SELECT u.id, u.instance_id, u.username, i.name AS instance_name
       FROM projections.users14 u LEFT JOIN projections.instances i ON i.id=u.instance_id
       WHERE u.id=$1`, [zid]
    );
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'user_not_found' });
    const meta = r.rows[0];
    const host = await getInstanceHost(meta.instance_id) || undefined;

    // Zitadel v2: POST /v2/users/{userId}/password_reset (returns verification_code when sendLink=false)
    const resp = await zitadelReq('POST', `/v2/users/${encodeURIComponent(zid)}/password_reset`, {
      returnCode: {},  // 返回一次性 code（不发邮件/短信）
    }, host);
    if (!resp.ok) {
      return res.status(resp.status).json({ success: false, error: `zitadel_${resp.status}`, detail: (resp.text||'').slice(0,300) });
    }
    res.json({ success: true, data: resp.json, username: meta.username, instance: meta.instance_name });
  } catch (err) {
    console.error('[zitadel/users password-reset]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/zitadel/users/:zid/addresses — 查该用户所有地址明细
router.get('/users/:zid/addresses', async (req, res) => {
  const zid = String(req.params.zid);
  try {
    const pgpool = getPgPool();
    const r = await pgpool.query(`
      SELECT id, addr_id, name, phone, province, city, district, detail,
             postal_code, country, is_default, created_at, updated_at
      FROM plant_collector.user_addresses
      WHERE zid=$1
      ORDER BY is_default DESC, created_at DESC
    `, [zid]);
    res.json({ success: true, count: r.rowCount, data: r.rows });
  } catch (err) {
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

// GET /api/zitadel/source-meta — 前端拉颜色映射
router.get('/source-meta', (req, res) => {
  res.json({ success: true, data: SOURCE_META });
});

module.exports = router;
