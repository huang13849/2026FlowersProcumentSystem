/**
 * StateManager —— 任务状态管理器
 *
 * 职责：
 * - 管理发布任务状态（内存 + 文件持久化）
 * - 记录同步日志
 * - 支持按 taskId / productId 查询
 *
 * 生产环境可替换为 Redis / PostgreSQL
 */
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { createPublishRecord } = require('../model');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');
const RECORDS_FILE = path.join(DATA_DIR, 'records.json');

class StateManager {
  constructor() {
    this.tasks = new Map();       // taskId → task
    this.records = [];            // 同步记录数组
    this._ensureDataDir();
    this._loadState();
    console.log(`[StateManager] 初始化完成: ${this.tasks.size} 个任务, ${this.records.length} 条记录`);
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  // ==================== 任务管理 ====================

  createTask(taskData) {
    const taskId = uuidv4();
    const task = {
      ...taskData,
      taskId,
      status: taskData.status || 'waiting',
      results: taskData.results || {},
      createdAt: taskData.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(taskId, task);
    this._persistState();
    return task;
  }

  getTask(taskId) {
    return this.tasks.get(taskId) || null;
  }

  updateTask(taskId, updates) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    Object.assign(task, updates, { updatedAt: new Date().toISOString() });
    this.tasks.set(taskId, task);
    this._persistState();
    return task;
  }

  updateTaskResult(taskId, platform, result) {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    task.results = { ...task.results, [platform]: result };
    task.updatedAt = new Date().toISOString();
    this.tasks.set(taskId, task);
    this._persistState();
    return task;
  }

  completeTask(taskId, status, errorMessage = null) {
    return this.updateTask(taskId, {
      status,
      errorMessage,
      completedAt: new Date().toISOString(),
    });
  }

  // ==================== 同步记录 ====================

  addRecord(recordData) {
    const record = {
      ...createPublishRecord(recordData),
      recordId: uuidv4(),
    };
    this.records.push(record);
    // 只保留最近1000条记录
    if (this.records.length > 1000) {
      this.records = this.records.slice(-1000);
    }
    this._persistState();
    return record;
  }

  /**
   * 查询某商品的同步记录
   */
  getRecordsByProductId(productId) {
    return this.records
      .filter(r => r.productId === productId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  /**
   * 查询某任务的同步记录
   */
  getRecordsByTaskId(taskId) {
    return this.records
      .filter(r => r.taskId === taskId)
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  }

  // ==================== 持久化 ====================

  _persistState() {
    try {
      const data = {
        tasks: Object.fromEntries(this.tasks),
        records: this.records.slice(-1000),
        updatedAt: new Date().toISOString(),
      };
      fs.writeFileSync(TASKS_FILE, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
      console.error('[StateManager] 持久化失败:', err.message);
    }
  }

  _loadState() {
    try {
      if (fs.existsSync(TASKS_FILE)) {
        const raw = fs.readFileSync(TASKS_FILE, 'utf-8');
        const data = JSON.parse(raw);
        if (data.tasks) {
          this.tasks = new Map(Object.entries(data.tasks));
        }
        if (data.records) {
          this.records = data.records;
        }
      }
    } catch (err) {
      console.warn('[StateManager] 加载状态失败，使用空白状态:', err.message);
    }
  }

  // ==================== 统计 ====================

  getStats() {
    const tasks = [...this.tasks.values()];
    const statusCounts = {};
    for (const t of tasks) {
      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
    }
    return {
      totalTasks: tasks.length,
      totalRecords: this.records.length,
      statusCounts,
    };
  }
}

module.exports = new StateManager();
