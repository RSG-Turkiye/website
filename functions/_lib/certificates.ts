/**
 * Shared rules for symposium certificates: what a stored file and a lookup
 * may look like, and the two cross-cutting concerns of the public endpoints
 * (CORS for the symposium site, a per-IP rate limit).
 *
 * See docs/superpowers/specs/2026-10-11-symposium-certificates-design.md.
 */

export const KINDS = ['participation', 'workshop', 'presentation', 'appreciation'] as const;
export type CertKind = (typeof KINDS)[number];

export const MAX_CERT_BYTES = 10 * 1024 * 1024;
export const RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const LOOKUP_WINDOW_SECONDS = 10 * 60;
export const LOOKUP_LIMIT = 20;

export const CERT_FILE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased with Turkish-aware folding of the dotted capital, so İ and I
 * both become i: "İLKER@" typed on a Turkish keyboard must find "ilker@". */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().replace(/İ/g, 'i').replace(/I/g, 'i').toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) return null;
  return email;
}

export function isKind(v: unknown): v is CertKind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

export function certKey(id: string): string {
  return `certificates/${id}.pdf`;
}

export function isPdf(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(5, bytes.byteLength));
  return String.fromCharCode(...head) === '%PDF-';
}

const TR_ASCII: Record<string, string> = { ı: 'i', İ: 'I', ğ: 'g', Ğ: 'G', ş: 's', Ş: 'S' };

export function downloadFilename(year: number, kind: CertKind, name: string): string {
  const slug = name
    .replace(/[ıİğĞşŞ]/g, (c) => TR_ASCII[c])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return slug ? `RSG-${year}-${kind}-${slug}.pdf` : `RSG-${year}-${kind}.pdf`;
}

const SYMPOSIUM_ORIGIN = 'https://symposium.rsg-turkiye.iscbsc.org';
const DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/** Only these endpoints are called cross-origin, so CORS is set here rather
 * than site-wide. An origin we do not know gets no CORS headers at all. */
export function corsHeaders(request: Request): Headers {
  const headers = new Headers();
  const origin = request.headers.get('Origin') ?? '';
  if (origin === SYMPOSIUM_ORIGIN || DEV_ORIGIN.test(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type');
    headers.set('Access-Control-Max-Age', '86400');
  }
  headers.set('Vary', 'Origin');
  return headers;
}

export async function ipHash(request: Request): Promise<string> {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`rsg-cert:${ip}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** True when this hash has used up its lookups in the window. Records the
 * attempt otherwise, so a limited caller does not extend its own window. */
export async function rateLimited(db: D1Database, hash: string, now: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT COUNT(*) AS n FROM certificate_lookups WHERE ip_hash = ? AND at > ?')
    .bind(hash, now - LOOKUP_WINDOW_SECONDS)
    .first<{ n: number }>();
  if ((row?.n ?? 0) >= LOOKUP_LIMIT) return true;
  await db.prepare('INSERT INTO certificate_lookups (ip_hash, at) VALUES (?, ?)').bind(hash, now).run();
  return false;
}
