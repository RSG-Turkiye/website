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

async function open(user, viewport, path = '/admin', body = EMPTY) {
  const page = await browser.newPage({ viewport });
  const views = [];
  const deletes = [];
  page.on('pageerror', (e) => bad.push(`pageerror (${user.email} ${viewport.width}px): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (req.method() !== 'GET') {
      deletes.push(`${req.method()} ${url.pathname}`);
      if (url.pathname === '/api/audit/view') views.push(req.postDataJSON()?.pane);
      return r.fulfill({ status: 204, body: '' });
    }
    if (url.pathname === '/api/me') return json({ user, profile: {} });
    if (url.pathname === '/api/admin/counts') return json(COUNTS);
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: !!user.is_admin });
    return json(body);
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return { page, views, deletes };
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

console.log('5) lists redrawn, 390 px');
{
  const long = 'x'.repeat(120);
  const FULL = {
    ...EMPTY,
    announcements: [{ id: 'a1', title: 'Registration closes ' + long, description: 'd', button_text: 'Go', button_url: 'https://example.org', expires_at: 1893456000, site: 'main', show_as_popup: true }],
    submissions: [{ id: 'b1', lang: 'en', title: 'A post', description: 'd', category: 'news', tags: ['x'], author: 'a', image_url: '', body: long, slug: 's', status: 'pending', rejection_reason: null, pr_url: null, paired_submission_id: null, submitter_email: 'someone@example.org' }],
    senders: [{ user_id: 'u9', email: 'sender@example.org', display_name: 'Sender', team: 'Comms', granted_at: 1760000000, granted_by_email: 'admin@example.org' }],
    attachments: [{ id: 'f1', filename: long + '.pdf', size_bytes: 2048, uploaded_at: 1760000000, is_active: 1 }],
    sends: [{ subject: 'Hello ' + long, sender_email: 's@example.org', sender_name: null, recipient_email: 'r@example.org', sent_at: 1760000000, status: 'failed', error_message: long }],
    connections: [{ platform: 'gmail', status: 'connected', accountName: 'mail@example.org', connectedBy: 'admin@example.org', connectedAt: 1760000000, lastOkAt: 1760000000, lastError: null, usesLegacySecret: false, hasStoredToken: true }],
    rows: [{ seq: 1, at: 1760000000, user_email: 'a@example.org', action: 'users.update', target_type: 'user', target_id: 'u1', details: JSON.stringify({ note: long }) }],
  };
  const { page, deletes, views } = await open(ADMIN, { width: 390, height: 844 }, '/admin', FULL);
  for (const h of ['#duyurular', '#blog', '#eposta/yetki', '#eposta/gondericiler', '#eposta/ekler', '#eposta/gonderilenler', '#baglantilar', '#kayit']) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await waitHash(page, h);
    await page.waitForTimeout(250);
    ok(await fits(page, 390), `${h}: scrollWidth <= 390`);
  }
  await page.evaluate(() => { location.hash = '#duyurular'; });
  await waitHash(page, '#duyurular');
  await page.waitForSelector('#announcementsList .delete-announcement-btn');
  const del = page.locator('#announcementsList .delete-announcement-btn').first();
  await del.click();
  ok(deletes.every((d) => !d.startsWith('DELETE')), 'first click on Delete does not delete');
  await del.click();
  await page.waitForFunction(() => true);
  await page.waitForTimeout(300);
  ok(deletes.some((d) => d === 'DELETE /api/admin/announcements/a1'), 'second click deletes');
  const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(300); };
  const noticeUp = () => page.locator('#announcementForm').evaluate((f) => !f.previousElementSibling.classList.contains('hidden'));
  await page.fill('#annTitle', 'unsaved');
  const before = views.length;
  await go('#blog');
  ok(await hash(page) === '#duyurular', 'leaving a dirty form stays on the section');
  ok(await noticeUp(), 'the unsaved-changes notice shows');
  ok(!(await visible(page, '[data-section="blog"]')), 'the target section was never shown');
  ok(views.length === before, 'a vetoed navigation posts no audit view');
  await go('#kayit');
  ok(await hash(page) === '#duyurular' && views.length === before, 'a second navigation while the notice is up is still blocked');
  await page.click('[data-keep]');
  ok(!(await noticeUp()) && await page.inputValue('#annTitle') === 'unsaved', 'Keep editing hides the notice and keeps the data');
  await go('#blog');
  await go('#kayit');
  await page.click('[data-discard]');
  await waitHash(page, '#kayit');
  ok(await hash(page) === '#kayit', 'Discard follows the latest wanted section');
  ok(views.length === before + 1 && views[views.length - 1] === 'kayit', 'only the section actually shown is audited');
  await go('#duyurular');
  ok(await page.inputValue('#annTitle') === '' && await page.inputValue('#announcementEditId') === '', 'Discard cleared the form');
  await page.fill('#annTitle', 'T');
  await page.fill('#annDescription', 'D');
  await page.fill('#annButtonText', 'B');
  await page.fill('#annButtonUrl', 'https://example.org');
  await page.fill('#annExpiresAt', '2030-01-01');
  await page.click('#announcementForm button[type="submit"]');
  await page.waitForTimeout(400);
  await go('#blog');
  ok(await hash(page) === '#blog', 'after a successful save, leaving is free');
  await page.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
