import { db } from './db.js';

const PUBLICATION_FIELDS = `
  p.id, p.slug, p.title, p.subtitle, p.type, p.description, p.abstract, p.author, p.publisher,
  p.year, p.issn, p.isbn, p.language, p.pages, p.category_id, p.cover_url, p.file_url, p.file_type,
  p.file_size, p.excerpt, p.top_keywords, p.reading_minutes, p.status, p.featured, p.views,
  p.downloads, p.reads, p.created_by, p.created_at, p.updated_at,
  c.name AS category_name, c.slug AS category_slug, c.accent AS category_accent
`;

export function basePublicationQuery() {
  return `SELECT ${PUBLICATION_FIELDS} FROM publications p
          LEFT JOIN categories c ON c.id = p.category_id`;
}

export async function tagsFor(ids) {
  if (!ids.length) return new Map();
  const rows = await db
    .prepare(
      `SELECT pt.publication_id, t.id, t.name, t.slug FROM publication_tags pt
       JOIN tags t ON t.id = pt.tag_id WHERE pt.publication_id IN (${ids.map(() => '?').join(',')})
       ORDER BY t.name`,
    )
    .all(...ids);
  const map = new Map();
  for (const row of rows) {
    if (!map.has(row.publication_id)) map.set(row.publication_id, []);
    map.get(row.publication_id).push({ id: row.id, name: row.name, slug: row.slug });
  }
  return map;
}

export function serializePublication(row, extra = {}) {
  if (!row) return null;
  let keywords = [];
  try {
    keywords = JSON.parse(row.top_keywords ?? '[]');
  } catch {
    keywords = [];
  }
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    type: row.type,
    description: row.description,
    abstract: row.abstract,
    author: row.author,
    publisher: row.publisher,
    year: row.year,
    issn: row.issn,
    isbn: row.isbn,
    language: row.language,
    pages: row.pages,
    category: row.category_id
      ? { id: row.category_id, name: row.category_name, slug: row.category_slug, accent: row.category_accent }
      : null,
    coverUrl: row.cover_url,
    fileUrl: row.file_url,
    fileType: row.file_type,
    fileSize: row.file_size,
    excerpt: row.excerpt,
    keywords,
    readingMinutes: row.reading_minutes,
    status: row.status,
    featured: Boolean(row.featured),
    views: row.views,
    downloads: row.downloads,
    reads: row.reads,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

export async function listPublications(rows, userId = null) {
  const ids = rows.map((row) => row.id);
  const tagMap = await tagsFor(ids);
  let progressMap = new Map();
  let bookmarkSet = new Set();
  if (userId && ids.length) {
    const marks = await db
      .prepare(
        `SELECT publication_id, progress, page, updated_at FROM reading_progress
         WHERE user_id = ? AND publication_id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(userId, ...ids);
    progressMap = new Map(marks.map((m) => [m.publication_id, m]));
    const saved = await db
      .prepare(
        `SELECT publication_id FROM bookmarks WHERE user_id = ? AND publication_id IN (${ids.map(() => '?').join(',')})`,
      )
      .all(userId, ...ids);
    bookmarkSet = new Set(saved.map((s) => s.publication_id));
  }
  return rows.map((row) => {
    const progress = progressMap.get(row.id);
    return serializePublication(row, {
      tags: tagMap.get(row.id) ?? [],
      progress: progress ? { progress: progress.progress, page: progress.page, updatedAt: progress.updated_at } : null,
      bookmarked: bookmarkSet.has(row.id),
    });
  });
}

export function publicationFilters(params, { staff = false, userId = null } = {}) {
  const where = [];
  const values = [];
  if (params.status && params.status !== 'all') {
    where.push('p.status = ?');
    values.push(params.status);
  } else if (!staff || !params.status) {
    where.push(`p.status = 'published'`);
  }
  if (params.mine === '1' && userId) {
    where.push('p.created_by = ?');
    values.push(userId);
  }
  if (params.category) {
    where.push('(c.slug = ? OR c.id = ?)');
    values.push(params.category, Number(params.category) || -1);
  }
  if (params.type) {
    where.push('p.type = ?');
    values.push(params.type);
  }
  if (params.language) {
    where.push('p.language = ?');
    values.push(params.language);
  }
  if (params.year) {
    where.push('p.year = ?');
    values.push(Number(params.year));
  }
  if (params.yearFrom) {
    where.push('p.year >= ?');
    values.push(Number(params.yearFrom));
  }
  if (params.yearTo) {
    where.push('p.year <= ?');
    values.push(Number(params.yearTo));
  }
  if (params.author) {
    where.push('p.author LIKE ?');
    values.push(`%${params.author}%`);
  }
  if (params.publisher) {
    where.push('p.publisher LIKE ?');
    values.push(`%${params.publisher}%`);
  }
  if (params.issn) {
    where.push("REPLACE(p.issn, '-', '') LIKE ?");
    values.push(`%${String(params.issn).replace(/-/g, '')}%`);
  }
  if (params.isbn) {
    where.push("REPLACE(p.isbn, '-', '') LIKE ?");
    values.push(`%${String(params.isbn).replace(/-/g, '')}%`);
  }
  if (params.tag) {
    where.push(
      `EXISTS (SELECT 1 FROM publication_tags pt JOIN tags t ON t.id = pt.tag_id
               WHERE pt.publication_id = p.id AND (t.slug = ? OR t.name = ?))`,
    );
    values.push(params.tag, params.tag);
  }
  if (params.featured === '1') where.push('p.featured = 1');
  if (params.ids && params.ids.length) {
    where.push(`p.id IN (${params.ids.map(() => '?').join(',')})`);
    values.push(...params.ids);
  }
  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', values };
}

export function sortClause(sort) {
  switch (sort) {
    case 'popular':
      return 'ORDER BY (p.reads + p.downloads * 2) DESC, p.views DESC';
    case 'downloads':
      return 'ORDER BY p.downloads DESC, p.reads DESC';
    case 'title':
      return 'ORDER BY p.title COLLATE NOCASE ASC';
    case 'oldest':
      return 'ORDER BY p.year ASC, p.id ASC';
    case 'year':
      return 'ORDER BY p.year DESC, p.created_at DESC';
    default:
      return 'ORDER BY p.featured DESC, p.created_at DESC';
  }
}

export async function scoreKeywords(queryText) {
  const terms = [...new Set(tokenizeQuery(queryText))];
  if (!terms.length) return { terms, scores: new Map(), df: new Map() };
  const total = (await db.prepare(`SELECT COUNT(*) AS n FROM publications WHERE status = 'published'`).get()).n || 1;
  const scores = new Map();
  const df = new Map();
  const stmt = db.prepare(`SELECT publication_id, term, weight FROM keywords WHERE term LIKE ? LIMIT 8000`);
  for (const term of terms) {
    const rows = await stmt.all(`${term}%`);
    const seen = new Set(rows.map((r) => r.publication_id));
    df.set(term, seen.size);
    const idf = Math.log(1 + total / (1 + seen.size));
    for (const row of rows) {
      const exact = row.term === term ? 1.35 : 0.7;
      const prefixAdjust = row.term.startsWith(term) ? 1 : 0;
      scores.set(row.publication_id, (scores.get(row.publication_id) ?? 0) + row.weight * idf * exact * prefixAdjust);
    }
  }
  return { terms, scores, df };
}

function tokenizeQuery(text) {
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  return [...segmenter.segment(String(text ?? '').toLowerCase())]
    .filter((part) => part.isWordLike)
    .map((part) => part.segment.trim())
    .filter((word) => word.length > 1);
}

export function buildSnippet(text, terms, radius = 110) {
  if (!text) return '';
  const haystack = String(text);
  const lower = haystack.toLowerCase();
  let bestIndex = -1;
  let bestTerm = '';
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index > -1 && (bestIndex === -1 || index < bestIndex)) {
      bestIndex = index;
      bestTerm = term;
    }
  }
  if (bestIndex === -1) return haystack.slice(0, radius * 2).trim();
  const start = Math.max(0, bestIndex - radius);
  const end = Math.min(haystack.length, bestIndex + bestTerm.length + radius);
  const snippet = `${start > 0 ? '…' : ''}${haystack.slice(start, end).trim()}${end < haystack.length ? '…' : ''}`;
  return snippet.replace(/\s+/g, ' ');
}

export function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function highlightSnippet(text, terms) {
  return String(text ?? '')
    .replace(/[\u0000-\u0008]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
