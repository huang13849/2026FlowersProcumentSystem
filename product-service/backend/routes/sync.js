import { Router } from 'express';
import axios from 'axios';

const router = Router();

const FLOWER_SYNC_BASE_URL = (
  process.env.FLOWER_PRICE_SYNC_API_URL ||
  'http://flower-price-sync-api.supply-chain.svc.cluster.local:3053'
).replace(/\/$/, '');

async function proxy(req, res, path) {
  try {
    const response = await axios({
      method: req.method,
      url: `${FLOWER_SYNC_BASE_URL}${path}`,
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

router.get('/watchlist', (req, res) => proxy(req, res, '/api/watchlist'));
router.get('/products', (req, res) => proxy(req, res, '/api/sync/products'));
router.get('/log', (req, res) => proxy(req, res, '/api/sync/log'));
router.post('/run', (req, res) => proxy(req, res, '/api/sync/run'));
router.post('/bind', (req, res) => proxy(req, res, '/api/sync/bind'));
router.post('/unbind', (req, res) => proxy(req, res, '/api/sync/unbind'));
router.post('/publish', (req, res) => proxy(req, res, '/api/sync/publish'));

export default router;
