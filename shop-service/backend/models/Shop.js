const mongoose = require('mongoose');

const ShopSchema = new mongoose.Schema({
  shopName:          { type: String, default: '' },
  lakalaShopNo:      { type: String, default: '' },
  terminalNo:        { type: String, default: '' },
  wechatMerchantNo:  { type: String, default: '' },
  alipayMerchantNo:  { type: String, default: '' },
  phone:             { type: String, default: '' },
  contactName:       { type: String, default: '' },
  date:              { type: String, default: '' },
  idNumber:          { type: String, default: '' },
  address:           { type: String, default: '' },
  longitude:         { type: Number, default: null },
  latitude:          { type: Number, default: null },
  // Image arrays: each item is { url, key, name }
  idCardImages:      [{ url: String, key: String, name: String }],
  bankCardImages:    [{ url: String, key: String, name: String }],
  qrCodeImages:      [{ url: String, key: String, name: String }],
  businessCategory:  { type: String, default: '' },
  sortOrder:         { type: Number, default: 0 },
}, { timestamps: true });

function createShopModel(connection) {
  if (connection.models.Shop) return connection.models.Shop;
  return connection.model('Shop', ShopSchema);
}

module.exports = { ShopSchema, createShopModel };
