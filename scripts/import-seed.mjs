import { ungzip } from 'fflate';

const CHUNK_LIMIT = 90 * 1024; // D1's maximum statement length (bytes)

export function splitStatements(sql) {
  const statements = [];
  let current = '';
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      current += ch;
      if (ch === "'") {
        if (sql[i + 1] === "'") {
          current += sql[i + 1];
          i += 1;
        } else {
          inString = false;
        }
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
      continue;
    }
    if (ch === ';') {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = '';
      continue;
    }
    current += ch;
  }
  const tail = current.trim();
  if (tail) statements.push(tail);
  return statements;
}

/**
 * First-run import: gzip SQL chunks -> D1, upload files -> R2, then bump the
 * seed marker so it never runs twice. Returns a summary for logging.
 */
export async function importSeed(env) {
  const manifestRes = await env.ASSETS.fetch(new Request('https://assets/seed/manifest.json'));
  if (!manifestRes.ok) throw new Error(`seed manifest missing: ${manifestRes.status}`);
  const manifest = await manifestRes.json();

  const check = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
  if (check && check.n > 0) return { skipped: true, reason: 'users already present' };

  const decoder = new TextDecoder();
  let sql = '';
  for (const name of manifest.chunks) {
    const res = await env.ASSETS.fetch(new Request(`https://assets/seed/${name}`));
    if (!res.ok) throw new Error(`seed chunk missing: ${name}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    sql += decoder.decode(ungzip(bytes));
  }

  let applied = 0;
  let failed = 0;
  for (const statement of splitStatements(sql)) {
    if (Buffer.byteLength(statement, 'utf8') > CHUNK_LIMIT) {
      failed += 1;
      continue;
    }
    try {
      await env.DB.prepare(statement).run();
      applied += 1;
    } catch (error) {
      failed += 1;
      console.error('[nakhonmaesot:seed] statement failed:', error?.message, statement.slice(0, 120));
    }
  }

  // Statements already create the schema via CREATE TABLE IF NOT EXISTS emitted by the dump,
  // but ensure the marker table exists regardless.
  await env.DB.exec(`CREATE TABLE IF NOT EXISTS seed_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  await env.DB.prepare(`INSERT OR REPLACE INTO seed_meta (key, value) VALUES ('imported_at', ?)`)
    .bind(new Date().toISOString())
    .run();

  return { skipped: false, applied, failed };
}

let seedPromise = null;
/** Memoized so concurrent requests don't race the import. */
export function ensureSeeded(env) {
  if (!seedPromise) {
    seedPromise = importSeed(env).catch((error) => {
      seedPromise = null;
      throw error;
    });
  }
  return seedPromise;
}