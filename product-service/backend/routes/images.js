import { Router } from "express";
import multer from "multer";
import Product from "../models/Product.js";
import { uploadFile, deleteFile } from "../services/minio.js";
import AuditLog from "../models/AuditLog.js";
import { auth } from "../middleware/auth.js";

const router = Router();
router.use(auth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (r, f, cb) => {
    if (!f.mimetype.startsWith("image/")) return cb(new Error("仅支持图片"));
    cb(null, true);
  },
});

// Upload image to MinIO and optionally bind to product
router.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请选择文件" });
    const result = await uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      folder: "products",
    });

    // If productId provided, bind image to product
    if (req.body.productId) {
      await Product.findByIdAndUpdate(req.body.productId, {
        $push: { images: result.url }
      });
    }
    res.json({ url: result.url, key: result.key, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload multiple images
router.post("/upload-multiple", upload.array("files", 20), async (req, res) => {
  try {
    const urls = [];
    const keys = [];
    for (const file of req.files) {
      const result = await uploadFile({
        buffer: file.buffer,
        filename: file.originalname,
        mimetype: file.mimetype,
        folder: "products",
      });
      urls.push(result.url);
      keys.push(result.key);
    }
    // Bind to product if specified
    if (req.body.productId && urls.length) {
      await Product.findByIdAndUpdate(req.body.productId, { $push: { images: { $each: urls } } });
    }
    res.json({ urls, keys, count: urls.length, success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get product images
router.get("/product/:productId", async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).select("images");
    if (!product) return res.status(404).json({ error: "商品不存在" });
    res.json({ images: product.images || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete image from product
router.delete("/product/:productId", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    await Product.findByIdAndUpdate(req.params.productId, { $pull: { images: imageUrl } });
    // Also delete from MinIO
    await deleteFile(imageUrl);
    res.json({ message: "图片已移除" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
