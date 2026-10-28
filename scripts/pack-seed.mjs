import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { gzipSync, strToU8 } from 'fflate';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'public', 'seed');
const DB_PATH = process.env.DATABASE_PATH ?? path.join(ROOT, 'data', 'nakhonmaesot.db');
const UPLOAD_DIR = path.join(ROOT, 'data', 'uploads');
const MAX_TEXT = 60_000;
const CHUNK_BYTES = 320 * 1024;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

const database = new DatabaseSync(DB_PATH);
const parts = [];
let buffer = '';
const push = (line) => {
  buffer += `${line}\n`;
  if (buffer.length >= CHUNK_BYTES) {
    parts.push(buffer);
    buffer = '';
  }
};

// Schema is created from server/db.js, so only data rows are exported here.
// Parent tables must be written first: D1 enforces foreign keys.
const TABLE_ORDER = [
  'users',
  'categories',
  'publications',
  'tags',
  'publication_tags',
  'keywords',
  'reading_progress',
  'bookmarks',
  'analytics_events',
];
const TABLE_SKIP = new Set(['sessions', 'seed_state']);
const present = database
  .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
  .all()
  .map((row) => row.name)
  .filter((name) => !TABLE_SKIP.has(name));
const tables = [
  ...TABLE_ORDER.filter((name) => present.includes(name)),
  ...present.filter((name) => !TABLE_ORDER.includes(name)).sort(),
].map((name) => ({ name }));

// The snapshot is imported into D1 on first run, and hosting allowances count
// written rows, so keep the demo history compact: two weeks of analytics and
// the strongest keywords per title.
const ANALYTICS_DAYS = 14;
const KEYWORDS_PER_TITLE = 150;
const cutoffDay = new Date(Date.now() - ANALYTICS_DAYS * 86400_000).toISOString().slice(0, 10);

function trimRows(table, rows) {
  if (table === 'analytics_events') {
    return rows.filter((row) => String(row.day) >= cutoffDay).sort((a, b) => a.id - b.id);
  }
  if (table === 'keywords') {
    const byPublication = new Map();
    for (const row of rows) {
      const list = byPublication.get(row.publication_id) ?? [];
      list.push(row);
      byPublication.set(row.publication_id, list);
    }
    return [...byPublication.values()].flatMap((list) =>
      list.sort((a, b) => b.weight - a.weight).slice(0, KEYWORDS_PER_TITLE),
    );
  }
  return rows;
}

let rowCount = 0;
const perTable = [];
const counts = {};
for (const table of tables) {
  const rows = trimRows(table.name, database.prepare(`SELECT * FROM "${table.name}"`).all());
  if (!rows.length) continue;
  perTable.push(`${table.name}=${rows.length}`);
  counts[table.name] = rows.length;
  const columns = Object.keys(rows[0]);
  for (const row of rows) {
    const values = columns.map((column) => {
      let value = row[column];
      if (value === null || value === undefined) return 'NULL';
      // D1 rejects statements above ~100 KiB, so every long value is capped.
      if (typeof value === 'string' && value.length > MAX_TEXT) {
        value = value.slice(0, MAX_TEXT);
      }
      return quote(value);
    });
    push(`INSERT INTO "${table.name}" (${columns.map((column) => `"${column}"`).join(', ')}) VALUES (${values.join(', ')});`);
    rowCount += 1;
  }
}
if (buffer) parts.push(buffer);
database.close();

const sql = parts.join('');
const gz = gzipSync(strToU8(sql), { level: 9 });
const chunks = [];
for (let i = 0; i < gz.length; i += CHUNK_BYTES) {
  const name = `db-${String(chunks.length).padStart(3, '0')}.gz`;
  fs.writeFileSync(path.join(OUT, name), gz.subarray(i, i + CHUNK_BYTES));
  chunks.push(name);
}

const uploads = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else uploads.push(path.relative(UPLOAD_DIR, full).split(path.sep).join('/'));
  }
};
walk(UPLOAD_DIR);
uploads.sort();

for (const key of uploads) {
  const target = path.join(OUT, 'uploads', key);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(UPLOAD_DIR, key), target);
}

fs.writeFileSync(
  path.join(OUT, 'manifest.json'),
  JSON.stringify({ chunks, uploads, rows: rowCount, counts, sqlBytes: sql.length }, null, 2),
);

const bytes = chunks.reduce((total, name) => total + fs.statSync(path.join(OUT, name)).size, 0);
console.log(`seed packed: ${rowCount} rows, ${chunks.length} chunk(s) (${(bytes / 1024).toFixed(0)} KiB), ${uploads.length} upload(s)`);
console.log(`rows per table: ${perTable.join(', ')}`);
