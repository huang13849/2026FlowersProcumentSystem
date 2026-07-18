/**
 * Profile Service - 业务档案领域
 * Port: 3018  NodePort: 31018
 *
 * 职责: 用户业务档案 (标签/地址/OneID/来源等 - 完全独立于 Zitadel 身份表)
 * 数据源:
 *   - PG plant_collector.user_profiles  (zid↔loginName 桥表 + tags + oneid)
 *   - PG plant_collector.user_addresses (收货地址)
 *   - PG plant_collector.tags           (标签池)
 *
 * Endpoints:
 *   GET   /profile/users                   - 全量业务档案(用于 BFF 聚合)
 *   GET   /profile/users/:zid              - 单档
 *   PATCH /profile/users/:zid              - 更新档案(source/user_type/tags/gender)
 *   DELETE /profile/users/:zid             - 删档
 *   GET   /profile/users/:zid/addresses    - 地址列表
 *   POST  /profile/users/:zid/addresses    - 增地址
 *   GET   /profile/tags                    - 标签池
 *   POST  /profile/tags                    - 新标签
 *   DELETE /profile/tags/:name             - 删标签
 *   GET   /health
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

app.use('/profile', require('./routes/profile'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'profile-service', ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3018;
connectAll().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`👤 profile-service listening on :${PORT}`);
  });
}).catch(err => {
  console.error('❌ startup failed:', err.message);
  process.exit(1);
});
