import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { events } from '../src/data/events';

/**
 * /workshops shows RSG-Türkiye's nf-core work (#225), its other hackathons and
 * its workshops, all from src/data/events.ts. The nf-core local sites in
 * particular were real and public on nf-co.re, and on none of our pages.
 */
const DIST = new URL('../dist/', import.meta.url).pathname;
const built = existsSync(`${DIST}workshops/index.html`);

test('every event link is absolute https, and nf-core hackathons link their nf-co.re page', () => {
  for (const e of events) {
    for (const l of e.links ?? []) {
      assert.match(l.url, /^https:\/\//, `${e.id}: ${l.url}`);
      assert.ok(l.label.en && l.label.tr, `${e.id}: a link needs both labels`);
    }
    if (e.nfcore && e.type === 'hackathon') {
      assert.ok(e.links?.some((l) => l.url.startsWith('https://nf-co.re/events/')), `${e.id} has no nf-co.re page`);
    }
  }
  assert.ok(events.filter((e) => e.nfcore && e.type === 'hackathon').length >= 2);
});

test('both languages render the nf-core section first, with the local-site pages', { skip: !built && 'no build in dist/' }, () => {
  for (const page of ['workshops/index.html', 'tr/workshops/index.html']) {
    const html = readFileSync(`${DIST}${page}`, 'utf8');
    const nf = html.indexOf('id="nf-core"');
    assert.ok(nf !== -1, `${page}: no nf-core section`);
    assert.ok(nf < html.indexOf('id="workshops"'), `${page}: nf-core is not first`);
    assert.match(html, /nf-co\.re\/events\/2025\/hackathon-march-2025\/rsg-turkiye/);
    assert.match(html, /nf-co\.re\/events\/2026\/hackathon-march-2026\/istanbul/);
    assert.match(html, /github\.com\/nf-core\/scdownstream\/pull\/261/);
  }
});

test('the events page lists the hackathons too, and links to /workshops', { skip: !built && 'no build in dist/' }, () => {
  const html = readFileSync(`${DIST}events/index.html`, 'utf8');
  assert.match(html, /id="hackathons"/);
  assert.match(html, /href="\/workshops\/"/);
});
