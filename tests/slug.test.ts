import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { slugify } from '../functions/_lib/slug';

/**
 * One slug rule, and proof that unifying two did not move anything.
 *
 * There were two implementations: one for speaker and session slugs, one for
 * blog post filenames. Run against the same inputs they agreed on every
 * realistic string and differed in exactly one thing -- the blog one capped
 * the result at 80 characters. That is the option below.
 *
 * The dangerous part of merging two functions that produce identifiers is that
 * the survivor might produce different identifiers, which would silently
 * change URLs for content that already exists. The last test checks the
 * merged function against every blog filename in the repository.
 */

// --- Turkish, which is the whole reason this is not one regex ----------------

test('dotless i does not become a hyphen', () => {
  // U+0131 has no NFKD decomposition, so normalising leaves it intact, the
  // [a-z0-9] filter rejects it, and it becomes a hyphen in the middle of a
  // word. Every Turkish title has one.
  assert.equal(slugify('Işıl Yıldız'), 'isil-yildiz');
  assert.equal(slugify('ı'), 'i');
  assert.equal('ı'.normalize('NFKD'), 'ı', 'the premise: nothing to strip');
});

test('the other five pairs transliterate, in both cases', () => {
  assert.equal(slugify('ÇAĞRI ŞİMŞEK'), 'cagri-simsek');
  assert.equal(slugify('Öğrenci Sempozyumu'), 'ogrenci-sempozyumu');
  assert.equal(slugify('Prof. Dr. Nurcan Tunçbağ'), 'prof-dr-nurcan-tuncbag');
  assert.equal(slugify('İmmünoinformatik'), 'immunoinformatik');
});

test('other languages keep working through NFKD', () => {
  assert.equal(slugify('José Müller'), 'jose-muller');
  assert.equal(slugify('Åsa Ødegård'), 'asa-degard');
});

// --- shape -------------------------------------------------------------------

test('punctuation collapses and the ends are trimmed', () => {
  assert.equal(slugify('Öğrenci Sempozyumu — 2026: İmmünoinformatik'), 'ogrenci-sempozyumu-2026-immunoinformatik');
  assert.equal(slugify('--- leading and trailing ---'), 'leading-and-trailing');
  assert.equal(slugify('   '), '');
  assert.equal(slugify(''), '');
});

test('slugifying a slug returns it unchanged', () => {
  // Relied on twice: a hand-typed slug that is re-saved must not drift, and
  // re-slugging a speakerSlugs entry to match a speaker must be a no-op.
  for (const s of ['rna-seq', 'ogrenci-sempozyumu-2026', 'a1', '']) {
    assert.equal(slugify(s), s);
    assert.equal(slugify(slugify(s)), slugify(s));
  }
});

// --- the cap, and the bug in how it used to be applied -----------------------

test('without a maxLength nothing is cut', () => {
  const long = 'a'.repeat(120);
  assert.equal(slugify(long).length, 120);
});

test('a cut that lands on a hyphen does not leave one behind', () => {
  // This is the bug the merge fixes. The old blog slugify stripped trailing
  // hyphens and *then* sliced, so the slice could put one back.
  const title = `${'a'.repeat(79)} tail`;
  const slug = slugify(title, { maxLength: 80 });
  assert.equal(slug.endsWith('-'), false, slug);
  assert.equal(slug, 'a'.repeat(79));
});

test('the shipped example is what the old rule produced', () => {
  // src/content/blog/en/ has a file whose name ends in a hyphen. Its URL is
  // live so the file is not renamed; this records where it came from.
  const title = 'Computational analysis and integration of large scale biological data with deep learning';
  const oldRule = slugify(title).slice(0, 80); // strip-then-slice, as it was
  assert.equal(oldRule.endsWith('-'), true, 'the old rule could end on a hyphen');
  assert.equal(slugify(title, { maxLength: 80 }).endsWith('-'), false, 'the new one cannot');
});

test('a slug shorter than the cap is untouched by it', () => {
  assert.equal(slugify('rna-seq', { maxLength: 80 }), 'rna-seq');
});

// --- nothing that already exists moves ---------------------------------------

test('every blog filename in the repository survives the character rules', () => {
  // The risk in merging two functions that mint identifiers: the survivor
  // mints different ones and existing URLs quietly change. A published slug
  // must be a fixed point of the character rules.
  //
  // The cap is checked separately, because it is not what these filenames
  // were made with: two of them are 86 characters, which means they came from
  // the WordPress import rather than from the submission endpoint. Applying
  // the cap here would report a change the merge does not make -- nothing
  // re-slugs an existing file.
  const dirs = ['en', 'tr'].map((lang) => new URL(`../src/content/blog/${lang}/`, import.meta.url).pathname);
  const slugs = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')));
  assert.ok(slugs.length >= 30, `expected the posts, found ${slugs.length}`);

  const moved = slugs.filter((s) => slugify(s) !== s);
  // One exception, and it is the bug: a file whose name ends in a hyphen,
  // left there by the old strip-then-slice cap. Its URL is live so the file
  // is not renamed, and the merged rule can no longer mint that shape.
  assert.deepEqual(
    moved,
    ['computational-analysis-and-integration-of-large-scale-biological-data-with-deep-'],
    'a published slug changed shape, which would change its URL',
  );
});

test('the two posts longer than the cap predate it, and are left alone', () => {
  // Recorded rather than asserted from memory: if the import ever gets
  // re-run through the endpoint these would be renamed, and that would be a
  // decision, not a side effect.
  const dirs = ['en', 'tr'].map((lang) => new URL(`../src/content/blog/${lang}/`, import.meta.url).pathname);
  const slugs = dirs.flatMap((d) => readdirSync(d).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')));
  const overLong = [...new Set(slugs.filter((s) => s.length > 80))];
  assert.deepEqual(overLong, [
    'from-biological-big-data-to-meaningful-information-bioinformatics-and-its-applications',
  ]);
});

test('every symposium speaker slug survives too', () => {
  const dir = new URL('../symposium_website/src/content/speakers/', import.meta.url).pathname;
  const slugs = readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .flatMap((f) => {
      const data = JSON.parse(readFileSync(join(dir, f), 'utf8')) as { people?: { slug: string }[] };
      return (data.people ?? []).map((s) => s.slug);
    });
  assert.ok(slugs.length >= 10, `expected the speakers, found ${slugs.length}`);
  const moved = slugs.filter((s) => slugify(s) !== s);
  assert.deepEqual(moved, [], 'a speaker slug changed shape');
});
