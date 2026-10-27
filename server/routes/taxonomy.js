import express from 'express';
import { db, uniqueSlug } from '../db.js';
import { canManageContent } from '../auth.js';

const router = express.Router();

router.get('/categories', async (_req, res, next) => {
  try {
    const rows = await db
      .prepare(
        `SELECT c.id, c.slug, c.name, c.description, c.accent, c.icon, c.sort_order,
                (SELECT COUNT(*) FROM publications p WHERE p.category_id = c.id AND p.status = 'published') AS count
         FROM categories c ORDER BY c.sort_order ASC, c.name ASC`,
      )
      .all();
    res.json({ categories: rows });
  } catch (error) {
    next(error);
  }
});

router.post('/categories', canManageContent, async (req, res, next) => {
  try {
    const name = String(req.body?.name ?? '').trim();
    if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อหมวดหมู่' });
    const info = await db
      .prepare(
        'INSERT INTO categories (slug, name, description, accent, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        await uniqueSlug('categories', name),
        name,
        String(req.body?.description ?? '').trim() || null,
        String(req.body?.accent ?? '#4f7cff'),
        String(req.body?.icon ?? 'book'),
        Number(req.body?.sortOrder) || 0,
      );
    const category = await db.prepare('SELECT * FROM categories WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json({ category });
  } catch (error) {
    next(error);
  }
});

router.patch('/categories/:id', canManageContent, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'ไม่พบหมวดหมู่นี้' });
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : existing.name;
    if (!name) return res.status(400).json({ error: 'ชื่อหมวดหมู่ห้ามว่าง' });
    await db
      .prepare('UPDATE categories SET name = ?, description = ?, accent = ?, icon = ?, sort_order = ? WHERE id = ?')
      .run(
        name,
        req.body?.description !== undefined ? String(req.body.description).trim() || null : existing.description,
        String(req.body?.accent ?? existing.accent),
        String(req.body?.icon ?? existing.icon),
        req.body?.sortOrder !== undefined ? Number(req.body.sortOrder) || 0 : existing.sort_order,
        id,
      );
    res.json({ category: await db.prepare('SELECT * FROM categories WHERE id = ?').get(id) });
  } catch (error) {
    next(error);
  }
});

router.delete('/categories/:id', canManageContent, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    await db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.get('/tags', async (_req, res, next) => {
  try {
    const rows = await db
      .prepare(
        `SELECT t.id, t.name, t.slug, COUNT(pt.publication_id) AS count FROM tags t
         LEFT JOIN publication_tags pt ON pt.tag_id = t.id
         LEFT JOIN publications p ON p.id = pt.publication_id AND p.status = 'published'
         GROUP BY t.id ORDER BY count DESC, t.name ASC`,
      )
      .all();
    res.json({ tags: rows });
  } catch (error) {
    next(error);
  }
});

router.delete('/tags/:id', canManageContent, async (req, res, next) => {
  try {
    await db.prepare('DELETE FROM tags WHERE id = ?').run(Number(req.params.id));
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
