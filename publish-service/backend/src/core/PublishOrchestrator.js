/**
 * PublishOrchestrator —— 发布编排器（核心业务逻辑）
 *
 * 职责：
 * 1. 调用 product-service 获取商品
 * 2. 从 MinIO 获取图片
 * 3. 进入平台适配器做字段映射
 * 4. 上传图片到平台
 * 5. 调用平台 API 创建商品
 * 6. 记录状态 & 同步日志
 */
const productClient = require('../client/ProductClient');
const { getAdapter } = require('../adapter');
const imageUploadService = require('./ImageUploadService');
const stateManager = require('./StateManager');
const { TaskStatus } = require('../model');

class PublishOrchestrator {
  /**
   * 编排单个商品的单平台发布
   * @param {Object} task 任务对象
   * @param {string} platformKey 平台标识
   * @returns {Promise<Object>} 发布结果
   */
  async publishToPlatform(task, platformKey) {
    const { productId, taskId } = task;
    const startTime = Date.now();

    try {
      // Step 1: 获取商品数据
      stateManager.updateTask(taskId, { status: TaskStatus.FETCHING });
      const product = await productClient.getProductById(productId);
      console.log(`[Orchestrator] 商品 ${productId} 获取成功: ${product.title}`);

      // Step 2: 获取平台适配器
      const platformAccount = task.platformAccounts && task.platformAccounts[platformKey];
      const adapter = getAdapter(platformKey, { account: platformAccount });
      if (!adapter.isConfigured()) {
        throw new Error(`平台 ${platformKey} 未配置密钥，请设置环境变量`);
      }

      // Step 3: 字段映射
      stateManager.updateTask(taskId, { status: TaskStatus.PROCESSING });
      const mappedProduct = adapter.mapProductToPlatform(product);
      const accountLabel = adapter.getAccountLabel ? adapter.getAccountLabel() : null;
      console.log(`[Orchestrator] 字段映射完成 → ${adapter.platformName}${accountLabel ? ' / ' + accountLabel : ''}`);

      // Step 4: 上传图片到平台（花乡花木由 adapter 内部处理，跳过避免双重上传）
      stateManager.updateTask(taskId, { status: TaskStatus.UPLOADING_IMAGES });
      const imageMap = (platformKey === 'huaxiang') ? new Map() : await imageUploadService.uploadProductImages(product, adapter);

      // Step 5: 发布商品
      stateManager.updateTask(taskId, { status: TaskStatus.PUBLISHING });
      const publishResult = await adapter.publishProduct(product, mappedProduct, imageMap);

      // Step 6: 记录成功
      const result = {
        platform: platformKey,
        platformName: adapter.platformName,
        status: 'success',
        platformProductId: publishResult.platformProductId,
        accountLabel,
        durationMs: Date.now() - startTime,
      };

      stateManager.updateTaskResult(taskId, platformKey, result);
      stateManager.addRecord({
        taskId,
        productId,
        platform: platformKey,
        status: 'success',
        platformProductId: publishResult.platformProductId,
      });

      console.log(`[Orchestrator] ✅ ${adapter.platformName} 发布成功, platformProductId=${publishResult.platformProductId}`);
      return result;

    } catch (err) {
      // 失败记录
      const errorMessage = err.message;
      console.error(`[Orchestrator] ❌ 发布失败 [${platformKey}] productId=${productId}:`, errorMessage);

      const result = {
        platform: platformKey,
        status: 'failed',
        errorMessage,
        durationMs: Date.now() - startTime,
      };

      stateManager.updateTaskResult(taskId, platformKey, result);
      stateManager.addRecord({
        taskId,
        productId,
        platform: platformKey,
        status: 'failed',
        errorMessage,
      });

      throw err; // 让 TaskQueue 处理重试
    }
  }

  /**
   * 下架商品
   * @param {string} platformKey 平台标识
   * @param {string} platformProductId 平台商品ID
   * @returns {Promise<Object>}
   */
  async offlineFromPlatform(platformKey, platformProductId) {
    const adapter = getAdapter(platformKey);
    if (!adapter.isConfigured()) {
      throw new Error(`平台 ${platformKey} 未配置`);
    }

    const success = await adapter.offlineProduct(platformProductId);
    console.log(`[Orchestrator] ${adapter.platformName} 下架结果: ${success ? '✅ 成功' : '❌ 失败'}`);

    return {
      platform: platformKey,
      platformName: adapter.platformName,
      platformProductId,
      success,
    };
  }
}

module.exports = new PublishOrchestrator();
