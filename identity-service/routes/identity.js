/**
 * Identity Service Routes - Zitadel 身份聚合
 * 从 user-management-service/routes/zitadel.js 迁入, 剥离所有业务档案富化 (那部分归 profile-service)
 */
const express = require('express');
const router = express.Router();
const fs = require('fs');
const crypto = require('crypto');
const { getZitadelPgPool } = require('../services/connections');

// ===== 统一来源标签 (权威映射, 保留在 identity 层因为 instance_name 是身份归属) =====
const SOURCE_META = {
  peony:           { label: '芍药联盟',  color: '#c2185b' },
  shopclub:        { label: '植物收藏家', color: '#2e7d32' },
  tropical:        { label: '热植联盟',  color: '#00695c' },
  edu:             { label: '金匠人学校',  color: '#e65100' },
  'plant-share':   { label: '植物共享',  color: '#6a1b9a' },
  system:          { label: '系统',      color: '#607d8b' },
  'self-operated': { label: '自营录入',  color: '#455a64' },
};

const INSTANCE_TO_SOURCE = {
  'Peony Alliance':      'peony',
  'Shop Club':           'shopclub',
  'Hot Plant Alliance':  'tropical',
  'School Alliance':     'edu',
  'Plant Share Beijing': 'plant-share',
  'ZITADEL':             'system',
};

function resolveSource(instanceName) {
  return INSTANCE_TO_SOURCE[instanceName] || 'system';
}

// ===== Zitadel Admin API 客户端 =====
const KEY_PATH = process.env.ZITADEL_SYSTEM_KEY_PATH || '/system-key/systemuser.key';
const ZITADEL_URL = process.env.ZITADEL_URL || 'http://zitadel.identity.svc.cluster.local:8080';
// This value must match the SystemAPIUsers key configured in ZITADEL, and is
// therefore also the issuer, subject and audience of the signed system JWT.
// It is deliberately not the public login domain.
const ZITADEL_SYSTEM_USER_ID = process.env.ZITADEL_SYSTEM_USER_ID || 'http://100.96.54.109:31111';

function b64url(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function sysJwt() {
  const pem = fs.readFileSync(KEY_PATH, 'utf8');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: ZITADEL_SYSTEM_USER_ID,
    sub: ZITADEL_SYSTEM_USER_ID,
    aud: ZITADEL_SYSTEM_USER_ID,
    iat: now,
    exp: now + 300,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const sig = b64url(signer.sign(pem));
  return `${header}.${payload}.${sig}`;
}

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
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: r.status, ok: r.ok, text, json };
}

async function getInstanceHost(instanceId) {
  const zpool = getZitadelPgPool();
  const r = await zpool.query(
    `SELECT domain FROM projections.instance_domains WHERE instance_id=$1 AND is_primary=true LIMIT 1`,
    [instanceId]
  );
  return r.rows[0] && r.rows[0].domain;
}

// The UI name "General Plants Alliance" is shared by the merged historical
// instances.  The sole stable enrollment anchor is the existing alliance
// administrator, not the (now ambiguous) display name.
const GENERAL_PLANTS_ADMIN_USERNAME = 'plant-alliance-admin';

async function getGeneralPlantsTarget() {
  const zpool = getZitadelPgPool();
  const r = await zpool.query(
    `SELECT u.instance_id, u.resource_owner AS org_id, i.name AS instance_name,
            o.name AS org_name
       FROM projections.users14 u
       JOIN projections.instances i ON i.id = u.instance_id
       JOIN projections.orgs1 o ON o.id = u.resource_owner AND o.instance_id = u.instance_id
      WHERE u.username = $1 AND u.state = 1
      ORDER BY u.change_date DESC
      LIMIT 1`,
    [GENERAL_PLANTS_ADMIN_USERNAME]
  );
  return r.rows[0] || null;
}

function validMobile(value) {
  return /^1\d{10}$/.test(String(value || '').trim());
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

// POST /identity/registrations/general-plants
// Internal-only ingress used by the plants-alliance BFF.  The ZITADEL system
// key never leaves this service and the user password is neither stored nor
// logged here.
router.post('/registrations/general-plants', async (req, res) => {
  const requiredKey = process.env.PLANT_ALLIANCE_REGISTRATION_KEY || '';
  if (!requiredKey || req.headers['x-plant-alliance-registration-key'] !== requiredKey) {
    return res.status(403).json({ success: false, error: 'registration_not_authorized' });
  }

  const body = req.body || {};
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');
  const nickname = String(body.nickname || '植物会员').trim().slice(0, 60) || '植物会员';
  if (!validMobile(phone)) return res.status(400).json({ success: false, error: 'phone_invalid' });
  if (!validEmail(email)) return res.status(400).json({ success: false, error: 'email_invalid' });
  if (password.length < 8) return res.status(400).json({ success: false, error: 'password_too_short' });

  try {
    const target = await getGeneralPlantsTarget();
    if (!target) return res.status(503).json({ success: false, error: 'general_plants_target_unavailable' });

    const zpool = getZitadelPgPool();
    const exists = await zpool.query(
      `SELECT u.id
         FROM projections.users14 u
         LEFT JOIN projections.users14_humans h ON h.user_id = u.id AND h.instance_id = u.instance_id
        WHERE u.instance_id = $1 AND u.state <> 3
          AND (u.username = $2 OR h.phone = $2 OR lower(h.email) = lower($3))
        LIMIT 1`,
      [target.instance_id, phone, email]
    );
    if (exists.rowCount) return res.status(409).json({ success: false, error: 'phone_or_email_already_registered' });

    const host = await getInstanceHost(target.instance_id) || undefined;
    const created = await zitadelReq('POST', '/v2/users/human', {
      username: phone,
      organization: { orgId: target.org_id },
      profile: { firstName: nickname, lastName: '植物联盟', displayName: nickname },
      email: { email, isEmailVerified: false },
      phone: { phone, isPhoneVerified: false },
      password: { password, passwordChangeRequired: false },
    }, host);
    if (!created.ok) {
      console.error('[general-plants-registration] ZITADEL rejected:', created.status, (created.text || '').slice(0, 300));
      return res.status(created.status || 502).json({ success: false, error: 'zitadel_registration_failed' });
    }
    const zid = String((created.json || {}).userId || (created.json || {}).id || '');
    if (!zid) return res.status(502).json({ success: false, error: 'zitadel_registration_missing_user' });
    return res.status(201).json({
      success: true,
      user: { zid, phone, email, nickname },
      instance: { id: target.instance_id, name: 'General Plants Alliance', org_id: target.org_id },
    });
  } catch (err) {
    console.error('[general-plants-registration]', err.message);
    return res.status(500).json({ success: false, error: 'registration_internal_error' });
  }
});

// One idempotent provisioning endpoint for the plants-alliance BFF client.
// It creates no user and returns only the public client id.
router.post('/oidc/general-plants-web/ensure', async (req, res) => {
  const requiredKey = process.env.PLANT_ALLIANCE_REGISTRATION_KEY || '';
  if (!requiredKey || req.headers['x-plant-alliance-registration-key'] !== requiredKey) {
    return res.status(403).json({ success: false, error: 'registration_not_authorized' });
  }
  try {
    const target = await getGeneralPlantsTarget();
    if (!target) return res.status(503).json({ success: false, error: 'general_plants_target_unavailable' });
    const zpool = getZitadelPgPool();
    const project = await zpool.query(
      `SELECT id FROM projections.projects4
        WHERE instance_id=$1 AND resource_owner=$2
        ORDER BY change_date DESC LIMIT 1`,
      [target.instance_id, target.org_id]
    );
    const projectId = project.rows[0] && project.rows[0].id;
    if (!projectId) return res.status(503).json({ success: false, error: 'general_plants_project_unavailable' });
    const host = await getInstanceHost(target.instance_id) || undefined;
    const existing = await zitadelReq('POST', `/management/v1/projects/${encodeURIComponent(projectId)}/apps/_search`, {}, host);
    const apps = ((existing.json || {}).result || []);
    const app = apps.find(x => x.name === 'plants-alliance-web');
    if (app && app.oidcConfig && app.oidcConfig.clientId) {
      // Older provisioning runs created the client before the callback was
      // finalized. Reconcile it every time so login cannot fail with a stale
      // redirect URI.
      const appId = app.id || app.appId;
      if (!appId) return res.status(502).json({ success: false, error: 'oidc_client_id_missing' });
      const updated = await zitadelReq('PUT', `/management/v1/projects/${encodeURIComponent(projectId)}/apps/${encodeURIComponent(appId)}/oidc_config`, {
        redirectUris: ['https://horiculture.club/plants-alliance/auth-callback.html'],
        responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
        grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
        appType: 'OIDC_APP_TYPE_USER_AGENT',
        authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
        postLogoutRedirectUris: ['https://horiculture.club/plants-alliance/'],
        devMode: false,
        accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
      }, host);
      if (!updated.ok) {
        console.error('[general-plants-oidc-update]', updated.status, (updated.text || '').slice(0, 300));
        return res.status(updated.status || 502).json({ success: false, error: 'oidc_client_update_failed' });
      }
      return res.json({ success: true, created: false, client_id: app.oidcConfig.clientId, project_id: projectId });
    }
    const created = await zitadelReq('POST', `/management/v1/projects/${encodeURIComponent(projectId)}/apps/oidc`, {
      name: 'plants-alliance-web',
      redirectUris: ['https://horiculture.club/plants-alliance/auth-callback.html'],
      responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
      grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
      appType: 'OIDC_APP_TYPE_USER_AGENT',
      authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
      postLogoutRedirectUris: ['https://horiculture.club/plants-alliance/'],
      version: 'OIDC_VERSION_1_0',
      devMode: false,
      accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
    }, host);
    if (!created.ok || !(created.json || {}).clientId) {
      console.error('[general-plants-oidc]', created.status, (created.text || '').slice(0, 300));
      return res.status(created.status || 502).json({ success: false, error: 'oidc_client_create_failed' });
    }
    res.status(201).json({ success: true, created: true, client_id: created.json.clientId, project_id: projectId });
  } catch (err) {
    console.error('[general-plants-oidc]', err.message);
    res.status(500).json({ success: false, error: 'oidc_client_internal_error' });
  }
});

const STATE = { 1: 'active', 2: 'inactive', 3: 'deleted', 4: 'locked', 5: 'suspend', 6: 'initial' };
const TYPE  = { 1: 'human', 2: 'machine' };

// ===== 内部函数: 一次拉取所有 last_login (供 BFF 层批量聚合避免 N+1) =====
async function loadLastLoginMap() {
  const zpool = getZitadelPgPool();
  const map = new Map();
  const upsert = (uid, ts) => {
    if (!uid || !ts) return;
    const cur = map.get(String(uid));
    if (!cur || new Date(ts) > new Date(cur)) map.set(String(uid), ts);
  };
  try {
    const r = await zpool.query(`
      SELECT user_id, MAX(password_checked_at) AS last_login
      FROM projections.sessions8
      WHERE user_id IS NOT NULL AND password_checked_at IS NOT NULL
      GROUP BY user_id
    `);
    for (const row of r.rows) upsert(row.user_id, row.last_login);
  } catch (e) {
    console.warn('[identity] sessions8 skipped:', e.message);
  }
  try {
    const r = await zpool.query(`
      SELECT payload->>'userID' AS user_id, MAX(created_at) AS last_login
      FROM eventstore.events2
      WHERE event_type IN ('session.user.checked','session.password.checked','oidc_session.added','session.token.set')
        AND payload ? 'userID'
      GROUP BY payload->>'userID'
    `);
    for (const row of r.rows) upsert(row.user_id, row.last_login);
  } catch (e) {
    console.warn('[identity] events2 skipped:', e.message);
  }
  return map;
}

// GET /identity/users
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
    const lastLoginByZid = await loadLastLoginMap();

    const data = r.rows.map(u => {
      const source = resolveSource(u.instance_name);
      const meta = SOURCE_META[source];
      return {
        id: u.id,
        instance_id: u.instance_id,
        instance_name: u.instance_name,
        org_id: u.org_id,
        org_name: u.org_name,
        org_domain: u.org_domain,
        username: u.username,
        state: u.state,
        state_label: STATE[u.state] || String(u.state),
        type: u.type,
        type_label: TYPE[u.type] || String(u.type),
        creation_date: u.creation_date,
        change_date: u.change_date,
        first_name: u.first_name,
        last_name: u.last_name,
        display_name: u.display_name,
        nick_name: u.nick_name,
        email: u.email,
        is_email_verified: u.is_email_verified,
        phone: u.phone,
        is_phone_verified: u.is_phone_verified,
        preferred_language: u.preferred_language,
        gender: u.gender,
        avatar_key: u.avatar_key,
        has_password: !!u.password_changed,
        password_change_required: !!u.password_change_required,
        last_login_at: lastLoginByZid.get(String(u.id)) || null,
        source_project: source,
        source_label: meta.label,
        source_color: meta.color,
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[identity/users]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /identity/users/:zid
router.get('/users/:zid', async (req, res) => {
  const zid = String(req.params.zid);
  try {
    const zpool = getZitadelPgPool();
    const r = await zpool.query(`
      SELECT u.id, u.instance_id, i.name AS instance_name, u.resource_owner AS org_id,
             o.name AS org_name, u.username, u.state, u.type, u.creation_date, u.change_date,
             h.first_name, h.last_name, h.display_name, h.nick_name,
             h.email, h.is_email_verified, h.phone, h.is_phone_verified,
             h.preferred_language, h.gender, h.avatar_key,
             h.password_changed, h.password_change_required
      FROM projections.users14 u
      LEFT JOIN projections.instances i ON i.id = u.instance_id
      LEFT JOIN projections.orgs1 o ON o.id = u.resource_owner AND o.instance_id = u.instance_id
      LEFT JOIN projections.users14_humans h ON h.user_id = u.id AND h.instance_id = u.instance_id
      WHERE u.id = $1
    `, [zid]);
    if (!r.rowCount) return res.status(404).json({ success: false, error: 'not_found' });
    const u = r.rows[0];
    const source = resolveSource(u.instance_name);
    const meta = SOURCE_META[source];
    const lastMap = await loadLastLoginMap();
    res.json({
      success: true,
      data: {
        ...u,
        state_label: STATE[u.state] || String(u.state),
        type_label: TYPE[u.type] || String(u.type),
        has_password: !!u.password_changed,
        password_change_required: !!u.password_change_required,
        last_login_at: lastMap.get(String(u.id)) || null,
        source_project: source,
        source_label: meta.label,
        source_color: meta.color,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /identity/users/:zid/login-history
router.get('/users/:zid/login-history', async (req, res) => {
  const zid = String(req.params.zid);
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const zpool = getZitadelPgPool();
    const r = await zpool.query(`
      SELECT event_type, created_at, payload
      FROM eventstore.events2
      WHERE payload->>'userID' = $1
        AND event_type IN ('session.user.checked','session.password.checked','oidc_session.added','session.token.set')
      ORDER BY created_at DESC
      LIMIT $2
    `, [zid, limit]);
    res.json({ success: true, count: r.rowCount, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /identity/users/batch-delete
router.post('/users/batch-delete', async (req, res) => {
  const zids = Array.isArray(req.body && req.body.zids) ? req.body.zids.map(String) : [];
  if (!zids.length) return res.status(400).json({ success: false, error: 'zids required' });

  const zpool = getZitadelPgPool();
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
        results.push({ zid, ok: true, username: meta.username, instance: meta.instance_name });
      } else {
        results.push({ zid, ok: false, error: `zitadel_${r.status}`, detail: (r.text || '').slice(0, 200) });
      }
    } catch (e) {
      results.push({ zid, ok: false, error: e.message });
    }
  }
  const okCount = results.filter(r => r.ok).length;
  res.json({ success: true, deleted: okCount, total: zids.length, results });
});

// POST /identity/users/:zid/password-reset
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
    const resp = await zitadelReq('POST', `/v2/users/${encodeURIComponent(zid)}/password_reset`, {
      returnCode: {},
    }, host);
    if (!resp.ok) {
      return res.status(resp.status).json({ success: false, error: `zitadel_${resp.status}`, detail: (resp.text || '').slice(0, 300) });
    }
    res.json({ success: true, data: resp.json, username: meta.username, instance: meta.instance_name });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /identity/instances
router.get('/instances', async (_req, res) => {
  try {
    const zpool = getZitadelPgPool();
    const r = await zpool.query(`
      SELECT i.id, i.name, i.default_org_id, i.default_language,
             (SELECT count(*) FROM projections.users14 u WHERE u.instance_id=i.id) AS user_count
      FROM projections.instances i
      ORDER BY i.name
    `);
    const rows = r.rows.map(x => ({
      ...x,
      user_count: Number(x.user_count),
      canonical_source: resolveSource(x.name),
      source_label: SOURCE_META[resolveSource(x.name)].label,
    }));
    res.json({ success: true, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /identity/stats
router.get('/stats', async (_req, res) => {
  try {
    const zpool = getZitadelPgPool();
    const r = await zpool.query(`
      SELECT i.name AS instance_name, u.type, u.state, count(*)::int AS c
      FROM projections.users14 u LEFT JOIN projections.instances i ON i.id=u.instance_id
      GROUP BY 1,2,3 ORDER BY 1
    `);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /identity/source-meta
router.get('/source-meta', (_req, res) => {
  res.json({ success: true, meta: SOURCE_META, instance_map: INSTANCE_TO_SOURCE });
});

module.exports = router;
