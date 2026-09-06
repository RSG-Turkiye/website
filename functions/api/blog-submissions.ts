import { slugify } from '../_lib/slug';

import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId, getBaseUrl } from '../_lib/auth';
import { notifyNewSubmission } from '../_lib/github';
import {
  submissionText,
  submissionTags,
  submissionImageUrl,
  LIMITS,
} from '../_lib/blog-submission';

/** Filenames become URLs; 80 characters is what this endpoint has always cut at. */
const SLUG_MAX = 80;

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

function toPublicShape(row: SubmissionRow) {
  return {
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
  };
}


type LangPost = {
  title: string;
  description: string;
  tags: string[];
  body: string;
};

type CreateBody = LangPost & {
  lang: 'en' | 'tr';
  category: string;
  author: string;
  image_url?: string;
  translation?: LangPost & { lang: 'en' | 'tr' };
};

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  const result = await env.DB.prepare(
    'SELECT * FROM blog_submissions WHERE submitted_by = ? ORDER BY created_at DESC'
  ).bind(user.id).all<SubmissionRow>();

  return jsonResponse({ submissions: result.results.map(toPublicShape) });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_writer !== 1) return jsonResponse({ error: 'Forbidden' }, 403);

  const body = await request.json<CreateBody>();

  if (body.lang !== 'en' && body.lang !== 'tr') {
    return jsonResponse({ error: 'Invalid lang' }, 400);
  }

  // Every field, by type and by length. Truthiness was the whole check before
  // this, which let a non-array `tags` through and made the submission
  // impossible to approve ever after -- see _lib/blog-submission.ts.
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
  const image = submissionImageUrl(body.image_url);
  if (!image.ok) return jsonResponse({ error: image.error }, 400);
  // Declared out here because the paired INSERT below needs it, and a
  // submission with no translation simply never uses it.
  let translationTagsJson = '[]';
  if (body.translation) {
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
    if (body.translation.lang !== 'en' && body.translation.lang !== 'tr') {
      return jsonResponse({ error: 'Invalid translation lang' }, 400);
    }
    if (body.translation.lang === body.lang) {
      return jsonResponse({ error: 'Translation must be in the other language' }, 400);
    }
  }

  const slug = slugify(title.value, { maxLength: SLUG_MAX });
  const now = Math.floor(Date.now() / 1000);
  const imageUrl = image.value;
  const tagsJson = tags.value;

  const primaryId = generateId();

  if (!body.translation) {
    await env.DB.prepare(
      `INSERT INTO blog_submissions
        (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      primaryId, user.id, body.lang, title.value, description.value, category.value,
      tagsJson, author.value, imageUrl, postBody.value, slug, now
    ).run();

    await notifyNewSubmission(
      `New blog submission: ${title.value}`,
      `Submitted by ${user.email} (${body.lang}).\n\n${description.value}\n\nReview it in the admin panel: ${getBaseUrl(request)}/admin`,
      env
    );

    return jsonResponse({ ok: true, id: primaryId });
  }

  const translation = body.translation;
  const pairedId = generateId();
  // Validated above with the rest of the translation half.
  const pairedTagsJson = translationTagsJson;

  // paired_submission_id is a self-referencing FK (blog_submissions.id), and
  // D1 enforces foreign keys, so each row must exist before the other
  // references it. Insert the primary row first with no pairing, then the
  // paired row referencing the (now-existing) primary row, then backfill
  // the primary row's own pairing. A batch runs its statements in order
  // inside one transaction, so that ordering holds and the three either all
  // land or none do.
  //
  // As three separate calls, a failure at the second or third left the writer
  // with a raw 500 and the database with an unpaired 'pending' row -- or a
  // pair where only one side pointed at the other. They would then submit
  // again, because from the form's point of view nothing happened, and get a
  // second pair. The approve path has been batched for exactly this reason
  // since it was written; these three were not.
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO blog_submissions
        (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      primaryId, user.id, body.lang, title.value, description.value, category.value,
      tagsJson, author.value, imageUrl, postBody.value, slug, now
    ),
    env.DB.prepare(
      `INSERT INTO blog_submissions
        (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at, paired_submission_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
    ).bind(
      pairedId, user.id, translation.lang, translation.title, translation.description, category.value,
      pairedTagsJson, author.value, imageUrl, translation.body, slug, now, primaryId
    ),
    env.DB.prepare(
      'UPDATE blog_submissions SET paired_submission_id = ? WHERE id = ?'
    ).bind(pairedId, primaryId),
  ]);

  await notifyNewSubmission(
    `New blog submission: ${title.value}`,
    `Submitted by ${user.email} (${body.lang} + ${translation.lang} translation).\n\n${description.value}\n\nReview it in the admin panel: ${getBaseUrl(request)}/admin`,
    env
  );

  return jsonResponse({ ok: true, id: primaryId });
};
