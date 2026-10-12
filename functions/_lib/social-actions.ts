import type { Env } from './auth';
import { jsonResponse } from './auth';
import { socialGate, readBody, malformed, nowSeconds, type Gate } from './social-api';
import { loadPost } from './social-post-read';
import { rowToDraft, type PostRow } from './social-posts';
import { notificationText, notifyEach, publisherEmails, postLabel, type NotifyKind } from './social-notify';

type Ok = { gate: Extract<Gate, { ok: true }>; row: PostRow & { plan_title?: string | null; author_email?: string | null }; body: Record<string, unknown>; revision: number; now: number };

/** Session, role, CSRF, the post, and the revision the caller acted on. */
export async function prepareAction(
  request: Request, env: Env, id: string, need: 'edit' | 'publish',
): Promise<{ ok: true; value: Ok } | { ok: false; response: Response }> {
  const gate = await socialGate(request, env, need, true);
  if (!gate.ok) return gate;
  const found = await loadPost(env.DB, env, id);
  if (!found) return { ok: false, response: jsonResponse({ error: 'Not found', code: 'not_found' }, 404) };
  const body = await readBody(request);
  if (!body) return { ok: false, response: malformed() };
  const revision = body.revision;
  if (typeof revision !== 'number' || !Number.isInteger(revision) || revision < 0) return { ok: false, response: malformed() };
  // Handlers decide on this exact row, so the client must have read exactly it.
  if (revision !== found.row.revision) return { ok: false, response: lostRace() };
  return { ok: true, value: { gate, row: found.row as Ok['row'], body, revision, now: nowSeconds() } };
}

export const lostRace = () => jsonResponse({ error: 'Someone changed this post in the meantime', code: 'post_changed' }, 409);

/** Fire-and-forget: never awaited by the response, never allowed to throw. */
export function notifyLater(
  ctx: { waitUntil(p: Promise<unknown>): void }, env: Env, request: Request, kind: NotifyKind,
  row: Ok['row'], to: 'publishers' | 'author', extra: { actor?: string; note?: string } = {},
): void {
  const work = (async () => {
    const d = rowToDraft(row);
    const label = postLabel(d.caption, row.plan_title ?? null);
    const panelUrl = `${new URL(request.url).origin}/admin`;
    const message = notificationText(kind, { label, when: d.scheduledAt, panelUrl, ...extra });
    const emails = to === 'publishers' ? await publisherEmails(env.DB) : row.author_email ? [row.author_email] : [];
    await notifyEach(env, emails, message);
  })().catch((err) => console.error('social notification failed', err));
  ctx.waitUntil(work);
}
