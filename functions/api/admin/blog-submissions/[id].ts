import type { Env } from '../../../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf } from '../../../_lib/auth';
import { openContentPR, fileExistsOnBaseBranch } from '../../../_lib/github';

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
  paired_submission_id: string | null;
};

type ActionBody =
  | { action: 'approve'; slug?: string }
  | { action: 'reject'; reason: string };

function buildFrontmatter(row: SubmissionRow, now: number): string {
  const pubDate = new Date(now * 1000).toISOString().slice(0, 10);
  const tags = JSON.parse(row.tags) as string[];
  const lines = [
    '---',
    `title: ${JSON.stringify(row.title)}`,
    `pubDate: ${pubDate}`,
    `description: ${JSON.stringify(row.description)}`,
    `author: ${JSON.stringify(row.author)}`,
    `category: ${JSON.stringify(row.category)}`,
    `tags: [${tags.map(t => JSON.stringify(t)).join(', ')}]`,
    `image: ${JSON.stringify(row.image_url)}`,
    'draft: false',
    'type: "post"',
    '---',
    '',
    row.body,
    '',
  ];
  return lines.join('\n');
}

export const onRequestPatch: PagesFunction<Env> = async ({ request, params, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const admin = await getSessionUser(request, env);
  if (!admin) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (!admin.is_admin) return jsonResponse({ error: 'Forbidden' }, 403);

  const id = params.id as string;
  const row = await env.DB.prepare(
    `SELECT s.*, u.email AS submitter_email
     FROM blog_submissions s
     JOIN users u ON u.id = s.submitted_by
     WHERE s.id = ?`
  ).bind(id).first<SubmissionRow & { submitter_email: string }>();
  if (!row) return jsonResponse({ error: 'Not found' }, 404);

  const body = await request.json<ActionBody>();

  if (body.action === 'reject') {
    if (!body.reason) return jsonResponse({ error: 'A rejection reason is required' }, 400);
    const now = Math.floor(Date.now() / 1000);
    const rejectStatements = [
      env.DB.prepare(
        `UPDATE blog_submissions SET status = 'rejected', rejection_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
      ).bind(body.reason, now, admin.id, id),
    ];
    if (row.paired_submission_id) {
      rejectStatements.push(
        env.DB.prepare(
          `UPDATE blog_submissions SET status = 'rejected', rejection_reason = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
        ).bind(body.reason, now, admin.id, row.paired_submission_id)
      );
    }
    await env.DB.batch(rejectStatements);
    return jsonResponse({ ok: true });
  }

  if (body.action !== 'approve') return jsonResponse({ error: 'Unknown action' }, 400);

  const slug = body.slug ?? row.slug;
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    return jsonResponse({ error: 'Invalid slug — use only lowercase letters, numbers, and hyphens' }, 400);
  }
  let pairedRow: SubmissionRow | null = null;
  if (row.paired_submission_id) {
    pairedRow = await env.DB.prepare('SELECT * FROM blog_submissions WHERE id = ?')
      .bind(row.paired_submission_id).first<SubmissionRow>();
  }

  const filesToCheck = pairedRow
    ? [`src/content/blog/${row.lang}/${slug}.md`, `src/content/blog/${pairedRow.lang}/${slug}.md`]
    : [`src/content/blog/${row.lang}/${slug}.md`];

  for (const path of filesToCheck) {
    try {
      if (await fileExistsOnBaseBranch(path, env)) {
        return jsonResponse({ error: `A file already exists at ${path} -- choose a different slug` }, 409);
      }
    } catch (e) {
      return jsonResponse({ error: e instanceof Error ? e.message : 'GitHub check failed' }, 502);
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const files = pairedRow
    ? [
        { path: `src/content/blog/${row.lang}/${slug}.md`, content: buildFrontmatter({ ...row, slug }, now) },
        { path: `src/content/blog/${pairedRow.lang}/${slug}.md`, content: buildFrontmatter({ ...pairedRow, slug }, now) },
      ]
    : [{ path: `src/content/blog/${row.lang}/${slug}.md`, content: buildFrontmatter({ ...row, slug }, now) }];

  const result = await openContentPR(
    {
      branchPrefix: 'blog-submission',
      branchSlug: slug,
      files,
      title: `New blog post: ${row.title}`,
      prBody: `Submitted by ${row.submitter_email}, approved by ${admin.email}.\n\n${row.description}`,
    },
    env
  );

  if (!result.success) {
    return jsonResponse({ error: result.error }, 502);
  }

  // Batch both UPDATEs into one D1 call so they succeed or fail together --
  // two separate unguarded .run() calls here would risk the second one
  // throwing (a raw 500) and leaving the pair desynced (primary approved
  // with the real PR, pair still at its prior status) even though the PR
  // itself has already succeeded by this point.
  const updateStatements = [
    env.DB.prepare(
      `UPDATE blog_submissions SET status = 'approved', pr_url = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
    ).bind(result.prUrl, now, admin.id, id),
  ];
  if (pairedRow) {
    updateStatements.push(
      env.DB.prepare(
        `UPDATE blog_submissions SET status = 'approved', pr_url = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?`
      ).bind(result.prUrl, now, admin.id, pairedRow.id)
    );
  }

  try {
    await env.DB.batch(updateStatements);
  } catch (e) {
    // The PR already exists and succeeded at this point -- a DB bookkeeping
    // failure here shouldn't be reported as if the approval itself failed.
    return jsonResponse({
      ok: true,
      pr_url: result.prUrl,
      warning: 'PR opened successfully, but updating the submission record failed — it may still show as pending.',
    });
  }

  return jsonResponse({ ok: true, pr_url: result.prUrl });
};
