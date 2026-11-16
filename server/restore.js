// Rebuilds library rows from the files that are still in object storage.
//
// The database and the bucket are separate services: a Turso integration that
// hands every deployment a fresh database leaves all uploaded books sitting in
// Blob with no row pointing at them, so the library came back empty while every
// file was still there. Each upload therefore writes a books/<id>/meta.json
// sidecar next to its file, and this module rebuilds a publication for any book
// file that no row references. Nothing is deleted or overwritten: books that are
// already listed are left exactly as they are.
import { db, nowIso, uniqueSlug } from './db.js';
import { generateCoverSvg } from './covers.js';
import { makeExcerpt, readPdfInfo } from './indexer.js';
import { getObject, getText, keyFromUrl, listKeys, putObject, statObject, uploadUrl } from './storage.js';

const BOOK_FILE = /^book\.(pdf|epub|zip)$/i;

const RUN_TABLE = `CREATE TABLE IF NOT EXISTS restore_runs (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_run_at TEXT NOT NULL,
  restored INTEGER NOT NULL DEFAULT 0
)`;

// Every request boots the app, so a scan of the bucket needs a cooldown: without
// it a cold isolate would list storage on each request.
const COOLDOWN_MS = 10 * 60 * 1000;

const encoder = new TextEncoder();
const keyOf = (url) => (url ? keyFromUrl(url) : null);

/** "books/15/book.pdf" → { storageId: 15, name: "book.pdf" } */
function parseBookKey(key) {
  const match = /^books\/(\d+)\/(.+)$/i.exec(String(key));
  return match ? { storageId: Number(match[1]), name: match[2] } : null;
}

function fileTypeOf(key) {
  const ext = String(key).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'epub') return 'epub';
  if (ext === 'zip') return 'zip';
  return 'pdf';
}

async function readSidecar(storageId) {
  try {
    const text = await getText(`books/${storageId}/meta.json`);
    if (!text) return null;
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    // A missing or damaged sidecar only costs metadata, not the book.
    return null;
  }
}

/** Page count and, for a book uploaded without a sidecar, its own metadata. */
async function inspectFile(key, meta) {
  const known = Number(meta?.pages);
  if (Number.isFinite(known) && known > 0) return { pages: known, title: null, author: null };
  if (!/\.pdf$/i.test(key)) return { pages: 0, title: null, author: null };
  const object = await getObject(key);
  if (!object) return { pages: 0, title: null, author: null };
  return readPdfInfo(object.bytes);
}

async function categoryIdFor(slug) {
  if (!slug) return null;
  const row = await db.prepare('SELECT id FROM categories WHERE slug = ?').get(String(slug));
  return row ? row.id : null;
}

async function createdByFor(email) {
  if (email) {
    const row = await db.prepare('SELECT id FROM users WHERE email = ?').get(String(email));
    if (row) return row.id;
  }
  // Restored books keep an owner so an admin can still edit them.
  const admin = await db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  return admin ? admin.id : null;
}

async function coverFor(storageId, meta, coverKeys) {
  const sidecarKey = keyOf(meta?.cover_url);
  if (sidecarKey && coverKeys.includes(sidecarKey)) return meta.cover_url;
  const match =
    coverKeys.find((key) => key === `covers/seed-${storageId}.svg`) ??
    coverKeys.find((key) => key.startsWith(`covers/cover-${storageId}-`));
  return match ? uploadUrl(match) : null;
}

async function generatedCover({ id, title, author, type, categoryName }) {
  const svg = generateCoverSvg({ title, author: author ?? '', type, category: categoryName ?? '', id });
  const key = `covers/auto-${id}.svg`;
  await putObject(key, encoder.encode(svg), 'image/svg+xml');
  return uploadUrl(key);
}

/**
 * Writes (or refreshes) the sidecar that makes a rebuild lossless. Called after
 * a file, cover or metadata change, and again after a restore.
 */
export async function writeBookMeta(publicationId) {
  try {
    const row = await db.prepare('SELECT * FROM publications WHERE id = ?').get(publicationId);
    if (!row || !row.file_url) return;
    const category = row.category_id
      ? await db.prepare('SELECT slug FROM categories WHERE id = ?').get(row.category_id)
      : null;
    const owner = row.created_by
      ? await db.prepare('SELECT email FROM users WHERE id = ?').get(row.created_by)
      : null;
    const meta = {
      version: 1,
      storage_id: row.id,
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
      file_url: row.file_url,
      file_type: row.file_type,
      file_size: row.file_size,
      cover_url: row.cover_url,
      status: row.status,
      featured: row.featured,
      category: category?.slug ?? null,
      created_by: owner?.email ?? null,
      created_at: row.created_at,
    };
    await putObject(
      `books/${row.id}/meta.json`,
      encoder.encode(`${JSON.stringify(meta, null, 2)}\n`),
      'application/json; charset=utf-8',
    );
  } catch (error) {
    // The book itself is already saved; a sidecar failure must not fail the save.
    console.warn('[nakhonmaesot] บันทึกข้อมูลกำกับหนังสือไม่สำเร็จ', error?.message ?? error);
  }
}

/**
 * Restores a publication for every book file in storage that no row points at.
 * Returns what it found, so an admin can see the result instead of guessing.
 */
export async function restoreBooks({ dryRun = false } = {}) {
  const [bookKeys, coverKeys] = await Promise.all([listKeys('books/'), listKeys('covers/')]);
  const rows = await db.prepare('SELECT id, file_url FROM publications').all();
  const claimed = new Set(rows.map((row) => keyOf(row.file_url)).filter(Boolean));

  const byStorageId = new Map();
  for (const key of bookKeys) {
    const parsed = parseBookKey(key);
    if (!parsed || !BOOK_FILE.test(parsed.name)) continue;
    const keys = byStorageId.get(parsed.storageId) ?? [];
    keys.push(key);
    byStorageId.set(parsed.storageId, keys);
  }

  const restored = [];
  const failed = [];
  for (const storageId of [...byStorageId.keys()].sort((a, b) => a - b)) {
    const key = byStorageId.get(storageId).find((candidate) => BOOK_FILE.test(parseBookKey(candidate)?.name ?? ''));
    if (!key || claimed.has(key)) continue;
    try {
      const meta = await readSidecar(storageId);
      const stat = await statObject(key).catch(() => null);
      const info = await inspectFile(key, meta).catch(() => ({ pages: 0, title: null, author: null }));
      const title = String(meta?.title ?? info.title ?? '').trim() || `หนังสือ #${storageId}`;
      const pages = Number(meta?.pages) > 0 ? Number(meta.pages) : Number(info.pages) || 0;

      if (dryRun) {
        restored.push({ storageId, title, pages, fileUrl: uploadUrl(key) });
        continue;
      }

      // Reuse the original id so an existing /uploads/books/<id>/ URL, a
      // bookmark or a shared link keeps resolving to the same book.
      const taken = await db.prepare('SELECT id FROM publications WHERE id = ?').get(storageId);
      const categoryId = await categoryIdFor(meta?.category);
      const filter = categoryId ? await db.prepare('SELECT name FROM categories WHERE id = ?').get(categoryId) : null;
      const type = String(meta?.type ?? 'ebook');
      const author = String(meta?.author ?? info.author ?? '').trim() || null;
      const slug = await uniqueSlug('publications', title);
      const createdBy = await createdByFor(meta?.created_by);
      const createdAt = meta?.created_at ?? nowIso();
      const year = Number(meta?.year);

      const inserted = await db
        .prepare(
          `INSERT INTO publications (id, slug, title, subtitle, type, description, abstract, author, publisher,
             year, issn, isbn, language, pages, category_id, cover_url, file_url, file_type, file_size, excerpt,
             status, featured, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          taken ? null : storageId,
          slug,
          title,
          meta?.subtitle ?? null,
          type,
          meta?.description ?? null,
          meta?.abstract ?? null,
          author,
          meta?.publisher ?? null,
          Number.isFinite(year) && year > 0 ? Math.round(year) : null,
          meta?.issn ?? null,
          meta?.isbn ?? null,
          String(meta?.language ?? 'th'),
          pages,
          categoryId,
          null,
          uploadUrl(key),
          fileTypeOf(key),
          Number(stat?.size) || 0,
          makeExcerpt(String(meta?.abstract ?? meta?.description ?? title)),
          String(meta?.status ?? 'published'),
          Number(meta?.featured) ? 1 : 0,
          createdBy,
          createdAt,
          nowIso(),
        );

      const id = Number(inserted.lastInsertRowid);
      let coverUrl = await coverFor(storageId, meta, coverKeys);
      if (!coverUrl) {
        coverUrl = await generatedCover({
          id,
          title,
          author,
          type,
          categoryName: filter?.name ?? '',
        }).catch(() => null);
      }
      if (coverUrl) {
        await db.prepare('UPDATE publications SET cover_url = ? WHERE id = ?').run(coverUrl, id);
      }
      // A book that was restored from its file alone now gains a sidecar, so the
      // next rebuild keeps its title, category and owner.
      await writeBookMeta(id);
      restored.push({ id, title, pages, fileUrl: uploadUrl(key) });
    } catch (error) {
      failed.push({ storageId, key, error: String(error?.message ?? error) });
    }
  }

  return { scanned: byStorageId.size, restored, failed };
}

/**
 * Boot hook: rebuilds any missing rows, at most once per cooldown window.
 * Never throws, because a bucket hiccup must not stop the whole request.
 */
export async function restoreOnBoot({ force = false } = {}) {
  try {
    await db.exec(RUN_TABLE);
    const marker = await db.prepare('SELECT last_run_at FROM restore_runs WHERE id = 1').get();
    if (!force && marker?.last_run_at && Date.now() - Date.parse(marker.last_run_at) < COOLDOWN_MS) {
      return null;
    }
    await db
      .prepare(
        `INSERT INTO restore_runs (id, last_run_at, restored) VALUES (1, ?, 0)
         ON CONFLICT(id) DO UPDATE SET last_run_at = excluded.last_run_at`,
      )
      .run(nowIso());
    const summary = await restoreBooks();
    if (summary.restored.length) {
      await db
        .prepare('UPDATE restore_runs SET restored = restored + ? WHERE id = 1')
        .run(summary.restored.length);
      console.log(`[nakhonmaesot] กู้คืนหนังสือจากไฟล์ในที่เก็บ ${summary.restored.length} เล่ม`);
    }
    return summary;
  } catch (error) {
    console.warn('[nakhonmaesot] กู้คืนหนังสือจากไฟล์ในที่เก็บไม่สำเร็จ', error?.message ?? error);
    return null;
  }
}
