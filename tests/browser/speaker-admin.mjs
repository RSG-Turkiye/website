/**
 * The speaker form's photo upload, driven in a real browser, signed in.
 *
 * The speaker form had only a URL field -- the first 2026 speaker was saved
 * with a Google Drive share link, which is a page and not a picture. It now
 * shares the committee form's upload (see committee-admin.mjs); this checks
 * the speaker side of it, including the save waiting for a slow upload.
 *
 * Same setup as committee-admin.mjs:
 *
 *   npm run build && npm run preview &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/speaker-admin.mjs
 *
 * Every API call is intercepted; nothing real is read, saved or uploaded.
 */
import { chromium } from 'playwright';

const BASE = 'http://localhost:4321';
const bad = [];
const ok = (cond, msg) => { console.log(`   ${cond ? '✓' : '✗'} ${msg}`); if (!cond) bad.push(msg); };

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('pageerror', (e) => bad.push('pageerror: ' + String(e).slice(0, 160)));

await page.route('**/api/me', (r) => r.fulfill({
  contentType: 'application/json',
  body: JSON.stringify({ user: { id: 'u1', email: 'organiser@example.org', is_symposium: true }, profile: {} }),
}));

const DRIVE_ID = '1CobUlVv3wmcPikRfqmct_yJPaKrqTdJH';
const speakers = [
  { id: 's1', sort: 0, slug: 'tunca-dogan', name: 'Tunca Doğan', position: 'Prof. Dr.', company: 'Hacettepe',
    bio: 'Uzun bir biyografi.', photo: `https://drive.google.com/file/d/${DRIVE_ID}/view?usp=sharing`, linkedin: '' },
];

let saved = null;
let uploads = 0;
await page.route('**/api/admin/symposium/speakers', (r) => {
  if (r.request().method() === 'GET') {
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ year: 2026, items: speakers }) });
  }
  saved = { method: 'POST', body: r.request().postDataJSON() };
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rebuild: { state: 'started', detail: '' } }) });
});
await page.route('**/api/admin/symposium/speakers/*', (r) => {
  saved = { method: r.request().method(), body: r.request().postDataJSON() };
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ rebuild: { state: 'started', detail: '' } }) });
});
await page.route('**/api/admin/symposium/edition', (r) => r.fulfill({
  contentType: 'application/json', body: JSON.stringify({ year: 2026, edition: {} }) }));
for (const kind of ['sessions', 'committee']) {
  await page.route(`**/api/admin/symposium/${kind}`, (r) => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({ year: 2026, items: [] }) }));
}
await page.route('**/api/blog-submissions/upload-image', async (r) => {
  uploads++;
  // Slow, so the save below has to wait for it.
  await new Promise((done) => setTimeout(done, 1500));
  return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ url: 'https://cdn.example.org/speaker.webp' }) });
});

console.log('1) konuşmacı formunda dosya yükleme alanı var');
await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
await page.waitForSelector('#symSpeakersTableBody tr');
ok(await page.isVisible('#symSpeakerPhotoFile'), 'dosya seçme tuşu görünür');

console.log('2) düzenle — Drive linkli fotoğrafın önizlemesi doğrudan resim adresini kullanıyor');
await page.click('#symSpeakersTableBody tr:first-child .edit-speaker-btn');
const preview = await page.evaluate(() => {
  const img = document.getElementById('symSpeakerPhotoPreview');
  return { src: img.getAttribute('src'), hidden: img.classList.contains('hidden') };
});
console.log('   ', JSON.stringify(preview));
ok(!preview.hidden, 'önizleme görünür');
ok(preview.src === `https://lh3.googleusercontent.com/d/${DRIVE_ID}=w600`, 'önizleme Drive linkini resme çevirdi');

console.log('3) yeni konuşmacı: dosya seç ve hemen kaydet — kayıt yüklemeyi bekliyor');
await page.click('#symSpeakerCancelBtn');
const cleared = await page.evaluate(() => document.getElementById('symSpeakerPhotoPreview').classList.contains('hidden'));
ok(cleared, 'iptal önizlemeyi temizledi');
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64');
await page.fill('#symSpeakerName', 'Yeni Konuşmacı');
await page.setInputFiles('#symSpeakerPhotoFile', { name: 'yeni.png', mimeType: 'image/png', buffer: png });
await page.waitForTimeout(120);
await page.click('#symSpeakerForm button[type=submit]');
await page.waitForTimeout(3000);
console.log('   ', JSON.stringify(saved));
ok(uploads === 1, 'yükleme bir kez yapıldı');
ok(saved?.method === 'POST' && saved?.body?.name === 'Yeni Konuşmacı', 'kayıt gitti');
ok(saved?.body?.photo === 'https://cdn.example.org/speaker.webp',
  `kayıt yüklemeyi bekledi (gelen foto: ${JSON.stringify(saved?.body?.photo)})`);

await browser.close();
console.log(bad.length ? `\n${bad.length} SORUN:\n - ` + bad.join('\n - ') : '\nHEPSİ GEÇTİ');
process.exit(bad.length ? 1 : 0);
