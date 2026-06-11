/**
 * API Gateway - Redis 路由
 * 统一缓存/队列/会话接口
 */
const express = require('express');
const router = express.Router();
const { getRedisClient } = require('../services/connections');

// ===== 基本信息 =====
router.get('/info', async (req, res) => {
  try {
    const redis = getRedisClient();
    const info = await redis.info();
    const dbSize = await redis.dbSize();
    const memory = await redis.info('memory');
    const memMatch = memory.match(/used_memory_human:(\S+)/);

    res.json({
      dbSize,
      memoryUsed: memMatch ? memMatch[1] : 'unknown',
      role: info.match(/role:(\w+)/)?.[1] || 'unknown',
      version: info.match(/redis_version:(\S+)/)?.[1] || 'unknown',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== GET =====
router.get('/key/:key', async (req, res) => {
  try {
    const redis = getRedisClient();
    const { key } = req.params;
    const type = await redis.type(key);

    let value;
    switch (type) {
      case 'string': value = await redis.get(key); break;
      case 'hash': value = await redis.hGetAll(key); break;
      case 'list': value = await redis.lRange(key, 0, -1); break;
      case 'set': value = await redis.sMembers(key); break;
      case 'zset': value = await redis.zRange(key, 0, -1, { withScores: true }); break;
      default: value = null;
    }

    const ttl = await redis.ttl(key);
    res.json({ key, type, value, ttl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== SET =====
router.post('/key/:key', async (req, res) => {
  try {
    const redis = getRedisClient();
    const { key } = req.params;
    const { value, ttl, type = 'string', fields } = req.body;

    let result;
    if (type === 'hash' && fields) {
      result = await redis.hSet(key, fields);
    } else if (type === 'list') {
      result = await redis.rPush(key, Array.isArray(value) ? value : [value]);
    } else if (type === 'set') {
      result = await redis.sAdd(key, Array.isArray(value) ? value : [value]);
    } else {
      result = await redis.set(key, typeof value === 'object' ? JSON.stringify(value) : value);
    }

    if (ttl && ttl > 0) await redis.expire(key, ttl);

    res.json({ key, type, result, ttl: ttl || -1 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== DELETE =====
router.delete('/key/:key', async (req, res) => {
  try {
    const redis = getRedisClient();
    const result = await redis.del(req.params.key);
    res.json({ key: req.params.key, deleted: result > 0 });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== KEYS 搜索 =====
router.get('/keys/:pattern', async (req, res) => {
  try {
    const redis = getRedisClient();
    const keys = await redis.keys(req.params.pattern || '*');
    res.json({ pattern: req.params.pattern, count: keys.length, keys });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 健康检查 =====
router.get('/health', async (req, res) => {
  try {
    const redis = getRedisClient();
    const pong = await redis.ping();
    res.json({ status: pong === 'PONG' ? 'ok' : 'error', service: 'redis' });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

module.exports = router;
