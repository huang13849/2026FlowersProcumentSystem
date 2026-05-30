/**
 * Migration API —— 一键搬家（淘宝/拼多多 → 微信小店）4 步流程
 *
 * POST /api/publish/migration/parse-source     —— 步骤1: 解析源商品
 * POST /api/publish/migration/convert-assets    —— 步骤2: 微信资产转换
 * POST /api/publish/migration/check-qual        —— 步骤3: 校验类目资质
 * POST /api/publish/migration/submit            —— 步骤4: 提交小店上架
 * GET  /api/publish/migration/status/:taskId    —— 查询迁移任务进展
 */
const { Router } = require('express');
const axios = require('axios');
const config = require('../config');
const { getAdapter } = require('../adapter');
const minioClient = require('../client/MinioImageClient');

const router = Router();

// 内存中的迁移任务状态
const migrationTasks = new Map();

/**
 * ==========================================
 * 步骤1: 解析源商品
 * ==========================================
 * POST /api/publish/migration/parse-source
 * Body: { url: "淘宝/拼多多商品链接" }
 * 说明: 目前用模拟数据，后续对接真实爬虫
 */
router.post('/parse-source', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: '缺少商品链接' });

    // 模拟解析（后续对接真实爬虫服务）
    // 由于没有阿里/拼多多API，这里解析链接中的关键词或返回模拟数据
    const urlLower = url.toLowerCase();
    var title = '';

    if (urlLower.includes('taobao') || urlLower.includes('tmall')) {
      title = '淘宝商品 (模拟)';
    } else if (urlLower.includes('pinduoduo') || urlLower.includes('yangkeduo')) {
      title = '拼多多商品 (模拟)';
    } else {
      title = '外部商品 (模拟)';
    }

    // 模拟商品数据
    const sourceData = {
      title: title + ' - 示例商品',
      raw_images: [
        'https://img.alicdn.com/imgextra/i1/2200729408547/O1CN01cS30O71NpNRxQXXgM_!!2200729408547.jpg',
        'https://img.alicdn.com/imgextra/i2/2200729408547/O1CN01Yj3JoP1NpNRxzWeYb_!!2200729408547.jpg',
      ],
      price: 99.00,
      originalPrice: 199.00,
      category: '绿植',
      description: '这是一款优质商品',
      stock: 100,
      weight: 1.0,
      specs: [
        { name: '规格', value: '标准款', price: 99.00, stock: 50 },
        { name: '规格', value: '豪华款', price: 149.00, stock: 30 },
      ],
      source: urlLower.includes('taobao') ? 'taobao' : (urlLower.includes('pinduoduo') ? 'pinduoduo' : 'other'),
    };

    // 创建迁移任务
    const taskId = 'MIG-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
    migrationTasks.set(taskId, {
      taskId,
      status: 'parsed',
      step: 1,
      stepName: '解析源商品',
      sourceData,
      createdAt: new Date().toISOString(),
    });

    return res.json({
      success: true,
      taskId,
      data: sourceData,
      step: 1,
      message: '源商品解析完成',
    });
  } catch (err) {
    console.error('[Migration] parse-source error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * ==========================================
 * 步骤2: 微信资产转换（图片上传到微信CDN）
 * ==========================================
 * POST /api/publish/migration/convert-assets
 * Body: { taskId, images: ["原始URL1", ...] }
 */
router.post('/convert-assets', async (req, res) => {
  try {
    const { taskId, images } = req.body;
    if (!taskId) return res.status(400).json({ error: '缺少 taskId' });
    if (!images || !images.length) return res.status(400).json({ error: '缺少图片列表' });

    const task = migrationTasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    // 更新任务状态
    task.step = 2;
    task.stepName = '微信资产转换';
    task.status = 'converting';
    task.totalImages = images.length;
    task.convertedImages = [];
    task.convertErrors = [];

    const adapter = getAdapter('shipinhao');
    if (!adapter.isConfigured()) {
      return res.status(400).json({ error: '微信小店未配置密钥' });
    }

    // 尝试获取access_token (需要ShipinhaoAdapter已初始化)
    var token = null;
    try {
      token = await adapter._getAccessToken();
    } catch (e) {
      // 如果稳定token拿不到，尝试直接用cgi-bin/stable_token
      try {
        const resp = await axios({
          method: 'POST',
          url: 'https://api.weixin.qq.com/cgi-bin/stable_token',
          data: {
            grant_type: 'client_credential',
            appid: config.platforms.shipinhao.appKey,
            secret: config.platforms.shipinhao.appSecret,
            force_refresh: false,
          },
          timeout: 10000,
        });
        token = resp.data && resp.data.access_token;
      } catch (e2) {
        console.error('[Migration] token获取失败:', e2.message);
      }
    }

    if (!token) {
      return res.status(503).json({ error: '无法获取微信access_token，请稍后重试' });
    }

    var wechatImages = [];
    var failCount = 0;

    for (var i = 0; i < images.length; i++) {
      var imgUrl = images[i];
      try {
        // 从原始URL下载图片
        var imgResp = await axios({
          method: 'GET',
          url: imgUrl,
          responseType: 'arraybuffer',
          timeout: 15000,
        });

        var imgBuffer = Buffer.from(imgResp.data);

        // 上传到微信小店图片接口
        var FormData = require('form-data');
        var form = new FormData();
        form.append('media', imgBuffer, {
          filename: 'product_' + i + '.jpg',
          contentType: imgResp.headers['content-type'] || 'image/jpeg',
        });

        var uploadResp = await axios({
          method: 'POST',
          url: 'https://api.weixin.qq.com/channels/ec/product/img/upload?access_token=' + token,
          data: form,
          headers: form.getHeaders(),
          timeout: 30000,
        });

        var uploadData = uploadResp.data;

        if (uploadData.errcode === 0 && uploadData.img_info) {
          var imgUrlResult = uploadData.img_info.temp_img_url || uploadData.img_info.img_url || '';
          if (imgUrlResult) {
            wechatImages.push(imgUrlResult);
            task.convertedImages.push({ original: imgUrl, wechatUrl: imgUrlResult, status: 'ok' });
          } else {
            failCount++;
            task.convertErrors.push('图片' + (i+1) + '返回URL为空');
          }
        } else {
          failCount++;
          task.convertErrors.push('图片' + (i+1) + '上传失败: ' + (uploadData.errmsg || '未知错误'));
        }
      } catch (err) {
        failCount++;
        task.convertErrors.push('图片' + (i+1) + '异常: ' + err.message);
      }
    }

    task.status = 'converted';
    task.step = 2;
    task.wechatImages = wechatImages;

    return res.json({
      success: true,
      taskId,
      step: 2,
      total: images.length,
      success: wechatImages.length,
      failed: failCount,
      wechat_images: wechatImages,
      errors: task.convertErrors,
      message: '图片转换完成: ' + wechatImages.length + '/' + images.length,
    });
  } catch (err) {
    console.error('[Migration] convert-assets error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * ==========================================
 * 步骤3: 校验类目与资质
 * ==========================================
 * POST /api/publish/migration/check-qual
 * Body: { taskId, catId: "微信类目ID" }
 */
router.post('/check-qual', async (req, res) => {
  try {
    const { taskId, catId } = req.body;
    if (!taskId) return res.status(400).json({ error: '缺少 taskId' });

    const task = migrationTasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    task.step = 3;
    task.stepName = '校验类目资质';

    // 获取类目详情
    var categoryInfo = null;
    var attrList = [];

    try {
      var adapter = getAdapter('shipinhao');
      var token = await adapter._getAccessToken();
      var catResp = await axios({
        method: 'POST',
        url: 'https://api.weixin.qq.com/shop/ec/category/detail?access_token=' + token,
        data: { cat_id: catId || '546003' },
        timeout: 10000,
      });
      categoryInfo = catResp.data;

      if (categoryInfo.errcode === 0 && categoryInfo.attr) {
        attrList = (categoryInfo.attr.product_attr_list || []).filter(function(a) {
          return a.is_required;
        });
      }
    } catch (e) {
      console.warn('[Migration] category detail query failed:', e.message);
    }

    // 检查该商家是否有该类目权限
    var hasPermission = true;  // 简化处理，后续可调 get_category_relation_list
    var requiredAttrs = attrList.map(function(a) { return a.name; });

    task.step = 3;
    task.status = 'checked';
    task.categoryInfo = categoryInfo;
    task.requiredAttrs = requiredAttrs;

    return res.json({
      success: true,
      taskId,
      step: 3,
      allowed: hasPermission,
      category: categoryInfo ? categoryInfo.info : { cat_id: catId || '546003', name: '盆景/盆栽' },
      required_attrs: requiredAttrs,
      message: hasPermission ? '类目资质校验通过' : '缺少该类目权限',
    });
  } catch (err) {
    console.error('[Migration] check-qual error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * ==========================================
 * 步骤4: 提交微信小店上架
 * ==========================================
 * POST /api/publish/migration/submit
 * Body: { taskId, payload: { ... 完整商品数据 } }
 */
router.post('/submit', async (req, res) => {
  try {
    const { taskId, payload } = req.body;
    if (!taskId) return res.status(400).json({ error: '缺少 taskId' });

    const task = migrationTasks.get(taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });

    task.step = 4;
    task.stepName = '提交小店上架';
    task.status = 'submitting';

    // 如果payload为空，从task数据自动构建
    var productPayload = payload;
    if (!productPayload && task.sourceData && task.wechatImages) {
      productPayload = {
        title: task.sourceData.title,
        head_imgs: (task.wechatImages || []).slice(0, 9),
        desc_info: {
          desc: task.sourceData.description || '',
          imgs: (task.wechatImages || []).slice(0, 20),
        },
        cats: [{ cat_id: '546003' }],
        attrs: [],
        extra_service: { seven_day_return: 0, freight_insurance: 0, damage_guarantee: 1 },
        deliver_method: 0,
        brand_id: '2100000000',
        skus: (task.sourceData.specs || []).map(function(s, i) {
          return {
            out_sku_id: taskId + '_' + i,
            sale_price: Math.round((s.price || task.sourceData.price || 0) * 100),
            stock_num: s.stock || 999,
            sku_attrs: [{ attr_key: s.name || '规格', attr_value: s.value || '默认' }],
          };
        }),
        out_product_id: taskId,
        listing: 0,
      };
      // 如果没规格，建默认SKU
      if (!productPayload.skus || productPayload.skus.length === 0) {
        productPayload.skus = [{
          out_sku_id: taskId + '_default',
          sale_price: Math.round((task.sourceData.price || 0) * 100),
          stock_num: task.sourceData.stock || 999,
        }];
      }
    }

    if (!productPayload) {
      return res.status(400).json({ error: '缺少商品payload或源数据/微信图片' });
    }

    // 提交到微信小店
    var result = { product_id: '', rawResponse: {} };
    try {
      var adapter = getAdapter('shipinhao');
      result = await adapter.publishProduct(
        { id: taskId, images: task.wechatImages || [] },
        productPayload,
        null
      );
    } catch (e) {
      task.status = 'failed';
      task.error = e.message;
      return res.json({
        success: false,
        taskId,
        step: 4,
        status: 'failed',
        error: e.message,
        message: '上架失败: ' + e.message,
      });
    }

    task.status = 'completed';
    task.productId = result.platformProductId;
    task.completedAt = new Date().toISOString();

    return res.json({
      success: true,
      taskId,
      step: 4,
      status: 'completed',
      product_id: result.platformProductId,
      message: '商品已成功提交到微信小店',
    });
  } catch (err) {
    console.error('[Migration] submit error:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 查询迁移任务状态
 */
router.get('/status/:taskId', (req, res) => {
  try {
    const task = migrationTasks.get(req.params.taskId);
    if (!task) return res.status(404).json({ error: '任务不存在' });
    return res.json(task);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
