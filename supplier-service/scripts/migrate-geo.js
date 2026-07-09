#!/usr/bin/env node
/**
 * 一次性迁移：把散落在 longitude/latitude 的经纬度回填到 location.coordinates
 * 幂等，可反复执行。
 *
 *   node scripts/migrate-geo.js
 *
 * 环境变量：MONGODB_URI (必填, 需带 admin 认证)
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { SupplierSchema, normalizeGeoPayload, isValidCoord } = require('../models/Supplier');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI required');
  const conn = await mongoose.createConnection(uri).asPromise();
  const Supplier = conn.model('Supplier', SupplierSchema);

  const total = await Supplier.countDocuments();
  let fixed = 0, cleared = 0, ok = 0, skipped = 0;

  const cursor = Supplier.find({}, { longitude:1, latitude:1, location:1 }).cursor();
  for await (const doc of cursor) {
    const lng = doc.longitude, lat = doc.latitude;
    const coords = doc.location?.coordinates || [0,0];
    const [cLng, cLat] = coords;
    const flatValid = isValidCoord(lng, lat);
    const geoValid = isValidCoord(cLng, cLat);

    if (flatValid && geoValid && cLng === lng && cLat === lat) { ok++; continue; }

    if (flatValid) {
      // 用平铺坐标回填 location（主字段）
      await Supplier.updateOne(
        { _id: doc._id },
        { $set: { location: { type: 'Point', coordinates: [lng, lat] } } }
      );
      fixed++;
    } else if (geoValid) {
      // location 有效但派生字段丢了 —— 让 hook 归一
      await Supplier.updateOne({ _id: doc._id }, { $set: { location: { type: 'Point', coordinates: [cLng, cLat] } } });
      fixed++;
    } else if (cLng !== 0 || cLat !== 0 || lng != null || lat != null) {
      // 都无效但字段被脏数据污染 —— 清零
      await Supplier.updateOne(
        { _id: doc._id },
        { $set: { longitude: null, latitude: null, location: { type: 'Point', coordinates: [0, 0] } } }
      );
      cleared++;
    } else {
      skipped++;
    }
  }

  console.log(JSON.stringify({ total, ok, fixed, cleared, skipped }, null, 2));
  await conn.close();
}

main().catch(e => { console.error(e); process.exit(1); });
