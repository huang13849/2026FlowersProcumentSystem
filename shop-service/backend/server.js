require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { createShopModel } = require('./models/Shop');
const shopRoutes = require('./routes/shops');
const uploadRoutes = require('./routes/upload');
const app = express();
const PORT = process.env.PORT || 3004;

// Use MONGO_WRITE_URI for primary, MONGO_READ_URI for replica reads
const MONGO_WRITE_URI = process.env.MONGO_WRITE_URI || process.env.MONGO_URI || 'mongodb://100.67.126.90:27017/supply_chain';
const MONGO_READ_URI = process.env.MONGO_READ_URI || MONGO_WRITE_URI;

app.use(cors());
app.use(express.json({ limit: '50mb' }));  // large limit for base64 images
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

// MongoDB connections (read/write split)
const writeConnection = mongoose.createConnection(MONGO_WRITE_URI);
const readConnection = mongoose.createConnection(MONGO_READ_URI);

app.locals.ShopWrite = createShopModel(writeConnection);
app.locals.ShopRead = createShopModel(readConnection);

Promise.all([writeConnection.asPromise(), readConnection.asPromise()])
  .then(() => {
    console.log('MongoDB write connection ready');
    console.log('MongoDB read connection ready');
    app.listen(PORT, '0.0.0.0', () => {
      console.log('Shop service running on http://0.0.0.0:' + PORT);
    });
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });