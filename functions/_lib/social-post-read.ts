import type { Env } from './auth';
import { rowToDraft, type PostRow } from './social-posts';

type Joined = PostRow & { author_email: string | null; plan_id: string | null; plan_title: string | null; agent_token_id: string | null };
type TargetRow = { post_id: string; platform: string; status: string; permalink: string | null; last_error: string | null };

const SELECT = `SELECT p.*, u.email AS author_email, pl.id AS plan_id, pl.title AS plan_title
                  FROM social_posts p
                  LEFT JOIN users u ON u.id = p.created_by
                  LEFT JOIN social_plans pl ON pl.post_id = p.id`;

/**
 * What a token may see beyond its member's own posts: what already went out.
 * Colleagues' drafts, pending and scheduled posts do not reach an agent whose
 * member could not review them (agentMayRead). This is also the rule of every
 * WRITE path (save, submit, discard), which never takes a reviewer's wider
 * reach: a colleague's post is not found for them. `p` is the social_posts alias.
 */
export const AGENT_VISIBLE = `(p.created_by = ? OR p.status IN ('published', 'partially_published'))`;
export const agentMaySee = (row: Pick<PostRow, 'created_by' | 'status'>, userId: string) =>
  row.created_by === userId || row.status === 'published' || row.status === 'partially_published';

/**
 * What a token may READ of a post: the narrow rule above, or anything when it
 * reviews social posts (agentReviewsSocial). Reads only; never use it to
 * decide whether a token may change a post.
 */
export const agentMayRead = (row: Pick<PostRow, 'created_by' | 'status'>, userId: string, reviewer: boolean) =>
  reviewer || agentMaySee(row, userId);

/**
 * `forAgent` is the member a token acts for, or null for the panel. An
 * agent's answers carry no e-mail address, no platform error text, and a
 * review note only on the member's own posts, or on any post for a reviewer
 * (the panel shows it to them).
 */
function respond(env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, row: Joined, targets: TargetRow[], forAgent: string | null, reviewer: boolean) {
  const d = rowToDraft(row);
  const agent = forAgent !== null;
  return {
    id: row.id, type: d.type, caption: d.caption, captionOverrides: d.captionOverrides, link: d.link,
    media: d.media.map((m) => ({
      ...m,
      url: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.key}`,
      ...(m.source ? { sourceUrl: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.source.key}` } : {}),
      ...(m.base ? { baseUrl: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.base}` } : {}),
    })),
    platforms: d.platforms, scheduledAt: d.scheduledAt, status: row.status, revision: row.revision,
    createdBy: row.created_by, authorEmail: agent ? null : row.author_email, approvedBy: row.approved_by, approvedAt: row.approved_at,
    reviewNote: agent && !reviewer && row.created_by !== forAgent ? null : row.review_note, planId: row.plan_id, planTitle: row.plan_title, eventModeId: row.event_mode_id,
    createdAt: row.created_at, updatedAt: row.updated_at, byAgent: row.agent_token_id != null,
    targets: targets.filter((t) => t.post_id === row.id).map((t) => ({ platform: t.platform, status: t.status, permalink: t.permalink, lastError: agent ? null : t.last_error })),
  };
}
export type PostResponse = ReturnType<typeof respond>;

/** `where` is written in code; values go through binds. */
export async function loadPosts(
  db: D1Database, env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, where: string, binds: unknown[], forAgent: string | null = null, reviewer = false,
): Promise<PostResponse[]> {
  const rows = (await db.prepare(`${SELECT} WHERE ${where} ORDER BY p.scheduled_at, p.created_at`).bind(...binds).all<Joined>()).results;
  if (rows.length === 0) return [];
  // One join with the same filter: binding every post id would hit D1's 100-parameter cap.
  const targets = (await db.prepare(
    `SELECT t.post_id, t.platform, t.status, t.permalink, t.last_error
       FROM social_post_targets t JOIN social_posts p ON p.id = t.post_id WHERE ${where}`,
  ).bind(...binds).all<TargetRow>()).results;
  return rows.map((r) => respond(env, r, targets, forAgent, reviewer));
}

export async function loadPost(
  db: D1Database, env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, id: string, forAgent: string | null = null, reviewer = false,
): Promise<{ row: PostRow; response: PostResponse } | null> {
  const row = await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<Joined>();
  if (!row) return null;
  const targets = (await db.prepare('SELECT post_id, platform, status, permalink, last_error FROM social_post_targets WHERE post_id = ?').bind(id).all<TargetRow>()).results;
  return { row, response: respond(env, row, targets, forAgent, reviewer) };
}
