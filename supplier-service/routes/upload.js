const router = require("express").Router();
const multer = require("multer");
const { uploadFile, deleteFile } = require("../services/minio.js");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// Single file upload
router.post("/", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请选择文件" });
    const type = req.body.type || "attachments";
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

// Multiple file upload
router.post("/multiple", upload.array("files", 10), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: "请选择文件" });
    const type = req.body.type || "attachments";
    const files = [];
    for (const file of req.files) {
      const result = await uploadFile({
        buffer: file.buffer,
        filename: file.originalname,
        mimetype: file.mimetype,
        folder: type,
      });
      files.push({ name: file.originalname, url: result.url, key: result.key });
    }
    res.json({ files });
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
