// tests/lib/cms-fixtures.ts: entries picked by shape, and synthetic ones in
// their place when the content has no entry of a shape, so a panel delete
// never makes the CMS tests throw before they run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCmsIndex } from '../src/lib/cms/cms-index';
import { cmsType } from '../src/lib/cms/types';
import { parseMarkdown } from '../src/lib/cms/serialize';
import { realFixtures } from './lib/cms-fixtures';

test('with no content at all, every shape is made up, valid, and indexed', () => {
  const files: Record<string, string> = {};
  const index = buildCmsIndex(files);
  const f = realFixtures(files, index);
  assert.ok(f.SYNTHETIC.length > 0);
  for (const p of f.SYNTHETIC) assert.ok(files[p], p);
  assert.notEqual(f.EVENT_ID, f.OTHER_EVENT_ID);
  for (const p of [f.EVENT_PATH, f.OTHER_EVENT_PATH]) {
    const r = cmsType('events')!.schema.safeParse(JSON.parse(files[p]));
    assert.ok(r.success, p);
  }
  const webinars = cmsType('webinars')!;
  for (const p of f.SYNTHETIC.filter((x) => x.endsWith('.md'))) {
    const r = webinars.schema.safeParse(parseMarkdown(webinars, files[p]).frontmatter);
    assert.ok(r.success, p);
  }
  const pair = index.webinars.find((w) => w.id === f.PAIR_ID)!;
  assert.equal(pair.paths!.en, f.PAIR_EN);
  assert.equal(pair.paths!.tr, f.PAIR_TR);
  assert.notEqual(f.PAIR_EN.split('/').pop(), f.PAIR_TR.split('/').pop());
  assert.ok(f.PAIR_KEY && f.OTHER_KEY && f.PAIR_KEY !== f.OTHER_KEY);
  const same = index.webinars.find((w) => w.id === f.SAME_NAME_ID)!;
  assert.equal(same.paths!.en!.split('/').pop(), same.paths!.tr!.split('/').pop());
  assert.ok(index.events.some((e) => e.id === f.EVENT_ID));
});

test('an index built with shas is rebuilt with shas', () => {
  const files: Record<string, string> = {};
  const index = buildCmsIndex(files, {});
  index.events.push({ id: 'x', title: 'x', shas: {} });
  realFixtures(files, index);
  assert.ok(index.events.every((e) => e.shas && Object.keys(e.shas).length === 1));
});
