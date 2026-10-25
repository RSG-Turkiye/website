import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, canManageSymposium, canSocialEdit } from '../../_lib/auth';
import { imageSize } from '../../_lib/images';
import { groupRights } from '../../_lib/cms-access';
import { appendAudit } from '../../_lib/audit';
import { authenticateAgent, agentMaySocial, agentGroupRights } from '../../_lib/agent-tokens';

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
  const now = Math.floor(Date.now() / 1000);
  // With an Authorization header the token alone decides, as in cmsGate: the
  // cookie is ignored and there is no CSRF check (no ambient credential).
  // A token uploads with a draft-level reach in any area it still holds.
  const auth = await authenticateAgent(request, env, now);
  if (auth.kind === 'refused') return auth.response;
  if (auth.kind === 'agent') {
    const a = auth.agent;
    if (!agentMaySocial(a, 'draft') && !Object.values(agentGroupRights(a, 'draft')).some((r) => r.edit)) {
      return jsonResponse({ error: 'Forbidden' }, 403);
    }
    return store(request, env, auth.user.id, a.tokenId, now);
  }
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  // The panel CMS uploads blog and other content images here; the symposium
  // panel uploads committee photographs through this same route rather than
  // a second copy of the size, type and dimension checks below -- a second
  // copy is a second place for one of them to be forgotten. The bucket is
  // shared, which is fine: both are public images on the same two sites,
  // published by people who can already publish to them. Social editors
  // upload post images here too (spec §3).
  // The path is the old member blog form's: kept so no caller changes.
  // Content editors of any group (approve implies edit) are read from their
  // grants, only when the fixed roles say no.
  const fixed = canManageSymposium(user) || canSocialEdit(user);
  if (!fixed && !Object.values(await groupRights(env.DB, user, now)).some((r) => r.edit)) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }
  return store(request, env, user.id, null, now);
};

/** The checks, the put and its records, once the caller may upload. */
async function store(request: Request, env: Env, userId: string, agent: string | null, now: number): Promise<Response> {
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

  // The social panel checks a post's aspect ratio against this record rather
  // than whatever the browser claims. Wrapped: a blog upload must not fail
  // because the social tables have not been migrated yet.
  try {
    await env.DB.prepare(
      'INSERT INTO social_media (key, width, height, content_type, size_bytes, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(key, size.width, size.height, contentType, bytes.byteLength, userId, now).run();
  } catch (err) {
    console.error('social_media insert failed', err);
  }

  // An R2 put is not a D1 write, so the row follows the put.
  await appendAudit(env.DB, { userId, action: 'media.upload', targetType: 'image', targetId: key, details: { bytes: bytes.byteLength }, agent });

  return jsonResponse({ url: `${env.PUBLIC_BLOG_IMAGES_URL}/${key}`, key, width: size.width, height: size.height });
}
