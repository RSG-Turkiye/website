/**
 * The admin panel's audit log: who did what, kept a year, and tamper-evident.
 *
 * Each row stores the hash of the row before it. Changing a row breaks its own
 * hash; deleting one breaks the link to the next. verifyChain finds the first
 * break. Deleting the newest rows cannot be detected from the table alone --
 * an exported copy is the evidence for that, which is why export exists.
 *
 * Mutations are written in the same D1 batch as their audit row (runWithAudit),
 * so an action is never recorded without happening or the reverse. prev_hash is
 * UNIQUE in the schema: when two writers read the same last row, one insert
 * fails, its whole batch rolls back, and it retries against the new last row.
 */

export const GENESIS = '0'.repeat(64);
export const AUDIT_RETENTION_SECONDS = 365 * 86400;
const MAX_ATTEMPTS = 8;

export interface AuditEntry {
  userId: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  details?: unknown;
}

export interface AuditRow {
  seq: number;
  at: number;
  user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: string;
  prev_hash: string;
  hash: string;
}

export type ChainResult =
  | { ok: true; checked: number; anchoredAfterPrune: boolean }
  | { ok: false; checked: number; brokenAt: number; reason: 'hash' | 'link' };

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** An array, not an object: key order is part of the hash, and arrays keep it. */
export function hashRow(row: Omit<AuditRow, 'seq' | 'hash'>): Promise<string> {
  return sha256Hex(JSON.stringify([row.at, row.user_id, row.action, row.target_type, row.target_id, row.details, row.prev_hash]));
}

const isChainCollision = (err: unknown) => /UNIQUE constraint failed: audit_log\.prev_hash/.test(String(err));

type AuditBase = Omit<AuditRow, 'seq' | 'hash'>;

/**
 * The retry loop both writers share. Reads the chain head, builds the row that
 * follows it and hands that row to `batch`. When another writer appended first,
 * the batch rolls back (UNIQUE prev_hash) and the loop starts again from the new head.
 */
async function appendWithRetry<R>(
  db: D1Database,
  entry: AuditEntry,
  now: number,
  batch: (base: AuditBase, hash: string) => Promise<R>,
): Promise<R> {
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const last = await db.prepare('SELECT hash FROM audit_log ORDER BY seq DESC LIMIT 1').first<{ hash: string }>();
    const base: AuditBase = {
      at: now,
      user_id: entry.userId,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      details: JSON.stringify(entry.details ?? {}),
      prev_hash: last?.hash ?? GENESIS,
    };
    const hash = await hashRow(base);
    try {
      return await batch(base, hash);
    } catch (err) {
      if (!isChainCollision(err)) throw err;
    }
  }
  throw new Error(`audit_log: could not append after ${MAX_ATTEMPTS} attempts`);
}

export function runWithAudit(
  db: D1Database,
  statements: D1PreparedStatement[],
  entry: AuditEntry,
  now = Math.floor(Date.now() / 1000),
): Promise<void> {
  return appendWithRetry(db, entry, now, async (base, hash) => {
    const insert = db.prepare(
      'INSERT INTO audit_log (at, user_id, action, target_type, target_id, details, prev_hash, hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(base.at, base.user_id, base.action, base.target_type, base.target_id, base.details, base.prev_hash, hash);
    await db.batch([...statements, insert]);
  });
}

export function appendAudit(db: D1Database, entry: AuditEntry, now?: number): Promise<void> {
  return runWithAudit(db, [], entry, now);
}

/**
 * An SQL boolean expression, written in code, that is true only if the guard took effect.
 *
 * The condition must name something only THIS write produced: a per-write nonce
 * (for example `EXISTS (SELECT 1 FROM plans WHERE id = ? AND write_nonce = ?)`).
 * Never use a revision number: a losing writer computes the same next revision,
 * so the condition would hold for it too, and its audit row and `after`
 * statements would land while the function returns false.
 *
 * Use plain positional `?` placeholders only. The binds are appended after the
 * eight audit-row binds, so named or numbered placeholders would bind wrongly.
 */
export interface AuditProof {
  condition: string;
  binds: unknown[];
}

/**
 * For changes that may lose a race: the guard is a conditional UPDATE or
 * DELETE (for example `WHERE id = ? AND revision = ?`). The guard, the audit
 * row and the `after` statements go in one batch. The audit row is inserted
 * only when `proof` holds afterwards, so a guard that matched nothing leaves
 * no record of a change that did not happen. `proof` must follow the rules on
 * AuditProof: a per-write nonce, never a revision. Each `after` statement must
 * carry the same kind of condition itself. Returns whether the guard changed
 * a row.
 */
export function runGuardedWithAudit(
  db: D1Database,
  guard: D1PreparedStatement,
  proof: AuditProof,
  after: D1PreparedStatement[],
  entry: AuditEntry,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  return appendWithRetry(db, entry, now, async (base, hash) => {
    const insert = db.prepare(
      `INSERT INTO audit_log (at, user_id, action, target_type, target_id, details, prev_hash, hash)
       SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE ${proof.condition}`,
    ).bind(base.at, base.user_id, base.action, base.target_type, base.target_id, base.details, base.prev_hash, hash, ...proof.binds);
    const results = await db.batch([guard, insert, ...after]);
    const changes = (results[0] as { meta?: { changes?: number } } | undefined)?.meta?.changes ?? 0;
    return Number(changes) > 0;
  });
}

/**
 * Rows in seq order. The first row may link to a pruned row rather than
 * GENESIS; that is accepted and reported, because the daily prune removes
 * the oldest rows on purpose.
 */
export async function verifyChain(rows: AuditRow[]): Promise<ChainResult> {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (i > 0 && row.prev_hash !== rows[i - 1].hash) return { ok: false, checked: i, brokenAt: row.seq, reason: 'link' };
    if ((await hashRow(row)) !== row.hash) return { ok: false, checked: i, brokenAt: row.seq, reason: 'hash' };
  }
  return { ok: true, checked: rows.length, anchoredAfterPrune: rows.length > 0 && rows[0].prev_hash !== GENESIS };
}

const CSV_COLUMNS = ['seq', 'at', 'user_email', 'action', 'target_type', 'target_id', 'details', 'prev_hash', 'hash'] as const;

/** A leading = + - @ makes Excel evaluate the cell; a quote defuses it. */
function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** For reading. JSON export is the one to verify against the chain: CSV defuses formulas, which changes cell text. */
export function toCsv(rows: (AuditRow & { user_email: string | null })[]): string {
  const lines = rows.map((r) =>
    CSV_COLUMNS.map((c) => csvCell(c === 'at' ? new Date(r.at * 1000).toISOString() : r[c])).join(','),
  );
  return [CSV_COLUMNS.join(','), ...lines].join('\r\n') + '\r\n';
}
