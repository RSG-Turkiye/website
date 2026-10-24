/**
 * Draws the Etkinlikler form from its field model (cms-form.ts) and reads
 * the values back. Markup only: sections/cms.ts owns the events, the saving
 * and the uploads. Every control carries `data-field` (and `data-lang` for a
 * language: en, tr, or `both` for a webinar field one control writes to
 * both sides), so values are read from the page, never kept twice.
 */
import { escapeHtml } from '../escape-html';
import { BTN, chip } from './ui-kit';
import { t, tf } from './context';
import {
  emptyRow, isSplit, lockedAfterSave, ROW_FROM, ROW_NAME, rowSummary, sharedShowsOne, shown, type Bi, type FieldDef, type ImageObject, type LinkItem, type Row, type TypeModel, type Values,
} from './cms-form';
import type { Change, EntryDiff, FileDiff, RowChange } from './cms-diff';

const tk = (k: string) => t(k as never) as string;
/** A row's one-line summary; a row named by a choice (rowOption) shows the choice's words. */
const summaryOf = (f: FieldDef, row: Row): string => {
  const v = rowSummary(f, row, lang());
  return f.rowOption && v ? optionLabel(f.fields?.find((x) => x.key === f.rowOption), v) : v;
};
/** A select's option as words: its own label (an entry's title), else the i18n one. */
const optionLabel = (f: FieldDef | undefined, o: string): string => f?.optionLabels?.[o] ?? tk(`admin.cms.opt.${o}`);
const esc = (v: unknown) => escapeHtml(String(v ?? ''));
const INPUT = 'w-full min-w-0 px-3 py-2 lg:py-1.5 min-h-11 lg:min-h-9 rounded-xl border border-border bg-white text-sm text-navy placeholder-gray-500 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy-mid focus:border-navy-mid disabled:bg-[#F7F7F6] disabled:text-gray-600';
const SMALL_BTN = BTN.ghost;
/** Side by side from lg, stacked on a phone. */
const PAIR = 'grid grid-cols-1 lg:grid-cols-2 gap-2';

type Lang = 'en' | 'tr' | 'both';
const langTag = (lang: Lang) => (lang === 'both' ? '' : `<span class="shrink-0 w-7 text-[11px] font-semibold uppercase text-gray-500" aria-hidden="true">${lang}</span>`);
const attrs = (f: FieldDef, lang: Lang | null, extra = '') => `data-field="${f.key}"${lang ? ` data-lang="${lang}"` : ''} ${extra}`;
/** The accessible name of a control: the field, and the language when there are two. */
const aria = (f: FieldDef, lang: Lang | null) => esc(`${tk(f.label)}${lang && lang !== 'both' ? ` (${lang.toUpperCase()})` : ''}`);

function control(f: FieldDef, v: unknown, lang: Lang | null): string {
  const a = `${attrs(f, lang)} aria-label="${aria(f, lang)}"`;
  const align = f.kind === 'textarea' ? 'items-start pt-2.5 lg:pt-2' : 'items-center';
  const wrap = (inner: string) => (lang && lang !== 'both' ? `<label class="flex ${align.split(' ')[0]} gap-1 min-w-0"><span class="${align.includes('pt') ? 'pt-2.5 lg:pt-2' : ''}">${langTag(lang)}</span><span class="flex-1 min-w-0">${inner}</span></label>` : inner);
  switch (f.kind) {
    case 'textarea':
      return wrap(`<textarea ${a} rows="3" class="${INPUT} min-h-20">${esc(v)}</textarea>`);
    case 'date':
      return wrap(`<input type="date" ${a} value="${esc(v)}" class="${INPUT}" />`);
    case 'number':
      return wrap(`<input type="number" inputmode="numeric" ${a} value="${esc(v)}" class="${INPUT}" />`);
    case 'select':
      return wrap(`<select ${a} class="${INPUT}"><option value="">${esc(tk('admin.cms.choose'))}</option>${(f.options ?? [])
        .map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(optionLabel(f, o))}</option>`).join('')}</select>`);
    case 'checkbox':
      return `<label class="flex items-center gap-2 min-h-11 lg:min-h-9 text-sm text-navy cursor-pointer">
        <input type="checkbox" ${a} ${v === true ? 'checked' : ''} class="w-4 h-4 rounded border-border" />${lang && lang !== 'both' ? langTag(lang) : ''}${esc(tk('admin.cms.yes'))}</label>`;
    default:
      return wrap(`<input type="text" ${a} value="${esc(v)}" class="${INPUT}" />`);
  }
}

function listButtons(i: number, n: number): string {
  return `<div class="flex shrink-0 items-center gap-1">
    <button type="button" data-move="-1" data-row-i="${i}" class="${SMALL_BTN} px-3" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('admin.cms.list.up' as never))}">↑</button>
    <button type="button" data-move="1" data-row-i="${i}" class="${SMALL_BTN} px-3" ${i === n - 1 ? 'disabled' : ''} aria-label="${esc(t('admin.cms.list.down' as never))}">↓</button>
    <button type="button" data-remove data-row-i="${i}" class="${BTN.ghost} px-3 text-red hover:text-red">${esc(t('admin.cms.list.remove' as never))}</button>
  </div>`;
}

function stringsList(f: FieldDef, items: string[], lang: Lang | null): string {
  const rows = items.map((s, i) => `<div data-row class="flex flex-wrap sm:flex-nowrap items-center gap-2">
      <input type="text" ${attrs(f, lang, 'data-item')} aria-label="${aria(f, lang)} ${i + 1}" value="${esc(s)}" class="${INPUT} flex-1 basis-full sm:basis-0" />
      ${listButtons(i, items.length)}</div>`).join('');
  return `<div data-list="${f.key}"${lang ? ` data-list-lang="${lang}"` : ''} class="flex flex-col gap-2">${lang && lang !== 'both' ? `<p class="text-[11px] font-semibold uppercase text-gray-500">${lang}</p>` : ''}${rows}
    <div><button type="button" data-add data-list-key="${f.key}"${lang ? ` data-list-lang="${lang}"` : ''} class="${BTN.secondary}">${esc(t('admin.cms.list.add' as never))}</button></div></div>`;
}

function linksList(f: FieldDef, items: LinkItem[]): string {
  const rows = items.map((l, i) => `<div data-row class="flex flex-col gap-2 p-3 lg:p-2 rounded-xl border border-border">
      <p class="text-xs font-medium text-gray-500">${esc(tf('admin.cms.list.link' as never, { n: i + 1 }))}</p>
      <div class="${PAIR}">
        ${control({ ...f, kind: 'text', key: `${f.key}` }, l.label.en, 'en').replace(`data-field="${f.key}"`, `data-field="${f.key}" data-part="label"`)}
        ${control({ ...f, kind: 'text', key: `${f.key}` }, l.label.tr, 'tr').replace(`data-field="${f.key}"`, `data-field="${f.key}" data-part="label"`)}
      </div>
      <input type="url" data-field="${f.key}" data-part="url" aria-label="${esc(tk('admin.cms.f.url'))}" placeholder="https://" value="${esc(l.url)}" class="${INPUT}" />
      ${listButtons(i, items.length)}</div>`).join('');
  return `<div data-list="${f.key}" class="flex flex-col gap-2">${rows}
    <div><button type="button" data-add data-list-key="${f.key}" class="${BTN.secondary}">${esc(t('admin.cms.list.addLink' as never))}</button></div></div>`;
}

function imageField(f: FieldDef, v: unknown): string {
  const url = f.image === 'url' ? String(v ?? '') : (v as ImageObject | null)?.full ?? '';
  const obj = f.image === 'object' ? (v as ImageObject | null) : null;
  return `<div data-image="${f.key}" class="flex flex-col gap-2">
    <input type="hidden" data-field="${f.key}" data-image-value value="${esc(JSON.stringify(v ?? (f.image === 'url' ? '' : null)))}" />
    <div class="flex flex-wrap items-center gap-3">
      ${url ? `<img src="${esc(url)}" alt="" class="w-20 h-14 rounded-lg object-cover border border-border bg-[#F7F7F6]" />` : ''}
      <label class="relative ${BTN.secondary} cursor-pointer">${esc(t((url ? 'admin.cms.image.replace' : 'admin.cms.image.choose') as never))}
        <input type="file" data-image-file="${f.key}" accept="image/jpeg,image/png,image/webp,image/gif" class="sr-only" /></label>
      ${url ? `<button type="button" data-image-remove="${f.key}" class="${BTN.ghost} text-red hover:text-red">${esc(t('admin.cms.image.remove' as never))}</button>` : ''}
      <p data-image-status="${f.key}" class="text-xs text-gray-500"></p>
    </div>
    ${obj ? `<div><p class="text-xs font-medium text-gray-500 mb-1">${esc(tk('admin.cms.f.alt'))}</p><div class="${PAIR}">
      ${control({ ...f, kind: 'text' }, obj.alt?.en ?? '', 'en').replace(`data-field="${f.key}"`, `data-field="${f.key}" data-part="alt"`)}
      ${control({ ...f, kind: 'text' }, obj.alt?.tr ?? '', 'tr').replace(`data-field="${f.key}"`, `data-field="${f.key}" data-part="alt"`)}
    </div></div>` : ''}
  </div>`;
}

function markdownField(f: FieldDef, v: Bi): string {
  const side = (lang: 'en' | 'tr') => `<label class="flex flex-col gap-1 min-w-0">${langTag(lang)}
    <textarea ${attrs(f, lang)} aria-label="${aria(f, lang)}" rows="8" class="${INPUT} font-mono text-xs">${esc(v[lang])}</textarea></label>`;
  return `<div class="${PAIR}">${side('en')}${side('tr')}</div>
    <div class="mt-2"><button type="button" data-preview="${f.key}" aria-expanded="false" class="${BTN.ghost} px-0">${esc(t('admin.cms.preview.show' as never))}</button></div>
    <div data-preview-box="${f.key}" class="hidden ${PAIR} mt-1"></div>`;
}

/**
 * How a value is held (cms-diff's Mode): a JSON entry's; a pair type's
 * top-level `{ en, tr }`; or one inside a pair type's row, where a
 * per-language field is `{ en, tr }` and a shared one is plain.
 */
export type Mode = 'json' | 'pair' | 'pairRow';
const modeOf = (model: TypeModel): Mode => (model.format === 'json' ? 'json' : 'pair');
/** The mode of a value inside a row: rows of a pair type hold pairRow values. */
const rowMode = (mode: Mode): Mode => (mode === 'json' ? 'json' : 'pairRow');
/**
 * The mode one field's own value is held in. In a pair row, a shared field
 * whose sides differ (isSplit) is held, shown and read like a per-language one.
 */
const leafMode = (mode: Mode, f: FieldDef, v?: unknown): Mode => (mode === 'pairRow' ? (f.perLang || isSplit(v) ? 'pair' : 'json') : mode);

/** The body of one field: its controls, for how its value is held. */
function bodyOf(mode: Mode, f: FieldDef, v: unknown): string {
  if (f.kind === 'objects') return objectsList(rowMode(mode), f, Array.isArray(v) ? v as Row[] : []);
  const m = leafMode(mode, f, v);
  if (m === 'pair') {
    const b = v as Bi<unknown>;
    if (f.kind === 'markdown') return markdownField(f, b as Bi);
    if (sharedShowsOne(f, b)) {
      if (f.kind === 'strings') return stringsList(f, b.en as string[], 'both');
      if (f.kind === 'image') return imageField(f, b.en);
      return control(f, b.en, 'both');
    }
    if (f.kind === 'strings') return `<div class="${PAIR}">${stringsList(f, b.en as string[], 'en')}${stringsList(f, b.tr as string[], 'tr')}</div>`;
    if (f.kind === 'image') return `<p class="text-xs text-gray-500">${esc(t('admin.cms.image.split' as never))}</p><div class="${PAIR}">${control({ ...f, kind: 'text' }, b.en, 'en')}${control({ ...f, kind: 'text' }, b.tr, 'tr')}</div>`;
    return `<div class="${PAIR}">${control(f, b.en, 'en')}${control(f, b.tr, 'tr')}</div>`;
  }
  switch (f.kind) {
    case 'bilingual': {
      const b = v as Bi;
      const kind = f.multiline ? 'textarea' : 'text';
      return `<div class="${PAIR}">${control({ ...f, kind }, b.en, 'en')}${control({ ...f, kind }, b.tr, 'tr')}</div>`;
    }
    case 'bilingualStrings': {
      const b = (v ?? { en: [], tr: [] }) as Bi<string[]>;
      return `<div class="${PAIR}">${stringsList(f, b.en ?? [], 'en')}${stringsList(f, b.tr ?? [], 'tr')}</div>`;
    }
    case 'strings': return stringsList(f, v as string[], null);
    case 'links': return linksList(f, v as LinkItem[]);
    case 'image': return imageField(f, v);
    default: return control(f, v, null);
  }
}

// ── Rows (objects) ───────────────────────────────────────────────────────────

/** A row's number, "Kaynak 3". */
const rowNum = (f: FieldDef, i: number) => tf((f.rowName ?? ROW_NAME) as never, { n: i + 1 });
const ARROW = `${BTN.ghost} w-11 lg:w-9 px-0 shrink-0`;

/** One field inside a row: label, help and controls. Hidden (not removed) while its showIf is false. */
function subField(mode: Mode, f: FieldDef, row: Row): string {
  const v = row[f.key];
  const locked = lockedAfterSave(f, v, mode === 'pairRow');
  const ro = f.readOnly || locked;
  return `<div data-sub-wrap="${f.key}"${f.showIf ? ' data-show-if' : ''} class="flex flex-col gap-1 min-w-0"${shown(f, row) ? '' : ' hidden'}>
    <p class="text-xs font-medium text-gray-600">${esc(tk(f.label))}${f.required && !ro ? `<span class="text-red" aria-hidden="true"> *</span><span class="sr-only"> (${esc(tk('admin.cms.required'))})</span>` : ''}${locked ? ` <span class="font-normal text-gray-500">· ${esc(tk('admin.cms.rows.locked'))}</span>` : ''}</p>
    ${f.help ? `<p class="text-xs text-gray-500 -mt-0.5">${esc(tk(f.help))}</p>` : ''}
    <fieldset class="min-w-0" ${ro ? 'disabled' : ''}>${bodyOf(mode, f, v)}</fieldset>
  </div>`;
}

/**
 * One row: collapsed to a line (its number and summary, with up and down),
 * its fields and Çıkar below when opened. The buttons in the line stop the
 * click from opening the row (cms.ts, rowsClick).
 */
function rowHtml(mode: Mode, f: FieldDef, row: Row, i: number, n: number, open = false): string {
  const label = summaryOf(f, row);
  const from = typeof row[ROW_FROM] === 'string' ? ` data-row-from="${esc(row[ROW_FROM])}"` : '';
  return `<details data-orow${from} class="group min-w-0 rounded-xl border border-border bg-white"${open ? ' open' : ''}>
    <summary class="flex items-center gap-1 min-h-11 lg:min-h-9 pl-3 pr-1 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
      <span aria-hidden="true" class="shrink-0 w-3 text-gray-500 transition-transform group-open:rotate-90">›</span>
      <span data-row-num class="shrink-0 text-xs font-semibold text-gray-500">${esc(rowNum(f, i))}</span>
      <span data-row-label class="flex-1 min-w-0 truncate text-sm text-navy">${esc(label)}</span>
      <button type="button" data-row-move="-1" class="${ARROW}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(tk('admin.cms.list.up'))}">↑</button>
      <button type="button" data-row-move="1" class="${ARROW}" ${i === n - 1 ? 'disabled' : ''} aria-label="${esc(tk('admin.cms.list.down'))}">↓</button>
    </summary>
    <div data-row-body class="flex flex-col gap-3 min-w-0 pl-2 pr-2 lg:pl-3 lg:pr-3 pb-3 pt-2 border-t border-border">
      ${(f.fields ?? []).map((s) => subField(mode, s, row)).join('')}
      <div><button type="button" data-row-remove class="${BTN.ghost} px-0 text-red hover:text-red">${esc(tk('admin.cms.list.remove'))}</button></div>
    </div>
  </details>`;
}

/** A list of rows, with Satır ekle. `mode` is the rows' own (json or pairRow). */
function objectsList(mode: Mode, f: FieldDef, rows: Row[]): string {
  return `<div data-objects="${f.key}" data-mode="${mode}" class="flex flex-col gap-2 min-w-0">
    <div data-rows class="flex flex-col gap-2 min-w-0">${rows.map((r, i) => rowHtml(mode, f, r, i, rows.length)).join('')}</div>
    <p data-rows-none class="text-sm text-gray-500"${rows.length ? ' hidden' : ''}>${esc(tk('admin.cms.rows.none'))}</p>
    <div><button type="button" data-row-add class="${BTN.secondary}">${esc(tk('admin.cms.rows.add'))}</button></div>
  </div>`;
}

const lang = (): 'en' | 'tr' => (document.documentElement.lang === 'tr' ? 'tr' : 'en');

/** The field definitions from the top field down to `el`'s innermost field, read from the page's wraps. */
function defsAt(model: TypeModel, el: Element): FieldDef[] {
  const keys: string[] = [];
  for (let n: Element | null = el; n; n = n.parentElement) {
    const k = (n as HTMLElement).dataset?.subWrap ?? (n as HTMLElement).dataset?.fieldWrap;
    if (k !== undefined) keys.unshift(k);
    if ((n as HTMLElement).dataset?.fieldWrap !== undefined) break;
  }
  const out: FieldDef[] = [];
  let fields = model.fields;
  for (const k of keys) {
    const f = fields.find((x) => x.key === k);
    if (!f) return [];
    out.push(f);
    fields = f.fields ?? [];
  }
  return out;
}

/** A list's rows, in page order. */
const rowsOf = (list: Element) => [...(list.querySelector(':scope > [data-rows]')?.children ?? [])] as HTMLElement[];

/** Numbers, first/last arrows and the "none yet" line of a list after a row moved, came or went. */
function renumber(list: HTMLElement, f: FieldDef): void {
  const rows = rowsOf(list);
  rows.forEach((row, i) => {
    const num = row.querySelector(':scope > summary > [data-row-num]');
    if (num) num.textContent = rowNum(f, i);
    const [up, down] = [...row.querySelectorAll<HTMLButtonElement>(':scope > summary > [data-row-move]')];
    if (up) up.disabled = i === 0;
    if (down) down.disabled = i === rows.length - 1;
  });
  list.querySelector<HTMLElement>(':scope > [data-rows-none]')!.hidden = rows.length > 0;
}

/** One row's values from the page. */
function readRowEl(mode: Mode, f: FieldDef, row: Element): Row {
  const body = row.querySelector(':scope > [data-row-body]');
  const out: Row = {};
  for (const s of f.fields ?? []) {
    const wrap = body?.querySelector(`:scope > [data-sub-wrap="${s.key}"]`);
    out[s.key] = wrap ? readIn(mode, s, wrap) : (emptyRow(f, mode === 'pairRow')[s.key]);
  }
  const from = (row as HTMLElement).dataset.rowFrom;
  if (from !== undefined) out[ROW_FROM] = from;
  return out;
}

function readRows(mode: Mode, f: FieldDef, wrap: Element): Row[] {
  const list = wrap.querySelector(`[data-objects="${f.key}"]`);
  return list ? rowsOf(list).map((row) => readRowEl(mode, f, row)) : [];
}

/**
 * A click on a row's or a row field's buttons: add, remove or move a row,
 * or a list inside a row. Rows are moved on the page, not redrawn, so open
 * rows stay open. Returns whether it handled the click; the caller then
 * announces the change (an input event).
 */
export function rowsClick(model: TypeModel, target: HTMLElement): boolean {
  const list = target.closest<HTMLElement>('[data-objects]');
  if (!list) return false;
  const mode = list.dataset.mode as Mode;
  const add = target.closest('[data-row-add]');
  const move = target.closest<HTMLElement>('[data-row-move]');
  const remove = target.closest('[data-row-remove]');
  // A list (strings, links) inside a row, or a photo's Kaldır: redraw that field alone.
  const leaf = target.closest<HTMLElement>('[data-sub-wrap]');
  if (!add && !move && !remove && leaf && list.contains(leaf)) {
    const s = defsAt(model, leaf).at(-1);
    if (!s || s.kind === 'objects') return false;
    if (s.kind === 'image' && target.closest('[data-image-remove]')) return !!setRowImage(model, leaf, '');
    const value = readIn(mode, s, leaf);
    const next = listEdit(leafMode(mode, s, value), s, value, target);
    if (next === undefined) return false;
    return !!redrawSubField(model, leaf, next);
  }
  const f = defsAt(model, list).at(-1);
  if (!f || f.kind !== 'objects' || f.key !== list.dataset.objects) return false;
  const rowsBox = list.querySelector<HTMLElement>(':scope > [data-rows]')!;
  if (add && add.closest('[data-objects]') === list) {
    const n = rowsOf(list).length;
    rowsBox.insertAdjacentHTML('beforeend', rowHtml(mode, f, emptyRow(f, mode === 'pairRow'), n, n + 1, true));
    renumber(list, f);
    rowsOf(list).at(-1)?.querySelector<HTMLElement>('[data-row-body] input:not([disabled]), [data-row-body] select, [data-row-body] textarea')?.focus();
    return true;
  }
  const row = target.closest<HTMLElement>('[data-orow]');
  if (!row || row.parentElement !== rowsBox) return false;
  if (move) {
    const d = Number(move.dataset.rowMove);
    const other = d < 0 ? row.previousElementSibling : row.nextElementSibling;
    if (!other) return true;
    if (d < 0) rowsBox.insertBefore(row, other); else rowsBox.insertBefore(other, row);
    renumber(list, f);
    const same = row.querySelector<HTMLButtonElement>(`:scope > summary > [data-row-move="${d}"]`);
    (same && !same.disabled ? same : row.querySelector<HTMLElement>(':scope > summary'))?.focus();
    return true;
  }
  if (remove) {
    const focusNext = (row.nextElementSibling ?? row.previousElementSibling)?.querySelector<HTMLElement>(':scope > summary') ?? list.querySelector<HTMLElement>(':scope > div > [data-row-add]');
    row.remove();
    renumber(list, f);
    focusNext?.focus();
    return true;
  }
  return false;
}

/**
 * One field inside a row drawn again with a new value, in place: the row
 * stays open and keeps its other values. Returns the new wrap, or null when
 * `leaf` is not a row's field.
 */
export function redrawSubField(model: TypeModel, leaf: HTMLElement, value: unknown): HTMLElement | null {
  const defs = defsAt(model, leaf);
  const s = defs.at(-1);
  const parent = defs.at(-2);
  const row = leaf.closest('[data-orow]');
  const list = leaf.closest<HTMLElement>('[data-objects]');
  if (!s || !parent || !row || !list) return null;
  const mode = list.dataset.mode as Mode;
  const hidden = leaf.hidden;
  const values = { ...readRowEl(mode, parent, row), [s.key]: value };
  leaf.outerHTML = subField(mode, s, values);
  const fresh = row.querySelector<HTMLElement>(`:scope > [data-row-body] > [data-sub-wrap="${s.key}"]`);
  if (fresh) fresh.hidden = hidden;
  return fresh;
}

/**
 * A photo inside a row set to an uploaded file's address, or cleared with
 * ''. Kept in the shape the field holds: a plain address, both sides of a
 * pair row, or an image object with its description.
 */
export function setRowImage(model: TypeModel, leaf: HTMLElement, url: string): HTMLElement | null {
  const s = defsAt(model, leaf).at(-1);
  const list = leaf.closest<HTMLElement>('[data-objects]');
  if (!s || s.kind !== 'image' || !list) return null;
  const before = readIn(list.dataset.mode as Mode, s, leaf);
  const next = isSplit(before) ? { en: url, tr: url }
    : s.image === 'object' ? (url ? { ...((before as ImageObject | null) ?? { alt: { en: '', tr: '' } }), thumb: url, full: url } : null)
    : url;
  return redrawSubField(model, leaf, next);
}

/** The new value of a strings/links/bilingualStrings list after a click on its Ekle, ↑, ↓ or Çıkar; undefined for any other click. */
export function listEdit(mode: Mode, f: FieldDef, value: unknown, target: HTMLElement): unknown {
  const listLang = target.closest<HTMLElement>('[data-list-lang]')?.dataset.listLang as 'en' | 'tr' | 'both' | undefined;
  const i = Number(target.closest<HTMLElement>('[data-row-i]')?.dataset.rowI ?? -1);
  let fn: ((l: unknown[]) => unknown[]) | null = null;
  if (target.closest('[data-add]')) fn = (l) => [...l, f.kind === 'links' ? { label: { en: '', tr: '' }, url: '' } : ''];
  else if (target.closest('[data-remove]')) fn = (l) => l.filter((_, j) => j !== i);
  else if (target.closest('[data-move]')) {
    const d = Number(target.closest<HTMLElement>('[data-move]')!.dataset.move);
    fn = (l) => { const j = i + d; if (j < 0 || j >= l.length) return l; [l[i], l[j]] = [l[j], l[i]]; return l; };
  }
  if (!fn) return undefined;
  if (mode === 'pair' || f.kind === 'bilingualStrings') {
    const v = value as { en: unknown[]; tr: unknown[] };
    if (listLang === 'both') { const l = fn([...v.en]); return { en: l, tr: [...l] }; }
    return listLang ? { ...v, [listLang]: fn([...v[listLang]]) } : undefined;
  }
  return fn([...(value as unknown[])]);
}

/**
 * After an edit: each row's summary line, and fields shown or hidden by
 * their showIf (inside rows, and at the top against the entry's values).
 */
export function refreshRows(model: TypeModel, root: Element): void {
  const conditional = model.fields.filter((f) => f.showIf);
  if (conditional.length) {
    const values = readValues(model, root);
    for (const f of conditional) {
      const wrap = root.querySelector<HTMLElement>(`[data-field-wrap="${f.key}"]`);
      if (wrap) wrap.hidden = !shown(f, values);
    }
  }
  for (const list of root.querySelectorAll<HTMLElement>('[data-objects]')) {
    const f = defsAt(model, list).at(-1);
    if (!f || f.kind !== 'objects') continue;
    const mode = list.dataset.mode as Mode;
    for (const row of rowsOf(list)) {
      const value = readRowEl(mode, f, row);
      const label = row.querySelector(':scope > summary > [data-row-label]');
      if (label) label.textContent = summaryOf(f, value);
      for (const s of f.fields ?? []) {
        if (!s.showIf) continue;
        const wrap = row.querySelector<HTMLElement>(`:scope > [data-row-body] > [data-sub-wrap="${s.key}"]`);
        if (wrap) wrap.hidden = !shown(s, value);
      }
    }
  }
}

/**
 * The control an error place points to inside an `objects` field, with
 * every row on the way opened; null when the page has no such row.
 */
export function controlInRows(wrap: Element, trail: { key: string; row: number }[], leaf: string | undefined, errLang: string | undefined): HTMLElement | null {
  let scope: Element = wrap;
  for (const step of trail) {
    const list = scope.querySelector(`[data-objects="${step.key}"]`);
    const row = list ? rowsOf(list)[step.row] : undefined;
    if (!row) return null;
    (row as HTMLDetailsElement).open = true;
    scope = row.querySelector(':scope > [data-row-body]') ?? row;
  }
  const target = leaf ? scope.querySelector(`:scope > [data-sub-wrap="${leaf}"]`) : scope.closest('[data-orow]');
  if (!target) return null;
  if (!leaf) return target.querySelector<HTMLElement>(':scope > summary');
  const pick = (sel: string) => target.querySelector<HTMLElement>(sel);
  return (errLang ? pick(`[data-lang="${errLang}"]`) ?? pick('[data-lang="both"]') : null) ?? pick('[data-field]:not([type=hidden])');
}

/** Fields short enough to share a row from lg up: a date, a choice, a number. */
export const isShort = (f: FieldDef) => ['date', 'select', 'number'].includes(f.kind);

/** One field: label, help, controls and its error line. */
export function renderField(model: TypeModel, f: FieldDef, v: unknown, opts: { readOnly?: boolean } = {}): string {
  const ro = opts.readOnly || f.readOnly || f.approverOnly;
  const label = f.approverOnly ? tk('admin.cms.f.note') : tk(f.label);
  return `<div data-field-wrap="${f.key}" class="flex flex-col gap-1 min-w-0 ${isShort(f) ? '' : 'lg:col-span-3'}">
    <p class="relative text-xs font-medium text-gray-600">${esc(label)}${f.required && !ro ? `<span class="text-red" aria-hidden="true"> *</span><span class="sr-only"> (${esc(tk('admin.cms.required'))})</span>` : ''}</p>
    ${f.help ? `<p class="text-xs text-gray-500 -mt-0.5">${esc(tk(f.help))}</p>` : ''}
    <fieldset class="min-w-0" ${ro ? 'disabled' : ''}>${bodyOf(modeOf(model), f, v)}</fieldset>
    <p data-error="${f.key}" role="alert" class="hidden text-xs text-red"></p>
  </div>`;
}

// ── Reading values back ──────────────────────────────────────────────────────

const q = <T extends Element>(root: Element, sel: string) => [...root.querySelectorAll<T>(sel)];

function readControl(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, f: FieldDef): unknown {
  if (f.kind === 'checkbox') return (el as HTMLInputElement).checked;
  return el.value;
}

function readList(wrap: Element, f: FieldDef, lang: Lang | null): string[] {
  const list = wrap.querySelector(`[data-list="${f.key}"]${lang ? `[data-list-lang="${lang}"]` : ''}`);
  return list ? q<HTMLInputElement>(list, 'input[data-item]').map((i) => i.value) : [];
}

function readLinks(wrap: Element): LinkItem[] {
  return q<HTMLElement>(wrap, '[data-row]').map((row) => ({
    label: {
      en: row.querySelector<HTMLInputElement>('[data-part="label"][data-lang="en"]')?.value ?? '',
      tr: row.querySelector<HTMLInputElement>('[data-part="label"][data-lang="tr"]')?.value ?? '',
    },
    url: row.querySelector<HTMLInputElement>('[data-part="url"]')?.value ?? '',
  }));
}

function readImage(wrap: Element, f: FieldDef): unknown {
  const hidden = wrap.querySelector<HTMLInputElement>('[data-image-value]');
  let v: unknown = f.image === 'url' ? '' : null;
  try { v = JSON.parse(hidden?.value ?? 'null'); } catch { /* keep empty */ }
  if (f.image === 'object' && v && typeof v === 'object') {
    const alt = (lang: 'en' | 'tr') => wrap.querySelector<HTMLInputElement>(`[data-part="alt"][data-lang="${lang}"]`)?.value ?? '';
    return { ...(v as ImageObject), alt: { en: alt('en'), tr: alt('tr') } };
  }
  return f.image === 'url' ? String(v ?? '') : v;
}

/** One field's value from the page, in the shape formValues gives it. */
export function readField(model: TypeModel, f: FieldDef, wrap: Element): unknown {
  return readIn(modeOf(model), f, wrap);
}

function readIn(mode: Mode, f: FieldDef, wrap: Element): unknown {
  if (f.kind === 'objects') return readRows(rowMode(mode), f, wrap);
  // A split shared field in a pair row has its two controls on the page.
  const split = mode === 'pairRow' && !!wrap.querySelector('[data-lang="en"], [data-list-lang="en"]');
  if (leafMode(mode, f) === 'pair' || split) {
    if (f.kind === 'markdown') {
      const side = (lang: 'en' | 'tr') => wrap.querySelector<HTMLTextAreaElement>(`textarea[data-field="${f.key}"][data-lang="${lang}"]`)?.value ?? '';
      return { en: side('en'), tr: side('tr') };
    }
    if (f.kind === 'strings') {
      if (wrap.querySelector(`[data-list-lang="both"]`)) { const v = readList(wrap, f, 'both'); return { en: v, tr: [...v] }; }
      return { en: readList(wrap, f, 'en'), tr: readList(wrap, f, 'tr') };
    }
    if (f.kind === 'image' && wrap.querySelector('[data-image-value]')) { const v = readImage(wrap, f); return { en: v, tr: v }; }
    const both = wrap.querySelector<HTMLInputElement>(`[data-field="${f.key}"][data-lang="both"]`);
    if (both) { const v = readControl(both, f); return { en: v, tr: v }; }
    const one = (lang: 'en' | 'tr') => {
      const el = wrap.querySelector<HTMLInputElement>(`[data-field="${f.key}"][data-lang="${lang}"]`);
      return el ? readControl(el, f) : f.kind === 'checkbox' ? false : '';
    };
    return { en: one('en'), tr: one('tr') };
  }
  switch (f.kind) {
    case 'bilingual': {
      const one = (lang: 'en' | 'tr') => wrap.querySelector<HTMLInputElement>(`[data-field="${f.key}"][data-lang="${lang}"]`)?.value ?? '';
      return { en: one('en'), tr: one('tr') };
    }
    case 'bilingualStrings': return { en: readList(wrap, f, 'en'), tr: readList(wrap, f, 'tr') };
    case 'strings': return readList(wrap, f, null);
    case 'links': return readLinks(wrap);
    case 'image': return readImage(wrap, f);
    default: {
      const el = wrap.querySelector<HTMLInputElement>(`[data-field="${f.key}"]`);
      return el ? readControl(el, f) : f.kind === 'checkbox' ? false : '';
    }
  }
}

/** The values of every editable field on the page. */
export function readValues(model: TypeModel, root: Element): Values {
  const out: Values = {};
  for (const f of model.fields) {
    if (f.readOnly || f.approverOnly) continue;
    const wrap = root.querySelector(`[data-field-wrap="${f.key}"]`);
    if (wrap) out[f.key] = readField(model, f, wrap);
  }
  return out;
}

// ── Showing values and changes (the approver's view) ─────────────────────────

/** A value as text, for the diff and the "on the site" column. */
export function show(f: FieldDef, v: unknown): string {
  if (v === undefined || v === null || v === '') return t('admin.cms.diff.empty' as never) as string;
  if (typeof v === 'boolean') return tk(v ? 'admin.cms.yes' : 'admin.cms.no');
  if (f.kind === 'select') return optionLabel(f, String(v));
  if (Array.isArray(v)) return v.map((x) => show(f, x)).join(', ');
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('url' in o && 'label' in o) { const l = o.label as Bi; return `${l.en} / ${l.tr} · ${o.url}`; }
    if ('full' in o) return String(o.full);
    if ('en' in o && 'tr' in o) return `${o.en} / ${o.tr}`;
    return JSON.stringify(v);
  }
  return String(v);
}

const STATE_TONE = { added: 'green', removed: 'red', moved: 'amber', same: 'neutral', changed: 'navy' } as const;

function beforeAfter(f: FieldDef, before: unknown, after: unknown, lang?: string): string {
  const cell = (label: string, v: unknown, cls: string) => `<div class="min-w-0 rounded-lg px-3 py-2 ${cls}">
    <p class="text-[11px] font-semibold uppercase text-gray-500">${esc(label)}${lang ? ` · ${esc(lang.toUpperCase())}` : ''}</p>
    <p class="text-sm text-navy whitespace-pre-wrap [overflow-wrap:anywhere]">${esc(show(f, v))}</p></div>`;
  return `<div class="${PAIR}">${cell(t('admin.cms.diff.live' as never) as string, before, 'bg-[#F7F7F6]')}${cell(t('admin.cms.diff.new' as never) as string, after, 'bg-green-50')}</div>`;
}

function changeHtml(f: FieldDef, c: Change): string {
  switch (c.type) {
    case 'value': return beforeAfter(f, c.before, c.after);
    case 'bilingual': return (['en', 'tr'] as const).filter((l) => c[l]).map((l) => beforeAfter(f, c[l]!.before, c[l]!.after, l)).join('');
    case 'list': return `<ul class="flex flex-col gap-1">${c.lang ? `<li class="text-[11px] font-semibold uppercase text-gray-500">${c.lang}</li>` : ''}${c.items.map((i) =>
      `<li class="flex items-start gap-2 text-sm text-navy">${chip(tk(`admin.cms.diff.${i.state}`), STATE_TONE[i.state])}<span class="min-w-0 [overflow-wrap:anywhere]">${esc(show(f, i.value))}</span></li>`).join('')}</ul>`;
    case 'lines': return `<div class="rounded-lg border border-border overflow-hidden">${c.lang ? `<p class="px-3 py-1 text-[11px] font-semibold uppercase text-gray-500 bg-[#F7F7F6]">${c.lang}</p>` : ''}
      <div class="font-mono text-xs">${c.lines.filter((l, i, all) => l.op !== ' ' || all[i - 1]?.op !== ' ' || all[i + 1]?.op !== ' ').map((l) =>
        `<p class="px-3 py-0.5 whitespace-pre-wrap [overflow-wrap:anywhere] ${l.op === '+' ? 'bg-green-50 text-green-800' : l.op === '-' ? 'bg-red-tint text-[#8a1c1c]' : 'text-gray-500'}"><span aria-hidden="true">${l.op === ' ' ? '&nbsp;' : l.op}</span> ${esc(l.text)}</p>`).join('')}</div></div>`;
    case 'rows': return `<ul class="flex flex-col gap-2 min-w-0">${c.rows.map((r) => rowChangeHtml(f, r)).join('')}</ul>`;
  }
}

/**
 * One row of a list that differs: its state, number and summary; for an
 * added row everything in it (it is all new), for a changed or moved one
 * the fields that changed, each as the diff shows a field.
 */
function rowChangeHtml(f: FieldDef, r: RowChange): string {
  const head = `<p class="flex flex-wrap items-center gap-2 min-w-0">${chip(tk(`admin.cms.diff.${r.state}`), STATE_TONE[r.state])}
    <span class="text-xs font-semibold text-gray-500">${esc(rowNum(f, r.n - 1))}</span>
    <span class="min-w-0 text-sm text-navy [overflow-wrap:anywhere]">${esc(summaryOf(f, r.row))}</span></p>`;
  const inner = r.state === 'added' ? `<div class="pl-3 border-l-2 border-green-200">${rowAll(f, r.row)}</div>`
    : r.changes.length ? `<div class="flex flex-col gap-2 pl-3 border-l-2 border-border">${r.changes.map(({ field, changes }) =>
      `<div class="flex flex-col gap-1 min-w-0"><p class="text-xs font-semibold text-navy">${esc(tk(field.label))}</p>${changes.map((c) => changeHtml(field, c)).join('')}</div>`).join('')}</div>` : '';
  return `<li data-diff-row="${r.state}" class="flex flex-col gap-1 min-w-0">${head}${inner}</li>`;
}

/** The changed fields, open, and the unchanged ones under one collapsed line. */
export function renderDiff(diff: EntryDiff): string {
  const changed = diff.changed.map(({ field, changes }) => `<div data-diff-field="${field.key}" class="flex flex-col gap-2 py-3 lg:py-2 border-b border-border last:border-0">
      <p class="text-sm font-semibold text-navy">${esc(tk(field.label))}</p>${changes.map((c) => changeHtml(field, c)).join('')}</div>`).join('');
  const unchanged = diff.unchanged.length
    ? `<details class="mt-2"><summary class="cursor-pointer min-h-11 lg:min-h-9 flex items-center text-sm text-gray-500">${esc(tf('admin.cms.review.unchanged' as never, { n: diff.unchanged.length }))}</summary>
        <p class="text-sm text-gray-600 pb-2">${diff.unchanged.map((f) => esc(tk(f.label))).join(', ')}</p></details>` : '';
  return `${changed}${unchanged}`;
}

/** A value as text, for one field held in `mode` (an objects field as one line per row). */
export function showIn(mode: Mode, f: FieldDef, v: unknown): string {
  if (f.kind === 'objects') {
    const rows = Array.isArray(v) ? v as Row[] : [];
    return rows.length ? rows.map((r, i) => `${rowNum(f, i)}: ${summaryOf(f, r)}`).join('\n') : tk('admin.cms.diff.empty');
  }
  if (leafMode(mode, f, v) === 'pair') {
    const b = v as Bi<unknown>;
    return sharedShowsOne(f, b) ? show(f, b.en) : `EN: ${show(f, b.en)}\nTR: ${show(f, b.tr)}`;
  }
  return show(f, v);
}

/** Every shown field of a row with its value, rows inside it as nested lists. */
function rowAll(f: FieldDef, row: Row): string {
  const mode: Mode = 'pairRow';
  return (f.fields ?? []).filter((s) => shown(s, row)).map((s) => {
    const v = row[s.key];
    if (s.kind === 'objects') {
      const rows = Array.isArray(v) ? v as Row[] : [];
      return `<div class="py-1 min-w-0"><p class="text-xs font-medium text-gray-500">${esc(tk(s.label))}</p>${rows.length ? `<ol class="flex flex-col gap-1 mt-1">${rows.map((r, i) =>
        `<li class="min-w-0"><p class="text-xs font-semibold text-gray-500">${esc(rowNum(s, i))}</p><div class="pl-3 border-l-2 border-border">${rowAll(s, r)}</div></li>`).join('')}</ol>` : `<p class="text-sm text-navy">${esc(tk('admin.cms.diff.empty'))}</p>`}</div>`;
    }
    // A per-language value is { en, tr } in a pair type's row and in a JSON row's bilingual field alike.
    // A per-language or split value of a pair row; a JSON row's bilingual field reads "en / tr".
    const text = s.kind !== 'bilingual' && isSplit(v) ? showIn(mode, s, v) : show(s, v);
    return `<div class="py-1 min-w-0"><p class="text-xs font-medium text-gray-500">${esc(tk(s.label))}</p><p class="text-sm text-navy whitespace-pre-wrap [overflow-wrap:anywhere]">${esc(text)}</p></div>`;
  }).join('');
}

/** Every field with its value: a new entry, or the entry a delete removes. */
export function renderAll(model: TypeModel, values: Values, fields: FieldDef[]): string {
  return fields.filter((f) => shown(f, values)).map((f) => {
    const v = values[f.key];
    if (f.kind === 'objects') {
      const rows = Array.isArray(v) ? v as Row[] : [];
      return `<div class="py-2 border-b border-border last:border-0 min-w-0"><p class="text-xs font-medium text-gray-500">${esc(tk(f.label))}</p>${rows.length ? `<ol class="flex flex-col gap-2 mt-1">${rows.map((r, i) =>
        `<li class="min-w-0"><p class="text-xs font-semibold text-gray-500">${esc(rowNum(f, i))}</p><div class="pl-3 border-l-2 border-border">${rowAll(f, r)}</div></li>`).join('')}</ol>` : `<p class="text-sm text-navy">${esc(tk('admin.cms.diff.empty'))}</p>`}</div>`;
    }
    return `<div class="py-2 border-b border-border last:border-0"><p class="text-xs font-medium text-gray-500">${esc(tk(f.label))}</p>
      <p class="text-sm text-navy whitespace-pre-wrap [overflow-wrap:anywhere] ${f.kind === 'markdown' ? 'line-clamp-6' : ''}">${esc(showIn(modeOf(model), f, v))}</p></div>`;
  }).join('');
}

/**
 * "Dosya farkı": each file's lines as main has them against the draft's,
 * collapsed. Opened, with a warning above it, when the files change but no
 * field does (`hidden`).
 */
export function renderFileDiff(files: FileDiff[], hidden: boolean): string {
  if (!files.length) return '';
  const warn = hidden ? `<p data-cms-hidden-changes role="alert" class="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">${esc(tk('admin.cms.review.hiddenChanges'))}</p>` : '';
  return `${warn}<details data-cms-file-diff class="mt-3 bg-white rounded-2xl border border-border p-4 lg:p-3"${hidden ? ' open' : ''}>
    <summary class="cursor-pointer min-h-11 lg:min-h-9 flex items-center text-sm font-semibold text-navy">${esc(tk('admin.cms.review.fileDiff'))}</summary>
    <div class="flex flex-col gap-3 mt-2 min-w-0">${files.map((f) => `<div class="flex flex-col gap-1 min-w-0">
      <p class="font-mono text-xs text-gray-600 [overflow-wrap:anywhere]">${esc(f.path)}</p>
      ${f.changed ? changeHtml({ key: f.path, kind: 'markdown', label: '', group: 'main' }, { type: 'lines', lines: f.lines }) : `<p class="text-sm text-gray-500">${esc(tk('admin.cms.review.fileSame'))}</p>`}</div>`).join('')}</div>
  </details>`;
}
