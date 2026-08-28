import type { Env } from '../../_lib/auth';
import { getSessionUser, jsonResponse } from '../../_lib/auth';

type SubmissionRow = {
  id: string;
  submitted_by: string;
  lang: string;
  title: string;
  description: string;
  category: string;
  tags: string;
  author: string;
  image_url: string;
  body: string;
  slug: string;
  status: string;
  rejection_reason: string | null;
  pr_url: string | null;
  paired_submission_id: string | null;
  created_at: number;
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!user.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const result = await env.DB.prepare(
    `SELECT s.*, u.email AS submitter_email
     FROM blog_submissions s
     JOIN users u ON u.id = s.submitted_by
     ORDER BY s.created_at DESC`
  ).all<SubmissionRow & { submitter_email: string }>();

  return jsonResponse({
    submissions: result.results.map(row => ({
      id: row.id,
      lang: row.lang,
      title: row.title,
      description: row.description,
      category: row.category,
      tags: JSON.parse(row.tags) as string[],
      author: row.author,
      image_url: row.image_url,
      body: row.body,
      slug: row.slug,
      status: row.status,
      rejection_reason: row.rejection_reason,
      pr_url: row.pr_url,
      paired_submission_id: row.paired_submission_id,
      submitter_email: row.submitter_email,
    })),
  });
};
