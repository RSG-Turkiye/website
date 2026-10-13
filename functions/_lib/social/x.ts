/**
 * X API v2 (pay per use): connecting @rsgturkey with OAuth 2.0 and PKCE,
 * renewing its two-hour access token on use (refresh tokens rotate: each
 * renewal spends the old one), and publishing image posts.
 *
 * The PKCE verifier is not stored: it is an HMAC of the one-use OAuth state
 * under the app secret, so start and callback derive the same value and
 * nothing new goes into D1.
 */
import type { Env } from '../auth';
import type { ConnectionRow } from '../connections';
import { getConnection, readAccessToken, readRefreshToken, connectionStatus, tokenContext } from '../connections';
import { seal } from '../token-vault';
import type { PublishInput, PublishStep } from './types';
import type { TokenEnv, Usable } from './tokens';

export const X_API = 'https://api.x.com/2';
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
type App = Pick<Env, 'X_CLIENT_ID' | 'X_CLIENT_SECRET'>;

export const xRedirectUri = (base: string) => `${base}/api/admin/connections/x/callback`;

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkceVerifier(secret: string, state: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`x-pkce:${state}`)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export async function xAuthUrl(env: App, base: string, state: string): Promise<string> {
  const u = new URL('https://x.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.X_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', xRedirectUri(base));
  u.searchParams.set('scope', X_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', await pkceChallenge(await pkceVerifier(env.X_CLIENT_SECRET ?? '', state)));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

async function json(res: Response): Promise<Record<string, unknown> | null> {
  return res.json().then((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)).catch(() => null);
}

type Tokens = { ok: true; accessToken: string; refreshToken: string | null; expiresIn: number; scopes: string[] };

async function tokenCall(env: App, params: Record<string, string>): Promise<Tokens | { ok: false; status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(`${X_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${env.X_CLIENT_ID ?? ''}:${env.X_CLIENT_SECRET ?? ''}`)}` },
      body: new URLSearchParams(params).toString(),
    });
  } catch { return { ok: false, status: 0, body: null }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') return { ok: false, status: res.status, body };
  return {
    ok: true, accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresIn: Number(body.expires_in) || 7200, scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
  };
}

export async function exchangeXCode(env: App, base: string, code: string, verifier: string): Promise<Tokens | { ok: false; status: number }> {
  const r = await tokenCall(env, { grant_type: 'authorization_code', code, redirect_uri: xRedirectUri(base), code_verifier: verifier });
  return r.ok ? r : { ok: false, status: r.status };
}

export async function refreshXToken(env: App, refreshToken: string): Promise<Tokens | { ok: false; status: number; auth: boolean; reason: string }> {
  const r = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (r.ok) return r;
  const reason = String(r.body?.error_description ?? r.body?.error ?? `HTTP ${r.status}`).slice(0, 200);
  return { ok: false, status: r.status, auth: r.status === 400 || r.status === 401, reason };
}

export async function xMe(token: string): Promise<{ ok: true; id: string; username: string } | { ok: false; status: number }> {
  let res: Response;
  try { res = await fetch(`${X_API}/users/me?user.fields=username`, { headers: { Authorization: `Bearer ${token}` } }); } catch { return { ok: false, status: 0 }; }
  const data = (await json(res))?.data as { id?: string; username?: string } | undefined;
  if (!res.ok || !data?.id) return { ok: false, status: res.status };
  return { ok: true, id: String(data.id), username: String(data.username ?? '') };
}

async function fromStored(env: TokenEnv, now: number, row?: ConnectionRow | null): Promise<Usable> {
  const current = row ?? await getConnection(env.DB, 'x');
  if (connectionStatus(current ?? null, now) === 'broken') return { ok: false, why: 'broken' };
  const token = current?.account_id && current.expires_at !== null && current.expires_at > now ? await readAccessToken(env, current) : null;
  return token ? { ok: true, token, account: { id: current!.account_id!, name: current!.account_name } } : { ok: false, why: 'transient', reason: 'unavailable: X token renewal did not finish' };
}

/**
 * Renews X's access token. Stored with a compare-and-set on the refresh token
 * it spent: if another caller rotated it first, theirs is the live pair and
 * is used instead, and a refusal of the spent token is not a broken connection.
 */
export async function refreshXOnUse(env: TokenEnv, row: ConnectionRow, now: number): Promise<Usable> {
  let refresh: string | null = null;
  try { refresh = await readRefreshToken(env, row); } catch { refresh = null; }
  if (!refresh) return { ok: false, why: 'unreadable' };
  const r = await refreshXToken(env, refresh);
  if (r.ok) {
    const access = await seal(env.TOKEN_ENC_KEY, r.accessToken, tokenContext('x', 'access'));
    const nextRefresh = r.refreshToken ? await seal(env.TOKEN_ENC_KEY, r.refreshToken, tokenContext('x', 'refresh')) : row.refresh_token_enc;
    const res = await env.DB.prepare(
      `UPDATE platform_connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, last_ok_at = ?, last_error = NULL, last_error_at = NULL
        WHERE platform = 'x' AND refresh_token_enc = ?`,
    ).bind(access, nextRefresh, now + r.expiresIn, now, row.refresh_token_enc).run();
    if (res.meta.changes === 1) return { ok: true, token: r.accessToken, account: { id: row.account_id!, name: row.account_name } };
    return fromStored(env, now);
  }
  const current = await getConnection(env.DB, 'x');
  if (current && current.refresh_token_enc !== row.refresh_token_enc) return fromStored(env, now, current);
  if (r.auth) {
    // Conditional on the refresh token this call spent: if someone rotated it since the re-read, theirs is the live pair.
    const broke = await env.DB.prepare(
      `UPDATE platform_connections SET last_error = ?, last_error_at = ? WHERE platform = 'x' AND refresh_token_enc = ?`,
    ).bind(`refresh: ${r.reason}`.slice(0, 300), now, row.refresh_token_enc).run();
    if (broke.meta.changes !== 1) return fromStored(env, now);
    return { ok: false, why: 'broken', justBroke: true, reason: r.reason };
  }
  if (row.expires_at !== null && row.expires_at > now) return fromStored(env, now, row);
  return { ok: false, why: 'transient', reason: `unavailable: ${r.reason}` };
}

interface XState { x: 1; media: string[]; attempt: number | null }
const encodeState = (s: XState) => JSON.stringify({ x: 1, media: s.media, attempt: s.attempt });
function decodeState(raw: string | null): XState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as XState;
    return v && v.x === 1 && Array.isArray(v.media) ? { x: 1, media: v.media.map(String), attempt: typeof v.attempt === 'number' ? v.attempt : null } : null;
  } catch { return null; }
}

const detail = (body: Record<string, unknown> | null, status: number) =>
  String(body?.detail ?? body?.title ?? (body?.errors as { message?: string }[] | undefined)?.[0]?.message ?? `HTTP ${status}`).slice(0, 250);

function fromFailure(status: number, body: Record<string, unknown> | null): PublishStep {
  const d = detail(body, status);
  if (status === 401) return { kind: 'auth', reason: `auth: ${d}` };
  if (status === 402 || /client-not-enrolled|client-forbidden|credits/i.test(`${body?.type ?? ''} ${d}`)) return { kind: 'fail', reason: `no_api_access: ${d}`, clearContainer: true };
  if (status === 429) return { kind: 'retry', reason: `rate_limited: ${d}` };
  if (status === 0 || status >= 500) return { kind: 'retry', reason: `unavailable: ${d}` };
  if (status === 403) return { kind: 'auth', reason: `auth: ${d}` };
  if (/too long|exceeds/i.test(d)) return { kind: 'fail', reason: `caption_rejected: ${d}`, clearContainer: true };
  return { kind: 'fail', reason: `unknown: ${d}`, clearContainer: true };
}

const isDuplicate = (status: number, body: Record<string, unknown> | null) => status === 403 && /duplicate/i.test(detail(body, status));

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, init);
    return { status: res.status, body: await json(res) };
  } catch { return { status: 0, body: null }; }
}

/**
 * Tick 1 uploads the images (with alt text) and waits. The next tick records
 * the attempt with checkpoint and creates the post. If a tick finds an
 * attempt already recorded, the create call it made was never answered: it
 * creates again, and X answering "duplicate content" proves the first one
 * went out. (The cost: a post whose text repeats an older one exactly, and
 * whose first create was lost, is recorded as published. Both together are
 * rare enough.) While recovering, no answer other than success, duplicate,
 * auth or rate limit is taken as proof that nothing went out, so none of
 * them clears the attempt.
 */
export async function xPublishStep(input: PublishInput): Promise<PublishStep> {
  const { account, token, post, now, checkpoint } = input;
  const st = decodeState(input.state.containerId);
  if (input.state.containerId && !st) return { kind: 'fail', reason: 'unknown: unreadable X state', clearContainer: true };
  if (post.type === 'story') return { kind: 'fail', reason: 'not_available: X has no stories' };
  const auth = { Authorization: `Bearer ${token}` };

  if (!st) {
    const media: string[] = [];
    const notes: string[] = [];
    for (const m of post.media) {
      const data = m.load ? await m.load() : null;
      if (!data) return { kind: 'retry', reason: `media_unreachable: ${m.key}` };
      const form = new FormData();
      form.set('media', new Blob([data as BlobPart], { type: 'image/jpeg' }), m.key);
      form.set('media_category', 'tweet_image');
      const up = await call(`${X_API}/media/upload`, { method: 'POST', headers: auth, body: form });
      const id = (up.body?.data as { id?: string } | undefined)?.id;
      if (up.status !== 200 && up.status !== 201) return fromFailure(up.status, up.body);
      if (!id) return { kind: 'retry', reason: 'unavailable: upload without id' };
      if (m.alt) {
        const meta = await call(`${X_API}/media/metadata`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, metadata: { alt_text: { text: m.alt.slice(0, 1000) } } }),
        });
        if (meta.status === 401) return fromFailure(401, meta.body);
        if (meta.status < 200 || meta.status >= 300) { if (!notes.includes('alt_text_dropped')) notes.push('alt_text_dropped'); }
      }
      media.push(id);
    }
    return { kind: 'pending', containerId: encodeState({ x: 1, media, attempt: null }), notes };
  }

  const recovering = st.attempt !== null;
  if (!recovering && !await checkpoint(encodeState({ ...st, attempt: now }))) return { kind: 'pending', containerId: input.state.containerId! };
  const created = await call(`${X_API}/tweets`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: post.caption, ...(st.media.length ? { media: { media_ids: st.media } } : {}) }),
  });
  if (created.status === 201 || created.status === 200) {
    const id = (created.body?.data as { id?: string } | undefined)?.id;
    if (!id) return { kind: 'retry', reason: `uncertain: unexpected ${created.status} from X` };
    return { kind: 'done', remoteId: id, permalink: `https://x.com/${account.name || 'i/web'}/status/${id}` };
  }
  if (isDuplicate(created.status, created.body)) {
    return recovering
      ? { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_duplicate'] }
      : { kind: 'fail', reason: `duplicate: ${detail(created.body, created.status)}`, clearContainer: true };
  }
  if (created.status >= 200 && created.status < 300) return { kind: 'retry', reason: `uncertain: unexpected ${created.status} from X` };
  if (recovering) {
    // The first create may have gone out: only a clear auth or rate-limit answer is believed, and nothing is cleared.
    if (created.status === 401) return { kind: 'auth', reason: `auth: ${detail(created.body, 401)}` };
    if (created.status === 429) return { kind: 'retry', reason: `rate_limited: ${detail(created.body, 429)}` };
    return { kind: 'retry', reason: `uncertain: ${detail(created.body, created.status)}` };
  }
  return fromFailure(created.status, created.body);
}
