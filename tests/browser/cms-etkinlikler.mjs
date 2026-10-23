/**
 * The Etkinlikler panel (panel CMS) in a real browser, signed in, with
 * /api/cms/* answered here: the list, the form, saving, sending, the
 * approver's queue and diff, "changed since you started", field errors in
 * plain words, an expired session, the deep link a pull request carries,
 * and the phone layout.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npx astro preview --port 4329 &
 *   BASE=http://localhost:4329 node tests/browser/cms-etkinlikler.mjs
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
  webinars: [{ id: 'w1', title: 'A webinar', date: '2024-04-16', paths: { en: 'src/content/webinars/en/w1.md', tr: 'src/content/webinars/tr/w1.md' }, shas: {} }],
};
const draftRow = (o) => ({ type: 'events', action: 'update', status: 'draft', author_id: 'u2', author_name: 'Ece Editör', reviewer_id: null, review_note: null,
  pr_url: null, pr_number: null, failure: null, stale_merge: false, created_at: NOW - 600, updated_at: NOW - 300, ...o });

/**
 * One page with its own mock server. `who` is 'editor' or 'approver'.
 * `state` is what the mock server holds; `calls` what the page sent.
 */
async function open(browser, who, hash, viewport = { width: 1440, height: 900 }, setup = () => {}) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push(`pageerror (${hash}): ` + String(e).slice(0, 200)));
  const state = {
    drafts: new Map(), live: [], entryShas: { [PATH]: 'sha-1' }, entryData: SYM,
    nextPost: null, nextPatch: null, nextSubmit: null, nextApprove: null, signedOut: false,
  };
  const calls = [];
  setup(state);
  const user = who === 'approver'
    ? { id: 'u1', email: 'onay@example.org', grants: [{ role: 'content.etkinlikler.approve', expires_at: null }] }
    : { id: 'u2', email: 'editor@example.org', grants: [{ role: 'content.etkinlikler.edit', expires_at: null }] };
  await page.route('**/api/**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const p = url.pathname;
    const method = req.method();
    const body = req.postData() ? JSON.parse(req.postData()) : undefined;
    const json = (v, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    if (p.startsWith('/api/cms')) calls.push({ method, path: p + url.search, body });
    if (state.signedOut && p.startsWith('/api/cms') && method !== 'GET') return json({ error: 'Not signed in', code: 'unauthenticated' }, 401);
    if (p === '/api/me') return json({ user, profile: {} });
    if (p === '/api/admin/health') return json({ issues: [], canFix: false });
    if (p === '/api/admin/counts') return json(who === 'approver' ? { cmsMine: 0, cmsQueue: 1, cmsTotal: 1 } : { cmsMine: 1, cmsTotal: 1 });
    if (p === '/api/cms/entries') return json({ type: url.searchParams.get('type'), entries: ENTRIES[url.searchParams.get('type')] ?? [] });
    if (p === '/api/cms/entry') return json({ type: 'events', id: url.searchParams.get('id'), data: state.entryData, base_shas: state.entryShas });
    if (p === '/api/cms/drafts' && method === 'GET') {
      const all = [...state.drafts.values()];
      return json({ mine: all.filter((d) => d.author_id === user.id).map(({ data, base_shas, ...d }) => d),
        queue: who === 'approver' ? all.filter((d) => d.status === 'submitted').map(({ data, base_shas, ...d }) => d) : [], more: false, live: state.live });
    }
    if (p === '/api/cms/drafts' && method === 'POST') {
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
      if (!m[2] && method === 'GET') return json({ draft: d });
      if (!m[2] && method === 'PATCH') {
        if (state.nextPatch) { const [s, v] = state.nextPatch; state.nextPatch = null; return json(v, s); }
        d.data = body.data; d.updated_at = Math.floor(Date.now() / 1000);
        return json({ draft: d });
      }
      if (!m[2] && method === 'DELETE') { d.status = 'discarded'; return json({ ok: true }); }
      if (m[2] === 'submit') {
        if (state.nextSubmit) { const [s, v] = state.nextSubmit; state.nextSubmit = null; return json(v, s); }
        d.status = 'submitted'; return json({ draft: d });
      }
      if (m[2] === 'approve') {
        if (state.nextApprove) { const [s, v] = state.nextApprove; state.nextApprove = null; return json(v, s); }
        d.status = 'pr_open'; d.pr_number = 7; return json({ draft: d });
      }
      if (m[2] === 'reject') { d.status = 'rejected'; d.review_note = body.note; return json({ draft: d }); }
    }
    if (method !== 'GET') return r.fulfill({ status: 204, body: '' });
    return json({});
  });
  await page.goto(`${BASE}/tr/admin${hash}`, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return { page, state, calls };
}

const visible = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const waitFor = (page, fn, arg, timeout = 5000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const noSideScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

console.log('1) the list: published events, newest first, "Daha fazla", my drafts row');
{
  const { page } = await open(browser, 'editor', '#icerik-etkinlikler');
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
  const { page, calls, state } = await open(browser, 'editor', '#icerik-etkinlikler/etkinlikler');
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
  ok(/#icerik-etkinlikler\/taslaklar\/0000/.test(await page.evaluate(() => location.hash)), 'the address is the draft\'s now');
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
  const { page } = await open(browser, 'editor', '#icerik-etkinlikler/taslaklar/00000000-0000-4000-8000-000000000009', { width: 1280, height: 680 }, (s) => {
    s.drafts.set('00000000-0000-4000-8000-000000000009', draftRow({ id: '00000000-0000-4000-8000-000000000009', entry_id: 'symposium-2026', data: { ...SYM, title: { ...SYM.title, tr: '' } }, base_shas: { [PATH]: 'sha-1' } }));
    s.nextSubmit = [422, { error: 'Some fields are not valid', code: 'invalid', errors: { 'title.tr': 'Too small: expected string to have >=1 characters', 'links.1.url': 'Invalid input: expected string, received undefined' } }];
  });
  await page.waitForSelector('#cmsSubmit');
  ok(await waitFor(page, () => document.getElementById('cmsTitle')?.textContent?.length > 0), 'the deep link a pull request carries opens the draft');
  await page.click('#cmsSubmit');
  // The half-translated warning comes first: the Turkish title is empty.
  ok(await waitFor(page, () => !!document.getElementById('cmsHalfSend')), 'a text in one language only is flagged before sending');
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
  const { page, calls } = await open(browser, 'editor', `#icerik-etkinlikler/taslaklar/${id}`, { width: 1366, height: 768 }, (s) => {
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
  const { page } = await open(browser, 'editor', '#icerik-etkinlikler/etkinlikler/symposium-2026', { width: 1440, height: 800 }, (s) => {
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
  const { page, state } = await open(browser, 'editor', '#icerik-etkinlikler/etkinlikler/symposium-2026', { width: 1536, height: 864 });
  await page.waitForSelector('[data-field="when"][data-lang="tr"]');
  state.signedOut = true;
  await page.fill('[data-field="description"][data-lang="tr"]', 'Uzun bir açıklama yazdım.');
  await page.click('#cmsSave');
  ok(await waitFor(page, () => /Oturumunuz kapandı/.test(document.getElementById('cmsNotice')?.textContent ?? '')), '"Oturumunuz kapandı. Yazdıklarınız burada duruyor."');
  ok(await page.inputValue('[data-field="description"][data-lang="tr"]') === 'Uzun bir açıklama yazdım.', 'the text is still in the form');
  ok((await page.textContent('#cmsSaveState')).includes('bu cihazda yedeklendi'), '"Kaydedilemedi, bu cihazda yedeklendi"');
  const kept = await page.evaluate(() => localStorage.getItem('rsg:cms:edit:events:symposium-2026'));
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
  const { page, calls, state } = await open(browser, 'approver', '#icerik-etkinlikler/onay', { width: 1280, height: 680 }, (s) => {
    const links = [SYM.links[1], SYM.links[0], { label: { en: 'Photos', tr: 'Fotoğraflar' }, url: 'https://example.org/c' }];
    s.drafts.set(id, draftRow({ id, status: 'submitted', entry_id: 'symposium-2026', author_id: 'u2', data: { ...SYM, when: { ...SYM.when, tr: '10-11 Ekim' }, links }, base_shas: { [PATH]: 'sha-1' } }));
    s.drafts.set(id2, draftRow({ id: id2, status: 'submitted', entry_id: 'meetup-1', author_id: 'u2', data: { ...SYM, id: 'meetup-1' }, base_shas: {} }));
  });
  ok(await waitFor(page, () => document.querySelectorAll('[data-cms-queue]').length === 2), 'the queue lists what waits');
  ok((await page.textContent(`[data-cms-queue="${id}"]`)).includes('Gönderen: Ece Editör'), 'with the author\'s name, never an address');
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
  await page.evaluate((h) => { location.hash = h; }, `#icerik-etkinlikler/onay/${id2}`);
  await page.waitForSelector('#cmsReject');
  ok((await page.textContent('#cmsReview')).includes('Bu taslakta değişiklik yok') && await page.locator('#cmsApprove').isDisabled(), 'no change: "Bu taslakta değişiklik yok", approval disabled');
  await page.click('#cmsReject');
  ok(await page.locator('#cmsRejectSend').isDisabled(), 'sending back needs a note');
  await page.fill('#cmsRejectNote', 'Tarihi kontrol edin.');
  await page.click('#cmsRejectSend');
  ok(await waitFor(page, () => location.hash === '#icerik-etkinlikler/onay'), 'back to the queue');
  ok(calls.some((c) => c.path === `/api/cms/drafts/${id2}/reject` && c.body?.note === 'Tarihi kontrol edin.'), 'reject carried the note');
  await page.close();
}

console.log('8) an approval that meets a changed entry offers to send it back');
{
  const id = '00000000-0000-4000-8000-000000000004';
  const { page } = await open(browser, 'approver', `#icerik-etkinlikler/onay/${id}`, { width: 1920, height: 1080 }, (s) => {
    s.drafts.set(id, draftRow({ id, status: 'submitted', entry_id: 'symposium-2026', data: { ...SYM, when: { ...SYM.when, tr: 'x' } }, base_shas: { [PATH]: 'sha-0' } }));
    s.nextApprove = [409, { error: 'changed', code: 'changed_since', paths: [PATH] }];
  });
  await page.waitForSelector('#cmsApprove');
  await page.click('#cmsApprove');
  ok(await waitFor(page, () => /sitede değişti/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'changed_since in plain words');
  ok(await visible(page, '#cmsRejectBox') && (await page.inputValue('#cmsRejectNote')).length > 0, 'the send-back note is ready');
  await page.close();
}

console.log('9) status words in my drafts; a missing deep link');
{
  const { page } = await open(browser, 'editor', '#icerik-etkinlikler/taslaklar', { width: 1440, height: 900 }, (s) => {
    const mk = (n, o) => s.drafts.set(`00000000-0000-4000-8000-00000000010${n}`, draftRow({ id: `00000000-0000-4000-8000-00000000010${n}`, entry_id: `meetup-${n}`, ...o }));
    mk(1, { status: 'rejected', review_note: 'Tarih yanlış' });
    mk(2, { status: 'pr_failed', failure: 'check failed: build' });
    mk(3, { status: 'merged', stale_merge: true });
    mk(4, { status: 'pr_failed', failure: 'merged but the site never showed it' });
    mk(5, { status: 'published', base_shas: { [PATH]: 'x' } });
    mk(6, { status: 'pr_open' });
  });
  ok(await waitFor(page, () => document.querySelectorAll('[data-cms-draft]').length === 6), 'every draft is listed');
  const txt = async (n) => (await page.textContent(`[data-cms-draft="00000000-0000-4000-8000-00000000010${n}"]`)).replace(/\s+/g, ' ');
  ok((await txt(1)).includes('Geri gönderildi: Tarih yanlış') && (await txt(1)).includes('Düzelt ve yeniden gönder'), 'sent back, with the note and "Düzelt ve yeniden gönder"');
  ok((await txt(2)).includes('Yayınlanamadı: Sitenin otomatik kontrolü bu değişikliği kabul etmedi: build') && (await txt(2)).includes('Yeniden dene'), 'a failed check in plain words, with "Yeniden dene"');
  ok((await txt(3)).includes('Birleşti ama site güncellenmedi, yöneticiye haber verin'), 'a late merge');
  ok((await txt(4)).includes('Birleşti ama site güncellenmedi') && !(await txt(4)).includes('Yeniden dene'), 'merged but never live: no resend pushed');
  ok((await txt(5)).includes('Yayında') && (await txt(5)).includes('Siteyi aç'), 'published, with "Siteyi aç"');
  ok((await txt(6)).includes('Yayına çıkıyor, birkaç dakika'), 'going live');
  const first = await page.locator('[data-cms-draft]').first().getAttribute('data-cms-draft');
  ok(['00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000104'].includes(first), 'drafts that need me come first');
  await page.evaluate(() => { location.hash = '#icerik-etkinlikler/taslaklar/00000000-0000-4000-8000-0000000009ff'; });
  ok(await waitFor(page, () => /artık yok veya size ait değil/.test(document.getElementById('cmsNotice')?.textContent ?? '')), 'a missing draft: "Bu taslak artık yok veya size ait değil"');
  ok(await visible(page, '[data-cms-to-drafts]'), 'with a link to Taslaklarım');
  await page.close();
}

console.log('10) a live draft makes its row read-only');
{
  const { page } = await open(browser, 'editor', '#icerik-etkinlikler/etkinlikler', { width: 1440, height: 900 }, (s) => { s.live = [{ type: 'events', entry_id: 'symposium-2026', status: 'pr_open' }]; });
  await page.waitForSelector('[data-cms-entry="symposium-2026"]');
  const t = await page.textContent('[data-cms-entry="symposium-2026"]');
  ok(t.includes('Yayına çıkıyor') && await page.locator('[data-cms-entry="symposium-2026"] [data-cms-edit]').count() === 0, 'no "Düzenle" while it is going live');
  await page.close();
}

console.log('11) phone: no sideways scroll on the list, the form and the review');
for (const [who, hash] of [['editor', '#icerik-etkinlikler/etkinlikler'], ['editor', '#icerik-etkinlikler/etkinlikler/symposium-2026'], ['editor', '#icerik-etkinlikler/webinarlar/_new'], ['approver', '#icerik-etkinlikler/onay/00000000-0000-4000-8000-000000000005']]) {
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
