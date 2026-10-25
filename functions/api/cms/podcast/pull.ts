import type { Env } from '../../../_lib/auth';
import { generateId, jsonResponse } from '../../../_lib/auth';
import { appendAudit, runWithAudit } from '../../../_lib/audit';
import { cmsGate, draftJson, fail, forbidden, githubFailed, newNonce, rightsIn } from '../../../_lib/cms-api';
import { LIVE_STATUSES, validateDraft, type DraftRow } from '../../../_lib/cms-drafts';
import { filesOnBase } from '../../../_lib/github';
import { cmsType } from '../../../../src/lib/cms/types';
import { jsonPath } from '../../../../src/lib/cms/serialize';
import { FEED, FeedError, parseFeed, type PodcastData } from '../../../../src/lib/podcast-feed';

/** Pulls per person in PULL_WINDOW_SECONDS. There is no paid WAF here, so
 * the limit lives in the Function (CLAUDE.md), counted from the audit log,
 * which records every attempt anyway: no table of its own, no migration. */
export const PULL_LIMIT = 5;
export const PULL_WINDOW_SECONDS = 600;
/** The feed is third-party: one request, this long at most, this big at most. */
export const FEED_TIMEOUT_MS = 10_000;
export const FEED_MAX_BYTES = 2 * 1024 * 1024;

/** Every attempt writes one cms.podcast.pull row before the feed is read, so
 * a request killed mid-fetch still counts. */
const PULLED = `SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ? AND at > ? AND action = 'cms.podcast.pull'`;
const LIVE = LIVE_STATUSES.map((s) => `'${s}'`).join(', ');

const feedFailed = () => fail(502, 'feed_failed', 'The podcast feed could not be read; try again later');

/** The feed's text, or null. Logs a status or a size, never the body. */
async function readFeed(): Promise<string | null> {
  let res: Response;
  try {
    res = await fetch(FEED, { headers: { 'User-Agent': 'rsg-turkiye-website/1.0' }, signal: AbortSignal.timeout(FEED_TIMEOUT_MS) });
  } catch (e) {
    console.error('podcast: the feed did not answer', e instanceof Error ? e.name : 'error');
    return null;
  }
  if (!res.ok || !res.body) {
    console.error('podcast: the feed answered', res.status);
    await res.body?.cancel().catch(() => {});
    return null;
  }
  if (Number(res.headers.get('Content-Length') ?? 0) > FEED_MAX_BYTES) {
    console.error('podcast: the feed is larger than the cap');
    await res.body.cancel().catch(() => {});
    return null;
  }
  // Counted as it arrives: Content-Length may be absent or wrong.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FEED_MAX_BYTES) {
        console.error('podcast: the feed is larger than the cap');
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch (e) {
    console.error('podcast: reading the feed failed', e instanceof Error ? e.name : 'error');
    return null;
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { bytes.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(bytes);
}

/** Two versions of the file, compared without syncedAt (which every pull changes). */
const sameShow = (a: PodcastData, b: PodcastData) => JSON.stringify({ ...a, syncedAt: '' }) === JSON.stringify({ ...b, syncedAt: '' });

/**
 * POST: "Yeni bölümleri çek". Reads the show's feed once and compares it
 * with src/data/podcast.json on main, ignoring syncedAt.
 * - The same: 200 `{ code: 'no_new_episodes' }`.
 * - Different (a new episode, or any other change the feed made): 201
 *   `{ draft, added }`, an update draft by the caller that then goes through
 *   the usual submit, approve and pull-request flow.
 * - The feed down, too large, empty, an episode without audio, title or
 *   date, or data the schema or the house rules refuse: 502 feed_failed.
 * The feed's own text is never in an answer or a log line.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await cmsGate(request, env, true);
  if (!gate.ok) return gate.response;
  const type = cmsType('podcast')!;
  if (!rightsIn(gate.rights, type.group).edit) return forbidden();
  const agent = gate.agent?.tokenId ?? null;

  const used = await env.DB.prepare(PULLED).bind(gate.user.id, gate.now - PULL_WINDOW_SECONDS).first<{ n: number }>();
  if ((used?.n ?? 0) >= PULL_LIMIT) return fail(429, 'rate_limited', 'Too many pulls; try again in a few minutes');

  // A draft submit would refuse (entry_busy) is not made at all.
  const busy = await env.DB.prepare(`SELECT 1 FROM content_drafts WHERE type = ? AND entry_id = ? AND status IN (${LIVE}) LIMIT 1`)
    .bind(type.key, type.fixedId).first();
  if (busy) return fail(409, 'entry_busy', 'Another podcast draft is waiting for approval or going live; wait for it to finish');

  // The attempt, before the feed is read (and counted by the rate limit).
  await appendAudit(env.DB, { userId: gate.user.id, action: 'cms.podcast.pull', targetType: 'content', targetId: type.fixedId, details: {}, agent }, gate.now);
  // How it ended, unless it ended in a draft (cms.draft.create says that).
  const logPull = (result: string) => appendAudit(env.DB, {
    userId: gate.user.id, action: 'cms.podcast.result', targetType: 'content', targetId: type.fixedId, details: { result }, agent,
  }, gate.now);

  const xml = await readFeed();
  let data: PodcastData | null = null;
  if (xml !== null) {
    try {
      data = parseFeed(xml, new Date(gate.now * 1000).toISOString());
    } catch (e) {
      if (!(e instanceof FeedError)) console.error('podcast: parsing the feed failed', e instanceof Error ? e.name : 'error');
      else console.error('podcast:', e.message);
    }
  }
  // Checked as submit will check it, so a pulled draft can always be sent.
  const checked = data ? validateDraft(type, data, 'strict') : null;
  if (checked && !checked.ok) console.error('podcast: the feed does not fit the schema at', Object.keys(checked.errors).join(', '));
  if (!data || !checked?.ok) {
    await logPull('feed_failed');
    return feedFailed();
  }

  const path = jsonPath(type, type.fixedId);
  let file: { content: string; sha: string } | null;
  try {
    file = (await filesOnBase([path], env))[path];
  } catch (e) {
    await logPull('github_failed');
    return githubFailed(e);
  }
  if (!file) { await logPull('not_found'); return fail(404, 'not_found', 'No such entry'); }
  let onMain: PodcastData;
  try {
    onMain = JSON.parse(file.content) as PodcastData;
  } catch (e) {
    console.error('cms: podcast.json on main could not be parsed', e);
    await logPull('unreadable');
    return fail(500, 'unreadable', 'The file on main could not be read');
  }

  if (sameShow(onMain, data)) {
    await logPull('no_new_episodes');
    return jsonResponse({ code: 'no_new_episodes' });
  }

  const known = new Set((onMain.episodes ?? []).map((e) => e.guid));
  const row: DraftRow = {
    id: generateId(), type: type.key, entry_id: type.fixedId, action: 'update', data: JSON.stringify(data), base_shas: JSON.stringify({ [path]: file.sha }),
    status: 'draft', author_id: gate.user.id, reviewer_id: null, review_note: null, pr_url: null, pr_number: null, failure: null,
    write_nonce: newNonce(), last_checked_at: null, agent_token_id: agent, created_at: gate.now, updated_at: gate.now,
  };
  await runWithAudit(env.DB, [env.DB.prepare(
    `INSERT INTO content_drafts (id, type, entry_id, action, data, base_shas, status, author_id, write_nonce, agent_token_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?)`,
  ).bind(row.id, row.type, row.entry_id, row.action, row.data, row.base_shas, row.author_id, row.write_nonce, row.agent_token_id, row.created_at, row.updated_at)],
  { userId: gate.user.id, action: 'cms.draft.create', targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, draft_action: row.action, generated: 'podcast' }, agent },
  gate.now);
  return jsonResponse({ draft: draftJson(row, true), added: data.episodes.filter((e) => !known.has(e.guid)).length }, 201);
};
