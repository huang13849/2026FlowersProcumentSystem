/**
 * Publish Tasks Routes —— 发布任务持久化管理
 * 
 * 挂载点: /api/publish-tasks
 * 
 * 功能:
 *   POST   /          — 创建任务记录
 *   GET    /          — 任务列表（分页）
 *   GET    /:taskId   — 单个任务
 *   PATCH  /:taskId   — 更新任务状态
 *   GET    /product/:productId — 商品所有发布记录（时间线）
 *   POST   /revoke    — 撤回（批量）
 *   POST   /restore   — 恢复（批量）
 */

import { Router } from 'express';
import ProductPublishTask from '../models/ProductPublishTask.js';
import Product from '../models/Product.js';
import { auth } from '../middleware/auth.js';

const router = Router();
router.use(auth);

// ── 生成任务 ID ──
function generateTaskId() {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const seq = String(Date.now()).slice(-4);
  return `TASK-${date}-${seq}`;
}

// ── POST / — 创建发布任务记录 ──
router.post('/', async (req, res) => {
  try {
    const { productId, platform, platformProductId, operator } = req.body;
    if (!productId || !platform) {
      return res.status(400).json({ error: '缺少 productId 或 platform' });
    }

    const task = await ProductPublishTask.create({
      taskId: generateTaskId(),
      productId,
      platform,
      platformProductId: platformProductId || '',
      operator: operator || 'admin',
      status: 'publishing',
      publishTime: new Date(),
    });

    res.status(201).json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET / — 任务列表 ──
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 20, status, platform, productId } = req.query;
    const query = {};
    if (status) query.status = status;
    if (platform) query.platform = platform;
    if (productId) query.productId = productId;

    const total = await ProductPublishTask.countDocuments(query);
    const tasks = await ProductPublishTask.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(Number(limit));

    res.json({ tasks, total, page: Number(page), totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /:taskId — 单个任务 ──
router.get('/:taskId', async (req, res) => {
  try {
    const task = await ProductPublishTask.findOne({ taskId: req.params.taskId });
    if (!task) return res.status(404).json({ error: '任务不存在' });
    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── PATCH /:taskId — 更新任务状态 ──
router.patch('/:taskId', async (req, res) => {
  try {
    const { status, platformProductId, errorMessage, retryCount } = req.body;
    const update = {};
    if (status) update.status = status;
    if (platformProductId) update.platformProductId = platformProductId;
    if (errorMessage) update.errorMessage = errorMessage;
    if (retryCount !== undefined) update.retryCount = retryCount;

    if (status === 'published') update.publishTime = new Date();
    if (status === 'offline') update.offlineTime = new Date();
    if (status === 'restored') update.restoreTime = new Date();

    const task = await ProductPublishTask.findOneAndUpdate(
      { taskId: req.params.taskId },
      { $set: update },
      { new: true }
    );
    if (!task) return res.status(404).json({ error: '任务不存在' });

    // 同步更新 Product 的 publishStatus
    if (status && task.productId) {
      const syncUpdate = { [`publishStatus.${task.platform}.status`]: status };
      if (platformProductId) syncUpdate[`publishStatus.${task.platform}.platformProductId`] = platformProductId;
      if (status === 'published') syncUpdate[`publishStatus.${task.platform}.publishTime`] = new Date();
      if (status === 'offline') syncUpdate[`publishStatus.${task.platform}.offlineTime`] = new Date();
      
      await Product.findByIdAndUpdate(task.productId, { $set: syncUpdate }).catch(() => {});
    }

    res.json(task);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /product/:productId — 商品发布时间线 ──
router.get('/product/:productId', async (req, res) => {
  try {
    const tasks = await ProductPublishTask.find({ productId: req.params.productId })
      .sort({ createdAt: -1 });
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /revoke — 批量撤回 ──
router.post('/revoke', async (req, res) => {
  try {
    const { productIds, platforms, operator } = req.body;
    if (!productIds?.length || !platforms?.length) {
      return res.status(400).json({ error: '缺少 productIds 或 platforms' });
    }

    const results = [];
    for (const pid of productIds) {
      for (const platform of platforms) {
        // 创建撤回记录
        const task = await ProductPublishTask.create({
          taskId: generateTaskId(),
          productId: pid,
          platform,
          operator: operator || 'admin',
          status: 'offline',
          offlineTime: new Date(),
        });
        results.push(task);

        // 更新商品状态
        await Product.findByIdAndUpdate(pid, {
          $set: { [`publishStatus.${platform}.status`]: 'offline', [`publishStatus.${platform}.offlineTime`]: new Date() }
        }).catch(() => {});
      }
    }

    res.json({ success: true, count: results.length, tasks: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /restore — 批量恢复（重新上架） ──
router.post('/restore', async (req, res) => {
  try {
    const { productIds, platforms, operator } = req.body;
    if (!productIds?.length || !platforms?.length) {
      return res.status(400).json({ error: '缺少 productIds 或 platforms' });
    }

    const results = [];
    for (const pid of productIds) {
      for (const platform of platforms) {
        const task = await ProductPublishTask.create({
          taskId: generateTaskId(),
          productId: pid,
          platform,
          operator: operator || 'admin',
          status: 'restored',
          restoreTime: new Date(),
        });
        results.push(task);

        await Product.findByIdAndUpdate(pid, {
          $set: { [`publishStatus.${platform}.status`]: 'restored', [`publishStatus.${platform}.publishTime`]: new Date() }
        }).catch(() => {});
      }
    }

    res.json({ success: true, count: results.length, tasks: results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
