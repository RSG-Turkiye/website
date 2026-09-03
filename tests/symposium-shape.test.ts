import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rowsToOverlay, editionRowFromInput, rowToEditionInput, rowFromInput, rowToInput, KIND_TABLES } from '../functions/_lib/symposium';

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

test('every field round trips to itself, not to its neighbour', () => {
  // The narrow round-trip test above leaves four fields at their defaults, so a
  // swapped pair (cityPublic reading venue_public, abstract reading registration)
  // would read back correct by coincidence. Here every field differs from every
  // other, so a swap has nowhere to hide.
  const input = {
    registrationUrl: 'https://example.org/register',
    registrationDeadline: '2026-09-15',
    abstractUrl: 'https://example.org/abstract',
    abstractDeadline: '2026-08-20',
    venuePublic: false,
    cityPublic: true,
  };
  const row = editionRowFromInput(input, 2026);
  assert.deepEqual(rowToEditionInput(row), input);
  assert.deepEqual(editionRowFromInput(rowToEditionInput(row), 2026), row);
});

// --- speakers, sessions, committee (Task 6) ---------------------------------

test('only the three known kinds map to a table', () => {
  assert.deepEqual(Object.keys(KIND_TABLES).sort(), ['committee', 'sessions', 'speakers']);
  assert.equal(KIND_TABLES.speakers, 'symposium_speakers');
});

test('a speaker gets a slug derived from the name when none is given', () => {
  const row = rowFromInput('speakers', { name: 'Ada Lovelace' }, 2026);
  assert.equal(row.slug, 'ada-lovelace');
});

test('Turkish letters survive slugging without becoming mojibake', () => {
  const row = rowFromInput('speakers', { name: 'Ayşe Yılmaz Öztürk' }, 2026);
  assert.equal(row.slug, 'ayse-yilmaz-ozturk');
});

test('a session stores its speaker links as slugs', () => {
  const row = rowFromInput('sessions', { title: 'Keynote', type: 'keynote', speakerSlugs: ['ada-lovelace'] }, 2026);
  assert.equal(row.speaker_slugs, '["ada-lovelace"]');
});

test('an unknown session type is rejected rather than stored', () => {
  assert.throws(() => rowFromInput('sessions', { title: 'X', type: 'lightning' }, 2026), /type/);
});

test('an unknown kind is rejected', () => {
  assert.throws(() => rowFromInput('sponsors' as never, {}, 2026), /kind/);
});

test('the dotted capital I does not turn into i plus a combining dot', () => {
  // 'İ'.toLowerCase() in plain JS is 'i' + U+0307 (combining dot above),
  // which would silently fail to match a speakerSlugs entry typed as "i".
  const row = rowFromInput('speakers', { name: 'İlayda Şahin' }, 2026);
  assert.equal(row.slug, 'ilayda-sahin');
  assert.equal(row.slug.normalize('NFC'), row.slug, 'must be plain ASCII, no combining marks');
});

test('more Turkish names slug to plain ASCII', () => {
  assert.equal(rowFromInput('speakers', { name: 'Oğuz Çetin' }, 2026).slug, 'oguz-cetin');
  assert.equal(rowFromInput('speakers', { name: 'Gülşah Öztürk' }, 2026).slug, 'gulsah-ozturk');
});

test('slugging is idempotent: twice or already-slugged gives the same answer', () => {
  const once = rowFromInput('speakers', { name: 'Gülşah Öztürk' }, 2026).slug;
  const twice = rowFromInput('speakers', { name: once }, 2026).slug;
  assert.equal(twice, once);
  const explicit = rowFromInput('speakers', { name: 'Someone Else', slug: once }, 2026).slug;
  assert.equal(explicit, once);
});

test('a committee member requires a name', () => {
  assert.throws(() => rowFromInput('committee', {} as never, 2026), /name/);
});

test('a non-http photo or LinkedIn URL is rejected rather than stored', () => {
  assert.throws(
    () => rowFromInput('speakers', { name: 'Ada Lovelace', linkedin: 'javascript:alert(1)' }, 2026),
    /http/,
  );
});

test('every speaker field round trips to itself, not to its neighbour', () => {
  // Every field below holds a distinct, non-default value, so a swapped pair
  // in rowToInput (position reading company, say) cannot read back correct
  // by coincidence -- see the edition test of the same name above.
  const row = {
    id: 'sp1', slug: 'jane-doe', year: 2026, name: 'Jane Doe', position: 'Chief Technology Officer',
    company: 'Acme Robotics', bio: 'Builds things that fly.', photo: 'https://example.org/jane.jpg',
    linkedin: 'https://linkedin.com/in/janedoe', sort: 4,
  };
  const input = rowToInput('speakers', row);
  assert.deepEqual(input, {
    id: row.id, sort: row.sort, slug: row.slug, name: row.name, position: row.position,
    company: row.company, bio: row.bio, photo: row.photo, linkedin: row.linkedin,
  });
  const { id, sort, ...expectedRow } = row;
  assert.deepEqual(rowFromInput('speakers', input, row.year), expectedRow);
});

test('every session field round trips to itself, not to its neighbour', () => {
  const row = {
    id: 'se1', slug: 'opening-keynote', year: 2026, title: 'Opening Keynote', type: 'keynote',
    time: '09:00', end_time: '10:00', description: 'Welcome remarks from the organizers.',
    speaker_slugs: '["jane-doe","john-roe"]', sort: 1,
  };
  const input = rowToInput('sessions', row);
  assert.deepEqual(input, {
    id: row.id, sort: row.sort, slug: row.slug, title: row.title, type: row.type,
    time: row.time, endTime: row.end_time, description: row.description,
    speakerSlugs: ['jane-doe', 'john-roe'],
  });
  const { id, sort, ...expectedRow } = row;
  assert.deepEqual(rowFromInput('sessions', input, row.year), expectedRow);
});

test('every committee field round trips to itself, not to its neighbour', () => {
  const row = {
    id: 'co1', year: 2026, name: 'Ali Veli', role: 'Chair', role_tr: 'Başkan',
    affiliation: 'Gebze Technical University', photo: 'https://example.org/ali.jpg',
    linkedin: 'https://linkedin.com/in/aliveli', sort: 2,
  };
  const input = rowToInput('committee', row);
  assert.deepEqual(input, {
    id: row.id, sort: row.sort, name: row.name, role: row.role, roleTr: row.role_tr,
    affiliation: row.affiliation, photo: row.photo, linkedin: row.linkedin,
  });
  const { id, sort, ...expectedRow } = row;
  assert.deepEqual(rowFromInput('committee', input, row.year), expectedRow);
});
