/**
 * migrate-drop-lng-lat.js
 *
 * 一次性迁移：从 supplier 集合彻底删除 longitude / latitude 字段。
 * 前置：数据已通过 hook 归一到 location.coordinates（migrate-geo.js 已跑过）。
 * 幂等：可反复运行，`$unset` 对不存在的字段是 no-op。
 *
 * 用法（在 supplier-service pod 或 host repo 目录下）：
 *   MONGODB_URI=... node scripts/migrate-drop-lng-lat.js
 */
const mongoose = require('mongoose');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI env required');
  await mongoose.connect(uri);
  const coll = mongoose.connection.collection('supplier');

  const total = await coll.countDocuments();
  const before = await coll.countDocuments({ $or: [{ longitude: { $exists: true } }, { latitude: { $exists: true } }] });

  const r = await coll.updateMany(
    { $or: [{ longitude: { $exists: true } }, { latitude: { $exists: true } }] },
    { $unset: { longitude: '', latitude: '' } }
  );

  const after = await coll.countDocuments({ $or: [{ longitude: { $exists: true } }, { latitude: { $exists: true } }] });

  console.log(JSON.stringify({
    total,
    hadFieldBefore: before,
    matched: r.matchedCount,
    modified: r.modifiedCount,
    hasFieldAfter: after,
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
