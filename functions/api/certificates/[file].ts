// Serves one certificate PDF through this domain (r2.dev is blocked in
// Türkiye). The UUID is the authorisation, as for /api/images; unlike
// images, an expired row is refused even if the object still exists.
import type { Env } from '../../_lib/auth';
import { CERT_FILE, certKey, corsHeaders, downloadFilename, isKind } from '../../_lib/certificates';

const SYMPOSIUM_ORIGIN = 'https://symposium.rsg-turkiye.iscbsc.org';

const serve: PagesFunction<Env> = async ({ params, env, request }) => {
  // CORS on both outcomes: the symposium page HEADs the file before framing
  // it, and must be able to read a 404 as "gone" rather than a network error.
  const notFound = () => {
    const headers = corsHeaders(request);
    headers.set('X-Robots-Tag', 'noindex');
    return new Response('Not found', { status: 404, headers });
  };
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
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/pdf');
  headers.set('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${filename}"`);
  headers.set('Content-Security-Policy', `frame-ancestors ${SYMPOSIUM_ORIGIN}`);
  headers.set('X-Robots-Tag', 'noindex');
  headers.set('Cache-Control', 'private, max-age=3600');
  headers.set('etag', object.httpEtag);

  headers.set('Accept-Ranges', 'bytes');

  // A 206 must say which bytes it carries (RFC 9110), or a resumed download
  // or a range-reading viewer cannot place them.
  const range = request.headers.has('Range') && 'range' in object ? (object.range as R2Range | undefined) : undefined;
  if (range) {
    const offset = 'suffix' in range ? object.size - range.suffix : (range.offset ?? 0);
    const length = 'suffix' in range ? range.suffix : (range.length ?? object.size - offset);
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('Content-Length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
};

export const onRequestGet = serve;
/** HEAD too: Pages does not derive it from GET, and the page checks a file
 * still exists with HEAD before framing it. */
export const onRequestHead = serve;
