import express from 'express';
import { db, nowIso } from '../db.js';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  hashPassword,
  isSecureRequest,
  publicUser,
  requireAuth,
  sessionCookie,
  throttle,
  verifyPassword,
} from '../auth.js';
import { basePublicationQuery, listPublications } from '../serialize.js';

const router = express.Router();

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register', async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (name.length < 2) return res.status(400).json({ error: 'กรุณากรอกชื่ออย่างน้อย 2 ตัวอักษร' });
    if (!emailPattern.test(email)) return res.status(400).json({ error: 'อีเมลไม่ถูกต้อง' });
    if (password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });

    const existing = await db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'อีเมลนี้ถูกใช้งานแล้ว' });

    const info = await db
      .prepare(
        `INSERT INTO users (name, email, password_hash, role, affiliation, avatar_hue, status, created_at)
         VALUES (?, ?, ?, 'reader', ?, ?, 'active', ?)`,
      )
      .run(
        name,
        email,
        hashPassword(password),
        String(req.body?.affiliation ?? '').trim() || null,
        Math.floor(Math.random() * 360),
        nowIso(),
      );
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
    const session = await createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, undefined, { secure: isSecureRequest(req) }));
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/login', async (req, res, next) => {
  try {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const password = String(req.body?.password ?? '');
    if (!throttle(`login:${req.ip}:${email}`)) {
      return res.status(429).json({ error: 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณาลองใหม่ภายหลัง' });
    }
    const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง' });
    }
    if (user.status !== 'active') return res.status(403).json({ error: 'บัญชีนี้ถูกระงับการใช้งาน' });
    const session = await createSession(user.id);
    res.setHeader('Set-Cookie', sessionCookie(session.token, undefined, { secure: isSecureRequest(req) }));
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await destroySession(req);
    res.setHeader('Set-Cookie', clearSessionCookie());
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/me', async (req, res, next) => {
  try {
    if (!req.user) return res.json({ user: null, counts: null });
    const counts = await db
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM reading_progress WHERE user_id = ?) AS reading,
           (SELECT COUNT(*) FROM bookmarks WHERE user_id = ?) AS saved,
           (SELECT COUNT(*) FROM publications WHERE created_by = ?) AS authored`,
      )
      .get(req.user.id, req.user.id, req.user.id);
    res.json({ user: req.user, counts });
  } catch (error) {
    next(error);
  }
});

router.patch('/me', requireAuth, async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? req.user.name).trim();
    if (name.length < 2) return res.status(400).json({ error: 'ชื่อต้องมีอย่างน้อย 2 ตัวอักษร' });
    const affiliation = req.body?.affiliation !== undefined ? String(req.body.affiliation).trim() || null : req.user.affiliation;
    const bio = req.body?.bio !== undefined ? String(req.body.bio).trim().slice(0, 400) || null : req.user.bio;
    await db.prepare('UPDATE users SET name = ?, affiliation = ?, bio = ? WHERE id = ?').run(name, affiliation, bio, req.user.id);

    if (req.body?.newPassword) {
      const current = await db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(String(req.body.currentPassword ?? ''), current.password_hash)) {
        return res.status(400).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
      }
      const next = String(req.body.newPassword);
      if (next.length < 8) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' });
      await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(next), req.user.id);
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

router.get('/me/shelf', requireAuth, async (req, res, next) => {
  try {
    const reading = await db
      .prepare(
        `${basePublicationQuery()}
         JOIN reading_progress rp ON rp.publication_id = p.id AND rp.user_id = ?
         WHERE p.status = 'published'
         ORDER BY rp.updated_at DESC LIMIT 24`,
      )
      .all(req.user.id);
    const progressRows = await db
      .prepare('SELECT publication_id, progress, page, updated_at FROM reading_progress WHERE user_id = ?')
      .all(req.user.id);
    const progressMap = new Map(progressRows.map((row) => [row.publication_id, row]));

    const saved = await db
      .prepare(
        `${basePublicationQuery()}
         JOIN bookmarks b ON b.publication_id = p.id AND b.user_id = ?
         WHERE p.status = 'published' ORDER BY b.created_at DESC LIMIT 24`,
      )
      .all(req.user.id);

    const decorate = async (rows) =>
      (await listPublications(rows, req.user.id)).map((item) => ({
        ...item,
        progress: progressMap.has(item.id)
          ? {
              progress: progressMap.get(item.id).progress,
              page: progressMap.get(item.id).page,
              updatedAt: progressMap.get(item.id).updated_at,
            }
          : null,
      }));

    res.json({ reading: await decorate(reading), saved: await decorate(saved) });
  } catch (error) {
    next(error);
  }
});

export default router;
