/**
 * Publish API Routes —— 对外 HTTP 接口
 *
 * 1. POST /api/publish       —— 发布商品到多平台
 * 2. GET  /api/publish/status/:taskId   —— 查询发布状态
 * 3. GET  /api/publish/record/:productId —— 查询商品同步记录
 * 4. POST /api/publish/retry —— 重新发布（失败重试）
 * 5. POST /api/publish/offline —— 下架商品
 * 6. GET  /api/publish/platforms —— 获取支持的平台列表
 */
const { Router } = require('express');
const taskQueue = require('../task/AsyncTaskQueue');
const stateManager = require('../core/StateManager');
const publishOrchestrator = require('../core/PublishOrchestrator');
const { getSupportedPlatforms } = require('../adapter');
const { createPublishTask, SupportedPlatforms, TaskStatus } = require('../model');
const minioClient = require('../client/MinioImageClient');
const config = require('../config');

const router = Router();

function normalizeHuaxiangAccount(raw) {
  if (!raw) return null;
  const token = String(raw.token || '').trim();
  let cookie = String(raw.cookie || '').trim();
  const label = String(raw.label || raw.username || '').trim().slice(0, 80);
  const username = String(raw.username || '').trim().slice(0, 80);

  // 允许用户只粘 JSESSIONID/ajaxtoken/Admin-Token 三个值，也允许直接粘完整 Cookie。
  const parts = [];
  if (raw.jsessionid) parts.push(`JSESSIONID=${String(raw.jsessionid).trim()}`);
  if (raw.adminToken) parts.push(`Admin-Token=${String(raw.adminToken).trim()}`);
  if (raw.ajaxtoken) parts.push(`ajaxtoken=${String(raw.ajaxtoken).trim()}`);
  if (parts.length) cookie = parts.join('; ');

  if (!token || !cookie) {
    throw new Error('花乡花木账号缺少 token 或 cookie');
  }
  // JSESSIONID 可能是 HttpOnly，浏览器脚本读不到；实测 token + ajaxtoken 也能覆盖多数接口。
  // 如果用户从 DevTools Application/Cookies 手动补上 JSESSIONID，会原样携带。
  if (!/ajaxtoken=/i.test(cookie)) {
    throw new Error('花乡花木 Cookie 至少需要包含 ajaxtoken');
  }
  if (!/Admin-Token=/i.test(cookie)) {
    cookie += '; Admin-Token=admin-token';
  }
  return { token, cookie, label: label || username || '花乡临时账号', username, freightTemplateId: Number(raw.freightTemplateId) || 216 };
}


// ==================== 1. 发布商品到多平台 ====================

/**
 * POST /api/publish
 * Body: { productId, platforms: ['douyin', 'xiaohongshu'], requestedBy? }
 */
router.post('/', async (req, res) => {
  try {
    const { productId, platforms, requestedBy, accounts, platformAccounts } = req.body;

    // 参数校验
    if (!productId) {
      return res.status(400).json({ error: '缺少 productId' });
    }
    if (!platforms || !Array.isArray(platforms) || platforms.length === 0) {
      return res.status(400).json({ error: 'platforms 必须是非空数组' });
    }

    // 校验平台有效性
    const invalidPlatforms = platforms.filter(p => !SupportedPlatforms.includes(p));
    if (invalidPlatforms.length) {
      return res.status(400).json({
        error: `不支持的平台: ${invalidPlatforms.join(', ')}`,
        supported: SupportedPlatforms,
      });
    }

    const normalizedAccounts = {};
    const accountInput = platformAccounts || accounts || {};
    if (platforms.includes('huaxiang') && accountInput.huaxiang) {
      normalizedAccounts.huaxiang = normalizeHuaxiangAccount(accountInput.huaxiang);
    }

    // 创建任务并入队
    const taskData = createPublishTask({ productId, platforms: [...new Set(platforms)], requestedBy, platformAccounts: normalizedAccounts });
    const taskId = taskQueue.enqueue(taskData);

    return res.status(202).json({
      success: true,
      taskId,
      message: '发布任务已创建，正在异步处理',
      _links: {
        status: `/api/publish/status/${taskId}`,
        record: `/api/publish/record/${productId}`,
      },
    });
  } catch (err) {
    console.error('[API] POST /api/publish 错误:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ==================== 2. 查询发布状态 ====================

/**
 * GET /api/publish/status/:taskId
 */
router.get('/status/:taskId', (req, res) => {
  try {
    const { taskId } = req.params;
    const task = stateManager.getTask(taskId);

    if (!task) {
      return res.status(404).json({ error: `任务不存在: ${taskId}` });
    }

    return res.json({
      taskId: task.taskId,
      productId: task.productId,
      status: task.status,
      platforms: task.platforms,
      results: task.results,
      errorMessage: task.errorMessage,
      retryCount: task.retryCount,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      completedAt: task.completedAt,
    });
  } catch (err) {
    console.error('[API] GET /api/publish/status 错误:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ==================== 3. 查询商品同步记录 ====================

/**
 * GET /api/publish/record/:productId
 * Query: ?platform=douyin&status=success
 */
router.get('/record/:productId', (req, res) => {
  try {
    const { productId } = req.params;
    const { platform, status } = req.query;

    let records = stateManager.getRecordsByProductId(productId);

    // 按平台过滤
    if (platform) {
      records = records.filter(r => r.platform === platform);
    }
    // 按状态过滤
    if (status) {
      records = records.filter(r => r.status === status);
    }

    return res.json({
      productId,
      total: records.length,
      records: records.map(r => ({
        recordId: r.recordId,
        taskId: r.taskId,
        platform: r.platform,
        status: r.status,
        platformProductId: r.platformProductId,
        errorMessage: r.errorMessage,
        createdAt: r.createdAt,
      })),
    });
  } catch (err) {
    console.error('[API] GET /api/publish/record 错误:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ==================== 4. 重新发布（失败重试） ====================

/**
 * POST /api/publish/retry
 * Body: { taskId, platforms?: ['douyin'] }
 */
router.post('/retry', async (req, res) => {
  try {
    const { taskId, platforms } = req.body;

    if (!taskId) {
      return res.status(400).json({ error: '缺少 taskId' });
    }

    const newTaskId = await taskQueue.enqueueRetry(taskId, platforms);

    return res.status(202).json({
      success: true,
      taskId: newTaskId,
      message: '重试任务已入队',
      _links: {
        status: `/api/publish/status/${newTaskId}`,
      },
    });
  } catch (err) {
    console.error('[API] POST /api/publish/retry 错误:', err.message);
    return res.status(400).json({ error: err.message });
  }
});

// ==================== 5. 下架商品 ====================

/**
 * POST /api/publish/offline
 * Body: { platform: 'douyin', platformProductId: '...', productId?: '...' }
 */
router.post('/offline', async (req, res) => {
  try {
    const { platform, platformProductId, productId } = req.body;

    if (!platform || !platformProductId) {
      return res.status(400).json({ error: '缺少 platform 或 platformProductId' });
    }
    if (!SupportedPlatforms.includes(platform)) {
      return res.status(400).json({ error: `不支持的平台: ${platform}` });
    }

    const result = await publishOrchestrator.offlineFromPlatform(platform, platformProductId);

    // 记录下架操作
    stateManager.addRecord({
      taskId: 'offline-' + Date.now(),
      productId: productId || 'unknown',
      platform,
      status: result.success ? 'offline' : 'failed',
      platformProductId,
      errorMessage: result.success ? null : (result.errorMessage || '下架失败'),
    });

    return res.json({
      success: result.success,
      ...result,
    });
  } catch (err) {
    console.error('[API] POST /api/publish/offline 错误:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ==================== 6. 获取支持的平台列表 ====================

/**
 * GET /api/publish/platforms
 */
router.get('/platforms', (req, res) => {
  try {
    const platforms = getSupportedPlatforms();
    return res.json({
      total: platforms.length,
      platforms,
    });
  } catch (err) {
    console.error('[API] GET /api/publish/platforms 错误:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ==================== 辅助接口 ====================

/**
 * GET /api/publish/health — 健康检查
 */


/**
 * GET /api/publish/minio-stats
 * 统计 MinIO 图床各目录文件数量（无认证要求）
 */
router.get('/minio-stats', async (req, res) => {
  try {
    const folders = ['products', 'contract', 'license', 'shops', 'dispatch'];
    const counts = {};
    let total = 0;

    for (const folder of folders) {
      try {
        const objects = await new Promise((resolve, reject) => {
          const items = [];
          const stream = minioClient.client.listObjects(config.minio.bucket, folder + '/', true);
          stream.on('data', obj => items.push(obj));
          stream.on('end', () => resolve(items));
          stream.on('error', reject);
        });
        counts[folder] = objects.length;
        total += objects.length;
      } catch (err) {
        console.warn('[minio-stats] folder error:', folder, err.message);
        counts[folder] = 0;
      }
    }

    return res.json({ total, folders: counts });
  } catch (err) {
    console.error('[minio-stats] error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/health', (req, res) => {
  const queueStats = taskQueue.getQueueStats();
  const stateStats = stateManager.getStats();
  return res.json({
    status: 'ok',
    service: 'publish-service',
    uptime: process.uptime(),
    queue: queueStats,
    state: stateStats,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
