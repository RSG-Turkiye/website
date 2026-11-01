/**
 * Google Form responses, read from their Sheet, into the panel's intake queue
 * (CLAUDE.md rule 3: the Sheet is the source of truth; D1 only holds the
 * queue). Generic: a mapping says which column is what, so the membership
 * and speaker forms can reuse it.
 *
 * Idempotent. A response is known by its timestamp and a hash of its
 * answers, never its row number: approvers delete handled rows from the
 * Sheet, which renumbers every row below. Keys already seen are kept in
 * intake_seen, so a response is never queued twice even after its queue row
 * is gone. Identical suggestions about one record collapse into one row with
 * a count. E-mail addresses typed into free text are masked on the way in.
 */

export interface SheetMapping {
  source: string;
  columns: { timestamp: number; kind: number; recordId: number; text: number; link: number };
  /** The queue kind for the Form's answer to "what is this about". */
  kindOf: (answer: string) => IntakeKind;
  /** Record ids the queue accepts; anything else is dropped, never kept as text. */
  recordId: RegExp;
}

export type IntakeKind = 'correction' | 'addition' | 'programme' | 'removal';

export const GUIDE_MAPPING: SheetMapping = {
  source: 'guide',
  columns: { timestamp: 0, kind: 1, recordId: 2, text: 3, link: 4 },
  kindOf: (a) => {
    const s = a.toLocaleLowerCase('tr');
    if (/çık|remove|sil/.test(s)) return 'removal';
    if (/program/.test(s)) return 'programme';
    if (/ekle|add|yeni|new/.test(s)) return 'addition';
    return 'correction';
  },
  // A professor or lab id, or a university/programme slug.
  recordId: /^(p_[0-9a-f]{12}|l_[0-9a-f]{12}|[a-z0-9]+(-[a-z0-9]+)*)$/,
};

/** How long a handled queue row is kept; the privacy notice says 90 days. */
export const INTAKE_RETENTION_DAYS = 90;
/** Seen-response keys (hashes, no text) are kept a year, so an old response is never re-queued. */
export const INTAKE_SEEN_DAYS = 365;

const EMAIL = /[^\s@<>()]+@[^\s@<>()]+\.[^\s@<>()]+/g;
export const maskEmails = (s: string) => s.replace(EMAIL, '[e-posta]');

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function readSheetRows(token: string, sheetId: string, range: string): Promise<string[][]> {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(range)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (res.status === 403 || res.status === 404) throw Object.assign(new Error(`sheets: ${res.status}`), { code: 'no_access' });
  if (!res.ok) throw new Error(`sheets: ${res.status}`);
  const body = (await res.json()) as { values?: unknown[][] };
  return (body.values ?? []).slice(1).map((r) => r.map((v) => String(v ?? '')));
}

export async function importRows(db: D1Database, rows: string[][], m: SheetMapping, now: number): Promise<{ added: number; removals: number }> {
  let added = 0;
  let removals = 0;
  for (const r of rows) {
    const c = m.columns;
    const timestamp = (r[c.timestamp] ?? '').trim();
    const rawId = (r[c.recordId] ?? '').trim();
    const recordId = m.recordId.test(rawId) ? rawId : '';
    const text = maskEmails((r[c.text] ?? '').trim()).slice(0, 4000);
    const link = maskEmails((r[c.link] ?? '').trim()).slice(0, 500);
    const kind = m.kindOf(r[c.kind] ?? '');
    if (!timestamp || (!text && !recordId)) continue;
    const rowKey = `${m.source}:${timestamp}:${await sha256(r.join('\u001f'))}`;
    const seen = await db.prepare('SELECT 1 FROM intake_seen WHERE row_key = ?').bind(rowKey).first();
    if (seen) continue;
    const twin = await db.prepare(
      "SELECT id, payload FROM intake_rows WHERE source = ? AND kind = ? AND record_id = ? AND status = 'new'",
    ).bind(m.source, kind, recordId).all<{ id: number; payload: string }>();
    const same = (twin.results ?? []).find((t) => norm(JSON.parse(t.payload).text ?? '') === norm(text));
    const remember = db.prepare('INSERT OR IGNORE INTO intake_seen (row_key, created_at) VALUES (?, ?)').bind(rowKey, now);
    if (same) {
      await db.batch([db.prepare('UPDATE intake_rows SET count = count + 1 WHERE id = ?').bind(same.id), remember]);
      continue;
    }
    await db.batch([
      db.prepare("INSERT INTO intake_rows (source, row_key, record_id, kind, payload, status, count, created_at) VALUES (?, ?, ?, ?, ?, 'new', 1, ?)")
        .bind(m.source, rowKey, recordId, kind, JSON.stringify({ text, link, submittedAt: timestamp }), now),
      remember,
    ]);
    added++;
    if (kind === 'removal') removals++;
  }
  return { added, removals };
}

/** Handled rows past their retention, and old seen-keys, go. Returns how many queue rows were deleted. */
export async function pruneIntake(db: D1Database, now: number): Promise<number> {
  const cutoff = now - INTAKE_RETENTION_DAYS * 86400;
  const n = await db.prepare("SELECT COUNT(*) AS n FROM intake_rows WHERE status != 'new' AND handled_at < ?").bind(cutoff).first<{ n: number }>();
  await db.batch([
    db.prepare("DELETE FROM intake_rows WHERE status != 'new' AND handled_at < ?").bind(cutoff),
    db.prepare('DELETE FROM intake_seen WHERE created_at < ?').bind(now - INTAKE_SEEN_DAYS * 86400),
  ]);
  return Number(n?.n ?? 0);
}
