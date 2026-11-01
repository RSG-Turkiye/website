import type { Env, User } from './auth';
import { checkCsrf, getSessionUser, jsonResponse } from './auth';
import { groupRights } from './cms-access';
import { publishGuideIndex, type PublishResult } from './guide-index';

/**
 * The gate for the panel's guide endpoints (/api/guide/professors, /labs,
 * /suggestions). People only: these routes are not in agent-routes.ts, and a
 * bearer header is refused here too, so no agent ever reads or writes a
 * professor record (spec, plan Global Constraints). Rehber editors read;
 * approvers and admins write.
 */

export const fail = (status: number, code: string, error: string) => jsonResponse({ error, code }, status);

export type GuideGate =
  | { ok: true; user: User; canWrite: boolean; now: number }
  | { ok: false; response: Response };

export async function guideGate(request: Request, env: Env, mutating: boolean): Promise<GuideGate> {
  if (request.headers.get('Authorization')) return { ok: false, response: fail(403, 'human_only', 'Forbidden') };
  if (mutating && !checkCsrf(request, env)) return { ok: false, response: fail(403, 'csrf', 'Forbidden') };
  const user = await getSessionUser(request, env);
  if (!user) return { ok: false, response: fail(401, 'unauthenticated', 'Not signed in') };
  const now = Math.floor(Date.now() / 1000);
  const rights = (await groupRights(env.DB, user, now)).rehber;
  if (!rights?.edit) return { ok: false, response: fail(403, 'forbidden', 'Forbidden') };
  if (mutating && !rights.approve) return { ok: false, response: fail(403, 'forbidden', 'Forbidden') };
  return { ok: true, user, canWrite: rights.approve, now };
}

export async function readBody(request: Request, max = 64 * 1024): Promise<Record<string, unknown> | null> {
  const text = await request.text();
  if (text.length > max) return null;
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const republish = (env: Env, now: number): Promise<PublishResult> => publishGuideIndex(env as never, now);

/** A string field, trimmed, at most `max` characters; null if missing or too long. */
export function str(v: unknown, max: number, required: boolean): string | null {
  if (v === undefined || v === null) return required ? null : '';
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length > max || (required && !s)) return null;
  return s;
}

export function strList(v: unknown, maxItems: number, maxLen: number): string[] | null {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out: string[] = [];
  for (const x of v) {
    if (typeof x !== 'string' || x.trim().length > maxLen) return null;
    if (x.trim()) out.push(x.trim());
  }
  return out;
}

export const isUrlOrEmpty = (s: string) => s === '' || /^https?:\/\/\S+$/.test(s);
export const isGuideId = (s: unknown, prefix: 'p' | 'l') => typeof s === 'string' && new RegExp(`^${prefix}_[0-9a-f]{12}$`).test(s);
export const isSlug = (s: string) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s);
