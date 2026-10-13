/**
 * Instagram API with Instagram Login (graph.instagram.com): connecting the
 * account, keeping its 60-day token alive, and (below, Task 4) publishing.
 * Where Meta's documentation and live responses have been seen to differ,
 * the code accepts both shapes.
 */
import type { Env } from '../auth';

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
  try { res = await fetch(u); } catch (err) { return { ok: false, status: 0, auth: false, reason: String(err).slice(0, 200) }; }
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
  if (!res.ok || body?.user_id === undefined) return { ok: false, status: res.status, auth: isAuthError(body) };
  return { ok: true, userId: String(body.user_id), username: String(body.username ?? ''), accountType: String(body.account_type ?? '') };
}

/** Instagram refuses to refresh a token younger than a day; past 60 days it cannot be refreshed at all. */
export const REFRESH_BEFORE_SECONDS = 20 * 86400;
export function needsRefresh(row: { expires_at: number | null; connected_at: number | null }, now: number): boolean {
  if (row.expires_at === null || row.connected_at === null) return false;
  return row.expires_at - now < REFRESH_BEFORE_SECONDS && now - row.connected_at >= 86400;
}
