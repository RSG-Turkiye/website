// The Etkinlikler panel's form model (src/scripts/admin/cms-form.ts) against
// the real schemas and every real file: each schema key is in its type's
// model (or hidden on purpose), and data goes through the form and back
// unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CMS_TYPES, cmsType, type CmsType } from '../src/lib/cms/types';
import { jsonSchemaFor } from '../src/lib/cms/json-schema';
import { parseMarkdown, serializeJson } from '../src/lib/cms/serialize';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { realFixtures } from './lib/cms-fixtures';
import { EM_DASH_MESSAGE, FAILURE, houseRuleErrors, NO_AT_MESSAGE } from '../functions/_lib/cms-drafts';
import { ui } from '../src/i18n/ui';
import {
  MODELS, applyValues, emptyData, errorKey, failureKey, formValues, halfTranslated, isEmptyValue, livePath, messageKey, placeOf, sharedShowsOne,
  statusView, suggestedId, visibleFields, type Bi, type FieldDef, type TypeKey, type TypeModel,
} from '../src/scripts/admin/cms-form';
import { diffEntry, lineDiff, listDiff } from '../src/scripts/admin/cms-diff';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');
const json = (dir: string) => readdirSync(`${ROOT}${dir}`).map((f) => ({ name: f, data: JSON.parse(read(`${dir}/${f}`)) }));
const WEBINARS = cmsType('webinars')!;

function files(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of ['src/content/events', 'src/content/workshops', 'src/content/webinars/en', 'src/content/webinars/tr', 'src/content/committees']) {
    for (const f of readdirSync(`${ROOT}${dir}`)) out[`${dir}/${f}`] = read(`${dir}/${f}`);
  }
  return out;
}
const FILES = files();
const INDEX = buildCmsIndex(FILES);
// Entries picked by shape, never by name: the panel edits and deletes them (A2).
const { EVENT_ID, EVENT_PATH, SAME_NAME_ID } = realFixtures(FILES, INDEX);
/** A webinar pair as GET /api/cms/entry answers it (JSON round trip included). */
const pair = (id: string) => {
  const w = INDEX.webinars.find((e) => e.id === id)!;
  const side = (p: string | null | undefined) => (p ? parseMarkdown(WEBINARS, FILES[p]) : null);
  return JSON.parse(JSON.stringify({ en: side(w.paths?.en), tr: side(w.paths?.tr) }));
};

test('every registered type has a model, and the model mirrors the registry the panel cannot import', () => {
  assert.deepEqual(Object.keys(MODELS).sort(), CMS_TYPES.map((t) => t.key).sort());
  for (const type of CMS_TYPES) {
    const m = MODELS[type.key as TypeKey];
    assert.equal(m.key, type.key);
    assert.equal(m.format, type.format, type.key);
    assert.equal(m.group, type.group, type.key);
    assert.equal(m.idField, type.idField, type.key);
    assert.equal(m.noCreate ?? false, type.noCreate, `${type.key} noCreate`);
    assert.equal(m.noDelete ?? false, type.noDelete, `${type.key} noDelete`);
    assert.equal(m.generated ?? false, type.generated, `${type.key} generated`);
    assert.equal(m.approve ?? 'group', type.approve, `${type.key} approve`);
  }
});

test('tab ids are unique, safe for the address, and the old Etkinlikler ones are kept (A15)', () => {
  const subs = Object.values(MODELS).map((m) => m.sub);
  assert.equal(new Set(subs).size, subs.length);
  for (const s of subs) {
    assert.match(s, /^[a-z][a-z-]{0,39}$/);
    assert.ok(!['taslaklar', 'onay'].includes(s), s);
  }
  assert.equal(MODELS.events.sub, 'etkinlikler');
  assert.equal(MODELS.workshops.sub, 'atolyeler');
  assert.equal(MODELS.webinars.sub, 'webinarlar');
});

type JS = { type?: string; properties?: Record<string, JS>; items?: JS; enum?: string[]; additionalProperties?: unknown };

/**
 * What is wrong with `fields` against an object's JSON schema: a schema key
 * neither shown nor hidden, a field the schema lacks, and, inside `objects`
 * rows (to any depth), the same plus the rows' key order, which must be the
 * schema's (rows are written in the fields' order).
 */
function coverage(where: string, fields: FieldDef[], schema: JS, hidden: Record<string, string> = {}): string[] {
  const props = schema.properties ?? {};
  const shown = fields.map((f) => f.key);
  const out: string[] = [];
  for (const k of Object.keys(props)) if (!shown.includes(k) && !Object.hasOwn(hidden, k)) out.push(`${where}.${k} is neither shown nor hidden`);
  for (const k of Object.keys(hidden)) if (shown.includes(k)) out.push(`${where}.${k} is both hidden and shown`);
  for (const f of fields) {
    const p = props[f.key];
    if (!p) { out.push(`${where}: the model has ${f.key}, the schema does not`); continue; }
    if (p.enum && f.key !== 'lang' && (f.kind !== 'select' || JSON.stringify(f.options) !== JSON.stringify(p.enum))) out.push(`${where}.${f.key}: the enum is not the select's options`);
    if (f.kind === 'bilingualStrings' && !(p.properties?.en?.type === 'array' && p.properties?.tr?.type === 'array')) out.push(`${where}.${f.key}: not { en: string[], tr: string[] }`);
    if (f.kind !== 'objects') continue;
    const item = p.items;
    if (p.type !== 'array' || !item?.properties) { out.push(`${where}.${f.key}: the schema's is not a list of objects`); continue; }
    out.push(...coverage(`${where}.${f.key}[]`, f.fields ?? [], item));
    const order = Object.keys(item.properties).filter((k) => (f.fields ?? []).some((x) => x.key === k));
    if (order.join() !== (f.fields ?? []).map((x) => x.key).filter((k) => k in item.properties!).join()) out.push(`${where}.${f.key}: the rows' fields are not in the schema's order`);
  }
  return out;
}

/** A type's coverage. A fixedKeys type may have a z.record schema: its form is built from its data (fieldsFor). */
function typeCoverage(type: CmsType, model: TypeModel): string[] {
  const schema = jsonSchemaFor(type) as JS;
  if (!schema.properties) return type.fixedKeys && schema.additionalProperties && model.fieldsFor ? [] : [`${type.key}: the schema has no keys and the type is not fixedKeys with fieldsFor`];
  return coverage(type.key, model.fields, schema, model.hidden);
}

test('every schema key of every type is in its field model (nested rows too), or hidden with a reason', () => {
  for (const type of CMS_TYPES) assert.deepEqual(typeCoverage(type, MODELS[type.key as TypeKey]), [], type.key);
});

test('every enum in a schema is the select\'s options, in order', () => {
  for (const type of CMS_TYPES) {
    const props = (jsonSchemaFor(type) as { properties: Record<string, { enum?: string[] }> }).properties;
    for (const f of MODELS[type.key as TypeKey].fields) {
      if (props[f.key]?.enum && f.key !== 'lang') {
        assert.equal(f.kind, 'select', `${type.key}.${f.key}`);
        assert.deepEqual([...f.options!], props[f.key].enum, `${type.key}.${f.key}`);
      }
    }
  }
});

test('the first group holds what people come to change, as the brief lists it', () => {
  const main = (k: TypeKey) => MODELS[k].fields.filter((f) => f.group === 'main').map((f) => f.key);
  assert.deepEqual(main('events'), ['title', 'start', 'end', 'type', 'when', 'location', 'description']);
  assert.deepEqual(main('workshops'), ['title', 'year', 'topics', 'repo']);
  assert.deepEqual(main('webinars'), ['title', 'date', 'speaker', 'speakerTitle', 'speakerAffiliation', 'youtubeUrl', 'description']);
});

test('the internal note is for approvers only', () => {
  assert.ok(!visibleFields(MODELS.events, false).some((f) => f.key === 'note'));
  assert.ok(visibleFields(MODELS.events, true).some((f) => f.key === 'note'));
});

test('an event goes through the form and back unchanged; an edited when.tr comes back changed', () => {
  const data = JSON.parse(FILES[EVENT_PATH]);
  const original = structuredClone(data);
  const values = formValues(MODELS.events, data);
  assert.deepEqual(applyValues(MODELS.events, data, values), data);
  const changed = `${data.when.tr} (edited)`;
  const edited = { ...values, when: { ...(values.when as Bi), tr: changed } };
  const out = applyValues(MODELS.events, data, edited) as typeof data;
  assert.equal(out.when.tr, changed);
  assert.deepEqual({ ...out, when: data.when }, data, 'nothing else moved');
  assert.deepEqual(data, original, 'the input is not changed');
});

test('every event and workshop file round-trips', () => {
  for (const [key, dir] of [['events', 'src/content/events'], ['workshops', 'src/content/workshops']] as const) {
    for (const { name, data } of json(dir)) assert.deepEqual(applyValues(MODELS[key], data, formValues(MODELS[key], data)), data, name);
  }
});

test('every webinar pair round-trips, legacy lang and source included', () => {
  for (const w of INDEX.webinars) {
    const data = pair(w.id);
    assert.deepEqual(applyValues(MODELS.webinars, data, formValues(MODELS.webinars, data)), data, w.id);
  }
});

test('a webinar body round-trips and an edit to one language stays in that language', () => {
  const data = pair(SAME_NAME_ID);
  const values = formValues(MODELS.webinars, data);
  const body = values.body as Bi;
  assert.equal(body.en, data.en.body);
  const out = applyValues(MODELS.webinars, data, { ...values, body: { ...body, tr: body.tr + '\nYeni satır.\n' } }) as typeof data;
  assert.equal(out.tr.body, data.tr.body + '\nYeni satır.\n');
  assert.equal(out.en.body, data.en.body);
});

test('a shared webinar field shows one control and writes both sides; one whose sides differ shows two', () => {
  const model = MODELS.webinars;
  const date = model.fields.find((f) => f.key === 'date')!;
  const data = pair(SAME_NAME_ID);
  const values = formValues(model, data);
  assert.ok(sharedShowsOne(date, values.date as Bi));
  const out = applyValues(model, data, { ...values, date: { en: '2024-05-01', tr: '2024-05-01' } }) as typeof data;
  assert.equal(out.en.frontmatter.date, '2024-05-01');
  assert.equal(out.tr.frontmatter.date, '2024-05-01');
  assert.ok(!sharedShowsOne(date, { en: '2024-04-16', tr: '2024-04-17' }));
  const title = model.fields.find((f) => f.key === 'title')!;
  assert.ok(!sharedShowsOne(title, { en: 'x', tr: 'x' }), 'a per-language field is always two');
});

test('an untouched new entry adds nothing; cleared optional fields leave the file', () => {
  for (const key of ['events', 'workshops', 'webinars'] as const) {
    const base = emptyData(MODELS[key]);
    assert.deepEqual(applyValues(MODELS[key], base, formValues(MODELS[key], base)), base, key);
  }
  const data = JSON.parse(FILES[EVENT_PATH]);
  const values = formValues(MODELS.events, data);
  const out = applyValues(MODELS.events, data, { ...values, end: '' }) as Record<string, unknown>;
  assert.ok(!('end' in out), 'a cleared end date is removed, not ""');
  const withImage = applyValues(MODELS.events, data, { ...values, image: { thumb: '/api/images/a.webp', full: '/api/images/a.webp', alt: { en: 'Poster', tr: 'Afiş' } } }) as Record<string, any>;
  assert.equal(withImage.image.thumb, withImage.image.full);
  assert.ok(!('image' in (applyValues(MODELS.events, withImage, { ...formValues(MODELS.events, withImage), image: null }) as object)));
  const workshop = applyValues(MODELS.workshops, {}, { title: 'T', year: '2027', topics: 'x', repo: 'R' }) as Record<string, unknown>;
  assert.equal(workshop.year, 2027, 'a number field writes a number');
});

test('the file name of a new entry comes from its title (or repo), read-only', () => {
  assert.equal(suggestedId(MODELS.events, { title: { en: 'Ankara Meetup', tr: '' }, start: '2027-03-06' }), 'ankara-meetup-2027');
  assert.equal(suggestedId(MODELS.events, { title: { en: 'Symposium 2027', tr: '' }, start: '2027-10-10' }), 'symposium-2027');
  assert.equal(suggestedId(MODELS.events, { title: { en: '', tr: 'Ankara' }, start: '' }), '');
  assert.equal(suggestedId(MODELS.workshops, { repo: 'Computational_Structural_Biology_Workshop' }), 'computational-structural-biology-workshop');
  assert.equal(suggestedId(MODELS.webinars, { title: { en: 'Çok Güzel Bir Başlık', tr: '' } }), 'cok-guzel-bir-baslik');
  // The same rule as the registry's idFrom for the types it derives itself.
  assert.equal(suggestedId(MODELS.workshops, { repo: 'X_Y' }), cmsType('workshops')!.idFrom({ repo: 'X_Y' }));
});

test('server error paths become fields, rows and languages', () => {
  assert.deepEqual(placeOf(MODELS.events, 'title.tr'), { key: 'title', part: undefined, lang: 'tr' });
  assert.deepEqual(placeOf(MODELS.events, 'links.1.url'), { key: 'links', row: 1, part: 'url', lang: undefined });
  assert.deepEqual(placeOf(MODELS.events, 'links.0.label.en'), { key: 'links', row: 0, part: 'label', lang: 'en' });
  assert.deepEqual(placeOf(MODELS.events, 'image.alt.tr'), { key: 'image', part: 'alt', lang: 'tr' });
  assert.equal(placeOf(MODELS.events, 'id').key, 'title', 'the id comes from the title');
  assert.deepEqual(placeOf(MODELS.webinars, 'en.frontmatter.title'), { key: 'title', lang: 'en' });
  assert.deepEqual(placeOf(MODELS.webinars, 'tr.body'), { key: 'body', lang: 'tr' });
  assert.deepEqual(placeOf(MODELS.webinars, 'tr'), { key: null, lang: 'tr' });
  assert.equal(messageKey('Invalid input: expected string, received undefined'), 'admin.cms.v.required');
  assert.equal(messageKey('Too small: expected string to have >=1 characters'), 'admin.cms.v.required');
  assert.equal(messageKey('end is before start'), 'admin.cms.v.endBeforeStart');
  assert.equal(messageKey('Invalid ISO date'), 'admin.cms.v.date');
  assert.equal(messageKey('Invalid option: expected one of "a"|"b"'), 'admin.cms.v.option');
  assert.equal(messageKey('something new'), 'admin.cms.v.invalid');
});

test('every failure reason the server stores has its own sentence', () => {
  for (const [name, value] of Object.entries(FAILURE)) {
    const reason = typeof value === 'function' ? value('build') : value;
    const k = failureKey(reason);
    assert.notEqual(k.key, 'admin.cms.failure.unknown', name);
    assert.ok(k.key in ui.tr && k.key in ui.en, k.key);
  }
  assert.deepEqual(failureKey('check failed: build'), { key: 'admin.cms.failure.check', vars: { name: 'build' } });
  assert.equal(failureKey('github_failed').key, 'admin.cms.failure.github');
});

test('status words name the next step', () => {
  const now = 10_000;
  const at = (status: string, extra: Record<string, unknown> = {}, approver = false) =>
    statusView({ status: status as never, review_note: null, failure: null, updated_at: now - 10, ...extra }, { approver, now });
  assert.deepEqual([at('draft').chip, at('draft').next, at('draft').editable], ['admin.cms.chip.draft', 'continue', true]);
  assert.equal(at('submitted').line, 'admin.cms.status.submitted');
  assert.equal(at('pr_open').line, 'admin.cms.status.goingLive');
  assert.equal(at('merged').line, 'admin.cms.status.goingLive');
  assert.equal(at('merged', { stale_merge: true }).line, 'admin.cms.status.mergedStale');
  assert.equal(at('published').next, 'openSite');
  assert.deepEqual([at('rejected', { review_note: 'x' }).next, at('rejected', { review_note: 'x' }).vars.note], ['fix', 'x']);
  assert.equal(at('pr_failed', { failure: 'checks did not finish' }).next, 'retry');
  // Merged but never on the site: no resend; an approver discards it.
  const notLive = at('pr_failed', { failure: FAILURE.notLive });
  assert.deepEqual([notLive.line, notLive.next, notLive.editable], ['admin.cms.status.mergedStale', null, false]);
  assert.equal(at('pr_failed', { failure: FAILURE.notLive }, true).next, 'discard');
  assert.equal(at('approved', { updated_at: now - 600 }).line, 'admin.cms.status.approvedStale');
  for (const s of ['draft', 'submitted', 'approved', 'pr_open', 'merged', 'published', 'rejected', 'pr_failed', 'discarded']) {
    const v = at(s);
    assert.ok(v.chip in ui.tr && v.chip in ui.en && v.line in ui.tr && v.line in ui.en, s);
  }
  for (const k of ['admin.cms.status.approvedStale', 'admin.cms.status.mergedStale', 'admin.cms.chip.stuck', 'admin.cms.chip.late']) assert.ok(k in ui.tr && k in ui.en, k);
  assert.equal(ui.tr['admin.cms.status.mergedStale'], 'Birleşti ama site güncellenmedi, yöneticiye haber verin');
  assert.equal(ui.tr['admin.cms.status.approvedStale'], 'Onay yarım kaldı, yeniden deneyin');
});

test('every label, help and error sentence exists in both languages', () => {
  const keys = new Set<string>();
  for (const m of Object.values(MODELS)) {
    keys.add(m.label);
    const walk = (fs: FieldDef[]) => { for (const f of fs) { keys.add(f.label); if (f.help) keys.add(f.help); if (f.rowName) keys.add(f.rowName); walk(f.fields ?? []); } };
    walk(m.fields);
  }
  for (const code of ['changed_since', 'entry_busy', 'superseded', 'exists', 'github_failed', 'unauthenticated', 'invalid', 'nonsense']) keys.add(errorKey(code));
  for (const m of ['received undefined', 'end is before start', 'Unknown field', 'Invalid ISO date', 'Invalid option', 'expected number', 'blocked in Türkiye', 'gives the file its name', 'Invalid id', 'same as the English side', EM_DASH_MESSAGE, NO_AT_MESSAGE, 'Invalid input: expected true', 'x']) keys.add(messageKey(m));
  for (const k of keys) {
    assert.ok(k in ui.en, `en missing ${k}`);
    assert.ok(k in ui.tr, `tr missing ${k}`);
  }
  const cms = (lang: 'en' | 'tr') => Object.keys(ui[lang]).filter((k) => k.startsWith('admin.cms.')).sort();
  assert.deepEqual(cms('en'), cms('tr'));
  assert.equal(ui.tr['admin.cms.save'], 'Kaydet (siteye gitmez)');
  assert.equal(ui.tr['admin.cms.submit'], 'Onaya gönder');
  assert.equal(ui.tr['admin.cms.notLiveBanner'], 'Bu taslak henüz sitede değil');
});

test('half-translated texts are found, whole and empty ones are not', () => {
  const data = JSON.parse(FILES[EVENT_PATH]);
  const values = formValues(MODELS.events, data);
  assert.deepEqual(halfTranslated(MODELS.events, values), []);
  const half = { ...values, location: { en: 'Ankara', tr: '' }, links: [{ label: { en: 'Site', tr: '' }, url: 'https://x' }] };
  assert.deepEqual(halfTranslated(MODELS.events, half).map((h) => h.key), ['links'], 'location is required: its field error covers it');
  const w = formValues(MODELS.webinars, pair(SAME_NAME_ID));
  assert.deepEqual(halfTranslated(MODELS.webinars, { ...w, topic: { en: 'ML', tr: '' } }).map((h) => h.key), ['topic']);
});

test('the approver\'s diff: values, both languages, items added, removed and moved, body lines', () => {
  const data = JSON.parse(FILES[EVENT_PATH]);
  const links = [{ label: { en: 'A', tr: 'A' }, url: 'a' }, { label: { en: 'B', tr: 'B' }, url: 'b' }, { label: { en: 'C', tr: 'C' }, url: 'c' }];
  const before = { ...data, links };
  const after = { ...data, when: { ...data.when, tr: `${data.when.tr} (edited)` }, links: [links[2], links[0], { label: { en: 'D', tr: 'D' }, url: 'd' }] };
  const d = diffEntry(MODELS.events, before, after);
  assert.deepEqual(d.changed.map((c) => c.field.key), ['when', 'links']);
  assert.deepEqual(d.changed[0].changes, [{ type: 'bilingual', en: null, tr: { before: data.when.tr, after: `${data.when.tr} (edited)` } }]);
  const items = (d.changed[1].changes[0] as { items: { state: string; value: any }[] }).items.map((i) => `${i.state}:${i.value.url}`);
  assert.deepEqual(items, ['moved:c', 'same:a', 'added:d', 'removed:b']);
  assert.ok(d.unchanged.some((f) => f.key === 'title'));
  assert.deepEqual(diffEntry(MODELS.events, data, data).changed, []);

  assert.deepEqual(listDiff(['a', 'b'], ['b', 'a']).map((i) => i.state).sort(), ['moved', 'same']);
  assert.deepEqual(lineDiff('one\ntwo\nthree', 'one\n2\nthree'), [{ op: ' ', text: 'one' }, { op: '-', text: 'two' }, { op: '+', text: '2' }, { op: ' ', text: 'three' }]);
  const w = pair(SAME_NAME_ID);
  const w2 = JSON.parse(JSON.stringify(w));
  w2.tr.body += 'Ek.\n';
  // A day the entry is not on, whatever date it has.
  const day = String(w.en.frontmatter.date).slice(0, 10) === '2000-01-01' ? '2000-01-02' : '2000-01-01';
  w2.en.frontmatter.date = w2.tr.frontmatter.date = day;
  const wd = diffEntry(MODELS.webinars, w, w2);
  assert.deepEqual(wd.changed.map((c) => c.field.key), ['date', 'body']);
  assert.equal(wd.changed[0].changes[0].type, 'value', 'a shared field both sides agree on is one value');
  assert.deepEqual(wd.changed[1].changes.map((c) => (c as { lang?: string }).lang), ['tr']);
});

test('the live page of a published entry', () => {
  assert.equal(livePath('events', EVENT_ID, [], 'tr'), '/tr/events/');
  assert.equal(livePath('workshops', 'x', [], 'en'), '/workshops/');
  const paths = ['src/content/webinars/en/integrative-modeling-of-biomolecular-complexes.md', 'src/content/webinars/tr/first-webinar-2018-integrative-modeling.md'];
  assert.equal(livePath('webinars', 'integrative-modeling-of-biomolecular-complexes', paths, 'tr'), '/tr/webinars/first-webinar-2018-integrative-modeling/');
  assert.equal(livePath('webinars', 'integrative-modeling-of-biomolecular-complexes', paths, 'en'), '/webinars/integrative-modeling-of-biomolecular-complexes/');
});

test('every admin.cms key the panel\'s scripts look up exists in both languages', () => {
  const used = new Set<string>();
  for (const f of ['cms-form', 'cms-render', 'cms-diff', 'sections/cms', 'sections', 'overview']) {
    const src = read(`src/scripts/admin/${f}.ts`);
    for (const m of src.matchAll(/'(admin\.(?:cms|overview\.cms)[\w.]*)'/g)) if (!m[1].endsWith('.')) used.add(m[1]);
  }
  assert.ok(used.size > 100, `found ${used.size}`);
  for (const k of used) {
    assert.ok(k in ui.en, `en missing ${k}`);
    assert.ok(k in ui.tr, `tr missing ${k}`);
  }
  // Keys built from a code: every value they can take.
  for (const s of ['create', 'update', 'delete']) assert.ok(`admin.cms.action.${s}` in ui.tr, s);
  for (const s of ['added', 'removed', 'moved', 'same']) assert.ok(`admin.cms.diff.${s}` in ui.tr, s);
  const options = (fs: FieldDef[]): string[] => fs.flatMap((f) => [...(f.options ?? []), ...options(f.fields ?? [])]);
  for (const m of Object.values(MODELS)) for (const o of options(m.fields)) assert.ok(`admin.cms.opt.${o}` in ui.tr && `admin.cms.opt.${o}` in ui.en, o);
});

// ── Task 7, fix round 1 ───────────────────────────────────────────────────────

import { backupChoice, backupStorageKey, offeredKey, othersBackupKeys, parseBackup, sameData, uploadErrorKey, BACKUP_MAX_AGE } from '../src/scripts/admin/cms-form';

test('a local backup is restored only when it was made on the version the server has now', () => {
  const now = 1_000_000;
  const b = (o: Record<string, unknown>) => ({ data: { x: 1 }, at: now - 60, updated_at: null, write_nonce: null, base_shas: null, ...o });
  // A draft: the copy names the version it was typed on; only that version lets it win.
  assert.equal(backupChoice(b({ write_nonce: 'v2' }), { write_nonce: 'v2', base_shas: null }, now), 'restore');
  // Saved from another tab or device since (or by this tab, with the answer lost): never silently.
  assert.equal(backupChoice(b({ write_nonce: 'v1' }), { write_nonce: 'v2', base_shas: null }, now), 'ask');
  assert.equal(backupChoice(b({ write_nonce: null }), { write_nonce: 'v2', base_shas: null }, now), 'ask');
  // No client clock in it: a copy "newer" by the clock but on another version still asks.
  assert.equal(backupChoice(b({ at: now + 9999, write_nonce: 'v1' }), { write_nonce: 'v2', base_shas: null }, now), 'ask');
  // A published entry: the files must still be the ones it was read at.
  assert.equal(backupChoice(b({ base_shas: { a: '1' } }), { write_nonce: null, base_shas: { a: '1' } }, now), 'restore');
  assert.equal(backupChoice(b({ base_shas: { a: '1' } }), { write_nonce: null, base_shas: { a: '2' } }, now), 'ask');
  // A new entry has nothing on the server to be older than.
  assert.equal(backupChoice(b({}), { write_nonce: null, base_shas: null }, now), 'restore');
  assert.equal(backupChoice(b({ at: now - BACKUP_MAX_AGE - 1 }), { write_nonce: null, base_shas: null }, now), 'expired');
});

test('the copy being offered has a key of its own, which typing never writes', () => {
  assert.equal(offeredKey('draft-1'), 'draft-1:offered');
  assert.notEqual(backupStorageKey('u1', offeredKey('draft-1')), backupStorageKey('u1', 'draft-1'));
});

test('a lost save is recognised by its data, whatever the key order', () => {
  assert.ok(sameData({ a: 1, b: { c: [1, { d: 2, e: 3 }] } }, { b: { c: [1, { e: 3, d: 2 }] }, a: 1 }));
  assert.ok(!sameData({ a: 1 }, { a: 2 }));
  assert.ok(!sameData({ a: [1, 2] }, { a: [2, 1] }));
});

test('backups are per person, and anything that is not one is ignored', () => {
  assert.equal(backupStorageKey('u1', 'new:events'), 'rsg:cms:u1:new:events');
  assert.deepEqual(othersBackupKeys(['rsg:cms:u1:a', 'rsg:cms:u2:b', 'rsg:cms:legacy', 'rsg:podcast', 'rsg_me_cache'], 'u1'), ['rsg:cms:u2:b', 'rsg:cms:legacy']);
  assert.equal(parseBackup('not json'), null);
  assert.equal(parseBackup(JSON.stringify({ data: {}, at: 'yesterday' })), null);
  assert.equal(parseBackup(JSON.stringify([1, 2])), null);
  assert.deepEqual(parseBackup(JSON.stringify({ data: { a: 1 }, at: 5, updated_at: 3, write_nonce: 'v1', base_shas: { p: null } })), { data: { a: 1 }, at: 5, updated_at: 3, write_nonce: 'v1', base_shas: { p: null } });
  assert.equal(parseBackup(JSON.stringify({ data: {}, at: 5, write_nonce: 7 })), null);
});

test('a webinar\'s year follows its date and is not typed', () => {
  const year = MODELS.webinars.fields.find((f) => f.key === 'year')!;
  assert.ok(year.readOnly);
  const base = emptyData(MODELS.webinars);
  const values = formValues(MODELS.webinars, base);
  const out = applyValues(MODELS.webinars, base, { ...values, date: { en: '2027-02-03', tr: '2027-02-03' } }) as any;
  assert.equal(out.en.frontmatter.year, 2027);
  assert.equal(out.tr.frontmatter.year, 2027);
});

test('required fields are marked; the half-translation warning is only for optional ones', () => {
  const data = JSON.parse(FILES[EVENT_PATH]);
  const values = formValues(MODELS.events, data);
  // A required field half-filled is a field error at submit, not this warning.
  assert.deepEqual(halfTranslated(MODELS.events, { ...values, title: { en: 'x', tr: '' } }), []);
  assert.ok(MODELS.events.fields.find((f) => f.key === 'title')!.required);
  assert.equal(messageKey('An entry with this name already exists'), 'admin.cms.v.exists');
});

test('image upload errors in plain words', () => {
  assert.equal(uploadErrorKey('Unsupported image type. Use JPEG, PNG, WebP, or GIF.'), 'admin.cms.image.err.type');
  assert.equal(uploadErrorKey('Image too large (max 5MB)'), 'admin.cms.image.err.size');
  assert.equal(uploadErrorKey('Image is 4000x3000px. The limit is 2000px'), 'admin.cms.image.err.dimensions');
  assert.equal(uploadErrorKey('That file does not look like a JPEG, PNG, WebP or GIF.'), 'admin.cms.image.err.notImage');
  assert.equal(uploadErrorKey('Not authenticated'), 'admin.cms.error.unauthenticated');
  assert.equal(uploadErrorKey('Upload failed (500)'), 'admin.cms.image.failed');
  for (const k of ['type', 'size', 'dimensions', 'notImage']) assert.ok(`admin.cms.image.err.${k}` in ui.tr && `admin.cms.image.err.${k}` in ui.en, k);
});

test('a change to the internal note alone is a change the approver sees', () => {
  const data = JSON.parse(FILES[EVENT_PATH]);
  const d = diffEntry(MODELS.events, data, { ...data, note: `${data.note ?? ''} (edited)` }, visibleFields(MODELS.events, true));
  assert.deepEqual(d.changed.map((c) => c.field.key), ['note']);
});

// ── Task 2 (plan 4): the objects and bilingualStrings kinds ──────────────────
// Synthetic schemas and models only: the real types that use them come later.

import { z } from 'astro/zod';
import { defineType } from '../src/lib/cms/types';
import { emptyRow, lockedAfterSave, placePhrases, rowSummary, shown, withFields, type Row } from '../src/scripts/admin/cms-form';

const BI = z.object({ en: z.string(), tr: z.string() });
/** A JSON type three lists deep: sections › resources › notes. */
const GUIDE_SCHEMA = z.object({
  title: BI,
  tags: z.object({ en: z.array(z.string()), tr: z.array(z.string()) }).optional(),
  sections: z.array(z.object({
    name: z.string(),
    heading: BI,
    resources: z.array(z.object({
      id: z.string(),
      title: BI,
      kind: z.enum(['link', 'webinar']),
      webinarSlug: z.string().optional(),
      notes: z.array(z.object({ text: z.string(), done: z.boolean().optional() })).optional(),
    })),
  })),
});
const f = (o: Partial<FieldDef> & Pick<FieldDef, 'key' | 'kind'>): FieldDef => ({ label: `admin.cms.f.${o.key}`, group: 'main', ...o });
const GUIDE = {
  key: 'guide', format: 'json', sub: 'rehber', group: 'ogrenme', idField: 'title.en', label: 'x', hidden: {},
  fields: [
    f({ key: 'title', kind: 'bilingual', required: true }),
    f({ key: 'tags', kind: 'bilingualStrings' }),
    f({ key: 'sections', kind: 'objects', rowName: 'Bölüm {n}', identity: 'name', fields: [
      f({ key: 'name', kind: 'text', required: true }),
      f({ key: 'heading', kind: 'bilingual' }),
      f({ key: 'resources', kind: 'objects', rowName: 'Kaynak {n}', identity: 'id', required: true, fields: [
        f({ key: 'id', kind: 'text', readOnlyAfterSave: true }),
        f({ key: 'title', kind: 'bilingual', label: 'Başlık' }),
        f({ key: 'kind', kind: 'select', options: ['link', 'webinar'] }),
        f({ key: 'webinarSlug', kind: 'text', showIf: (r: Row) => r.kind === 'webinar' }),
        f({ key: 'notes', kind: 'objects', rowName: 'Not {n}', fields: [f({ key: 'text', kind: 'text', label: 'Metin' }), f({ key: 'done', kind: 'checkbox' })] }),
      ] }),
    ] }),
  ],
} as unknown as TypeModel;
const GUIDE_DATA = {
  title: { en: 'Guide', tr: 'Rehber' },
  tags: { en: ['a', 'b'], tr: ['a'] },
  sections: [
    { name: 's1', heading: { en: 'Start', tr: 'Başla' }, resources: [
      { id: 'r1', title: { en: 'One', tr: 'Bir' }, kind: 'link' },
      { id: 'r2', title: { en: 'Two', tr: 'İki' }, kind: 'webinar', webinarSlug: 'w2', notes: [{ text: 'n1', done: true }, { text: 'n2' }] },
    ] },
    { name: 's2', heading: { en: 'Next', tr: 'Sonra' }, resources: [] },
  ],
};

/** A pair type: rows mixing per-language fields and shared ones, two deep. */
const PATH = {
  key: 'path', format: 'markdown-pair', sub: 'yol', group: 'ogrenme', idField: 'en.frontmatter.title', label: 'x', hidden: {},
  fields: [
    f({ key: 'title', kind: 'text', perLang: true }),
    f({ key: 'sections', kind: 'objects', rowName: 'Bölüm {n}', fields: [
      f({ key: 'heading', kind: 'text', perLang: true, label: 'Başlık' }),
      f({ key: 'resources', kind: 'objects', rowName: 'Kaynak {n}', identity: 'id', fields: [
        f({ key: 'id', kind: 'text', readOnlyAfterSave: true }),
        f({ key: 'title', kind: 'text', perLang: true, label: 'Başlık' }),
        f({ key: 'url', kind: 'text' }),
        f({ key: 'tags', kind: 'strings' }),
      ] }),
    ] }),
  ],
} as unknown as TypeModel;
const side = (lang: 'en' | 'tr') => ({
  frontmatter: {
    title: lang === 'en' ? 'Path' : 'Yol',
    sections: [
      { heading: lang === 'en' ? 'Basics' : 'Temeller', resources: [
        { id: 'a-1', title: lang === 'en' ? 'Alpha' : 'Alfa', url: 'https://a', tags: ['x'] },
        { id: 'b-2', title: lang === 'en' ? 'Beta' : 'Beta TR', url: 'https://b' },
      ] },
      { heading: lang === 'en' ? 'More' : 'Daha', resources: [{ id: 'c-3', title: lang === 'en' ? 'Gamma' : 'Gama', url: 'https://c' }] },
    ],
  },
  body: '\nBody.\n',
});
const PATH_DATA = { en: side('en'), tr: side('tr') };
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v));

test('objects: the coverage walk goes into rows, checks their key order, and takes a fixedKeys record', () => {
  const t = (schema: z.ZodType, extra: object = {}) => defineType({ key: 'guide' as never, group: 'ogrenme', dir: 'x', format: 'json', schema, idFrom: () => 'x', idField: 'x', indexTitle: () => undefined, label: { en: 'x', tr: 'x' }, ...extra });
  assert.deepEqual(typeCoverage(t(GUIDE_SCHEMA), GUIDE), []);
  // A key missing three lists down, and rows declared out of the schema's order, are both caught.
  const deep = copy(GUIDE_SCHEMA.shape) as never;
  const missing = t(GUIDE_SCHEMA.extend({ sections: z.array(z.object({ name: z.string(), heading: BI, resources: z.array(z.object({ id: z.string(), title: BI, kind: z.enum(['link', 'webinar']), webinarSlug: z.string().optional(), notes: z.array(z.object({ text: z.string(), done: z.boolean().optional(), extra: z.string() })) })) })) }));
  assert.deepEqual(typeCoverage(missing, GUIDE), ['guide.sections[].resources[].notes[].extra is neither shown nor hidden']);
  void deep;
  const swapped = copy(GUIDE) as TypeModel;
  const res = swapped.fields[2].fields![2];
  res.fields = [res.fields![1], res.fields![0], ...res.fields!.slice(2)];
  assert.ok(typeCoverage(t(GUIDE_SCHEMA), swapped).some((p) => p.includes("resources: the rows' fields are not in the schema's order")));
  // Page texts (A7): a record of bilingual texts, its form built from the file.
  const pages = { ...GUIDE, fields: [], fieldsFor: (d: unknown) => Object.keys(d as object).map((k) => f({ key: k, kind: 'bilingual' })) } as TypeModel;
  const record = z.record(z.string(), BI);
  assert.deepEqual(typeCoverage(t(record, { fixedKeys: true }), pages), []);
  assert.equal(typeCoverage(t(record), pages).length, 1, 'only a fixedKeys type may be a record');
});

test('objects: a JSON entry three lists deep goes through the form and back byte for byte', () => {
  const values = formValues(GUIDE, GUIDE_DATA);
  assert.equal(JSON.stringify(applyValues(GUIDE, GUIDE_DATA, values)), JSON.stringify(GUIDE_DATA));
  const rows = values.sections as Row[];
  assert.equal(rows.length, 2);
  const note0 = ((rows[0].resources as Row[])[1].notes as Row[])[0];
  assert.deepEqual({ ...note0, $from: undefined }, { text: 'n1', done: true, $from: undefined });
  assert.match(String(note0.$from), /^0:[0-9a-z]+$/, 'with the row and list it came from');
  // An edit three lists down changes that value and nothing else.
  const edited = copy(values);
  (((edited.sections as Row[])[0].resources as Row[])[1].notes as Row[])[1].text = 'n2 edited';
  const out = applyValues(GUIDE, GUIDE_DATA, edited) as typeof GUIDE_DATA;
  assert.equal(out.sections[0].resources[1].notes![1].text, 'n2 edited');
  const back = copy(out);
  back.sections[0].resources[1].notes![1].text = 'n2';
  assert.equal(JSON.stringify(back), JSON.stringify(GUIDE_DATA));
  assert.equal(GUIDE_DATA.sections[0].resources[1].notes![1].text, 'n2', 'the input is not changed');
});

test('objects: a row is written in the fields\' order whatever order it was built in; empty optional values are left out', () => {
  const row: Row = { notes: [], webinarSlug: '', kind: 'link', title: { en: 'T', tr: '' }, id: '' };
  const values = { ...formValues(GUIDE, GUIDE_DATA) };
  (values.sections as Row[])[1].resources = [row];
  const out = applyValues(GUIDE, GUIDE_DATA, values) as typeof GUIDE_DATA;
  assert.deepEqual(Object.keys(out.sections[1].resources[0]), ['title', 'kind'], 'empty id, slug and notes left out');
  // A required list is written even empty, so the entry keeps its key.
  (values.sections as Row[])[1].resources = [];
  assert.deepEqual((applyValues(GUIDE, GUIDE_DATA, values) as typeof GUIDE_DATA).sections[1].resources, []);
  const fresh = emptyRow(GUIDE.fields[2], false);
  assert.deepEqual(Object.keys(fresh), ['name', 'heading', 'resources']);
  assert.deepEqual(applyValues(GUIDE, {}, { sections: [fresh] }), { sections: [{ name: '', resources: [] }] }, 'required ones written empty, for submit to report');
});

test('objects in a pair type: one list for both sides, per-language fields per side, shared ones on both, at the same index', () => {
  const values = formValues(PATH, PATH_DATA);
  assert.equal(JSON.stringify(applyValues(PATH, PATH_DATA, values)), JSON.stringify(PATH_DATA), 'byte for byte');
  const rows = values.sections as Row[];
  assert.deepEqual(rows[0].heading, { en: 'Basics', tr: 'Temeller' });
  const r = (rows[0].resources as Row[])[1];
  assert.deepEqual({ ...r, $from: undefined }, { id: 'b-2', title: { en: 'Beta', tr: 'Beta TR' }, url: 'https://b', tags: [], $from: undefined });
  assert.match(String(r.$from), /^1:[0-9a-z]+:[0-9a-z]+$/, 'row 1, of the English and the Turkish list');

  // A per-language edit lands on its side; a shared one on both, same row.
  const v = copy(values);
  const res = (v.sections as Row[])[0].resources as Row[];
  (res[1].title as Bi).tr = 'Beta (TR)';
  res[1].url = 'https://b2';
  let out = applyValues(PATH, PATH_DATA, v) as typeof PATH_DATA;
  assert.equal(out.tr.frontmatter.sections[0].resources[1].title, 'Beta (TR)');
  assert.equal(out.en.frontmatter.sections[0].resources[1].title, 'Beta');
  assert.equal(out.en.frontmatter.sections[0].resources[1].url, 'https://b2');
  assert.equal(out.tr.frontmatter.sections[0].resources[1].url, 'https://b2');

  // Move, add and remove keep the two sides index-aligned.
  const moved = copy(values);
  const list = (moved.sections as Row[])[0].resources as Row[];
  list.reverse();
  list.push(emptyRow(PATH.fields[1].fields![1], true));
  (moved.sections as Row[]).splice(1, 1);
  out = applyValues(PATH, PATH_DATA, moved) as typeof PATH_DATA;
  const ids = (lang: 'en' | 'tr') => out[lang].frontmatter.sections.map((s) => s.resources.map((x) => x.id ?? '·').join(','));
  assert.deepEqual(ids('en'), ['b-2,a-1,·']);
  assert.deepEqual(ids('tr'), ids('en'));
  assert.deepEqual(out.tr.frontmatter.sections[0].resources.map((x) => x.title), ['Beta TR', 'Alfa', undefined], 'the new row is empty on both sides');
  assert.equal(out.en.body, PATH_DATA.en.body, 'the body is not touched');

  // A side with fewer rows reads as empty rows; it gains the row back only when its own text is filled in.
  const short = copy(PATH_DATA);
  short.tr.frontmatter.sections.pop();
  const sv = formValues(PATH, short);
  assert.equal((sv.sections as Row[]).length, 2);
  assert.deepEqual((sv.sections as Row[])[1].heading, { en: 'More', tr: '' });
  assert.equal(((sv.sections as Row[])[1].resources as Row[])[0].url, 'https://c', 'a shared value from the side that has it');
  const touched = copy(sv);
  (touched.sections as Row[])[0].heading = { en: 'Basics!', tr: 'Temeller' };
  out = applyValues(PATH, short, touched) as typeof PATH_DATA;
  assert.equal(out.tr.frontmatter.sections.length, 1, 'not filled in: the short side stays short');
  assert.equal(out.en.frontmatter.sections.length, 2);
  ((touched.sections as Row[])[1].heading as Bi).tr = 'Daha';
  out = applyValues(PATH, short, touched) as typeof PATH_DATA;
  assert.equal(out.tr.frontmatter.sections.length, 2, 'filled in: the row is written');
  assert.equal(out.tr.frontmatter.sections[1].resources[0].url, 'https://c');
  assert.equal(out.tr.frontmatter.sections[1].resources[0].id, 'c-3');
});

test('bilingualStrings: two lists side by side, read, written, empty and half-translated', () => {
  const tags = GUIDE.fields[1];
  const values = formValues(GUIDE, GUIDE_DATA);
  assert.deepEqual(values.tags, { en: ['a', 'b'], tr: ['a'] });
  assert.ok(isEmptyValue(tags, { en: [], tr: [] }));
  assert.ok(!isEmptyValue(tags, { en: [], tr: ['x'] }));
  assert.ok(!('tags' in (applyValues(GUIDE, {}, { tags: { en: [], tr: [] } }) as object)), 'an untouched empty pair adds nothing');
  assert.deepEqual((applyValues(GUIDE, GUIDE_DATA, { ...values, tags: { en: ['a'], tr: ['b', 'c'] } }) as typeof GUIDE_DATA).tags, { en: ['a'], tr: ['b', 'c'] });
  assert.deepEqual(halfTranslated(GUIDE, { ...values, tags: { en: ['a'], tr: [] } }).map((h) => h.key), ['tags']);
});

test('objects: half-translated texts inside rows are found, with the rows they are in', () => {
  const values = copy(formValues(GUIDE, GUIDE_DATA));
  assert.deepEqual(halfTranslated(GUIDE, values), []);
  ((values.sections as Row[])[1].heading as Bi).tr = '';
  (((values.sections as Row[])[0].resources as Row[])[1].title as Bi).en = '';
  const half = halfTranslated(GUIDE, values);
  assert.deepEqual(half.map((h) => [h.key, h.label, h.trail]), [
    ['sections', 'Başlık', [{ key: 'sections', row: 0 }, { key: 'resources', row: 1 }]],
    ['sections', 'admin.cms.f.heading', [{ key: 'sections', row: 1 }]],
  ]);
  const p = formValues(PATH, PATH_DATA);
  const pv = copy(p);
  ((pv.sections as Row[])[1].heading as Bi).tr = '';
  assert.deepEqual(halfTranslated(PATH, pv).map((h) => h.trail), [[{ key: 'sections', row: 1 }]]);
});

test('objects: placeOf at depth 3, both formats, and the words of the place', () => {
  const p = placeOf(GUIDE, 'sections.1.resources.2.notes.0.text');
  assert.deepEqual(p, { key: 'sections', part: undefined, lang: undefined, trail: [{ key: 'sections', row: 1 }, { key: 'resources', row: 2 }, { key: 'notes', row: 0 }], leaf: 'text' });
  assert.deepEqual(placeOf(GUIDE, 'sections.0.resources.2.title.en'), { key: 'sections', part: undefined, lang: 'en', trail: [{ key: 'sections', row: 0 }, { key: 'resources', row: 2 }], leaf: 'title' });
  assert.deepEqual(placeOf(PATH, 'tr.frontmatter.sections.1.resources.0.title'), { key: 'sections', part: undefined, lang: 'tr', trail: [{ key: 'sections', row: 1 }, { key: 'resources', row: 0 }], leaf: 'title' });
  assert.deepEqual(placeOf(PATH, 'en.frontmatter.sections.0'), { key: 'sections', part: undefined, lang: 'en', trail: [{ key: 'sections', row: 0 }] });
  assert.deepEqual(placeOf(GUIDE, 'sections'), { key: 'sections', part: undefined, lang: undefined });
  // The rows are named, then the field: "Bölüm 2 › Kaynak 3 › Başlık".
  const words = (path: string, model = GUIDE) => placePhrases(model, placeOf(model, path))
    .map((w) => Object.entries(w.vars ?? {}).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), w.key)).join(' › ');
  assert.equal(words('sections.1.resources.2.title.tr'), 'Bölüm 2 › Kaynak 3 › Başlık');
  assert.equal(words('sections.1.resources.2.notes.0.text'), 'Bölüm 2 › Kaynak 3 › Not 1 › Metin');
  assert.equal(words('tr.frontmatter.sections.1.resources.0.title', PATH), 'Bölüm 2 › Kaynak 1 › Başlık');
  assert.equal(words('sections.0'), 'Bölüm 1');
  // Nothing changes for the old kinds.
  assert.deepEqual(placePhrases(MODELS.events, placeOf(MODELS.events, 'links.1.url')), [{ key: 'admin.cms.f.links' }, { key: 'admin.cms.list.link', vars: { n: 2 } }, { key: 'admin.cms.f.url' }]);
  assert.ok('admin.cms.rows.item' in ui.tr && 'admin.cms.rows.item' in ui.en);
});

test('objects: conditional fields, ids locked once they hold a value, row summaries', () => {
  const res = GUIDE.fields[2].fields![2];
  const slug = res.fields!.find((x) => x.key === 'webinarSlug')!;
  assert.ok(shown(slug, { kind: 'webinar' }));
  assert.ok(!shown(slug, { kind: 'link' }));
  // Hidden is not cleared: a value kept while hidden is still written.
  const values = copy(formValues(GUIDE, GUIDE_DATA));
  ((values.sections as Row[])[0].resources as Row[])[1].kind = 'link';
  assert.equal((applyValues(GUIDE, GUIDE_DATA, values) as typeof GUIDE_DATA).sections[0].resources[1].webinarSlug, 'w2');
  const id = res.fields![0];
  assert.ok(lockedAfterSave(id, 'r1', false));
  assert.ok(!lockedAfterSave(id, '', false), 'a new row\'s id is editable');
  assert.ok(!lockedAfterSave(res.fields![1], { en: 'x', tr: 'y' }, false), 'only readOnlyAfterSave fields lock');
  const r0 = ((values.sections as Row[])[0].resources as Row[])[0];
  assert.equal(rowSummary(res, r0, 'tr'), 'r1', 'the first text filled in');
  assert.equal(rowSummary(res, { ...r0, id: '' }, 'tr'), 'Bir');
  assert.equal(rowSummary(res, { ...r0, id: '' }, 'en'), 'One');
  assert.equal(rowSummary({ ...res, rowLabel: (r) => `#${r.id}` }, r0, 'en'), '#r1');
  assert.equal(rowSummary(res, emptyRow(res, false), 'en'), '');
});

test('fieldsFor (A7): a model built from the entry\'s own keys', () => {
  const model = { ...GUIDE, fields: [], fieldsFor: (d: unknown) => Object.keys(d as object).map((k) => f({ key: k, kind: 'bilingual' })) } as TypeModel;
  const data = { heroTitle: { en: 'Hi', tr: 'Selam' }, cta: { en: 'Join', tr: 'Katıl' } };
  const m = withFields(model, data);
  assert.deepEqual(m.fields.map((x) => x.key), ['heroTitle', 'cta']);
  assert.equal(JSON.stringify(applyValues(m, data, formValues(m, data))), JSON.stringify(data));
  assert.equal(withFields(MODELS.events, data), MODELS.events, 'a static model is itself');
});

test('objects diff: rows by identity (moved, added, removed, changed inside) and by position', () => {
  const after = copy(GUIDE_DATA);
  const res = after.sections[0].resources;
  // r2 moves to the top and its title changes; r1 is removed; r9 is added.
  after.sections[0].resources = [{ ...res[1], title: { en: 'Two', tr: 'İki!' } }, { id: 'r9', title: { en: 'Nine', tr: 'Dokuz' }, kind: 'link' }] as typeof res;
  after.sections.reverse();
  const d = diffEntry(GUIDE, GUIDE_DATA, after);
  assert.deepEqual(d.changed.map((c) => c.field.key), ['sections']);
  const top = d.changed[0].changes[0] as { type: 'rows'; rows: { state: string; n: number; row: Row; changes: { field: FieldDef; changes: any[] }[] }[] };
  assert.equal(top.type, 'rows');
  // Two rows swapped: one of them moved (s2, to the top); s1 kept its order relative to the rest and changed inside.
  assert.deepEqual(top.rows.map((r) => [r.state, r.n, r.row.name, r.changes.length]), [['moved', 1, 's2', 0], ['changed', 2, 's1', 1]]);
  const inner = top.rows[1].changes.find((c) => c.field.key === 'resources')!.changes[0];
  assert.deepEqual(inner.rows.map((r: any) => [r.state, r.n, r.row.id]), [['changed', 1, 'r2'], ['added', 2, 'r9'], ['removed', 1, 'r1']]);
  assert.deepEqual(inner.rows[0].changes.map((c: any) => [c.field.key, c.changes[0]]), [['title', { type: 'bilingual', en: null, tr: { before: 'İki', after: 'İki!' } }]]);
  // A pure move is a move with nothing inside.
  const swap = copy(GUIDE_DATA);
  swap.sections[0].resources.reverse();
  const sd = (diffEntry(GUIDE, GUIDE_DATA, swap).changed[0].changes[0] as any).rows[0].changes[0].changes[0].rows;
  assert.deepEqual(sd.map((r: any) => [r.state, r.row.id, r.changes.length]), [['moved', 'r2', 0]]);
  // Without an identity (notes), rows are compared by position.
  const notes = copy(GUIDE_DATA);
  notes.sections[0].resources[1].notes = [{ text: 'n2' }];
  const nd = (diffEntry(GUIDE, GUIDE_DATA, notes).changed[0].changes[0] as any).rows[0].changes[0].changes[0].rows[0].changes[0].changes[0].rows;
  assert.deepEqual(nd.map((r: any) => [r.state, r.n]), [['changed', 1], ['removed', 2]], 'n1 became n2, the second note is gone');
  assert.deepEqual(nd[0].changes.map((c: any) => c.field.key), ['text', 'done']);
  assert.deepEqual(diffEntry(GUIDE, GUIDE_DATA, copy(GUIDE_DATA)).changed, []);
});

test('objects diff in a pair type, and bilingualStrings per language', () => {
  const after = copy(PATH_DATA);
  for (const lang of ['en', 'tr'] as const) after[lang].frontmatter.sections[0].resources.reverse();
  after.tr.frontmatter.sections[1].resources[0].title = 'Gama!';
  after.en.frontmatter.sections[1].resources[0].url = after.tr.frontmatter.sections[1].resources[0].url = 'https://c2';
  const rows = (diffEntry(PATH, PATH_DATA, after).changed[0].changes[0] as any).rows;
  assert.deepEqual(rows.map((r: any) => [r.state, r.n]), [['changed', 1], ['changed', 2]]);
  const moved = rows[0].changes[0].changes[0].rows;
  assert.deepEqual(moved.map((r: any) => [r.state, r.row.id]), [['moved', 'b-2']]);
  const c3 = rows[1].changes[0].changes[0].rows[0];
  assert.deepEqual(c3.changes.map((c: any) => [c.field.key, c.changes[0]]), [
    ['title', { type: 'bilingual', en: null, tr: { before: 'Gama', after: 'Gama!' } }],
    ['url', { type: 'value', before: 'https://c', after: 'https://c2' }],
  ]);
  const t = diffEntry(GUIDE, GUIDE_DATA, { ...GUIDE_DATA, tags: { en: ['a', 'b'], tr: ['a', 'c'] } });
  assert.deepEqual(t.changed[0].changes, [{ type: 'list', lang: 'tr', items: [{ state: 'same', value: 'a' }, { state: 'added', value: 'c' }] }]);
});

// ── Task 2, fix round 1: rows never lose what the form does not show ─────────

const PROBE_J = {
  key: 'j', format: 'json', sub: 'j', group: 'ogrenme', idField: 'title', label: 'x', hidden: {},
  fields: [
    f({ key: 'title', kind: 'text' }),
    f({ key: 'rows', kind: 'objects', identity: 'name', fields: [
      f({ key: 'name', kind: 'text' }),
      f({ key: 'note', kind: 'text' }),
      f({ key: 'flag', kind: 'checkbox', required: true }),
      f({ key: 'opt', kind: 'checkbox' }),
      f({ key: 'n', kind: 'number' }),
    ] }),
  ],
} as unknown as TypeModel;
const PROBE_J_DATA = { title: 'a', rows: [{ name: 'A', note: '', flag: false, opt: false, n: 0, extra: 1 }, { name: 'B', flag: true }] };
const PROBE_P = {
  key: 'p', format: 'markdown-pair', sub: 'p', group: 'ogrenme', idField: 'en.frontmatter.title', label: 'x', hidden: {},
  fields: [
    f({ key: 'title', kind: 'text', perLang: true }),
    f({ key: 'res', kind: 'objects', identity: 'id', fields: [
      f({ key: 'id', kind: 'text' }),
      f({ key: 'title', kind: 'text', perLang: true }),
      f({ key: 'url', kind: 'text' }),
    ] }),
  ],
} as unknown as TypeModel;
const PROBE_P_DATA = {
  en: { frontmatter: { title: 'E', res: [{ id: 'x', title: 'a', url: '/x/' }] }, body: '' },
  tr: { frontmatter: { title: 'T', res: [{ id: 'x', title: 'b', url: '/tr/x/' }, { id: 'y', title: 'c', url: '/tr/y/' }] }, body: '' },
};

test('fix 1: an edit elsewhere leaves an untouched objects or bilingualStrings field byte for byte', () => {
  const v = formValues(PROBE_J, PROBE_J_DATA);
  v.title = 'b';
  const out = applyValues(PROBE_J, PROBE_J_DATA, v) as typeof PROBE_J_DATA;
  assert.equal(JSON.stringify(out.rows), JSON.stringify(PROBE_J_DATA.rows));
  const pv = formValues(PROBE_P, PROBE_P_DATA);
  (pv.title as Bi).en = 'E2';
  const po = applyValues(PROBE_P, PROBE_P_DATA, pv) as typeof PROBE_P_DATA;
  assert.equal(JSON.stringify(po.tr.frontmatter.res), JSON.stringify(PROBE_P_DATA.tr.frontmatter.res), 'the TR urls keep /tr and the longer side its rows');
  assert.equal(JSON.stringify(po.en.frontmatter.res), JSON.stringify(PROBE_P_DATA.en.frontmatter.res));
  const odd = { ...GUIDE_DATA, tags: { tr: ['z'], en: ['y'] } };
  const gv = formValues(GUIDE, odd);
  (gv.title as Bi).en = 'Guide 2';
  assert.equal(JSON.stringify((applyValues(GUIDE, odd, gv) as typeof odd).tags), JSON.stringify(odd.tags), 'a bilingualStrings value keeps its key order');
});

test('fix 2: a row edited in one field keeps its undeclared keys, empty optionals and false checkboxes, also after a move', () => {
  const v = copy(formValues(PROBE_J, PROBE_J_DATA));
  (v.rows as Row[])[0].n = '5';
  let out = applyValues(PROBE_J, PROBE_J_DATA, v) as typeof PROBE_J_DATA;
  assert.equal(JSON.stringify(out.rows[0]), JSON.stringify({ name: 'A', note: '', flag: false, opt: false, n: 5, extra: 1 }));
  assert.equal(JSON.stringify(out.rows[1]), JSON.stringify(PROBE_J_DATA.rows[1]), 'the other row is as it was');
  (v.rows as Row[]).reverse();
  out = applyValues(PROBE_J, PROBE_J_DATA, v) as typeof PROBE_J_DATA;
  assert.equal(JSON.stringify(out.rows), JSON.stringify([PROBE_J_DATA.rows[1], { ...PROBE_J_DATA.rows[0], n: 5 }]), 'each row keeps its own base after a move');
  // Values without their origin (a restored copy, say) find their row by identity.
  const bare = { ...v, rows: (v.rows as Row[]).map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('$')))) };
  out = applyValues(PROBE_J, PROBE_J_DATA, bare) as typeof PROBE_J_DATA;
  assert.equal(out.rows[1].extra, 1);
  // A new key lands in the schema's place, not at the end.
  const w = copy(formValues(PROBE_J, PROBE_J_DATA));
  (w.rows as Row[])[1].note = 'hi';
  assert.deepEqual(Object.keys((applyValues(PROBE_J, PROBE_J_DATA, w) as typeof PROBE_J_DATA).rows[1]), ['name', 'note', 'flag']);
});

test('fix 3: a shared row field whose sides differ is two inputs and is written per side; a short side gains no row', () => {
  const pv = formValues(PROBE_P, PROBE_P_DATA);
  const rows = pv.res as Row[];
  assert.deepEqual(rows[0].url, { en: '/x/', tr: '/tr/x/' }, 'split, not the English value');
  assert.equal(rows[1].url, '/tr/y/', 'a row only one side has: that side\'s value');
  const v = copy(pv);
  ((v.res as Row[])[0].title as Bi).tr = 'b2';
  const out = applyValues(PROBE_P, PROBE_P_DATA, v) as typeof PROBE_P_DATA;
  assert.deepEqual(out.tr.frontmatter.res.map((r) => r.url), ['/tr/x/', '/tr/y/']);
  assert.deepEqual(out.en.frontmatter.res.map((r) => r.url), ['/x/'], 'the shorter side does not gain the other\'s row');
  assert.equal(out.tr.frontmatter.res[0].title, 'b2');
  // A row the person adds goes to both sides.
  const added = copy(pv);
  (added.res as Row[]).push({ ...emptyRow(PROBE_P.fields[1], true), id: 'z', url: '/z/' });
  const ao = applyValues(PROBE_P, PROBE_P_DATA, added) as typeof PROBE_P_DATA;
  assert.deepEqual(ao.en.frontmatter.res.map((r) => r.id), ['x', 'z']);
  assert.deepEqual(ao.tr.frontmatter.res.map((r) => r.id), ['x', 'y', 'z']);
  // The diff sees a per-side change of a split field.
  const d = diffEntry(PROBE_P, PROBE_P_DATA, { ...PROBE_P_DATA, tr: { ...PROBE_P_DATA.tr, frontmatter: { ...PROBE_P_DATA.tr.frontmatter, res: [{ id: 'x', title: 'b', url: '/tr/x2/' }, PROBE_P_DATA.tr.frontmatter.res[1]] } } });
  const c = (d.changed[0].changes[0] as any).rows[0].changes[0];
  assert.deepEqual([c.field.key, c.changes[0]], ['url', { type: 'bilingual', en: null, tr: { before: '/tr/x/', after: '/tr/x2/' } }]);
});

test('fix 4: a required checkbox set to false is written', () => {
  const out = applyValues(PROBE_J, {}, { rows: [{ ...emptyRow(PROBE_J.fields[1], false), name: 'N' }] }) as typeof PROBE_J_DATA;
  assert.equal(JSON.stringify(out.rows[0]), JSON.stringify({ name: 'N', flag: false }));
  const v = copy(formValues(PROBE_J, PROBE_J_DATA));
  (v.rows as Row[])[1].flag = false;
  assert.equal((applyValues(PROBE_J, PROBE_J_DATA, v) as typeof PROBE_J_DATA).rows[1].flag, false);
});

test('fix 5: the file diff, and a warning when the files change but no field does', async () => {
  const { fileDiffs, hiddenFileChanges } = await import('../src/scripts/admin/cms-diff');
  const path = 'src/content/lp/en/x.md';
  const before = '---\ntitle: "A"\nurl: "/tr/x/"\n---\n';
  const after = '---\ntitle: "A"\nurl: "/x/"\n---\n';
  const files = fileDiffs({ [path]: before }, [{ path, content: after }]);
  assert.equal(files[0].changed, true);
  assert.deepEqual(files[0].lines.filter((l) => l.op !== ' '), [{ op: '-', text: 'url: "/tr/x/"' }, { op: '+', text: 'url: "/x/"' }]);
  assert.ok(hiddenFileChanges(files, { changed: [], unchanged: [] }), 'bytes changed, no field did: warn');
  assert.ok(!hiddenFileChanges(files, { changed: [{ field: GUIDE.fields[0], changes: [] }], unchanged: [] }));
  assert.ok(!hiddenFileChanges(fileDiffs({ [path]: before }, [{ path, content: before }]), { changed: [], unchanged: [] }));
  assert.deepEqual(fileDiffs(null, [{ path, content: after }]), [], 'nothing to compare without main');
  for (const k of ['admin.cms.review.fileDiff', 'admin.cms.review.hiddenChanges', 'admin.cms.review.fileSame']) assert.ok(k in ui.tr && k in ui.en, k);
  assert.equal(ui.tr['admin.cms.review.hiddenChanges'], 'Dosyada formda görünmeyen değişiklikler var');
});

// ── Task 2, fix round 2: a row's origin counts only against the data it was read from ──

const R2J = {
  key: 'j', format: 'json', sub: 'j', group: 'ogrenme', idField: 'title', label: 'x', hidden: {},
  fields: [f({ key: 'title', kind: 'text' }), f({ key: 'rows', kind: 'objects', identity: 'name', fields: [f({ key: 'name', kind: 'text' }), f({ key: 'note', kind: 'text' })] })],
} as unknown as TypeModel;
const R2J_BASE = { title: 'a', rows: [{ name: 'A', extra: 'a-secret' }, { name: 'B', extra: 'b-secret' }] };
const R2P = {
  key: 'p', format: 'markdown-pair', sub: 'p', group: 'ogrenme', idField: 'en.frontmatter.title', label: 'x', hidden: {},
  fields: [f({ key: 'title', kind: 'text', perLang: true }), f({ key: 'res', kind: 'objects', fields: [f({ key: 'title', kind: 'text', perLang: true }), f({ key: 'url', kind: 'text' })] })],
} as unknown as TypeModel;
const r2side = (rows: object[]) => ({ frontmatter: { title: 'T', res: rows }, body: '' });
const R2P_BASE = { en: r2side([{ title: 'a', url: '/a', x: 'ea' }, { title: 'b', url: '/b', x: 'eb' }]), tr: r2side([{ title: 'a', url: '/a', x: 'ta' }, { title: 'b', url: '/b', x: 'tb' }]) };

test('fix round 2: a restored copy is applied to the opened data without moving keys between rows', () => {
  // JSON: row A deleted, the copy backed up, restored after a reload, saved again.
  const v = copy(formValues(R2J, R2J_BASE));
  (v.rows as Row[]).splice(0, 1);
  const backup = applyValues(R2J, R2J_BASE, v);
  assert.deepEqual(backup, { title: 'a', rows: [{ name: 'B', extra: 'b-secret' }] });
  assert.deepEqual(applyValues(R2J, R2J_BASE, formValues(R2J, backup)), backup, 'B keeps its own key, not A\'s');
  // Pair: a new row with only a shared url survives the restore, on both sides.
  const pv = copy(formValues(R2P, R2P_BASE));
  (pv.res as Row[]).push({ ...emptyRow(R2P.fields[1], true), url: '/new' });
  const pbak = applyValues(R2P, R2P_BASE, pv) as typeof R2P_BASE;
  assert.deepEqual(pbak.tr.frontmatter.res.at(-1), { url: '/new' });
  const again = applyValues(R2P, R2P_BASE, formValues(R2P, pbak)) as typeof R2P_BASE;
  assert.deepEqual(again.en.frontmatter.res.map((r: any) => r.url), ['/a', '/b', '/new']);
  assert.deepEqual(again.tr.frontmatter.res.map((r: any) => r.url), ['/a', '/b', '/new']);
  // Pair: the first row deleted, restored: the second keeps its own hidden keys.
  const pd = copy(formValues(R2P, R2P_BASE));
  (pd.res as Row[]).splice(0, 1);
  const pdel = applyValues(R2P, R2P_BASE, pd) as typeof R2P_BASE;
  const pdel2 = applyValues(R2P, R2P_BASE, formValues(R2P, pdel)) as typeof R2P_BASE;
  // No identity key: the restored row is new to the opened data. It loses its hidden key, and never takes row a's.
  assert.deepEqual(pdel2.en.frontmatter.res, [{ title: 'b', url: '/b' }]);
  assert.deepEqual(pdel2.tr.frontmatter.res, [{ title: 'b', url: '/b' }], 'no identity: matched as new, never another row\'s keys');
});

test('fix round 2: rebase onto a version where the site deleted a row', () => {
  // JSON: the form was read from base; the site removed A meanwhile.
  const fresh = { title: 'a', rows: [{ name: 'B', extra: 'b-secret' }] };
  const v = copy(formValues(R2J, R2J_BASE));
  v.title = 'z';
  const out = applyValues(R2J, fresh, v) as typeof R2J_BASE;
  assert.deepEqual(out.rows.find((r) => r.name === 'B'), { name: 'B', extra: 'b-secret' }, 'B by its name, with its own key');
  assert.ok(!out.rows.some((r) => r.name === 'A' && r.extra), 'A, which the form still has, does not take B\'s key');
  // Pair: the site removed the first row on both sides.
  const pfresh = { en: r2side([{ title: 'b', url: '/b', x: 'eb' }]), tr: r2side([{ title: 'b', url: '/b', x: 'tb' }]) };
  const pv = copy(formValues(R2P, R2P_BASE));
  (pv.title as Bi).en = 'T2';
  const pout = applyValues(R2P, pfresh, pv) as typeof R2P_BASE;
  assert.deepEqual(pout.en.frontmatter.res.map((r: any) => [r.title, r.x]), [['a', undefined], ['b', undefined]], 'rows the form holds, none with another row\'s hidden key');
  assert.equal(pout.tr.frontmatter.res.length, 2, 'not dropped: they are the form\'s rows');
});

test('fix round 2: "take" copies another version\'s rows into a form opened on base', () => {
  const site = { title: 'a', rows: [{ name: 'B', extra: 'b-secret' }, { name: 'C', extra: 'c' }] };
  const v = { ...formValues(R2J, R2J_BASE), rows: formValues(R2J, site).rows };
  const out = applyValues(R2J, R2J_BASE, v) as typeof R2J_BASE;
  assert.deepEqual(out.rows, [{ name: 'B', extra: 'b-secret' }, { name: 'C' }], 'B matched by name; C is new to this base');
  const psite = { en: r2side([{ title: 'b', url: '/b', x: 'eb' }]), tr: r2side([{ title: 'b', url: '/b', x: 'tb' }]) };
  const pv = { ...formValues(R2P, R2P_BASE), res: formValues(R2P, psite).res };
  const pout = applyValues(R2P, R2P_BASE, pv) as typeof R2P_BASE;
  assert.deepEqual(pout.en.frontmatter.res, [{ title: 'b', url: '/b' }], 'without an identity: a new row, not row 0\'s keys');
  assert.deepEqual(pout.tr.frontmatter.res, [{ title: 'b', url: '/b' }]);
  // The deliberate rule: a row re-added under a deleted row's identity inherits that row's hidden keys.
  const v3 = copy(formValues(R2J, R2J_BASE));
  (v3.rows as Row[]).splice(0, 1);
  (v3.rows as Row[]).push({ ...emptyRow(R2J.fields[1], false), name: 'A' });
  assert.deepEqual((applyValues(R2J, R2J_BASE, v3) as typeof R2J_BASE).rows, [{ name: 'B', extra: 'b-secret' }, { name: 'A', extra: 'a-secret' }]);
});

// ── Task 2, fix round 3: every save writes onto the data the form was stamped from ──

import { withFieldFrom } from '../src/scripts/admin/cms-form';

test('fix round 3: the same stamped values saved twice onto their origin keep hidden keys and add no rows', () => {
  const J = { ...R2J, fields: [R2J.fields[0], { ...R2J.fields[1], identity: undefined }] } as TypeModel;
  const base = { title: 'a', rows: [{ name: 'A', note: '', extra: 'a-secret' }, { name: 'B', note: '', extra: 'b-secret' }] };
  const v = copy(formValues(J, base));
  (v.rows as Row[])[0].note = 'edited';
  const save1 = applyValues(J, base, v);
  v.title = 'later edit';
  const save2 = applyValues(J, base, v) as typeof base;
  assert.deepEqual(save2.rows, [{ name: 'A', note: 'edited', extra: 'a-secret' }, { name: 'B', note: '', extra: 'b-secret' }]);
  assert.deepEqual({ ...save2, title: 'a' }, save1, 'the second save is the first plus its own edit');

  const pb = { en: r2side([{ title: 'a', url: '/a', x: 'ea' }]), tr: r2side([{ title: 'a', url: '/a', x: 'ta' }, { title: 'tronly', url: '/t', x: 'tt' }]) };
  const pv = copy(formValues(R2P, pb));
  (pv.res as Row[])[0].url = '/a2';
  applyValues(R2P, pb, pv);
  (pv.title as Bi).en = 'T2';
  const p2 = applyValues(R2P, pb, pv) as typeof pb;
  assert.deepEqual(p2.en.frontmatter.res, [{ title: 'a', url: '/a2', x: 'ea' }], 'English gains no row');
  assert.deepEqual(p2.tr.frontmatter.res, [{ title: 'a', url: '/a2', x: 'ta' }, { title: 'tronly', url: '/t', x: 'tt' }]);
});

test('fix round 3: "take" moves the origin to the other version\'s data for that field, so its rows stay its own', () => {
  const origin = { en: r2side([{ title: 'a', url: '/a', x: 'ea' }]), tr: r2side([{ title: 'a', url: '/a', x: 'ta' }]) };
  const site = { en: r2side([{ title: 'b', url: '/b', x: 'eb' }]), tr: r2side([{ title: 'b', url: '/b', x: 'tb' }, { title: 'tronly', url: '/t', x: 'tt' }]) };
  const next = withFieldFrom(R2P, origin, site, 'res') as typeof origin;
  assert.deepEqual(next.tr.frontmatter.res, site.tr.frontmatter.res);
  assert.equal(next.en.frontmatter.title, 'T', 'other fields stay the origin\'s');
  assert.deepEqual(origin.en.frontmatter.res, [{ title: 'a', url: '/a', x: 'ea' }], 'the origin itself is not changed');
  // The form's value for the field is redrawn from the new origin; a save is the site's list exactly.
  const values = { ...formValues(R2P, origin), res: formValues(R2P, next).res };
  ((values.res as Row[])[0].title as Bi).tr = 'b!';
  const out = applyValues(R2P, next, values) as typeof origin;
  assert.deepEqual(out.en.frontmatter.res, [{ title: 'b', url: '/b', x: 'eb' }], 'no Turkish-only row on the English side');
  assert.deepEqual(out.tr.frontmatter.res, [{ title: 'b!', url: '/b', x: 'tb' }, { title: 'tronly', url: '/t', x: 'tt' }]);
  // JSON, and a field the other version lacks.
  assert.deepEqual(withFieldFrom(R2J, R2J_BASE, { title: 'x' }, 'rows'), { title: 'a' });
  assert.deepEqual(withFieldFrom(R2J, R2J_BASE, { title: 'x' }, 'title'), { ...R2J_BASE, title: 'x' });
});

test('house rules: the em dash, the @ and the missing consent each have their own sentence', () => {
  assert.equal(messageKey(EM_DASH_MESSAGE), 'admin.cms.v.emDash');
  assert.equal(messageKey(NO_AT_MESSAGE), 'admin.cms.v.noAt');
  assert.equal(messageKey('Invalid input: expected true'), 'admin.cms.v.consent');
  assert.match(ui.tr['admin.cms.v.emDash'], /^Uzun tire \(—\) kullanılmıyor; kısa tire \(-\) ya da virgül kullanın$/);
});

test('house rules: no published file of any type is refused (no false alarm on what CI already accepts)', () => {
  for (const type of CMS_TYPES) {
    const ids = Object.keys(FILES).filter((p) => p.startsWith(`${type.dir}/`));
    if (type.format === 'json') {
      for (const p of ids) assert.deepEqual(houseRuleErrors(type, JSON.parse(FILES[p])), {}, p);
    } else {
      for (const w of INDEX[type.key as 'webinars']) assert.deepEqual(houseRuleErrors(type, pair(w.id)), {}, w.id);
    }
  }
});

// ── Committees (Topluluk) ────────────────────────────────────────────────────

const COMMITTEES = cmsType('committees')!;
/** A synthetic committee (A2: no test reads what a real profile says). */
const aCommittee = () => ({
  order: 30,
  name: { en: 'Example Committee', tr: 'Örnek Komite' },
  description: { en: 'Does example things.', tr: 'Örnek işler yapar.' },
  members: [
    {
      name: 'Ada Örnek',
      role: { en: 'Leader', tr: 'Lider' },
      image: 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_600/v1/rsgturkey/committee/ada.jpg',
      education: [{ degree: { en: 'MSc', tr: 'Yüksek Lisans' }, field: { en: 'Biology', tr: 'Biyoloji' }, institution: { en: 'A University', tr: 'A Üniversitesi' }, year: '2027' }],
      socialMedia: [{ platform: 'linkedin', url: 'https://www.linkedin.com/in/example/' }],
      consent: true,
    },
    { name: 'Bora Örnek', role: { en: 'Member', tr: 'Üye' }, image: '/api/images/bora.webp', consent: true },
  ],
});

test('committees: every committee file goes through the form and is written back byte for byte', () => {
  const paths = Object.keys(FILES).filter((p) => p.startsWith('src/content/committees/'));
  assert.ok(paths.length > 0);
  for (const p of paths) {
    const data = JSON.parse(FILES[p]);
    assert.equal(serializeJson(COMMITTEES, applyValues(MODELS.committees, data, formValues(MODELS.committees, data))), FILES[p], p);
  }
  const syn = aCommittee();
  assert.equal(serializeJson(COMMITTEES, applyValues(MODELS.committees, syn, formValues(MODELS.committees, syn))), `${JSON.stringify(syn, null, 2)}\n`);
});

test('committees: a member added with consent is written in the schema\'s key order; the photos already there are untouched', () => {
  const data = aCommittee();
  const values = formValues(MODELS.committees, data);
  const members = MODELS.committees.fields.find((f) => f.key === 'members')!;
  const added = { ...emptyRow(members, false), name: 'Cem Örnek', role: { en: 'Member', tr: 'Üye' }, image: '/api/images/cem.webp', consent: true };
  const out = applyValues(MODELS.committees, data, { ...values, members: [...(values.members as Row[]), added] }) as ReturnType<typeof aCommittee>;
  assert.equal(out.members.length, 3);
  assert.deepEqual(Object.keys(out.members[2]), ['name', 'role', 'image', 'consent']);
  assert.equal(out.members[0].image, data.members[0].image, 'a Cloudinary URL comes back as it was');
  assert.deepEqual(out.members.slice(0, 2), data.members);
  // Unticked, consent is still written (false), so submit can name it.
  const unticked = applyValues(MODELS.committees, data, { ...values, members: [{ ...added, consent: false }] }) as ReturnType<typeof aCommittee>;
  assert.equal(unticked.members[0].consent, false);
  // Members are matched by name across versions: a reorder is a move, not two changes.
  assert.equal(members.identity, 'name');
  assert.equal(rowSummary(members, (values.members as Row[])[0], 'tr'), 'Ada Örnek');
});

test('committees: the form\'s groups, the file name of a new one, and its page', () => {
  assert.deepEqual(MODELS.committees.fields.filter((f) => f.group === 'main').map((f) => f.key), ['name', 'description', 'members']);
  assert.deepEqual(MODELS.committees.fields.filter((f) => f.group === 'more').map((f) => f.key), ['order']);
  assert.equal(MODELS.committees.sub, 'komiteler');
  assert.equal(MODELS.committees.titleField, 'name');
  assert.equal(suggestedId(MODELS.committees, { name: { en: 'Example Committee', tr: 'Örnek' } }), 'example-committee');
  assert.equal(suggestedId(MODELS.committees, { name: { en: 'Example Committee', tr: '' } }), COMMITTEES.idFrom({ name: { en: 'Example Committee', tr: '' } }));
  assert.equal(livePath('committees', 'website', ['src/content/committees/website.json'], 'en'), '/about/');
  assert.equal(livePath('committees', 'website', ['src/content/committees/website.json'], 'tr'), '/tr/about/');
  const consent = MODELS.committees.fields.find((f) => f.key === 'members')!.fields!.find((f) => f.key === 'consent')!;
  assert.equal(consent.kind, 'checkbox');
  assert.equal(consent.required, true);
});
