// Organisers' side of symposium certificates: upload one PDF at a time
// (the panel loops over the CSV), list a year, delete a year. Files go in
// the private MAIL_ATTACHMENTS bucket under certificates/ and are deleted 30
// days after upload by ./certificates/purge.ts.
import type { Env, User } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId, canManageSymposium } from '../../_lib/auth';
import {
  normaliseEmail, isKind, isPdf, certKey, MAX_CERT_BYTES, RETENTION_SECONDS,
} from '../../_lib/certificates';

const bad = (code: string, error: string) => jsonResponse({ error, code }, 400);

export async function organiser(request: Request, env: Env, mutating: boolean): Promise<User | Response> {
  if (mutating && !checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (!canManageSymposium(user)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  return user;
}

export function yearParam(raw: string | null): number | null {
  if (!raw || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 2012 && year <= 2100 ? year : null;
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, false);
  if (user instanceof Response) return user;
  const year = yearParam(new URL(request.url).searchParams.get('year'));
  if (year === null) return bad('invalid_year', 'Invalid year');
  const { results } = await env.DB.prepare(
    `SELECT id, year, email, name, kind, size_bytes, uploaded_at, expires_at
     FROM symposium_certificates WHERE year = ? ORDER BY name COLLATE NOCASE, kind`
  ).bind(year).all<{ size_bytes: number }>();
  const totalBytes = results.reduce((sum, r) => sum + r.size_bytes, 0);
  return jsonResponse({ certificates: results, totalBytes });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;

  const year = yearParam(request.headers.get('X-Cert-Year'));
  if (year === null) return bad('invalid_year', 'Invalid year');
  // URI-encoded like the name: header values are Latin-1, and an address
  // with Turkish letters would not survive the trip raw.
  let email: string | null;
  try {
    email = normaliseEmail(decodeURIComponent(request.headers.get('X-Cert-Email') ?? ''));
  } catch {
    email = null;
  }
  if (!email) return bad('invalid_email', 'Invalid email');
  let name: string;
  try {
    name = decodeURIComponent(request.headers.get('X-Cert-Name') ?? '');
  } catch {
    return bad('invalid_name', 'Invalid name');
  }
  name = name.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 120);
  if (!name) return bad('invalid_name', 'Invalid name');
  const kind = request.headers.get('X-Cert-Type');
  if (!isKind(kind)) return bad('invalid_kind', 'Invalid certificate type');

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return bad('empty_file', 'Empty file');
  if (bytes.byteLength > MAX_CERT_BYTES) return bad('too_large', 'File too large');
  if (!isPdf(bytes)) return bad('not_pdf', 'Not a PDF');

  const previous = await env.DB.prepare(
    'SELECT id FROM symposium_certificates WHERE year = ? AND email = ? AND kind = ?'
  ).bind(year, email, kind).first<{ id: string }>();

  const id = generateId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + RETENTION_SECONDS;
  // New object first, then the rows in one transaction, then the old
  // object: a failure at any step leaves a row pointing at a file that exists.
  await env.MAIL_ATTACHMENTS.put(certKey(id), bytes, { httpMetadata: { contentType: 'application/pdf' } });
  const insert = env.DB.prepare(
    `INSERT INTO symposium_certificates (id, year, email, name, kind, size_bytes, uploaded_by, uploaded_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(id, year, email, name, kind, bytes.byteLength, user.id, now, expiresAt);
  try {
    if (previous) {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM symposium_certificates WHERE id = ?').bind(previous.id),
        insert,
      ]);
    } else {
      await insert.run();
    }
  } catch (err) {
    // Another upload for the same person and kind won the race (a double
    // click, two organisers at once). Take back this object so nothing is
    // left in R2 that no row -- and so no purge -- will ever find.
    await env.MAIL_ATTACHMENTS.delete(certKey(id));
    if (String(err).includes('UNIQUE')) {
      return jsonResponse({ error: 'Uploaded twice at once; the other upload was kept', code: 'conflict' }, 409);
    }
    throw err;
  }
  if (previous) await env.MAIL_ATTACHMENTS.delete(certKey(previous.id));
  return jsonResponse({ ok: true, id, expiresAt, replaced: Boolean(previous) });
};

export const onRequestDelete: PagesFunction<Env> = async ({ request, env }) => {
  const user = await organiser(request, env, true);
  if (user instanceof Response) return user;
  const year = yearParam(new URL(request.url).searchParams.get('year'));
  if (year === null) return bad('invalid_year', 'Invalid year');
  const { results } = await env.DB.prepare('SELECT id FROM symposium_certificates WHERE year = ?')
    .bind(year).all<{ id: string }>();
  // R2 accepts up to 1000 keys per delete.
  for (let i = 0; i < results.length; i += 1000) {
    await env.MAIL_ATTACHMENTS.delete(results.slice(i, i + 1000).map((r) => certKey(r.id)));
  }
  await env.DB.prepare('DELETE FROM symposium_certificates WHERE year = ?').bind(year).run();
  return jsonResponse({ ok: true, deleted: results.length });
};
