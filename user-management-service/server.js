/**
 * User Management Service — 独立用户管理后端
 * 端口: 3016  |  NodePort: 31016
 *
 * 前后端分离：nginx-gateway 只托管 users.html，本服务只处理 /api/users/* 请求
 *
 * 功能:
 *   GET  /api/users                    — 列表 (Zitadel 全量 + plant_collector 富化)
 *   GET  /api/users/:zid/addresses     — 收货地址明细
 *   PATCH /api/users/:zid              — 更新业务字段 (source_project, tags, gender...)
 *   POST /api/users/batch-delete       — 批量删除 (Zitadel + PG)
 *   POST /api/users/:zid/password-reset — 生成一次性密码重置 code
 *   GET  /api/users/instances          — instance 列表
 *   GET  /api/users/stats              — 统计
 *   GET  /api/users/source-meta        — 来源颜色配置
 *   GET  /api/health                   — 健康检查
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { connectAll } = require('./services/connections');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ⚠️ 内部服务：NodePort 只暴露在 Tailscale 内网；生产可加 K8s NetworkPolicy 或 API key
app.use('/api', require('./routes/zitadel'));  // routes 内部路径本身是 /users, /users/:zid 等

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'user-management-service', ts: new Date().toISOString() });
});

app.use((_req, res) => res.status(404).json({ success: false, error: 'not found' }));
app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ success: false, error: err.message });
});

const PORT = process.env.PORT || 3016;

connectAll()
  .catch(err => { console.error('[connectAll] partial failure:', err.message); })
  .finally(() => {
    app.listen(PORT, () => console.log(`✅ user-management-service listening on :${PORT}`));
  });
