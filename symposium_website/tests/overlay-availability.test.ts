import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchOverlay, repoCanStandAlone, type RepoContent } from '../src/lib/overlay';

/**
 * Three ways to have no overlay, and they are not the same thing.
 *
 * "The CMS has no row for this edition yet" is the ordinary state of a
 * symposium nobody has programmed, and the site should build and say so.
 * "We could not reach the CMS, or could not read its answer" is a fault, and
 * building anyway can publish an empty programme over a live one -- Pages
 * keeps the last successful deploy, so a failed build preserves what is
 * published and a quiet success destroys it.
 *
 * They used to be one `null`.
 */

const payload = (over: Record<string, unknown> = {}) => ({
  year: 2026,
  edition: {
    registrationUrl: '',
    registrationDeadline: null,
    abstractUrl: '',
    abstractDeadline: null,
    venuePublic: null,
    cityPublic: null,
  },
  speakers: [],
  sessions: [],
  committee: [],
  announcements: [],
  ...over,
});

async function withFetch<T>(impl: typeof fetch, run: () => Promise<T>): Promise<T> {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = real;
  }
}

const respond = (body: unknown, status = 200): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

// --- asked, and there is nothing ---------------------------------------------

test('a CMS with no edition row is empty, not a fault', async () => {
  // This is the live response today, verbatim in shape.
  const result = await withFetch(respond(payload({ year: null })), () =>
    fetchOverlay(2026, 'https://example.org'),
  );
  assert.equal(result.kind, 'empty');
});

test('a CMS serving another year is empty, not a fault', async () => {
  const result = await withFetch(respond(payload({ year: 2025 })), () =>
    fetchOverlay(2026, 'https://example.org'),
  );
  assert.equal(result.kind, 'empty');
  assert.match(result.kind === 'empty' ? result.reason : '', /2025/);
});

// --- could not ask ------------------------------------------------------------

test('a network failure is unavailable', async () => {
  const result = await withFetch(
    (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch,
    () => fetchOverlay(2026, 'https://example.org'),
  );
  assert.equal(result.kind, 'unavailable');
});

test('a 500 is unavailable', async () => {
  const result = await withFetch(respond(payload(), 500), () => fetchOverlay(2026, 'https://example.org'));
  assert.equal(result.kind, 'unavailable');
});

test('an answer we cannot read is unavailable, not empty', async () => {
  // A renamed field on the server arrives as undefined and would otherwise
  // look exactly like "the CMS is empty" -- which is how a server bug could
  // quietly blank a published programme.
  const result = await withFetch(respond({ year: 2026, speakers: [] }), () =>
    fetchOverlay(2026, 'https://example.org'),
  );
  assert.equal(result.kind, 'unavailable');
});

// --- the good case ------------------------------------------------------------

test('a matching year is ok, and carries the overlay', async () => {
  const result = await withFetch(
    respond(payload({ speakers: [{ slug: 'a', name: 'A' }] })),
    () => fetchOverlay(2026, 'https://example.org'),
  );
  assert.equal(result.kind, 'ok');
  assert.equal(result.kind === 'ok' ? result.overlay.speakers.length : 0, 1);
});

// --- whether the repo can carry the page on its own ---------------------------

const repo = (over: Partial<RepoContent> = {}): RepoContent => ({
  registrationUrl: '',
  abstractUrl: '',
  venuePublic: false,
  cityPublic: true,
  speakers: [],
  sessions: [],
  committee: [],
  ...over,
});

test('an edition with nothing committed cannot stand alone', () => {
  // 2026 today: no speakers, no sessions, an empty committee folder.
  assert.equal(repoCanStandAlone(repo()), false);
});

test('any one of them is enough', () => {
  assert.equal(repoCanStandAlone(repo({ speakers: [{ slug: 'a', name: 'A' } as never] })), true);
  assert.equal(repoCanStandAlone(repo({ sessions: [{ slug: 's' } as never] })), true);
  assert.equal(repoCanStandAlone(repo({ committee: [{ name: 'N' } as never] })), true);
  assert.equal(repoCanStandAlone(repo({ registrationUrl: 'https://example.org' })), true);
  assert.equal(repoCanStandAlone(repo({ abstractUrl: 'https://example.org' })), true);
});

test('a link of nothing but spaces is not a link', () => {
  assert.equal(repoCanStandAlone(repo({ registrationUrl: '   ' })), false);
});
