/**
 * The committee form, driven in a real browser, signed in.
 *
 * The admin panel is behind auth and is written entirely by script after a
 * fetch, so `astro check` and the build say nothing about it -- and the last
 * time a change here was called done on the strength of a build passing, it
 * shipped a header that vanished for every signed-in user.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npm run preview &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/committee-admin.mjs
 *
 * Every API call is intercepted, so this touches no real database and
 * uploads nothing: what is being checked is the panel's own behaviour --
 * that teams load into the form and come back out in the request body, and
 * that choosing a file uploads it and puts the URL where the save reads it.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4321';
const bad = [];
const ok = (cond, msg) => { console.log(`   ${cond ? '✓' : '✗'} ${msg}`); if (!cond) bad.push(msg); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => bad.push('pageerror: ' + String(e).slice(0, 160)));

// A symposium organiser, which is the account this feature is for -- not an
// admin, so this also exercises the widened upload gate.
await page.route('**/api/me', (r) => r.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ user: { id: 'u1', email: 'organiser@example.org', is_symposium: true }, profile: {} }),
}));

let committee = [
  { id: 'c1', sort: 0, name: 'Ayşe Kaya', role: 'Social Media', roleTr: 'Sosyal Medya',
    affiliation: 'GTÜ', photo: 'https://example.org/ayse.jpg', linkedin: '',
    teams: ['Social Media', 'Scientific Program'], teamsTr: ['Sosyal Medya', 'Bilimsel Program'] },
  { id: 'c2', sort: 1, name: 'Mehmet Tan', role: 'Design', roleTr: 'Tasarım',
    affiliation: 'ODTÜ', photo: '', linkedin: '', teams: [], teamsTr: [] },
];

let saved = null;
let uploaded = 0;

await page.route('**/api/admin/symposium/committee', async (r) => {
  if (r.request().method() === 'GET') {
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ year: 2026, items: committee }) });
  }
  saved = { method: 'POST', body: r.request().postDataJSON() };
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rebuild: { state: 'started', detail: 'rebuild started' } }) });
});
let saves = 0;
await page.route('**/api/admin/symposium/committee/*', async (r) => {
  saves++;
  saved = { method: r.request().method(), body: r.request().postDataJSON() };
  // Slow, so a second click has time to land if the button is not disabled.
  await new Promise((done) => setTimeout(done, 700));
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rebuild: { state: 'queued', detail: 'a build was already queued' } }) });
});
await page.route('**/api/admin/symposium/edition', (r) => r.fulfill({
  contentType: 'application/json', body: JSON.stringify({ year: 2026, edition: {} }) }));
for (const kind of ['speakers', 'sessions']) {
  await page.route(`**/api/admin/symposium/${kind}`, (r) => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({ year: 2026, items: [] }) }));
}
await page.route('**/api/blog-submissions/upload-image', (r) => {
  uploaded++;
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://cdn.example.org/uploaded.webp' }) });
});

console.log('1) sempozyum yetkilisi olarak /admin — komite tablosu ekipleri gösteriyor');
await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await page.waitForSelector('#symCommitteeTableBody tr');
const rows = await page.$$eval('#symCommitteeTableBody tr', (trs) =>
  trs.map((tr) => [...tr.querySelectorAll('td')].slice(0, 4).map((td) => td.textContent.trim())));
console.log('   ', JSON.stringify(rows));
ok(rows[0][3] === 'Social Media, Scientific Program',
  `İngilizce panel İngilizce adları gösteriyor (gelen: ${rows[0][3]})`);
ok(rows[1][3] === '', 'ekipsiz üyenin hücresi boş');

console.log('2) her iki dil alanı da kullanımdaki ekipleri öneriyor');
const options = await page.evaluate(() => ({
  en: [...document.querySelectorAll('#symCommitteeTeamOptions option')].map((o) => o.value),
  tr: [...document.querySelectorAll('#symCommitteeTeamTrOptions option')].map((o) => o.value),
}));
console.log('   ', JSON.stringify(options));
ok(JSON.stringify(options.en) === '["Social Media","Scientific Program"]', 'İngilizce öneriler');
ok(JSON.stringify(options.tr) === '["Sosyal Medya","Bilimsel Program"]', 'Türkçe öneriler');

console.log('3) düzenle — ekipler ve fotoğraf forma yükleniyor');
await page.click('#symCommitteeTableBody tr:first-child .edit-committee-btn');
const filled = await page.evaluate(() => ({
  teams: document.getElementById('symCommitteeTeams').value,
  teamsTr: document.getElementById('symCommitteeTeamsTr').value,
  photo: document.getElementById('symCommitteePhoto').value,
  previewHidden: document.getElementById('symCommitteePhotoPreview').classList.contains('hidden'),
  editId: document.getElementById('symCommitteeEditId').value,
}));
console.log('   ', JSON.stringify(filled));
ok(filled.teams === 'Social Media, Scientific Program', 'İngilizce ekipler alanı dolu');
ok(filled.teamsTr === 'Sosyal Medya, Bilimsel Program', 'Türkçe ekipler alanı dolu');
ok(filled.previewHidden === false, 'mevcut fotoğrafın önizlemesi görünür');

console.log('4) dosya seç — yükleniyor ve URL alanına yazılıyor');
// A real 1x1 PNG, so nothing about the browser side is faked.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
await page.setInputFiles('#symCommitteePhotoFile', { name: 'ayse.png', mimeType: 'image/png', buffer: png });
await page.waitForFunction(() =>
  document.getElementById('symCommitteePhoto').value.startsWith('https://cdn.example.org/'), null, { timeout: 5000 })
  .catch(() => {});
const afterUpload = await page.evaluate(() => ({
  photo: document.getElementById('symCommitteePhoto').value,
  status: document.getElementById('symCommitteePhotoStatus').textContent,
  preview: document.getElementById('symCommitteePhotoPreview').getAttribute('src'),
  fileCleared: document.getElementById('symCommitteePhotoFile').value === '',
}));
console.log('   ', JSON.stringify(afterUpload), 'uploads:', uploaded);
ok(uploaded === 1, 'yükleme uç noktası bir kez çağrıldı');
ok(afterUpload.photo === 'https://cdn.example.org/uploaded.webp', 'dönen URL alana yazıldı');
ok(afterUpload.preview === 'https://cdn.example.org/uploaded.webp', 'önizleme yeni fotoğrafı gösteriyor');
ok(afterUpload.fileCleared, 'dosya girdisi temizlendi (aynı dosya yeniden denenebilir)');

console.log('5) kaydet — ekipler dizi olarak, fotoğraf yüklenen URL olarak gidiyor');
await page.fill('#symCommitteeTeams', 'Social Media , , graphic design');
await page.fill('#symCommitteeTeamsTr', 'Sosyal Medya, Grafik Tasarım');
// Twice, deliberately: the button must be disabled by the time the second
// click lands, so only one write happens.
await page.click('#symCommitteeForm button[type=submit]');
await page.click('#symCommitteeForm button[type=submit]', { force: true }).catch(() => {});
await page.waitForTimeout(1400);
console.log('   ', JSON.stringify(saved));
ok(saved?.method === 'PUT', 'düzenleme PUT ile gitti');
ok(JSON.stringify(saved?.body?.teams) === '["Social Media","graphic design"]', 'boş İngilizce etiket düşürüldü');
ok(JSON.stringify(saved?.body?.teamsTr) === '["Sosyal Medya","Grafik Tasarım"]', 'Türkçe liste dizi olarak gitti');
ok(saved?.body?.photo === 'https://cdn.example.org/uploaded.webp', 'yüklenen fotoğraf kaydedildi');

console.log('5b) kaydet düğmesi kayıt sürerken kilitli, ve 304 bir hata gibi gösterilmiyor');
console.log('   ', JSON.stringify({ saves, status: await page.textContent('#symCommitteeStatus') }));
ok(saves === 1, `tek tıklama tek yazma yaptı (gelen: ${saves})`);
ok(!/not rebuilt|nightly|yeniden derlenmedi|gecelik/i.test(await page.textContent('#symCommitteeStatus')),
  'sıraya alınmış derleme hata gibi gösterilmiyor');

console.log('6) kaydettikten sonra form temizlendi — önizleme bir öncekini göstermiyor');
const afterSave = await page.evaluate(() => ({
  teams: document.getElementById('symCommitteeTeams').value + document.getElementById('symCommitteeTeamsTr').value,
  photo: document.getElementById('symCommitteePhoto').value,
  previewHidden: document.getElementById('symCommitteePhotoPreview').classList.contains('hidden'),
  status: document.getElementById('symCommitteePhotoStatus').textContent,
}));
console.log('   ', JSON.stringify(afterSave));
ok(afterSave.teams === '' && afterSave.photo === '', 'alanlar boşaldı');
ok(afterSave.previewHidden, 'önizleme gizlendi');
ok(afterSave.status === '', 'durum satırı temizlendi');

console.log('7) sayıları uyuşmayan iki liste — sunucunun mesajı kullanıcıya ulaşıyor');
// The count check lives on the server, so this asserts the panel surfaces
// its message rather than swallowing it behind a generic error.
saved = null;
await page.unroute('**/api/admin/symposium/committee/*');
await page.route('**/api/admin/symposium/committee/*', (r) => {
  saved = { method: r.request().method(), body: r.request().postDataJSON() };
  return r.fulfill({ status: 400, contentType: 'application/json',
    body: JSON.stringify({ error: '2 team name(s) in English and 1 in Turkish: the two lists are matched one to one and in order, so give a Turkish name for every team or leave Turkish empty' }) });
});
await page.click('#symCommitteeTableBody tr:first-child .edit-committee-btn');
await page.fill('#symCommitteeTeams', 'Social Media, Scientific Program');
await page.fill('#symCommitteeTeamsTr', 'Sosyal Medya');
await page.click('#symCommitteeForm button[type=submit]');
await page.waitForTimeout(700);
const mismatch = await page.evaluate(() => ({
  toast: document.body.innerText.includes('matched one to one'),
  teams: document.getElementById('symCommitteeTeams').value,
}));
console.log('   ', JSON.stringify({ ...mismatch, sentTr: saved?.body?.teamsTr }));
ok(JSON.stringify(saved?.body?.teamsTr) === '["Sosyal Medya"]', 'kısmi Türkçe liste olduğu gibi gönderildi');
ok(mismatch.toast, 'sunucunun sayı uyuşmazlığı mesajı gösterildi');
ok(mismatch.teams === 'Social Media, Scientific Program', 'reddedilen kayıtta form temizlenmedi');

console.log('8) yükleme reddedilirse sunucunun mesajı gösteriliyor, URL bozulmuyor');
await page.unroute('**/api/blog-submissions/upload-image');
await page.route('**/api/blog-submissions/upload-image', (r) =>
  r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Image too large (max 5MB)' }) }));
const urlBefore = await page.inputValue('#symCommitteePhoto');
await page.setInputFiles('#symCommitteePhotoFile', { name: 'big.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(900);
const afterFail = await page.evaluate(() => ({
  photo: document.getElementById('symCommitteePhoto').value,
  toast: document.body.innerText.includes('Image too large (max 5MB)'),
  status: document.getElementById('symCommitteePhotoStatus').textContent,
  disabled: document.getElementById('symCommitteePhotoFile').disabled,
}));
console.log('   ', JSON.stringify(afterFail));
ok(afterFail.toast, 'sunucunun kendi mesajı gösterildi');
ok(afterFail.photo === urlBefore, `başarısız yükleme mevcut URL'i bozmadı (${urlBefore || 'boş'})`);
ok(!afterFail.disabled, 'dosya girdisi yeniden denenebilir durumda');

console.log('9) yükleme biterken kaydet — fotoğraf kaybolmamalı');
// This is what lost a real committee member's photograph: the upload runs on
// choosing the file, the save used to read the URL field the instant it was
// pressed, and a save in those seconds stored an empty photo.
let slowUploads = 0;
await page.unroute('**/api/blog-submissions/upload-image');
await page.route('**/api/blog-submissions/upload-image', async (r) => {
  slowUploads++;
  await new Promise((done) => setTimeout(done, 1500));
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://cdn.example.org/late.webp' }) });
});
saved = null;
await page.unroute('**/api/admin/symposium/committee');
await page.route('**/api/admin/symposium/committee', async (r) => {
  if (r.request().method() === 'GET') {
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ year: 2026, items: committee }) });
  }
  saved = { method: 'POST', body: r.request().postDataJSON() };
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rebuild: { state: 'started', detail: '' } }) });
});

await page.click('#symCommitteeCancelBtn');
await page.fill('#symCommitteeName', 'Melih Koç');
await page.setInputFiles('#symCommitteePhotoFile', { name: 'melih.png', mimeType: 'image/png', buffer: png });
// Immediately -- long before the upload can finish.
await page.waitForTimeout(120);
await page.click('#symCommitteeForm button[type=submit]');
await page.waitForTimeout(3000);
console.log('   ', JSON.stringify({ ...saved?.body, teams: undefined, teamsTr: undefined }));
ok(slowUploads === 1, 'yükleme bir kez yapıldı');
ok(saved?.body?.name === 'Melih Koç', 'kayıt gitti');
ok(saved?.body?.photo === 'https://cdn.example.org/late.webp',
  `kayıt yüklemeyi bekledi (gelen foto: ${JSON.stringify(saved?.body?.photo)})`);

await browser.close();
console.log(bad.length ? `\n${bad.length} SORUN:\n - ` + bad.join('\n - ') : '\nHEPSİ GEÇTİ');
process.exit(bad.length ? 1 : 0);
