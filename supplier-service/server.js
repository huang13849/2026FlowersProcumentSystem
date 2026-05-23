require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const supplierRoutes = require('./routes/supplier');
const uploadRoutes = require('./routes/upload');
const app = express();
const PORT = process.env.PORT || 3002;
app.use(cors());
app.use(express.json({limit:'50mb'}));
app.use('/uploads', express.static(path.join(__dirname,'uploads')));
app.use(express.static(path.join(__dirname, 'frontend/dist')));
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'frontend/dist/index.html')); });
app.use('/api/suppliers', supplierRoutes);
app.use('/api/upload', uploadRoutes);
app.get('/api/health', (req,res) => { res.json({status:'ok',service:'supplier-service',time:new Date().toISOString()}); });
mongoose.connect(process.env.MONGO_URI||'mongodb://100.67.126.90:27017/supply_chain')
  .then(()=>{ console.log('MongoDB connected'); app.listen(PORT,'0.0.0.0',()=>{console.log('Supplier service on port',PORT);}); })
  .catch(err=>{ console.error('MongoDB error:',err); process.exit(1); });
