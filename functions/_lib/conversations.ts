import type { ParsedMessage } from './gmail-read';

/**
 * Conversations: the threads the site started, and what to do with them.
 *
 * The decisions live here as pure functions so they can be tested without a
 * database or a Gmail account; the SQL and the network calls that use them sit
 * below in the same file (Task 6) with nothing clever in them.
 */

/** One notification per thread per hour, however many replies arrive. */
export const NOTIFY_THROTTLE_SECONDS = 3600;

/**
 * A References header naming every message in a long thread would run past
 * the line length mail servers are willing to accept. Clients only need
 * enough of the tail to place the reply.
 */
export const MAX_REFERENCES = 10;

export const SNIPPET_LENGTH = 140;

export interface ThreadState {
  lastMessageAt: number;
  lastDirection: 'out' | 'in';
}

export function replySubject(subject: string): string {
  const trimmed = subject.trim();
  // `RE :` and `re:` are both prefixes a real client produces; matching only
  // the exact string `Re: ` would give "Re: RE : Sempozyum" after two rounds.
  if (/^re\s*:/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`.trim();
}

export function buildReferences(messageIds: Array<string | null>): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of messageIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ordered.push(id);
  }
  return ordered.slice(-MAX_REFERENCES);
}

export function computeThreadState(messages: ParsedMessage[]): ThreadState | null {
  if (messages.length === 0) return null;
  let latest = messages[0];
  // `>=` rather than `>`: on a tie the later entry wins, which matches the
  // ascending order parseThread produces and keeps the answer stable.
  for (const message of messages) {
    if (message.sentAt >= latest.sentAt) latest = message;
  }
  return { lastMessageAt: latest.sentAt, lastDirection: latest.direction };
}

export function shouldNotify(lastNotifiedAt: number | null, now: number): boolean {
  if (lastNotifiedAt === null) return true;
  // A stamp in the future (clock skew between D1 and the isolate) fails this
  // comparison and suppresses the mail, which is the safe direction to err.
  return now - lastNotifiedAt >= NOTIFY_THROTTLE_SECONDS;
}

export function snippet(bodyText: string, max = SNIPPET_LENGTH): string {
  const flat = bodyText.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}
