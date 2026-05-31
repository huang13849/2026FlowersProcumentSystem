/**
 * 视频号小店平台适配器（v3 - 全功能版）
 * 支持4级类目、运费模板、售后地址、图片上传
 */
const BasePlatformAdapter = require('./BasePlatformAdapter');
const config = require('../config');
const axios = require('axios');

// ============================================================
// 微信小店分类映射
// 类目路径: 农资园艺(一级) > 花卉绿植(二级) > 绿植盆栽(三级) > 盆景/盆栽(四级)
// 注意：请通过 WeChat API 查询具体 cat_id
// 类目ID示例（需替换为真实ID）:
//   L1 农资园艺 = ?
//   L2 花卉绿植 = ?
//   L3 绿植盆栽 = ?
//   L4 盆景/盆栽 = ?
// 由于API超配额，暂用已知ID:
//   546003 - 盆景/盆栽 (leaf)
// 用 cats_v2 格式支持多级类目
// ============================================================
const WECHAT_CATEGORY_MAP = {
  '土': '546003',
  '营养土': '546003',
  '营养液': '546003',
  '肥料': '546003',
  '花盆': '546003',
  '盆器': '546003',
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
  '盆栽': '546003',
  '植物': '546003',
  '浇灌设备': '546003',
  '通用': '546003',
};

/**
 * 收集产品中所有非空图片URL
 */
function collectAllImages(product) {
  var urls = [];
  var fields = ['images', 'head_imgs', 'main_images', 'panorama_images', 'package_images',
                'detail_images', 'scene_images', 'selling_point_images',
                'care_images', 'comparison_images', 'shipping_images', 'after_sale_images',
                'root_soil_images', 'size_ref_images'];
  for (var i = 0; i < fields.length; i++) {
    var f = product[fields[i]];
    if (f && Array.isArray(f)) {
      for (var j = 0; j < f.length; j++) {
        if (f[j] && typeof f[j] === 'string' && f[j].length > 5) {
          urls.push(f[j]);
        }
      }
    }
  }
  return urls;
}

class ShipinhaoAdapter extends BasePlatformAdapter {
  constructor() {
    super('shipinhao', config.platforms.shipinhao);
    this.appId = this.appKey;
    this._cachedToken = null;
    this._tokenExpiry = 0;
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
   * 构建4级类目路径
   * cats_v2 格式支持多级
   * 由于API超配额，使用单级类目（4级叶子节点）
   * TODO: 查询全量类目树获取完整4级路径ID后替换
   */
  _buildCategoryPath(catId) {
    // 使用 cats_v2 格式：1级 > 2级 > 3级 > 4级 的 cat_id 数组
    // 目前只知道叶子节点 catId，上级ID需API查询
    // 先使用单级格式，让WeChat自动补全（部分版本支持）
    return [parseInt(catId)];
  }

  /**
   * 构建默认属性
   */
  _buildAttrs(catId) {
    var attrsMap = {
      '546003': [
        { attr_key: '冠幅', attr_value: '30CM以下' },
        { attr_key: '整体高度（含盆高和植物高度）', attr_value: '11cm-20cm' },
        { attr_key: '植物类别', attr_value: '观叶植物' },
        { attr_key: '发货苗情', attr_value: '不开花植物' },
        { attr_key: '产地', attr_value: '国产' },
      ],
      '546011': [
        { attr_key: '品种', attr_value: '混合花材' },
        { attr_key: '产地', attr_value: '浙江杭州' },
      ],
    };
    return attrsMap[catId] || [];
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

    // 构建请求体（产品图片由 publishProduct 阶段上传后填入）
    return {
      title: title,
      head_imgs: [],           // 由 publishProduct 填入上传后的图片URL
      desc_info: {
        desc: this._buildDescription(product),
        imgs: [],              // 由 publishProduct 填入上传后的图片URL
      },
      cats_v2: this._buildCategoryPath(catId),
      attrs: this._buildAttrs(catId),
      spu_code: String(product.id),
      extra_service: {
        seven_day_return: 0,
        freight_insurance: 0,
        damage_guarantee: 1,
      },
      deliver_method: 0,       // 快递发货
      brand_id: "2100000000",
      express_info: { template_id: "905443892004" },
      after_sale_info: { after_sale_address_id: "62961836002" },  // 无品牌
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
   * 步骤：上传图片 → 填写head_imgs/desc_info → API发布
   */
  async publishProduct(product, mappedProduct, imageMap) {
    // 如果有图片已上传到微信CDN，填入head_imgs和desc_info.imgs
    if (imageMap && imageMap.size > 0) {
      var urls = [];
      imageMap.forEach(function(val, key) {
        if (val && val.url) urls.push(val.url);
      });
      mappedProduct.head_imgs = urls.slice(0, 9);
      if (mappedProduct.desc_info && mappedProduct.desc_info.imgs) {
        mappedProduct.desc_info.imgs = urls.slice(0, 20);
      }
    }

    var result = await this._request('POST', '/product/add', mappedProduct);
    return {
      platformProductId: result && (result.product_id || (result.data && result.data.product_id)) || '',
      rawResponse: result,
    };
  }

  async offlineProduct(platformProductId) {
    var result = await this._request('POST', '/product/listing', { product_id: platformProductId, listing_type: 2 });
    return result && (result.errcode === 0 || result.code === 0);
  }

  /**
   * 上传图片到微信CDN
   * POST /img/upload
   * 返回的url需填入head_imgs/desc_info.imgs
   */
  async uploadImage(imageBuffer, fileName) {
    var FormData = require('form-data');
    var form = new FormData();
    form.append('media', imageBuffer, { filename: fileName || 'product.jpg', contentType: 'image/jpeg' });
    var result = await this._request('POST', '/img/upload', form, { headers: form.getHeaders() });
    return {
      platformId: result && (result.img_id || result.media_id || ''),
      url: result && (result.url || result.img_url || ''),
    };
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
