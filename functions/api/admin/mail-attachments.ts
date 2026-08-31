import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../../_lib/auth';
import { MAX_ATTACHMENT_BYTES } from '../../_lib/mail';

const ALLOWED_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  // Senders need the list to pick from; only admins see deactivated entries.
  if (!user.is_admin && user.is_sender !== 1) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const query = user.is_admin
    ? `SELECT id, filename, content_type, size_bytes, uploaded_at, is_active
       FROM mail_attachments ORDER BY uploaded_at DESC`
    : `SELECT id, filename, content_type, size_bytes, uploaded_at, is_active
       FROM mail_attachments WHERE is_active = 1 ORDER BY uploaded_at DESC`;

  const result = await env.DB.prepare(query).all();
  return jsonResponse({ attachments: result.results });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  const contentType = (request.headers.get('Content-Type') ?? '').split(';')[0].trim();
  if (!ALLOWED_TYPES[contentType]) {
    return jsonResponse({ error: 'Unsupported file type', code: 'unsupported_type' }, 400);
  }

  // Header-borne filenames are attacker-adjacent input even from an admin
  // form: strip path separators, quotes and CR/LF before it reaches a
  // Content-Disposition header. decodeURIComponent throws SyntaxError on a
  // malformed percent-encoding (e.g. a trailing "%"), so it needs the same
  // coded-400 treatment as the JSON parsing below rather than a raw 500.
  const rawName = request.headers.get('X-Filename') ?? '';
  let decodedName: string;
  try {
    decodedName = decodeURIComponent(rawName);
  } catch {
    return jsonResponse({ error: 'Invalid filename', code: 'invalid_filename' }, 400);
  }
  const filename = decodedName.replace(/[\r\n"\\/]+/g, '_').trim().slice(0, 120);
  if (!filename) return jsonResponse({ error: 'Missing filename', code: 'missing_filename' }, 400);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) return jsonResponse({ error: 'Empty file', code: 'empty_file' }, 400);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    return jsonResponse({ error: 'File too large', code: 'attachments_too_large' }, 400);
  }

  const id = generateId();
  const key = `${id}.${ALLOWED_TYPES[contentType]}`;
  await env.MAIL_ATTACHMENTS.put(key, bytes, { httpMetadata: { contentType } });

  await env.DB.prepare(
    `INSERT INTO mail_attachments
      (id, filename, r2_key, content_type, size_bytes, uploaded_by, uploaded_at, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, filename, key, contentType, bytes.byteLength, user.id, Math.floor(Date.now() / 1000)).run();

  return jsonResponse({ ok: true, id });
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated', code: 'not_authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);

  let parsed: unknown;
  try {
    parsed = await request.json();
  } catch {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }
  if (parsed === null || typeof parsed !== 'object') {
    return jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
  }

  const body = parsed as { id?: unknown; is_active?: unknown };
  if (typeof body.id !== 'string' || !body.id || typeof body.is_active !== 'boolean') {
    return jsonResponse({ error: 'Missing id or is_active', code: 'missing_fields' }, 400);
  }

  // Deactivate rather than delete: sent_emails rows reference these ids, and
  // the log has to stay readable.
  await env.DB.prepare('UPDATE mail_attachments SET is_active = ? WHERE id = ?')
    .bind(body.is_active ? 1 : 0, body.id).run();

  return jsonResponse({ ok: true });
};
