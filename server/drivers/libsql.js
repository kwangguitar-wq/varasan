/**
 * Turso / libSQL driver. Maps the project's prepared-statement facade onto
 * libSQL's `execute` API so the same SQL used by node:sqlite and D1 runs on
 * Vercel Functions, where the filesystem is read-only and per-request.
 *
 * libSQL accepts `?` placeholders and returns `lastInsertRowid`/`rowsAffected`,
 * so route code needs no changes. BEGIN/COMMIT/ROLLBACK are routed to a libSQL
 * stream transaction: seed.js wraps the analytics history in one, and the
 * stateless HTTP API rejects a bare `BEGIN`.
 */

function toObject(row, columns) {
  const object = {};
  for (let i = 0; i < columns.length; i += 1) object[columns[i]] = row[i];
  return object;
}

export function createLibsqlDriver(client) {
  let transaction = null;
  const runner = () => transaction ?? client;

  return {
    prepare(sql) {
      return {
        run: async (...params) => {
          const result = await runner().execute({ sql, args: params });
          const lastId = result.lastInsertRowid;
          return {
            lastInsertRowid: lastId === null || lastId === undefined ? null : Number(lastId),
            changes: Number(result.rowsAffected ?? 0),
          };
        },
        get: async (...params) => {
          const result = await runner().execute({ sql, args: params });
          const row = result.rows[0];
          return row ? toObject(row, result.columns) : null;
        },
        all: async (...params) => {
          const result = await runner().execute({ sql, args: params });
          return result.rows.map((row) => toObject(row, result.columns));
        },
      };
    },

    async exec(sql) {
      const keyword = String(sql).trim().split(/\s+/)[0]?.toUpperCase() ?? '';
      if (keyword === 'BEGIN') {
        transaction = await client.transaction('write');
        return;
      }
      if (keyword === 'COMMIT') {
        const current = transaction;
        transaction = null;
        if (current) await current.commit();
        return;
      }
      if (keyword === 'ROLLBACK') {
        const current = transaction;
        transaction = null;
        if (current) await current.rollback();
        return;
      }
      if (typeof client.executeMultiple === 'function') await client.executeMultiple(sql);
      else await client.execute(sql);
    },

    /** Chunked D1-style batch: one round trip per 100 statements. */
    async runMany(sql, rows, normalize = (params) => params) {
      for (let i = 0; i < rows.length; i += 100) {
        const statements = rows
          .slice(i, i + 100)
          .map((params) => ({ sql, args: [...normalize(params)] }));
        if (!statements.length) continue;
        if (transaction) await transaction.batch(statements);
        else await client.batch(statements, 'write');
      }
    },
  };
}
