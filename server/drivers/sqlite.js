import { DatabaseSync } from 'node:sqlite';
import { SCHEMA_SQL } from '../db.js';

/** Local/Node driver: synchronous node:sqlite wrapped in promises. */
export function createSqliteDriver(dbPath) {
  const database = new DatabaseSync(dbPath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  database.exec(SCHEMA_SQL);

  return {
    prepare(sql) {
      const statement = database.prepare(sql);
      return {
        run: async (...params) => {
          const result = statement.run(...params);
          return { lastInsertRowid: Number(result.lastInsertRowid), changes: Number(result.changes) };
        },
        get: async (...params) => statement.get(...params) ?? null,
        all: async (...params) => statement.all(...params),
      };
    },
    async exec(sql) {
      database.exec(sql);
    },
  };
}
