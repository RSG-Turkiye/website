/**
 * The PR shepherd: moves approved CMS drafts from an open pull request to
 * the live site, once a minute on the mail tick (functions/api/mail/dispatch.ts).
 *
 * For each draft in `pr_open`, it asks GitHub where the pull request
 * stands, in this order:
 *
 * - merged on GitHub                → `merged` (cms.pr.merged)
 * - closed without merging          → `pr_failed`, "closed on GitHub"
 * - conflicts (`dirty`)             → `pr_failed`, "conflicts with a newer change; start a new draft"
 * - behind main                     → update the branch (checks run again on the new head,
 *                                     so a check that failed on the old one is not final);
 *                                     an update refused for a conflict → the conflict reason
 * - a required check failed         → `pr_failed`, naming the check
 * - checks green and mergeable      → squash-merge it at the head the checks ran on
 * - anything else (checks pending, GitHub still `unknown`, `blocked`, a merge refused)
 *                                   → ask again next tick, until the draft has been
 *                                     `pr_open` for PR_OPEN_MAX_SECONDS: then `pr_failed`,
 *                                     "blocked by branch protection" when the checks were
 *                                     green, else "checks did not finish"
 *
 * The age cap is applied only after GitHub answered, so a pull request that
 * merged or closed meanwhile still settles as such; a GitHub error never
 * fails a draft. A draft set to pr_failed here has its pull request closed
 * (best effort), so it is not merged by hand and a retry opens a new one.
 * A pr_open row with no pull request number fails at once ("no pull request
 * on record"). Without a GitHub token the pr_open rows are skipped.
 *
 * A `merged` draft becomes `published` only when the deployed site's
 * /cms-index.json shows its files: each written file with the blob sha the
 * draft's content has, each deleted file absent. After MERGED_STALE_SECONDS
 * the panel says the site did not update; after MERGED_NOT_LIVE_SECONDS the
 * draft becomes pr_failed ("merged but the site never showed it"), which
 * frees the entry. An approver may also discard it.
 *
 * GitHub's own auto-merge was considered and not used: turning it on needs a
 * repository owner's setting, and with strict "up to date before merging"
 * branch protection it still does not update a behind branch, so the
 * update-branch step here would be needed anyway.
 *
 * Budget: Workers on the free plan allow about 50 subrequests per
 * invocation, shared with the mail work in the same tick, so the shepherd
 * makes at most MAX_FETCHES GitHub requests per tick. A pull request costs
 * up to ROW_COST (status: 2, or 1 when it is merged or closed; then merge: 2
 * or update: 1; then closing it on a failure: 1); one is started only while
 * that much is left. Drafts are taken by last_checked_at, oldest
 * first, so a slow pull request cannot starve the others.
 *
 * Every status change is a guarded write (status and write_nonce as read)
 * with its audit row in the same batch, so two overlapping ticks make each
 * change, and log it, once. The last_checked_at bookkeeping touches neither
 * updated_at (the age caps count from it) nor write_nonce.
 */

import type { Env } from './auth';
import { appendAudit, runGuardedWithAudit } from './audit';
import { loadCmsIndex, newNonce, nonceProof } from './cms-api';
import { DRAFT_RETENTION_SECONDS, FAILURE, filesFor, MERGED_NOT_LIVE_SECONDS, PR_OPEN_MAX_SECONDS, type DraftRow } from './cms-drafts';
import { closePr, mergePr, prStatus, updateBranch } from './github';
import { gitBlobSha } from '../../src/lib/cms/blob-sha';
import type { CmsIndex } from '../../src/lib/cms/cms-index';
import { cmsType } from '../../src/lib/cms/types';

/** GitHub requests per tick, at most. */
export const MAX_FETCHES = 12;
/** The most one pull request can cost in a tick: prStatus (2), mergePr (2)
 * and, when that ends in pr_failed, closing it (1). */
const ROW_COST = 5;
/** Drafts read per tick. More than the GitHub budget covers, so `merged`
 * drafts (which cost no GitHub request) are not held back by it. */
const PICK = 20;

/** The site the deployed index is read from when no origin is given. */
const SITE_ORIGIN = 'https://rsg-turkiye.iscbsc.org';

/** mergeable_state values GitHub will merge from (unstable: a check that is
 * not required failed; has_hooks: mergeable, with hooks). */
const MERGEABLE = new Set(['clean', 'unstable', 'has_hooks']);

/**
 * The one query a tick makes when nothing is waiting. It runs every minute,
 * so it must use an index (idx_content_drafts_status); a test checks the plan.
 */
export const PICK_SQL = `SELECT id, type, entry_id, action, data, base_shas, status, pr_number, write_nonce, updated_at
  FROM content_drafts
  WHERE status IN ('pr_open', 'merged')
  ORDER BY last_checked_at ASC, updated_at ASC
  LIMIT ${PICK}`;

type Picked = Pick<DraftRow, 'id' | 'type' | 'entry_id' | 'action' | 'data' | 'base_shas' | 'status' | 'pr_number' | 'write_nonce' | 'updated_at'>;

export interface ShepherdResult {
  merged: number;
  updated: number;
  failed: number;
  published: number;
}

export async function shepherd(env: Env, now: number, origin: string = SITE_ORIGIN): Promise<ShepherdResult> {
  const result: ShepherdResult = { merged: 0, updated: 0, failed: 0, published: 0 };
  const rows = (await env.DB.prepare(PICK_SQL).all<Picked>()).results;
  if (rows.length === 0) return result;

  let fetches = 0;
  let index: CmsIndex | null | undefined;
  const checked: string[] = [];

  for (const row of rows) {
    if (row.status === 'merged') {
      if (index === undefined) index = await loadCmsIndex(new Request(new URL('/', origin)), env);
      checked.push(row.id);
      // No index (a failed read) means "not known yet", never "absent".
      if (index && (await onSite(row, index))) {
        if (await settle(env, row, 'merged', 'published', null, 'cms.pr.published', {}, now)) result.published++;
      } else if (now - row.updated_at > MERGED_NOT_LIVE_SECONDS) {
        // Its exit: pr_failed frees the entry; the author or an approver
        // can look at the site and send a new draft or discard this one.
        if (await settle(env, row, 'merged', 'pr_failed', FAILURE.notLive, 'cms.pr.failed', { reason: FAILURE.notLive }, now)) result.failed++;
      }
      continue;
    }

    // Nothing on GitHub to ask about: a pr_open row without a number.
    if (row.pr_number === null) {
      checked.push(row.id);
      if (await settle(env, row, 'pr_open', 'pr_failed', FAILURE.noPr, 'cms.pr.failed', { reason: FAILURE.noPr }, now)) result.failed++;
      continue;
    }
    // No token: still stamped, so these rows rotate and never hold back the merged ones.
    if (!env.GITHUB_PAT) {
      checked.push(row.id);
      continue;
    }
    if (MAX_FETCHES - fetches < ROW_COST) continue; // not stamped: first in line next tick
    checked.push(row.id);
    const n = row.pr_number;
    // pr_failed, and the pull request closed (best effort, counted), so
    // nobody merges a failed draft by hand and a retry opens a fresh one.
    const fail = async (reason: string, extra: Record<string, unknown> = {}, close = true) => {
      if (!(await settle(env, row, 'pr_open', 'pr_failed', reason, 'cms.pr.failed', { reason, ...extra }, now))) return;
      result.failed++;
      if (!close) return;
      fetches += 1;
      try {
        await closePr(n, env);
      } catch (e) {
        console.error('cms shepherd: closing failed pull request', n, e);
      }
    };
    const toMerged = async (extra: Record<string, unknown> = {}) => {
      if (await settle(env, row, 'pr_open', 'merged', null, 'cms.pr.merged', extra, now)) result.merged++;
    };
    // Not finished: ask again next tick, until the age cap.
    const cap = async (reason: string = FAILURE.timeout, extra: Record<string, unknown> = {}) => {
      if (now - row.updated_at > PR_OPEN_MAX_SECONDS) await fail(reason, extra);
    };

    let s: Awaited<ReturnType<typeof prStatus>>;
    try {
      s = await prStatus(n, env);
      fetches += s.state === 'open' ? 2 : 1;
    } catch (e) {
      // GitHub having a bad minute is never a reason to fail a draft: the
      // next tick reads the pull request again.
      fetches += 2;
      console.error('cms shepherd: pull request', n, e);
      continue;
    }
    try {
      if (s.state === 'merged') await toMerged();
      else if (s.state === 'closed') await fail(FAILURE.closed, {}, false);
      else if (s.mergeable_state === 'dirty') await fail(FAILURE.conflict);
      else if (s.mergeable_state === 'behind') {
        // Before the check result: a check that failed on an old head is
        // run again on the updated one.
        fetches += 1;
        const u = await updateBranch(n, env, s.headSha);
        if (!u.success && u.reason === 'conflict') await fail(FAILURE.conflict);
        else {
          if (u.success) result.updated++;
          await cap();
        }
      } else if (s.checks === 'failure') await fail(FAILURE.check(s.failedCheck ?? 'unknown'), { check: s.failedCheck ?? null });
      else if (s.checks === 'success' && MERGEABLE.has(s.mergeable_state)) {
        fetches += 2;
        const m = await mergePr(n, env, s.headSha);
        if (m.merged) await toMerged({ merge_sha: m.sha });
        else await cap(FAILURE.blocked, { merge: m.reason });
      } else if (s.checks === 'success' && s.mergeable_state === 'blocked') {
        await cap(FAILURE.blocked);
      } else {
        await cap();
      }
    } catch (e) {
      // One broken pull request must not stop the others; it is looked at again next tick.
      console.error('cms shepherd: pull request', n, e);
    }
  }

  if (checked.length) {
    await env.DB.prepare(`UPDATE content_drafts SET last_checked_at = ? WHERE id IN (${checked.map(() => '?').join(', ')})`)
      .bind(now, ...checked)
      .run();
  }
  return result;
}

/**
 * A guarded status change from `from`, with its audit row (no user when
 * the tick did it). False when the draft moved on since it was read, for
 * example because an overlapping tick already made this change.
 */
export async function settle(
  env: Env,
  row: Pick<DraftRow, 'id' | 'type' | 'entry_id' | 'pr_number' | 'write_nonce'>,
  from: 'pr_open' | 'merged',
  to: 'merged' | 'published' | 'pr_failed',
  failure: string | null,
  action: string,
  extra: Record<string, unknown>,
  now: number,
  userId: string | null = null,
): Promise<boolean> {
  const nonce = newNonce();
  return runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = ?, failure = ?, updated_at = ?, last_checked_at = ?, write_nonce = ?
                    WHERE id = ? AND status = ? AND write_nonce IS ?`)
      .bind(to, failure, now, now, nonce, row.id, from, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId, action, targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, pr_number: row.pr_number, ...extra } },
    now,
  );
}

/**
 * Whether the deployed index shows the draft: every file it writes with the
 * blob sha of the draft's content, every file it deletes absent. An index
 * built before shas were added proves nothing, so it never counts.
 */
export async function onSite(row: Pick<DraftRow, 'type' | 'entry_id' | 'action' | 'data' | 'base_shas'>, index: CmsIndex): Promise<boolean> {
  const type = cmsType(row.type);
  if (!type) return false;
  const all = Object.values(index).flat();
  if (!all.some((e) => e.shas !== undefined)) return false;
  const live = new Map<string, string>();
  for (const e of index[type.key] ?? []) for (const [path, sha] of Object.entries(e.shas ?? {})) live.set(path, sha);
  let files;
  try {
    files = filesFor(row);
  } catch (e) {
    console.error('cms shepherd: draft could not be written out', e);
    return false;
  }
  for (const f of files) {
    if (f.content === null) {
      if (live.has(f.path)) return false;
    } else if (live.get(f.path) !== (await gitBlobSha(f.content))) {
      return false;
    }
  }
  return true;
}

/**
 * Deletes finished drafts (published, discarded) older than
 * DRAFT_RETENTION_SECONDS, on the hourly tick, then logs one row with the
 * number the DELETE reports (as the audit prune does). pr_failed and
 * rejected drafts stay: they are waiting for someone. Returns that number.
 */
export async function pruneDrafts(db: D1Database, now: number): Promise<number> {
  const res = await db.prepare(
    `DELETE FROM content_drafts WHERE status IN ('published', 'discarded') AND updated_at < ?`,
  ).bind(now - DRAFT_RETENTION_SECONDS).run();
  const deleted = Number(res.meta?.changes ?? 0);
  if (deleted > 0) await appendAudit(db, { userId: null, action: 'cms.draft.prune', targetType: 'content_draft', details: { count: deleted } }, now);
  return deleted;
}
