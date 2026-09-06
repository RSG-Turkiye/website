import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../_lib/auth';
import {
  submissionText,
  submissionTags,
  submissionImageUrl,
  LIMITS,
} from '../../_lib/blog-submission';

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
  // The same rules the create path uses. This is the path a writer takes to
  // fix a rejected submission, so validating only there would leave the way
  // back in wide open -- which is how an unapprovable row used to survive a
  // rejection and come straight back.
  const title = submissionText(body.title, LIMITS.title, 'Title');
  if (!title.ok) return jsonResponse({ error: title.error }, 400);
  const description = submissionText(body.description, LIMITS.description, 'Description');
  if (!description.ok) return jsonResponse({ error: description.error }, 400);
  const category = submissionText(body.category, LIMITS.category, 'Category');
  if (!category.ok) return jsonResponse({ error: category.error }, 400);
  const author = submissionText(body.author, LIMITS.author, 'Author');
  if (!author.ok) return jsonResponse({ error: author.error }, 400);
  const postBody = submissionText(body.body, LIMITS.body, 'Body');
  if (!postBody.ok) return jsonResponse({ error: postBody.error }, 400);
  const tags = submissionTags(body.tags);
  if (!tags.ok) return jsonResponse({ error: tags.error }, 400);

  if (existing.paired_submission_id && !body.translation) {
    return jsonResponse({ error: 'This is a paired submission -- include the translation to resubmit both languages together' }, 400);
  }
  let translationTagsJson = '[]';
  if (existing.paired_submission_id && body.translation) {
    for (const [raw, max, label] of [
      [body.translation.title, LIMITS.title, 'Translation title'],
      [body.translation.description, LIMITS.description, 'Translation description'],
      [body.translation.body, LIMITS.body, 'Translation body'],
    ] as const) {
      const checked = submissionText(raw, max, label);
      if (!checked.ok) return jsonResponse({ error: checked.error }, 400);
    }
    const translationTags = submissionTags(body.translation.tags);
    if (!translationTags.ok) return jsonResponse({ error: translationTags.error }, 400);
    translationTagsJson = translationTags.value;
  }

  let imageUrl = existing.image_url;
  if (body.image_url !== undefined) {
    const image = submissionImageUrl(body.image_url);
    if (!image.ok) return jsonResponse({ error: image.error }, 400);
    imageUrl = image.value;
  }
  const tagsJson = tags.value;

  // Both halves of a pair go back to 'pending' together or neither does. As
  // two calls, a failure between them left the primary pending and the
  // translation still rejected: the admin list then shows a half-resubmitted
  // pair, and approving the primary picks up the stale rejected translation.
  const updates = [
    env.DB.prepare(
      `UPDATE blog_submissions
       SET title = ?, description = ?, category = ?, tags = ?, author = ?, image_url = ?, body = ?,
           status = 'pending', rejection_reason = NULL
       WHERE id = ?`
    ).bind(title.value, description.value, category.value, tagsJson, author.value, imageUrl, postBody.value, id),
  ];

  if (existing.paired_submission_id && body.translation) {
    const t = body.translation;
    updates.push(
      env.DB.prepare(
        `UPDATE blog_submissions
         SET title = ?, description = ?, category = ?, tags = ?, author = ?, image_url = ?, body = ?,
             status = 'pending', rejection_reason = NULL
         WHERE id = ?`
      ).bind(t.title, t.description, category.value, translationTagsJson, author.value, imageUrl, t.body, existing.paired_submission_id)
    );
  }

  await env.DB.batch(updates);

  return jsonResponse({ ok: true });
};
