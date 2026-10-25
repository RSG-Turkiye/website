// The MCP tools: each one is a REST route of the agent table, called
// in-process with an internal Request, so what a tool may do is exactly what
// that route lets the token do (the same gate, rights, checks and audit).
// There is no tool for anything a person decides (approve, reject, publish,
// schedule, cancel, requeue), and no upload tool: base64 in JSON-RPC would
// multiply the body limit, so images go up over REST (Call 10).

import type { Env, User } from './auth';
import { agentGroupRights, agentMaySocial, markInternal, type AgentPrincipal } from './agent-tokens';
import { routeFor, type AgentRoute } from './agent-routes';
import { holdsValue, refuseLeak } from './agent-limits';
import type { CmsGroup } from './roles';
import * as cmsTypesApi from '../api/cms/types';
import * as cmsEntries from '../api/cms/entries';
import * as cmsEntry from '../api/cms/entry';
import * as cmsDrafts from '../api/cms/drafts';
import * as cmsDraft from '../api/cms/drafts/[id]';
import * as cmsSubmit from '../api/cms/drafts/[id]/submit';
import * as cmsPodcast from '../api/cms/podcast/pull';
import * as socialPosts from '../api/social/posts/index';
import * as socialPost from '../api/social/posts/[id]';
import * as socialSubmit from '../api/social/posts/[id]/submit';
import * as socialPlans from '../api/social/plans/index';
import * as socialPlan from '../api/social/plans/[id]';

type Args = Record<string, unknown>;
type JsonType = 'string' | 'integer' | 'number' | 'boolean' | 'object' | 'array' | 'null';
interface Prop { type: JsonType | JsonType[]; description?: string; enum?: readonly unknown[]; items?: object }
interface InputSchema { type: 'object'; properties: Record<string, Prop>; required?: string[]; additionalProperties: false }

export interface McpTool {
  name: string;
  description: string;
  inputSchema: InputSchema;
  route: {
    method: AgentRoute['method'];
    path: (args: Args) => string;
    query?: (args: Args) => Record<string, string>;
    body?: (args: Args) => unknown;
    /** The handler's route params ([id] files read params.id, not the URL). */
    params?: (args: Args) => Record<string, string>;
  };
  /** Listed only where the member edits this CMS group (a tool for one type). */
  group?: CmsGroup;
  handler: PagesFunction<Env>;
}

const enc = (v: unknown) => encodeURIComponent(String(v));
const byId = (args: Args) => ({ id: String(args.id) });
const without = (args: Args, ...keys: string[]) => Object.fromEntries(Object.entries(args).filter(([k]) => !keys.includes(k)));
const str = (description: string): Prop => ({ type: 'string', description });
const int = (description: string): Prop => ({ type: 'integer', description });
const schema = (properties: Record<string, Prop>, required: string[] = []): InputSchema =>
  ({ type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false });

const DRAFT_ID = str('The draft id (a UUID) from cms_create_draft or cms_list_my_drafts.');
const POST_ID = str('The post id from social_create_post or social_list_my_drafts.');
const PLAN_ID = str('The plan id from social_create_plan or social_list_plans.');
const REVISION = int('The revision of the post as you last read or saved it.');
const RANGE = { from: int('Start, Unix seconds.'), to: int('End, Unix seconds, at most 62 days after from.') };

const PLATFORMS: Prop = { type: 'array', items: { type: 'string', enum: ['instagram', 'linkedin', 'x'] }, description: 'Platforms, each at most once.' };
const POST_FIELDS: Record<string, Prop> = {
  type: { type: 'string', enum: ['image', 'carousel', 'story'], description: 'image, carousel or story.' },
  caption: str('The caption. Stories have none.'),
  captionOverrides: { type: 'object', description: 'A different caption for a platform: { "x": "..." }.' },
  link: { type: ['string', 'null'], description: 'An https link, or null.' },
  media: {
    type: 'array',
    items: { type: 'object', properties: { key: { type: 'string' }, alt: { type: 'string' } }, required: ['key', 'alt'] },
    description: 'Images already uploaded over REST: { key, alt } each, alt text required.',
  },
  platforms: PLATFORMS,
  scheduledAt: { type: ['integer', 'null'], description: 'When it should go out, Unix seconds; a person approves it.' },
};
const PLAN_FIELDS: Record<string, Prop> = {
  title: str('What the post will be about, 1 to 120 characters.'),
  scheduledAt: int('The planned time, Unix seconds, in the future.'),
  platforms: PLATFORMS,
  postType: { type: 'string', enum: ['image', 'carousel', 'story'], description: 'image (default), carousel or story.' },
  assigneeId: { type: ['string', 'null'], description: 'A social editor\'s user id you already have (your member\'s own, or one from a plan), or null.' },
  note: str('A note for the team.'),
};

const tool = (t: McpTool): McpTool => t;

export const MCP_TOOLS: readonly McpTool[] = Object.freeze([
  tool({
    name: 'cms_list_types',
    description: 'The content types your member edits, each with its group and JSON Schema. Read it before writing a draft.',
    inputSchema: schema({}),
    route: { method: 'GET', path: () => '/api/cms/types' },
    handler: cmsTypesApi.onRequestGet,
  }),
  tool({
    name: 'cms_list_entries',
    description: 'The id and title of every published entry of a type, newest first.',
    inputSchema: schema({ type: str('A type key from cms_list_types.') }, ['type']),
    route: { method: 'GET', path: () => '/api/cms/entries', query: (a) => ({ type: String(a.type) }) },
    handler: cmsEntries.onRequestGet,
  }),
  tool({
    name: 'cms_get_entry',
    description: 'A published entry as it is on the site now, with base_shas. Start an update from this and pass base_shas to cms_create_draft.',
    inputSchema: schema({ type: str('A type key from cms_list_types.'), id: str('The entry id from cms_list_entries.') }, ['type', 'id']),
    route: { method: 'GET', path: () => '/api/cms/entry', query: (a) => ({ type: String(a.type), id: String(a.id) }) },
    handler: cmsEntry.onRequestGet,
  }),
  tool({
    name: 'cms_list_my_drafts',
    description: 'Your member\'s drafts (mine), newest first, without their data; and which entries already have a draft in review (live).',
    inputSchema: schema({}),
    route: { method: 'GET', path: () => '/api/cms/drafts' },
    handler: cmsDrafts.onRequestGet,
  }),
  tool({
    name: 'cms_get_draft',
    description: 'One of your member\'s drafts with its data and its current write_nonce.',
    inputSchema: schema({ id: DRAFT_ID }, ['id']),
    route: { method: 'GET', path: (a) => `/api/cms/drafts/${enc(a.id)}`, params: byId },
    handler: cmsDraft.onRequestGet,
  }),
  tool({
    name: 'cms_create_draft',
    description: 'Start a draft. action create: a new entry, with data. update: entry_id, data and the base_shas from cms_get_entry. delete: entry_id and base_shas. Both languages are written as a pair. Counts against the daily write quota, even when refused.',
    inputSchema: schema({
      type: str('A type key from cms_list_types.'),
      action: { type: 'string', enum: ['create', 'update', 'delete'], description: 'create, update or delete.' },
      entry_id: str('The published entry, for update and delete.'),
      data: { type: 'object', description: 'The entry, as the type\'s schema in cms_list_types describes it.' },
      base_shas: { type: 'object', description: 'From cms_get_entry, unchanged. Required for update and delete.' },
    }, ['type', 'action']),
    route: { method: 'POST', path: () => '/api/cms/drafts', body: (a) => a },
    handler: cmsDrafts.onRequestPost,
  }),
  tool({
    name: 'cms_save_draft',
    description: 'Save new data over one of your member\'s drafts. write_nonce is required: the one from cms_get_draft or your last save. 409 draft_changed means a person saved since: read again. A draft whose write_nonce is null can be saved only after a person saves it once in the panel.',
    inputSchema: schema({
      id: DRAFT_ID,
      data: { type: 'object', description: 'The whole entry, as in cms_get_draft.' },
      write_nonce: str('The latest write_nonce of this draft.'),
    }, ['id', 'data', 'write_nonce']),
    route: { method: 'PATCH', path: (a) => `/api/cms/drafts/${enc(a.id)}`, params: byId, body: (a) => without(a, 'id') },
    handler: cmsDraft.onRequestPatch,
  }),
  tool({
    name: 'cms_submit_draft',
    description: 'Send one of your member\'s drafts for approval by a person. Counts against the daily submit quota, even when refused.',
    inputSchema: schema({ id: DRAFT_ID }, ['id']),
    route: { method: 'POST', path: (a) => `/api/cms/drafts/${enc(a.id)}/submit`, params: byId },
    handler: cmsSubmit.onRequestPost,
  }),
  tool({
    name: 'cms_discard_draft',
    description: 'Discard one of your member\'s drafts while it is in draft or rejected status.',
    inputSchema: schema({ id: DRAFT_ID }, ['id']),
    route: { method: 'DELETE', path: (a) => `/api/cms/drafts/${enc(a.id)}`, params: byId },
    handler: cmsDraft.onRequestDelete,
  }),
  tool({
    name: 'cms_pull_podcast',
    description: 'Make a podcast draft from the show\'s feed, when the feed has new episodes. Submit it as any other draft.',
    inputSchema: schema({}),
    route: { method: 'POST', path: () => '/api/cms/podcast/pull' },
    group: 'topluluk',
    handler: cmsPodcast.onRequestPost,
  }),
  tool({
    name: 'social_list_my_drafts',
    description: 'Your member\'s social drafts that have no date yet.',
    inputSchema: schema({}),
    route: { method: 'GET', path: () => '/api/social/posts', query: () => ({ drafts: '1' }) },
    handler: socialPosts.onRequestGet,
  }),
  tool({
    name: 'social_list_posts',
    description: 'Your member\'s posts and published posts dated within a window.',
    inputSchema: schema(RANGE, ['from', 'to']),
    route: { method: 'GET', path: () => '/api/social/posts', query: (a) => ({ from: String(a.from), to: String(a.to) }) },
    handler: socialPosts.onRequestGet,
  }),
  tool({
    name: 'social_get_post',
    description: 'One post with its revision.',
    inputSchema: schema({ id: POST_ID }, ['id']),
    route: { method: 'GET', path: (a) => `/api/social/posts/${enc(a.id)}`, params: byId },
    handler: socialPost.onRequestGet,
  }),
  tool({
    name: 'social_create_post',
    description: 'Make a social draft in your member\'s name. planId links it to a plan without a post. Counts against the daily write quota.',
    inputSchema: schema({ ...POST_FIELDS, planId: str('A plan from social_list_plans that has no post yet.') }, ['type']),
    route: { method: 'POST', path: () => '/api/social/posts', body: (a) => a },
    handler: socialPosts.onRequestPost,
  }),
  tool({
    name: 'social_save_post',
    description: 'Save a whole post (all fields, as in social_get_post) while it is a draft, rejected or waiting for approval. 409 post_changed means read again.',
    inputSchema: schema({ id: POST_ID, revision: REVISION, ...POST_FIELDS }, ['id', 'revision', 'type']),
    route: { method: 'PATCH', path: (a) => `/api/social/posts/${enc(a.id)}`, params: byId, body: (a) => without(a, 'id') },
    handler: socialPost.onRequestPatch,
  }),
  tool({
    name: 'social_submit_post',
    description: 'Send a post for approval. A person approves and schedules it. Counts against the daily submit quota.',
    inputSchema: schema({ id: POST_ID, revision: REVISION }, ['id', 'revision']),
    route: { method: 'POST', path: (a) => `/api/social/posts/${enc(a.id)}/submit`, params: byId, body: (a) => without(a, 'id') },
    handler: socialSubmit.onRequestPost,
  }),
  tool({
    name: 'social_discard_post',
    description: 'Delete your member\'s post while it is a draft or rejected.',
    inputSchema: schema({ id: POST_ID, revision: REVISION }, ['id', 'revision']),
    route: { method: 'DELETE', path: (a) => `/api/social/posts/${enc(a.id)}`, params: byId, body: (a) => without(a, 'id') },
    handler: socialPost.onRequestDelete,
  }),
  tool({
    name: 'social_list_plans',
    description: 'The team\'s post plans dated within a window.',
    inputSchema: schema(RANGE, ['from', 'to']),
    route: { method: 'GET', path: () => '/api/social/plans', query: (a) => ({ from: String(a.from), to: String(a.to) }) },
    handler: socialPlans.onRequestGet,
  }),
  tool({
    name: 'social_create_plan',
    description: 'Plan a post: a title, a time and platforms. Counts against the daily write quota.',
    inputSchema: schema(PLAN_FIELDS, ['title', 'scheduledAt', 'platforms']),
    route: { method: 'POST', path: () => '/api/social/plans', body: (a) => a },
    handler: socialPlans.onRequestPost,
  }),
  tool({
    name: 'social_save_plan',
    description: 'Change a plan: send only the fields that change.',
    inputSchema: schema({ id: PLAN_ID, ...PLAN_FIELDS }, ['id']),
    route: { method: 'PATCH', path: (a) => `/api/social/plans/${enc(a.id)}`, params: byId, body: (a) => without(a, 'id') },
    handler: socialPlan.onRequestPatch,
  }),
  tool({
    name: 'social_delete_plan',
    description: 'Delete a plan your member made, while it has no post.',
    inputSchema: schema({ id: PLAN_ID }, ['id']),
    route: { method: 'DELETE', path: (a) => `/api/social/plans/${enc(a.id)}`, params: byId },
    handler: socialPlan.onRequestDelete,
  }),
]);

/** An id that fits every id pattern of the table, to find each tool's route without arguments. */
const SAMPLE = { id: '00000000-0000-4000-8000-000000000000' };
const routeOf = (t: McpTool) => routeFor(t.route.method, t.route.path(SAMPLE));

/** The tools this token may use now: its scope at the route's level, intersected with the member's live grants. */
export function toolsFor(a: AgentPrincipal): McpTool[] {
  return MCP_TOOLS.filter((t) => {
    const route = routeOf(t);
    if (!route) return false;
    if (route.area === 'cms') {
      const rights = agentGroupRights(a, route.level);
      return t.group ? rights[t.group].edit : Object.values(rights).some((r) => r.edit);
    }
    if (route.area === 'social') return agentMaySocial(a, route.level);
    return false;
  });
}

const typeOf = (v: unknown): JsonType =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v as JsonType;

/** Why these arguments do not fit the tool, or null. Checks the top level of the schema and that the path stays in the table. */
export function argsProblem(t: McpTool, args: unknown): string | null {
  if (typeOf(args) !== 'object') return 'arguments must be an object';
  const a = args as Args;
  const { properties, required = [] } = t.inputSchema;
  for (const key of required) if (a[key] === undefined) return `${key} is required`;
  for (const [key, value] of Object.entries(a)) {
    const prop = properties[key];
    if (!prop) return `unknown argument ${key}`;
    const allowed = Array.isArray(prop.type) ? prop.type : [prop.type];
    const actual = typeOf(value);
    if (!allowed.includes(actual) && !(actual === 'integer' && allowed.includes('number'))) return `${key} must be ${allowed.join(' or ')}`;
    if (prop.enum && !prop.enum.includes(value)) return `${key} must be one of ${prop.enum.join(', ')}`;
  }
  if (!routeFor(t.route.method, t.route.path(a))) return 'not a valid id';
  return null;
}

/**
 * Runs the tool's REST handler in-process on an internal Request with the
 * real REST path, which authenticateAgent recognises (markInternal): the
 * same principal, the route of this path, and only that route's quota.
 */
export async function callTool(
  t: McpTool, args: Args, auth: { user: User; agent: AgentPrincipal },
  ctx: { env: Env; origin: string; authorization: string; waitUntil: (p: Promise<unknown>) => void },
): Promise<{ status: number; body: unknown }> {
  const query = t.route.query ? `?${new URLSearchParams(t.route.query(args))}` : '';
  const payload = t.route.body ? JSON.stringify(t.route.body(args)) : undefined;
  // The outer message was checked for the value already; this is the text
  // the handler will store, so it is checked as written, once more.
  const sent = `${t.route.path(args)}${query}${payload ?? ''}`;
  if (holdsValue(sent, auth.agent.value)) {
    const res = await refuseLeak(ctx.env.DB, auth.agent, Math.floor(Date.now() / 1000));
    return { status: res.status, body: await res.json() };
  }
  const headers: Record<string, string> = { Authorization: ctx.authorization };
  if (payload !== undefined) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = String(new TextEncoder().encode(payload).byteLength);
  }
  const request = new Request(ctx.origin + t.route.path(args) + query, { method: t.route.method, headers, body: payload });
  markInternal(request, auth);
  const res = await t.handler({
    request, env: ctx.env, params: t.route.params?.(args) ?? {}, waitUntil: ctx.waitUntil, data: {},
  } as unknown as Parameters<PagesFunction<Env>>[0]);
  const text = await res.text();
  let body: unknown = text;
  try { body = JSON.parse(text); } catch { /* not JSON: the text as it is */ }
  // A tool result has no headers: the wait a 429 asks for goes into the body.
  const retryAfter = Number(res.headers.get('Retry-After'));
  if (res.status === 429 && retryAfter > 0 && typeof body === 'object' && body !== null && !Array.isArray(body)) {
    body = { ...body, retry_after: retryAfter };
  }
  return { status: res.status, body };
}
