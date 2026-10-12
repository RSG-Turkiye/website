/**
 * The certificate CSV, read in the organiser's browser before anything is
 * uploaded. Pure, so it is tested under node. Columns: email, name, type,
 * file -- any order, any case. Comma or semicolon: Excel in a Turkish locale
 * saves with semicolons.
 */

export type CsvKind = 'participation' | 'workshop' | 'presentation' | 'appreciation';
export const PLAN_KINDS: readonly CsvKind[] = ['participation', 'workshop', 'presentation', 'appreciation'];
export interface CsvRow { line: number; email: string; name: string; type: string; file: string }
export type CsvError = 'empty' | 'missing_columns';
export type RowProblem = 'invalid_email' | 'invalid_kind' | 'missing_name' | 'missing_file' | 'duplicate';
export interface PlannedRow extends CsvRow { kind: CsvKind | null; problems: RowProblem[] }

const COLUMNS = ['email', 'name', 'type', 'file'] as const;

/** Turkish-aware lowercase: I -> ı would be right for Turkish words but
 * wrong for emails and English labels, so I, İ and ı all fold to i -- the
 * same rule as normaliseEmail on the server. */
const fold = (s: string) => s.trim().replace(/[İIı]/g, 'i').toLowerCase();

const LABELS: Record<string, CsvKind> = {
  participation: 'participation', katilim: 'participation',
  workshop: 'workshop', 'çaliştay': 'workshop',
  presentation: 'presentation', sunum: 'presentation',
  appreciation: 'appreciation', 'teşekkür': 'appreciation', tesekkur: 'appreciation',
};

export function kindFromLabel(label: string): CsvKind | null {
  return Object.hasOwn(LABELS, fold(label)) ? LABELS[fold(label)] : null;
}

function splitRecords(text: string, delimiter: string): { line: number; fields: string[] }[] {
  const out: { line: number; fields: string[] }[] = [];
  let field = '', fields: string[] = [], quoted = false, line = 1, start = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; field += c; }
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { fields.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      fields.push(field);
      out.push({ line: start, fields });
      fields = []; field = ''; line++; start = line;
    } else field += c;
  }
  fields.push(field);
  out.push({ line: start, fields });
  return out.filter((r) => r.fields.some((f) => f.trim() !== ''));
}

/** The file's text. UTF-8 when it is valid UTF-8; otherwise windows-1254,
 * which is what Turkish Excel's plain "CSV" and "MS-DOS" formats write --
 * read as UTF-8 those names would reach the certificate holders as "�ule". */
export function decodeCsv(bytes: ArrayBuffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1254').decode(bytes);
  }
}

export function parseCsv(text: string): { rows: CsvRow[] } | { error: CsvError; missing?: string[] } {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const records = splitRecords(clean, delimiter);
  if (records.length === 0) return { error: 'empty' };
  const header = records[0].fields.map(fold);
  const missing = COLUMNS.filter((c) => !header.includes(c));
  if (missing.length) return { error: 'missing_columns', missing: [...missing] };
  const at = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)])) as Record<(typeof COLUMNS)[number], number>;
  const rows = records.slice(1).map(({ line, fields }) => ({
    line,
    email: (fields[at.email] ?? '').trim(),
    name: (fields[at.name] ?? '').trim(),
    type: (fields[at.type] ?? '').trim(),
    file: (fields[at.file] ?? '').trim(),
  }));
  return { rows };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function planUpload(rows: CsvRow[], fileNames: string[]): { rows: PlannedRow[]; unusedFiles: string[] } {
  const byLower = new Map(fileNames.map((n) => [n.toLowerCase(), n]));
  const used = new Set<string>();
  const seen = new Set<string>();
  const planned = rows.map((row) => {
    const email = fold(row.email);
    const kind = kindFromLabel(row.type);
    const problems: RowProblem[] = [];
    if (email.length > 254 || !EMAIL.test(email)) problems.push('invalid_email');
    if (!kind) problems.push('invalid_kind');
    if (!row.name) problems.push('missing_name');
    const match = byLower.get(row.file.toLowerCase());
    if (!match) problems.push('missing_file');
    else used.add(match);
    const key = `${email}|${kind}`;
    if (problems.length === 0 && seen.has(key)) problems.push('duplicate');
    seen.add(key);
    return { ...row, email, kind, file: match ?? row.file, problems };
  });
  return { rows: planned, unusedFiles: fileNames.filter((n) => !used.has(n)) };
}
