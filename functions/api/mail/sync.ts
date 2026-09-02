import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { listHistory, getProfileHistoryId, GmailHistoryExpired } from '../../_lib/gmail-read';
import { ingestThread, notifyThreadOwner } from '../../_lib/conversations';

/**
 * Pull replies into the local cache.
 *
 * Driven by the Cloudflare cron Worker (workers/mail-cron) every five minutes
 * and by the conversations page on load. Secret-gated exactly like
 * /api/mail/dispatch: without that, anyone could burn the Gmail read quota.
 */

/** Threads per backfill invocation, chosen to stay inside the subrequest budget. */
const BACKFILL_BATCH = 15;

/** Sorts before every Gmail id, so a fresh backfill starts at the first row. */
const BACKFILL_START = '';

/** D1 caps a statement at 100 bound parameters; half that leaves headroom. */
const ID_CHUNK = 50;

interface SyncState {
  history_id: string | null;
  last_synced_at: number | null;
  backfill_cursor: string | null;
}

interface IngestSummary {
  ingested: number;
  notified: number;
  failed: number;
  firstError: string | null;
}

async function knownThreadIds(env: Env, ids: string[]): Promise<string[]> {
  const known: string[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT id FROM mail_threads WHERE id IN (${placeholders})`
    ).bind(...chunk).all<{ id: string }>();
    for (const row of rows.results) known.push(row.id);
  }
  return known;
}

async function ingestAll(
  env: Env,
  threadIds: string[],
  siteOrigin: string,
  now: number,
): Promise<IngestSummary> {
  const summary: IngestSummary = { ingested: 0, notified: 0, failed: 0, firstError: null };

  for (const threadId of threadIds) {
    try {
      const result = await ingestThread(env, threadId, now);
      summary.ingested += 1;

      if (result.newInbound > 0) {
        // A failed notification must not discard the ingest that already
        // succeeded. The messages are stored either way; the member finds them
        // on the page, and the next reply notifies.
        try {
          if (await notifyThreadOwner(env, threadId, siteOrigin, now)) summary.notified += 1;
        } catch (err) {
          summary.failed += 1;
          summary.firstError ??= `notify ${threadId}: ${String(err).slice(0, 200)}`;
        }
      }
    } catch (err) {
      // One unreadable thread must not stop the rest of the batch. Counted and
      // reported rather than swallowed, so a systematic failure is visible in
      // the Worker log instead of looking like a quiet no-op.
      summary.failed += 1;
      summary.firstError ??= `ingest ${threadId}: ${String(err).slice(0, 200)}`;
    }
  }

  return summary;
}

async function runBackfillBatch(
  env: Env,
  cursor: string,
  siteOrigin: string,
  now: number,
): Promise<Response> {
  const rows = await env.DB.prepare(
    `SELECT id FROM mail_threads WHERE id > ? ORDER BY id ASC LIMIT ?`
  ).bind(cursor, BACKFILL_BATCH).all<{ id: string }>();

  if (rows.results.length === 0) {
    // history_id was already snapshotted when the backfill began; adopting a
    // fresh one here would skip everything that arrived while it ran.
    await env.DB.prepare(
      'UPDATE mail_sync_state SET backfill_cursor = NULL, last_synced_at = ? WHERE id = 1'
    ).bind(now).run();
    return jsonResponse({ ok: true, backfillComplete: true });
  }

  const ids = rows.results.map((row) => row.id);
  const summary = await ingestAll(env, ids, siteOrigin, now);
  const nextCursor = ids[ids.length - 1];

  // Unlike the history walk above, the backfill cursor advances even when a
  // thread failed. A held backfill cursor has nothing to eventually rescue it
  // -- it would retry the same batch forever and never reach the end of the
  // walk. A thread missed here is repaired by the next backfill or by its own
  // next message; a stalled backfill repairs nothing.
  await env.DB.prepare(
    'UPDATE mail_sync_state SET backfill_cursor = ?, last_synced_at = ? WHERE id = 1'
  ).bind(nextCursor, now).run();

  return jsonResponse({ ok: true, backfill: true, ...summary, nextCursor });
}

export async function runSync(env: Env, siteOrigin: string): Promise<Response> {
  const now = Math.floor(Date.now() / 1000);

  const state = await env.DB.prepare(
    'SELECT history_id, last_synced_at, backfill_cursor FROM mail_sync_state WHERE id = 1'
  ).first<SyncState>();

  if (!state) {
    return jsonResponse({ error: 'Sync state row is missing', code: 'no_sync_state' }, 500);
  }

  // `!== null`, not a truthiness test: the sentinel that starts a fresh
  // backfill is the empty string, and `if (state.backfill_cursor)` would skip
  // straight past it into a history walk, abandoning the backfill on its very
  // first tick.
  if (state.backfill_cursor !== null) {
    return runBackfillBatch(env, state.backfill_cursor, siteOrigin, now);
  }

  // First run ever: adopt Gmail's current cursor and stop. Walking backwards
  // from here would pull in the whole mailbox's history, which is precisely
  // what this feature promises not to do.
  if (!state.history_id) {
    const historyId = await getProfileHistoryId(env);
    await env.DB.prepare(
      'UPDATE mail_sync_state SET history_id = ?, last_synced_at = ? WHERE id = 1'
    ).bind(historyId, now).run();
    return jsonResponse({ ok: true, initialised: true, historyId });
  }

  let threadIds: string[];
  let historyId: string;
  try {
    const result = await listHistory(env, state.history_id);
    threadIds = result.threadIds;
    historyId = result.historyId;
  } catch (err) {
    if (err instanceof GmailHistoryExpired) {
      // Snapshot the cursor at the START of the backfill, not at its end. The
      // walk can take hours; anything arriving during it must still be
      // reported by the first history walk afterwards. Re-ingesting a thread
      // the backfill already covered is free -- mail_messages' primary key is
      // Gmail's own message id -- so overlap is the safe direction to err.
      const historyId = await getProfileHistoryId(env);
      await env.DB.prepare(
        'UPDATE mail_sync_state SET history_id = ?, backfill_cursor = ?, last_synced_at = ? WHERE id = 1'
      ).bind(historyId, BACKFILL_START, now).run();
      return jsonResponse({ ok: true, backfillStarted: true, historyId, reason: err.message });
    }
    throw err;
  }

  // The filter that makes the scope promise real: Gmail told us about every
  // thread that changed, and only the ones the site started survive this line.
  const known = await knownThreadIds(env, threadIds);
  const summary = await ingestAll(env, known, siteOrigin, now);

  // Hold the cursor when anything failed, so the next tick sees the same
  // history entries again -- re-ingesting is idempotent, so a retry costs
  // nothing but a fetch. This cannot stall forever: a cursor left in place
  // long enough eventually ages out of Gmail's retention, and the resulting
  // GmailHistoryExpired routes into a backfill that visits every registered
  // thread and repairs whatever was missed.
  if (summary.failed === 0) {
    await env.DB.prepare(
      'UPDATE mail_sync_state SET history_id = ?, last_synced_at = ? WHERE id = 1'
    ).bind(historyId, now).run();
  } else {
    await env.DB.prepare(
      'UPDATE mail_sync_state SET last_synced_at = ? WHERE id = 1'
    ).bind(now).run();
  }

  return jsonResponse({
    ok: true,
    seen: threadIds.length,
    known: known.length,
    ...summary,
    historyId,
    cursorHeld: summary.failed > 0,
  });
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Dispatch-Secret');
  if (!env.MAIL_SYNC_SECRET || secret !== env.MAIL_SYNC_SECRET) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  return runSync(env, new URL(request.url).origin);
};
