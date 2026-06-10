const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  name: { type: String, required: true },
  shop_name: { type: String, index: true, sparse: true },
  status: { type: String, enum: ['已完成','待签章','已下发','合同异常','待补资料'], default: '待签章' },
  contact: { name: String, phone: String, wechat: String },
  contacts: [{ name: String, phone: String, title: String, gender: String }],
  company_info: { tax_id: String, address: String, main_business: String },
  business_items: [{
    main_business: String,       // 主营业务内容
    address: String,             // 对应种植/经营地址
    planting_area: Number,       // 种植面积（亩）
    estimated_inventory: Number, // 库存预估（株/棵）
    sales_period: String,        // 销售期（自由填写）
  }],

  // ── V2.0 新增字段 ──
  address: { type: String, default: '' },                    // 供应商实际经营地址
  longitude: { type: Number, default: null },                 // 经度（自动生成）
  latitude: { type: Number, default: null },                  // 纬度（自动生成）
  planting_area: { type: Number, default: null },             // 种植面积（亩）
  estimated_inventory: { type: Number, default: null },       // 预估总库存（株/棵）
  sales_period: { type: [String], default: [] },              // 销售期（多选）

  // 地理位置索引（为地图系统预留）
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }          // [lng, lat]
  },

  contract_files: [{ name: String, url: String }],
  license_files: [{ name: String, url: String }],
  dispatch_files: [{ name: String, url: String }],
  notes: String,
  product_count: { type: Number, default: 0 },
  product_ids: [String],
  sortOrder: { type: Number, default: 0, index: true },
}, { timestamps: true, collection: 'supplier' });

SupplierSchema.index({ status: 1 });
SupplierSchema.index({ location: '2dsphere' });  // V2.0 地理空间索引

function createSupplierModel(connection) {
  return connection.models.Supplier || connection.model('Supplier', SupplierSchema);
}

module.exports = {
  SupplierSchema,
  createSupplierModel,
  Supplier: mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema),
};
