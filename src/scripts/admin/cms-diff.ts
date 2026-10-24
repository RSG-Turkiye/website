/**
 * What a draft changes, field by field, for the approver: the published
 * value and the new one, per language for bilingual fields, per item for
 * lists (added, removed, moved), and per line for a Markdown body. Pure:
 * works on the form's values (cms-form.ts), so it sees fields the way the
 * form shows them.
 */
import { formValues, same, type Bi, type FieldDef, type Row, type TypeModel, type Values } from './cms-form';

export type ItemState = 'added' | 'removed' | 'moved' | 'same';
export type LineOp = '+' | '-' | ' ';

export type Change =
  | { type: 'value'; before: unknown; after: unknown }
  | { type: 'bilingual'; en: { before: unknown; after: unknown } | null; tr: { before: unknown; after: unknown } | null }
  | { type: 'list'; items: { state: ItemState; value: unknown }[]; lang?: 'en' | 'tr' }
  | { type: 'lines'; lines: { op: LineOp; text: string }[]; lang?: 'en' | 'tr' }
  | { type: 'rows'; rows: RowChange[] };

/**
 * One row of an `objects` list that differs: added, removed, moved (and
 * maybe changed too), or changed in place. Rows that are the same are left
 * out. `n` is its number in the new list (in the old one for a removed row);
 * `row` its values, for the summary line.
 */
export interface RowChange { state: 'added' | 'removed' | 'moved' | 'changed'; n: number; row: Row; changes: FieldChange[] }

export interface FieldChange { field: FieldDef; changes: Change[] }
export interface EntryDiff { changed: FieldChange[]; unchanged: FieldDef[] }

/** Longest common subsequence of two sequences, as index pairs. */
function lcs<T>(a: T[], b: T[], eq: (x: T, y: T) => boolean): [number, number][] {
  const n = a.length;
  const m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = eq(a[i], b[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: [number, number][] = [];
  for (let i = 0, j = 0; i < n && j < m;) {
    if (eq(a[i], b[j])) { out.push([i, j]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) i++; else j++;
  }
  return out;
}

/**
 * Items of `after` in order, each added, moved or the same, then the items
 * of `before` that are gone. Items are compared whole: an edited item is one
 * removed and one added, which is what changed.
 */
export function listDiff(before: unknown[], after: unknown[]): { state: ItemState; value: unknown }[] {
  const key = (v: unknown) => JSON.stringify(v);
  const pool = new Map<string, number>();
  for (const v of before) pool.set(key(v), (pool.get(key(v)) ?? 0) + 1);
  const kept: boolean[] = after.map((v) => {
    const n = pool.get(key(v)) ?? 0;
    if (n > 0) { pool.set(key(v), n - 1); return true; }
    return false;
  });
  // Items still in both that keep their relative order are "same"; the rest moved.
  const common = after.filter((_, i) => kept[i]);
  const left = new Map<string, number>();
  for (const v of common) left.set(key(v), (left.get(key(v)) ?? 0) + 1);
  const beforeCommon = before.filter((v) => {
    const n = left.get(key(v)) ?? 0;
    if (n > 0) { left.set(key(v), n - 1); return true; }
    return false;
  });
  const inOrder = new Set(lcs(common, beforeCommon, (x, y) => key(x) === key(y)).map(([i]) => i));
  const out: { state: ItemState; value: unknown }[] = [];
  let c = 0;
  after.forEach((v, i) => {
    if (!kept[i]) { out.push({ state: 'added', value: v }); return; }
    out.push({ state: inOrder.has(c) ? 'same' : 'moved', value: v });
    c++;
  });
  const gone = new Map<string, number>();
  for (const v of after) gone.set(key(v), (gone.get(key(v)) ?? 0) + 1);
  for (const v of before) {
    const n = gone.get(key(v)) ?? 0;
    if (n > 0) gone.set(key(v), n - 1);
    else out.push({ state: 'removed', value: v });
  }
  return out;
}

/** A line diff of two texts. */
export function lineDiff(before: string, after: string): { op: LineOp; text: string }[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const pairs = lcs(a, b, (x, y) => x === y);
  const out: { op: LineOp; text: string }[] = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of [...pairs, [a.length, b.length] as [number, number]]) {
    while (i < pi) out.push({ op: '-', text: a[i++] });
    while (j < pj) out.push({ op: '+', text: b[j++] });
    if (pi < a.length) out.push({ op: ' ', text: a[pi] });
    i = pi + 1;
    j = pj + 1;
  }
  return out;
}

/**
 * How a value is held: a JSON entry's, a pair type's top-level `{ en, tr }`,
 * or one inside a pair type's row (a per-language field `{ en, tr }`, a
 * shared one plain).
 */
type Mode = 'json' | 'pair' | 'pairRow';

function fieldChanges(mode: Mode, f: FieldDef, before: unknown, after: unknown): Change[] {
  if (same(before, after)) return [];
  if (f.kind === 'objects') return [{ type: 'rows', rows: rowsDiff(mode === 'json' ? 'json' : 'pairRow', f, before as Row[], after as Row[]) }];
  if (mode === 'pairRow') return fieldChanges(f.perLang ? 'pair' : 'json', f, before, after);
  if (f.kind === 'bilingualStrings' || (mode === 'pair' && f.kind === 'strings')) {
    const b = before as Bi<unknown>;
    const a = after as Bi<unknown>;
    if (mode === 'pair' && !f.perLang && same(b.en, b.tr) && same(a.en, a.tr)) return fieldChanges('json', f, b.en, a.en);
    const out: Change[] = [];
    for (const lang of ['en', 'tr'] as const) if (!same(b?.[lang], a?.[lang])) out.push({ type: 'list', lang, items: listDiff((b?.[lang] ?? []) as unknown[], (a?.[lang] ?? []) as unknown[]) });
    return out;
  }
  if (mode === 'pair') {
    const b = before as Bi<unknown>;
    const a = after as Bi<unknown>;
    // A shared field both sides agree on reads as one value.
    if (!f.perLang && same(b.en, b.tr) && same(a.en, a.tr)) return fieldChanges('json', f, b.en, a.en);
    const out: Change[] = [];
    if (f.kind === 'markdown') {
      for (const lang of ['en', 'tr'] as const) if (!same(b[lang], a[lang])) out.push({ type: 'lines', lang, lines: lineDiff(String(b[lang] ?? ''), String(a[lang] ?? '')) });
      return out;
    }
    return [{ type: 'bilingual', en: same(b.en, a.en) ? null : { before: b.en, after: a.en }, tr: same(b.tr, a.tr) ? null : { before: b.tr, after: a.tr } }];
  }
  if (f.kind === 'bilingual') {
    const b = before as Bi;
    const a = after as Bi;
    return [{ type: 'bilingual', en: same(b.en, a.en) ? null : { before: b.en, after: a.en }, tr: same(b.tr, a.tr) ? null : { before: b.tr, after: a.tr } }];
  }
  if (f.kind === 'strings' || f.kind === 'links') return [{ type: 'list', items: listDiff(before as unknown[], after as unknown[]) }];
  if (f.kind === 'markdown') return [{ type: 'lines', lines: lineDiff(String(before ?? ''), String(after ?? '')) }];
  return [{ type: 'value', before, after }];
}

/** A row's identity value ('' when it has none): a per-language one by its English side. */
function identityOf(f: FieldDef, row: Row): string {
  if (!f.identity) return '';
  const v = row?.[f.identity];
  const x = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Bi<unknown>).en : v;
  return typeof x === 'string' || typeof x === 'number' ? String(x) : '';
}

/**
 * Rows of the new list against the old. With an identity key, rows are
 * matched by it, so a moved row is a move and an edited one a change;
 * rows without a match are added or removed. Without one, row i is
 * compared with row i, and the longer list's extra rows are added or
 * removed (a move then reads as changes).
 */
export function rowsDiff(mode: 'json' | 'pairRow', f: FieldDef, before: Row[], after: Row[]): RowChange[] {
  const b = Array.isArray(before) ? before : [];
  const a = Array.isArray(after) ? after : [];
  const matchOf: (number | null)[] = a.map(() => null);
  if (f.identity) {
    const free = new Map<string, number[]>();
    b.forEach((r, i) => { const id = identityOf(f, r); if (id) free.set(id, [...(free.get(id) ?? []), i]); });
    a.forEach((r, j) => { const id = identityOf(f, r); const left = id ? free.get(id) : undefined; if (left?.length) matchOf[j] = left.shift()!; });
  } else {
    a.forEach((_, j) => { if (j < b.length) matchOf[j] = j; });
  }
  const matched = matchOf.map((i, j) => [i, j] as const).filter((x): x is readonly [number, number] => x[0] !== null);
  // Matched rows that keep their relative order stay; the others moved.
  const order = matched.map(([i]) => i);
  const kept = new Set(lcs(order, [...order].sort((x, y) => x - y), (x, y) => x === y).map(([k]) => order[k]));
  const inner = (x: Row, y: Row) => (f.fields ?? []).map((s) => ({ field: s, changes: fieldChanges(mode, s, x?.[s.key], y?.[s.key]) })).filter((c) => c.changes.length);
  const out: RowChange[] = [];
  a.forEach((row, j) => {
    const i = matchOf[j];
    if (i === null) { out.push({ state: 'added', n: j + 1, row, changes: [] }); return; }
    const changes = inner(b[i], row);
    if (!kept.has(i)) out.push({ state: 'moved', n: j + 1, row, changes });
    else if (changes.length) out.push({ state: 'changed', n: j + 1, row, changes });
  });
  const used = new Set(matchOf.filter((i): i is number => i !== null));
  b.forEach((row, i) => { if (!used.has(i)) out.push({ state: 'removed', n: i + 1, row, changes: [] }); });
  return out;
}

/** The fields a draft changes against the published entry, and the ones it leaves. */
export function diffEntry(model: TypeModel, published: unknown, draft: unknown, fields: FieldDef[] = model.fields): EntryDiff {
  const b: Values = formValues(model, published);
  const a: Values = formValues(model, draft);
  const changed: FieldChange[] = [];
  const unchanged: FieldDef[] = [];
  for (const f of fields) {
    const changes = fieldChanges(model.format === 'json' ? 'json' : 'pair', f, b[f.key], a[f.key]);
    if (changes.length) changed.push({ field: f, changes });
    else unchanged.push(f);
  }
  return { changed, unchanged };
}
