// server.js - PG only, MongoDB removed
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const shopRoutes = require('./routes/shops');
const uploadRoutes = require('./routes/upload');
const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist/index.html'));
});

// API Routes
app.use('/api/shops', shopRoutes);
app.use('/api/upload', uploadRoutes);
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'shop-service', time: new Date().toISOString() });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Shop service running on http://0.0.0.0:${PORT} (PG mode)`);
});
