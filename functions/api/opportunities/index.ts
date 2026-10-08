import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { PUBLIC_LIST_SQL } from '../../_lib/opportunity';
import { toPublicItem } from '../../_lib/opportunity-rss';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const u = new URL(request.url);
  const since = Math.max(0, Number(u.searchParams.get('since')) || 0);
  const limit = Math.min(200, Math.max(1, Number(u.searchParams.get('limit')) || 100));
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(PUBLIC_LIST_SQL).bind(now, since, limit).all<Record<string, unknown>>();
  const items = results.map(toPublicItem);
  return jsonResponse({ items }, 200);
};
