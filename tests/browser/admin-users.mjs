/**
 * Users and roles in the admin panel, in a real browser: the list of rows
 * with a detail panel, the role switches, the Roles tab (one card per role,
 * × to remove with two clicks, + to add), and the phone's list-then-detail.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-users.mjs
 *
 * Every API call is intercepted, so nothing is read or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const ME = { id: 'u1', email: 'admin@example.org', is_admin: true };
const EMPTY = {
  users: [], badge_catalog: [], announcements: [], submissions: [], senders: [], attachments: [], sends: [],
  connections: [], rows: [], hasMore: false, year: 2026, edition: {}, items: [], certificates: [], totalBytes: 0,
  posts: [], plans: [], modes: [], editors: [],
};
const fresh = () => [
  { id: 'u1', email: 'admin@example.org', display_name: 'Ada Admin', username: 'ada', is_member: 1, is_admin: 1, is_announcer: 1,
    is_writer: 0, is_sender: 0, is_symposium: 0, is_social: 0, is_social_publisher: 0, is_public: 1, current_rank: 'seed', badge_codes: '', created_at: 1700000000 },
  { id: 'u2', email: 'uye@example.org', display_name: 'Bir Üye', username: 'uye', is_member: 0, is_admin: 0, is_announcer: 0,
    is_writer: 0, is_sender: 0, is_symposium: 0, is_social: 0, is_social_publisher: 0, is_public: 1, current_rank: 'seed', badge_codes: '', created_at: 1700000000 },
];
const FLAGS = { make_: 1, remove_: 0 };
const ROLE_FLAGS = ['is_admin', 'is_announcer', 'is_writer', 'is_sender', 'is_symposium', 'is_social', 'is_social_publisher'];
const hasRole = (u) => ROLE_FLAGS.some((f) => u[f]);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function open(viewport, hash) {
  const page = await browser.newPage({ viewport });
  const users = fresh();
  const patches = [];
  const gets = [];
  // How the next PATCHes answer: 'ok', 'refuse' (a 400) or 'abort' (a network failure).
  const patchMode = { value: 'ok' };
  page.on('pageerror', (e) => bad.push(`pageerror (${viewport.width}px): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (url.pathname === '/api/admin/users' && req.method() === 'PATCH') {
      const body = req.postDataJSON();
      patches.push(body);
      if (patchMode.value === 'refuse') return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Refused by the stub' }) });
      if (patchMode.value === 'abort') return r.abort('failed');
      const u = users.find((x) => x.id === body.user_id);
      const m = /^(make|remove)_(.+)$/.exec(body.action);
      if (u && m && m[2] !== 'private') u[`is_${m[2]}`] = FLAGS[`${m[1]}_`];
      return json({ ok: true });
    }
    if (req.method() !== 'GET') return r.fulfill({ status: 204, body: '' });
    if (url.pathname === '/api/me') return json({ user: ME, profile: {} });
    if (url.pathname === '/api/admin/counts') return json({ email: 0, social: 0, blog: 0, scheduledThisWeek: 0 });
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: true });
    if (url.pathname === '/api/admin/users') {
      gets.push(url.search);
      const f = url.searchParams.get('filter');
      const q = (url.searchParams.get('search') ?? '').toLowerCase();
      const list = users
        .filter((u) => f === 'members' ? u.is_member : f === 'pending' ? !u.is_member : f === 'roles' ? hasRole(u) : true)
        .filter((u) => !q || `${u.email} ${u.username} ${u.display_name}`.toLowerCase().includes(q));
      return json({ users: list, badge_catalog: [{ code: 'nf', name_en: 'Nextflow', name_tr: 'Nextflow' }] });
    }
    return json(EMPTY);
  });
  await page.goto(BASE + '/admin' + hash, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return { page, patches, gets, patchMode };
}

const waitPatches = (patches, n) => new Promise((resolve) => {
  const start = Date.now();
  const tick = () => (patches.length >= n || Date.now() - start > 3000 ? resolve() : setTimeout(tick, 50));
  tick();
});
const fits = async (page, w) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= w;
const rowText = (page, id) => page.textContent(`#usersList [data-user="${id}"]`);

console.log('1) list and detail, 1280 px');
{
  const { page, patches, gets, patchMode } = await open({ width: 1280, height: 900 }, '#kullanicilar/liste');
  await page.waitForSelector('#usersList [data-user="u2"]');
  ok(await page.locator('#usersList [data-user]').count() === 2, 'two rows');
  ok(await page.locator('#userDetail input[role="switch"]').count() === 0, 'no switches before a row is selected');
  ok((await rowText(page, 'u1')).includes('Admin'), 'the admin row carries the Admin chip');
  await page.click('#usersList [data-user="u2"]');
  await page.waitForSelector('#userDetail input[data-action-on="make_symposium"]');
  ok(await page.locator('#userDetail input[role="switch"]').count() === 7, 'seven role switches');
  ok((await page.textContent('#userDetail')).includes('uye@example.org'), 'detail shows the email');
  await page.click('#userDetail input[data-action-on="make_symposium"]');
  await waitPatches(patches, 1);
  ok(JSON.stringify(patches[0]) === JSON.stringify({ user_id: 'u2', action: 'make_symposium' }), `PATCH body ${JSON.stringify(patches[0])}`);
  await page.waitForFunction(() => document.querySelector('#usersList [data-user="u2"]')?.textContent.includes('Symposium'), null, { timeout: 3000 }).catch(() => {});
  ok((await rowText(page, 'u2')).includes('Symposium'), 'the row gains the Symposium chip');
  ok(await page.locator('#userDetail input[data-action-on="make_symposium"]').isChecked(), 'same person still selected, switch on');

  console.log('   turning it off sends remove_symposium');
  await page.click('#userDetail input[data-action-on="make_symposium"]');
  await waitPatches(patches, 2);
  ok(patches[1]?.action === 'remove_symposium' && patches[1]?.user_id === 'u2', `second PATCH ${JSON.stringify(patches[1])}`);

  console.log('   the role filter shows only people with a role');
  await page.click('[data-filter="roles"]');
  await page.waitForFunction(() => document.querySelectorAll('#usersList [data-user]').length === 1, null, { timeout: 3000 }).catch(() => {});
  ok(await page.locator('#usersList [data-user]').count() === 1 && await page.locator('#usersList [data-user="u1"]').count() === 1, 'only the admin is listed');
  ok(gets.some((s) => new URLSearchParams(s).get('filter') === 'roles'), `"Has a role" asks the server for filter=roles (${gets.join(' ')})`);
  await page.click('[data-filter="all"]');
  await page.waitForFunction(() => document.querySelectorAll('#usersList [data-user]').length === 2, null, { timeout: 3000 }).catch(() => {});

  console.log('   rank, badges, verify and profile actions are all there');
  await page.click('#usersList [data-user="u2"]');
  await page.waitForSelector('#userDetail .rank-select');
  await page.selectOption('#userDetail .rank-select', 'sprout');
  await waitPatches(patches, 3);
  ok(patches[2]?.action === 'set_rank' && patches[2]?.value === 'sprout', `set_rank sent ${JSON.stringify(patches[2])}`);
  await page.waitForSelector('#userDetail .badge-chip[data-code="nf"]');
  await page.click('#userDetail .badge-chip[data-code="nf"]');
  await waitPatches(patches, 4);
  ok(patches[3]?.action === 'award_badge' && patches[3]?.value === 'nf', `award_badge sent ${JSON.stringify(patches[3])}`);
  await page.waitForSelector('#userDetail [data-action="verify"]');
  await page.click('#userDetail [data-action="verify"]');
  await waitPatches(patches, 5);
  ok(patches[4]?.action === 'verify', `verify sent ${JSON.stringify(patches[4])}`);
  await page.waitForSelector('#userDetail [data-action="clear_bio"]');
  await page.click('#userDetail [data-action="clear_bio"]');
  await page.waitForTimeout(150);
  ok(patches.length === 5, 'clear bio does nothing on the first click');
  await page.click('#userDetail [data-action="clear_bio"]');
  await waitPatches(patches, 6);
  ok(patches[5]?.action === 'clear_bio', `clear_bio sent on the second click ${JSON.stringify(patches[5])}`);
  await page.waitForSelector('#userDetail [data-action="make_private"]');
  await page.click('#userDetail [data-action="make_private"]');
  await page.click('#userDetail [data-action="make_private"]');
  await waitPatches(patches, 7);
  ok(patches[6]?.action === 'make_private', `make_private sent ${JSON.stringify(patches[6])}`);

  console.log('   a refused or failed change puts the switch back and frees it');
  for (const mode of ['refuse', 'abort']) {
    patchMode.value = mode;
    const n = patches.length;
    const sw = '#userDetail input[data-action-on="make_writer"]';
    await page.waitForSelector(sw);
    const was = await page.locator(sw).isChecked();
    await page.click(sw);
    await waitPatches(patches, n + 1);
    await page.waitForFunction((s) => !document.querySelector(s)?.disabled, sw, { timeout: 3000 }).catch(() => {});
    ok(patches.length === n + 1 && patches[n]?.action === 'make_writer', `${mode}: the PATCH was sent`);
    ok(await page.locator(sw).isChecked() === was, `${mode}: the switch is back in its old state`);
    ok(await page.locator(sw).isEnabled(), `${mode}: the switch is enabled again`);
    ok(await page.locator('#toastStack [role="alert"]').count() > 0, `${mode}: an error toast shows`);
  }
  patchMode.value = 'ok';

  console.log('   one cannot take admin from oneself: the switch is locked');
  await page.click('#usersList [data-user="u1"]');
  const selfAdmin = '#userDetail input[data-action-off="remove_admin"]';
  await page.waitForSelector(`${selfAdmin}:checked`);
  ok(await page.locator(selfAdmin).isDisabled(), 'own Admin switch is disabled');
  ok((await page.locator(selfAdmin).locator('xpath=..').textContent()).includes('You cannot remove your own admin role.'), 'its hint says why');
  ok(await page.locator('#userDetail input[data-action-off="remove_announcer"]').isEnabled(), 'own other roles stay editable');
  ok(await fits(page, 1280), 'no horizontal scroll at 1280 px');
  await page.close();
}

console.log('2) roles tab, 1280 px');
{
  const { page, patches, gets } = await open({ width: 1280, height: 900 }, '#kullanicilar/yetkiler');
  await page.waitForSelector('#rolesView [data-role-card="is_admin"] [data-person="u1"]').catch(() => {});
  ok(await page.locator('#rolesView [data-role-card]').count() === 7, 'seven role cards');
  ok(gets.includes('?filter=roles'), `the Roles tab loads with filter=roles (${gets.join(' ')})`);
  ok((await page.textContent('#rolesView [data-role-card="is_admin"]') ?? '').includes('Ada Admin'), 'Ada Admin is listed under Admin');
  ok(await page.locator('#rolesView [data-role-card="is_admin"] [data-person="u1"] button').count() === 0, 'no × on one\'s own Admin chip');
  const remove = page.locator('#rolesView [data-role-card="is_announcer"] [data-person="u1"] button');
  await remove.click();
  await page.waitForTimeout(150);
  ok(patches.length === 0, 'first × click sends nothing');
  await remove.click();
  await waitPatches(patches, 1);
  ok(JSON.stringify(patches[0]) === JSON.stringify({ user_id: 'u1', action: 'remove_announcer' }), `second × click sends ${JSON.stringify(patches[0])}`);
  await page.waitForFunction(() => !document.querySelector('#rolesView [data-role-card="is_announcer"] [data-person="u1"]'), null, { timeout: 3000 }).catch(() => {});
  ok(await page.locator('#rolesView [data-role-card="is_announcer"] [data-person="u1"]').count() === 0, 'Ada leaves the Announcements card');

  console.log('   + adds a person, found by the server');
  await page.click('#rolesView [data-role-card="is_writer"] [data-add-role]');
  await page.fill('#rolesView [data-role-card="is_writer"] [data-add-input]', 'uye@');
  await page.waitForSelector('#rolesView [data-role-card="is_writer"] [data-add-user="u2"]');
  ok(await page.locator('#rolesView [data-role-card="is_writer"] [data-add-user]').count() === 1, 'search filters to one match');
  ok(gets.some((s) => new URLSearchParams(s).get('search') === 'uye@'), `the add box searches the server (${gets.join(' ')})`);
  await page.click('#rolesView [data-role-card="is_writer"] [data-add-user="u2"]');
  await page.waitForSelector('#rolesView [data-role-card="is_writer"] [data-picker-confirm]', { timeout: 3000 }).catch(() => {});
  ok(await fits(page, 1280), 'no horizontal scroll with the duration choice open');
  await page.click('#rolesView [data-role-card="is_writer"] [data-picker-confirm]');
  await waitPatches(patches, 2);
  ok(JSON.stringify(patches[1]) === JSON.stringify({ user_id: 'u2', action: 'make_writer', duration: { months: 1 } }), `add sends ${JSON.stringify(patches[1])}`);
  await page.waitForSelector('#rolesView [data-role-card="is_writer"] [data-person="u2"]', { timeout: 3000 }).catch(() => {});
  ok(await page.locator('#rolesView [data-role-card="is_writer"] [data-person="u2"]').count() === 1, 'Bir Üye appears under Blog writer');
  ok(await fits(page, 1280), 'no horizontal scroll at 1280 px');
  await page.close();
}

console.log('3) phone, 390 px');
{
  const { page } = await open({ width: 390, height: 844 }, '#kullanicilar/liste');
  await page.waitForSelector('#usersList [data-user="u2"]');
  ok(await fits(page, 390), 'no horizontal scroll with the list');
  ok(!(await page.locator('#userDetail').isVisible()), 'detail hidden until a row is picked');
  await page.click('#usersList [data-user="u2"]');
  await page.waitForSelector('#userDetailBack', { state: 'visible', timeout: 3000 }).catch(() => {});
  ok(await page.locator('#userDetail').isVisible() && !(await page.locator('#usersPane').isVisible()), 'detail replaces the list');
  ok(await fits(page, 390), 'no horizontal scroll with the detail');
  await page.click('#userDetailBack');
  await page.waitForSelector('#usersPane', { state: 'visible', timeout: 3000 }).catch(() => {});
  ok(await page.locator('#usersPane').isVisible() && !(await page.locator('#userDetail').isVisible()), '‹ returns to the list');
  ok(await page.evaluate(() => location.hash) === '#kullanicilar/liste', 'the route did not change');
  await page.goto(BASE + '/admin#kullanicilar/yetkiler', { waitUntil: 'networkidle' });
  await page.waitForSelector('#rolesView [data-role-card]').catch(() => {});
  ok(await fits(page, 390), 'no horizontal scroll on the roles tab');
  await page.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} PROBLEM(S):\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
