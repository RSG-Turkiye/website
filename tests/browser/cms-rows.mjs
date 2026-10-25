/**
 * Rows of an `objects` field (the panel CMS's lists of lists) in a real
 * browser: collapsed summaries, add, remove, up and down at three levels,
 * a pair type's rows staying aligned, fields shown by a choice, ids locked
 * once they hold a value, an error three lists down, and the phone width.
 *
 * No real type has an `objects` field yet, so this draws synthetic models
 * (tests/browser/fixtures/cms-rows-harness.ts, bundled here with esbuild)
 * with the panel's own renderer, inside the built panel's form box: the
 * real styles at the real width. Signed in as an editor, /api/* answered here.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/cms-rows.mjs
 */
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./fixtures/cms-rows-harness.ts', import.meta.url))],
  bundle: true, write: false, format: 'iife', target: 'es2022', logLevel: 'silent',
});
const HARNESS = bundle.outputFiles[0].text;

const USER = { id: 'u2', email: 'editor@example.org', grants: [{ role: 'content.etkinlikler.edit', expires_at: null }] };

async function open(browser, viewport, which = 'guide', lang = 'tr') {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", (e) => bad.push(`pageerror: ${String(e.stack ?? e).slice(0, 400)}`));
  await page.route('**/api/**', (r) => {
    const p = new URL(r.request().url()).pathname;
    const json = (v) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (p === '/api/me') return json({ user: USER, profile: {} });
    if (p === '/api/cms/types') return json({ types: [{ key: 'events', group: 'etkinlikler', label: { en: 'Events', tr: 'Etkinlikler' }, format: 'json', schema: {}, canApprove: false }] });
    if (p === '/api/cms/drafts') return json({ mine: [], queue: [], more: false, live: [], inflight: [] });
    if (p === '/api/cms/entries') return json({ type: 'events', entries: [] });
    if (p === '/api/admin/counts') return json({ cmsMine: 0, cmsTotal: 0 });
    if (p === '/api/admin/health') return json({ issues: [], canFix: false });
    return json({});
  });
  await page.goto(`${BASE}${lang === 'tr' ? '/tr' : ''}/admin#icerik/etkinlikler/_new`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#cmsFields [data-field-wrap]');
  await page.addScriptTag({ content: HARNESS });
  await page.evaluate((w) => window.harness.mount(w), which);
  return page;
}

const rowsOf = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} > [data-rows] > [data-orow]`)].map((r) => ({
  num: r.querySelector(':scope > summary > [data-row-num]').textContent.trim(),
  label: r.querySelector(':scope > summary > [data-row-label]').textContent.trim(),
  open: r.open,
})), sel);
const SECTIONS = '[data-field-wrap="sections"] [data-objects="sections"]';
const sectionRow = (i) => `${SECTIONS} > [data-rows] > [data-orow]:nth-child(${i})`;
const RES1 = `${sectionRow(1)} [data-objects="resources"]`;
const resRow = (i) => `${RES1} > [data-rows] > [data-orow]:nth-child(${i})`;

const browser = await chromium.launch({ ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });

console.log('1) collapsed rows: a number and a summary each');
{
  const page = await open(browser, { width: 1440, height: 900 });
  const rows = await rowsOf(page, SECTIONS);
  ok(rows.length === 2 && rows.every((r) => !r.open), `two section rows, closed (${JSON.stringify(rows)})`);
  ok(rows[0].num === 'Satır 1' && rows[0].label === 'basics', `"Satır 1 basics" (${rows[0].num} ${rows[0].label})`);
  ok(await page.locator(`${sectionRow(1)} [data-sub-wrap="heading"]`).isHidden(), 'a closed row\'s fields are not shown');

  console.log('2) open, move, add, remove three lists deep; the data follows');
  await page.click(`${sectionRow(1)} > summary`);
  ok(await page.locator(`${sectionRow(1)} [data-sub-wrap="heading"]`).first().isVisible(), 'opening a row shows its fields');
  const res = await rowsOf(page, RES1);
  ok(res.map((r) => r.num).join() === 'Bağlantı 1,Bağlantı 2', `resources named by their rowName (${res.map((r) => r.num)})`);
  await page.click(`${resRow(1)} > summary [data-row-move="1"]`);
  const data1 = await page.evaluate(() => window.harness.data());
  ok(data1.sections[0].resources.map((r) => r.id).join() === 'r-two,r-one', `↓ moved r-one down (${data1.sections[0].resources.map((r) => r.id)})`);
  ok((await rowsOf(page, RES1)).every((r) => !r.open), 'the ↓ in the summary line did not open the row');
  ok(await page.evaluate((s) => document.querySelector(s).open, sectionRow(1)), 'the outer row stays open');
  ok(await page.evaluate((s) => document.activeElement?.matches(`${s} > summary [data-row-move="1"]`) === false && document.activeElement?.closest('[data-orow]') !== null, resRow(2)), 'focus stays with the moved row');
  const up = await page.evaluate((s) => [...document.querySelectorAll(`${s} > [data-rows] > [data-orow] > summary [data-row-move]`)].map((b) => b.disabled), RES1);
  ok(JSON.stringify(up) === '[true,false,false,true]', `first ↑ and last ↓ disabled (${up})`);

  // Three deep: the moved r-one has a note; open it and add a note.
  await page.click(`${resRow(2)} > summary`);
  const NOTES = `${resRow(2)} [data-objects="notes"]`;
  await page.click(`${NOTES} > div > [data-row-add]`);
  const notes = await rowsOf(page, NOTES);
  ok(notes.length === 2 && notes[1].open && notes[1].num === 'Satır 2', `a new note row, open (${JSON.stringify(notes)})`);
  await page.fill(`${NOTES} > [data-rows] > [data-orow]:nth-child(2) [data-sub-wrap="url"] input`, 'https://example.org/new');
  await page.fill(`${NOTES} > [data-rows] > [data-orow]:nth-child(2) [data-sub-wrap="text"] input[data-lang="tr"]`, 'Yeni not');
  const notes2 = await rowsOf(page, NOTES);
  ok(notes2[1].label === 'Yeni not', `typing updates the summary (${notes2[1].label})`);
  const data2 = await page.evaluate(() => window.harness.data());
  ok(JSON.stringify(data2.sections[0].resources[1].notes[1]) === JSON.stringify({ text: { en: '', tr: 'Yeni not' }, url: 'https://example.org/new' }), `the new note is in the data, keys in order (${JSON.stringify(data2.sections[0].resources[1].notes[1])})`);
  // Çıkar is inside the opened row, away from the summary line.
  await page.click(`${NOTES} > [data-rows] > [data-orow]:nth-child(1) > summary`);
  await page.click(`${NOTES} > [data-rows] > [data-orow]:nth-child(1) [data-row-remove]`);
  ok((await rowsOf(page, NOTES)).map((r) => r.num).join() === 'Satır 1', 'removing renumbers');
  const data3 = await page.evaluate(() => window.harness.data());
  ok(data3.sections[0].resources[1].notes.length === 1 && data3.sections[0].resources[1].notes[0].url === 'https://example.org/new', 'the first note is gone from the data');
  ok(data3.sections[1].name === 'next' && data3.title.tr === 'Rehber', 'nothing else moved');

  console.log('3) ids: locked once they hold a value, editable on a new row');
  ok(await page.locator(`${resRow(1)} [data-sub-wrap="id"] fieldset`).evaluate((e) => e.disabled), 'a saved row\'s id is read-only');
  ok(await page.locator(`${resRow(1)} [data-sub-wrap="id"]`).evaluate((e) => /Kaydedildikten sonra değişmez/.test(e.textContent)), 'and says why');
  await page.click(`${RES1} > div > [data-row-add]`);
  const NEW = `${RES1} > [data-rows] > [data-orow]:nth-child(3)`;
  ok(!(await page.locator(`${NEW} [data-sub-wrap="id"] fieldset`).evaluate((e) => e.disabled)), 'a new row\'s id is editable');

  console.log('4) a field shown by a choice keeps its value while hidden');
  ok(await page.locator(`${NEW} [data-sub-wrap="speaker"]`).isHidden(), 'speaker hidden until the series is student');
  await page.selectOption(`${NEW} [data-sub-wrap="kind"] select`, 'student');
  ok(await page.locator(`${NEW} [data-sub-wrap="speaker"]`).isVisible(), 'choosing student shows it');
  await page.fill(`${NEW} [data-sub-wrap="speaker"] input`, 'Ada');
  await page.selectOption(`${NEW} [data-sub-wrap="kind"] select`, 'bioinfonet');
  ok(await page.locator(`${NEW} [data-sub-wrap="speaker"]`).isHidden(), 'another choice hides it');
  const d4 = await page.evaluate(() => window.harness.data());
  ok(d4.sections[0].resources[2].speaker === 'Ada', 'its value is kept');

  console.log('5) an error three lists down: its words, and the control, every row on the way opened');
  await page.evaluate(() => document.querySelectorAll('[data-orow]').forEach((d) => { d.open = false; }));
  const e = await page.evaluate(() => window.harness.error('sections.0.resources.1.notes.0.text.tr'));
  ok(e.label === 'Satır 1 › Bağlantı 2 › Satır 1 › Açıklama', `"${e.label}"`);
  ok(e.found && e.visible && e.lang === 'tr', `the Turkish control is found and visible (${JSON.stringify(e)})`);
  ok(await page.evaluate(() => document.activeElement?.getAttribute('data-lang') === 'tr'), 'and focused');
  await page.close();
}

console.log('6) a pair type: per-language and shared fields; sides that differ stay different; a short side stays short');
{
  const page = await open(browser, { width: 1440, height: 900 }, 'path');
  const LIST = '[data-objects="resources"]';
  const R = (i) => `${LIST} > [data-rows] > [data-orow]:nth-child(${i})`;
  ok((await rowsOf(page, LIST)).length === 3, 'three rows: the longer side\'s count');
  await page.click(`${R(1)} > summary`);
  await page.click(`${R(2)} > summary`);
  ok(await page.locator(`${R(2)} [data-sub-wrap="title"] input[data-lang="en"]`).count() === 1 && await page.locator(`${R(2)} [data-sub-wrap="title"] input[data-lang="tr"]`).count() === 1, 'a per-language field has two controls');
  ok(await page.locator(`${R(2)} [data-sub-wrap="url"] input`).count() === 1, 'a shared field whose sides agree has one');
  const split = await page.locator(`${R(1)} [data-sub-wrap="url"] input`).evaluateAll((els) => els.map((e) => [e.dataset.lang, e.value]));
  ok(JSON.stringify(split) === JSON.stringify([['en', 'https://a'], ['tr', '/tr/a']]), `a shared field whose sides differ shows both (${JSON.stringify(split)})`);
  await page.fill(`${R(2)} [data-sub-wrap="url"] input`, 'https://b2');
  await page.click(`${R(2)} [data-sub-wrap="tags"] [data-add]`);
  await page.fill(`${R(2)} [data-sub-wrap="tags"] input[data-item]`, 'y');
  await page.click(`${R(2)} > summary [data-row-move="-1"]`);
  await page.click(`${LIST} > div > [data-row-add]`);
  const d = await page.evaluate(() => window.harness.data());
  const ids = (l) => d[l].frontmatter.resources.map((r) => r.id ?? '·').join();
  ok(ids('en') === 'b-2,a-1,·', `English: moved and added, and no Turkish-only row (${ids('en')})`);
  ok(ids('tr') === 'b-2,a-1,c-3,·', `Turkish: moved and added, its own row kept (${ids('tr')})`);
  ok(d.en.frontmatter.resources[0].url === 'https://b2' && d.tr.frontmatter.resources[0].url === 'https://b2', 'an edited shared value is written to both sides');
  ok(d.en.frontmatter.resources[1].url === 'https://a' && d.tr.frontmatter.resources[1].url === '/tr/a', 'a split value keeps each side\'s own');
  ok(d.tr.frontmatter.resources[0].title === 'Beta TR' && d.en.frontmatter.resources[0].title === 'Beta', 'per-language values stay on their side');
  ok(JSON.stringify(d.en.frontmatter.resources[0].tags) === '["y"]' && JSON.stringify(d.tr.frontmatter.resources[0].tags) === '["y"]', 'a list inside a row works, on both sides');
  await page.close();
}

console.log('8) the real editor: edit inside a row, save, edit another field, save again: the file keeps what the form does not show');
for (const [type, data, check] of [
  ['guide', {
    title: { en: 'Guide', tr: 'Rehber' },
    sections: [{ name: 'basics', heading: { en: 'Basics', tr: 'Temeller' }, resources: [
      { id: 'r-one', title: { en: 'One', tr: 'Bir' }, kind: 'bioinfonet', notes: [{ text: { en: 'n1', tr: 'n1' }, url: 'https://n1', extra: 'keep-1' }, { text: { en: 'n2', tr: 'n2' }, extra: 'keep-2' }] },
    ] }],
  }, (d) => {
    const notes = d.sections[0].resources[0].notes;
    return JSON.stringify(notes) === JSON.stringify([{ text: { en: 'n1', tr: 'n1' }, url: 'https://n1-edited', extra: 'keep-1' }, { text: { en: 'n2', tr: 'n2' }, extra: 'keep-2' }]) && d.title.en === 'Guide 2';
  }],
  ['path', {
    en: { frontmatter: { title: 'Path', resources: [{ id: 'a-1', title: 'Alpha', url: 'https://a', x: 'ea' }] }, body: '\n' },
    tr: { frontmatter: { title: 'Yol', resources: [{ id: 'a-1', title: 'Alfa', url: 'https://a', x: 'ta' }, { id: 'c-3', title: 'Gama', url: '/tr/c', x: 'tc' }] }, body: '\n' },
  }, (d) => JSON.stringify(d.en.frontmatter.resources) === JSON.stringify([{ id: 'a-1', title: 'Alpha', url: 'https://a-edited', x: 'ea' }])
    && JSON.stringify(d.tr.frontmatter.resources) === JSON.stringify([{ id: 'a-1', title: 'Alfa', url: 'https://a-edited', x: 'ta' }, { id: 'c-3', title: 'Gama', url: '/tr/c', x: 'tc' }])
    && d.en.frontmatter.title === 'Path 2'],
]) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', (e) => bad.push(`pageerror: ${String(e.stack ?? e).slice(0, 400)}`));
  const id = '00000000-0000-4000-8000-000000000901';
  const d = { id, type, entry_id: `${type}-1`, action: 'update', status: 'draft', author_id: 'u2', author_name: 'Editör', reviewer_id: null, review_note: null, pr_url: null, pr_number: null,
    failure: null, stale_merge: false, created_at: 1, updated_at: 1, write_nonce: 'n0', data, base_shas: { x: 'sha' } };
  const saved = [];
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const p = new URL(req.url()).pathname;
    const json = (v) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    if (p === '/api/me') return json({ user: USER, profile: {} });
    if (p === '/api/cms/types') return json({ types: [{ key: 'events', group: 'etkinlikler', label: { en: 'Events', tr: 'Etkinlikler' }, format: 'json', schema: {}, canApprove: false }] });
    if (p === `/api/cms/drafts/${id}` && req.method() === 'GET') return json({ draft: d, files: null });
    if (p === `/api/cms/drafts/${id}` && req.method() === 'PATCH') {
      const body = JSON.parse(req.postData());
      d.data = body.data; d.write_nonce = `n${saved.length + 1}`; saved.push(body.data);
      return json({ draft: d });
    }
    if (p === '/api/cms/drafts') return json({ mine: [d], queue: [], more: false, live: [], inflight: [] });
    if (p === '/api/cms/entries') return json({ type, entries: [] });
    if (p === '/api/admin/counts') return json({ cmsMine: 1, cmsTotal: 1 });
    if (p === '/api/admin/health') return json({ issues: [], canFix: false });
    return json({});
  });
  await page.goto(`${BASE}/tr/admin#icerik/taslaklar`, { waitUntil: 'networkidle' });
  await page.addScriptTag({ content: HARNESS });
  await page.evaluate((h) => { location.hash = h; }, `#icerik/taslaklar/${id}`);
  await page.waitForSelector('#cmsFields [data-objects]');
  // Open every row, edit a url inside a row, save.
  await page.evaluate(() => document.querySelectorAll('#cmsFields [data-orow]').forEach((x) => { x.open = true; }));
  if (type === 'guide') await page.fill('[data-objects="notes"] > [data-rows] > [data-orow]:nth-child(1) [data-sub-wrap="url"] input', 'https://n1-edited');
  else await page.fill('[data-objects="resources"] > [data-rows] > [data-orow]:nth-child(1) [data-sub-wrap="url"] input', 'https://a-edited');
  await page.click('#cmsSave');
  await page.waitForFunction(() => /Kaydedildi/.test(document.getElementById('cmsSaveState')?.textContent ?? ''), null, { timeout: 5000 }).catch(() => {});
  // Another field, another save.
  if (type === 'guide') await page.fill('[data-field-wrap="title"] input[data-lang="en"]', 'Guide 2');
  else await page.fill('[data-field-wrap="title"] input[data-lang="en"]', 'Path 2');
  await page.click('#cmsSave');
  await page.waitForTimeout(500);
  ok(saved.length >= 2, `${type}: two saves sent (${saved.length})`);
  ok(saved.length >= 2 && check(saved.at(-1)), `${type}: the second save keeps every hidden key and adds no row (${JSON.stringify(saved.at(-1)).slice(0, 400)})`);
  await page.close();
}

console.log('7) phone (390 px) and the six desktop sizes: three levels open, nothing sideways, no inner scrollbars, 44 px buttons on the phone');
for (const [w, h] of [[390, 844], [1280, 680], [1366, 768], [1440, 800], [1536, 864], [1440, 900], [1920, 1080]]) {
  for (const lang of ['tr', 'en']) {
    const page = await open(browser, { width: w, height: h }, 'guide', lang);
    await page.evaluate(() => document.querySelectorAll('[data-orow]').forEach((d) => { d.open = true; }));
    // A row added at the deepest level too, so every kind of control is on the page.
    await page.click(`${resRow(1)} [data-objects="notes"] > div > [data-row-add]`);
    const r = await page.evaluate(() => {
      const root = document.getElementById('harness');
      const vw = document.documentElement.clientWidth;
      const wide = [...root.querySelectorAll('*')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > vw + 0.5).map((e) => e.tagName + (e.className ? '.' + String(e.className).split(' ')[0] : ''));
      const inner = [...document.querySelectorAll('#cmsFields *')].filter((e) => {
        const s = getComputedStyle(e);
        return (/(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && e.scrollWidth > e.clientWidth + 1);
      }).map((e) => e.tagName);
      const small = [...root.querySelectorAll('[data-row-move], [data-row-remove], [data-row-add], [data-orow] > summary')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).length;
      const depth = Math.max(...[...root.querySelectorAll('[data-orow]')].map((e) => { let n = 0; for (let x = e; x; x = x.parentElement?.closest('[data-orow]')) n++; return n; }));
      return { side: document.documentElement.scrollWidth > innerWidth, wide: wide.slice(0, 5), inner, small, depth };
    });
    ok(!r.side && r.wide.length === 0, `${w}×${h} ${lang}: nothing wider than the window (${r.wide.join(' ')})`);
    ok(r.inner.length === 0, `${w}×${h} ${lang}: no inner scrollbars (${r.inner.join(' ')})`);
    ok(r.depth === 3, `${w}×${h} ${lang}: three levels of rows open (${r.depth})`);
    if (w < 1024) ok(r.small === 0, `${w}×${h} ${lang}: row buttons and summary lines are at least 44 px tall (${r.small} smaller)`);
    if (w === 390 && lang === 'tr' && process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
    await page.close();
  }
}

await browser.close();
if (bad.length) { console.log(`\n${bad.length} FAILED:\n - ${bad.join('\n - ')}`); process.exit(1); }
console.log('\nALL PASSED');
