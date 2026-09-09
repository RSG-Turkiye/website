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

test('a committee payload in either team shape is accepted', () => {
  // The API and this site are separate Pages projects and are not deployed
  // together, so during the window between the two deploys this build reads
  // the *previous* payload shape. The repo has no committee of its own, so a
  // rejected payload does not degrade to the repo's copy -- it refuses to
  // publish at all. Being strict about a field's shape here turns every
  // change to the API into a broken deploy, and it did exactly that once.
  const base = {
    year: 2026,
    edition: { registrationUrl: '', registrationDeadline: null, abstractUrl: '', abstractDeadline: null, venuePublic: null, cityPublic: null },
    speakers: [], sessions: [], announcements: [],
  };
  // Today's shape.
  const pairs = parseOverlay({ ...base, committee: [{ name: 'A', teams: [{ en: 'Social Media', tr: 'Sosyal Medya' }] }] });
  assert.deepEqual(pairs?.committee[0].teams, [{ en: 'Social Media', tr: 'Sosyal Medya' }]);
  // The first shape this field had, which is what a not-yet-redeployed API
  // still serves. A bare name meant English only.
  const strings = parseOverlay({ ...base, committee: [{ name: 'A', teams: ['Scientific Program'] }] });
  assert.deepEqual(strings?.committee[0].teams, [{ en: 'Scientific Program', tr: '' }]);
  // And no teams at all, which is every row written before the column.
  const none = parseOverlay({ ...base, committee: [{ name: 'A' }] });
  assert.deepEqual(none?.committee[0].teams, []);
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

// --- announcements ------------------------------------------------------------

test('announcements come from the overlay, because the repo has none', () => {
  const out = mergeOverlay(repo, {
    announcements: [
      {
        id: 'a1',
        title: 'Registration open',
        description: 'Until 1 October',
        button_text: 'Register',
        button_url: 'https://example.org',
        expires_at: 4_000_000_000,
      },
    ],
  } as never);
  assert.deepEqual(out.announcements, [
    {
      id: 'a1',
      title: 'Registration open',
      description: 'Until 1 October',
      buttonText: 'Register',
      buttonUrl: 'https://example.org',
    },
  ]);
});

test('an empty list clears them, unlike the three repo-backed lists', () => {
  // Speakers, sessions and committee live in the repo, so an empty overlay
  // means "no opinion" and the repo's own stand -- the test above this block
  // pins that. Announcements exist only in the CMS, so deleting the last one
  // has to make it disappear rather than leave the previous build's showing.
  const withOne = { ...(repo as object), announcements: [
    { id: 'old', title: 'Old', description: '', buttonText: '', buttonUrl: '' },
  ] } as never;
  const out = mergeOverlay(withOne, { announcements: [] } as never);
  assert.deepEqual(out.announcements, []);
});

test('an overlay that carries no announcements field clears them too', () => {
  // The field is required by the schema, so this is defence rather than a
  // case the server can produce -- and clearing is the safe direction here.
  const out = mergeOverlay(repo, { speakers: [] } as never);
  assert.deepEqual(out.announcements, []);
});

test('an announcement missing a field the site renders is refused', () => {
  // The schema exists so a renamed field on the server is caught here rather
  // than rendering a card with a blank title. It was z.array(z.unknown()),
  // which caught nothing -- and nothing on this site read announcements at
  // all, so there was nothing to catch.
  const base = {
    year: 2026,
    edition: {
      registrationUrl: '', registrationDeadline: null,
      abstractUrl: '', abstractDeadline: null,
      venuePublic: null, cityPublic: null,
    },
    speakers: [], sessions: [], committee: [],
  };
  const good = { ...base, announcements: [{ id: 'a', title: 'T', description: '', button_text: '', button_url: '', expires_at: 1 }] };
  assert.notEqual(parseOverlay(good), null);

  for (const missing of ['id', 'title', 'description', 'button_text', 'button_url', 'expires_at']) {
    const announcement: Record<string, unknown> = { ...good.announcements[0] };
    delete announcement[missing];
    assert.equal(parseOverlay({ ...base, announcements: [announcement] }), null, `missing ${missing}`);
  }
});

test('an announcement may carry fields this site does not use', () => {
  // show_as_popup is a main-site idea; the server sends the row it has.
  const payload = {
    year: 2026,
    edition: { registrationUrl: '', registrationDeadline: null, abstractUrl: '', abstractDeadline: null, venuePublic: null, cityPublic: null },
    speakers: [], sessions: [], committee: [],
    announcements: [{ id: 'a', title: 'T', description: '', button_text: '', button_url: '', expires_at: 1, show_as_popup: 1 }],
  };
  assert.notEqual(parseOverlay(payload), null);
});
