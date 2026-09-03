import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchive, endOfEventFromMarkdown, editionMarkdownPath } from '../functions/_lib/archive';

const overlay = {
  year: 2026,
  edition: { registrationUrl: 'https://forms.gle/reg', venuePublic: true, cityPublic: true },
  speakers: [{ slug: 'ada-lovelace', name: 'Ada Lovelace', position: '', company: '', bio: '', photo: '' }],
  sessions: [{ slug: 'keynote', title: 'Keynote', type: 'keynote', speakerSlugs: ['ada-lovelace'], description: '', time: '09:30', order: 1 }],
  committee: [],
  announcements: [],
} as never;

test('it writes one file per kind, under the symposium site', () => {
  const paths = renderArchive(overlay).map((f) => f.path).sort();
  assert.deepEqual(paths, [
    'symposium_website/src/content/sessions/2026.json',
    'symposium_website/src/content/speakers/2026.json',
  ]);
});

test('an empty kind writes no file rather than an empty one', () => {
  // committee is empty above
  const paths = renderArchive(overlay).map((f) => f.path);
  assert.ok(!paths.some((p) => p.includes('committee')));
});

test('the written JSON parses back to the shape the collection expects', () => {
  const speakers = renderArchive(overlay).find((f) => f.path.includes('speakers'))!;
  const parsed = JSON.parse(speakers.content);
  assert.equal(parsed.year, 2026);
  assert.equal(parsed.people[0].slug, 'ada-lovelace');
});

test('the JSON is formatted, so the pull request is reviewable', () => {
  const speakers = renderArchive(overlay).find((f) => f.path.includes('speakers'))!;
  assert.ok(speakers.content.includes('\n  '), 'indented, not one line');
  assert.ok(speakers.content.endsWith('\n'), 'trailing newline');
});

test('the session keeps the slug link to its speaker', () => {
  const sessions = renderArchive(overlay).find((f) => f.path.includes('sessions'))!;
  assert.deepEqual(JSON.parse(sessions.content).items[0].speakerSlugs, ['ada-lovelace']);
});

test('editionMarkdownPath names the file this module reads, not writes', () => {
  assert.equal(editionMarkdownPath(2026), 'symposium_website/src/content/editions/2026.md');
});

// endOfEventFromMarkdown must apply exactly the rule
// symposium_website/src/lib/editions.ts's own endOfEvent() applies: the
// midnight after endDate, falling back to startDate, in epoch seconds.
const ONE_DAY = 24 * 60 * 60;

test('a startDate alone gives midnight the day after it', () => {
  const md = '---\nyear: 2026\nstartDate: 2026-10-10\n---\nBody text.\n';
  assert.equal(endOfEventFromMarkdown(md), Date.UTC(2026, 9, 10) / 1000 + ONE_DAY);
});

test('an endDate overrides startDate, matching the site rule', () => {
  const md = '---\nstartDate: 2026-10-10\nendDate: 2026-10-12\n---\n';
  assert.equal(endOfEventFromMarkdown(md), Date.UTC(2026, 9, 12) / 1000 + ONE_DAY);
});

test('a quoted date parses the same as a bare one', () => {
  const md = '---\nstartDate: "2026-10-10"\n---\n';
  assert.equal(endOfEventFromMarkdown(md), Date.UTC(2026, 9, 10) / 1000 + ONE_DAY);
});

test('no dates in the frontmatter is undated, not "already over"', () => {
  const md = '---\nyear: 2018\ntitle: "5th RSG-Türkiye Student Symposium"\n---\nBody.\n';
  assert.equal(endOfEventFromMarkdown(md), null);
});

test('no frontmatter at all is undated, not "already over"', () => {
  assert.equal(endOfEventFromMarkdown('Just a body, no frontmatter.'), null);
});
