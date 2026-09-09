import type { Env } from '../../_lib/auth';

/**
 * Serves an uploaded image from R2 through this site's own domain.
 *
 * The bucket has a public r2.dev URL and uploads used to return it. That URL
 * is unreachable from Türkiye -- the TLS handshake is cut, the same way
 * pages.dev is -- so every photograph uploaded through the panel rendered as
 * a broken image for essentially every reader of these two sites. The bucket
 * was fine and the object was fine; only the hostname was wrong. Serving
 * from a hostname the readers can actually reach is the fix, and it also
 * ends the site's dependence on a Cloudflare-owned domain nobody chose.
 *
 * Public on purpose: these are photographs published on public pages. The
 * key is the whole authorisation -- a v4 UUID nobody can guess -- which is
 * exactly what the r2.dev URL offered too.
 *
 * `Content-Type` and the rest come off the object, so an image stored as
 * WebP is served as WebP even though the key says .jpg is possible.
 */

/** Exactly what upload-image.ts writes: a v4 UUID plus one known extension.
 * Anything else is refused without touching the bucket -- this is the only
 * user-controlled value in the request, and it must never be able to name
 * an object it was not meant to. */
export const IMAGE_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp|gif)$/;

/** A year, immutable: the key contains a UUID minted per upload, so a given
 * key's bytes never change. Without this every view is a Function
 * invocation; with it, the edge answers almost all of them. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable';

const serve: PagesFunction<Env> = async ({ params, env, request }) => {
  const key = String(params.key);
  if (!IMAGE_KEY.test(key)) return new Response('Not found', { status: 404 });

  // onlyIf hands R2 the browser's validators, so a repeat view transfers no
  // bytes: an unmodified object comes back with no body and becomes a 304.
  const object = await env.BLOG_IMAGES.get(key, {
    onlyIf: request.headers,
    range: request.headers,
  });
  if (!object) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('Cache-Control', CACHE_CONTROL);
  // The bytes are the same for everyone; only the validators vary.
  headers.set('Vary', 'Accept-Encoding');

  if (!('body' in object)) return new Response(null, { status: 304, headers });

  const ranged = 'range' in object && object.range !== undefined && request.headers.has('Range');
  return new Response(object.body, { status: ranged ? 206 : 200, headers });
};

export const onRequestGet = serve;
/**
 * HEAD too, or it falls through to the static handler and answers with the
 * site's HTML 404 page while GET on the same URL returns the image. Pages
 * dispatches by method and does not derive HEAD from onRequestGet; the
 * runtime drops the body, so this is the same handler. Browsers use GET for
 * an <img>, so nothing was visibly broken -- but a link checker, a crawler
 * or a cache probing with HEAD was told the image does not exist.
 */
export const onRequestHead = serve;
