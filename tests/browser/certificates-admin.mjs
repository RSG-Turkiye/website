/**
 * The certificates section of the symposium pane, driven in a real browser,
 * signed in as a symposium organiser.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npm run preview &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/certificates-admin.mjs
 *
 * Every API call is intercepted, so nothing is stored. What is checked is the
 * panel's own work: reading an Excel-TR CSV, matching it to the chosen PDFs,
 * shrinking a large PDF in the browser, refusing what the API would refuse,
 * and sending exactly the rows that are ready.
 */
import { chromium } from 'playwright';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { mkdtempSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

const BASE = 'http://localhost:4321';
const bad = [];
const ok = (cond, msg) => { console.log(`   ${cond ? '✓' : '✗'} ${msg}`); if (!cond) bad.push(msg); };

// --- Fixtures ----------------------------------------------------------------

/** An RGB PNG of random noise: incompressible, so the PDF holding it is big. */
function noisePng(width, height) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let i = 0; i < raw.length; i++) raw[i] = i % (width * 3 + 1) === 0 ? 0 : (Math.random() * 256) | 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]);
}

const dir = mkdtempSync(join(tmpdir(), 'rsg-certs-'));
{
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText('Certificate of Participation', { x: 80, y: 700, size: 28, font: await doc.embedFont(StandardFonts.Helvetica) });
  writeFileSync(join(dir, 'small.pdf'), await doc.save());
}
{
  // A small page holding a large image: rasterising at 200 DPI gives far
  // fewer pixels than the image has, so the shrink is real and measurable.
  const doc = await PDFDocument.create();
  const page = doc.addPage([300, 200]);
  const img = await doc.embedPng(noisePng(1200, 800));
  page.drawImage(img, { x: 0, y: 0, width: 300, height: 200 });
  writeFileSync(join(dir, 'big.pdf'), await doc.save());
}
writeFileSync(join(dir, 'broken.pdf'), '%PDF-1.7\n' + 'garbage '.repeat(200));
writeFileSync(join(dir, 'notpdf.pdf'), '<html></html>');
writeFileSync(join(dir, 'list.csv'), '﻿' + [
  'email;name;type;file',
  'a@example.org;Ayşe Yılmaz;katılım;small.pdf',
  'b@example.org;Ali;workshop;big.pdf',
  'c@example.org;Can;sunum;broken.pdf',
  'd@example.org;Deniz;teşekkür;notpdf.pdf',
  'bad;Eda;poster;missing.pdf',
].join('\r\n') + '\r\n');
const bigSize = statSync(join(dir, 'big.pdf')).size;
console.log(`fixtures in ${dir}; big.pdf ${(bigSize / 1024 / 1024).toFixed(2)} MB`);
ok(bigSize > 1024 * 1024, 'big.pdf is over 1 MB, so the rasterise path runs');

// --- Run ---------------------------------------------------------------------

async function run(viewport) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push('pageerror: ' + String(e).slice(0, 160)));

  await page.route('**/api/me', (r) => r.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ user: { id: 'u1', email: 'organiser@example.org', is_symposium: true }, profile: {} }),
  }));
  await page.route('**/api/admin/symposium/edition', (r) => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({ year: 2026, edition: {} }) }));
  for (const kind of ['speakers', 'sessions', 'committee']) {
    await page.route(`**/api/admin/symposium/${kind}`, (r) => r.fulfill({
      contentType: 'application/json', body: JSON.stringify({ year: 2026, items: [] }) }));
  }
  const posts = [];
  let rebuilds = 0;
  await page.route('**/api/admin/certificates?year=*', (r) => r.fulfill({
    contentType: 'application/json', body: JSON.stringify({ certificates: [], totalBytes: 0 }) }));
  await page.route('**/api/admin/certificates', (r) => {
    const h = r.request().headers();
    posts.push({ type: h['x-cert-type'], name: h['x-cert-name'], email: h['x-cert-email'], size: r.request().postDataBuffer()?.length ?? 0 });
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: 'x', expiresAt: 0, replaced: false }) });
  });
  await page.route('**/api/admin/certificates/rebuild', (r) => {
    rebuilds++;
    return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, rebuild: { state: 'started', detail: 'rebuild started' } }) });
  });

  console.log(`\n== ${viewport.width}x${viewport.height}`);
  await page.goto(BASE + '/admin', { waitUntil: 'networkidle' });
  await page.waitForSelector('#symCertificates');
  await page.setInputFiles('#symCertCsv', join(dir, 'list.csv'));
  await page.setInputFiles('#symCertPdfs', ['small.pdf', 'big.pdf', 'broken.pdf', 'notpdf.pdf'].map((f) => join(dir, f)));
  await page.click('#symCertCheck');
  await page.waitForFunction(() => {
    const b = document.getElementById('symCertUpload');
    return b && !b.classList.contains('hidden') && /\b3\b/.test(b.textContent);
  }, null, { timeout: 30000 }).catch(() => {});
  // Compression is sequential; give the last row time to settle.
  await page.waitForTimeout(500);

  const rows = await page.$$eval('#symCertPreviewBody tr', (trs) =>
    trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
  console.log('   ', JSON.stringify(rows));
  ok(rows.length === 5, 'five preview rows');
  ok(rows[0]?.[4] === 'Ready', `row 1 ready (${rows[0]?.[4]})`);
  const sizes = rows[1]?.[3]?.match(/([\d.]+) MB → ([\d.]+) MB/);
  ok(sizes && Number(sizes[2]) < Number(sizes[1]), `row 2 shrank (${rows[1]?.[3]})`);
  ok(/original kept/.test(rows[2]?.[4] ?? ''), `row 3 keeps the original (${rows[2]?.[4]})`);
  ok(rows[3]?.[4] === 'Not a PDF', `row 4 not a PDF (${rows[3]?.[4]})`);
  ok(rows[4]?.[4] === 'Invalid email, Unknown type, File not selected', `row 5 problems (${rows[4]?.[4]})`);
  ok((await page.textContent('#symCertUpload')).trim() === 'Upload 3 certificates', 'upload button counts the ready rows');
  ok(/notpdf|small|big|broken/.test(await page.textContent('#symCertUnused')) === false, 'no PDF reported unused');

  await page.click('#symCertUpload');
  await page.waitForFunction(() => /Uploaded \d+, failed \d+/.test(document.getElementById('symCertProgress')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
  console.log('   ', JSON.stringify(posts), 'rebuilds:', rebuilds);
  ok(posts.length === 3, 'three uploads');
  ok(JSON.stringify(posts.map((p) => p.type)) === '["participation","workshop","presentation"]', 'kinds sent in English');
  ok(decodeURIComponent(posts[0]?.name ?? '') === 'Ayşe Yılmaz', 'name sent URI-encoded');
  ok(posts[1]?.size > 0 && posts[1]?.size < bigSize, 'the shrunk bytes were sent for big.pdf');
  ok(rebuilds === 1, 'one rebuild after the batch');

  if (viewport.width <= 400) {
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    ok(width <= viewport.width, `no horizontal page scroll at ${viewport.width}px (scrollWidth ${width})`);
  }
  await browser.close();
}

await run({ width: 1280, height: 900 });
await run({ width: 390, height: 844 });

console.log(bad.length ? `\n${bad.length} PROBLEM(S):\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
