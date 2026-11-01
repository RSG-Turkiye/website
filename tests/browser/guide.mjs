/**
 * The graduate guide's pages in a real browser: search by topic in English
 * and Turkish, the programme box, an unknown window, the city filter, a
 * university page with and without programmes, and no sideways scroll, at
 * 1280x680, 1366x768, 1440x800, 1536x864, 1440x900, 1920x1080 and 390x844.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/guide.mjs
 *
 * The search index (/api/guide/index.json) is intercepted with invented
 * professors; the catalog is the real built one, so the university ids used
 * below must exist in src/content/guide-universities.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { if (!c) { console.log(`   ✗ ${m}`); bad.push(m); } else console.log(`   ✓ ${m}`); };

const catalog = await (await fetch(`${BASE}/guide/catalog.json`)).json();
const withProg = catalog.universities.find((u) => catalog.programmes.some((p) => p.universityId === u.id));
const withoutProg = catalog.universities.find((u) => !catalog.programmes.some((p) => p.universityId === u.id));
const otherCity = catalog.universities.find((u) => u.city !== withProg.city);
const prog = catalog.programmes.find((p) => p.universityId === withProg.id);

const INDEX = {
  generatedAt: new Date().toISOString(),
  labs: [{ id: 'l_000000000001', name: 'Örnek Yapısal Biyoinformatik Lab', universityId: withProg.id, url: 'https://example.org/lab' }],
  professors: [
    { id: 'p_000000000001', title: 'Doç. Dr.', name: 'Örnek Hoca A', universityId: withProg.id, department: 'Biyomühendislik', labId: 'l_000000000001', profileUrl: 'https://example.org/a', openalexId: null, topics: ['protein structure', 'docking'], programmeIds: [prog.id], checkedAt: '2026-11-01', source: 'https://example.org/a' },
    { id: 'p_000000000002', title: 'Dr. Öğr. Üyesi', name: 'Örnek Hoca B', universityId: otherCity.id, department: 'Biyoloji', labId: null, profileUrl: '', openalexId: null, topics: ['Sistem Biyolojisi'], programmeIds: [], checkedAt: '2026-11-01', source: '' },
    { id: 'p_000000000003', title: 'Prof. Dr.', name: 'Örnek Hoca C', universityId: withoutProg?.id ?? otherCity.id, department: 'Kimya', labId: null, profileUrl: '', openalexId: null, topics: ['metabolomics'], programmeIds: [], checkedAt: '2026-11-01', source: '' },
  ],
};

const SIZES = [[1280, 680], [1366, 768], [1440, 800], [1536, 864], [1440, 900], [1920, 1080], [390, 844]];
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function page(w, h) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.route('**/api/guide/index.json', (r) => r.fulfill({ json: INDEX }));
  await p.route('**/api/me', (r) => r.fulfill({ json: { user: null } }));
  return p;
}
const noSideways = (p) => p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

for (const [w, h] of SIZES) {
  console.log(`${w}x${h}`);
  const p = await page(w, h);
  await p.goto(`${BASE}/guide/`);
  await p.fill('[data-q]', 'protein structure');
  await p.waitForTimeout(300);
  const first = await p.locator('[data-results] li').first().innerText();
  ok(/Örnek Hoca A/.test(first), 'typing "protein structure" shows the tagged professor first');
  ok(first.includes(prog.name.en), 'the card names the programme to apply to');
  ok(await noSideways(p), 'no sideways scroll on the search page');
  if (w === 1280) {
    await p.fill('[data-q]', 'protein yapısı');
    await p.waitForTimeout(300);
    ok(/Örnek Hoca A/.test(await p.locator('[data-results]').innerText()), '"protein yapısı" finds the same professor');
    ok(/protein structure/.test(await p.locator('[data-also]').innerText()), 'the "also searched" line lists the English term');
    await p.fill('[data-q]', 'biyoloji');
    await p.waitForTimeout(300);
    const b = await p.locator('[data-results]').innerText();
    ok(/Örnek Hoca B/.test(b), '"biyoloji" finds "Sistem Biyolojisi"');
    ok(/which programme|No MSc programme found|programı bulunamadı/i.test(b) || b.includes(catalog.programmes.find((x) => x.universityId === otherCity.id)?.name.en ?? '§'), 'a professor with no programme id gets the fallback or the suggest line');
    await p.selectOption('[data-city]', withProg.city === otherCity.city ? '' : withProg.city);
    await p.waitForTimeout(200);
    ok(!/Örnek Hoca B/.test(await p.locator('[data-results]').innerText()), 'the city filter drops a professor in another city');
    await p.goto(`${BASE}/tr/guide/?q=protein%20yap%C4%B1s%C4%B1`);
    await p.waitForTimeout(400);
    const tr = await p.locator('[data-results]').innerText();
    ok(/Başvuru:/.test(tr) && /Örnek Hoca A/.test(tr), 'Turkish page renders Turkish labels and keeps the query from the address');
    await p.goto(`${BASE}/guide/${withProg.id}/`);
    await p.waitForTimeout(400);
    ok((await p.locator('h1').innerText()).includes(withProg.name.en), 'university page has its name');
    ok(/Örnek Hoca A/.test(await p.locator('[data-results]').innerText()), 'university page lists its professor from the index');
    if (withoutProg) {
      await p.goto(`${BASE}/guide/${withoutProg.id}/`);
      ok(/No MSc programme found/.test(await p.locator('main, body').first().innerText()), 'a university with no programme shows the suggest line');
    }
    await p.goto(`${BASE}/guide/universities/`);
    ok(await p.locator(`a[href="/guide/${withProg.id}/"]`).count() === 1, 'the university list links each university');
    ok(await noSideways(p), 'no sideways scroll on the university list');
  }
  await p.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} failed` : '\nall passed');
process.exit(bad.length ? 1 : 0);
