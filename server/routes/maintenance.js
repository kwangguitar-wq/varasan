// Manual entry point for the rebuild that normally runs by itself on boot.
// Admin only: it writes publication rows.
import express from 'express';
import { requireAuth } from '../auth.js';
import { migrateDatabaseFiles } from '../migrate-storage.js';
import { restoreBooks } from '../restore.js';

const router = express.Router();

router.post('/restore', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    }
    const summary = await restoreBooks({ dryRun: req.body?.dryRun === true });
    res.json({ ok: true, ...summary });
  } catch (error) {
    next(error);
  }
});

router.post('/migrate', requireAuth, async (req, res, next) => {
  try {
    if (req.user.role !== 'admin') {
      return res.status(403).json({ error: 'เฉพาะผู้ดูแลระบบเท่านั้น' });
    }
    const summary = await migrateDatabaseFiles({
      dryRun: req.body?.dryRun === true,
      force: req.body?.force === true,
    });
    res.json({ ok: true, ...summary });
  } catch (error) {
    next(error);
  }
});

export default router;
