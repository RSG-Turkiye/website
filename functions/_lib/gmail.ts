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
  /**
   * Already base64-encoded and 76-column wrapped. Encoded once per compose
   * by the caller (send.ts, when it reads the bytes from R2) and reused for
   * every recipient in the loop -- encoding raw bytes here, inside
   * buildMime, would re-run the (memory-heavy) base64/wrap pass once per
   * recipient for identical output.
   */
  base64Body: string;
}

export interface MimeMessage {
  fromAddress: string;
  fromName: string;
  to: string;
  replyTo: string;
  subject: string;
  /** Both halves of the message; see functions/_lib/markdown.ts. */
  body: { text: string; html: string };
  attachments: MimeAttachment[];
  /**
   * Threading, set only when this message is a reply. Gmail groups by its own
   * threadId, but the recipient's mail client groups by these headers -- set
   * only one of the two and the reply looks like a new subject to whichever
   * side was left out.
   */
  inReplyTo?: string;
  references?: string[];
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
 * Base64-encode and 76-column wrap attachment bytes for a MIME part. Exposed
 * so send.ts can do this once per compose (reading from R2) instead of
 * buildMime doing it once per recipient inside the send loop.
 */
export function encodeAttachmentBody(bytes: Uint8Array): string {
  return wrap76(base64(bytes));
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

/**
 * Safe `display-name` token for a `From: display-name <addr>` header.
 *
 * A display name is free text a member controls (`profiles.display_name`,
 * 1-60 chars, no character restrictions beyond length). It must never be
 * interpolated into the header unescaped: something like
 * `Foo" <evil@example.com>, Bar` would otherwise inject a second address.
 *
 * RFC 2047 encoded-words and RFC 5322 quoted-strings are the two ways to
 * make it safe, and they are mutually exclusive -- an encoded-word cannot
 * appear inside a quoted string, so exactly one of these applies:
 *   - non-ASCII: RFC 2047 encoded-word. It is atomic (base64 of the whole
 *     string), so there is no `"`, `<`, `>` or `,` for a parser to see.
 *   - pure ASCII: a quoted-string, with `\` and `"` backslash-escaped so
 *     they cannot terminate the quote early.
 *
 * This must live here, not at the call site, so it applies no matter what a
 * caller passes -- a display name is safe by construction, not by whichever
 * string happens to be non-ASCII today (see gmail.test.ts's injection case).
 */
function safeDisplayName(value: string): string {
  const clean = headerSafe(value);
  // eslint-disable-next-line no-control-regex
  if (!/^[\x20-\x7E]*$/.test(clean)) return encodeHeader(clean);
  return `"${clean.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

export function buildMime(msg: MimeMessage): string {
  const encoder = new TextEncoder();
  const textB64 = wrap76(base64(encoder.encode(msg.body.text)));
  const htmlB64 = wrap76(base64(encoder.encode(msg.body.html)));

  const headers = [
    `From: ${safeDisplayName(msg.fromName)} <${msg.fromAddress}>`,
    `To: ${headerSafe(msg.to)}`,
    `Reply-To: ${headerSafe(msg.replyTo)}`,
    `Subject: ${encodeHeader(headerSafe(msg.subject))}`,
    'MIME-Version: 1.0',
  ];

  // headerSafe on each id, not on the joined string: a crafted id carrying a
  // newline would otherwise inject a header of the attacker's choosing. These
  // ids come from inbound mail, so they are attacker-controlled by definition.
  if (msg.inReplyTo) {
    headers.push(`In-Reply-To: ${headerSafe(msg.inReplyTo)}`);
  }
  if (msg.references && msg.references.length > 0) {
    headers.push(`References: ${msg.references.map(headerSafe).join(' ')}`);
  }

  // Distinct prefixes guarantee the nested boundaries differ; one boundary
  // reused at both levels makes the message unparseable.
  const altBoundary = `rsg_alt_${crypto.randomUUID()}`;
  const altBody = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textB64,
    `--${altBoundary}`,
    // Last wins: clients render the last part they understand.
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlB64,
    `--${altBoundary}--`,
  ];

  let mime: string;

  if (msg.attachments.length === 0) {
    mime = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altBody,
      '',
    ].join('\r\n');
  } else {
    const mixedBoundary = `rsg_mix_${crypto.randomUUID()}`;
    const parts = [
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altBody,
    ];
    for (const a of msg.attachments) {
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${headerSafe(a.contentType)}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${headerSafe(a.filename).replace(/"/g, '')}"`,
        '',
        a.base64Body,
      );
    }
    parts.push(`--${mixedBoundary}--`, '');

    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      ...parts,
    ].join('\r\n');
  }

  return base64Url(encoder.encode(mime));
}

// Access tokens last an hour; cache per isolate so a compose to ten
// recipients does not perform ten token refreshes.
let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Drop the cached access token. Exported for gmail-read.ts, which has to
 * recover from the same early-invalidation case sendMail handles inline: a
 * token Google revoked before its stated expiry passes the isolate's own
 * check and then comes back 401 from Gmail.
 */
export function resetAccessToken(): void {
  cachedToken = null;
}

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

async function postSend(token: string, raw: string, threadId?: string): Promise<Response> {
  return fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw }),
  });
}

export interface SentMessage {
  id: string;
  /**
   * Gmail assigns every message a thread, so this is always present -- for a
   * new conversation it is a thread of one. It is what registers the
   * conversation the sync is later allowed to read.
   */
  threadId: string;
}

export async function sendMail(env: Env, raw: string, threadId?: string): Promise<SentMessage> {
  const token = await getAccessToken(env);
  let res = await postSend(token, raw, threadId);

  // A revoked/expired token can still pass the isolate's own expiry check
  // (Google may invalidate it early) and come back 401 from Gmail itself.
  // Without clearing the cache here, every send for up to an hour of this
  // isolate's life reuses the same bad token and fails the same way. Clear
  // it and retry once with a freshly fetched token before giving up.
  if (res.status === 401) {
    cachedToken = null;
    const freshToken = await getAccessToken(env);
    res = await postSend(freshToken, raw, threadId);
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Gmail send failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ id: string; threadId: string }>();
  return { id: data.id, threadId: data.threadId };
}
