// GET and POST /oauth/authorize (plan 6): the consent step of the site's own
// OAuth server. GET asks the signed-in member what to allow; POST carries the
// answer. Both validate the request the same way, in this order: session,
// client and redirect URI (an error page, never a redirect: the URI is not
// trusted yet), the OAuth parameters (an error redirect), then the member's
// own reach. The session comes first so an anonymous request never makes
// this Function fetch a CIMD document. Nothing is written before Allow.

import { checkCsrf, getSessionUser, type Env } from '../_lib/auth';
import { areasHeld, parseScopes, formatScope, type AgentArea, type AgentLevel } from '../_lib/agent-tokens';
import { activeGrants } from '../_lib/role-grants';
import { safeNext } from '../_lib/next-path';
import { isLoopbackOrCustom, redirectMatches, resolveClient } from '../_lib/oauth-clients';
import { createCode } from '../_lib/oauth-codes';
import { CONNECTION_DAYS, DEFAULT_DAYS, ISSUER, MAX_CONNECTIONS, isCanonicalResource } from '../_lib/oauth-config';
import { consentLang, consentPage, errorPage, type ConsentArea, type ErrorKey, type Lang } from '../_lib/oauth-consent';

const OAUTH_PARAMS = ['response_type', 'client_id', 'redirect_uri', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource'] as const;
const CHALLENGE = /^[A-Za-z0-9._~-]{43,128}$/;
const MAX_STATE = 512;
const HEADERS = {
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
};

const page = (html: string, status = 200) =>
  new Response(html, { status, headers: { ...HEADERS, 'Content-Type': 'text/html; charset=utf-8' } });
const fail = (lang: Lang, key: ErrorKey) => page(errorPage(lang, key), 400);

/** 303, never 307: a 307 would re-POST the form to the client's callback. The asked string is kept exactly; only the query is added. */
function back(uri: string, answer: Record<string, string | null>): Response {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(answer)) if (v !== null) q.set(k, v);
  q.set('iss', ISSUER);
  return new Response(null, { status: 303, headers: { ...HEADERS, Location: `${uri}${uri.includes('?') ? '&' : '?'}${q}` } });
}

/** Scopes the client asked for, as `area:level` strings we know; unknown values are ignored. */
function requestedLevels(raw: string | null): Map<string, AgentLevel> {
  const out = new Map<string, AgentLevel>();
  for (const tok of (raw ?? '').split(/\s+/)) {
    const s = parseScopes([tok])?.[0];
    if (s && !out.has(s.area)) out.set(s.area, s.level);
  }
  return out;
}

type User = NonNullable<Awaited<ReturnType<typeof getSessionUser>>>;

async function handle(request: Request, env: Env, p: URLSearchParams, posted: boolean, user: User | null): Promise<Response> {
  const lang = consentLang(request, p.get('rsg_lang'));
  if (!user) {
    if (posted) return fail(lang, 'signin');
    const next = safeNext(`/oauth/authorize${new URL(request.url).search}`);
    if (!next) return fail(lang, 'long');
    return new Response(null, { status: 302, headers: { ...HEADERS, Location: `/auth/login?next=${encodeURIComponent(next)}` } });
  }
  if (posted && !checkCsrf(request, env)) return fail(lang, 'request');

  const client = await resolveClient(env.DB, p.get('client_id') ?? '');
  const redirectUri = p.get('redirect_uri');
  if ('error' in client || !redirectUri || !redirectMatches(client.redirectUris, redirectUri)) return fail(lang, 'client');

  const state = p.get('state');
  const echo = state !== null && state.length <= MAX_STATE ? state : null;
  const challenge = p.get('code_challenge') ?? '';
  if (p.get('response_type') !== 'code' || !CHALLENGE.test(challenge) || p.get('code_challenge_method') !== 'S256'
    || (state !== null && state.length > MAX_STATE)) {
    return back(redirectUri, { error: 'invalid_request', state: echo });
  }
  const resource = p.get('resource');
  if (resource !== null && !isCanonicalResource(resource)) return back(redirectUri, { error: 'invalid_target', state: echo });

  if (posted && p.get('action') === 'deny') return back(redirectUri, { error: 'access_denied', state: echo });

  const now = Math.floor(Date.now() / 1000);
  const held = areasHeld((await activeGrants(env.DB, user.id, now)).map((g) => g.role));
  const live = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND kind = 'oauth' AND revoked_at IS NULL AND expires_at > ?`,
  ).bind(user.id, now).first<{ n: number }>();
  const full = (live?.n ?? 0) >= MAX_CONNECTIONS;

  if (posted) {
    if (p.get('action') !== 'allow') return fail(lang, 'request');
    if (full) return fail(lang, 'full');
    const ticked = p.getAll('area').map((area) => `${area}:${p.get(`level_${area}`) ?? ''}`);
    const scopes = parseScopes(ticked);
    if (!scopes || scopes.some((s) => !held.includes(s.area))) return fail(lang, 'area');
    const days = Number(p.get('days'));
    if (!CONNECTION_DAYS.includes(days)) return fail(lang, 'days');
    const code = await createCode(env.DB, {
      userId: user.id, clientId: client.id, label: `${client.name} (${client.host})`.slice(0, 60), redirectUri, codeChallenge: challenge,
      scopes: scopes.map(formatScope), days,
    }, now);
    if (!code) return fail(lang, 'codes');
    return back(redirectUri, { code, state: echo });
  }

  const asked = requestedLevels(p.get('scope'));
  const areas: ConsentArea[] = held.map((area: AgentArea) => ({ area, ticked: asked.has(area), level: asked.get(area) ?? 'draft' }));
  const warn = isLoopbackOrCustom(redirectUri);
  // The scope field is kept through the form only as far as the member holds it (it is never read on POST: the ticked boxes are).
  const kept = areas.filter((a) => a.ticked).map((a) => `${a.area}:${a.level}`).join(' ');
  const other = new URLSearchParams(p);
  if (kept) other.set('scope', kept); else other.delete('scope');
  other.set('rsg_lang', lang === 'tr' ? 'en' : 'tr');
  const fields: [string, string][] = OAUTH_PARAMS.flatMap((k) => {
    const v = k === 'scope' ? kept : p.get(k);
    return v ? [[k, v] as [string, string]] : [];
  });
  fields.push(['rsg_lang', lang]);
  return page(consentPage({
    lang,
    state: full ? 'full' : held.length === 0 ? 'noAreas' : 'form',
    clientName: client.name,
    clientHost: client.kind === 'cimd' ? client.host : null,
    target: warn ? redirectUri : new URL(redirectUri).hostname,
    warn, areas, days: CONNECTION_DAYS, defaultDays: DEFAULT_DAYS, fields,
    langHref: `/oauth/authorize?${other}`,
  }));
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) =>
  handle(request, env, new URL(request.url).searchParams, false, await getSessionUser(request, env));

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  // The session first: an anonymous caller never makes this Function read or parse a body.
  const user = await getSessionUser(request, env);
  if (!user) return fail(consentLang(request, null), 'signin');
  let form: FormData;
  try { form = await request.formData(); } catch { return fail(consentLang(request, null), 'request'); }
  const p = new URLSearchParams();
  for (const [k, v] of form.entries()) if (typeof v === 'string') p.append(k, v);
  return handle(request, env, p, true, user);
};
