import mongoose from "mongoose";

const productSchema = new mongoose.Schema({
  title: { type: String, required: true, index: true },
  englishTitle: { type: String, default: '', index: true },
  isListed: { type: Boolean, default: false, index: true },
  category: { type: String, index: true },
  sellerName: String,
  images: [String],
  // 11 dedicated image columns
  panorama_images: [String],
  package_images: [String],
  detail_images: [String],
  root_soil_images: [String],
  size_ref_images: [String],
  scene_images: [String],
  selling_point_images: [String],
  care_images: [String],
  comparison_images: [String],
  shipping_images: [String],
  after_sale_images: [String],
  product_videos: [String],
  flowerName: String,
  // 花期：1-12 表示有花期的月份，便于按月份筛选植物
  floweringMonths: { type: [Number], default: [], index: true },
  // 场景标签：用于首页「成功案例/场景」展示与按场景筛选
  sceneTags: { type: [String], default: [], index: true },
  contactPerson: String,
  specSize: String,
  deliveryMethod: String,
  origin: String,
  potColorNotes: String,
  stock: { type: Number, default: 0 },
  minOrder: { type: Number, default: 1 },
  tradeType: { type: String, enum: ["retail", "wholesale", "mixed"], default: "retail" },

  // ── 多平台发布状态 ──
  publishStatus: {
    type: Map,
    of: new mongoose.Schema({
      status: { type: String, enum: ['unpublished','publishing','published','reviewing','failed','offline'], default: 'unpublished' },
      platformProductId: { type: String },
      publishTime: { type: Date },
      offlineTime: { type: Date },
      lastError: { type: String },
    }, { _id: false }),
    default: {
      wechat: { status: 'unpublished' },
      douyin: { status: 'unpublished' },
      xiaohongshu: { status: 'unpublished' },
      taobao: { status: 'unpublished' },
      jd: { status: 'unpublished' },
    },
  },
  weight: Number,
  dropShippingCost: Number,
  dropShippingMarketPrice: Number,
  settlementPrice: { type: Number, default: 0 },
  shippingFee: { type: Number, default: 0 },
  costPrice: Number,
  sellPrice: Number,
  taxRateA: { type: Number, default: 0 },
  taxRateB: { type: Number, default: 0 },
  retailMarkupPrice: Number,
  profit: Number,
  platformPriceDiff: Number,
  couponInfo: String,
  retailProfit: Number,
  description: String,
  batchMinQty: Number,
  batchShipping: Number,
  batchUnitPrice: Number,
  productId: { type: String, unique: true, sparse: true },
  listedDate: Date,
  listedStore: String,
  salesVolume: { type: Number, default: 0 },
  createdBy: { type: String, default: "admin" },

  shipping_description: { type: String, default: null }, // V2.0: 运费说明

  supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: "Supplier", index: true, sparse: true },
  ecommerceReferenceUrl: String,
  supplier_name: { type: String, index: true },
}, { timestamps: true });

productSchema.index({ title: "text", description: "text", flowerName: "text" });
productSchema.index({ createdAt: -1 });
productSchema.index({ updatedAt: -1 });

export default mongoose.model("Product", productSchema);
