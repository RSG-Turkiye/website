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
 * CHROME=<path to a Chrome binary> uses that browser instead of Playwright's own.
 *
 * Every call is intercepted, so this grants nothing to anybody real.
 *
 * Part 5 covers grants that end: a chip shows its end date, the add flow
 * offers only the durations the server accepts for that role, and the chosen
 * duration is what the PATCH carries.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
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
const bodies = [];
await page.route('**/api/admin/users**', async (r) => {
  if (r.request().method() === 'GET') {
    const url = new URL(r.request().url());
    const roles = url.searchParams.get('filter') === 'roles';
    const q = (url.searchParams.get('search') ?? '').toLowerCase();
    const list = roles ? [...users, ...holders].filter((u) => u.is_writer || u.is_symposium || u.is_admin)
      : [...users, ...holders].filter((u) => !q || `${u.email} ${u.display_name}`.toLowerCase().includes(q));
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ users: list, badge_catalog: [] }) });
  }
  const body = r.request().postDataJSON();
  actions.push(body.action);
  bodies.push(body);
  if (body.action === 'make_symposium') users[0].is_symposium = 1;
  if (body.action === 'remove_symposium') users[0].is_symposium = 0;
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
});
// Role holders for the Roles tab, with live grants as the server sends them.
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;
const holders = [
  { id: 'u3', email: 'yazar@example.org', display_name: 'Yazar Kişi', is_member: 1, is_writer: 1, created_at: 1,
    grants: [{ role: 'writer', expires_at: NOW + 20 * DAY }] },
  { id: 'u4', email: 'yakinda@example.org', display_name: 'Süresi Yakın', is_member: 1, is_writer: 1, created_at: 1,
    grants: [{ role: 'writer', expires_at: NOW + 3 * DAY }] },
  { id: 'u5', email: 'kalici@example.org', display_name: 'Kalıcı Admin', is_member: 1, is_admin: 1, created_at: 1,
    grants: [{ role: 'admin', expires_at: null }] },
];
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

console.log('5) süreli yetkiler (Yetkiler sekmesi)');
bodies.length = 0; // parts 3 and 4 sent their own
await page.goto(BASE + '/admin#kullanicilar/yetkiler', { waitUntil: 'networkidle' });
await page.waitForSelector('#rolesView [data-role-card="is_writer"] [data-person="u3"]');
const chipText = (card, id) => page.textContent(`#rolesView [data-role-card="${card}"] [data-person="${id}"]`).then((s) => (s ?? '').replace(/\s+/g, ' '));
const istanbulDay = (ts) => new Date(ts * 1000).toLocaleDateString('en-GB', { day: 'numeric', timeZone: 'Europe/Istanbul' });
const writerChip = await chipText('is_writer', 'u3');
ok(/\d/.test(writerChip) && writerChip.includes(istanbulDay(NOW + 20 * DAY)), `bitiş tarihi çipte görünür: "${writerChip.trim()}"`);
const adminChip = await chipText('is_admin', 'u5');
ok(!/\d/.test(adminChip), `süresiz yetkide tarih yok: "${adminChip.trim()}"`);
ok(await page.locator('#rolesView [data-role-card="is_writer"] [data-person="u4"][data-ends-soon]').count() === 1, '7 gün içinde biten çip amber');
ok(await page.locator('#rolesView [data-role-card="is_writer"] [data-person="u3"][data-ends-soon]').count() === 0, '20 gün kalan çip amber değil');
ok(await page.locator('#rolesView [data-role-card="is_writer"] [data-person="u3"] [data-renew]').count() === 1, 'süreli çipte Yenile var');
ok(await page.locator('#rolesView [data-role-card="is_admin"] [data-person="u5"] [data-renew]').count() === 0, 'süresiz çipte Yenile yok');

// Opens the add box of a card, searches and picks the first match.
async function pick(card, q, id) {
  await page.click(`#rolesView [data-role-card="${card}"] [data-add-role]`);
  await page.fill(`#rolesView [data-role-card="${card}"] [data-add-input]`, q);
  await page.waitForSelector(`#rolesView [data-role-card="${card}"] [data-add-user="${id}"]`);
  await page.click(`#rolesView [data-role-card="${card}"] [data-add-user="${id}"]`);
  await page.waitForSelector(`#rolesView [data-role-card="${card}"] [data-duration]`, { timeout: 3000 }).catch(() => {});
}
const options = (card) => page.$$eval(`#rolesView [data-role-card="${card}"] [data-duration] option`, (os) => os.map((o) => o.value));
const ymd = (ts) => new Date(ts * 1000).toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });

await pick('is_writer', 'organiser', 'u2');
ok(bodies.length === 0, 'sonuca tıklamak henüz bir şey göndermez');
const writerOpts = await options('is_writer');
ok(JSON.stringify(writerOpts) === JSON.stringify(['1', 'date']), `yazar için yalnız 1 ay ve tarih: ${JSON.stringify(writerOpts)}`);
ok(await page.$eval('#rolesView [data-role-card="is_writer"] [data-duration]', (s) => s.value) === '1', 'yazar için varsayılan 1 ay');
await page.selectOption('#rolesView [data-role-card="is_writer"] [data-duration]', 'date');
const until = page.locator('#rolesView [data-role-card="is_writer"] [data-until]');
ok(await until.isVisible(), 'tarih seçilince tarih alanı görünür');
const max = await until.getAttribute('max');
const monthAway = new Date((NOW + 3 * 3600) * 1000);
monthAway.setUTCMonth(monthAway.getUTCMonth() + 1);
const expectedMax = monthAway.toISOString().slice(0, 10);
ok(max === expectedMax || max === ymd(NOW + 31 * DAY) || max === ymd(NOW + 30 * DAY), `tarih en çok bir ay sonrası: max=${max}, beklenen ${expectedMax}`);
ok(max < ymd(NOW + 32 * DAY), 'tarih bir aydan uzağa gitmez');
// The latest date offered must be one the server accepts: the rule in
// functions/_lib/roles.ts (addMonths in Türkiye time, keeping the hour).
await page.click('#rolesView [data-role-card="is_writer"] [data-picker-confirm]');
for (let i = 0; i < 60 && !bodies.length; i++) await new Promise((r) => setTimeout(r, 50));
const sent = bodies[0]?.duration?.until;
const TR = 3 * 3600;
const d0 = new Date((NOW + TR) * 1000);
const last = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 2, 0)).getUTCDate();
const limit = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, Math.min(d0.getUTCDate(), last),
  d0.getUTCHours(), d0.getUTCMinutes(), d0.getUTCSeconds()) / 1000 - TR;
ok(typeof sent === 'number' && sent > NOW && sent <= limit && ymd(sent) === max,
  `en geç tarih sunucunun kabul edeceği gün başı: until=${sent} (${sent && new Date(sent * 1000).toISOString()}), sınır ${limit}`);
bodies.length = 0;

await pick('is_symposium', 'organiser', 'u2');
const sympOpts = await options('is_symposium');
ok(JSON.stringify(sympOpts) === JSON.stringify(['1', '2', '3', '6', '12', 'date', 'permanent']), `sempozyum için tüm süreler: ${JSON.stringify(sympOpts)}`);
ok(await page.$eval('#rolesView [data-role-card="is_symposium"] [data-duration]', (s) => s.value) === 'permanent', 'liderlik yetkisinde varsayılan Süresiz');
await page.selectOption('#rolesView [data-role-card="is_symposium"] [data-duration]', '3');
await page.click('#rolesView [data-role-card="is_symposium"] [data-picker-confirm]');
for (let i = 0; i < 60 && !bodies.length; i++) await new Promise((r) => setTimeout(r, 50));
ok(JSON.stringify(bodies[0]) === JSON.stringify({ user_id: 'u2', action: 'make_symposium', duration: { months: 3 } }),
  `3 ay ile ekleme gönderir: ${JSON.stringify(bodies[0])}`);

console.log('6) yenile');
await page.waitForSelector('#rolesView [data-role-card="is_writer"] [data-person="u3"] [data-renew]');
await page.click('#rolesView [data-role-card="is_writer"] [data-person="u3"] [data-renew]');
await page.waitForSelector('#rolesView [data-role-card="is_writer"] [data-duration]', { timeout: 3000 }).catch(() => {});
ok(JSON.stringify(await options('is_writer')) === JSON.stringify(['1', 'date']), 'yenilemede de yalnız 1 ay ve tarih');
await page.click('#rolesView [data-role-card="is_writer"] [data-picker-confirm]');
for (let i = 0; i < 60 && bodies.length < 2; i++) await new Promise((r) => setTimeout(r, 50));
ok(JSON.stringify(bodies[1]) === JSON.stringify({ user_id: 'u3', action: 'make_writer', duration: { months: 1 } }),
  `yenile aynı kuralla gönderir: ${JSON.stringify(bodies[1])}`);

console.log('7) sunucunun 400 kodu son sözdür');
await page.route('**/api/admin/users**', (r) => r.request().method() === 'PATCH'
  ? r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid duration', code: 'too_long' }) })
  : r.fallback());
await page.click('#rolesView [data-role-card="is_writer"] [data-person="u4"] [data-renew]');
await page.click('#rolesView [data-role-card="is_writer"] [data-picker-confirm]');
const toast = await page.waitForSelector('#toastStack [role="alert"]', { timeout: 3000 }).then((e) => e.textContent()).catch(() => '');
ok(!!toast && toast !== 'Invalid duration', `ret iletisi çevrilmiş olarak gösterilir: "${toast}"`);
ok(await page.locator('#rolesView [data-role-card="is_writer"] [data-picker-confirm]').isEnabled(), 'ret sonrası düğme yeniden kullanılabilir');

console.log('8) Türkçe çip');
await page.goto(BASE + '/tr/admin#kullanicilar/yetkiler', { waitUntil: 'networkidle' });
await page.waitForSelector('#rolesView [data-role-card="is_writer"] [data-person="u3"]');
const trChip = await chipText('is_writer', 'u3');
ok(/\d+ \S+'y?[ae] kadar/.test(trChip), `tarih Türkçe ekle yazılır: "${trChip.trim()}"`);

await browser.close();
console.log(bad.length ? `\n${bad.length} SORUN:\n - ` + bad.join('\n - ') : '\nHEPSİ GEÇTİ');
process.exit(bad.length ? 1 : 0);
