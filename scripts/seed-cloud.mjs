// One-shot cloud seed, run from the Vercel build script.
//
// Vercel cannot ship the local SQLite file or data/uploads, so the demo library
// is generated from server/seed.js into Turso and Vercel Blob. It is
// idempotent: a database that already has users is left untouched.
import fs from 'node:fs';
import path from 'node:path';
import { cloudConfig, configureCloud, ensureCloudSchema, isCloudConfigured } from '../server/cloud.js';
import { db } from '../server/db.js';
import { UPLOAD_DIR } from '../server/paths.js';
import { objectExists, putObject } from '../server/storage.js';

const settings = cloudConfig();
if (!isCloudConfigured(settings)) {
  console.log('[lumen:seed] TURSO_DATABASE_URL ยังไม่ได้ตั้งค่า — ข้ามการ seed ข้อมูลคลาวด์');
  process.exit(0);
}

const client = configureCloud(settings);
const created = await ensureCloudSchema(client);
console.log(`[lumen:seed] schema ${created ? 'created' : 'already present'}`);

const users = (await db.prepare('SELECT COUNT(*) AS n FROM users').get())?.n ?? 0;
if (users > 0) {
  console.log(`[lumen:seed] พบผู้ใช้ ${users} คนในฐานข้อมูลแล้ว — ข้ามการ seed`);
} else {
  const started = Date.now();
  const { seedDatabase } = await import('../server/seed.js');
  await seedDatabase();
  console.log(`[lumen:seed] สร้างข้อมูลตัวอย่างเสร็จใน ${((Date.now() - started) / 1000).toFixed(1)}s`);
}

if (!settings.blobToken) {
  console.log('[lumen:seed] ไม่ได้ตั้งค่า BLOB_READ_WRITE_TOKEN — ไฟล์อัปโหลดจะไม่ถูกคัดลอกขึ้น Blob');
  process.exit(0);
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
for (const key of keys) {
  if (await objectExists(key)) continue;
  const bytes = new Uint8Array(fs.readFileSync(path.join(UPLOAD_DIR, key)));
  await putObject(key, bytes);
  copied += 1;
}
console.log(`[lumen:seed] คัดลอกไฟล์ขึ้น Blob ${copied}/${keys.length} ไฟล์`);
