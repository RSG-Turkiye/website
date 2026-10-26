/**
 * The free-tier usage lines in Overview's System block, signed in as an
 * admin, in a real browser: today's numbers, "not set up", and a failed
 * check (with its reason for an admin), in English and Turkish, at
 * 1280x680, 1366x768, 1440x800, 1536x864, 1440x900, 1920x1080 and 390x844. The lines must be there, the page must not
 * scroll sideways, and nothing around the block may become its own scroll box.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-usage.mjs
 *
 * BASE defaults to http://localhost:4329. Without Playwright's own browser,
 * CHROME=<path to a Chromium or headless shell> points it at another one.
 *
 * Every API call is intercepted, so nothing is read or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { if (!c) { console.log(`   ✗ ${m}`); bad.push(m); } else console.log(`   ✓ ${m}`); };

const ADMIN = { id: 'u1', email: 'admin@example.org', is_admin: true, is_social_publisher: true, is_symposium: true, is_announcer: true };
const now = Math.floor(Date.now() / 1000);
const today = new Date().toISOString().slice(0, 10);
const LIMITS = { requests: 100000, rowsRead: 5000000, rowsWritten: 100000, agentRequests: 15000, agentWrites: 2000 };
const base = { configured: true, checkedAt: now - 600, measuredAt: now - 600, day: today, requests: 42000, rowsRead: 3600000, rowsWritten: 20000, failed: false, error: null, agentRequests: 12, agentWrites: 4, limits: LIMITS,
  parts: { workers: [{ name: 'mail-dispatch', requests: 1200 }], pages: 40800 } };

const STATES = {
  numbers: {
    usage: base,
    en: [/Worker requests: 42,000 of 100,000 \(42%\)/, /D1 rows read: 3,600,000 of 5,000,000 \(72%\)/, /Agent writes: 4 of 2,000/, /Measured at/, /by script: mail-dispatch 1,200\. Pages Functions: 40,800/],
    tr: [/Worker istekleri: 42\.000 \/ 100\.000 \(%42\)/, /itibarıyla/, /Pages Functions: 40\.800/],
    bold: /D1 rows read|D1 okunan satır/,
  },
  notConfigured: {
    usage: { ...base, configured: false, checkedAt: null, measuredAt: null, day: null, requests: null, rowsRead: null, rowsWritten: null },
    en: [/CF_ANALYTICS_TOKEN is not set/, /Agent requests: 12 of 15,000/],
    tr: [/CF_ANALYTICS_TOKEN girilmemiş/],
    absent: /Worker requests|Worker istekleri/,
  },
  partial: {
    usage: { ...base, failed: true, error: 'pages: Cannot query field', requests: null, parts: { workers: [{ name: 'mail-dispatch', requests: 1200 }], pages: null } },
    en: [/D1 rows read: 3,600,000 of 5,000,000/, /failed: pages: Cannot query field/],
    tr: [/D1 okunan satır: 3\.600\.000 \/ 5\.000\.000/],
    absent: /Worker requests:|Worker istekleri:|Everything is working|Her şey çalışıyor/,
  },
  failed: {
    usage: { ...base, failed: true, error: 'Cannot query field "pagesFunctionsInvocationsAdaptiveGroups" on type "account".', day: null, measuredAt: null, requests: null, rowsRead: null, rowsWritten: null },
    en: [/failed: Cannot query field/, /Agent requests/],
    tr: [/kontrolü başarısız: Cannot query field/],
    absent: /Worker requests|Worker istekleri|Not measured yet today/,
  },
};
const VIEWPORTS = [[1280, 680], [1366, 768], [1440, 800], [1536, 864], [1440, 900], [1920, 1080], [390, 844]].map(([width, height]) => ({ width, height }));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function open(lang, viewport, usage) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push(`pageerror (${lang} ${viewport.width}px): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (req.method() !== 'GET') return r.fulfill({ status: 204, body: '' });
    if (url.pathname === '/api/me') return json({ user: ADMIN, profile: {} });
    if (url.pathname === '/api/admin/counts') return json({});
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: true, usage });
    // Every other list the shell loads alongside Overview, empty.
    return json({ types: [], announcements: [], users: [], badge_catalog: [], senders: [], attachments: [], sends: [], scheduled: [], connections: [], submissions: [], rows: [], items: [], hasMore: false, year: 2026, edition: {}, certificates: [], totalBytes: 0 });
  });
  await page.goto(`${BASE}${lang === 'tr' ? '/tr' : ''}/admin#genel`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  await page.waitForFunction(() => (document.getElementById('overviewHealth')?.innerText ?? '').length > 0);
  return page;
}

for (const [name, s] of Object.entries(STATES)) {
  for (const lang of ['en', 'tr']) {
    for (const viewport of VIEWPORTS) {
      const tag = `${name} ${lang} ${viewport.width}x${viewport.height}`;
      console.log(tag);
      const page = await open(lang, viewport, s.usage);
      const text = (await page.locator('#overviewHealth').innerText()).replace(/\s+/g, ' ');
      for (const re of [...(lang === 'en' ? s.en : s.tr)]) ok(re.test(text), `${tag}: shows ${re}`);
      if (s.absent) ok(!s.absent.test(text), `${tag}: does not show ${s.absent}`);
      if (s.bold) {
        const bold = await page.locator('#overviewHealth p.font-semibold').allInnerTexts();
        ok(bold.length === 1 && s.bold.test(bold[0]), `${tag}: only the line past 70% is bold (${bold.join(' | ')})`);
      }
      const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: innerWidth }));
      ok(sw.s <= sw.w, `${tag}: no sideways scroll (scrollWidth ${sw.s}, viewport ${sw.w})`);
      const boxes = await page.evaluate(() => {
        const out = [];
        for (let el = document.getElementById('overviewHealth'); el && el !== document.body; el = el.parentElement) {
          const cs = getComputedStyle(el);
          const scrolls = (v) => v === 'auto' || v === 'scroll';
          if ((scrolls(cs.overflowY) && el.scrollHeight > el.clientHeight + 1) || (scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 1)) out.push(el.id || el.className.slice(0, 60));
        }
        return out;
      });
      ok(boxes.length === 0, `${tag}: no inner scrollbar around the block${boxes.length ? ` (${boxes.join(' | ')})` : ''}`);
      if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/usage-${name}-${lang}-${viewport.width}.png`, fullPage: false });
      await page.close();
    }
  }
}

await browser.close();
if (bad.length) {
  for (const b of bad) console.log(`   ✗ ${b}`);
  console.log(`\n${bad.length} problem(s)`);
  process.exit(1);
}
console.log('\nall good');
