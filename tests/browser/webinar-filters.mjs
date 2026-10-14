/**
 * The webinar list's filters, driven in a real browser on both languages.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   npm i --no-save playwright && npx playwright install chromium
 *   BASE=http://localhost:4329 node tests/browser/webinar-filters.mjs
 *
 * Checks: the recording box keeps only cards marked with a recording; a year
 * and the box combine; search does not reset them; the address records the
 * filter and a shared address restores it; an old #2020 link still picks the
 * year; no console errors.
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const browser = await chromium.launch();
const visible = (page) => page.$$eval('.webinar-item', (els) => els.filter((e) => e.style.display !== 'none').map((e) => ({ video: e.dataset.video, year: e.dataset.year })));
const shown = (page) => page.$$eval('.webinar-item', (els) => els.filter((e) => e.style.display !== 'none').length);

try {
  for (const prefix of ['', '/tr']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // `astro preview` serves no Pages Functions, so /api/* (the header's /api/me) is a 404 here and only here.
    page.on('console', (m) => { if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(m.text()); });
    page.on('response', (r) => { if (r.status() >= 400 && !new URL(r.url()).pathname.startsWith('/api/')) errors.push(`${r.status()} ${r.url()}`); });

    await page.goto(`${BASE}${prefix}/webinars/`);
    const total = await page.$$eval('.webinar-item', (els) => els.length);
    assert.equal(await shown(page), Math.min(20, total), `${prefix}: first page shows 20`);

    await page.check('#videoOnly');
    const withVideo = await visible(page);
    assert.ok(withVideo.length > 0 && withVideo.every((x) => x.video === '1'), `${prefix}: only recordings`);
    assert.match(page.url(), /[?&]video=1/);

    await page.selectOption('#yearFilter', '2020');
    const both = await visible(page);
    assert.ok(both.length > 0 && both.every((x) => x.video === '1' && x.year === '2020'), `${prefix}: recording + year`);
    assert.match(page.url(), /year=2020/);

    await page.fill('#searchWebinars', 'zzzz-no-such-talk');
    assert.equal(await shown(page), 0, `${prefix}: search narrows further`);
    await page.fill('#searchWebinars', '');
    assert.deepEqual(await visible(page), both, `${prefix}: clearing search keeps the year and the box`);

    // A shared address restores the filter.
    const shared = page.url();
    const again = await browser.newPage();
    await again.goto(shared);
    assert.equal(await again.isChecked('#videoOnly'), true, `${prefix}: box restored`);
    assert.equal(await again.inputValue('#yearFilter'), '2020', `${prefix}: year restored`);
    assert.deepEqual(await visible(again), both);
    await again.close();

    // Old links named the year in the hash.
    const old = await browser.newPage();
    await old.goto(`${BASE}${prefix}/webinars/#2021`);
    const y2021 = await visible(old);
    assert.ok(y2021.length > 0 && y2021.every((x) => x.year === '2021'), `${prefix}: #2021 still works`);
    assert.equal(await old.inputValue('#yearFilter'), '2021');
    await old.close();

    assert.deepEqual(errors, [], `${prefix}: no console errors`);
    console.log(`ok ${prefix || '/'}webinars: ${total} total, ${withVideo.length} on the first recordings page, ${both.length} recorded in 2020`);
    await page.close();
  }
} finally {
  await browser.close();
}
