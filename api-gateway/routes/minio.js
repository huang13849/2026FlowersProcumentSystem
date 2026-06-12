/**
 * API Gateway - MinIO 文件存储路由
 * 统一文件上传/下载/删除/列表/预签名接口
 * 供 product-service / supplier-service / publish-service 统一调用
 */
const express = require('express');
const router = express.Router();
const multer = require('multer');
const { getMinioClient, getMinioBucket, getMinioPublicUrl } = require('../services/connections');

// Multer 内存存储（文件不上磁盘，直接进 MinIO）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

// ===== 上传单个文件 =====
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '请选择文件' });
    const client = getMinioClient();
    const bucket = getMinioBucket();
    const publicUrl = getMinioPublicUrl();
    const folder = req.body.folder || 'general';
    const filename = req.file.originalname;
    const key = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + filename;

    await client.putObject(bucket, key, req.file.buffer, null, {
      'Content-Type': req.file.mimetype,
    });

    const url = publicUrl + '/' + bucket + '/' + key;
    res.json({ key, url, name: filename, size: req.file.size, mimetype: req.file.mimetype });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 上传多个文件 =====
router.post('/upload-multiple', upload.array('files', 20), async (req, res) => {
  try {
    if (!req.files || !req.files.length) return res.status(400).json({ error: '请选择文件' });
    const client = getMinioClient();
    const bucket = getMinioBucket();
    const publicUrl = getMinioPublicUrl();
    const folder = req.body.folder || 'general';

    const files = [];
    for (const file of req.files) {
      const key = folder + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + file.originalname;
      await client.putObject(bucket, key, file.buffer, null, {
        'Content-Type': file.mimetype,
      });
      const url = publicUrl + '/' + bucket + '/' + key;
      files.push({ key, url, name: file.originalname, size: file.size });
    }
    res.json({ files, count: files.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 删除文件 =====
router.delete('/delete', async (req, res) => {
  try {
    const { url, key } = req.body;
    const client = getMinioClient();
    const bucket = getMinioBucket();
    // 支持 key 或 url 方式
    let objectKey = key;
    if (!objectKey && url) {
      const parts = url.split('/' + bucket + '/');
      objectKey = parts[1];
    }
    if (!objectKey) return res.status(400).json({ error: '缺少 key 或 url' });
    await client.removeObject(bucket, objectKey);
    res.json({ deleted: true, key: objectKey });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 列出文件 =====
router.get('/list', async (req, res) => {
  try {
    const client = getMinioClient();
    const bucket = getMinioBucket();
    const publicUrl = getMinioPublicUrl();
    const prefix = req.query.prefix || '';
    const objects = [];
    const stream = client.listObjects(bucket, prefix, true);
    stream.on('data', obj => objects.push({
      key: obj.name,
      size: obj.size,
      lastModified: obj.lastModified,
      url: publicUrl + '/' + bucket + '/' + obj.name,
    }));
    stream.on('end', () => res.json({ files: objects, count: objects.length }));
    stream.on('error', err => res.status(500).json({ error: err.message }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 获取预签名 URL =====
router.get('/presigned', async (req, res) => {
  try {
    const client = getMinioClient();
    const bucket = getMinioBucket();
    const { key, expires = 3600 } = req.query;
    if (!key) return res.status(400).json({ error: '缺少 key 参数' });
    const presignedUrl = await client.presignedGetObject(bucket, key, parseInt(expires));
    res.json({ url: presignedUrl, expiresIn: parseInt(expires) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===== 检查 bucket 状态 =====
router.get('/status', async (req, res) => {
  try {
    const client = getMinioClient();
    const bucket = getMinioBucket();
    const exists = await client.bucketExists(bucket);
    res.json({ bucket, exists, publicUrl: getMinioPublicUrl() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
