// First-run bootstrap for the deployed Worker: create the D1 schema, load the
// bundled SQL snapshot once, and mirror bundled uploads into object storage.
//
// Hosting allowances count written rows, so the import must be one-shot and
// resumable: a request that gets cut off mid-import continues from the last
// committed batch instead of wiping and re-inserting every row. Restarting used
// to cost the full ~3k rows again on each retry, which is what exhausted the
// daily write allowance and paused the site.
import { gunzipSync } from 'fflate';
import { SCHEMA_STATEMENTS, UPLOAD_SCHEMA_STATEMENTS } from './db.js';
import { getStorageDriver } from './storage.js';

const MAX_STATEMENT_BYTES = 95 * 1024;
const BATCH_STATEMENTS = 200;
// A claim younger than this means another isolate is still importing.
const CLAIM_MS = 120_000;

// Keep only settled state at module scope. A Promise created by one Worker
// request must not be shared with another request: its continuation is bound
// to the request context that created it and can be dropped after that request ends.
let ready = false;
let manifest;

export async function ensureDatabase(env) {
  if (ready) return;
  await bootstrap(env);
  ready = true;
}

async function bootstrap(env) {
  // Recreating tables on every cold start is wasted work: only a database that
  // has never been bootstrapped needs the DDL.
  if (!(await schemaReady(env))) await ensureSchema(env);
  // Tables added after the first deploy still need creating on existing sites.
  else await env.DB.batch(UPLOAD_SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
  const snapshot = await loadManifest(env);
  await ensureSeedData(env, snapshot);
  // B2 is an external file store. A temporary B2 authorization/outage must not
  // block D1-backed login, catalog and other API routes. Missing seed files are
  // retried on the next cold start after the B2 issue is corrected.
  try {
    await ensureSeedUploads(env, snapshot);
  } catch (error) {
    console.error('[nakhonmaesot:seed] B2 seed-file sync failed; continuing with D1:', error);
  }
}

async function schemaReady(env) {
  try {
    const row = await env.DB.prepare(
      `SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = 'seed_state'`,
    ).first();
    return Boolean(row);
  } catch {
    return false;
  }
}

async function ensureSchema(env) {
  await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));
}

function asset(env, name) {
  return env.ASSETS.fetch(new Request(`https://assets/seed/${name}`));
}

/** Cache only the resolved manifest value, never a request-bound Promise. */
async function loadManifest(env) {
  if (manifest !== undefined) return manifest;
  try {
    const response = await asset(env, 'manifest.json');
    manifest = response.ok ? await response.json() : null;
  } catch {
    manifest = null;
  }
  return manifest;
}

function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (inString) {
      current += char;
      if (char === "'") {
        if (sql[i + 1] === "'") {
          current += sql[i + 1];
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (char === "'") {
      inString = true;
      current += char;
      continue;
    }
    if (char === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += char;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

// Children first: D1 enforces foreign keys, so a reset drops dependants first.
const DATA_TABLES = [
  'bookmarks',
  'reading_progress',
  'analytics_events',
  'keywords',
  'publication_tags',
  'tags',
  'publications',
  'categories',
  'sessions',
  'users',
  'seed_state',
];

const FINGERPRINT_KEY = 'seed';
const PROGRESS_KEY = 'seed-progress';

function fingerprintOf(snapshot) {
  return JSON.stringify({
    rows: snapshot.rows ?? 0,
    counts: snapshot.counts ?? null,
    sqlBytes: snapshot.sqlBytes ?? 0,
    uploads: (snapshot.uploads ?? []).length,
  });
}

async function readState(env, keys) {
  const rows = await env.DB.prepare(
    `SELECT key, value FROM seed_state WHERE key IN (${keys.map(() => '?').join(', ')})`,
  )
    .bind(...keys)
    .all();
  return new Map((rows.results ?? []).map((row) => [row.key, row.value]));
}

function writeState(env, key, value) {
  return env.DB.prepare(
    `INSERT INTO seed_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, new Date().toISOString())
    .run();
}

function clearState(env, key) {
  return env.DB.prepare('DELETE FROM seed_state WHERE key = ?')
    .bind(key)
    .run();
}

async function rowCounts(env) {
  const row = await env.DB.prepare(
    'SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM publications) AS pubs',
  ).first();
  return { users: row?.users ?? 0, pubs: row?.pubs ?? 0 };
}

/**
 * True when the database already holds at least everything the snapshot ships.
 *
 * Counts are compared with `>=` rather than `===`: readers add analytics events,
 * reading progress and bookmarks, and admins upload publications with their own
 * keywords and tags, so a complete database rarely matches the snapshot exactly.
 * An exact comparison read that drift as a half-finished import, and the
 * recovery path for one drops the data tables and writes all ~3k snapshot rows
 * again — which is what burned through the daily written-rows allowance and got
 * the site paused. To deliberately re-apply edited demo data, clear the data
 * tables first so the counts fall short of the snapshot.
 */
// analytics_events is trimmed by a moving 14-day window when the snapshot is
// packed, so its row count legitimately differs from one pack to the next and
// cannot be compared. Dropping it is safe for detecting a cut-off import: it is
// the last table in the snapshot, after every other table has loaded.
const COUNT_UNSTABLE_TABLES = new Set(['analytics_events']);

async function snapshotLoaded(env, counts) {
  const entries = Object.entries(counts ?? {}).filter(([table]) => !COUNT_UNSTABLE_TABLES.has(table));
  if (!entries.length) return false;
  try {
    for (const [table, expected] of entries) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).first();
      if ((row?.n ?? -1) < expected) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseProgress(raw) {
  try {
    return JSON.parse(raw ?? 'null');
  } catch {
    return null;
  }
}

async function ensureSeedData(env, snapshot) {
  if (!snapshot) {
    console.warn('[nakhonmaesot:seed] no bundled snapshot; starting empty');
    return;
  }
  const fingerprint = fingerprintOf(snapshot);
  const state = await readState(env, [FINGERPRINT_KEY, PROGRESS_KEY]);
  // Steady state: one read and no writes.
  if (state.get(FINGERPRINT_KEY) === fingerprint) return;

  const current = await rowCounts(env);
  // The snapshot only ships demo accounts: never wipe a database that has more.
  const seededUsers = snapshot.counts?.users;
  if (seededUsers !== undefined && current.users > seededUsers) {
    console.warn(`[nakhonmaesot:seed] keeping ${current.users} user(s); snapshot only ships ${seededUsers}`);
    return;
  }

  // The same rows may already be in place when only the packed layout changed.
  if (await snapshotLoaded(env, snapshot.counts)) {
    console.log('[nakhonmaesot:seed] snapshot already loaded; recording fingerprint only');
    await writeState(env, FINGERPRINT_KEY, fingerprint);
    await clearState(env, PROGRESS_KEY);
    return;
  }

  let progress = parseProgress(state.get(PROGRESS_KEY));
  if (progress?.fingerprint !== fingerprint) progress = null;
  if (progress && Date.now() - (progress.at ?? 0) < CLAIM_MS) {
    console.log('[nakhonmaesot:seed] import already running in another isolate');
    return;
  }

  let cursor = Number(progress?.applied) || 0;
  if (!cursor && (current.users > 0 || current.pubs > 0)) {
    // An interrupted or older import leaves partial rows behind; drop the data
    // tables and start from a clean snapshot.
    console.log(`[nakhonmaesot:seed] replacing partial snapshot (${current.pubs} publication(s))`);
    await env.DB.batch(DATA_TABLES.map((name) => env.DB.prepare(`DROP TABLE IF EXISTS ${name}`)));
    await ensureSchema(env);
  }
  // Claim the import before the heavy work so a second isolate leaves it alone.
  await writeState(
    env,
    PROGRESS_KEY,
    JSON.stringify({ fingerprint, applied: cursor, total: 0, at: Date.now() }),
  );

  const decoder = new TextDecoder();
  let sql = '';
  for (const name of snapshot.chunks ?? []) {
    const response = await asset(env, name);
    if (!response.ok) throw new Error(`seed chunk missing: ${name}`);
    sql += decoder.decode(gunzipSync(new Uint8Array(await response.arrayBuffer())));
  }

  const statements = splitStatements(sql).filter(
    (statement) => !/^CREATE\s+(TABLE|INDEX|UNIQUE)/i.test(statement),
  );
  if (cursor) console.log(`[nakhonmaesot:seed] resuming import at ${cursor}/${statements.length}`);
  let applied = 0;
  let skipped = 0;
  for (let i = cursor; i < statements.length; i += BATCH_STATEMENTS) {
    const chunk = [];
    for (const statement of statements.slice(i, i + BATCH_STATEMENTS)) {
      if (new TextEncoder().encode(statement).length > MAX_STATEMENT_BYTES) {
        skipped += 1;
        continue;
      }
      chunk.push(env.DB.prepare(statement));
    }
    if (chunk.length) await env.DB.batch(chunk);
    applied += chunk.length;
    // Batches are atomic, so a cursor written after one is safe to resume from.
    await writeState(
      env,
      PROGRESS_KEY,
      JSON.stringify({
        fingerprint,
        applied: Math.min(i + BATCH_STATEMENTS, statements.length),
        total: statements.length,
        at: Date.now(),
      }),
    );
  }
  console.log(`[nakhonmaesot:seed] imported ${applied} statement(s), skipped ${skipped}`);

  await env.DB.prepare('DELETE FROM sessions').run();

  const mismatch = [];
  for (const [table, expected] of Object.entries(snapshot.counts ?? {})) {
    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).first();
    if ((row?.n ?? 0) !== expected) mismatch.push(`${table}=${row?.n ?? 0}/${expected}`);
  }
  if (mismatch.length) console.warn(`[nakhonmaesot:seed] row count mismatch: ${mismatch.join(', ')}`);

  await writeState(env, FINGERPRINT_KEY, fingerprint);
  await clearState(env, PROGRESS_KEY);
}

/** Idempotent: only missing objects are written, so an interrupted run resumes. */
async function ensureSeedUploads(env, snapshot) {
  const files = snapshot?.uploads ?? [];
  if (!files.length) return;

  const storage = getStorageDriver();
  const missing = [];
  for (let i = 0; i < files.length; i += 16) {
    const chunk = files.slice(i, i + 16);
    const checks = await Promise.all(chunk.map((key) => storage.exists(key)));
    checks.forEach((exists, index) => {
      if (!exists) missing.push(chunk[index]);
    });
  }
  if (!missing.length) return;

  for (let i = 0; i < missing.length; i += 8) {
    await Promise.all(
      missing.slice(i, i + 8).map(async (key) => {
        const response = await asset(env, `uploads/${key}`);
        if (!response.ok) return;
        const bytes = new Uint8Array(await response.arrayBuffer());
        await storage.put(key, bytes, response.headers.get('content-type') ?? undefined);
      }),
    );
  }
  console.log(`[nakhonmaesot:seed] copied ${missing.length} upload file(s) into storage`);
}
