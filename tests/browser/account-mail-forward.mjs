/**
 * The four old mail URLs forward to the admin panel, in a real browser:
 * /account/mail and /account/conversations (and the /tr twins) each end on
 * the right #eposta hash, and show the moved note when scripts do not run.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/account-mail-forward.mjs
 *
 * Every API call is intercepted, so nothing is read or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const CASES = [
  ['/account/mail/', '/admin/', '#eposta/yaz', 'Mail has moved to the admin panel.'],
  ['/account/conversations/', '/admin/', '#eposta/gelen', 'Mail has moved to the admin panel.'],
  ['/tr/account/mail/', '/tr/admin/', '#eposta/yaz', 'E-posta yönetim paneline taşındı.'],
  ['/tr/account/conversations/', '/tr/admin/', '#eposta/gelen', 'E-posta yönetim paneline taşındı.'],
];

const browser = await chromium.launch();
for (const [from, path, hash, note] of CASES) {
  console.log(from);
  const page = await browser.newPage();
  page.on('pageerror', (e) => bad.push(`pageerror (${from}): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: null }) }));
  await page.goto(BASE + from, { waitUntil: 'commit' });
  await page.waitForURL((u) => u.pathname.startsWith(path.replace(/\/$/, '')), { timeout: 8000 }).catch(() => {});
  const u = new URL(page.url());
  ok(u.pathname.replace(/\/$/, '') === path.replace(/\/$/, ''), `ends on ${path} (${u.pathname})`);
  ok(u.hash === hash, `ends on ${hash} (${u.hash})`);
  await page.close();

  // With scripts off the page stays and shows a plain link to the same place.
  const ctx = await browser.newContext({ javaScriptEnabled: false });
  const p2 = await ctx.newPage();
  await p2.goto(BASE + from);
  ok((await p2.textContent('#mailMovedLink')).trim() === note, 'the moved note shows');
  ok((await p2.getAttribute('#mailMovedLink', 'href')).endsWith(hash), 'the link points at ' + hash);
  ok((await p2.locator('meta[name=robots][content*=noindex]').count()) === 1, 'the page is noindex');
  await ctx.close();
}
await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
