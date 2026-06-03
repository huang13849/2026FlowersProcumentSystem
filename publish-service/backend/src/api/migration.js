/**
 * Migration API —— 4步发布流程（修复版）
 *
 * 修复内容：
 * 1. 图片上传改用 /shop/ec/basics/img/upload（upload_type=0, resp_type=1）
 * 2. 图片URL必须是 mmecimage.cn 格式才能通过 product/add 验证
 * 3. head_imgs 至少3张，desc_info.imgs 至少1张
 * 4. damage_guarantee=1 是该类目必填项
 */
const { Router } = require('express');
let sharp;
try { sharp = require('sharp'); } catch(e) { sharp = null; }
const axios = require('axios');
const config = require('../config');
const { getAdapter } = require('../adapter');
const minioClient = require('../client/MinioImageClient');

const router = Router();

// 迁移任务状态（内存中，后续可持久化）
var migrationTasks = new Map();

/**
 * ==========================================
 * 步骤1: 鉴权 + 解析商品
 * POST /api/publish/migration/start
 * Body: { productId: "商品ID" }
 * ==========================================
 */
router.post('/start', async (req, res) => {
  try {
    var { productId } = req.body;
    if (!productId) return res.status(400).json({ error: '缺少 productId' });

    var productClient = require('../client/ProductClient');
    var product;
    try {
      product = await productClient.getProductById(productId);
    } catch (e) {
      return res.status(404).json({ error: '商品不存在: ' + e.message });
    }

    var taskId = 'MIG-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    var task = {
      taskId: taskId,
      productId: productId,
      product: product,
      step: 1,
      stepName: '解析源商品',
      status: { overall: 'step1_done', step1: 'done', step2: 'waiting', step3: 'waiting', step4: 'waiting' },
      progress: 15,
      wechatImages: [],
      errors: [],
      createdAt: new Date().toISOString(),
    };
    migrationTasks.set(taskId, task);

    return res.json({
      success: true,
      taskId: taskId,
      product: {
        id: product.id,
        title: product.title,
        images: product.images,
        allImages: collectImages(product),
        price: product.price,
        category: product.category,
        specs: product.specs,
        stock: product.stock,
      },
      step: 1,
      status: 'done',
      message: '商品解析完成',
    });
  } catch (err) {
    console.error('[Migration] start error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

function collectImages(product) {
  var urls = [];
  var fields = ['scene_images','detail_images','panorama_images','images','head_imgs','main_images','package_images','selling_point_images','care_images','comparison_images','shipping_images','after_sale_images','root_soil_images','size_ref_images'];
  for (var i = 0; i < fields.length; i++) {
    var f = product[fields[i]];
    if (f && Array.isArray(f)) {
      for (var j = 0; j < f.length; j++) {
        if (f[j] && typeof f[j] === 'string' && f[j].length > 5) urls.push(f[j]);
      }
    }
  }
  return urls;
}

/**
 * ==========================================
 * 步骤2: 上传图片到微信CDN
 * POST /api/publish/migration/upload
 * Body: { taskId }
 * 
 * 使用正确的 /shop/ec/basics/img/upload 接口
 * upload_type=0 (二进制流), resp_type=1 (返回mmecimage链接)
 * ==========================================
 */
router.post('/upload', async (req, res) => {
  try {
    var { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: '缺少 taskId' });

    var task = migrationTasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    task.step = 2;
    task.stepName = '微信资产转换';
    task.status.overall = 'step2_doing';

    var images = collectImages(task.product);
    if (!images.length) {
      task.status.step2 = 'skipped';
      task.status.overall = 'step2_skipped';
      task.progress = 40;
      return res.json({ success: true, step: 2, status: 'skipped', message: '无图片，跳过上传', wechatImages: [] });
    }

    // 获取平台适配器（使用其 uploadImage 方法）
    var adapter = getAdapter('shipinhao');
    
    var wechatImages = [];
    var failCount = 0;
    var maxImages = Math.min(images.length, 20); // 最多上传20张（head_imgs 9 + detail_imgs）

    for (var i = 0; i < maxImages; i++) {
      var imgRef = images[i];
      if (!imgRef) continue;
      
      // 跳过已经是微信CDN的图片
      if (imgRef.indexOf('mmecimage.cn') >= 0) {
        wechatImages.push(imgRef);
        continue;
      }

      try {
        // 从MinIO下载图片
        var objectName = extractObjectName(imgRef);
        if (!objectName) {
          console.warn('[Migration] 无法解析图片引用: ' + imgRef);
          failCount++;
          continue;
        }

        var buffer = await minioClient.getImageBuffer(objectName);
        
        // 如果图片超过10MB，自动压缩（微信resp_type=1限制10MB）
        if (buffer.length > 2 * 1024 * 1024 && sharp) {
          console.log('[Migration] 图片' + (i+1) + '超过2MB (' + Math.round(buffer.length/1024/1024) + 'MB)，自动压缩...');
          try {
            buffer = await sharp(buffer)
              .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
              .jpeg({ quality: 85 })
              .toBuffer();
            console.log('[Migration] 压缩后: ' + Math.round(buffer.length/1024) + 'KB');
          } catch (compressErr) {
            console.warn('[Migration] 压缩失败: ' + compressErr.message);
            failCount++;
            task.errors.push('图片' + (i+1) + '压缩失败: ' + compressErr.message);
            continue;
          }
        } else if (buffer.length > 2 * 1024 * 1024) {
          console.warn('[Migration] 图片' + (i+1) + '超过10MB且无压缩库，跳过');
          failCount++;
          task.errors.push('图片' + (i+1) + '超过2MB限制');
          continue;
        }

        // 上传到微信CDN（通过适配器的 uploadImage 方法）
        var fileName = task.productId + '_' + i + '.jpg';
        var result = await adapter.uploadImage(buffer, fileName);
        
        if (result.url) {
          wechatImages.push(result.url);
          console.log('[Migration] 图片' + (i+1) + '/' + maxImages + '上传成功: ' + result.url);
        } else {
          failCount++;
          console.warn('[Migration] 图片' + (i+1) + '上传返回空URL');
        }
      } catch (err) {
        failCount++;
        task.errors.push('图片' + (i+1) + '上传失败: ' + err.message);
        console.error('[Migration] 图片' + (i+1) + '上传失败:', err.message);
      }
    }

    task.wechatImages = wechatImages;
    task.status.step2 = wechatImages.length > 0 ? 'done' : 'failed';
    task.status.overall = task.status.step2 === 'done' ? 'step2_done' : 'step2_failed';
    task.progress = wechatImages.length > 0 ? 40 : 25;

    var detailErrors = task.errors.slice(-5).join('; ');
    return res.json({
      success: wechatImages.length > 0,
      step: 2,
      status: task.status.step2,
      total: images.length,
      uploaded: wechatImages.length,
      failed: failCount,
      wechatImages: wechatImages,
      message: '图片上传: ' + wechatImages.length + '/' + maxImages + ' 成功',
      error: !wechatImages.length ? ('所有图片上传失败: ' + detailErrors) : undefined,
      errors: task.errors.slice(-10),
    });
  } catch (err) {
    console.error('[Migration] upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 从图片引用中提取 MinIO object name
 */
function extractObjectName(imageRef) {
  if (!imageRef) return null;
  var bucket = config.minio.bucket;
  if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
    try {
      var u = new URL(imageRef);
      var path = u.pathname.replace(/^\//, '');
      // Strip bucket name from path (URL format: /bucket/object)
      // e.g. /supply-chain/products/xxx.jpg -> products/xxx.jpg
      if (path.startsWith(bucket + '/')) {
        path = path.substring(bucket.length + 1);
      }
      return path || null;
    } catch (e) {
      return null;
    }
  }
  return imageRef;
}

/**
 * ==========================================
 * 步骤3: 校验类目资质
 * POST /api/publish/migration/verify
 * Body: { taskId }
 * ==========================================
 */
router.post('/verify', async (req, res) => {
  try {
    var { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: '缺少 taskId' });

    var task = migrationTasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    task.step = 3;
    task.stepName = '校验类目资质';
    task.status.overall = 'step3_doing';

    var product = task.product;
    var category = product.category || '';
    var leafCatId = '546003';

    var adapter = getAdapter('shipinhao');
    var token = await adapter._getAccessToken();
    var allowed = false;
    var catName = '盆景/盆栽';
    var requiredAttrs = [];

    if (token) {
      try {
        var catResp = await axios({
          method: 'POST',
          url: 'https://api.weixin.qq.com/shop/ec/category/detail?access_token=' + token,
          data: { cat_id: leafCatId },
          timeout: 10000,
        });
        var catData = catResp.data;
        if (catData.errcode === 0 && catData.info) {
          catName = catData.info.name || catName;
          allowed = true;
          requiredAttrs = (catData.attr && catData.attr.product_attr_list || [])
            .filter(function(a) { return a.is_required; })
            .map(function(a) { return a.name; });
        }
      } catch (e) {
        console.warn('[Migration] category check error:', e.message);
      }
    }

    task.status.step3 = allowed ? 'done' : 'failed';
    task.status.overall = allowed ? 'step3_done' : 'step3_failed';
    task.progress = allowed ? 60 : 50;
    task.categoryInfo = { catId: leafCatId, name: catName };

    return res.json({
      success: allowed,
      step: 3,
      status: task.status.step3,
      allowed: allowed,
      category: { id: leafCatId, name: catName },
      requiredAttrs: requiredAttrs,
    });
  } catch (err) {
    console.error('[Migration] verify error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * ==========================================
 * 步骤4: 提交微信小店上架
 * POST /api/publish/migration/publish
 * Body: { taskId }
 * ==========================================
 */
router.post('/publish', async (req, res) => {
  try {
    var { taskId } = req.body;
    if (!taskId) return res.status(400).json({ error: '缺少 taskId' });

    var task = migrationTasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    task.step = 4;
    task.stepName = '提交小店上架';
    task.status.overall = 'step4_doing';
    task.progress = 75;

    var product = task.product;
    var wechatImages = task.wechatImages || [];
    var leafCatId = '546003';

    // 使用适配器构建完整 payload
    var adapter = getAdapter('shipinhao');
    var mappedProduct = adapter.mapProductToPlatform(product);

    // 填入微信CDN图片
    // head_imgs 至少3张
    var headImgs = wechatImages.slice(0, 9);
    while (headImgs.length < 3 && headImgs.length > 0) {
      headImgs.push(headImgs[headImgs.length % headImgs.length]);
    }
    mappedProduct.head_imgs = headImgs;

    // desc_info.imgs 至少1张
    var descImgs = wechatImages.slice(0, 20);
    if (descImgs.length === 0 && headImgs.length > 0) {
      descImgs = [headImgs[0]];
    }
    mappedProduct.desc_info.imgs = descImgs;

    // 调微信API
    var productId = '';
    var success = false;
    var errorMsg = '';

    try {
      var result = await adapter.publishProduct(product, mappedProduct, null);
      productId = result.platformProductId;
      success = !!productId;
      if (!success) errorMsg = '返回商品ID为空';
    } catch (e) {
      errorMsg = e.message;
      success = false;
    }

    task.status.step4 = success ? 'done' : 'failed';
    task.status.overall = success ? 'completed' : 'step4_failed';
    task.progress = success ? 100 : 75;
    task.productId = productId || '';
    task.completedAt = success ? new Date().toISOString() : null;

    return res.json({
      success: success,
      step: 4,
      status: task.status.step4,
      productId: productId,
      error: errorMsg || undefined,
      message: success ? '🎉 商品已成功提交到微信小店' : '上架失败: ' + errorMsg,
    });
  } catch (err) {
    console.error('[Migration] publish error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 获取已铺货/正在铺货的商品列表
 * GET /api/publish/migration/list
 */
router.get('/list', (req, res) => {
  var tasks = [];
  migrationTasks.forEach(function(t) {
    tasks.push({
      taskId: t.taskId,
      productId: t.productId,
      productTitle: t.product ? t.product.title : '',
      step: t.step,
      stepName: t.stepName,
      status: t.status,
      progress: t.progress,
      errors: t.errors,
      createdAt: t.createdAt,
      completedAt: t.completedAt,
    });
  });
  tasks.sort(function(a, b) { return b.createdAt.localeCompare(a.createdAt); });
  return res.json({ total: tasks.length, tasks: tasks });
});

/**
 * 查询单个迁移任务状态
 * GET /api/publish/migration/status/:taskId
 */
router.get('/status/:taskId', (req, res) => {
  var task = migrationTasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: '任务不存在' });
  return res.json({
    taskId: task.taskId,
    productId: task.productId,
    productTitle: task.product ? task.product.title : '',
    step: task.step,
    stepName: task.stepName,
    status: task.status,
    progress: task.progress,
    wechatImagesCount: (task.wechatImages || []).length,
    errors: task.errors,
    createdAt: task.createdAt,
    completedAt: task.completedAt,
  });
});

module.exports = router;
