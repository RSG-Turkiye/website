import type { Env } from '../../_lib/auth';
import { INDEX_KEY } from '../../_lib/guide-index';

/**
 * GET /api/guide/index.json: the graduate guide's search index, from R2,
 * through this site's own domain (r2.dev is blocked in Türkiye).
 *
 * A Pages Function response is not cached at the edge by Cache-Control
 * alone, so the edge cache (caches.default) is used explicitly, keyed by the
 * object's etag: a publish writes a new object, a new etag, a new key. The
 * browser also keeps it for five minutes, which is how long a removal can
 * take to reach a reader who already has the page open.
 */
const CACHE_CONTROL = 'public, max-age=300, stale-while-revalidate=3600';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const head = await env.BLOG_IMAGES.head?.(INDEX_KEY).catch(() => null);
  const etag = head?.httpEtag ?? null;
  const edge = typeof caches !== 'undefined' ? (caches as unknown as { default: Cache }).default : null;
  const cacheKey = etag ? new Request(`https://rsg-turkiye.iscbsc.org/api/guide/index.json?v=${encodeURIComponent(etag)}`) : null;
  if (etag && request.headers.get('If-None-Match') === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag, 'Cache-Control': CACHE_CONTROL } });
  }
  if (edge && cacheKey) {
    const hit = await edge.match(cacheKey);
    if (hit) return hit;
  }
  const object = await env.BLOG_IMAGES.get(INDEX_KEY);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': CACHE_CONTROL });
  if (object.httpEtag) headers.set('ETag', object.httpEtag);
  const res = new Response(object.body, { headers });
  if (edge && cacheKey) await edge.put(cacheKey, res.clone()).catch(() => undefined);
  return res;
};
