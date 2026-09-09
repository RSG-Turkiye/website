import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseTeams, parseTeams, rowFromInput, rowToInput, rowsToOverlay,
  MAX_TEAMS, MAX_TEAM_LENGTH,
  type CommitteeRow, type EditionRow,
} from '../functions/_lib/symposium';

/**
 * Committee team labels survive the round trip, and nothing dangerous gets in.
 *
 * The labels are free text -- the organisers add a team without a deploy --
 * so every guarantee the feature has lives in normaliseTeams. And a team
 * written in the admin panel travels through JSON in a D1 column, out of the
 * public endpoint, and into a heading on the symposium site: the shape has
 * to be the same at both ends or the panel shows one thing and the page
 * another.
 */

const edition: EditionRow = {
  year: 2026, registration_url: '', registration_deadline: null,
  abstract_url: '', abstract_deadline: null, venue_public: null, city_public: null,
};

const row = (teams: string, over: Partial<CommitteeRow> = {}): CommitteeRow => ({
  id: 'c1', year: 2026, name: 'Ayşe', role: '', role_tr: '',
  affiliation: '', photo: '', linkedin: '', teams, sort: 0, ...over,
});

test('a form submission survives being saved and loaded again', () => {
  const saved = rowFromInput('committee', {
    name: 'Ayşe',
    teams: ['Social Media', 'Graphic Design'],
    teamsTr: ['Sosyal Medya', 'Grafik Tasarım'],
  }, 2026);
  const loaded = rowToInput('committee', { id: 'c1', sort: 0, ...saved });
  assert.deepEqual(loaded.teams, ['Social Media', 'Graphic Design']);
  assert.deepEqual(loaded.teamsTr, ['Sosyal Medya', 'Grafik Tasarım']);
  // And saving what was loaded, unchanged, stores the same bytes.
  assert.equal(rowFromInput('committee', { name: 'Ayşe', ...loaded }, 2026).teams, saved.teams);
});

test('a member saved with no teams loads as no teams, not as undefined', () => {
  const saved = rowFromInput('committee', { name: 'Ayşe' }, 2026);
  assert.equal(saved.teams, '[]');
  const loaded = rowToInput('committee', { id: 'c1', sort: 0, ...saved });
  assert.deepEqual(loaded.teams, []);
  assert.deepEqual(loaded.teamsTr, []);
});

test('Turkish is optional and round trips as empty', () => {
  const saved = rowFromInput('committee', { name: 'Sude', teams: ['Scientific Program'] }, 2026);
  assert.equal(saved.teams, '[{"en":"Scientific Program","tr":""}]');
  const loaded = rowToInput('committee', { id: 'c1', sort: 0, ...saved });
  assert.deepEqual(loaded.teamsTr, ['']);
  // Loading that and saving it back must not become a mismatch error.
  assert.equal(rowFromInput('committee', { name: 'Sude', ...loaded }, 2026).teams, saved.teams);
});

test('a partial Turkish list is refused rather than guessed at', () => {
  // Silently pairing two of three would put a team under the wrong name.
  assert.throws(
    () => normaliseTeams(['A', 'B', 'C'], ['A-tr', 'B-tr']),
    /2 in Turkish|one to one/,
  );
  assert.throws(() => normaliseTeams([], ['A-tr']), /one to one/);
});

test('the two lists are matched in order', () => {
  assert.deepEqual(normaliseTeams(['A', 'B'], ['A-tr', 'B-tr']), [
    { en: 'A', tr: 'A-tr' },
    { en: 'B', tr: 'B-tr' },
  ]);
});

test('a team named only in Turkish is allowed', () => {
  assert.deepEqual(normaliseTeams([''], ['Sosyal Medya']), [{ en: '', tr: 'Sosyal Medya' }]);
});

test('the public overlay carries teams as pairs, not the stored JSON', () => {
  const overlay = rowsToOverlay(edition, [], [], [row('[{"en":"Social Media","tr":"Sosyal Medya"}]')], []);
  assert.deepEqual(overlay.committee[0].teams, [{ en: 'Social Media', tr: 'Sosyal Medya' }]);
});

test('the first version of this column, bare strings, still reads', () => {
  // Written before the Turkish name existed. English-only is exactly what it
  // meant, so it must decode to that rather than to nothing -- there is such
  // a row in production.
  const overlay = rowsToOverlay(edition, [], [], [row('["Scientific Program"]')], []);
  assert.deepEqual(overlay.committee[0].teams, [{ en: 'Scientific Program', tr: '' }]);
});

test('a row written before the column existed still renders', () => {
  // ADD COLUMN gave existing rows '[]', but a hand-run migration or a
  // restore could leave '' -- which JSON.parse throws on. One bad row must
  // not take the whole symposium site's build down with it.
  for (const stored of ['', 'not json', 'null', '{"a":1}', '[7,null,{}]', '[{"en":7}]']) {
    const overlay = rowsToOverlay(edition, [], [], [row(stored)], []);
    assert.ok(Array.isArray(overlay.committee[0].teams), `${stored} did not decode to an array`);
    for (const t of overlay.committee[0].teams) {
      assert.equal(typeof t.en, 'string');
      assert.equal(typeof t.tr, 'string');
    }
  }
  assert.deepEqual(parseTeams('["ok",7,null]'), [{ en: 'ok', tr: '' }]);
  assert.deepEqual(parseTeams('[{"en":"","tr":""}]'), [], 'a pair with neither name is not a team');
});

test('whitespace is trimmed and collapsed, in both languages', () => {
  assert.deepEqual(normaliseTeams(['  Social   Media  '], ['  Sosyal   Medya ']),
    [{ en: 'Social Media', tr: 'Sosyal Medya' }]);
});

test('blank entries disappear rather than becoming a blank heading', () => {
  assert.deepEqual(normaliseTeams(['', '   ', 'Design'], []), [{ en: 'Design', tr: '' }]);
});

test('duplicates are dropped case-insensitively, keeping the first spelling', () => {
  assert.deepEqual(normaliseTeams(['RSG Media', 'rsg media', 'RSG  MEDIA'], []),
    [{ en: 'RSG Media', tr: '' }]);
});

test('every form of the letter I folds together', () => {
  // Turkish locale rules fold İ/i but split I/i; the default rules do the
  // opposite. Both spellings occur in these labels, so both must fold.
  assert.deepEqual(normaliseTeams(['İletişim', 'iletişim'], []), [{ en: 'İletişim', tr: '' }]);
  assert.deepEqual(normaliseTeams(['RSG MEDIA', 'RSG Media'], []), [{ en: 'RSG MEDIA', tr: '' }]);
  assert.deepEqual(normaliseTeams(['IT', 'it'], []), [{ en: 'IT', tr: '' }]);
  assert.deepEqual(normaliseTeams(['Sıra', 'Sira'], []), [{ en: 'Sıra', tr: '' }],
    'documented cost of the fold changed -- update the comment on teamKey');
});

test('case is otherwise left exactly as typed', () => {
  assert.deepEqual(normaliseTeams(['RSG Türkiye', 'iT'], []),
    [{ en: 'RSG Türkiye', tr: '' }, { en: 'iT', tr: '' }]);
});

test('absent, null and an empty list all mean no teams', () => {
  assert.deepEqual(normaliseTeams(undefined), []);
  assert.deepEqual(normaliseTeams(null), []);
  assert.deepEqual(normaliseTeams([]), []);
  assert.deepEqual(normaliseTeams([], undefined), []);
});

test('a non-array, or an array of anything but strings, is refused', () => {
  for (const bad of ['Social Media', 42, { a: 1 }, [1], [null], [['x']]]) {
    assert.throws(() => normaliseTeams(bad), /must be an array of strings/, `${JSON.stringify(bad)} was accepted`);
  }
  assert.throws(() => normaliseTeams(['A'], [1]), /must be an array of strings/);
});

test('an over-long label is refused rather than becoming a heading', () => {
  assert.throws(() => normaliseTeams(['x'.repeat(MAX_TEAM_LENGTH + 1)], []), /too long/);
  assert.throws(() => normaliseTeams(['A'], ['x'.repeat(MAX_TEAM_LENGTH + 1)]), /too long/);
  assert.deepEqual(normaliseTeams(['x'.repeat(MAX_TEAM_LENGTH)], []).length, 1);
});

test('too many teams on one member is refused', () => {
  const many = Array.from({ length: MAX_TEAMS + 1 }, (_, i) => `Team ${i}`);
  assert.throws(() => normaliseTeams(many, []), /at most/);
  assert.deepEqual(normaliseTeams(many.slice(0, MAX_TEAMS), []).length, MAX_TEAMS);
});

test('a bad teams list fails the save rather than storing part of it', () => {
  assert.throws(() => rowFromInput('committee', { name: 'Ayşe', teams: [1 as unknown as string] }, 2026));
  assert.throws(() => rowFromInput('committee', { name: 'Ayşe', teams: ['A', 'B'], teamsTr: ['A-tr'] }, 2026));
});
