import { ENABLED_PLATFORMS, POST_TYPES, type PostType, type SocialPlatform } from './social-limits';
import { validateScheduledAt } from './schedule';
import type { Parsed } from './social-posts';

/** Admins and both social roles: the people a plan or an event window can name. */
export async function isSocialEditor(db: D1Database, id: string): Promise<boolean> {
  return Boolean(await db.prepare(
    'SELECT 1 FROM users WHERE id = ? AND (is_admin = 1 OR is_social = 1 OR is_social_publisher = 1)',
  ).bind(id).first());
}

export interface PlanInput {
  title?: string;
  scheduledAt?: number;
  platforms?: SocialPlatform[];
  postType?: PostType;
  assigneeId?: string | null;
  note?: string;
}

const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });

/**
 * `partial` for PATCH: absent fields stay absent. A new date must be in the
 * future and a new assignee a social editor; `stored` (PATCH) is what the plan
 * holds now, and a value sent back unchanged is not checked again.
 */
export async function parsePlanInput(
  body: Record<string, unknown>, partial: boolean, now: number, isEditorId: (id: string) => Promise<boolean>,
  stored?: { scheduledAt: number; assigneeId: string | null },
): Promise<Parsed<PlanInput>> {
  const out: PlanInput = {};
  const has = (k: string) => Object.hasOwn(body, k);

  if (has('title') || !partial) {
    const t = body.title;
    if (typeof t !== 'string' || t.trim().length < 1 || t.trim().length > 120) return fail('invalid_title');
    out.title = t.trim();
  }
  if (has('scheduledAt') || !partial) {
    if (stored && body.scheduledAt === stored.scheduledAt) out.scheduledAt = stored.scheduledAt;
    else {
      const v = validateScheduledAt(body.scheduledAt, now);
      if (!v.ok) return fail(v.code);
      out.scheduledAt = v.scheduledAt;
    }
  }
  if (has('platforms') || !partial) {
    const p = body.platforms;
    if (!Array.isArray(p) || p.length === 0 || new Set(p).size !== p.length
      || !p.every((x) => typeof x === 'string' && (ENABLED_PLATFORMS as string[]).includes(x))) return fail('invalid_platforms');
    out.platforms = p as SocialPlatform[];
  }
  if (has('postType') || !partial) {
    const t = body.postType ?? 'image';
    if (typeof t !== 'string' || !(POST_TYPES as string[]).includes(t)) return fail('invalid_post_type');
    out.postType = t as PostType;
  }
  if (has('assigneeId')) {
    const a = body.assigneeId;
    if (a === null || a === '') out.assigneeId = null;
    else if (typeof a !== 'string') return fail('invalid_assignee');
    else if (stored && a === stored.assigneeId) out.assigneeId = a;
    else if (!(await isEditorId(a))) return fail('invalid_assignee');
    else out.assigneeId = a;
  }
  if (has('note')) {
    const n = body.note ?? '';
    if (typeof n !== 'string' || n.length > 500) return fail('invalid_note');
    out.note = n;
  }
  return { ok: true, value: out };
}
