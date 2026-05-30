/**
 * productController 追加 — 添加 GET /api/product/:id 端点
 *
 * 将此代码合并到 product-service 的 productController 中。
 *
 * 已有路由:  POST /api/product      → 创建商品
 *            GET  /api/products     → 商品列表
 * 新增路由:  GET  /api/product/:id  → 单商品查询 (publish-service调用)
 *
 * 使用方法:
 *   在 product-service/src/routes/product.js 中追加:
 *       router.get('/:id', getProductById);
 *   或在 product-service/src/controllers/productController.js 中追加:
 *       exports.getProductById = async (req, res) => { ... };
 */

/**
 * GET /api/product/:id
 * 查询单个商品完整数据，供 publish-service 调用
 *
 * 参数: req.params.id — MongoDB _id 或自定义 productId
 * 返回: 完整商品对象 JSON
 */
async function getProductById(req, res) {
  try {
    const { id } = req.params;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: '缺少商品ID参数',
      });
    }

    // 查询商品 — 兼容 MongoDB ObjectId 和自定义 productId
    const { ObjectId } = require('mongoose').Types;
    const query = ObjectId.isValid(id)
      ? { $or: [{ _id: id }, { productId: id }] }
      : { productId: id };

    const product = await Product.findOne(query).lean();

    if (!product) {
      return res.status(404).json({
        success: false,
        error: `商品不存在: ${id}`,
      });
    }

    // 返回完整商品数据
    return res.json({
      success: true,
      data: product,
    });

  } catch (err) {
    console.error('[ProductController] getProductById 错误:', err.message);
    return res.status(500).json({
      success: false,
      error: '查询商品失败',
      message: err.message,
    });
  }
}

module.exports = { getProductById };

/**
 * ======== 路由注册 (product.js) ========
 *
 * // 在 product.js 的 router 定义中添加:
 * const { getProductById } = require('../controllers/productController');
 * router.get('/product/:id', getProductById);
 *
 * 注意: 如果已有 router.get('/products') (复数)，确保 /:id 放在它后面
 * Express 路由匹配顺序: /products 先于 /:id
 */
