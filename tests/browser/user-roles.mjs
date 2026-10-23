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
const usersRoute = async (r) => {
  if (r.request().method() === 'GET') {
    const url = new URL(r.request().url());
    const roles = url.searchParams.get('filter') === 'roles';
    const q = (url.searchParams.get('search') ?? '').toLowerCase();
    const list = roles ? [...users, ...holders].filter((u) => u.is_writer || u.is_symposium || u.is_admin || u.grants?.some((g) => g.role.startsWith('content.')))
      : [...users, ...holders].filter((u) => !q || `${u.email} ${u.display_name}`.toLowerCase().includes(q));
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ users: list, badge_catalog: [] }) });
  }
  const body = r.request().postDataJSON();
  actions.push(body.action);
  bodies.push(body);
  if (body.action === 'make_symposium') users[0].is_symposium = 1;
  if (body.action === 'remove_symposium') users[0].is_symposium = 0;
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true }) });
};
await page.route('**/api/admin/users**', usersRoute);
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
  // Picked as a date: ends at 00:00 Istanbul, ten days on.
  // A content role has no is_* column: only its grant says who holds it.
  { id: 'u7', email: 'etkinlik@example.org', display_name: 'Etkinlik Editörü', is_member: 1, created_at: 1,
    grants: [{ role: 'content.etkinlikler.edit', expires_at: NOW + 20 * DAY }] },
  { id: 'u6', email: 'tarihli@example.org', display_name: 'Tarihli Lider', is_member: 1, is_symposium: 1, created_at: 1,
    grants: [{ role: 'symposium', expires_at: Math.floor((NOW + 3 * 3600) / DAY) * DAY - 3 * 3600 + 10 * DAY }] },
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
const u6End = holders.find((h) => h.id === 'u6').grants[0].expires_at;
ok(await page.locator('#rolesView [data-role-card="content.etkinlikler.edit"] [data-person="u7"]').count() === 1, 'Etkinlikler düzenleyici kartı, sütunu olmayan yetkiyi gösterir');
ok(await page.locator('#rolesView [data-role-card="content.etkinlikler.approve"]').count() === 1, 'Etkinlikler onaylayıcı kartı var');
const u6Chip = await chipText('is_symposium', 'u6');
ok(u6Chip.includes(` ${istanbulDay(u6End - 1)} `) && !u6Chip.includes(` ${istanbulDay(u6End)} `),
  `gece yarısı biten yetki son günü gösterir (${istanbulDay(u6End - 1)}): "${u6Chip.trim()}"`);
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
const min = await until.getAttribute('min');
// The server's limit: addMonths(now, 1) in Türkiye time, keeping the hour
// (functions/_lib/roles.ts). A picked date is inclusive, so it is sent as
// 00:00 of the next day, and the last date offered is the last whose next
// midnight is within the limit.
const TR = 3 * 3600;
const d0 = new Date((NOW + TR) * 1000);
const lastOfNext = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 2, 0)).getUTCDate();
const limit = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + 1, Math.min(d0.getUTCDate(), lastOfNext),
  d0.getUTCHours(), d0.getUTCMinutes(), d0.getUTCSeconds()) / 1000 - TR;
ok(max === ymd(limit - DAY), `en geç tarih izin verilen son gün: max=${max}, beklenen ${ymd(limit - DAY)}`);
ok(min === ymd(NOW), `en erken tarih bugün: min=${min}`);
await page.click('#rolesView [data-role-card="is_writer"] [data-picker-confirm]');
for (let i = 0; i < 60 && !bodies.length; i++) await new Promise((r) => setTimeout(r, 50));
const sent = bodies[0]?.duration?.until;
ok(typeof sent === 'number' && sent > NOW && sent <= limit, `sunucu kabul eder: until=${sent} <= ${limit}`);
ok(typeof sent === 'number' && ymd(sent - 1) === max && ymd(sent) !== max && (sent + TR) % DAY === 0,
  `seçilen gün dahil: ertesi günün 00:00'ı gider (${sent && new Date(sent * 1000).toISOString()})`);
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

await page.waitForSelector('#rolesView [data-role-card="is_symposium"] [data-person="u6"] [data-renew]');
await page.click('#rolesView [data-role-card="is_symposium"] [data-person="u6"] [data-renew]');
await page.waitForSelector('#rolesView [data-role-card="is_symposium"] [data-renew-slot] [data-duration]');
const renewSel = '#rolesView [data-role-card="is_symposium"] [data-renew-slot]';
ok(await page.$eval(`${renewSel} [data-duration]`, (x) => x.value) === '12', 'süreli lider yetkisini yenilerken 12 ay seçili, Süresiz değil');
ok((await page.$$eval(`${renewSel} [data-duration] option`, (os) => os.map((o) => o.value))).includes('permanent'), 'Süresiz yine seçilebilir');
await page.selectOption(`${renewSel} [data-duration]`, 'date');
await page.fill(`${renewSel} [data-until]`, ymd(NOW));
ok(await page.locator(`${renewSel} [data-picker-confirm]`).isDisabled(), 'şimdiki bitişten erken bir tarihte Yenile kapalı');
ok(await page.locator(`${renewSel} [data-not-later]`).isVisible(), 'nedenini söyler');
await page.selectOption(`${renewSel} [data-duration]`, '1');
ok(await page.locator(`${renewSel} [data-picker-confirm]`).isEnabled(), 'daha geç bir bitişte Yenile açılır');
await page.click(`${renewSel} [data-picker-cancel]`);

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
const trMonth = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'][Number(ymd(NOW + 20 * DAY - 1).slice(5, 7)) - 1];
ok(new RegExp(`\\d+ ${trMonth}'[ae] kadar`).test(trChip), `tarih tam ay adı ve ekle yazılır (${trMonth}): "${trChip.trim()}"`);

console.log('9) admin olmayan onaylayıcı yalnız kendi grubunun düzenleyici kartını görür');
const ap = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
ap.on('pageerror', (e) => bad.push('pageerror (onaylayıcı): ' + String(e).slice(0, 150)));
await ap.route('**/api/me', json({ user: { id: 'u8', email: 'onay@example.org', is_admin: false,
  grants: [{ role: 'content.etkinlikler.approve', expires_at: null }] }, profile: {} }));
await ap.route('**/api/admin/users**', usersRoute);
bodies.length = 0;
await ap.goto(BASE + '/admin#kullanicilar/yetkiler', { waitUntil: 'networkidle' });
await ap.waitForSelector('#rolesView [data-role-card]', { timeout: 5000 }).catch(() => {});
const apCards = await ap.$$eval('#rolesView [data-role-card]', (cs) => cs.map((c) => c.getAttribute('data-role-card')));
ok(JSON.stringify(apCards) === JSON.stringify(['content.etkinlikler.edit']), `yalnız Etkinlikler düzenleyici kartı: ${JSON.stringify(apCards)}`);
ok(await ap.locator('#rolesView [data-person="u7"]').count() === 1, 'mevcut düzenleyici listelenir');
const apCard = '#rolesView [data-role-card="content.etkinlikler.edit"]';
await ap.click(`${apCard} [data-add-role]`);
await ap.fill(`${apCard} [data-add-input]`, 'organiser');
await ap.click(`${apCard} [data-add-user="u2"]`);
await ap.waitForSelector(`${apCard} [data-duration]`, { timeout: 3000 }).catch(() => {});
const apOpts = await ap.$$eval(`${apCard} [data-duration] option`, (os) => os.map((o) => o.value));
ok(JSON.stringify(apOpts) === JSON.stringify(['1', 'date']), `onaylayıcıya yalnız 1 ay ve tarih: ${JSON.stringify(apOpts)}`);
await ap.click(`${apCard} [data-picker-confirm]`);
for (let i = 0; i < 60 && !bodies.length; i++) await new Promise((r) => setTimeout(r, 50));
ok(JSON.stringify(bodies[0]) === JSON.stringify({ user_id: 'u2', action: 'make_content.etkinlikler.edit', duration: { months: 1 } }),
  `onaylayıcı 1 aylık düzenleyici ekler: ${JSON.stringify(bodies[0])}`);
const apUsersTabs = await ap.$$eval('[data-sub-link], a[href*="#kullanicilar/"]', (as) => as.map((a) => a.getAttribute('href') ?? a.textContent).filter((h) => h && h.includes('kullanicilar/liste')));
ok(apUsersTabs.length === 0, `kullanıcı listesi sekmesi yok: ${JSON.stringify(apUsersTabs)}`);

await browser.close();
console.log(bad.length ? `\n${bad.length} SORUN:\n - ` + bad.join('\n - ') : '\nHEPSİ GEÇTİ');
process.exit(bad.length ? 1 : 0);
