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

test('event images are served by /api/images, with alt text in both languages', async () => {
  // r2.dev is blocked in Türkiye, so photos go through the site's own /api/images.
  const { IMAGE_KEY } = await import('../functions/_lib/images');
  for (const e of events) {
    if (!e.image) continue;
    for (const url of [e.image.thumb, e.image.full]) {
      const key = url.replace(/^\/api\/images\//, '');
      assert.ok(url.startsWith('/api/images/') && IMAGE_KEY.test(key), `${e.id}: ${url}`);
    }
    assert.ok(e.image.alt.en.trim() && e.image.alt.tr.trim(), `${e.id}: alt text`);
  }
  assert.ok(events.filter((e) => e.image).length >= 10);
});

test('every event image is really in the bucket', { skip: process.env.CHECK_NETWORK !== '1' && 'network check; set CHECK_NETWORK=1' }, async () => {
  for (const e of events) {
    for (const url of e.image ? [e.image.thumb, e.image.full] : []) {
      const res = await fetch(`https://rsg-turkiye.iscbsc.org${url}`, { method: 'HEAD' });
      assert.equal(res.status, 200, `${e.id}: ${url}`);
    }
  }
});

test('both pages carry the year rail and the side column, and the column counts what the data holds', { skip: !built && 'no build in dist/' }, () => {
  for (const page of ['workshops/index.html', 'tr/workshops/index.html', 'events/index.html', 'tr/events/index.html']) {
    const html = readFileSync(`${DIST}${page}`, 'utf8');
    assert.match(html, /class="year-rail"/, `${page}: no year rail`);
    assert.match(html, /<aside[^>]*xl:sticky/, `${page}: no sticky side column`);
    assert.doesNotMatch(html.slice(html.indexOf("<aside"), html.indexOf(">", html.indexOf("<aside"))), /overflow/, `${page}: the column must not scroll on its own`);
    assert.match(html, /mailto:turkey\.rsg@gmail\.com/, `${page}: no invitation`);
  }
  const workshops = events.filter((e) => e.type === 'workshop' && e.start < new Date()).length;
  const html = readFileSync(`${DIST}workshops/index.html`, 'utf8');
  const aside = html.slice(html.indexOf('<aside'), html.indexOf('</aside>'));
  assert.match(aside, new RegExp(`>workshops</dt>\\s*<dd[^>]*>${workshops}<`), 'workshop count');
});
