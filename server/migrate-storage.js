// Moves books that were stored inside the database into the bucket.
//
// Before a bucket was configured, uploads fell back to the `upload_objects`
// table so the site kept working — but those files vanish with the database.
// The first boot after a bucket appears copies every one of them (skipping keys
// the bucket already has) and records that the move is done, so it never repeats.
// Rows are left in place: nothing is deleted, so a copy is a copy.
import { db, nowIso, runtime } from './db.js';
import { contentTypeFor, objectExists, putObject, toBytes } from './storage.js';

const NAME = 'db-to-bucket';

const TABLE = `CREATE TABLE IF NOT EXISTS storage_migrations (
  name TEXT PRIMARY KEY,
  done_at TEXT,
  attempted_at TEXT,
  moved INTEGER NOT NULL DEFAULT 0
)`;

// A run that was cut off (a Function cannot exceed 60s) continues on the next
// boot; the cooldown keeps a large library from being retried on every request.
const COOLDOWN_MS = 5 * 60 * 1000;

const bytesOf = (rows) => rows.reduce((sum, row) => sum + (Number(row.size) || 0), 0);

async function finish(moved) {
  await db
    .prepare(
      `INSERT INTO storage_migrations (name, done_at, attempted_at, moved) VALUES (?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET done_at = excluded.done_at, moved = excluded.moved`,
    )
    .run(NAME, nowIso(), nowIso(), moved);
}

/**
 * Copies database-stored files into the current bucket.
 * `dryRun` reports what would move without writing anything.
 */
export async function migrateDatabaseFiles({ dryRun = false, force = false } = {}) {
  const backend = runtime.storageBackend;
  if (backend !== 'r2' && backend !== 'blob') {
    return { backend, skipped: 'ที่เก็บไฟล์ปัจจุบันไม่ใช่ bucket — ไม่มีอะไรต้องย้าย' };
  }

  await db.exec(TABLE);
  const state = await db
    .prepare('SELECT done_at, attempted_at FROM storage_migrations WHERE name = ?')
    .get(NAME);
  if (!force && state?.done_at) {
    return { backend, skipped: 'ย้ายไฟล์ขึ้น bucket ครบแล้ว', doneAt: state.done_at };
  }
  if (!force && state?.attempted_at && Date.now() - Date.parse(state.attempted_at) < COOLDOWN_MS) {
    return { backend, skipped: 'เพิ่งเริ่มย้ายไปเมื่อครู่ กำลังทำต่อในรอบถัดไป' };
  }

  let rows;
  try {
    rows = await db.prepare('SELECT key, size FROM upload_objects ORDER BY key').all();
  } catch {
    // This database never held files, so there is nothing to move.
    return { backend, total: 0, pending: 0, moved: 0, bytes: 0, skipped: 'ฐานข้อมูลนี้ไม่เคยเก็บไฟล์' };
  }

  const pending = [];
  for (const row of rows) {
    if (await objectExists(row.key).catch(() => false)) continue;
    pending.push(row);
  }
  const summary = {
    backend,
    total: rows.length,
    pending: pending.length,
    bytes: bytesOf(rows),
    moved: 0,
  };
  if (dryRun) return summary;
  if (!pending.length) {
    await finish(0);
    return { ...summary, skipped: 'ไฟล์อยู่ใน bucket ครบแล้ว' };
  }

  await db
    .prepare(
      `INSERT INTO storage_migrations (name, attempted_at) VALUES (?, ?)
       ON CONFLICT(name) DO UPDATE SET attempted_at = excluded.attempted_at`,
    )
    .run(NAME, nowIso());

  const failed = [];
  for (const row of pending) {
    try {
      const object = await db.prepare('SELECT bytes FROM upload_objects WHERE key = ?').get(row.key);
      if (!object?.bytes) continue;
      await putObject(row.key, toBytes(object.bytes), contentTypeFor(row.key));
      summary.moved += 1;
    } catch (error) {
      failed.push({ key: row.key, error: String(error?.message ?? error) });
    }
  }

  if (!failed.length) await finish(summary.moved);
  return failed.length ? { ...summary, failed } : summary;
}

/**
 * Boot hook: copies database-stored files into the bucket. Never throws, so a
 * storage hiccup cannot stop a request; whatever is left is retried next boot.
 */
export async function migrateOnBoot() {
  try {
    const summary = await migrateDatabaseFiles();
    if (summary?.moved) {
      console.log(`[nakhonmaesot] ย้ายไฟล์จากฐานข้อมูลขึ้น ${summary.backend} แล้ว ${summary.moved}/${summary.total} ไฟล์`);
    }
    return summary;
  } catch (error) {
    console.warn('[nakhonmaesot] ย้ายไฟล์จากฐานข้อมูลขึ้น bucket ไม่สำเร็จ', error?.message ?? error);
    return null;
  }
}
