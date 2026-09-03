import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToOverlay, editionRowFromInput, rowToEditionInput } from '../functions/_lib/symposium';

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

test('a blank deadline is stored as null, not as zero', () => {
  const row = editionRowFromInput({ registrationUrl: 'https://x', registrationDeadline: '' }, 2026);
  assert.equal(row.registration_deadline, null);
});

test('a date arrives as a day and is stored as a timestamp', () => {
  const row = editionRowFromInput({ registrationDeadline: '2026-10-01' }, 2026);
  assert.equal(row.registration_deadline, Date.UTC(2026, 9, 1) / 1000);
});

test('an untouched visibility flag stays null', () => {
  const row = editionRowFromInput({}, 2026);
  assert.equal(row.venue_public, null);
});

test('an explicit false is stored as 0, not dropped as falsy', () => {
  // The difference between "hide it" and "no opinion" is the whole point of
  // the column being nullable.
  const row = editionRowFromInput({ venuePublic: false }, 2026);
  assert.equal(row.venue_public, 0);
});

test('a url is rejected rather than stored when it is not http', () => {
  assert.throws(() => editionRowFromInput({ registrationUrl: 'javascript:alert(1)' }, 2026), /http/);
});

test('what GET returns is what PUT accepts', () => {
  // The form loads a value, the user changes nothing, the form saves. That must
  // be a no-op, not a corruption -- so the two shapes have to be the same shape.
  const row = editionRowFromInput({ registrationDeadline: '2026-10-01', venuePublic: false }, 2026);
  const backOut = rowToEditionInput(row);
  assert.equal(backOut.registrationDeadline, '2026-10-01');
  assert.equal(backOut.venuePublic, false);
  assert.deepEqual(editionRowFromInput(backOut, 2026), row);
});

test('a null deadline survives the round trip as null, not as 1970', () => {
  const row = editionRowFromInput({ registrationDeadline: '' }, 2026);
  assert.equal(row.registration_deadline, null);
  assert.equal(rowToEditionInput(row).registrationDeadline, null);
});

test('no opinion survives the round trip as no opinion', () => {
  // The third state is the one a round trip is most likely to flatten.
  const row = editionRowFromInput({}, 2026);
  assert.equal(row.venue_public, null);
  assert.equal(rowToEditionInput(row).venuePublic, null);
});
