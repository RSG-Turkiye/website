export interface Env {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

export interface User {
  id: string;
  google_id: string;
  email: string;
  is_member: number;
  is_admin: number;
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
const SESSION_DURATION = 60 * 60 * 24 * 30; // 30 days in seconds

export function generateId(): string {
  return crypto.randomUUID();
}

export function sessionCookie(token: string, expires: Date): string {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Expires=${expires.toUTCString()}`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

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
