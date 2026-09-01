/**
 * Reading the RSG mailbox.
 *
 * Separate from gmail.ts on purpose: sending needs `gmail.send`, reading needs
 * `gmail.readonly`, and readonly is a *restricted* scope that grants the token
 * the whole mailbox. Keeping every read in one file means the blast radius of
 * that scope is one auditable module rather than a habit spread across the
 * codebase.
 *
 * This file holds the pure parsing; the network calls live beside it and are
 * reachable only through conversations.ts, which checks the thread against
 * mail_threads first.
 */

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  /** Milliseconds since the epoch, as a string. Gmail's own field. */
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

export interface HistoryPayload {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }>;
  }>;
  historyId?: string;
  nextPageToken?: string;
}

export interface ParsedMessage {
  id: string;
  direction: 'out' | 'in';
  rfc822MessageId: string | null;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  bodyText: string;
  attachmentCount: number;
  /** Epoch seconds. */
  sentAt: number;
}

export function decodeBase64Url(data: string): string {
  const normalised = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalised + '='.repeat((4 - (normalised.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * RFC 2047 encoded-words in a header value. Gmail returns header values raw,
 * so a Turkish name or subject arrives as `=?UTF-8?B?...?=` and would
 * otherwise be shown to members as gibberish.
 */
export function decodeEncodedWords(value: string): string {
  return value.replace(
    /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g,
    (whole, charset: string, encoding: string, text: string) => {
      try {
        const decoder = new TextDecoder(charset.toLowerCase());
        if (encoding.toUpperCase() === 'B') {
          const binary = atob(text);
          return decoder.decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
        }
        const unquoted = text
          .replace(/_/g, ' ')
          .replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
        return decoder.decode(Uint8Array.from(unquoted, (c) => c.charCodeAt(0)));
      } catch {
        // An unknown charset or malformed payload: show the raw word rather
        // than throwing away the header.
        return whole;
      }
    },
  );
}

export function pickHeader(headers: GmailHeader[], name: string): string | null {
  const wanted = name.toLowerCase();
  for (const header of headers) {
    if (header.name.toLowerCase() === wanted) return header.value;
  }
  return null;
}

export function parseFrom(value: string | null): { email: string; name: string | null } {
  if (!value) return { email: '', name: null };
  const angle = value.match(/^(.*)<([^>]+)>\s*$/);
  if (!angle) return { email: value.trim().toLowerCase(), name: null };
  const name = angle[1].trim().replace(/^"(.*)"$/, '$1').trim();
  return { email: angle[2].trim().toLowerCase(), name: name || null };
}

/**
 * Best-effort text from HTML, used only when a message has no text/plain part.
 * This is not a sanitiser and its output is never inserted as markup -- the
 * page renders it as text. Its only job is to stop a member from being shown
 * a wall of tags.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    // &amp; last: doing it first would turn `&amp;lt;` into `<` instead of
    // the `&lt;` the sender actually wrote.
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectText(part: GmailPart | undefined, out: { plain: string[]; html: string[] }): void {
  if (!part) return;
  // A part with a filename is an attachment, even when its type is text/plain.
  // Folding an attached .txt into the body would misrepresent the message.
  if (!part.filename && part.body?.data) {
    const mime = (part.mimeType ?? '').toLowerCase();
    if (mime === 'text/plain') out.plain.push(decodeBase64Url(part.body.data));
    else if (mime === 'text/html') out.html.push(decodeBase64Url(part.body.data));
  }
  for (const child of part.parts ?? []) collectText(child, out);
}

export function extractPlainText(payload: GmailPart | undefined): string {
  const out = { plain: [] as string[], html: [] as string[] };
  collectText(payload, out);
  if (out.plain.length > 0) return out.plain.join('\n').trim();
  if (out.html.length > 0) return htmlToText(out.html.join('\n'));
  return '';
}

export function countAttachments(payload: GmailPart | undefined): number {
  let count = 0;
  const walk = (part: GmailPart | undefined): void => {
    if (!part) return;
    if (part.filename) count += 1;
    for (const child of part.parts ?? []) walk(child);
  };
  walk(payload);
  return count;
}

export function parseMessage(msg: GmailMessage, rsgAddress: string): ParsedMessage {
  const headers = msg.payload?.headers ?? [];
  const rawFrom = pickHeader(headers, 'From');
  const from = parseFrom(rawFrom === null ? null : decodeEncodedWords(rawFrom));
  const rawSubject = pickHeader(headers, 'Subject');

  // Gmail's SENT label is the reliable signal. The address comparison is the
  // fallback for a payload that arrives without labels.
  const isOutgoing =
    (msg.labelIds ?? []).includes('SENT') || from.email === rsgAddress.trim().toLowerCase();

  return {
    id: msg.id,
    direction: isOutgoing ? 'out' : 'in',
    rfc822MessageId: pickHeader(headers, 'Message-ID'),
    fromEmail: from.email,
    fromName: from.name,
    subject: rawSubject === null ? null : decodeEncodedWords(rawSubject),
    bodyText: extractPlainText(msg.payload),
    attachmentCount: countAttachments(msg.payload),
    sentAt: msg.internalDate ? Math.floor(Number(msg.internalDate) / 1000) : 0,
  };
}

export function parseThread(thread: GmailThread, rsgAddress: string): ParsedMessage[] {
  return (thread.messages ?? [])
    .map((msg) => parseMessage(msg, rsgAddress))
    .sort((a, b) => a.sentAt - b.sentAt);
}

/**
 * Thread ids of messages that were *added* since the cursor. Label changes and
 * deletions are deliberately ignored: they cannot introduce a reply, and
 * acting on them would mean reading threads for no reason.
 */
export function threadIdsFromHistory(payload: HistoryPayload): string[] {
  const ids = new Set<string>();
  for (const entry of payload.history ?? []) {
    for (const added of entry.messagesAdded ?? []) {
      const id = added.message?.threadId;
      if (id) ids.add(id);
    }
  }
  return [...ids];
}
