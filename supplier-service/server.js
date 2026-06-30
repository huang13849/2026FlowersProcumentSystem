require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const { createSupplierModel } = require('./models/Supplier');
const supplierRoutes = require('./routes/supplier');
const uploadRoutes = require('./routes/upload');
const internetSuppliersRoutes = require('./routes/internetSuppliers');
const app = express();
const PORT = process.env.PORT || 3002;
const MONGO_WRITE_URI = process.env.MONGO_WRITE_URI || process.env.MONGO_URI || 'mongodb://100.67.126.90:27017/supply_chain';
const MONGO_READ_URI = process.env.MONGO_READ_URI || MONGO_WRITE_URI;

app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use('/uploads', express.static(path.join(__dirname,'uploads')));
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'frontend/dist/index.html')); });
app.use('/api/suppliers', supplierRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/internet-suppliers', internetSuppliersRoutes);
app.get('/api/health', (req,res) => { res.json({status:'ok',service:'supplier-service',time:new Date().toISOString()}); });

const writeConnection = mongoose.createConnection(MONGO_WRITE_URI);
const readConnection = mongoose.createConnection(MONGO_READ_URI);

app.locals.SupplierWrite = createSupplierModel(writeConnection);
app.locals.SupplierRead = createSupplierModel(readConnection);

Promise.all([writeConnection.asPromise(), readConnection.asPromise()])
  .then(()=>{
    console.log('MongoDB write connection ready');
    console.log('MongoDB read connection ready');
    app.listen(PORT,'0.0.0.0',()=>{console.log('Supplier service on port',PORT);});
  })
  .catch(err=>{ console.error('MongoDB error:',err); process.exit(1); });
