/**
 * The E-posta pane's compose sub-page (#eposta/yaz), in a real browser:
 * send, schedule, edit and cancel a queued message, the unsaved-changes
 * guard and the server's error codes, in English and Turkish, on a phone
 * and a desktop.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-mail-compose.mjs
 *
 * Every API call is intercepted, so nothing is sent or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const SENDER = { id: 'u3', email: 'sender@example.org', is_sender: true };
const ATTACHMENTS = [
  { id: 'a1', filename: 'Sponsorship <deck>.pdf', size_bytes: 204800, is_active: 1 },
  { id: 'a2', filename: 'old.pdf', size_bytes: 1024, is_active: 0 },
];
// 2026-11-20 09:30 Istanbul (UTC+3).
const QUEUED_AT = Date.UTC(2026, 10, 20, 6, 30) / 1000;
const QUEUED = [{
  id: 'q1', recipients: JSON.stringify(['x@example.org', 'y@example.org']), subject: 'Queued <i>hello</i>',
  body: 'Queued body', attachment_ids: JSON.stringify(['a1']), scheduled_at: QUEUED_AT,
}];

const browser = await chromium.launch();

/** `reply(method, path, body)` may return { status, json } to override the default answer. */
async function open(lang, viewport, reply = () => null) {
  const page = await browser.newPage({ viewport });
  const calls = [];
  const tag = `${lang} ${viewport.width}px`;
  page.on('pageerror', (e) => bad.push(`pageerror (${tag}): ` + String(e).slice(0, 160)));
  page.on('dialog', (d) => { bad.push(`a dialog appeared (${tag}): ${d.message()}`); void d.dismiss(); });
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const body = req.method() === 'GET' ? null : req.postDataJSON();
    calls.push({ method: req.method(), path: url.pathname + url.search, body });
    const json = (v, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    const custom = reply(req.method(), url.pathname, body);
    if (custom) return json(custom.json, custom.status ?? 200);
    if (url.pathname === '/api/me') return json({ user: SENDER, profile: {} });
    if (url.pathname === '/api/admin/counts') return json({ email: 0, social: 0, blog: 0, scheduledThisWeek: 0 });
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: false });
    if (url.pathname === '/api/admin/mail-attachments') return json({ attachments: ATTACHMENTS });
    if (url.pathname === '/api/mail/scheduled' && req.method() === 'GET') return json({ scheduled: QUEUED });
    if (url.pathname === '/api/mail/send') {
      if (body?.scheduled_at !== undefined) return json({ ok: true, scheduled: true, id: 'new' }, 201);
      return json({ ok: true, results: (body?.to ?? '').split(',').map((r) => ({ recipient: r.trim(), status: 'sent' })) });
    }
    if (req.method() !== 'GET') return json({ ok: true });
    return json({ sends: [], conversations: [], users: [], senders: [], attachments: [] });
  });
  const prefix = lang === 'tr' ? '/tr' : '';
  await page.goto(`${BASE}${prefix}/admin#eposta/yaz`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  await page.waitForSelector('#mailQueuedList [data-queued]');
  return { page, calls, tag };
}

const hash = (page) => page.evaluate(() => location.hash);
const fits = async (page, w) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= w;
const toastText = (page) => page.locator('#toastStack').textContent();

const T = {
  en: { sentTo: 'Sent to 2 recipient(s).', queued: 'Queued.', updated: 'Queued message updated.', confirm: 'Cancel this email?', rate: 'You have reached the hourly send limit (20). Try again later.', unsaved: 'You have unsaved changes.', send: 'Send', update: 'Update' },
  tr: { sentTo: '2 alıcıya gönderildi.', queued: 'Kuyruğa alındı.', updated: 'Bekleyen mesaj güncellendi.', confirm: 'Bu e-posta iptal edilsin mi?', rate: 'Saatlik gönderim sınırına (20) ulaştınız. Daha sonra tekrar deneyin.', unsaved: 'Kaydedilmemiş değişiklikler var.', send: 'Gönder', update: 'Güncelle' },
};

async function fill(page, { to = 'a@example.org, b@example.org', subject = 'Hi', body = 'Body text' } = {}) {
  await page.fill('#mailComposeTo', to);
  await page.fill('#mailComposeSubject', subject);
  await page.fill('#mailComposeBody', body);
}

for (const lang of ['en', 'tr']) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const s = T[lang];
    console.log(`${lang}, ${viewport.width} px`);

    // Layout, the queue, the attachment choices.
    {
      const { page, calls } = await open(lang, viewport);
      ok(calls.some((c) => c.path === '/api/mail/scheduled'), 'the queue was requested on first show');
      ok(await page.locator('.mail-compose-attachment').count() === 1, 'only the active attachment is offered');
      ok((await page.textContent('#mailComposeAttachments')).includes('Sponsorship <deck>.pdf'), 'attachment filename is escaped');
      ok((await page.textContent('#mailQueuedList')).includes('Queued <i>hello</i>'), 'queued subject is escaped');
      ok(await page.locator('#mailQueuedScopeLabel').isHidden(), 'a sender has no Everyone\'s switch');
      ok(await fits(page, viewport.width), `no horizontal scroll at ${viewport.width} px`);
      const small = await page.evaluate(() => [...document.querySelectorAll('#mailComposeRoot button, #mailComposeRoot input, #mailComposeRoot textarea')]
        .filter((e) => e.offsetParent && e.type !== 'checkbox' && e.getBoundingClientRect().height < 44).length);
      if (viewport.width === 390) ok(small === 0, `every control is at least 44 px tall on a phone (${small} short)`);
      await page.close();
    }

    // Send.
    {
      const { page, calls } = await open(lang, viewport);
      await fill(page);
      await page.check('.mail-compose-attachment');
      await page.click('#mailComposeSend');
      await page.waitForFunction(() => document.getElementById('mailComposeTo').value === '');
      const post = calls.find((c) => c.method === 'POST' && c.path === '/api/mail/send');
      ok(post && post.body.to === 'a@example.org, b@example.org' && post.body.subject === 'Hi' && post.body.body === 'Body text', 'POST carries to, subject and body');
      ok(post && JSON.stringify(post.body.attachment_ids) === '["a1"]', 'POST carries the attachment ids');
      ok(post && !('scheduled_at' in post.body), 'an immediate send carries no scheduled_at');
      ok((await toastText(page)).includes(s.sentTo), 'success toast');
      ok(await page.inputValue('#mailComposeBody') === '', 'the form clears');
      ok(calls.filter((c) => c.method === 'GET' && c.path === '/api/mail/scheduled').length >= 2, 'the queue reloads');
      await page.close();
    }

    // Schedule.
    {
      const { page, calls } = await open(lang, viewport);
      await fill(page);
      await page.fill('#mailComposeSchedule', '2026-11-21T10:00');
      await page.click('#mailComposeSend');
      await page.waitForFunction(() => document.getElementById('mailComposeTo').value === '');
      const post = calls.find((c) => c.method === 'POST' && c.path === '/api/mail/send');
      ok(post?.body.scheduled_at === Date.UTC(2026, 10, 21, 7, 0) / 1000, `POST carries scheduled_at in Istanbul time (got ${post?.body.scheduled_at})`);
      ok((await toastText(page)).includes(s.queued), 'queued toast');
      await page.close();
    }

    // Edit queued.
    {
      const { page, calls } = await open(lang, viewport);
      await page.click('[data-edit="q1"]');
      ok(await page.locator('#mailComposeEditing').isVisible(), 'the editing banner shows');
      ok(await page.inputValue('#mailComposeTo') === 'x@example.org, y@example.org', 'Edit fills To');
      ok(await page.inputValue('#mailComposeSubject') === 'Queued <i>hello</i>', 'Edit fills Subject');
      ok(await page.inputValue('#mailComposeSchedule') === '2026-11-20T09:30', 'Edit fills the Istanbul time');
      ok(await page.isChecked('.mail-compose-attachment'), 'Edit ticks the queued attachment');
      ok((await page.textContent('#mailComposeSend')).trim() === s.update, 'the button reads Update');
      await page.fill('#mailComposeSubject', 'Changed');
      await page.click('#mailComposeSend');
      await page.waitForFunction(() => document.getElementById('mailComposeEditing').classList.contains('hidden'));
      const patch = calls.find((c) => c.method === 'PATCH' && c.path === '/api/mail/scheduled');
      ok(patch?.body.id === 'q1' && patch?.body.subject === 'Changed' && patch?.body.scheduled_at === QUEUED_AT, 'Save sends a PATCH with id, subject and scheduled_at');
      ok(!calls.some((c) => c.path === '/api/mail/send'), 'editing does not POST a new send');
      ok((await toastText(page)).includes(s.updated), 'updated toast');
      ok((await page.textContent('#mailComposeSend')).trim() === s.send, 'the button reads Send again');
      await page.close();
    }

    // Cancel queued.
    {
      const { page, calls } = await open(lang, viewport);
      await page.click('[data-cancel="q1"]');
      ok((await page.textContent('[data-cancel="q1"]')).trim() === s.confirm, 'the first click arms');
      ok(!calls.some((c) => c.method === 'DELETE'), 'nothing deleted yet');
      await page.click('[data-cancel="q1"]');
      await page.waitForFunction(() => document.getElementById('toastStack').textContent.length > 0);
      const del = calls.find((c) => c.method === 'DELETE' && c.path === '/api/mail/scheduled');
      ok(del?.body.id === 'q1', 'the second click sends a DELETE with the id');
      await page.close();
    }

    // Unsaved changes.
    {
      const { page } = await open(lang, viewport);
      await page.fill('#mailComposeSubject', 'Draft');
      if (viewport.width >= 1024) await page.click('#subNav [data-sub-link="gelen"]');
      else await page.evaluate(() => { location.hash = '#eposta/gelen'; });
      await page.waitForTimeout(300);
      ok(await hash(page) === '#eposta/yaz', `the route stays (got ${await hash(page)})`);
      const notice = page.locator('#mailComposeRoot div', { hasText: s.unsaved }).first();
      ok(await notice.isVisible(), 'the unsaved notice shows');
      await notice.locator('[data-discard]').click();
      await page.waitForFunction(() => location.hash === '#eposta/gelen');
      ok(await hash(page) === '#eposta/gelen', 'Discard navigates');
      ok(await page.inputValue('#mailComposeSubject') === '', 'Discard clears the form');
      await page.close();
    }

    // Server error.
    {
      const { page } = await open(lang, viewport, (method, path) =>
        method === 'POST' && path === '/api/mail/send' ? { status: 429, json: { error: 'Rate limit exceeded', code: 'rate_limit_hour' } } : null);
      await fill(page);
      await page.click('#mailComposeSend');
      await page.waitForFunction(() => document.getElementById('toastStack').textContent.length > 0);
      ok((await toastText(page)).includes(s.rate), 'the 429 code shows the mapped message');
      ok(await page.inputValue('#mailComposeSubject') === 'Hi', 'the form keeps its content after an error');
      await page.close();
    }
  }
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
