import Product from '../models/Product.js';
import { deleteFile, listFiles, objectKeyFromUrl } from '../services/minio.js';
import { productMediaUrls } from '../services/productMedia.js';

const execute = process.argv.includes('--execute');
const graceDays = Number(process.env.MINIO_ORPHAN_GRACE_DAYS || 7);
const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000;

const products = await Product.find({});
const referencedKeys = new Set();
for (const product of products) {
  for (const url of productMediaUrls(product)) {
    const key = objectKeyFromUrl(url);
    if (key) referencedKeys.add(key);
  }
}

const objects = await listFiles('products');
const candidates = objects.filter((object) =>
  !referencedKeys.has(object.key) && new Date(object.lastModified).getTime() < cutoff,
);

let deleted = 0;
if (execute) {
  for (const object of candidates) {
    await deleteFile(object.url);
    deleted += 1;
  }
}

console.log(JSON.stringify({
  mode: execute ? 'execute' : 'dry-run',
  graceDays,
  productCount: products.length,
  objectCount: objects.length,
  referencedObjectCount: referencedKeys.size,
  candidateCount: candidates.length,
  candidateBytes: candidates.reduce((total, object) => total + (object.size || 0), 0),
  deleted,
  sampleKeys: candidates.slice(0, 20).map((object) => object.key),
}, null, 2));
