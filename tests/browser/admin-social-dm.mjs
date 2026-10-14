/**
 * Sosyal → Messages (#sosyal/dm) in a real browser: hidden for an editor,
 * list and thread for a publisher, a reply, the expired state, a deep link,
 * escaping, and the phone's list-then-thread flow, in English and Turkish.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-social-dm.mjs
 *
 * Every API call is intercepted, so nothing is sent or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };
const PUB = { id: 'p1', email: 'pub@example.org', is_social: true, is_social_publisher: true };
const ED = { id: 'e1', email: 'ed@example.org', is_social: true };
const NOW = Math.floor(Date.now() / 1000);
const XSS = '<img src=x onerror=alert(1)>';
const THREADS = [
  { id: 'aaa-1', username: 'ayse', lastAt: NOW - 600, lastInboundAt: NOW - 600, unanswered: true, unread: true, expired: false, closesAt: NOW - 600 + 86400, secondsLeft: 86400 - 600 },
  { id: 'bbb-2', username: null, lastAt: NOW - 90000, lastInboundAt: NOW - 90000, unanswered: true, unread: false, expired: true, closesAt: NOW - 3600, secondsLeft: 0 },
  { id: 'ccc-3', username: 'mehmet', lastAt: NOW - 60, lastInboundAt: NOW - 7200, unanswered: false, unread: false, expired: false, closesAt: NOW + 79200, secondsLeft: 79200 },
];

const browser = await chromium.launch();

async function open(lang, viewport, { user = PUB, hash = '#sosyal/dm', reply = () => null } = {}) {
  const page = await browser.newPage({ viewport });
  const calls = [];
  page.on('pageerror', (e) => bad.push(`pageerror (${lang} ${viewport.width}): ` + String(e).slice(0, 160)));
  page.on('dialog', (d) => { bad.push(`dialog: ${d.message()}`); void d.dismiss(); });
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const body = req.method() === 'GET' ? null : req.postDataJSON();
    calls.push({ method: req.method(), path: url.pathname, body });
    const json = (v, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    const custom = reply(req.method(), url.pathname, body);
    if (custom) return json(custom.json, custom.status ?? 200);
    if (url.pathname === '/api/me') return json({ user, profile: {} });
    if (url.pathname === '/api/admin/counts') return json({ social: 0, dm: 1, scheduledThisWeek: 0 });
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: false });
    if (url.pathname === '/api/admin/social/dm') return json({ status: 'ok', account: 'rsg_test', linkedin: true, threads: THREADS });
    const m = url.pathname.match(/^\/api\/admin\/social\/dm\/([^/]+)(\/reply)?$/);
    if (m && m[2]) return json({ ok: true });
    if (m && m[1] !== 'refresh') {
      const th = THREADS.find((x) => x.id === m[1]);
      return json({ thread: th, messages: [
        { id: 'm1', at: NOW - 700, mine: false, text: XSS, attachments: ['https://lookaside.fbsbx.com/x.jpg'] },
        { id: 'm2', at: NOW - 650, mine: true, text: 'Merhaba', attachments: [] },
      ] });
    }
    if (req.method() !== 'GET') return json({ ok: true });
    return json({ posts: [], plans: [], modes: [], editors: [], connections: [], rows: [] });
  });
  await page.goto(`${BASE}${lang === 'tr' ? '/tr' : ''}/admin${hash}`, { waitUntil: 'networkidle' });
  return { page, calls };
}

console.log('editor: no Messages tab');
{
  const { page, calls } = await open('en', { width: 1280, height: 800 }, { user: ED });
  ok(await page.locator('[data-sub-link="dm"]').count() === 0, 'no tab link');
  ok(await page.locator('#dmList').count() === 0, 'no markup');
  ok(!calls.some((c) => c.path.startsWith('/api/admin/social/dm')), 'no DM request');
  await page.close();
}

console.log('publisher, desktop, English');
{
  const { page, calls } = await open('en', { width: 1280, height: 800 });
  ok(await page.locator('#dmList [data-dm]').count() === 1, 'Unanswered filter shows the one open thread');
  await page.click('#dmFilterAll');
  ok(await page.locator('#dmList [data-dm]').count() === 3, 'All shows three');
  ok((await page.locator('#dmList').innerText()).includes('Instagram user'), 'unknown sender named');
  ok(!(await page.locator('#dmList').innerText()).includes('@null'), 'no @null');
  await page.click('[data-dm="aaa-1"]');
  await page.waitForSelector('#dmThreadView:not(.hidden)');
  ok(page.url().endsWith('#sosyal/dm/aaa-1'), 'address names the thread');
  ok((await page.locator('#dmMessages').innerText()).includes(XSS), 'text shown as text');
  ok(await page.locator('#dmMessages img').count() === 0, 'no HTML injected');
  ok(await page.locator('#dmMessages a[rel="noopener noreferrer"]').count() === 1, 'attachment link');
  await page.fill('#dmReplyText', 'ş'.repeat(501));
  ok(await page.locator('#dmSend').isDisabled(), '1002 bytes: Send disabled');
  await page.fill('#dmReplyText', 'Teşekkürler');
  await page.click('#dmSend');
  await page.waitForTimeout(300);
  const sent = calls.find((c) => c.path === '/api/admin/social/dm/aaa-1/reply');
  ok(sent?.body?.text === 'Teşekkürler', 'reply posted');
  ok(await page.locator('#dmReplyText').inputValue() === '', 'box cleared after send');
  await page.goto(`${BASE}/admin#sosyal/dm/bbb-2`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#dmThreadView:not(.hidden)');
  ok(await page.locator('#dmReplyForm').isHidden(), 'expired: no reply box');
  ok(await page.locator('#dmClosed').isVisible(), 'expired: explains why');
  ok(await page.locator('#dmLinkedin').isVisible(), 'LinkedIn line when connected');
  await page.close();
}

console.log('deep link to a missing conversation');
{
  const { page } = await open('en', { width: 1280, height: 800 }, {
    hash: '#sosyal/dm/zzz-9',
    reply: (m, path) => (path === '/api/admin/social/dm/zzz-9' ? { status: 404, json: { error: 'Not found', code: 'not_found' } } : null),
  });
  await page.waitForSelector('#dmThreadError:not(.hidden)');
  ok((await page.locator('#dmThreadError').innerText()).includes('no longer exists'), 'not-found text shown');
  ok(await page.locator('#dmReplyForm').isHidden(), 'no reply box');
  await page.close();
}

console.log('publisher, phone, Turkish');
{
  const { page } = await open('tr', { width: 390, height: 844 });
  ok(await page.locator('#dmListCard').isVisible(), 'list first');
  await page.click('#dmFilterAll');
  await page.click('[data-dm="ccc-3"]');
  await page.waitForSelector('#dmThreadView:not(.hidden)');
  ok(await page.locator('#dmListCard').isHidden(), 'thread replaces list');
  ok((await page.locator('#dmBack').boundingBox()).height >= 44, 'back is 44px');
  ok((await page.locator('#dmSend').boundingBox()).height >= 44, 'Send is 44px');
  await page.click('#dmBack');
  await page.waitForTimeout(200);
  ok(await page.locator('#dmListCard').isVisible(), 'back to the list');
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal scroll');
  await page.close();
}

await browser.close();
if (bad.length) { console.log(`\n${bad.length} failed`); process.exit(1); }
console.log('\nall passed');
