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

/**
 * What a message needs to know about an attachment to describe it: never its
 * bytes. The streaming sender carries a richer type than this -- an R2 key and
 * a size -- and the message format neither knows nor needs to.
 */
export interface MimeAttachmentRef {
  filename: string;
  contentType: string;
}

/** An attachment whose bytes are already in hand, base64 and 76-column wrapped. */
export interface MimeAttachment extends MimeAttachmentRef {
  base64Body: string;
}

export interface MimeMessage<A extends MimeAttachmentRef = MimeAttachmentRef> {
  fromAddress: string;
  fromName: string;
  to: string;
  replyTo: string;
  subject: string;
  /** Both halves of the message; see functions/_lib/markdown.ts. */
  body: { text: string; html: string };
  attachments: A[];
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

/**
 * The message as a list of lines, joined with CRLF.
 *
 * Every rule about how an RSG message is shaped lives here and nowhere else.
 */
export function mimeLines<A extends MimeAttachmentRef>(msg: MimeMessage<A>): MimeLine<A>[] {
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

  const lines: MimeLine<A>[] = [];

  if (msg.attachments.length === 0) {
    lines.push(
      ...headers,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altBody,
      '',
    );
  } else {
    const mixedBoundary = `rsg_mix_${crypto.randomUUID()}`;
    lines.push(
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altBody,
    );
    for (const a of msg.attachments) {
      lines.push(
        `--${mixedBoundary}`,
        `Content-Type: ${headerSafe(a.contentType)}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${headerSafe(a.filename).replace(/"/g, '')}"`,
        '',
        // The body is a placeholder rather than a string: the streaming
        // sender fills it from R2 a chunk at a time and never holds the
        // whole thing. `buildMime` below substitutes the encoded string it
        // was given, so both paths emit the same bytes by construction.
        { attachment: a },
      );
    }
    lines.push(`--${mixedBoundary}--`, '');
  }

  return lines;
}

/**
 * One line of a MIME message, or the place an attachment's encoded body goes.
 *
 * Splitting the message into lines rather than assembling it as one string is
 * what lets the same code serve two callers with very different memory
 * budgets: `buildMime` joins them, and the streaming sender writes them out
 * one at a time while pulling the attachment from R2. The alternative -- two
 * functions that each know the message format -- is the pattern that has gone
 * wrong repeatedly in this repo: the same fact stored twice, drifting.
 */
export type MimeLine<A extends MimeAttachmentRef = MimeAttachmentRef> =
  | string
  | { attachment: A };

/**
 * The message as a single base64url string, ready for the JSON send endpoint.
 *
 * Memory-expensive by construction -- for a 9 MB attachment this materialises
 * the wrapped base64, the joined MIME, its base64url and the JSON body, which
 * measured 123 MB of peak heap against a 128 MB isolate on 2026-09-05. The
 * streaming sender exists because of that measurement; this remains for
 * messages small enough not to care, and as the thing the streaming path is
 * tested against for byte-for-byte equality.
 */
export function buildMime(msg: MimeMessage<MimeAttachment>): string {
  const mime = mimeLines(msg)
    .map((line) => (typeof line === 'string' ? line : line.attachment.base64Body))
    .join('\r\n');
  return base64Url(new TextEncoder().encode(mime));
}

/**
 * How many bytes `encodeAttachmentBody` produces for `n` input bytes.
 *
 * Needed because the streaming send must declare an exact Content-Length
 * before a single byte is read: Cloudflare's FixedLengthStream errors if the
 * body turns out to be even one byte longer or shorter, so this has to agree
 * with wrap76 exactly rather than approximately.
 *
 * base64 is four characters per three bytes rounded up, wrap76 puts a CRLF
 * *between* lines and none after the last, and an empty attachment produces
 * an empty string rather than a stray newline.
 */
export function encodedLength(n: number): number {
  const b64 = 4 * Math.ceil(n / 3);
  if (b64 === 0) return 0;
  return b64 + 2 * (Math.ceil(b64 / 76) - 1);
}

/**
 * The exact byte length of the assembled message, without assembling it.
 *
 * Lines are joined with CRLF, so the separators are one fewer than the lines.
 */
export function mimeByteLength<A extends MimeAttachmentRef>(
  lines: MimeLine<A>[],
  sizeOf: (a: A) => number,
): number {
  const encoder = new TextEncoder();
  let total = lines.length > 0 ? 2 * (lines.length - 1) : 0;
  for (const line of lines) {
    total += typeof line === 'string'
      ? encoder.encode(line).length
      : encodedLength(sizeOf(line.attachment));
  }
  return total;
}

/**
 * Exactly one base64 line comes out of exactly this many input bytes, which is
 * what lets the encoder below wrap at 76 columns without ever holding two
 * lines' worth of context.
 */
const BYTES_PER_LINE = 57;

/**
 * How many lines to encode before handing a chunk on. 1024 lines is ~58 KB of
 * input and ~79 KB of output -- small enough that the transient strings are
 * ordinary short-lived garbage, large enough that the loop is not the cost.
 */
const LINES_PER_CHUNK = 1024;

function base64Line(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * The message as a stream of chunks, holding no more than one chunk at a time.
 *
 * This is the whole point of the exercise. Assembling a message with a 9.36 MB
 * attachment as one string measured 123 MB of peak heap against a 128 MB
 * isolate: the wrapped base64, the joined MIME, its base64url and the JSON
 * body all exist at once. Cloudflare killed the invocation whenever anything
 * else was already resident, which after a few sends it always was. Produced a
 * chunk at a time the same message peaks around 10 MB, and that number does
 * not grow with the attachment.
 *
 * `open` is called at most once per attachment and only when the stream
 * reaches it, so nothing is read from R2 that the message does not need.
 */
export async function* mimeChunks<A extends MimeAttachmentRef>(
  lines: MimeLine<A>[],
  open: (a: A) => Promise<ReadableStream<Uint8Array>>,
): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  let pending = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const separator = i === 0 ? '' : '\r\n';

    if (typeof line === 'string') {
      pending += separator + line;
      // Header lines are tiny; flushing per line would be one write each.
      if (pending.length > 8192) {
        yield encoder.encode(pending);
        pending = '';
      }
      continue;
    }

    yield encoder.encode(pending + separator);
    pending = '';
    yield* encodeAttachmentStream(await open(line.attachment), encoder);
  }

  if (pending.length > 0) yield encoder.encode(pending);
}

/**
 * Base64 of a byte stream, wrapped at 76 columns, emitted in chunks.
 *
 * R2 hands over chunks of whatever size it likes, and a base64 line may not
 * straddle one, so bytes left over from a chunk are carried into the next.
 * Only the final line may be shorter than 57 bytes, which is exactly where
 * base64 padding belongs.
 */
async function* encodeAttachmentStream(
  source: ReadableStream<Uint8Array>,
  encoder: TextEncoder,
): AsyncGenerator<Uint8Array> {
  const reader = source.getReader();
  let carry = new Uint8Array(0);
  let wroteLine = false;

  const emit = (bytes: Uint8Array): Uint8Array => {
    let out = '';
    for (let i = 0; i < bytes.length; i += BYTES_PER_LINE) {
      out += (wroteLine ? '\r\n' : '') + base64Line(bytes.subarray(i, i + BYTES_PER_LINE));
      wroteLine = true;
    }
    return encoder.encode(out);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      let buffer: Uint8Array;
      if (carry.length === 0) {
        buffer = value;
      } else {
        buffer = new Uint8Array(carry.length + value.length);
        buffer.set(carry, 0);
        buffer.set(value, carry.length);
      }

      // Whole lines only; the remainder waits for the bytes that complete it.
      const span = BYTES_PER_LINE * LINES_PER_CHUNK;
      let offset = 0;
      while (buffer.length - offset >= span) {
        yield emit(buffer.subarray(offset, offset + span));
        offset += span;
      }
      const rest = buffer.subarray(offset);
      const usable = rest.length - (rest.length % BYTES_PER_LINE);
      if (usable > 0) yield emit(rest.subarray(0, usable));
      // Copied, not a view: `value` is released once this iteration ends, and
      // a subarray of it would keep the whole chunk alive for the carry.
      carry = rest.slice(usable);
    }
    if (carry.length > 0) yield emit(carry);
  } finally {
    reader.releaseLock();
  }
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

/**
 * The upload endpoint, and why it is not the ordinary one.
 *
 * `messages/send` takes the whole message as base64url inside a JSON body,
 * which means the message must exist as one string, twice over. For a 9.36 MB
 * attachment that measured 123.1 MB of peak heap against a 128 MB isolate on
 * 2026-09-05 -- one message fitting with five megabytes to spare, which is why
 * a freshly deployed isolate managed three or four sends and then killed every
 * tick after.
 *
 * The upload endpoint takes the raw RFC 822 message as the request body, so it
 * can be streamed and never assembled. `uploadType=media` would be the simpler
 * form but it carries no metadata, and Gmail requires `threadId` on the
 * message resource to attach a reply to its thread -- headers alone are not
 * documented as sufficient. So: `uploadType=multipart`, a JSON metadata part
 * ahead of a `message/rfc822` part. The metadata is a fixed preamble, so the
 * message half still streams.
 *
 * https://developers.google.com/workspace/gmail/api/guides/uploads
 */
const UPLOAD_URL =
  'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=multipart';

/**
 * The `multipart/related` envelope around a message, and its exact size.
 *
 * Exact is the operative word. The body is streamed, so its length has to be
 * declared before a byte of it is read, and Cloudflare's FixedLengthStream
 * fails the request if the stream turns out to be even one byte longer or
 * shorter than promised. A wrong prediction here is a failed send, not a slow
 * one, which is why this is a pure function with its own tests rather than an
 * expression inside the sender.
 */
export function uploadEnvelope<A extends MimeAttachmentRef>(
  lines: MimeLine<A>[],
  sizeOf: (a: A) => number,
  threadId?: string,
): { boundary: string; contentType: string; head: string; tail: string; length: number } {
  const boundary = `rsg_up_${crypto.randomUUID()}`;
  // Always sent, empty when there is no thread, so there is one code path
  // rather than two and the length arithmetic has no special case.
  const metadata = JSON.stringify(threadId ? { threadId } : {});
  const head =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n' +
    '\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: message/rfc822\r\n' +
    '\r\n';
  const tail = `\r\n--${boundary}--`;
  const encoder = new TextEncoder();
  return {
    boundary,
    contentType: `multipart/related; boundary=${boundary}`,
    head,
    tail,
    length:
      encoder.encode(head).length +
      mimeByteLength(lines, sizeOf) +
      encoder.encode(tail).length,
  };
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

/**
 * Sends a message without ever holding it.
 *
 * The body is produced as it is uploaded: header lines, then the attachment
 * base64 a chunk at a time straight from R2, then the closing boundaries.
 * Peak heap is a chunk, not a message, and it does not grow with the
 * attachment -- 10.2 MB measured against the 123.1 MB the assembled path
 * needed for the same mail.
 *
 * `open` is called when the stream reaches each attachment, and again on a
 * retry: a stream is consumed once, so the body cannot be re-posted the way a
 * string could and has to be built afresh. That costs a second R2 read on the
 * (rare) 401 path and keeps the retry that a prematurely invalidated token
 * needs.
 */
export async function sendStreamedMail<A extends MimeAttachmentRef>(
  env: Env,
  msg: MimeMessage<A>,
  open: (a: A) => Promise<ReadableStream<Uint8Array>>,
  sizeOf: (a: A) => number,
  threadId?: string,
): Promise<SentMessage> {
  // Built once: the boundaries must be the same on a retry as the length that
  // was computed with them, and mimeLines would generate new ones per call.
  const lines = mimeLines(msg);
  const envelope = uploadEnvelope(lines, sizeOf, threadId);
  const encoder = new TextEncoder();

  const post = async (token: string): Promise<Response> => {
    const { readable, writable } = new FixedLengthStream(envelope.length);

    // Deliberately not awaited: the body has to be produced while the request
    // is in flight, which is the entire point of streaming it. Awaiting it
    // afterwards would be worse than useless -- if the fetch fails first, the
    // pump is parked on a write that will never drain, and awaiting it hangs
    // the send. It reports failure the only way that matters instead: by
    // erroring the stream, which fails the fetch below. The catch is what
    // keeps the rejection from being unhandled, so this promise never
    // rejects and never needs to be waited on.
    void (async () => {
      const writer = writable.getWriter();
      try {
        await writer.write(encoder.encode(envelope.head));
        for await (const chunk of mimeChunks(lines, open)) await writer.write(chunk);
        await writer.write(encoder.encode(envelope.tail));
        await writer.close();
      } catch (err) {
        // Also reached when the fetch itself failed and the reader went away,
        // in which case aborting an already-errored stream is a no-op.
        await writable.abort(err).catch(() => {});
      }
    })();

    return fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': envelope.contentType },
      body: readable,
    });
  };

  let res = await post(await getAccessToken(env));
  if (res.status === 401) {
    cachedToken = null;
    res = await post(await getAccessToken(env));
  }

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new GmailError(`Gmail upload failed (${res.status}): ${detail}`);
  }

  const data = await res.json<{ id: string; threadId: string }>();
  return { id: data.id, threadId: data.threadId };
}
