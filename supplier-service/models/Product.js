const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
  title: { type: String, index: true },
  supplier_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Supplier', index: true, sparse: true },
  supplier_name: { type: String, index: true },
}, { timestamps: true, collection: 'products' });

function createProductModel(connection) {
  return connection.models.Product || connection.model('Product', productSchema);
}

module.exports = {
  productSchema,
  createProductModel,
  Product: mongoose.models.Product || mongoose.model('Product', productSchema),
};
