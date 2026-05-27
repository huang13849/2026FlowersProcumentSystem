const router = require("express").Router();
const multer = require("multer");
const { uploadFile, uploadBase64, deleteFile } = require("../services/minio.js");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Single file upload (multipart)
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请选择文件" });
    const type = req.body.type || "shops";
    const result = await uploadFile({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
      folder: type,
    });
    res.json({ name: req.file.originalname, url: result.url, key: result.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload base64 image (from clipboard paste)
router.post("/base64", async (req, res) => {
  try {
    const { base64, name, folder } = req.body;
    if (!base64) return res.status(400).json({ error: "缺少base64数据" });
    const filename = name || `paste-${Date.now()}.png`;
    const result = await uploadBase64({ base64, filename, folder: folder || "shops" });
    res.json({ name: filename, url: result.url, key: result.key });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete file
router.delete("/", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: "缺少url" });
    await deleteFile(url);
    res.json({ message: "已删除" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;