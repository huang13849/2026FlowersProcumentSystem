/**
 * System Test —— 供应商经纬度统一性
 *
 * 覆盖：
 *   1. 只传 longitude/latitude → location.coordinates 自动同步
 *   2. 只传 location.coordinates → longitude/latitude 自动同步
 *   3. (0,0) 视为未设置 → longitude=null, latitude=null
 *   4. 非法坐标抛错
 *   5. 2dsphere $near 查询命中
 *   6. 静态扫描 guard —— 除 services/ models/ scripts/ 外，禁止直接读写 .longitude / .latitude / location.coordinates
 *
 * 运行：
 *   MONGODB_URI="mongodb://.../supply_chain_test?..." node --test tests/system/supplier.geo.test.mjs
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

describe('geo unification', () => {

  test('flat lng/lat 写入自动同步到 location.coordinates', async () => {
    const s = await svc.create({ name: 'A', longitude: 116.3974, latitude: 39.9093 });
    const got = await svc.get(s._id);
    assert.equal(got.longitude, 116.3974);
    assert.equal(got.latitude, 39.9093);
    assert.deepEqual(got.location.coordinates, [116.3974, 39.9093]);
    assert.equal(got.location.type, 'Point');
  });

  test('location.coordinates 写入自动同步到 flat lng/lat', async () => {
    const s = await svc.create({
      name: 'B',
      location: { type: 'Point', coordinates: [121.4737, 31.2304] }
    });
    const got = await svc.get(s._id);
    assert.equal(got.longitude, 121.4737);
    assert.equal(got.latitude, 31.2304);
    assert.deepEqual(got.location.coordinates, [121.4737, 31.2304]);
  });

  test('(0,0) 视为未设置', async () => {
    const s = await svc.create({ name: 'C', longitude: 0, latitude: 0 });
    const got = await svc.get(s._id);
    assert.equal(got.longitude, null);
    assert.equal(got.latitude, null);
    assert.deepEqual(got.location.coordinates, [0, 0]);
  });

  test('update 时通过 setGeo 也生效', async () => {
    const s = await svc.create({ name: 'D' });
    await svc.setGeo(s._id, { longitude: 113.2644, latitude: 23.1291 });
    const got = await svc.get(s._id);
    assert.deepEqual(got.location.coordinates, [113.2644, 23.1291]);
  });

  test('非法坐标抛错', async () => {
    await assert.rejects(
      () => svc.create({ name: 'E', longitude: 200, latitude: 39 }),
      /Invalid coordinates/
    );
  });

  test('2dsphere $near 能命中', async () => {
    // 北京
    await svc.create({ name: 'BJ', longitude: 116.4, latitude: 39.9 });
    // 上海
    await svc.create({ name: 'SH', longitude: 121.5, latitude: 31.2 });
    // 在北京附近 5 公里查
    const near = await svc.findNear({ longitude: 116.41, latitude: 39.91, maxMeters: 5000, limit: 5 });
    const names = near.map(x => x.name);
    assert.ok(names.includes('BJ'), '北京供应商应该被查到');
    assert.ok(!names.includes('SH'), '上海供应商不应被查到');
  });

  test('normalizeGeoPayload 幂等', () => {
    const p = { longitude: 116.4, latitude: 39.9 };
    normalizeGeoPayload(p);
    const before = JSON.stringify(p);
    normalizeGeoPayload(p);
    normalizeGeoPayload(p);
    assert.equal(JSON.stringify(p), before);
  });

});

describe('static guard - 防止分裂', () => {

  test('业务代码不得直接读写 .longitude / .latitude / location.coordinates', () => {
    // 只扫业务层，允许的目录：services/, models/, scripts/, tests/, frontend/ (前端展示)
    const r = spawnSync('grep', [
      '-rEn',
      '(\\.longitude|\\.latitude|location\\.coordinates)',
      '--include=*.js',
      'routes/', 'controllers/'
    ], { cwd: ROOT, encoding: 'utf8' });
    // grep exit 1 = no match, exit 0 = matched, exit 2 = error
    if (r.status === 2) throw new Error('grep failed: ' + r.stderr);
    const out = r.stdout || '';
    // 允许的例外：
    //   - geocode 接口返回 (不写 DB)
    //   - 注释行 (// 或 * )
    const violations = out.split('\n').filter(l => {
      if (!l) return false;
      if (/geocode/.test(l)) return false;
      // 提取 "path:lineno:content" 里的 content
      const m = l.match(/^[^:]+:\d+:(.*)$/);
      const content = m ? m[1] : l;
      if (/^\s*(\/\/|\*)/.test(content)) return false;
      return true;
    });
    assert.equal(violations.length, 0,
      `业务代码检测到直接使用经纬度字段, 请改走 SupplierService:\n${violations.join('\n')}`);
  });

});
