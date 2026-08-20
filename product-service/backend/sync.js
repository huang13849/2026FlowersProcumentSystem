import { Router } from 'express';
import axios from 'axios';

const router = Router();

const FLOWER_SYNC_BASE_URL = (
  process.env.FLOWER_PRICE_SYNC_API_URL ||
  'http://flower-price-sync-api.supply-chain.svc.cluster.local:3053'
).replace(/\/$/, '');
const FLOWER_PRICE_API_BASE_URL = (
  process.env.FLOWER_PRICE_WATCHLIST_URL ||
  'http://flower-price-service.flower-price.svc.cluster.local:3030'
).replace(/\/$/, '');

async function proxy(req, res, path, baseUrl = FLOWER_SYNC_BASE_URL) {
  try {
    const response = await axios({
      method: req.method,
      url: `${baseUrl}${path}`,
      params: req.query,
      data: req.body,
      timeout: 30000,
      headers: {
        'content-type': req.headers['content-type'] || 'application/json',
      },
      validateStatus: () => true,
    });
    res.status(response.status).json(response.data);
  } catch (error) {
    const message = error.response?.data?.message || error.message || 'sync proxy failed';
    res.status(502).json({ code: 502, message });
  }
}

function normalizeWatchlistPayload(payload) {
  const sourceItems = Array.isArray(payload?.items)
    ? payload.items
    : (Array.isArray(payload?.data) ? payload.data : null);
  if (!payload || !sourceItems) return payload;
  const items = sourceItems.map((item) => {
    const origin = item.origin_province ?? item.province ?? '';
    const itemKey = [
      item.sub_category,
      item.flower_standard || '',
      item.flower_level || '',
      origin || '',
    ].join('|');
    const shortLabel = [
      item.sub_category,
      item.flower_standard,
      item.flower_level,
      origin,
    ].filter(Boolean).join('·');
    return {
      ...item,
      origin_province: origin,
      item_key: item.item_key || itemKey,
      short_label: item.short_label || shortLabel || itemKey,
    };
  });
  return {
    ...payload,
    items,
    data: items,
  };
}

router.get('/watchlist', async (req, res) => {
  try {
    const response = await axios({
      method: 'GET',
      url: `${FLOWER_PRICE_API_BASE_URL}/api/watchlist`,
      params: req.query,
      timeout: 30000,
      validateStatus: () => true,
    });
    res.status(response.status).json(normalizeWatchlistPayload(response.data));
  } catch (error) {
    const message = error.response?.data?.message || error.message || 'watchlist proxy failed';
    res.status(502).json({ code: 502, message });
  }
});
router.get('/products', (req, res) => proxy(req, res, '/api/sync/products'));
router.get('/log', (req, res) => proxy(req, res, '/api/sync/log'));
router.post('/run', (req, res) => proxy(req, res, '/api/sync/run'));
router.post('/bind', (req, res) => proxy(req, res, '/api/sync/bind'));
router.post('/unbind', (req, res) => proxy(req, res, '/api/sync/unbind'));
router.post('/sync/bind', (req, res) => proxy(req, res, '/api/sync/bind'));
router.post('/sync/unbind', (req, res) => proxy(req, res, '/api/sync/unbind'));
router.post('/publish', (req, res) => proxy(req, res, '/api/sync/publish'));

export default router;
