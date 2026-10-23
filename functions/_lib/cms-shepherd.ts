/**
 * The PR shepherd: moves approved CMS drafts from an open pull request to
 * the live site, once a minute on the mail tick (functions/api/mail/dispatch.ts).
 *
 * For each draft in `pr_open`, it asks GitHub where the pull request stands:
 *
 * - merged on GitHub                → `merged` (cms.pr.merged)
 * - closed without merging          → `pr_failed`, "closed on GitHub"
 * - conflicts (`dirty`, or an update-branch refused for a conflict)
 *                                   → `pr_failed`, "conflicts with a newer change; start a new draft"
 * - a required check failed         → `pr_failed`, naming the check
 * - behind main                     → update the branch (checks run again); no status change
 * - checks green and mergeable      → squash-merge it at the head the checks ran on
 * - anything else (checks pending, GitHub still `unknown`, `blocked`)
 *                                   → ask again next tick, until the draft has been
 *                                     `pr_open` for PR_OPEN_MAX_SECONDS: then
 *                                     `pr_failed`, "checks did not finish"
 *
 * A `merged` draft becomes `published` only when the deployed site's
 * /cms-index.json shows its files: each written file with the blob sha the
 * draft's content has, each deleted file absent. Until then it stays
 * `merged`; after MERGED_STALE_SECONDS the panel says the site did not update.
 *
 * GitHub's own auto-merge was considered and not used: turning it on needs a
 * repository owner's setting, and with strict "up to date before merging"
 * branch protection it still does not update a behind branch, so the
 * update-branch step here would be needed anyway.
 *
 * Budget: Workers on the free plan allow about 50 subrequests per
 * invocation, shared with the mail work in the same tick, so the shepherd
 * makes at most MAX_FETCHES GitHub requests per tick. A pull request costs
 * up to ROW_COST (status: 2, then merge: 2 or update: 1); one is started only
 * while that much is left. Drafts are taken by last_checked_at, oldest
 * first, so a slow pull request cannot starve the others.
 *
 * Every status change is a guarded write (status and write_nonce as read)
 * with its audit row in the same batch, so two overlapping ticks make each
 * change, and log it, once. The last_checked_at bookkeeping touches neither
 * updated_at (the age caps count from it) nor write_nonce.
 */

import type { Env } from './auth';
import { runGuardedWithAudit, runWithAudit } from './audit';
import { loadCmsIndex, newNonce, nonceProof } from './cms-api';
import { DRAFT_RETENTION_SECONDS, FAILURE, filesFor, PR_OPEN_MAX_SECONDS, type DraftRow } from './cms-drafts';
import { mergePr, prStatus, updateBranch } from './github';
import { gitBlobSha } from '../../src/lib/cms/blob-sha';
import type { CmsIndex } from '../../src/lib/cms/cms-index';
import { cmsType } from '../../src/lib/cms/types';

/** GitHub requests per tick, at most. */
export const MAX_FETCHES = 12;
/** The most one pull request can cost in a tick: prStatus (2) and mergePr (2). */
const ROW_COST = 4;
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
      }
      continue;
    }

    if (!env.GITHUB_PAT || row.pr_number === null) continue;
    if (MAX_FETCHES - fetches < ROW_COST) continue; // next tick; merged drafts below still count
    checked.push(row.id);
    const n = row.pr_number;
    const fail = async (reason: string, extra: Record<string, unknown> = {}) => {
      if (await settle(env, row, 'pr_open', 'pr_failed', reason, 'cms.pr.failed', { reason, ...extra }, now)) result.failed++;
    };
    const toMerged = async (extra: Record<string, unknown> = {}) => {
      if (await settle(env, row, 'pr_open', 'merged', null, 'cms.pr.merged', extra, now)) result.merged++;
    };
    // Not finished yet: ask again next tick, up to the age cap.
    const wait = async () => {
      if (now - row.updated_at > PR_OPEN_MAX_SECONDS) await fail(FAILURE.timeout);
    };

    try {
      fetches += 2;
      const s = await prStatus(n, env);
      if (s.state === 'merged') await toMerged();
      else if (s.state === 'closed') await fail(FAILURE.closed);
      else if (s.mergeable_state === 'dirty') await fail(FAILURE.conflict);
      else if (s.checks === 'failure') await fail(FAILURE.check(s.failedCheck ?? 'unknown'), { check: s.failedCheck ?? null });
      else if (s.mergeable_state === 'behind') {
        fetches += 1;
        const u = await updateBranch(n, env, s.headSha);
        if (u.success) result.updated++;
        else if (u.reason === 'conflict') await fail(FAILURE.conflict);
        else await wait();
      } else if (s.checks === 'success' && MERGEABLE.has(s.mergeable_state)) {
        fetches += 2;
        const m = await mergePr(n, env, s.headSha);
        if (m.merged) await toMerged({ merge_sha: m.sha });
        else await wait();
      } else {
        await wait();
      }
    } catch (e) {
      // One broken pull request (or GitHub having a bad minute) must not stop the others.
      console.error('cms shepherd: pull request', n, e);
      await wait();
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
 * A guarded status change from `from`, with its audit row (no user: the
 * tick did it). False when the draft moved on since it was read, for
 * example because an overlapping tick already made this change.
 */
async function settle(
  env: Env,
  row: Picked,
  from: 'pr_open' | 'merged',
  to: 'merged' | 'published' | 'pr_failed',
  failure: string | null,
  action: string,
  extra: Record<string, unknown>,
  now: number,
): Promise<boolean> {
  const nonce = newNonce();
  return runGuardedWithAudit(
    env.DB,
    env.DB.prepare(`UPDATE content_drafts SET status = ?, failure = ?, updated_at = ?, last_checked_at = ?, write_nonce = ?
                    WHERE id = ? AND status = ? AND write_nonce IS ?`)
      .bind(to, failure, now, now, nonce, row.id, from, row.write_nonce),
    nonceProof(row.id, nonce),
    [],
    { userId: null, action, targetType: 'content_draft', targetId: row.id, details: { type: row.type, entry_id: row.entry_id, pr_number: row.pr_number, ...extra } },
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

/** Finished drafts (published, discarded, rejected) are deleted this many at most per hour. */
const PRUNE_BATCH = 100;

/**
 * Deletes finished drafts older than DRAFT_RETENTION_SECONDS, on the hourly
 * tick, with one log row naming how many. pr_failed drafts stay: they are
 * waiting for someone. Returns the number deleted.
 */
export async function pruneDrafts(db: D1Database, now: number): Promise<number> {
  const cutoff = now - DRAFT_RETENTION_SECONDS;
  const old = (await db.prepare(
    `SELECT id FROM content_drafts WHERE status IN ('published', 'discarded', 'rejected') AND updated_at < ? LIMIT ${PRUNE_BATCH}`,
  ).bind(cutoff).all<{ id: string }>()).results;
  if (old.length === 0) return 0;
  const ids = old.map((r) => r.id);
  await runWithAudit(
    db,
    [db.prepare(`DELETE FROM content_drafts WHERE id IN (${ids.map(() => '?').join(', ')}) AND status IN ('published', 'discarded', 'rejected') AND updated_at < ?`)
      .bind(...ids, cutoff)],
    { userId: null, action: 'cms.draft.prune', targetType: 'content_draft', details: { count: ids.length } },
    now,
  );
  return ids.length;
}
