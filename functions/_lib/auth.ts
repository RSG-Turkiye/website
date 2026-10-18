export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  GITHUB_PAT: string;
  GITHUB_NOTIFY_USERNAME: string;
  BLOG_IMAGES: R2Bucket;
  PUBLIC_BLOG_IMAGES_URL: string;
  GMAIL_REFRESH_TOKEN: string;
  RSG_MAIL_FROM: string;
  MAIL_SYNC_SECRET: string;
  MAIL_ATTACHMENTS: R2Bucket;
  SYMPOSIUM_DEPLOY_HOOK: string;
  /** Shared with the symposium-cron Worker's own copy of the same value --
   * see functions/api/admin/symposium/archive.ts, gated the same way
   * MAIL_SYNC_SECRET gates /api/mail/dispatch. */
  SYMPOSIUM_ARCHIVE_SECRET: string;
  /** 32 random bytes, base64. Encrypts platform tokens in D1 -- see token-vault.ts. */
  TOKEN_ENC_KEY?: string;
  /** The Gmail account the site sends from, when RSG_MAIL_FROM is a send-as alias of it. Defaults to RSG_MAIL_FROM. */
  GMAIL_ACCOUNT?: string;
  /** Instagram app (Meta dashboard, Instagram > API setup with Instagram login). Both are Pages secrets. */
  INSTAGRAM_APP_ID?: string;
  INSTAGRAM_APP_SECRET?: string;
  /** LinkedIn app (developer.linkedin.com, Community Management API). Pages secrets. */
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  /** The Page's public vanity name (linkedin.com/company/<this>); a [vars] entry. */
  LINKEDIN_ORGANIZATION?: string;
  /** X app (console.x.com, OAuth 2.0, confidential client). Pages secrets. */
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
}

export interface User {
  id: string;
  google_id: string;
  email: string;
  is_member: number;
  is_admin: number;
  is_announcer: number;
  is_writer: number;
  is_sender: number;
  is_symposium: number;
  is_social: number;
  is_social_publisher: number;
  created_at: number;
  last_login: number;
}

export interface Profile {
  user_id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  institution: string | null;
  card_template: string;
  bio: string | null;
  is_public: number;
  updated_at: number;
}

const SESSION_COOKIE = 'rsg_session';
export const SESSION_DURATION = 60 * 60 * 24 * 30; // 30 days in seconds

export function generateId(): string {
  return crypto.randomUUID();
}

export function sessionCookie(token: string, expires: Date): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

/**
 * A readable companion to the session cookie, which pages cannot see because
 * it is HttpOnly. It says only "there may be a session", never whose: the
 * header uses it to skip /api/me for visitors who are not signed in, so their
 * page views make no request and show Join and Sign in at once. Every
 * decision that matters still reads the real session on the server.
 */
export const SIGNED_IN_MARKER = 'rsg_signed_in';

export function signedInMarker(expires: Date): string {
  return `${SIGNED_IN_MARKER}=1; Path=/; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

export function clearSignedInMarker(): string {
  return `${SIGNED_IN_MARKER}=; Path=/; Secure; SameSite=Lax; Max-Age=0`;
}

export const hasSignedInMarker = (request: Request): boolean =>
  new RegExp(`(?:^|;\\s*)${SIGNED_IN_MARKER}=1(?:;|$)`).test(request.headers.get('Cookie') ?? '');

export async function getSessionUser(request: Request, env: Env): Promise<User | null> {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;

  const sessionId = match[1];
  const now = Math.floor(Date.now() / 1000);

  const session = await env.DB.prepare(
    'SELECT user_id FROM sessions WHERE id = ? AND expires_at > ?'
  ).bind(sessionId, now).first<{ user_id: string }>();

  if (!session) return null;

  const user = await env.DB.prepare(
    'SELECT * FROM users WHERE id = ?'
  ).bind(session.user_id).first<User>();

  return user ?? null;
}

export async function createSession(userId: string, env: Env): Promise<{ token: string; expires: Date }> {
  const token = generateId();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_DURATION;
  const expires = new Date((now + SESSION_DURATION) * 1000);

  // Rows were only ever inserted. Nothing read an expired session -- every
  // lookup filters on expires_at -- so this was not a security hole, it was a
  // table that grows by one row per sign-in for ever and is never smaller.
  //
  // Signing in is the natural moment to sweep: it is the only time this table
  // is written, it happens often enough that the table stays small and rarely
  // enough to cost nothing, and it needs no cron and no coupling to the mail
  // dispatcher's tick. The delete runs first so a failure surfaces here rather
  // than after a session the caller is about to be handed.
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now).run();

  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)'
  ).bind(token, userId, expiresAt, now).run();

  return { token, expires };
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function redirectResponse(url: string, headers?: Record<string, string>): Response {
  return new Response(null, {
    status: 302,
    headers: { Location: url, ...headers },
  });
}

export function getBaseUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function getSessionDuration() {
  return SESSION_DURATION;
}

export function canManageAnnouncements(user: Pick<User, 'is_admin' | 'is_announcer'>): boolean {
  return user.is_admin === 1 || user.is_announcer === 1;
}

/**
 * The only place `is_symposium` is read. Everything that gates symposium
 * editing calls this, so when the role model is reworked -- which is
 * expected -- this function is the whole of the change.
 */
export function canManageSymposium(user: Pick<User, 'is_admin' | 'is_symposium'>): boolean {
  return user.is_admin === 1 || user.is_symposium === 1;
}

/**
 * Social media roles. A publisher is always an editor as well, even if
 * is_social was never set on the row: publish is the larger permission and
 * must not depend on the smaller flag having been set in the same request.
 */
export function canSocialEdit(user: Pick<User, 'is_admin' | 'is_social' | 'is_social_publisher'>): boolean {
  return user.is_admin === 1 || user.is_social === 1 || user.is_social_publisher === 1;
}

export function canSocialPublish(user: Pick<User, 'is_admin' | 'is_social_publisher'>): boolean {
  return user.is_admin === 1 || user.is_social_publisher === 1;
}

/** Anyone with a pane in /admin. Used by endpoints every panel user needs, like the status banner. */
export function canSeeAdminPanel(
  user: Pick<User, 'is_admin' | 'is_announcer' | 'is_symposium' | 'is_social' | 'is_social_publisher' | 'is_sender'>,
): boolean {
  return user.is_admin === 1 || user.is_announcer === 1 || user.is_sender === 1 || user.is_symposium === 1 || canSocialEdit(user);
}

const ALLOWED_ORIGINS = new Set([
  'https://rsg-turkiye.iscbsc.org',
]);

export function checkCsrf(request: Request): boolean {
  // Allow same-origin requests (no Origin header means same-origin in most browsers)
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  // Allow localhost/preview URLs during development
  if (origin.startsWith('http://localhost') || origin.endsWith('.pages.dev')) return true;
  return ALLOWED_ORIGINS.has(origin);
}
