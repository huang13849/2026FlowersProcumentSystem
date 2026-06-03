/**
 * ImageUploadService —— 图片上传服务
 *
 * 流程：
 * 1. 从 MinIO 获取图片 Buffer
 * 2. 上传到目标平台
 * 3. 返回平台可用的图片引用
 */
const minioClient = require('../client/MinioImageClient');

/**
 * 商品中所有可能含图片的字段
 */
const IMAGE_FIELDS = [
  'images', 'head_imgs', 'main_images', 'panorama_images', 'package_images',
  'detail_images', 'scene_images', 'selling_point_images',
  'care_images', 'comparison_images', 'shipping_images', 'after_sale_images',
  'root_soil_images', 'size_ref_images',
];

/**
 * 收集商品中所有非空图片URL
 */
function collectAllImages(product) {
  var all = [];
  for (var i = 0; i < IMAGE_FIELDS.length; i++) {
    var f = product[IMAGE_FIELDS[i]];
    if (f && Array.isArray(f)) {
      for (var j = 0; j < f.length; j++) {
        if (f[j] && typeof f[j] === 'string' && f[j].length > 5) {
          all.push(f[j]);
        }
      }
    }
  }
  return all;
}

class ImageUploadService {
  /**
   * 将商品的所有图片上传到指定平台
   * @param {Object} product 标准化商品对象（含所有图片字段）
   * @param {BasePlatformAdapter} adapter 目标平台适配器
   * @returns {Promise<Map<string, { platformId: string, url: string }>>}
   */
  async uploadProductImages(product, adapter) {
    const imageMap = new Map();

    // 从所有字段收集图片
    const images = collectAllImages(product);

    if (!images.length) {
      console.log('[ImageUpload] 商品 ' + product.id + ' 无图片，跳过上传');
      return imageMap;
    }

    console.log('[ImageUpload] 开始上传 ' + images.length + ' 张图片到 ' + adapter.platformName + '...');

    for (var i = 0; i < images.length; i++) {
      const imageRef = images[i];
      try {
        // 解析图片路径（可能是完整URL或MinIO object name）
        const objectName = this._extractObjectName(imageRef);
        if (!objectName) {
          console.warn('[ImageUpload] 无法解析图片引用: ' + imageRef);
          continue;
        }

        // 从 MinIO 获取图片
        const buffer = await minioClient.getImageBuffer(objectName);

        // 上传到平台
        const fileName = product.id + '_' + i + '_' + Date.now() + '.jpg';
        const result = await adapter.uploadImage(buffer, fileName);

        imageMap.set(imageRef, {
          platformId: result.platformId,
          url: result.url,
          originalRef: imageRef,
        });

        console.log('[ImageUpload] ✓ 第' + (i+1) + '/' + images.length + '张上传完成: ' + (result.url || result.platformId));
      } catch (err) {
        console.error('[ImageUpload] ✗ 图片' + (i+1) + '上传失败:', err.message);
      }
    }

    console.log('[ImageUpload] 上传完成: ' + imageMap.size + '/' + images.length + ' 成功');
    return imageMap;
  }

  /**
   * 从图片引用中提取 MinIO object name
   * 支持格式：
   *   - 完整URL: http://minio:9000/supply-chain/products/abc123.jpg -> supply-chain/products/abc123.jpg
   *   - 直接路径: products/abc123.jpg -> products/abc123.jpg
   *   - 简单名称: abc123.jpg -> abc123.jpg
   */
  _extractObjectName(imageRef) {
    if (!imageRef) return null;
    // URL格式: 提取 pathname
    if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
      try {
        var u = new URL(imageRef);
        var path = u.pathname.replace(/^\//, '');
        // Strip bucket name from path (URL format: /bucket/object)
        // e.g. /supply-chain/products/xxx.jpg -> products/xxx.jpg
        var bucket = require('../config').minio.bucket;
        if (path.startsWith(bucket + '/')) {
          path = path.substring(bucket.length + 1);
        }
        return path || null;
      } catch (e) {
        return null;
      }
    }
    // 直接路径
    return imageRef;
  }
}

module.exports = new ImageUploadService();
