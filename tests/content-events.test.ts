import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'astro/zod';
import { eventSchema } from '../src/data/events';
import { eventFiles, readEvents } from './lib/events';

/**
 * src/content/events: one JSON file per event, named by its id. Every file
 * validates, and dates land on the day they name (UTC midnight, exactly as
 * `new Date("2026-10-10")` did).
 */

test('every event JSON validates against the schema', () => {
  const files = eventFiles();
  assert.ok(files.length > 0);
  for (const { file, raw } of files) {
    const r = eventSchema.safeParse(raw);
    assert.ok(r.success, `${file}: ${r.success ? '' : r.error.message}`);
  }
});

test('ids are unique and equal the file names', () => {
  const files = eventFiles();
  const ids = files.map(({ raw }) => (raw as { id: string }).id);
  assert.equal(new Set(ids).size, ids.length);
  for (const { file, raw } of files) assert.equal(file, `${(raw as { id: string }).id}.json`);
});

test('every title, date line, location and description has both languages', () => {
  for (const e of readEvents()) {
    for (const f of [e.title, e.when, e.location, e.description]) {
      assert.ok(f.en.trim() && f.tr.trim(), e.id);
    }
  }
});

test('dates are read as UTC midnight of the day they name, not shifted a day', () => {
  // Every event, from its own file: no entry or date is named, since the
  // panel edits them (A2).
  const midnight = (day: string) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const raw = new Map(eventFiles().map(({ raw: r }) => [(r as { id: string }).id, r as { start: string; end?: string }]));
  for (const e of readEvents()) {
    const r = raw.get(e.id)!;
    assert.equal(e.start.getTime(), midnight(r.start), e.id);
    if (r.end) assert.equal(e.end?.getTime(), midnight(r.end), e.id);
  }
});

const base = {
  id: 'x',
  type: 'meetup',
  start: '2026-10-10',
  title: { en: 'a', tr: 'a' },
  when: { en: 'a', tr: 'a' },
  location: { en: 'a', tr: 'a' },
  description: { en: 'a', tr: 'a' },
};

test('a date is a calendar day as YYYY-MM-DD and nothing else', () => {
  const ok = eventSchema.parse(base);
  assert.equal(ok.start.getTime(), Date.UTC(2026, 9, 10));
  for (const bad of [null, 0, '2026-10-10T00:00', '2026-02-30', '10/10/2026', '']) {
    assert.equal(eventSchema.safeParse({ ...base, start: bad }).success, false, String(bad));
    assert.equal(eventSchema.safeParse({ ...base, end: bad }).success, false, `end ${String(bad)}`);
  }
});

test('an end before the start is refused; the same day is fine', () => {
  assert.equal(eventSchema.safeParse({ ...base, end: '2026-10-09' }).success, false);
  assert.equal(eventSchema.safeParse({ ...base, end: '2026-10-10' }).success, true);
  assert.equal(eventSchema.safeParse({ ...base, end: '2026-10-11' }).success, true);
});

test('a misspelt key is refused, at the top and in nested objects', () => {
  assert.equal(eventSchema.safeParse({ ...base, locaton: { en: 'a', tr: 'a' } }).success, false);
  assert.equal(eventSchema.safeParse({ ...base, title: { en: 'a', tr: 'a', de: 'a' } }).success, false);
  assert.equal(eventSchema.safeParse({ ...base, links: [{ label: { en: 'a', tr: 'a' }, url: 'https://x.org', href: 'y' }] }).success, false);
  const image = { thumb: '/api/images/a.jpg', full: '/api/images/a.jpg', alt: { en: 'a', tr: 'a' } };
  assert.equal(eventSchema.safeParse({ ...base, image }).success, true);
  assert.equal(eventSchema.safeParse({ ...base, image: { ...image, fiT: 'cover' } }).success, false);
});

test('an image on a host blocked in Türkiye is refused', () => {
  const alt = { en: 'a', tr: 'a' };
  for (const host of ['pub-abc.r2.dev', 'rsg.pages.dev', 'x.y.workers.dev', 'R2.DEV']) {
    const url = `https://${host}/a.jpg`;
    assert.equal(eventSchema.safeParse({ ...base, image: { thumb: url, full: '/api/images/a.jpg', alt } }).success, false, url);
    assert.equal(eventSchema.safeParse({ ...base, image: { thumb: '/api/images/a.jpg', full: url, alt } }).success, false, url);
  }
  assert.equal(eventSchema.safeParse({ ...base, image: { thumb: '//a.r2.dev/x.jpg', full: '/x.jpg', alt } }).success, false);
  assert.equal(
    eventSchema.safeParse({ ...base, image: { thumb: 'https://res.cloudinary.com/x.jpg', full: 'https://notr2.dev.example.org/x.jpg', alt } }).success,
    true,
  );
});

test('the schema has a JSON Schema for its input, for generated forms', () => {
  const js = z.toJSONSchema(eventSchema, { io: 'input' }) as {
    properties: Record<string, { type?: string; format?: string }>;
    required: string[];
    additionalProperties: boolean;
  };
  assert.equal(js.properties.start.type, 'string');
  assert.equal(js.properties.start.format, 'date');
  assert.ok(js.required.includes('start'));
  assert.ok(!js.required.includes('end'));
  assert.equal(js.additionalProperties, false);
});
