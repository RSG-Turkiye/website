/**
 * The İçerik section (panel CMS) in a real browser, signed in, with
 * /api/cms/* answered here: the list, the form, saving, sending, the
 * approver's queue and diff, "changed since you started", field errors in
 * plain words, an expired session, the deep link a pull request carries
 * (and the old #icerik-etkinlikler one), tabs per group, approve rights per
 * type, and the phone layout.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/cms-icerik.mjs
 *
 * Every call is intercepted, so nothing is read from GitHub or stored.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4329';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const NOW = Math.floor(Date.now() / 1000);
const SYM = {
  id: 'symposium-2026', type: 'symposium', start: '2026-10-10', end: '2026-10-11', note: 'Kept in step by hand.',
  title: { en: '13th RSG-Türkiye Student Symposium', tr: '13. RSG-Türkiye Öğrenci Sempozyumu' },
  when: { en: '10–11 October 2026', tr: '10–11 Ekim 2026' },
  location: { en: 'Ankara', tr: 'Ankara' },
  description: { en: 'Our annual symposium.', tr: 'Yıllık sempozyumumuz.' },
  links: [{ label: { en: 'Programme', tr: 'Program' }, url: 'https://example.org/a' }, { label: { en: 'Venue', tr: 'Mekân' }, url: 'https://example.org/b' }],
};
const PATH = 'src/content/events/symposium-2026.json';
const ENTRIES = {
  events: [
    { id: 'symposium-2026', title: SYM.title.en, date: '2026-10-10', shas: { [PATH]: 'sha-1' } },
    ...Array.from({ length: 24 }, (_, i) => ({ id: `meetup-${i}`, title: `Meetup ${i}`, date: `2025-0${(i % 9) + 1}-01`, shas: {} })),
  ],
  workshops: [{ id: 'nextflow', title: 'Nextflow', date: '2024', shas: {} }],
  webinars: [{ id: 'w1', title: 'A webinar', date: '2024-04-16', paths: { en: 'src/content/webinars/en/w1.md', tr: 'src/content/webinars/tr/w1-tr.md' }, shas: {} }],
};
/** What /api/cms/types answers: the types of the groups `who` edits, approve per type (`state.adminOnly` lists keys only an admin approves). */
const TYPES = [
  { key: 'events', group: 'etkinlikler', label: { en: 'Events', tr: 'Etkinlikler' } },
  { key: 'workshops', group: 'etkinlikler', label: { en: 'Workshops', tr: 'Atölyeler' } },
  { key: 'webinars', group: 'etkinlikler', label: { en: 'Webinars', tr: 'Webinarlar' } },
];
const USERS = {
  approver: { id: 'u1', email: 'onay@example.org', grants: [{ role: 'content.etkinlikler.approve', expires_at: null }] },
  editor: { id: 'u2', email: 'editor@example.org', grants: [{ role: 'content.etkinlikler.edit', expires_at: null }] },
  yazilar: { id: 'u4', email: 'yazar@example.org', grants: [{ role: 'content.yazilar.edit', expires_at: null }] },
  // DEMO=admin only: an admin, for the Roles tab and every group.
  admin: { id: 'u1', email: 'admin@example.org', display_name: 'Ada Admin', is_admin: true, grants: [] },
};
/** DEMO=admin: people for the Roles tab's cards (one holds an Etkinlikler role, one a Yazılar one). */
const DEMO_PEOPLE = [
  { id: 'u1', email: 'admin@example.org', display_name: 'Ada Admin', username: 'ada', is_member: 1, is_admin: 1, is_public: 1, current_rank: 'seed', badge_codes: '', created_at: 1700000000, grants: [] },
  { id: 'u2', email: 'editor@example.org', display_name: 'Editör A', username: 'editor', is_member: 1, is_admin: 0, is_public: 1, current_rank: 'seed', badge_codes: '', created_at: 1700000000,
    grants: [{ role: 'content.etkinlikler.edit', granted_at: 1760000000, expires_at: Math.floor(Date.now() / 1000) + 20 * 86400 }] },
  { id: 'u4', email: 'yazar@example.org', display_name: 'Yazar B', username: 'yazar', is_member: 1, is_admin: 0, is_public: 1, current_rank: 'seed', badge_codes: '', created_at: 1700000000,
    grants: [{ role: 'content.yazilar.approve', granted_at: 1760000000, expires_at: null }] },
];
const draftRow = (o) => ({ type: 'events', action: 'update', status: 'draft', author_id: 'u2', author_name: 'Editör A', reviewer_id: null, review_note: null,
  pr_url: null, pr_number: null, failure: null, stale_merge: false, created_at: NOW - 600, updated_at: NOW - 300, write_nonce: 'n0', ...o });

/**
 * One page with its own mock server. `who` is 'editor' or 'approver'.
 * `state` is what the mock server holds; `calls` what the page sent.
 */
async function open(browser, who, hash, viewport = { width: 1440, height: 900 }, setup = () => {}, lang = 'tr') {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push(`pageerror (${hash}): ` + String(e).slice(0, 200)));
  const state = {
    drafts: new Map(), live: [], entryShas: { [PATH]: 'sha-1' }, entryData: SYM,
    nextPost: null, nextPatch: null, nextSubmit: null, nextApprove: null, signedOut: false,
    adminOnly: [], typesFail: false, postDelay: 0, entryFail: false, failDelete: false, draftsFail: 0, more: false, queueCount: null, uploadDelay: 0, uploadFail: null,
  };
  const calls = [];
  setup(state);
  const user = USERS[who];
  const groups = new Set(user.is_admin ? TYPES.map((t) => t.group) : user.grants.map((g) => g.role.split('.')[1]));
  await page.route('**/api/**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    let body;
    try { body = req.postData() ? JSON.parse(req.postData()) : undefined; } catch { body = undefined; } // an image upload is not JSON
    const json = (v, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    if (p.startsWith('/api/cms')) calls.push({ method, path: p + url.search, body });
    if (state.signedOut && p.startsWith('/api/cms') && method !== 'GET') return json({ error: 'Not signed in', code: 'unauthenticated' }, 401);
    if (p === '/api/me') return json({ user, profile: {} });
    if (p === '/api/cms/types') {
      if (state.typesFail) return json({ error: 'x', code: 'boom' }, 500);
      return json({ types: TYPES.filter((t) => groups.has(t.group)).map((t) => ({ ...t, format: 'json', schema: {}, canApprove: (who === 'approver' || who === 'admin') && !state.adminOnly.includes(t.key) })) });
    }
    if (p === '/api/admin/users' && method === 'GET') return json({ users: DEMO_PEOPLE, badge_catalog: [] });
    if (p === '/api/admin/health') return json({ issues: [], canFix: false });
    if (p === '/api/admin/counts') return json(who === 'approver' || who === 'admin' ? { cmsMine: 0, cmsQueue: state.queueCount ?? 1, cmsTotal: 1 } : { cmsMine: 1, cmsTotal: 1 });
    if (p === '/api/blog-submissions/upload-image') {
      if (state.uploadDelay) await new Promise((res) => setTimeout(res, state.uploadDelay));
      if (state.uploadFail) return json({ error: state.uploadFail }, 400);
      return json({ url: '/api/images/uploaded.webp', key: 'uploaded.webp', width: 10, height: 10 });
    }
    if (p.startsWith('/api/cms/drafts/') && method === 'PATCH' && state.abortNextPatch) {
      // The save lands, but its answer never comes back.
      state.abortNextPatch = false;
      const d = state.drafts.get(p.split('/').pop());
      d.data = body.data; d.write_nonce = `n${Math.random()}`; d.updated_at = Math.floor(Date.now() / 1000);
      return r.abort('failed');
    }
    if (p === '/api/cms/entry' && state.entryFail) return json({ error: 'GitHub did not answer', code: 'github_failed' }, 502);
    if (p === '/api/cms/entries') return json({ type: url.searchParams.get('type'), entries: ENTRIES[url.searchParams.get('type')] ?? [] });
    if (p === '/api/cms/entry') {
      // The symposium as the fixture has it; any other entry as itself, so a click-through shows its own title.
      const id = url.searchParams.get('id');
      const type = url.searchParams.get('type');
      const e = (ENTRIES[type] ?? []).find((x) => x.id === id);
      if (id === 'symposium-2026' || !e || type !== 'events') return json({ type, id, data: state.entryData, base_shas: state.entryShas, ...(state.entryFiles ? { files: state.entryFiles } : {}) });
      return json({ type, id, data: { ...SYM, id, note: undefined, start: e.date, end: undefined, title: { en: e.title, tr: e.title } }, base_shas: { [`src/content/events/${id}.json`]: `sha-${id}` } });
    }
    if (p === '/api/cms/drafts' && method === 'GET') {
      if (state.draftsFail) return json({ error: 'x', code: state.draftsFail === 401 ? 'unauthenticated' : 'boom' }, state.draftsFail);
      const all = [...state.drafts.values()];
      return json({ mine: all.filter((d) => d.author_id === user.id).map(({ data, base_shas, ...d }) => d),
        queue: who === 'approver' || who === 'admin' ? all.filter((d) => d.status === 'submitted' || d.status === 'approved').map(({ data, base_shas, ...d }) => d) : [], more: state.more, live: state.live,
        inflight: who === 'approver' || who === 'admin' ? all.filter((d) => ['pr_open', 'merged', 'pr_failed'].includes(d.status) || (d.status === 'approved' && d.updated_at < NOW - 300)).map(({ data, base_shas, ...d }) => d) : [] });
    }
    if (p === '/api/cms/drafts' && method === 'POST') {
      if (state.postDelay) await new Promise((res) => setTimeout(res, state.postDelay));
      if (state.nextPost) { const [s, v] = state.nextPost; state.nextPost = null; return json(v, s); }
      const id = `00000000-0000-4000-8000-00000000000${state.drafts.size + 1}`;
      const d = draftRow({ id, action: body.action, entry_id: body.entry_id ?? body.data?.id ?? 'x', author_id: user.id, data: body.data ?? {}, base_shas: body.base_shas ?? {} });
      state.drafts.set(id, d);
      return json({ draft: d }, 201);
    }
    const m = /^\/api\/cms\/drafts\/([^/]+)(?:\/(\w+))?$/.exec(p);
    if (m) {
      const d = state.drafts.get(m[1]);
      if (!d) return json({ error: 'Not found', code: 'not_found' }, 404);
      if (!m[2] && method === 'GET') return json({ draft: d, files: state.draftFiles ?? null });
      if (!m[2] && method === 'PATCH') {
        if (state.nextPatch) { const [s, v] = state.nextPatch; state.nextPatch = null; return json(v, s); }
        if (body.write_nonce !== undefined && body.write_nonce !== d.write_nonce) return json({ error: 'changed', code: 'draft_changed' }, 409);
        d.data = body.data; d.updated_at = Math.floor(Date.now() / 1000); d.write_nonce = `n${Math.random()}`;
        return json({ draft: d });
      }
      if (!m[2] && method === 'DELETE') {
        if (state.failDelete) return json({ error: 'x', code: 'bad_state' }, 409);
        d.status = 'discarded'; return json({ ok: true });
      }
      if (m[2] === 'submit') {
        if (state.nextSubmit) { const [s, v] = state.nextSubmit; state.nextSubmit = null; return json(v, s); }
        d.status = 'submitted'; return json({ draft: d });
      }
      if (m[2] === 'approve') {
        if (state.nextApprove) { const [s, v] = state.nextApprove; state.nextApprove = null; return json(v, s); }
        d.status = 'pr_open'; d.pr_number = 7; return json({ draft: d });
      }
      if (m[2] === 'cancel') { d.status = 'pr_failed'; d.failure = 'cancelled'; return json({ draft: d }); }
      if (m[2] === 'reject') { d.status = 'rejected'; d.review_note = body.note; return json({ draft: d }); }
    }
    if (method !== 'GET') return r.fulfill({ status: 204, body: '' });
    // The rest of an admin's panel (DEMO=admin): empty lists, so nothing throws.
    return json(who === 'admin' ? { users: [], announcements: [], submissions: [], senders: [], attachments: [], sends: [], connections: [], rows: [], items: [], posts: [], edition: {}, badge_catalog: [] } : {});
  });
  await page.goto(`${BASE}${lang === 'tr' ? '/tr' : ''}/admin${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return { page, state, calls };
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const waitFor = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

/*
 * DEMO=editor, DEMO=approver, DEMO=yazilar or DEMO=admin: no checks; a
 * visible browser on the panel with this file's mock server and a few seeded
 * drafts, to click through by hand. Saving, sending, approving and sending
 * back all work, in memory only; nothing reaches GitHub or a database. Close
 * the window to stop. DEMO=admin also fills Users and roles → Roles
 * (#kullanicilar/yetkiler) with every role's card. DEMO_LANG=en for English.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   DEMO=approver BASE=http://localhost:4329 node tests/browser/cms-icerik.mjs
 */
if (process.env.DEMO) {
  const demo = await chromium.launch({ headless: false, ...(process.env.CHROME ? { executablePath: process.env.CHROME } : {}) });
  const who = Object.hasOwn(USERS, process.env.DEMO) ? process.env.DEMO : 'editor';
  const me = USERS[who].id;
  const { page } = await open(demo, who, '#icerik', { width: 1440, height: 900 }, (s) => {
    const mk = (n, o) => s.drafts.set(`00000000-0000-4000-8000-00000000020${n}`, draftRow({ id: `00000000-0000-4000-8000-00000000020${n}`, author_id: me, ...o }));
    mk(1, { status: 'submitted', author_id: 'u2', entry_id: 'symposium-2026', data: { ...SYM, when: { ...SYM.when, tr: '10–11 Ekim 2026, ODTÜ' }, links: [SYM.links[1], SYM.links[0]] }, base_shas: { [PATH]: 'sha-1' } });
    mk(2, { status: 'rejected', entry_id: 'meetup-3', review_note: 'Tarihi kontrol edin.', data: { ...SYM, id: 'meetup-3' } });
    mk(3, { status: 'pr_failed', entry_id: 'meetup-4', failure: 'check failed: build', data: { ...SYM, id: 'meetup-4' } });
    mk(4, { status: 'pr_open', entry_id: 'meetup-5', data: { ...SYM, id: 'meetup-5' } });
    mk(5, { status: 'published', entry_id: 'meetup-6', data: { ...SYM, id: 'meetup-6' } });
  }, process.env.DEMO_LANG === 'en' ? 'en' : 'tr');
  await new Promise((resolve) => page.on('close', resolve));
  await demo.close();
  process.exit(0);
}

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

/** A part of the check: a throw (a missing element) counts as a failure and the rest still runs. */
async function section(title, run) {
  console.log(title);
  try { await run(); } catch (e) { ok(false, `${title.split(')')[0]}: ${String(e.message ?? e).split('\n')[0]}`); }
}

console.log('1) the list: published events, newest first, "Daha fazla", my drafts row');
{
  const { page } = await open(browser, 'editor', '#icerik');
  ok(await waitFor(page, () => document.querySelectorAll('[data-sub="etkinlikler"] [data-cms-entry]').length > 0), 'Etkinlikler is where the section lands, with rows');
  ok(await page.locator('[data-sub="etkinlikler"] [data-cms-entry]').count() === 20, 'the newest 20 first');
  ok(await page.locator('[data-cms-entry]').first().getAttribute('data-cms-entry') === 'symposium-2026', 'in the order the index gives');
  ok((await page.textContent('[data-cms-entry="symposium-2026"]')).includes('10 Ekim 2026'), 'a date under the title');
  await page.click('[data-cms-more]');
  ok(await waitFor(page, () => document.querySelectorAll('[data-sub="etkinlikler"] [data-cms-entry]').length === 25), '"Daha fazla" shows the rest');
  ok((await page.textContent('[data-cms-mine]')).includes('Taslaklarım (0)'), 'the "Taslaklarım" row is above the list');
  ok(await visible(page, '[data-cms-new]'), 'a "Yeni" button');
  await page.close();
}

console.log('2) open an entry, edit, save (POST then PATCH), send for approval');
{
  const { page, calls, state } = await open(browser, 'editor', '#icerik/etkinlikler');
  await page.click('[data-cms-entry="symposium-2026"] [data-cms-edit]');
  await page.waitForSelector('#cmsForm [data-field="when"][data-lang="tr"]');
  ok(await page.inputValue('[data-field="when"][data-lang="tr"]') === SYM.when.tr, 'the form has the current values');
  ok(await page.inputValue('[data-field="title"][data-lang="en"]') === SYM.title.en && await page.inputValue('[data-field="title"][data-lang="tr"]') === SYM.title.tr, 'both languages, side by side');
  ok(await page.locator('[data-field-wrap="note"]').count() === 0, 'an editor does not see the internal note');
  ok((await page.textContent('#cmsSave')).includes('Kaydet (siteye gitmez)') && (await page.textContent('#cmsSubmit')).includes('Onaya gönder'), 'the buttons say what happens');
  await page.fill('[data-field="when"][data-lang="tr"]', '10-11 Ekim 2026, Ankara');
  await page.click('#cmsSave');
  ok(await waitFor(page, () => /Kaydedildi/.test(document.getElementById('cmsSaveState')?.textContent ?? '')), 'saved, with the time');
  const post = calls.find((c) => c.method === 'POST' && c.path === '/api/cms/drafts');
  ok(post?.body?.action === 'update' && post.body.entry_id === 'symposium-2026' && post.body.data.when.tr === '10-11 Ekim 2026, Ankara', 'the first save starts an update draft with the edited field');
  ok(JSON.stringify(post?.body?.base_shas) === JSON.stringify({ [PATH]: 'sha-1' }), 'with the shas the form was read at');
  ok(post?.body?.data.note === SYM.note && post.body.data.links.length === 2, 'what the form does not show passes through');
  ok(/#icerik\/taslaklar\/0000/.test(await page.evaluate(() => location.hash)), 'the address is the draft\'s now');
  ok(await visible(page, '#cmsBanner') && (await page.textContent('#cmsBanner')).includes('Bu taslak henüz sitede değil'), 'the "not on the site" banner');
  await page.fill('[data-field="location"][data-lang="tr"]', 'Ankara, ODTÜ');
  await page.click('#cmsSave');
  await waitFor(page, () => /Kaydedildi/.test(document.getElementById('cmsSaveState')?.textContent ?? ''));
  const patch = calls.find((c) => c.method === 'PATCH');
  ok(patch?.body?.data?.location?.tr === 'Ankara, ODTÜ' && patch.body.data.when.tr === '10-11 Ekim 2026, Ankara', 'the next save is a PATCH with the edited field');
  // A list: reorder with the buttons, no drag and drop.
  await page.click('#cmsMore summary');
  await page.click('[data-field-wrap="links"] [data-move="1"][data-row-i="0"]');
  await page.click('#cmsSave');
  await waitFor(page, () => /Kaydedildi/.test(document.getElementById('cmsSaveState')?.textContent ?? ''));
  const moved = calls.filter((c) => c.method === 'PATCH').at(-1);
  ok(moved?.body?.data?.links?.[0]?.url === 'https://example.org/b', 'the down button moves a link');
  await page.click('#cmsSubmit');
  ok(await waitFor(page, () => /Onay bekliyor/.test(document.getElementById('cmsStatus')?.textContent ?? '')), 'sent: "Onay bekliyor, bir yönetici bakacak"');
  ok(calls.some((c) => c.method === 'POST' && /\/submit$/.test(c.path)), 'submit called /submit');
  ok(!(await visible(page, '#cmsSave')), 'a draft in review is read-only');
  ok([...state.drafts.values()][0].status === 'submitted', 'the server has it as submitted');
  await page.close();
}

console.log('3) a draft with errors: plain words next to the fields, a summary, focus on the first');
{
  const { page } = await open(browser, 'editor', '#icerik/taslaklar/00000000-0000-4000-8000-000000000009', { width: 1280, height: 680 }, (s) => {
    s.drafts.set('00000000-0000-4000-8000-000000000009', draftRow({ id: '00000000-0000-4000-8000-000000000009', entry_id: 'symposium-2026', data: { ...SYM, title: { ...SYM.title, tr: '' }, links: [{ label: { en: 'Programme', tr: '' }, url: 'https://example.org/a' }] }, base_shas: { [PATH]: 'sha-1' } }));
    s.nextSubmit = [422, { error: 'Some fields are not valid', code: 'invalid', errors: { 'title.tr': 'Too small: expected string to have >=1 characters', 'links.1.url': 'Invalid input: expected string, received undefined' } }];
  });
  await page.waitForSelector('#cmsSubmit');
  ok(await waitFor(page, () => document.getElementById('cmsTitle')?.textContent?.length > 0), 'the deep link a pull request carries opens the draft');
  await page.click('#cmsSubmit');
  // The half-translated warning comes first, for the optional link label only:
  // the empty Turkish title is a field error (required).
  ok(await waitFor(page, () => !!document.getElementById('cmsHalfSend')), 'a text in one language only is flagged before sending');
  const half = await page.textContent('#cmsNotice');
  ok(half.includes('Bağlantılar') && !half.includes('Başlık'), `only the optional text is in the warning: "${half.replace(/\s+/g, ' ').slice(0, 120)}"`);
  await page.click('#cmsHalfSend');
  ok(await waitFor(page, () => /2 alan düzeltilmeli/.test(document.getElementById('cmsErrors')?.textContent ?? '')), 'a summary: "2 alan düzeltilmeli"');
  const summary = await page.textContent('#cmsErrors');
  ok(summary.includes('Başlık (TR): Bu alan gerekli'), `a field's label, not a path: "${summary.replace(/\s+/g, ' ').slice(0, 120)}"`);
  ok(summary.includes('Bağlantılar › Bağlantı 2 › Adres'), 'a row in a list by its number');
  ok(await page.evaluate(() => document.activeElement?.getAttribute('data-field') === 'title' && document.activeElement?.getAttribute('data-lang') === 'tr'), 'focus is on the first invalid field');
  ok(await visible(page, '[data-error="title"]'), 'the error sits next to the field');
  await page.close();
}

console.log('4) changed since you started: site and draft side by side, "Eskiyi al"');
{
  const id = '00000000-0000-4000-8000-000000000007';
  const { page, calls } = await open(browser, 'editor', `#icerik/taslaklar/${id}`, { width: 1366, height: 768 }, (s) => {
    s.drafts.set(id, draftRow({ id, entry_id: 'symposium-2026', data: { ...SYM, when: { ...SYM.when, tr: 'Taslaktaki tarih' } }, base_shas: { [PATH]: 'sha-0' } }));
    s.entryData = { ...SYM, location: { en: 'Ankara', tr: 'Ankara (yeni salon)' } };
  });
  ok(await waitFor(page, () => !document.getElementById('cmsChanged')?.classList.contains('hidden')), 'the draft knows the site moved on (index shas)');
  const text = await page.textContent('#cmsChanged');
  ok(text.includes('Sitede') && text.includes('Taslakta') && text.includes('Ankara (yeni salon)') && text.includes('Taslaktaki tarih'), 'per field, what the site has and what the draft has');
  ok(await page.locator('#cmsSubmit').isDisabled(), 'it cannot be sent before it is moved onto the site\'s version');
  await page.click('[data-take="location"]');
  ok(await page.inputValue('[data-field="location"][data-lang="tr"]') === 'Ankara (yeni salon)', '"Eskiyi al" copies the site\'s value into the draft');
  ok(await page.inputValue('[data-field="when"][data-lang="tr"]') === 'Taslaktaki tarih', 'and nothing else is merged');
  await page.click('#cmsRebase');
  ok(await waitFor(page, () => /000000000002$/.test(location.hash) || /000000000001$/.test(location.hash)), 'continuing makes a fresh draft from the site\'s version');
  const post = calls.find((c) => c.method === 'POST' && c.path === '/api/cms/drafts');
  ok(post?.body?.base_shas?.[PATH] === 'sha-1' && post.body.data.location.tr === 'Ankara (yeni salon)' && post.body.data.when.tr === 'Taslaktaki tarih', 'with the fresh shas and the kept edits');
  ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith(id)), 'and the stale draft is discarded');
  await page.close();
}

console.log('5) a first save that meets a changed entry shows the comparison, not an error');
{
  const { page } = await open(browser, 'editor', '#icerik/etkinlikler/symposium-2026', { width: 1440, height: 800 }, (s) => {
    s.nextPost = [409, { error: 'changed', code: 'changed_since', paths: [PATH] }];
  });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  await page.fill('[data-field="when"][data-lang="tr"]', 'Başka');
  await page.click('#cmsSave');
  ok(await waitFor(page, () => !document.getElementById('cmsChanged')?.classList.contains('hidden')), 'a 409 changed_since opens "changed since you started"');
  ok(await page.inputValue('[data-field="when"][data-lang="tr"]') === 'Başka', 'the edit is still in the form');
  await page.close();
}

console.log('6) an expired session keeps the form and says so');
{
  const { page, state } = await open(browser, 'editor', '#icerik/etkinlikler/symposium-2026', { width: 1536, height: 864 });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  state.signedOut = true;
  await page.fill('[data-field="description"][data-lang="tr"]', 'Uzun bir açıklama yazdım.');
  await page.click('#cmsSave');
  ok(await waitFor(page, () => /Oturumunuz kapandı/.test(document.getElementById('cmsNotice')?.textContent ?? '')), '"Oturumunuz kapandı. Yazdıklarınız burada duruyor."');
  ok(await page.inputValue('[data-field="description"][data-lang="tr"]') === 'Uzun bir açıklama yazdım.', 'the text is still in the form');
  ok((await page.textContent('#cmsSaveState')).includes('bu cihazda yedeklendi'), '"Kaydedilemedi, bu cihazda yedeklendi"');
  const kept = await page.evaluate(() => localStorage.getItem('rsg:cms:u2:edit:events:symposium-2026'));
  ok(!!kept && kept.includes('Uzun bir açıklama yazdım.'), 'and kept in this browser');
  // Reopening restores it.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-field="description"][data-lang="tr"]');
  ok(await page.inputValue('[data-field="description"][data-lang="tr"]') === 'Uzun bir açıklama yazdım.', 'a reload restores it from this browser');
  ok(await waitFor(page, () => /geri yüklendi/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'and says so');
  await page.close();
}

console.log('7) the approver: the queue, the diff field by field, approve, send back');
{
  const id = '00000000-0000-4000-8000-000000000005';
  const id2 = '00000000-0000-4000-8000-000000000006';
  const { page, calls, state } = await open(browser, 'approver', '#icerik/onay', { width: 1280, height: 680 }, (s) => {
    const links = [SYM.links[1], SYM.links[0], { label: { en: 'Photos', tr: 'Fotoğraflar' }, url: 'https://example.org/c' }];
    s.drafts.set(id, draftRow({ id, status: 'submitted', entry_id: 'symposium-2026', author_id: 'u2', data: { ...SYM, when: { ...SYM.when, tr: '10-11 Ekim' }, links }, base_shas: { [PATH]: 'sha-1' } }));
    s.drafts.set(id2, draftRow({ id: id2, status: 'submitted', entry_id: 'symposium-2026', author_id: 'u2', data: SYM, base_shas: { [PATH]: 'sha-1' } }));
  });
  ok(await waitFor(page, () => document.querySelectorAll('[data-cms-queue]').length === 2), 'the queue lists what waits');
  ok((await page.textContent(`[data-cms-queue="${id}"]`)).includes('Gönderen: Editör A'), 'with the author\'s name, never an address');
  await page.click(`[data-cms-queue="${id}"] a`);
  ok(await waitFor(page, () => /alan değişti/.test(document.getElementById('cmsReview')?.textContent ?? '')), '"N alan değişti"');
  const review = await page.textContent('#cmsReview');
  ok(review.includes('2 alan değişti'), `two fields changed (when, links): "${review.match(/\d+ alan değişti/)?.[0]}"`);
  ok(review.includes('Yayında') && review.includes('Yeni') && review.includes('10-11 Ekim'), 'old and new side by side');
  ok(review.includes('Eklendi') && review.includes('Taşındı'), 'a list shows added and moved items');
  ok(review.includes('Değişmeyen'), 'unchanged fields collapse under one line');
  ok(review.includes('İç not') && review.includes(SYM.note), 'the internal note, read-only, for approvers');
  ok(await page.evaluate(() => { const b = document.getElementById('cmsApprove').getBoundingClientRect(); return b.bottom <= innerHeight && b.top >= 0; }), 'the action bar is on screen');
  await page.click('#cmsApprove');
  ok(await waitFor(page, () => /birkaç dakika/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'approved: "Yayına çıkması birkaç dakika sürer"');
  ok(calls.some((c) => c.method === 'POST' && c.path === `/api/cms/drafts/${id}/approve`), 'approve called /approve');
  ok(state.drafts.get(id).status === 'pr_open', 'the server has it on its way');
  // Send back needs a note.
  await page.evaluate((h) => { location.hash = h; }, `#icerik/onay/${id2}`);
  await page.waitForSelector('#cmsReject');
  ok((await page.textContent('#cmsReview')).includes('Bu taslakta değişiklik yok') && await page.locator('#cmsApprove').isDisabled(), 'no change: "Bu taslakta değişiklik yok", approval disabled');
  await page.click('#cmsReject');
  ok(await page.locator('#cmsRejectSend').isDisabled(), 'sending back needs a note');
  await page.fill('#cmsRejectNote', 'Tarihi kontrol edin.');
  await page.click('#cmsRejectSend');
  ok(await waitFor(page, () => location.hash === '#icerik/onay'), 'back to the queue');
  ok(calls.some((c) => c.path === `/api/cms/drafts/${id2}/reject` && c.body?.note === 'Tarihi kontrol edin.'), 'reject carried the note');
  await page.close();
}

console.log('8) an approval that meets a changed entry offers to send it back');
{
  const id = '00000000-0000-4000-8000-000000000004';
  const { page } = await open(browser, 'approver', `#icerik/onay/${id}`, { width: 1920, height: 1080 }, (s) => {
    s.drafts.set(id, draftRow({ id, status: 'submitted', entry_id: 'symposium-2026', data: { ...SYM, when: { ...SYM.when, tr: 'x' } }, base_shas: { [PATH]: 'sha-0' } }));
    s.nextApprove = [409, { error: 'changed', code: 'changed_since', paths: [PATH] }];
  });
  await page.waitForSelector('#cmsApprove');
  await page.click('#cmsApprove');
  ok(await waitFor(page, () => /sitede değişti/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'changed_since in plain words');
  ok(await visible(page, '#cmsRejectBox') && (await page.inputValue('#cmsRejectNote')).length > 0, 'the send-back note is ready');
  await page.close();
}

console.log('8b) an approval that never finished is back in the queue, labelled');
{
  const id = '00000000-0000-4000-8000-000000000003';
  const again = await open(browser, 'approver', `#icerik/onay/${id}`, { width: 1440, height: 800 }, (s) => {
    s.drafts.set(id, draftRow({ id, status: 'approved', updated_at: NOW - 900, entry_id: 'symposium-2026', data: { ...SYM, when: { ...SYM.when, tr: 'y' } }, base_shas: { [PATH]: 'sha-1' } }));
  });
  ok(await waitFor(again.page, () => /Onay yarım kaldı, yeniden deneyin/.test(document.getElementById('cmsNotice')?.textContent ?? '')), '"Onay yarım kaldı, yeniden deneyin"');
  ok(await again.page.locator('#cmsApprove').isEnabled(), 'and it can be approved again');
  await again.page.click('#cmsApprove');
  ok(await waitFor(again.page, () => /birkaç dakika/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'which finishes it');
  ok(again.calls.some((c) => c.path === `/api/cms/drafts/${id}/approve`), 'through /approve');
  await again.page.close();
}

console.log('9) status words in my drafts; a missing deep link');
{
  const { page } = await open(browser, 'editor', '#icerik/taslaklar', { width: 1440, height: 900 }, (s) => {
    const mk = (n, o) => s.drafts.set(`00000000-0000-4000-8000-00000000010${n}`, draftRow({ id: `00000000-0000-4000-8000-00000000010${n}`, entry_id: `meetup-${n}`, ...o }));
    mk(1, { status: 'rejected', review_note: 'Tarih yanlış' });
    mk(2, { status: 'pr_failed', failure: 'check failed: build' });
    mk(3, { status: 'merged', stale_merge: true });
    mk(4, { status: 'pr_failed', failure: 'merged but the site never showed it' });
    mk(5, { status: 'published', base_shas: { [PATH]: 'x' } });
    mk(6, { status: 'pr_open' });
    mk(7, { status: 'published', type: 'webinars', entry_id: 'w1', base_shas: { 'src/content/webinars/en/w1.md': 'a', 'src/content/webinars/tr/w1.md': 'b' } });
  });
  ok(await waitFor(page, () => document.querySelectorAll('[data-cms-draft]').length === 7), 'every draft is listed');
  ok(await page.getAttribute('[data-cms-draft="00000000-0000-4000-8000-000000000107"] a[target=_blank]', 'href', { timeout: 3000 }).catch(() => null) === '/tr/webinars/w1-tr/', '"Siteyi aç" for a webinar goes to its Turkish page');
  const txt = async (n) => (await page.textContent(`[data-cms-draft="00000000-0000-4000-8000-00000000010${n}"]`)).replace(/\s+/g, ' ');
  ok((await txt(1)).includes('Geri gönderildi: Tarih yanlış') && (await txt(1)).includes('Düzelt ve yeniden gönder'), 'sent back, with the note and "Düzelt ve yeniden gönder"');
  ok((await txt(2)).includes('Yayınlanamadı: Sitenin otomatik kontrolü bu değişikliği kabul etmedi: build') && (await txt(2)).includes('Yeniden dene'), 'a failed check in plain words, with "Yeniden dene"');
  ok((await txt(3)).includes('Birleşti ama site güncellenmedi, yöneticiye haber verin'), 'a late merge');
  ok((await txt(4)).includes('Birleşti ama site güncellenmedi') && !(await txt(4)).includes('Yeniden dene'), 'merged but never live: no resend pushed');
  ok((await txt(5)).includes('Yayında') && (await txt(5)).includes('Siteyi aç'), 'published, with "Siteyi aç"');
  ok((await txt(6)).includes('Yayına çıkıyor, birkaç dakika'), 'going live');
  const first = await page.locator('[data-cms-draft]').first().getAttribute('data-cms-draft');
  ok(['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000104'].includes(first), 'drafts that need me come first');
  await page.evaluate(() => { location.hash = '#icerik/taslaklar/00000000-0000-4000-8000-0000000009ff'; });
  ok(await waitFor(page, () => /artık yok veya size ait değil/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'a missing draft: "Bu taslak artık yok veya size ait değil"');
  ok(await visible(page, '[data-cms-to-drafts]'), 'with a link to Taslaklarım');
  await page.close();
}

console.log('10) a live draft makes its row read-only');
{
  const { page } = await open(browser, 'editor', '#icerik/etkinlikler', { width: 1440, height: 900 }, (s) => { s.live = [{ type: 'events', entry_id: 'symposium-2026', status: 'pr_open' }]; });
  await page.waitForSelector('[data-cms-entry="symposium-2026"]');
  const t = await page.textContent('[data-cms-entry="symposium-2026"]');
  ok(t.includes('Yayına çıkıyor') && await page.locator('[data-cms-entry="symposium-2026"] [data-cms-edit]').count() === 0, 'no "Düzenle" while it is going live');
  await page.close();
}

await section('F1) leaving the form inside the section asks first, before and after the first save', async () => {
  const { page } = await open(browser, 'editor', '#icerik/etkinlikler/symposium-2026', { width: 1440, height: 800 });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  await page.fill('[data-field="when"][data-lang="tr"]', 'değişti');
  await page.click('[data-cms-back]');
  ok(await waitFor(page, () => [...document.querySelectorAll('#cmsEditor div')].some((d) => /Kaydedilmemiş değişiklikler var/.test(d.textContent) && !d.classList.contains('hidden'))), '"Geri" with unsaved changes asks');
  ok(await page.evaluate(() => location.hash) === '#icerik/etkinlikler/symposium-2026', 'and stays put');
  await page.click('text=Düzenlemeye devam et');
  await page.click('#cmsSave');
  await waitFor(page, () => /taslaklar\//.test(location.hash));
  const draftHash = await page.evaluate(() => location.hash);
  await page.fill('[data-field="when"][data-lang="tr"]', 'yine değişti');
  await page.click('#subNav [data-sub-link="atolyeler"]');
  ok(await waitFor(page, () => [...document.querySelectorAll('#cmsEditor div')].some((d) => /Kaydedilmemiş değişiklikler var/.test(d.textContent) && !d.classList.contains('hidden'))), 'a type tab after the first save asks too');
  await page.click('text=Düzenlemeye devam et');
  ok(await page.evaluate(() => location.hash) === draftHash, `"Keep editing" keeps the draft's address (${draftHash})`);
  await page.close();
});

await section('F2) a local copy never silently wins; other people\'s copies go; signing out clears them', async () => {
  const id = '00000000-0000-4000-8000-000000000301';
  const { page } = await open(browser, 'editor', '#icerik/taslaklar', { width: 1440, height: 900 }, (s) => {
    s.drafts.set(id, draftRow({ id, entry_id: 'symposium-2026', updated_at: NOW - 60, data: SYM, base_shas: { [PATH]: 'sha-1' } }));
  });
  // A copy made on an older version of the draft, and one of another person.
  await page.evaluate(([key, older, now]) => {
    localStorage.setItem(key, JSON.stringify({ data: { ...older, when: { en: 'x', tr: 'Bu cihazdaki tarih' } }, at: now - 30, updated_at: now - 3600, write_nonce: 'an-older-version', base_shas: null }));
    localStorage.setItem('rsg:cms:someone-else:new:events', JSON.stringify({ data: {}, at: now, updated_at: null, base_shas: null }));
  }, [`rsg:cms:u2:${id}`, SYM, NOW]);
  await page.reload({ waitUntil: 'networkidle' });
  await page.evaluate((h) => { location.hash = h; }, `#icerik/taslaklar/${id}`);
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  ok(await page.inputValue('[data-field="when"][data-lang="tr"]') === SYM.when.tr, 'the saved version is what the form shows');
  ok(await waitFor(page, () => /daha eski bir kopya var/.test(document.getElementById('cmsBackup')?.textContent ?? '')), '"Bu tarayıcıda kaydedilmemiş daha eski bir kopya var"');
  // Typing before choosing does not overwrite the copy on offer, and a reload offers it again.
  await page.fill('[data-field="location"][data-lang="tr"]', 'Yazdım, seçmeden');
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  ok(await waitFor(page, () => /daha eski bir kopya var/.test(document.getElementById('cmsBackup')?.textContent ?? '')), 'after typing and a reload, the older copy is still offered');
  await page.click('[data-backup-compare]');
  ok((await page.textContent('#cmsBackup')).includes('Bu cihazdaki tarih'), 'and it is the copy that was offered, not what was typed since');
  ok((await page.textContent('#cmsBackup')).includes('Bu cihazdaki tarih') && (await page.textContent('#cmsBackup')).includes('Kayıtlı'), 'compared field by field');
  await page.click('#cmsBackup [data-take="when"]');
  ok(await page.inputValue('[data-field="when"][data-lang="tr"]') === 'Bu cihazdaki tarih', '"Bu cihazdakini al" copies it in');
  ok(await page.evaluate(() => localStorage.getItem('rsg:cms:someone-else:new:events')) === null, 'another person\'s copy is gone');
  // Signing out from the header.
  await page.route('**/auth/logout', (r) => r.fulfill({ contentType: 'text/html', body: '<p>signed out</p>' }));
  await page.evaluate(() => { localStorage.setItem('rsg:cms:u2:new:events', '{"data":{},"at":1}'); document.querySelector('form[action="/auth/logout"]').requestSubmit(); });
  await page.waitForURL('**/auth/logout');
  ok(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('rsg:cms:')).length) === 0, 'signing out leaves no content copies');
  await page.close();
});

await section('F3) a save belongs to the form that asked for it', async () => {
  const { page, calls, state } = await open(browser, 'editor', '#icerik/etkinlikler/symposium-2026', { width: 1440, height: 900 });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  state.postDelay = 1500;
  await page.fill('[data-field="when"][data-lang="tr"]', 'bir');
  await page.click('#cmsSave');
  await page.fill('[data-field="when"][data-lang="tr"]', 'iki');
  await page.click('#cmsSave');
  // Away to another entry while those saves wait.
  await page.evaluate(() => { location.hash = '#icerik/etkinlikler/meetup-1'; });
  await page.click('text=Değişiklikleri at').catch(() => {});
  await page.waitForTimeout(3500);
  const posts = calls.filter((c) => c.method === 'POST' && c.path === '/api/cms/drafts');
  ok(posts.length >= 1 && posts.every((c) => c.body.entry_id === 'symposium-2026'), `no save went out with the other entry's form (${posts.map((c) => c.body.entry_id).join(', ')})`);
  await page.close();
});

await section('F4) a save made on an older version is refused and says so', async () => {
  const id = '00000000-0000-4000-8000-000000000302';
  const { page, calls, state } = await open(browser, 'editor', `#icerik/taslaklar/${id}`, { width: 1366, height: 768 }, (s) => {
    s.drafts.set(id, draftRow({ id, entry_id: 'symposium-2026', data: SYM, base_shas: { [PATH]: 'sha-1' } }));
  });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  state.drafts.get(id).write_nonce = 'other-tab';
  await page.fill('[data-field="when"][data-lang="tr"]', 'bu sekme');
  await page.click('#cmsSave');
  ok(await waitFor(page, () => /başka bir sekmede veya cihazda değişti/.test(document.getElementById('cmsNotice')?.textContent ?? '')), '"Bu taslak başka bir sekmede veya cihazda değişti"');
  ok(calls.find((c) => c.method === 'PATCH')?.body?.write_nonce === 'n0', 'the PATCH named the version it was made on');
  ok(await visible(page, '#cmsReload') && await page.locator('#cmsSubmit').isDisabled(), '"Yeniden yükle", and no sending from here');
  ok(await page.inputValue('[data-field="when"][data-lang="tr"]') === 'bu sekme', 'the text stays in the form');
  await page.close();
});

await section('F5) review: an unreadable published version, a non-approver, a note-only change', async () => {
  const id = '00000000-0000-4000-8000-000000000303';
  const mk = (s, o = {}) => s.drafts.set(id, draftRow({ id, status: 'submitted', entry_id: 'symposium-2026', data: SYM, base_shas: { [PATH]: 'sha-1' }, ...o }));
  let r = await open(browser, 'approver', `#icerik/onay/${id}`, { width: 1440, height: 900 }, (s) => { mk(s, { data: { ...SYM, when: { ...SYM.when, tr: 'y' } } }); s.entryFail = true; });
  ok(await waitFor(r.page, () => /Yayındaki sürüm okunamadı/.test(document.getElementById('cmsReview')?.textContent ?? '')), '"Yayındaki sürüm okunamadı, birazdan yeniden deneyin"');
  ok(await r.page.locator('#cmsApprove').isDisabled(), 'and no approval on a guess');
  await r.page.close();
  r = await open(browser, 'approver', `#icerik/onay/${id}`, { width: 1440, height: 900 }, (s) => mk(s, { data: { ...SYM, note: 'Changed note' } }));
  await r.page.waitForSelector('#cmsApprove');
  ok(await r.page.locator('#cmsApprove').isEnabled() && (await r.page.textContent('#cmsReview')).includes('1 alan değişti'), 'a change to the internal note alone is a change');
  await r.page.close();
  r = await open(browser, 'editor', `#icerik/onay/${id}`, { width: 1440, height: 900 }, (s) => mk(s, { data: { ...SYM, when: { ...SYM.when, tr: 'y' } } }));
  await waitFor(r.page, () => /alan değişti|onaylayabilir/.test(document.getElementById('cmsEditor')?.textContent ?? ''));
  ok(await r.page.locator('#cmsApprove, #cmsReject').count() === 0, 'a non-approver sees no approve or send-back');
  await r.page.close();
  r = await open(browser, 'approver', '#icerik/onay/00000000-0000-4000-8000-0000000003ff', { width: 1440, height: 900 });
  ok(await waitFor(r.page, () => !!document.querySelector('#cmsNotice [data-cms-to-drafts]')), 'a missing draft on onay/ links to Taslaklarım');
  await r.page.close();
});

await section('F12) review: "Dosya farkı" under the fields, and a warning when the file changes but no field does', async () => {
  const id = '00000000-0000-4000-8000-000000000306';
  const main = `${JSON.stringify(SYM, null, 2)}\n`;
  const mk = (s, data, after) => {
    s.drafts.set(id, draftRow({ id, status: 'submitted', entry_id: 'symposium-2026', data, base_shas: { [PATH]: 'sha-1' } }));
    s.entryFiles = { [PATH]: main };
    s.draftFiles = [{ path: PATH, content: after }];
  };
  // Same data, different bytes (say a key the form does not show).
  let r = await open(browser, 'approver', `#icerik/onay/${id}`, { width: 1440, height: 900 }, (s) => mk(s, SYM, main.replace('"note"', '"extra": 1,\n  "note"')));
  ok(await waitFor(r.page, () => !!document.querySelector('[data-cms-hidden-changes]')), '"Dosyada formda görünmeyen değişiklikler var"');
  ok((await r.page.textContent('[data-cms-hidden-changes]')).includes('Dosyada formda görünmeyen değişiklikler var'), 'in those words');
  ok(await r.page.locator('[data-cms-file-diff]').evaluate((d) => d.open), 'the file diff is open');
  ok((await r.page.textContent('[data-cms-file-diff]')).includes('"extra": 1'), 'and shows the added line');
  ok(await r.page.locator('#cmsApprove').isEnabled(), 'the approver can approve after reading it');
  await r.page.close();
  // A field change: the file diff is there, closed, with no warning.
  const changed = { ...SYM, when: { ...SYM.when, tr: 'y' } };
  r = await open(browser, 'approver', `#icerik/onay/${id}`, { width: 1440, height: 900 }, (s) => mk(s, changed, `${JSON.stringify(changed, null, 2)}\n`));
  await r.page.waitForSelector('[data-cms-file-diff]');
  ok(!(await r.page.locator('[data-cms-file-diff]').evaluate((d) => d.open)) && await r.page.locator('[data-cms-hidden-changes]').count() === 0, 'closed and no warning when a field explains it');
  await r.page.click('[data-cms-file-diff] > summary');
  ok((await r.page.textContent('[data-cms-file-diff]')).includes('Dosya farkı') && (await r.page.textContent('[data-cms-file-diff]')).includes(PATH), 'opens to the file\'s path and lines');
  await r.page.close();
});

await section('F6) opening an entry asks again whether it is busy', async () => {
  const { page, state } = await open(browser, 'editor', '#icerik/etkinlikler', { width: 1440, height: 900 });
  await page.waitForSelector('[data-cms-entry="symposium-2026"] [data-cms-edit]');
  state.live = [{ type: 'events', entry_id: 'symposium-2026', status: 'submitted' }];
  await page.click('[data-cms-entry="symposium-2026"] [data-cms-edit]');
  ok(await waitFor(page, () => /onay bekliyor/.test(document.getElementById('cmsStatus')?.textContent ?? '')), 'busy wording');
  ok(await page.locator('#cmsSave').count() === 0, 'and read-only');
  await page.close();
});

await section('F7) moving onto the site\'s version: a failed delete of the old draft is said', async () => {
  const id = '00000000-0000-4000-8000-000000000304';
  const { page } = await open(browser, 'editor', `#icerik/taslaklar/${id}`, { width: 1440, height: 900 }, (s) => {
    s.drafts.set(id, draftRow({ id, status: 'rejected', review_note: 'Yeri kontrol edin', entry_id: 'symposium-2026', data: SYM, base_shas: { [PATH]: 'sha-0' } }));
    s.failDelete = true;
  });
  await page.waitForSelector('#cmsRebase');
  await page.click('#cmsRebase');
  ok(await waitFor(page, () => /eski taslak silinemedi/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'the old draft could not be deleted: said');
  ok((await page.textContent('#cmsNotice')).includes('Yeri kontrol edin'), 'and the old send-back note is carried over');
  await page.close();
});

await section('F8) list failures, required marks, the 401 notice once, upload errors, queue overflow, banner', async () => {
  let r = await open(browser, 'editor', '#icerik/taslaklar', { width: 1440, height: 900 }, (s) => { s.draftsFail = 500; });
  ok(await waitFor(r.page, () => /Liste yüklenemedi/.test(document.querySelector('[data-sub="taslaklar"]')?.textContent ?? '')), 'a failed list says so, not "no drafts"');
  ok(!(await r.page.textContent('[data-sub="taslaklar"]')).includes('Taslağınız yok'), 'never "Taslağınız yok"');
  await r.page.close();
  r = await open(browser, 'editor', '#icerik/etkinlikler', { width: 1440, height: 900 }, (s) => { s.draftsFail = 401; });
  ok(await waitFor(r.page, () => /Oturumunuz kapandı/.test(document.querySelector('[data-sub="etkinlikler"]')?.textContent ?? '')), 'a 401 says to sign in');
  await r.page.close();

  r = await open(browser, 'editor', '#icerik/etkinlikler/symposium-2026', { width: 1440, height: 900 });
  await r.page.waitForSelector('[data-field-wrap="title"]');
  ok((await r.page.textContent('[data-field-wrap="title"] p')).includes('*'), 'a required field is marked');
  ok(await r.page.locator('#cmsBanner').count() === 0, 'no draft banner before a change');
  await r.page.fill('[data-field="location"][data-lang="tr"]', 'Ankara!');
  ok(await visible(r.page, '#cmsBanner'), 'the banner once the form has a change');
  r.state.signedOut = true;
  await r.page.click('#cmsSave');
  await waitFor(r.page, () => /Oturumunuz kapandı/.test(document.getElementById('cmsNotice')?.textContent ?? ''));
  const scrolls = await r.page.evaluate(async () => {
    let n = 0;
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = function (...a) { if (this.id === 'cmsNotice') n++; return orig.apply(this, a); };
    document.getElementById('cmsSave').click();
    await new Promise((res) => setTimeout(res, 800));
    return n;
  });
  ok(scrolls === 0, `a second failed save does not bring the notice back (${scrolls})`);
  r.state.signedOut = false;
  r.state.uploadFail = 'Unsupported image type. Use JPEG, PNG, WebP, or GIF.';
  await r.page.click('#cmsMore summary');
  await r.page.setInputFiles('[data-image-file="image"]', { name: 'a.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
  ok(await waitFor(r.page, () => /JPEG, PNG, WebP veya GIF/.test(document.querySelector('[data-image-status="image"]')?.textContent ?? '')), 'an upload error in plain Turkish');
  await r.page.close();

  r = await open(browser, 'approver', '#icerik/onay', { width: 1440, height: 900 }, (s) => {
    s.drafts.set('00000000-0000-4000-8000-000000000305', draftRow({ id: '00000000-0000-4000-8000-000000000305', status: 'submitted', entry_id: 'symposium-2026', data: SYM }));
    s.more = true; s.queueCount = 205;
  });
  ok(await waitFor(r.page, () => /204 taslak daha var/.test(document.querySelector('[data-cms-queue-more]')?.textContent ?? '')), '"N taslak daha var"');
  ok(await r.page.locator('[data-sub="onay"] [data-cms-mine]').count() === 1, 'the Taslaklarım row above the queue too');
  await r.page.close();

  r = await open(browser, 'editor', '#icerik/webinarlar/_new', { width: 1440, height: 900 });
  await r.page.waitForSelector('[data-field-wrap="year"]', { state: 'attached' });
  ok(await r.page.locator('[data-field-wrap="year"] fieldset').evaluate((f) => f.disabled), 'a webinar\'s year is not typed: it comes from the date');
  await r.page.close();
});

await section('F9) a new name that is taken is said on the title', async () => {
  const id = '00000000-0000-4000-8000-000000000306';
  const { page } = await open(browser, 'editor', `#icerik/taslaklar/${id}`, { width: 1440, height: 900 }, (s) => {
    s.drafts.set(id, draftRow({ id, action: 'create', entry_id: 'meetup-x-2027', data: { ...SYM, id: 'meetup-x-2027' } }));
    s.nextPatch = [422, { error: 'Some fields are not valid', code: 'invalid', errors: { id: 'An entry with this name already exists' } }];
  });
  await page.waitForSelector('#cmsSave');
  await page.click('#cmsSave');
  ok(await waitFor(page, () => /Başlık: Bu adla bir kayıt zaten var/.test(document.getElementById('cmsErrors')?.textContent ?? '')), '"Bu adla bir kayıt zaten var", on the title');
  await page.close();
});

await section('F10) a save whose answer was lost does not look like someone else\'s change', async () => {
  const id = '00000000-0000-4000-8000-000000000307';
  const { page, calls, state } = await open(browser, 'editor', `#icerik/taslaklar/${id}`, { width: 1440, height: 900 }, (s) => {
    s.drafts.set(id, draftRow({ id, entry_id: 'symposium-2026', data: SYM, base_shas: { [PATH]: 'sha-1' } }));
  });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  state.abortNextPatch = true;
  await page.fill('[data-field="when"][data-lang="tr"]', 'kayboldu');
  await page.click('#cmsSave');
  await waitFor(page, () => /yedeklendi/.test(document.getElementById('cmsSaveState')?.textContent ?? ''));
  await page.click('#cmsSave');
  ok(await waitFor(page, () => /Kaydedildi/.test(document.getElementById('cmsSaveState')?.textContent ?? '')), 'the next save goes through');
  ok(!/başka bir sekmede/.test(await page.textContent('#cmsNotice')), 'no "changed elsewhere"');
  ok(calls.filter((c) => c.method === 'GET' && c.path.endsWith(id)).length === 2 && calls.filter((c) => c.method === 'PATCH').length === 3, 'the draft was read once and the save sent again');
  await page.close();
});

await section('F11) a copy on offer goes with its form: a new entry saved, then a new form offers nothing', async () => {
  const { page } = await open(browser, 'editor', '#icerik/taslaklar', { width: 1440, height: 900 });
  await page.evaluate((now) => localStorage.setItem('rsg:cms:u2:new:events:offered', JSON.stringify({ data: { title: { en: 'Eski', tr: 'Eski' } }, at: now, updated_at: null, write_nonce: null, base_shas: null })), NOW);
  await page.evaluate(() => { location.hash = '#icerik/etkinlikler/_new'; });
  ok(await waitFor(page, () => /daha eski bir kopya var/.test(document.getElementById('cmsBackup')?.textContent ?? '')), 'the copy is offered on the new form');
  await page.fill('[data-field="title"][data-lang="en"]', 'Ankara Meetup');
  await page.fill('[data-field="start"]', '2027-03-06');
  await page.click('#cmsSave');
  await waitFor(page, () => /taslaklar\//.test(location.hash));
  ok(await page.evaluate(() => localStorage.getItem('rsg:cms:u2:new:events:offered')) === null, 'saving the new entry as a draft drops the copy on offer');
  await page.evaluate(() => { location.hash = '#icerik/etkinlikler/_new'; });
  await page.waitForSelector('[data-field="title"][data-lang="en"]');
  await page.waitForTimeout(300);
  ok(await page.locator('#cmsBackup:not(.hidden)').count() === 0, 'the next new form offers nothing');
  await page.close();
});

await section('X1) no draft without an exit', async () => {
  const mk = (s, n, o) => s.drafts.set(`00000000-0000-4000-8000-00000000040${n}`, draftRow({ id: `00000000-0000-4000-8000-00000000040${n}`, entry_id: `meetup-${n}`, data: { ...SYM, id: `meetup-${n}` }, ...o }));
  const { page, calls } = await open(browser, 'approver', '#icerik/onay', { width: 1440, height: 900 }, (s) => {
    mk(s, 1, { status: 'pr_open', pr_number: 9 });
    mk(s, 2, { status: 'merged', stale_merge: true });
    mk(s, 3, { status: 'pr_failed', failure: 'merged but the site never showed it' });
    mk(s, 4, { status: 'approved', updated_at: NOW - 900, entry_id: 'symposium-2026', data: SYM, base_shas: { [PATH]: 'sha-1' } });
  });
  ok(await waitFor(page, () => /Süren ve takılanlar/.test(document.querySelector('[data-sub="onay"]')?.textContent ?? '')), '"Süren ve takılanlar" under the queue');
  ok(await page.locator('[data-cms-inflight]').count() === 4, 'with the pull request, the late merge, the failure and the unfinished approval');
  await page.click('[data-cms-inflight="00000000-0000-4000-8000-000000000401"] a');
  await page.waitForSelector('#cmsReviewCancel');
  await page.click('#cmsReviewCancel'); await page.click('#cmsReviewCancel');
  ok(await waitFor(page, () => location.hash === '#icerik/onay'), 'a pull request on its way can be stopped from its review');
  ok(calls.some((c) => c.path.endsWith('000000000401/cancel')), 'through /cancel');
  for (const n of [2, 3]) {
    await page.evaluate((h) => { location.hash = h; }, `#icerik/onay/00000000-0000-4000-8000-00000000040${n}`);
    await page.waitForSelector('#cmsReviewDiscard');
    await page.click('#cmsReviewDiscard'); await page.click('#cmsReviewDiscard');
    await waitFor(page, () => location.hash === '#icerik/onay');
    ok(calls.some((c) => c.method === 'DELETE' && c.path.endsWith(`00000000040${n}`)), `draft ${n} discarded from its review`);
  }
  await page.evaluate(() => { location.hash = '#icerik/onay/00000000-0000-4000-8000-000000000404'; });
  await page.waitForSelector('#cmsApprove');
  ok(await page.locator('#cmsApprove').isEnabled(), 'an unfinished approval with no changes can still be approved again');
  ok(await page.locator('#cmsReviewDiscard').count() === 1, 'or discarded');
  await page.close();
});

await section('X2) the author lets go of a failed draft; no removal while the entry is busy', async () => {
  const id = '00000000-0000-4000-8000-000000000501';
  let r = await open(browser, 'editor', `#icerik/taslaklar/${id}`, { width: 1440, height: 900 }, (s) => {
    s.drafts.set(id, draftRow({ id, entry_id: 'symposium-2026', status: 'pr_failed', failure: 'merged but the site never showed it', data: SYM }));
  });
  await r.page.waitForSelector('[data-cms-menu]', { state: 'attached' });
  ok(await r.page.locator('[data-cms-discard]').count() === 1, 'the author can delete a draft that failed, whatever the reason');
  await r.page.close();
  r = await open(browser, 'approver', '#icerik/etkinlikler/symposium-2026', { width: 1440, height: 900 }, (s) => { s.live = [{ type: 'events', entry_id: 'symposium-2026', status: 'pr_open' }]; });
  await r.page.waitForSelector('[data-field-wrap="title"]');
  await r.page.waitForTimeout(300);
  ok(await r.page.locator('[data-cms-delete-entry]').count() === 0, '"Siteden kaldır" is not offered while the entry is busy');
  await r.page.close();
  r = await open(browser, 'approver', '#icerik/etkinlikler/symposium-2026', { width: 1440, height: 900 });
  await r.page.waitForSelector('[data-field-wrap="title"]');
  ok(await r.page.locator('[data-cms-delete-entry]').count() === 1, 'and is offered when it is free');
  await r.page.close();
});

console.log('22) the old address: #icerik-etkinlikler/<rest> opens #icerik/<rest>');
{
  const id = '00000000-0000-4000-8000-000000000501';
  const { page } = await open(browser, 'editor', `#icerik-etkinlikler/taslaklar/${id}`, { width: 1440, height: 900 }, (s) => {
    s.drafts.set(id, draftRow({ id, entry_id: 'symposium-2026', data: SYM, base_shas: { [PATH]: 'sha-1' } }));
  });
  ok(await waitFor(page, () => location.hash === '#icerik/taslaklar/00000000-0000-4000-8000-000000000501'), `the address is swapped: ${await page.evaluate(() => location.hash)}`);
  ok(await waitFor(page, () => (document.getElementById('cmsTitle')?.textContent ?? '').includes('Sempozyum')), 'and the same draft opens');
  ok(await page.locator('[data-sub-link="taslaklar"][aria-selected="true"]').count() === 1, 'on the Taslaklarım tab');
  for (const [old, now] of [['#icerik-etkinlikler', '#icerik/etkinlikler'], ['#icerik-etkinlikler/webinarlar', '#icerik/webinarlar']]) {
    await page.evaluate((h) => { location.hash = h; }, old);
    ok(await waitFor(page, (h) => location.hash === h, now), `${old} → ${now}`);
  }
  // The section's title is the new one, in both languages.
  ok((await page.textContent('#sectionTitle')).trim() === 'İçerik', 'the section is called İçerik');
  await page.close();
  const en = await open(browser, 'editor', '#icerik-etkinlikler/etkinlikler', { width: 1440, height: 900 }, () => {}, 'en');
  ok(await waitFor(en.page, () => location.hash === '#icerik/etkinlikler'), 'the English panel swaps it too');
  ok((await en.page.textContent('#sectionTitle')).trim() === 'Content', 'and calls the section Content');
  await en.page.close();
}

console.log('23) a Yazılar-only editor: only that group\'s tabs, no Onay, no Etkinlikler data');
{
  const { page, calls } = await open(browser, 'yazilar', '#icerik', { width: 1440, height: 900 });
  ok(await waitFor(page, () => !!document.querySelector('[data-sub-link="taslaklar"]')), 'İçerik opens, with Taslaklarım');
  const tabs = await page.$$eval('[data-sub-link]', (els) => els.map((e) => e.getAttribute('data-sub-link')));
  ok(!tabs.some((t) => ['etkinlikler', 'atolyeler', 'webinarlar'].includes(t)), `no Etkinlikler tab: ${tabs.join(', ')}`);
  ok(!tabs.includes('onay'), 'no Onay');
  ok(await page.locator('[data-section="icerik"] [data-sub="etkinlikler"], [data-section="icerik"] [data-sub="onay"]').count() === 0, 'and their panes are gone from the page');
  ok(await page.locator('[data-nav="icerik"]').count() >= 1, 'the menu has İçerik');
  ok(!calls.some((c) => c.path.startsWith('/api/cms/entries')), 'no type\'s index was loaded for an empty draft list');
  // An Etkinlikler address falls back to what they may see.
  await page.evaluate(() => { location.hash = '#icerik/etkinlikler'; });
  ok(await waitFor(page, () => location.hash === '#icerik/taslaklar'), `an Etkinlikler tab is not theirs: ${await page.evaluate(() => location.hash)}`);
  await page.close();
}

console.log('24) approve rights per type: a group approver sees no Approve for an approve: \'admin\' type');
{
  const ev = '00000000-0000-4000-8000-000000000601';
  const ws = '00000000-0000-4000-8000-000000000602';
  const { page, calls } = await open(browser, 'approver', `#icerik/onay/${ev}`, { width: 1440, height: 900 }, (s) => {
    s.adminOnly = ['events'];
    s.drafts.set(ev, draftRow({ id: ev, status: 'submitted', entry_id: 'symposium-2026', author_id: 'u2', data: { ...SYM, when: { ...SYM.when, tr: 'y' } }, base_shas: { [PATH]: 'sha-1' } }));
    s.drafts.set(ws, draftRow({ id: ws, type: 'workshops', action: 'create', status: 'submitted', entry_id: 'rnaseq', author_id: 'u2', data: { title: 'RNA-seq', year: 2026, topics: 'x', repo: 'RNAseq' }, base_shas: {} }));
  });
  ok(await waitFor(page, () => !!document.getElementById('cmsReview')?.textContent?.trim()), 'the change is shown');
  ok(await page.locator('#cmsApprove').count() === 0 && await page.locator('#cmsReject').count() === 0, 'no Approve or Reject for a type only an admin approves');
  ok((await page.textContent('#cmsNotice')).trim().length > 0, 'it says the view is read-only');
  ok(await page.locator('[data-sub-link="onay"]').count() === 1, 'Onay is still there: they approve the other types');
  await page.evaluate((h) => { location.hash = h; }, `#icerik/onay/${ws}`);
  ok(await waitFor(page, () => !!document.getElementById('cmsApprove')), 'the same approver approves a workshop');
  await page.click('#cmsApprove');
  ok(await waitFor(page, () => /Onaylandı/.test(document.getElementById('cmsNotice')?.textContent ?? '')) && calls.some((c) => c.method === 'POST' && c.path.endsWith(`${ws}/approve`)), 'and the approval goes out');
  ok(!calls.some((c) => c.method === 'POST' && c.path.endsWith(`${ev}/approve`)), 'the events draft was never approved');
  ok(calls.filter((c) => c.path === '/api/cms/types').length === 1, '/api/cms/types is asked once per page');
  await page.close();
}

console.log('25) /api/cms/types fails: the list says so, it does not guess anyone\'s rights');
{
  const { page } = await open(browser, 'approver', '#icerik/etkinlikler', { width: 1440, height: 900 }, (s) => { s.typesFail = true; });
  ok(await waitFor(page, () => !!document.querySelector('[data-sub="etkinlikler"] [data-cms-load-failed]')), 'a load-failed line, not an empty list');
  await page.close();
}

console.log('11) phone: no sideways scroll on the list, the form and the review');
for (const [who, hash] of [['editor', '#icerik/etkinlikler'], ['editor', '#icerik/etkinlikler/symposium-2026'], ['editor', '#icerik/webinarlar/_new'], ['approver', '#icerik/onay/00000000-0000-4000-8000-000000000005']]) {
  const { page } = await open(browser, who, hash, { width: 390, height: 844 }, (s) => {
    s.drafts.set('00000000-0000-4000-8000-000000000005', draftRow({ id: '00000000-0000-4000-8000-000000000005', status: 'submitted', entry_id: 'symposium-2026', data: { ...SYM, when: { ...SYM.when, tr: 'x '.repeat(80) } } }));
  });
  await page.waitForSelector('[data-cms-entry], #cmsFields [data-field-wrap], #cmsReview [data-diff-field]');
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  ok(await noSideScroll(page), `${hash}: nothing wider than the phone`);
  await page.close();
}

await browser.close();
console.log(bad.length ? `\n${bad.length} FAILED:\n - ` + bad.join('\n - ') : '\nALL PASSED');
process.exit(bad.length ? 1 : 0);
