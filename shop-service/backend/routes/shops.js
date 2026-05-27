const router = require('express').Router();
const { createShopModel } = require('../models/Shop');

function shopModel(req, role) {
  return req.app.locals[role];
}

// ── List all shops ──
router.get('/', async (req, res) => {
  try {
    const ShopRead = shopModel(req, 'ShopRead');
    const { search } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { shopName: { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }
    const data = await ShopRead.find(query).sort({ sortOrder: 1, updatedAt: -1 });
    res.json({ shops: data, total: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Get one shop ──
router.get('/:id', async (req, res) => {
  try {
    const ShopRead = shopModel(req, 'ShopRead');
    const shop = await ShopRead.findById(req.params.id);
    if (!shop) return res.status(404).json({ error: '店铺不存在' });
    res.json(shop);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Create shop ──
router.post('/', async (req, res) => {
  try {
    const ShopWrite = shopModel(req, 'ShopWrite');
    const body = { ...req.body };
    if (body.sortOrder === undefined) {
      const last = await ShopWrite.findOne().sort({ sortOrder: -1 }).select('sortOrder');
      body.sortOrder = (last?.sortOrder ?? 0) + 10;
    }
    const s = await ShopWrite.create(body);
    res.status(201).json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Update shop ──
router.put('/:id', async (req, res) => {
  try {
    const ShopWrite = shopModel(req, 'ShopWrite');
    const s = await ShopWrite.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!s) return res.status(404).json({ error: '店铺不存在' });
    res.json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Delete shop ──
router.delete('/:id', async (req, res) => {
  try {
    const ShopWrite = shopModel(req, 'ShopWrite');
    await ShopWrite.findByIdAndDelete(req.params.id);
    res.json({ message: '已删除' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;