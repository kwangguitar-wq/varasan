import { db } from './db.js';
import {
  basePublicationQuery,
  listPublications,
  publicationFilters,
  scoreKeywords,
  sortClause,
  buildSnippet,
} from './serialize.js';

const TITLE_BOOST = 9;

async function rawMatchIds(query) {
  const terms = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!terms.length) return new Set();
  const clauses = terms.map(() => '(p.title LIKE ? OR p.author LIKE ? OR p.description LIKE ? OR p.abstract LIKE ?)');
  const values = terms.flatMap((term) => Array(4).fill(`%${term}%`));
  const rows = await db
    .prepare(`SELECT p.id FROM publications p WHERE p.status = 'published' AND (${clauses.join(' OR ')})`)
    .all(...values);
  return new Set(rows.map((row) => row.id));
}

export async function runPublicationQuery(params = {}, { staff = false, userId = null, withSnippets = true } = {}) {
  const q = String(params.q ?? '').trim();
  const page = Math.max(1, Number(params.page) || 1);
  const limit = Math.min(48, Math.max(1, Number(params.limit) || 12));

  let terms = [];
  let scores = new Map();
  let candidateIds = null;

  if (q) {
    const scored = await scoreKeywords(q);
    terms = scored.terms;
    scores = scored.scores;
    const raw = await rawMatchIds(q);
    const ids = new Set([...scores.keys(), ...raw]);
    // Title matches should be discoverable even before keyword indexing finishes.
    if (!ids.size) {
      const like = `%${q}%`;
      const rows = await db
        .prepare(`SELECT id FROM publications WHERE status = 'published' AND (title LIKE ? OR author LIKE ?)`)
        .all(like, like);
      rows.forEach((row) => ids.add(row.id));
    }
    candidateIds = [...ids];
    if (!candidateIds.length) {
      return { items: [], total: 0, page, limit, terms, query: q };
    }
    for (const id of raw) {
      if (!scores.has(id)) scores.set(id, 1.5);
    }
  }

  const filters = publicationFilters({ ...params, ids: candidateIds ?? undefined }, { staff, userId });
  const order = q && (!params.sort || params.sort === 'relevance') ? '' : sortClause(params.sort);
  const sql = `${basePublicationQuery()} ${filters.clause} ${order}`;

  if (q && order === '') {
    // Relevance ranking happens in JS; keep candidate set bounded.
    const rows = await db.prepare(`${sql} LIMIT 400`).all(...filters.values);
    for (const row of rows) {
      const haystackTitle = String(row.title ?? '').toLowerCase();
      const haystackAuthor = String(row.author ?? '').toLowerCase();
      let score = scores.get(row.id) ?? 0;
      for (const term of terms) {
        if (haystackTitle.includes(term)) score += TITLE_BOOST;
        if (haystackAuthor.includes(term)) score += TITLE_BOOST / 2;
      }
      row._score = score;
    }
    rows.sort((a, b) => b._score - a._score || String(b.created_at).localeCompare(String(a.created_at)));
    const total = rows.length;
    const paged = rows.slice((page - 1) * limit, page * limit);
    const items = (await listPublications(paged, userId)).map((item, index) => ({
      ...item,
      relevance: Number((paged[index]._score ?? 0).toFixed(2)),
      snippet: withSnippets
        ? buildSnippet(paged[index].excerpt || paged[index].description || '', terms)
        : undefined,
      matchedTerms: terms,
    }));
    return { items, total, page, limit, terms, query: q };
  }

  const total = (
    await db
      .prepare(`SELECT COUNT(*) AS n FROM publications p LEFT JOIN categories c ON c.id = p.category_id ${filters.clause}`)
      .get(...filters.values)
  ).n;
  const rows = await db
    .prepare(`${sql} LIMIT ? OFFSET ?`)
    .all(...filters.values, limit, (page - 1) * limit);
  const items = await listPublications(rows, userId);
  return { items, total, page, limit, terms, query: q, pages: Math.ceil(total / limit) };
}

/**
 * Poll keywords across the published collection, ignoring terms that appear in
 * most titles (Thai function words such as ผู้/ใช้ dominate raw counts).
 */
export async function trendingKeywords(limit = 18) {
  return db
    .prepare(
      `SELECT k.term, SUM(k.count) AS count, COUNT(DISTINCT k.publication_id) AS docs
       FROM keywords k
       JOIN publications p ON p.id = k.publication_id AND p.status = 'published'
       GROUP BY k.term
       HAVING COUNT(DISTINCT k.publication_id) <= MAX(2, (SELECT COUNT(*) FROM publications WHERE status = 'published') / 2)
       ORDER BY SUM(k.weight) DESC, count DESC, k.term ASC
       LIMIT ?`,
    )
    .all(limit);
}

export async function searchFacets() {
  const authors = await db
    .prepare(
      `SELECT author AS name, COUNT(*) AS count FROM publications
       WHERE status = 'published' AND author IS NOT NULL AND author != ''
       GROUP BY author ORDER BY count DESC, author ASC LIMIT 60`,
    )
    .all();
  const years = await db
    .prepare(
      `SELECT year, COUNT(*) AS count FROM publications
       WHERE status = 'published' AND year IS NOT NULL GROUP BY year ORDER BY year DESC`,
    )
    .all();
  const tags = await db
    .prepare(
      `SELECT t.id, t.name, t.slug, COUNT(pt.publication_id) AS count FROM tags t
       JOIN publication_tags pt ON pt.tag_id = t.id
       JOIN publications p ON p.id = pt.publication_id AND p.status = 'published'
       GROUP BY t.id ORDER BY count DESC, t.name ASC LIMIT 40`,
    )
    .all();
  const types = await db
    .prepare(`SELECT type, COUNT(*) AS count FROM publications WHERE status='published' GROUP BY type ORDER BY count DESC`)
    .all();
  const languages = await db
    .prepare(`SELECT language, COUNT(*) AS count FROM publications WHERE status='published' GROUP BY language`)
    .all();
  const publishers = await db
    .prepare(
      `SELECT publisher AS name, COUNT(*) AS count FROM publications
       WHERE status='published' AND publisher IS NOT NULL AND publisher != ''
       GROUP BY publisher ORDER BY count DESC LIMIT 30`,
    )
    .all();
  return { authors, years, tags, types, languages, publishers };
}

export async function suggest(query, limit = 8) {
  const q = String(query ?? '').trim();
  if (!q) return { publications: [], keywords: [], tags: [] };
  const like = `%${q}%`;
  const publications = await db
    .prepare(
      `SELECT id, slug, title, author, cover_url, type FROM publications
       WHERE status='published' AND (title LIKE ? OR author LIKE ?)
       ORDER BY (title LIKE ?) DESC, reads DESC LIMIT ?`,
    )
    .all(like, like, `${q}%`, limit);
  const keywords = await db
    .prepare(
      `SELECT term, SUM(count) AS count FROM keywords WHERE term LIKE ?
       GROUP BY term ORDER BY count DESC LIMIT ?`,
    )
    .all(`${q}%`, limit);
  const tags = await db
    .prepare(`SELECT name, slug FROM tags WHERE name LIKE ? ORDER BY name LIMIT ?`)
    .all(like, limit);
  return { publications, keywords, tags };
}
