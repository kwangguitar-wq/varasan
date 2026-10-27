import express from 'express';
import { db } from '../db.js';
import { requireRole } from '../auth.js';
import { trendingKeywords } from '../search.js';

const router = express.Router();

function dayList(days) {
  const list = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - i);
    list.push(date.toISOString().slice(0, 10));
  }
  return list;
}

router.get('/summary', requireRole('admin', 'editor'), async (req, res, next) => {
  try {
    const days = Math.min(90, Math.max(7, Number(req.query.days) || 30));
    const dates = dayList(days);
    const start = dates[0];
    const previousStart = dayList(days * 2)[0];

    const totals = (
      await db.prepare(`SELECT type, COUNT(*) AS count FROM analytics_events WHERE day >= ? GROUP BY type`).all(start)
    ).reduce((acc, row) => ({ ...acc, [row.type]: row.count }), {});

    const previous = (
      await db
        .prepare(`SELECT type, COUNT(*) AS count FROM analytics_events WHERE day >= ? AND day < ? GROUP BY type`)
        .all(previousStart, start)
    ).reduce((acc, row) => ({ ...acc, [row.type]: row.count }), {});

    const delta = (type) => {
      const now = totals[type] ?? 0;
      const before = previous[type] ?? 0;
      if (!before) return now ? 100 : 0;
      return Math.round(((now - before) / before) * 100);
    };

    const seriesRows = await db
      .prepare(`SELECT day, type, COUNT(*) AS count FROM analytics_events WHERE day >= ? GROUP BY day, type`)
      .all(start);
    const seriesMap = new Map();
    for (const day of dates) seriesMap.set(day, { day, views: 0, reads: 0, downloads: 0, complete: 0 });
    for (const row of seriesRows) {
      const entry = seriesMap.get(row.day);
      if (!entry) continue;
      const key = row.type === 'view' ? 'views' : row.type === 'read' ? 'reads' : row.type === 'download' ? 'downloads' : 'complete';
      entry[key] = (entry[key] ?? 0) + row.count;
    }

    const topPublications = await db
      .prepare(
        `SELECT p.id, p.slug, p.title, p.author, p.cover_url, p.type, p.reads, p.downloads, p.views,
                COUNT(e.id) AS period_events
         FROM publications p
         LEFT JOIN analytics_events e ON e.publication_id = p.id AND e.day >= ?
         WHERE p.status = 'published'
         GROUP BY p.id
         ORDER BY period_events DESC, p.reads DESC, p.downloads DESC
         LIMIT 8`,
      )
      .all(start);

    const categorySplit = await db
      .prepare(
        `SELECT c.id, c.name, c.accent, COUNT(DISTINCT p.id) AS titles,
                COALESCE(SUM(p.reads), 0) AS reads, COALESCE(SUM(p.downloads), 0) AS downloads
         FROM categories c
         LEFT JOIN publications p ON p.category_id = c.id AND p.status = 'published'
         GROUP BY c.id ORDER BY reads DESC, titles DESC`,
      )
      .all();

    const recentActivity = await db
      .prepare(
        `SELECT e.type, e.created_at, p.title AS publication_title, p.slug AS publication_slug,
                u.name AS user_name, e.user_id
         FROM analytics_events e
         LEFT JOIN publications p ON p.id = e.publication_id
         LEFT JOIN users u ON u.id = e.user_id
         ORDER BY e.id DESC LIMIT 14`,
      )
      .all();

    const activeReaders = (
      await db
        .prepare(`SELECT COUNT(DISTINCT COALESCE(user_id, -id)) AS n FROM analytics_events WHERE day >= ? AND type = 'read'`)
        .get(start)
    ).n;

    const library = {
      published: (await db.prepare("SELECT COUNT(*) AS n FROM publications WHERE status = 'published'").get()).n,
      drafts: (await db.prepare("SELECT COUNT(*) AS n FROM publications WHERE status = 'draft'").get()).n,
      readers: (await db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'reader'").get()).n,
      allReads: (await db.prepare('SELECT COALESCE(SUM(reads),0) AS n FROM publications').get()).n,
      allDownloads: (await db.prepare('SELECT COALESCE(SUM(downloads),0) AS n FROM publications').get()).n,
      allViews: (await db.prepare('SELECT COALESCE(SUM(views),0) AS n FROM publications').get()).n,
      storage: (await db.prepare('SELECT COALESCE(SUM(file_size),0) AS n FROM publications').get()).n,
    };

    const keywords = await trendingKeywords(28);

    const topDownloads = await db
      .prepare(
        `SELECT id, slug, title, downloads FROM publications WHERE status='published' ORDER BY downloads DESC LIMIT 5`,
      )
      .all();

    res.json({
      range: { days, start, end: dates[dates.length - 1] },
      totals: {
        views: totals.view ?? 0,
        reads: totals.read ?? 0,
        downloads: totals.download ?? 0,
        complete: totals.complete ?? 0,
        activeReaders,
      },
      delta: { views: delta('view'), reads: delta('read'), downloads: delta('download') },
      series: [...seriesMap.values()],
      topPublications,
      topDownloads,
      categorySplit,
      recentActivity,
      keywords,
      library,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
