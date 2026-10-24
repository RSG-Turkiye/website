/**
 * Whole-panel check, in a real browser: every section and sub-page, as an
 * admin, in English and Turkish, at 390 and 1280 px. Nothing may be wider than
 * the viewport, on the phone every button, link and checkbox in the content is
 * at least 44 px tall, and no page throws.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/admin-overflow.mjs
 *
 * Every API call is intercepted, so nothing is read or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { if (!c) { console.log(`   ✗ ${m}`); bad.push(m); } };

const ADMIN = { id: 'u1', email: 'admin@example.org', is_admin: true, is_social_publisher: true, is_symposium: true, is_announcer: true };
const SENDER = { id: 'u3', email: 'sender@example.org', is_sender: true };
const COUNTS = { email: 3, social: 2, blog: 1, scheduledThisWeek: 4, cmsMine: 2, cmsQueue: 1, cmsTotal: 3 };
const long = 'x'.repeat(120);
const now0 = Math.floor(Date.now() / 1000);
// Mail: a 120-character subject, a 60-character address and a long unbroken snippet.
const LONG_ADDR = 'r'.repeat(48) + '@example.org'; // 60 characters
const MAIL_THREADS = [
  { id: 't1', recipient_email: 'ayse@example.org', recipient_name: 'Ayse', subject: 'Sponsorship', last_message_at: 1760000300, last_direction: 'in', unread: 1, snippet: 'Thanks a lot' },
  { id: 't2', recipient_email: LONG_ADDR, recipient_name: long, subject: long, last_message_at: 1760000200, last_direction: 'out', unread: 0, snippet: long + long, sender_email: LONG_ADDR, sender_name: long },
];
const MAIL_THREAD = {
  thread: { id: 't2', recipient_email: LONG_ADDR, recipient_name: long, subject: long, sender_email: 'sender@example.org', can_reply: true },
  messages: [
    { id: 'm1', direction: 'out', from_email: 'rsg@example.org', from_name: null, body_html: '<p>' + long + long + '</p>', attachment_count: 0, sent_at: 1760000000 },
    { id: 'm2', direction: 'in', from_email: LONG_ADDR, from_name: long, body_html: '<p>' + long + '</p>', attachment_count: 1, sent_at: 1760000060 },
  ],
};
// Two realistic items per list, one with a long unbroken string.
const FULL = {
  users: [
    { id: 'u1', email: 'admin@example.org', display_name: 'Admin One', is_admin: 1, is_announcer: 0, is_symposium: 0, is_social: 0, badges: [] },
    { id: 'u2', email: long + '@example.org', display_name: 'Long ' + long, is_admin: 0, is_announcer: 1, is_symposium: 1, is_social: 1, badges: [] },
  ],
  badge_catalog: [],
  announcements: [
    { id: 'a1', title: 'Registration closes soon', description: 'd', button_text: 'Go', button_url: 'https://example.org', expires_at: 1893456000, site: 'main', show_as_popup: true },
    { id: 'a2', title: 'Closes ' + long, description: 'd', button_text: 'Go', button_url: 'https://example.org', expires_at: 1893456000, site: 'main', show_as_popup: false },
  ],
  submissions: [
    { id: 'b1', lang: 'en', title: 'A post', description: 'd', category: 'news', tags: ['x'], author: 'a', image_url: '', body: 'text', slug: 's', status: 'pending', rejection_reason: null, pr_url: null, paired_submission_id: null, submitter_email: 'someone@example.org' },
    { id: 'b2', lang: 'en', title: 'Long ' + long, description: 'd', category: 'news', tags: ['x'], author: 'a', image_url: '', body: long, slug: 's2', status: 'pending', rejection_reason: null, pr_url: null, paired_submission_id: null, submitter_email: long + '@example.org' },
  ],
  senders: [
    { user_id: 'u9', email: 'sender@example.org', display_name: 'Sender', team: 'Comms', granted_at: 1760000000, granted_by_email: 'admin@example.org' },
    { user_id: 'u8', email: long + '@example.org', display_name: long, team: long, granted_at: 1760000000, granted_by_email: 'admin@example.org' },
  ],
  attachments: [
    { id: 'f1', filename: 'poster.pdf', size_bytes: 2048, uploaded_at: 1760000000, is_active: 1 },
    { id: 'f2', filename: long + '.pdf', size_bytes: 2048, uploaded_at: 1760000000, is_active: 0 },
  ],
  sends: [
    { subject: 'Hello', sender_email: 's@example.org', sender_name: null, recipient_email: 'r@example.org', sent_at: 1760000000, status: 'sent', error_message: null },
    { subject: 'Hello ' + long, sender_email: 's@example.org', sender_name: null, recipient_email: LONG_ADDR, sent_at: 1760000000, status: 'failed', error_message: long },
  ],
  scheduled: [
    { id: 's1', subject: 'Later', recipient_email: 'r@example.org', recipients: ['r@example.org'], send_at: now0 + 86400, status: 'pending', sender_email: 's@example.org' },
    { id: 's2', subject: long, recipient_email: LONG_ADDR, recipients: [LONG_ADDR], send_at: now0 + 86400, status: 'pending', sender_email: LONG_ADDR },
  ],
  connections: [
    { platform: 'gmail', status: 'connected', accountName: 'mail@example.org', connectedBy: 'admin@example.org', connectedAt: 1760000000, lastOkAt: 1760000000, lastError: null, usesLegacySecret: false, hasStoredToken: true },
    { platform: 'x', status: 'broken', accountName: long, connectedBy: 'admin@example.org', connectedAt: 1760000000, lastOkAt: null, lastError: long, usesLegacySecret: false, hasStoredToken: true },
  ],
  rows: [
    { seq: 1, at: 1760000000, user_email: 'a@example.org', action: 'users.update', target_type: 'user', target_id: 'u1', details: JSON.stringify({ note: 'ok' }) },
    { seq: 2, at: 1760000100, user_email: long + '@example.org', action: 'users.update', target_type: 'user', target_id: 'u2', details: JSON.stringify({ note: long }) },
  ],
  hasMore: false, year: 2026, edition: {},
  items: [
    { id: 'i1', sort: 1, slug: 's1', name: 'Ada Lovelace', position: 'Prof.', company: 'Uni', bio: '', photo: '', linkedin: '',
      title: 'Opening talk', type: 'talk', time: '09:00', endTime: '09:30', description: '', speakerSlugs: [], day: 1, titleTr: '', descriptionTr: '',
      role: 'Chair', roleTr: '', affiliation: 'Lab', teams: ['A', 'B'], teamsTr: [] },
    { id: 'i2', sort: 2, slug: 's2', name: 'Ada ' + long, position: 'Prof. ' + long, company: 'Uni ' + long, bio: '', photo: '', linkedin: '',
      title: 'Talk ' + long, type: 'talk', time: '10:00', endTime: '10:30', description: '', speakerSlugs: [], day: 1, titleTr: '', descriptionTr: '',
      role: 'Chair', roleTr: '', affiliation: 'Lab ' + long, teams: ['A'], teamsTr: [] },
  ],
  certificates: [
    { id: 'c1', email: 'ayse@example.org', name: 'Ayse Yilmaz', kind: 'participation', size_bytes: 877, expires_at: 1794415522 },
    { id: 'c2', email: long + '@example.org', name: 'Ayse ' + long, kind: 'participation', size_bytes: 877, expires_at: 1794415522 },
  ],
  totalBytes: 1754,
  posts: [], plans: [], modes: [], editors: [],
};

// Social data: dated around now so the calendar month shows the cards and slots.
const now = Math.floor(Date.now() / 1000);
const POSTS = [
  { id: 'p1', type: 'image', caption: 'Join us for the symposium', captionOverrides: {}, link: null, media: [], platforms: ['instagram', 'x'], scheduledAt: now + 3600, status: 'pending_approval', revision: 1,
    createdBy: 'u2', authorEmail: 'editor@example.org', approvedBy: null, approvedAt: null, reviewNote: null, planId: null, planTitle: null, eventModeId: null, createdAt: now, updatedAt: now, targets: [] },
  { id: 'p2', type: 'image', caption: long, captionOverrides: {}, link: 'https://example.org/' + long, media: [], platforms: ['instagram', 'linkedin', 'x'], scheduledAt: now + 7200, status: 'draft', revision: 1,
    createdBy: 'u2', authorEmail: long + '@example.org', approvedBy: null, approvedAt: null, reviewNote: long, planId: null, planTitle: long, eventModeId: null, createdAt: now, updatedAt: now, targets: [] },
];
const PLANS = [
  { id: 'pl1', title: 'Weekly recap', scheduledAt: now + 86400, platforms: ['instagram'], postType: 'image', assigneeId: 'u2', assigneeEmail: 'editor@example.org', note: 'n', postId: null, postStatus: null, createdBy: 'u1', createdAt: now },
  { id: 'pl2', title: 'Plan ' + long, scheduledAt: now + 2 * 86400, platforms: ['instagram', 'x'], postType: 'story', assigneeId: null, assigneeEmail: long + '@example.org', note: long, postId: null, postStatus: null, createdBy: 'u1', createdAt: now },
];
const EDITORS = [
  { id: 'u2', email: 'editor@example.org', name: 'Editor Two', isPublisher: false },
  { id: 'u3', email: long + '@example.org', name: null, isPublisher: false },
];
const MODES = [
  { id: 'm1', name: 'Symposium day', startsAt: now - 3600, endsAt: now + 86400, editorIds: ['u2'], editorEmails: ['editor@example.org'], openedBy: 'u1', closedAt: null, active: true },
  { id: 'm2', name: 'Event ' + long, startsAt: now + 86400, endsAt: now + 2 * 86400, editorIds: ['u3'], editorEmails: [long + '@example.org'], openedBy: 'u1', closedAt: null, active: false },
];

// Not 44 px on purpose, each with its reason. (Add [selector, reason] pairs.)
const EXCLUDED = [];

// The Etkinlikler panel: a long unbroken title, a long note, every status.
const CMS_EVENT = {
  id: 'symposium-2026', type: 'symposium', start: '2026-10-10', note: long,
  title: { en: 'Symposium ' + long, tr: 'Sempozyum ' + long }, when: { en: '10 October 2026', tr: '10 Ekim 2026' },
  location: { en: 'Ankara', tr: 'Ankara' }, description: { en: long + long, tr: long }, links: [{ label: { en: long, tr: long }, url: 'https://example.org/' + long }],
};
/** A committee whose texts are long, with members open: rows must wrap, not overflow. */
const CMS_COMMITTEE = {
  order: 10, name: { en: long, tr: long }, description: { en: long, tr: long },
  members: [0, 1].map((i) => ({
    name: `${long} ${i}`, role: { en: long, tr: long }, image: 'https://res.cloudinary.com/demo/image/upload/v1/a.jpg',
    education: [{ degree: { en: long, tr: long }, field: { en: long, tr: long }, institution: { en: long, tr: long }, year: '2027' }],
    socialMedia: [{ platform: 'linkedin', url: `https://www.linkedin.com/in/${long}/` }],
    consent: true,
  })),
};
/** The podcast (generated, no form): its list, a pulled draft and its review. */
const POD_EP = (i) => ({ guid: `g${i}`, title: `${long} ${i}`, pubDate: `2025-01-${String(i + 1).padStart(2, '0')}T10:00:00.000Z`, durationSeconds: 3065,
  audioUrl: `https://example.org/${i}.m4a`, audioBytes: 1, image: '', description: long });
const CMS_PODCAST = { syncedAt: '2025-06-01T00:00:00.000Z', title: long, description: long, image: 'https://example.org/i.jpg',
  platforms: { spotify: 'https://example.org/s', apple: 'https://example.org/a', castbox: 'https://example.org/c', rss: 'https://example.org/r' },
  episodes: Array.from({ length: 3 }, (_, i) => POD_EP(3 - 1 - i)) };
const CMS_PODCAST_NEW = { ...CMS_PODCAST, episodes: [POD_EP(3), ...CMS_PODCAST.episodes] };
const POD_DRAFT = '00000000-0000-4000-8000-000000000399';
/** A resource whose texts and tags are long: the two tag lists must wrap, not overflow. */
const CMS_RESOURCE = {
  section: 'md-drug', order: 10, title: { en: long, tr: long }, description: { en: long + long, tr: long }, url: 'https://example.org/' + long,
  tags: { en: [long, 'python', 'drug-design'], tr: [long, 'python', 'ilaç-tasarımı'] }, opensource: true,
};
const CMS_ENTRIES = {
  resources: [{ id: 'example', title: long, section: 'md-drug', shas: {} }],
  podcast: [{ id: 'podcast', title: CMS_PODCAST.title, date: '2025-01-01', shas: {} }],
  committees: [{ id: 'example', title: long, shas: {} }],
  events: [{ id: 'symposium-2026', title: CMS_EVENT.title.en, date: '2026-10-10', shas: {} }, { id: 'meetup-x', title: 'Meetup', date: '2025-01-01', shas: {} }],
  workshops: [{ id: 'w', title: long, date: '2024', shas: {} }],
  webinars: [{ id: 'webinar', title: long, date: '2024-04-16', paths: { en: 'src/content/webinars/en/webinar.md', tr: 'src/content/webinars/tr/webinar.md' }, shas: {} }],
};
const CMS_DRAFTS = ['draft', 'submitted', 'rejected', 'pr_failed', 'pr_open', 'published'].map((status, i) => ({
  id: `00000000-0000-4000-8000-00000000000${i}`, type: 'events', entry_id: i ? 'symposium-2026' : 'meetup-x', action: 'update', status, author_id: 'u1', author_name: long,
  reviewer_id: null, review_note: status === 'rejected' ? long : null, pr_url: null, pr_number: null, failure: status === 'pr_failed' ? 'check failed: ' + long : null,
  stale_merge: false, created_at: 1760000000, updated_at: 1760000000 + i,
}));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

async function open(path, viewport, user = ADMIN) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push(`pageerror (${path} ${viewport.width}px): ` + String(e).slice(0, 160)));
  page.inflight = 0; // routed requests started and not yet fulfilled
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
    if (url.pathname === '/api/mail/conversations') return json({ threads: MAIL_THREADS, unreadCount: 1, scope: url.searchParams.get('scope') === 'all' ? 'all' : 'own', isAdmin: user.is_admin === true });
    if (/^\/api\/mail\/conversations\/[^/]+$/.test(url.pathname)) return json(MAIL_THREAD);
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: true });
    // An admin approves every type (approve per type: functions/api/cms/types.ts).
    if (url.pathname === '/api/cms/types') return json({ types: [['events', 'etkinlikler'], ['workshops', 'etkinlikler'], ['webinars', 'etkinlikler'], ['committees', 'topluluk'], ['podcast', 'topluluk'], ['resources', 'ogrenme']].map(([key, group]) => ({ key, group, canApprove: true })) });
    if (url.pathname === '/api/cms/entries') return json({ entries: CMS_ENTRIES[url.searchParams.get('type')] ?? [] });
    if (url.pathname === '/api/cms/entry' && url.searchParams.get('type') === 'podcast') return json({ data: CMS_PODCAST, base_shas: { 'src/data/podcast.json': 'sha' }, files: { 'src/data/podcast.json': JSON.stringify(CMS_PODCAST, null, 2) } });
    if (url.pathname === `/api/cms/drafts/${POD_DRAFT}`) return json({ draft: { ...CMS_DRAFTS[1], id: POD_DRAFT, type: 'podcast', entry_id: 'podcast', status: 'draft', write_nonce: 'n', data: CMS_PODCAST_NEW, base_shas: { 'src/data/podcast.json': 'sha' } }, files: null });
    if (url.pathname === '/api/cms/entry' && url.searchParams.get('type') === 'resources') return json({ data: CMS_RESOURCE, base_shas: { 'src/content/resources/example.json': 'sha' } });
    if (url.pathname === '/api/cms/entry' && url.searchParams.get('type') === 'committees') return json({ data: CMS_COMMITTEE, base_shas: { 'src/content/committees/example.json': 'sha' } });
    if (url.pathname === '/api/cms/entry') return json({ data: CMS_EVENT, base_shas: { 'src/content/events/symposium-2026.json': 'sha' } });
    if (url.pathname === '/api/cms/drafts') return json({ mine: CMS_DRAFTS, queue: CMS_DRAFTS.filter((d) => d.status === 'submitted'), more: false, live: [] });
    if (/^\/api\/cms\/drafts\/[^/]+$/.test(url.pathname)) return json({ draft: { ...CMS_DRAFTS.find((d) => d.id === url.pathname.split('/').pop()) ?? CMS_DRAFTS[1], data: CMS_EVENT, base_shas: {} } });
    if (url.pathname === '/api/social/plans') return json({ plans: PLANS });
    if (url.pathname === '/api/social/posts') return json({ posts: POSTS });
    if (url.pathname === '/api/social/editors') return json({ editors: EDITORS });
    if (url.pathname === '/api/social/event-modes') return json({ modes: MODES });
    return json(FULL);
  }
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return page;
}

// Wait until the menu marks the section and the addressed sub-page shows.
// True once the menu marks the section, the addressed sub-page (if any) is
// the only one shown, and the visible part has content.
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
    // A section with sub-pages: a list of them (phone) or exactly one shown sub-page with content (laptop).
    if (document.querySelectorAll('#subNav a').length === 0) return false;
    const shown = [...root.querySelectorAll('[data-sub]')].filter((el) => !el.classList.contains('hidden'));
    return shown.length === 0 || (shown.length === 1 && shown[0].innerText.trim().length > 0);
  }
  return root.innerText.trim().length > 0;
}, h, { timeout: 8000 }).then(() => true, () => false);

async function go(page, h) {
  await page.evaluate((x) => { location.hash = x; }, h);
  const reached = await settle(page, h);
  // A hash change does not navigate, so networkidle would return at once: wait for the stub to have answered everything, then a frame.
  for (let i = 0; i < 200 && page.inflight > 0; i++) await page.waitForTimeout(25);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  // Requests started by the render itself: give them one more round.
  for (let i = 0; i < 200 && page.inflight > 0; i++) await page.waitForTimeout(25);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  if (reached && /^#sosyal\/(takvim|onay|taslaklar|yayinlananlar|etkinlik)$/.test(h)) {
    // The stubbed items must actually be drawn before measuring.
    const item = await page.waitForSelector('[data-sub]:not(.hidden) [data-entry], [data-sub]:not(.hidden) [data-post], [data-sub]:not(.hidden) [data-event], [data-social-view]:not(.hidden) [data-entry], [data-social-view]:not(.hidden) [data-post]', { timeout: 5000 }).then(() => true, () => false);
    if (!item) return false;
  }
  return reached;
}

// Every section and sub-page this admin can open, read from the menu itself.
async function routes(lang, user) {
  const page = await open(lang + '/admin', { width: 1280, height: 900 }, user);
  const sections = await page.locator('#sectionNav [data-nav]').evaluateAll((els) => els.map((e) => e.dataset.nav));
  const out = [];
  for (const s of sections) {
    ok(await go(page, '#' + s), `${lang || '/en'}: menu section #${s} could not be reached`);
    const subs = await page.locator('#subNav [data-sub-link]').evaluateAll((els) => els.map((e) => e.dataset.subLink));
    out.push('#' + s);
    for (const sub of subs) out.push(`#${s}/${sub}`);
  }
  await page.close();
  // A thread in the address, as the notification mail links to it.
  if (out.includes('#eposta/gelen')) out.push('#eposta/gelen/t2');
  // An entry's form, a draft (the link a pull request carries) and an approver's review.
  if (out.includes('#icerik/etkinlikler')) out.push('#icerik/etkinlikler/symposium-2026', '#icerik/etkinlikler/_new', '#icerik/taslaklar/00000000-0000-4000-8000-000000000002', '#icerik/onay/00000000-0000-4000-8000-000000000001');
  if (out.includes('#icerik/komiteler')) out.push('#icerik/komiteler/example', '#icerik/komiteler/_new');
  if (out.includes('#icerik/kaynaklar')) out.push('#icerik/kaynaklar/example', '#icerik/kaynaklar/_new');
  if (out.includes('#icerik/podcast')) out.push(`#icerik/taslaklar/${POD_DRAFT}`, `#icerik/onay/${POD_DRAFT}`);
  return [...new Set(out)];
}

// Interactive controls under 44 px tall, in the content, outside paragraphs.
function smallTargets(excluded) {
  return [...document.querySelectorAll('#adminContent a, #adminContent button, #adminContent input[type=checkbox]')]
    .filter((el) => {
      // A checkbox is operated through its label, so the label is the target.
      const r = (el.type === 'checkbox' ? el.closest('label') : null)?.getBoundingClientRect() ?? el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      if (el.closest('[hidden], .hidden')) return false;
      if (excluded.some((s) => el.matches(s))) return false;
      if (el.tagName === 'A' && el.closest('p')) return false;
      return r.height < 43.5;
    })
    .map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30)}"`);
}

let pages = 0;
for (const [who, user, min] of [['admin', ADMIN, 20], ['sender', SENDER, 3]])
for (const lang of ['', '/tr']) {
  const all = await routes(lang, user);
  ok(all.length >= min, `${who} ${lang || '/en'}: found the routes (${all.length})`);
  for (const width of [390, 1280]) {
    const page = await open(lang + '/admin', { width, height: width === 390 ? 844 : 900 }, user);
    const phone = width === 390;
    for (const h of all) {
      const tag = `${who} ${lang || '/en'} ${width}px ${h}`;
      const reached = await go(page, h);
      ok(reached, `${tag}: route did not settle`);
      if (!reached) continue;
      pages++;
      if (h === '#eposta/gelen/t2') {
        // The thread must really be open, not just the list.
        const open = await page.waitForFunction((s) => document.getElementById('mailThreadSubject')?.textContent === s
          && !document.getElementById('mailThreadView')?.classList.contains('hidden'), long, { timeout: 5000 }).then(() => true, () => false);
        ok(open, `${tag}: the thread did not open`);
        ok(await page.locator('#mailThreadView').isVisible(), `${tag}: thread pane is visible`);
      }
      const sw = await page.evaluate(() => ({ s: document.documentElement.scrollWidth, w: innerWidth }));
      if (sw.s > sw.w) {
        const wide = await page.evaluate((w) => [...document.querySelectorAll('body *')]
          .filter((el) => el.getBoundingClientRect().right > w + 1 && el.getBoundingClientRect().width > 0)
          .slice(-3).map((el) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}.${String(el.className).slice(0, 60)} (${Math.round(el.getBoundingClientRect().right)})`), sw.w);
        ok(false, `${tag}: scrollWidth ${sw.s} > ${sw.w}, e.g. ${wide.join(' | ')}`);
      }
      if (phone) {
        const small = await page.evaluate(smallTargets, EXCLUDED.map((e) => e[0]));
        for (const s of small) ok(false, `${tag}: touch target under 44 px: ${s}`);
      }
    }
    await page.close();
  }
}

await browser.close();
console.log(`${pages} pages checked`);
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
