/**
 * Migration API —— 4步发布流程（替代原一键铺货异步任务）
 *
 * POST /api/publish/migration/start   —— 鉴权+解析商品
 * POST /api/publish/migration/upload  —— 上传图片到微信CDN
 * POST /api/publish/migration/verify  —— 校验类目资质
 * POST /api/publish/migration/publish —— 提交微信小店上架
 * GET  /api/publish/migration/list    —— 获取已铺货商品列表
 */
const { Router } = require('express');
const axios = require('axios');
const config = require('../config');
const { getAdapter } = require('../adapter');

const router = Router();

// ============================================================
// token 获取（与 ShipinhaoAdapter 共享逻辑）
// ============================================================
async function getShipinhaoToken() {
  var cfg = config.platforms.shipinhao;
  if (!cfg.appKey || !cfg.appSecret) return null;
  try {
    var resp = await axios({
      method: 'POST',
      url: 'https://api.weixin.qq.com/cgi-bin/stable_token',
      data: { grant_type: 'client_credential', appid: cfg.appKey, secret: cfg.appSecret, force_refresh: false },
      timeout: 10000,
    });
    return resp.data && resp.data.access_token;
  } catch (e) {
    console.error('[Migration] token error:', e.message);
    return null;
  }
}

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

    // 从product-service获取商品
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

    var token = await getShipinhaoToken();
    if (!token) return res.status(503).json({ error: '无法获取微信access_token，请稍后重试' });

    var FormData = require('form-data');
    var minioClient = require('../client/MinioImageClient');
    var wechatImages = [];
    var failCount = 0;

    for (var i = 0; i < images.length; i++) {
      var imgRef = images[i];
      try {
        // 是否已上传到微信CDN（mmecimage.cn/ 开头的直接可用）
        if (imgRef.indexOf('mmecimage.cn') >= 0) {
          wechatImages.push(imgRef);
          continue;
        }

        // 从MinIO或URL获取图片
        var imgBuffer;
        if (imgRef.startsWith('http://') || imgRef.startsWith('https://')) {
          var urlResp = await axios({ method: 'GET', url: imgRef, responseType: 'arraybuffer', timeout: 15000 });
          imgBuffer = Buffer.from(urlResp.data);
        } else {
          imgBuffer = await minioClient.getImageBuffer(imgRef);
        }

        if (!imgBuffer) { failCount++; continue; }

        var form = new FormData();
        form.append('media', imgBuffer, { filename: 'img_' + i + '.jpg', contentType: 'image/jpeg' });

        var uploadResp = await axios({
          method: 'POST',
          url: 'https://api.weixin.qq.com/channels/ec/product/img/upload?access_token=' + token,
          data: form,
          headers: form.getHeaders(),
          timeout: 30000,
        });

        var ud = uploadResp.data;
        if (ud.errcode === 0 && ud.img_info) {
          var wxUrl = ud.img_info.temp_img_url || ud.img_info.img_url || '';
          if (wxUrl) { wechatImages.push(wxUrl); }
          else { failCount++; }
        } else {
          failCount++;
        }
      } catch (e) {
        failCount++;
        task.errors.push('图片' + (i+1) + '上传异常: ' + e.message);
      }
    }

    task.wechatImages = wechatImages;
    task.status.step2 = wechatImages.length > 0 ? 'done' : 'failed';
    task.status.overall = task.status.step2 === 'done' ? 'step2_done' : 'step2_failed';
    task.progress = wechatImages.length > 0 ? 40 : 25;

    return res.json({
      success: wechatImages.length > 0,
      step: 2,
      status: task.status.step2,
      total: images.length,
      uploaded: wechatImages.length,
      failed: failCount,
      wechatImages: wechatImages,
      message: '图片上传: ' + wechatImages.length + '/' + images.length + ' 成功',
    });
  } catch (err) {
    console.error('[Migration] upload error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

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

    // 检查类目权限（简单方式：直接调detail接口看是否能查到）
    var token = await getShipinhaoToken();
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

    // 构建微信商品payload
    var priceCents = Math.round((product.price || product.sellPrice || 0) * 100);
    var title = product.title || '';
    if (title.replace(/[\s]/g, '').length < 5) {
      title = (title + ' - 林草二十年').substring(0, 60);
    }

    var payload = {
      title: title,
      head_imgs: wechatImages.slice(0, 9),
      desc_info: {
        desc: (product.description || '') + (product.careGuide ? '\n[养护]' + product.careGuide : '') + (product.sceneApplication ? '\n[场景]' + product.sceneApplication : ''),
        imgs: wechatImages.slice(0, 20),
      },
      cats_v2: [{ cat_id: leafCatId }],
      attrs: [
        { attr_key: '冠幅', attr_value: '30CM以下' },
        { attr_key: '整体高度（含盆高和植物高度）', attr_value: '11cm-20cm' },
        { attr_key: '植物类别', attr_value: '观叶植物' },
        { attr_key: '发货苗情', attr_value: '不开花植物' },
      ],
      extra_service: { seven_day_return: 0, freight_insurance: 0, damage_guarantee: 1 },
      deliver_method: 0,
      brand_id: '2100000000',
      express_info: {},
      after_sale_info: {},
      skus: (product.specs && product.specs.length > 0)
        ? product.specs.map(function(s, i) {
            return {
              out_sku_id: product.id + '_' + i,
              sale_price: Math.round((s.price || product.price || 0) * 100) || 100,
              stock_num: s.stock || 999,
              sku_attrs: [{ attr_key: '规格', attr_value: s.value || s.name || '默认' }],
            };
          })
        : [{ out_sku_id: product.id + '_default', sale_price: priceCents || 100, stock_num: product.stock || 999 }],
      out_product_id: String(product.id),
      listing: 0,
    };

    // 调微信API
    var productId = '';
    var success = false;
    var errorMsg = '';

    try {
      var adapter = getAdapter('shipinhao');
      var result = await adapter.publishProduct(product, payload, null);
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
  // 按创建时间倒序
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
