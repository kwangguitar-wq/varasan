// Chunked uploads for hosts that cap a single request body (Vercel allows
// 4.5 MB per Function request, far below a real book). The browser splits the
// file, each chunk lands in object storage, and finish() joins the parts so the
// normal ingest pipeline still extracts text, pages and keywords.
import express from 'express';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, nowIso, runtime } from '../db.js';
import { canManageContent } from '../auth.js';
import { contentTypeFor, deleteObjects, getObject, putObject, uploadUrl } from '../storage.js';
import { writeBookMeta } from '../restore.js';
import { attachStoredFile, serializeForClient } from './publications.js';

const router = express.Router();

const BOOK_EXT = new Set(['.pdf', '.epub', '.zip']);
const COVER_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);

const partKey = (sessionId, index) => `tmp/uploads/${sessionId}/${String(index).padStart(4, '0')}`;
const megabytes = (bytes) => Math.round(bytes / (1024 * 1024));

router.get('/config', (_req, res) => {
  res.json({
    mode: runtime.uploadMode,
    chunkBytes: runtime.chunkBytes,
    maxFileBytes: runtime.maxUploadBytes,
  });
});

async function ownedSession(req) {
  const session = await db.prepare('SELECT * FROM upload_sessions WHERE id = ?').get(String(req.params.id));
  if (!session) return null;
  if (req.user.role !== 'admin' && session.user_id !== req.user.id) return null;
  return session;
}

router.post('/start', canManageContent, async (req, res, next) => {
  try {
    if (runtime.storageIssue) return res.status(503).json({ error: runtime.storageIssue });
    const publicationId = Number(req.body?.publicationId);
    const kind = req.body?.kind === 'cover' ? 'cover' : 'file';
    const filename = String(req.body?.filename ?? '').slice(0, 200);
    const size = Number(req.body?.size);
    const ext = path.extname(filename).toLowerCase();

    if (!Number.isInteger(publicationId) || publicationId <= 0) {
      return res.status(400).json({ error: 'ไม่พบรายการที่ต้องการแนบไฟล์' });
    }
    if (!Number.isFinite(size) || size <= 0) {
      return res.status(400).json({ error: 'ขนาดไฟล์ไม่ถูกต้อง' });
    }
    if (size > runtime.maxUploadBytes) {
      return res.status(413).json({ error: `ไฟล์ใหญ่เกินกำหนด (สูงสุด ${megabytes(runtime.maxUploadBytes)} MB)` });
    }
    if (kind === 'file' && !BOOK_EXT.has(ext)) {
      return res.status(400).json({ error: 'รองรับเฉพาะไฟล์ PDF, ePub หรือ ZIP (Flipbook)' });
    }
    if (kind === 'cover' && !COVER_EXT.has(ext)) {
      return res.status(400).json({ error: 'รูปปกต้องเป็น JPG, PNG, WebP หรือ AVIF' });
    }

    const row = await db.prepare('SELECT id, created_by FROM publications WHERE id = ?').get(publicationId);
    if (!row) return res.status(404).json({ error: 'ไม่พบเอกสารนี้' });
    if (req.user.role === 'editor' && row.created_by !== req.user.id) {
      return res.status(403).json({ error: 'แก้ไขได้เฉพาะเอกสารที่คุณสร้างเท่านั้น' });
    }

    const id = randomUUID();
    const parts = Math.max(1, Math.ceil(size / runtime.chunkBytes));
    await db
      .prepare(
        `INSERT INTO upload_sessions (id, user_id, publication_id, kind, filename, size, parts, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, req.user.id, publicationId, kind, filename, size, parts, nowIso());

    res.status(201).json({ id, chunkBytes: runtime.chunkBytes, parts });
  } catch (error) {
    next(error);
  }
});

router.put(
  '/:id/chunk/:index',
  canManageContent,
  express.raw({ type: '*/*', limit: runtime.chunkBytes + 1024 * 1024 }),
  async (req, res, next) => {
    try {
      const session = await ownedSession(req);
      if (!session) return res.status(404).json({ error: 'ไม่พบการอัปโหลดนี้' });
      const index = Number(req.params.index);
      if (!Number.isInteger(index) || index < 1 || index > session.parts) {
        return res.status(400).json({ error: 'ลำดับชิ้นไฟล์ไม่ถูกต้อง' });
      }
      const body = Buffer.isBuffer(req.body) ? req.body : null;
      if (!body || body.length === 0) return res.status(400).json({ error: 'ไม่พบข้อมูลในชิ้นไฟล์' });

      await putObject(partKey(session.id, index), new Uint8Array(body), 'application/octet-stream');
      await db
        .prepare('INSERT OR REPLACE INTO upload_parts (session_id, idx, size) VALUES (?, ?, ?)')
        .run(session.id, index, body.length);

      const received = (await db.prepare('SELECT COUNT(*) AS n FROM upload_parts WHERE session_id = ?').get(session.id))?.n ?? 0;
      res.json({ received, parts: session.parts });
    } catch (error) {
      next(error);
    }
  },
);

router.post('/:id/finish', canManageContent, async (req, res, next) => {
  try {
    const session = await ownedSession(req);
    if (!session) return res.status(404).json({ error: 'ไม่พบการอัปโหลดนี้' });

    const parts = await db
      .prepare('SELECT idx FROM upload_parts WHERE session_id = ? ORDER BY idx')
      .all(session.id);
    if (parts.length !== session.parts) {
      return res.status(409).json({ error: `อัปโหลดไม่ครบ (${parts.length}/${session.parts} ชิ้น)` });
    }

    const buffers = [];
    for (const part of parts) {
      const object = await getObject(partKey(session.id, part.idx));
      if (!object) return res.status(409).json({ error: 'ชิ้นไฟล์สูญหาย กรุณาเริ่มอัปโหลดใหม่' });
      buffers.push(Buffer.from(object.bytes));
    }
    const buffer = Buffer.concat(buffers);
    if (buffer.length !== session.size) {
      return res.status(409).json({ error: 'ขนาดไฟล์รวมไม่ตรงกับที่แจ้งไว้ กรุณาอัปโหลดใหม่' });
    }

    let publication = null;
    if (session.kind === 'cover') {
      const ext = path.extname(session.filename).toLowerCase();
      const filename = `cover-${session.publication_id}-${Date.now()}${ext}`;
      await putObject(`covers/${filename}`, buffer, contentTypeFor(filename));
      await db
        .prepare('UPDATE publications SET cover_url = ?, updated_at = ? WHERE id = ?')
        .run(uploadUrl(`covers/${filename}`), nowIso(), session.publication_id);
      await writeBookMeta(session.publication_id);
    } else {
      // The browser measures the page count while uploading; prefer it over the
      // server-side PDF parser, which may be missing assets on the host.
      const reportedPages = Number(req.body?.pages);
      publication = await attachStoredFile(
        session.publication_id,
        { filename: session.filename, buffer },
        Number.isFinite(reportedPages) && reportedPages > 0 ? { pages: Math.round(reportedPages) } : {},
      );
    }

    await db.prepare('DELETE FROM upload_parts WHERE session_id = ?').run(session.id);
    await db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id);
    await deleteObjects(`tmp/uploads/${session.id}`);

    if (!publication) publication = await serializeForClient(session.publication_id);
    res.json({ publication });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', canManageContent, async (req, res, next) => {
  try {
    const session = await ownedSession(req);
    if (!session) return res.json({ ok: true });
    await db.prepare('DELETE FROM upload_parts WHERE session_id = ?').run(session.id);
    await db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(session.id);
    await deleteObjects(`tmp/uploads/${session.id}`);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

export default router;
