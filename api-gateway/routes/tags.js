const express = require('express');
const router = express.Router();
const { resolveServiceBase } = require('../services/nacosResolver');

const DEFAULT_URL = 'http://tag-api-service.supply-chain.svc.cluster.local:31017';
const TAG_API_SERVICE_NAME = process.env.TAG_API_SERVICE_NAME || 'k8s.supply-chain.tag-api-service';
const BASE = (process.env.TAG_API_URL || DEFAULT_URL).replace(/\/+$/, '');

async function proxy(req, res) {
  try {
    const base = await resolveServiceBase({ serviceName: TAG_API_SERVICE_NAME, fallbackUrl: BASE });
    const url = new URL(req.originalUrl, base);
    const headers = { 'content-type': 'application/json' };
    if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key'];
    const init = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body || {});
    }
    const response = await fetch(url, init);
    const text = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json; charset=utf-8';
    res.status(response.status);
    res.setHeader('content-type', contentType);
    res.send(text);
  } catch (error) {
    console.error('[tags-proxy]', error.message);
    res.status(error.status || 502).json({ success: false, error: error.message || 'tag-api-service unavailable' });
  }
}

router.get('/', proxy);
router.get('/tree', proxy);
router.post('/', proxy);
router.post('/apply', proxy);
router.patch('/:name', proxy);
router.delete('/:name', proxy);
router.get('/:name/count', proxy);

module.exports = router;
