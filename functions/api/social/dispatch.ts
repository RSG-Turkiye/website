import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { safeEqual } from '../../_lib/secret';
import { startRun, finishRun } from '../../_lib/dispatch-log';
import { dispatchSocial } from '../../_lib/social-dispatcher';

/**
 * The social tick. workers/mail-cron calls it every minute with the same
 * X-Dispatch-Secret it sends to /api/mail/dispatch. Each run is recorded in
 * dispatch_runs as kind 'social', so the banner notices a stopped scheduler.
 */
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Dispatch-Secret'), env.MAIL_SYNC_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const runId = await startRun(env.DB, crypto.randomUUID(), now, 'social');
  try {
    const summary = await dispatchSocial(env, now, new URL(request.url).origin);
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), {
      candidates: summary.candidates, planned: summary.claimed, sent: summary.published, failed: summary.failed, retried: summary.waiting,
    });
    return jsonResponse({ ok: true, ...summary });
  } catch (err) {
    await finishRun(env.DB, runId, Math.floor(Date.now() / 1000), { error: String(err).slice(0, 300) });
    console.error('social dispatch failed', err);
    return jsonResponse({ error: 'Dispatch failed', code: 'dispatch_failed' }, 500);
  }
};
