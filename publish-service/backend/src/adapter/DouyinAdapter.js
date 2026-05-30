/**
 * 抖店平台适配器
 * 参考文档: https://op.jinritemai.com/docs
 *
 * 字段映射规则:
 *  your-title → product_name
 *  your-main-image → main_image
 *  your-price → price (单位:分)
 *  your-specs → spec_info / spec_pic
 *  your-desc → description
 *  养护教程 + 售后 → after_sale_info
 */
const BasePlatformAdapter = require('./BasePlatformAdapter');
const config = require('../config');

class DouyinAdapter extends BasePlatformAdapter {
  constructor() {
    super('douyin', config.platforms.douyin);
  }

  /**
   * 字段映射：内部商品 → 抖店 product/addV2
   */
  mapProductToPlatform(product) {
    // 构建规格信息
    const specInfo = this._buildSpecInfo(product);

    return {
      // ---------- 基础信息 ----------
      product_name: this._truncate(product.title, 60),           // 商品标题，最多60字符
      product_short_title: this._truncate(product.title, 20),    // 短标题
      product_format: '{}',                                       // 实物商品
      out_product_id: String(product.id),                         // 关联我们的商品ID

      // ---------- 价格 ----------
      price: Math.round(product.price * 100),                     // 销售价（分）
      market_price: Math.round(product.marketPrice * 100) || 0,   // 市场价（分）
      discount_price: Math.round(product.price * 100),            // 折扣价

      // ---------- 库存 ----------
      stock_num: product.stock || 999,
      reduce_type: 2,                                             // 付款减库存

      // ---------- 分类 ----------
      // category_leaf_id: product.category,  // 需要抖店类目ID，从product.category映射

      // ---------- 发货 ----------
      delivery_delay_day: 2,                                      // 承诺发货时间
      extra_service: JSON.stringify({
        seven_day_return: '1',                                    // 7天无理由
      }),

      // ---------- 规格 ----------
      spec_info: specInfo.specInfo,
      spec_pic: specInfo.specPics,

      // ---------- 商品详情 ----------
      description: this._buildDescription(product),
      // ---------- 图片 ----------
      pic: '',                                                     // 主图，由上传后填入
      // pictures: [],                                             // 轮播图

      // ---------- 重量 ----------
      weight: product.weight || 0,

      // ---------- 支付方式 ----------
      pay_type: 1,                                                 // 支持货到付款
    };
  }

  /**
   * 构建规格信息（多SKU）
   */
  _buildSpecInfo(product) {
    if (!product.specs || product.specs.length === 0) {
      return { specInfo: '', specPics: '' };
    }

    // 收集所有规格属性
    const specProperties = [];
    const specs = [];
    const specPics = [];

    if (typeof product.specs[0] === 'object') {
      // 假设规格结构: [{ name, values, pic }]
      product.specs.forEach((spec, i) => {
        specProperties.push({
          property_name: spec.name || `规格${i + 1}`,
        });
        if (spec.values) {
          (Array.isArray(spec.values) ? spec.values : [spec.values]).forEach(v => {
            specs.push({
              spec_property_values: [{ property_name: spec.name, value_name: String(v) }],
              price: Math.round((product.price || 0) * 100),
              stock_num: spec.stock || product.stock || 999,
              status: 1,
            });
          });
        }
        if (spec.pic) {
          specPics.push({ spec_pic_url: spec.pic });
        }
      });
    } else {
      // 简单数组规格
      product.specs.forEach(s => {
        specProperties.push({ property_name: String(s) });
      });
    }

    return {
      specInfo: specProperties.length ? JSON.stringify({ properties: specProperties }) : '',
      specPics: specPics.length ? JSON.stringify(specPics) : '',
    };
  }

  /**
   * 构建商品详情（HTML格式）
   * 组合：场景应用 + 品种卖点 + 养护教程 + 规格对比 + 售后保障
   */
  _buildDescription(product) {
    const sections = [];

    if (product.sceneApplication) {
      sections.push(`<h3>📷 场景应用</h3><p>${product.sceneApplication}</p>`);
    }
    if (product.sellingPoints?.length) {
      sections.push(`<h3>🌟 品种卖点</h3><ul>${product.sellingPoints.map(s => `<li>${s}</li>`).join('')}</ul>`);
    }
    if (product.description) {
      sections.push(`<h3>📝 商品详情</h3><p>${product.description}</p>`);
    }
    if (product.careGuide) {
      sections.push(`<h3>🌱 养护教程</h3><p>${product.careGuide}</p>`);
    }
    if (product.afterSales) {
      sections.push(`<h3>🛡️ 售后保障</h3><p>${product.afterSales}</p>`);
    }

    // 插入主图（由调用方用实际平台图片URL替换）
    if (product.images?.length) {
      sections.unshift(`<img src="${product.images[0]}" style="width:100%;max-width:790px"/>`);
    }

    return sections.join('<br/>');
  }

  /**
   * 发布商品到抖店
   * POST /product/addV2
   */
  async publishProduct(product, mappedProduct, imageMap) {
    // 注入平台图片URL
    if (imageMap && product.images?.length) {
      const imageMapEntry = imageMap.get(product.images[0]);
      if (imageMapEntry) {
        mappedProduct.pic = imageMapEntry.url || '';
      }

      // 轮播图
      const pictureUrls = [];
      for (const img of product.images) {
        const entry = imageMap.get(img);
        if (entry) pictureUrls.push(entry.url || '');
      }
      mappedProduct.pictures = pictureUrls;
    }

    // 调用抖店创建商品API
    const result = await this._request('POST', '/product/addV2', mappedProduct);

    return {
      platformProductId: result?.data?.product_id || result?.product_id || '',
      rawResponse: result,
    };
  }

  /**
   * 下架商品
   * POST /product/setOffline
   */
  async offlineProduct(platformProductId) {
    const result = await this._request('POST', '/product/setOffline', {
      product_id: platformProductId,
    });
    return result?.code === 10000 || result?.err_no === 0;
  }

  /**
   * 上传图片到抖店素材中心
   * POST /material/uploadImage
   */
  async uploadImage(imageBuffer, fileName) {
    const FormData = require('form-data');
    const form = new FormData();
    form.append('material_type', 'photo');
    form.append('file', imageBuffer, {
      filename: fileName || 'product_image.jpg',
      contentType: 'image/jpeg',
    });

    const result = await this._request('POST', '/material/uploadImage', form, {
      headers: form.getHeaders(),
    });

    return {
      platformId: result?.data?.material_id || '',
      url: result?.data?.url || result?.data?.pic_url || '',
    };
  }

  _truncate(str, len) {
    if (!str) return '';
    return str.length > len ? str.substring(0, len) : str;
  }
}

module.exports = DouyinAdapter;
