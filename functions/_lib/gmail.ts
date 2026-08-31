import type { Env } from './auth';

/**
 * Sending mail as RSG.
 *
 * Everything Gmail-specific lives here. The account is a consumer Gmail
 * account (`turkey.rsg@gmail.com`), so there is no Workspace tenant and no
 * domain-wide delegation available -- authentication is a one-time OAuth
 * refresh token held as a Cloudflare secret. If RSG ever moves to a real
 * Workspace, `getAccessToken` is the only function that has to change.
 */

export class GmailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GmailError';
  }
}

export interface MimeAttachment {
  filename: string;
  contentType: string;
  bytes: Uint8Array;
}

export interface MimeMessage {
  fromAddress: string;
  fromName: string;
  to: string;
  replyTo: string;
  subject: string;
  body: string;
  attachments: MimeAttachment[];
}

function base64(bytes: Uint8Array): string {
  // btoa takes a binary string; chunk it so a large attachment does not blow
  // the argument limit of String.fromCharCode.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function base64Url(bytes: Uint8Array): string {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function wrap76(s: string): string {
  return (s.match(/.{1,76}/g) ?? []).join('\r\n');
}

/**
 * RFC 2047 encoded-word. Applied to display names and subjects only -- never
 * to an email address, which must stay literal for Gmail to parse it.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
}

/** Strip CR/LF so a crafted subject or filename cannot inject extra headers. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildMime(msg: MimeMessage): string {
  const encoder = new TextEncoder();
  const bodyB64 = wrap76(base64(encoder.encode(msg.body)));

  const headers = [
    `From: ${encodeHeader(headerSafe(msg.fromName))} <${msg.fromAddress}>`,
    `To: ${headerSafe(msg.to)}`,
    `Reply-To: ${headerSafe(msg.replyTo)}`,
    `Subject: ${encodeHeader(headerSafe(msg.subject))}`,
    'MIME-Version: 1.0',
  ];

  let mime: string;

  if (msg.attachments.length === 0) {
    mime = [
      ...headers,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      bodyB64,
      '',
    ].join('\r\n');
  } else {
    const boundary = `rsg_${crypto.randomUUID()}`;
    const parts = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="UTF-8"',
      'Content-Transfer-Encoding: base64',
      '',
      bodyB64,
    ];
    for (const a of msg.attachments) {
      parts.push(
        `--${boundary}`,
        `Content-Type: ${headerSafe(a.contentType)}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${headerSafe(a.filename).replace(/"/g, '')}"`,
        '',
        wrap76(base64(a.bytes)),
      );
    }
    parts.push(`--${boundary}--`, '');

    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${boundary}"`,
      '',
      ...parts,
    ].join('\r\n');
  }

  return base64Url(encoder.encode(mime));
}

// Access tokens last an hour; cache per isolate so a compose to ten
// recipients does not perform ten token refreshes.
let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getAccessToken(env: Env): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.token;

  if (!env.GMAIL_REFRESH_TOKEN) {
    throw new GmailError('GMAIL_REFRESH_TOKEN is not configured');
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GMAIL_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    cachedToken = null;
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Token refresh failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ access_token: string; expires_in: number }>();
  cachedToken = { token: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return data.access_token;
}

export async function sendMail(env: Env, raw: string): Promise<string> {
  const token = await getAccessToken(env);

  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ raw }),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Gmail send failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ id: string }>();
  return data.id;
}
