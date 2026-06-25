import { Router } from "express";
import mongoose from "mongoose";
import Product from "../models/Product.js";
import { exportToCSV, exportToExcel } from "../services/exporter.js";

const router = Router();

/**
 * Build a MongoDB query from the same filter params that the frontend uses.
 * Supports: ids, search, category, isListed, sellerName, supplier_id,
 *           priceMin, priceMax, stockMin, stockMax
 */
function buildQuery(req) {
  const { ids, search, category, isListed, sellerName, supplier_id,
          priceMin, priceMax, stockMin, stockMax } = req.query;
  const query = {};

  if (ids) {
    // Filter out invalid ObjectId strings (e.g. _new_ prefixed rows)
    const validIds = ids.split(",").filter(id => mongoose.Types.ObjectId.isValid(id));
    if (validIds.length > 0) query._id = { $in: validIds };
    else query._id = null; // force empty result if no valid IDs
  }
  if (search) query.title = { $regex: search, $options: "i" };
  if (category) query.category = category;
  if (isListed !== undefined && isListed !== "") query.isListed = isListed === "true";
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

router.get("/csv", async (req, res) => {
  try {
    const query = buildQuery(req);
    const products = await Product.find(query).sort("-updatedAt").lean();
    const csv = exportToCSV(products);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=products.csv");
    res.send(csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get("/excel", async (req, res) => {
  try {
    const query = buildQuery(req);
    const requestedMode = String(req.query.mode || "simple");
    const mode = ["simple", "full", "withImages"].includes(requestedMode) ? requestedMode : "simple";
    const defaultLimit = mode === "withImages" ? 30 : 5000;
    const maxLimit = mode === "withImages" ? 200 : 20000;
    const limit = Math.min(parseInt(req.query.limit) || defaultLimit, maxLimit);
    const products = await Product.find(query).sort("-updatedAt").limit(limit).lean();
    const buffer = await exportToExcel(products, { mode });
    const filename = mode === "full" ? "products_full.xlsx" : (mode === "withImages" ? "products_with_images.xlsx" : "products_simple.xlsx");
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.send(buffer);
  } catch (err) {
    console.error("Export Excel error:", err);
    res.status(500).json({ error: err.message });
  }
});


/**
 * GET /api/export/count-files
 * 统计 MinIO 各目录文件数量（供 dashboard 显示图床文件数）
 */
router.get('/count-files', async (req, res) => {
  try {
    const { listFiles } = await import('../services/minio.js');
    const folders = ['products', 'contract', 'license', 'shops', 'dispatch'];
    const counts = {};
    let total = 0;
    for (const folder of folders) {
      try {
        const files = await listFiles(folder);
        counts[folder] = files.length;
        total += files.length;
      } catch (err) {
        counts[folder] = 0;
      }
    }
    res.json({ total, folders: counts });
  } catch (err) {
    console.error('count-files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});


export default router;

/**
 * GET /api/export/count-files
 * 统计 MinIO 各目录文件数量（供 dashboard 显示图床文件数）
 * 不需要 auth
 */
router.get('/count-files', async (req, res) => {
  try {
    const { listFiles } = await import('../services/minio.js');
    const folders = ['products', 'contract', 'license', 'shops', 'dispatch'];
    const counts = {};
    let total = 0;

    for (const folder of folders) {
      try {
        const files = await listFiles(folder);
        counts[folder] = files.length;
        total += files.length;
      } catch (err) {
        counts[folder] = 0;
        console.warn('count-files error for', folder, err.message);
      }
    }

    res.json({ total, folders: counts });
  } catch (err) {
    console.error('count-files error:', err.message);
    res.status(500).json({ error: err.message });
  }
});
