// Serves one certificate PDF through this domain (r2.dev is blocked in
// Türkiye). The UUID is the authorisation, as for /api/images; unlike
// images, an expired row is refused even if the object still exists.
import type { Env } from '../../_lib/auth';
import { CERT_FILE, certKey, downloadFilename, isKind } from '../../_lib/certificates';

const SYMPOSIUM_ORIGIN = 'https://symposium.rsg-turkiye.iscbsc.org';
const notFound = () => new Response('Not found', { status: 404, headers: { 'X-Robots-Tag': 'noindex' } });

const serve: PagesFunction<Env> = async ({ params, env, request }) => {
  const name = String(params.file);
  if (!CERT_FILE.test(name)) return notFound();
  const id = name.slice(0, -4);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    'SELECT year, kind, name FROM symposium_certificates WHERE id = ? AND expires_at > ?'
  ).bind(id, now).first<{ year: number; kind: string; name: string }>();
  if (!row || !isKind(row.kind)) return notFound();

  const object = await env.MAIL_ATTACHMENTS.get(certKey(id), { range: request.headers });
  if (!object) return notFound();

  const filename = downloadFilename(row.year, row.kind, row.name);
  const download = new URL(request.url).searchParams.get('download') === '1';
  const headers = new Headers();
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
  headers.set('Content-Security-Policy', `frame-ancestors ${SYMPOSIUM_ORIGIN}`);
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('etag', object.httpEtag);

  const ranged = 'range' in object && object.range !== undefined && request.headers.has('Range');
  return new Response(object.body, { status: ranged ? 206 : 200, headers });
};

export const onRequestGet = serve;
/** HEAD too: Pages does not derive it from GET, and the page checks a file
 * still exists with HEAD before framing it. */
export const onRequestHead = serve;
