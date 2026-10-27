import express from 'express';
import { db } from '../db.js';
import { runPublicationQuery, searchFacets, suggest, trendingKeywords } from '../search.js';
import { basePublicationQuery, listPublications } from '../serialize.js';

const router = express.Router();

router.get('/search', async (req, res, next) => {
  try {
    const staff = req.user?.role === 'admin' || req.user?.role === 'editor';
    const result = await runPublicationQuery(req.query, { staff, userId: req.user?.id ?? null });
    res.json({ ...result, pages: result.pages ?? Math.ceil(result.total / result.limit) });
  } catch (error) {
    next(error);
  }
});

router.get('/search/suggest', async (req, res, next) => {
  try {
    res.json(await suggest(req.query.q));
  } catch (error) {
    next(error);
  }
});

router.get('/search/facets', async (_req, res, next) => {
  try {
    res.json(await searchFacets());
  } catch (error) {
    next(error);
  }
});

router.get('/overview', async (req, res, next) => {
  try {
    const stats = {
      titles: (await db.prepare("SELECT COUNT(*) AS n FROM publications WHERE status = 'published'").get()).n,
      categories: (await db.prepare('SELECT COUNT(*) AS n FROM categories').get()).n,
      reads: (await db.prepare('SELECT COALESCE(SUM(reads),0) AS n FROM publications').get()).n,
      downloads: (await db.prepare('SELECT COALESCE(SUM(downloads),0) AS n FROM publications').get()).n,
      journals: (
        await db.prepare("SELECT COUNT(*) AS n FROM publications WHERE status='published' AND type='journal'").get()
      ).n,
      ebooks: (
        await db.prepare("SELECT COUNT(*) AS n FROM publications WHERE status='published' AND type='ebook'").get()
      ).n,
      keywords: (await db.prepare('SELECT COUNT(DISTINCT term) AS n FROM keywords').get()).n,
    };

    const featured = await db
      .prepare(`${basePublicationQuery()} WHERE p.status='published' AND p.featured = 1 ORDER BY p.created_at DESC LIMIT 5`)
      .all();
    const latest = await db
      .prepare(`${basePublicationQuery()} WHERE p.status='published' ORDER BY p.created_at DESC LIMIT 8`)
      .all();
    const popular = await db
      .prepare(
        `${basePublicationQuery()} WHERE p.status='published' ORDER BY (p.reads + p.downloads * 2) DESC, p.views DESC LIMIT 8`,
      )
      .all();
    const journals = await db
      .prepare(
        `${basePublicationQuery()} WHERE p.status='published' AND p.type IN ('journal','magazine') ORDER BY p.year DESC LIMIT 4`,
      )
      .all();
    const categories = await db
      .prepare(
        `SELECT c.id, c.slug, c.name, c.description, c.accent, c.icon,
                (SELECT COUNT(*) FROM publications p WHERE p.category_id = c.id AND p.status='published') AS count
         FROM categories c ORDER BY c.sort_order ASC`,
      )
      .all();

    const userId = req.user?.id ?? null;
    res.json({
      stats,
      featured: await listPublications(featured, userId),
      latest: await listPublications(latest, userId),
      popular: await listPublications(popular, userId),
      journals: await listPublications(journals, userId),
      categories,
      keywords: await trendingKeywords(18),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
