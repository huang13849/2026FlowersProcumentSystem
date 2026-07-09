const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────
// 供应商 Schema
//
// 【经纬度存储铁律 —— Single Source of Truth】
//   主字段 : location = { type:'Point', coordinates:[lng, lat] }  (GeoJSON, 2dsphere)
//   派生字段: longitude / latitude  (由 hook 自动从 location.coordinates 同步)
//
//   写入规则（由 normalizeGeo 处理）：
//     1) 若传入 longitude/latitude 且合法 → 同步写 location.coordinates
//     2) 若传入 location.coordinates 且合法 → 同步写 longitude/latitude
//     3) (0,0) 视为「未设置」，等价于 null
//     4) 非法坐标（超出 -180~180 / -90~90）→ 抛错
//
//   读取规则：调用方可读 location.coordinates / longitude / latitude 任一，保证一致
//   历史遗留：顶层 `address` 字段废弃（保留结构但不再使用），公司注册地址请用 company_info.address
// ─────────────────────────────────────────────────────────────

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

  // @deprecated 顶层 address —— 请使用 company_info.address；保留字段仅为向后兼容读取
  address: { type: String, default: '' },

  // ↓↓↓ 派生字段（由 normalizeGeo hook 从 location.coordinates 自动同步；不要直接依赖）↓↓↓
  longitude: { type: Number, default: null },
  latitude:  { type: Number, default: null },
  // ↑↑↑

  planting_area: { type: Number, default: null },
  estimated_inventory: { type: Number, default: null },
  sales_period: { type: [String], default: [] },

  // ↓↓↓ 主字段 —— 经纬度唯一存储位置 ↓↓↓
  location: {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], default: [0, 0] }
  },
  // ↑↑↑

  contract_files: [{ name: String, url: String }],
  license_files:  [{ name: String, url: String }],
  dispatch_files: [{ name: String, url: String }],
  notes: String,
  product_count: { type: Number, default: 0 },
  product_ids: [String],
  sortOrder: { type: Number, default: 0, index: true },
}, { timestamps: true, collection: 'supplier' });

SupplierSchema.index({ status: 1 });
SupplierSchema.index({ location: '2dsphere' });

// ── 坐标归一化 & 校验 ────────────────────────────────────────
function isValidCoord(lng, lat) {
  if (lng == null || lat == null) return false;
  if (typeof lng !== 'number' || typeof lat !== 'number') return false;
  if (Number.isNaN(lng) || Number.isNaN(lat)) return false;
  if (lng < -180 || lng > 180 || lat < -90 || lat > 90) return false;
  if (lng === 0 && lat === 0) return false; // 视为未设置
  return true;
}

/**
 * 把 payload 里的 longitude/latitude/location 三种形态统一：
 *   - 有效坐标 → 三处一致
 *   - 无效 / 空 → longitude=null, latitude=null, location.coordinates=[0,0]
 * 该函数是幂等的，可反复调用。
 */
function normalizeGeoPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  let lng = null, lat = null;

  // 优先取 location.coordinates（主字段）
  if (payload.location && Array.isArray(payload.location.coordinates) && payload.location.coordinates.length === 2) {
    const [a, b] = payload.location.coordinates;
    if (isValidCoord(a, b)) { lng = a; lat = b; }
  }

  // 没主字段就取派生字段
  if (lng === null && payload.longitude != null && payload.latitude != null) {
    const a = Number(payload.longitude);
    const b = Number(payload.latitude);
    if (isValidCoord(a, b)) { lng = a; lat = b; }
    else if ((a !== 0 || b !== 0) && (Number.isNaN(a) || Number.isNaN(b) || a < -180 || a > 180 || b < -90 || b > 90)) {
      throw new Error(`Invalid coordinates: longitude=${payload.longitude}, latitude=${payload.latitude}`);
    }
  }

  if (lng !== null) {
    payload.longitude = lng;
    payload.latitude = lat;
    payload.location = { type: 'Point', coordinates: [lng, lat] };
  } else {
    // 显式提到过 geo 字段之一时才清零，避免 patch 时误清
    const geoTouched = ('longitude' in payload) || ('latitude' in payload) || ('location' in payload);
    if (geoTouched) {
      payload.longitude = null;
      payload.latitude = null;
      payload.location = { type: 'Point', coordinates: [0, 0] };
    }
  }
  return payload;
}

SupplierSchema.statics.normalizeGeoPayload = normalizeGeoPayload;
SupplierSchema.statics.isValidCoord = isValidCoord;

// pre-save: 完整文档保存前归一化
SupplierSchema.pre('validate', function(next) {
  try {
    // this 是 document；取其 geo 三字段构造 payload，归一化后回填
    const payload = {
      longitude: this.longitude,
      latitude: this.latitude,
      location: this.location ? { coordinates: this.location.coordinates } : undefined,
    };
    normalizeGeoPayload(payload);
    this.longitude = payload.longitude;
    this.latitude = payload.latitude;
    this.location = { type: 'Point', coordinates: payload.location.coordinates };
    next();
  } catch (e) { next(e); }
});

// pre-update: findOneAndUpdate / updateOne / updateMany 前归一化 $set
function normalizeUpdateHook(next) {
  try {
    const upd = this.getUpdate() || {};
    // $set 场景
    if (upd.$set) {
      normalizeGeoPayload(upd.$set);
    }
    // 直接顶层字段场景 (findByIdAndUpdate(id, {longitude, latitude}))
    if ('longitude' in upd || 'latitude' in upd || 'location' in upd) {
      normalizeGeoPayload(upd);
    }
    this.setUpdate(upd);
    next();
  } catch (e) { next(e); }
}
SupplierSchema.pre('findOneAndUpdate', normalizeUpdateHook);
SupplierSchema.pre('updateOne', normalizeUpdateHook);
SupplierSchema.pre('updateMany', normalizeUpdateHook);

// ── 工厂 ───────────────────────────────────────────────────
function createSupplierModel(connection) {
  return connection.models.Supplier || connection.model('Supplier', SupplierSchema);
}

module.exports = {
  SupplierSchema,
  createSupplierModel,
  normalizeGeoPayload,
  isValidCoord,
  Supplier: mongoose.models.Supplier || mongoose.model('Supplier', SupplierSchema),
};
