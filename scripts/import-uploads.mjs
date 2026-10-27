import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Upload data/uploads/** into the preview R2 bucket with wrangler.
// Usage: R2_BUCKET=<bucket-name> node scripts/import-uploads.mjs
const ROOT = path.resolve(import.meta.dirname, '..');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const bucket = process.env.R2_BUCKET;

if (!bucket) {
  console.error('set R2_BUCKET to the wrangler R2 bucket name first');
  process.exit(1);
}

const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      return entry.isDirectory() ? walk(full) : [full];
    });

for (const full of walk(UPLOAD_DIR)) {
  const key = path.relative(UPLOAD_DIR, full).split(path.sep).join('/');
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `${bucket}/${key}`, '--file', full], {
    stdio: 'inherit',
    cwd: ROOT,
  });
}
console.log('uploads synced to R2');