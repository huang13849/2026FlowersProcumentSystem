/**
 * BFF /api/crm — 直接转发到 crm-service
 */
const express = require('express');
const router = express.Router();
const { resolveServiceBase } = require('../services/nacosResolver');
const CRM_URL = process.env.CRM_URL || 'http://crm-service.supply-chain.svc.cluster.local:3019';
const CRM_SERVICE_NAME = process.env.CRM_SERVICE_NAME || 'k8s.supply-chain.crm-service';

router.all('*', async (req, res) => {
  try {
    const base = await resolveServiceBase({ serviceName: CRM_SERVICE_NAME, fallbackUrl: CRM_URL });
    const url = `${base}/crm${req.path}${req._parsedUrl && req._parsedUrl.search ? req._parsedUrl.search : ''}`;
    const opts = { method: req.method, headers: { 'Content-Type': 'application/json' } };
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.body && Object.keys(req.body).length) {
      opts.body = JSON.stringify(req.body);
    }
    const r = await fetch(url, opts);
    const text = await r.text();
    res.status(r.status);
    try { res.json(JSON.parse(text)); } catch { res.type('text').send(text); }
  } catch (err) {
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
