import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { db, nowIso, runtime, todayKey, uniqueSlug } from '../db.js';
import { requireAuth, canManageContent } from '../auth.js';
import {
  buildKeywordIndex,
  makeExcerpt,
  readingMinutes,
  readPdf,
  readEpub,
  readFlipbookZip,
  saveKeywords,
} from '../indexer.js';
import { generateCoverSvg } from '../covers.js';
import { basePublicationQuery, listPublications, serializePublication } from '../serialize.js';
import { runPublicationQuery } from '../search.js';
import { contentTypeFor, deleteObjects, getObject, getText, putObject, uploadUrl } from '../storage.js';

const router = express.Router();

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: { fileSize: runtime.maxUploadBytes, files: 2 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.fieldname === 'cover') {
      if (!/\.(jpe?g|png|webp|avif)$/i.test(ext)) return cb(new Error('รูปปกต้องเป็น JPG, PNG, WebP หรือ AVIF'));
      return cb(null, true);
    }
    if (!['.pdf', '.epub', '.zip'].includes(ext)) {
      return cb(new Error('รองรับเฉพาะไฟล์ PDF, ePub หรือ ZIP (Flipbook)'));
    }
    cb(null, true);
  },
});

const uploader = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'cover', maxCount: 1 },
]);

const TYPES = new Set(['journal', 'ebook', 'research', 'flipbook', 'report', 'magazine']);

async function validCategory(data, res) {
  if (data.category_id === undefined || data.category_id === null) return true;
  const row = await db.prepare('SELECT id FROM categories WHERE id = ?').get(data.category_id);
  if (row) return true;
  res.status(400).json({ error: 'ไม่พบหมวดหมู่ที่ระบุ' });
  return false;
}

function findPublication(idOrSlug) {
  return db
    .prepare(`${basePublicationQuery()} WHERE p.slug = ? OR p.id = ?`)
    .get(String(idOrSlug), Number(idOrSlug) || -1);
}

function canAccess(row, user, { staff = false } = {}) {
  if (row.status === 'published') return true;
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'editor') return staff ? true : row.created_by === user.id;
  return row.created_by === user.id;
}

function parseTags(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  const text = String(raw).trim();
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) return parsed.map((item) => (typeof item === 'string' ? item : item?.name)).filter(Boolean);
    } catch {
      /* fall through to comma parsing */
    }
  }
  return text
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function syncTags(publicationId, tagNames) {
  await db.prepare('DELETE FROM publication_tags WHERE publication_id = ?').run(publicationId);
  if (!tagNames.length) return;
  const insertTag = db.prepare('INSERT OR IGNORE INTO tags (name, slug) VALUES (?, ?)');
  const findTag = db.prepare('SELECT id FROM tags WHERE name = ? COLLATE NOCASE');
  const link = db.prepare('INSERT OR IGNORE INTO publication_tags (publication_id, tag_id) VALUES (?, ?)');
  for (const name of [...new Set(tagNames.map((tag) => tag.trim()).filter(Boolean))].slice(0, 20)) {
    await insertTag.run(name, await uniqueSlug('tags', name));
    const row = await findTag.get(name);
    if (row) await link.run(publicationId, row.id);
  }
  // Prune tags that are no longer attached to any publication.
  await db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM publication_tags)').run();
}

async function reindex(publication, extractedText = '') {
  const metadata = [
    publication.title,
    publication.subtitle,
    publication.author,
    publication.publisher,
    publication.description,
    publication.abstract,
    publication.issn,
    publication.isbn,
    publication.year,
  ]
    .filter(Boolean)
    .join('\n');
  const fullText = `${metadata}\n\n${extractedText}`.trim();
  const keywords = buildKeywordIndex(fullText, {
    title: publication.title,
    author: publication.author ?? '',
  });
  await saveKeywords(publication.id, keywords);
  const top = keywords.slice(0, 14).map(({ term, count }) => ({ term, count }));
  await db
    .prepare(
      `UPDATE publications SET content_text = ?, excerpt = ?, top_keywords = ?, reading_minutes = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      fullText.slice(0, 160_000),
      makeExcerpt(publication.abstract || publication.description || extractedText, 320),
      JSON.stringify(top),
      readingMinutes(fullText),
      nowIso(),
      publication.id,
    );
}

/** Store the uploaded book (and everything derived from it) in object storage. */
async function ingestFile(publication, file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const base = `books/${publication.id}`;
  const publicBase = uploadUrl(base);
  const buffer = file.buffer ?? new Uint8Array();

  if (ext === '.pdf') {
    await putObject(`${base}/book.pdf`, buffer, 'application/pdf');
    const pdf = await readPdf(buffer);
    return {
      fileType: 'pdf',
      fileUrl: `${publicBase}/book.pdf`,
      fileSize: buffer.length,
      pages: Math.max(pdf.pageCount, 1),
      text: pdf.text,
      defaults: { type: 'ebook' },
    };
  }
  if (ext === '.epub') {
    await putObject(`${base}/book.epub`, buffer, 'application/epub+zip');
    const epub = readEpub(buffer, { publicBase: `${publicBase}/epub` });
    for (const [name, bytes] of epub.assets) {
      await putObject(`${base}/epub/${name}`, bytes, contentTypeFor(name));
    }
    await putObject(`${base}/chapters.json`, JSON.stringify({ title: epub.title, chapters: epub.chapters }), 'application/json');
    return {
      fileType: 'epub',
      fileUrl: `${publicBase}/book.epub`,
      fileSize: buffer.length,
      pages: Math.max(epub.pageCount, 1),
      text: epub.text,
      defaults: { type: 'ebook' },
    };
  }
  if (ext === '.zip') {
    await putObject(`${base}/book.zip`, buffer, 'application/zip');
    const flip = readFlipbookZip(buffer, { publicBase: `${publicBase}/pages` });
    for (const asset of flip.assets) {
      await putObject(`${base}/pages/${asset.name}`, asset.bytes, contentTypeFor(asset.name));
    }
    await putObject(
      `${base}/pages.json`,
      JSON.stringify({ title: publication.title, pages: flip.pages }),
      'application/json',
    );
    return {
      fileType: 'flipbook',
      fileUrl: `${publicBase}/book.zip`,
      fileSize: buffer.length,
      pages: Math.max(flip.pageCount, 1),
      text: flip.text,
      defaults: { type: 'flipbook' },
    };
  }
  throw new Error('นามสกุลไฟล์ไม่รองรับ');
}

async function saveCover(publication, file) {
  if (!file) return null;
  const ext = path.extname(file.originalname).toLowerCase();
  const filename = `cover-${publication.id}-${Date.now()}${ext}`;
  await putObject(`covers/${filename}`, file.buffer ?? new Uint8Array(), contentTypeFor(filename));
  return uploadUrl(`covers/${filename}`);
}

async function ensureGeneratedCover(publication) {
  if (publication.cover_url) return publication.cover_url;
  const filename = `auto-${publication.id}.svg`;
  const svg = generateCoverSvg({
    title: publication.title,
    author: publication.author ?? '',
    type: publication.type,
    category: publication.category_name ?? '',
    id: publication.id,
  });
  await putObject(`covers/${filename}`, svg, 'image/svg+xml');
  const url = uploadUrl(`covers/${filename}`);
  await db.prepare('UPDATE publications SET cover_url = ? WHERE id = ?').run(url, publication.id);
  return url;
}

function normalizeBody(body) {
  const data = {};
  const text = (key) => (typeof body[key] === 'string' ? body[key].trim() : undefined);
  for (const key of ['title', 'subtitle', 'description', 'abstract', 'author', 'publisher', 'issn', 'isbn', 'language']) {
    const value = text(key);
    if (value !== undefined) data[key] = value || null;
  }
  if (body.type !== undefined) data.type = TYPES.has(body.type) ? body.type : 'ebook';
  if (body.year !== undefined) data.year = body.year ? Number(body.year) || null : null;
  if (body.pages !== undefined) data.pages = Number(body.pages) || 0;
  if (body.categoryId !== undefined) data.category_id = body.categoryId ? Number(body.categoryId) || null : null;
  if (body.category_id !== undefined) data.category_id = body.category_id ? Number(body.category_id) || null : null;
  if (body.featured !== undefined) data.featured = ['1', 'true', 'on', 'yes'].includes(String(body.featured)) ? 1 : 0;
  if (body.status !== undefined) data.status = body.status === 'published' ? 'published' : 'draft';
  return data;
}

router.get('/', async (req, res, next) => {
  try {
    const staff = req.user?.role === 'admin' || req.user?.role === 'editor';
    const result = await runPublicationQuery(req.query, { staff, userId: req.user?.id ?? null });
    res.json({ ...result, pages: result.pages ?? Math.ceil(result.total / result.limit) });
  } catch (error) {
    next(error);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    const staff = req.user?.role === 'admin' || req.user?.role === 'editor';
    if (!canAccess(row, req.user, { staff })) return res.status(403).json({ error: 'เอกสารนี้ยังไม่เผยแพร่' });

    const tags = await db
      .prepare(`SELECT t.id, t.name, t.slug FROM publication_tags pt JOIN tags t ON t.id = pt.tag_id WHERE pt.publication_id = ?`)
      .all(row.id);
    let progress = null;
    let bookmarked = false;
    if (req.user) {
      progress =
        (await db
          .prepare('SELECT progress, page, updated_at FROM reading_progress WHERE user_id = ? AND publication_id = ?')
          .get(req.user.id, row.id)) ?? null;
      bookmarked = Boolean(
        await db.prepare('SELECT 1 AS ok FROM bookmarks WHERE user_id = ? AND publication_id = ?').get(req.user.id, row.id),
      );
    }
    const related = await db
      .prepare(
        `${basePublicationQuery()} WHERE p.status = 'published' AND p.id != ?
         AND (p.category_id = ? OR p.author = ?) ORDER BY p.reads DESC LIMIT 4`,
      )
      .all(row.id, row.category_id ?? -1, row.author ?? '');
    if (related.length < 4) {
      const seen = new Set([row.id, ...related.map((item) => item.id)]);
      const filler = await db
        .prepare(
          `${basePublicationQuery()} WHERE p.status = 'published' AND p.id NOT IN (${[...seen].map(() => '?').join(',')})
           ORDER BY (p.reads + p.downloads) DESC LIMIT ?`,
        )
        .all(...seen, 4 - related.length);
      related.push(...filler);
    }
    res.json({
      publication: serializePublication(row, {
        tags,
        progress: progress ? { progress: progress.progress, page: progress.page } : null,
        bookmarked,
      }),
      related: await listPublications(related, req.user?.id ?? null),
    });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/content', async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    const staff = req.user?.role === 'admin' || req.user?.role === 'editor';
    if (!canAccess(row, req.user, { staff })) return res.status(403).json({ error: 'เอกสารนี้ยังไม่เผยแพร่' });
    if (!row.file_url) return res.status(409).json({ error: 'เอกสารนี้ยังไม่มีไฟล์แนบ' });

    if (row.file_type === 'epub') {
      const raw = await getText(`books/${row.id}/chapters.json`);
      if (!raw) return res.status(409).json({ error: 'ไม่พบเนื้อหา ePub' });
      const payload = JSON.parse(raw);
      return res.json({ kind: 'epub', title: row.title, fileUrl: row.file_url, chapters: payload.chapters });
    }
    if (row.file_type === 'flipbook') {
      const raw = await getText(`books/${row.id}/pages.json`);
      if (!raw) return res.status(409).json({ error: 'ไม่พบหน้าของ Flipbook' });
      const payload = JSON.parse(raw);
      return res.json({ kind: 'flipbook', title: row.title, pages: payload.pages });
    }
    res.json({ kind: 'pdf', title: row.title, fileUrl: row.file_url, pages: row.pages });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/keywords', async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    const rows = await db
      .prepare('SELECT term, weight, count FROM keywords WHERE publication_id = ? ORDER BY weight DESC LIMIT 40')
      .all(row.id);
    res.json({ keywords: rows });
  } catch (error) {
    next(error);
  }
});

router.get('/:id/download', async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    const staff = req.user?.role === 'admin' || req.user?.role === 'editor';
    if (!canAccess(row, req.user, { staff })) return res.status(403).json({ error: 'เอกสารนี้ยังไม่เผยแพร่' });
    if (!row.file_url) return res.status(409).json({ error: 'เอกสารนี้ยังไม่มีไฟล์ให้ดาวน์โหลด' });

    const key = String(row.file_url).replace(/^\/uploads\//, '');
    const object = key.startsWith('..') ? null : await getObject(key);
    if (!object) return res.status(404).json({ error: 'ไม่พบไฟล์บนเซิร์ฟเวอร์' });

    const ext = path.extname(key);
    const filename = `${row.title}`.replace(/[\\/:*?"<>|]/g, ' ').trim().slice(0, 100) + ext;
    await db.prepare('UPDATE publications SET downloads = downloads + 1 WHERE id = ?').run(row.id);
    await db
      .prepare('INSERT INTO analytics_events (publication_id, user_id, type, day, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, req.user?.id ?? null, 'download', todayKey(), nowIso());

    res.setHeader('Content-Type', object.contentType || 'application/octet-stream');
    res.setHeader('Content-Length', String(object.size));
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.end(Buffer.from(object.bytes));
  } catch (error) {
    next(error);
  }
});

router.post('/:id/event', async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    const type = String(req.body?.type ?? '');
    if (!['view', 'read', 'complete'].includes(type)) return res.status(400).json({ error: 'ประเภทเหตุการณ์ไม่ถูกต้อง' });
    if (type === 'view') await db.prepare('UPDATE publications SET views = views + 1 WHERE id = ?').run(row.id);
    if (type === 'read') await db.prepare('UPDATE publications SET reads = reads + 1 WHERE id = ?').run(row.id);
    await db
      .prepare('INSERT INTO analytics_events (publication_id, user_id, type, day, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(row.id, req.user?.id ?? null, type, todayKey(), nowIso());
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/progress', requireAuth, async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    const progress = Math.min(1, Math.max(0, Number(req.body?.progress) || 0));
    const maxPage = Math.max(1, Number(row.pages) || 1);
    const page = Math.min(maxPage, Math.max(1, Number(req.body?.page) || 1));
    await db
      .prepare(
        `INSERT INTO reading_progress (user_id, publication_id, progress, page, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id, publication_id) DO UPDATE SET progress = excluded.progress, page = excluded.page, updated_at = excluded.updated_at`,
      )
      .run(req.user.id, row.id, progress, page, nowIso());
    res.json({ ok: true, progress, page });
  } catch (error) {
    next(error);
  }
});

router.post('/:id/bookmark', requireAuth, async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    const exists = await db
      .prepare('SELECT 1 AS ok FROM bookmarks WHERE user_id = ? AND publication_id = ?')
      .get(req.user.id, row.id);
    if (exists) {
      await db.prepare('DELETE FROM bookmarks WHERE user_id = ? AND publication_id = ?').run(req.user.id, row.id);
      return res.json({ bookmarked: false });
    }
    await db
      .prepare('INSERT INTO bookmarks (user_id, publication_id, created_at) VALUES (?, ?, ?)')
      .run(req.user.id, row.id, nowIso());
    res.json({ bookmarked: true });
  } catch (error) {
    next(error);
  }
});

router.post('/', canManageContent, uploader, async (req, res, next) => {
  try {
    const data = normalizeBody(req.body);
    if (!data.title) return res.status(400).json({ error: 'กรุณาระบุชื่อเรื่อง' });
    if (!(await validCategory(data, res))) return;
    const slug = await uniqueSlug('publications', data.title);
    const timestamp = nowIso();
    const info = await db
      .prepare(
        `INSERT INTO publications (slug, title, subtitle, type, description, abstract, author, publisher, year, issn, isbn,
          language, pages, category_id, status, featured, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        slug,
        data.title,
        data.subtitle ?? null,
        data.type ?? 'ebook',
        data.description ?? null,
        data.abstract ?? null,
        data.author ?? null,
        data.publisher ?? null,
        data.year ?? null,
        data.issn ?? null,
        data.isbn ?? null,
        data.language ?? 'th',
        data.pages ?? 0,
        data.category_id ?? null,
        data.status ?? 'draft',
        data.featured ?? 0,
        req.user.id,
        timestamp,
        timestamp,
      );
    const id = Number(info.lastInsertRowid);
    let publication = await db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
    let extracted = '';

    const file = req.files?.file?.[0];
    if (file) {
      const ingested = await ingestFile(publication, file);
      extracted = ingested.text;
      await db
        .prepare('UPDATE publications SET file_url = ?, file_type = ?, file_size = ?, pages = ?, type = ? WHERE id = ?')
        .run(ingested.fileUrl, ingested.fileType, ingested.fileSize, ingested.pages, data.type ?? ingested.defaults.type, id);
      publication = await db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
    }

    const cover = req.files?.cover?.[0];
    if (cover) {
      const url = await saveCover(publication, cover);
      await db.prepare('UPDATE publications SET cover_url = ? WHERE id = ?').run(url, id);
      publication = await db.prepare('SELECT * FROM publications WHERE id = ?').get(id);
    }

    await syncTags(id, parseTags(req.body.tags));
    await reindex(publication, extracted);

    publication = await db.prepare(`${basePublicationQuery()} WHERE p.id = ?`).get(id);
    if (!publication.cover_url) {
      await ensureGeneratedCover(publication);
      publication = await db.prepare(`${basePublicationQuery()} WHERE p.id = ?`).get(id);
    }

    res.status(201).json({ publication: serializePublication(publication) });
  } catch (error) {
    next(error);
  }
});

router.patch('/:id', canManageContent, uploader, async (req, res, next) => {
  try {
    const existing = await findPublication(req.params.id);
    if (!existing) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    if (req.user.role === 'editor' && existing.created_by !== req.user.id) {
      return res.status(403).json({ error: 'แก้ไขได้เฉพาะเอกสารที่คุณสร้างเท่านั้น' });
    }
    const data = normalizeBody(req.body);
    if (data.title === null) return res.status(400).json({ error: 'ชื่อเรื่องห้ามว่าง' });
    if (!(await validCategory(data, res))) return;
    const fields = Object.keys(data);
    if (fields.length) {
      const assignments = fields.map((field) => `${field} = ?`).join(', ');
      await db
        .prepare(`UPDATE publications SET ${assignments}, updated_at = ? WHERE id = ?`)
        .run(...fields.map((field) => data[field]), nowIso(), existing.id);
    }
    let publication = await db.prepare('SELECT * FROM publications WHERE id = ?').get(existing.id);
    let extracted = publication.content_text ?? '';

    const file = req.files?.file?.[0];
    if (file) {
      const previousType = publication.type;
      const ingested = await ingestFile(publication, file);
      extracted = ingested.text;
      await db
        .prepare('UPDATE publications SET file_url = ?, file_type = ?, file_size = ?, pages = ?, type = ? WHERE id = ?')
        .run(
          ingested.fileUrl,
          ingested.fileType,
          ingested.fileSize,
          ingested.pages,
          data.type ?? (previousType === 'flipbook' ? ingested.defaults.type : previousType),
          existing.id,
        );
      publication = await db.prepare('SELECT * FROM publications WHERE id = ?').get(existing.id);
    }

    const cover = req.files?.cover?.[0];
    if (cover) {
      const url = await saveCover(publication, cover);
      await db.prepare('UPDATE publications SET cover_url = ? WHERE id = ?').run(url, existing.id);
    }
    if (req.body.tags !== undefined) await syncTags(existing.id, parseTags(req.body.tags));

    publication = await db.prepare('SELECT * FROM publications WHERE id = ?').get(existing.id);
    await reindex(publication, extracted);
    if (!publication.cover_url || /^\/uploads\/covers\/auto-/.test(publication.cover_url)) {
      await db.prepare('UPDATE publications SET cover_url = NULL WHERE id = ?').run(existing.id);
      const refreshed = await db.prepare('SELECT * FROM publications WHERE id = ?').get(existing.id);
      await ensureGeneratedCover({ ...refreshed, category_name: existing.category_name });
    }

    const finalRow = await db.prepare(`${basePublicationQuery()} WHERE p.id = ?`).get(existing.id);
    res.json({ publication: serializePublication(finalRow) });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', canManageContent, async (req, res, next) => {
  try {
    const row = await findPublication(req.params.id);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    if (req.user.role === 'editor' && row.created_by !== req.user.id) {
      return res.status(403).json({ error: 'ลบได้เฉพาะเอกสารที่คุณสร้างเท่านั้น' });
    }
    await db.prepare('DELETE FROM publications WHERE id = ?').run(row.id);
    await db.prepare('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM publication_tags)').run();
    await deleteObjects(`books/${row.id}`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
