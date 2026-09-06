/**
 * The podcast player, driven in a real browser.
 *
 * Not part of `npm test`: it needs Playwright and a running preview server,
 * and putting either in CI for one feature is a bigger dependency than the
 * feature. It lives here because the behaviour it checks cannot be checked any
 * other way -- whether audio survives a view transition is not a fact about
 * the built HTML, and I got it wrong from reasoning alone before measuring it.
 *
 * Run it when touching PodcastStrip, PodcastIndex, or <ClientRouter />:
 *
 *   npm run build && npm run preview &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/podcast.mjs
 *
 * What it establishes, on the real autoplay policy with real clicks:
 *   - nothing plays until something is pressed
 *   - the strip plays without leaving the page
 *   - there is never more than one player
 *
 * What it does NOT establish any more: that audio survives navigation. It did,
 * under <ClientRouter />, which was removed because it broke the signed-in
 * header -- DOMContentLoaded stops firing, and three scripts and the auth area
 * depend on it. The navigation steps below now record that the audio stops,
 * which is the truth today. When the router comes back, with those scripts
 * moved to astro:page-load and a test that signs in, these flip back.
 *   - /podcast switches episodes through the same player
 *   - pause and resume
 *   - crossing languages keeps the audio and moves the labels
 *   - dismissing stops it, and is remembered
 *   - the timeline seeks by click, drag and arrow key, and survives navigation
 */
import { chromium } from 'playwright';
const BASE = 'http://localhost:4321';
const browser = await chromium.launch();      // real autoplay policy
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const bad = [];
page.on('pageerror', e => bad.push('pageerror: ' + String(e).slice(0,140)));

const A = () => page.evaluate(() => {
  const a = document.getElementById('podcastAudio');
  const s = document.getElementById('podcastStrip');
  const t = document.getElementById('podcastTitle');
  const time = document.getElementById('podcastTime');
  return { audios: document.querySelectorAll('audio').length, hidden: s?.hidden,
           paused: a?.paused, t: a ? Number(a.currentTime.toFixed(1)) : null,
           title: t?.textContent?.slice(0,34), time: time?.textContent,
           playIcon: !document.getElementById('podcastIconPlay')?.classList.contains('hidden') };
});

console.log('1) ana sayfaya gir — hiçbir şey çalmamalı');
await page.goto(BASE + '/', { waitUntil: 'networkidle' });
await page.waitForTimeout(900);
let s = await A(); console.log('  ', JSON.stringify(s));
if (s.paused === false) bad.push('kendiliğinden çalmaya başladı');
if (s.audios !== 1) bad.push(`ana sayfada ${s.audios} audio elemanı`);

console.log('2) şeritteki düğmeye bas — sayfaya gitmeden çalmalı');
await page.click('#podcastToggle');
await page.waitForTimeout(2600);
s = await A(); console.log('  ', JSON.stringify(s));
if (s.paused !== false) bad.push('şeritten çalmadı');
if (s.playIcon) bad.push('çalarken hâlâ play ikonu görünüyor');

console.log('3) üç sayfa gez — ses kesilmemeli');
let prev = s.t;
for (const p of ['/about', '/blog', '/webinars']) {
  await page.locator(`a[href="${p}"]:visible`).first().click(); await page.waitForTimeout(1500);
  s = await A();
  console.log(`   ${p.padEnd(11)} ses ${s.t}s ${s.t > prev ? '↑' : 'DURDU'}  audio:${s.audios}`);
  // Not an assertion: without view transitions the audio stops here, and
  // that is the documented state of the feature rather than a regression.
  if (s.audios !== 1) bad.push(`${p} sayfasında ${s.audios} audio`);
  prev = s.t;
}

console.log('4) /podcast — başka bölüme geç');
await page.locator('a[href="/podcast"]:visible').first().click(); await page.waitForTimeout(1200);
s = await A(); console.log('   audio elemanı:', s.audios, '(1 olmalı)');
if (s.audios !== 1) bad.push(`/podcast sayfasında ${s.audios} audio`);
await page.locator('.episode-play').nth(2).click();
await page.waitForTimeout(2600);
s = await A(); console.log('  ', JSON.stringify(s));
if (s.paused) bad.push('bölüm düğmesi çalıştırmadı');
if (!s.title?.includes('İlk Ad')) bad.push('şeritteki başlık güncellenmedi: ' + s.title);

console.log('5) duraklat / devam et');
await page.click('#podcastToggle'); await page.waitForTimeout(600);
s = await A(); if (!s.paused) bad.push('duraklatmadı'); else console.log('   duraklattı ✓');
await page.click('#podcastToggle'); await page.waitForTimeout(1200);
s = await A(); if (s.paused) bad.push('devam ettirmedi'); else console.log('   devam etti ✓', s.t + 's');

console.log('6) Türkçeye geç — etiketler Türkçeleşmeli, ses sürmeli');
prev = s.t;
await page.locator('a[href="/tr/podcast"]:visible').first().click().catch(async () => {
  await page.evaluate(() => { const a=document.createElement('a'); a.href='/tr/podcast'; document.body.append(a); a.click(); });
});
await page.waitForTimeout(1800);
const trLabel = await page.evaluate(() => document.getElementById('podcastStrip')?.innerText?.replace(/\s+/g,' ').trim().slice(0, 40));
s = await A();
console.log(`   etiket: "${trLabel}"  ses: ${s.t}s ${s.t > prev ? '↑' : 'DURDU'}`);
if (!trLabel?.toLocaleLowerCase('tr').includes('son bölüm')) bad.push(`şerit etiketi Türkçeleşmedi: "${trLabel}"`);
if (s.paused || s.t <= prev) bad.push('dil değişiminde ses kesildi');

console.log('7) şeridi kapat — ses susmalı, hatırlanmalı');
await page.click('#podcastStripClose'); await page.waitForTimeout(600);
s = await A();
if (!s.hidden) bad.push('kapanmadı'); else console.log('   kapandı ✓, ses paused:', s.paused);
await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.waitForTimeout(900);
s = await A();
if (!s.hidden) bad.push('kapatma hatırlanmadı'); else console.log('   yeni sayfada da kapalı ✓');


// --- the timeline -----------------------------------------------------------

{


  const T = () => page.evaluate(() => {
    const a = document.getElementById('podcastAudio');
    const s = document.getElementById('podcastSeek');
    return { t: Number(a.currentTime.toFixed(1)), dur: Number((a.duration||0).toFixed(0)),
             paused: a.paused, disabled: s?.disabled, val: Number(Number(s?.value).toFixed(1)),
             max: Number(Number(s?.max).toFixed(0)),
             progress: s?.style.getPropertyValue('--progress'),
             valuetext: s?.getAttribute('aria-valuetext') };
  });

  await page.goto(BASE + '/podcast/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  console.log('1) hiçbir şey yüklenmemişken timeline devre dışı olmalı');
  let q = await T(); console.log('  ', JSON.stringify(q));
  if (!q.disabled) bad.push('yüklenmemişken timeline etkin');

  console.log('2) bölümü başlat');
  await page.locator('.episode-play').first().click();
  await page.waitForTimeout(3000);
  q = await T(); console.log('  ', JSON.stringify(q));
  if (q.disabled) bad.push('süre bilindiği hâlde timeline devre dışı');
  if (q.max < 3000) bad.push('max süreye ayarlanmadı: ' + q.max);
  if (!q.progress || q.progress === '0%') bad.push('kırmızı çizgi ilerlemiyor: ' + q.progress);
  if (!q.valuetext?.includes('/')) bad.push('aria-valuetext yok: ' + q.valuetext);

  console.log('3) çizginin ortasına tıkla — ileri atlamalı');
  const box = await page.locator('#podcastSeek').boundingBox();
  console.log('   kutu:', JSON.stringify({w: Math.round(box.width), h: Math.round(box.height), y: Math.round(box.y)}));
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await page.waitForTimeout(1200);
  q = await T(); console.log('  ', JSON.stringify(q));
  if (q.t < q.dur * 0.4 || q.t > q.dur * 0.6) bad.push(`ortaya atlamadı: ${q.t}/${q.dur}`);
  else console.log(`   ATLADI: ${q.t}s / ${q.dur}s (~%${Math.round(q.t/q.dur*100)})`);

  console.log('4) geri al — %20');
  await page.mouse.click(box.x + box.width * 0.2, box.y + box.height / 2);
  await page.waitForTimeout(1200);
  q = await T();
  if (q.t > q.dur * 0.3) bad.push(`geri alamadı: ${q.t}`);
  else console.log(`   GERİ ALDI: ${q.t}s (~%${Math.round(q.t/q.dur*100)})`);

  console.log('5) klavye: ok tuşuyla ilerlet');
  await page.locator('#podcastSeek').focus();
  const beforeKey = (await T()).t;
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  q = await T();
  if (q.t < beforeKey + 25) bad.push(`ok tuşu 10sn adımlarla ilerletmedi: ${beforeKey} -> ${q.t}`);
  else console.log(`   KLAVYE ÇALIŞTI: ${beforeKey}s -> ${q.t}s`);

  console.log('6) sürükle — timeupdate elden çekmemeli');
  await page.mouse.move(box.x + box.width * 0.7, box.y + box.height / 2);
  await page.mouse.down();
  for (const f of [0.72, 0.75, 0.78, 0.8]) { await page.mouse.move(box.x + box.width * f, box.y + box.height/2); await page.waitForTimeout(180); }
  const during = await T();
  await page.mouse.up();
  await page.waitForTimeout(600);
  q = await T();
  console.log(`   sürükleme sırasında ${during.t}s, bırakınca ${q.t}s`);
  if (Math.abs(q.t - during.t) > 3) bad.push(`bırakınca konum kaydı: ${during.t} -> ${q.t}`);
  if (q.t < q.dur * 0.7) bad.push(`sürükleme hedefe götürmedi: ${q.t}/${q.dur}`);

  console.log('7) gezindikten sonra timeline hâlâ doğru');
  await page.locator('a[href$="/blog"]:visible').first().click();
  await page.waitForTimeout(1600);
  q = await T(); console.log('  ', JSON.stringify(q));
  if (q.disabled) bad.push('gezinmeden sonra timeline devre dışı kaldı');
  if (q.max < 3000) bad.push('gezinmeden sonra max sıfırlandı');
  if (!q.progress || parseFloat(q.progress) < 60) bad.push('gezinmeden sonra ilerleme kayboldu: ' + q.progress);



}

console.log('\n=== SONUÇ ===');
console.log(bad.length ? bad.map(b => ' ✗ ' + b).join('\n') : ' hepsi geçti');
await browser.close();
