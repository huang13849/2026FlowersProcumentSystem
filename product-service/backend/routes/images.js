import { Router } from "express";
import multer from "multer";
import sharp from "sharp";
import Product from "../models/Product.js";
import { uploadFile } from "../services/minio.js";
import { deleteIfUnreferenced } from "../services/productMedia.js";

const router = Router();

const TEN_MB = 10 * 1024 * 1024;
const TWO_MB = 2 * 1024 * 1024;
const IMAGE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE_UPLOAD_MAX_BYTES },
  fileFilter: (r, f, cb) => {
    if (!f.mimetype.startsWith("image/")) return cb(new Error("仅支持图片"));
    cb(null, true);
  },
});

const videoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TEN_MB },
  fileFilter: (r, f, cb) => {
    if (!f.mimetype.startsWith("video/")) return cb(new Error("仅支持视频文件"));
    cb(null, true);
  },
});

async function optimizeImageForMinio(file) {
  if (!file) return null;

  const original = {
    buffer: file.buffer,
    filename: file.originalname,
    mimetype: file.mimetype,
    compressed: false,
    originalSize: file.size || file.buffer.length,
    finalSize: file.buffer.length,
  };

  if (!file.mimetype || !file.mimetype.startsWith("image/")) return original;
  if (file.buffer.length <= TWO_MB) return original;

  const baseName = (file.originalname || "image").replace(/\.[^.]+$/, "");
  const attempts = [];

  for (const width of [2400, 2000, 1600, 1280, 1024, 800]) {
    for (const quality of [88, 82, 76, 70, 64, 58, 52, 46, 40]) {
      attempts.push({ width, quality, format: "jpeg", ext: ".jpg", mimetype: "image/jpeg" });
    }
  }
  for (const width of [2000, 1600, 1280, 1024, 800]) {
    for (const quality of [84, 76, 68, 60, 52, 44, 36]) {
      attempts.push({ width, quality, format: "webp", ext: ".webp", mimetype: "image/webp" });
    }
  }

  let smallest = null;
  for (const a of attempts) {
    let pipeline = sharp(file.buffer)
      .rotate()
      .resize({ width: a.width, height: a.width, fit: "inside", withoutEnlargement: true });

    const buffer = a.format === "webp"
      ? await pipeline.webp({ quality: a.quality, effort: 5 }).toBuffer()
      : await pipeline.jpeg({ quality: a.quality, mozjpeg: true }).toBuffer();

    const candidate = {
      buffer,
      filename: `${baseName}${a.ext}`,
      mimetype: a.mimetype,
      compressed: true,
      originalSize: file.buffer.length,
      finalSize: buffer.length,
    };

    if (!smallest || candidate.finalSize < smallest.finalSize) smallest = candidate;
    if (candidate.finalSize <= TWO_MB) return candidate;
  }

  const finalKb = Math.round((smallest?.finalSize || file.buffer.length) / 1024);
  const err = new Error(`图片压缩后仍超过2MB：${finalKb}KB，请换更小图片或裁剪后再上传`);
  err.statusCode = 413;
  throw err;
}

function uploadImageMiddleware(handler) {
  return (req, res) => {
    upload.single("file")(req, res, async (err) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? "图片不能超过50MB，请换更小图片或裁剪后再上传" : err.message;
        return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
      }
      return handler(req, res).catch((e) => res.status(e.statusCode || 500).json({ error: e.message }));
    });
  };
}

function uploadMultipleImagesMiddleware(handler) {
  return (req, res) => {
    upload.array("files", 20)(req, res, async (err) => {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? "单张图片不能超过50MB，请换更小图片或裁剪后再上传" : err.message;
        return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
      }
      return handler(req, res).catch((e) => res.status(e.statusCode || 500).json({ error: e.message }));
    });
  };
}

// Upload image to MinIO and optionally bind to product. Images >2MB are compressed before saving.
router.post("/upload", uploadImageMiddleware(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "请选择文件" });
  const image = await optimizeImageForMinio(req.file);
  const result = await uploadFile({
    buffer: image.buffer,
    filename: image.filename,
    mimetype: image.mimetype,
    folder: "products",
  });

  if (req.body.productId) {
    await Product.findByIdAndUpdate(req.body.productId, {
      $push: { images: result.url }
    });
  }

  res.json({
    url: result.url,
    key: result.key,
    success: true,
    compressed: image.compressed,
    originalSize: image.originalSize,
    finalSize: image.finalSize,
  });
}));

// Upload one product video (<=10MB)
router.post("/upload-video", (req, res) => {
  videoUpload.single("file")(req, res, async (err) => {
    try {
      if (err) {
        const msg = err.code === "LIMIT_FILE_SIZE" ? "视频不能超过10MB，请压缩后上传" : err.message;
        return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: msg });
      }
      if (!req.file) return res.status(400).json({ error: "请选择视频文件" });
      if (req.file.size > TEN_MB) return res.status(413).json({ error: "视频不能超过10MB，请压缩后上传" });

      const result = await uploadFile({
        buffer: req.file.buffer,
        filename: req.file.originalname,
        mimetype: req.file.mimetype,
        folder: "products/videos",
      });

      if (req.body.productId) {
        await Product.findByIdAndUpdate(req.body.productId, {
          $push: { product_videos: result.url }
        });
      }
      res.json({ url: result.url, key: result.key, size: req.file.size, success: true });
    } catch (e) {
      res.status(e.statusCode || 500).json({ error: e.message });
    }
  });
});

// Upload multiple images. Each image >2MB is compressed before saving.
router.post("/upload-multiple", uploadMultipleImagesMiddleware(async (req, res) => {
  const urls = [];
  const keys = [];
  const files = [];

  for (const file of req.files || []) {
    const image = await optimizeImageForMinio(file);
    const result = await uploadFile({
      buffer: image.buffer,
      filename: image.filename,
      mimetype: image.mimetype,
      folder: "products",
    });
    urls.push(result.url);
    keys.push(result.key);
    files.push({
      url: result.url,
      key: result.key,
      compressed: image.compressed,
      originalSize: image.originalSize,
      finalSize: image.finalSize,
    });
  }

  if (req.body.productId && urls.length) {
    await Product.findByIdAndUpdate(req.body.productId, { $push: { images: { $each: urls } } });
  }
  res.json({ urls, keys, files, count: urls.length, success: true });
}));

// Get product images
router.get("/product/:productId", async (req, res) => {
  try {
    const product = await Product.findById(req.params.productId).select("images");
    if (!product) return res.status(404).json({ error: "商品不存在" });
    res.json({ images: product.images || [] });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Delete image from product
router.delete("/product/:productId", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "缺少图片URL" });
    await Product.findByIdAndUpdate(req.params.productId, { $pull: { images: imageUrl } });
    const cleanup = await deleteIfUnreferenced(imageUrl);
    res.json({ message: "图片已移除", cleanup });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// Delete image from MinIO by URL (for grid delete button)
router.delete("/by-url", async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: "缺少图片URL" });
    const cleanup = await deleteIfUnreferenced(imageUrl);
    res.json({ message: cleanup.deleted ? "图片已删除" : "图片仍被引用，保留对象", url: imageUrl, cleanup });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

export default router;
