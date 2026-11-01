import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { CITY_COORDS, mapCities, project, MAP } from '../src/lib/guide-map';
import { cityFromParams } from '../src/lib/guide-search';

/** The guide's city map (src/components/guide/GuideMap.astro). */

const dir = new URL('../src/content/guide-universities/', import.meta.url);
const universities = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as { id: string; city: string });

test('every city in the guide has coordinates (add it to CITY_COORDS in src/lib/guide-map.ts)', () => {
  const missing = [...new Set(universities.map((u) => u.city))].filter((c) => !CITY_COORDS[c]);
  assert.deepEqual(missing, []);
});

test('every city lands inside the drawing', () => {
  for (const [name, c] of Object.entries(CITY_COORDS)) {
    const { x, y } = project(c.lat, c.lon);
    assert.ok(x > 0 && x < MAP.width && y > 0 && y < MAP.height, `${name} at ${x},${y}`);
  }
});

test('one marker per city, the same for every city, faded where no university has a programme', () => {
  const cities = mapCities(
    [{ id: 'a', city: 'İstanbul' }, { id: 'b', city: 'İstanbul' }, { id: 'c', city: 'Mersin' }, { id: 'd', city: 'Nowhere' }],
    [{ universityId: 'a' }],
  );
  assert.deepEqual(cities.map((c) => [c.name, c.universities, c.faded]), [['İstanbul', 2, false], ['Mersin', 1, true]], 'a city without coordinates is left out, not an error');
});

test('?city= is read whatever the encoding or case, and only a known city counts', () => {
  const known = ['İzmir', 'İstanbul', 'Çanakkale'];
  assert.equal(cityFromParams('?city=%C4%B0zmir', known), 'İzmir');
  assert.equal(cityFromParams('?city=izmir', known), 'İzmir');
  assert.equal(cityFromParams('?city=CANAKKALE', known), 'Çanakkale');
  assert.equal(cityFromParams('?city=Atlantis', known), '');
  assert.equal(cityFromParams('', known), '');
});
