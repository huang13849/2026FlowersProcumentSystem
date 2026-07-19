'use strict';
/**
 * scene-service — 庭院园林·成功案例 场景图片管理微服务
 * 功能: 场景案例图片的增/查/改/删 (CRUD), 图片存 MinIO, 元数据存 MongoDB
 * 端口: 3012 (network_mode: host)
 *
 * 数据模型 (collection: scene_cases, db: supply_chain):
 *   _id, region('cn'|'global'|'all'), title, desc, tag, imageKey, imageUrl,
 *   kind('product'|'trend'), keyword, sortOrder(Number), enabled(Boolean), createdAt, updatedAt
 */
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { MongoClient, ObjectId } = require('mongodb');
const Minio = require('minio');

const PORT = parseInt(process.env.SCENE_PORT || '3012', 10);
const MONGO_URI = proces...URI || (function(){throw new Error('MONGO_URI env required')})();
const DB_NAME = process.env.SCENE_DB || 'supply_chain';
const COLL = 'scene_cases';

const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || '100.96.54.109:9000';
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'supply-chain';
const MINIO_PREFIX = process.env.MINIO_PREFIX || 'scenes';
const MINIO_PUBLIC_URL = process.env.MINIO_PUBLIC_URL || 'http://100.96.54.109:9000';

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT.split(':')[0],
  port: parseInt(MINIO_ENDPOINT.split(':')[1] || '9000', 10),
  useSSL: MINIO_ENDPOINT.startsWith('https'),
  accessKey: process.env.MINIO_ACCESS_KEY || 'minioadmin',
  secretKey: process.env.MINIO_SECRET_KEY || 'minioadmin',
});

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

let db;
async function initMongo() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  await db.collection(COLL).createIndex({ region: 1, enabled: 1, sortOrder: 1 });
  console.log('[scene-service] MongoDB connected:', DB_NAME);
}
async function ensureBucket() {
  const exists = await minioClient.bucketExists(MINIO_BUCKET).catch(() => false);
  if (!exists) await minioClient.makeBucket(MINIO_BUCKET);
  console.log('[scene-service] MinIO bucket ready:', MINIO_BUCKET);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

// 返回相对路径, 让前端按部署区域(国内苏州nginx / 国际CF Function)自行拼接 /minio
function toRelative(key) { return `/minio/${MINIO_BUCKET}/${key}`; }
function shape(doc) {
  if (!doc) return doc;
  return {
    id: String(doc._id),
    region: doc.region || 'all',
    kind: doc.kind || 'product',
    keyword: doc.keyword || '',
    title: doc.title || '',
    desc: doc.desc || '',
    tag: doc.tag || '',
    titleEn: doc.titleEn || '',
    descEn: doc.descEn || '',
    tagEn: doc.tagEn || '',
    imageKey: doc.imageKey || '',
    imageUrl: doc.imageKey ? toRelative(doc.imageKey) : (doc.imageUrl || ''),
    imageUrlAbsolute: doc.imageKey ? `${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${doc.imageKey}` : '',
    sortOrder: typeof doc.sortOrder === 'number' ? doc.sortOrder : 0,
    enabled: doc.enabled !== false,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'scene-service', time: new Date().toISOString() }));

// 列表查询: ?region=cn|global|all  &enabled=true  &limit=
app.get('/api/scenes', async (req, res) => {
  try {
    const { region, enabled, limit, kind } = req.query;
    const q = {};
    if (region && region !== 'all') q.region = { $in: [region, 'all'] };
    if (enabled === 'true') q.enabled = { $ne: false };
    if (enabled === 'false') q.enabled = false;
    if (kind) q.kind = kind;
    let cur = db.collection(COLL).find(q).sort({ sortOrder: 1, createdAt: -1 });
    if (limit) cur = cur.limit(parseInt(limit, 10));
    const docs = await cur.toArray();
    res.json({ scenes: docs.map(shape), total: docs.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 单条查询
app.get('/api/scenes/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const doc = await db.collection(COLL).findOne({ _id: new ObjectId(req.params.id) });
    if (!doc) return res.status(404).json({ error: 'not found' });
    res.json(shape(doc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 新增 (支持 multipart 上传图片 字段名 image, 或 json 传已有 imageKey)
app.post('/api/scenes', upload.single('image'), async (req, res) => {
  try {
    const b = req.body || {};
    let imageKey = b.imageKey || '';
    if (req.file) {
      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
      imageKey = `${MINIO_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await minioClient.putObject(MINIO_BUCKET, imageKey, req.file.buffer, req.file.size, {
        'Content-Type': req.file.mimetype || 'image/jpeg',
      });
    }
    const now = new Date();
    const doc = {
      region: b.region || 'all',
      kind: b.kind === 'trend' ? 'trend' : 'product',
      keyword: b.keyword || '',
      title: b.title || '',
      desc: b.desc || '',
      tag: b.tag || '',
      titleEn: b.titleEn || '',
      descEn: b.descEn || '',
      tagEn: b.tagEn || '',
      imageKey,
      imageUrl: b.imageUrl || '',
      sortOrder: b.sortOrder != null ? Number(b.sortOrder) : 0,
      enabled: b.enabled === 'false' ? false : true,
      createdAt: now,
      updatedAt: now,
    };
    const r = await db.collection(COLL).insertOne(doc);
    res.status(201).json(shape({ ...doc, _id: r.insertedId }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 修改 (可换图)
app.put('/api/scenes/:id', upload.single('image'), async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const _id = new ObjectId(req.params.id);
    const existing = await db.collection(COLL).findOne({ _id });
    if (!existing) return res.status(404).json({ error: 'not found' });
    const b = req.body || {};
    const set = { updatedAt: new Date() };
    ['region', 'title', 'desc', 'tag', 'titleEn', 'descEn', 'tagEn', 'kind', 'keyword'].forEach(k => { if (b[k] !== undefined) set[k] = b[k]; });
    if (b.sortOrder !== undefined) set.sortOrder = Number(b.sortOrder);
    if (b.enabled !== undefined) set.enabled = !(b.enabled === 'false' || b.enabled === false);
    if (req.file) {
      const ext = (req.file.originalname.split('.').pop() || 'jpg').toLowerCase();
      const newKey = `${MINIO_PREFIX}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      await minioClient.putObject(MINIO_BUCKET, newKey, req.file.buffer, req.file.size, {
        'Content-Type': req.file.mimetype || 'image/jpeg',
      });
      set.imageKey = newKey;
      if (existing.imageKey) minioClient.removeObject(MINIO_BUCKET, existing.imageKey).catch(() => {});
    } else if (b.imageKey !== undefined) {
      set.imageKey = b.imageKey;
      if (b.imageUrl !== undefined) set.imageUrl = b.imageUrl;
    } else if (b.imageUrl !== undefined) {
      set.imageUrl = b.imageUrl;
      set.imageKey = '';
    }
    await db.collection(COLL).updateOne({ _id }, { $set: set });
    const doc = await db.collection(COLL).findOne({ _id });
    res.json(shape(doc));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 删除 (连带删 MinIO 图)
app.delete('/api/scenes/:id', async (req, res) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: 'invalid id' });
    const _id = new ObjectId(req.params.id);
    const doc = await db.collection(COLL).findOne({ _id });
    if (!doc) return res.status(404).json({ error: 'not found' });
    if (doc.imageKey) minioClient.removeObject(MINIO_BUCKET, doc.imageKey).catch(() => {});
    await db.collection(COLL).deleteOne({ _id });
    res.json({ ok: true, id: req.params.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 管理页
app.use('/', express.static(__dirname + '/public'));

(async () => {
  try {
    await initMongo();
    await ensureBucket();
    app.listen(PORT, () => console.log(`[scene-service] listening on :${PORT}`));
  } catch (e) {
    console.error('[scene-service] startup failed:', e);
    process.exit(1);
  }
})();
