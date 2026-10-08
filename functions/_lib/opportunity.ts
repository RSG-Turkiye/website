// Pure shaping for the opportunities board. No D1 handle, no fetch: the
// routes in functions/api/opportunities/ bind these statements, and tests run
// them against node:sqlite with the real CREATE TABLE.
import { parseHttpUrl } from './url';

export const LEVELS = ['undergrad', 'msc', 'phd', 'postdoc', 'professional'] as const;
export const TYPES = [
  'bursiyer', 'scholarship', 'phd_position', 'internship', 'course', 'summer_school',
  'hackathon', 'competition', 'job', 'fellowship', 'event',
] as const;
const STUDENT = new Set(['undergrad', 'msc', 'phd']);
const DEFAULT_LIFETIME = 45 * 86400;

export interface IngestItem {
  url: string; title: string; title_tr?: string; summary_tr?: string; source: string;
  type: string; levels: string[]; deadline?: number | null; starts_at?: number | null;
  country?: string; online?: boolean; cost_note?: string; eligibility_note?: string;
  visibility?: 'public' | 'slack';
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const int = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) ? v : null);

export function validateIngestItem(x: unknown): { ok: true; item: IngestItem } | { ok: false; error: string } {
  if (!x || typeof x !== 'object') return { ok: false, error: 'item must be an object' };
  const o = x as Record<string, unknown>;
  let url: string;
  try { url = parseHttpUrl(String(o.url ?? ''), 'url'); } catch { return { ok: false, error: 'url must be http(s)' }; }
  if (!url) return { ok: false, error: 'url is required' };
  const title = str(o.title, 300);
  if (!title) return { ok: false, error: 'title is required' };
  const source = str(o.source, 40);
  if (!/^[a-z0-9_]+$/.test(source)) return { ok: false, error: 'source must be an adapter name' };
  if (!(TYPES as readonly string[]).includes(String(o.type))) return { ok: false, error: `type must be one of ${TYPES.join(', ')}` };
  const levels = Array.isArray(o.levels) ? o.levels.map(String) : [];
  if (levels.some((l) => !(LEVELS as readonly string[]).includes(l))) return { ok: false, error: 'unknown level' };
  const visibility = o.visibility === 'slack' ? 'slack' : 'public';
  return {
    ok: true,
    item: {
      url, title, source, type: String(o.type), levels: [...new Set(levels)], visibility,
      title_tr: str(o.title_tr, 300), summary_tr: str(o.summary_tr, 600),
      deadline: int(o.deadline), starts_at: int(o.starts_at),
      country: str(o.country, 2).toUpperCase(), online: o.online === true,
      cost_note: str(o.cost_note, 80), eligibility_note: str(o.eligibility_note, 160),
    },
  };
}

export function isStudentLevel(levels: string[]): boolean {
  return levels.some((l) => STUDENT.has(l));
}

export function expiryFor(deadline: number | null | undefined, firstSeen: number): number {
  return deadline ?? firstSeen + DEFAULT_LIFETIME;
}

export function upsertStatements(item: IngestItem, now: number, id: string): { sql: string; values: unknown[] } {
  const published = isStudentLevel(item.levels) ? now : null;
  return {
    // ON CONFLICT keeps id, first_seen and, while the item stays student level,
    // its original published_at; a re-ingest that drops the level unpublishes it. It
    // never touches a removed row: the WHERE turns the update into a no-op.
    sql: `INSERT INTO opportunities
            (id, url, title, title_tr, summary_tr, source, type, levels, deadline, starts_at,
             country, online, cost_note, eligibility_note, visibility, first_seen, published_at, expires_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(url) DO UPDATE SET
            title = excluded.title, title_tr = excluded.title_tr, summary_tr = excluded.summary_tr,
            type = excluded.type, levels = excluded.levels, deadline = excluded.deadline,
            starts_at = excluded.starts_at, country = excluded.country, online = excluded.online,
            cost_note = excluded.cost_note, eligibility_note = excluded.eligibility_note,
            visibility = excluded.visibility,
            published_at = CASE WHEN excluded.published_at IS NULL THEN NULL
                                 ELSE COALESCE(opportunities.published_at, excluded.published_at) END,
            expires_at = COALESCE(excluded.deadline, opportunities.first_seen + ${DEFAULT_LIFETIME})
          WHERE opportunities.removed_at IS NULL`,
    values: [
      id, item.url, item.title, item.title_tr ?? '', item.summary_tr ?? '', item.source, item.type,
      JSON.stringify(item.levels), item.deadline ?? null, item.starts_at ?? null, item.country ?? '',
      item.online ? 1 : 0, item.cost_note ?? '', item.eligibility_note ?? '', item.visibility ?? 'public',
      now, published, expiryFor(item.deadline, now),
    ],
  };
}

// Params: now, since (published_at >= since), limit.
export const PUBLIC_LIST_SQL = `
  SELECT id, url, title, title_tr, summary_tr, source, type, levels, deadline, starts_at,
         country, online, cost_note, eligibility_note, published_at, expires_at
  FROM opportunities
  WHERE published_at IS NOT NULL AND removed_at IS NULL AND visibility = 'public'
    AND expires_at > ?1 AND published_at >= ?2
  ORDER BY COALESCE(deadline, expires_at) ASC
  LIMIT ?3`;

async function hmac(message: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function signRemoval(id: string, secret: string): Promise<string> {
  return hmac(`remove:${id}`, secret);
}

export async function verifyRemoval(id: string, token: string, secret: string): Promise<boolean> {
  const expected = await signRemoval(id, secret);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
