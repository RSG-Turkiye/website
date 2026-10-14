/**
 * The E-posta pane's inbox (#eposta/gelen), in a real browser: the thread
 * list, a thread in the address, the phone's list-then-thread flow, replies,
 * the unsaved-reply guard, unread counts, an admin's "all members" view and
 * escaping, in English and Turkish, on a phone and a desktop.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-mail-inbox.mjs
 *
 * Every API call is intercepted, so nothing is sent or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const SENDER = { id: 'u3', email: 'sender@example.org', is_sender: true };
const ADMIN = { id: 'u1', email: 'admin@example.org', is_admin: true };
const XSS = '<img src=x onerror=alert(1)>';
const AT = Date.UTC(2026, 9, 10, 9, 0) / 1000;
const THREADS = [
  { id: '7', recipient_email: 'ayse@example.org', recipient_name: null, subject: XSS, last_message_at: AT + 300, last_direction: 'in', unread: 1, snippet: 'Thanks <b>a lot</b>' },
  { id: '8', recipient_email: 'mehmet@example.org', recipient_name: 'Mehmet <M>', subject: 'Sponsorship', last_message_at: AT + 200, last_direction: 'out', unread: 0, snippet: 'See you then' },
  { id: '9', recipient_email: 'zeynep@example.org', recipient_name: null, subject: 'Workshop dates', last_message_at: AT + 100, last_direction: 'in', unread: 0, snippet: 'Which week?' },
];
const OTHERS = [
  { ...THREADS[2], id: 'c4', subject: 'Someone else\'s thread', sender_email: 'other@example.org', sender_name: 'Other <Member>', unread: 1 },
];

function threadFor(id, user) {
  const th = [...THREADS, ...OTHERS].find((x) => x.id === id);
  return {
    thread: { id, recipient_email: th.recipient_email, recipient_name: th.recipient_name, subject: th.subject, sender_email: 'sender@example.org', can_reply: user.is_sender === true },
    messages: [
      { id: `${id}-1`, direction: 'out', from_email: 'rsg@example.org', from_name: null, body_html: '<p>Hello from RSG</p>', attachment_count: 0, sent_at: AT },
      { id: `${id}-2`, direction: 'in', from_email: th.recipient_email, from_name: 'Reply <Person>', body_html: '<p>Body of the answer</p>', attachment_count: 2, sent_at: AT + 60 },
    ],
  };
}

const browser = await chromium.launch();

/** `reply(method, path, body)` may return { status, json } to override the default answer. */
async function open(lang, viewport, { user = SENDER, hash = '#eposta/gelen', reply = () => null } = {}) {
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
    if (url.pathname === '/api/me') return json({ user, profile: {} });
    if (url.pathname === '/api/admin/counts') return json({ email: 1, social: 0, blog: 0, scheduledThisWeek: 0 });
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: false });
    if (url.pathname === '/api/mail/conversations') {
      const all = url.searchParams.get('scope') === 'all' && user.is_admin === true;
      return json({ threads: all ? [...THREADS, ...OTHERS] : THREADS, unreadCount: 1, scope: all ? 'all' : 'own', isAdmin: user.is_admin === true });
    }
    const m = url.pathname.match(/^\/api\/mail\/conversations\/([^/]+)(\/reply)?$/);
    if (m && m[2]) return json({ ok: true, results: [{ recipient: 'x', status: 'sent' }] });
    if (m) return json(threadFor(decodeURIComponent(m[1]), user));
    if (req.method() !== 'GET') return json({ ok: true });
    // The rest of an admin's panel loads too; give its lists empty answers.
    return json({
      users: [], badge_catalog: [], announcements: [], submissions: [], senders: [], attachments: [], sends: [], scheduled: [],
      connections: [], rows: [], hasMore: false, year: 2026, edition: {}, items: [], certificates: [], totalBytes: 0,
      posts: [], plans: [], modes: [], editors: [],
    });
  });
  const prefix = lang === 'tr' ? '/tr' : '';
  await page.goto(`${BASE}${prefix}/admin${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  await page.waitForSelector('#mailInboxList [data-thread]', { state: 'attached' });
  return { page, calls, tag };
}

const hash = (page) => page.evaluate(() => location.hash);
const fits = async (page, w) => (await page.evaluate(() => document.documentElement.scrollWidth)) <= w;
const toastText = (page) => page.locator('#toastStack').textContent();
const threadGets = (calls, id) => calls.filter((c) => c.method === 'GET' && c.path === `/api/mail/conversations/${id}`).length;
async function openRow(page, id) {
  await page.click(`#mailInboxList [data-thread="${id}"]`);
  await page.waitForFunction((id) => location.hash === `#eposta/gelen/${id}`, id);
  await page.waitForSelector('#mailThreadView:not(.hidden)');
}

const T = {
  en: { notSender: 'Replying needs the sender role', unread: 'Unread', sent: 'Reply sent.', unsaved: 'You have unsaved changes.', blocked: 'Only the member who started the conversation can reply.', back: 'Back to inbox', attach: '2 attachment(s): open the RSG mailbox in Gmail to download.' },
  tr: { notSender: 'Cevap yazmak için gönderici yetkisi gerekir', unread: 'Okunmadı', sent: 'Cevap gönderildi.', unsaved: 'Kaydedilmemiş değişiklikler var.', blocked: 'Yalnızca yazışmayı başlatan üye cevap yazabilir.', back: 'Gelen kutusuna dön', attach: '2 ek var: indirmek için RSG posta kutusunu Gmail\'den açın.' },
};

for (const lang of ['en', 'tr']) {
  for (const viewport of [{ width: 390, height: 844 }, { width: 1280, height: 900 }]) {
    const s = T[lang];
    const phone = viewport.width < 1024;
    console.log(`${lang}, ${viewport.width} px`);

    // Opening: the list, then a thread in the address. Escaping throughout.
    {
      const { page, calls } = await open(lang, viewport);
      ok(calls.some((c) => c.method === 'GET' && c.path === '/api/mail/conversations'), 'the list was requested');
      ok(calls.some((c) => c.method === 'POST' && c.path === '/api/mail/refresh'), 'a refresh was asked for after the cached render');
      ok(await page.locator('#mailInboxList [data-thread]').count() === 3, 'three rows render');
      const listText = await page.textContent('#mailInboxList');
      ok(listText.includes(XSS) && listText.includes('Thanks <b>a lot</b>') && listText.includes('Mehmet <M>'), 'subject, snippet and name render as text');
      ok(await page.locator('#mailInboxList img, #mailInboxList b').count() === 0, 'no markup from the data is parsed');
      ok((await page.textContent('[data-thread="7"]')).includes(s.unread), 'the unread row carries the chip');
      ok(!(await page.textContent('[data-thread="8"]')).includes(s.unread), 'a read row has no chip');
      ok(await page.locator('#mailInboxScopeLabel').isHidden(), 'a sender has no All members switch');
      ok(await page.locator('#mailThreadCard').isVisible() === !phone, phone ? 'phone: the list shows alone' : 'desktop: the thread pane shows beside the list');
      ok(await fits(page, viewport.width), `list: no horizontal scroll at ${viewport.width} px`);
      if (phone) {
        const small = await page.evaluate(() => [...document.querySelectorAll('#mailInboxRoot a, #mailInboxRoot button, #mailInboxRoot label')]
          .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).length);
        ok(small === 0, `list: every control is at least 44 px tall (${small} short)`);
      }
      await openRow(page, '8');
      ok(threadGets(calls, '8') === 1, 'opening a row GETs that thread');
      ok((await page.textContent('#mailThreadSubject')) === 'Sponsorship', 'the thread subject shows');
      ok((await page.textContent('#mailThreadWith')) === 'Mehmet <M> <mehmet@example.org>', 'the correspondent renders as text');
      ok((await page.textContent('#mailThreadMessages')).includes('Reply <Person>'), 'the sender name renders as text');
      ok((await page.locator('#mailThreadMessages .mail-body p').count()) === 2, 'server-rendered bodies are inserted as HTML');
      ok((await page.textContent('#mailThreadMessages')).includes(s.attach), 'the attachment note shows');
      ok(await page.locator('#mailReplyForm').isVisible(), 'the owner sees the reply form');
      ok(await page.locator('#mailReplyBlocked').isHidden(), 'the owner does not see the blocked note');
      ok(await fits(page, viewport.width), `thread: no horizontal scroll at ${viewport.width} px`);
      if (phone) {
        ok(await page.locator('#mailInboxListCard').isHidden(), 'phone: the list hides while a thread is open');
        ok(await page.locator('#mailInboxBack').isVisible(), 'phone: ‹ shows');
        const h = await page.evaluate(() => document.getElementById('mailInboxBack').getBoundingClientRect().height);
        ok(h >= 44, `phone: ‹ is at least 44 px tall (${h})`);
        ok((await page.textContent('#mailInboxBack')).includes(s.back), 'phone: ‹ is labelled');
        const small = await page.evaluate(() => [...document.querySelectorAll('#mailThreadCard a, #mailThreadCard button, #mailThreadCard textarea')]
          .filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).length);
        ok(small === 0, `thread: every control is at least 44 px tall (${small} short)`);
        ok(await page.locator('#phoneBack').isHidden(), 'phone: the bar\'s ‹ hides on a thread, one back control');
        const before = await page.evaluate(() => history.length);
        await page.click('#mailInboxBack');
        await page.waitForFunction(() => location.hash === '#eposta/gelen');
        ok(await hash(page) === '#eposta/gelen', '‹ returns to #eposta/gelen');
        ok(await page.evaluate(() => history.length) === before, '‹ steps back rather than pushing the list again');
        ok(await page.locator('#phoneBack').isVisible(), 'phone: the bar\'s ‹ is back on the list');
        await page.waitForSelector('#mailInboxListCard', { state: 'visible', timeout: 3000 }).catch(() => {});
        ok(await page.locator('#mailInboxListCard').isVisible(), '‹ shows the list again');
        ok(await page.locator('#mailThreadCard').isHidden(), '‹ hides the thread');
      } else {
        const [l, r] = await page.evaluate(() => [document.getElementById('mailInboxListCard').getBoundingClientRect().right, document.getElementById('mailThreadCard').getBoundingClientRect().left]);
        ok(l <= r, 'desktop: list and thread side by side');
        ok(await page.locator('#mailInboxBack').isHidden(), 'desktop: no ‹');
        ok(await page.locator('[data-thread="8"][aria-current="true"]').count() === 1, 'desktop: the open row is marked');
      }
      await page.goBack();
      if (!phone) {
        await page.waitForFunction(() => location.hash === '#eposta/gelen');
        ok(await page.locator('#mailThreadView').isHidden(), 'browser back closes the thread');
      }
      await page.close();
    }

    // Deep link and unread.
    {
      const { page, calls } = await open(lang, viewport, { hash: '#eposta/gelen/7' });
      await page.waitForSelector('#mailThreadView:not(.hidden)');
      ok(threadGets(calls, '7') === 1, 'a fresh load of #eposta/gelen/7 GETs thread 7');
      ok((await page.textContent('#mailThreadSubject')) === XSS, 'thread 7 opens, its subject as text');
      ok(await page.locator('#mailThreadCard img').count() === 0, 'no markup from the subject is parsed');
      if (phone) ok(await page.locator('#mailInboxListCard').isHidden(), 'phone deep link: the thread shows alone');
      await page.close();

      const second = await open(lang, viewport);
      const before = second.calls.filter((c) => c.path === '/api/admin/counts').length;
      await openRow(second.page, '7');
      await second.page.waitForTimeout(200);
      const after = second.calls.filter((c) => c.path === '/api/admin/counts').length;
      ok(after > before, `opening an unread thread asks for the counts again (${before} -> ${after})`);
      ok(!(await second.page.textContent('[data-thread="7"]')).includes(s.unread), 'the row loses its unread chip');
      const again = second.calls.filter((c) => c.path === '/api/admin/counts').length;
      if (!phone) {
        await openRow(second.page, '8');
        await second.page.waitForTimeout(200);
        ok(second.calls.filter((c) => c.path === '/api/admin/counts').length === again, 'opening a read thread does not');
      }
      await second.page.close();
    }

    // Reply.
    {
      const { page, calls } = await open(lang, viewport);
      await openRow(page, '8');
      await page.fill('#mailReplyBody', '  Thanks, see you.  ');
      await page.click('#mailReplySend');
      await page.waitForFunction(() => document.getElementById('mailReplyBody').value === '');
      const post = calls.find((c) => c.method === 'POST' && c.path === '/api/mail/conversations/8/reply');
      ok(post?.body.body === 'Thanks, see you.', 'the reply POSTs to the thread\'s reply URL with the trimmed body');
      ok((await toastText(page)).includes(s.sent), 'success toast');
      ok(threadGets(calls, '8') >= 2, 'the thread reloads after the reply');
      // Navigating away after a sent reply needs no confirmation.
      if (phone) await page.click('#mailInboxBack');
      else await page.click('#mailInboxList [data-thread="9"]');
      const left = phone ? '#eposta/gelen' : '#eposta/gelen/9';
      await page.waitForFunction((h) => location.hash === h, left).catch(() => {});
      ok(await hash(page) === left, `leaving after a sent reply is not held up (got ${await hash(page)})`);
      ok(await page.locator('#mailReplyWrap [data-discard]').isHidden(), 'no unsaved notice after a sent reply');
      await page.close();
    }

    // Reply error keeps the text.
    {
      const { page } = await open(lang, viewport, { reply: (method, path) => method === 'POST' && path.endsWith('/reply') ? { status: 404, json: { code: 'not_found' } } : null });
      await openRow(page, '8');
      await page.fill('#mailReplyBody', 'Kept');
      await page.click('#mailReplySend');
      await page.waitForFunction(() => document.getElementById('toastStack').textContent.length > 0);
      const msg = lang === 'en' ? 'This conversation is no longer available.' : 'Bu yazışma artık mevcut değil.';
      ok((await toastText(page)).includes(msg), 'not_found shows the conversation wording');
      ok(await page.inputValue('#mailReplyBody') === 'Kept', 'the reply text is kept after an error');
      await page.close();
    }

    // Dirty reply: a real control that leaves the thread shows the notice.
    // Desktop clicks another thread's row; on a phone the list is hidden
    // while a thread is open, so the control that leaves it is ‹.
    {
      const { page } = await open(lang, viewport);
      await openRow(page, '8');
      await page.fill('#mailReplyBody', 'Half-written');
      const target = phone ? '#eposta/gelen' : '#eposta/gelen/9';
      if (phone) await page.click('#mailInboxBack');
      else await page.click('#mailInboxList [data-thread="9"]');
      await page.waitForTimeout(300);
      ok(await hash(page) === '#eposta/gelen/8', `the route stays on the thread (got ${await hash(page)})`);
      const notice = page.locator('#mailReplyWrap div', { hasText: s.unsaved }).first();
      ok(await notice.isVisible(), 'the unsaved notice shows');
      ok(await page.inputValue('#mailReplyBody') === 'Half-written', 'the text is still there');
      ok(await fits(page, viewport.width), 'notice: no horizontal scroll');
      await notice.locator('[data-discard]').click();
      await page.waitForFunction((h) => location.hash === h, target);
      ok(await hash(page) === target, `Discard follows the move (${target})`);
      if (!phone) {
        await page.waitForFunction(() => document.getElementById('mailThreadSubject').textContent === 'Workshop dates');
        ok(await page.inputValue('#mailReplyBody') === '', 'Discard clears the reply');
      }
      await page.close();
    }

    // Admin: all members, and the reply blocked on someone else's thread.
    {
      const { page, calls } = await open(lang, viewport, { user: ADMIN });
      ok(await page.locator('#mailInboxScopeLabel').isVisible(), 'an admin sees All members');
      ok(await page.locator('#mailComposeRoot').count() === 0, 'a non-sender admin has no compose page');
      await page.check('#mailInboxScopeAll');
      await page.waitForSelector('[data-thread="c4"]');
      ok(calls.some((c) => c.method === 'GET' && c.path === '/api/mail/conversations?scope=all'), 'the switch requests scope=all');
      ok((await page.textContent('[data-thread="c4"]')).includes('Other <Member>'), 'the member\'s name renders as text');
      ok(await fits(page, viewport.width), 'all members: no horizontal scroll');
      const before = calls.filter((c) => c.path === '/api/admin/counts').length;
      await openRow(page, 'c4');
      await page.waitForTimeout(200);
      ok(await page.locator('#mailReplyForm').isHidden(), 'no reply form on someone else\'s thread');
      ok((await page.textContent('#mailReplyBlocked')).includes(s.blocked), 'the blocked note shows');
      ok(await page.locator('#mailReplyBlocked').isVisible(), 'the blocked note is visible');
      ok(calls.filter((c) => c.path === '/api/admin/counts').length === before, 'reading someone else\'s unread thread leaves the counts');
      if (!phone) ok((await page.textContent('[data-thread="c4"]')).includes(s.unread), 'and their row stays unread');
      await page.close();
    }

    // An admin who is not (or no longer) a sender, on their own old thread:
    // the server would refuse the reply, so the form hides and says why.
    {
      const own = (method, path) => method === 'GET' && path === '/api/mail/conversations/8'
        ? { json: { ...threadFor('8', ADMIN), thread: { ...threadFor('8', ADMIN).thread, can_reply: true } } }
        : null;
      const { page } = await open(lang, viewport, { user: ADMIN, reply: own });
      await openRow(page, '8');
      ok(await page.locator('#mailReplyForm').isHidden(), 'no reply form for an owner without the sender role');
      ok((await page.textContent('#mailReplyBlocked')).includes(s.notSender), 'the note says replying needs the sender role');
      await page.close();
    }

    // Refresh after a failed open retries the thread the address names.
    {
      let fail = true;
      const flaky = (method, path) => fail && method === 'GET' && path === '/api/mail/conversations/9' ? { status: 500, json: {} } : null;
      const { page, calls } = await open(lang, viewport, { reply: flaky });
      if (!phone) {
        await openRow(page, '8');
        await page.click('#mailInboxList [data-thread="9"]');
      } else {
        await page.evaluate(() => { location.hash = '#eposta/gelen/9'; });
      }
      await page.waitForFunction(() => location.hash === '#eposta/gelen/9');
      await page.waitForFunction(() => document.getElementById('toastStack').textContent.length > 0);
      fail = false;
      await page.click('#mailInboxRefresh');
      await page.waitForFunction(() => document.getElementById('mailThreadSubject').textContent === 'Workshop dates', null, { timeout: 5000 }).catch(() => {});
      ok(threadGets(calls, '9') >= 2, `Refresh asks for thread 9 again (${threadGets(calls, '9')} requests)`);
      ok((await page.textContent('#mailThreadSubject')) === 'Workshop dates', 'and thread 9 shows');
      await page.close();
    }
  }
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
