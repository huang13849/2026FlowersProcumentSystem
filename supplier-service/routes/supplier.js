const router = require('express').Router();
const { Supplier } = require('../models/Supplier');

function supplierModel(req, role) {
  return req.app.locals[role] || Supplier;
}

// ── Batch reorder (MUST be before /:id) ──
router.post('/reorder', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const { orders } = req.body;
    if (!Array.isArray(orders)) return res.status(400).json({ error: 'orders must be an array' });
    const bulkOps = orders.map(({ id, sortOrder }) => ({
      updateOne: { filter: { _id: id }, update: { $set: { sortOrder } } }
    }));
    await SupplierWrite.bulkWrite(bulkOps);
    res.json({ success: true, updated: orders.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Product shop names ──
router.get('/shop-names', async (req, res) => {
  try {
    const db = req.app.locals.SupplierRead.db;
    const names = await db.collection('products').distinct('sellerName', { sellerName: { $ne: null, $ne: '' } });
    res.json(names.filter(Boolean));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Product count stats by shop_name ──
router.get('/product-stats', async (req, res) => {
  try {
    const db = req.app.locals.SupplierRead.db;
    const pipeline = [
      { $match: { sellerName: { $ne: null, $ne: '' } } },
      { $group: { _id: '$sellerName', count: { $sum: 1 } } }
    ];
    if (req.query.names) {
      const names = req.query.names.split(',').map(n => n.trim()).filter(Boolean);
      pipeline[0].$match.sellerName = { $in: names };
    }
    const result = await db.collection('products').aggregate(pipeline).toArray();
    const map = {};
    result.forEach(r => { map[r._id] = r.count; });
    res.json(map);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/', async (req, res) => {
  try {
    const SupplierRead = supplierModel(req, 'SupplierRead');
    const { search, status } = req.query;
    const query = {};
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { shop_name: { $regex: search, $options: 'i' } },
        { 'contact.name': { $regex: search, $options: 'i' } },
        { 'company_info.tax_id': { $regex: search, $options: 'i' } },
        { notes: { $regex: search, $options: 'i' } }
      ];
    }
    if (status) query.status = status;
    const data = await SupplierRead.find(query).sort({ sortOrder: 1, updatedAt: -1 });
    res.json({ suppliers: data, total: data.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:id', async (req, res) => {
  try {
    const SupplierRead = supplierModel(req, 'SupplierRead');
    const supplier = await SupplierRead.findById(req.params.id);
    if (!supplier) return res.status(404).json({ error: 'Supplier not found' });
    res.json(supplier);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const body = { ...req.body };
    if (body.sortOrder === undefined) {
      const last = await SupplierWrite.findOne().sort({ sortOrder: -1 }).select('sortOrder');
      body.sortOrder = (last?.sortOrder ?? 0) + 10;
    }
    const s = await SupplierWrite.create(body);
    res.status(201).json(s);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:id', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    const s = await SupplierWrite.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(s);
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:id', async (req, res) => {
  try {
    const SupplierWrite = supplierModel(req, 'SupplierWrite');
    await SupplierWrite.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted' });
  }
  catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
