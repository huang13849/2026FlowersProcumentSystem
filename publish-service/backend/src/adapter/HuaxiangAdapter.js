/**
 * 花乡花木平台适配器 (admin.huaxianghuamu.cn)
 *
 * 图片映射规则（2026-06-30 v4 优化）:
 * - 商品主图 (productParameterValue0[0].imageList) ← panorama_images（主图列）
 * - 商品详情图 (imageArray) ← 其他所有图片（场景应用+包装+细节等），每张间隔 1s 上传
 *
 * 配送方式: distributionMode '0,1' = 快递发货+自提
 * 运费: expressFreight=0 表示统一运费；expressFreight=1 + template 表示运费模板模式
 */
const BasePlatformAdapter = require('./BasePlatformAdapter');
const axios = require('axios');
const FormData = require('form-data');
const sharp = require('sharp');
const config = require('../config');

// 其他图片字段（用于商品详情图）
const DETAIL_IMAGE_KEYS = [
  'scene_images', 'package_images', 'detail_images', 'root_soil_images',
  'size_ref_images', 'selling_point_images',
  'care_images', 'comparison_images', 'shipping_images', 'after_sale_images',
  'images'
];

const HUAXIANG_CATEGORY_MAP = {
  '鲜花': 9000023,
  '鲜切花': 9000023,
  '花卉': 9000023,
  '盆栽': 9000023,
  '绿植': 9000023,
  'default': 9000023,
};

class HuaxiangAdapter extends BasePlatformAdapter {
  constructor() {
    const config = require('../config');
    super('huaxiang', config.platforms.huaxiang);
    this.apiBase = config.platforms.huaxiang?.apiBase || 'https://admin.huaxianghuamu.cn';
    this.token = config.platforms.huaxiang?.token || '';
    this.cookie = config.platforms.huaxiang?.cookie || '';
    this.productCategory = config.platforms.huaxiang?.productCategory || 9000023;
    this.account = null;
    this._qiniuToken = null;
    this._qiniuTokenExpiry = 0;
    this._freightTemplateId = null;
  }

  isConfigured() {
    return Boolean(this.getToken() && this.getCookie());
  }

  setAccount(account) {
    this.account = account || null;
    this._qiniuToken = null;
    this._qiniuTokenExpiry = 0;
    this._freightTemplateId = null;
  }

  clearAccount() { this.setAccount(null); }

  getToken() { return (this.account && this.account.token) || this.token || ''; }
  getCookie() { return (this.account && this.account.cookie) || this.cookie || ''; }
  getAccountLabel() { return (this.account && (this.account.label || this.account.username)) || '默认账号'; }

  _buildHeaders(contentType = 'application/json;charset=utf-8') {
    return {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0',
      'Accept': 'application/json, text/plain, */*',
      'token': this.getToken(),
      'Content-Type': contentType,
      'Origin': this.apiBase,
      'Referer': this.apiBase + '/',
      'Cookie': this.getCookie(),
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-origin',
    };
  }

  _buildUrl(path) {
    const token = this.getToken();
    return `${this.apiBase}${path}?token=${token}&stoken=${token}`;
  }

  async _getQiniuToken() {
    if (this._qiniuToken && Date.now() < this._qiniuTokenExpiry - 60000) return this._qiniuToken;
    const url = this._buildUrl('/weidao/weidaoyun/qiniuyun/getmUploadToken.jhtml');
    const resp = await axios.get(url, { headers: this._buildHeaders(), timeout: 15000 });
    this._qiniuToken = resp.data.uptoken;
    this._qiniuTokenExpiry = Date.now() + 3600000;
    return this._qiniuToken;
  }

  _getFreightConfig() {
    const mode = (this.account && this.account.freightMode === 'template') ? 'template' : 'uniform';
    const templateId = Number(this.account && this.account.freightTemplateId) || 216;
    const uniformPostage = Math.max(0, Number(this.account && this.account.uniformPostage) || 0);
    if (mode === 'template') {
      console.log(`[Huaxiang] 运费模式: 运费模板 ${templateId}`);
      return { mode, templateId, uniformPostage: 0 };
    }
    console.log(`[Huaxiang] 运费模式: 统一运费 ${uniformPostage}`);
    return { mode, templateId, uniformPostage };
  }

  async uploadImage(imageBuffer, fileName) {
    const qiniuToken = await this._getQiniuToken();
    const key = `images/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;

    // 压缩图片（max 1200x1200, quality 80），避免大文件上传超时
    let uploadBuffer = imageBuffer;
    try {
      uploadBuffer = await sharp(imageBuffer)
        .jpeg({ quality: 80, progressive: true })
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .toBuffer();
      console.log(`[Huaxiang] 图片压缩: ${imageBuffer.length} → ${uploadBuffer.length} bytes`);
    } catch (e) {
      console.warn(`[Huaxiang] sharp 压缩失败，使用原图:`, e.message);
    }

    // 重试3次，每次90秒超时（花乡七牛上传偶发慢，避免前端误判超时）
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const formData = new FormData();
        formData.append('token', qiniuToken);
        formData.append('key', key);
        formData.append('file', uploadBuffer, { filename: fileName || 'product.jpg', contentType: 'image/jpeg' });
        const resp = await axios.post('https://up-z1.qiniup.com/', formData, {
          headers: formData.getHeaders(), timeout: 90000,
          maxContentLength: Infinity, maxBodyLength: Infinity,
        });
        if (resp.status === 200 && resp.data.key) {
          return { platformId: resp.data.key, url: `https://img.huaxianghuamu.cn/${resp.data.key}` };
        }
        throw new Error(`七牛云返回异常: ${JSON.stringify(resp.data)}`);
      } catch (err) {
        lastErr = err;
        console.warn(`[Huaxiang] 上传第${attempt}次失败: ${err.message}`);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    throw lastErr;
  }

  async uploadImages(images, intervalMs = 300) {
    const uploaded = [];
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      try {
        let buffer;
        if (img.buffer) { buffer = img.buffer; }
        else {
          const resp = await axios.get(img.url, { responseType: 'arraybuffer', timeout: 60000 });
          buffer = Buffer.from(resp.data);
        }
        const result = await this.uploadImage(buffer, `product_${i}.jpg`);
        uploaded.push(result.url);
        console.log(`[Huaxiang] 图片 ${i + 1}/${images.length} 上传成功: ${result.url}`);
      } catch (err) {
        console.error(`[Huaxiang] 图片 ${i + 1}/${images.length} 上传失败:`, err.message);
        uploaded.push(img.url);
      }
      // 图片之间间隔，避免七牛云限流，从1000ms改为300ms加速
      if (i < images.length - 1 && intervalMs > 0) {
        await new Promise(r => setTimeout(r, intervalMs));
      }
    }
    return uploaded;
  }

  _collectMainImages(product) {
    const imgs = product.panorama_images || product.main_images || [];
    return Array.isArray(imgs) ? imgs.filter(u => u && typeof u === 'string') : [];
  }

  _collectSpecImages(product) {
    const imgs = product.scene_images || [];
    const specUrls = Array.isArray(imgs) ? imgs.filter(u => u && typeof u === 'string') : [];
    return specUrls;
  }

  /**
   * 收集其他图片作为商品详情图（排除主图，去重）
   */
  _collectDetailImages(product) {
    const mainUrls = new Set(this._collectMainImages(product));
    const urls = [];
    const seen = new Set();
    for (const key of DETAIL_IMAGE_KEYS) {
      const imgs = product[key];
      if (Array.isArray(imgs)) {
        for (const url of imgs) {
          if (url && typeof url === 'string' && !mainUrls.has(url) && !seen.has(url)) {
            seen.add(url);
            urls.push(url);
          }
        }
      }
    }
    return urls;
  }

  mapProductToPlatform(product) {
    const mainImages = this._collectMainImages(product);
    const specImages = this._collectSpecImages(product);
    const category = this._mapCategory(product);

    const sku = {
      imageList: mainImages,  // 商品主图 ← panorama_images
      isList: true,
      isMarketTable: false,
      price: Number(product.sellPrice) || 0,
      cost: Number(product.costPrice) || 0,
      attribute_value19: 1,
      weight: Number(product.weight) || 0.5,
      commissionRate: 0,
      market: Number(product.ecommerceReferenceUrl) || Number(product.sellPrice) || 0,
      saleAmount: 0,
      stock: Number(product.stock) || 999,
    };

    // 收集其他图片作为商品详情图
    const detailImages = this._collectDetailImages(product);

    return {
      productType: 0,
      productName: this._cleanTitle(product.title || '未命名商品'),
      fullName: this._cleanTitle(product.title || '未命名商品'),
      productCategory: category,
      seoKeyWords: (product.sceneTags && product.sceneTags[0]) || product.category || '花卉',
      introduction: this._buildIntroduction(product),
      // 商品主图通过 productParameterValue0[0].imageList 传
      imageArray: detailImages,  // 商品详情图 ← 其他所有图片（在 publishProduct 中替换为七牛云 URL）
      storageRacks: [],
      shopList: [],
      distributionMode: '0,1',  // 快递发货+自提
      expressFreight: 1,  // 1=运费模板模式 (Number(2)-1)
      template: null,  // 运费模板ID，在 publishProduct 中设置
      freight: null,  // 兼容旧字段
      is_limitation: 0,
      isTop: false,
      isGift: false,
      deductionMT: 0,
      integralProp: 0,
      attribute_value20: '',
      attribute_value21: '',
      attribute_value22: '',
      attribute_value23: '',
      attribute_value9: '',
      parameters: [],
      newParameters: [],
      productParameterValue0: [sku],
    };
  }

  async publishProduct(product, mappedProduct, imageMap) {
    const mainImages = this._collectMainImages(product);
    const detailImages = this._collectDetailImages(product);

    console.log(`[Huaxiang] 使用账号: ${this.getAccountLabel()}`);
    console.log(`[Huaxiang] 图片分类: 主图=${mainImages.length}张, 详情图=${detailImages.length}张`);

    // 上传主图 + 详情图（去重）
    const allUrls = [...mainImages, ...detailImages];
    const seen = new Set();
    const uniqueUrls = allUrls.filter(url => { if (seen.has(url)) return false; seen.add(url); return true; });
    const imagesToUpload = uniqueUrls.map(url => ({ url }));

    console.log(`[Huaxiang] 开始上传 ${imagesToUpload.length} 张图片（间隔1s）...`);
    const uploadedUrls = await this.uploadImages(imagesToUpload, 1000);

    let uploadIdx = 0;
    const nextUrl = () => uploadedUrls[uploadIdx++] || uploadedUrls[uploadedUrls.length - 1] || '';

    const uploadedMain = mainImages.map(() => nextUrl());
    const uploadedDetail = detailImages.map(() => nextUrl());

    // 商品主图
    if (mappedProduct.productParameterValue0 && mappedProduct.productParameterValue0[0]) {
      mappedProduct.productParameterValue0[0].imageList = uploadedMain;
    }
    // 商品详情图
    mappedProduct.imageArray = uploadedDetail;

    const freight = this._getFreightConfig();
    if (freight.mode === 'template') {
      mappedProduct.expressFreight = 1;
      mappedProduct.template = freight.templateId;  // 花乡 API 字段名是 template
      mappedProduct.freight = freight.templateId;   // 兼容
      mappedProduct.uniformPostage = 0;
    } else {
      mappedProduct.expressFreight = 0;
      mappedProduct.template = null;
      mappedProduct.freight = null;
      mappedProduct.uniformPostage = freight.uniformPostage;
    }

    const url = this._buildUrl('/weidao/weidaoyun/admin/product/newSaveProduct.jhtml');
    const resp = await axios.post(url, mappedProduct, { headers: this._buildHeaders(), timeout: 60000 });

    const data = resp.data;
    if (data.code == 200 || data.code === '200') {
      const productId = data.json && data.json[0] ? data.json[0].id : null;
      console.log(`[Huaxiang] 商品发布成功! 平台商品ID: ${productId}`);
      return { platformProductId: String(productId), rawResponse: data };
    }
    throw new Error(`花乡花木发布失败: ${data.message || data.status || JSON.stringify(data)}`);
  }

  async offlineProduct(platformProductId) {
    const url = this._buildUrl('/weidao/weidaoyun/admin/product/updateSkuMarketable.jhtml');
    const resp = await axios.post(url, {
      ids: String(platformProductId),
      marketable: false
    }, { headers: this._buildHeaders(), timeout: 15000 });
    return resp.data.code == 200;
  }

  _mapCategory(product) {
    const title = (product.title || '') + (product.category || '');
    for (const [keyword, catId] of Object.entries(HUAXIANG_CATEGORY_MAP)) {
      if (keyword !== 'default' && title.includes(keyword)) return catId;
    }
    return HUAXIANG_CATEGORY_MAP.default;
  }

  _cleanTitle(title) {
    return title.replace(/・/g, '·').replace(/[🎨🌸🌺🌻🌹🌷🌼✨🎉]/g, '').trim().slice(0, 50);
  }

  _buildIntroduction(product) {
    const parts = [];
    if (product.specSize) parts.push(product.specSize);
    if (product.sceneTags && product.sceneTags.length) parts.push('场景: ' + product.sceneTags.join(', '));
    if (product.category) parts.push('分类: ' + product.category);
    if (!parts.length) parts.push(product.title || '优质花卉');
    return parts.slice(0, 3).join(' | ').slice(0, 500);
  }
}

module.exports = HuaxiangAdapter;
