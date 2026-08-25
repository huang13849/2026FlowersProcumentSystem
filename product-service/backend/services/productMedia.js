import { getPgPool } from '../config/db.js';
import { deleteFile } from './minio.js';

export const PRODUCT_MEDIA_FIELDS = [
  'images', 'panorama_images', 'package_images', 'detail_images',
  'root_soil_images', 'size_ref_images', 'scene_images', 'selling_point_images',
  'care_images', 'comparison_images', 'shipping_images', 'after_sale_images',
  'product_videos',
];

function urlsFromProduct(product) {
  const urls = new Set();
  for (const field of PRODUCT_MEDIA_FIELDS) {
    for (const url of product?.[field] || []) {
      if (typeof url === 'string' && url) urls.add(url);
    }
  }
  return urls;
}

export async function deleteIfUnreferenced(url) {
  if (!url) return { deleted: false, reason: 'missing-url' };

  const pool = getPgPool();
  const predicates = PRODUCT_MEDIA_FIELDS.map((field) => '$1 = ANY(' + field + ')').join(' OR ');
  const { rowCount } = await pool.query(
    'SELECT 1 FROM public.products WHERE ' + predicates + ' LIMIT 1',
    [url],
  );

  if (rowCount) return { deleted: false, reason: 'still-referenced' };
  await deleteFile(url);
  return { deleted: true };
}

export async function cleanupRemovedMedia(previous, next) {
  const before = urlsFromProduct(previous);
  const after = urlsFromProduct(next);
  const results = [];
  for (const url of before) {
    if (!after.has(url)) results.push(await deleteIfUnreferenced(url));
  }
  return results;
}

export function productMediaUrls(product) {
  return urlsFromProduct(product);
}
