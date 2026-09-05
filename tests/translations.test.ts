import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { counterpartSlug, slugOf, type TranslatableEntry } from '../src/lib/translations';

/**
 * Which entry is the other language's version of this one.
 *
 * Filename equality was the whole rule, and six webinar translations were
 * therefore unreachable: the Turkish file had a Turkish name, so the language
 * toggle dropped the reader on the listing page, the in-page chip was hidden,
 * and no hreflang was emitted -- search engines never learned the two pages
 * were the same talk. The translations existed the entire time.
 */

const entry = (id: string, translationKey?: string): TranslatableEntry => ({
  id,
  data: translationKey === undefined ? {} : { translationKey },
});

// --- the default: matching filenames ----------------------------------------

test('matching filenames still pair, with nothing to declare', () => {
  const all = [entry('en/rna-seq'), entry('tr/rna-seq')];
  assert.equal(counterpartSlug(all, 'en/rna-seq', 'tr'), 'rna-seq');
  assert.equal(counterpartSlug(all, 'tr/rna-seq', 'en'), 'rna-seq');
});

test('an entry with no twin has none', () => {
  const all = [entry('en/rna-seq'), entry('tr/baska-bir-sey')];
  assert.equal(counterpartSlug(all, 'en/rna-seq', 'tr'), null);
});

// --- the override -----------------------------------------------------------

test('a shared key pairs two entries whose slugs differ', () => {
  // This is the case that was broken, and the Turkish slug survives it.
  const all = [
    entry('en/molecular-simulations', 'molecular-simulations'),
    entry('tr/molekuler-simulasyonlar', 'molecular-simulations'),
  ];
  assert.equal(counterpartSlug(all, 'en/molecular-simulations', 'tr'), 'molekuler-simulasyonlar');
  assert.equal(counterpartSlug(all, 'tr/molekuler-simulasyonlar', 'en'), 'molecular-simulations');
});

test('a key on one side only pairs nothing, even when a filename matches', () => {
  // Half a declaration is a typo, and the dangerous shape is this one: the
  // author meant to pair with the Turkish file of a different name, and a
  // same-named Turkish file about something else exists. Falling back to the
  // filename would link the wrong two pages and say nothing. Refusing leaves
  // them unpaired, and the "declared on both sides" test below names the typo.
  const all = [
    entry('en/rna-seq', 'rna-sequencing'),
    entry('tr/rna-seq'),
    entry('tr/rna-dizileme'),
  ];
  assert.equal(counterpartSlug(all, 'en/rna-seq', 'tr'), null);
});

test('an empty key is the same as no key', () => {
  // The schema defaults it to "", so almost every entry has one.
  const all = [entry('en/rna-seq', ''), entry('tr/rna-seq', '')];
  assert.equal(counterpartSlug(all, 'en/rna-seq', 'tr'), 'rna-seq');
});

test('a duplicated key resolves the same way on every build', () => {
  const all = [
    entry('en/a', 'shared'),
    entry('tr/zeta', 'shared'),
    entry('tr/alpha', 'shared'),
  ];
  assert.equal(counterpartSlug(all, 'en/a', 'tr'), 'alpha', 'sorted, not loader order');
});

test('a key never pairs an entry with its own language', () => {
  const all = [entry('en/a', 'k'), entry('en/b', 'k')];
  assert.equal(counterpartSlug(all, 'en/a', 'tr'), null);
});

test('slugOf strips the language folder and nothing else', () => {
  assert.equal(slugOf('en/rna-seq'), 'rna-seq');
  assert.equal(slugOf('tr/rna-seq'), 'rna-seq');
  assert.equal(slugOf('en/en-route-to-somewhere'), 'en-route-to-somewhere');
});

// --- against the real content -----------------------------------------------

/** Frontmatter fields, read directly so a broken file fails loudly. */
function fields(path: string): Record<string, string> {
  const text = readFileSync(path, 'utf8');
  const block = text.slice(3, text.indexOf('\n---', 3));
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(line);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function collection(name: string): TranslatableEntry[] {
  const base = new URL(`../src/content/${name}/`, import.meta.url).pathname;
  const entries: TranslatableEntry[] = [];
  for (const lang of ['en', 'tr']) {
    for (const file of readdirSync(join(base, lang)).filter((f) => f.endsWith('.md'))) {
      const f = fields(join(base, lang, file));
      if (f.draft === 'true') continue; // the routes filter drafts out too
      entries.push({ id: `${lang}/${file.replace(/\.md$/, '')}`, data: { translationKey: f.translationKey } });
    }
  }
  return entries;
}

test('the six talks that were unreachable now pair, in both directions', () => {
  const all = collection('webinars');
  const pairs: [string, string][] = [
    ['molecular-simulations', 'molekuler-simulasyonlar'],
    ['computational-challenges-protein-rna', 'protein-rna-etkilesimleri'],
    ['language-models-protein-properties', 'dil-modelleri-protein-ozellikleri'],
    ['understanding-disease-mechanisms', 'hastalik-mekanizmalarinin-anlasilmasi'],
    ['open-student-webinars', 'acik-ogrenci-webinarlari'],
    ['integrative-modeling-of-biomolecular-complexes', 'first-webinar-2018-integrative-modeling'],
  ];
  for (const [en, tr] of pairs) {
    assert.equal(counterpartSlug(all, `en/${en}`, 'tr'), tr, `en/${en} → tr`);
    assert.equal(counterpartSlug(all, `tr/${tr}`, 'en'), en, `tr/${tr} → en`);
  }
});

test('every declared key is declared on both sides', () => {
  // A key with no partner is a typo that silently unpairs a translation, which
  // is the failure this whole mechanism exists to end.
  for (const name of ['webinars', 'blog']) {
    const all = collection(name);
    for (const e of all) {
      const key = e.data.translationKey?.trim() ?? '';
      if (key === '') continue;
      const other = e.id.startsWith('en/') ? 'tr' : 'en';
      assert.notEqual(
        counterpartSlug(all, e.id, other),
        null,
        `${name}/${e.id} declares translationKey "${key}" and nothing in ${other}/ shares it`,
      );
    }
  }
});

test('pairing by filename did not stop working for everyone else', () => {
  const all = collection('webinars');
  const byFilename = all.filter((e) => e.id.startsWith('en/') && !e.data.translationKey?.trim());
  const paired = byFilename.filter((e) => counterpartSlug(all, e.id, 'tr') !== null);
  assert.ok(paired.length >= 15, `expected the existing pairs to survive, found ${paired.length}`);
});
