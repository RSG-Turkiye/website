import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import { imageSize } from '../../_lib/images';

const MAX_BYTES = 5 * 1024 * 1024; // 5MB
/**
 * Blog images are rendered about 800px wide, so this is already generous
 * enough for a retina screen.
 *
 * It is here because bytes alone do not catch the case that actually hurts:
 * a well-compressed photograph can be 6720x4480 and still fit comfortably
 * under the byte limit, and it is then sent whole to every reader. One such
 * photograph in this repo was 6.18 MB and displayed at 300px.
 *
 * The panel downscales before uploading, so in normal use nobody meets this
 * limit. It exists for when they do.
 */
const MAX_DIMENSION = 2000;
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

  const size = imageSize(bytes);
  if (!size) {
    return jsonResponse({ error: 'That file does not look like a JPEG, PNG, WebP or GIF.' }, 400);
  }
  if (size.width > MAX_DIMENSION || size.height > MAX_DIMENSION) {
    return jsonResponse(
      {
        error:
          `Image is ${size.width}x${size.height}px. The limit is ${MAX_DIMENSION}px on the longest side ` +
          `-- blog images are shown about 800px wide, so anything larger is sent to readers and never seen. ` +
          `Resize it and upload again.`,
      },
      400
    );
  }

  const key = `${crypto.randomUUID()}.${extension}`;
  await env.BLOG_IMAGES.put(key, bytes, { httpMetadata: { contentType } });

  return jsonResponse({ url: `${env.PUBLIC_BLOG_IMAGES_URL}/${key}` });
};
