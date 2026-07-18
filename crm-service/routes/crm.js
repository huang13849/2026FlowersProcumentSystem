/**
 * CRM Service Routes - 通用 CRUD (Mongo)
 *   /crm/campaigns  → mongo collection: crm_campaigns
 *   /crm/coupons    → crm_coupons
 *   /crm/parking    → crm_parking
 */
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ObjectId = mongoose.Types.ObjectId;
const { getMongoDb } = require('../services/connections');

const COLLECTIONS = {
  campaigns: 'crm_campaigns',
  coupons: 'crm_coupons',
  parking: 'crm_parking',
};

function coll(name) {
  const c = COLLECTIONS[name];
  if (!c) return null;
  return getMongoDb().collection(c);
}

function toObjId(id) {
  try { return new ObjectId(String(id)); } catch { return null; }
}

// GET /crm/:resource   ?limit=100&skip=0&q=<json>
router.get('/:resource', async (req, res) => {
  const c = coll(req.params.resource);
  if (!c) return res.status(404).json({ success: false, error: 'unknown_resource' });
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 5000);
    const skip = parseInt(req.query.skip) || 0;
    let filter = {};
    if (req.query.q) { try { filter = JSON.parse(req.query.q); } catch {} }
    const cursor = c.find(filter).sort({ _id: -1 }).skip(skip).limit(limit);
    const data = await cursor.toArray();
    res.json({ success: true, count: data.length, data });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET /crm/:resource/:id
router.get('/:resource/:id', async (req, res) => {
  const c = coll(req.params.resource);
  if (!c) return res.status(404).json({ success: false, error: 'unknown_resource' });
  const oid = toObjId(req.params.id);
  if (!oid) return res.status(400).json({ success: false, error: 'bad_id' });
  try {
    const doc = await c.findOne({ _id: oid });
    if (!doc) return res.status(404).json({ success: false, error: 'not_found' });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// POST /crm/:resource
router.post('/:resource', async (req, res) => {
  const c = coll(req.params.resource);
  if (!c) return res.status(404).json({ success: false, error: 'unknown_resource' });
  try {
    const doc = { ...req.body, createdAt: new Date(), updatedAt: new Date() };
    const r = await c.insertOne(doc);
    res.json({ success: true, data: { _id: r.insertedId, ...doc } });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT /crm/:resource/:id
router.put('/:resource/:id', async (req, res) => {
  const c = coll(req.params.resource);
  if (!c) return res.status(404).json({ success: false, error: 'unknown_resource' });
  const oid = toObjId(req.params.id);
  if (!oid) return res.status(400).json({ success: false, error: 'bad_id' });
  try {
    const upd = { ...req.body, updatedAt: new Date() };
    delete upd._id;
    const r = await c.updateOne({ _id: oid }, { $set: upd });
    res.json({ success: true, matched: r.matchedCount, modified: r.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// DELETE /crm/:resource/:id
router.delete('/:resource/:id', async (req, res) => {
  const c = coll(req.params.resource);
  if (!c) return res.status(404).json({ success: false, error: 'unknown_resource' });
  const oid = toObjId(req.params.id);
  if (!oid) return res.status(400).json({ success: false, error: 'bad_id' });
  try {
    const r = await c.deleteOne({ _id: oid });
    res.json({ success: true, deleted: r.deletedCount });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
