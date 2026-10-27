import express from 'express';
import { db, nowIso } from '../db.js';
import { canAdminister, hashPassword } from '../auth.js';

const router = express.Router();

router.get('/', canAdminister, async (req, res, next) => {
  try {
    const q = String(req.query.q ?? '').trim();
    const role = String(req.query.role ?? '').trim();
    const where = [];
    const values = [];
    if (q) {
      where.push('(name LIKE ? OR email LIKE ? OR affiliation LIKE ?)');
      values.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }
    if (role) {
      where.push('role = ?');
      values.push(role);
    }
    const rows = await db
      .prepare(
        `SELECT id, name, email, role, affiliation, avatar_hue, status, created_at,
          (SELECT COUNT(*) FROM publications p WHERE p.created_by = users.id) AS publication_count,
          (SELECT COUNT(*) FROM analytics_events e WHERE e.user_id = users.id AND e.type = 'read') AS read_count
         FROM users ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
         ORDER BY CASE role WHEN 'admin' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END, created_at DESC`,
      )
      .all(...values);
    const roleCounts = await db.prepare('SELECT role, COUNT(*) AS count FROM users GROUP BY role').all();
    res.json({ users: rows, roleCounts });
  } catch (error) {
    next(error);
  }
});

router.post('/', canAdminister, async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    const role = ['admin', 'editor', 'reader'].includes(req.body?.role) ? req.body.role : 'reader';
    if (name.length < 2) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
    if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    if (await db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
      return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });
    }
    const info = await db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, affiliation, avatar_hue, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`,
      )
      .run(
        name,
        email,
        hashPassword(password),
        role,
        String(req.body?.affiliation ?? '').trim() || null,
        Math.floor(Math.random() * 360),
        nowIso(),
      );
    res.status(201).json({ ok: true, id: Number(info.lastInsertRowid) });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', canAdminister, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!user) return res.status(404).json({ error: 'ไม่พบผู้ใช้รายนี้' });

    if (req.body?.role !== undefined) {
      if (id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถเปลี่ยนสิทธิ์ของตัวเองได้' });
      if (!['admin', 'editor', 'reader'].includes(req.body.role)) return res.status(400).json({ error: 'สิทธิ์ไม่ถูกต้อง' });
      await db.prepare('UPDATE users SET role = ? WHERE id = ?').run(req.body.role, id);
    }
    if (req.body?.status !== undefined) {
      if (id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถระงับบัญชีของตัวเองได้' });
      const status = req.body.status === 'suspended' ? 'suspended' : 'active';
      await db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
      if (status === 'suspended') await db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }
    if (req.body?.password) {
      if (String(req.body.password).length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(req.body.password)), id);
    }
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', canAdminister, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (id === req.user.id) return res.status(400).json({ error: 'ไม่สามารถลบบัญชีของตัวเองได้' });
    const admins = (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get()).n;
    const target = await db.prepare('SELECT role FROM users WHERE id = ?').get(id);
    if (!target) return res.status(404).json({ error: 'ไม่พบผู้ใช้รายนี้' });
    if (target.role === 'admin' && admins <= 1) {
      return res.status(400).json({ error: 'ต้องมีผู้ดูแลระบบอย่างน้อย 1 ท่าน' });
    }
    await db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
