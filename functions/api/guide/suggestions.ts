import type { Env } from '../../_lib/auth';
import { jsonResponse } from '../../_lib/auth';
import { runWithAudit } from '../../_lib/audit';
import { deleteProfessor } from '../../_lib/guide-db';
import { guideGate, fail, readBody, republish, isGuideId } from '../../_lib/guide-api';

/**
 * The guide's suggestion queue (Google Form responses imported nightly by
 * /api/admin/guide/import). Rehber editors read it; approvers act. Nothing is
 * applied from a form row by itself: a person makes the change in the editor
 * and marks the row done (spec: "insan onayı önemli"). A removal request is
 * the one exception that is a single click, and it deletes every queue row
 * about that professor along with the record.
 */

interface Row { id: number; record_id: string; kind: string; payload: string; status: string; count: number; created_at: number }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, false);
  if (!gate.ok) return gate.response;
  const { results } = await env.DB.prepare(
    `SELECT id, record_id, kind, payload, status, count, created_at FROM intake_rows
     WHERE source = 'guide' AND status = 'new'
     ORDER BY CASE kind WHEN 'removal' THEN 0 ELSE 1 END, created_at, id`,
  ).all<Row>();
  const state = await env.DB.prepare('SELECT checked_at, result, added FROM intake_state WHERE id = 1').first();
  const unreadable = await env.DB.prepare('SELECT url, failures FROM guide_page_watch WHERE failures >= 3 AND muted = 0 ORDER BY url').all<{ url: string; failures: number }>();
  const muted = await env.DB.prepare('SELECT url FROM guide_page_watch WHERE muted = 1 ORDER BY url').all<{ url: string }>();
  return jsonResponse({
    rows: (results ?? []).map((r) => ({ id: r.id, recordId: r.record_id, kind: r.kind, count: r.count, createdAt: r.created_at, ...JSON.parse(r.payload || '{}') })),
    state,
    watch: { unreadable: unreadable.results ?? [], muted: (muted.results ?? []).map((m) => m.url) },
    canWrite: gate.canWrite,
  });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const gate = await guideGate(request, env, true);
  if (!gate.ok) return gate.response;
  const body = await readBody(request);
  const id = Number(body?.id);
  const action = body?.action;
  if (!Number.isInteger(id) || !['done', 'discard', 'applyRemoval'].includes(String(action))) return fail(400, 'bad_request', 'Expected { id, action }');
  const row = await env.DB.prepare("SELECT id, record_id, kind, status FROM intake_rows WHERE id = ? AND source = 'guide'").bind(id).first<Row>();
  if (!row || row.status !== 'new') return fail(404, 'not_found', 'No such open suggestion');

  if (action === 'applyRemoval') {
    if (row.kind !== 'removal' || !isGuideId(row.record_id, 'p')) return fail(400, 'not_removal', 'This row is not a removal request for a professor');
    // One batch: the record, every queue row about it, and the audit row.
    await deleteProfessor(env.DB, row.record_id, gate.user.id, gate.now, 'guide.suggestion.removal');
    return jsonResponse({ ok: true, publish: await republish(env, gate.now) });
  }

  const status = action === 'done' ? 'done' : 'discarded';
  // A removal request's text usually names the person: it is not kept once handled.
  const set = action === 'discard' || row.kind === 'removal' ? ", payload = '{}'" : '';
  await runWithAudit(env.DB, [env.DB.prepare(`UPDATE intake_rows SET status = ?, handled_at = ?${set} WHERE id = ?`).bind(status, gate.now, id)],
    { userId: gate.user.id, action: `guide.suggestion.${status}`, targetType: 'intake_row', targetId: String(id) }, gate.now);
  // A handled page change may lift a public "do not rely on this" warning.
  if (row.kind === 'page_changed') return jsonResponse({ ok: true, publish: await republish(env, gate.now) });
  return jsonResponse({ ok: true });
};
