/**
 * CRM Service - 营销运营领域
 * Port: 3019  NodePort: 31019
 *
 * 职责: crm_campaigns / crm_coupons / crm_parking (Mongo)
 *
 * Endpoints:
 *   GET/POST/PUT/DELETE  /crm/campaigns[/:id]
 *   GET/POST/PUT/DELETE  /crm/coupons[/:id]
 *   GET/POST/PUT/DELETE  /crm/parking[/:id]
 *   GET   /health
 */
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const { connectAll } = require('./services/connections');

const app = express();
app.disable('x-powered-by');
app.use(cors());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));

app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

app.use('/crm', require('./routes/crm'));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'crm-service', ts: new Date().toISOString() });
});

const PORT = process.env.PORT || 3019;
connectAll().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`📣 crm-service listening on :${PORT}`);
  });
}).catch(err => {
  console.error('❌ startup failed:', err.message);
  process.exit(1);
});
