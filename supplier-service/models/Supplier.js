const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────
// 供应商 Schema —— 【经纬度铁律 v2 · 单字段唯一】
//
//   唯一存储 : location = { type:'Point', coordinates:[lng, lat] }  (GeoJSON, 2dsphere)
//   longitude/latitude 已从 schema 中移除。
//
//   兼容层（normalizeGeoPayload）：
//     - 入口 payload 里若还带 longitude/latitude，会被归一到 location.coordinates
//       并从 payload 中 delete，不再落库；
//     - 若同时传 location.coordinates，则以 location 为准；
//     - (0,0) 视为「未设置」，写入前会归一为 [0,0] 占位；
//     - 非法坐标（超出 -180~180 / -90~90 或 NaN）→ 抛错。
//
//   读取：调用方只能通过 doc.location.coordinates[0/1] 拿到经纬度。
//         若需要 lng/lat 简化视图，请调用 SupplierService.toGeoView(doc)。
//   历史遗留：顶层 address 字段已废弃，公司注册地址请用 company_info.address
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

  planting_area: { type: Number, default: null },
  estimated_inventory: { type: Number, default: null },
  sales_period: { type: [String], default: [] },

  // ↓↓↓ 经纬度唯一存储 ↓↓↓
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

  // ─── Peony Alliance 注册字段（管理员申请） ───
  peony_alliance: {
    alliance_type: { type: String, enum: ['hq','branch','overseas','partner'] },
    identity:      { type: String, enum: ['admin','staff'] },
    positions:     [{ type: String, enum: ['sales','operation','info','aftersales'] }],
    entity_name:      String,  // 主体名称
    office_province:  String,
    office_city:      String,
    office_district:  String,
    office_address:   String,  // 详细地址
    business_license_url: String,  // MinIO URL
    main_species: [{ type: String }],  // 信息员：主营品种
    capacity_mu:  Number,              // 信息员：产能（亩）
    zitadel_org_id:      String,
    zitadel_instance_id: { type: String, default: '381066489660178661' },
    registration_id:     Number,  // PG new_ecommerce.peony_registrations.id
    status: { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
    approved_at: Date,
    submitted_at: Date,
  },
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
 * 把 payload 里的 longitude/latitude/location 三种入口形态统一到 location.coordinates。
 * 处理完后 payload 上不会残留 longitude/latitude。
 *   - 有效坐标 → location.coordinates=[lng,lat]
 *   - 无效 / 空 → location.coordinates=[0,0]（视为未设置）
 * 幂等，可反复调用。
 */
function normalizeGeoPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;

  let lng = null, lat = null;

  // 优先取 location.coordinates（唯一存储）
  if (payload.location && Array.isArray(payload.location.coordinates) && payload.location.coordinates.length === 2) {
    const [a, b] = payload.location.coordinates;
    if (isValidCoord(a, b)) { lng = a; lat = b; }
  }

  // 兼容旧入口：payload.longitude / latitude
  if (lng === null && payload.longitude != null && payload.latitude != null) {
    const a = Number(payload.longitude);
    const b = Number(payload.latitude);
    if (isValidCoord(a, b)) {
      lng = a; lat = b;
    } else if ((a !== 0 || b !== 0) && (Number.isNaN(a) || Number.isNaN(b) || a < -180 || a > 180 || b < -90 || b > 90)) {
      throw new Error(`Invalid coordinates: longitude=${payload.longitude}, latitude=${payload.latitude}`);
    }
  }

  // 无论如何都要把 longitude/latitude 从 payload 移除，杜绝再写入 DB
  delete payload.longitude;
  delete payload.latitude;

  if (lng !== null) {
    payload.location = { type: 'Point', coordinates: [lng, lat] };
  } else {
    const geoTouched = ('location' in payload) || arguments[1] === true; // arg2=forceReset
    if (geoTouched) {
      payload.location = { type: 'Point', coordinates: [0, 0] };
    }
  }
  return payload;
}

SupplierSchema.statics.normalizeGeoPayload = normalizeGeoPayload;
SupplierSchema.statics.isValidCoord = isValidCoord;

// pre-validate: 保存前归一化文档 geo 状态
SupplierSchema.pre('validate', function(next) {
  try {
    // 若因某种历史原因 doc 上还挂着 longitude/latitude（旧数据 hydrate），当作 payload 归一
    const payload = {};
    if (this.location && this.location.coordinates) {
      payload.location = { coordinates: this.location.coordinates };
    }
    // this.get('longitude') 拿 schema 外字段（strict:false 时可能存在），主动清理
    const stray_lng = this.get && this.get('longitude', null, { strict: false });
    const stray_lat = this.get && this.get('latitude', null, { strict: false });
    if (stray_lng != null) payload.longitude = stray_lng;
    if (stray_lat != null) payload.latitude  = stray_lat;

    normalizeGeoPayload(payload);
    if (payload.location) {
      this.location = { type: 'Point', coordinates: payload.location.coordinates };
    }
    // 清理 doc 上残留字段
    if (this.set) {
      this.set('longitude', undefined, { strict: false });
      this.set('latitude',  undefined, { strict: false });
    }
    next();
  } catch (e) { next(e); }
});

// pre-update: findOneAndUpdate / updateOne / updateMany 前归一化 $set + $unset
function normalizeUpdateHook(next) {
  try {
    const upd = this.getUpdate() || {};

    if (upd.$set) normalizeGeoPayload(upd.$set);
    if ('longitude' in upd || 'latitude' in upd || 'location' in upd) {
      normalizeGeoPayload(upd);
    }

    // 无论如何都清理掉可能残留的 longitude/latitude 字段
    upd.$unset = upd.$unset || {};
    upd.$unset.longitude = '';
    upd.$unset.latitude  = '';

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
