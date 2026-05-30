const mongoose = require('mongoose');

const SupplierSchema = new mongoose.Schema({
  name: { type: String, required: true },
  shop_name: { type: String, index: true, sparse: true },
  status: { type: String, enum: ['已完成','待签章','已下发','合同异常','待补资料'], default: '待签章' },
  contact: { name: String, phone: String, wechat: String },
  company_info: { tax_id: String, address: String, main_business: String },
  contract_files: [{ name: String, url: String }],
  license_files: [{ name: String, url: String }],
  dispatch_files: [{ name: String, url: String }],
  notes: String,
  product_count: { type: Number, default: 0 },
  product_ids: [String],
  sortOrder: { type: Number, default: 0, index: true },
}, { timestamps: true, collection: 'supplier' });
SupplierSchema.index({ status: 1 });

function createSupplierModel(connection) {
  return connection.models.Supplier || connection.model('Supplier', SupplierSchema);
}

module.exports = {
  SupplierSchema,
  createSupplierModel,
  Supplier: mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema),
};
