/**
 * ProductClient —— 调用 product-service HTTP 接口获取商品数据
 * 原则：不直连 MongoDB，只通过 HTTP 调用 product-service
 */
const axios = require('axios');
const config = require('../config');

class ProductClient {
  constructor() {
    this.baseUrl = config.productService.baseUrl;
    this.timeout = config.productService.timeoutMs;
    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  /**
   * 获取单个商品完整数据
   * GET /api/products/:id（注意 products 是复数，匹配 product-service 实际路由）
   * @param {string} productId
   * @returns {Promise<Object>} 商品结构化数据
   */
  async getProductById(productId) {
    try {
      const { data } = await this.client.get(`/api/products/${productId}`);
      return this.normalizeProduct(data);
    } catch (err) {
      console.error(`[ProductClient] 获取商品失败 productId=${productId}:`, err.message);
      throw new Error(`无法获取商品 ${productId}: ${err.message}`);
    }
  }

  /**
   * 批量获取商品数据
   * GET /api/products?ids=...
   * @param {string[]} productIds
   * @returns {Promise<Object[]>}
   */
  async getProductBatch(productIds) {
    try {
      // 实际使用 product-service 的批量查询
      // 现有 routes 支持 GET /api/products?page=1&limit=50&search=...
      const { data } = await this.client.get(`/api/products`, {
        params: { limit: 50, _ids: productIds.join(',') }
      });
      return (Array.isArray(data?.products) ? data.products : []).map(p => this.normalizeProduct(p));
    } catch (err) {
      console.error(`[ProductClient] 批量获取商品失败:`, err.message);
      throw new Error(`无法批量获取商品: ${err.message}`);
    }
  }

  /**
   * 标准化商品数据结构
   * 适配 product-service 可能的不同返回格式
   */
  normalizeProduct(raw) {
    // 兼容 { data: { ... } } 或直接返回对象
    const product = raw?.data || raw;

    return {
      id: product._id || product.id,
      title: product.title || product.name || '',
      description: product.description || product.desc || '',
      images: product.images || product.pictures || [],
      price: product.price || product.salePrice || product.salesPrice || 0,
      marketPrice: product.marketPrice || product.originalPrice || product.market_price || 0,
      stock: product.stock || product.quantity || product.inventory || 0,
      weight: product.weight || 0,
      category: product.category || product.categories || '',
      specs: product.specs || product.specifications || product.skuList || [],
      delivery: product.delivery || product.deliveryFrom || product.shippingFrom || '',
      // 营销卖点
      sellingPoints: product.sellingPoints || product.highlights || [],
      // 售后保障
      afterSales: product.afterSales || product.warranty || '',
      // 养护教程
      careGuide: product.careGuide || product.maintenanceGuide || '',
      // 场景应用
      sceneApplication: product.sceneApplication || product.usageScenarios || '',
    };
  }

  /**
   * 检查 product-service 健康状态
   * @returns {Promise<boolean>}
   */
  async healthCheck() {
    try {
      await this.client.get('/api/health', { timeout: 5000 });
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = new ProductClient();
