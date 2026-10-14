/**
 * Looks for new Instagram DMs. Runs from the social tick every minute but
 * acts every five (a 'social_dm' row in dispatch_runs marks each run), or on
 * a publisher's Refresh at most every 30 seconds. Records per conversation
 * only who and when (social_dm_threads), never what was written, then hands
 * over to the notifications.
 */
import type { Env } from './auth';
import { getConnection, markBroken } from './connections';
import { usableToken } from './social/tokens';
import { instagramDm, peerOf } from './social/instagram-dm';
import { startRun, finishRun } from './dispatch-log';
import { runDmNotifications } from './social-dm-notify';
import { DM_SCOPE, POLL_EVERY, REFRESH_MIN_GAP, MAX_THREAD_FETCHES } from './social-dm';

export type DmEnv = Pick<Env, 'DB' | 'TOKEN_ENC_KEY' | 'RSG_MAIL_FROM'> & Partial<Env>;
export interface PollSummary { skipped?: 'paced' | 'not_connected' | 'needs_scope' | 'token'; fetched: number; updated: number; error?: string }

/** The digest and last-call step; tests swap it with setAfterSync. */
export let afterSync: (env: DmEnv, now: number, origin: string) => Promise<void> = async (env, now, origin) => { await runDmNotifications(env, now, origin); };
export function setAfterSync(fn: typeof afterSync): void { afterSync = fn; }

export async function dmStatus(env: DmEnv, now: number): Promise<'ok' | 'not_connected' | 'broken' | 'needs_scope'> {
  const row = await getConnection(env.DB, 'instagram');
  if (!row || !row.access_token_enc) return 'not_connected';
  const scopes = (row.scopes ?? '').split(/[,\s]+/);
  if (!scopes.includes(DM_SCOPE)) return 'needs_scope';
  const tok = await usableToken(env as never, 'instagram', now);
  return tok.ok ? 'ok' : tok.why === 'unused' ? 'not_connected' : 'broken';
}

async function lastRunAt(db: D1Database): Promise<number> {
  const r = await db.prepare(`SELECT MAX(started_at) AS at FROM dispatch_runs WHERE kind = 'social_dm'`).first<{ at: number | null }>();
  return r?.at ?? 0;
}

export async function pollDms(env: DmEnv, now: number, origin: string, opts: { force?: boolean } = {}): Promise<PollSummary> {
  const summary: PollSummary = { fetched: 0, updated: 0 };
  const gap = opts.force ? REFRESH_MIN_GAP : POLL_EVERY;
  if (now - await lastRunAt(env.DB) < gap) return { ...summary, skipped: 'paced' };

  const status = await dmStatus(env, now);
  if (status === 'not_connected') return { ...summary, skipped: 'not_connected' };
  if (status === 'needs_scope') return { ...summary, skipped: 'needs_scope' };
  const tok = await usableToken(env as never, 'instagram', now);
  if (!tok.ok) return { ...summary, skipped: 'token' };

  const runId = await startRun(env.DB, crypto.randomUUID(), now, 'social_dm');
  // Pacing depends on this row; without it the poll would call Meta every minute.
  if (runId === null) return { ...summary, error: 'run log unavailable' };
  try {
    const list = await instagramDm.listConversations(tok.token);
    if (!list.ok) {
      // 'permission' is a messaging-only refusal; it must never halt publishing (R8).
      if (list.kind === 'auth') await markBroken(env.DB, 'instagram', list.reason, now);
      summary.error = `${list.kind}: ${list.reason}`;
      return summary;
    }
    for (const conv of list.conversations) {
      if (summary.fetched >= MAX_THREAD_FETCHES) break;
      const known = await env.DB.prepare(`SELECT id, updated_at FROM social_dm_threads WHERE platform = 'instagram' AND conversation_id = ?`)
        .bind(conv.id).first<{ id: string; updated_at: number }>();
      if (known && known.updated_at >= conv.updatedAt) continue;
      summary.fetched++;
      const th = await instagramDm.thread(tok.token, conv.id, tok.account);
      if (!th.ok) {
        if (th.kind === 'permission') { summary.error = `permission: ${th.reason}`; break; }
        if (th.kind === 'auth') { await markBroken(env.DB, 'instagram', th.reason, now); summary.error = `auth: ${th.reason}`; break; }
        continue;
      }
      const peer = peerOf(th.messages);
      if (!peer || !peer.id) continue;
      const theirs = th.messages.filter((m) => !m.mine).map((m) => m.at);
      const ours = th.messages.filter((m) => m.mine).map((m) => m.at);
      const inbound = theirs.length ? Math.max(...theirs) : null;
      const outbound = ours.length ? Math.max(...ours) : null;
      await env.DB.prepare(`
        INSERT INTO social_dm_threads (id, platform, conversation_id, peer_id, peer_username, last_inbound_at, last_outbound_at, updated_at)
        VALUES (?, 'instagram', ?, ?, ?, ?, ?, ?)
        ON CONFLICT (platform, conversation_id) DO UPDATE SET
          peer_id = excluded.peer_id,
          peer_username = COALESCE(excluded.peer_username, social_dm_threads.peer_username),
          last_inbound_at = MAX(COALESCE(social_dm_threads.last_inbound_at, 0), COALESCE(excluded.last_inbound_at, 0)),
          last_outbound_at = MAX(COALESCE(social_dm_threads.last_outbound_at, 0), COALESCE(excluded.last_outbound_at, 0)),
          updated_at = excluded.updated_at`)
        .bind(known?.id ?? crypto.randomUUID(), conv.id, peer.id, peer.username, inbound, outbound, conv.updatedAt).run();
      summary.updated++;
    }
    await afterSync(env, now, origin);
    return summary;
  } catch (err) {
    summary.error = String(err).slice(0, 300);
    throw err;
  } finally {
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), { candidates: summary.fetched, sent: summary.updated, error: summary.error });
  }
}
