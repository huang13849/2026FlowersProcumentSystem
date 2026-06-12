const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  name: { type: String, required: true },
  shop_name: { type: String, index: true, sparse: true },
  status: { type: String, enum: ['已完成','待整理','合同异常'], default: '待整理' },
  contact: { name: String, phone: String, wechat: String },
  contacts: [{ name: String, phone: String, title: String, gender: String }],
  company_info: { tax_id: String, address: String, main_business: String },
  business_items: [{
    main_business: String,
    address: String,
    planting_area: Number,
    estimated_inventory: Number,
    sales_period: String,
  }],

  address: { type: String, default: '' },
  longitude: { type: Number, default: null },
  latitude: { type: Number, default: null },
  planting_area: { type: Number, default: null },
  estimated_inventory: { type: Number, default: null },
  sales_period: { type: [String], default: [] },

  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
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
SupplierSchema.index({ location: '2dsphere' });

function createSupplierModel(connection) {
  return connection.models.Supplier || connection.model('Supplier', SupplierSchema);
}

module.exports = {
  SupplierSchema,
  createSupplierModel,
  Supplier: mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema),
};
