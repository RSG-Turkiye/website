import type { Env } from '../_lib/auth';
import { getSessionUser, jsonResponse, generateId, checkCsrf } from '../_lib/auth';

const VALID_INTERESTS = new Set([
  'Genomics', 'Transcriptomics', 'Single-cell Analysis', 'Spatial Transcriptomics',
  'Metagenomics', 'Microbiome', 'Structural Biology', 'Proteomics',
  'ML & AI', 'Drug Discovery', 'Evolutionary Biology', 'Phylogenetics',
  'Epigenetics', 'Variant Analysis', 'Bioinformatics Education',
]);

const VALID_BADGES = new Set([
  'open_to_work', 'open_to_collaborate', 'open_to_mentor', 'seeking_mentor', 'open_to_review',
]);

const RESERVED_USERNAMES = new Set([
  'admin', 'api', 'auth', 'account', 'login', 'logout', 'members', 'profile', 'settings', 'setup',
]);

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!checkCsrf(request)) return jsonResponse({ error: 'Forbidden' }, 403);
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);

  let body: {
    display_name?: string;
    username?: string;
    institution?: string | null;
    bio?: string | null;
    avatar_url?: string | null;
    interests?: string[];
    badges?: string[];
  };

  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'Invalid request body' }, 400);
  }

  // Validate display name
  const displayName = body.display_name?.trim();
  if (!displayName || displayName.length < 1 || displayName.length > 60) {
    return jsonResponse({ error: 'Display name must be between 1 and 60 characters.' }, 400);
  }

  // Validate username
  const username = body.username?.toLowerCase().trim();
  if (!username || username.length < 3 || username.length > 30 || !/^[a-z0-9_-]+$/.test(username)) {
    return jsonResponse({ error: 'Username must be 3–30 characters: letters, numbers, underscores, hyphens only.' }, 400);
  }
  if (RESERVED_USERNAMES.has(username)) {
    return jsonResponse({ error: 'That username is reserved.' }, 400);
  }

  // Check username uniqueness
  const taken = await env.DB.prepare(
    'SELECT user_id FROM profiles WHERE username = ? AND user_id != ?'
  ).bind(username, user.id).first();
  if (taken) return jsonResponse({ error: 'Username already taken.' }, 409);

  // Validate interests
  const interests = (body.interests ?? []).filter(i => VALID_INTERESTS.has(i));

  // Validate badges
  const badges = (body.badges ?? []).filter(b => VALID_BADGES.has(b));

  const now = Math.floor(Date.now() / 1000);

  // Upsert profile
  const existing = await env.DB.prepare(
    'SELECT user_id FROM profiles WHERE user_id = ?'
  ).bind(user.id).first();

  // Validate avatar_url is a Cloudinary URL if provided
  const avatarUrl = body.avatar_url?.startsWith('https://res.cloudinary.com/')
    ? body.avatar_url
    : null;

  if (existing) {
    await env.DB.prepare(
      `UPDATE profiles SET username=?, display_name=?, institution=?, bio=?, avatar_url=?, updated_at=? WHERE user_id=?`
    ).bind(username, displayName, body.institution ?? null, body.bio ?? null, avatarUrl, now, user.id).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO profiles (user_id, username, display_name, institution, bio, avatar_url, card_template, is_public, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'default', 1, ?)`
    ).bind(user.id, username, displayName, body.institution ?? null, body.bio ?? null, avatarUrl, now).run();
  }

  // Replace interests
  await env.DB.prepare('DELETE FROM user_interests WHERE user_id = ?').bind(user.id).run();
  for (const interest of interests) {
    await env.DB.prepare(
      'INSERT INTO user_interests (user_id, interest) VALUES (?, ?)'
    ).bind(user.id, interest).run();
  }

  // Replace badges
  await env.DB.prepare('DELETE FROM user_badges WHERE user_id = ?').bind(user.id).run();
  for (const badge of badges) {
    await env.DB.prepare(
      'INSERT INTO user_badges (user_id, badge) VALUES (?, ?)'
    ).bind(user.id, badge).run();
  }

  return jsonResponse({ ok: true });
};
