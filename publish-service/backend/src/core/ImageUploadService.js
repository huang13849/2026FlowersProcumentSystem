/**
 * ImageUploadService —— 图片上传服务
 *
 * 流程：
 * 1. 从 MinIO 获取图片 Buffer
 * 2. 上传到目标平台
 * 3. 返回平台可用的图片引用
 */
const minioClient = require('../client/MinioImageClient');

class ImageUploadService {
  /**
   * 将商品的所有图片上传到指定平台
   * @param {Object} product 标准化商品对象
   * @param {BasePlatformAdapter} adapter 目标平台适配器
   * @returns {Promise<Map<string, { platformId: string, url: string }>>}
   *   key = 原始图片URL/path
   */
  async uploadProductImages(product, adapter) {
    const imageMap = new Map();
    const images = product.images || [];

    if (!images.length) {
      console.log(`[ImageUpload] 商品 ${product.id} 无图片，跳过上传`);
      return imageMap;
    }

    console.log(`[ImageUpload] 开始上传 ${images.length} 张图片到 ${adapter.platformName}...`);

    for (let i = 0; i < images.length; i++) {
      const imageRef = images[i];
      try {
        // 解析图片路径（可能是完整URL或MinIO object name）
        const objectName = this._extractObjectName(imageRef);
        if (!objectName) {
          console.warn(`[ImageUpload] 无法解析图片引用: ${imageRef}`);
          continue;
        }

        // 从 MinIO 获取图片
        const buffer = await minioClient.getImageBuffer(objectName);

        // 上传到平台
        const fileName = `${product.id}_${i}_${Date.now()}.jpg`;
        const result = await adapter.uploadImage(buffer, fileName);

        imageMap.set(imageRef, {
          platformId: result.platformId,
          url: result.url,
          originalRef: imageRef,
        });

        console.log(`[ImageUpload] ✅ 第${i+1}/${images.length}张上传完成: ${result.url || result.platformId}`);
      } catch (err) {
        console.error(`[ImageUpload] ❌ 图片${i+1}上传失败:`, err.message);
        // 不阻断，继续上传其他图片
      }
    }

    console.log(`[ImageUpload] 上传完成: ${imageMap.size}/${images.length} 成功`);
    return imageMap;
  }

  /**
   * 从图片引用中提取 MinIO object name
   * 支持格式：
   *   - 完整URL: http://minio:9000/products/abc123.jpg → abc123.jpg
   *   - 直接路径: products/abc123.jpg → abc123.jpg
   *   - 简单名称: abc123.jpg → abc123.jpg
   */
  _extractObjectName(imageRef) {
    if (!imageRef) return null;
    // URL格式
    if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
      const url = new URL(imageRef);
      // 去掉开头的 / 和 bucket 前缀
      let path = url.pathname.replace(/^\//, '');
      // 如果路径包含bucket前缀（如 products/abc.jpg），保留完整路径
      return path || null;
    }
    // 直接路径
    return imageRef;
  }
}

module.exports = new ImageUploadService();
