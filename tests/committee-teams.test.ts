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
  const saved = rowFromInput('committee', { name: 'Ayşe', teams: ['Sosyal Medya', 'Grafik Tasarım'] }, 2026);
  const loaded = rowToInput('committee', { id: 'c1', sort: 0, ...saved });
  assert.deepEqual(loaded.teams, ['Sosyal Medya', 'Grafik Tasarım']);
});

test('a member saved with no teams loads as no teams, not as undefined', () => {
  const saved = rowFromInput('committee', { name: 'Ayşe' }, 2026);
  assert.equal(saved.teams, '[]');
  assert.deepEqual(rowToInput('committee', { id: 'c1', sort: 0, ...saved }).teams, []);
});

test('the public overlay carries teams as an array, not the stored JSON', () => {
  const overlay = rowsToOverlay(edition, [], [], [row('["Sosyal Medya"]')], []);
  assert.deepEqual(overlay.committee[0].teams, ['Sosyal Medya']);
});

test('a row written before the column existed still renders', () => {
  // ADD COLUMN gave existing rows '[]', but a hand-run migration or a
  // restore could leave '' -- which JSON.parse throws on. One bad row must
  // not take the whole symposium site's build down with it.
  for (const stored of ['', 'not json', 'null', '{"a":1}', '["ok",7,null]']) {
    const overlay = rowsToOverlay(edition, [], [], [row(stored)], []);
    assert.ok(Array.isArray(overlay.committee[0].teams), `${stored} did not decode to an array`);
    for (const team of overlay.committee[0].teams) assert.equal(typeof team, 'string');
  }
  assert.deepEqual(parseTeams('["ok",7,null]'), ['ok']);
});

test('whitespace is trimmed and collapsed', () => {
  assert.deepEqual(normaliseTeams(['  Sosyal   Medya  ']), ['Sosyal Medya']);
});

test('blank entries disappear rather than becoming a blank heading', () => {
  assert.deepEqual(normaliseTeams(['', '   ', 'Tasarım']), ['Tasarım']);
});

test('duplicates are dropped case-insensitively, keeping the first spelling', () => {
  assert.deepEqual(normaliseTeams(['RSG Medya', 'rsg medya', 'RSG  MEDYA']), ['RSG Medya']);
});

test('İ and i are the same letter for the purposes of a duplicate', () => {
  assert.deepEqual(normaliseTeams(['İletişim', 'iletişim']), ['İletişim']);
});

test('case is otherwise left exactly as typed', () => {
  // "RSG" must not come back as "Rsg". The label is shown to readers.
  assert.deepEqual(normaliseTeams(['RSG Türkiye', 'iT']), ['RSG Türkiye', 'iT']);
});

test('absent, null and an empty list all mean no teams', () => {
  assert.deepEqual(normaliseTeams(undefined), []);
  assert.deepEqual(normaliseTeams(null), []);
  assert.deepEqual(normaliseTeams([]), []);
});

test('a non-array, or an array of anything but strings, is refused', () => {
  for (const bad of ['Sosyal Medya', 42, { a: 1 }, [1], [null], [['x']]]) {
    assert.throws(() => normaliseTeams(bad), /must be an array of strings/, `${JSON.stringify(bad)} was accepted`);
  }
});

test('an over-long label is refused rather than becoming a heading', () => {
  assert.throws(() => normaliseTeams(['x'.repeat(MAX_TEAM_LENGTH + 1)]), /too long/);
  assert.deepEqual(normaliseTeams(['x'.repeat(MAX_TEAM_LENGTH)]), ['x'.repeat(MAX_TEAM_LENGTH)]);
});

test('too many teams on one member is refused', () => {
  const many = Array.from({ length: MAX_TEAMS + 1 }, (_, i) => `Ekip ${i}`);
  assert.throws(() => normaliseTeams(many), /at most/);
  assert.deepEqual(normaliseTeams(many.slice(0, MAX_TEAMS)).length, MAX_TEAMS);
});

test('a bad teams list fails the save rather than storing part of it', () => {
  assert.throws(() => rowFromInput('committee', { name: 'Ayşe', teams: [1 as unknown as string] }, 2026));
});
