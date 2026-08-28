import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';

type LangPost = {
  title: string;
  description: string;
  tags: string[];
  body: string;
};

type ResubmitBody = LangPost & {
  category: string;
  author: string;
  image_url?: string;
  translation?: LangPost;
};

export const onRequestPatch: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const id = params.id as string;
  const existing = await env.DB.prepare(
    'SELECT id, submitted_by, status, paired_submission_id, image_url FROM blog_submissions WHERE id = ?'
  ).bind(id).first<{ id: string; submitted_by: string; status: string; paired_submission_id: string | null; image_url: string }>();

  if (!existing) return jsonResponse({ error: 'Not found' }, 404);
  if (existing.submitted_by !== user.id) return jsonResponse({ error: 'Forbidden' }, 403);
  if (user.is_writer !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  if (existing.status !== 'rejected') {
    return jsonResponse({ error: 'Only a rejected submission can be edited and resubmitted' }, 400);
  }

  const body = await request.json<ResubmitBody>();
  if (!body.title || !body.description || !body.category || !body.author || !body.body) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }
  if (existing.paired_submission_id && !body.translation) {
    return jsonResponse({ error: 'This is a paired submission -- include the translation to resubmit both languages together' }, 400);
  }
  if (existing.paired_submission_id && body.translation) {
    if (!body.translation.title || !body.translation.description || !body.translation.body) {
      return jsonResponse({ error: 'Missing required field in translation' }, 400);
    }
  }

  const imageUrl = body.image_url !== undefined ? body.image_url : existing.image_url;
  const tagsJson = JSON.stringify(body.tags ?? []);

  await env.DB.prepare(
    `UPDATE blog_submissions
     SET title = ?, description = ?, category = ?, tags = ?, author = ?, image_url = ?, body = ?,
         status = 'pending', rejection_reason = NULL
     WHERE id = ?`
  ).bind(body.title, body.description, body.category, tagsJson, body.author, imageUrl, body.body, id).run();

  if (existing.paired_submission_id && body.translation) {
    const t = body.translation;
    const pairedTagsJson = JSON.stringify(t.tags ?? []);
    await env.DB.prepare(
      `UPDATE blog_submissions
       SET title = ?, description = ?, category = ?, tags = ?, author = ?, image_url = ?, body = ?,
           status = 'pending', rejection_reason = NULL
       WHERE id = ?`
    ).bind(t.title, t.description, body.category, pairedTagsJson, body.author, imageUrl, t.body, existing.paired_submission_id).run();
  }

  return jsonResponse({ ok: true });
};
