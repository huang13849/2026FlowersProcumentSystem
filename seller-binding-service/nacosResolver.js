const NACOS_BASE_URL = (process.env.NACOS_BASE_URL || 'http://nacos.nacos.svc.cluster.local:8848').replace(/\/+$/, '');
const NACOS_CACHE_TTL_MS = Number(process.env.NACOS_CACHE_TTL_MS || 30000);
const cache = new Map();

function normalizeBase(url) {
  return String(url || '').replace(/\/+$/, '');
}

async function resolveServiceBase({ serviceName, fallbackUrl, protocol = 'http' }) {
  const fallback = normalizeBase(fallbackUrl);
  if (process.env.NACOS_ENABLED === 'false' || !serviceName) return fallback;
  const now = Date.now();
  const cached = cache.get(serviceName);
  if (cached && cached.expiresAt > now) return cached.base;
  try {
    const url = `${NACOS_BASE_URL}/nacos/v3/client/ns/instance/list?serviceName=${encodeURIComponent(serviceName)}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!resp.ok) throw new Error(`status=${resp.status}`);
    const data = await resp.json();
    const list = Array.isArray(data.data) ? data.data : [];
    const picked = list.find(x => x.enabled && x.healthy) || list.find(x => x.enabled) || list[0];
    if (picked && picked.ip && picked.port) {
      const base = `${protocol}://${picked.ip}:${picked.port}`;
      cache.set(serviceName, { base, expiresAt: now + NACOS_CACHE_TTL_MS });
      return base;
    }
  } catch (err) {
    console.warn(`[nacos] resolve failed for ${serviceName}: ${err.message}`);
  }
  return fallback;
}

module.exports = { resolveServiceBase };
