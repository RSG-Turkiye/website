/**
 * The admin panel fits the window from lg up, in a real browser: on a laptop
 * the page itself never scrolls; long lists scroll inside their own boxes and
 * a side panel (a member, a mail thread, an edit form) is on screen without
 * scrolling the page. On a phone the page still scrolls as before.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-fit-viewport.mjs
 *
 * Every API call is intercepted, so nothing is read or stored. The fixtures
 * are long on purpose (200 members, 60 of everything else), so every box has
 * something to scroll.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { if (!c) { console.log(`   ✗ ${m}`); bad.push(m); } };
const pass = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const ADMIN = { id: 'u1', email: 'admin@example.org', is_admin: true, is_social_publisher: true, is_symposium: true, is_announcer: true };
const SENDER = { id: 'u3', email: 'sender@example.org', is_sender: true };
const COUNTS = { email: 3, social: 2, blog: 1, scheduledThisWeek: 4 };
const now = Math.floor(Date.now() / 1000);
const N = (n, f) => Array.from({ length: n }, (_, i) => f(i + 1));

const USERS = N(200, (i) => ({ id: `u${i}`, email: `person${i}@example.org`, display_name: `Person ${i}`, is_admin: i === 1 ? 1 : 0, is_announcer: 0, is_symposium: 0, is_social: 0, badges: [] }));
const MAIL_THREADS = N(60, (i) => ({ id: `t${i}`, recipient_email: `r${i}@example.org`, recipient_name: `Recipient ${i}`, subject: `Subject ${i}`, last_message_at: 1760000000 - i * 60, last_direction: i % 2 ? 'in' : 'out', unread: i % 3 === 0 ? 1 : 0, snippet: `Snippet ${i}` }));
const MAIL_THREAD = {
  thread: { id: 't60', recipient_email: 'r60@example.org', recipient_name: 'Recipient 60', subject: 'Subject 60', sender_email: 'sender@example.org', can_reply: true },
  messages: N(3, (i) => ({ id: `m${i}`, direction: i % 2 ? 'in' : 'out', from_email: 'r60@example.org', from_name: null, body_html: `<p>Message ${i}</p>`, attachment_count: 0, sent_at: 1760000000 + i * 60 })),
};
const FULL = {
  users: USERS,
  badge_catalog: [],
  announcements: N(40, (i) => ({ id: `a${i}`, title: `Announcement ${i}`, description: 'd', button_text: 'Go', button_url: 'https://example.org', expires_at: 1893456000, site: 'main', show_as_popup: false })),
  submissions: N(20, (i) => ({ id: `b${i}`, lang: 'en', title: `Post ${i}`, description: 'd', category: 'news', tags: ['x'], author: 'a', image_url: '', body: 'text', slug: `s${i}`, status: 'pending', rejection_reason: null, pr_url: null, paired_submission_id: null, submitter_email: 'someone@example.org' })),
  senders: N(30, (i) => ({ user_id: `s${i}`, email: `sender${i}@example.org`, display_name: `Sender ${i}`, team: 'Comms', granted_at: 1760000000, granted_by_email: 'admin@example.org' })),
  attachments: N(30, (i) => ({ id: `f${i}`, filename: `file${i}.pdf`, size_bytes: 2048, uploaded_at: 1760000000, is_active: 1 })),
  sends: N(60, (i) => ({ subject: `Hello ${i}`, sender_email: 's@example.org', sender_name: null, recipient_email: 'r@example.org', sent_at: 1760000000, status: 'sent', error_message: null })),
  scheduled: N(20, (i) => ({ id: `q${i}`, subject: `Later ${i}`, recipient_email: 'r@example.org', recipients: ['r@example.org'], send_at: now + 86400, status: 'pending', sender_email: 's@example.org' })),
  connections: [
    { platform: 'gmail', status: 'connected', accountName: 'mail@example.org', connectedBy: 'admin@example.org', connectedAt: 1760000000, lastOkAt: 1760000000, lastError: null, usesLegacySecret: false, hasStoredToken: true },
  ],
  rows: N(60, (i) => ({ seq: i, at: 1760000000 + i, user_email: 'a@example.org', action: 'users.update', target_type: 'user', target_id: 'u1', details: JSON.stringify({ note: 'ok' }) })),
  hasMore: true, year: 2026, edition: {},
  items: N(60, (i) => ({ id: `i${i}`, sort: i, slug: `s${i}`, name: `Speaker ${i}`, position: 'Prof.', company: 'Uni', bio: '', photo: '', linkedin: '',
    title: `Talk ${i}`, type: 'talk', time: '09:00', endTime: '09:30', description: '', speakerSlugs: [], day: 1, titleTr: '', descriptionTr: '',
    role: 'Chair', roleTr: '', affiliation: 'Lab', teams: ['A'], teamsTr: [] })),
  certificates: N(60, (i) => ({ id: `c${i}`, email: `p${i}@example.org`, name: `Person ${i}`, kind: 'participation', size_bytes: 877, expires_at: 1794415522 })),
  totalBytes: 60 * 877,
  posts: [], plans: [], modes: [], editors: [],
};
const POSTS = N(12, (i) => ({ id: `p${i}`, type: 'image', caption: `Caption ${i}`, captionOverrides: {}, link: null, media: [], platforms: ['instagram'], scheduledAt: now + i * 3600, status: i % 2 ? 'pending_approval' : 'draft', revision: 1,
  createdBy: 'u2', authorEmail: 'editor@example.org', approvedBy: null, approvedAt: null, reviewNote: null, planId: null, planTitle: null, eventModeId: null, createdAt: now, updatedAt: now, targets: [] }));
const PLANS = N(6, (i) => ({ id: `pl${i}`, title: `Plan ${i}`, scheduledAt: now + i * 86400, platforms: ['instagram'], postType: 'image', assigneeId: 'u2', assigneeEmail: 'editor@example.org', note: 'n', postId: null, postStatus: null, createdBy: 'u1', createdAt: now }));
const EDITORS = [{ id: 'u2', email: 'editor@example.org', name: 'Editor Two', isPublisher: false }];
const MODES = N(10, (i) => ({ id: `m${i}`, name: `Event ${i}`, startsAt: now + i * 86400, endsAt: now + (i + 1) * 86400, editorIds: ['u2'], editorEmails: ['editor@example.org'], openedBy: 'u1', closedAt: null, active: i === 1 }));

const browser = await chromium.launch();

async function open(path, viewport, user = ADMIN) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push(`pageerror (${path} ${viewport.width}px): ` + String(e).slice(0, 160)));
  page.inflight = 0;
  await page.route('**/api/**', async (r) => {
    page.inflight++;
    try { await answer(r); } finally { page.inflight--; }
  });
  async function answer(r) {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (req.method() !== 'GET') return r.fulfill({ status: 204, body: '' });
    if (url.pathname === '/api/me') return json({ user, profile: {} });
    if (url.pathname === '/api/admin/counts') return json(COUNTS);
    if (url.pathname === '/api/mail/conversations') return json({ threads: MAIL_THREADS, unreadCount: 1, scope: 'own', isAdmin: user.is_admin === true });
    if (/^\/api\/mail\/conversations\/[^/]+$/.test(url.pathname)) return json(MAIL_THREAD);
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: true });
    if (url.pathname === '/api/social/plans') return json({ plans: PLANS });
    if (url.pathname === '/api/social/posts') return json({ posts: POSTS });
    if (url.pathname === '/api/social/editors') return json({ editors: EDITORS });
    if (url.pathname === '/api/social/event-modes') return json({ modes: MODES });
    const q = url.searchParams.get('search');
    if (url.pathname === '/api/admin/users' && q) return json({ ...FULL, users: USERS.filter((u) => u.email.includes(q)) });
    return json(FULL);
  }
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return page;
}

// The same settle as admin-overflow.mjs: the menu marks the section and the
// addressed sub-page is the only one shown, with content.
const settle = (page, h) => page.waitForFunction((x) => {
  const [section, sub] = x.slice(1).split('/');
  if (!location.hash.startsWith('#' + section)) return false;
  if (document.querySelector('[data-nav][aria-current="page"]')?.dataset.nav !== section) return false;
  const root = document.querySelector(`[data-section="${section}"]`);
  if (!root || root.classList.contains('hidden')) return false;
  if (sub) {
    const shown = [...root.querySelectorAll('[data-sub]')].filter((el) => !el.classList.contains('hidden'));
    return shown.length === 1 && shown[0].dataset.sub === sub && shown[0].innerText.trim().length > 0;
  }
  if (root.querySelector('[data-sub]')) {
    if (document.querySelectorAll('#subNav a').length === 0) return false;
    const shown = [...root.querySelectorAll('[data-sub]')].filter((el) => !el.classList.contains('hidden'));
    return shown.length === 0 || (shown.length === 1 && shown[0].innerText.trim().length > 0);
  }
  return root.innerText.trim().length > 0;
}, h, { timeout: 8000 }).then(() => true, () => false);

async function quiet(page) {
  for (let i = 0; i < 200 && page.inflight > 0; i++) await page.waitForTimeout(25);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  for (let i = 0; i < 200 && page.inflight > 0; i++) await page.waitForTimeout(25);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

async function go(page, h) {
  await page.evaluate((x) => { location.hash = x; }, h);
  const reached = await settle(page, h);
  await quiet(page);
  if (reached && /^#sosyal\/(takvim|onay|taslaklar)$/.test(h)) {
    await page.waitForSelector('[data-social-view]:not(.hidden) [data-entry], [data-social-view]:not(.hidden) [data-post]', { timeout: 5000 }).catch(() => {});
  }
  return reached;
}

async function routes(lang, user) {
  const page = await open(lang + '/admin', { width: 1280, height: 800 }, user);
  const sections = await page.locator('#sectionNav [data-nav]').evaluateAll((els) => els.map((e) => e.dataset.nav));
  const out = [];
  for (const s of sections) {
    ok(await go(page, '#' + s), `${lang || '/en'}: menu section #${s} could not be reached`);
    const subs = await page.locator('#subNav [data-sub-link]').evaluateAll((els) => els.map((e) => e.dataset.subLink));
    out.push('#' + s);
    for (const sub of subs) out.push(`#${s}/${sub}`);
  }
  await page.close();
  if (out.includes('#eposta/gelen')) out.push('#eposta/gelen/t60');
  return [...new Set(out)];
}

const fits = (page) => page.evaluate(() => ({ h: document.scrollingElement.scrollHeight, ih: innerHeight, y: scrollY }));
const fitMsg = (f) => `scrollHeight ${f.h} vs innerHeight ${f.ih}, scrollY ${f.y}`;
const inView = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return { ok: false, why: 'missing' };
  const r = el.getBoundingClientRect();
  return { ok: r.height > 0 && r.top >= 0 && r.bottom <= innerHeight + 0.5, why: `top ${Math.round(r.top)} bottom ${Math.round(r.bottom)} of ${innerHeight}` };
}, sel);

const LAPTOPS = [{ width: 1280, height: 800 }, { width: 1440, height: 900 }, { width: 1280, height: 680 }, { width: 1024, height: 768 }];

console.log('1) every route, every laptop size: the document does not scroll');
let checked = 0;
for (const [who, user] of [['admin', ADMIN], ['sender', SENDER]])
for (const lang of ['', '/tr']) {
  const all = await routes(lang, user);
  ok(all.length >= (who === 'admin' ? 20 : 3), `${who} ${lang || '/en'}: found the routes (${all.length})`);
  for (const vp of LAPTOPS) {
    const page = await open(lang + '/admin', vp, user);
    for (const h of all) {
      const tag = `${who} ${lang || '/en'} ${vp.width}x${vp.height} ${h}`;
      const reached = await go(page, h);
      ok(reached, `${tag}: route did not settle`);
      if (!reached) continue;
      checked++;
      const f = await fits(page);
      ok(f.h <= f.ih + 1 && f.y === 0, `${tag}: the page scrolls (${fitMsg(f)})`);
    }
    await page.close();
  }
}
pass(checked > 0 && !bad.some((m) => m.includes('the page scrolls')), `${checked} route x size combinations fit the window`);

for (const vp of LAPTOPS) for (const lang of ['', '/tr']) {
  const tag = `${lang || '/en'} ${vp.width}x${vp.height}`;
  console.log(`2) ${tag}: long lists scroll in their own box, side panels stay on screen`);
  const page = await open(lang + '/admin', vp);

  // Members: the wheel over the list scrolls the list, not the page.
  await go(page, '#kullanicilar/liste');
  await page.waitForSelector('#usersList [data-user="u200"]');
  const box = await page.locator('#usersList').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 100));
  await page.mouse.wheel(0, 1200);
  const scrolled = await page.waitForFunction(() => document.getElementById('usersList').scrollTop > 0, null, { timeout: 3000 }).then(() => true, () => false);
  pass(scrolled && (await fits(page)).y === 0, `${tag}: the wheel scrolls the members list, the page stays put`);
  await page.locator('#usersList [data-user="u200"]').scrollIntoViewIfNeeded();
  await page.click('#usersList [data-user="u200"]');
  await page.waitForFunction(() => document.getElementById('userDetail')?.textContent.includes('person200@example.org'), null, { timeout: 3000 }).catch(() => {});
  let v = await inView(page, '#userDetail');
  let f = await fits(page);
  pass(v.ok && f.y === 0 && f.h <= f.ih + 1, `${tag}: the last member's detail is fully on screen (${v.why}; ${fitMsg(f)})`);

  // Mail: a thread from the bottom of a long list.
  await go(page, '#eposta/gelen');
  await page.waitForSelector('#mailInboxList a[href$="/t60"]');
  await page.locator('#mailInboxList a[href$="/t60"]').scrollIntoViewIfNeeded();
  const listScrolled = await page.evaluate(() => document.getElementById('mailInboxListCard').scrollTop > 0);
  await page.click('#mailInboxList a[href$="/t60"]');
  await page.waitForFunction(() => !document.getElementById('mailThreadView').classList.contains('hidden') && document.getElementById('mailThreadSubject').textContent === 'Subject 60', null, { timeout: 5000 }).catch(() => {});
  v = await inView(page, '#mailThreadCard');
  f = await fits(page);
  pass(listScrolled && v.ok && f.y === 0 && f.h <= f.ih + 1, `${tag}: the thread list scrolls in its card and the opened thread is fully on screen (${v.why}; ${fitMsg(f)})`);
  const reply = await inView(page, '#mailThreadView h3');
  pass(reply.ok, `${tag}: the thread's subject is on screen (${reply.why})`);

  // Symposium: edit the last speaker; the form comes into view with its save bar.
  await go(page, '#sempozyum/konusmacilar');
  await page.waitForSelector('#symSpeakersTableBody .edit-speaker-btn[data-id="i60"]');
  await page.locator('.edit-speaker-btn[data-id="i60"]').scrollIntoViewIfNeeded();
  const bodyScrolled = await page.evaluate(() => document.getElementById('sectionBody').scrollTop > 0);
  await page.click('.edit-speaker-btn[data-id="i60"]');
  await page.waitForFunction(() => document.getElementById('symSpeakerName').value === 'Speaker 60', null, { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(100);
  const name = await inView(page, '#symSpeakerName');
  const bar = await inView(page, '#symSpeakerForm button[type=submit]');
  f = await fits(page);
  pass(bodyScrolled && name.ok && bar.ok && f.y === 0 && f.h <= f.ih + 1, `${tag}: editing the last speaker shows the form and its save button (name ${name.why}; save ${bar.why}; ${fitMsg(f)})`);

  // The side panel and toasts keep working: the social calendar's panel opens on screen.
  await go(page, '#sosyal/takvim');
  const entry = page.locator('#socialCalendar [data-entry]').first();
  if (await entry.count()) {
    await entry.click();
    await page.waitForSelector('#socialSide:not(.hidden)', { timeout: 3000 }).catch(() => {});
    v = await inView(page, '#socialSide');
    f = await fits(page);
    pass(v.ok && f.y === 0, `${tag}: the calendar's side panel is on screen (${v.why}; ${fitMsg(f)})`);
  } else pass(false, `${tag}: the calendar drew no entries`);
  await page.close();
}

console.log('3) a new page starts at its top, not where the last one was left');
{
  const page = await open('/admin', { width: 1280, height: 680 });
  await go(page, '#kayit');
  const box = await page.locator('#sectionBody').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 3000);
  const deep = await page.waitForFunction(() => document.getElementById('sectionBody').scrollTop > 200, null, { timeout: 3000 }).then(() => true, () => false);
  await go(page, '#duyurular');
  const top = await page.evaluate(() => document.getElementById('sectionBody').scrollTop);
  const form = await inView(page, '#annTitle');
  pass(deep && top === 0 && form.ok, `Announcements opens at its form after scrolling the activity log (scrollTop ${top}; ${form.why})`);
  await go(page, '#sempozyum/konusmacilar');
  await page.mouse.wheel(0, 3000);
  await page.waitForFunction(() => document.getElementById('sectionBody').scrollTop > 200, null, { timeout: 3000 }).catch(() => {});
  await go(page, '#sempozyum/baski');
  pass(await page.evaluate(() => document.getElementById('sectionBody').scrollTop) === 0, 'a sibling sub-page opens at its top too');
  // No matches: the message sits at the top of the list's place, not under an empty box.
  await go(page, '#kullanicilar/liste');
  await page.fill('#searchInput', 'zzz-nobody');
  await page.waitForSelector('#emptyState:not(.hidden)', { timeout: 3000 }).catch(() => {});
  const empty = await inView(page, '#emptyState');
  const below = await page.evaluate(() => document.getElementById('emptyState').getBoundingClientRect().top - document.querySelector('#usersPane .bg-white').getBoundingClientRect().bottom);
  pass(empty.ok && below < 40, `"No users found" sits right under the search (${Math.round(below)} px below it)`);
  await page.close();
}

console.log('4) phone, 390 px: the page still scrolls as before');
{
  const page = await open('/admin', { width: 390, height: 844 });
  await go(page, '#kullanicilar/liste');
  await page.waitForSelector('#usersList [data-user="u200"]');
  const f = await fits(page);
  pass(f.h > f.ih * 3, `the members list makes the page long (${fitMsg(f)})`);
  const listBox = await page.evaluate(() => getComputedStyle(document.getElementById('usersList')).overflowY);
  pass(listBox === 'visible', `the list is not its own scroll box on a phone (overflow-y ${listBox})`);
  await page.mouse.move(195, 600);
  await page.mouse.wheel(0, 800);
  const moved = await page.waitForFunction(() => scrollY > 0, null, { timeout: 3000 }).then(() => true, () => false);
  pass(moved, 'the wheel scrolls the page');
  const footer = await page.locator('footer').isVisible();
  pass(footer, 'the site footer is still there');
  await page.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
