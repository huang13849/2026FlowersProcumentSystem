const { mirrorUpsert, mirrorDelete } = require('./supplyChainPg');
// ─────────────────────────────────────────────────────────────
// SupplierService —— 供应商唯一 CRUD 入口
//
// 【规则】
//   1. 所有对 supplier 集合的读写都走本模块，禁止在 route/controller 里直连 Model
//   2. 经纬度处理已下沉到 model hook (normalizeGeoPayload)，本层只负责业务编排
//   3. 本 service 作为「统一 CRUD 模板」，其他集合按同样模式复制即可
//
// 【依赖注入】
//   构造函数接收 { readModel, writeModel } —— 支持主从分离；
//   若只传一个 model，则读写共用。
// ─────────────────────────────────────────────────────────────

class SupplierService {
  constructor({ readModel, writeModel } = {}) {
    if (!readModel && !writeModel) throw new Error('SupplierService: model required');
    this.R = readModel || writeModel;
    this.W = writeModel || readModel;
  }

  // ── 列表 ──
  async list({ search, status, filterIds } = {}) {
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { shop_name: { $regex: search, $options: 'i' } },
        { 'contact.name': { $regex: search, $options: 'i' } },
        { 'company_info.tax_id': { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) query.status = status;
    if (Array.isArray(filterIds)) {
      if (filterIds.length === 0) return { suppliers: [], total: 0 };
      query._id = { $in: filterIds };
    }
    const data = await this.R.find(query).sort({ updatedAt: -1 });
    return { suppliers: data, total: data.length };
  }

  async get(id) {
    return this.R.findById(id);
  }

  async create(dto) {
    const body = { ...dto };
    if (body.sortOrder === undefined) {
      const last = await this.W.findOne().sort({ sortOrder: -1 }).select('sortOrder');
      body.sortOrder = (last?.sortOrder ?? 0) + 10;
    }
    const doc = await this.W.create(body);
    mirrorUpsert(doc.toObject ? doc.toObject() : doc).catch(()=>{});
    return doc;
  }

  async update(id, patch) {
    const doc = await this.W.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
    if (doc) mirrorUpsert(doc.toObject ? doc.toObject() : doc).catch(()=>{});
    return doc;
  }

  async remove(id) {
    await this.W.findByIdAndDelete(id);
    mirrorDelete(id).catch(()=>{});
    return { message: 'Deleted' };
  }

  // ── Geo 专用入口 ──
  /**
   * 唯一 geo 写入入口 —— 只写 location.coordinates
   * @param {string} id
   * @param {{lng:number,lat:number}|{longitude:number,latitude:number}} pos
   */
  async setGeo(id, pos = {}) {
    const lng = pos.lng ?? pos.longitude;
    const lat = pos.lat ?? pos.latitude;
    return this.update(id, { location: { type: 'Point', coordinates: [Number(lng), Number(lat)] } });
  }

  async clearGeo(id) {
    return this.update(id, { location: { type: 'Point', coordinates: [0, 0] } });
  }

  /**
   * 从 supplier doc 提取一份对外 geo 视图（其他应用调用用）
   * @returns {{lng:number|null, lat:number|null, hasGeo:boolean, geojson:object|null}}
   */
  static toGeoView(doc) {
    if (!doc) return { lng: null, lat: null, hasGeo: false, geojson: null };
    const coords = doc.location && Array.isArray(doc.location.coordinates) ? doc.location.coordinates : [0, 0];
    const [lng, lat] = coords;
    const hasGeo = !(lng === 0 && lat === 0) && typeof lng === 'number' && typeof lat === 'number';
    return {
      lng: hasGeo ? lng : null,
      lat: hasGeo ? lat : null,
      hasGeo,
      geojson: hasGeo ? { type: 'Point', coordinates: [lng, lat] } : null,
    };
  }

  async findNear({ longitude, latitude, lng, lat, maxMeters = 50000, limit = 20 }) {
    const x = lng ?? longitude;
    const y = lat ?? latitude;
    return this.R.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [Number(x), Number(y)] },
          $maxDistance: maxMeters
        }
      }
    }).limit(limit);
  }

  // ── 批量 ──
  async reorder(orders) {
    if (!Array.isArray(orders)) throw new Error('orders must be an array');
    const bulkOps = orders.map(({ id, sortOrder }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sortOrder } } }
    }));
    await this.W.bulkWrite(bulkOps);
    return { success: true, updated: orders.length };
  }

  async batchDelete(ids) {
    if (!Array.isArray(ids) || ids.length === 0) throw new Error('ids must be a non-empty array');
    const result = await this.W.deleteMany({ _id: { $in: ids } });
    Promise.all(ids.map(id => mirrorDelete(id))).catch(()=>{});
    return { success: true, deleted: result.deletedCount };
  }
}

// 工厂：从 express req 拿到已注入的 Model 后构造 service
function fromReq(req) {
  const R = req.app.locals.SupplierRead;
  const W = req.app.locals.SupplierWrite;
  if (!R && !W) {
    const { Supplier } = require('../models/Supplier');
    return new SupplierService({ readModel: Supplier, writeModel: Supplier });
  }
  return new SupplierService({ readModel: R, writeModel: W });
}

module.exports = { SupplierService, fromReq };
