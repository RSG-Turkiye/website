/**
 * The admin panel's shell, in a real browser: grouped menu, the route kept
 * in the address, the phone drawer and the phone's list-then-page
 * sub-navigation, and the return from an OAuth connect.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-shell.mjs
 *
 * Every API call is intercepted, so nothing is read or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const ADMIN = { id: 'u1', email: 'admin@example.org', is_admin: true };
const SOCIAL = { id: 'u2', email: 'social@example.org', is_social: true };
const COUNTS = { email: 3, social: 2, blog: 1, scheduledThisWeek: 4 };
// One body that satisfies every list the panel reads on load.
const EMPTY = {
  users: [], badge_catalog: [], announcements: [], submissions: [], senders: [], attachments: [], sends: [],
  connections: [], rows: [], hasMore: false, year: 2026, edition: {}, items: [], certificates: [], totalBytes: 0,
  posts: [], plans: [], modes: [], editors: [],
};

const browser = await chromium.launch();

async function open(user, viewport, path = '/admin') {
  const page = await browser.newPage({ viewport });
  const views = [];
  page.on('pageerror', (e) => bad.push(`pageerror (${user.email} ${viewport.width}px): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (req.method() !== 'GET') {
      if (url.pathname === '/api/audit/view') views.push(req.postDataJSON()?.pane);
      return r.fulfill({ status: 204, body: '' });
    }
    if (url.pathname === '/api/me') return json({ user, profile: {} });
    if (url.pathname === '/api/admin/counts') return json(COUNTS);
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: !!user.is_admin });
    return json(EMPTY);
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return { page, views };
}

const hash = (page) => page.evaluate(() => location.hash);
// The address changes before the hashchange handler runs: wait until the
// menu marks the section and exactly the addressed sub-page (or none) shows.
const waitHash = (page, h) => page.waitForFunction((x) => {
  const [section, sub] = x.slice(1).split('/');
  if (location.hash !== x) return false;
  if (document.querySelector('[data-nav][aria-current="page"]')?.dataset.nav !== section) return false;
  const shown = [...document.querySelectorAll(`[data-section="${section}"] [data-sub]`)].filter((el) => !el.classList.contains('hidden')).map((el) => el.dataset.sub);
  return sub ? shown.length === 1 && shown[0] === sub : shown.length === 0;
}, h, { timeout: 5000 }).catch(() => {});
const visible = (page, sel) => page.locator(sel).first().isVisible();
const fits = async (page, w) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= w;

console.log('1) admin, 1280 px');
{
  const { page, views } = await open(ADMIN, { width: 1280, height: 900 });
  ok(await hash(page) === '#genel', `lands on #genel (got ${await hash(page)})`);
  ok(await page.locator('#sectionNav [data-nav-group]').count() === 4, 'menu shows the four group headings');
  const email = page.locator('#sectionNav [data-count="email"]');
  ok(await email.isVisible() && (await email.textContent()) === '3', 'E-posta carries the count 3');
  await page.waitForSelector('#overviewHealth p');
  ok((await page.textContent('#overview')).includes('3'), 'Overview lists the waiting e-mail');
  await page.click('#sectionNav [data-nav="sempozyum"]');
  await waitHash(page, '#sempozyum/baski');
  ok(await hash(page) === '#sempozyum/baski', `Sempozyum opens #sempozyum/baski (got ${await hash(page)})`);
  ok(await page.locator('#subNav [role="tab"]').count() === 5, 'five sub-tabs');
  await page.click('#subNav [data-sub-link="komite"]');
  await waitHash(page, '#sempozyum/komite');
  ok(await hash(page) === '#sempozyum/komite', 'Komite makes it #sempozyum/komite');
  ok(await visible(page, '[data-sub="komite"]') && !(await visible(page, '[data-sub="baski"]')), 'only the committee sub-page shows');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  ok(await hash(page) === '#sempozyum/komite', 'reload keeps #sempozyum/komite');
  ok(await visible(page, '[data-sub="komite"]'), 'committee still shown after reload');
  await page.goBack();
  await waitHash(page, '#sempozyum/baski');
  ok(await hash(page) === '#sempozyum/baski', `back returns to #sempozyum/baski (got ${await hash(page)})`);
  ok(await visible(page, '[data-sub="baski"]'), 'edition sub-page shown after back');
  ok(views.length > 0 && views.every((v) => /^[a-z][a-z-]{0,39}$/.test(v)), `every view is audited with a valid id (${[...new Set(views)].join(', ')})`);
  ok(await fits(page, 1280), 'no horizontal scroll at 1280 px');
  await page.close();
}

console.log('2) social-only user');
{
  const { page } = await open(SOCIAL, { width: 1280, height: 900 });
  ok(await hash(page) === '#sosyal/takvim', `lands on #sosyal/takvim (got ${await hash(page)})`);
  ok(await page.locator('[data-nav="genel"]').count() === 0, 'no Overview link');
  const groups = await page.locator('#sectionNav [data-nav-group]').evaluateAll((els) => els.map((e) => e.dataset.navGroup));
  ok(groups.length === 1 && groups[0] === 'iletisim', `only the İletişim group (got ${groups.join(', ')})`);
  ok(await page.locator('[data-sub="onay"]').count() === 0, 'no approval sub-page for a non-publisher');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  ok(!(await page.locator('#navToggle').isVisible()), 'no ☰ at 390 px');
  ok(await fits(page, 390), 'no horizontal scroll at 390 px');
  await page.close();
}

console.log('3) admin, 390 px');
{
  const { page } = await open(ADMIN, { width: 390, height: 844 });
  ok(await hash(page) === '#genel', `lands on #genel (got ${await hash(page)})`);
  ok(await page.locator('#navToggle').isVisible(), '☰ is shown');
  await page.click('#navToggle');
  ok(await page.locator('#navDrawer').isVisible(), '☰ opens the drawer');
  ok((await page.locator('#drawerNav [data-count="email"]').textContent()) === '3', 'the drawer carries the counts too');
  await page.click('#drawerNav [data-nav="eposta"]');
  await waitHash(page, '#eposta');
  ok(await hash(page) === '#eposta', `E-posta opens its list (got ${await hash(page)})`);
  ok(!(await page.locator('#navDrawer').isVisible()), 'the drawer closes');
  ok(await page.locator('#subNav a').count() === 4, 'four list rows');
  ok(!(await visible(page, '[data-sub="ekler"]')), 'no sub-page under the list');
  ok(await fits(page, 390), 'no horizontal scroll on the list');
  await page.click('#subNav [data-sub-link="ekler"]');
  await waitHash(page, '#eposta/ekler');
  ok(await hash(page) === '#eposta/ekler', 'Ekler opens #eposta/ekler');
  ok(await visible(page, '#attachmentFile'), 'the attachments sub-page shows');
  ok(await page.locator('#phoneBack').isVisible(), '‹ is shown');
  ok(await page.locator('#subNav a').count() === 0, 'the list is hidden');
  ok(await fits(page, 390), 'no horizontal scroll on the sub-page');
  await page.click('#phoneBack');
  await waitHash(page, '#eposta');
  ok(await hash(page) === '#eposta' && await page.locator('#subNav a').count() === 4, '‹ returns to the list');
  ok(!(await page.locator('#phoneBack').isVisible()), '‹ hides on the list');
  await page.goBack();
  await waitHash(page, '#genel');
  ok(await hash(page) === '#genel', `back from the list returns to the previous section (got ${await hash(page)})`);
  ok(await fits(page, 390), 'document.documentElement.scrollWidth <= 390');
  await page.close();
}

console.log('4) back from an OAuth connect');
{
  const { page } = await open(ADMIN, { width: 1280, height: 900 }, '/admin?connected=instagram#eposta/ekler');
  ok(await visible(page, '[data-section="baglantilar"]'), 'shows Bağlantılar');
  ok(!(await visible(page, '[data-section="eposta"]')), 'not the e-mail section');
  const toast = page.locator('#toastStack [role="status"]');
  ok(await toast.count() > 0 && ((await toast.first().textContent()) ?? '').trim().length > 0, 'the success toast shows');
  ok(new URL(page.url()).pathname + new URL(page.url()).search + new URL(page.url()).hash === '/admin#baglantilar', `URL becomes /admin#baglantilar (got ${page.url()})`);
  await page.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
