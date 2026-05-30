/**
 * 数据模型定义 —— 发布任务 & 同步记录
 */

/**
 * 发布任务状态枚举
 */
const TaskStatus = Object.freeze({
  WAITING: 'waiting',
  FETCHING: 'fetching',
  PROCESSING: 'processing',
  UPLOADING_IMAGES: 'uploading_images',
  PUBLISHING: 'publishing',
  SUCCESS: 'success',
  FAILED: 'failed',
  RETRYING: 'retrying',
  OFFLINE: 'offline',
});

/**
 * 支持的平台列表
 */
const SupportedPlatforms = ['douyin', 'xiaohongshu', 'pinduoduo', 'shipinhao'];

/**
 * 创建发布任务对象
 */
function createPublishTask({ productId, platforms, requestedBy }) {
  return {
    taskId: null,           // uuid, assigned by TaskQueue
    productId,
    platforms: Array.isArray(platforms) ? [...new Set(platforms)] : [platforms],
    status: TaskStatus.WAITING,
    results: {},            // { [platform]: { status, platformProductId, error, ... } }
    errorMessage: null,
    retryCount: 0,
    requestedBy: requestedBy || 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  };
}

/**
 * 创建同步记录对象（每次发布操作产生一条）
 */
function createPublishRecord({ taskId, productId, platform, status, platformProductId, errorMessage }) {
  return {
    recordId: null,        // uuid, assigned by StateManager
    taskId,
    productId,
    platform,
    status,
    platformProductId: platformProductId || null,
    errorMessage: errorMessage || null,
    createdAt: new Date().toISOString(),
  };
}

module.exports = {
  TaskStatus,
  SupportedPlatforms,
  createPublishTask,
  createPublishRecord,
};
