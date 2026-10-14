/**
 * Granting the symposium role from the admin panel, in a real browser.
 *
 * The role existed and worked -- it opens the symposium pane and, since the
 * committee photo upload, the image uploader too -- but there was no way to
 * grant it except a wrangler command written in a comment in db/schema.sql.
 * In practice that meant only full admins ever had it, which is the wrong
 * shape for a role whose point is to let an organiser edit the programme
 * without being an admin of everything.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npm run preview &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/user-roles.mjs
 *
 * Every call is intercepted, so this grants nothing to anybody real.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
page.on('pageerror', (e) => bad.push('pageerror: ' + String(e).slice(0, 150)));

await page.route('**/api/me', (r) => r.fulfill({ contentType: 'application/json',
  body: JSON.stringify({ user: { id: 'u1', email: 'admin@example.org', is_admin: true }, profile: {} }) }));

const users = [{
  id: 'u2', email: 'organiser@example.org', display_name: 'Bir Üye', username: 'uye',
  is_member: 1, is_admin: 0, is_announcer: 0, is_writer: 0, is_sender: 0, is_symposium: 0,
  created_at: 1, last_login: 1, badges: [],
}];
const actions = [];
await page.route('**/api/admin/users**', async (r) => {
  if (r.request().method() === 'GET') {
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ users, badge_catalog: [] }) });
  }
  const body = r.request().postDataJSON();
  actions.push(body.action);
  if (body.action === 'make_symposium') users[0].is_symposium = 1;
  if (body.action === 'remove_symposium') users[0].is_symposium = 0;
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
});
const json = (value) => (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
await page.route('**/api/admin/blog-submissions**', json({ submissions: [] }));
await page.route('**/api/admin/mail-senders**', json({ senders: [] }));
await page.route('**/api/admin/mail-attachments**', json({ attachments: [] }));
await page.route('**/api/admin/sends**', json({ sends: [] }));
await page.route('**/api/announcements**', json({ announcements: [] }));
for (const kind of ['speakers', 'sessions', 'committee']) {
  await page.route(`**/api/admin/symposium/${kind}`, json({ year: 2026, items: [] }));
}
await page.route('**/api/admin/symposium/edition', json({ year: 2026, edition: {} }));

await page.goto(BASE + '/admin#kullanicilar/liste', { waitUntil: 'networkidle' });
await page.waitForSelector('#usersList [data-user="u2"]');

// Playwright's own :visible, never offsetParent. The roles are switches in
// the detail panel now, which only exists once a person is selected; the
// row carries the role as a chip.
const symposiumSwitch = () => page.locator('#userDetail input[data-action-on=make_symposium]:visible');
const rowText = () => page.textContent('#usersList [data-user="u2"]');
const waitRow = (has) => page.waitForFunction((h) => (document.querySelector('#usersList [data-user="u2"]')?.textContent ?? '').includes('Symposium') === h, has, { timeout: 3000 }).catch(() => {});
const waitAction = async (a) => {
  for (let i = 0; i < 60 && !actions.includes(a); i++) await new Promise((r) => setTimeout(r, 50));
};

console.log('1) kişi seçilmeden rol verilemez');
ok(await symposiumSwitch().count() === 0, 'seçim yokken sempozyum anahtarı tıklanamaz');
ok(!(await rowText()).includes('Symposium'), 'rozet yok');

console.log('2) kişiyi seç');
await page.click('#usersList [data-user="u2"]');
await page.waitForSelector('#userDetail input[data-action-on=make_symposium]');
ok(await symposiumSwitch().count() === 1, 'ayrıntıda sempozyum anahtarı görünür');
ok(!(await symposiumSwitch().isChecked()), 'anahtar kapalı');

console.log('3) rolü ver');
await symposiumSwitch().click();
await waitAction('make_symposium');
await waitRow(true);
console.log('   sunucuya giden:', JSON.stringify(actions));
ok(actions.includes('make_symposium'), 'make_symposium gönderildi');
ok((await rowText()).includes('Symposium'), 'rozet listede göründü');

console.log('4) geri al');
ok(await symposiumSwitch().isChecked(), 'anahtar artık açık');
await symposiumSwitch().click();
await waitAction('remove_symposium');
await waitRow(false);
ok(actions.includes('remove_symposium'), 'remove_symposium gönderildi');
ok(!(await rowText()).includes('Symposium'), 'rozet kalktı');

await browser.close();
console.log(bad.length ? `\n${bad.length} SORUN:\n - ` + bad.join('\n - ') : '\nHEPSİ GEÇTİ');
process.exit(bad.length ? 1 : 0);
