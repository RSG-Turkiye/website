// The complete list of what an agent token may call. Any other method and
// path that carries an Authorization header is refused 403 human_only by
// functions/api/_middleware.ts before a handler runs, and authenticateAgent
// checks this table again. A panel area joins by adding its draft-level
// routes here and nothing else; approve, publish, send and everything a
// person decides stay out (CLAUDE.md rules 5 and 10).

export type AgentLevel = 'read' | 'draft';

export interface AgentRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  /** Anchored, and matched against the URL's pathname as it arrived (still percent-encoded). */
  pattern: RegExp;
  area: 'cms' | 'social' | 'media' | 'mcp';
  level: AgentLevel;
  quota?: 'write' | 'submit' | 'upload';
}

// crypto.randomUUID(), as generateId makes every draft, post and plan id.
// Lower case only: a path that differs in any way is not in the table.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// Social ids are UUIDs today; this also takes any plain id without a slash
// or an escape, so a path can never step into another route.
const ID = '[A-Za-z0-9_-]{1,64}';

const r = (method: AgentRoute['method'], path: string, area: AgentRoute['area'], level: AgentLevel, quota?: AgentRoute['quota']): AgentRoute =>
  Object.freeze({ method, pattern: new RegExp(`^${path}$`), area, level, ...(quota ? { quota } : {}) });

export const AGENT_ROUTES: readonly AgentRoute[] = Object.freeze([
  r('GET', '/api/cms/types', 'cms', 'read'),
  r('GET', '/api/cms/entries', 'cms', 'read'),
  r('GET', '/api/cms/entry', 'cms', 'read'),
  r('GET', '/api/cms/drafts', 'cms', 'read'),
  r('POST', '/api/cms/drafts', 'cms', 'draft', 'write'),
  r('GET', `/api/cms/drafts/${UUID}`, 'cms', 'read'),
  r('PATCH', `/api/cms/drafts/${UUID}`, 'cms', 'draft', 'write'),
  r('DELETE', `/api/cms/drafts/${UUID}`, 'cms', 'draft', 'write'),
  r('POST', `/api/cms/drafts/${UUID}/submit`, 'cms', 'draft', 'submit'),
  r('POST', '/api/cms/podcast/pull', 'cms', 'draft', 'write'),
  r('GET', '/api/social/posts', 'social', 'read'),
  r('POST', '/api/social/posts', 'social', 'draft', 'write'),
  r('GET', `/api/social/posts/${ID}`, 'social', 'read'),
  r('PATCH', `/api/social/posts/${ID}`, 'social', 'draft', 'write'),
  r('DELETE', `/api/social/posts/${ID}`, 'social', 'draft', 'write'),
  r('POST', `/api/social/posts/${ID}/submit`, 'social', 'draft', 'submit'),
  r('GET', '/api/social/plans', 'social', 'read'),
  r('POST', '/api/social/plans', 'social', 'draft', 'write'),
  r('PATCH', `/api/social/plans/${ID}`, 'social', 'draft', 'write'),
  r('DELETE', `/api/social/plans/${ID}`, 'social', 'draft', 'write'),
  r('POST', '/api/blog-submissions/upload-image', 'media', 'draft', 'upload'),
  r('GET', '/api/mcp', 'mcp', 'read'),
  r('POST', '/api/mcp', 'mcp', 'read'),
]);

/** The route a token may call for this method and path, or null: refused. */
export function routeFor(method: string, pathname: string): AgentRoute | null {
  return AGENT_ROUTES.find((route) => route.method === method && route.pattern.test(pathname)) ?? null;
}
