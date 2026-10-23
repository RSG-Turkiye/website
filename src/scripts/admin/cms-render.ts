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
import { sharedShowsOne, type Bi, type FieldDef, type ImageObject, type LinkItem, type TypeModel, type Values } from './cms-form';
import type { Change, EntryDiff } from './cms-diff';

const tk = (k: string) => t(k as never) as string;
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
        .map((o) => `<option value="${esc(o)}" ${o === v ? 'selected' : ''}>${esc(tk(`admin.cms.opt.${o}`))}</option>`).join('')}</select>`);
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
      <label class="${BTN.secondary} cursor-pointer">${esc(t((url ? 'admin.cms.image.replace' : 'admin.cms.image.choose') as never))}
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

/** The body of one field: its controls, for the model's format. */
function body(model: TypeModel, f: FieldDef, v: unknown): string {
  if (model.format === 'markdown-pair') {
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
    case 'strings': return stringsList(f, v as string[], null);
    case 'links': return linksList(f, v as LinkItem[]);
    case 'image': return imageField(f, v);
    default: return control(f, v, null);
  }
}

/** Fields short enough to share a row from lg up: a date, a choice, a number. */
export const isShort = (f: FieldDef) => ['date', 'select', 'number'].includes(f.kind);

/** One field: label, help, controls and its error line. */
export function renderField(model: TypeModel, f: FieldDef, v: unknown, opts: { readOnly?: boolean } = {}): string {
  const ro = opts.readOnly || f.readOnly || f.approverOnly;
  const label = f.approverOnly ? tk('admin.cms.f.note') : tk(f.label);
  return `<div data-field-wrap="${f.key}" class="flex flex-col gap-1 min-w-0 ${isShort(f) ? '' : 'lg:col-span-3'}">
    <p class="text-xs font-medium text-gray-600">${esc(label)}</p>
    ${f.help ? `<p class="text-xs text-gray-500 -mt-0.5">${esc(tk(f.help))}</p>` : ''}
    <fieldset class="min-w-0" ${ro ? 'disabled' : ''}>${body(model, f, v)}</fieldset>
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
  if (model.format === 'markdown-pair') {
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
    case 'strings': return readList(wrap, f, null);
    case 'links': return readLinks(wrap);
    case 'image': return readImage(wrap, f);
    default: {
      const el = wrap.querySelector<HTMLInputElement>(`[data-field="${f.key}"]`);
      return el ? readControl(el, f) : '';
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
  if (f.kind === 'select') return tk(`admin.cms.opt.${String(v)}`);
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

const STATE_TONE = { added: 'green', removed: 'red', moved: 'amber', same: 'neutral' } as const;

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
  }
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

/** Every field with its value: a new entry, or the entry a delete removes. */
export function renderAll(model: TypeModel, values: Values, fields: FieldDef[]): string {
  return fields.map((f) => {
    const v = values[f.key];
    const text = model.format === 'markdown-pair'
      ? (sharedShowsOne(f, v as Bi<unknown>) ? show(f, (v as Bi<unknown>).en) : `EN: ${show(f, (v as Bi<unknown>).en)}\nTR: ${show(f, (v as Bi<unknown>).tr)}`)
      : show(f, v);
    return `<div class="py-2 border-b border-border last:border-0"><p class="text-xs font-medium text-gray-500">${esc(tk(f.label))}</p>
      <p class="text-sm text-navy whitespace-pre-wrap [overflow-wrap:anywhere] ${f.kind === 'markdown' ? 'line-clamp-6' : ''}">${esc(text)}</p></div>`;
  }).join('');
}
