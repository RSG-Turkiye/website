/**
 * Instagram API with Instagram Login (graph.instagram.com): connecting the
 * account, keeping its 60-day token alive, and (below, Task 4) publishing.
 * Where Meta's documentation and live responses have been seen to differ,
 * the code accepts both shapes.
 */
import type { Env } from '../auth';
import type { PublishStep, PostForPlatform, TargetState } from './types';
import { stepFromError, classifyGraphError, type GraphError } from './instagram-errors';

export const IG_GRAPH = 'https://graph.instagram.com/v25.0';
export const IG_SCOPES = ['instagram_business_basic', 'instagram_business_content_publish'];
const PROFESSIONAL = ['BUSINESS', 'MEDIA_CREATOR', 'CREATOR'];

type App = Pick<Env, 'INSTAGRAM_APP_ID' | 'INSTAGRAM_APP_SECRET'>;

export const instagramRedirectUri = (base: string) => `${base}/api/admin/connections/instagram/callback`;

export function instagramAuthUrl(env: App, base: string, state: string): string {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', env.INSTAGRAM_APP_ID ?? '');
  u.searchParams.set('redirect_uri', instagramRedirectUri(base));
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', IG_SCOPES.join(','));
  u.searchParams.set('state', state);
  return u.toString();
}

export const isProfessional = (accountType: string) => PROFESSIONAL.includes(accountType.toUpperCase());

async function json(res: Response): Promise<Record<string, unknown> | null> {
  return res.json().then((v) => (v && typeof v === 'object' ? v as Record<string, unknown> : null)).catch(() => null);
}
const isAuthError = (body: Record<string, unknown> | null) => {
  const code = (body?.error as { code?: number } | undefined)?.code;
  return code === 190 || code === 10 || body?.error_type === 'OAuthException';
};

export async function exchangeInstagramCode(env: App, base: string, code: string):
  Promise<{ ok: true; token: string; userId: string; permissions: string[] } | { ok: false; status: number }> {
  let res: Response;
  try {
    res = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.INSTAGRAM_APP_ID ?? '', client_secret: env.INSTAGRAM_APP_SECRET ?? '',
        grant_type: 'authorization_code', redirect_uri: instagramRedirectUri(base), code,
      }).toString(),
    });
  } catch { return { ok: false, status: 0 }; }
  const body = await json(res);
  // Documented as {data:[{...}]}; also seen flat.
  const row = (Array.isArray(body?.data) ? (body!.data as Record<string, unknown>[])[0] : body) ?? null;
  const token = row?.access_token;
  if (!res.ok || typeof token !== 'string') return { ok: false, status: res.status };
  const raw = row!.permissions;
  const permissions = Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' ? raw.split(',').map((s) => s.trim()) : [];
  return { ok: true, token, userId: String(row!.user_id ?? ''), permissions };
}

export async function longLivedInstagramToken(env: App, shortToken: string):
  Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; status: number }> {
  const u = new URL('https://graph.instagram.com/access_token');
  u.searchParams.set('grant_type', 'ig_exchange_token');
  u.searchParams.set('client_secret', env.INSTAGRAM_APP_SECRET ?? '');
  u.searchParams.set('access_token', shortToken);
  let res: Response;
  try { res = await fetch(u); } catch { return { ok: false, status: 0 }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') return { ok: false, status: res.status };
  return { ok: true, token: body.access_token, expiresIn: Number(body.expires_in) || 60 * 86400 };
}

export async function refreshInstagramToken(token: string):
  Promise<{ ok: true; token: string; expiresIn: number } | { ok: false; status: number; auth: boolean; reason: string }> {
  const u = new URL('https://graph.instagram.com/refresh_access_token');
  u.searchParams.set('grant_type', 'ig_refresh_token');
  u.searchParams.set('access_token', token);
  let res: Response;
  try { res = await fetch(u); } catch { return { ok: false, status: 0, auth: false, reason: 'network' }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') {
    const message = (body?.error as { message?: string } | undefined)?.message ?? `HTTP ${res.status}`;
    return { ok: false, status: res.status, auth: isAuthError(body), reason: message.slice(0, 200) };
  }
  return { ok: true, token: body.access_token, expiresIn: Number(body.expires_in) || 60 * 86400 };
}

export async function instagramMe(token: string):
  Promise<{ ok: true; userId: string; username: string; accountType: string } | { ok: false; status: number; auth: boolean }> {
  const u = new URL(`${IG_GRAPH}/me`);
  u.searchParams.set('fields', 'user_id,username,account_type');
  u.searchParams.set('access_token', token);
  let res: Response;
  try { res = await fetch(u); } catch { return { ok: false, status: 0, auth: false }; }
  const body = await json(res);
  // user_id is the professional account's id, the one /<IG>/media takes; `id` is app-scoped.
  // A JSON number past 2^53 has already been rounded: it would name the wrong account.
  if (typeof body?.user_id === 'number' && !Number.isSafeInteger(body.user_id)) return { ok: false, status: res.status, auth: false };
  if (!res.ok || body?.user_id === undefined) return { ok: false, status: res.status, auth: isAuthError(body) };
  return { ok: true, userId: String(body.user_id), username: String(body.username ?? ''), accountType: String(body.account_type ?? '') };
}

/** Instagram refuses to refresh a token younger than a day; past 60 days it cannot be refreshed at all. */
export const REFRESH_BEFORE_SECONDS = 20 * 86400;
export function needsRefresh(row: { expires_at: number | null; connected_at: number | null }, now: number): boolean {
  if (row.expires_at === null || row.connected_at === null) return false;
  return row.expires_at - now < REFRESH_BEFORE_SECONDS && now - row.connected_at >= 86400;
}

type GraphResult = { ok: true; data: Record<string, unknown> } | { ok: false; status: number; error: GraphError | null };

/** One Graph call. Never throws: a dropped connection is status 0, which classifies as transient. */
async function graph(method: 'GET' | 'POST', path: string, token: string, params: Record<string, string>): Promise<GraphResult> {
  const url = new URL(`${IG_GRAPH}/${path}`);
  const all = { ...params, access_token: token };
  let res: Response;
  try {
    if (method === 'GET') {
      for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
      res = await fetch(url);
    } else {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(all).toString(),
      });
    }
  } catch {
    return { ok: false, status: 0, error: null };
  }
  const body = await res.json().catch(() => null) as Record<string, unknown> | null;
  if (!res.ok || !body || body.error) return { ok: false, status: res.status, error: (body?.error as GraphError | undefined) ?? null };
  return { ok: true, data: body };
}

const fromFailure = (r: Extract<GraphResult, { ok: false }>) => stepFromError(r.status, r.error);

/** Creates a media container; if this API version refuses alt_text, makes it once more without and says so. */
async function createContainer(igUserId: string, token: string, params: Record<string, string>, alt: string, notes: string[]): Promise<GraphResult> {
  const first = await graph('POST', `${igUserId}/media`, token, alt ? { ...params, alt_text: alt } : params);
  if (!first.ok && alt && first.error?.code === 100 && /alt_text/i.test(first.error.message ?? '')) {
    if (!notes.includes('alt_text_dropped')) notes.push('alt_text_dropped');
    return graph('POST', `${igUserId}/media`, token, params);
  }
  return first;
}

/**
 * One step for one target (spec §5). With no container yet it creates one
 * (children first for a carousel) and returns pending. With a container it
 * reads its status: still processing waits; finished publishes; already
 * PUBLISHED means a previous tick published and died before recording it,
 * so the result is recorded and nothing is published twice.
 */
export async function instagramPublishStep(input: { igUserId: string; token: string; post: PostForPlatform; state: TargetState }): Promise<PublishStep> {
  const { igUserId, token, post, state } = input;
  if (state.containerId) {
    const s = await graph('GET', state.containerId, token, { fields: 'status_code,status' });
    if (!s.ok) return fromFailure(s);
    switch (s.data.status_code) {
      case 'PUBLISHED':
        return { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_published_container'] };
      case 'IN_PROGRESS':
        return { kind: 'pending', containerId: state.containerId };
      case 'EXPIRED':
        return { kind: 'retry', reason: 'expired: container expired', clearContainer: true };
      case 'FINISHED': {
        const p = await graph('POST', `${igUserId}/media_publish`, token, { creation_id: state.containerId });
        if (!p.ok) {
          return classifyGraphError(p.status, p.error) === 'pending' ? { kind: 'pending', containerId: state.containerId } : fromFailure(p);
        }
        const remoteId = String(p.data.id);
        const link = await graph('GET', remoteId, token, { fields: 'permalink' });
        const permalink = link.ok && typeof link.data.permalink === 'string' ? link.data.permalink : null;
        return { kind: 'done', remoteId, permalink };
      }
      default:
        return { kind: 'fail', reason: `container_error: ${String(s.data.status ?? s.data.status_code ?? 'unknown')}`.slice(0, 300) };
    }
  }

  const notes: string[] = [];
  let created: GraphResult;
  if (post.type === 'story') {
    created = await graph('POST', `${igUserId}/media`, token, { media_type: 'STORIES', image_url: post.media[0].url });
  } else if (post.type === 'carousel') {
    const children: string[] = [];
    for (const m of post.media) {
      const child = await createContainer(igUserId, token, { image_url: m.url, is_carousel_item: 'true' }, m.alt, notes);
      if (!child.ok) return fromFailure(child);
      children.push(String(child.data.id));
    }
    created = await graph('POST', `${igUserId}/media`, token, { media_type: 'CAROUSEL', children: children.join(','), caption: post.caption });
  } else {
    created = await createContainer(igUserId, token, { image_url: post.media[0].url, caption: post.caption }, post.media[0].alt, notes);
  }
  if (!created.ok) return fromFailure(created);
  return { kind: 'pending', containerId: String(created.data.id), notes };
}
