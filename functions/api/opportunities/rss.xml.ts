import type { Env } from '../../_lib/auth';
import { PUBLIC_LIST_SQL } from '../../_lib/opportunity';
import { renderRss, toPublicItem } from '../../_lib/opportunity-rss';

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const now = Math.floor(Date.now() / 1000);
  const { results } = await env.DB.prepare(PUBLIC_LIST_SQL).bind(now, 0, 100).all<Record<string, unknown>>();
  const items = results.map(toPublicItem);
  return new Response(renderRss(items, 'https://rsg-turkiye.iscbsc.org'), {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Cache-Control': 'public, max-age=900' },
  });
};
