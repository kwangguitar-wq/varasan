// Shared Vercel wiring. Vercel Functions have a read-only bundle and no
// persistent disk, so Turso (libSQL) replaces the local SQLite file and Vercel
// Blob replaces data/uploads. The same shapes are used by api/index.mjs at
// request time and by scripts/seed-cloud.mjs during the production build.
import { createClient } from '@libsql/client';
import { SCHEMA_STATEMENTS, UPLOAD_SCHEMA_STATEMENTS, runtime, setDatabaseDriver } from './db.js';
import { createBlobStorage } from './drivers/vercel-blob.js';
import { createFsStorage } from './drivers/fs-storage.js';
import { createLibsqlStorage, UPLOAD_OBJECTS_SCHEMA } from './drivers/libsql-storage.js';
import { createLibsqlDriver } from './drivers/libsql.js';
import { setStorageDriver } from './storage.js';
import { UPLOAD_DIR } from './paths.js';

export function cloudConfig(env = process.env) {
  return {
    url: String(env.TURSO_DATABASE_URL ?? env.LIBSQL_URL ?? '').trim(),
    authToken: String(env.TURSO_AUTH_TOKEN ?? env.LIBSQL_AUTH_TOKEN ?? '').trim(),
    blobToken: String(env.BLOB_READ_WRITE_TOKEN ?? '').trim(),
    // auto  = Blob when a token exists, database otherwise, local disk for file URLs
    // blob  = require Vercel Blob, db = keep files in the database, fs = local disk
    fileStorage: String(env.FILE_STORAGE ?? 'auto').trim().toLowerCase(),
    uploadDir: UPLOAD_DIR,
  };
}

let storageBackend = 'fs';

/** Which backend the uploads ended up on: 'blob' | 'db' | 'fs'. */
export function cloudStorageBackend() {
  return storageBackend;
}

function selectStorage(config, client) {
  const mode = config.fileStorage;
  if (mode === 'fs') return 'fs';
  if (mode === 'db') return 'db';
  if (config.blobToken) return 'blob';
  // A Vercel Function has no writable disk, so without Blob the files go into
  // the database instead of failing every upload.
  if (mode === 'blob' || !config.url.startsWith('file:')) return 'db';
  return 'fs';
}

function mountStorage(backend, config, client) {
  storageBackend = backend;
  runtime.storageBackend = backend;
  if (backend === 'blob') return createBlobStorage({ token: config.blobToken });
  if (backend === 'db') return createLibsqlStorage(client);
  return createFsStorage(config.uploadDir);
}

export function isCloudConfigured(config = cloudConfig()) {
  return Boolean(config.url);
}

/** Registers the cloud drivers; returns the libSQL client for schema work. */
export function configureCloud(config = cloudConfig()) {
  if (!config.url) throw new Error('TURSO_DATABASE_URL is not configured');
  const client = createClient({
    url: config.url,
    ...(config.authToken ? { authToken: config.authToken } : {}),
  });
  setDatabaseDriver(createLibsqlDriver(client));
  // Host only (no credentials) so /api/health can say which database this
  // deployment writes to, e.g. "xxx.turso.io".
  try {
    const parsed = new URL(config.url);
    runtime.databaseHost = parsed.host || parsed.pathname.slice(0, 60);
  } catch {
    runtime.databaseHost = null;
  }
  // Without Blob (local runs) uploads fall back to the data directory; on Vercel
  // they fall back to the database, because the bundle is read-only.
  setStorageDriver(mountStorage(selectStorage(config, client), config, client));
  runtime.platform = 'vercel';
  // Vercel caps a Function request body at 4.5 MB, so books travel in chunks
  // instead of one multipart request. Responses stay under the same cap because
  // large files are redirected to the Blob CDN.
  runtime.uploadMode = 'chunked';
  runtime.chunkBytes = 3 * 1024 * 1024;
  runtime.maxUploadBytes = 64 * 1024 * 1024;
  return client;
}

/** Upload tables postdate the first deploys, so add them to existing databases. */
export async function ensureUploadSchema(client) {
  const statements = UPLOAD_SCHEMA_STATEMENTS.map((sql) => ({ sql, args: [] }));
  // Only the database-backed storage needs its object table.
  if (storageBackend === 'db') statements.push({ sql: UPLOAD_OBJECTS_SCHEMA, args: [] });
  await client.batch(statements, 'write');
}

async function tableExists(client, name) {
  try {
    await client.execute(`SELECT 1 FROM ${name} LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

/** Creates the schema once; returns true when it had to create it. */
export async function ensureCloudSchema(client) {
  if (await tableExists(client, 'seed_state')) return false;
  await client.batch(
    SCHEMA_STATEMENTS.map((sql) => ({ sql, args: [] })),
    'write',
  );
  return true;
}
