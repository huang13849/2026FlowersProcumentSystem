import { Router } from 'express';
import Product from '../models/Product.js';
import AuditLog from '../models/AuditLog.js';
import { uploadFile as minioUpload, deleteFile as minioDelete } from "../services/minio.js";

const router = Router();

// Auth middleware removed - no login required

async function log(action, details = {}) {
  try {
    await AuditLog.create({ action, username: 'admin', ...details });
  } catch (e) { console.warn('Audit log failed:', e.message); }
}

// List / Search
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50, search, category, isListed, sellerName, sort = '-createdAt', supplier_id } = req.query;
    const query = {};
    if (search) query.$text = { $search: search };
    if (category) query.category = category;
    if (isListed !== undefined) query.isListed = isListed === 'true';
    if (sellerName) query.sellerName = sellerName;
    if (supplier_id) query.supplier_id = supplier_id;
    if (req.query.tradeType) query.tradeType = { $in: req.query.tradeType.split(",") };
    if (req.query.inStock === 'true') query.stock = { $gt: 0 };
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
    await log('create_product', { productId: product.productId, title: product.title });
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
    await log('update_product', { productId: product.productId, title: product.title, changes: Object.keys(req.body) });
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete
router.delete('/:id', async (req, res) => {
  try {
    const product = await Product.findByIdAndDelete(req.params.id);
    if (!product) return res.status(404).json({ error: '商品不存在' });
    await log('delete_product', { productId: product.productId, title: product.title });
    res.json({ message: '已删除' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Copy product (deep copy including MinIO images) ──
router.post('/:id/copy', async (req, res) => {
  try {
    const original = await Product.findById(req.params.id);
    if (!original) return res.status(404).json({ error: '商品不存在' });

    const imgFields = [
      'panorama_images', 'package_images', 'detail_images', 'root_soil_images',
      'size_ref_images', 'scene_images', 'selling_point_images', 'care_images',
      'comparison_images', 'shipping_images', 'after_sale_images', 'images',
    ];

    const copyUrls = async (urls) => {
      if (!urls?.length) return [];
      const newUrls = [];
      for (const url of urls) {
        try {
          const resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
          if (!resp.ok) continue;
          const buffer = Buffer.from(await resp.arrayBuffer());
          const filename = url.split('/').pop() || 'copy.jpg';
          const result = await minioUpload({
            buffer,
            filename: 'copy-' + filename,
            mimetype: resp.headers.get('content-type') || 'image/jpeg',
            folder: 'products',
          });
          newUrls.push(result.url);
        } catch (e) {
          console.warn('复制图片失败:', url, e.message);
        }
      }
      return newUrls;
    };

    const copyData = {};
    const skipFields = ['_id', '__v', 'createdAt', 'updatedAt', 'productId', 'salesVolume', ...imgFields];
    for (const key of Object.keys(original.toObject())) {
      if (!skipFields.includes(key)) copyData[key] = original[key];
    }

    for (const field of imgFields) {
      if (original[field]?.length) {
        copyData[field] = await copyUrls(original[field]);
      }
    }

    copyData.title = original.title + ' (副本)';
    if (copyData.title.length > 100) copyData.title = copyData.title.slice(0, 97) + '...';
    copyData.isListed = false;

    const product = await Product.create(copyData);
    await log('copy_product', { originalId: original._id.toString(), newId: product._id.toString(), title: product.title });
    res.status(201).json(product);
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
        const toDelete = await Product.find({ _id: { $in: ids } }).lean();
        result = await Product.deleteMany({ _id: { $in: ids } });
        for (const p of toDelete) {
          const allUrls = new Set();
          const imgFields = ['panorama_images','package_images','detail_images','root_soil_images','size_ref_images','scene_images','selling_point_images','care_images','comparison_images','shipping_images','after_sale_images','images'];
          for (const f of imgFields) {
            if (p[f]) p[f].forEach(u => allUrls.add(u));
          }
          for (const url of allUrls) {
            minioDelete(url).catch(e => console.warn('MinIO cleanup failed:', url, e.message));
          }
        }
        break;
      default:
        return res.status(400).json({ error: '未知操作' });
    }
    await log(`batch_${action}`, { ids, count: result.modifiedCount || result.deletedCount });
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

