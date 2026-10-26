// Dynamic client registration (RFC 7591) for agents that cannot use a
// metadata-document client id. Open to anyone, so it is capped per IP and
// per day, reads at most 8 KB, fetches nothing the client names, and writes
// one row. Every success carries a client_id and a client_secret.
import type { Env } from '../_lib/auth';
import { jsonResponse } from '../_lib/auth';
import { ipKey, readCapped, registrationBumps, registrationGuard, registrationRefusal } from '../_lib/agent-limits';
import { parseRegistration, registerStatement } from '../_lib/oauth-clients';
import { cors, preflight } from '../_lib/oauth-metadata';

const MAX_BODY = 8 * 1024;

/** The answer, with CORS (no cookies here) and never cached: it can hold a secret. */
function reply(res: Response): Response {
  res.headers.set('Cache-Control', 'no-store');
  return cors(res);
}

const invalid = (error: 'invalid_redirect_uri' | 'invalid_client_metadata', error_description: string) =>
  reply(jsonResponse({ error, error_description }, 400));

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!(request.headers.get('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    return invalid('invalid_client_metadata', 'Send the metadata as application/json.');
  }
  const text = await readCapped(request, MAX_BODY);
  if (text === null) return invalid('invalid_client_metadata', 'The body may be at most 8 KB.');
  const now = Math.floor(Date.now() / 1000);
  const ip = await ipKey(request);
  const refused = await registrationRefusal(env.DB, ip, now);
  if (refused) return reply(refused);

  let body: unknown;
  try { body = JSON.parse(text); } catch { return invalid('invalid_client_metadata', 'The body is not valid JSON.'); }
  const parsed = parseRegistration(body);
  if (!parsed.ok) return invalid(parsed.error, parsed.description);

  const { statement, id, secret } = await registerStatement(env.DB, {
    name: parsed.name, redirectUris: parsed.redirectUris, authMethod: parsed.authMethod, now,
    guard: registrationGuard(ip, now),
  });
  const results = await env.DB.batch([statement, ...registrationBumps(env.DB, ip, now, true)]);
  // The guard held back the insert: a parallel request took the last slot.
  if (!results[0].meta.changes) {
    const again = await registrationRefusal(env.DB, ip, now);
    if (again) return reply(again);
    const res = jsonResponse({ error: 'rate_limited' }, 429);
    res.headers.set('Retry-After', '60');
    return reply(res);
  }
  return reply(jsonResponse({
    client_id: id,
    client_secret: secret,
    client_id_issued_at: now,
    client_secret_expires_at: 0,
    client_name: parsed.name,
    redirect_uris: parsed.redirectUris,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: parsed.authMethod,
  }, 201));
};

export const onRequestOptions: PagesFunction = () => preflight();
