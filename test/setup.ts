/**
 * Vitest setup.
 * - Provides a fresh in-memory SQLite database for DB-backed tests.
 * - Exposes helpers to build a D1-compatible `AuthDb` adapter.
 */

import Database from 'better-sqlite3';
import { beforeEach } from 'vitest';
import { resetTestEnv } from './cloudflare-shim';
import { SCHEMA_SQL } from './schema';
import type { AuthDb } from '../src/lib/auth/db';

// A minimal D1-shaped adapter over better-sqlite3. The production code only
// uses: prepare(sql).bind(...).run() | .first() | .all() | .exec(sql).
// We translate those into better-sqlite3 calls and normalise the results so
// the data-access layer is exercised exactly as it would be against D1.
class SqliteStmt {
  constructor(private db: Database.Database, private sql: string) {}

  bind(...params: unknown[]) {
    this.params = params;
    return this;
  }
  private params: unknown[] = [];

  run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: info.changes } };
  }

  first<T = any>(): T | null {
    const row = this.db.prepare(this.sql).get(...this.params);
    return (row as T) ?? null;
  }

  all<T = any>(): { results: T[] } {
    const rows = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results: rows };
  }
}

export function makeDb(): AuthDb {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA_SQL);
  return {
    prepare(sql: string) {
      return new SqliteStmt(db, sql) as any;
    },
    async exec(sql: string) {
      db.exec(sql);
      return {} as any;
    },
  };
}

// Reset the cloudflare env shim before every test so rate-limiter / secret
// mocks don't leak between tests.
beforeEach(() => {
  resetTestEnv();
});
