import type { Env } from './auth';
import { rowToDraft, type PostRow } from './social-posts';

type Joined = PostRow & { author_email: string | null; plan_id: string | null; plan_title: string | null };
type TargetRow = { post_id: string; platform: string; status: string; permalink: string | null; last_error: string | null };

const SELECT = `SELECT p.*, u.email AS author_email, pl.id AS plan_id, pl.title AS plan_title
                  FROM social_posts p
                  LEFT JOIN users u ON u.id = p.created_by
                  LEFT JOIN social_plans pl ON pl.post_id = p.id`;

function respond(env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, row: Joined, targets: TargetRow[]) {
  const d = rowToDraft(row);
  return {
    id: row.id, type: d.type, caption: d.caption, captionOverrides: d.captionOverrides, link: d.link,
    media: d.media.map((m) => ({ ...m, url: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.key}` })),
    platforms: d.platforms, scheduledAt: d.scheduledAt, status: row.status, revision: row.revision,
    createdBy: row.created_by, authorEmail: row.author_email, approvedBy: row.approved_by, approvedAt: row.approved_at,
    reviewNote: row.review_note, planId: row.plan_id, planTitle: row.plan_title, eventModeId: row.event_mode_id,
    createdAt: row.created_at, updatedAt: row.updated_at,
    targets: targets.filter((t) => t.post_id === row.id).map((t) => ({ platform: t.platform, status: t.status, permalink: t.permalink, lastError: t.last_error })),
  };
}
export type PostResponse = ReturnType<typeof respond>;

/** `where` is written in code; values go through binds. */
export async function loadPosts(db: D1Database, env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, where: string, binds: unknown[]): Promise<PostResponse[]> {
  const rows = (await db.prepare(`${SELECT} WHERE ${where} ORDER BY p.scheduled_at, p.created_at`).bind(...binds).all<Joined>()).results;
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const targets = (await db.prepare(
    `SELECT post_id, platform, status, permalink, last_error FROM social_post_targets WHERE post_id IN (${ids.map(() => '?').join(',')})`,
  ).bind(...ids).all<TargetRow>()).results;
  return rows.map((r) => respond(env, r, targets));
}

export async function loadPost(db: D1Database, env: Pick<Env, 'PUBLIC_BLOG_IMAGES_URL'>, id: string): Promise<{ row: PostRow; response: PostResponse } | null> {
  const row = await db.prepare(`${SELECT} WHERE p.id = ?`).bind(id).first<Joined>();
  if (!row) return null;
  const targets = (await db.prepare('SELECT post_id, platform, status, permalink, last_error FROM social_post_targets WHERE post_id = ?').bind(id).all<TargetRow>()).results;
  return { row, response: respond(env, row, targets) };
}
