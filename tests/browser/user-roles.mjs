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

await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await page.waitForSelector('#userTableBody tr');

// Playwright's own :visible, never offsetParent -- the dropdown's buttons are
// in the DOM the whole time, and offsetParent called them visible while a
// click on them timed out as "element is not visible". Note the row also
// carries one action button outside the menu, so this asks about the
// symposium action specifically rather than counting all of them.
const symposiumAction = (which) => page.locator(`#userTableBody .action-btn[data-action=${which}_symposium]:visible`);
const openMenu = async () => { await page.click('#userTableBody .more-btn'); await page.waitForTimeout(200); };
const rowText = () => page.textContent('#userTableBody tr');

console.log('1) menü kapalıyken rol verilemez');
ok(await symposiumAction('make').count() === 0, 'kapalı menüde sempozyum eylemi tıklanamaz');
ok(!(await rowText()).includes('Symposium'), 'rozet yok');

console.log('2) menüyü aç');
await openMenu();
ok(await symposiumAction('make').count() === 1, 'menüde "Make symposium editor" görünür');

console.log('3) rolü ver');
await symposiumAction('make').click();
await page.waitForTimeout(800);
console.log('   sunucuya giden:', JSON.stringify(actions));
ok(actions.includes('make_symposium'), 'make_symposium gönderildi');
ok((await rowText()).includes('Symposium'), 'rozet listede göründü');

console.log('4) geri al');
await openMenu();
ok(await symposiumAction('remove').count() === 1, 'menü artık "Remove" gösteriyor');
await symposiumAction('remove').click();
await page.waitForTimeout(800);
ok(actions.includes('remove_symposium'), 'remove_symposium gönderildi');
ok(!(await rowText()).includes('Symposium'), 'rozet kalktı');

await browser.close();
console.log(bad.length ? `\n${bad.length} SORUN:\n - ` + bad.join('\n - ') : '\nHEPSİ GEÇTİ');
process.exit(bad.length ? 1 : 0);
