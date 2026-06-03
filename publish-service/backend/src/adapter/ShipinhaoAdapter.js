/**
 * 视频号小店平台适配器（v4 - 修复版）
 * 
 * 修复内容：
 * 1. 图片上传改用正确的 /shop/ec/basics/img/upload 接口
 * 2. upload_type=0 (二进制流), resp_type=1 (返回mmecimage链接)
 * 3. 大图自动压缩到10MB以内
 * 4. 运费模板和售后地址从配置读取
 * 5. head_imgs 至少需要3张，不足时自动补齐
 */
const BasePlatformAdapter = require('./BasePlatformAdapter');
let sharp;
try { sharp = require('sharp'); } catch(e) { sharp = null; }
const config = require('../config');
const axios = require('axios');

// ============================================================
// 微信小店分类映射
// 类目路径: 农资园艺(一级) > 花卉绿植(二级) > 绿植盆栽(三级) > 盆景/盆栽(四级)
// 由于API超配额，暂用已知ID:
//   546003 - 盆景/盆栽 (leaf)
//   546011 - 鲜切花 (leaf)
// ============================================================
const WECHAT_CATEGORY_MAP = {
  '土': '546003',
  '营养土': '546003',
  '营养液': '546003',
  '肥料': '546003',
  '花盆': '546003',
  '盆器': '546003',
  '盆栽': '546003',
  '种子': '546003',
  '绿植': '546003',
  '园艺绿植': '546003',
  '花卉': '546011',
  '鲜花': '546011',
  '鲜切花': '546011',
  '切花': '546011',
  '水培': '546003',
  '多肉': '546003',
  '盆景': '546003',
  '植物': '546003',
  '浇灌设备': '546003',
  '通用': '546003',
};

class ShipinhaoAdapter extends BasePlatformAdapter {
  constructor() {
    super('shipinhao', config.platforms.shipinhao);
    this.appId = this.appKey;
    this._cachedToken = null;
    this._tokenExpiry = 0;
    this._imageUploadUrl = 'https://api.weixin.qq.com/shop/ec/basics/img/upload';
  }

  async _getAccessToken() {
    if (this._cachedToken && Date.now() < this._tokenExpiry - 60000) {
      return this._cachedToken;
    }
    try {
      var resp = await axios({
        method: 'POST',
        url: 'https://api.weixin.qq.com/cgi-bin/stable_token',
        data: { grant_type: 'client_credential', appid: this.appId, secret: this.appSecret, force_refresh: false },
        timeout: 10000,
      });
      var data = resp.data;
      if (data.access_token) {
        this._cachedToken = data.access_token;
        this._tokenExpiry = Date.now() + (data.expires_in || 7200) * 1000;
        console.log('[Shipinhao] access_token OK');
        return this._cachedToken;
      }
      throw new Error('get token fail: ' + JSON.stringify(data));
    } catch (err) {
      console.error('[Shipinhao] token error:', err.message);
      if (this._cachedToken) return this._cachedToken;
      throw new Error('cannot get access_token: ' + err.message);
    }
  }

  _getCatId(category) {
    if (!category) return '546003';
    var cat = String(category).trim();
    if (WECHAT_CATEGORY_MAP[cat]) return WECHAT_CATEGORY_MAP[cat];
    for (var key in WECHAT_CATEGORY_MAP) {
      if (cat.includes(key) || key.includes(cat)) return WECHAT_CATEGORY_MAP[key];
    }
    console.warn('[Shipinhao] no cat map for: "' + category + '", default 546003');
    return '546003';
  }

  /**
   * 构建默认属性 - 根据类目
   */
  _buildAttrs(catId) {
    var attrsMap = {
      '546003': [
        { attr_key: '冠幅', attr_value: '30CM以下' },
        { attr_key: '整体高度（含盆高和植物高度）', attr_value: '11cm-20cm' },
        { attr_key: '植物类别', attr_value: '观叶植物' },
        { attr_key: '发货苗情', attr_value: '不开花植物' },
      ],
      '546011': [
        { attr_key: '品种', attr_value: '混合花材' },
        { attr_key: '产地', attr_value: '云南昆明' },
        { attr_key: '植物类别', attr_value: '观叶植物' },
        { attr_key: '发货苗情', attr_value: '完全开放' },
      ],
    };
    return attrsMap[catId] || attrsMap['546003'];
  }

  mapProductToPlatform(product) {
    var catId = this._getCatId(product.category);

    // 标题最少5个有效字符
    var title = this._truncate(product.title, 60);
    if (title.replace(/[\s]/g, '').length < 5) {
      title = (title + ' - 林草二十年').substring(0, 60);
    }

    // 价格：元转分
    var priceFloat = product.price || product.sellPrice || product.salesPrice || 0;
    var priceCents = Math.round(priceFloat * 100);

    // 读取配置中的运费模板和售后地址
    var freightTemplateId = config.platforms.shipinhao.freightTemplateId || '905443892004';
    var afterSaleAddressId = config.platforms.shipinhao.afterSaleAddressId || '62961836002';

    // 构建请求体（产品图片由 publishProduct 阶段上传后填入）
    return {
      title: title,
      head_imgs: [],           // 由 publishProduct 填入上传后的mmecimage链接
      desc_info: {
        desc: this._buildDescription(product),
        imgs: [],              // 由 publishProduct 填入上传后的mmecimage链接
      },
      cats_v2: [{ cat_id: catId }],
      attrs: this._buildAttrs(catId),
      spu_code: String(product.id),
      extra_service: {
        seven_day_return: 0,
        freight_insurance: 0,
        damage_guarantee: 1,   // 该类目必须支持坏损包退
      },
      deliver_method: 0,       // 快递发货
      brand_id: '2100000000',  // 无品牌
      express_info: { template_id: freightTemplateId },
      after_sale_info: { after_sale_address_id: afterSaleAddressId },
      skus: this._buildSkus(product, priceCents),
      out_product_id: String(product.id),
      listing: 0,              // 不直接上架，先创建草稿
    };
  }

  _buildSkus(product, priceCents) {
    if (!product.specs || product.specs.length === 0) {
      return [{
        out_sku_id: product.id + '_default',
        sale_price: priceCents || 100,
        stock_num: product.stock || 999,
      }];
    }
    return product.specs.map(function(spec, i) {
      var sp = Math.round((spec.price || product.price || product.sellPrice || 0) * 100);
      return {
        out_sku_id: product.id + '_' + i,
        sale_price: sp || 100,
        stock_num: spec.stock || product.stock || 999,
        sku_attrs: [{
          attr_key: typeof spec === 'string' ? '规格' : (spec.name || '规格'),
          attr_value: typeof spec === 'string' ? spec : (spec.value || spec.name || ''),
        }],
      };
    });
  }

  _buildDescription(product) {
    var parts = [];
    if (product.sceneApplication) parts.push('[场景应用]' + product.sceneApplication);
    if (product.sellingPoints && product.sellingPoints.length) parts.push('[卖点]' + product.sellingPoints.join(';'));
    if (product.description) parts.push(product.description);
    if (product.careGuide) parts.push('[养护]' + product.careGuide);
    return parts.join('\n');
  }

  /**
   * 发布商品到视频号
   * 步骤：上传图片到微信CDN → 填写head_imgs/desc_info → API发布
   */
  async publishProduct(product, mappedProduct, imageMap) {
    // 合并图片：优先使用 mappedProduct 中已设置的图片（migration流程），其次用 imageMap（通用流程）
    var urls = [];
    if (imageMap && imageMap.size > 0) {
      imageMap.forEach(function(val, key) {
        if (val && val.url) urls.push(val.url);
      });
    }

    // head_imgs：如果mappedProduct已有图片，保留；否则用imageMap填充
    var headImgs = (mappedProduct.head_imgs && mappedProduct.head_imgs.length > 0)
      ? mappedProduct.head_imgs
      : urls.slice(0, 9);
    // 至少3张，不足时补齐
    while (headImgs.length < 3 && headImgs.length > 0) {
      headImgs.push(headImgs[headImgs.length % headImgs.length]);
    }
    mappedProduct.head_imgs = headImgs;

    // desc_info.imgs：如果已有图片，保留；否则用imageMap填充
    var descImgs = (mappedProduct.desc_info && mappedProduct.desc_info.imgs && mappedProduct.desc_info.imgs.length > 0)
      ? mappedProduct.desc_info.imgs
      : urls.slice(0, 20);
    if (descImgs.length === 0 && headImgs.length > 0) {
      descImgs = [headImgs[0]];
    }
    if (mappedProduct.desc_info) {
      mappedProduct.desc_info.imgs = descImgs;
    }

    console.log('[Shipinhao] 发布商品: head_imgs=' + mappedProduct.head_imgs.length + ', desc_imgs=' + (mappedProduct.desc_info.imgs ? mappedProduct.desc_info.imgs.length : 0));

    var result = await this._request('POST', '/product/add', mappedProduct);
    return {
      platformProductId: result && result.data && result.data.product_id ? String(result.data.product_id) : 
                         (result && result.product_id ? String(result.product_id) : ''),
      rawResponse: result,
    };
  }

  async offlineProduct(platformProductId) {
    var result = await this._request('POST', '/product/delisting', { product_id: platformProductId });
    return result && (result.errcode === 0);
  }

  /**
   * 上传图片到微信CDN
   * 使用正确的 /shop/ec/basics/img/upload 接口
   * upload_type=0: 二进制流上传
   * resp_type=1: 返回 mmecimage.cn 链接（永久有效）
   */
  async uploadImage(imageBuffer, fileName) {
    var token = await this._getAccessToken();
    var FormData = require('form-data');
    var form = new FormData();
    
    // 如果图片超过10MB（resp_type=1限制），自动压缩
    var buffer = imageBuffer;
    if (buffer.length > 2 * 1024 * 1024 && sharp) {
      console.warn('[Shipinhao] 图片 ' + fileName + ' 超过2MB (' + Math.round(buffer.length / 1024 / 1024) + 'MB)，自动压缩...');
      try {
        buffer = await sharp(imageBuffer)
          .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        console.log('[Shipinhao] 压缩后: ' + Math.round(buffer.length / 1024) + 'KB');
      } catch (compressErr) {
        console.error('[Shipinhao] 压缩失败:', compressErr.message);
        throw new Error('图片超过2MB且压缩失败: ' + Math.round(imageBuffer.length / 1024 / 1024) + 'MB');
      }
    } else if (buffer.length > 2 * 1024 * 1024) {
      throw new Error('图片超过2MB限制(无压缩库): ' + Math.round(buffer.length / 1024 / 1024) + 'MB');
    }

    // 确定content-type
    var ext = (fileName || '').toLowerCase().split('.').pop();
    var contentType = 'image/jpeg';
    if (ext === 'png') contentType = 'image/png';
    else if (ext === 'webp') contentType = 'image/webp';
    else if (ext === 'bmp') contentType = 'image/bmp';

    form.append('media', buffer, { 
      filename: fileName || 'product.jpg', 
      contentType: contentType 
    });

    var uploadUrl = this._imageUploadUrl 
      + '?access_token=' + token 
      + '&upload_type=0'   // 二进制流上传
      + '&resp_type=1'     // 返回图片链接（mmecimage.cn格式）
      + '&height=800&width=800';

    try {
      var resp = await axios({
        method: 'POST',
        url: uploadUrl,
        data: form,
        headers: form.getHeaders(),
        timeout: 30000,
      });
      var body = resp.data;
      if (body.errcode && body.errcode !== 0) {
        throw new Error('图片上传失败: errcode=' + body.errcode + ' ' + (body.errmsg || ''));
      }
      var imgUrl = body.pic_file && body.pic_file.img_url || '';
      var mediaId = body.pic_file && body.pic_file.media_id || '';
      console.log('[Shipinhao] 图片上传成功: ' + (imgUrl || mediaId));
      return {
        platformId: mediaId,
        url: imgUrl,  // mmecimage.cn/p/{appid}/{imgKey} 格式
      };
    } catch (err) {
      if (err.response) {
        console.error('[Shipinhao] 图片上传HTTP错误:', err.response.status, err.response.data);
      }
      throw err;
    }
  }

  _truncate(str, len) { return str ? (str.length > len ? str.substring(0, len) : str) : ''; }

  async _request(method, url, data, options) {
    var token = await this._getAccessToken();
    var fullUrl = this.apiBase + url + (url.indexOf('?') >= 0 ? '&' : '?') + 'access_token=' + token;

    try {
      var resp = await axios({
        method: method,
        url: fullUrl,
        data: data,
        headers: { 'Content-Type': 'application/json', ...((options && options.headers) || {}) },
        timeout: (options && options.timeout) || 30000,
        ...((options && options.axiosOptions) || {}),
      });
      var body = resp.data;
      if (body.errcode && body.errcode !== 0) {
        console.error('[Shipinhao] API err:', body.errcode, (body.errmsg || '').slice(0, 300));
        if ([40001, 40014, 42001].indexOf(body.errcode) >= 0) {
          this._cachedToken = null; this._tokenExpiry = 0;
          return await this._request(method, url, data, options);
        }
        throw new Error('WeChatShopErr: ' + (body.errmsg || JSON.stringify(body)).slice(0, 1000) + ' rid:' + (body.rid || ''));
      }
      return body;
    } catch (err) {
      if (err.message && err.message.indexOf('WeChatShopErr') >= 0) throw err;
      if (err.response) throw new Error('WXHTTP[' + err.response.status + ']: ' + JSON.stringify(err.response.data).slice(0, 300));
      throw new Error('WXReqFail: ' + err.message);
    }
  }
}

module.exports = ShipinhaoAdapter;
