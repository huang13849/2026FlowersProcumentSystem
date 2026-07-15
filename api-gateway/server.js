/**
 * API Gateway — supply-chain-platform 统一数据网关
 * 
 * 职责：
 * 1. 统一对外提供 MongoDB / PostgreSQL / Redis / MySQL / MinIO 的增删改查接口
 * 2. 自动路由到正确的数据库主从节点（写→主，读→从）
 * 3. 缓存层（Redis hot data）
 * 4. 认证 & 限流
 * 5. Prometheus 指标（含 service label 区分调用来源）
 * 
 * 端口: 3007
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const promClient = require('prom-client');
require('dotenv').config();

const app = express();

// ===== Prometheus 指标 =====
promClient.collectDefaultMetrics({ register: promClient.register });

// 自定义指标 — 增加 service label 区分调用来源
const httpRequestsTotal = new promClient.Counter({
  name: 'api_gateway_http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status', 'service'],
});
const httpRequestDurationSeconds = new promClient.Histogram({
  name: 'api_gateway_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'service'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
const dbOperationDurationSeconds = new promClient.Histogram({
  name: 'api_gateway_db_operation_duration_seconds',
  help: 'Database operation duration in seconds',
  labelNames: ['db', 'operation'],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
});
const dbConnectionsActive = new promClient.Gauge({
  name: 'api_gateway_db_connections_active',
  help: 'Active database connections',
  labelNames: ['db'],
});
const authAttemptsTotal = new promClient.Counter({
  name: 'api_gateway_auth_attempts_total',
  help: 'Authentication attempts',
  labelNames: ['method', 'result'],
});
// MinIO 操作指标
const minioOperationsTotal = new promClient.Counter({
  name: 'api_gateway_minio_operations_total',
  help: 'MinIO file operations',
  labelNames: ['operation', 'status'],
});
const minioOperationDurationSeconds = new promClient.Histogram({
  name: 'api_gateway_minio_operation_duration_seconds',
  help: 'MinIO operation duration in seconds',
  labelNames: ['operation'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
const minioFileSizeBytes = new promClient.Histogram({
  name: 'api_gateway_minio_file_size_bytes',
  help: 'MinIO uploaded file size in bytes',
  labelNames: ['folder'],
  buckets: [1024, 10240, 102400, 512000, 1048576, 5242880, 10485760, 52428800],
});

// 从请求路径推断 service 来源
function inferService(path) {
  if (path.startsWith('/api/mongo')) return 'mongo';
  if (path.startsWith('/api/pg')) return 'postgres';
  if (path.startsWith('/api/redis')) return 'redis';
  if (path.startsWith('/api/mysql')) return 'mysql';
  if (path.startsWith('/api/minio')) return 'minio';
  if (path.startsWith('/api/unified')) return 'unified';
  if (path.startsWith('/api/zitadel')) return 'zitadel';
  if (path.startsWith('/api/health') || path.startsWith('/metrics')) return 'system';
  return 'unknown';
}

// 指标中间件
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const route = req.route ? req.route.path : req.path;
    const service = inferService(req.path);
    httpRequestsTotal.inc({ method: req.method, route, status: res.statusCode, service });
    httpRequestDurationSeconds.observe({ method: req.method, route, service }, (Date.now() - start) / 1000);
  });
  next();
});

// 指标端点（免认证）
app.get('/metrics', async (req, res) => {
  try {
    const { getMongoDb, getPgPool, getRedisClient, getMinioClient } = require('./services/connections');
    try { dbConnectionsActive.set({ db: 'mongodb' }, mongoose.connection.readyState === 1 ? 1 : 0); } catch(e) {}
    try { dbConnectionsActive.set({ db: 'redis' }, getRedisClient() ? 1 : 0); } catch(e) {}
    try { dbConnectionsActive.set({ db: 'postgres' }, getPgPool() ? 1 : 0); } catch(e) {}
    try { dbConnectionsActive.set({ db: 'minio' }, getMinioClient() ? 1 : 0); } catch(e) {}

    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  } catch (err) {
    res.status(500).end(err.message);
  }
});

// ===== 中间件 =====
app.use(cors());
app.use(helmet());
app.use(express.json({ limit: '50mb' }));

// 限流：每 IP 每 15 分钟 1000 次
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '请求过于频繁，请稍后再试' },
}));

// ===== 认证中间件（路由之前） =====
const authMiddleware = require('./middleware/auth');
app.use('/api/mongo', authMiddleware);
app.use('/api/pg', authMiddleware);
app.use('/api/redis', authMiddleware);
app.use('/api/mysql', authMiddleware);
app.use('/api/unified', authMiddleware);
app.use('/api/zitadel', authMiddleware);
app.use('/api/minio', authMiddleware);

// ===== 路由 =====
app.use('/api/health', require('./routes/health'));
// products 商品子集 → 代理到 product-api-service（必须在 /api/mongo 之前 mount）
app.use('/api/mongo/products', require('./routes/mongoProductsProxy'));
app.use('/api/mongo', require('./routes/mongo'));
app.use('/api/pg', require('./routes/postgres'));
app.use('/api/redis', require('./routes/redis'));
app.use('/api/mysql', require('./routes/mysql'));
app.use('/api/unified', require('./routes/unified'));
app.use('/api/zitadel', require('./routes/zitadel'));
app.use('/api/tags', require('./routes/tags'));
app.use('/api/minio', require('./routes/minio'));

// 404
app.use((req, res) => {
  res.status(404).json({ error: '路由不存在', path: req.path });
});

// 全局错误处理
app.use((err, req, res, next) => {
  console.error('[Gateway Error]', err.message);
  res.status(err.status || 500).json({
    error: err.message || '内部服务器错误',
    code: err.code,
  });
});

const PORT = process.env.PORT || 3007;

// ===== 启动 =====
async function start() {
  try {
    const { connectAll } = require('./services/connections');
    const results = await connectAll();
    console.log('📦 Database connections:');
    if (results.mongodb) console.log('  ✅ MongoDB connected');
    if (results.mongodbError) console.log('  ⚠️  MongoDB: ' + results.mongodbError);
    if (results.postgres) console.log('  ✅ PostgreSQL connected');
    if (results.postgresError) console.log('  ⚠️  PostgreSQL: ' + results.postgresError);
    if (results.redis) console.log('  ✅ Redis connected');
    if (results.redisError) console.log('  ⚠️  Redis: ' + results.redisError);
    if (results.minio) console.log('  ✅ MinIO connected');
    if (results.minioError) console.log('  ⚠️  MinIO: ' + results.minioError);
  } catch (e) {
    console.error('❌ Startup connection error:', e.message);
  }

  app.listen(PORT, () => {
    console.log('🚪 API Gateway running on port ' + PORT);
    console.log('📋 Endpoints: /api/mongo | /api/pg | /api/redis | /api/mysql | /api/minio | /api/unified | /api/zitadel');
  });
}

start();
