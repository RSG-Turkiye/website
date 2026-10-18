/**
 * "Connect through Buffer" for LinkedIn and X (spec 2026-10-19 §4): no OAuth
 * on our side. The server lists the channels the Buffer key can see, keeps
 * the ones that fit the platform (LinkedIn: a Page, never a member's
 * profile), and saves the one chosen as an ordinary connection row, so the
 * panel, the banner and the waiting queue treat it like any other.
 */
import type { Env } from './auth';
import { getSessionUser, jsonResponse, checkCsrf } from './auth';
import { connectionUpsert, requeueWaitingStatement, bufferKeyExpiry, BUFFER_SCOPE_PREFIX } from './connections';
import { runWithAudit, appendAudit } from './audit';
import { listBufferChannels, channelFits, type BufferChannel } from './social/buffer';

export type BufferPlatform = 'linkedin' | 'x';

/**
 * Which channel to save: the one asked for, or the only one that fits. More
 * than one and none asked for: the panel shows the list and asks again.
 */
export function chooseChannel(platform: BufferPlatform, channels: BufferChannel[], wanted: string | null):
  { ok: true; channel: BufferChannel } | { ok: false; code: 'no_channel' | 'unknown_channel' } | { ok: false; code: 'choose'; choices: { id: string; name: string }[] } {
  const fits = channels.filter((c) => channelFits(platform, c));
  if (wanted) {
    const c = fits.find((f) => f.id === wanted);
    return c ? { ok: true, channel: c } : { ok: false, code: 'unknown_channel' };
  }
  if (fits.length === 0) return { ok: false, code: 'no_channel' };
  if (fits.length === 1) return { ok: true, channel: fits[0] };
  return { ok: false, code: 'choose', choices: fits.map((c) => ({ id: c.id, name: c.name })) };
}

export function bufferConnect(platform: BufferPlatform): PagesFunction<Env> {
  return async ({ request, env }) => {
    if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
    const user = await getSessionUser(request, env);
    if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
    if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
    const now = Math.floor(Date.now() / 1000);
    if (!env.BUFFER_API_KEY) return jsonResponse({ error: 'Buffer is not set up', code: 'not_configured' }, 400);

    let wanted: string | null = null;
    const raw = await request.text();
    if (raw) {
      try {
        const body = JSON.parse(raw) as { channelId?: unknown };
        if (typeof body.channelId === 'string' && body.channelId.length <= 100) wanted = body.channelId;
      } catch { return jsonResponse({ error: 'Bad request', code: 'bad_request' }, 400); }
    }

    const listed = await listBufferChannels(env.BUFFER_API_KEY);
    if (!listed.ok) {
      const auth = listed.status === 401 || listed.code === 'UNAUTHORIZED' || listed.code === 'UNAUTHENTICATED';
      await appendAudit(env.DB, { userId: user.id, action: 'connection.buffer_failed', targetType: 'connection', targetId: platform, details: { status: listed.status, code: listed.code } }, now);
      return jsonResponse({ error: listed.message, code: auth ? 'buffer_auth' : 'buffer_unavailable' }, 502);
    }
    const pick = chooseChannel(platform, listed.channels, wanted);
    if (!pick.ok) {
      if (pick.code === 'choose') return jsonResponse({ choose: pick.choices });
      return jsonResponse({ error: pick.code, code: pick.code }, pick.code === 'no_channel' ? 409 : 400);
    }
    const c = pick.channel;
    const upsert = await connectionUpsert(env, platform, {
      accountId: c.id, accountName: c.name, accessToken: null, refreshToken: null,
      scopes: `${BUFFER_SCOPE_PREFIX}${c.organizationId}`, expiresAt: bufferKeyExpiry(env), refreshExpiresAt: null,
    }, user.id, now);
    await runWithAudit(env.DB, [upsert, requeueWaitingStatement(env.DB, platform)], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: platform,
      details: { via: 'buffer', channel: c.id, name: c.name },
    });
    return jsonResponse({ ok: true, platform, accountName: c.name });
  };
}
