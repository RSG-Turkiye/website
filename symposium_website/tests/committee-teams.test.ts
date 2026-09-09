import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByTeam } from '../src/lib/committee';
import type { CommitteeMember, Team } from '../src/lib/content';

/**
 * Committee members are grouped by their team labels, in the reader's
 * language.
 *
 * The page this drives cannot be checked by eye: the repo's committee folder
 * holds nothing but a .gitkeep and the live roster is one person, so most of
 * these cases have never existed in production. The grouping is a pure
 * function for exactly that reason.
 */

const team = (en: string, tr = ''): Team => ({ en, tr });
const person = (name: string, teams?: Team[]): CommitteeMember => ({
  name, role: '', roleTr: '', affiliation: '', photo: '', teams,
});

const shape = (groups: { label: string | null; members: CommitteeMember[] }[]) =>
  groups.map((g) => [g.label, g.members.map((m) => m.name)]);

test('a member on two teams is listed under both, in each language', () => {
  const people = [
    person('Ayşe', [team('Social Media', 'Sosyal Medya'), team('Scientific Program', 'Bilimsel Program')]),
    person('Mehmet', [team('Scientific Program', 'Bilimsel Program')]),
  ];
  assert.deepEqual(shape(groupByTeam(people, 'en')), [
    ['Social Media', ['Ayşe']],
    ['Scientific Program', ['Ayşe', 'Mehmet']],
  ]);
  assert.deepEqual(shape(groupByTeam(people, 'tr')), [
    ['Sosyal Medya', ['Ayşe']],
    ['Bilimsel Program', ['Ayşe', 'Mehmet']],
  ]);
});

test('a team named only in English still heads the Turkish page', () => {
  // The case that exists in production right now: one member, one team,
  // entered before the Turkish field existed. A blank heading would be the
  // worst outcome of adding the second language.
  const groups = groupByTeam([person('Sude', [team('Scientific Program')])], 'tr');
  assert.deepEqual(shape(groups), [['Scientific Program', ['Sude']]]);
});

test('a team named only in Turkish still heads the English page', () => {
  const groups = groupByTeam([person('Ayşe', [team('', 'Sosyal Medya')])], 'en');
  assert.deepEqual(shape(groups), [['Sosyal Medya', ['Ayşe']]]);
});

test("a later member's translation replaces a fallback heading", () => {
  // The first member gave no Turkish name, so the Turkish page fell back to
  // English; the second member supplies one. Both are on the same team, and
  // the reader should get the translation rather than the fallback.
  const groups = groupByTeam([
    person('Sude', [team('Scientific Program')]),
    person('Ayşe', [team('Scientific Program', 'Bilimsel Program')]),
  ], 'tr');
  assert.deepEqual(shape(groups), [['Bilimsel Program', ['Sude', 'Ayşe']]]);
});

test('a real heading is never overwritten by a later fallback', () => {
  const groups = groupByTeam([
    person('Ayşe', [team('Scientific Program', 'Bilimsel Program')]),
    person('Sude', [team('Scientific Program')]),
  ], 'tr');
  assert.deepEqual(shape(groups), [['Bilimsel Program', ['Ayşe', 'Sude']]]);
});

test('English-only and Turkish-only spellings of one team do not meet', () => {
  // An accepted limit, not an oversight: nothing here can know that
  // "Scientific Program" and "Bilimsel Program" are the same team when no
  // member has written both. The admin form offers the names already in use
  // in both fields, which is what stops it happening.
  const groups = groupByTeam([
    person('Sude', [team('Scientific Program')]),
    person('Ayşe', [team('', 'Bilimsel Program')]),
  ], 'tr');
  assert.equal(groups.length, 2, 'documented limit changed -- update the comment in committee.ts');
});

test('members with no team come last, in one block with no label', () => {
  const groups = groupByTeam([
    person('Ayşe', [team('Social Media', 'Sosyal Medya')]),
    person('Mehmet'),
    person('Zeynep', []),
  ], 'tr');
  assert.equal(groups.length, 2);
  assert.equal(groups[1].label, null);
  assert.deepEqual(groups[1].members.map((m) => m.name), ['Mehmet', 'Zeynep']);
});

test('with nobody on a team the result is the old flat grid', () => {
  const groups = groupByTeam([person('Ayşe'), person('Mehmet')], 'en');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].label, null);
  assert.equal(groups[0].members.length, 2);
});

test('an empty roster produces no groups at all', () => {
  assert.deepEqual(groupByTeam([], 'en'), []);
});

test('spelling and spacing differences do not split a team', () => {
  const groups = groupByTeam([
    person('Ayşe', [team('Social Media')]),
    person('Mehmet', [team('social  media ')]),
  ], 'en');
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map((m) => m.name), ['Ayşe', 'Mehmet']);
});

test('every form of the letter I folds together', () => {
  // Must match teamKey on the write side exactly, or a member saved under
  // one spelling renders under a second heading.
  for (const [a, b] of [['İletişim', 'iletişim'], ['RSG MEDIA', 'RSG Media'], ['IT', 'it']]) {
    const groups = groupByTeam([person('Ayşe', [team(a)]), person('Mehmet', [team(b)])], 'tr');
    assert.equal(groups.length, 1, `${a} / ${b} became ${groups.map((g) => g.label).join(' / ')}`);
  }
});

test('the heading keeps the first spelling, uppercase and all', () => {
  const groups = groupByTeam([
    person('Ayşe', [team('RSG Media')]),
    person('Mehmet', [team('rsg media')]),
  ], 'en');
  assert.equal(groups[0].label, 'RSG Media');
});

test('a member who lists one team twice appears once under it', () => {
  const groups = groupByTeam([person('Ayşe', [team('Design'), team('design')])], 'en');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 1);
});

test('team order follows the order members are already sorted in', () => {
  const groups = groupByTeam([
    person('Ayşe', [team('Sponsorship')]),
    person('Mehmet', [team('Graphic Design')]),
    person('Zeynep', [team('Sponsorship')]),
  ], 'en');
  assert.deepEqual(groups.map((g) => g.label), ['Sponsorship', 'Graphic Design']);
});

test('a member with no teams field at all is untagged, not dropped', () => {
  const groups = groupByTeam([{ name: 'Ayşe', role: '', roleTr: '', affiliation: '', photo: '' }], 'en');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members[0].name, 'Ayşe');
});

test('a pair with neither name is not a heading', () => {
  const groups = groupByTeam([person('Ayşe', [team('', ''), team('Design')])], 'en');
  assert.deepEqual(shape(groups), [['Design', ['Ayşe']]]);
});
