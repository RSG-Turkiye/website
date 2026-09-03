import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeOverlay, parseOverlay } from '../src/lib/overlay';

const repo = {
  registrationUrl: '', abstractUrl: '',
  registrationDeadline: undefined, abstractDeadline: undefined,
  venuePublic: false, cityPublic: true,
  speakers: [{ slug: 'from-repo', name: 'From Repo' }],
  sessions: [{ slug: 's1', title: 'From Repo', order: 1 }],
  committee: [],
} as never;

test('no overlay at all leaves the repo untouched', () => {
  assert.deepEqual(mergeOverlay(repo, null), repo);
});

test('the overlay supplies the links the repo does not have', () => {
  const out = mergeOverlay(repo, { edition: { registrationUrl: 'https://forms.gle/reg' } } as never);
  assert.equal(out.registrationUrl, 'https://forms.gle/reg');
});

test('an empty speaker list means no opinion, not deletion', () => {
  // A bad deploy or a half-run migration must not silently erase a published
  // programme. Removing every speaker is an act for a pull request.
  const out = mergeOverlay(repo, { speakers: [], sessions: [] } as never);
  assert.equal(out.speakers[0].name, 'From Repo');
  assert.equal(out.sessions[0].title, 'From Repo');
});

test('a non-empty list replaces the repo list wholesale', () => {
  const out = mergeOverlay(repo, { speakers: [{ slug: 'from-cms', name: 'From CMS' }] } as never);
  assert.deepEqual(out.speakers.map((s: { name: string }) => s.name), ['From CMS']);
});

test('a null flag leaves the repo flag standing', () => {
  const out = mergeOverlay(repo, { edition: { venuePublic: null } } as never);
  assert.equal(out.venuePublic, false);
});

test('an explicit true announces the venue the repo was withholding', () => {
  const out = mergeOverlay(repo, { edition: { venuePublic: true } } as never);
  assert.equal(out.venuePublic, true);
});

test('the overlay cannot introduce a venue string', () => {
  const out = mergeOverlay(repo, { edition: { venue: 'Secret Hall' } } as never);
  assert.ok(!('venue' in out) || (out as { venue?: string }).venue === undefined);
});

test('a payload whose shape drifted is refused, not half-used', () => {
  // A renamed server field must not arrive as undefined and empty a list.
  assert.equal(parseOverlay({ year: 2026, edition: {}, speakers: [] }), null);
});

test('a payload with an extra field is accepted', () => {
  // Adding to the API must not break a site that has not been redeployed.
  const ok = parseOverlay({
    year: 2026,
    edition: { registrationUrl: '', registrationDeadline: null, abstractUrl: '', abstractDeadline: null, venuePublic: null, cityPublic: null },
    speakers: [{ slug: 'a', name: 'A', somethingNew: true }],
    sessions: [], committee: [], announcements: [],
  });
  assert.equal(ok?.speakers[0].slug, 'a');
});

test('an empty url from the overlay does not erase the repo one', () => {
  // The column is NOT NULL DEFAULT '', so a row that exists only to carry a flag
  // arrives with '' here. That must read as "no opinion", not "delete it".
  const out = mergeOverlay(
    { ...(repo as Record<string, unknown>), registrationUrl: 'https://forms.gle/real' } as never,
    { edition: { registrationUrl: '', abstractUrl: '' } } as never,
  );
  assert.equal(out.registrationUrl, 'https://forms.gle/real');
});

test('a real url from the overlay does replace the repo one', () => {
  const out = mergeOverlay(
    { ...(repo as Record<string, unknown>), registrationUrl: 'https://old' } as never,
    { edition: { registrationUrl: 'https://forms.gle/new' } } as never,
  );
  assert.equal(out.registrationUrl, 'https://forms.gle/new');
});
