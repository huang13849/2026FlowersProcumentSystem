/**
 * System Test —— 供应商经纬度 v2·单字段
 *
 * 铁律：
 *   - location.coordinates 是唯一存储
 *   - longitude/latitude 从 schema 移除；作为入口兼容层被 hook 归一后不落库
 *   - 读取方通过 doc.location.coordinates 或 SupplierService.toGeoView(doc) 取
 *
 * 运行：
 *   TEST_MONGODB_URI="mongodb://.../supply_chain_test?..." node --test tests/system/
 */

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { SupplierSchema, isValidCoord, normalizeGeoPayload } = require('../../models/Supplier');
const { SupplierService } = require('../../services/supplierService');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const URI = process.env.TEST_MONGODB_URI || process.env.MONGODB_URI;
if (!URI) {
  console.error('TEST_MONGODB_URI or MONGODB_URI required');
  process.exit(2);
}

let conn, Supplier, svc;

before(async () => {
  conn = await mongoose.createConnection(URI).asPromise();
  Supplier = conn.model('SupplierGeoTest', SupplierSchema, 'supplier_geo_test');
  await Supplier.deleteMany({});
  await Supplier.syncIndexes();
  svc = new SupplierService({ readModel: Supplier, writeModel: Supplier });
});

after(async () => {
  if (Supplier) await Supplier.deleteMany({});
  if (conn) await conn.close();
});

describe('geo unification v2 - 单字段', () => {

  test('传入 lng/lat 兼容入口, 归一到 location.coordinates, DB 里无 longitude/latitude', async () => {
    const s = await svc.create({ name: 'A', longitude: 116.3974, latitude: 39.9093 });
    // 原始 DB 文档
    const raw = await Supplier.collection.findOne({ _id: s._id });
    assert.deepEqual(raw.location.coordinates, [116.3974, 39.9093]);
    assert.equal(raw.longitude, undefined, 'DB 里不应有 longitude 字段');
    assert.equal(raw.latitude,  undefined, 'DB 里不应有 latitude 字段');
  });

  test('传入 location.coordinates 直接落库', async () => {
    const s = await svc.create({
      name: 'B',
      location: { type: 'Point', coordinates: [121.4737, 31.2304] }
    });
    const got = await svc.get(s._id);
    assert.deepEqual(got.location.coordinates, [121.4737, 31.2304]);
  });

  test('(0,0) 视为未设置', async () => {
    const s = await svc.create({ name: 'C', longitude: 0, latitude: 0 });
    const got = await svc.get(s._id);
    assert.deepEqual(got.location.coordinates, [0, 0]);
    const view = SupplierService.toGeoView(got);
    assert.equal(view.hasGeo, false);
    assert.equal(view.lng, null);
  });

  test('setGeo 只写 location, 不再接受旧字段名', async () => {
    const s = await svc.create({ name: 'D' });
    await svc.setGeo(s._id, { lng: 113.2644, lat: 23.1291 });
    const raw = await Supplier.collection.findOne({ _id: s._id });
    assert.deepEqual(raw.location.coordinates, [113.2644, 23.1291]);
    assert.equal(raw.longitude, undefined);
    assert.equal(raw.latitude,  undefined);
  });

  test('setGeo 兼容旧 key longitude/latitude', async () => {
    const s = await svc.create({ name: 'D2' });
    await svc.setGeo(s._id, { longitude: 114.06, latitude: 22.54 });
    const raw = await Supplier.collection.findOne({ _id: s._id });
    assert.deepEqual(raw.location.coordinates, [114.06, 22.54]);
  });

  test('非法坐标抛错', async () => {
    await assert.rejects(
      () => svc.create({ name: 'E', longitude: 200, latitude: 39 }),
      /Invalid coordinates/
    );
  });

  test('2dsphere $near 能命中', async () => {
    await svc.create({ name: 'BJ', location: { type: 'Point', coordinates: [116.4, 39.9] } });
    await svc.create({ name: 'SH', location: { type: 'Point', coordinates: [121.5, 31.2] } });
    const near = await svc.findNear({ lng: 116.41, lat: 39.91, maxMeters: 5000, limit: 5 });
    const names = near.map(x => x.name);
    assert.ok(names.includes('BJ'));
    assert.ok(!names.includes('SH'));
  });

  test('toGeoView 提取对外视图', () => {
    const doc = { location: { type: 'Point', coordinates: [116.4, 39.9] } };
    const v = SupplierService.toGeoView(doc);
    assert.equal(v.lng, 116.4);
    assert.equal(v.lat, 39.9);
    assert.equal(v.hasGeo, true);
    assert.deepEqual(v.geojson, { type: 'Point', coordinates: [116.4, 39.9] });
  });

  test('normalizeGeoPayload 会 delete longitude/latitude', () => {
    const p = { longitude: 116.4, latitude: 39.9, name: 'X' };
    normalizeGeoPayload(p);
    assert.equal('longitude' in p, false);
    assert.equal('latitude'  in p, false);
    assert.deepEqual(p.location.coordinates, [116.4, 39.9]);
    // 幂等
    normalizeGeoPayload(p);
    normalizeGeoPayload(p);
    assert.deepEqual(p.location.coordinates, [116.4, 39.9]);
  });

});

describe('static guard - 防止分裂', () => {

  test('业务代码不得直接读写 .longitude / .latitude / location.coordinates', () => {
    // 只扫业务层
    const r = spawnSync('grep', [
      '-rEn',
      '(\\.longitude|\\.latitude|location\\.coordinates)',
      '--include=*.js',
      'routes/', 'controllers/'
    ], { cwd: ROOT, encoding: 'utf8' });
    if (r.status === 2) throw new Error('grep failed: ' + r.stderr);
    const out = r.stdout || '';
    const violations = out.split('\n').filter(l => {
      if (!l) return false;
      if (/geocode/.test(l)) return false;
      const m = l.match(/^[^:]+:\d+:(.*)$/);
      const content = m ? m[1] : l;
      if (/^\s*(\/\/|\*)/.test(content)) return false;
      return true;
    });
    assert.equal(violations.length, 0,
      `业务代码检测到直接使用经纬度字段, 请改走 SupplierService:\n${violations.join('\n')}`);
  });

});
