import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { d1 } from './d1-sqlite';
import { resetAccessToken } from '../../functions/_lib/gmail';

const SCHEMA = readFileSync(new URL('../../db/schema.sql', import.meta.url).pathname, 'utf8');
export const BASE = 'https://rsg-turkiye.iscbsc.org';
export const KEYS = {
  feed: '11111111-1111-4111-8111-111111111111.jpg',
  story: '22222222-2222-4222-8222-222222222222.jpg',
  square: '33333333-3333-4333-8333-333333333333.jpg',
};

export function addMedia(db: DatabaseSync, key: string, width: number, height: number): void {
  db.prepare(`INSERT INTO social_media (key, width, height, content_type, size_bytes, uploaded_by, uploaded_at) VALUES (?, ?, ?, 'image/jpeg', 1, 'ed', 1)`).run(key, width, height);
}

export function setupSocial() {
  const db = new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const users: [string, string, string][] = [
    ['admin', 'admin@example.org', 'is_admin'],
    ['pub', 'pub@example.org', 'is_social_publisher'],
    ['ed', 'ed@example.org', 'is_social'],
    ['ed2', 'ed2@example.org', 'is_social'],
    ['mem', 'mem@example.org', 'is_member'],
  ];
  for (const [id, email, role] of users) {
    db.prepare(`INSERT INTO users (id, google_id, email, ${role}, created_at, last_login) VALUES (?, ?, ?, 1, 1, 1)`).run(id, `g-${id}`, email);
    db.prepare(`INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, 4000000000, 1)`).run(`s-${id}`, id);
  }
  db.prepare(`UPDATE users SET is_social = 1 WHERE id = 'pub'`).run();
  addMedia(db, KEYS.feed, 1080, 1350);
  addMedia(db, KEYS.story, 1080, 1920);
  addMedia(db, KEYS.square, 1080, 1080);
  const waits: Promise<unknown>[] = [];
  const bindLog: { sql: string; count: number }[] = [];
  const env = {
    DB: d1(db, (sql, count) => bindLog.push({ sql, count })), RSG_MAIL_FROM: 'turkey.rsg@gmail.com', GMAIL_REFRESH_TOKEN: 'r', GOOGLE_CLIENT_ID: 'c', GOOGLE_CLIENT_SECRET: 's',
    PUBLIC_BLOG_IMAGES_URL: `${BASE}/api/images`, SYMPOSIUM_ARCHIVE_SECRET: 'cron-secret',
  };
  return { db, env: env as never, waits, bindLog };
}

export async function call(
  handler: unknown, method: string, path: string,
  opts: { as?: string; body?: unknown; params?: Record<string, string>; waits?: Promise<unknown>[]; env: unknown; headers?: Record<string, string> },
): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  if (opts.as) headers.Cookie = `rsg_session=s-${opts.as}`;
  const request = new Request(`${BASE}${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const waits = opts.waits ?? [];
  return (handler as (c: unknown) => Promise<Response>)({
    request, env: opts.env, params: opts.params ?? {}, waitUntil: (p: Promise<unknown>) => { waits.push(p); },
  });
}

export async function settle(waits: Promise<unknown>[]): Promise<void> {
  await Promise.allSettled(waits);
}

/** Stubs Google: token refresh succeeds, each send is recorded with its To and Subject. */
export function stubMail() {
  resetAccessToken();
  const sent: { to: string; subject: string }[] = [];
  let failing = false;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('oauth2')) return new Response(JSON.stringify({ access_token: 't', expires_in: 3600 }), { status: 200 });
    if (failing) return new Response('down', { status: 500 });
    const { raw } = JSON.parse(String(init?.body)) as { raw: string };
    const mime = Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const to = /^To: (.+)$/m.exec(mime)?.[1].trim() ?? '';
    // Unfold continuation lines, then decode and join every encoded word.
    const header = /^Subject: ((?:.*)(?:\r?\n[ \t].*)*)/m.exec(mime)?.[1].replace(/\r?\n[ \t]+/g, ' ').trim() ?? '';
    const words = [...header.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)];
    const subject = words.length ? words.map((w) => Buffer.from(w[1], 'base64').toString('utf8')).join('') : header;
    sent.push({ to, subject });
    return new Response(JSON.stringify({ id: 'm', threadId: 't' }), { status: 200 });
  }) as typeof fetch;
  return { sent, fail: () => { failing = true; }, restore: () => { globalThis.fetch = original; resetAccessToken(); } };
}
