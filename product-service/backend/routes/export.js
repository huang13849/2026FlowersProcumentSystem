import { Router } from 'express';
import Product from '../models/Product.js';
import { exportToCSV, exportToExcel, exportToPDF } from '../services/exporter.js';
import AuditLog from '../models/AuditLog.js';
import { auth } from '../middleware/auth.js';

const router = Router();
router.use(auth);

async function getProducts(req) {
  const { ids, category, search } = req.query;
  const query = {};
  if (ids) query._id = { $in: ids.split(',') };
  if (category) query.category = category;
  if (search) query.$text = { $search: search };
  return await Product.find(query).sort('-createdAt').lean();
}

router.get('/csv', async (req, res) => {
  try {
    const products = await getProducts(req);
    const csv = exportToCSV(products);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=products.csv');
    res.send('﻿' + csv);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/excel', async (req, res) => {
  try {
    const products = await getProducts(req);
    const buffer = await exportToExcel(products);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=products.xlsx');
    res.send(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/pdf', async (req, res) => {
  try {
    const products = await getProducts(req);
    const buffer = await exportToPDF(products);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename=products.pdf');
    res.send(buffer);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

export default router;
