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
    this._token = null;
    this._tokenExpiry = 0;
    this._authInProgress = null;  // 防止并发登录

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: { 'Content-Type': 'application/json' },
    });

    // 响应拦截器：401 时自动重登录
    this.client.interceptors.response.use(
      response => response,
      async error => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
          originalRequest._retry = true;
          await this._ensureAuth();
          originalRequest.headers['Authorization'] = 'Bearer ' + this._token;
          return this.client(originalRequest);
        }
        return Promise.reject(error);
      }
    );
  }

  /**
   * 登录获取 JWT token
   */
  async _login() {
    const username = config.productService.username;
    const password = config.productService.password;

    if (!username || !password) {
      throw new Error('product-service 未配置登录凭据 (PRODUCT_SERVICE_USERNAME / PRODUCT_SERVICE_PASSWORD)');
    }

    const response = await axios({
      method: 'POST',
      url: this.baseUrl + '/api/auth/login',
      headers: { 'Content-Type': 'application/json' },
      data: { username, password },
      timeout: 10000,
    });

    const token = response.data?.token;
    if (!token) {
      throw new Error('product-service 登录失败: 未返回 token');
    }

    this._token = token;
    this._tokenExpiry = Date.now() + 7 * 24 * 3600 * 1000; // JWT 配置了 7 天过期
    console.log('[ProductClient] 登录成功，已获取 JWT token');
    return token;
  }

  /**
   * 确保已登录，如 token 过期则重新登录
   */
  async _ensureAuth() {
    if (this._token && Date.now() < this._tokenExpiry - 60000) {
      return this._token;
    }
    // 防止并发多次登录
    if (this._authInProgress) {
      return this._authInProgress;
    }
    this._authInProgress = this._login().finally(() => {
      this._authInProgress = null;
    });
    return this._authInProgress;
  }

  /**
   * 设置请求头（带 auth token）
   */
  async _getHeaders() {
    const token = await this._ensureAuth();
    return {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + token,
    };
  }

  /**
   * 获取单个商品完整数据
   * GET /api/products/:id
   */
  async getProductById(productId) {
    try {
      // product-service 已去登录化；先匿名读取，只有遇到 401 再走旧登录逻辑。
      // 避免 k3s 环境未配置 JWT_SECRET 时 /api/auth/login 返回 500，导致一键铺货误报“无法获取商品”。
      const { data } = await this.client.get('/api/products/' + productId);
      return this.normalizeProduct(data);
    } catch (err) {
      if (err.response?.status === 401) {
        try {
          const headers = await this._getHeaders();
          const { data } = await this.client.get('/api/products/' + productId, { headers });
          return this.normalizeProduct(data);
        } catch (authErr) {
          console.error('[ProductClient] 获取商品失败 productId=' + productId + ':', authErr.message);
          throw new Error('无法获取商品 ' + productId + ': ' + authErr.message);
        }
      }
      console.error('[ProductClient] 获取商品失败 productId=' + productId + ':', err.message);
      throw new Error('无法获取商品 ' + productId + ': ' + err.message);
    }
  }

  /**
   * 批量获取商品数据
   * GET /api/products
   */
  async getProductBatch(productIds) {
    const params = { limit: 50, _ids: productIds.join(',') };
    try {
      const { data } = await this.client.get('/api/products', { params });
      return (Array.isArray(data?.products) ? data.products : []).map(p => this.normalizeProduct(p));
    } catch (err) {
      if (err.response?.status === 401) {
        try {
          const headers = await this._getHeaders();
          const { data } = await this.client.get('/api/products', { params, headers });
          return (Array.isArray(data?.products) ? data.products : []).map(p => this.normalizeProduct(p));
        } catch (authErr) {
          console.error('[ProductClient] 批量获取商品失败:', authErr.message);
          throw new Error('无法批量获取商品: ' + authErr.message);
        }
      }
      console.error('[ProductClient] 批量获取商品失败:', err.message);
      throw new Error('无法批量获取商品: ' + err.message);
    }
  }

  /**
   * 标准化商品数据结构
   */
  normalizeProduct(raw) {
    const product = raw?.data || raw;

    return {
      id: product._id || product.id,
      title: product.title || product.name || '',
      description: product.description || product.desc || '',
      // 所有图片字段（保留原始分类）
      images: product.images || product.pictures || [],
      panorama_images: product.panorama_images || [],
      package_images: product.package_images || [],
      detail_images: product.detail_images || [],
      root_soil_images: product.root_soil_images || [],
      size_ref_images: product.size_ref_images || [],
      scene_images: product.scene_images || [],
      selling_point_images: product.selling_point_images || [],
      care_images: product.care_images || [],
      comparison_images: product.comparison_images || [],
      shipping_images: product.shipping_images || [],
      after_sale_images: product.after_sale_images || [],
      main_images: product.main_images || [],
      // 价格字段（映射自 API 返回的实际字段名）
      // ecommerceReferenceUrl 是商品管理里“平台参考价/划线价”，花乡发布 market 字段优先用它。
      price: product.price || product.sellPrice || product.salesPrice || 0,
      marketPrice: product.ecommerceReferenceUrl || product.marketPrice || product.retailMarkupPrice || product.costPrice || product.sellPrice || 0,
      sellPrice: product.sellPrice || product.price || 0,
      costPrice: product.costPrice || 0,
      retailMarkupPrice: product.retailMarkupPrice || 0,
      ecommerceReferenceUrl: product.ecommerceReferenceUrl || '',
      stock: product.stock || product.quantity || product.inventory || 0,
      weight: product.weight || 0,
      category: product.category || product.categories || '',
      specs: product.specs || product.specifications || product.skuList || [],
      delivery: product.delivery || product.deliveryFrom || product.shippingFrom || '',
      // 营销内容
      sellingPoints: product.sellingPoints || product.highlights || [],
      afterSales: product.afterSales || product.warranty || '',
      careGuide: product.careGuide || product.maintenanceGuide || '',
      sceneApplication: product.sceneApplication || product.usageScenarios || '',
    };
  }

  /**
   * 健康检查
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
