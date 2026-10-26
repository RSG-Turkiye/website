/**
 * LinkedIn Community Management API: connecting a member who administers the
 * RSG Page, keeping the token alive, and publishing as the organisation
 * (Posts API with images from the Images API).
 *
 * LINKEDIN-VERSION: LinkedIn retires each monthly version about a year after
 * release. Bump LI_VERSION once a year (README, "Yearly upkeep").
 */
import type { Env } from '../auth';
import type { PublishInput, PublishStep } from './types';
import { foreignState } from './buffer';

export const LI_API = 'https://api.linkedin.com/rest';
export const LI_VERSION = '202609';
export const LI_SCOPES = ['w_organization_social', 'r_organization_social', 'rw_organization_admin'];

type App = Pick<Env, 'LINKEDIN_CLIENT_ID' | 'LINKEDIN_CLIENT_SECRET'>;

export const linkedinRedirectUri = (base: string) => `${base}/api/admin/connections/linkedin/callback`;

export function linkedinAuthUrl(env: App, base: string, state: string): string {
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', linkedinRedirectUri(base));
  u.searchParams.set('state', state);
  u.searchParams.set('scope', LI_SCOPES.join(' '));
  return u.toString();
}

const headers = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`, 'Linkedin-Version': LI_VERSION, 'X-Restli-Protocol-Version': '2.0.0', ...extra,
});

async function json(res: Response): Promise<Record<string, unknown> | null> {
  return res.json().then((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)).catch(() => null);
}

type TokenOk = { ok: true; accessToken: string; expiresIn: number; refreshToken: string | null; refreshExpiresIn: number | null; scopes: string[] };

async function tokenCall(params: Record<string, string>): Promise<TokenOk | { ok: false; status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
    });
  } catch { return { ok: false, status: 0, body: null }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') return { ok: false, status: res.status, body };
  return {
    ok: true, accessToken: body.access_token, expiresIn: Number(body.expires_in) || 60 * 86400,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    refreshExpiresIn: typeof body.refresh_token_expires_in === 'number' ? body.refresh_token_expires_in : null,
    scopes: typeof body.scope === 'string' ? body.scope.split(/[ ,]+/).filter(Boolean) : [],
  };
}

export async function exchangeLinkedinCode(env: App, base: string, code: string): Promise<TokenOk | { ok: false; status: number }> {
  const r = await tokenCall({
    grant_type: 'authorization_code', code, redirect_uri: linkedinRedirectUri(base),
    client_id: env.LINKEDIN_CLIENT_ID ?? '', client_secret: env.LINKEDIN_CLIENT_SECRET ?? '',
  });
  return r.ok ? r : { ok: false, status: r.status };
}

/** Only apps approved for programmatic refresh tokens get one; the refresh token keeps its original expiry. */
export async function refreshLinkedinToken(env: App, refreshToken: string):
  Promise<TokenOk | { ok: false; status: number; auth: boolean; reason: string }> {
  const r = await tokenCall({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.LINKEDIN_CLIENT_ID ?? '', client_secret: env.LINKEDIN_CLIENT_SECRET ?? '',
  });
  if (r.ok) return r;
  const reason = String(r.body?.error_description ?? r.body?.error ?? `HTTP ${r.status}`).slice(0, 200);
  return { ok: false, status: r.status, auth: r.status === 400 || r.status === 401, reason };
}

/** The Page the member administers whose vanity name is `vanityName` (case-insensitive). */
export async function findAdminOrganization(token: string, vanityName: string):
  Promise<{ ok: true; id: string; name: string } | { ok: false; reason: 'not_admin' | 'lookup_failed'; status: number }> {
  let res: Response;
  try {
    res = await fetch(`${LI_API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100`, { headers: headers(token) });
  } catch { return { ok: false, reason: 'lookup_failed', status: 0 }; }
  const body = await json(res);
  if (!res.ok || !Array.isArray(body?.elements)) return { ok: false, reason: 'lookup_failed', status: res.status };
  const ids = (body!.elements as Record<string, unknown>[])
    .map((e) => String(e.organization ?? e.organizationTarget ?? ''))
    .map((urn) => /^urn:li:organization:(\d+)$/.exec(urn)?.[1])
    .filter((id): id is string => Boolean(id));
  for (const id of ids) {
    let org: Response;
    try { org = await fetch(`${LI_API}/organizations/${id}`, { headers: headers(token) }); } catch { return { ok: false, reason: 'lookup_failed', status: 0 }; }
    const o = await json(org);
    if (!org.ok) return { ok: false, reason: 'lookup_failed', status: org.status };
    if (String(o?.vanityName ?? '').toLowerCase() === vanityName.toLowerCase()) return { ok: true, id, name: String(o?.localizedName ?? vanityName) };
  }
  return { ok: false, reason: 'not_admin', status: res.status };
}

const RESERVED = /[|{}@[\]()<>#\\*_~]/g;
const escapeLittle = (s: string) => s.replace(RESERVED, (c) => `\\${c}`);

/**
 * Commentary is LinkedIn's "little" format: every reserved character is
 * escaped so the text appears as typed. A hashtag (a # at the start or after
 * whitespace, then letters, digits or _) becomes the hashtag template so it
 * stays clickable; a # anywhere else (inside a link) is plain text.
 */
export function toLittleText(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = m.index! + m[1].length;
    out += escapeLittle(text.slice(last, start)) + `{hashtag|\\#|${escapeLittle(m[2])}}`;
    last = start + 1 + m[2].length;
  }
  return out + escapeLittle(text.slice(last));
}

interface LiState { li: 1; images: string[]; attempt: number | null }
const encodeState = (s: LiState) => JSON.stringify({ li: 1, images: s.images, attempt: s.attempt });
function decodeState(raw: string | null): LiState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LiState;
    return v && v.li === 1 && Array.isArray(v.images) ? { li: 1, images: v.images.map(String), attempt: typeof v.attempt === 'number' ? v.attempt : null } : null;
  } catch { return null; }
}

/** LinkedIn's author finder can lag behind a post it just created. */
const RECOVERY_SETTLE_SECONDS = 120;

const message = (body: Record<string, unknown> | null, status: number) => String(body?.message ?? `HTTP ${status}`).slice(0, 250);

/**
 * Maps a failed LinkedIn answer (status 0 = no answer) to a step: 401/403 is
 * an auth problem, 429 and 5xx are retried, anything else is a refusal that
 * clears the container. Callers that may already have created the post must
 * not use it for the refusal cases (see the recovery branch).
 */
function fromFailure(status: number, body: Record<string, unknown> | null): PublishStep {
  const m = message(body, status);
  if (status === 401 || status === 403) return { kind: 'auth', reason: `auth: ${m}` };
  if (status === 429) return { kind: 'retry', reason: `rate_limited: ${m}` };
  if (status === 0 || status >= 500 || status === 409) return { kind: 'retry', reason: `unavailable: ${m}` };
  if (/FIELD_LENGTH_TOO_LONG/.test(m)) return { kind: 'fail', reason: `caption_rejected: ${m}`, clearContainer: true };
  return { kind: 'fail', reason: `unknown: ${m}`, clearContainer: true };
}

async function call(url: string, init: RequestInit): Promise<{ res: Response | null; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, init);
    return { res, body: await json(res.clone()) };
  } catch { return { res: null, body: null }; }
}

/** Alt text is optional: an empty one is left out rather than sent as "". */
const altOf = (alt: string | undefined) => (alt?.trim() ? { altText: alt } : {});
const permalink = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;
const usesImage = (post: Record<string, unknown>, image: string) => {
  const content = post.content as { media?: { id?: string }; multiImage?: { images?: { id?: string }[] } } | undefined;
  return content?.media?.id === image || Boolean(content?.multiImage?.images?.some((i) => i.id === image));
};

/**
 * One step for one target. Tick 1 uploads the images (pending). Later ticks
 * wait until every image is AVAILABLE, record the attempt with checkpoint,
 * and create the post. A tick that finds an attempt already recorded did not
 * see that create call answer: it reads the Page's recent posts and records
 * the one using this post's first image, or clears the attempt and lets the
 * next tick create it.
 */
export async function linkedinPublishStep(input: PublishInput): Promise<PublishStep> {
  const { account, token, post, now, checkpoint } = input;
  const org = `urn:li:organization:${account.id}`;
  // Switched back from Buffer while a post was in flight: Buffer may already have sent it.
  const foreign = foreignState(input.state.containerId, 'li');
  if (foreign === 'started') return { kind: 'fail', reason: 'uncertain: a Buffer post may already have gone out before switching back; check the account, then retry', clearContainer: true };
  const raw = foreign === 'idle' ? null : input.state.containerId;
  const st = decodeState(raw);
  if (raw && !st) return { kind: 'fail', reason: 'unknown: unreadable LinkedIn state', clearContainer: true };
  if (post.type === 'story') return { kind: 'fail', reason: 'not_available: LinkedIn has no stories' };
  if (post.media.length === 0) return { kind: 'fail', reason: 'unknown: post has no images' };

  if (!st) {
    const images: string[] = [];
    for (const m of post.media) {
      const data = m.load ? await m.load() : null;
      if (!data) return { kind: 'retry', reason: `media_unreachable: ${m.key}` };
      const init = await call(`${LI_API}/images?action=initializeUpload`, {
        method: 'POST', headers: headers(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ initializeUploadRequest: { owner: org } }),
      });
      if (!init.res?.ok) return fromFailure(init.res?.status ?? 0, init.body);
      const value = init.body?.value as { uploadUrl?: string; image?: string } | undefined;
      if (!value?.uploadUrl || !value.image) return { kind: 'retry', reason: 'unavailable: upload without url' };
      const put = await call(value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: data.slice() });
      if (!put.res?.ok) return fromFailure(put.res?.status ?? 0, put.body);
      images.push(value.image);
    }
    return { kind: 'pending', containerId: encodeState({ li: 1, images, attempt: null }) };
  }

  if (st.attempt !== null) {
    const q = new URLSearchParams({ q: 'author', author: org, count: '20', sortBy: 'CREATED', viewContext: 'AUTHOR' });
    const found = await call(`${LI_API}/posts?${q}`, { headers: headers(token, { 'X-RestLi-Method': 'FINDER' }) });
    const fs = found.res?.status ?? 0;
    if (fs === 401 || fs === 403 || fs === 429) return fromFailure(fs, found.body);
    // Never clear the attempt on a failed read: it is the only record that a create call was sent.
    if (!found.res?.ok || !Array.isArray(found.body?.elements)) return { kind: 'retry', reason: `uncertain: ${message(found.body, fs)}` };
    const mine = (found.body!.elements as Record<string, unknown>[]).find((p) => usesImage(p, st.images[0]));
    if (mine && typeof mine.id === 'string') return { kind: 'done', remoteId: mine.id, permalink: permalink(mine.id), notes: ['recovered_published'] };
    if (now - st.attempt < RECOVERY_SETTLE_SECONDS) return { kind: 'pending', containerId: input.state.containerId! };
    return { kind: 'pending', containerId: encodeState({ ...st, attempt: null }) };
  }

  const ids = st.images.map(encodeURIComponent).join(',');
  // The Posts docs require BATCH_GET for ids=List(...); the Images sample omits it. Sending it is harmless either way.
  const status = await call(`${LI_API}/images?ids=List(${ids})`, { headers: headers(token, { 'X-RestLi-Method': 'BATCH_GET' }) });
  if (!status.res?.ok) return fromFailure(status.res?.status ?? 0, status.body);
  const results = (status.body?.results ?? {}) as Record<string, { status?: string }>;
  const states = st.images.map((id) => results[id]?.status);
  if (states.includes('PROCESSING_FAILED')) return { kind: 'fail', reason: 'image_format: LinkedIn could not process an image', clearContainer: true };
  if (!states.every((s) => s === 'AVAILABLE')) return { kind: 'pending', containerId: input.state.containerId! };

  if (!await checkpoint(encodeState({ ...st, attempt: now }))) return { kind: 'pending', containerId: input.state.containerId! };
  const content = st.images.length === 1
    ? { media: { id: st.images[0], ...altOf(post.media[0]?.alt) } }
    : { multiImage: { images: st.images.map((id, i) => ({ id, ...altOf(post.media[i]?.alt) })) } };
  const created = await call(`${LI_API}/posts`, {
    method: 'POST', headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      author: org, commentary: toLittleText(post.caption), visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    }),
  });
  if (created.res?.status === 201) {
    const urn = created.res.headers.get('x-restli-id');
    return urn ? { kind: 'done', remoteId: urn, permalink: permalink(urn) } : { kind: 'done', remoteId: null, permalink: null };
  }
  if (created.res?.ok) return { kind: 'retry', reason: `uncertain: unexpected ${created.res.status} from LinkedIn` };
  return fromFailure(created.res?.status ?? 0, created.body);
}
