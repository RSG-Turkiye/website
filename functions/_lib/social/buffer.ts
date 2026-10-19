/**
 * Buffer as the transport for LinkedIn and X (spec 2026-10-19): the panel
 * still decides what goes out and when; at the scheduled minute the post is
 * handed to Buffer with "share now", and later ticks read back whether it
 * went out. One GraphQL endpoint, one account-wide key (the BUFFER_API_KEY
 * secret). Buffer fetches the images itself from their public URLs.
 *
 * Items marked (live) in the spec were not on Buffer's reference page and are
 * read defensively here: the PostStatus values beyond "sent", and the exact
 * spelling of a channel's service and type.
 */
import type { PublishInput, PublishStep } from './types';
import type { SocialPlatform } from '../social-limits';

export const BUFFER_API = 'https://api.buffer.com';
/** Status reads after a create: 1, 2, 5, 10, 20 and then every 30 minutes; about six reads in the dispatcher's two-hour window (spec §5). */
export const POLL_BACKOFF = [60, 120, 300, 600, 1200, 1800];
/**
 * A create whose answer was lost: how long the post list is given to show it
 * before the create is sent again. Generous on purpose: a second copy on the
 * Page is worse than a post going out a few minutes late.
 */
export const RECOVERY_SETTLE_SECONDS = 10 * 60;
/** Every Buffer call gives up after this, so one slow answer cannot hold a tick past its lease. */
const TIMEOUT_MS = 20_000;
/** Under this share left in any rate-limit window, no new post is created (spec §5). */
export const RATE_LOW = 0.1;
/** X takes up to four images in one post. */
const X_MAX_IMAGES = 4;
/** An Instagram carousel takes up to ten. */
const IG_MAX_IMAGES = 10;

export interface RateWindow { name: string; remaining: number; quota: number | null }

/**
 * Buffer sends one RateLimit and one RateLimit-Policy entry per window
 * (15 min, a day, 30 days); fetch joins repeated headers with ", ". The quota
 * is the policy's q, or the number the policy name starts with.
 */
export function parseRateLimit(rate: string | null, policy: string | null): RateWindow[] {
  const entries = (h: string | null) => (h ?? '').split(/,\s*(?=")/).map((s) => s.trim()).filter(Boolean);
  const quotas = new Map<string, number>();
  for (const p of entries(policy)) {
    const name = p.match(/^"([^"]+)"/)?.[1];
    const q = p.match(/;\s*q=(\d+)/)?.[1];
    if (name && q) quotas.set(name, Number(q));
  }
  const out: RateWindow[] = [];
  for (const r of entries(rate)) {
    const name = r.match(/^"([^"]+)"/)?.[1];
    const left = r.match(/;\s*r=(\d+)/)?.[1];
    if (!name || left === undefined) continue;
    const lead = name.match(/^(\d+)-/)?.[1];
    out.push({ name, remaining: Number(left), quota: quotas.get(name) ?? (lead ? Number(lead) : null) });
  }
  return out;
}

/** The smallest share left across the windows, or null when Buffer sent none. */
export function lowestShare(windows: RateWindow[]): number | null {
  const shares = windows.filter((w) => w.quota).map((w) => w.remaining / w.quota!);
  return shares.length ? Math.min(...shares) : null;
}

/**
 * The last share seen, per isolate. A best effort: a fresh isolate starts
 * without one and finds out on its first answer, which is at worst one
 * create too many inside a window Buffer still enforces itself.
 */
let lastShare: { share: number; at: number } | null = null;
export const resetRateMemory = () => { lastShare = null; };

export type GqlResult =
  | { ok: true; data: Record<string, unknown> }
  /** status 0: no answer. code: Buffer's errors[0].extensions.code, if any. data: whatever came back alongside the errors. */
  | { ok: false; status: number; code: string | null; message: string; data?: Record<string, unknown> | null };

/** One GraphQL call. Never throws, and never puts the key in a message. */
export async function bufferGraphql(token: string, query: string, variables: Record<string, unknown> = {}, now = Math.floor(Date.now() / 1000)): Promise<GqlResult> {
  let res: Response;
  try {
    res = await fetch(BUFFER_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch { return { ok: false, status: 0, code: null, message: 'no answer from Buffer' }; }
  const share = lowestShare(parseRateLimit(res.headers.get('ratelimit'), res.headers.get('ratelimit-policy')));
  if (share !== null) lastShare = { share, at: now };
  const body = await res.json().catch(() => null) as { data?: Record<string, unknown> | null; errors?: { message?: string; extensions?: { code?: string } }[] } | null;
  const first = body?.errors?.[0];
  if (!res.ok || first || !body?.data) {
    return { ok: false, status: res.status, code: first?.extensions?.code ?? null, message: String(first?.message ?? `HTTP ${res.status}`).slice(0, 250), data: body?.data ?? null };
  }
  return { ok: true, data: body.data };
}

const AUTH_CODES = new Set(['UNAUTHORIZED', 'UNAUTHENTICATED', 'FORBIDDEN']);
/** The key was refused. Shared by the publish step, the connect endpoint and the daily check, so they agree. */
export const isAuthFailure = (r: Extract<GqlResult, { ok: false }>) => r.status === 401 || r.status === 403 || AUTH_CODES.has(r.code ?? '');
const isRateLimited = (r: Extract<GqlResult, { ok: false }>) => r.status === 429 || r.code === 'RATE_LIMIT_EXCEEDED';
/** Codes for a request refused before it ran (Apollo-style); with a 4xx, the only proof that a create did not happen. */
const NEVER_RAN = new Set(['BAD_USER_INPUT', 'GRAPHQL_VALIDATION_FAILED', 'GRAPHQL_PARSE_FAILED']);

/**
 * Whether a failed create call provably created nothing: a 4xx, a refused
 * key or rate limit, or a query refused before it ran. A 200 carrying
 * errors, an unreadable body, a 5xx or no answer at all may hide a post that
 * exists, so the attempt is kept for the recovery read.
 */
export function createNeverRan(r: Extract<GqlResult, { ok: false }>): boolean {
  return (r.status >= 400 && r.status < 500) || isAuthFailure(r) || isRateLimited(r) || NEVER_RAN.has(r.code ?? '');
}

/** A failed call as a step. created: whether the call may have created a post (see createNeverRan). */
function fromFailure(r: Extract<GqlResult, { ok: false }>, created: 'no' | 'maybe'): PublishStep {
  const m = r.message;
  if (isAuthFailure(r)) return { kind: 'auth', reason: `auth: ${m}` };
  if (isRateLimited(r)) return { kind: 'retry', reason: `rate_limited: ${m}`, clearContainer: created === 'no' };
  if (r.status === 0 || r.status >= 500) return { kind: 'retry', reason: `unavailable: ${m}` };
  // A refused query (a schema change, a bad id): nothing was created.
  return created === 'no' ? { kind: 'fail', reason: `unknown: ${m}`, clearContainer: true } : { kind: 'retry', reason: `uncertain: ${m}` };
}

/**
 * first: when the first create for this target was sent, kept when an
 * attempt is cleared, so every later look-up searches back to it.
 */
interface BufState { buf: 1; attempt: number | null; first: number | null; postId: string | null; next: number; polls: number }
type StateFields = Omit<BufState, 'buf'>;
const encodeState = (s: StateFields) => JSON.stringify({ buf: 1, attempt: s.attempt, first: s.first, postId: s.postId, next: s.next, polls: s.polls });
const num = (v: unknown) => (typeof v === 'number' ? v : null);
export function decodeBufferState(raw: string | null): BufState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown>;
    if (!v || v.buf !== 1) return null;
    return {
      buf: 1, attempt: num(v.attempt), first: num(v.first) ?? num(v.attempt), postId: typeof v.postId === 'string' ? v.postId : null,
      next: num(v.next) ?? 0, polls: num(v.polls) ?? 0,
    };
  } catch { return null; }
}

/**
 * Another adapter's state on this target (the connection was switched while
 * a post was in flight): 'idle' when it never sent a create, 'started' when it
 * may have. null when the state is not another adapter's.
 */
export function foreignState(raw: string | null, own: 'buf' | 'li' | 'x' | 'ig'): 'idle' | 'started' | null {
  if (!raw) return null;
  let v: Record<string, unknown>;
  try { v = JSON.parse(raw) as Record<string, unknown>; } catch { return null; }
  if (!v || typeof v !== 'object') return null;
  const marker = (['buf', 'li', 'x'] as const).find((k) => v[k] === 1);
  // Instagram's own state is a bare container id, never JSON, so 'ig' has no marker.
  if (!marker || marker === own) return null;
  return typeof v.attempt === 'number' || typeof v.postId === 'string' ? 'started' : 'idle';
}

const waitFor = (st: Pick<StateFields, 'first'>, postId: string, now: number, polls: number, notes?: string[]): PublishStep =>
  ({ kind: 'pending', containerId: encodeState({ attempt: null, first: st.first, postId, next: now + POLL_BACKOFF[Math.min(polls, POLL_BACKOFF.length - 1)], polls }), ...(notes ? { notes } : {}) });

/**
 * The concrete error types are the ones Buffer's error guide shows on
 * createPost; any other error (DuplicateError among them) still answers
 * through the MutationError interface, routed by __typename. A fragment on a
 * type outside the payload union would make the whole mutation invalid.
 */
const CREATE = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id } }
    ... on LimitReachedError { message }
    ... on InvalidInputError { message }
    ... on MutationError { message }
  }
}`;

/** Text up to its first link, whitespace collapsed: Buffer may shorten or rewrite links (live). */
export function comparableText(text: string): string {
  const flat = (t: string) => t.replace(/\s+/g, ' ').trim();
  const head = flat(text.split(/https?:\/\//)[0]);
  return head || flat(text);
}

/** Buffer's clock and ours may differ a little; a post created this much "before" the attempt still counts. */
const CLOCK_SKEW = 120;

/**
 * The channel's latest posts, newest first, looking for ours: the same text
 * (up to the first link) and created at or after our first attempt. A post
 * without createdAt is never taken as ours.
 * (live) Whether `posts` lists posts that were already sent, and whether
 * Buffer keeps the text unchanged, are checked in the first live test.
 */
async function findCreated(token: string, org: string, channelId: string, caption: string, since: number, now: number): Promise<{ ok: true; id: string | null } | { ok: false; failure: Extract<GqlResult, { ok: false }> }> {
  const r = await bufferGraphql(token, `query Recent {
  posts(input: { organizationId: ${JSON.stringify(org)}, sort: [{ field: createdAt, direction: desc }], filter: { channelIds: [${JSON.stringify(channelId)}] } }) {
    edges { node { id text createdAt } }
  }
}`, {}, now);
  if (!r.ok) return { ok: false, failure: r };
  const edges = ((r.data.posts as { edges?: { node?: { id?: string; text?: string; createdAt?: string } }[] } | null)?.edges ?? []);
  const want = comparableText(caption);
  const mine = edges.map((e) => e.node).find((n) => {
    if (!n?.id || !n.createdAt) return false;
    const at = Date.parse(n.createdAt) / 1000;
    return Number.isFinite(at) && at >= since - CLOCK_SKEW && comparableText(n.text ?? '') === want;
  });
  return { ok: true, id: mine?.id ?? null };
}

/**
 * One step for one target (spec §5). Tick 1 records the attempt with
 * checkpoint and asks Buffer to share now; Buffer's post id is kept and
 * read back on a backoff until it is sent or refused. A tick that finds an
 * attempt but no post id did not see the create answer: it looks for the
 * post in the channel's list, and only after RECOVERY_SETTLE_SECONDS without
 * it clears the attempt so the next tick creates again. A failed read never
 * clears it: it is the only record that a create was sent.
 */
export async function bufferPublishStep(input: PublishInput): Promise<PublishStep> {
  const { account, token, post, now, checkpoint } = input;
  const platform: SocialPlatform | null = input.platform ?? null;
  // Instagram's direct state is a bare container id. Nothing records whether media_publish was
  // already called for it (a lost answer keeps the container), and without the Instagram token
  // its status cannot be read here, so it is never taken as proof that nothing went out.
  if (input.state.containerId && !input.state.containerId.startsWith('{')) {
    return { kind: 'fail', reason: 'uncertain: an Instagram container from the direct connection may already have been published before switching to Buffer; check the account, then retry', clearContainer: true };
  }
  const foreign = foreignState(input.state.containerId, 'buf');
  if (foreign === 'started') {
    return { kind: 'fail', reason: 'uncertain: a direct create may already have gone out before switching to Buffer; check the account, then retry', clearContainer: true };
  }
  const raw = foreign === 'idle' ? null : input.state.containerId;
  const st = decodeBufferState(raw);
  if (raw && !st) return { kind: 'fail', reason: 'unknown: unreadable Buffer state', clearContainer: true };
  const org = account.org ?? null;
  const first = st?.first ?? null;

  if (st?.postId) {
    if (now < st.next) return { kind: 'pending', containerId: raw! };
    const r = await bufferGraphql(token, `query Post {
  post(input: { id: ${JSON.stringify(st.postId)} }) { id status sentAt externalLink error { message } }
}`, {}, now);
    if (!r.ok) return fromFailure(r, 'maybe');
    const p = r.data.post as { id?: string; status?: string; sentAt?: string | null; externalLink?: string | null; error?: { message?: string } | null } | null;
    if (!p) return { kind: 'fail', reason: 'buffer_refused: the post is no longer in Buffer', clearContainer: true };
    // (live) Only "sent" is confirmed by Buffer's examples; an error, or a status naming one, is Buffer giving up.
    const status = String(p.status ?? '').toLowerCase();
    if (p.error?.message || status === 'error' || status === 'failed') {
      return { kind: 'fail', reason: `buffer_refused: ${String(p.error?.message ?? status).slice(0, 250)}`, clearContainer: true };
    }
    if (status === 'sent' || p.sentAt) {
      return p.externalLink
        ? { kind: 'done', remoteId: st.postId, permalink: p.externalLink }
        : { kind: 'done', remoteId: st.postId, permalink: null, notes: ['no_link'] };
    }
    return waitFor(st, st.postId, now, st.polls + 1);
  }

  if (st?.attempt != null) {
    if (!org) return { kind: 'retry', reason: 'uncertain: no Buffer organisation to look the post up in' };
    const found = await findCreated(token, org, account.id, post.caption, first ?? st.attempt, now);
    if (!found.ok) return fromFailure(found.failure, 'maybe');
    if (found.id) return waitFor(st, found.id, now, 0, ['recovered_created']);
    if (now - st.attempt < RECOVERY_SETTLE_SECONDS) return { kind: 'pending', containerId: raw! };
    return { kind: 'pending', containerId: encodeState({ attempt: null, first, postId: null, next: 0, polls: 0 }) };
  }

  const instagram = platform === 'instagram';
  if (post.type === 'story' && !instagram) return { kind: 'fail', reason: 'not_available: stories do not go through Buffer' };
  if (post.media.length === 0) return { kind: 'fail', reason: 'unknown: post has no images' };
  if (platform === 'x' && post.media.length > X_MAX_IMAGES) return { kind: 'fail', reason: `carousel_count: X takes up to ${X_MAX_IMAGES} images` };
  if (instagram && post.media.length > IG_MAX_IMAGES) return { kind: 'fail', reason: `carousel_count: Instagram takes up to ${IG_MAX_IMAGES} images` };
  // A story is one image; a plain image post one; a carousel all of them.
  const media = instagram && post.type !== 'carousel' ? post.media.slice(0, 1) : post.media;
  if (lastShare && now - lastShare.at < 900 && lastShare.share < RATE_LOW) {
    return { kind: 'retry', reason: 'rate_limited: rate_low, under 10% of the Buffer request quota left' };
  }

  const sent = { first: first ?? now };
  // Lease lost: another tick owns the target now, and this answer is never written.
  if (!await checkpoint(encodeState({ attempt: now, first: sent.first, postId: null, next: 0, polls: 0 }))) return { kind: 'retry', reason: 'uncertain: lease lost before the create' };
  const created = await bufferGraphql(token, CREATE, {
    input: {
      channelId: account.id, text: post.caption, schedulingType: 'automatic', mode: 'shareNow',
      assets: media.map((m) => ({ image: { url: m.url, metadata: { altText: m.alt } } })),
      // InstagramPostMetadataInput. (live) Whether Buffer publishes a story and a carousel by itself
      // through the API, rather than as a reminder to post from the phone, is checked in the first live test.
      ...(instagram ? { metadata: { instagram: { type: post.type === 'story' ? 'story' : 'post', shouldShareToFeed: true } } } : {}),
    },
  }, now);
  const c = created.data?.createPost as { __typename?: string; post?: { id?: string }; message?: string } | null | undefined;
  // A post id is followed even when errors came with it: the post exists.
  if (c?.post?.id) return waitFor(sent, c.post.id, now, 0);
  if (!created.ok) return fromFailure(created, createNeverRan(created) ? 'no' : 'maybe');
  const message = String(c?.message ?? 'no answer').slice(0, 250);
  if (c?.__typename === 'DuplicateError' || (!c?.__typename?.startsWith('Limit') && /duplicate/i.test(message))) {
    // Buffer saw this text before: maybe our lost create, maybe a deleted copy (a known Buffer bug). Only the list tells.
    if (!org) return { kind: 'fail', reason: `duplicate: ${message}`, clearContainer: true };
    const found = await findCreated(token, org, account.id, post.caption, sent.first, now);
    if (found.ok && found.id) return waitFor(sent, found.id, now, 0, ['recovered_duplicate']);
    if (!found.ok) return { kind: 'retry', reason: `uncertain: ${found.failure.message}` };
    return { kind: 'fail', reason: `duplicate: ${message}`, clearContainer: true };
  }
  if (c?.__typename === 'LimitReachedError') return { kind: 'fail', reason: `limit: ${message}`, clearContainer: true };
  if (!c) return { kind: 'retry', reason: 'uncertain: Buffer answered without a createPost result' };
  return { kind: 'fail', reason: `buffer_refused: ${message}`, clearContainer: true };
}

export interface BufferChannel {
  id: string;
  name: string;
  service: string;
  type: string;
  organizationId: string;
  isDisconnected: boolean;
  isLocked: boolean;
}

/** Every channel in every organisation the key can see. */
export async function listBufferChannels(token: string): Promise<{ ok: true; channels: BufferChannel[] } | Extract<GqlResult, { ok: false }>> {
  const orgs = await bufferGraphql(token, 'query Orgs { account { organizations { id } } }');
  if (!orgs.ok) return orgs;
  const ids = ((orgs.data.account as { organizations?: { id?: string }[] } | null)?.organizations ?? []).map((o) => o.id).filter((id): id is string => Boolean(id));
  const channels: BufferChannel[] = [];
  for (const org of ids) {
    const r = await bufferGraphql(token, `query Channels {
  channels(input: { organizationId: ${JSON.stringify(org)} }) { id name displayName service type isDisconnected isLocked }
}`);
    if (!r.ok) return r;
    for (const c of (r.data.channels as Record<string, unknown>[] | null) ?? []) {
      if (typeof c.id !== 'string') continue;
      channels.push({
        id: c.id, name: String(c.displayName || c.name || c.id), service: String(c.service ?? '').toLowerCase(), type: String(c.type ?? '').toLowerCase(),
        organizationId: org, isDisconnected: c.isDisconnected === true, isLocked: c.isLocked === true,
      });
    }
  }
  return { ok: true, channels };
}

/** A channel Buffer cannot post to until someone fixes it in Buffer. */
export const channelUsable = (c: BufferChannel) => !c.isDisconnected && !c.isLocked;

/** (live) The spelling of service and type: LinkedIn Pages only (never a member's profile); X may be called twitter; Instagram professional accounts only. */
export function channelFits(platform: 'linkedin' | 'x' | 'instagram', c: BufferChannel): boolean {
  if (platform === 'linkedin') return c.service === 'linkedin' && c.type === 'page';
  // Buffer shows @rsgturkey as an "Instagram Professional Account"; a personal account cannot be posted to.
  if (platform === 'instagram') return c.service === 'instagram' && ['business', 'professional', 'creator'].includes(c.type);
  return c.service === 'twitter' || c.service === 'x';
}
