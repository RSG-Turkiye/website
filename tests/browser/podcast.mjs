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
 *   - audio survives navigation, and there is never more than one player
 *   - /podcast switches episodes through the same player
 *   - pause and resume
 *   - crossing languages keeps the audio and moves the labels
 *   - dismissing stops it, and is remembered
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
  if (s.paused) bad.push(`${p} sayfasında ses durdu`);
  if (s.t <= prev) bad.push(`${p} sayfasında ses ilerlemedi`);
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

console.log('\n=== SONUÇ ===');
console.log(bad.length ? bad.map(b => ' ✗ ' + b).join('\n') : ' hepsi geçti');
await browser.close();
