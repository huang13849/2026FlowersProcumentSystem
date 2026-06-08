import Redis from 'ioredis'

let client = null
let lastWarn = 0

function makeClient() {
  const host = process.env.REDIS_HOST || 'redis'
  const port = Number(process.env.REDIS_PORT || 6379)
  const c = new Redis({
    host, port,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (times) => Math.min(times * 500, 5000),
  })
  c.on('error', (e) => {
    const now = Date.now()
    if (now - lastWarn > 30000) {
      console.warn('[redis] error:', e.code || e.message)
      lastWarn = now
    }
  })
  c.connect().catch(() => {})
  return c
}

export function getRedis() {
  if (!client) client = makeClient()
  return client
}

export async function cacheGet(key) {
  try {
    const r = getRedis()
    if (r.status !== 'ready') return null
    const v = await r.get(key)
    return v ? JSON.parse(v) : null
  } catch { return null }
}

export async function cacheSet(key, value, ttlSec = 300) {
  try {
    const r = getRedis()
    if (r.status !== 'ready') return
    await r.set(key, JSON.stringify(value), 'EX', ttlSec)
  } catch {}
}

export async function cacheStatus() {
  try {
    const r = getRedis()
    return { status: r.status, host: r.options.host, port: r.options.port }
  } catch (e) { return { status: 'error', error: e.message } }
}
