/**
 * Cloudflare D1 driver. Mirrors the node:sqlite adapter: every call returns a
 * promise and writes report `lastInsertRowid`/`changes` the way node:sqlite does.
 */
export function createD1Driver(d1) {
  return {
    prepare(sql) {
      const statement = d1.prepare(sql);
      return {
        run: async (...params) => {
          const result = await statement.bind(...params).run();
          const meta = result?.meta ?? {};
          return { lastInsertRowid: meta.last_row_id ?? null, changes: meta.changes ?? 0 };
        },
        get: async (...params) => (await statement.bind(...params).first()) ?? null,
        all: async (...params) => (await statement.bind(...params).all())?.results ?? [],
      };
    },
    async exec(sql) {
      await d1.exec(sql);
    },
    /** D1 executes a batch atomically and in one round trip. */
    async runMany(sql, rows, normalize = (params) => params) {
      const statement = d1.prepare(sql);
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100).map((params) => statement.bind(...normalize(params)));
        if (chunk.length) await d1.batch(chunk);
      }
      return undefined;
    },
  };
}
