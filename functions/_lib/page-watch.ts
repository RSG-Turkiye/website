/**
 * The guide's announcement-page watch: has a programme's announcement or
 * calendar page changed since last week? It never tries to read dates out of
 * the page (40 universities, 40 formats); it only notices change and asks a
 * person to look (spec, "Change watch").
 *
 * pageText keeps the readable text, one block per line, and drops what
 * changes on every visit: menus, scripts, forms, clocks, dates, counters
 * (five digits or more; a year stays).
 * Turkish sites often answer in windows-1254 or ISO-8859-9; the response's
 * charset decides the decoding.
 */

const DROP = /<(script|style|nav|header|footer|form|noscript|svg|iframe)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_END = /<\/(p|div|li|h[1-6]|tr|td|th|section|article|table|ul|ol|dd|dt)>|<br\s*\/?>/gi;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: ' ' };

function decode(input: string | Uint8Array | ArrayBuffer, contentType = ''): string {
  if (typeof input === 'string') return input;
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(charset).decode(input);
  } catch {
    return new TextDecoder('utf-8').decode(input);
  }
}

export function pageText(html: string | Uint8Array | ArrayBuffer, contentType = ''): string {
  return decode(html, contentType)
    .replace(DROP, ' ')
    .replace(BLOCK_END, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, e: string) => ENTITIES[e] ?? ' ')
    .replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b/g, ' ')
    // Counters and ids; four digits stay, because a year changing is the news.
    .replace(/\d{5,}/g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t\r\f\v]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

export async function fingerprint(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Lines of `now` that `before` did not have, at most 40: what the approver reads in the queue. */
export function changedLines(before: string, now: string): string[] {
  const old = new Set(before.split('\n'));
  return now.split('\n').filter((l) => l && !old.has(l)).slice(0, 40);
}

/** Fewer characters than this is a maintenance page, a block page or an error: unreadable, not a change. */
export const MIN_TEXT = 1000;
/** Each URL is seen about weekly: this many nights per full pass. */
export const PASS_NIGHTS = 7;
export const MAX_PER_NIGHT = 25;
