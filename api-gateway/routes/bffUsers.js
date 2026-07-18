/**
 * BFF /api/users — 用户聚合层
 * 并行调 identity-service (身份主档 + last_login) + profile-service (业务档案 + 地址)
 * 前端只需 /api/users 一个入口, 内部服务分散在 identity/profile 两个 svc
 *
 * 上游服务地址通过 env 配置, 默认走 k8s cluster DNS:
 *   IDENTITY_URL: http://identity-service.supply-chain.svc.cluster.local:3017
 *   PROFILE_URL:  http://profile-service.supply-chain.svc.cluster.local:3018
 */
const express = require('express');
const router = express.Router();

const IDENTITY_URL = process.env.IDENTITY_URL || 'http://identity-service.supply-chain.svc.cluster.local:3017';
const PROFILE_URL  = process.env.PROFILE_URL  || 'http://profile-service.supply-chain.svc.cluster.local:3018';

async function getJson(url) {
  const r = await fetch(url);
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}
async function reqJson(method, url, body) {
  const r = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  try { return { ok: r.ok, status: r.status, json: JSON.parse(text) }; }
  catch { return { ok: r.ok, status: r.status, json: null, text }; }
}

// GET /api/users — 聚合
router.get('/', async (_req, res) => {
  try {
    const [idR, prR] = await Promise.all([
      getJson(`${IDENTITY_URL}/identity/users`),
      getJson(`${PROFILE_URL}/profile/users`),
    ]);
    if (!idR.ok) return res.status(502).json({ success: false, error: 'identity_upstream', detail: idR.json || idR.text });
    const identities = (idR.json && idR.json.data) || [];
    const profiles = (prR.ok && prR.json && prR.json.data) || [];
    const profByZid = new Map();
    for (const p of profiles) profByZid.set(String(p.zid), p);

    const data = identities.map(u => {
      const p = profByZid.get(String(u.id));
      return {
        ...u,
        oneid: (p && p.oneid) || null,
        user_type: (p && p.user_type) || null,
        tags: (p && p.tags) || [],
        address_count: (p && p.address_count) || 0,
        default_address: (p && p.default_address) || null,
        pg_synced: !!p,
        // 前端如果读了 PG 内的 source_project, 保留 identity 的权威值(instance→canonical)
      };
    });
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[bff /api/users]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// PATCH /api/users/:zid — 走 profile-service
router.patch('/:zid', async (req, res) => {
  const r = await reqJson('PATCH', `${PROFILE_URL}/profile/users/${encodeURIComponent(req.params.zid)}`, req.body);
  res.status(r.status).json(r.json || { success: false, error: 'upstream_error', detail: r.text });
});

// POST /api/users/batch-delete — 先 identity 删 Zitadel, 再 profile 删档
router.post('/batch-delete', async (req, res) => {
  const zids = Array.isArray(req.body && req.body.zids) ? req.body.zids : [];
  if (!zids.length) return res.status(400).json({ success: false, error: 'zids required' });
  const idR = await reqJson('POST', `${IDENTITY_URL}/identity/users/batch-delete`, { zids });
  // profile 逐个删档 (identity 删成功的)
  const oks = ((idR.json && idR.json.results) || []).filter(x => x.ok).map(x => x.zid);
  const profDel = [];
  for (const zid of oks) {
    try {
      const pr = await reqJson('DELETE', `${PROFILE_URL}/profile/users/${encodeURIComponent(zid)}`);
      profDel.push({ zid, ok: pr.ok });
    } catch (e) { profDel.push({ zid, ok: false, error: e.message }); }
  }
  res.status(idR.status).json({ ...(idR.json || {}), profile_deletes: profDel });
});

// POST /api/users/:zid/password-reset — 走 identity
router.post('/:zid/password-reset', async (req, res) => {
  const r = await reqJson('POST',
    `${IDENTITY_URL}/identity/users/${encodeURIComponent(req.params.zid)}/password-reset`,
    req.body || {});
  res.status(r.status).json(r.json || { success: false, error: 'upstream_error', detail: r.text });
});

// GET /api/users/:zid/addresses — 走 profile
router.get('/:zid/addresses', async (req, res) => {
  const r = await getJson(`${PROFILE_URL}/profile/users/${encodeURIComponent(req.params.zid)}/addresses`);
  res.status(r.status).json(r.json || { success: false, error: 'upstream_error', detail: r.text });
});

// GET /api/users/instances — 走 identity
router.get('/instances', async (_req, res) => {
  const r = await getJson(`${IDENTITY_URL}/identity/instances`);
  res.status(r.status).json(r.json || { success: false, error: 'upstream_error', detail: r.text });
});

// GET /api/users/stats — 走 identity
router.get('/stats', async (_req, res) => {
  const r = await getJson(`${IDENTITY_URL}/identity/stats`);
  res.status(r.status).json(r.json || { success: false, error: 'upstream_error', detail: r.text });
});

// GET /api/users/source-meta — 走 identity
router.get('/source-meta', async (_req, res) => {
  const r = await getJson(`${IDENTITY_URL}/identity/source-meta`);
  res.status(r.status).json(r.json || { success: false, error: 'upstream_error', detail: r.text });
});

module.exports = router;
