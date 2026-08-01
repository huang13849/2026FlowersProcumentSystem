/**
 * BFF /api/orders — 订单聚合层
 * 前端从 nginx-gateway :8088 走, 后端聚合 order-service + purchase-list-service + contract-service
 *
 * 上游:
 *   ORDER_URL:         http://order-service.supply-chain.svc.cluster.local:3000
 *   PURCHASE_LIST_URL: http://purchase-list-service.supply-chain.svc.cluster.local:3000
 *   CONTRACT_URL:      http://contract-service.supply-chain.svc.cluster.local:3000
 */
const express = require('express');
const router = express.Router();
const { resolveServiceBase } = require('../services/nacosResolver');

const ORDER_URL         = process.env.ORDER_URL         || 'http://order-service.supply-chain.svc.cluster.local:3000';
const PURCHASE_LIST_URL = process.env.PURCHASE_LIST_URL || 'http://purchase-list-service.supply-chain.svc.cluster.local:3000';
const CONTRACT_URL      = process.env.CONTRACT_URL      || 'http://contract-service.supply-chain.svc.cluster.local:3000';
const ORDER_SERVICE_NAME = process.env.ORDER_SERVICE_NAME || 'k8s.supply-chain.order-service';
const PURCHASE_LIST_SERVICE_NAME = process.env.PURCHASE_LIST_SERVICE_NAME || 'k8s.supply-chain.purchase-list-service';
const CONTRACT_SERVICE_NAME = process.env.CONTRACT_SERVICE_NAME || 'k8s.supply-chain.contract-service';

async function resolveOrderBase() { return resolveServiceBase({ serviceName: ORDER_SERVICE_NAME, fallbackUrl: ORDER_URL }); }
async function resolvePurchaseListBase() { return resolveServiceBase({ serviceName: PURCHASE_LIST_SERVICE_NAME, fallbackUrl: PURCHASE_LIST_URL }); }
async function resolveContractBase() { return resolveServiceBase({ serviceName: CONTRACT_SERVICE_NAME, fallbackUrl: CONTRACT_URL }); }

async function proxy(req, res, resolveBase, pathPrefix = '/api/orders') {
  const base = await resolveBase();
  const url = `${base}${pathPrefix}${req.url === '/' ? '' : req.url}`;
  try {
    const opts = {
      method: req.method,
      headers: { 'Content-Type': 'application/json' },
    };
    if (['POST','PUT','PATCH','DELETE'].includes(req.method) && req.body && Object.keys(req.body).length) {
      opts.body = JSON.stringify(req.body);
    }
    const r = await fetch(url, opts);
    const text = await r.text();
    res.status(r.status);
    try { res.json(JSON.parse(text)); }
    catch { res.send(text); }
  } catch (e) {
    res.status(502).json({ error: 'upstream_failed', detail: e.message, url });
  }
}

// ---- 聚合端点 ----

// GET /api/orders/summary — 一次拉订单 + 采购单 + 合同 三个数量, 前端 dashboard 用
router.get('/summary', async (req, res) => {
  try {
    const [o, p, c] = await Promise.all([
      resolveOrderBase().then(base => fetch(`${base}/api/orders?limit=1&page=1`).then(r=>r.json())).catch(()=>({total:0})),
      resolvePurchaseListBase().then(base => fetch(`${base}/api/purchase-lists?limit=1`).then(r=>r.json())).catch(()=>({total:0})),
      resolveContractBase().then(base => fetch(`${base}/api/contracts?limit=1`).then(r=>r.json())).catch(()=>({total:0})),
    ]);
    res.json({
      orders:         o.total ?? o.count ?? 0,
      purchase_lists: p.total ?? p.count ?? (Array.isArray(p) ? p.length : 0),
      contracts:      c.total ?? c.count ?? (Array.isArray(c) ? c.length : 0),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET/POST/PUT/DELETE /api/orders/* → order-service /api/orders/*
router.all('/*', (req, res) => proxy(req, res, resolveOrderBase, '/api/orders'));
router.all('/',  (req, res) => proxy(req, res, resolveOrderBase, '/api/orders'));

module.exports = router;
