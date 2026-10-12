/**
 * The symposium site's /certificates/ page and home page band, in a real
 * browser, against a stub of the main site's API.
 *
 * Not part of `npm test`: it needs Playwright.
 *
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/certificates-page.mjs
 *
 * The script builds symposium_website into a temporary directory with
 * PUBLIC_API_BASE pointing at a stub it serves itself, so the real dist/ and
 * the real API are left alone. The stub answers the three public certificate
 * endpoints the way functions/api/certificates/* do.
 */
import { chromium } from 'playwright';
import { PDFDocument } from 'pdf-lib';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SYMPOSIUM = join(dirname(fileURLToPath(import.meta.url)), '../../symposium_website');
const API_PORT = 8799;
const SITE_PORT = 4329;
const API = `http://127.0.0.1:${API_PORT}`;
const SITE = `http://127.0.0.1:${SITE_PORT}`;
const bad = [];
const ok = (cond, msg) => { console.log(`   ${cond ? '✓' : '✗'} ${msg}`); if (!cond) bad.push(msg); };

// 01:30 on 12 November 2026 in Istanbul.
const EXPIRES = Date.UTC(2026, 10, 11, 22, 30) / 1000;
const GOOD = '11111111-1111-4111-8111-111111111111';
const GONE = '22222222-2222-4222-8222-222222222222';

const pdf = await (async () => { const d = await PDFDocument.create(); d.addPage([595, 842]); return Buffer.from(await d.save()); })();
let lookups = 0;

const api = createServer((req, res) => {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' };
  const json = (status, body) => { res.writeHead(status, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const url = new URL(req.url, API);
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  if (url.pathname === '/api/certificates/status') return json(200, { years: [{ year: 2026, count: 2, expiresAt: EXPIRES }] });
  if (url.pathname === '/api/symposium') return json(200, {});
  if (url.pathname === '/api/certificates/lookup' && req.method === 'POST') {
    lookups++;
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const email = String(JSON.parse(body || '{}').email ?? '').toLowerCase();
      if (email === 'ayse@example.org') {
        return json(200, { certificates: [
          { id: GOOD, year: 2026, kind: 'participation', name: 'Ayşe Yılmaz', expiresAt: EXPIRES, url: `${API}/api/certificates/${GOOD}.pdf` },
          { id: GONE, year: 2026, kind: 'presentation', name: 'Ayşe Yılmaz', expiresAt: EXPIRES, url: `${API}/api/certificates/${GONE}.pdf` },
        ] });
      }
      if (email === 'limit@example.org') return json(429, { error: 'Too many lookups', code: 'rate_limited' });
      return json(200, { certificates: [] });
    });
    return;
  }
  if (url.pathname === `/api/certificates/${GOOD}.pdf`) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/pdf' });
    return res.end(req.method === 'HEAD' ? undefined : pdf);
  }
  res.writeHead(404, cors);
  res.end();
});
await new Promise((done) => api.listen(API_PORT, '127.0.0.1', done));

const run = (args, opts) => new Promise((resolve, reject) => {
  const p = spawn('npx', args, { cwd: SYMPOSIUM, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  p.stderr.on('data', (d) => { out += d; });
  p.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`npx ${args.join(' ')} exited ${code}\n${out.slice(-2000)}`))));
});

const outDir = mkdtempSync(join(tmpdir(), 'rsg-symposium-'));
const env = { ...process.env, PUBLIC_API_BASE: API, SYMPOSIUM_ALLOW_EMPTY_BUILD: '1' };
console.log(`building symposium_website into ${outDir}`);
await run(['astro', 'build', '--outDir', outDir], { env });
const preview = spawn('npx', ['astro', 'preview', '--outDir', outDir, '--port', String(SITE_PORT), '--host', '127.0.0.1'],
  { cwd: SYMPOSIUM, env, stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  if (await fetch(`${SITE}/`).then((r) => r.ok).catch(() => false)) break;
  await new Promise((done) => setTimeout(done, 200));
}

const TEXT = {
  en: { path: '/certificates/', home: '/', invalid: 'valid email', none: '30 days', rate: 'ten minutes', gone: 'no longer available',
    kinds: ['2026 · Participation', '2026 · Presentation'], date: '12 November 2026', band: 'Certificates for the 2026 symposium are ready.' },
  tr: { path: '/tr/certificates/', home: '/tr/', invalid: 'geçerli bir e-posta', none: '30 günlük', rate: 'on dakika', gone: 'artık mevcut değil',
    kinds: ['2026 · Katılım', '2026 · Sunum'], date: '12 Kasım 2026', band: '2026 sempozyumunun sertifikaları hazır.' },
};

const browser = await chromium.launch();
try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    for (const lang of ['en', 'tr']) {
      const L = TEXT[lang];
      console.log(`\n== ${lang} ${viewport.width}x${viewport.height}`);
      const page = await browser.newPage({ viewport });
      page.on('pageerror', (e) => bad.push('pageerror: ' + String(e).slice(0, 160)));
      const message = () => page.textContent('#certMessage');
      const submit = async (email) => {
        await page.fill('#certEmail', email);
        await page.click('#certSubmit');
        await page.waitForFunction(() => !document.getElementById('certSubmit').disabled);
        await page.waitForTimeout(100);
      };

      await page.goto(SITE + L.home);
      const band = await page.locator(`a[href="${L.path}"]`).first();
      ok(await band.count() === 1 && (await page.textContent('body')).includes(L.band), 'home page band links to the page');

      await page.goto(SITE + L.path);
      const before = lookups;
      await submit('');
      ok((await message()).includes(L.invalid), 'empty email asks for a valid one');
      await submit('x');
      ok((await message()).includes(L.invalid), '"x" asks for a valid one');
      ok(lookups === before, 'no request for an invalid email');

      await submit('nobody@example.org');
      ok((await message()).includes(L.none) && (await message()).includes('turkey.rsg@gmail.com'), 'no match points to the 30 days and the address');

      await submit('limit@example.org');
      ok((await message()).includes(L.rate), 'rate limit message');

      await submit('AYSE@example.org');
      const cards = await page.$$eval('#certResults li p:first-child', (ps) => ps.map((p) => p.textContent));
      ok(JSON.stringify(cards) === JSON.stringify(L.kinds), `two cards with ${lang} labels (${JSON.stringify(cards)})`);

      await page.click('#certResults li:nth-child(1) button');
      ok(await page.evaluate(() => document.getElementById('certNotice').open), 'View opens the notice');
      const notice = await page.textContent('#certNoticeBody');
      ok(notice.includes(L.date) && notice.includes('turkey.rsg@gmail.com'), `notice names the date and the address (${notice.slice(0, 80)}…)`);
      await page.click('#certNotice button[value=cancel]');
      await page.waitForTimeout(100);
      ok(await page.isHidden('#certViewer'), 'Cancel leaves the viewer hidden');

      await page.click('#certResults li:nth-child(1) button');
      await page.click('#certNoticeOk');
      await page.waitForSelector('#certViewer:not(.hidden)', { timeout: 3000 }).catch(() => {});
      const viewer = await page.evaluate(() => ({
        src: document.getElementById('certFrame').getAttribute('src'),
        download: document.getElementById('certDownload').getAttribute('href'),
        hidden: document.getElementById('certViewer').classList.contains('hidden'),
      }));
      ok(!viewer.hidden, 'I understand shows the viewer');
      ok(viewer.src === `${API}/api/certificates/${GOOD}.pdf`, 'the frame shows the certificate URL');
      ok(viewer.download === `${API}/api/certificates/${GOOD}.pdf?download=1`, 'the download link asks for an attachment');

      await page.click('#certResults li:nth-child(2) button');
      await page.click('#certNoticeOk');
      await page.waitForTimeout(400);
      ok((await message()).includes(L.gone), 'a certificate gone since the lookup says so');
      ok(await page.isHidden('#certViewer'), 'and the viewer is hidden');

      if (viewport.width <= 400) {
        const width = await page.evaluate(() => document.documentElement.scrollWidth);
        ok(width <= viewport.width, `no horizontal page scroll (scrollWidth ${width})`);
      }
      await page.close();
    }
  }
} finally {
  await browser.close();
  preview.kill();
  api.close();
}

console.log(bad.length ? `\n${bad.length} PROBLEM(S):\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
