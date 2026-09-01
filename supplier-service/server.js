// server.js - PG only, MongoDB removed
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Supplier } = require('./models/Supplier');
const supplierRoutes = require('./routes/supplier');
const uploadRoutes = require('./routes/upload');
const internetSuppliersRoutes = require('./routes/internetSuppliers');
const peonyAllianceRoutes = require('./routes/peonyAlliance');
const supplierApplicationsRoutes = require('./routes/supplierApplications');
const { ensureTable } = require('./services/supplierApplications');
const { startSupplierApplicationConsumer } = require('./services/supplierApplicationNats');

const app = express();
const PORT = process.env.PORT || 3002;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'frontend/dist/index.html')); });

app.use('/api/suppliers', supplierRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/internet-suppliers', internetSuppliersRoutes);
app.use('/api/peony-alliance', peonyAllianceRoutes);
app.use('/api/supplier-applications', supplierApplicationsRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'supplier-service', time: new Date().toISOString() });
});

// Inject Supplier model into app.locals (replacing mongoose connections)
app.locals.SupplierWrite = Supplier;
app.locals.SupplierRead = Supplier;

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`Supplier service running on http://0.0.0.0:${PORT} (PG mode)`);
  try { await ensureTable(); await startSupplierApplicationConsumer(); }
  catch (error) { console.warn('[supplier-applications] NATS consumer skipped:', error.message); }
});
