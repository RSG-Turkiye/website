import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByTeam } from '../src/lib/committee';
import type { CommitteeMember } from '../src/lib/content';

/**
 * Committee members are grouped by their team labels.
 *
 * The page this drives cannot be checked by eye: the repo's committee folder
 * holds nothing but a .gitkeep and the live overlay's roster is empty, so
 * /committee renders "will be announced soon" no matter what this code does.
 * The grouping is a pure function for exactly that reason, and these are the
 * cases the organisers described -- somebody on two teams, somebody on none.
 */

const person = (name: string, teams?: string[]): CommitteeMember => ({
  name, role: '', roleTr: '', affiliation: '', photo: '', teams,
});

test('a member on two teams is listed under both', () => {
  const groups = groupByTeam([
    person('Ayşe', ['Sosyal Medya', 'Bilimsel Program']),
    person('Mehmet', ['Bilimsel Program']),
  ]);
  assert.deepEqual(
    groups.map((g) => [g.label, g.members.map((m) => m.name)]),
    [
      ['Sosyal Medya', ['Ayşe']],
      ['Bilimsel Program', ['Ayşe', 'Mehmet']],
    ],
  );
});

test('members with no team come last, in one block with no label', () => {
  const groups = groupByTeam([
    person('Ayşe', ['Sosyal Medya']),
    person('Mehmet'),
    person('Zeynep', []),
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups[1].label, null);
  assert.deepEqual(groups[1].members.map((m) => m.name), ['Mehmet', 'Zeynep']);
});

test('with nobody on a team the result is the old flat grid', () => {
  // One unlabelled group, which CommitteeGrid renders without any heading --
  // the page as it was before teams existed.
  const groups = groupByTeam([person('Ayşe'), person('Mehmet')]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, null);
  assert.equal(groups[0].members.length, 2);
});

test('an empty roster produces no groups at all', () => {
  assert.deepEqual(groupByTeam([]), []);
});

test('spelling and spacing differences do not split a team', () => {
  // Free text: nobody picks the label from a list, so two people typing the
  // same team must still land under one heading.
  const groups = groupByTeam([
    person('Ayşe', ['Sosyal Medya']),
    person('Mehmet', ['sosyal  medya ']),
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map((m) => m.name), ['Ayşe', 'Mehmet']);
});

test('Turkish dotted and dotless I fold together', () => {
  // toLowerCase() alone leaves "İ" as "i" + a combining dot, which never
  // equals the "i" in "iletişim". The heading is a Turkish word far more
  // often than not, so this is the common case, not the exotic one.
  const groups = groupByTeam([
    person('Ayşe', ['İletişim']),
    person('Mehmet', ['iletişim']),
  ]);
  assert.equal(groups.length, 1, `expected one team, got ${groups.map((g) => g.label).join(' / ')}`);
});

test('the heading keeps the first spelling, uppercase and all', () => {
  const groups = groupByTeam([
    person('Ayşe', ['RSG Medya']),
    person('Mehmet', ['rsg medya']),
  ]);
  assert.equal(groups[0].label, 'RSG Medya');
});

test('a member who lists one team twice appears once under it', () => {
  const groups = groupByTeam([person('Ayşe', ['Tasarım', 'tasarım'])]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 1);
});

test('team order follows the order members are already sorted in', () => {
  // Sort is set in the admin panel; teams inherit it rather than carrying a
  // second ordering that could disagree with it.
  const groups = groupByTeam([
    person('Ayşe', ['Sponsorluk']),
    person('Mehmet', ['Grafik Tasarım']),
    person('Zeynep', ['Sponsorluk']),
  ]);
  assert.deepEqual(groups.map((g) => g.label), ['Sponsorluk', 'Grafik Tasarım']);
});

test('a member with no teams field at all is untagged, not dropped', () => {
  // The overlay schema passes payloads through, so an older one carries no
  // teams key; the rosters archived before this feature have none either.
  const groups = groupByTeam([{ name: 'Ayşe', role: '', roleTr: '', affiliation: '', photo: '' }]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members[0].name, 'Ayşe');
});
