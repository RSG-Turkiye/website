/**
 * Bulk personal mail: one letter, many people, each with their own name in it
 * (docs/superpowers/specs/2026-11-05-bulk-personal-mail-design.md).
 *
 * The list is a table pasted from a Google Sheet. Its header row names the
 * columns; one is the address, every other one is a placeholder written in
 * square brackets in the subject and text: a column `unvan` fills `[unvan]`.
 *
 * Pure and shared: the panel runs it to show the check and the first letters
 * before anything is sent, and the server runs it again on what it receives,
 * so the two can never disagree about who gets what.
 */
import { isValidEmail, MAX_SUBJECT_LENGTH, MAX_BODY_LENGTH } from '../../functions/_lib/mail';

/** Per campaign. The daily quota, not this, decides how long a mail-out takes. */
export const CAMPAIGN_MAX_RECIPIENTS = 500;

/** Header names accepted for the address column, compared lowercased. */
const EMAIL_HEADERS = ['e-posta', 'eposta', 'email', 'e-mail', 'mail'];

export interface PastedTable {
  headers: string[];
  /** The header holding the address, as written; null when there is none. */
  emailColumn: string | null;
  /** One object per non-blank row after the header, keyed by header. */
  rows: Record<string, string>[];
  /** How many cells each row actually had. A row whose count differs from
   * the header's is refused: its values would sit under the wrong columns. */
  widths: number[];
}

/**
 * Placeholder and header names match whatever the case. Plain lowercasing,
 * not the Turkish rules, so TITLE still matches [title]; the dotted capital
 * İ lowercases to i plus a combining dot, which is dropped so İSİM matches
 * [isim].
 */
const key = (name: string) => name.trim().toLowerCase().replace(/\u0307/g, '');

/**
 * Splits pasted text into rows of cells. A copy from Google Sheets is
 * tab-separated and quotes any cell holding a tab, a line break or a quote
 * ("" inside a quoted cell is one "); a hand-typed list may use commas or
 * semicolons, with the same quoting. The separator is picked from the
 * header line.
 */
function splitCells(text: string): string[][] {
  const src = text.replace(/\r\n?/g, '\n');
  const head = src.split('\n', 1)[0];
  const sep = head.includes('\t') ? '\t' : head.includes(';') ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let i = 0;
  while (i <= src.length) {
    const c = src[i];
    if (c === '"' && cell.trim() === '') {
      // A quoted cell: read to the closing quote, then ignore anything up to
      // the next separator (Sheets adds nothing there; a stray space is safe).
      let j = i + 1;
      let value = '';
      for (; j < src.length; j++) {
        if (src[j] === '"') {
          if (src[j + 1] === '"') { value += '"'; j++; continue; }
          break;
        }
        value += src[j];
      }
      cell = value;
      i = j + 1;
      while (i < src.length && src[i] !== sep && src[i] !== '\n') i++;
      continue;
    }
    if (c === sep) { row.push(cell); cell = ''; i++; continue; }
    if (c === '\n' || c === undefined) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i++;
      continue;
    }
    cell += c;
    i++;
  }
  return rows.map((r) => r.map((x) => x.trim())).filter((r) => r.some((x) => x !== ''));
}

export function parseTable(text: string): PastedTable {
  const lines = splitCells(text);
  if (lines.length === 0) return { headers: [], emailColumn: null, rows: [], widths: [] };
  const headers = lines[0];
  const emailColumn = headers.find((h) => EMAIL_HEADERS.includes(key(h))) ?? null;
  const body = lines.slice(1);
  const rows = body.map((cells) => {
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = cells[i] ?? ''; });
    return row;
  });
  return { headers, emailColumn, rows, widths: body.map((cells) => cells.length) };
}

/**
 * Any `[name]`, unless it is the text of a Markdown link (`[text](url)`): the
 * body is Markdown, and a link must not turn into a missing column. Any other
 * bracketed text is a placeholder, so one the list has no column for blocks
 * the campaign rather than going out to everyone as written.
 */
const PLACEHOLDER = /\[([^\[\]\n]{1,80})\](?!\()/gu;

/** Each placeholder name used, once, in order of first use. */
export function placeholdersIn(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of template.matchAll(PLACEHOLDER)) {
    const k = key(m[1]);
    if (!seen.has(k)) { seen.add(k); out.push(k); }
  }
  return out;
}

/** Fills in one person's values. A value is text: brackets inside it stay. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  const byKey = new Map(Object.entries(values).map(([k, v]) => [key(k), v]));
  return template.replace(PLACEHOLDER, (whole, name: string) => byKey.get(key(name)) ?? whole);
}

export interface CampaignRecipient { email: string; subject: string; body: string }

export interface RefusedRow {
  /** Line number in the pasted text, header = 1, so the person can find it. */
  line: number;
  email: string;
  reason: 'invalid_email' | 'duplicate' | 'empty_value' | 'column_count';
  /** For empty_value: the column the letter needs and this row lacks. */
  field?: string;
}

export type CampaignBuild =
  | { ok: true; recipients: CampaignRecipient[]; refused: RefusedRow[]; placeholders: string[] }
  | { ok: false; code: string; unknown?: string[] };

/**
 * Who gets which letter. A problem with one row refuses that row and the rest
 * go; a problem every letter would carry (no address column, an unknown
 * placeholder, an empty subject) blocks the whole campaign, because sending
 * five hundred copies of "[soyad]" is worse than sending none.
 */
export function buildCampaign(input: { table: string; subject: string; body: string }): CampaignBuild {
  const subject = input.subject.trim();
  const body = input.body.trim();
  if (!subject) return { ok: false, code: 'empty_subject' };
  if (subject.length > MAX_SUBJECT_LENGTH) return { ok: false, code: 'subject_too_long' };
  if (!body) return { ok: false, code: 'empty_body' };
  if (body.length > MAX_BODY_LENGTH) return { ok: false, code: 'body_too_long' };

  const table = parseTable(input.table);
  if (!table.emailColumn) return { ok: false, code: 'no_email_column' };
  const emailColumn = table.emailColumn;

  const columns = new Set(table.headers.map(key));
  const used = placeholdersIn(subject + '\n' + body);
  const unknown = used.filter((p) => !columns.has(p));
  if (unknown.length) return { ok: false, code: 'unknown_placeholder', unknown };

  const headerByKey = new Map(table.headers.map((h) => [key(h), h]));
  const recipients: CampaignRecipient[] = [];
  const refused: RefusedRow[] = [];
  const seen = new Set<string>();
  table.rows.forEach((row, i) => {
    const line = i + 2;
    const email = row[emailColumn] ?? '';
    if (table.widths[i] !== table.headers.length) { refused.push({ line, email, reason: 'column_count' }); return; }
    if (!isValidEmail(email)) { refused.push({ line, email, reason: 'invalid_email' }); return; }
    const lower = email.toLowerCase();
    if (seen.has(lower)) { refused.push({ line, email, reason: 'duplicate' }); return; }
    const missing = used.find((p) => !(row[headerByKey.get(p) ?? ''] ?? '').trim());
    if (missing) { refused.push({ line, email, reason: 'empty_value', field: missing }); return; }
    seen.add(lower);
    recipients.push({ email, subject: fillTemplate(subject, row), body: fillTemplate(body, row) });
  });

  if (recipients.length === 0) return { ok: false, code: 'no_recipients' };
  if (recipients.length > CAMPAIGN_MAX_RECIPIENTS) return { ok: false, code: 'too_many_recipients' };
  return { ok: true, recipients, refused, placeholders: used };
}
