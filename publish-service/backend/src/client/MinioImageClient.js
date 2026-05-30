/**
 * MinIO 客户端 —— 获取商品图片
 * 从 MinIO 下载图片供后续上传到各平台
 */
const { Client: MinioClient } = require('minio');
const config = require('../config');

class MinioImageClient {
  constructor() {
    this.client = new MinioClient({
      endPoint: config.minio.endPoint,
      port: config.minio.port,
      accessKey: config.minio.accessKey,
      secretKey: config.minio.secretKey,
      useSSL: config.minio.useSSL,
    });
    this.bucket = config.minio.bucket;
  }

  /**
   * 获取图片的可访问 URL
   * @param {string} objectName 对象名称（路径）
   * @param {number} [expirySeconds=3600] 预签名 URL 过期时间
   * @returns {Promise<string>}
   */
  async getImageUrl(objectName, expirySeconds = 3600) {
    try {
      const url = await this.client.presignedGetObject(
        this.bucket,
        objectName,
        expirySeconds
      );
      return url;
    } catch (err) {
      console.error(`[MinioClient] 获取图片URL失败 object=${objectName}:`, err.message);
      throw new Error(`无法获取图片URL ${objectName}: ${err.message}`);
    }
  }

  /**
   * 获取图片的 Buffer 数据（用于上传到平台）
   * @param {string} objectName
   * @returns {Promise<Buffer>}
   */
  async getImageBuffer(objectName) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      this.client.getObject(this.bucket, objectName, (err, stream) => {
        if (err) {
          console.error(`[MinioClient] 获取图片Buffer失败 object=${objectName}:`, err.message);
          return reject(new Error(`无法获取图片Buffer ${objectName}: ${err.message}`));
        }
        stream.on('data', chunk => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });
    });
  }

  /**
   * 批量获取图片 Buffer
   * @param {string[]} objectNames
   * @returns {Promise<Map<string, Buffer>>}
   */
  async getImageBufferBatch(objectNames) {
    const results = new Map();
    const promises = objectNames.map(async (name) => {
      try {
        const buffer = await this.getImageBuffer(name);
        results.set(name, buffer);
      } catch (err) {
        console.warn(`[MinioClient] 跳过错误图片 ${name}: ${err.message}`);
      }
    });
    await Promise.allSettled(promises);
    return results;
  }

  /**
   * 检查 MinIO 连接健康状态
   */
  async healthCheck() {
    try {
      await this.client.bucketExists(this.bucket);
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = new MinioImageClient();
