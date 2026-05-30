/**
 * 商品发布任务模型（ESM 版本，适配 product-service）
 * ProductPublishTask —— MongoDB 集合
 */
import mongoose from 'mongoose';

const productPublishTaskSchema = new mongoose.Schema({
  taskId: { type: String, required: true, unique: true },
  productId: { type: String, required: true },
  sku: { type: String },
  platform: {
    type: String,
    enum: ['wechat', 'douyin', 'xiaohongshu', 'taobao', 'jd', 'pinduoduo'],
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'publishing', 'published', 'reviewing', 'failed', 'offline', 'restored'],
    default: 'pending',
  },
  platformProductId: { type: String },
  errorMessage: { type: String },
  operator: { type: String, default: 'system' },
  retryCount: { type: Number, default: 0 },
  publishTime: { type: Date },
  offlineTime: { type: Date },
  restoreTime: { type: Date },
}, { timestamps: true });

productPublishTaskSchema.index({ productId: 1, platform: 1 });
productPublishTaskSchema.index({ taskId: 1 });
productPublishTaskSchema.index({ status: 1 });

const ProductPublishTask = mongoose.model('ProductPublishTask', productPublishTaskSchema);
export default ProductPublishTask;
