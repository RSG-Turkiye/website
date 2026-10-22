// The admin Statistics section. Admins only, counts only: nothing here says
// who did anything. ?year= picks the year; the current year compares this
// month, last month, this year and last year, an earlier year compares
// itself with the year before.
import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';
import { appendAudit } from '../../_lib/audit';
import { d1Stats, periodsFor, trYear } from '../../_lib/stats';
import { configured, siteVisits, type AnalyticsEnv } from '../../_lib/web-analytics';

export const onRequestGet: PagesFunction<Env & AnalyticsEnv> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const now = Math.floor(Date.now() / 1000);
  const current = trYear(now);
  const raw = new URL(request.url).searchParams.get('year');
  const year = raw && /^\d{4}$/.test(raw) ? Number(raw) : current;
  if (year < 2015 || year > current) return jsonResponse({ error: 'Invalid year', code: 'invalid_year' }, 400);

  const periods = periodsFor(year, now);
  const [stats, visits] = await Promise.all([
    d1Stats(env.DB, periods),
    configured(env)
      ? Promise.all([siteVisits(env, 'main', periods, now), siteVisits(env, 'symposium', periods, now)])
        .then(([main, symposium]) => ({ main, symposium }))
      : Promise.resolve(null),
  ]);

  await appendAudit(env.DB, { userId: user.id, action: 'read.stats' }, now);
  return jsonResponse({
    year,
    periods: periods.map((p) => ({ key: p.key, from: p.from, to: p.to })),
    ...stats,
    visits,
  });
};
