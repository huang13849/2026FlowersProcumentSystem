import { Router } from 'express';
import Product from '../models/Product.js';
import { exportToCSV, exportToExcel } from '../services/exporter.js';
import { auth } from '../middleware/auth.js';

const router = Router();
router.use(auth);

/**
 * Build a MongoDB query from the same filter params that the frontend uses.
 * Supports: ids, search, category, isListed, sellerName, supplier_id,
 *           priceMin, priceMax, stockMin, stockMax
 */
function buildQuery(req) {
  const { ids, search, category, isListed, sellerName, supplier_id,
          priceMin, priceMax, stockMin, stockMax } = req.query;
  const query = {};

  if (ids) query._id = { $in: ids.split(',') };
  if (search) query.title = { $regex: search, $options: 'i' };
  if (category) query.category = category;
  if (isListed !== undefined && isListed !== '') query.isListed = isListed === 'true';
  if (sellerName) query.sellerName = sellerName;
  if (supplier_id) query.supplier_id = supplier_id;

  // Price range
  if (priceMin || priceMax) {
    query.sellPrice = {};
    if (priceMin) query.sellPrice.$gte = Number(priceMin);
    if (priceMax) query.sellPrice.$lte = Number(priceMax);
  }
  // Stock range
  if (stockMin || stockMax) {
    query.stock = {};
    if (stockMin) query.stock.$gte = Number(stockMin);
    if (stockMax) query.stock.$lte = Number(stockMax);
  }

  return query;
}

router.get('/csv', async (req, res) => {
  try {
    const query = buildQuery(req);
    const products = await Product.find(query).sort('-updatedAt').lean();
    const csv = exportToCSV(products);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/excel', async (req, res) => {
  try {
    const query = buildQuery(req);
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const products = await Product.find(query).sort('-updatedAt').limit(limit).lean();
    const buffer = await exportToExcel(products);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
    res.send(buffer);
  } catch (err) {
    console.error('Export Excel error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
