import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathUnits, pathsForWebinar, progressByUnit, type DomainEntry, type LevelEntry, type StageEntry } from '../src/lib/learning-paths';

const domains: DomainEntry[] = [
  { slug: 'ml', name: 'Machine Learning', emoji: '🤖', order: 2 },
  { slug: 'genomics', name: 'Genomics', emoji: '🧬', order: 1 },
];
const levels: LevelEntry[] = [
  { domain: 'genomics', level: 'practitioner', sections: [{ resources: [{ id: 'g-p-0' }, { id: 'g-p-1', webinarSlug: 'talk-a' }] }] },
  { domain: 'genomics', level: 'explorer', sections: [{ resources: [{ id: 'g-e-0', webinarSlug: 'talk-a' }] }, { resources: [{ id: 'g-e-1', webinarSlug: 'talk-a' }] }] },
  { domain: 'ml', level: 'explorer', sections: [{ resources: [{ id: 'm-e-0' }, { id: 'm-e-1' }] }] },
];
const stages: StageEntry[] = [
  { id: 'en/06-rsg', number: 6, title: 'RSG', resources: [{ id: 'roadmap-6-0', webinarSlug: 'talk-a' }] },
  { id: 'en/01-start', number: 1, title: 'Start', resources: [{ id: 'roadmap-1-0' }] },
];

test('units run roadmap first, then domains by order and levels from Explorer up', () => {
  const units = pathUnits('en', domains, levels, stages);
  assert.deepEqual(units.map((u) => u.key), ['roadmap', 'genomics/explorer', 'genomics/practitioner', 'ml/explorer']);
  assert.deepEqual(units[0].ids, ['roadmap-1-0', 'roadmap-6-0']);
  assert.equal(units[1].href, '/learning-paths/genomics/?level=explorer');
  assert.equal(pathUnits('tr', domains, levels, stages)[1].href, '/tr/learning-paths/genomics/?level=explorer');
  assert.match(pathUnits('tr', domains, levels, stages)[1].label, /Keşifçi/);
});

test('a webinar is listed once per level and stage that has it, in reading order', () => {
  const paths = pathsForWebinar('talk-a', 'en', domains, levels, stages);
  // Two sections of genomics/explorer list it: still one line.
  assert.deepEqual(paths.map((p) => p.href), [
    '/learning-paths/roadmap/#en/06-rsg',
    '/learning-paths/genomics/?level=explorer',
    '/learning-paths/genomics/?level=practitioner',
  ]);
  assert.match(paths[0].label, /Stage 6: RSG/);
  assert.deepEqual(pathsForWebinar('nobody-lists-this', 'en', domains, levels, stages), []);
});

test('progress counts a tick from either language once, and puts the unfinished first', () => {
  const units = pathUnits('en', domains, levels, stages);
  const rows = progressByUnit(units, [
    'g-e-0', 'tr-g-e-0', 'tr-g-e-1', // explorer finished, partly ticked in Turkish
    'm-e-0',                         // ml half done
    'tr-roadmap-1-0',                // roadmap half done
    'gone-resource',                 // a removed resource's tick is ignored
  ]);
  assert.deepEqual(rows.map((r) => [r.key, r.done, r.total]), [
    ['roadmap', 1, 2],
    ['ml/explorer', 1, 2],
    ['genomics/explorer', 2, 2],
  ]);
  assert.equal(rows.some((r) => r.key === 'genomics/practitioner'), false, 'untouched units are left out');
  assert.deepEqual(progressByUnit(units, []), []);
});
