const express = require('express');
const router = express.Router();
const { healthCheck } = require('../services/connections');

router.get('/', async (req, res) => {
  try {
    const health = await healthCheck();
    const allOk = Object.values(health).every(v => !v || v.status === 'ok');
    res.json({ status: allOk ? 'ok' : 'degraded', ...health });
  } catch (err) {
    res.status(500).json({ status: 'error', error: err.message });
  }
});

module.exports = router;
