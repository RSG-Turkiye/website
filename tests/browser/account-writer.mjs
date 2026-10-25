/**
 * /account's blog card, signed in: blog posts are written in the panel CMS,
 * so the card is a link to İçerik › Blog, shown to whoever may edit the
 * Yazılar group (its editors, its approvers, admins) and to nobody else.
 * The old submission form is gone and nothing calls its endpoints.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/account-writer.mjs
 *
 * Every API call is intercepted, so nothing is read or stored. SHOTS=<dir>
 * also saves a screenshot of each language at 1366x768 and 390 px.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const SHOTS = process.env.SHOTS;
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const NOW = Math.floor(Date.now() / 1000);
const me = (user) => ({
  user: {
    id: 'u1', email: 'member@example.org', is_member: true, is_admin: false, is_announcer: false, is_sender: false,
    is_symposium: false, is_social: false, is_social_publisher: false, grants: [], ...user,
  },
  profile: { user_id: 'u1', display_name: 'Deneme Üye', username: 'deneme', institution: null, bio: null, avatar_url: null },
  badges: [], interests: [], rank: 'seed', achievement_badges: [],
});
const grant = (role) => ({ role, expires_at: NOW + 20 * 86400 });

const PEOPLE = [
  ['a Yazılar editor', me({ grants: [grant('content.yazilar.edit')] }), true],
  ['a Yazılar approver', me({ grants: [grant('content.yazilar.approve')] }), true],
  ['an admin with no grants', me({ is_admin: true }), true],
  ['an Etkinlikler editor', me({ grants: [grant('content.etkinlikler.edit')] }), false],
  ['a member with the retired writer flag only', me({ is_writer: true, grants: [] }), false],
];
const LANGS = [
  { prefix: '', href: '/admin#icerik/blog', title: 'Write a blog post', open: 'Open' },
  { prefix: '/tr', href: '/tr/admin#icerik/blog', title: 'Blog yazısı yaz', open: 'Aç' },
];
const SIZES = [[1280, 680], [1366, 768], [1440, 800], [1536, 864], [1440, 900], [1920, 1080], [390, 844]];

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function open(lang, body, size = [1366, 768]) {
  const page = await browser.newPage({ viewport: { width: size[0], height: size[1] } });
  const calls = [];
  page.on('pageerror', (e) => bad.push(`pageerror (${page.url()}): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    calls.push(path);
    if (path === '/api/me') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
    return r.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.goto(`${BASE}${lang.prefix}/account/`);
  await page.waitForSelector('#profileContent:not(.hidden)', { timeout: 8000 });
  await page.waitForTimeout(150);
  return { page, calls };
}

for (const lang of LANGS) {
  console.log(`${lang.prefix || '/'}account/`);
  for (const [who, body, shown] of PEOPLE) {
    const { page, calls } = await open(lang, body);
    const card = page.locator('#writerCard');
    ok(await card.isVisible() === shown, `${who}: the card is ${shown ? 'shown' : 'hidden'}`);
    if (shown) {
      ok((await card.locator('h2').textContent()).trim() === lang.title, `${who}: titled "${lang.title}"`);
      const link = card.locator('a');
      ok(await link.getAttribute('href') === lang.href, `${who}: opens ${lang.href}`);
      ok((await link.textContent()).trim() === lang.open, `${who}: the button reads "${lang.open}"`);
    }
    ok(await page.locator('#submissionForm, #submissionsList, #subBody').count() === 0, `${who}: no submission form`);
    ok(!calls.some((p) => p.startsWith('/api/blog-submissions')), `${who}: no call to the old endpoints (${calls.join(', ')})`);
    await page.close();
  }

  // The editor's card at every window size: no horizontal scroll, the button inside the card.
  for (const size of SIZES) {
    const { page } = await open(lang, PEOPLE[0][1], size);
    const fit = await page.evaluate(() => {
      const card = document.getElementById('writerCard').getBoundingClientRect();
      const btn = document.querySelector('#writerCard a').getBoundingClientRect();
      return {
        scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        inside: btn.left >= card.left && btn.right <= card.right && btn.top >= card.top && btn.bottom <= card.bottom,
      };
    });
    ok(fit.scroll && fit.inside, `${size.join('x')}: no horizontal scroll, the button sits inside the card`);
    if (SHOTS && (size[0] === 1366 || size[0] === 390)) {
      await page.locator('#writerCard').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOTS}/account-writer${lang.prefix.replace('/', '-')}-${size.join('x')}.png` });
    }
    await page.close();
  }
}

// Following the card's link lands on the admin panel's Blog tab address.
{
  const { page } = await open(LANGS[0], PEOPLE[0][1]);
  // The panel itself is not under test here (its own checks mock its APIs).
  await page.route((u) => u.pathname.startsWith('/admin'), (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>admin</title>' }));
  await page.locator('#writerCard a').click();
  await page.waitForURL((u) => u.pathname.startsWith('/admin'), { timeout: 8000 }).catch(() => {});
  const u = new URL(page.url());
  ok(u.pathname.replace(/\/$/, '') === '/admin' && u.hash === '#icerik/blog', `the link lands on /admin#icerik/blog (${u.pathname}${u.hash})`);
  await page.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
