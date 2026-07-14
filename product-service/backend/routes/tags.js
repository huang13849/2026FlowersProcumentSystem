import express from 'express';
import Tag from '../models/Tag.js';
import Product from '../models/Product.js';

const router = express.Router();

// GET /api/tags — 列出所有自定义标签
router.get('/', async (req, res) => {
  try {
    const tags = await Tag.find({}).sort({ usageCount: -1, createdAt: -1 }).lean();
    // usageCount 实时校准（可选，量少直接算）
    for (const t of tags) {
      t.usageCount = await Product.countDocuments({ sceneTags: t.name });
    }
    res.json({ tags });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/tags — 新增
router.post('/', async (req, res) => {
  try {
    const { name, color = '', bg = '', border = '' } = req.body || {};
    const clean = String(name || '').trim();
    if (!clean) return res.status(400).json({ error: 'name required' });
    const doc = await Tag.findOneAndUpdate(
      { name: clean },
      { $setOnInsert: { name: clean, color, bg, border, createdAt: new Date() } },
      { new: true, upsert: true }
    );
    res.status(201).json({ tag: doc });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/tags/:name — 删除并从所有商品剥离该标签
router.delete('/:name', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const result = await Product.updateMany({ sceneTags: name }, { $pull: { sceneTags: name } });
    await Tag.deleteOne({ name });
    res.json({ ok: true, detachedFromProducts: result.modifiedCount || 0 });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/tags/:name/count — 单个标签使用数
router.get('/:name/count', async (req, res) => {
  try {
    const name = decodeURIComponent(req.params.name);
    const count = await Product.countDocuments({ sceneTags: name });
    res.json({ name, count });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
