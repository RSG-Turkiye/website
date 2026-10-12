/** The few things every /api/social handler does first. */
import type { Env, User } from './auth';
import { getSessionUser, jsonResponse, checkCsrf, canSocialEdit, canSocialPublish } from './auth';
import type { Actor } from './social-posts';

export type Gate = { ok: true; user: User; actor: Actor } | { ok: false; response: Response };

export async function socialGate(request: Request, env: Env, need: 'edit' | 'publish', mutating: boolean): Promise<Gate> {
  if (mutating && !checkCsrf(request)) return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { ok: false, response: jsonResponse({ error: 'Not authenticated' }, 401) };
  const allowed = need === 'publish' ? canSocialPublish(user) : canSocialEdit(user);
  if (!allowed) return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
  return { ok: true, user, actor: { id: user.id, isPublisher: canSocialPublish(user) } };
}

export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const v: unknown = await request.json();
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const malformed = () => jsonResponse({ error: 'Malformed request', code: 'malformed_request' }, 400);
export const nowSeconds = () => Math.floor(Date.now() / 1000);
export const intParam = (v: string | null): number | null => (v !== null && /^\d{1,12}$/.test(v) ? Number(v) : null);

const MAX_RANGE_SECONDS = 62 * 86400;

/** A calendar window: both ends, in order, at most 62 days apart. */
export function rangeParams(url: URL): { from: number; to: number } | null {
  const from = intParam(url.searchParams.get('from'));
  const to = intParam(url.searchParams.get('to'));
  if (from === null || to === null || to < from || to - from > MAX_RANGE_SECONDS) return null;
  return { from, to };
}
