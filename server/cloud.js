// Shared Vercel wiring. Vercel Functions have a read-only bundle and no
// persistent disk, so Turso (libSQL) replaces the local SQLite file and Vercel
// Blob replaces data/uploads. The same shapes are used by api/index.mjs at
// request time and by scripts/seed-cloud.mjs during the production build.
import { createClient } from '@libsql/client';
import { SCHEMA_STATEMENTS, UPLOAD_SCHEMA_STATEMENTS, runtime, setDatabaseDriver } from './db.js';
import { createBlobStorage } from './drivers/vercel-blob.js';
import { createFsStorage } from './drivers/fs-storage.js';
import { createLibsqlDriver } from './drivers/libsql.js';
import { setStorageDriver } from './storage.js';
import { UPLOAD_DIR } from './paths.js';

export function cloudConfig(env = process.env) {
  return {
    url: String(env.TURSO_DATABASE_URL ?? env.LIBSQL_URL ?? '').trim(),
    authToken: String(env.TURSO_AUTH_TOKEN ?? env.LIBSQL_AUTH_TOKEN ?? '').trim(),
    blobToken: String(env.BLOB_READ_WRITE_TOKEN ?? '').trim(),
    uploadDir: UPLOAD_DIR,
  };
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
  // Without Blob (local runs) uploads fall back to the data directory.
  setStorageDriver(
    config.blobToken
      ? createBlobStorage({ token: config.blobToken })
      : createFsStorage(config.uploadDir),
  );
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
  await client.batch(
    UPLOAD_SCHEMA_STATEMENTS.map((sql) => ({ sql, args: [] })),
    'write',
  );
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
