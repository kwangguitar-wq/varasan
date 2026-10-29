// One-shot cloud seed, run from the Vercel build script.
//
// Vercel cannot ship the local SQLite file or data/uploads, so the demo library
// is generated from server/seed.js into Turso, and the files are copied into
// whatever upload backend the deployment selected (Vercel Blob or the database
// itself). It is idempotent: a database that already has users is left untouched.
import fs from 'node:fs';
import path from 'node:path';
import {
  cloudConfig,
  cloudStorageBackend,
  configureCloud,
  ensureCloudSchema,
  ensureUploadSchema,
  isCloudConfigured,
} from '../server/cloud.js';
import { db } from '../server/db.js';
import { UPLOAD_DIR } from '../server/paths.js';
import { objectExists, putObject } from '../server/storage.js';

const settings = cloudConfig();
if (!isCloudConfigured(settings)) {
  console.log('[nakhonmaesot:seed] TURSO_DATABASE_URL ยังไม่ได้ตั้งค่า — ข้ามการ seed ข้อมูลคลาวด์');
  process.exit(0);
}

const client = configureCloud(settings);
const created = await ensureCloudSchema(client);
await ensureUploadSchema(client);
const backend = cloudStorageBackend();
console.log(
  `[nakhonmaesot:seed] schema ${created ? 'created' : 'already present'} · ที่เก็บไฟล์: ${backend}`,
);

const users = (await db.prepare('SELECT COUNT(*) AS n FROM users').get())?.n ?? 0;
if (users > 0) {
  console.log(`[nakhonmaesot:seed] พบผู้ใช้ ${users} คนในฐานข้อมูลแล้ว — ข้ามการ seed`);
} else {
  const started = Date.now();
  const { seedDatabase } = await import('../server/seed.js');
  await seedDatabase();
  console.log(`[nakhonmaesot:seed] สร้างข้อมูลตัวอย่างเสร็จใน ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

const walk = (dir, base = dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, base) : [path.relative(base, full).split(path.sep).join('/')];
  });
};

const keys = walk(UPLOAD_DIR).sort();
let copied = 0;
try {
  for (const key of keys) {
    if (await objectExists(key)) continue;
    const bytes = new Uint8Array(fs.readFileSync(path.join(UPLOAD_DIR, key)));
    await putObject(key, bytes);
    copied += 1;
  }
  console.log(`[nakhonmaesot:seed] คัดลอกไฟล์เข้า ${backend} ${copied}/${keys.length} ไฟล์`);
} catch (error) {
  // A storage hiccup must not fail the whole deployment: the site still serves
  // the database, and the missing files can be re-seeded by the next build.
  console.warn(
    `[nakhonmaesot:seed] คัดลอกไฟล์เข้า ${backend} ได้ ${copied}/${keys.length} ไฟล์ แล้วหยุดเพราะ: ${error?.message ?? error}`,
  );
}
