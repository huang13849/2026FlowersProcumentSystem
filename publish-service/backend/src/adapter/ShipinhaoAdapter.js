/**
 * 视频号小店平台适配器
 * 参考文档: https://developers.weixin.qq.com/doc/channels/API
 *
 * 字段映射规则:
 *  your-title → title
 *  your-images → head_imgs
 *  your-price → sale_price
 *  your-specs → skus[]
 */
const BasePlatformAdapter = require('./BasePlatformAdapter');
const config = require('../config');

class ShipinhaoAdapter extends BasePlatformAdapter {
  constructor() {
    super('shipinhao', config.platforms.shipinhao);
  }

  mapProductToPlatform(product) {
    return {
      title: this._truncate(product.title, 60),
      head_imgs: [],                                               // 上传后填入，最多9张
      desc_info: {
        desc: this._buildDescription(product),
        imgs: [],
      },
      cats: [{
        cat_id: '',                                               // 视频号类目ID
      }],
      attrs: [],
      spu_code: String(product.id),
      limited_discount_info: {},
      extra_service: {
        seven_day_return: 1,
      },
      status: 0,                                                   // 草稿
      listing_time: Math.floor(Date.now() / 1000),
      listing_type: 0,
      deliver_method: 1,
      freight_info: {
        template_id: '',
      },
      // 规格合并到 SKU
      skus: this._buildSkus(product),
      out_product_id: String(product.id),
    };
  }

  _buildSkus(product) {
    if (!product.specs || product.specs.length === 0) {
      return [{
        out_sku_id: `${product.id}_default`,
        thumb_img: product.images?.[0] || '',
        sale_price: Math.round((product.price || 0) * 100),
        stock_num: product.stock || 999,
        status: 0,                                                  // SKU上架状态
      }];
    }

    return product.specs.map((spec, i) => ({
      out_sku_id: `${product.id}_${i}`,
      thumb_img: spec.pic || product.images?.[0] || '',
      sale_price: Math.round((spec.price || product.price || 0) * 100),
      market_price: Math.round((spec.marketPrice || product.marketPrice || 0) * 100),
      stock_num: spec.stock || product.stock || 999,
      status: 0,
      sku_attrs: [{
        attr_key: typeof spec === 'string' ? '规格' : (spec.name || '规格'),
        attr_value: typeof spec === 'string' ? spec : (spec.value || spec.name || ''),
      }],
    }));
  }

  _buildDescription(product) {
    const parts = [];
    if (product.sceneApplication) parts.push(`【场景应用】${product.sceneApplication}`);
    if (product.sellingPoints?.length) parts.push(`【品种卖点】${product.sellingPoints.join('；')}`);
    if (product.description) parts.push(`【商品详情】${product.description}`);
    if (product.careGuide) parts.push(`【养护教程】${product.careGuide}`);
    if (product.afterSales) parts.push(`【售后保障】${product.afterSales}`);
    return parts.join('\n');
  }

  /**
   * 发布商品到视频号
   * POST /product/add
   */
  async publishProduct(product, mappedProduct, imageMap) {
    if (imageMap) {
      const urls = (product.images || [])
        .map(img => imageMap.get(img))
        .filter(Boolean)
        .map(e => e.url);
      mappedProduct.head_imgs = urls.slice(0, 9);
      mappedProduct.desc_info.imgs = urls.slice(0, 20);
    }

    const result = await this._request('POST', '/product/add', mappedProduct);

    return {
      platformProductId: result?.product_id || result?.data?.product_id || '',
      rawResponse: result,
    };
  }

  async offlineProduct(platformProductId) {
    const result = await this._request('POST', '/product/listing', {
      product_id: platformProductId,
      listing_type: 2,                                             // 下架
    });
    return result?.errcode === 0 || result?.code === 0;
  }

  /**
   * 上传图片到视频号（微信CDN）
   * POST /img/upload
   */
  async uploadImage(imageBuffer, fileName) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('media', imageBuffer, {
      filename: fileName || 'product.jpg',
      contentType: 'image/jpeg',
    });

    const result = await this._request('POST', '/img/upload', form, {
      headers: form.getHeaders(),
    });

    return {
      platformId: result?.img_id || result?.media_id || '',
      url: result?.url || result?.img_url || '',
    };
  }

  _truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) : str;
  }
}

module.exports = ShipinhaoAdapter;
