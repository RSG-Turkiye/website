/** The few things every /api/social handler does first. */
import type { Env, User } from './auth';
import { getSessionUser, jsonResponse, checkCsrf, canSocialEdit, canSocialPublish } from './auth';
import { authenticateAgent, agentMaySocial, humanOnly, type AgentPrincipal } from './agent-tokens';
import type { Actor } from './social-posts';

/** `agent` is set when a personal agent token is asking (in its member's name). */
export type Gate = { ok: true; user: User; actor: Actor; agent: AgentPrincipal | null } | { ok: false; response: Response };

export async function socialGate(request: Request, env: Env, need: 'edit' | 'publish', mutating: boolean): Promise<Gate> {
  // With an Authorization header the token alone decides; the cookie is ignored.
  const auth = await authenticateAgent(request, env, nowSeconds());
  if (auth.kind === 'refused') return { ok: false, response: auth.response };
  if (auth.kind === 'agent') {
    const { user, agent } = auth;
    // A social route's own area only, as cmsGate checks 'cms': a token's route from elsewhere never passes here.
    if (need === 'publish' || agent.route.area !== 'social') return { ok: false, response: humanOnly() };
    if (!agentMaySocial(agent, agent.route.level)) return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
    // Never a publisher: whatever a token submits waits for a person's approval.
    return { ok: true, user, actor: { id: user.id, isPublisher: false }, agent };
  }
  if (mutating && !checkCsrf(request, env)) return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
  const user = await getSessionUser(request, env);
  if (!user) return { ok: false, response: jsonResponse({ error: 'Not authenticated' }, 401) };
  const allowed = need === 'publish' ? canSocialPublish(user) : canSocialEdit(user);
  if (!allowed) return { ok: false, response: jsonResponse({ error: 'Forbidden' }, 403) };
  return { ok: true, user, actor: { id: user.id, isPublisher: canSocialPublish(user) }, agent: null };
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
