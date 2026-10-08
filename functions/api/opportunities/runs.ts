import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Ingest-Secret');
  if (!env.INGEST_SECRET || secret !== env.INGEST_SECRET) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  let body: { started_at?: number; finished_at?: number; sources?: unknown };
  try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON', code: 'bad_request' }, 400); }
  await env.DB.prepare('INSERT INTO opportunity_runs (id, started_at, finished_at, sources) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), body.started_at ?? null, body.finished_at ?? null, JSON.stringify(body.sources ?? {})).run();
  return jsonResponse({ ok: true });
};
