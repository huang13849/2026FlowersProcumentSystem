/**
 * API Gateway - MongoDB 路由
 * 统一 CRUD 接口，支持任意 collection 的增删改查
 * 自动适配 Replica Set 读写分离
 */
const express = require('express');
const router = express.Router();
const { getMongoDb } = require('../services/connections');

// ===== 列出所有集合 =====
router.get('/collections', async (req, res) => {
  try {
    const db = getMongoDb();
    const collections = await db.listCollections().toArray();
    const stats = [];
    for (const col of collections) {
      const count = await db.collection(col.name).estimatedDocumentCount();
      stats.push({ name: col.name, type: col.type, documentCount: count });
    }
    res.json({ database: db.databaseName, collections: stats });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 查询文档（支持过滤/分页/排序/字段选择） =====
router.get('/:collection', async (req, res) => {
  try {
    const db = getMongoDb();
    const { collection } = req.params;
    const {
      filter = '{}',
      sort = '{}',
      fields,
      page = 1,
      limit = 50,
      countOnly,
    } = req.query;

    const query = JSON.parse(filter);
    const sortObj = JSON.parse(sort);
    const projection = fields ? fields.split(',').reduce((p, f) => ({ ...p, [f.trim()]: 1 }), {}) : {};
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const col = db.collection(collection);
    let cursor = col.find(query, Object.keys(projection).length > 0 ? { projection } : {});

    if (Object.keys(sortObj).length > 0) cursor = cursor.sort(sortObj);

    const total = await col.countDocuments(query);

    if (countOnly === 'true') {
      return res.json({ collection, total });
    }

    const documents = await cursor.skip(skip).limit(parseInt(limit)).toArray();
    res.json({
      collection,
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      pages: Math.ceil(total / parseInt(limit)),
      data: documents,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 查询单个文档 =====
router.get('/:collection/:id', async (req, res) => {
  try {
    const db = getMongoDb();
    const { collection, id } = req.params;
    const mongoose = require('mongoose');
    const doc = await db.collection(collection).findOne({
      _id: mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id,
    });
    if (!doc) return res.status(404).json({ error: '文档不存在' });
    res.json({ collection, data: doc });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 创建文档 =====
router.post('/:collection', async (req, res) => {
  try {
    const db = getMongoDb();
    const { collection } = req.params;
    const data = req.body;
    // 自动添加时间戳
    data.createdAt = new Date();
    data.updatedAt = new Date();

    const result = await db.collection(collection).insertOne(data);
    res.status(201).json({
      collection,
      insertedId: result.insertedId,
      data: { _id: result.insertedId, ...data },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 批量创建 =====
router.post('/:collection/bulk', async (req, res) => {
  try {
    const db = getMongoDb();
    const { collection } = req.params;
    const docs = req.body;
    if (!Array.isArray(docs)) return res.status(400).json({ error: '需要数组格式' });

    const now = new Date();
    docs.forEach(d => { d.createdAt = now; d.updatedAt = now; });

    const result = await db.collection(collection).insertMany(docs);
    res.status(201).json({
      collection,
      insertedCount: result.insertedCount,
      insertedIds: result.insertedIds,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 更新文档 =====
router.put('/:collection/:id', async (req, res) => {
  try {
    const db = getMongoDb();
    const { collection, id } = req.params;
    const mongoose = require('mongoose');
    const updateData = { ...req.body, updatedAt: new Date() };
    delete updateData._id; // 不能更新 _id

    const filter = {
      _id: mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id,
    };
    const result = await db.collection(collection).findOneAndUpdate(
      filter,
      { $set: updateData },
      { returnDocument: 'after' }
    );

    if (!result) return res.status(404).json({ error: '文档不存在' });
    res.json({ collection, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 删除文档 =====
router.delete('/:collection/:id', async (req, res) => {
  try {
    const db = getMongoDb();
    const { collection, id } = req.params;
    const mongoose = require('mongoose');
    const filter = {
      _id: mongoose.Types.ObjectId.isValid(id) ? new mongoose.Types.ObjectId(id) : id,
    };
    const result = await db.collection(collection).findOneAndDelete(filter);
    if (!result) return res.status(404).json({ error: '文档不存在' });
    res.json({ collection, deleted: true, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ===== 聚合查询 =====
router.post('/:collection/aggregate', async (req, res) => {
  try {
    const db = getMongoDb();
    const { collection } = req.params;
    const pipeline = req.body;
    if (!Array.isArray(pipeline)) return res.status(400).json({ error: 'pipeline 必须是数组' });

    const results = await db.collection(collection).aggregate(pipeline).toArray();
    res.json({ collection, count: results.length, data: results });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
