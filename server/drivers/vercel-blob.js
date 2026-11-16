import { del, get, head, list, put } from '@vercel/blob';
import { contentTypeFor } from '../storage.js';

/**
 * Vercel Blob storage for uploads on Vercel: books, covers and derived files.
 * Keys are the same relative paths used for R2 and local disk, e.g.
 * "books/12/book.pdf", so stored `file_url` values keep working unchanged.
 *
 * A store is created as either public or private and that choice cannot be
 * changed afterwards, so the driver detects it on first use: writing with the
 * wrong mode fails with "Cannot use public access on a private store", after
 * which every later call reuses the mode that actually works. BLOB_STORE_ACCESS
 * (public|private) skips the detection when it is set explicitly.
 */
const configured = String(process.env.BLOB_STORE_ACCESS ?? '').trim().toLowerCase();
let accessMode = configured === 'public' || configured === 'private' ? configured : null;

const isPrivateStoreError = (cause) => /private (access|store)/i.test(String(cause?.message ?? cause ?? ''));

/** Detected access mode: 'public', 'private', or null while still unknown. */
export function blobAccessMode() {
  return accessMode;
}

export function createBlobStorage({ token }) {
  const auth = token ? { token } : {};

  // Surface the real cause (bad/expired token, network) to the admin screen
  // instead of the generic internal-server-error message.
  const wrap = (action) => (cause) => {
    const error = new Error(`Vercel Blob: ${action}ไม่สำเร็จ — ${cause?.message ?? cause}`);
    error.expose = true;
    error.status = 502;
    throw error;
  };

  /** Runs a blob call with the detected access mode, retrying once on a private store. */
  async function withAccess(run) {
    const mode = accessMode ?? 'public';
    try {
      return await run(mode);
    } catch (error) {
      if (mode === 'private' || !isPrivateStoreError(error)) throw error;
      accessMode = 'private';
      return run('private');
    }
  }

  async function headOrNull(key) {
    try {
      return await head(key, auth);
    } catch {
      // head() throws BlobNotFoundError for a missing object.
      return null;
    }
  }

  async function readAll(key) {
    const result = await withAccess((access) => get(key, { access, ...auth })).catch(wrap('อ่านไฟล์'));
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    return {
      bytes,
      contentType: result.blob?.contentType ?? contentTypeFor(key),
      size: bytes.length,
    };
  }

  return {
    async put(key, bytes, contentType) {
      const options = {
        ...auth,
        contentType: contentType ?? contentTypeFor(key),
        addRandomSuffix: false,
        allowOverwrite: true,
      };
      await withAccess((access) => put(key, bytes, { ...options, access })).catch(wrap('บันทึกไฟล์'));
    },
    get: readAll,
    /** Metadata only, so a range request never has to download the whole book. */
    async stat(key) {
      const info = await headOrNull(key);
      if (!info) return null;
      const size = Number(info.size);
      if (!Number.isFinite(size)) return null;
      return { size, contentType: info.contentType || contentTypeFor(key) };
    },
    /** Reads `start`..`end` (inclusive) without buffering the whole blob. */
    async readRange(key, start, end) {
      const result = await withAccess((access) =>
        get(key, { access, ...auth, headers: { Range: `bytes=${start}-${end}` } }),
      ).catch(wrap('อ่านไฟล์'));
      if (!result || !result.stream) return null;
      const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
      const contentRange = result.headers?.get?.('content-range') ?? null;
      if (contentRange) {
        const total = Number(contentRange.split('/').pop());
        return {
          bytes,
          contentType: result.blob?.contentType ?? contentTypeFor(key),
          total: Number.isFinite(total) ? total : bytes.length,
        };
      }
      // Store ignored the Range header and sent everything: cut the window out.
      const slice = bytes.subarray(Math.min(start, bytes.length), Math.min(end + 1, bytes.length));
      return {
        bytes: slice,
        contentType: result.blob?.contentType ?? contentTypeFor(key),
        total: bytes.length,
      };
    },
    async exists(key) {
      return Boolean(await headOrNull(key));
    },
    /**
     * Browser-usable links. Private blobs require the token, so a private store
     * has none and the file must be proxied through the app instead.
     */
    async link(key) {
      if (accessMode === 'private') return null;
      // A read is the cheapest way to learn the mode on a fresh instance.
      await readAllOnce(key);
      if (accessMode === 'private') return null;
      const info = await headOrNull(key);
      if (!info) return null;
      return { url: info.url, downloadUrl: info.downloadUrl ?? info.url };
    },
    /** Every key under `prefix`, paged, for rebuilding rows from the store. */
    async list(prefix) {
      const keys = [];
      let cursor;
      do {
        const page = await list({ prefix, cursor, ...auth, limit: 1000 });
        for (const blob of page.blobs) keys.push(blob.pathname);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
    async delete(key) {
      await del(key, auth);
    },
    async deletePrefix(prefix) {
      let cursor;
      do {
        const page = await list({ prefix, cursor, ...auth, limit: 1000 });
        if (page.blobs.length) await del(page.blobs.map((blob) => blob.url), auth);
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    },
  };

  async function readAllOnce(key) {
    if (accessMode) return;
    const result = await withAccess((access) => get(key, { access, ...auth })).catch(() => null);
    if (result?.stream) await new Response(result.stream).arrayBuffer().catch(() => null);
  }
}
