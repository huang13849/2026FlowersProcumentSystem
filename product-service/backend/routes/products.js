import { Router } from 'express';
import Product from '../models/Product.js';
import AuditLog from '../models/AuditLog.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(auth);

async function log(user, action, details = {}) {
  await AuditLog.create({ action, userId: user._id, username: user.username, ...details });
}

// List / Search
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category, isListed, sort = '-createdAt', supplier_id } = req.query;
    const query = {};
    if (search) query.$text = { $search: search };
    if (category) query.category = category;
    if (isListed !== undefined) query.isListed = isListed === 'true';
    if (supplier_id) query.supplier_id = supplier_id;
    const total = await Product.countDocuments(query);
    const products = await Product.find(query)
      .sort(sort).skip((page - 1) * limit).limit(Number(limit));
    res.json({ products, total, page: Number(page), totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get one
router.get('/:id', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ error: '商品不存在' });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create
router.post('/', async (req, res) => {
  try {
    const product = await Product.create(req.body);
    await log(req.user, 'create_product', { productId: product.productId, title: product.title });
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update
router.put('/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!product) return res.status(404).json({ error: '商品不存在' });
    await log(req.user, 'update_product', { productId: product.productId, title: product.title, changes: Object.keys(req.body) });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: '商品不存在' });
    await log(req.user, 'delete_product', { productId: product.productId, title: product.title });
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Batch operations
router.post('/batch', async (req, res) => {
  try {
    const { ids, action, data } = req.body;
    if (!ids?.length) return res.status(400).json({ error: '请选择商品' });
    let result;
    switch (action) {
      case 'list':
        result = await Product.updateMany({ _id: { $in: ids } }, { isListed: true });
        break;
      case 'unlist':
        result = await Product.updateMany({ _id: { $in: ids } }, { isListed: false });
        break;
      case 'update':
        result = await Product.updateMany({ _id: { $in: ids } }, data);
        break;
      case 'delete':
        result = await Product.deleteMany({ _id: { $in: ids } });
        break;
      default:
        return res.status(400).json({ error: '未知操作' });
    }
    await log(req.user, `batch_${action}`, { ids, count: result.modifiedCount || result.deletedCount });
    res.json({ message: `操作完成`, modifiedCount: result.modifiedCount, deletedCount: result.deletedCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Categories list (for filter)
router.get('/meta/categories', async (req, res) => {
  try {
    const categories = await Product.distinct('category');
    res.json(categories.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// Sellers list (for filter)
router.get('/meta/sellers', async (req, res) => {
  try {
    const sellers = await Product.distinct('sellerName');
    res.json(sellers.filter(Boolean));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
