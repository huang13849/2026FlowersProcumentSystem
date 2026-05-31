/**
 * publish-service 入口文件
 *
 * 微服务启动入口，职责：
 * - 加载环境变量
 * - 初始化平台适配器
 * - 启动 Express HTTP 服务
 * - 注册路由
 */
// 非 Docker 环境：从 backend 目录的上级加载 .env
// Docker 环境：通过 docker-compose env_file 注入，dotenv 无操作
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const config = require('./config');
const { initAdapters } = require('./adapter');
const publishRoutes = require('./api/publish');

// 初始化平台适配器
initAdapters();

const app = express();

// ==================== 中间件 ====================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('short'));

// ==================== 路由 ====================

// 前端页面（publish.html）
app.get('/', (req, res) => res.sendFile(require('path').join(__dirname, '..', 'frontend', 'publish.html')));
app.use(express.static(require('path').join(__dirname, '..', 'frontend')));

// 发布服务主路由
app.use('/api/publish', publishRoutes);

// 健康检查（根路径）
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'publish-service',
    version: '1.0.0',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

// 全局错误处理
app.use((err, req, res, _next) => {
  console.error('[Express] 未捕获错误:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message: err.message,
  });
});

// ==================== 启动 ====================

const server = app.listen(config.port, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════════╗');
  console.log('║        📦 publish-service v1.0.0           ║');
  console.log(`║        Port: ${config.port}                           ║`);
  console.log('║        🛜  product-service + MinIO           ║');
  console.log('╚════════════════════════════════════════════╝');
  console.log('');
  console.log(`  Product Service: ${config.productService.baseUrl}`);
  console.log(`  MinIO: ${config.minio.endPoint}:${config.minio.port}`);
  console.log(`  Platforms: douyin, xiaohongshu, pinduoduo, shipinhao`);
  console.log('');
});

// ==================== 优雅退出 ====================

function gracefulShutdown(signal) {
  console.log(`\n[Shutdown] 收到 ${signal} 信号，正在优雅退出...`);
  server.close(() => {
    console.log('[Shutdown] HTTP 服务已关闭');
    process.exit(0);
  });
  // 强制退出超时
  setTimeout(() => {
    console.error('[Shutdown] 强制退出');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('unhandledRejection', (reason) => {
  console.error('[Process] unhandledRejection:', reason);
});
