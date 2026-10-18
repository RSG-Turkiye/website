/**
 * Where to go after signing in. The admin panel's address carries its place
 * in the fragment (#sosyal/dm/<id>), which never reaches the server, so the
 * page sends it as ?next= to /auth/login, which keeps it for ten minutes in a
 * cookie that only /auth/* sees. Only this site's own panel, account and
 * member pages are accepted: anything else would make sign-in an open
 * redirect. The member pages are here so that a link to a filtered directory
 * (/members/?badge=open_to_mentor, from the mentorship page) survives sign-in.
 */
export const NEXT_COOKIE = 'rsg_next';
const BASE = 'https://next.invalid';
const ALLOWED = /^\/(tr\/)?(admin|account|members)(\/|$)/;

export function safeNext(v: unknown): string | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return null;
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\') || /[\u0000-\u001f\u007f]/.test(v)) return null;
  let u: URL;
  try { u = new URL(v, BASE); } catch { return null; }
  if (u.origin !== BASE) return null;
  if (!ALLOWED.test(u.pathname) || /%2f|%5c/i.test(u.pathname)) return null;
  // The normalised path must be what was asked for: "/admin/../../blog" is not.
  if (!v.startsWith(u.pathname)) return null;
  return u.pathname + u.search + u.hash;
}

export const nextCookie = (v: string) => `${NEXT_COOKIE}=${encodeURIComponent(v)}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
export const clearNextCookie = () => `${NEXT_COOKIE}=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export function readNext(request: Request): string | null {
  const raw = (request.headers.get('Cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${NEXT_COOKIE}=`));
  if (!raw) return null;
  try { return safeNext(decodeURIComponent(raw.slice(NEXT_COOKIE.length + 1))); } catch { return null; }
}
