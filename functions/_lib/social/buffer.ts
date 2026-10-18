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
/** Status reads after a create: 1, 2, 5, 10 and then every 20 minutes, within the dispatcher's two-hour window. */
export const POLL_BACKOFF = [60, 120, 300, 600, 1200];
/** A create whose answer was lost: how long the post list is given to show it before the create is sent again. */
const RECOVERY_SETTLE_SECONDS = 120;
/** Under this share left in any rate-limit window, no new post is created (spec §5). */
export const RATE_LOW = 0.1;
/** X takes up to four images in one post. */
const X_MAX_IMAGES = 4;

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
  /** status 0: no answer. code: Buffer's errors[0].extensions.code, if any. */
  | { ok: false; status: number; code: string | null; message: string };

/** One GraphQL call. Never throws, and never puts the key in a message. */
export async function bufferGraphql(token: string, query: string, variables: Record<string, unknown> = {}, now = Math.floor(Date.now() / 1000)): Promise<GqlResult> {
  let res: Response;
  try {
    res = await fetch(BUFFER_API, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables }),
    });
  } catch { return { ok: false, status: 0, code: null, message: 'no answer from Buffer' }; }
  const share = lowestShare(parseRateLimit(res.headers.get('ratelimit'), res.headers.get('ratelimit-policy')));
  if (share !== null) lastShare = { share, at: now };
  const body = await res.json().catch(() => null) as { data?: Record<string, unknown> | null; errors?: { message?: string; extensions?: { code?: string } }[] } | null;
  const first = body?.errors?.[0];
  if (!res.ok || first || !body?.data) {
    return { ok: false, status: res.status, code: first?.extensions?.code ?? null, message: String(first?.message ?? `HTTP ${res.status}`).slice(0, 250) };
  }
  return { ok: true, data: body.data };
}

/** A failed call as a step. Whether a create may have gone out is the caller's question (see the step). */
function fromFailure(r: Extract<GqlResult, { ok: false }>, created: 'no' | 'maybe'): PublishStep {
  const m = r.message;
  if (r.status === 401 || r.code === 'UNAUTHORIZED' || r.code === 'UNAUTHENTICATED' || r.code === 'FORBIDDEN') return { kind: 'auth', reason: `auth: ${m}` };
  if (r.status === 429 || r.code === 'RATE_LIMIT_EXCEEDED') return { kind: 'retry', reason: `rate_limited: ${m}`, clearContainer: created === 'no' };
  if (r.status === 0 || r.status >= 500) return { kind: 'retry', reason: `unavailable: ${m}` };
  // A refused query (a schema change, a bad id): nothing was created.
  return created === 'no' ? { kind: 'fail', reason: `unknown: ${m}`, clearContainer: true } : { kind: 'retry', reason: `uncertain: ${m}` };
}

interface BufState { buf: 1; attempt: number | null; postId: string | null; next: number; polls: number }
const encodeState = (s: Omit<BufState, 'buf'>) => JSON.stringify({ buf: 1, attempt: s.attempt, postId: s.postId, next: s.next, polls: s.polls });
export function decodeBufferState(raw: string | null): BufState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as BufState;
    if (!v || v.buf !== 1) return null;
    return {
      buf: 1, attempt: typeof v.attempt === 'number' ? v.attempt : null, postId: typeof v.postId === 'string' ? v.postId : null,
      next: typeof v.next === 'number' ? v.next : 0, polls: typeof v.polls === 'number' ? v.polls : 0,
    };
  } catch { return null; }
}

const waitFor = (postId: string, now: number, polls: number, notes?: string[]): PublishStep =>
  ({ kind: 'pending', containerId: encodeState({ attempt: null, postId, next: now + POLL_BACKOFF[Math.min(polls, POLL_BACKOFF.length - 1)], polls }), ...(notes ? { notes } : {}) });

const CREATE = `mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id } }
    ... on MutationError { message }
  }
}`;

/**
 * The channel's latest posts, newest first, looking for ours: same text,
 * created no earlier than the attempt (with a few minutes for clock skew).
 */
async function findCreated(token: string, org: string, channelId: string, caption: string, since: number, now: number): Promise<{ ok: true; id: string | null } | { ok: false; failure: Extract<GqlResult, { ok: false }> }> {
  const r = await bufferGraphql(token, `query Recent {
  posts(input: { organizationId: ${JSON.stringify(org)}, sort: [{ field: createdAt, direction: desc }], filter: { channelIds: [${JSON.stringify(channelId)}] } }) {
    edges { node { id text createdAt } }
  }
}`, {}, now);
  if (!r.ok) return { ok: false, failure: r };
  const edges = ((r.data.posts as { edges?: { node?: { id?: string; text?: string; createdAt?: string } }[] } | null)?.edges ?? []);
  const mine = edges.map((e) => e.node).find((n) =>
    n?.id && (n.text ?? '').trim() === caption.trim() && (!n.createdAt || Date.parse(n.createdAt) / 1000 >= since - 300));
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
  const st = decodeBufferState(input.state.containerId);
  if (input.state.containerId && !st) return { kind: 'fail', reason: 'unknown: unreadable Buffer state', clearContainer: true };
  const org = account.org ?? null;

  if (st?.postId) {
    if (now < st.next) return { kind: 'pending', containerId: input.state.containerId! };
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
    return waitFor(st.postId, now, st.polls + 1);
  }

  if (st?.attempt != null) {
    if (!org) return { kind: 'retry', reason: 'uncertain: no Buffer organisation to look the post up in' };
    const found = await findCreated(token, org, account.id, post.caption, st.attempt, now);
    if (!found.ok) return fromFailure(found.failure, 'maybe');
    if (found.id) return waitFor(found.id, now, 0, ['recovered_created']);
    if (now - st.attempt < RECOVERY_SETTLE_SECONDS) return { kind: 'pending', containerId: input.state.containerId! };
    return { kind: 'pending', containerId: encodeState({ attempt: null, postId: null, next: 0, polls: 0 }) };
  }

  if (post.type === 'story') return { kind: 'fail', reason: 'not_available: stories do not go through Buffer' };
  if (post.media.length === 0) return { kind: 'fail', reason: 'unknown: post has no images' };
  if (platform === 'x' && post.media.length > X_MAX_IMAGES) return { kind: 'fail', reason: `carousel_count: X takes up to ${X_MAX_IMAGES} images` };
  if (lastShare && now - lastShare.at < 900 && lastShare.share < RATE_LOW) {
    return { kind: 'retry', reason: 'rate_limited: rate_low, under 10% of the Buffer request quota left' };
  }

  // Lease lost: another tick owns the target now, and this answer is never written.
  if (!await checkpoint(encodeState({ attempt: now, postId: null, next: 0, polls: 0 }))) return { kind: 'retry', reason: 'uncertain: lease lost before the create' };
  const created = await bufferGraphql(token, CREATE, {
    input: {
      channelId: account.id, text: post.caption, schedulingType: 'automatic', mode: 'shareNow',
      assets: post.media.map((m) => ({ image: { url: m.url, metadata: { altText: m.alt } } })),
    },
  }, now);
  if (!created.ok) return fromFailure(created, created.status === 0 || created.status >= 500 ? 'maybe' : 'no');
  const c = created.data.createPost as { __typename?: string; post?: { id?: string }; message?: string } | null;
  if (c?.post?.id) return waitFor(c.post.id, now, 0);
  const message = String(c?.message ?? 'no answer').slice(0, 250);
  if (c?.__typename === 'DuplicateError') {
    // Buffer saw this text before: maybe our lost create, maybe a deleted copy (a known Buffer bug). Only the list tells.
    if (!org) return { kind: 'fail', reason: `duplicate: ${message}`, clearContainer: true };
    const found = await findCreated(token, org, account.id, post.caption, now - 3 * 3600, now);
    if (found.ok && found.id) return waitFor(found.id, now, 0, ['recovered_duplicate']);
    if (!found.ok) return { kind: 'retry', reason: `uncertain: ${found.failure.message}` };
    return { kind: 'fail', reason: `duplicate: ${message}`, clearContainer: true };
  }
  if (c?.__typename === 'LimitReachedError') return { kind: 'fail', reason: `limit: ${message}`, clearContainer: true };
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

/** (live) The spelling of service and type: LinkedIn Pages only (never a member's profile); X may be called twitter. */
export function channelFits(platform: 'linkedin' | 'x', c: BufferChannel): boolean {
  if (platform === 'linkedin') return c.service === 'linkedin' && c.type === 'page';
  return c.service === 'twitter' || c.service === 'x';
}
