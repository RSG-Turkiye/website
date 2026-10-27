import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { helpSchema } from '../src/data/help';
import { parseMarkdown } from '../src/lib/cms/serialize';
import { cmsType } from '../src/lib/cms/types';
import { ROLES, roleDef } from '../functions/_lib/roles';

/**
 * The role guides shown in the panel's Help section. These checks keep every
 * guide valid, in both languages, in step with the role catalog, and free of
 * the hostnames blocked in Türkiye.
 */

const ROOT = new URL('../', import.meta.url).pathname;
const LANGS = ['tr', 'en'] as const;
type Lang = (typeof LANGS)[number];

// parseMarkdown only reads the text; any markdown type will do.
const anyMarkdown = cmsType('webinars')!;

const slugs = (lang: Lang) =>
  readdirSync(`${ROOT}src/content/help/${lang}`).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort();

function guide(lang: Lang, slug: string) {
  const { frontmatter, body } = parseMarkdown(anyMarkdown, readFileSync(`${ROOT}src/content/help/${lang}/${slug}.md`, 'utf8'));
  return { frontmatter, body };
}

const all = () => LANGS.flatMap((lang) => slugs(lang).map((slug) => ({ lang, slug, ...guide(lang, slug) })));

const HEADINGS: Record<Lang, string[]> = {
  tr: ['## Bu rolle neler yaparsın', '## Neler yapamazsın, kime sorarsın', '## Sık yapılan işler', '## Sık karşılaşılan sorunlar'],
  en: ['## What you can do', '## What you cannot do, and who to ask', '## Common tasks', '## Common problems'],
};
const CONNECT_HEADINGS: Record<Lang, string[]> = {
  tr: ['## Bağlamak', '## Ne yaptırabilirsin', '## Asla yapamayacakları', '## Bağlantıyı kesmek'],
  en: ['## Connecting', '## What you can ask', '## What it can never do', '## Disconnecting'],
};

test('every guide parses with helpSchema', () => {
  assert.equal(slugs('tr').length, 9);
  for (const g of all()) {
    const r = helpSchema.safeParse(g.frontmatter);
    assert.ok(r.success, `${g.lang}/${g.slug}`);
  }
});

test('tr and en have the same slugs', () => {
  assert.deepEqual(slugs('tr'), slugs('en'));
});

test('every role key in a guide is a real, non-retired role', () => {
  for (const g of all()) {
    for (const k of helpSchema.parse(g.frontmatter).roles) {
      if (k === 'all') continue;
      const def = roleDef(k);
      assert.ok(def && !def.retired, `${g.lang}/${g.slug}: ${k}`);
    }
  }
});

test('every non-retired role is covered by a guide in both languages', () => {
  for (const lang of LANGS) {
    const covered = new Set(all().filter((g) => g.lang === lang).flatMap((g) => helpSchema.parse(g.frontmatter).roles));
    for (const r of ROLES.filter((x) => !x.retired)) assert.ok(covered.has(r.key), `${lang}: no guide for ${r.key}`);
  }
});

test('no concrete blocked hostname and no em dash in a guide', () => {
  const blocked = /(?<![*\w-])[a-z0-9-]+\.(pages|r2|workers)\.dev/i;
  for (const lang of LANGS) {
    for (const slug of slugs(lang)) {
      const text = readFileSync(`${ROOT}src/content/help/${lang}/${slug}.md`, 'utf8');
      assert.doesNotMatch(text, blocked, `${lang}/${slug}`);
      assert.ok(!text.includes('—'), `${lang}/${slug} has an em dash`);
    }
  }
});

test('every guide has its four headings', () => {
  for (const g of all()) {
    const want = g.slug === 'connect-claude' ? CONNECT_HEADINGS[g.lang] : HEADINGS[g.lang];
    for (const h of want) assert.ok(g.body.split('\n').includes(h), `${g.lang}/${g.slug}: missing "${h}"`);
  }
});
