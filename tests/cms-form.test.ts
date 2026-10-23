// The Etkinlikler panel's form model (src/scripts/admin/cms-form.ts) against
// the real schemas and every real file: each schema key is in its type's
// model (or hidden on purpose), and data goes through the form and back
// unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { CMS_TYPES, cmsType } from '../src/lib/cms/types';
import { jsonSchemaFor } from '../src/lib/cms/json-schema';
import { parseMarkdown } from '../src/lib/cms/serialize';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { FAILURE } from '../functions/_lib/cms-drafts';
import { ui } from '../src/i18n/ui';
import {
  MODELS, applyValues, emptyData, errorKey, failureKey, formValues, halfTranslated, livePath, messageKey, placeOf, sharedShowsOne,
  statusView, suggestedId, visibleFields, type Bi, type TypeKey,
} from '../src/scripts/admin/cms-form';
import { diffEntry, lineDiff, listDiff } from '../src/scripts/admin/cms-diff';

const ROOT = new URL('../', import.meta.url).pathname;
const read = (p: string) => readFileSync(`${ROOT}${p}`, 'utf8');
const json = (dir: string) => readdirSync(`${ROOT}${dir}`).map((f) => ({ name: f, data: JSON.parse(read(`${dir}/${f}`)) }));
const WEBINARS = cmsType('webinars')!;

function files(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const dir of ['src/content/events', 'src/content/workshops', 'src/content/webinars/en', 'src/content/webinars/tr']) {
    for (const f of readdirSync(`${ROOT}${dir}`)) out[`${dir}/${f}`] = read(`${dir}/${f}`);
  }
  return out;
}
const FILES = files();
const INDEX = buildCmsIndex(FILES);
/** A webinar pair as GET /api/cms/entry answers it (JSON round trip included). */
const pair = (id: string) => {
  const w = INDEX.webinars.find((e) => e.id === id)!;
  const side = (p: string | null | undefined) => (p ? parseMarkdown(WEBINARS, FILES[p]) : null);
  return JSON.parse(JSON.stringify({ en: side(w.paths?.en), tr: side(w.paths?.tr) }));
};

test('every schema key of every type is in its field model, or hidden with a reason', () => {
  for (const type of CMS_TYPES) {
    const model = MODELS[type.key as TypeKey];
    const props = Object.keys((jsonSchemaFor(type) as { properties: Record<string, unknown> }).properties);
    const shown = new Set(model.fields.map((f) => f.key));
    for (const k of props) assert.ok(shown.has(k) || Object.hasOwn(model.hidden, k), `${type.key}.${k} is neither shown nor hidden`);
    for (const f of model.fields) assert.ok(props.includes(f.key), `${type.key}: the model has ${f.key}, the schema does not`);
    for (const k of Object.keys(model.hidden)) assert.ok(!shown.has(k), `${type.key}.${k} is both hidden and shown`);
  }
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

test('symposium-2026 goes through the form and back unchanged; an edited when.tr comes back changed', () => {
  const data = JSON.parse(read('src/content/events/symposium-2026.json'));
  const values = formValues(MODELS.events, data);
  assert.deepEqual(applyValues(MODELS.events, data, values), data);
  const edited = { ...values, when: { ...(values.when as Bi), tr: '10-11 Ekim 2026, Ankara' } };
  const out = applyValues(MODELS.events, data, edited) as typeof data;
  assert.equal(out.when.tr, '10-11 Ekim 2026, Ankara');
  assert.deepEqual({ ...out, when: data.when }, data, 'nothing else moved');
  assert.deepEqual(data.when.tr, '10–11 Ekim 2026', 'the input is not changed');
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
  const data = pair('ai-approaches-biomolecular-representation');
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
  const data = pair('ai-approaches-biomolecular-representation');
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
  const data = JSON.parse(read('src/content/events/symposium-2026.json'));
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
    for (const f of m.fields) { keys.add(f.label); if (f.help) keys.add(f.help); }
  }
  for (const code of ['changed_since', 'entry_busy', 'superseded', 'exists', 'github_failed', 'unauthenticated', 'invalid', 'nonsense']) keys.add(errorKey(code));
  for (const m of ['received undefined', 'end is before start', 'Unknown field', 'Invalid ISO date', 'Invalid option', 'expected number', 'blocked in Türkiye', 'gives the file its name', 'Invalid id', 'same as the English side', 'x']) keys.add(messageKey(m));
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
  const data = JSON.parse(read('src/content/events/symposium-2026.json'));
  const values = formValues(MODELS.events, data);
  assert.deepEqual(halfTranslated(MODELS.events, values), []);
  const half = { ...values, location: { en: 'Ankara', tr: '' }, links: [{ label: { en: 'Site', tr: '' }, url: 'https://x' }] };
  assert.deepEqual(halfTranslated(MODELS.events, half).map((h) => h.key), ['links'], 'location is required: its field error covers it');
  const w = formValues(MODELS.webinars, pair('ai-approaches-biomolecular-representation'));
  assert.deepEqual(halfTranslated(MODELS.webinars, { ...w, topic: { en: 'ML', tr: '' } }).map((h) => h.key), ['topic']);
});

test('the approver\'s diff: values, both languages, items added, removed and moved, body lines', () => {
  const data = JSON.parse(read('src/content/events/symposium-2026.json'));
  const links = [{ label: { en: 'A', tr: 'A' }, url: 'a' }, { label: { en: 'B', tr: 'B' }, url: 'b' }, { label: { en: 'C', tr: 'C' }, url: 'c' }];
  const before = { ...data, links };
  const after = { ...data, when: { ...data.when, tr: 'Ekim' }, links: [links[2], links[0], { label: { en: 'D', tr: 'D' }, url: 'd' }] };
  const d = diffEntry(MODELS.events, before, after);
  assert.deepEqual(d.changed.map((c) => c.field.key), ['when', 'links']);
  assert.deepEqual(d.changed[0].changes, [{ type: 'bilingual', en: null, tr: { before: data.when.tr, after: 'Ekim' } }]);
  const items = (d.changed[1].changes[0] as { items: { state: string; value: any }[] }).items.map((i) => `${i.state}:${i.value.url}`);
  assert.deepEqual(items, ['moved:c', 'same:a', 'added:d', 'removed:b']);
  assert.ok(d.unchanged.some((f) => f.key === 'title'));
  assert.deepEqual(diffEntry(MODELS.events, data, data).changed, []);

  assert.deepEqual(listDiff(['a', 'b'], ['b', 'a']).map((i) => i.state).sort(), ['moved', 'same']);
  assert.deepEqual(lineDiff('one\ntwo\nthree', 'one\n2\nthree'), [{ op: ' ', text: 'one' }, { op: '-', text: 'two' }, { op: '+', text: '2' }, { op: ' ', text: 'three' }]);
  const w = pair('ai-approaches-biomolecular-representation');
  const w2 = JSON.parse(JSON.stringify(w));
  w2.tr.body += 'Ek.\n';
  w2.en.frontmatter.date = w2.tr.frontmatter.date = '2024-04-17';
  const wd = diffEntry(MODELS.webinars, w, w2);
  assert.deepEqual(wd.changed.map((c) => c.field.key), ['date', 'body']);
  assert.equal(wd.changed[0].changes[0].type, 'value', 'a shared field both sides agree on is one value');
  assert.deepEqual(wd.changed[1].changes.map((c) => (c as { lang?: string }).lang), ['tr']);
});

test('the live page of a published entry', () => {
  assert.equal(livePath('events', 'symposium-2026', [], 'tr'), '/tr/events/');
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
  for (const m of Object.values(MODELS)) for (const f of m.fields) for (const o of f.options ?? []) assert.ok(`admin.cms.opt.${o}` in ui.tr && `admin.cms.opt.${o}` in ui.en, o);
});

// ── Task 7, fix round 1 ───────────────────────────────────────────────────────

import { backupChoice, backupStorageKey, othersBackupKeys, parseBackup, uploadErrorKey, BACKUP_MAX_AGE } from '../src/scripts/admin/cms-form';

test('a local backup is restored only when it is newer than, and based on, what the server has', () => {
  const now = 1_000_000;
  const b = (o: Record<string, unknown>) => ({ data: { x: 1 }, at: now - 60, updated_at: null, base_shas: null, ...o });
  // A draft: same version it was made on, and newer than it.
  assert.equal(backupChoice(b({ updated_at: now - 300 }), { updated_at: now - 300, base_shas: null }, now), 'restore');
  // Another tab or device saved since: never silently.
  assert.equal(backupChoice(b({ updated_at: now - 900 }), { updated_at: now - 300, base_shas: null }, now), 'ask');
  assert.equal(backupChoice(b({ at: now - 400, updated_at: now - 300 }), { updated_at: now - 300, base_shas: null }, now), 'ask');
  // A published entry: the files must still be the ones it was read at.
  assert.equal(backupChoice(b({ base_shas: { a: '1' } }), { updated_at: null, base_shas: { a: '1' } }, now), 'restore');
  assert.equal(backupChoice(b({ base_shas: { a: '1' } }), { updated_at: null, base_shas: { a: '2' } }, now), 'ask');
  // A new entry has nothing on the server to be older than.
  assert.equal(backupChoice(b({}), { updated_at: null, base_shas: null }, now), 'restore');
  assert.equal(backupChoice(b({ at: now - BACKUP_MAX_AGE - 1 }), { updated_at: null, base_shas: null }, now), 'expired');
});

test('backups are per person, and anything that is not one is ignored', () => {
  assert.equal(backupStorageKey('u1', 'new:events'), 'rsg:cms:u1:new:events');
  assert.deepEqual(othersBackupKeys(['rsg:cms:u1:a', 'rsg:cms:u2:b', 'rsg:cms:legacy', 'rsg:podcast', 'rsg_me_cache'], 'u1'), ['rsg:cms:u2:b', 'rsg:cms:legacy']);
  assert.equal(parseBackup('not json'), null);
  assert.equal(parseBackup(JSON.stringify({ data: {}, at: 'yesterday' })), null);
  assert.equal(parseBackup(JSON.stringify([1, 2])), null);
  assert.deepEqual(parseBackup(JSON.stringify({ data: { a: 1 }, at: 5, updated_at: 3, base_shas: { p: null } })), { data: { a: 1 }, at: 5, updated_at: 3, base_shas: { p: null } });
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
  const data = JSON.parse(read('src/content/events/symposium-2026.json'));
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
  const data = JSON.parse(read('src/content/events/symposium-2026.json'));
  const d = diffEntry(MODELS.events, data, { ...data, note: 'updated' }, visibleFields(MODELS.events, true));
  assert.deepEqual(d.changed.map((c) => c.field.key), ['note']);
});
