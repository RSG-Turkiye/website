// Personal agent tokens: a member's own AI agent acts in the member's name
// through `Authorization: Bearer rsg_pat_...`. What a token may do is worked
// out on every request as its scope intersected with the member's live
// grants, with approve off everywhere, so a role that ends takes the token's
// reach with it and nothing has to sweep the tokens. Only the files listed
// in tests/agent-tokens.test.ts may import this module; getSessionUser
// knows nothing of tokens, so every other endpoint still sees cookies only.

import { jsonResponse, type Env, type User } from './auth';
import { activeGrants } from './role-grants';
import { CMS_GROUPS, ROLES, rightsFromRoles, type CmsGroup, type GroupRights } from './roles';
import { safeEqual } from './secret';
import { routeFor, type AgentLevel, type AgentRoute } from './agent-routes';
import { checkQuota, checkToken, countFailedAuth, ipKey, ipRefusal, readSnapshot, type Charge, type QuotaColumn } from './agent-limits';

export type { AgentLevel, AgentRoute };

export type AgentArea = `cms.${CmsGroup}` | 'social';
export type AgentScope = { area: AgentArea; level: AgentLevel };

const AREAS: readonly AgentArea[] = [...CMS_GROUPS.map((g) => `cms.${g}` as const), 'social'];
const LEVELS: readonly AgentLevel[] = ['read', 'draft'];
const SCOPES = new Map<string, AgentScope>(
  AREAS.flatMap((area) => LEVELS.map((level): [string, AgentScope] => [`${area}:${level}`, { area, level }])),
);

/** Known `area:level` strings only, at least one and at most one per area; anything else is null. */
export function parseScopes(raw: unknown): AgentScope[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: AgentScope[] = [];
  for (const item of raw) {
    const scope = typeof item === 'string' ? SCOPES.get(item) : undefined;
    if (!scope || out.some((s) => s.area === scope.area)) return null;
    out.push(scope);
  }
  return out;
}

export const formatScope = (s: AgentScope): string => `${s.area}:${s.level}`;

const PREFIX = 'rsg_pat_';
const VALUE = /^Bearer (rsg_pat_[A-Za-z0-9_-]{43})$/;

/** `rsg_pat_` and 32 random bytes in base64url (43 characters). */
export function newTokenValue(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const b64 = btoa(String.fromCharCode(...bytes));
  return PREFIX + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** SHA-256 hex. 32 random bytes need no salt or pepper: there is nothing to guess. */
export async function hashToken(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface AgentPrincipal {
  tokenId: string;
  userId: string;
  scopes: AgentScope[];
  route: AgentRoute;
  liveRoles: string[];
  /** In memory only, for the leak check; never logged, stored or returned. */
  value: string;
  /** What this request spends: whether it is social work that may use the agents' reserve, and its quota (agent-limits.ts). */
  charge: (body: string) => Charge;
  /** Set on an MCP message whose tool has a quota: spent with the message, or 'full' (agent-limits.ts). */
  quotaPaid?: QuotaColumn | 'full';
}

/** How the MCP endpoint says what each of its messages spends (mcp-tools.ts, mcpCharge). */
export type ChargeRule = (agent: AgentPrincipal, body: string) => Charge;

/**
 * Social work may use the agents' reserve once the general pool is spent:
 * social routes, and an image upload by a token that may draft social
 * posts. The MCP endpoint decides per message (its ChargeRule), and names
 * the quota of the tool a message calls.
 */
function chargeFor(route: AgentRoute, agent: () => AgentPrincipal, mcp: ChargeRule | undefined): (body: string) => Charge {
  const quota = route.quota;
  if (route.area === 'social') return () => ({ reserve: true, quota });
  if (route.area === 'media') return () => ({ reserve: agentMaySocial(agent(), 'draft'), quota });
  if (route.area === 'mcp' && mcp) return (body) => mcp(agent(), body);
  return () => ({ reserve: false, quota });
}

export type AgentAuth =
  | { kind: 'none' }
  | { kind: 'agent'; user: User; agent: AgentPrincipal }
  | { kind: 'refused'; response: Response };

/** One answer for every authentication failure, so none says which check failed. */
export function unauthorized(): Response {
  const res = jsonResponse({ error: 'Unauthorized', code: 'unauthorized' }, 401);
  res.headers.set('WWW-Authenticate', 'Bearer');
  return res;
}

export const humanOnly = (): Response =>
  jsonResponse({ error: 'This is done by a person in the panel', code: 'human_only' }, 403);

const refused = (response: Response): AgentAuth => ({ kind: 'refused', response });

/** last_used_at is written at most this often, so reads do not each cost a write. */
const LAST_USED_EVERY = 300;

interface TokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  scopes: string;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

function storedScopes(raw: string): AgentScope[] | null {
  try { return parseScopes(JSON.parse(raw)); } catch { return null; }
}

/**
 * Who is asking, when the request carries an Authorization header. With the
 * header present it alone decides: the cookie is ignored, and a bad token is
 * 401 even beside a valid session. Callers skip CSRF on the agent path, since
 * a bearer header is no ambient credential a page could forge.
 *
 * The first statement reads the IP's counters and today's token counters
 * (agent-limits.ts): a cut-off IP is answered 429 before anything else, with
 * no write. A header that is no token value, or a value that matches no
 * token, counts as a failed authentication of the IP. A revoked or expired
 * token's value is 401 without a count: it is a stale client, not a guess,
 * and must not lock out everyone else behind the same address.
 */
export async function authenticateAgent(request: Request, env: Env, now: number, opts: { charge?: ChargeRule } = {}): Promise<AgentAuth> {
  const internal = INTERNAL.get(request);
  if (internal) return authenticateInternal(request, env, internal, now);
  const header = request.headers.get('Authorization');
  if (header === null) return { kind: 'none' };

  const ip = await ipKey(request);
  const snapshot = await readSnapshot(env.DB, ip, now);
  const cutOff = ipRefusal(snapshot.ip, now);
  if (cutOff) return refused(cutOff);

  const match = VALUE.exec(header);
  if (!match) {
    await countFailedAuth(env.DB, ip, now);
    return refused(unauthorized());
  }
  const value = match[1];
  const hash = await hashToken(value);

  const row = await env.DB.prepare('SELECT * FROM agent_tokens WHERE token_hash = ?').bind(hash).first<TokenRow>();
  if (!row || !safeEqual(row.token_hash, hash)) {
    await countFailedAuth(env.DB, ip, now);
    return refused(unauthorized());
  }
  if (row.revoked_at !== null || row.expires_at <= now) return refused(unauthorized());
  const scopes = storedScopes(row.scopes);
  if (!scopes) return refused(unauthorized());
  const stored = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(row.user_id).first<User>();
  if (!stored) return refused(unauthorized());
  const user = withoutRightsColumns(stored);

  const route = routeFor(request.method, new URL(request.url).pathname);
  if (!route) return refused(humanOnly());

  const liveRoles = [...new Set((await activeGrants(env.DB, user.id, now)).map((g) => g.role))];
  const agent: AgentPrincipal = {
    tokenId: row.id, userId: user.id, scopes, route, liveRoles, value,
    charge: chargeFor(route, () => agent, opts.charge),
  };

  // Rate, quota, budget, size and leak checks. A refused request is not a
  // use, so last_used_at below moves only for requests that go on to the handler.
  const limited = await checkToken(env.DB, request, agent, { ip, snapshot }, now);
  if (limited) return refused(limited);

  if (row.last_used_at === null || now - row.last_used_at > LAST_USED_EVERY) {
    await env.DB.prepare('UPDATE agent_tokens SET last_used_at = ? WHERE id = ?').bind(now, row.id).run();
  }
  return { kind: 'agent', user, agent };
}

// The legacy users.is_* columns that mirror a role (is_admin, is_social_publisher
// and the rest; not is_member, which is membership). On the token path they are
// all 0, so no helper that reads them (groupRights, canSocialPublish,
// approvesType) can give a token more than its scope and live grants allow.
const RIGHTS_COLUMNS = ROLES.flatMap((r) => (r.column ? [r.column] : []));

function withoutRightsColumns(user: User): User {
  const out: Record<string, unknown> = { ...user };
  for (const c of RIGHTS_COLUMNS) out[c] = 0;
  return out as unknown as User;
}

// Requests the MCP endpoint builds for a tool call, each with the member and
// principal its own (outer) request authenticated. A WeakMap keyed by the
// Request object: nothing a client sends can put a request in it.
const INTERNAL = new WeakMap<Request, { user: User; agent: AgentPrincipal }>();

/**
 * Marks an in-process request the MCP endpoint is about to hand to a REST
 * handler. authenticateAgent then answers for it without a token lookup and
 * without the rate, size and leak checks, which the outer /api/mcp request
 * already passed and counted once; only the inner route's own quota (write,
 * submit) is spent here, so a tool call that writes counts exactly once.
 */
export function markInternal(request: Request, auth: { user: User; agent: AgentPrincipal }): void {
  INTERNAL.set(request, auth);
}

async function authenticateInternal(request: Request, env: Env, outer: { user: User; agent: AgentPrincipal }, now: number): Promise<AgentAuth> {
  // The table again, on the inner request's own method and path.
  const route = routeFor(request.method, new URL(request.url).pathname);
  if (!route) return refused(humanOnly());
  const agent: AgentPrincipal = { ...outer.agent, route, quotaPaid: undefined };
  // The outer message spent (or found full) this tool's quota: used once.
  const paid = outer.agent.quotaPaid;
  outer.agent.quotaPaid = undefined;
  const limited = await checkQuota(env.DB, agent, now, paid);
  if (limited) return refused(limited);
  return { kind: 'agent', user: outer.user, agent };
}

const reaches = (held: AgentLevel, wanted: AgentLevel) => LEVELS.indexOf(held) >= LEVELS.indexOf(wanted);
const scopeAt = (a: AgentPrincipal, area: AgentArea, level: AgentLevel) =>
  a.scopes.some((s) => s.area === area && reaches(s.level, level));
// A live admin grant, not users.is_admin, so a token's admin reach ends
// exactly when the grant does.
const isAdmin = (liveRoles: readonly string[]) => liveRoles.includes('admin');

/** CMS rights for this request: edit where the scope reaches `level` and the live roles allow it; approve never. */
export function agentGroupRights(a: AgentPrincipal, level: AgentLevel): GroupRights {
  const live = rightsFromRoles(a.liveRoles, isAdmin(a.liveRoles));
  return Object.fromEntries(CMS_GROUPS.map((g) => [
    g, { edit: scopeAt(a, `cms.${g}`, level) && live[g].edit, approve: false },
  ])) as GroupRights;
}

const SOCIAL_ROLES = ['social', 'social_publisher', 'admin'];

/** Social reach for this request. The caller still treats the token as a non-publisher. */
export function agentMaySocial(a: AgentPrincipal, level: AgentLevel): boolean {
  return scopeAt(a, 'social', level) && a.liveRoles.some((r) => SOCIAL_ROLES.includes(r));
}

/** The areas these live roles allow, for deciding which scopes a new token may have. */
export function areasHeld(liveRoles: string[]): AgentArea[] {
  const live = rightsFromRoles(liveRoles, isAdmin(liveRoles));
  return [
    ...CMS_GROUPS.filter((g) => live[g].edit).map((g) => `cms.${g}` as const),
    ...(liveRoles.some((r) => SOCIAL_ROLES.includes(r)) ? ['social' as const] : []),
  ];
}
