/**
 * Bundled by tests/browser/cms-rows.mjs (esbuild) and put into the built
 * admin page: draws synthetic models with `objects` fields, three lists
 * deep, with the panel's own renderer, inside the panel's own form box, so
 * the check sees the real styles at the real width. No real content type
 * has an `objects` field yet (plan 4 Tasks 4-8 add them).
 *
 * Its clicks and typing go through the same functions cms.ts calls
 * (rowsClick, refreshRows, readValues, controlInRows), and stop there, so
 * the events form under it never hears them.
 */
import { applyValues, formValues, placeOf, placePhrases, type FieldDef, type Row, type TypeModel } from '../../../src/scripts/admin/cms-form';
import { controlInRows, readValues, refreshRows, renderField, rowsClick } from '../../../src/scripts/admin/cms-render';
import { t, tf } from '../../../src/scripts/admin/context';

const f = (o: Partial<FieldDef> & Pick<FieldDef, 'key' | 'kind' | 'label'>): FieldDef => ({ group: 'main', ...o });

const GUIDE = {
  key: 'guide', format: 'json', sub: 'x', group: 'ogrenme', idField: 'title', label: 'admin.cms.f.title', hidden: {},
  fields: [
    f({ key: 'title', kind: 'bilingual', label: 'admin.cms.f.title', required: true }),
    f({ key: 'tags', kind: 'bilingualStrings', label: 'admin.cms.f.topics' }),
    f({ key: 'sections', kind: 'objects', label: 'admin.cms.f.links', identity: 'name', fields: [
      f({ key: 'name', kind: 'text', label: 'admin.cms.f.repo', required: true }),
      f({ key: 'heading', kind: 'bilingual', label: 'admin.cms.f.title' }),
      f({ key: 'resources', kind: 'objects', label: 'admin.cms.f.links', rowName: 'admin.cms.list.link', identity: 'id', fields: [
        f({ key: 'id', kind: 'text', label: 'admin.cms.f.translationKey', readOnlyAfterSave: true }),
        f({ key: 'title', kind: 'bilingual', label: 'admin.cms.f.title', multiline: true }),
        f({ key: 'kind', kind: 'select', label: 'admin.cms.f.webinarType', options: ['bioinfonet', 'student'] }),
        f({ key: 'speaker', kind: 'text', label: 'admin.cms.f.speaker', showIf: (r: Row) => r.kind === 'student' }),
        f({ key: 'notes', kind: 'objects', label: 'admin.cms.f.keyTakeaways', fields: [
          f({ key: 'text', kind: 'bilingual', label: 'admin.cms.f.description' }),
          f({ key: 'url', kind: 'text', label: 'admin.cms.f.url' }),
        ] }),
      ] }),
    ] }),
  ],
} as unknown as TypeModel;

const LONG = 'A rather long English title that keeps going so that it would push a narrow phone layout sideways if anything let it';
const GUIDE_DATA = {
  title: { en: 'Guide', tr: 'Rehber' },
  tags: { en: ['genomics'], tr: ['genomik'] },
  sections: [
    { name: 'basics', heading: { en: 'Basics', tr: 'Temeller' }, resources: [
      { id: 'r-one', title: { en: 'One', tr: 'Bir' }, kind: 'bioinfonet', notes: [{ text: { en: LONG, tr: 'Uzun' }, url: 'https://example.org/a/very/long/path/that/does/not/break/easily/anywhere/at/all' }] },
      { id: 'r-two', title: { en: 'Two', tr: 'İki' }, kind: 'student', speaker: 'Dr. Synthetic' },
    ] },
    { name: 'next', heading: { en: 'Next', tr: 'Sonra' }, resources: [] },
  ],
};

/** A pair type: per-language and shared fields in one row, at the same index on both sides. */
const PATH = {
  key: 'path', format: 'markdown-pair', sub: 'y', group: 'ogrenme', idField: 'en.frontmatter.title', label: 'admin.cms.f.title', hidden: {},
  fields: [
    f({ key: 'title', kind: 'text', label: 'admin.cms.f.title', perLang: true }),
    f({ key: 'resources', kind: 'objects', label: 'admin.cms.f.links', identity: 'id', fields: [
      f({ key: 'id', kind: 'text', label: 'admin.cms.f.translationKey', readOnlyAfterSave: true }),
      f({ key: 'title', kind: 'text', label: 'admin.cms.f.title', perLang: true }),
      f({ key: 'url', kind: 'text', label: 'admin.cms.f.url' }),
      f({ key: 'tags', kind: 'strings', label: 'admin.cms.f.domains' }),
    ] }),
  ],
} as unknown as TypeModel;
// The sides differ as real learning-path files do: a Turkish url with /tr, and a row only Turkish has.
const PATH_DATA = {
  en: { frontmatter: { title: 'Path', resources: [
    { id: 'a-1', title: 'Alpha', url: 'https://a', tags: ['x'] },
    { id: 'b-2', title: 'Beta', url: 'https://b' },
  ] }, body: '\n' },
  tr: { frontmatter: { title: 'Yol', resources: [
    { id: 'a-1', title: 'Alfa', url: '/tr/a', tags: ['x'] },
    { id: 'b-2', title: 'Beta TR', url: 'https://b' },
    { id: 'c-3', title: 'Gama', url: '/tr/c' },
  ] }, body: '\n' },
};

const MODELS: Record<string, { model: TypeModel; data: unknown }> = { guide: { model: GUIDE, data: GUIDE_DATA }, path: { model: PATH, data: PATH_DATA } };
let current: { model: TypeModel; data: unknown; root: HTMLElement } | null = null;

function mount(which: string): void {
  const { model, data } = MODELS[which];
  const box = document.getElementById('cmsFields')!;
  const values = formValues(model, data);
  box.innerHTML = `<div id="harness" class="bg-white rounded-2xl border border-border p-4 lg:p-3 grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-3">
    ${model.fields.map((x) => renderField(model, x, values[x.key])).join('')}</div>`;
  const root = document.getElementById('harness')!;
  root.addEventListener('click', (e) => {
    if (rowsClick(model, e.target as HTMLElement)) { e.preventDefault(); refreshRows(model, root); }
    e.stopPropagation();
  });
  root.addEventListener('input', (e) => { refreshRows(model, root); e.stopPropagation(); });
  root.addEventListener('change', (e) => e.stopPropagation());
  refreshRows(model, root);
  current = { model, data, root };
}

/** Where an error path points, as cms.ts shows it: the words, and the control (rows on the way opened). */
function error(path: string): { label: string; found: boolean; visible: boolean; lang: string | null } {
  const { model, root } = current!;
  const p = placeOf(model, path);
  const label = placePhrases(model, p).map((w) => (w.vars ? tf(w.key as never, w.vars) : t(w.key as never))).join(' › ');
  const wrap = root.querySelector(`[data-field-wrap="${p.key}"]`)!;
  const el = p.trail ? controlInRows(wrap, p.trail, p.leaf, p.lang) : null;
  el?.focus();
  return { label, found: !!el, visible: !!el && el.getClientRects().length > 0, lang: el?.getAttribute('data-lang') ?? null };
}

(window as unknown as { harness: unknown }).harness = {
  mount,
  values: () => readValues(current!.model, current!.root),
  data: () => applyValues(current!.model, current!.data, readValues(current!.model, current!.root)),
  error,
};
