import { Router } from 'express';
import AuditLog from '../models/AuditLog.js';
import { auth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(auth);
router.use(requireRole('admin', 'auditor'));

router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const total = await AuditLog.countDocuments();
    const logs = await AuditLog.find().sort('-createdAt')
      .skip((page - 1) * limit).limit(Number(limit));
    res.json({ logs, total, page: Number(page), totalPages: Math.ceil(total / limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
