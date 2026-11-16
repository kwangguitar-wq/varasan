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
    async stat(key) {
      const target = resolve(key);
      if (!target.startsWith(uploadDir) || !fs.existsSync(target)) return null;
      const info = fs.statSync(target);
      if (!info.isFile()) return null;
      return { size: info.size, contentType: contentTypeFor(key) };
    },
    async readRange(key, start, end) {
      const target = resolve(key);
      if (!target.startsWith(uploadDir) || !fs.existsSync(target)) return null;
      const info = fs.statSync(target);
      const length = Math.min(end, info.size - 1) - start + 1;
      if (length <= 0) return null;
      const fd = fs.openSync(target, 'r');
      try {
        const buffer = Buffer.alloc(length);
        fs.readSync(fd, buffer, 0, length, start);
        return { bytes: new Uint8Array(buffer), contentType: contentTypeFor(key), total: info.size };
      } finally {
        fs.closeSync(fd);
      }
    },
    // Local files are served by the app, so there is no external CDN link.
    async link() {
      return null;
    },
    async exists(key) {
      return fs.existsSync(resolve(key));
    },
    async list(prefix) {
      if (!fs.existsSync(uploadDir)) return [];
      const walk = (dir) =>
        fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
          const full = path.join(dir, entry.name);
          return entry.isDirectory()
            ? walk(full)
            : [path.relative(uploadDir, full).split(path.sep).join('/')];
        });
      return walk(uploadDir).filter((key) => key.startsWith(prefix)).sort();
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
