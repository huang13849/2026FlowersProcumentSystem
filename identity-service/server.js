/**
 * Identity Service - 身份领域
 * Port: 3017  NodePort: 31017
 *
 * 职责: 用户身份主档 (Zitadel PG)、最后登录时间、密码状态、密码重置、批量禁用、instance 元数据
 * 数据源: projections.users14, sessions8, eventstore.events2, projections.instances
 * 写通道: Zitadel Admin API (systemuser JWT)
 *
 * Endpoints:
 *   GET  /identity/users                      - 用户身份列表(不含业务档案)
 *   GET  /identity/users/:zid                 - 单用户身份详情
 *   GET  /identity/users/:zid/login-history   - 登录历史(events2)
 *   POST /identity/users/:zid/password-reset  - 触发密码重置(生成一次性 code)
 *   POST /identity/users/batch-delete         - 批量禁用/删除
 *   GET  /identity/instances                  - instance 元数据列表
 *   GET  /identity/stats                      - 身份维度统计
 *   GET  /identity/source-meta                - 来源标签映射
 *   GET  /health
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

app.use('/identity', require('./routes/identity'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'identity-service', ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3017;
connectAll().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🆔 identity-service listening on :${PORT}`);
  });
}).catch(err => {
  console.error('❌ startup failed:', err.message);
  process.exit(1);
});
