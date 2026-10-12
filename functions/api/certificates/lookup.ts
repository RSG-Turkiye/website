// Public: a participant's email -> their unexpired certificates. Called from
// the symposium site's /certificates page in the browser. Email alone is the
// key, by the organisers' decision (see the spec); the rate limit only slows
// bulk probing.
import type { Env } from '../../_lib/auth';
import { corsHeaders, ipHash, normaliseEmail, rateLimited } from '../../_lib/certificates';

function json(request: Request, body: unknown, status = 200): Response {
  const headers = corsHeaders(request);
  headers.set('Content-Type', 'application/json');
  headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

export const onRequestOptions: PagesFunction<Env> = async ({ request }) =>
  new Response(null, { status: 204, headers: corsHeaders(request) });

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let email: string | null = null;
  try {
    const body = JSON.parse(await request.text()) as { email?: unknown };
    if (typeof body?.email === 'string') email = normaliseEmail(body.email);
  } catch {
    email = null;
  }
  if (!email) return json(request, { error: 'Invalid email', code: 'invalid_email' }, 400);

  const now = Math.floor(Date.now() / 1000);
  if (await rateLimited(env.DB, await ipHash(request), now)) {
    return json(request, { error: 'Too many lookups', code: 'rate_limited' }, 429);
  }

  const { results } = await env.DB.prepare(
    `SELECT id, year, kind, name, expires_at FROM symposium_certificates
     WHERE email = ? AND expires_at > ? ORDER BY year DESC, kind`
  ).bind(email, now).all<{ id: string; year: number; kind: string; name: string; expires_at: number }>();

  const origin = new URL(request.url).origin;
  return json(request, {
    certificates: results.map((r) => ({
      id: r.id, year: r.year, kind: r.kind, name: r.name, expiresAt: r.expires_at,
      url: `${origin}/api/certificates/${r.id}.pdf`,
    })),
  });
};
