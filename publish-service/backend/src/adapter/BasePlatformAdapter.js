/**
 * 平台适配器基类 —— 定义统一接口，所有平台适配器继承于此
 *
 * 每个平台适配器职责：
 * 1. 商品字段映射（你的字段 → 平台字段）
 * 2. 调用平台 API 创建商品
 * 3. 调用平台 API 下架商品
 * 4. 上传图片到平台
 */
const axios = require('axios');

class BasePlatformAdapter {
  constructor(platformKey, platformConfig) {
    this.platformKey = platformKey;       // douyin / xiaohongshu / ...
    this.platformName = platformConfig?.name || platformKey;
    this.appKey = platformConfig?.appKey || '';
    this.appSecret = platformConfig?.appSecret || '';
    this.apiBase = platformConfig?.apiBase || '';
  }

  /**
   * 字段映射 —— 把内部商品结构转成平台要求的结构
   * 每个子类必须实现
   * @param {Object} product 标准化商品对象
   * @returns {Object} 平台商品创建参数
   */
  mapProductToPlatform(product) {
    throw new Error(`[${this.platformName}] mapProductToPlatform() 未实现`);
  }

  /**
   * 发布商品到平台
   * @param {Object} product 标准化商品
   * @param {Object} mappedProduct 平台映射后的商品
   * @param {Object} imageMap 图片映射 { internalName: { platformId, url } }
   * @returns {Promise<{ platformProductId: string, rawResponse: Object }>}
   */
  async publishProduct(product, mappedProduct, imageMap) {
    throw new Error(`[${this.platformName}] publishProduct() 未实现`);
  }

  /**
   * 下架商品
   * @param {string} platformProductId 平台商品ID
   * @returns {Promise<boolean>}
   */
  async offlineProduct(platformProductId) {
    throw new Error(`[${this.platformName}] offlineProduct() 未实现`);
  }

  /**
   * 上传图片到平台
   * @param {Buffer} imageBuffer 图片二进制
   * @param {string} fileName 文件名
   * @returns {Promise<{ platformId: string, url: string }>}
   */
  async uploadImage(imageBuffer, fileName) {
    throw new Error(`[${this.platformName}] uploadImage() 未实现`);
  }

  /**
   * 检查平台配置是否有效
   * @returns {boolean}
   */
  isConfigured() {
    return Boolean(this.appKey && this.appSecret && this.apiBase);
  }

  /**
   * 通用 HTTP 请求封装
   */
  async _request(method, url, data, options = {}) {
    try {
      const response = await axios({
        method,
        url: `${this.apiBase}${url}`,
        data,
        headers: {
          'Content-Type': 'application/json',
          ...options.headers,
        },
        timeout: options.timeout || 30000,
        ...options.axiosOptions,
      });
      return response.data;
    } catch (err) {
      const status = err.response?.status;
      const msg = err.response?.data || err.message;
      console.error(`[${this.platformName}] API ${method} ${url} 失败:`, status, msg);
      throw new Error(`平台API错误[${status}]: ${JSON.stringify(msg)}`);
    }
  }
}

module.exports = BasePlatformAdapter;
