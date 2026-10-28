import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');
// LUMEN_DATA_DIR lets the build (Vercel) write demo files somewhere writable.
export const DATA_DIR = process.env.LUMEN_DATA_DIR
  ? path.resolve(process.env.LUMEN_DATA_DIR)
  : path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
export const TMP_DIR = path.join(DATA_DIR, 'tmp');
export const DB_PATH = process.env.DATABASE_PATH ?? path.join(DATA_DIR, 'lumen.db');

// The Vercel Function bundle is read-only; storage there is Vercel Blob, so a
// failed mkdir must not crash the module at import time.
for (const dir of [DATA_DIR, UPLOAD_DIR, TMP_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // read-only bundle — cloud storage drivers are used instead
  }
}
