import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse, checkCsrf, generateId } from '../_lib/auth';

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

const TURKISH_CHAR_MAP: Record<string, string> = {
  'ı': 'i', 'İ': 'i', 'ğ': 'g', 'Ğ': 'g', 'ü': 'u', 'Ü': 'u',
  'ş': 's', 'Ş': 's', 'ö': 'o', 'Ö': 'o', 'ç': 'c', 'Ç': 'c',
};

function slugify(title: string): string {
  // Turkish dotless ı (U+0131) has no NFKD canonical decomposition (unlike
  // ö/ğ/ü/ş/ç, which decompose into base+diacritic and get stripped below),
  // so it would otherwise survive untouched and turn into a stray hyphen.
  // Transliterate all six Turkish letter-pairs explicitly first so
  // correctness doesn't depend on Unicode decomposition subtleties.
  const transliterated = title.replace(/[ığĞüÜşŞöÖçÇİ]/g, c => TURKISH_CHAR_MAP[c] ?? c);
  return transliterated
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip any remaining accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
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

  if (!body.lang || !body.title || !body.description || !body.category || !body.author || !body.body) {
    return jsonResponse({ error: 'Missing required field' }, 400);
  }
  if (body.translation && (!body.translation.title || !body.translation.description || !body.translation.body)) {
    return jsonResponse({ error: 'Missing required field in translation' }, 400);
  }

  const slug = slugify(body.title);
  const now = Math.floor(Date.now() / 1000);
  const imageUrl = body.image_url ?? '';
  const tagsJson = JSON.stringify(body.tags ?? []);

  const primaryId = generateId();

  if (!body.translation) {
    await env.DB.prepare(
      `INSERT INTO blog_submissions
        (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      primaryId, user.id, body.lang, body.title, body.description, body.category,
      tagsJson, body.author, imageUrl, body.body, slug, now
    ).run();

    return jsonResponse({ ok: true, id: primaryId });
  }

  const translation = body.translation;
  const pairedId = generateId();
  const pairedTagsJson = JSON.stringify(translation.tags ?? []);

  // paired_submission_id is a self-referencing FK (blog_submissions.id), and
  // D1 enforces foreign keys, so each row must exist before the other
  // references it. Insert the primary row first with no pairing, then the
  // paired row referencing the (now-existing) primary row, then backfill
  // the primary row's own pairing.
  await env.DB.prepare(
    `INSERT INTO blog_submissions
      (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
  ).bind(
    primaryId, user.id, body.lang, body.title, body.description, body.category,
    tagsJson, body.author, imageUrl, body.body, slug, now
  ).run();

  await env.DB.prepare(
    `INSERT INTO blog_submissions
      (id, submitted_by, lang, title, description, category, tags, author, image_url, body, slug, status, created_at, paired_submission_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`
  ).bind(
    pairedId, user.id, translation.lang, translation.title, translation.description, body.category,
    pairedTagsJson, body.author, imageUrl, translation.body, slug, now, primaryId
  ).run();

  await env.DB.prepare(
    'UPDATE blog_submissions SET paired_submission_id = ? WHERE id = ?'
  ).bind(pairedId, primaryId).run();

  return jsonResponse({ ok: true, id: primaryId });
};
