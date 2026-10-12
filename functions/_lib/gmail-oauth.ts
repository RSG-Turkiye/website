import type { Env } from './auth';

/** openid + email let the callback check WHICH account granted access. */
export const GMAIL_SCOPES = [
  'openid',
  'email',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];
const REQUIRED = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'];

export const gmailRedirectUri = (base: string) => `${base}/api/admin/connections/gmail/callback`;
export const expectedGmailAccount = (env: Pick<Env, 'GMAIL_ACCOUNT' | 'RSG_MAIL_FROM'>) =>
  (env.GMAIL_ACCOUNT || env.RSG_MAIL_FROM).trim().toLowerCase();

export function gmailAuthUrl(env: Pick<Env, 'GOOGLE_CLIENT_ID' | 'GMAIL_ACCOUNT' | 'RSG_MAIL_FROM'>, base: string, state: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: gmailRedirectUri(base),
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    // Without both, Google returns no refresh token on a second grant.
    access_type: 'offline',
    prompt: 'consent',
    login_hint: expectedGmailAccount(env),
    state,
  }).toString();
  return url.toString();
}

export const hasRequiredScopes = (granted: string) => REQUIRED.every((s) => granted.split(' ').includes(s));

export async function revokeGrant(token: string): Promise<void> {
  try {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, { method: 'POST' });
  } catch { /* best effort: an unrevoked grant to the wrong account is harmless to the site */ }
}
