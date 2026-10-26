/**
 * The consent page of /oauth/authorize, in a real browser: rendered from
 * consentPage() with page.setContent (no server, no network), in English and
 * Turkish, at the six desktop sizes and at 390 px. For a member with five
 * areas and a very long app name, a member with two areas and a loopback
 * redirect, and the two "nothing to choose" states: nothing scrolls
 * sideways, nothing scrolls inside, every control is at least 44 px high,
 * the long name wraps instead of widening the page, and at 1280x680 the
 * loopback warning is on screen without scrolling when there are two areas.
 *
 * Not part of `npm test`: it needs Playwright.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/oauth-consent.mjs
 *
 * CHROME=<path to a Chrome binary> uses that browser instead of Playwright's own.
 * Node 24 or newer imports the TypeScript file directly.
 */
import { chromium } from 'playwright';
import { consentPage } from '../../functions/_lib/oauth-consent.ts';

const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const SIZES = [[1280, 680], [1366, 768], [1440, 800], [1536, 864], [1440, 900], [1920, 1080], [390, 844]];
const FIVE = ['cms.etkinlikler', 'cms.yazilar', 'cms.ogrenme', 'cms.topluluk', 'cms.sayfalar'];
const LONG_NAME = 'An Extremely Long Application Name That Keeps Going And Going ' + 'x'.repeat(40);
const FIELDS = [['response_type', 'code'], ['client_id', 'https://claude.example/oauth/client.json'], ['code_challenge_method', 'S256']];

const view = (lang, over) => ({
  lang, state: 'form', clientName: 'Claude', clientHost: 'claude.example', target: 'claude.example', warn: false,
  areas: FIVE.map((area, i) => ({ area, ticked: i < 2, level: i === 0 ? 'draft' : 'read' })),
  days: [7, 30, 90], defaultDays: 30, fields: FIELDS, langHref: '/oauth/authorize?rsg_lang=' + (lang === 'tr' ? 'en' : 'tr'),
  ...over,
});

const CASES = [
  ['five areas, a long app name', (lang) => view(lang, { clientName: LONG_NAME })],
  ['two areas, loopback warning', (lang) => view(lang, {
    clientName: 'Cursor', clientHost: null, warn: true, target: 'http://127.0.0.1:33418/oauth/callback/with/a/long/path/segment',
    areas: FIVE.slice(0, 2).map((area, i) => ({ area, ticked: i === 0, level: 'draft' })),
  })],
  ['two areas, custom scheme warning', (lang) => view(lang, {
    clientName: 'Editor', clientHost: null, warn: true, target: 'cursor://anysphere.cursor-retrieval/oauth/user-' + 'z'.repeat(50) + '/callback',
    areas: FIVE.slice(0, 2).map((area) => ({ area, ticked: false, level: 'draft' })),
  })],
  ['nothing to allow', (lang) => view(lang, { state: 'noAreas', areas: [] })],
  ['connection limit reached', (lang) => view(lang, { state: 'full' })],
];

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

/** What the page measures about itself, in the page. */
const measure = () => {
  const vw = innerWidth;
  const root = document.scrollingElement;
  const controls = [...document.querySelectorAll('button, select, a, input:not([type=hidden])')].map((el) => {
    // A checkbox is operated through its label: that is the target to measure.
    const target = el.type === 'checkbox' ? el.closest('label') ?? el : el;
    const r = target.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), text: (el.textContent || el.name || '').trim().slice(0, 30), h: Math.round(r.height) };
  });
  const inner = [...document.querySelectorAll('body *')].filter((el) => {
    if (el.tagName === 'SELECT') return false;
    const s = getComputedStyle(el);
    return /(auto|scroll)/.test(s.overflowY + s.overflowX) && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  }).map((el) => el.tagName.toLowerCase() + '.' + el.className);
  const wide = [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > vw + 0.5).map((el) => el.tagName.toLowerCase() + '.' + el.className);
  const warn = document.querySelector('.warn');
  const wr = warn?.getBoundingClientRect();
  return { sw: root.scrollWidth, iw: vw, controls, inner, wide, warn: wr ? { top: Math.round(wr.top), bottom: Math.round(wr.bottom) } : null, ih: innerHeight };
};

for (const lang of ['en', 'tr']) {
  for (const [name, make] of CASES) {
    console.log(`${lang}: ${name}`);
    for (const [width, height] of SIZES) {
      const at = `${width}x${height}`;
      const page = await browser.newPage({ viewport: { width, height } });
      page.on('pageerror', (e) => bad.push(`pageerror (${at}): ` + String(e).slice(0, 160)));
      await page.setContent(consentPage(make(lang)));
      const m = await page.evaluate(measure);
      ok(m.sw <= m.iw, `${at}: no sideways scroll (scrollWidth ${m.sw}, innerWidth ${m.iw})`);
      ok(m.wide.length === 0, `${at}: nothing sticks out of the viewport${m.wide.length ? ' (' + m.wide.slice(0, 3).join(', ') + ')' : ''}`);
      ok(m.inner.length === 0, `${at}: no inner scrollbar${m.inner.length ? ' (' + m.inner.join(', ') + ')' : ''}`);
      const small = m.controls.filter((c) => c.h < 44);
      ok(small.length === 0, `${at}: every control is at least 44 px high${small.length ? ' (' + small.map((c) => `${c.tag} "${c.text}" ${c.h}px`).join(', ') + ')' : ''}`);
      if (name === 'two areas, loopback warning' && width === 1280 && height === 680) {
        ok(m.warn && m.warn.top >= 0 && m.warn.bottom <= m.ih, `${at}: the warning is on screen without scrolling (${m.warn?.top}..${m.warn?.bottom} of ${m.ih})`);
      }
      if (name.includes('warning')) {
        const shown = await page.locator('.warn').isVisible();
        ok(shown, `${at}: the warning is shown`);
        ok(await page.locator('.uri').isVisible(), `${at}: the whole address is shown`);
      }
      await page.close();
    }
  }
}

await browser.close();
if (bad.length) { console.log(`\n${bad.length} failed`); process.exit(1); }
console.log('\nall passed');
