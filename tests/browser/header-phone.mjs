/**
 * The header on a phone, signed in and signed out. Below lg the account
 * button lives in the opened menu; shown in the top bar it pushed the menu
 * button past the right edge of a signed-in phone (17 px at 390). The
 * phone menu's Join button is for non-members only, as on a wide screen.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/header-phone.mjs
 *
 * /api/me is intercepted, so nothing is read or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const member = {
  user: { id: 'u1', email: 'member@example.org', is_member: true, is_admin: false, grants: [] },
  profile: { user_id: 'u1', display_name: 'Deneme Üye Uzunisim', username: 'deneme', avatar_url: null },
  badges: [], interests: [], rank: 'seed', achievement_badges: [],
};
const PEOPLE = [['signed in', member], ['signed out', { user: null }]];
const SIZES = [[360, 740], [390, 844], [768, 1024], [1280, 680]];

const browser = await chromium.launch();
for (const [who, body] of PEOPLE) {
  for (const path of ['/', '/tr/']) {
    for (const [w, h] of SIZES) {
      const ctx = await browser.newContext({ viewport: { width: w, height: h } });
      // The header asks /api/me only when this marker says a session may exist.
      if (body.user) await ctx.addCookies([{ name: 'rsg_signed_in', value: '1', url: BASE }]);
      const page = await ctx.newPage();
      await page.route('**/api/me', (r) => r.fulfill({ json: body }));
      await page.goto(BASE + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const btn = document.getElementById('mobileMenuBtn');
        const auth = document.getElementById('authArea');
        const b = btn.getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth - innerWidth,
          btnShown: getComputedStyle(btn).display !== 'none',
          btnRight: b.right,
          authShown: getComputedStyle(auth).display !== 'none' && auth.innerHTML !== '',
          joinInMenu: getComputedStyle(document.getElementById('joinMobileLink')).display !== 'none',
        };
      });
      const label = `${who} ${path} ${w}x${h}`;
      ok(r.overflow <= 0, `${label}: no horizontal scroll (${r.overflow}px)`);
      if (r.btnShown) ok(r.btnRight <= w, `${label}: menu button inside the screen (right ${Math.round(r.btnRight)})`);
      ok(r.authShown === (w >= 1024), `${label}: account area in the top bar only at lg`);
      ok(r.joinInMenu === !body.user?.is_member, `${label}: phone menu offers Join only to a non-member`);
      await ctx.close();
    }
  }
}
await browser.close();
if (bad.length) { console.error(`\n${bad.length} failed`); process.exit(1); }
console.log('\nall passed');
