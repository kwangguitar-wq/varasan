import { del, get, head, list, put } from '@vercel/blob';
import { contentTypeFor } from '../storage.js';

/**
 * Vercel Blob storage for uploads on Vercel: books, covers and derived files.
 * Keys are the same relative paths used for R2 and local disk, e.g.
 * "books/12/book.pdf", so stored `file_url` values keep working unchanged.
 */
export function createBlobStorage({ token }) {
  const auth = token ? { token } : {};

  async function headOrNull(key) {
    try {
      return await head(key, auth);
    } catch {
      // head() throws BlobNotFoundError for a missing object.
      return null;
    }
  }

  return {
    async put(key, bytes, contentType) {
      await put(key, bytes, {
        ...auth,
        access: 'public',
        contentType: contentType ?? contentTypeFor(key),
        addRandomSuffix: false,
        allowOverwrite: true,
      });
    },
    async get(key) {
      const result = await get(key, { access: 'public', ...auth });
      if (!result || result.statusCode !== 200 || !result.stream) return null;
      const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
      return {
        bytes,
        contentType: result.blob?.contentType ?? contentTypeFor(key),
        size: bytes.length,
      };
    },
    async exists(key) {
      return Boolean(await headOrNull(key));
    },
    /** Public CDN URL, used to hand large files to the client directly. */
    async url(key) {
      return (await headOrNull(key))?.url ?? null;
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
}
