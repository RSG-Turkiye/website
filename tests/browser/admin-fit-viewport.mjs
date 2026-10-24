/**
 * The admin panel fits the window from lg up, in a real browser: on a laptop
 * the page itself never scrolls; long lists scroll inside their own boxes and
 * a side panel (a member, a mail thread, an edit form) is on screen without
 * scrolling the page. On a phone the page still scrolls as before. The
 * section title and sub-page tabs stay put however far the content scrolls
 * (with and without the podcast bar), the social calendar fits its box with
 * "+N more" on a busy day, and the content's type is desktop-sized.
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
const COUNTS = { email: 3, social: 2, blog: 1, scheduledThisWeek: 4, cmsMine: 2, cmsQueue: 1, cmsTotal: 3 };
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
// A busy month: twelve posts on today, five tomorrow (Istanbul days), so
// some calendar cells have more than they can show.
const DAY0 = Math.floor((now + 3 * 3600) / 86400) * 86400 - 3 * 3600;
const BUSY = [
  ...N(12, (i) => ({ ...POSTS[0], id: `busy${i}`, caption: `Busy post ${i}`, scheduledAt: DAY0 + 8 * 3600 + i * 900, status: i % 3 ? 'scheduled' : 'pending_approval' })),
  ...N(5, (i) => ({ ...POSTS[0], id: `next${i}`, caption: `Next day ${i}`, scheduledAt: DAY0 + 86400 + 9 * 3600 + i * 900, status: 'draft' })),
  ...POSTS,
];
const PLANS = N(6, (i) => ({ id: `pl${i}`, title: `Plan ${i}`, scheduledAt: now + i * 86400, platforms: ['instagram'], postType: 'image', assigneeId: 'u2', assigneeEmail: 'editor@example.org', note: 'n', postId: null, postStatus: null, createdBy: 'u1', createdAt: now }));
const EDITORS = [{ id: 'u2', email: 'editor@example.org', name: 'Editor Two', isPublisher: false }];
const MODES = N(10, (i) => ({ id: `m${i}`, name: `Event ${i}`, startsAt: now + i * 86400, endsAt: now + (i + 1) * 86400, editorIds: ['u2'], editorEmails: ['editor@example.org'], openedBy: 'u1', closedAt: null, active: i === 1 }));

// The Etkinlikler panel: 60 of each, so the lists have something to scroll.
const CMS_EVENT = {
  id: 'symposium-2026', type: 'symposium', start: '2026-10-10', note: 'n',
  title: { en: 'Symposium 2026', tr: 'Sempozyum 2026' }, when: { en: '10 October 2026', tr: '10 Ekim 2026' },
  location: { en: 'Ankara', tr: 'Ankara' }, description: { en: 'Description', tr: 'Açıklama' },
  links: N(6, (i) => ({ label: { en: `Link ${i}`, tr: `Bağlantı ${i}` }, url: `https://example.org/${i}` })),
};
const CMS_COMMITTEE = {
  order: 10, name: { en: 'Committee', tr: 'Komite' }, description: { en: 'Description', tr: 'Açıklama' },
  members: N(8, (i) => ({ name: `Member ${i}`, role: { en: 'Role', tr: 'Görev' }, image: '/api/images/a.webp', consent: true })),
};
/** The podcast (generated, no form): its list, a pulled draft and its review. */
const POD_EP = (i) => ({ guid: `g${i}`, title: `Episode ${i}`, pubDate: `2025-01-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`, durationSeconds: 3065,
  audioUrl: `https://example.org/${i}.m4a`, audioBytes: 1, image: '', description: 'Description' });
const CMS_PODCAST = { syncedAt: '2025-06-01T00:00:00.000Z', title: 'Podcast', description: 'Description', image: 'https://example.org/i.jpg',
  platforms: { spotify: 'https://example.org/s', apple: 'https://example.org/a', castbox: 'https://example.org/c', rss: 'https://example.org/r' },
  episodes: Array.from({ length: 14 }, (_, i) => POD_EP(14 - 1 - i)) };
const CMS_PODCAST_NEW = { ...CMS_PODCAST, episodes: [POD_EP(14), ...CMS_PODCAST.episodes] };
const POD_DRAFT = '00000000-0000-4000-8000-000000000399';
const CMS_ENTRIES = {
  podcast: [{ id: 'podcast', title: CMS_PODCAST.title, date: '2025-01-01', shas: {} }],
  committees: N(8, (i) => ({ id: `c${i}`, title: `Committee ${i}`, shas: {} })),
  events: [{ id: 'symposium-2026', title: 'Symposium 2026', date: '2026-10-10', shas: {} }, ...N(59, (i) => ({ id: `e${i}`, title: `Event ${i}`, date: '2025-01-01', shas: {} }))],
  workshops: N(20, (i) => ({ id: `w${i}`, title: `Workshop ${i}`, date: '2024', shas: {} })),
  webinars: N(60, (i) => ({ id: `wb${i}`, title: `Webinar ${i}`, date: '2024-04-16', paths: { en: `src/content/webinars/en/wb${i}.md`, tr: `src/content/webinars/tr/wb${i}.md` }, shas: {} })),
};
const CMS_DRAFTS = N(30, (i) => ({
  id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, '0')}`, type: 'events', entry_id: i === 1 ? 'symposium-2026' : `e${i}`, action: 'update',
  status: ['draft', 'submitted', 'rejected', 'pr_failed', 'pr_open', 'published'][i % 6], author_id: 'u1', author_name: 'Editor', reviewer_id: null,
  review_note: i % 6 === 2 ? 'Fix the date' : null, pr_url: null, pr_number: null, failure: i % 6 === 3 ? 'checks did not finish' : null,
  stale_merge: false, created_at: 1760000000, updated_at: 1760000000 + i,
}));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

// ONLY=1,5 runs just those parts (a debugging aid; the default is all of them).
const want = (n) => !process.env.ONLY || process.env.ONLY.split(',').includes(String(n));

async function open(path, viewport, user = ADMIN, { podcast = true, posts = POSTS } = {}) {
  const page = await browser.newPage({ viewport });
  // The podcast bar shows unless it was dismissed; it takes height off the panel.
  if (!podcast) await page.addInitScript(() => { try { localStorage.setItem('rsg:podcast-strip-dismissed', '1'); } catch {} });
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
    // An admin approves every type (approve per type: functions/api/cms/types.ts).
    if (url.pathname === '/api/cms/types') return json({ types: [['events', 'etkinlikler'], ['workshops', 'etkinlikler'], ['webinars', 'etkinlikler'], ['committees', 'topluluk'], ['podcast', 'topluluk']].map(([key, group]) => ({ key, group, canApprove: true })) });
    if (url.pathname === '/api/cms/entries') return json({ entries: CMS_ENTRIES[url.searchParams.get('type')] ?? [] });
    if (url.pathname === '/api/cms/entry' && url.searchParams.get('type') === 'podcast') return json({ data: CMS_PODCAST, base_shas: { 'src/data/podcast.json': 'sha' }, files: { 'src/data/podcast.json': JSON.stringify(CMS_PODCAST, null, 2) } });
    if (url.pathname === `/api/cms/drafts/${POD_DRAFT}`) return json({ draft: { ...CMS_DRAFTS[1], id: POD_DRAFT, type: 'podcast', entry_id: 'podcast', status: 'draft', write_nonce: 'n', data: CMS_PODCAST_NEW, base_shas: { 'src/data/podcast.json': 'sha' } }, files: null });
    if (url.pathname === '/api/cms/entry' && url.searchParams.get('type') === 'committees') return json({ data: CMS_COMMITTEE, base_shas: { 'src/content/committees/c0.json': 'sha' } });
    if (url.pathname === '/api/cms/entry') return json({ data: CMS_EVENT, base_shas: { 'src/content/events/symposium-2026.json': 'sha' } });
    if (url.pathname === '/api/cms/drafts') return json({ mine: CMS_DRAFTS, queue: CMS_DRAFTS.filter((d) => d.status === 'submitted'), more: false, live: [] });
    if (/^\/api\/cms\/drafts\/[^/]+$/.test(url.pathname)) return json({ draft: { ...CMS_DRAFTS.find((d) => d.id === url.pathname.split('/').pop()) ?? CMS_DRAFTS[1], data: CMS_EVENT, base_shas: {} } });
    if (url.pathname === '/api/social/plans') return json({ plans: PLANS });
    if (url.pathname === '/api/social/posts') return json({ posts });
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
  if (out.includes('#icerik/etkinlikler')) out.push('#icerik/etkinlikler/symposium-2026', '#icerik/webinarlar/_new', '#icerik/taslaklar/00000000-0000-4000-8000-000000000002', '#icerik/onay/00000000-0000-4000-8000-000000000001');
  if (out.includes('#icerik/komiteler')) out.push('#icerik/komiteler/c0');
  if (out.includes('#icerik/podcast')) out.push(`#icerik/taslaklar/${POD_DRAFT}`, `#icerik/onay/${POD_DRAFT}`);
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

let checked = 0;
if (want(1)) console.log('1) every route, every laptop size: the document does not scroll');
if (want(1)) for (const [who, user] of [['admin', ADMIN], ['sender', SENDER]])
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
if (want(1)) pass(checked > 0 && !bad.some((m) => m.includes('the page scrolls')), `${checked} route x size combinations fit the window`);

if (want(2)) for (const vp of LAPTOPS) for (const lang of ['', '/tr']) {
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

if (want(3)) {
  console.log('3) a new page starts at its top, not where the last one was left');
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

if (want(4)) {
  console.log('4) phone, 390 px: the page still scrolls as before');
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

// Where the section's title and its sub-page tabs are on screen.
const heads = (page) => page.evaluate(() => {
  const top = (el) => (el ? Math.round(el.getBoundingClientRect().top * 2) / 2 : null);
  const tab = document.querySelector('#subNav [role=tab]');
  return { title: top(document.getElementById('sectionTitle')), tabs: top(tab), hasTabs: !!tab, y: scrollY, main: document.querySelector('main').scrollTop };
});

// Scrolls the content as far down as it goes: the wheel over the middle of
// the content, then every scroll box in it to its end, then the section's
// last element into view the way revealInPanel and focus do.
async function scrollContentToBottom(page) {
  const box = await page.evaluate(() => {
    const r = document.getElementById('sectionBody').getBoundingClientRect();
    const bottom = Math.min(r.bottom, innerHeight);
    return { x: r.left + r.width / 2, y: r.top + (bottom - r.top) / 2 };
  });
  await page.mouse.move(box.x, box.y);
  for (let i = 0; i < 3; i++) await page.mouse.wheel(0, 4000);
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    const body = document.getElementById('sectionBody');
    for (const el of [body, ...body.querySelectorAll('*')]) {
      if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) el.scrollTop = el.scrollHeight;
    }
    const shown = [...body.querySelectorAll('[data-section]:not(.hidden) *')].filter((el) => el.getClientRects().length > 0);
    shown.at(-1)?.scrollIntoView({ block: 'end' });
  });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
}

if (want(5)) {
  console.log('5) the section title and the sub-page tabs never move when the content scrolls');
  const all = await routes('', ADMIN);
  const sizes = [
    [{ width: 1280, height: 680 }, true], [{ width: 1366, height: 768 }, true], [{ width: 1024, height: 768 }, true], [{ width: 1440, height: 900 }, true],
    [{ width: 1280, height: 680 }, false], [{ width: 1366, height: 768 }, false],
  ];
  let n = 0;
  for (const [vp, podcast] of sizes) {
    const page = await open('/admin', vp, ADMIN, { podcast });
    const strip = await page.evaluate(() => { const s = document.getElementById('podcastStrip'); return !!s && !s.hidden; });
    ok(strip === podcast, `${vp.width}x${vp.height}: the podcast bar is ${podcast ? 'shown' : 'dismissed'} as asked (shown: ${strip})`);
    for (const h of all) {
      const tag = `${vp.width}x${vp.height}${podcast ? ' +podcast' : ''} ${h}`;
      if (!(await go(page, h))) { ok(false, `${tag}: route did not settle`); continue; }
      const before = await heads(page);
      await scrollContentToBottom(page);
      const after = await heads(page);
      n++;
      ok(before.title === after.title && before.tabs === after.tabs && after.y === 0 && after.main === 0,
        `${tag}: the heading moved (title ${before.title} -> ${after.title}, tabs ${before.tabs} -> ${after.tabs}, scrollY ${after.y}, main ${after.main})`);
      if (after.hasTabs) ok(after.tabs >= 0 && after.tabs < 200, `${tag}: the tabs are not at the top of the window (${after.tabs})`);
      await page.evaluate(() => document.getElementById('sectionBody').scrollTo(0, 0));
    }
    await page.close();
  }
  pass(n > 0 && !bad.some((m) => m.includes('the heading moved') || m.includes('tabs are not')), `${n} route x size combinations keep the title and tabs in place`);
}

if (want(6)) {
  console.log('6) the social calendar fits its box: no scrollbar, a busy day shows "+N more"');
  for (const vp of [{ width: 1024, height: 768 }, { width: 1280, height: 680 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) for (const podcast of [true, false]) {
    const tag = `${vp.width}x${vp.height}${podcast ? ' +podcast' : ''}`;
    const page = await open('/admin', vp, ADMIN, { podcast, posts: BUSY });
    await go(page, '#sosyal/takvim');
    await page.waitForSelector('#socialCalendar [data-entry]', { state: 'attached' });
    await quiet(page);
    const m = await page.evaluate((day0) => {
      const cal = document.getElementById('socialCalendar');
      const grid = cal.querySelector('[data-month-grid]');
      const strip = document.getElementById('podcastStrip');
      const floor = innerHeight - (strip && !strip.hidden ? strip.getBoundingClientRect().height : 0);
      const key = (e) => new Date((e + 3 * 3600) * 1000).toISOString().slice(0, 10);
      const busy = cal.querySelector(`[data-day="${key(day0)}"]`);
      const more = busy?.querySelector('[data-more]');
      const spill = [];
      for (const cell of cal.querySelectorAll('[data-day]')) {
        const c = cell.getBoundingClientRect();
        for (const el of cell.querySelectorAll('*')) {
          if (el.closest('[hidden]') || el.getClientRects().length === 0) continue;
          const r = el.getBoundingClientRect();
          if (r.height > 0 && (r.bottom > c.bottom + 0.5 || r.top < c.top - 0.5)) spill.push(`${cell.dataset.day}: ${el.textContent.trim().slice(0, 20)}`);
        }
      }
      const legend = cal.lastElementChild.getBoundingClientRect();
      return {
        cal: [cal.scrollHeight, cal.clientHeight], grid: [grid.scrollHeight, grid.clientHeight],
        bottom: Math.round(cal.getBoundingClientRect().bottom), legend: Math.round(legend.bottom), floor: Math.round(floor),
        moreShown: !!more && !more.hidden, moreText: more?.textContent ?? '',
        shownEntries: busy ? [...busy.querySelectorAll('[data-entry]')].filter((e) => !e.hidden).length : -1,
        allEntries: busy ? busy.querySelectorAll('[data-entry]').length : -1,
        rowH: Math.round(busy?.getBoundingClientRect().height ?? 0),
        spill, y: scrollY, docH: document.scrollingElement.scrollHeight,
      };
    }, DAY0);
    pass(m.cal[0] <= m.cal[1] + 1 && m.grid[0] <= m.grid[1] + 1, `${tag}: neither the calendar nor its grid scrolls (calendar ${m.cal}, grid ${m.grid})`);
    pass(m.bottom <= m.floor + 1 && m.legend <= m.floor + 1 && m.y === 0 && m.docH <= vp.height + 1, `${tag}: the whole calendar and its legend are on screen (bottom ${m.bottom}, legend ${m.legend}, floor ${m.floor}, scrollY ${m.y})`);
    const hiddenN = Number((m.moreText.match(/\+(\d+)/) ?? [])[1] ?? 0);
    pass(m.allEntries >= 12 && m.moreShown && hiddenN > 0 && m.shownEntries > 0 && hiddenN + m.shownEntries === m.allEntries, `${tag}: the busy day shows ${m.shownEntries} of ${m.allEntries} and "${m.moreText}" (cell ${m.rowH} px tall)`);
    pass(m.spill.length === 0, `${tag}: nothing spills out of a day cell (${m.spill.slice(0, 3).join('; ')})`);
    if (vp.width === 1280 && vp.height === 680 && podcast) {
      await page.click('#socialCalendar [data-more]:not([hidden])');
      await page.waitForSelector('#socialSide:not(.hidden) [data-day-list]', { timeout: 3000 }).catch(() => {});
      const listed = await page.locator('#socialSide [data-day-list] [data-entry]').count();
      const v = await inView(page, '#socialSide');
      pass(listed === m.allEntries && v.ok, `${tag}: "+N more" lists the whole day in the side panel (${listed} of ${m.allEntries} items; ${v.why})`);
      await page.click('#socialSide [data-day-list] [data-entry][data-id="busy12"]');
      const opened = await page.waitForFunction(() => !document.querySelector('#socialSide [data-day-list]') && document.getElementById('socialSide').textContent.includes('editor@example.org'), null, { timeout: 3000 }).then(() => true, () => false);
      pass(opened, `${tag}: an item in the day list opens that item`);
      // The board fills the same box; its columns scroll on their own.
      await page.click('#socialViewBoard');
      const b = await page.evaluate(() => { const c = document.getElementById('socialCalendar'); return [c.scrollHeight, c.clientHeight, scrollY]; });
      pass(b[0] <= b[1] + 1 && b[2] === 0, `${tag}: the board fits the same box (${b})`);
      await page.click('#socialViewCalendar');
    }
    await page.close();
  }
}

if (want(7)) {
  console.log('7) at 1280 the content is set like a desktop tool: title <= 20 px, row titles <= 14 px, nothing over 16 px');
  const all = await routes('', ADMIN);
  const page = await open('/admin', { width: 1280, height: 800 });
  let rows = 0;
  for (const h of all) {
    if (!(await go(page, h))) { ok(false, `${h}: route did not settle`); continue; }
    if (h === '#kullanicilar/liste') { await page.click('#usersList [data-user="u2"]'); await page.waitForTimeout(50); }
    const f = await page.evaluate(() => {
      const px = (el) => parseFloat(getComputedStyle(el).fontSize);
      const shown = (el) => el.getClientRects().length > 0 && !el.closest('.hidden,[hidden]');
      const body = document.getElementById('sectionBody');
      const rowTitles = [...body.querySelectorAll('[data-row-title]')].filter(shown).map(px);
      // A heading kept for screen readers only (lg:sr-only) is a 1 px box.
      const srOnly = (el) => el.getBoundingClientRect().width <= 1;
      const hasText = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const big = [...body.querySelectorAll('*')].filter((el) => shown(el) && hasText(el) && !srOnly(el) && px(el) > 16)
        .map((el) => `${el.tagName.toLowerCase()} ${px(el)}px "${el.textContent.trim().slice(0, 24)}"`);
      return { title: px(document.getElementById('sectionTitle')), rowTitles, big };
    });
    rows += f.rowTitles.length;
    ok(f.title <= 20, `${h}: the section title is ${f.title}px`);
    ok(f.rowTitles.every((x) => x <= 14), `${h}: a row title is over 14px (${Math.max(...f.rowTitles)})`);
    ok(f.big.length === 0, `${h}: text over 16px in the content: ${f.big.slice(0, 3).join('; ')}`);
  }
  await page.close();
  pass(rows > 50 && !bad.some((m) => / title is |row title is over|text over 16px/.test(m)), `${all.length} routes: title <= 20px, ${rows} row titles <= 14px, no content text over 16px`);
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
