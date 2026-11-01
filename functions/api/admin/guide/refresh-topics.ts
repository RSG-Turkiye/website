import type { Env } from '../../../_lib/auth';
import { jsonResponse } from '../../../_lib/auth';
import { runWithAudit } from '../../../_lib/audit';
import { safeEqual } from '../../../_lib/secret';
import { fetchAuthorTopics } from '../../../_lib/openalex';
import { publishGuideIndex } from '../../../_lib/guide-index';

/**
 * Nightly (workers/symposium-cron): the 20 professors with an OpenAlex id
 * whose topics are oldest (never-refreshed first) get fresh topics, then the
 * index is republished once. A failed fetch keeps the old topics but still
 * moves the professor to the back of the queue and counts the failure, so
 * one bad id never blocks the rest. 20 fetches stay inside a Worker's
 * subrequest limit with room for the D1 and R2 calls.
 */

const PER_NIGHT = 20;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(
    `SELECT id, openalex_id FROM guide_professors WHERE openalex_id IS NOT NULL AND openalex_id != ''
     ORDER BY topics_refreshed_at IS NOT NULL, topics_refreshed_at, id LIMIT ?`,
  ).bind(PER_NIGHT).all<{ id: string; openalex_id: string }>();
  const updates: D1PreparedStatement[] = [];
  let failed = 0;
  for (const r of results ?? []) {
    try {
      const topics = await fetchAuthorTopics(r.openalex_id);
      updates.push(env.DB.prepare('UPDATE guide_professors SET openalex_topics = ?, topics_refreshed_at = ?, topics_failures = 0 WHERE id = ?').bind(JSON.stringify(topics), now, r.id));
    } catch {
      failed++;
      updates.push(env.DB.prepare('UPDATE guide_professors SET topics_refreshed_at = ?, topics_failures = topics_failures + 1 WHERE id = ?').bind(now, r.id));
    }
  }
  await runWithAudit(env.DB, updates, { userId: null, action: 'guide.topics', details: { checked: results?.length ?? 0, failed } }, now);
  const publish = (results?.length ?? 0) > 0 ? await publishGuideIndex(env as never, now) : null;
  return jsonResponse({ checked: results?.length ?? 0, failed, publish });
};
