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
    teams: ['Sosyal Medya', 'Bilimsel Program'] },
  { id: 'c2', sort: 1, name: 'Mehmet Tan', role: 'Design', roleTr: 'Tasarım',
    affiliation: 'ODTÜ', photo: '', linkedin: '', teams: [] },
];

let saved = null;
let uploaded = 0;

await page.route('**/api/admin/symposium/committee', async (r) => {
  if (r.request().method() === 'GET') {
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ year: 2026, items: committee }) });
  }
  saved = { method: 'POST', body: r.request().postDataJSON() };
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rebuild: { triggered: false, detail: '' } }) });
});
await page.route('**/api/admin/symposium/committee/*', async (r) => {
  saved = { method: r.request().method(), body: r.request().postDataJSON() };
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rebuild: { triggered: false, detail: '' } }) });
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
ok(rows[0][3] === 'Sosyal Medya, Bilimsel Program', 'iki ekipli üyenin ekipleri tabloda');
ok(rows[1][3] === '', 'ekipsiz üyenin hücresi boş');

console.log('2) datalist kullanımdaki ekipleri öneriyor');
const options = await page.$$eval('#symCommitteeTeamOptions option', (os) => os.map((o) => o.value));
console.log('   ', JSON.stringify(options));
ok(options.length === 2 && options.includes('Sosyal Medya'), 'öneriler dolu');

console.log('3) düzenle — ekipler ve fotoğraf forma yükleniyor');
await page.click('#symCommitteeTableBody tr:first-child .edit-committee-btn');
const filled = await page.evaluate(() => ({
  teams: document.getElementById('symCommitteeTeams').value,
  photo: document.getElementById('symCommitteePhoto').value,
  previewHidden: document.getElementById('symCommitteePhotoPreview').classList.contains('hidden'),
  editId: document.getElementById('symCommitteeEditId').value,
}));
console.log('   ', JSON.stringify(filled));
ok(filled.teams === 'Sosyal Medya, Bilimsel Program', 'ekipler alanı virgüllü dolu');
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
await page.fill('#symCommitteeTeams', 'Sosyal Medya , , grafik tasarım');
await page.click('#symCommitteeForm button[type=submit]');
await page.waitForFunction(() => !!window.__unused || true);
await page.waitForTimeout(600);
console.log('   ', JSON.stringify(saved));
ok(saved?.method === 'PUT', 'düzenleme PUT ile gitti');
ok(JSON.stringify(saved?.body?.teams) === '["Sosyal Medya","grafik tasarım"]', 'boş etiket düşürüldü, dizi gönderildi');
ok(saved?.body?.photo === 'https://cdn.example.org/uploaded.webp', 'yüklenen fotoğraf kaydedildi');

console.log('6) kaydettikten sonra form temizlendi — önizleme bir öncekini göstermiyor');
const afterSave = await page.evaluate(() => ({
  teams: document.getElementById('symCommitteeTeams').value,
  photo: document.getElementById('symCommitteePhoto').value,
  previewHidden: document.getElementById('symCommitteePhotoPreview').classList.contains('hidden'),
  status: document.getElementById('symCommitteePhotoStatus').textContent,
}));
console.log('   ', JSON.stringify(afterSave));
ok(afterSave.teams === '' && afterSave.photo === '', 'alanlar boşaldı');
ok(afterSave.previewHidden, 'önizleme gizlendi');
ok(afterSave.status === '', 'durum satırı temizlendi');

console.log('7) yükleme reddedilirse sunucunun mesajı gösteriliyor, URL bozulmuyor');
await page.unroute('**/api/blog-submissions/upload-image');
await page.route('**/api/blog-submissions/upload-image', (r) =>
  r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Image too large (max 5MB)' }) }));
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
ok(afterFail.photo === '', 'başarısız yükleme URL alanına bir şey yazmadı');
ok(!afterFail.disabled, 'dosya girdisi yeniden denenebilir durumda');

await browser.close();
console.log(bad.length ? `\n${bad.length} SORUN:\n - ` + bad.join('\n - ') : '\nHEPSİ GEÇTİ');
process.exit(bad.length ? 1 : 0);
