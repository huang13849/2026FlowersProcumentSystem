/**
 * AsyncTaskQueue —— 异步任务队列
 *
 * 职责：
 * - 接收发布任务，异步执行
 * - 失败自动重试（带指数退避）
 * - 支持并发控制
 * - 状态实时更新
 *
 * 生产环境可替换为 Bull / BullMQ + Redis
 */
const { EventEmitter } = require('events');
const stateManager = require('../core/StateManager');
const publishOrchestrator = require('../core/PublishOrchestrator');
const { TaskStatus } = require('../model');
const config = require('../config');

class AsyncTaskQueue extends EventEmitter {
  constructor() {
    super();
    this.queue = [];              // 待处理任务队列
    this.activeCount = 0;
    this.maxConcurrency = 3;     // 最大并发任务数
    this.processing = false;

    // 启动队列处理循环
    this._startLoop();
  }

  /**
   * 添加发布任务
   * @param {Object} task 任务对象
   * @returns {string} taskId
   */
  enqueue(task) {
    const savedTask = stateManager.createTask(task);
    this.queue.push({ ...savedTask, retryCount: savedTask.retryCount || 0 });
    console.log(`[TaskQueue] 任务入队: ${savedTask.taskId}, platforms=${savedTask.platforms.join(',')}`);
    this._processNext();
    return savedTask.taskId;
  }

  /**
   * 添加重试任务
   * @param {string} taskId 原始任务ID
   * @param {string[]} [platforms] 要重试的平台（不传则重试所有失败的）
   */
  async enqueueRetry(taskId, platforms) {
    const task = stateManager.getTask(taskId);
    if (!task) throw new Error(`任务不存在: ${taskId}`);

    // 找出失败的平台
    const failedPlatforms = platforms || Object.entries(task.results || {})
      .filter(([, r]) => r.status === 'failed')
      .map(([p]) => p);

    if (!failedPlatforms.length) {
      throw new Error('没有需要重试的平台');
    }

    const retryTask = {
      productId: task.productId,
      platforms: failedPlatforms,
      status: TaskStatus.RETRYING,
      results: { ...task.results },
      retryCount: (task.retryCount || 0) + 1,
      originalTaskId: taskId,
    };

    if (retryTask.retryCount > config.retry.maxRetries) {
      throw new Error(`重试次数已达上限 (${config.retry.maxRetries})`);
    }

    return this.enqueue(retryTask);
  }

  // ==================== 队列处理 ====================

  async _processNext() {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0 && this.activeCount < this.maxConcurrency) {
      const task = this.queue.shift();
      this.activeCount++;
      // 异步处理，不阻塞队列
      this._executeTask(task).finally(() => {
        this.activeCount--;
        this._processNext();
      });
    }

    this.processing = false;
  }

  async _executeTask(task) {
    const { taskId, productId, platforms } = task;
    console.log(`[TaskQueue] 开始执行任务 ${taskId}, platforms=${platforms.join(',')}`);

    // 更新任务状态
    stateManager.updateTask(taskId, { status: TaskStatus.PROCESSING });

    // 并行发布到各平台
    const results = await Promise.allSettled(
      platforms.map(platformKey =>
        this._publishWithRetry(task, platformKey)
      )
    );

    // 判断整体状态
    const allSuccess = results.every(r => r.status === 'fulfilled' && r.value?.status === 'success');
    const anySuccess = results.some(r => r.status === 'fulfilled' && r.value?.status === 'success');
    const allFailed = results.every(r => r.status === 'rejected' || r.value?.status === 'failed');

    let finalStatus;
    if (allSuccess) {
      finalStatus = TaskStatus.SUCCESS;
    } else if (allFailed) {
      finalStatus = TaskStatus.FAILED;
    } else {
      finalStatus = TaskStatus.FAILED; // 部分成功也算失败，需人工查看
    }

    const taskResult = stateManager.completeTask(taskId, finalStatus);
    this.emit('taskCompleted', taskResult);

    console.log(`[TaskQueue] 任务完成 ${taskId}: ${finalStatus}`);
  }

  async _publishWithRetry(task, platformKey) {
    let lastError;

    for (let attempt = 0; attempt <= config.retry.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          const delay = config.retry.retryDelayMs * Math.pow(2, attempt - 1);
          console.log(`[TaskQueue] 重试 ${platformKey} 第${attempt}次, 等待${delay}ms`);
          await this._sleep(delay);
        }

        return await publishOrchestrator.publishToPlatform(task, platformKey);
      } catch (err) {
        lastError = err;
        console.warn(`[TaskQueue] ${platformKey} 第${attempt}次失败: ${err.message}`);
      }
    }

    // 所有重试都失败
    return {
      platform: platformKey,
      status: 'failed',
      errorMessage: `重试${config.retry.maxRetries}次后仍失败: ${lastError?.message}`,
    };
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== 状态查询 ====================

  getQueueStats() {
    return {
      queueLength: this.queue.length,
      activeCount: this.activeCount,
      maxConcurrency: this.maxConcurrency,
    };
  }

  /**
   * 启动队列循环（服务启动时处理未完成的任务）
   */
  _startLoop() {
    // 服务启动时，不自动重新入队历史任务
    // 历史任务需要通过 /retry 接口手动重试
    console.log(`[TaskQueue] 队列已启动, 最大并发=${this.maxConcurrency}`);
  }
}

module.exports = new AsyncTaskQueue();
