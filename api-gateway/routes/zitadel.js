/**
 * API Gateway - Zitadel 用户只读聚合路由
 * 直连 RPi8 上 Zitadel 的 PostgreSQL projections，跨 instance 聚合展示。
 * 只读 — 不写任何 Zitadel 表；用户如需变更，仍在各自 instance 的 Console 操作。
 */
const express = require('express');
const router = express.Router();
const { getZitadelPgPool } = require('../services/connections');

// GET /api/zitadel/users  —— 跨 instance 全量用户
router.get('/users', async (req, res) => {
  try {
    const pool = getZitadelPgPool();
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
    const r = await pool.query(sql);
    // 状态/类型翻译
    const STATE = { 1: 'active', 2: 'inactive', 3: 'deleted', 4: 'locked', 5: 'suspend', 6: 'initial' };
    const TYPE  = { 1: 'human', 2: 'machine' };
    const data = r.rows.map(u => ({
      ...u,
      state_label: STATE[u.state] || String(u.state),
      type_label: TYPE[u.type] || String(u.type),
    }));
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    console.error('[zitadel/users]', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /api/zitadel/instances  —— instance + org 元数据（前端筛选下拉用）
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

// GET /api/zitadel/stats  —— 汇总统计（供 KPI 卡片）
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
