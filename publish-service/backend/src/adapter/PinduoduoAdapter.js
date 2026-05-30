/**
 * 拼多多平台适配器
 * 参考文档: https://open.pinduoduo.com
 *
 * 字段映射规则:
 *  your-title → goods_name
 *  your-images → carousel_gallery
 *  your-price → goods_price
 *  your-specs → sku_list
 */
const BasePlatformAdapter = require('./BasePlatformAdapter');
const config = require('../config');

class PinduoduoAdapter extends BasePlatformAdapter {
  constructor() {
    super('pinduoduo', config.platforms.pinduoduo);
  }

  mapProductToPlatform(product) {
    return {
      goods_name: this._truncate(product.title, 60),
      goods_type: 1,                                               // 普通商品
      goods_desc: this._buildDescription(product),
      market_price: Math.round(product.marketPrice * 100) || 0,
      goods_price: Math.round(product.price * 100),
      out_goods_id: String(product.id),
      quantity: product.stock || 999,
      weight: product.weight || 0,
      delivery: {
        delivery_type: 1,                                          // 快递
        delivery_template_id: '',
      },
      carousel_gallery: [],                                        // 上传后填入
      sku_list: this._buildSkus(product),
      cat_id: '',                                                  // 拼多多类目ID
      service_guarantee: [
        { id: 1 },                                                // 7天无理由
      ],
    };
  }

  _buildSkus(product) {
    if (!product.specs || product.specs.length === 0) {
      return [{
        spec: { 颜色: '默认' },
        thumb_url: product.images?.[0] || '',
        out_sku_id: `${product.id}_default`,
        sku_price: Math.round((product.price || 0) * 100),
        sku_quantity: product.stock || 999,
      }];
    }

    return product.specs.map((spec, i) => ({
      spec: {
        规格: typeof spec === 'string' ? spec : (spec.name || `规格${i + 1}`),
      },
      thumb_url: spec.pic || product.images?.[0] || '',
      out_sku_id: `${product.id}_${i}`,
      sku_price: Math.round((spec.price || product.price || 0) * 100),
      sku_quantity: spec.stock || product.stock || 999,
    }));
  }

  _buildDescription(product) {
    const parts = [];
    if (product.sceneApplication) parts.push(`【场景】${product.sceneApplication}`);
    if (product.sellingPoints?.length) parts.push(`【卖点】${product.sellingPoints.join('；')}`);
    if (product.description) parts.push(`【详情】${product.description}`);
    if (product.careGuide) parts.push(`【养护】${product.careGuide}`);
    if (product.afterSales) parts.push(`【售后】${product.afterSales}`);
    return parts.join('\n');
  }

  /**
   * 发布商品到拼多多
   * POST /api/router pdd.goods.add
   */
  async publishProduct(product, mappedProduct, imageMap) {
    if (imageMap && product.images?.length) {
      const urls = product.images
        .map(img => imageMap.get(img))
        .filter(Boolean)
        .map(e => e.url);
      mappedProduct.carousel_gallery = urls.slice(0, 10);
    }

    const body = {
      type: 'pdd.goods.add',
      ...mappedProduct,
    };

    const result = await this._request('POST', '', body);

    return {
      platformProductId: result?.goods_add_response?.goods_id || '',
      rawResponse: result,
    };
  }

  async offlineProduct(platformProductId) {
    const body = {
      type: 'pdd.goods.sale.status.set',
      goods_id: platformProductId,
      is_onsale: 0,
    };
    const result = await this._request('POST', '', body);
    return !!result?.goods_sale_status_set_response;
  }

  /**
   * 上传图片到拼多多
   * POST /api/router pdd.goods.image.upload
   */
  async uploadImage(imageBuffer, fileName) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('type', 'pdd.goods.image.upload');
    form.append('file', imageBuffer, {
      filename: fileName || 'product.jpg',
      contentType: 'image/jpeg',
    });

    const result = await this._request('POST', '', form, {
      headers: form.getHeaders(),
    });

    return {
      platformId: '', // PDD uses URLs directly
      url: result?.goods_image_upload_response?.image_url || '',
    };
  }

  _truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) : str;
  }
}

module.exports = PinduoduoAdapter;
