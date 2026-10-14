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
const COUNTS = { email: 3, social: 2, blog: 1, scheduledThisWeek: 4 };
const long = 'x'.repeat(120);
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
    { subject: 'Hello ' + long, sender_email: 's@example.org', sender_name: null, recipient_email: 'r@example.org', sent_at: 1760000000, status: 'failed', error_message: long },
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

const browser = await chromium.launch();

async function open(path, viewport) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push(`pageerror (${path} ${viewport.width}px): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(v) });
    if (req.method() !== 'GET') return r.fulfill({ status: 204, body: '' });
    if (url.pathname === '/api/me') return json({ user: ADMIN, profile: {} });
    if (url.pathname === '/api/admin/counts') return json(COUNTS);
    if (url.pathname === '/api/admin/health') return json({ issues: [], canFix: true });
    if (url.pathname === '/api/social/plans') return json({ plans: PLANS });
    if (url.pathname === '/api/social/posts') return json({ posts: POSTS });
    if (url.pathname === '/api/social/editors') return json({ editors: EDITORS });
    if (url.pathname === '/api/social/event-modes') return json({ modes: MODES });
    return json(FULL);
  });
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
  return root.innerText.trim().length > 0 || document.querySelectorAll('#subNav a').length > 0;
}, h, { timeout: 8000 }).then(() => true, () => false);

async function go(page, h) {
  await page.evaluate((x) => { location.hash = x; }, h);
  const reached = await settle(page, h);
  await page.waitForLoadState('networkidle');
  return reached;
}

// Every section and sub-page this admin can open, read from the menu itself.
async function routes(lang) {
  const page = await open(lang + '/admin', { width: 1280, height: 900 });
  const sections = await page.locator('#sectionNav [data-nav]').evaluateAll((els) => els.map((e) => e.dataset.nav));
  const out = [];
  for (const s of sections) {
    await go(page, '#' + s);
    const subs = await page.locator('#subNav [data-sub-link]').evaluateAll((els) => els.map((e) => e.dataset.subLink));
    out.push('#' + s);
    for (const sub of subs) out.push(`#${s}/${sub}`);
  }
  await page.close();
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
for (const lang of ['', '/tr']) {
  const all = await routes(lang);
  ok(all.length >= 20, `${lang || '/en'}: found the routes (${all.length})`);
  for (const width of [390, 1280]) {
    const page = await open(lang + '/admin', { width, height: width === 390 ? 844 : 900 });
    const phone = width === 390;
    for (const h of all) {
      const tag = `${lang || '/en'} ${width}px ${h}`;
      const reached = await go(page, h);
      ok(reached, `${tag}: route did not settle`);
      if (!reached) continue;
      pages++;
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
