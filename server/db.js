// Database + runtime facade shared by the Node server and the Workers runtime.
// The concrete driver (node:sqlite locally, D1 in the Worker) is registered by
// the entry point, so route modules never import a runtime-specific module.

let driver = null;

export const runtime = {
  platform: 'node',
  maxUploadBytes: 300 * 1024 * 1024,
  // Cloudflare Workers have a strict CPU budget. Always upload books in chunks;
  // the browser sends metadata first and the file in small independent requests.
  uploadMode: 'chunked',
  chunkBytes: 4 * 1024 * 1024,
  // Set by the host entry point when uploads cannot be stored (e.g. Vercel
  // without BLOB_READ_WRITE_TOKEN): requests then fail with this explanation
  // instead of an opaque 500 from a read-only disk.
  storageIssue: null,
  // Reported by /api/health so a deployment can be checked from the outside:
  // which object storage holds uploads and which database host holds the rows.
  // The host only — never the URL with its credentials or token.
  storageBackend: 'fs',
  databaseHost: null,
};

export function setDatabaseDriver(next) {
  driver = next;
}

export function getDatabaseDriver() {
  if (!driver) throw new Error('database driver is not configured');
  return driver;
}

function normalizeParams(params) {
  return params.map((value) => {
    if (value === undefined) return null;
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  });
}

/**
 * Minimal prepared-statement facade. Drivers normalise to promises so the same
 * route code works against synchronous SQLite and asynchronous D1.
 */
export const db = {
  prepare(sql) {
    const statement = getDatabaseDriver().prepare(sql);
    return {
      run: (...params) => statement.run(...normalizeParams(params)),
      get: (...params) => statement.get(...normalizeParams(params)),
      all: (...params) => statement.all(...normalizeParams(params)),
    };
  },
  exec: (sql) => getDatabaseDriver().exec(sql),
};

/** Run the same statement for many parameter tuples; drivers may batch them. */
export async function runMany(sql, rows) {
  const current = getDatabaseDriver();
  if (typeof current.runMany === 'function') return current.runMany(sql, rows, normalizeParams);
  for (const row of rows) await db.prepare(sql).run(...row);
  return undefined;
}

export const nowIso = () => new Date().toISOString();
export const todayKey = () => new Date().toISOString().slice(0, 10);

export function slugify(input, fallback = 'item') {
  const base = String(input ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return base || `${fallback}-${Date.now().toString(36)}`;
}

export async function uniqueSlug(table, value, ignoreId = null) {
  const base = slugify(value);
  let candidate = base;
  let i = 2;
  const stmt = db.prepare(`SELECT id FROM ${table} WHERE slug = ?`);
  while (true) {
    const row = await stmt.get(candidate);
    if (!row || (ignoreId != null && row.id === Number(ignoreId))) return candidate;
    candidate = `${base}-${i++}`;
  }
}

export function json(row) {
  return row ? JSON.parse(JSON.stringify(row)) : row;
}

export function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Multi-request uploads, used when a single body would exceed the host limit. */
export const UPLOAD_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    publication_id INTEGER NOT NULL,
    kind TEXT NOT NULL DEFAULT 'file',
    filename TEXT NOT NULL,
    size INTEGER NOT NULL,
    parts INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS upload_parts (
    session_id TEXT NOT NULL,
    idx INTEGER NOT NULL,
    size INTEGER NOT NULL,
    PRIMARY KEY (session_id, idx)
  )`,
];

/** Schema as individual statements: D1's exec() cannot take multi-line DDL. */
export const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'reader',
    affiliation TEXT,
    bio TEXT,
    avatar_hue INTEGER NOT NULL DEFAULT 205,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    accent TEXT NOT NULL DEFAULT '#4f7cff',
    icon TEXT NOT NULL DEFAULT 'book',
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS publications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subtitle TEXT,
    type TEXT NOT NULL DEFAULT 'ebook',
    description TEXT,
    abstract TEXT,
    author TEXT,
    publisher TEXT,
    year INTEGER,
    issn TEXT,
    isbn TEXT,
    language TEXT NOT NULL DEFAULT 'th',
    pages INTEGER NOT NULL DEFAULT 0,
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    cover_url TEXT,
    file_url TEXT,
    file_type TEXT,
    file_size INTEGER NOT NULL DEFAULT 0,
    content_text TEXT,
    excerpt TEXT,
    top_keywords TEXT,
    reading_minutes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    featured INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    downloads INTEGER NOT NULL DEFAULT 0,
    reads INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS publication_tags (
    publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (publication_id, tag_id)
  )`,
  `CREATE TABLE IF NOT EXISTS keywords (
    term TEXT NOT NULL,
    publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    weight REAL NOT NULL DEFAULT 1,
    count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (term, publication_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_keywords_term ON keywords(term)`,
  `CREATE TABLE IF NOT EXISTS analytics_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    publication_id INTEGER REFERENCES publications(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    type TEXT NOT NULL,
    day TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_events_pub ON analytics_events(publication_id, type)`,
  `CREATE INDEX IF NOT EXISTS idx_events_day ON analytics_events(day)`,
  `CREATE TABLE IF NOT EXISTS reading_progress (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    progress REAL NOT NULL DEFAULT 0,
    page INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user_id, publication_id)
  )`,
  `CREATE TABLE IF NOT EXISTS bookmarks (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, publication_id)
  )`,
  // Tracks whether the bundled demo snapshot finished importing (Worker only).
  `CREATE TABLE IF NOT EXISTS seed_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  ...UPLOAD_SCHEMA_STATEMENTS,
];

export const SCHEMA_SQL = SCHEMA_STATEMENTS.map((sql) => `${sql};`).join('\n');
