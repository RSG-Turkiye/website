import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { upsertStatements, validateIngestItem } from '../../_lib/opportunity';

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const secret = request.headers.get('X-Ingest-Secret');
  if (!env.INGEST_SECRET || secret !== env.INGEST_SECRET) return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  let body: { items?: unknown[] };
  try { body = await request.json(); } catch { return jsonResponse({ error: 'invalid JSON', code: 'bad_request' }, 400); }
  const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
  const now = Math.floor(Date.now() / 1000);
  const rejected: { index: number; error: string }[] = [];
  const statements: D1PreparedStatement[] = [];
  items.forEach((raw, index) => {
    const v = validateIngestItem(raw);
    if (!v.ok) { rejected.push({ index, error: v.error }); return; }
    const { sql, values } = upsertStatements(v.item, now, crypto.randomUUID());
    statements.push(env.DB.prepare(sql).bind(...values));
  });
  if (statements.length) await env.DB.batch(statements);
  return jsonResponse({ ingested: statements.length, rejected });
};
