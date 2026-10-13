/**
 * The rules for a social post: what a draft may look like, what makes it
 * ready to go out, who may change it, and the guarded statements every change
 * is written with. Pure apart from mediaDims, which reads the server's own
 * record of image sizes.
 */
import {
  ALL_PLATFORMS, ENABLED_PLATFORMS, POST_TYPES, CAROUSEL_MIN_ITEMS, CAROUSEL_MAX_ITEMS, MAX_ALT_LENGTH,
  ratioOk, captionProblems, type PostType, type SocialPlatform,
} from './social-limits';
import { validateScheduledAt } from './schedule';
import { IMAGE_KEY } from './images';

export type PostStatus =
  | 'draft' | 'pending_approval' | 'scheduled' | 'published' | 'partially_published' | 'failed' | 'rejected' | 'cancelled';
/** Nobody edits these: they record what already happened, or what was abandoned. */
export const LOCKED_STATUSES: PostStatus[] = ['published', 'partially_published', 'failed', 'cancelled'];

const MAX_CAPTION_STORED = 5000;
const MAX_LINK = 2048;

/**
 * Where an image came from when it was cropped or fitted in the panel: the
 * uploaded original and the area of it that was used (original pixels). The
 * panel re-opens the cropper from the original, so a crop can be undone later.
 */
export interface MediaSource { key: string; mode: 'crop' | 'fit'; x: number; y: number; w: number; h: number }
export interface MediaRef { key: string; alt: string; source?: MediaSource }

/** Larger than any upload (the client shrinks to 2000px); a bound, not a rule. */
const MAX_SOURCE_PX = 20000;

/** The one link rule, shared with the panel so it can hold autosave until a link is whole. */
export function linkOk(link: string): boolean {
  if (link.length > MAX_LINK || !link.startsWith('https://')) return false;
  try { new URL(link); return true; } catch { return false; }
}

function parseSource(v: unknown): MediaSource | null | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object' || Array.isArray(v)) return null;
  const { key, mode, x, y, w, h } = v as Record<string, unknown>;
  if (typeof key !== 'string' || !IMAGE_KEY.test(key)) return null;
  if (mode !== 'crop' && mode !== 'fit') return null;
  const px = (n: unknown, min: number) => typeof n === 'number' && Number.isSafeInteger(n) && n >= min && n <= MAX_SOURCE_PX;
  if (!px(x, 0) || !px(y, 0) || !px(w, 1) || !px(h, 1)) return null;
  return { key, mode, x: x as number, y: y as number, w: w as number, h: h as number };
}

export interface DraftInput {
  type: PostType;
  caption: string;
  captionOverrides: Partial<Record<SocialPlatform, string>>;
  link: string | null;
  media: MediaRef[];
  platforms: SocialPlatform[];
  scheduledAt: number | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: string };
const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });
const isPlatform = (v: unknown): v is SocialPlatform => typeof v === 'string' && (ALL_PLATFORMS as string[]).includes(v);

/** Shape only. A draft may be incomplete; readinessProblems decides whether it can go out. */
export function parseDraft(body: Record<string, unknown>): Parsed<DraftInput> {
  const type = body.type;
  if (typeof type !== 'string' || !(POST_TYPES as string[]).includes(type)) return fail('invalid_type');

  const caption = body.caption ?? '';
  if (typeof caption !== 'string' || caption.length > MAX_CAPTION_STORED) return fail('invalid_caption');

  const rawOverrides = body.captionOverrides ?? {};
  if (rawOverrides === null || typeof rawOverrides !== 'object' || Array.isArray(rawOverrides)) return fail('invalid_overrides');
  const captionOverrides: Partial<Record<SocialPlatform, string>> = {};
  for (const [k, v] of Object.entries(rawOverrides)) {
    if (!isPlatform(k) || typeof v !== 'string' || v.length > MAX_CAPTION_STORED) return fail('invalid_overrides');
    captionOverrides[k] = v;
  }

  let link: string | null = null;
  if (body.link !== undefined && body.link !== null && body.link !== '') {
    if (typeof body.link !== 'string' || !linkOk(body.link)) return fail('invalid_link');
    link = body.link;
  }

  const rawMedia = body.media ?? [];
  if (!Array.isArray(rawMedia)) return fail('invalid_media');
  if (rawMedia.length > CAROUSEL_MAX_ITEMS) return fail('too_many_items');
  const media: MediaRef[] = [];
  for (const m of rawMedia) {
    if (m === null || typeof m !== 'object') return fail('invalid_media');
    const { key, alt, source: rawSource } = m as { key?: unknown; alt?: unknown; source?: unknown };
    if (typeof key !== 'string' || !IMAGE_KEY.test(key)) return fail('invalid_media');
    if (typeof alt !== 'string' || alt.length > MAX_ALT_LENGTH) return fail('invalid_media');
    const source = parseSource(rawSource);
    if (source === null) return fail('invalid_media');
    media.push(source ? { key, alt, source } : { key, alt });
  }

  const rawPlatforms = body.platforms ?? [];
  if (!Array.isArray(rawPlatforms) || !rawPlatforms.every(isPlatform) || new Set(rawPlatforms).size !== rawPlatforms.length) {
    return fail('invalid_platforms');
  }

  const scheduledAt = body.scheduledAt ?? null;
  if (scheduledAt !== null && (typeof scheduledAt !== 'number' || !Number.isSafeInteger(scheduledAt) || scheduledAt < 0)) {
    return fail('invalid_schedule');
  }

  return { ok: true, value: { type: type as PostType, caption, captionOverrides, link, media, platforms: rawPlatforms, scheduledAt } };
}

export type Problem = { code: string; index?: number; platform?: SocialPlatform; limit?: number; actual?: number };

/** Sizes as the upload endpoint measured them. Keys never uploaded are simply absent. */
export async function mediaDims(db: D1Database, keys: string[]): Promise<Map<string, { width: number; height: number }>> {
  const out = new Map<string, { width: number; height: number }>();
  if (keys.length === 0) return out;
  const rows = (await db.prepare(
    `SELECT key, width, height FROM social_media WHERE key IN (${keys.map(() => '?').join(',')})`,
  ).bind(...keys).all<{ key: string; width: number; height: number }>()).results;
  for (const r of rows) out.set(r.key, { width: r.width, height: r.height });
  return out;
}

/** Everything that stops a post from being submitted or approved. Empty means ready. */
export function readinessProblems(post: DraftInput, dims: Map<string, { width: number; height: number }>, now: number): Problem[] {
  const problems: Problem[] = [];
  if (post.platforms.length === 0) problems.push({ code: 'no_platform' });
  for (const platform of post.platforms) {
    if (!ENABLED_PLATFORMS.includes(platform)) problems.push({ code: 'platform_unavailable', platform });
  }
  if (post.type === 'story' && post.platforms.some((p) => p !== 'instagram')) problems.push({ code: 'story_instagram_only' });

  const n = post.media.length;
  const countOk = post.type === 'carousel' ? n >= CAROUSEL_MIN_ITEMS && n <= CAROUSEL_MAX_ITEMS : n === 1;
  if (!countOk) problems.push({ code: 'media_count', actual: n });

  post.media.forEach((m, index) => {
    if (m.alt.trim() === '') problems.push({ code: 'missing_alt', index });
    const d = dims.get(m.key);
    if (!d) problems.push({ code: 'unknown_media', index });
    else if (!ratioOk(post.type, d.width, d.height)) problems.push({ code: 'bad_ratio', index });
  });

  const enabled = post.platforms.filter((p) => ENABLED_PLATFORMS.includes(p));
  for (const p of captionProblems(post, enabled, post.type)) problems.push(p);

  if (post.scheduledAt === null) problems.push({ code: 'no_schedule' });
  else {
    const v = validateScheduledAt(post.scheduledAt, now);
    if (!v.ok) problems.push({ code: v.code });
  }
  return problems;
}

export interface Actor { id: string; isPublisher: boolean }
type Owned = { status: PostStatus; created_by: string };

export function canEditPost(actor: Actor, post: Owned): boolean {
  if (LOCKED_STATUSES.includes(post.status)) return false;
  return actor.isPublisher || post.created_by === actor.id;
}

export function canDeletePost(actor: Actor, post: Owned): boolean {
  return (post.status === 'draft' || post.status === 'rejected') && (actor.isPublisher || post.created_by === actor.id);
}

export function canCancelPost(actor: Actor, post: Owned): boolean {
  return (post.status === 'pending_approval' || post.status === 'scheduled') && (actor.isPublisher || post.created_by === actor.id);
}

/**
 * An editor changing a post that was approved sends it back for approval;
 * a publisher's change, or a story inside an event window that covers the
 * editor, keeps it scheduled. A rejected post becomes a draft again.
 */
export function statusAfterEdit(actor: Actor, current: PostStatus, storyCovered: boolean): PostStatus {
  if (current === 'rejected') return 'draft';
  if (current === 'scheduled' && !actor.isPublisher && !storyCovered) return 'pending_approval';
  return current;
}

export function statusOnSubmit(actor: Actor, storyCovered: boolean): 'scheduled' | 'pending_approval' {
  return actor.isPublisher || storyCovered ? 'scheduled' : 'pending_approval';
}

export interface PostRow {
  id: string;
  type: PostType;
  caption: string;
  caption_overrides: string;
  link: string | null;
  media: string;
  platforms: string;
  scheduled_at: number | null;
  status: PostStatus;
  revision: number;
  created_by: string;
  approved_by: string | null;
  approved_at: number | null;
  review_note: string | null;
  event_mode_id: string | null;
  created_at: number;
  updated_at: number;
}

function parseJson<T>(text: string, fallback: T): T {
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

export function rowToDraft(row: PostRow): DraftInput {
  return {
    type: row.type,
    caption: row.caption,
    captionOverrides: parseJson(row.caption_overrides, {}),
    link: row.link,
    media: parseJson(row.media, []),
    platforms: parseJson(row.platforms, []),
    scheduledAt: row.scheduled_at,
  };
}

export type PostColumn =
  | 'type' | 'caption' | 'caption_overrides' | 'link' | 'media' | 'platforms' | 'scheduled_at'
  | 'status' | 'approved_by' | 'approved_at' | 'review_note' | 'event_mode_id';

/** Every column a guarded update may write. A key outside this list is a bug, never a request. */
export const POST_COLUMNS: PostColumn[] = [
  'type', 'caption', 'caption_overrides', 'link', 'media', 'platforms', 'scheduled_at',
  'status', 'approved_by', 'approved_at', 'review_note', 'event_mode_id',
];

export function draftColumns(d: DraftInput): Partial<Record<PostColumn, unknown>> {
  return {
    type: d.type,
    caption: d.caption,
    caption_overrides: JSON.stringify(d.captionOverrides),
    link: d.link,
    media: JSON.stringify(d.media),
    platforms: JSON.stringify(d.platforms),
    scheduled_at: d.scheduledAt,
  };
}

/**
 * True after a guarded update took effect: the row carries the nonce THIS
 * write stored. (A revision number would not do: two writers that read the
 * same revision compute the same next one, and the loser's statements would
 * pass too.)
 */
export const POST_PROOF = 'EXISTS (SELECT 1 FROM social_posts WHERE id = ? AND write_nonce = ?)';

/** Column names are checked against POST_COLUMNS at run time, never taken from a request. */
export function updatePostGuarded(
  db: D1Database, id: string, revision: number, nonce: string, fields: Partial<Record<PostColumn, unknown>>, now: number, statusIn?: PostStatus[],
): D1PreparedStatement {
  const cols = Object.keys(fields) as PostColumn[];
  for (const c of cols) {
    if (!POST_COLUMNS.includes(c)) throw new Error(`updatePostGuarded: unknown column ${c}`);
    if (fields[c] === undefined) throw new Error(`updatePostGuarded: undefined value for ${c}`);
  }
  const sets = cols.map((c) => `${c} = ?, `).join('');
  const statusClause = statusIn && statusIn.length ? ` AND status IN (${statusIn.map(() => '?').join(', ')})` : '';
  return db.prepare(
    `UPDATE social_posts SET ${sets}revision = revision + 1, write_nonce = ?, updated_at = ? WHERE id = ? AND revision = ?${statusClause}`,
  ).bind(...cols.map((c) => fields[c]), nonce, now, id, revision, ...(statusIn ?? []));
}

/** Replaces a post's queued targets (null: removes them), only if this write's guarded update landed. */
export function targetStatements(db: D1Database, postId: string, nonce: string, platforms: SocialPlatform[] | null): D1PreparedStatement[] {
  const statements = [
    db.prepare(`DELETE FROM social_post_targets WHERE post_id = ? AND ${POST_PROOF}`).bind(postId, postId, nonce),
  ];
  for (const platform of platforms ?? []) {
    statements.push(db.prepare(
      `INSERT INTO social_post_targets (post_id, platform, status) SELECT ?, ?, 'queued' WHERE ${POST_PROOF}`,
    ).bind(postId, platform, postId, nonce));
  }
  return statements;
}

/** Frees the plan slot a cancelled post was filling. */
export function unlinkPlanStatement(db: D1Database, postId: string, nonce: string): D1PreparedStatement {
  return db.prepare(`UPDATE social_plans SET post_id = NULL WHERE post_id = ? AND ${POST_PROOF}`).bind(postId, postId, nonce);
}
