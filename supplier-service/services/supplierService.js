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
  async list({ search, status } = {}) {
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
    return this.W.create(body);
  }

  async update(id, patch) {
    return this.W.findByIdAndUpdate(id, patch, { new: true, runValidators: true });
  }

  async remove(id) {
    await this.W.findByIdAndDelete(id);
    return { message: 'Deleted' };
  }

  // ── Geo 专用入口 ──
  async setGeo(id, { longitude, latitude }) {
    return this.update(id, { longitude, latitude });
  }

  async findNear({ longitude, latitude, maxMeters = 50000, limit = 20 }) {
    return this.R.find({
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [longitude, latitude] },
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
