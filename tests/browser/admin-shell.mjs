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
const SENDER = { id: 'u3', email: 'sender@example.org', is_sender: true };
const COUNTS = { email: 3, social: 2, scheduledThisWeek: 4 };
// One body that satisfies every list the panel reads on load.
const EMPTY = {
  users: [], badge_catalog: [], announcements: [], senders: [], attachments: [], sends: [],
  connections: [], rows: [], hasMore: false, year: 2026, edition: {}, items: [], certificates: [], totalBytes: 0,
  posts: [], plans: [], modes: [], editors: [],
};

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function open(user, viewport, path = '/admin', body = EMPTY) {
  const page = await browser.newPage({ viewport });
  const views = [];
  const deletes = [];
  const gets = [];
  page.on('pageerror', (e) => bad.push(`pageerror (${user.email} ${viewport.width}px): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (req.method() === 'GET') gets.push(url.pathname + url.search);
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
  return { page, views, deletes, gets };
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
// The element's own computed display, whatever its ancestors do: `hidden`
// beside `inline-flex` once lost to it in the built CSS, so these buttons
// showed while hidden. isVisible() would miss that inside a hidden section.
// Shown, it reads `flex` rather than `inline-flex` inside a flex row.
const display = (page, id) => page.evaluate((x) => getComputedStyle(document.getElementById(x)).display, id);
const STARTS_HIDDEN = ['cancelEditBtn', 'auditMore', 'symSpeakerCancelBtn', 'symSessionCancelBtn', 'symCommitteeCancelBtn', 'symCertUpload'];
const fits = async (page, w) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= w;

console.log('1) admin, 1280 px');
{
  const { page, views } = await open(ADMIN, { width: 1280, height: 900 });
  ok(await hash(page) === '#genel', `lands on #genel (got ${await hash(page)})`);
  for (const id of STARTS_HIDDEN) ok(await display(page, id) === 'none', `#${id} is display:none at load (got ${await display(page, id)})`);
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
  ok(await page.locator('#subNav a').count() === 5, 'five list rows');
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
  ok(await hash(page) === '#eposta' && await page.locator('#subNav a').count() === 5, '‹ returns to the list');
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
    senders: [{ user_id: 'u9', email: 'sender@example.org', display_name: 'Sender', team: 'Comms', granted_at: 1760000000, granted_by_email: 'admin@example.org' }],
    attachments: [{ id: 'f1', filename: long + '.pdf', size_bytes: 2048, uploaded_at: 1760000000, is_active: 1 }],
    sends: [{ subject: 'Hello ' + long, sender_email: 's@example.org', sender_name: null, recipient_email: 'r@example.org', sent_at: 1760000000, status: 'failed', error_message: long }],
    connections: [{ platform: 'gmail', status: 'connected', accountName: 'mail@example.org', connectedBy: 'admin@example.org', connectedAt: 1760000000, lastOkAt: 1760000000, lastError: null, usesLegacySecret: false, hasStoredToken: true }],
    rows: [{ seq: 1, at: 1760000000, user_email: 'a@example.org', action: 'users.update', target_type: 'user', target_id: 'u1', details: JSON.stringify({ note: long }) }],
    hasMore: true,
  };
  const { page, deletes, views } = await open(ADMIN, { width: 390, height: 844 }, '/admin', FULL);
  for (const h of ['#duyurular', '#eposta/yetki', '#eposta/gondericiler', '#eposta/ekler', '#eposta/gonderilenler', '#baglantilar', '#kayit']) {
    await page.evaluate((x) => { location.hash = x; }, h);
    await waitHash(page, h);
    await page.waitForTimeout(250);
    ok(await fits(page, 390), `${h}: scrollWidth <= 390`);
  }
  await page.waitForFunction(() => getComputedStyle(document.getElementById('auditMore')).display !== 'none', null, { timeout: 3000 }).catch(() => {});
  ok(await display(page, 'auditMore') !== 'none' && await visible(page, '#auditMore'), `with more entries, "Older entries" shows (got ${await display(page, 'auditMore')})`);
  await page.evaluate(() => { location.hash = '#duyurular'; });
  await waitHash(page, '#duyurular');
  await page.waitForSelector('#announcementsList .edit-announcement-btn');
  ok(await display(page, 'cancelEditBtn') === 'none', 'Cancel is hidden before an edit');
  await page.click('#announcementsList .edit-announcement-btn');
  ok(await display(page, 'cancelEditBtn') !== 'none' && await visible(page, '#cancelEditBtn'), `editing an announcement shows Cancel (got ${await display(page, 'cancelEditBtn')})`);
  await page.click('#cancelEditBtn');
  ok(await display(page, 'cancelEditBtn') === 'none' && await page.inputValue('#announcementEditId') === '', 'Cancel hides itself and clears the edit');
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
  await go('#baglantilar');
  ok(await hash(page) === '#duyurular', 'leaving a dirty form stays on the section');
  ok(await noticeUp(), 'the unsaved-changes notice shows');
  ok(!(await visible(page, '[data-section="baglantilar"]')), 'the target section was never shown');
  ok(views.length === before, 'a vetoed navigation posts no audit view');
  await go('#kayit');
  ok(await hash(page) === '#duyurular' && views.length === before, 'a second navigation while the notice is up is still blocked');
  await page.click('[data-keep]');
  ok(!(await noticeUp()) && await page.inputValue('#annTitle') === 'unsaved', 'Keep editing hides the notice and keeps the data');
  await go('#baglantilar');
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
  await go('#baglantilar');
  ok(await hash(page) === '#baglantilar', 'after a successful save, leaving is free');
  await page.close();
}

console.log('6) Sempozyum sub-pages and the unsaved-changes guard');
{
  const long = 'y'.repeat(120);
  const SYMP = {
    ...EMPTY,
    items: [{ id: 'i1', sort: 1, slug: 's1', name: 'Ada ' + long, position: 'Prof. ' + long, company: 'Uni ' + long, bio: '', photo: '', linkedin: '',
      title: 'Talk ' + long, type: 'talk', time: '09:00', endTime: '09:30', description: '', speakerSlugs: [], day: 1, titleTr: '', descriptionTr: '',
      role: 'Chair', roleTr: '', affiliation: 'Lab', teams: ['A', 'B'], teamsTr: [] }],
    certificates: [{ id: 'c1', email: long + '@example.org', name: 'Ayse ' + long, kind: 'participation', size_bytes: 877, expires_at: 1794415522 }],
    totalBytes: 877,
  };
  const SUBS = ['baski', 'konusmacilar', 'oturumlar', 'komite', 'sertifikalar'];
  {
    const { page } = await open(ADMIN, { width: 1280, height: 900 }, '/admin', SYMP);
    for (const sub of SUBS) {
      await page.evaluate(() => { location.hash = '#genel'; });
      await waitHash(page, '#genel');
      await page.click('#sectionNav [data-nav="sempozyum"]');
      await page.click(`#subNav [data-sub-link="${sub}"]`);
      await waitHash(page, `#sempozyum/${sub}`);
      ok(await hash(page) === `#sempozyum/${sub}` && await visible(page, `[data-sub="${sub}"]`), `desktop: tab ${sub} opens its sub-page`);
    }
    ok(await fits(page, 1280), 'sempozyum: no horizontal scroll at 1280 px');
    await page.close();
  }
  {
    const { page, deletes } = await open(ADMIN, { width: 390, height: 844 }, '/admin', SYMP);
    for (const sub of SUBS) {
      await page.evaluate(() => { location.hash = '#sempozyum'; });
      await waitHash(page, '#sempozyum');
      await page.click(`#subNav [data-sub-link="${sub}"]`);
      await waitHash(page, `#sempozyum/${sub}`);
      ok(await hash(page) === `#sempozyum/${sub}` && await visible(page, `[data-sub="${sub}"]`), `phone: list row ${sub} opens its sub-page`);
      await page.waitForTimeout(150);
      ok(await fits(page, 390), `phone: #sempozyum/${sub} has no horizontal scroll`);
    }
    await page.evaluate(() => { location.hash = '#sempozyum/sertifikalar'; });
    await waitHash(page, '#sempozyum/sertifikalar');
    await page.waitForSelector('#symCertListBody > div');
    ok(await fits(page, 390), 'certificates with long values: scrollWidth <= 390');
    await page.click('#symCertListBody button');
    ok(!deletes.some((d) => d.startsWith('DELETE')), 'certificate delete needs a second click');

    await page.evaluate(() => { location.hash = '#sempozyum/konusmacilar'; });
    await waitHash(page, '#sempozyum/konusmacilar');
    await page.waitForSelector('#symSpeakersTableBody > div');
    await page.fill('#symSpeakerName', 'Unsaved speaker');
    const notice = page.locator('#symSpeakerForm').locator('xpath=preceding-sibling::div[1]');
    await page.evaluate(() => { location.hash = '#sempozyum/oturumlar'; });
    await page.waitForTimeout(300);
    ok(await hash(page) === '#sempozyum/konusmacilar', 'a dirty speaker form blocks moving to another symposium sub-page');
    ok(await notice.isVisible(), 'the unsaved-changes notice is on screen above the speaker form');
    ok(!(await visible(page, '[data-sub="oturumlar"]')), 'the sessions sub-page was never shown');
    await notice.locator('[data-keep]').click();
    await page.evaluate(() => { location.hash = '#baglantilar'; });
    await page.waitForTimeout(300);
    ok(await hash(page) === '#sempozyum/konusmacilar', 'a dirty speaker form blocks leaving the section');
    ok(await notice.isVisible(), 'the notice shows again');
    await notice.locator('[data-discard]').click();
    await waitHash(page, '#baglantilar');
    ok(await hash(page) === '#baglantilar', 'Discard continues to the wanted section');
    await page.evaluate(() => { location.hash = '#sempozyum/konusmacilar'; });
    await waitHash(page, '#sempozyum/konusmacilar');
    ok(await page.inputValue('#symSpeakerName') === '', 'Discard cleared the speaker form');
    await page.evaluate(() => { location.hash = '#sempozyum/oturumlar'; });
    await waitHash(page, '#sempozyum/oturumlar');
    ok(await hash(page) === '#sempozyum/oturumlar', 'with a clean form, moving between sub-pages is free');
    await page.close();
  }
}

console.log('7) sender-only user and the Sent sub-page');
{
  const SENDS = { ...EMPTY, sends: [
    { id: 's1', subject: 'Welcome <b>aboard</b>', recipient_email: 'r@example.org', recipient_name: null, sent_at: 1760000000, status: 'sent', error_message: null, sender_email: 'x@example.org', sender_name: 'Xavier' },
  ] };
  {
    const { page, gets } = await open(SENDER, { width: 1280, height: 900 }, '/admin', SENDS);
    ok(await hash(page) === '#eposta/gelen', `sender lands on #eposta/gelen (got ${await hash(page)})`);
    const subs = await page.locator('#subNav [data-sub-link]').evaluateAll((els) => els.map((e) => e.dataset.subLink));
    ok(subs.join(',') === 'gelen,yaz,gonderilenler', `sub-nav is gelen, yaz, gonderilenler (got ${subs.join(',')})`);
    ok(gets.includes('/api/admin/counts'), 'counts were requested');
    // One section: no menu, so the Inbox tab carries the unread count.
    await page.waitForFunction(() => document.querySelector('#subNav [data-sub-link="gelen"] [data-count="email"]')?.textContent === '3');
    ok(await page.locator('#subNav [data-sub-link="gelen"] [data-count="email"]').isVisible(), 'the Inbox tab shows the unread count 3');
    await page.click('#subNav [data-sub-link="gonderilenler"]');
    await waitHash(page, '#eposta/gonderilenler');
    await page.waitForSelector('#sentList > div');
    ok(await page.locator('#sentList > div').count() === 1, 'the stubbed history row is listed');
    ok((await page.textContent('#sentList')).includes('Welcome <b>aboard</b>'), 'the subject is escaped');
    ok(!(await visible(page, '#sentScope')), 'a sender has no Mine/Everyone toggle');
    ok(gets.includes('/api/mail/history'), 'own sends requested');
    ok(await fits(page, 1280), 'sent: no horizontal scroll at 1280 px');
    await page.close();
  }
  {
    // An admin who cannot send has no mail of their own: Everyone first.
    const { page, gets } = await open(ADMIN, { width: 1280, height: 900 }, '/admin#eposta/gonderilenler', SENDS);
    await page.waitForSelector('#sentList > div');
    ok(await visible(page, '#sentScope'), 'an admin sees the toggle');
    ok(gets.filter((g) => g.startsWith('/api/mail/history')).join(',') === '/api/mail/history?scope=all', `a non-sender admin starts on Everyone (got ${gets.filter((g) => g.startsWith('/api/mail/history')).join(',')})`);
    ok(await page.getAttribute('#sentScope [data-scope="all"]', 'aria-pressed') === 'true', 'Everyone is pressed');
    ok((await page.textContent('#sentList')).includes('Xavier'), 'everyone\'s rows name the sender');
    await page.click('#sentScope [data-scope="mine"]');
    await page.waitForFunction(() => !document.getElementById('sentList').textContent.includes('Xavier'));
    ok(gets.includes('/api/mail/history'), 'Mine requests the own list');
    await page.close();
  }
  {
    // An admin who is also a sender starts on Mine.
    const { page, gets } = await open({ ...ADMIN, is_sender: true }, { width: 1280, height: 900 }, '/admin#eposta/gonderilenler', SENDS);
    await page.waitForSelector('#sentList > div');
    ok(!gets.some((g) => g.includes('scope=all')), 'admin and sender: default view is Mine');
    ok(await page.getAttribute('#sentScope [data-scope="mine"]', 'aria-pressed') === 'true', 'Mine is pressed');
    await page.click('#sentScope [data-scope="all"]');
    await page.waitForFunction(() => document.getElementById('sentList').textContent.includes('Xavier'));
    ok(gets.some((g) => g === '/api/mail/history?scope=all'), 'Everyone requests scope=all');
    await page.close();
  }
}

console.log('8) Sent load failures');
{
  const SENDS = { ...EMPTY, sends: [
    { id: 's1', subject: 'Own mail', recipient_email: 'r@example.org', recipient_name: null, sent_at: 1760000000, status: 'sent', error_message: null, sender_email: 'x@example.org', sender_name: 'Xavier' },
  ] };
  {
    const { page, gets } = await open(SENDER, { width: 1280, height: 900 }, '/admin', SENDS);
    let fail = true;
    await page.route((u) => u.pathname === '/api/mail/history', (r) => fail
      ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' })
      : r.fallback());
    await page.click('#subNav [data-sub-link="gonderilenler"]');
    await waitHash(page, '#eposta/gonderilenler');
    await page.waitForSelector('#toastStack [role="alert"]');
    ok((await page.textContent('#toastStack')).includes('Sent mail could not be loaded.'), 'a failed first load says so');
    ok(await page.locator('#sentList > div').count() === 0, 'nothing is listed');
    fail = false;
    await page.click('#subNav [data-sub-link="gelen"]');
    await waitHash(page, '#eposta/gelen');
    await page.click('#subNav [data-sub-link="gonderilenler"]');
    await waitHash(page, '#eposta/gonderilenler');
    await page.waitForSelector('#sentList > div');
    ok((await page.textContent('#sentList')).includes('Own mail'), 'the next show retries and lists the mail');
    ok(gets.filter((g) => g === '/api/mail/history').length >= 1, 'the retry asked again');
    await page.close();
  }
  {
    // A failed switch leaves the toggle on the list still shown.
    const { page } = await open({ ...ADMIN, is_sender: true }, { width: 1280, height: 900 }, '/admin#eposta/gonderilenler', SENDS);
    await page.waitForSelector('#sentList > div');
    await page.route((u) => u.pathname === '/api/mail/history' && u.searchParams.get('scope') === 'all', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"x"}' }));
    await page.click('#sentScope [data-scope="all"]');
    await page.waitForSelector('#toastStack [role="alert"]');
    ok(await page.getAttribute('#sentScope [data-scope="mine"]', 'aria-pressed') === 'true', 'the toggle returns to Mine');
    ok(!(await page.textContent('#sentList')).includes('Xavier') && (await page.textContent('#sentList')).includes('Own mail'), 'the own list stays under it');
    await page.close();
  }
}

console.log('9) signed out, and signed in without access');
for (const [path, text] of [['/admin#eposta/gelen/abc', 'Sign In'], ['/tr/admin#eposta/gelen/abc', 'Giriş Yap']]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', (e) => bad.push(`pageerror (signed out ${path}): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => new URL(r.request().url()).pathname === '/api/me'
    ? r.fulfill({ status: 401, contentType: 'application/json', body: '{"user":null}' })
    : r.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('#notSignedIn:not(.hidden)', { timeout: 5000 }).catch(() => {});
  ok(await page.locator('#notSignedIn').isVisible(), `${path}: signed out shows the sign-in prompt`);
  ok(!(await page.locator('#notAuth').isVisible()), `${path}: not the no-access message`);
  const link = page.locator('#notSignedIn a');
  const href = (await link.getAttribute('href')) ?? '';
  ok(href.startsWith('/auth/login?next=') && (await link.textContent()).trim() === text, `${path}: the button is ${text} -> /auth/login?next=`);
  ok(decodeURIComponent(href.slice('/auth/login?next='.length)) === path, `${path}: signing in returns to this page`);
  ok((await link.boundingBox()).height >= 44, `${path}: the button is at least 44 px tall`);
  ok(await fits(page, 390), `${path}: no horizontal scroll`);
  await page.close();
}
console.log('6) what an agent wrote or did: "Bir ajan yazdı" on a social draft, "ajan üzerinden" in the log (/tr/admin)');
{
  const post = (id, byAgent) => ({
    id, type: 'image', caption: `Örnek gönderi ${id}`, captionOverrides: {}, link: null, media: [], platforms: ['instagram'], scheduledAt: null,
    status: 'draft', revision: 1, createdBy: 'u1', authorEmail: null, approvedBy: null, approvedAt: null, reviewNote: null,
    planId: null, planTitle: null, eventModeId: null, createdAt: 1760000000, updatedAt: 1760000000, byAgent, targets: [],
  });
  const AGENT = {
    ...EMPTY,
    posts: [post('p-agent', true), post('p-person', false)],
    rows: [
      { seq: 2, at: 1760000100, user_email: 'a@example.org', action: 'cms.draft.create', target_type: 'content_draft', target_id: 'd1', details: JSON.stringify({ type: 'events', via: 'agent', agent_token: 'tok-1' }) },
      { seq: 1, at: 1760000000, user_email: 'a@example.org', action: 'cms.draft.update', target_type: 'content_draft', target_id: 'd1', details: JSON.stringify({ type: 'events' }) },
    ],
  };
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    const w = viewport.width;
    const { page } = await open(ADMIN, viewport, '/tr/admin#sosyal/taslaklar', AGENT);
    await page.waitForSelector('#socialDraftList [data-post="p-agent"]', { timeout: 5000 }).catch(() => {});
    const card = async (id) => ((await page.locator(`#socialDraftList [data-post="${id}"]`).textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ');
    ok((await card('p-agent')).includes('Bir ajan yazdı'), `${w}px: Taslaklar: the agent's post says "Bir ajan yazdı"`);
    ok(!(await card('p-person')).includes('ajan'), `${w}px: Taslaklar: a person's post does not`);
    ok(await fits(page, w), `${w}px: Taslaklar is no wider than the window`);
    await page.evaluate(() => { location.hash = '#kayit'; });
    await waitHash(page, '#kayit');
    await page.waitForFunction(() => document.querySelectorAll('#auditBody [data-row-title]').length === 2, null, { timeout: 5000 }).catch(() => {});
    const rows = await page.locator('#auditBody [data-row-title]').evaluateAll((els) => els.map((e) => e.closest('div').textContent.replace(/\s+/g, ' ')));
    ok(rows.length === 2 && rows[0].includes('ajan üzerinden'), `${w}px: the log row an agent caused says "ajan üzerinden" (got ${rows[0]?.slice(0, 120)})`);
    ok(rows.length === 2 && !rows[1].includes('ajan'), `${w}px: a person's row does not`);
    ok(await fits(page, w), `${w}px: the log is no wider than the window`);
    await page.close();
  }
}

{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/api/**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ user: { id: 'u9', email: 'member@example.org' }, profile: {} }) }));
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  await page.waitForSelector('#notAuth:not(.hidden)', { timeout: 5000 }).catch(() => {});
  ok(await page.locator('#notAuth').isVisible(), 'a member without a panel role keeps the no-access message');
  ok(!(await page.locator('#notSignedIn').isVisible()), 'and no sign-in prompt');
  await page.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
