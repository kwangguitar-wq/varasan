import { contentTypeFor } from '../storage.js';

/** Cloudflare R2 storage for uploads and derived files. */
export function createR2Storage(bucket) {
  return {
    async put(key, bytes, contentType) {
      await bucket.put(key, bytes, {
        httpMetadata: { contentType: contentType ?? contentTypeFor(key) },
      });
    },
    async get(key) {
      const object = await bucket.get(key);
      if (!object) return null;
      const bytes = new Uint8Array(await object.arrayBuffer());
      return {
        bytes,
        contentType: object.httpMetadata?.contentType ?? contentTypeFor(key),
        size: bytes.length,
      };
    },
    async exists(key) {
      return Boolean(await bucket.head(key));
    },
    async delete(key) {
      await bucket.delete(key);
    },
    async deletePrefix(prefix) {
      let cursor;
      do {
        const listing = await bucket.list({ prefix, cursor });
        if (listing.objects.length) {
          await bucket.delete(listing.objects.map((object) => object.key));
        }
        cursor = listing.truncated ? listing.cursor : undefined;
      } while (cursor);
    },
  };
}
