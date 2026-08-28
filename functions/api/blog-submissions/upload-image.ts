import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_writer !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const contentType = request.headers.get('Content-Type') ?? '';
  const extension = ALLOWED_TYPES[contentType];
  if (!extension) {
    return jsonResponse({ error: 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.' }, 400);
  }

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength === 0) {
    return jsonResponse({ error: 'Empty file' }, 400);
  }
  if (bytes.byteLength > MAX_BYTES) {
    return jsonResponse({ error: 'Image too large (max 5MB)' }, 400);
  }

  const key = `${crypto.randomUUID()}.${extension}`;
  await env.BLOG_IMAGES.put(key, bytes, { httpMetadata: { contentType } });

  return jsonResponse({ url: `${env.PUBLIC_BLOG_IMAGES_URL}/${key}` });
};
