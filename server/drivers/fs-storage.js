import fs from 'node:fs';
import path from 'node:path';
import { contentTypeFor } from '../storage.js';

/** Local development storage: plain files under data/uploads. */
export function createFsStorage(uploadDir) {
  const resolve = (key) => path.join(uploadDir, key);

  return {
    async put(key, bytes, contentType) {
      void contentType;
      const target = resolve(key);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, bytes);
    },
    async get(key) {
      const target = resolve(key);
      if (!target.startsWith(uploadDir) || !fs.existsSync(target)) return null;
      const bytes = new Uint8Array(fs.readFileSync(target));
      return { bytes, contentType: contentTypeFor(key), size: bytes.length };
    },
    async exists(key) {
      return fs.existsSync(resolve(key));
    },
    async delete(key) {
      const target = resolve(key);
      if (target.startsWith(uploadDir)) fs.rmSync(target, { force: true });
    },
    async deletePrefix(prefix) {
      const target = resolve(prefix);
      if (!target.startsWith(uploadDir)) return;
      fs.rmSync(target, { recursive: true, force: true });
    },
  };
}
