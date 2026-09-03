import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToOverlay } from '../functions/_lib/symposium';

const editionRow = {
  year: 2026, registration_url: 'https://forms.gle/reg', registration_deadline: 1790000000,
  abstract_url: '', abstract_deadline: null, venue_public: null, city_public: 1,
};

test('an unset flag stays null so the repo keeps its say', () => {
  const o = rowsToOverlay(editionRow, [], [], [], []);
  assert.equal(o.edition.venuePublic, null);
  assert.equal(o.edition.cityPublic, true);
});

test('an empty url is carried as an empty string, not dropped', () => {
  const o = rowsToOverlay(editionRow, [], [], [], []);
  assert.equal(o.edition.abstractUrl, '');
  assert.equal(o.edition.abstractDeadline, null);
});

test('speaker slugs survive so sessions can still point at them', () => {
  const o = rowsToOverlay(editionRow,
    [{ id: 'a', slug: 'ada-lovelace', year: 2026, name: 'Ada Lovelace', position: '', company: '', bio: '', photo: '', linkedin: '', sort: 0 }],
    [{ id: 'b', year: 2026, title: 'Keynote', type: 'keynote', time: '09:30', end_time: '', description: '', speaker_slugs: '["ada-lovelace"]', sort: 0 }],
    [], []);
  assert.equal(o.speakers[0].slug, 'ada-lovelace');
  assert.deepEqual(o.sessions[0].speakerSlugs, ['ada-lovelace']);
});

test('a malformed speaker_slugs blob degrades to empty rather than throwing', () => {
  const o = rowsToOverlay(editionRow, [],
    [{ id: 'b', year: 2026, title: 'Keynote', type: 'keynote', time: '', end_time: '', description: '', speaker_slugs: 'not json', sort: 0 }],
    [], []);
  assert.deepEqual(o.sessions[0].speakerSlugs, []);
});

test('rows come out in sort order, not insertion order', () => {
  const o = rowsToOverlay(editionRow,
    [{ id: 'b', slug: 'b', year: 2026, name: 'B', position: '', company: '', bio: '', photo: '', linkedin: '', sort: 2 },
     { id: 'a', slug: 'a', year: 2026, name: 'A', position: '', company: '', bio: '', photo: '', linkedin: '', sort: 1 }],
    [], [], []);
  assert.deepEqual(o.speakers.map((s) => s.name), ['A', 'B']);
});

test('the hall never appears in the payload', () => {
  const o = rowsToOverlay(editionRow, [], [], [], []);
  const json = JSON.stringify(o);
  // The hall's name lives in the symposium repo's edition markdown and reaches
  // the page through locationFor. Only its visibility flag travels over this API.
  assert.ok(!json.includes('U3'), 'the hall name must not travel');
  assert.ok(!json.includes('Amphitheatre'), 'nor any part of it');
  assert.ok(!('venue' in o.edition), 'no venue string field');
  assert.ok(!('venueCity' in o.edition), 'no city string field either');
});
