/**
 * product-api-service HTTP client（供 api-gateway 内部使用）
 * 目标：把 api-gateway 里所有对 Mongo `products` collection 的直连调用
 *      收拢到 product-api-service，为后续切 PG 做准备。
 *
 * 环境变量：
 *   PRODUCT_API_URL   缺省 http://product-api-service.supply-chain.svc.cluster.local:3000
 */
const DEFAULT_URL = 'http://product-api-service.supply-chain.svc.cluster.local:3000';
const BASE = (process.env.PRODUCT_API_URL || DEFAULT_URL).replace(/\/+$/, '');

async function req(path, opts = {}) {
  const url = BASE + path;
  const init = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' } };
  if (opts.body != null) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs || 15000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  init.signal = controller.signal;
  try {
    const r = await fetch(url, init);
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!r.ok) {
      const err = new Error(`[product-api] ${r.status} ${url}: ${data.error || text || ''}`);
      err.status = r.status; err.body = data; throw err;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// —— sceneTags 使用计数：Mongo db.products.countDocuments({sceneTags: name}) ——
// product-api-service /api/products?sceneTags=<name>&limit=1 返回 total
async function countBySceneTag(name) {
  const url = `/api/products?limit=1&sceneTags=${encodeURIComponent(name)}`;
  const data = await req(url);
  return Number(data.total || 0);
}

// —— 批量打场景标签（mode: add|remove|set） ——
// product-api-service POST /api/products/batch { ids, action, data:{tags} }
async function applySceneTags({ ids, tags, mode }) {
  const action = mode === 'remove' ? 'remove_tags' : (mode === 'set' ? 'set_tags' : 'add_tags');
  const data = await req('/api/products/batch', { method: 'POST', body: { ids, action, data: { tags } } });
  return { updated: data.modifiedCount || 0 };
}

// —— 标签从所有商品剥离（DELETE tag 场景） ——
async function detachTagFromAll(name) {
  // 找出所有含该 tag 的商品 id
  const found = await req(`/api/products?limit=10000&fields=_id,sceneTags&sceneTags=${encodeURIComponent(name)}`);
  const list = Array.isArray(found.products) ? found.products : [];
  if (!list.length) return { updated: 0 };
  const ids = list.map(p => String(p._id));
  return applySceneTags({ ids, tags: [name], mode: 'remove' });
}

// —— 单个商品详情（unified 用） ——
async function getProduct(id) {
  try {
    return await req(`/api/products/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e.status === 404) return null;
    throw e;
  }
}

module.exports = { BASE, req, countBySceneTag, applySceneTags, detachTagFromAll, getProduct };
