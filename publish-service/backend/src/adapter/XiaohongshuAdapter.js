/**
 * 小红书平台适配器
 * 参考文档: https://open.xiaohongshu.com
 *
 * 字段映射规则:
 *  your-title → title (最多20字）
 *  your-images → item_images
 *  your-price → price (单位:分)
 *  your-desc → description
 *  your-specs → skus[]
 */
const BasePlatformAdapter = require('./BasePlatformAdapter');
const config = require('../config');

class XiaohongshuAdapter extends BasePlatformAdapter {
  constructor() {
    super('xiaohongshu', config.platforms.xiaohongshu);
  }

  mapProductToPlatform(product) {
    return {
      // ---------- 基础信息 ----------
      title: this._truncate(product.title, 20),
      category_id: '',                                           // 小红书类目ID
      brand_id: '',                                               // 品牌ID

      // ---------- 价格 ----------
      price: Math.round((product.price || 0) * 100),

      // ---------- 库存 ----------
      stock: product.stock || 999,
      total_stock: product.stock || 999,

      // ---------- 运费 ----------
      freight_template_id: '',                                    // 运费模板ID
      weight: product.weight || 0,

      // ---------- SKU ----------
      skus: this._buildSkus(product),

      // ---------- 商品详情 ----------
      item_imgs: [],                                              // 由上传后填入
      description: this._buildDescription(product),
      attributes: [],                                             // 商品属性
      service_info: {
        seven_day_return: 1,
      },

      // ---------- 外部ID关联 ----------
      outer_product_id: String(product.id),
    };
  }

  _buildSkus(product) {
    if (!product.specs || product.specs.length === 0) {
      return [{
        outer_sku_id: `${product.id}_default`,
        price: Math.round((product.price || 0) * 100),
        stock: product.stock || 999,
        bar_code: '',
      }];
    }

    return product.specs.map((spec, i) => ({
      outer_sku_id: `${product.id}_${i}`,
      spec_name: typeof spec === 'string' ? spec : (spec.name || `规格${i + 1}`),
      price: Math.round((spec.price || product.price || 0) * 100),
      stock: spec.stock || product.stock || 999,
      bar_code: spec.barcode || '',
    }));
  }

  _buildDescription(product) {
    const parts = [];
    if (product.sceneApplication) parts.push(`🌿 场景应用\n${product.sceneApplication}`);
    if (product.sellingPoints?.length) parts.push(`✨ 卖点\n${product.sellingPoints.join('\n')}`);
    if (product.careGuide) parts.push(`💧 养护\n${product.careGuide}`);
    if (product.afterSales) parts.push(`🛡️ 售后\n${product.afterSales}`);
    return parts.join('\n\n');
  }

  /**
   * 发布商品到小红书
   * POST /open/api/v1/item/publish
   */
  async publishProduct(product, mappedProduct, imageMap) {
    // 注入图片
    if (imageMap) {
      const imgUrls = [];
      for (const imgUrl of product.images || []) {
        const entry = imageMap.get(imgUrl);
        if (entry) imgUrls.push(entry.url || '');
      }
      mappedProduct.item_imgs = imgUrls.slice(0, 9); // 小红书最多9张
    }

    const result = await this._request('POST', '/open/api/v1/item/publish', mappedProduct);

    return {
      platformProductId: result?.data?.item_id || result?.item_id || '',
      rawResponse: result,
    };
  }

  async offlineProduct(platformProductId) {
    const result = await this._request('POST', '/open/api/v1/item/offline', {
      item_id: platformProductId,
    });
    return result?.success || result?.code === 0;
  }

  /**
   * 上传图片到小红书素材
   * POST /open/api/v1/material/uploadImg
   */
  async uploadImage(imageBuffer, fileName) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('img', imageBuffer, {
      filename: fileName || 'product.jpg',
      contentType: 'image/jpeg',
    });

    const result = await this._request('POST', '/open/api/v1/material/uploadImg', form, {
      headers: form.getHeaders(),
    });

    return {
      platformId: result?.data?.img_id || '',
      url: result?.data?.img_url || '',
    };
  }

  _truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) : str;
  }
}

module.exports = XiaohongshuAdapter;
