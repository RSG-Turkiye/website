import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderArchive } from '../functions/_lib/archive';

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
