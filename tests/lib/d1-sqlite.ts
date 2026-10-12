import type { DatabaseSync } from 'node:sqlite';

/**
 * Just enough of D1's API over node:sqlite for handler tests: prepare/bind
 * and first/all/run, plus batch as a transaction. Real SQL, real schema --
 * the point is that a wrong query fails here the way it would in D1.
 * `onBind` sees every bind call, so a test can check D1's 100-parameter cap,
 * which node:sqlite does not enforce.
 */
export function d1(db: DatabaseSync, onBind?: (sql: string, count: number) => void) {
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => { onBind?.(sql, a.length); return statement(sql, a); },
    async first<T>(): Promise<T | null> {
      const row = db.prepare(sql).get(...(args as never[]));
      return (row ? { ...row } : null) as T | null;
    },
    async all<T>(): Promise<{ results: T[] }> {
      return { results: db.prepare(sql).all(...(args as never[])).map((r) => ({ ...r })) as T[] };
    },
    async run() {
      const r = db.prepare(sql).run(...(args as never[]));
      return { meta: { changes: Number(r.changes) } };
    },
  });
  return {
    prepare: (sql: string) => statement(sql),
    async batch(stmts: { run(): Promise<unknown> }[]) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s.run());
        db.exec('COMMIT');
        return out;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
  };
}
