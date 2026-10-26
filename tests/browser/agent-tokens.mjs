/**
 * The Agent tokens section (#anahtarlar), in a real browser: reached by its
 * own link by a one-section editor who has no menu; create a token,
 * see its value once, reload and it is gone; revoke with the two-click
 * confirm; an admin sees everyone's tokens without e-mail; the help box for
 * Claude and ChatGPT; a connected app sits in its own list and disconnects
 * with the same two clicks; an admin sees the App chip; nothing scrolls
 * sideways at 390 px and nothing scrolls inside at the six desktop sizes.
 *
 * Not part of `npm test`: it needs Playwright and a preview server.
 *
 *   npm run build && npm run preview &
 *   npm i --no-save playwright && npx playwright install chromium
 *   node tests/browser/agent-tokens.mjs
 *
 * CHROME=<path to a Chrome binary> uses that browser instead of Playwright's own.
 *
 * Every /api call is intercepted: no token is created anywhere real.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:4321';
const bad = [];
const ok = (c, m) => { console.log(`   ${c ? '✓' : '✗'} ${m}`); if (!c) bad.push(m); };

const NOW = Math.floor(Date.now() / 1000);
const EDITOR = { id: 'u1', email: 'editor@example.org', grants: [{ role: 'content.etkinlikler.edit', expires_at: null }] };
const ADMIN = { id: 'u9', email: 'admin@example.org', is_admin: true, grants: [{ role: 'admin', expires_at: null }] };
const VALUE = 'rsg_pat_' + 'A'.repeat(39) + 'wxyz';
const LONG = 'A very long token name for the laptop in the lab'.slice(0, 60);

const EMPTY = Object.fromEntries(['users', 'badge_catalog', 'announcements', 'submissions', 'senders', 'attachments', 'sends', 'scheduled',
  'connections', 'rows', 'items', 'issues', 'threads', 'posts', 'plans', 'editors', 'modes', 'certificates',
  'speakers', 'sessions', 'committee', 'editions', 'types', 'entries', 'mine', 'queue', 'live'].map((k) => [k, []]));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});

/** A page whose /api answers come from `state`: the editor's tokens, and (admin) everyone's. */
async function open(path, user, state, viewport = { width: 1280, height: 800 }) {
  const page = await browser.newPage({ viewport });
  page.on('pageerror', (e) => bad.push(`pageerror (${path}): ` + String(e).slice(0, 160)));
  await page.route('**/api/**', async (r) => {
    const req = r.request();
    const url = new URL(req.url());
    const json = (v, status = 200) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(v) });
    if (url.pathname === '/api/me') return json({ user, profile: {} });
    if (url.pathname === '/api/agent-tokens' && req.method() === 'GET') {
      return json({ mine: state.mine, areas: state.areas, ...(user.is_admin ? { all: state.all } : {}) });
    }
    if (url.pathname === '/api/agent-tokens' && req.method() === 'POST') {
      const body = req.postDataJSON();
      state.posts.push(body);
      const token = { id: `t${state.posts.length}`, kind: 'pat', label: body.label, hint: VALUE.slice(-4), scopes: body.scopes, created_at: NOW,
        expires_at: NOW + body.days * 86400, last_used_at: null, revoked_at: null, revoke_reason: null, status: 'live' };
      state.mine.unshift(token);
      return json({ token, value: VALUE }, 201);
    }
    const del = url.pathname.match(/^\/api\/agent-tokens\/([^/]+)$/);
    if (del && req.method() === 'DELETE') {
      state.deletes.push(del[1]);
      for (const list of [state.mine, state.all]) {
        const tok = list.find((x) => x.id === del[1]);
        if (tok) Object.assign(tok, { status: 'revoked', revoked_at: NOW, revoke_reason: user.is_admin && list === state.all ? 'admin' : 'member' });
      }
      return json({ token: state.mine.find((x) => x.id === del[1]) ?? state.all.find((x) => x.id === del[1]) });
    }
    if (req.method() !== 'GET') return r.fulfill({ status: 204, body: '' });
    // Whatever else the panel loads on the way (announcements, health, lists): empty.
    return json(EMPTY);
  });
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForSelector('#adminContent:not(.hidden)');
  return page;
}

const fresh = () => ({ mine: [], all: [], areas: ['cms.etkinlikler'], posts: [], deletes: [] });

console.log('0) a one-section editor still lands in their section, with no menu, and reaches Agent tokens by its link');
for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const state = fresh();
  const page = await open('/admin', EDITOR, state, viewport);
  const at = `${viewport.width}px`;
  await page.waitForFunction(() => location.hash.startsWith('#icerik'), null, { timeout: 8000 }).catch(() => {});
  ok((await page.evaluate(() => location.hash)).startsWith('#icerik'), `${at}: lands in İçerik (got ${await page.evaluate(() => location.hash)})`);
  ok(await page.locator('[data-nav="genel"]').count() === 0, `${at}: no Overview`);
  ok(!(await page.locator('#navToggle').isVisible()) && !(await page.locator('aside:has(#sectionNav)').isVisible()), `${at}: no menu`);
  const link = page.locator('[data-tokens-link]:visible');
  ok(await link.count() === 1, `${at}: one visible Agent tokens link`);
  if (await link.count() === 1) {
    ok((await link.innerText()).trim() === 'Agent tokens', `${at}: it is called Agent tokens`);
    const box = await link.boundingBox();
    if (viewport.width < 1024) ok(box && box.height >= 44, `${at}: a 44 px target (${box && Math.round(box.height)})`);
    await link.click();
    await page.waitForSelector('[data-section="anahtarlar"]:not(.hidden) #tokensAreas [data-area]', { timeout: 8000 }).catch(() => {});
    ok(await page.evaluate(() => location.hash) === '#anahtarlar', `${at}: the link opens #anahtarlar`);
    ok(await page.locator('#tokensAreas [data-area]').count() === 1, `${at}: the section loads`);
    ok(await page.locator('[data-tokens-link]:visible').count() === 0, `${at}: the link hides while Agent tokens is open`);
    const w = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth }));
    ok(w.sw <= w.iw, `${at}: no horizontal scroll (scrollWidth ${w.sw})`);
    await page.goBack();
    await page.waitForFunction(() => location.hash.startsWith('#icerik'), null, { timeout: 8000 }).catch(() => {});
    ok(await page.locator('[data-tokens-link]:visible').count() === 1, `${at}: back in İçerik, the link shows again`);
  }
  await page.close();
}
{
  // An announcer alone has no area a token can reach: no link.
  const page = await open('/admin', { id: 'u5', email: 'ann@example.org', is_announcer: true, grants: [{ role: 'announcer', expires_at: null }] }, fresh());
  ok(await page.locator('[data-tokens-link]').count() === 0, 'an announcer alone has no Agent tokens link');
  await page.close();
}

console.log('1) an editor creates a token: the value shows once, and a reload drops it');
{
  const state = fresh();
  const page = await open('/admin#anahtarlar', EDITOR, state);
  ok(await page.locator('#sectionNav [data-nav="anahtarlar"]').count() === 0, 'one real section: Agent tokens is not in the (hidden) menu');
  await page.waitForSelector('#tokensAreas [data-area]');
  ok(await page.locator('#tokensAreas [data-area]').count() === 1, 'one area row: the one the server says is held');
  ok((await page.locator('[data-section="anahtarlar"]').innerText()).includes('https://rsg-turkiye.iscbsc.org/api/mcp'), 'the intro gives the MCP address');
  ok(await page.locator('#tokensShown').isHidden(), 'no value box before a create');
  await page.fill('#tokensLabel', LONG);
  await page.check('#tokensAreas [data-area="cms.etkinlikler"]');
  await page.selectOption('[data-level-for="cms.etkinlikler"]', 'draft');
  await page.selectOption('#tokensDays', '90');
  await page.click('#tokensSubmit');
  await page.waitForSelector('#tokensShown:not(.hidden)');
  ok(await page.locator('#tokensShownValue').innerText() === VALUE, 'the value is shown');
  // A screen reader hears that a token was made, never the value itself.
  const live = await page.evaluate((v) => [...document.querySelectorAll('[role="status"], [role="alert"], [aria-live]')]
    .filter((el) => el.getAttribute('aria-live') !== 'off').map((el) => el.textContent ?? ''), VALUE);
  ok(!live.some((text) => text.includes(VALUE)), 'the value is in no live region');
  ok(live.some((text) => text.includes('Token created.')), 'a live region says Token created.');
  const sent = state.posts[0] ?? {};
  ok(JSON.stringify(sent) === JSON.stringify({ label: LONG, scopes: ['cms.etkinlikler:draft'], days: 90 }), `the create sends label, scopes and days (${JSON.stringify(sent)})`);
  await page.waitForSelector('#tokensMine [data-token="t1"]');
  const rowText = await page.locator('#tokensMine [data-token="t1"]').innerText();
  ok(rowText.includes('wxyz') && !rowText.includes(VALUE), 'the list shows the last 4 characters, not the value');
  ok(await page.locator('#tokensLabel').inputValue() === '', 'the form is cleared');

  await page.click('#tokensShownDone');
  ok(await page.locator('#tokensShown').isHidden(), '"I have saved it" hides the box');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('#tokensMine [data-token="t1"]');
  ok(await page.locator('#tokensShown').isHidden(), 'after a reload no value box');
  ok(!(await page.content()).includes(VALUE), 'after a reload the value is nowhere in the page');

  console.log('2) revoke takes two clicks');
  const revoke = page.locator('#tokensMine [data-revoke="t1"]');
  const before = await revoke.innerText();
  await revoke.click();
  ok(await revoke.innerText() !== before, 'the first click asks again');
  ok(state.deletes.length === 0, 'the first click sends nothing');
  await revoke.click();
  await page.waitForFunction(() => !document.querySelector('#tokensMine [data-revoke="t1"]'));
  ok(JSON.stringify(state.deletes) === '["t1"]', 'the second click revokes it');
  const revoked = await page.locator('#tokensMine [data-token="t1"]').innerText();
  ok(/Revoked/.test(revoked), 'the row says Revoked');
  await page.close();
}

console.log('3) an admin sees everyone\'s tokens, named without e-mail');
{
  const state = fresh();
  state.areas = ['cms.etkinlikler', 'cms.yazilar', 'cms.ogrenme', 'cms.topluluk', 'cms.sayfalar', 'social'];
  state.all = [
    { id: 'o1', user_id: 'u2', display_name: 'Bir Üye', label: 'Laptop', hint: 'abcd', scopes: ['social:draft'], created_at: NOW, expires_at: NOW + 86400,
      last_used_at: NOW, revoked_at: null, revoke_reason: null, status: 'live' },
    { id: 'o2', user_id: 'u3', display_name: null, label: 'Old', hint: 'efgh', scopes: ['cms.yazilar:read'], created_at: NOW - 900000, expires_at: NOW - 1,
      last_used_at: null, revoked_at: null, revoke_reason: null, status: 'expired' },
  ];
  const page = await open('/tr/admin#anahtarlar', ADMIN, state);
  await page.waitForSelector('#tokensAll [data-token="o1"]');
  ok(await page.locator('#tokensAreas [data-area]').count() === 6, 'an admin may scope every area');
  const all = await page.locator('#tokensAll').innerText();
  ok(all.includes('Bir Üye') && !all.includes('@'), 'owners by name, no e-mail');
  ok(await page.locator('#tokensAll [data-revoke]').count() === 1, 'only the live one can be revoked');
  const btn = page.locator('#tokensAll [data-revoke="o1"]');
  await btn.click(); await btn.click();
  await page.waitForFunction(() => !document.querySelector('#tokensAll [data-revoke="o1"]'));
  ok(JSON.stringify(state.deletes) === '["o1"]', 'an admin revokes another member\'s token');
  ok((await page.locator('h2', { hasText: 'Ajan anahtarları' }).count()) > 0, 'Turkish heading');
  ok(await page.locator('#sectionNav [data-nav="anahtarlar"]').count() === 1, 'an admin\'s menu lists Ajan anahtarları');
  ok(await page.locator('[data-tokens-link]').count() === 0, 'with the menu entry, no separate link');
  await page.close();
}

console.log('4) 390 px: nothing scrolls sideways, with the value box and a long row');
{
  const state = fresh();
  state.mine = [{ id: 'm1', label: 'x'.repeat(60), hint: 'wxyz', scopes: ['cms.etkinlikler:draft'], created_at: NOW, expires_at: NOW + 86400,
    last_used_at: NOW, revoked_at: null, revoke_reason: null, status: 'live' }];
  const page = await open('/admin#anahtarlar', EDITOR, state, { width: 390, height: 844 });
  await page.waitForSelector('#tokensMine [data-token="m1"]');
  await page.fill('#tokensLabel', 'phone');
  await page.check('#tokensAreas [data-area="cms.etkinlikler"]');
  await page.click('#tokensSubmit');
  await page.waitForSelector('#tokensShown:not(.hidden)');
  const w = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth }));
  ok(w.sw <= w.iw, `no horizontal scroll (scrollWidth ${w.sw}, innerWidth ${w.iw})`);
  await page.close();
}

const PAT = { id: 'p1', kind: 'pat', label: 'Laptop', hint: 'wxyz', scopes: ['cms.etkinlikler:draft'], created_at: NOW, expires_at: NOW + 86400,
  last_used_at: NOW, revoked_at: null, revoke_reason: null, status: 'live' };
const APP = { id: 'c1', kind: 'oauth', label: 'Claude (claude.ai)', hint: 'q9Zk', scopes: ['cms.etkinlikler:draft'], created_at: NOW - 3600, expires_at: NOW + 30 * 86400,
  last_used_at: NOW, revoked_at: null, revoke_reason: null, status: 'live' };
const AUTO = { id: 'c2', kind: 'oauth', label: 'ChatGPT', hint: 'r8Yj', scopes: ['cms.etkinlikler:read'], created_at: NOW - 86400, expires_at: NOW + 6 * 86400,
  last_used_at: null, revoked_at: NOW - 60, revoke_reason: 'refresh_reuse', status: 'revoked' };
const withApps = () => ({ ...fresh(), mine: [structuredClone(PAT), structuredClone(APP), structuredClone(AUTO)] });

console.log('5) the help box, and a connected app in its own list with a two-click Disconnect');
{
  const state = withApps();
  const page = await open('/admin#anahtarlar', EDITOR, state);
  await page.waitForSelector('#tokensApps [data-token="c1"]', { timeout: 8000 }).catch(() => {});
  const help = page.locator('#tokensConnect');
  ok(await help.isVisible(), 'the help box is visible');
  const helpText = (await help.count()) ? await help.innerText() : '';
  ok(helpText.includes('Connect Claude') && helpText.includes('Connect ChatGPT'), 'the help box has both headings');
  ok(helpText.includes('https://rsg-turkiye.iscbsc.org/api/mcp'), 'the help box gives the MCP address as text');
  ok(await page.locator('#tokensConnect ol').count() === 2, 'two numbered lists');
  ok(await page.locator('#tokensApps [data-token="c1"]').count() === 1, 'the connection is in Connected apps');
  ok(await page.locator('#tokensMine [data-token="c1"]').count() === 0, 'the connection is not in My tokens');
  ok(await page.locator('#tokensMine [data-token="p1"]').count() === 1 && await page.locator('#tokensApps [data-token="p1"]').count() === 0, 'the personal token stays in My tokens');
  ok((await page.locator('h3', { hasText: 'Connected apps' }).count()) === 1, 'a Connected apps heading');
  const appText = await page.locator('#tokensApps [data-token="c1"]').innerText().catch(() => '');
  ok(appText.includes('Claude (claude.ai)') && /connected /.test(appText) && /ends /.test(appText) && /last used /.test(appText), `the row names the app, when it was connected, ends and was last used (${appText.replace(/\n/g, ' | ')})`);
  ok(!appText.includes('ends in'), 'no hint of a value that rotates every hour');
  ok(/revoked automatically/.test(await page.locator('#tokensApps [data-token="c2"]').innerText().catch(() => '')), 'a connection revoked for refresh reuse says revoked automatically');
  const disc = page.locator('#tokensApps [data-revoke="c1"]');
  ok((await disc.innerText().catch(() => '')).trim() === 'Disconnect', 'the button says Disconnect');
  await disc.click().catch(() => {});
  ok(state.deletes.length === 0, 'the first click sends nothing');
  ok((await disc.innerText().catch(() => '')).trim() !== 'Disconnect', 'the first click asks again');
  await disc.click().catch(() => {});
  await page.waitForFunction(() => !document.querySelector('#tokensApps [data-revoke="c1"]'), null, { timeout: 8000 }).catch(() => {});
  ok(JSON.stringify(state.deletes) === '["c1"]', `the second click sends DELETE /api/agent-tokens/c1 (${JSON.stringify(state.deletes)})`);
  ok(/Revoked/.test(await page.locator('#tokensApps [data-token="c1"]').innerText().catch(() => '')), 'after the refreshed list the row says Revoked');
  await page.close();
}
{
  const state = { ...fresh(), mine: [structuredClone(PAT)] };
  const page = await open('/admin#anahtarlar', EDITOR, state);
  await page.waitForSelector('#tokensMine [data-token="p1"]', { timeout: 8000 }).catch(() => {});
  ok((await page.locator('#tokensApps').innerText().catch(() => '')).includes('No app is connected yet.'), 'no connection: No app is connected yet.');
  await page.close();
}

console.log('5b) a connection label with HTML is shown as text, in both lists');
{
  const evil = '<img src=x onerror="window.__xss=1"><b>Evil</b> (e.example)';
  const state = { ...fresh(), mine: [{ ...structuredClone(APP), id: 'x1', label: evil }], all: [{ ...structuredClone(APP), id: 'x1', label: evil, display_name: '<i>Name</i>' }] };
  for (const user of [EDITOR, ADMIN]) {
    const page = await open('/admin#anahtarlar', user, state);
    for (const list of user.is_admin ? ['#tokensApps', '#tokensAll'] : ['#tokensApps']) {
      await page.waitForSelector(`${list} [data-token="x1"]`, { timeout: 8000 }).catch(() => {});
      const host = page.locator(`${list} [data-token="x1"]`);
      ok((await host.locator('[data-row-title]').innerText().catch(() => '')).includes(evil), `${user.id} ${list}: the label is the visible text, tags and all`);
      ok(await host.locator('img, b, i').count() === 0, `${user.id} ${list}: no element came out of the label or the name`);
    }
    ok(await page.evaluate(() => window.__xss === undefined), `${user.id}: no script ran`);
    await page.close();
  }
}

console.log('6) an admin sees both kinds, with an App chip on the connection');
for (const [path, chipText] of [['/admin#anahtarlar', 'App'], ['/tr/admin#anahtarlar', 'Uygulama']]) {
  const state = fresh();
  state.all = [{ ...structuredClone(PAT), user_id: 'u2', display_name: 'Bir Üye' }, { ...structuredClone(APP), user_id: 'u2', display_name: 'Bir Üye' }];
  const page = await open(path, ADMIN, state);
  await page.waitForSelector('#tokensAll [data-token="c1"]', { timeout: 8000 }).catch(() => {});
  const chips = async (id) => page.locator(`#tokensAll [data-token="${id}"] span`).allInnerTexts().catch(() => []);
  ok((await chips('c1')).some((c) => c.trim() === chipText), `${path}: the connection has the ${chipText} chip`);
  ok(!(await chips('p1')).some((c) => c.trim() === chipText), `${path}: the personal token has none`);
  await page.close();
}

console.log('7) Turkish page');
{
  const page = await open('/tr/admin#anahtarlar', EDITOR, withApps());
  await page.waitForSelector('#tokensApps [data-token="c1"]', { timeout: 8000 }).catch(() => {});
  const text = await page.locator('[data-section="anahtarlar"]').innerText();
  ok(text.includes('Bağlı uygulamalar'), 'Bağlı uygulamalar');
  ok(text.includes("Claude'a bağla"), "Claude'a bağla");
  ok((await page.locator('#tokensApps [data-revoke="c1"]').innerText().catch(() => '')).trim() === 'Bağlantıyı kes', 'Bağlantıyı kes');
  await page.close();
}

console.log('8) no sideways scroll at 390 px, no inner scrollbar at the six desktop sizes');
const SIZES = [[1280, 680], [1366, 768], [1440, 800], [1536, 864], [1440, 900], [1920, 1080], [390, 844]];
for (const path of ['/admin#anahtarlar', '/tr/admin#anahtarlar']) {
  for (const [width, height] of SIZES) {
    const page = await open(path, ADMIN, { ...withApps(), all: [{ ...structuredClone(APP), user_id: 'u2', display_name: 'Bir Üye' }] }, { width, height });
    await page.waitForSelector('#tokensApps [data-token="c1"]', { timeout: 8000 }).catch(() => {});
    const at = `${path} ${width}x${height}`;
    const w = await page.evaluate(() => ({ sw: document.scrollingElement.scrollWidth, iw: innerWidth }));
    ok(w.sw <= w.iw, `${at}: no horizontal scroll (scrollWidth ${w.sw})`);
    // Something that scrolls inside the section other than the panel's own content box is an inner scrollbar.
    const inner = await page.evaluate(() => {
      const section = document.querySelector('[data-section="anahtarlar"]');
      return [section, ...section.querySelectorAll('*')].filter((el) => {
        const s = getComputedStyle(el);
        return (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 1) || (/(auto|scroll)/.test(s.overflowX) && el.scrollWidth > el.clientWidth + 1);
      }).map((el) => el.id || el.tagName);
    });
    ok(inner.length === 0, `${at}: no inner scrollbar (${inner.join(', ')})`);
    await page.close();
  }
}

await browser.close();
if (bad.length) { console.log(`\n${bad.length} failed`); process.exit(1); }
console.log('\nall passed');
