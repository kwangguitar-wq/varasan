// Database-backed object storage, so a Vercel deployment works without any
// external bucket: the same Turso/libSQL database that holds the library keeps
// the uploaded books, covers and derived files. Rows are read back in windows
// with substr(), which keeps a large book from being buffered on every request.
import { contentTypeFor } from '../storage.js';

export const UPLOAD_OBJECTS_SCHEMA = `CREATE TABLE IF NOT EXISTS upload_objects (
  key TEXT PRIMARY KEY,
  bytes BLOB NOT NULL,
  content_type TEXT,
  size INTEGER NOT NULL,
  updated_at TEXT NOT NULL
)`;

const nowIso = () => new Date().toISOString();

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value ?? []);
}

export function createLibsqlStorage(client) {
  let ready = null;

  const ensure = () => {
    if (!ready) {
      ready = client.execute(UPLOAD_OBJECTS_SCHEMA).catch((error) => {
        ready = null;
        throw error;
      });
    }
    return ready;
  };

  const query = async (sql, args = []) => {
    await ensure();
    return client.execute({ sql, args });
  };

  const statOf = async (key) => {
    const result = await query('SELECT size, content_type FROM upload_objects WHERE key = ?', [key]);
    const row = result.rows[0];
    if (!row) return null;
    return { size: Number(row[0] ?? 0), contentType: row[1] || contentTypeFor(key) };
  };

  return {
    async put(key, bytes, contentType) {
      const data = toBytes(bytes);
      await query(
        `INSERT INTO upload_objects (key, bytes, content_type, size, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET bytes = excluded.bytes, content_type = excluded.content_type,
           size = excluded.size, updated_at = excluded.updated_at`,
        [key, data, contentType ?? contentTypeFor(key), data.length, nowIso()],
      );
    },
    async get(key) {
      const result = await query('SELECT bytes, content_type FROM upload_objects WHERE key = ?', [key]);
      const row = result.rows[0];
      if (!row) return null;
      const bytes = toBytes(row[0]);
      return { bytes, contentType: row[1] || contentTypeFor(key), size: bytes.length };
    },
    stat: statOf,
    async readRange(key, start, end) {
      const info = await statOf(key);
      if (!info) return null;
      const from = Math.max(0, Math.min(start, info.size));
      const last = Math.min(end, info.size - 1);
      const length = last - from + 1;
      if (length <= 0) return { bytes: new Uint8Array(0), contentType: info.contentType, total: info.size };

      const result = await query('SELECT substr(bytes, ?, ?) AS chunk FROM upload_objects WHERE key = ?', [
        from + 1,
        length,
        key,
      ]);
      const chunk = toBytes(result.rows[0]?.[0]);
      if (chunk.length === length) return { bytes: chunk, contentType: info.contentType, total: info.size };

      // Defensive fallback: some SQLite builds refuse substr() on blobs.
      const full = await this.get(key);
      if (!full) return null;
      return {
        bytes: full.bytes.subarray(from, last + 1),
        contentType: full.contentType,
        total: full.size,
      };
    },
    async exists(key) {
      const result = await query('SELECT 1 AS found FROM upload_objects WHERE key = ?', [key]);
      return result.rows.length > 0;
    },
    // Rows are served by the app itself, so there is no external CDN link.
    async link() {
      return null;
    },
    async list(prefix) {
      const result = await query('SELECT key FROM upload_objects WHERE key LIKE ? ORDER BY key', [
        `${prefix}%`,
      ]);
      return result.rows.map((row) => String(row[0]));
    },
    async delete(key) {
      await query('DELETE FROM upload_objects WHERE key = ?', [key]);
    },
    async deletePrefix(prefix) {
      await query('DELETE FROM upload_objects WHERE key LIKE ?', [`${prefix}%`]);
    },
  };
}
