/**
 * API Gateway - 统一查询路由
 * 支持跨数据库联合查询（MongoDB + PostgreSQL + Redis）
 */
const express = require('express');
const router = express.Router();
const { getMongoDb, getPgPool, getRedisClient } = require('../services/connections');

// ===== 商品详情（MongoDB 商品 + PostgreSQL 价格 + Redis 缓存） =====
router.get('/product/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const mongoose = require('mongoose');
    const result = {};

    // 1. 先查 Redis 缓存
    try {
      const redis = getRedisClient();
      const cached = await redis.get(`product:${id}`);
      if (cached) {
        result.cached = true;
        result.data = JSON.parse(cached);
        return res.json(result);
      }
    } catch (e) { /* Redis 不可用不影响主流程 */ }

    // 2. MongoDB 商品信息
    try {
      const db = getMongoDb();
      const filter = mongoose.Types.ObjectId.isValid(id) ? { _id: new mongoose.Types.ObjectId(id) } : { _id: id };
      result.product = await db.collection('products').findOne(filter);
    } catch (e) { result.productError = e.message; }

    // 3. PostgreSQL 价格信息
    try {
      const pool = getPgPool();
      const { rows } = await pool.query('SELECT * FROM product_prices WHERE product_id = $1 LIMIT 1', [id]);
      result.pricing = rows[0] || null;
    } catch (e) { result.pricingError = e.message; }

    // 4. 缓存结果
    try {
      const redis = getRedisClient();
      await redis.set(`product:${id}`, JSON.stringify(result), { EX: 300 }); // 5分钟缓存
    } catch (e) { /* ignore */ }

    result.cached = false;
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 数据库概览 =====
router.get('/overview', async (req, res) => {
  try {
    const overview = {};

    // MongoDB
    try {
      const db = getMongoDb();
      const collections = await db.listCollections().toArray();
      overview.mongodb = {
        status: 'ok',
        database: db.databaseName,
        collections: await Promise.all(collections.map(async c => ({
          name: c.name,
          count: await db.collection(c.name).estimatedDocumentCount(),
        }))),
      };
    } catch (e) {
      overview.mongodb = { status: 'error', error: e.message };
    }

    // PostgreSQL
    try {
      const pool = getPgPool();
      const { rows } = await pool.query(
        "SELECT datname FROM pg_database WHERE datistemplate = false"
      );
      overview.postgres = { status: 'ok', databases: rows.map(r => r.datname) };
    } catch (e) {
      overview.postgres = { status: 'error', error: e.message };
    }

    // Redis
    try {
      const redis = getRedisClient();
      const dbSize = await redis.dbsize();
      overview.redis = { status: 'ok', keyCount: dbSize };
    } catch (e) {
      overview.redis = { status: 'error', error: e.message };
    }

    res.json(overview);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
