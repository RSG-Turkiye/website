# Social Panel Phase 5: LinkedIn and X Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish scheduled social posts to the RSG LinkedIn Page and the @rsgturkey X account from the same panel and dispatcher that already publish to Instagram.

**Architecture:** The dispatcher stops being Instagram-shaped: it asks a registry for each platform's publish step and a token module for a usable token, and gives every adapter a `checkpoint` to record "a create call is about to go out" before it makes one, so a crash never posts twice. LinkedIn (Community Management API, organisation posts, Images API) and X (API v2, OAuth 2.0 with PKCE, media upload v2) are two new adapters behind that boundary, each with its own connect flow in Connections and its own token upkeep in the existing daily job. A platform that has never been connected is skipped, so LinkedIn can be ticked in the composer while its API approval is pending without holding Instagram posts back.

**Tech Stack:** Cloudflare Pages Functions (TypeScript), D1 (SQLite), R2, `node:test` with `tsx`, the existing token vault (AES-GCM) and OAuth state table.

**Spec:** `docs/superpowers/specs/2026-10-12-social-media-panel-design.md` (§5 dispatcher, §8 phase 5 and 6, §9 handover). This plan extends phase 5 with X, which the spec had put in phase 6; the user asked for both together on 2026-10-14.

## Global Constraints

- The repository is public: no token, secret, client id or account id in code, tests, docs or commit messages. Tests use `example.org` addresses and made-up ids.
- Secrets are Pages secrets (`LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `X_CLIENT_ID`, `X_CLIENT_SECRET`); `LINKEDIN_ORGANIZATION` (the Page's public vanity name) is a `[vars]` entry in `wrangler.toml`.
- No em dash (U+2014) in new code, comments, strings or docs.
- Every UI string exists in both `en` and `tr` in `src/i18n/ui.ts`; `tests/admin-social-i18n.test.ts` enforces this for `admin.social.*`.
- No `text-gray-400` (`tests/contrast.test.ts`).
- Never publish twice: an adapter that cannot tell whether a create call went through must find out before creating again.
- A post's Instagram half must keep behaving exactly as today: every existing test in `tests/social-dispatcher.test.ts` passes, except the one this plan rewrites on purpose (Task 2).
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.
- Run the whole suite with `npm test`; type-check with `npx astro check`.

## Review Focus

1. A tick that dies (or a request that times out) after LinkedIn or X created the post but before the target was written: the next tick must record it as published, not post it again. Tests: Task 3 (LinkedIn recovery read), Task 5 (X duplicate answer), Task 2 (checkpoint survives into the written state).
2. X refresh-token rotation racing between the minute tick and the daily job: the loser must use the winner's token, not mark the connection broken. Test: Task 5.
3. Caption text with LinkedIn's reserved characters (parentheses, underscores and `#` inside URLs, `*` bullets, `@`): it must appear on LinkedIn exactly as typed, with real hashtags still clickable. Test: Task 3.
4. LinkedIn ticked while its API approval is pending (never connected): the target is skipped with a clear reason and the post still ends `published` on the strength of Instagram. Test: Task 2.
5. An X post with more than 4 images, or a caption whose link makes it look longer than X counts it: refused (or accepted) before scheduling, the same way in the composer and on the server. Test: Task 1.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `functions/_lib/social-limits.ts` (modify) | X enabled; `countFor` (X counts a URL as 23); `X_MAX_IMAGES` |
| `functions/_lib/social-posts.ts` (modify) | readiness problem `x_too_many_images` |
| `functions/_lib/social/reasons.ts` (create) | `PUBLISH_REASON_KEYS`, shared by all adapters and the panel |
| `functions/_lib/social/instagram-errors.ts` (modify) | re-exports `PUBLISH_REASON_KEYS` from `reasons.ts` |
| `functions/_lib/social/types.ts` (modify) | `PublishInput`, `PublishStepFn`, `media[].load` |
| `functions/_lib/social/registry.ts` (create) | platform to publish step, labels, skip-when-unconnected |
| `functions/_lib/social/tokens.ts` (create) | `usableToken`: a usable token per platform, refresh on use |
| `functions/_lib/connections.ts` (modify) | per-platform requeue; expiry ignores access expiry when a refresh token exists |
| `functions/_lib/social-dispatcher.ts` (rewrite) | platform-neutral tick |
| `functions/_lib/social-notify.ts` (modify) | platform name in texts; `connection_expiring` |
| `functions/_lib/social/linkedin.ts` (create) | LinkedIn OAuth, organisation lookup, little text, publish step |
| `functions/_lib/social/x.ts` (create) | X OAuth with PKCE, refresh on use, publish step |
| `functions/api/admin/connections/linkedin/{start,callback}.ts` (create) | connect LinkedIn |
| `functions/api/admin/connections/x/{start,callback}.ts` (create) | connect X |
| `functions/api/admin/social/refresh-tokens.ts` (modify) | daily: Instagram, LinkedIn refresh or reminders, X keep-alive |
| `functions/_lib/auth.ts` (modify) | new `Env` fields |
| `src/scripts/admin-connections.ts` (modify) | LinkedIn and X connect buttons |
| `src/scripts/admin-panel.ts` (modify) | new connection error codes |
| `src/scripts/social/{composer,plan-dialog,messages,side-panel,preview}.ts` (modify) | X selectable, X count, X preview, per-platform error sentences |
| `src/i18n/ui.ts` (modify) | strings |
| `tests/lib/http.ts` (create) | generic fetch stub for LinkedIn and X hosts |
| `README.md` (modify) | setup, costs, yearly upkeep |

---

### Task 1: Platform rules and per-platform wording

**Files:**
- Create: `functions/_lib/social/reasons.ts`
- Modify: `functions/_lib/social/instagram-errors.ts`, `functions/_lib/social-limits.ts`, `functions/_lib/social-posts.ts`, `src/scripts/social/messages.ts`, `src/scripts/social/side-panel.ts`, `src/scripts/social/composer.ts`, `src/scripts/social/plan-dialog.ts`, `src/i18n/ui.ts`, `tests/admin-social-i18n.test.ts`
- Test: `tests/social-platform-rules.test.ts`

**Interfaces:**
- Produces: `PUBLISH_REASON_KEYS` (in `functions/_lib/social/reasons.ts`, now including `duplicate`, `uncertain`, `no_api_access`, `not_connected`); `countFor(platform: SocialPlatform, text: string): number`; `X_MAX_IMAGES = 4`; `X_URL_LENGTH = 23`; `ENABLED_PLATFORMS` equals `ALL_PLATFORMS`; problem code `x_too_many_images`; `publishErrorText(lastError: string | null, platform: Platform): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/social-platform-rules.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countFor, captionProblems, ENABLED_PLATFORMS, ALL_PLATFORMS, X_MAX_IMAGES } from '../functions/_lib/social-limits';
import { readinessProblems } from '../functions/_lib/social-posts';
import { PUBLISH_REASON_KEYS } from '../functions/_lib/social/reasons';
import { PUBLISH_REASON_KEYS as FROM_INSTAGRAM } from '../functions/_lib/social/instagram-errors';

const KEY = (n: number) => `${String(n).padStart(8, '0')}-1111-4111-8111-111111111111.jpg`;
const dims = (n: number) => new Map(Array.from({ length: n }, (_, i) => [KEY(i), { width: 1080, height: 1350 }]));
const post = (platforms: ('instagram' | 'linkedin' | 'x')[], images: number, caption = 'Merhaba') => ({
  type: (images > 1 ? 'carousel' : 'image') as 'carousel' | 'image',
  caption, captionOverrides: {}, link: null, platforms,
  media: Array.from({ length: images }, (_, i) => ({ key: KEY(i), alt: `Alt ${i}` })),
  scheduledAt: 2_000_000_000,
});

test('X is offered like the others', () => {
  assert.deepEqual(ENABLED_PLATFORMS, ALL_PLATFORMS);
});

test('X counts every link as 23 characters, whatever its length', () => {
  const long = `https://rsg-turkiye.iscbsc.org/${'a'.repeat(200)}`;
  assert.equal(countFor('x', `Kayıt açık ${long}`), 'Kayıt açık '.length + 23);
  assert.equal(countFor('x', 'http://a.co'), 23);
  assert.equal(countFor('linkedin', `x ${long}`), 2 + long.length, 'other platforms count the link as written');
});

test('a caption that fits X once its link is weighted is not refused', () => {
  const link = `https://rsg-turkiye.iscbsc.org/${'a'.repeat(300)}`;
  const src = { caption: 'a'.repeat(250), captionOverrides: {}, link };
  assert.deepEqual(captionProblems(src, ['x'], 'image'), [], '250 + 2 newlines + 23 = 275');
  const over = { caption: 'a'.repeat(260), captionOverrides: {}, link };
  assert.equal(captionProblems(over, ['x'], 'image')[0]?.code, 'caption_too_long');
});

test('X takes at most four images; the other platforms are not limited by it', () => {
  const p = readinessProblems(post(['instagram', 'x'], 5), dims(5), 1_900_000_000);
  assert.deepEqual(p.filter((x) => x.code === 'x_too_many_images'), [{ code: 'x_too_many_images', platform: 'x', limit: X_MAX_IMAGES, actual: 5 }]);
  assert.equal(readinessProblems(post(['x'], 4), dims(4), 1_900_000_000).some((x) => x.code === 'x_too_many_images'), false);
  assert.equal(readinessProblems(post(['instagram', 'linkedin'], 5), dims(5), 1_900_000_000).some((x) => x.code === 'x_too_many_images'), false);
});

test('one list of publish reasons, shared by every adapter', () => {
  assert.equal(FROM_INSTAGRAM, PUBLISH_REASON_KEYS);
  for (const k of ['duplicate', 'uncertain', 'no_api_access', 'not_connected']) assert.ok((PUBLISH_REASON_KEYS as readonly string[]).includes(k), k);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/social-platform-rules.test.ts`
Expected: FAIL (`countFor` / `reasons.ts` do not exist).

- [ ] **Step 3: Implement**

Create `functions/_lib/social/reasons.ts`:

```ts
/**
 * Every "<key>: <detail>" an adapter may write to a target's last_error. The
 * panel turns the key into a sentence (admin.social.publishError.<key>) with
 * the platform's name filled in, so one list serves Instagram, LinkedIn and X.
 */
export const PUBLISH_REASON_KEYS = [
  'auth', 'needs_business', 'image_too_large', 'image_format', 'bad_ratio', 'caption_rejected', 'carousel_count',
  'account_restricted', 'spam', 'media_unreachable', 'rate_limited', 'daily_limit', 'expired', 'container_error',
  'unavailable', 'not_available', 'unknown', 'processing',
  'duplicate', 'uncertain', 'no_api_access', 'not_connected',
] as const;
export type PublishReasonKey = (typeof PUBLISH_REASON_KEYS)[number];
```

In `functions/_lib/social/instagram-errors.ts`, replace the `PUBLISH_REASON_KEYS` declaration (the `/** Keys the panel turns into a sentence ... */` comment and the array) with:

```ts
import { PUBLISH_REASON_KEYS } from './reasons';
export { PUBLISH_REASON_KEYS };
```

(put the `import` next to the existing `import type { PublishStep } from './types';`). `reasonKey`'s return type `(typeof PUBLISH_REASON_KEYS)[number]` keeps working.

In `functions/_lib/social-limits.ts`:

```ts
// replace the ENABLED_PLATFORMS line and its comment
export const ENABLED_PLATFORMS: SocialPlatform[] = ALL_PLATFORMS;
```

Add below `MAX_ALT_LENGTH`:

```ts
/** X takes up to four photos in one post. */
export const X_MAX_IMAGES = 4;
/** X shortens every link to t.co and counts it as 23 characters, however long it is. */
export const X_URL_LENGTH = 23;
const URL_PATTERN = /https?:\/\/\S+/g;

/** Characters as the platform counts them: countChars, except that X weighs each link as X_URL_LENGTH. */
export function countFor(platform: SocialPlatform, text: string): number {
  if (platform !== 'x') return countChars(text);
  return countChars(text.replace(URL_PATTERN, 'x'.repeat(X_URL_LENGTH)));
}
```

In `captionProblems`, change `const chars = countChars(text);` to `const chars = countFor(platform, text);`.

In `functions/_lib/social-posts.ts`, add `X_MAX_IMAGES` to the import from `./social-limits`, and in `readinessProblems` directly after the `media_count` check:

```ts
  if (post.platforms.includes('x') && n > X_MAX_IMAGES) problems.push({ code: 'x_too_many_images', platform: 'x', limit: X_MAX_IMAGES, actual: n });
```

In `src/scripts/social/messages.ts`:
- change the import to `import { PUBLISH_REASON_KEYS } from '../../../functions/_lib/social/reasons';`
- add `'x_too_many_images'` to `PROBLEM_CODES` (after `'too_many_hashtags'`)
- replace `publishErrorText` with:

```ts
export function publishErrorText(lastError: string | null, platform: Platform): string {
  if (!lastError) return '';
  const { t, tf } = deps();
  const { key } = splitPublishError(lastError);
  const known = (PUBLISH_REASON_KEYS as readonly string[]).includes(key) ? key : 'unknown';
  return tf(`admin.social.publishError.${known}`, { platform: t(`admin.connections.platform.${platform}`) });
}
```

and add `Platform` to the type import from `./api` (`import { ApiError, type Problem, type Post, type Platform } from './api';`).

In `src/scripts/social/side-panel.ts` line 92, call `publishErrorText(x.lastError, x.platform)`.

In `tests/admin-social-i18n.test.ts` change the import to `import { PUBLISH_REASON_KEYS } from '../functions/_lib/social/reasons';`.

In `src/scripts/social/composer.ts`:
- import `countFor` instead of `countChars` from social-limits (keep the others).
- replace the platforms row (the `${ENABLED_PLATFORMS.map(...)}` line and the disabled `xLater` label after it) with:

```ts
            ${ENABLED_PLATFORMS.map((p) => `<label><input type="checkbox" data-platform="${p}" ${dis} ${state.platforms.includes(p) ? 'checked' : ''}> ${esc(t(`admin.connections.platform.${p}`))}</label>`).join('')}
```

- `const OVERRIDE_ORDER: Platform[] = ['instagram', 'linkedin', 'x'];`
- in `renderCounts`, `const chars = countFor(p, text);`

In `src/scripts/social/plan-dialog.ts`: `const PLATFORMS: Platform[] = ['instagram', 'linkedin', 'x'];`

In `src/i18n/ui.ts`, delete `admin.social.composer.linkedinLater` and `admin.social.composer.xLater` in both languages, add the problem sentence, and replace every `admin.social.publishError.*` line in both languages with the blocks below (English block replaces lines `'admin.social.publishError.auth'` through `'admin.social.publishError.processing'`, Turkish likewise):

```ts
    'admin.social.problem.x_too_many_images': 'X takes at most {limit} images; this post has {actual}.',
```

```ts
    'admin.social.problem.x_too_many_images': 'X en fazla {limit} görsel kabul ediyor; bu gönderide {actual} var.',
```

English:

```ts
    'admin.social.publishError.auth': 'The {platform} connection no longer works. An admin has to reconnect it.',
    'admin.social.publishError.needs_business': 'Instagram publishes stories through the API only for Business accounts. Switch the account to Business.',
    'admin.social.publishError.image_too_large': 'An image is larger than {platform} accepts.',
    'admin.social.publishError.image_format': '{platform} did not accept the image format.',
    'admin.social.publishError.bad_ratio': 'An image has a shape {platform} does not accept. Crop it and retry.',
    'admin.social.publishError.caption_rejected': '{platform} refused the text (too long, or too many hashtags or mentions).',
    'admin.social.publishError.carousel_count': 'A carousel needs 2 to 10 images.',
    'admin.social.publishError.account_restricted': 'The {platform} account is restricted. Check it in the app.',
    'admin.social.publishError.spam': '{platform} flagged this post as spam.',
    'admin.social.publishError.media_unreachable': 'An image could not be read for {platform}.',
    'admin.social.publishError.rate_limited': '{platform} asked to slow down; it was retried for two hours.',
    'admin.social.publishError.daily_limit': 'The account reached {platform}\'s daily publishing limit.',
    'admin.social.publishError.expired': 'Instagram\'s copy of the post expired before it went out.',
    'admin.social.publishError.container_error': 'Instagram could not process the post.',
    'admin.social.publishError.unavailable': '{platform} was not reachable for two hours.',
    'admin.social.publishError.not_available': 'Publishing to this platform is not available yet.',
    'admin.social.publishError.unknown': '{platform} refused the post.',
    'admin.social.publishError.processing': '{platform} was still processing the post after two hours, so it was stopped.',
    'admin.social.publishError.duplicate': '{platform} refused the post because the same text was already posted. Change the text and retry.',
    'admin.social.publishError.uncertain': 'It is not known whether this went out on {platform}. Check the account before retrying.',
    'admin.social.publishError.no_api_access': '{platform} refused the site\'s app (no API credits, or access not granted). See the README.',
    'admin.social.publishError.not_connected': '{platform} is not connected, so this platform was skipped.',
```

Turkish:

```ts
    'admin.social.publishError.auth': '{platform} bağlantısı artık çalışmıyor. Bir admin yeniden bağlamalı.',
    'admin.social.publishError.needs_business': "Instagram, API üzerinden story'yi yalnızca İşletme hesaplarında yayınlıyor. Hesabı İşletme'ye geçir.",
    'admin.social.publishError.image_too_large': 'Bir görsel {platform} için fazla büyük.',
    'admin.social.publishError.image_format': '{platform} görsel biçimini kabul etmedi.',
    'admin.social.publishError.bad_ratio': 'Bir görselin oranını {platform} kabul etmiyor. Kırp ve yeniden dene.',
    'admin.social.publishError.caption_rejected': '{platform} metni reddetti (çok uzun ya da çok fazla hashtag veya etiket).',
    'admin.social.publishError.carousel_count': 'Carousel için 2 ile 10 arası görsel gerekir.',
    'admin.social.publishError.account_restricted': '{platform} hesabı kısıtlanmış. Uygulamadan kontrol et.',
    'admin.social.publishError.spam': '{platform} bu gönderiyi spam olarak işaretledi.',
    'admin.social.publishError.media_unreachable': '{platform} için bir görsel okunamadı.',
    'admin.social.publishError.rate_limited': '{platform} yavaşlamamızı istedi; iki saat boyunca yeniden denendi.',
    'admin.social.publishError.daily_limit': 'Hesap {platform} günlük yayın sınırına ulaştı.',
    'admin.social.publishError.expired': "Gönderinin Instagram'daki kopyası yayınlanmadan süresi doldu.",
    'admin.social.publishError.container_error': 'Instagram gönderiyi işleyemedi.',
    'admin.social.publishError.unavailable': '{platform} iki saat boyunca ulaşılamadı.',
    'admin.social.publishError.not_available': 'Bu platforma yayın henüz yok.',
    'admin.social.publishError.unknown': '{platform} gönderiyi reddetti.',
    'admin.social.publishError.processing': '{platform} iki saat sonra hâlâ gönderiyi işliyordu; durduruldu.',
    'admin.social.publishError.duplicate': '{platform} aynı metin daha önce paylaşıldığı için gönderiyi reddetti. Metni değiştirip yeniden dene.',
    'admin.social.publishError.uncertain': "Bunun {platform}'da yayınlanıp yayınlanmadığı bilinmiyor. Yeniden denemeden önce hesaba bak.",
    'admin.social.publishError.no_api_access': "{platform} sitenin uygulamasını reddetti (API kredisi yok ya da erişim verilmemiş). README'ye bak.",
    'admin.social.publishError.not_connected': '{platform} bağlı değil, bu platform atlandı.',
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/social-platform-rules.test.ts tests/admin-social-i18n.test.ts tests/social-limits.test.ts tests/social-posts.test.ts tests/social-publish-error.test.ts`
Expected: PASS. If `tests/social-publish-error.test.ts` calls `publishErrorText` with one argument, pass `'instagram'` as the second and expect the same Instagram sentences (the `{platform}` placeholder fills in "Instagram").
Then `npm test` and `npx astro check`: all pass, 0 errors.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/social/reasons.ts functions/_lib/social/instagram-errors.ts functions/_lib/social-limits.ts functions/_lib/social-posts.ts src/scripts/social/messages.ts src/scripts/social/side-panel.ts src/scripts/social/composer.ts src/scripts/social/plan-dialog.ts src/i18n/ui.ts tests/admin-social-i18n.test.ts tests/social-platform-rules.test.ts tests/social-publish-error.test.ts
git commit -m "Social: X selectable, X character and image rules, per-platform publish sentences"
```

---

### Task 2: Adapter boundary and a platform-neutral dispatcher

**Files:**
- Create: `functions/_lib/social/registry.ts`, `functions/_lib/social/tokens.ts`
- Modify: `functions/_lib/social/types.ts`, `functions/_lib/connections.ts`, `functions/_lib/social-notify.ts`, `functions/api/admin/connections/instagram/callback.ts`, `functions/api/admin/social/refresh-tokens.ts`
- Rewrite: `functions/_lib/social-dispatcher.ts`
- Test: `tests/social-dispatcher.test.ts` (rewrite one test, add three), `tests/connections.test.ts` (add one)

**Interfaces:**
- Consumes: `PLATFORM` labels from Task 1 i18n are not used server-side; server uses `PLATFORM_LABEL`.
- Produces:
  - `types.ts`: `PostForPlatform.media[]` gains `load?: () => Promise<Uint8Array | null>`; `interface PublishInput { account: { id: string; name: string | null }; token: string; post: PostForPlatform; state: TargetState; now: number; checkpoint: (containerId: string) => Promise<boolean> }`; `type PublishStepFn = (input: PublishInput) => Promise<PublishStep>`.
  - `registry.ts`: `PLATFORM_LABEL: Record<SocialPlatform, string>`, `SKIP_WHEN_UNCONNECTED: ReadonlySet<SocialPlatform>`, `PUBLISHERS: Partial<Record<SocialPlatform, PublishStepFn>>` (Tasks 3 and 5 add entries).
  - `tokens.ts`: `type Usable`, `REFRESH_ON_USE: Partial<Record<SocialPlatform, { within: number; refresh: Refresher }>>`, `usableToken(env, platform, now): Promise<Usable>`.
  - `connections.ts`: `requeueWaitingStatement(db: D1Database, platform: SocialPlatform)`.
  - `social-notify.ts`: `notificationText` ctx gains `platform?: string` (default `'Instagram'`); new kind `'connection_expiring'`.

- [ ] **Step 1: Write the failing tests**

In `tests/social-dispatcher.test.ts`, replace the test `'LinkedIn is skipped until phase 5; the Instagram half still makes the post published'` with the first test below, and add the other three at the end of the file:

```ts
// LinkedIn gets its real publisher in Task 3; until then these tests stand one in, so they test the dispatcher alone.
async function withLinkedinPublisher<T>(run: () => Promise<T>): Promise<T> {
  const { PUBLISHERS } = await import('../functions/_lib/social/registry');
  const before = PUBLISHERS.linkedin;
  PUBLISHERS.linkedin = async () => ({ kind: 'fail', reason: 'unknown: the stand-in publisher must not be reached' });
  try { return await run(); } finally { PUBLISHERS.linkedin = before; }
}

test('a platform never connected (LinkedIn awaiting approval) is skipped; Instagram alone makes the post published', async () => {
  const { env, db } = world({ platforms: ['instagram', 'linkedin'] });
  await connect(env);
  const g = stubGraph(graphFlow(['FINISHED']));
  try {
    await withLinkedinPublisher(async () => {
      await dispatchSocial(env, T0 + 30, ORIGIN);
      await dispatchSocial(env, T0 + 90, ORIGIN);
    });
  } finally { g.restore(); }
  const li = db.prepare(`SELECT status, last_error FROM social_post_targets WHERE platform = 'linkedin'`).get() as { status: string; last_error: string };
  assert.equal(li.status, 'skipped');
  assert.match(li.last_error, /^not_connected: LinkedIn/);
  assert.equal(postStatus(db), 'published');
});

test('a connected platform whose connection broke waits; Instagram is not held by it', async () => {
  const { env, db } = world({ platforms: ['instagram', 'linkedin'] });
  await connect(env);
  const li = await connectionUpsert(env as never, 'linkedin', {
    accountId: '1234', accountName: 'RSG', accessToken: 'li-tok', refreshToken: null, scopes: 'x', expiresAt: T0 + 50 * 86400, refreshExpiresAt: null,
  }, 'admin', T0 - 86400);
  await li.run();
  db.prepare(`UPDATE platform_connections SET last_error = 'revoked', last_error_at = ? WHERE platform = 'linkedin'`).run(T0);
  const g = stubGraph(graphFlow(['FINISHED']));
  try {
    await withLinkedinPublisher(async () => {
      await dispatchSocial(env, T0 + 30, ORIGIN);
      await dispatchSocial(env, T0 + 90, ORIGIN);
    });
  } finally { g.restore(); }
  assert.equal((db.prepare(`SELECT status FROM social_post_targets WHERE platform = 'linkedin'`).get() as { status: string }).status, 'waiting_connection');
  assert.equal(target(db).status, 'published');
  assert.equal(postStatus(db), 'scheduled', 'the post settles when LinkedIn does');
});

test('an adapter checkpoint is written under the lease and survives into the target written after the step', async () => {
  const { PUBLISHERS } = await import('../functions/_lib/social/registry');
  const before = PUBLISHERS.instagram;
  const seen: string[] = [];
  PUBLISHERS.instagram = async (i) => {
    seen.push(String(await i.checkpoint('{"attempt":1}')));
    return { kind: 'retry', reason: 'unavailable: lost response' };
  };
  const { env, db } = world();
  await connect(env);
  try { await dispatchSocial(env, T0 + 30, ORIGIN); } finally { PUBLISHERS.instagram = before; }
  assert.deepEqual(seen, ['true']);
  assert.equal(target(db).container_id, '{"attempt":1}', 'a retry keeps what the checkpoint recorded');
});

test('a waiting target of one platform is healed only by that platform\'s working connection', async () => {
  const { env, db } = world({ platforms: ['instagram', 'linkedin'] });
  await connect(env);
  db.prepare(`UPDATE social_post_targets SET status = 'waiting_connection'`).run();
  db.prepare(`UPDATE social_posts SET scheduled_at = ?`).run(T0 + 3600);
  await dispatchSocial(env, T0 + 30, ORIGIN);
  const rows = db.prepare(`SELECT platform, status FROM social_post_targets ORDER BY platform`).all() as { platform: string; status: string }[];
  assert.deepEqual(rows.map((r) => [r.platform, r.status]), [['instagram', 'queued'], ['linkedin', 'waiting_connection']]);
});
```

In `tests/connections.test.ts` add (adjust the import line to include `connectionStatus` if it is not already imported):

```ts
test('with a refresh token and no known refresh expiry, a short-lived access token does not make the connection look broken', () => {
  const row = {
    platform: 'x', account_id: '1', account_name: 'rsg', access_token_enc: 'a', refresh_token_enc: 'r', scopes: '',
    expires_at: 1000, refresh_expires_at: null, connected_by: 'admin', connected_at: 1, last_ok_at: 1, last_error: null, last_error_at: null,
  } as const;
  assert.equal(connectionStatus(row as never, 5000), 'connected');
  assert.equal(connectionStatus({ ...row, refresh_token_enc: null } as never, 5000), 'broken', 'without one, the access expiry is the expiry');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/social-dispatcher.test.ts tests/connections.test.ts`
Expected: FAIL (registry missing; LinkedIn skipped with the old reason; X-shaped row reads as broken).

- [ ] **Step 3: Implement**

`functions/_lib/social/types.ts`, replace `PostForPlatform` and add the input types at the end:

```ts
export interface PostForPlatform {
  type: 'image' | 'carousel' | 'story';
  caption: string;
  /** url: public address (Instagram fetches it). load: the bytes from R2 (LinkedIn and X upload them). */
  media: { key: string; url: string; alt: string; load?: () => Promise<Uint8Array | null> }[];
}

export interface TargetState { containerId: string | null }

export interface PublishInput {
  account: { id: string; name: string | null };
  token: string;
  post: PostForPlatform;
  state: TargetState;
  now: number;
  /**
   * Records containerId on the target now, under this tick's lease, before
   * the adapter makes a call that creates something. True when written; false
   * when the lease was lost (make no further calls then). A step that follows
   * a successful checkpoint is applied on top of it, so a retry keeps it.
   */
  checkpoint: (containerId: string) => Promise<boolean>;
}

export type PublishStepFn = (input: PublishInput) => Promise<PublishStep>;
```

Create `functions/_lib/social/registry.ts`:

```ts
/**
 * Which publish step serves which platform. The dispatcher knows nothing
 * else about a platform; swapping LinkedIn's backend (for Buffer, say) is a
 * change to one entry here.
 */
import type { SocialPlatform } from '../social-limits';
import type { PublishStepFn } from './types';
import { instagramPublishStep } from './instagram';

export const PLATFORM_LABEL: Record<SocialPlatform, string> = { instagram: 'Instagram', linkedin: 'LinkedIn', x: 'X' };

/**
 * Never connected means skipped, not waiting: LinkedIn can be ticked while
 * its API access is still being approved without holding the post's
 * Instagram half in "scheduled". Instagram is the main channel and waits.
 */
export const SKIP_WHEN_UNCONNECTED: ReadonlySet<SocialPlatform> = new Set(['linkedin', 'x']);

export const PUBLISHERS: Partial<Record<SocialPlatform, PublishStepFn>> = {
  instagram: (i) => instagramPublishStep({ igUserId: i.account.id, token: i.token, post: i.post, state: i.state }),
};
```

Create `functions/_lib/social/tokens.ts`:

```ts
/**
 * A token the dispatcher can publish with, per platform. Instagram and
 * LinkedIn keep a long-lived access token (renewed by the daily job); X's
 * lasts two hours and is renewed here, at the moment it is needed (Task 5
 * registers that in REFRESH_ON_USE).
 */
import type { ConnectionRow } from '../connections';
import { getConnection, connectionStatus, readAccessToken } from '../connections';
import type { SocialPlatform } from '../social-limits';

export type TokenEnv = { DB: D1Database; TOKEN_ENC_KEY?: string; X_CLIENT_ID?: string; X_CLIENT_SECRET?: string };

export type Usable =
  | { ok: true; token: string; account: { id: string; name: string | null } }
  /** unused: never connected. broken: needs a reconnect (justBroke: this call found out). unreadable: stored token cannot be opened. */
  | { ok: false; why: 'unused' | 'unreadable' }
  | { ok: false; why: 'broken'; justBroke?: boolean; reason?: string }
  /** The provider could not be reached to renew the token; try again next tick. */
  | { ok: false; why: 'transient'; reason: string };

export type Refresher = (env: TokenEnv, row: ConnectionRow, now: number) => Promise<Usable>;

export const REFRESH_ON_USE: Partial<Record<SocialPlatform, { within: number; refresh: Refresher }>> = {};

export async function usableToken(env: TokenEnv, platform: SocialPlatform, now: number): Promise<Usable> {
  const row = await getConnection(env.DB, platform);
  const status = connectionStatus(row, now);
  if (status === 'unused') return { ok: false, why: 'unused' };
  if (status === 'broken' || !row?.account_id) return { ok: false, why: 'broken' };
  const r = REFRESH_ON_USE[platform];
  if (r && (row.expires_at === null || row.expires_at - now <= r.within)) return r.refresh(env, row, now);
  const token = await readAccessToken(env, row);
  if (!token) return { ok: false, why: 'unreadable' };
  return { ok: true, token, account: { id: row.account_id, name: row.account_name } };
}
```

`functions/_lib/connections.ts`:

```ts
// in connectionStatus, replace the `const expiry = ...` line:
  // A refresh token with no known end keeps the connection alive past each
  // short access token (X: two hours; Gmail): only a refresh failure breaks it.
  const expiry = row?.refresh_expires_at ?? (row?.refresh_token_enc ? null : row?.expires_at ?? null);
```

```ts
// replace requeueWaitingStatement and its comment's first sentence:
/**
 * Puts every target of one platform that was waiting for a working
 * connection back in the queue, with a clean retry clock (a long wait must
 * not make its first transient error fatal) and no confirmation (a target
 * that waited days is held by the lateness rule again unless a publisher
 * confirms it). Used by a reconnect, a token refresh, and each tick that
 * finds the platform's token usable.
 */
export function requeueWaitingStatement(db: D1Database, platform: Exclude<Platform, 'gmail'>): D1PreparedStatement {
  return db.prepare(
    `UPDATE social_post_targets SET status = 'queued', claimed_at = NULL, first_tried_at = NULL, attempts = 0, last_error = NULL, confirmed_at = NULL
      WHERE platform = ? AND status = 'waiting_connection'`,
  ).bind(platform);
}
```

Update its two other callers: `functions/api/admin/connections/instagram/callback.ts` (`requeueWaitingStatement(env.DB, 'instagram')`) and `functions/api/admin/social/refresh-tokens.ts` (`requeueWaitingStatement(env.DB, 'instagram')`).

`functions/_lib/social-notify.ts`:
- `export type NotifyKind = ... | 'connection_broken' | 'connection_expiring';`
- ctx type gains `platform?: string`; at the top of `notificationText` add `const p = ctx.platform ?? 'Instagram';`
- in `publish_failed`, `waiting_connection` and `connection_broken`, replace every literal `Instagram` with `${p}` (Turkish: `${p}'da`, `${p} bağlantısı`; keep the sentence shapes), so `connection_broken` becomes:

```ts
    case 'connection_broken':
      return {
        subject: `${p} bağlantısı koptu / ${p} connection broken`,
        text: `${p} bağlantısı artık çalışmıyor. Neden:${note}\n\nBağlantılar sekmesinden yeniden bağla; bekleyen gönderiler sıraya döner: ${ctx.panelUrl}\n\n---\n\nThe ${p} connection no longer works. Reason:${note}\n\nReconnect it in Connections; waiting posts are queued again: ${ctx.panelUrl}`,
      };
    case 'connection_expiring':
      return {
        subject: `${p} bağlantısının süresi doluyor / ${p} connection expiring`,
        text: `${p} bağlantısının süresi ${ctx.note ?? ''} gün içinde doluyor ve kendiliğinden yenilenemiyor. Süre dolmadan Bağlantılar sekmesinden yeniden bağla: ${ctx.panelUrl}\n\n---\n\nThe ${p} connection expires in ${ctx.note ?? ''} days and cannot renew itself. Reconnect it in Connections before then: ${ctx.panelUrl}`,
      };
```

`publish_failed` English: `could not be published to ${p}`; Turkish: `${p}'da yayınlanamadı` (an apostrophe suffix reads fine for Instagram, LinkedIn and X). `waiting_connection`: `${p} bağlantısı çalışmıyor` / `the ${p} connection is not working`.

Rewrite `functions/_lib/social-dispatcher.ts`:

```ts
/**
 * One social dispatch tick (spec §5), called every minute by
 * workers/mail-cron through /api/social/dispatch. Claims due targets with a
 * lease, runs one adapter step each, writes the result through the pure
 * transition in social-dispatch.ts, and keeps the post's status in step with
 * its targets. Every change is audited as the system (userId null). Nothing
 * here is specific to a platform: social/registry.ts names the publish step,
 * social/tokens.ts the token.
 */
import type { Env } from './auth';
import { markOk, markBroken, requeueWaitingStatement } from './connections';
import { rowToDraft, type PostRow } from './social-posts';
import { captionFor, type SocialPlatform } from './social-limits';
import { afterStep, derivePostStatus, isLate, CLAIM_LEASE_SECONDS, type TargetNow, type TargetStatus } from './social-dispatch';
import { PUBLISHERS, PLATFORM_LABEL, SKIP_WHEN_UNCONNECTED } from './social/registry';
import { usableToken, type Usable } from './social/tokens';
import { appendAudit } from './audit';
import { notificationText, notifyEach, publisherEmails, adminEmails, postLabel, type NotifyKind } from './social-notify';

export const TICK_BATCH = 2;
export { CLAIM_LEASE_SECONDS };

type Due = PostRow & {
  target_status: TargetStatus; platform: SocialPlatform; attempts: number; first_tried_at: number | null; container_id: string | null;
  remote_id: string | null; permalink: string | null; published_at: number | null; last_error: string | null; confirmed_at: number | null;
  author_email: string | null; plan_title: string | null;
};

async function loadMedia(env: Env, key: string): Promise<Uint8Array | null> {
  const object = await env.BLOG_IMAGES.get(key);
  return object ? new Uint8Array(await object.arrayBuffer()) : null;
}

export async function dispatchSocial(env: Env, now: number, origin: string) {
  const db = env.DB;
  const summary = { candidates: 0, claimed: 0, published: 0, failed: 0, waiting: 0 };
  const panelUrl = `${origin}/admin`;
  const brokenMail = (platform: SocialPlatform, note: string) =>
    notificationText('connection_broken', { label: '', when: null, note, panelUrl, platform: PLATFORM_LABEL[platform] });

  // A token is read once per platform per tick; an auth failure replaces it, so the rest of the batch waits instead of failing the same way.
  const tokens = new Map<SocialPlatform, Usable>();
  const tokenFor = async (platform: SocialPlatform): Promise<Usable> => {
    const cached = tokens.get(platform);
    if (cached) return cached;
    const u = await usableToken(env, platform, now);
    if (!u.ok && u.why === 'unreadable') {
      await markBroken(db, platform, 'stored token unreadable', now);
      await notifyEach(env, await adminEmails(db), brokenMail(platform, 'stored token unreadable'));
    }
    if (!u.ok && u.why === 'broken' && u.justBroke) await notifyEach(env, await adminEmails(db), brokenMail(platform, u.reason ?? ''));
    tokens.set(platform, u);
    return u;
  };
  // Read now, as before this was platform-neutral: an unreadable Instagram token is reported even on a tick with nothing due.
  await tokenFor('instagram');

  // A target can be left waiting with its connection working again (a tick
  // that wrote waiting_connection just after a reconnect re-queued): put it
  // back, exactly as a reconnect would. This runs before the due query, since
  // waiting targets are not due and a tick with none due would never get here.
  const waiting = (await db.prepare(`SELECT DISTINCT platform FROM social_post_targets WHERE status = 'waiting_connection'`).all<{ platform: SocialPlatform }>()).results;
  for (const { platform } of waiting) {
    if (!(await tokenFor(platform)).ok) continue;
    const healed = await requeueWaitingStatement(db, platform).run();
    if (healed.meta.changes > 0) {
      await appendAudit(db, { userId: null, action: 'social.target.requeued', targetType: 'connection', targetId: platform, details: { targets: healed.meta.changes } }, now);
    }
  }

  // Fewest attempts first: a target retrying a transient error must not starve newer due posts.
  const due = (await db.prepare(
    `SELECT p.*, t.platform, t.status AS target_status, t.attempts, t.first_tried_at, t.container_id, t.remote_id, t.permalink,
            t.published_at, t.last_error, t.confirmed_at, u.email AS author_email, pl.title AS plan_title
       FROM social_post_targets t
       JOIN social_posts p ON p.id = t.post_id
       LEFT JOIN users u ON u.id = p.created_by
       LEFT JOIN social_plans pl ON pl.post_id = p.id
      WHERE t.status IN ('queued','publishing') AND p.status = 'scheduled' AND p.scheduled_at <= ?
        AND (t.claimed_at IS NULL OR t.claimed_at <= ?)
      ORDER BY t.attempts, p.scheduled_at
      LIMIT ?`,
  ).bind(now, now - CLAIM_LEASE_SECONDS, TICK_BATCH).all<Due>()).results;
  summary.candidates = due.length;

  // A tick that died between a target's write and its post's settle leaves a post 'scheduled' with every target settled; no claim would ever touch it again.
  const orphans = (await db.prepare(
    `SELECT p.id FROM social_posts p
      WHERE p.status = 'scheduled'
        AND EXISTS (SELECT 1 FROM social_post_targets t WHERE t.post_id = p.id)
        AND NOT EXISTS (SELECT 1 FROM social_post_targets t WHERE t.post_id = p.id AND t.status IN ('queued','publishing','waiting_connection','needs_confirmation'))
      LIMIT 10`,
  ).all<{ id: string }>()).results;
  for (const o of orphans) await settlePost(db, o.id, now);
  if (due.length === 0) return summary;

  for (const row of due) {
    const claim = await db.prepare(
      `UPDATE social_post_targets SET claimed_at = ?
        WHERE post_id = ? AND platform = ? AND status IN ('queued','publishing') AND (claimed_at IS NULL OR claimed_at <= ?)
          AND status = ? AND container_id IS ?`,
    ).bind(now, row.id, row.platform, now - CLAIM_LEASE_SECONDS, row.target_status, row.container_id).run();
    if (claim.meta.changes !== 1) continue;
    summary.claimed++;

    const platform = row.platform;
    const name = PLATFORM_LABEL[platform];
    const t: TargetNow = {
      status: row.target_status, attempts: row.attempts, first_tried_at: row.first_tried_at, container_id: row.container_id,
      remote_id: row.remote_id, permalink: row.permalink, published_at: row.published_at, last_error: row.last_error,
    };
    const label = postLabel(row.caption, row.plan_title);
    const tell = async (kind: NotifyKind, to: string[], note?: string) =>
      notifyEach(env, to, notificationText(kind, { label, when: row.scheduled_at, note, panelUrl, platform: name }));
    const settleAs = async (next: TargetNow, action: string, details: Record<string, unknown> = {}) => {
      if (!await write(db, row, next, now)) return false;
      await settlePost(db, row.id, now);
      await appendAudit(db, { userId: null, action, targetType: 'social_post', targetId: row.id, details: { platform, ...details } }, now);
      return true;
    };

    const publish = PUBLISHERS[platform];
    if (!publish) {
      await settleAs({ ...t, status: 'skipped', last_error: 'not_available: no adapter yet' }, 'social.target.skipped');
      continue;
    }
    const usable = await tokenFor(platform);
    if (!usable.ok && usable.why === 'unused' && SKIP_WHEN_UNCONNECTED.has(platform)) {
      await settleAs({ ...t, status: 'skipped', last_error: `not_connected: ${name} is not connected` }, 'social.target.skipped', { reason: 'not_connected' });
      continue;
    }
    // Queued with no attempt in its current run (a transient retry has already started and runs out its own window) and more than two hours late: a person decides (spec §5, lateness rule).
    // A container kept from before a wait does not exempt it: reconnect, refresh and requeue all reset first_tried_at, and a held target keeps its container for the status read after confirmation.
    if (row.target_status === 'queued' && row.first_tried_at === null && isLate(row.scheduled_at!, now, row.confirmed_at)) {
      if (!await settleAs({ ...t, status: 'needs_confirmation' }, 'social.target.late', { scheduledAt: row.scheduled_at })) continue;
      await tell('needs_confirmation', await publisherEmails(db));
      continue;
    }
    if (!usable.ok && usable.why === 'transient') {
      const tr = afterStep({ kind: 'retry', reason: usable.reason }, t, now);
      if (!await write(db, row, tr.next, now)) continue;
      await settlePost(db, row.id, now);
      if (tr.audit) await appendAudit(db, { userId: null, action: tr.audit, targetType: 'social_post', targetId: row.id, details: { platform, status: tr.next.status, reason: tr.next.last_error } }, now);
      if (tr.next.status === 'failed') { summary.failed++; await tell('publish_failed', [row.author_email ?? '', ...await publisherEmails(db)], tr.next.last_error ?? ''); }
      continue;
    }
    if (!usable.ok) {
      if (!await settleAs({ ...t, status: 'waiting_connection', last_error: `auth: no working ${name} connection` }, 'social.target.waiting')) continue;
      await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
      summary.waiting++;
      continue;
    }

    const d = rowToDraft(row);
    const step = await publish({
      account: usable.account, token: usable.token, now,
      post: {
        type: d.type, caption: captionFor(d, platform),
        media: d.media.map((m) => ({ key: m.key, alt: m.alt, url: `${env.PUBLIC_BLOG_IMAGES_URL}/${m.key}`, load: () => loadMedia(env, m.key) })),
      },
      state: { containerId: t.container_id },
      checkpoint: async (containerId) => {
        const res = await db.prepare(
          'UPDATE social_post_targets SET container_id = ? WHERE post_id = ? AND platform = ? AND claimed_at = ?',
        ).bind(containerId, row.id, row.platform, now).run();
        if (res.meta.changes !== 1) return false;
        t.container_id = containerId;
        return true;
      },
    });
    const tr = afterStep(step, t, now);
    // Lost the lease (the step outlived it and another tick took over): that tick owns the target now; record nothing.
    if (!await write(db, row, tr.next, now)) continue;
    await settlePost(db, row.id, now);
    if (tr.audit) {
      await appendAudit(db, {
        userId: null, action: tr.audit, targetType: 'social_post', targetId: row.id,
        details: { platform, status: tr.next.status, reason: tr.next.last_error, remoteId: tr.next.remote_id, notes: 'notes' in step ? step.notes : undefined },
      }, now);
    }
    if (step.kind === 'done') { summary.published++; await markOk(db, platform, now); }
    if (tr.next.status === 'failed') summary.failed++;
    if (step.kind === 'auth') {
      summary.waiting++;
      await markBroken(db, platform, step.reason, now);
      tokens.set(platform, { ok: false, why: 'broken' });
      // usable.ok was true, so the connection was not broken before this step.
      await tell('connection_broken', await adminEmails(db), step.reason);
    }
    if (tr.notify === 'failed') await tell('publish_failed', [row.author_email ?? '', ...await publisherEmails(db)], tr.next.last_error ?? '');
    if (tr.notify === 'waiting_connection') await tell('waiting_connection', [row.author_email ?? '', ...await publisherEmails(db)]);
  }
  return summary;
}
```

Keep `write` and `settlePost` exactly as they are below it. Note the audit for `social.target.skipped` and `.late` and `.waiting` keeps `details.platform`, as before; `.late` keeps `scheduledAt`.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/social-dispatcher.test.ts tests/connections.test.ts tests/social-requeue-refresh.test.ts tests/social-notify.test.ts tests/instagram-connect.test.ts`
Expected: PASS. Every pre-existing dispatcher test passes unchanged. If one asserts the exact audit `details` of a skipped target, it now also carries `reason`: update only that assertion.
Then `npm test` and `npx astro check`.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/social functions/_lib/connections.ts functions/_lib/social-notify.ts functions/_lib/social-dispatcher.ts functions/api/admin/connections/instagram/callback.ts functions/api/admin/social/refresh-tokens.ts tests/social-dispatcher.test.ts tests/connections.test.ts
git commit -m "Social dispatcher: platform registry, token module, checkpoint before create; unconnected platforms skipped"
```

---

### Task 3: LinkedIn adapter

**Files:**
- Create: `functions/_lib/social/linkedin.ts`, `tests/lib/http.ts`, `tests/linkedin-publish.test.ts`
- Modify: `functions/_lib/social/registry.ts`, `functions/_lib/auth.ts`

**Interfaces:**
- Consumes: `PublishInput`, `PublishStep`, `PublishStepFn` (Task 2).
- Produces (all in `linkedin.ts`): `LI_API`, `LI_VERSION`, `LI_SCOPES`, `linkedinRedirectUri(base)`, `linkedinAuthUrl(env, base, state)`, `exchangeLinkedinCode(env, base, code)`, `refreshLinkedinToken(env, refreshToken)`, `findAdminOrganization(token, vanityName)`, `toLittleText(text)`, `linkedinPublishStep(input)`; `tests/lib/http.ts`: `stubHttp(hosts, handler)` and `type HttpCall`.
- `Env` gains `LINKEDIN_CLIENT_ID?`, `LINKEDIN_CLIENT_SECRET?`, `LINKEDIN_ORGANIZATION?`, `X_CLIENT_ID?`, `X_CLIENT_SECRET?`.

- [ ] **Step 1: Write the test helper and the failing tests**

Create `tests/lib/http.ts`:

```ts
/** Stubs the given hosts and passes every other URL to the fetch installed before. JSON bodies are parsed, form bodies become URLSearchParams, anything else (FormData, bytes) is kept as sent. */
export type HttpCall = { method: string; url: URL; headers: Headers; body: unknown };

export function stubHttp(hosts: string[], handler: (c: HttpCall) => Response | undefined) {
  const calls: HttpCall[] = [];
  const before = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(String(req ? req.url : input));
    if (!hosts.includes(url.host)) return before(input, init);
    let body: unknown = init?.body ?? null;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = new URLSearchParams(body); }
    }
    const c: HttpCall = { method: (init?.method ?? req?.method ?? 'GET').toUpperCase(), url, headers: new Headers(init?.headers ?? req?.headers), body };
    calls.push(c);
    const res = handler(c);
    if (!res) throw new Error(`unexpected call ${c.method} ${url.href}`);
    return res;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = before; } };
}
```

Create `tests/linkedin-publish.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubHttp, type HttpCall } from './lib/http';
import { linkedinPublishStep, toLittleText, findAdminOrganization, LI_VERSION } from '../functions/_lib/social/linkedin';
import type { PostForPlatform, PublishInput } from '../functions/_lib/social/types';

const HOSTS = ['api.linkedin.com', 'www.linkedin.com', 'upload.example.org'];
const ORG = '424242';
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const img = (n: number) => ({ key: `k${n}.jpg`, url: `https://rsg-turkiye.iscbsc.org/api/images/k${n}.jpg`, alt: `Alt ${n}`, load: async () => bytes });
const single: PostForPlatform = { type: 'image', caption: 'Kayıt açık (son gün 1 Kasım) #bioinformatics', media: [img(1)] };
const multi: PostForPlatform = { type: 'carousel', caption: 'İki görsel', media: [img(1), img(2)] };

function input(post: PostForPlatform, containerId: string | null, checkpoints: string[] = []): PublishInput {
  return {
    account: { id: ORG, name: 'RSG' }, token: 'li-tok', post, state: { containerId }, now: 1_800_000_000,
    checkpoint: async (c) => { checkpoints.push(c); return true; },
  };
}
const state = (images: string[], attempt: number | null) => JSON.stringify({ li: 1, images, attempt });

async function run(h: (c: HttpCall) => Response | undefined, i: PublishInput) {
  const s = stubHttp(HOSTS, h);
  try { return { result: await linkedinPublishStep(i), calls: s.calls }; } finally { s.restore(); }
}

const uploads = (c: HttpCall) => {
  if (c.method === 'POST' && c.url.pathname === '/rest/images' && c.url.searchParams.get('action') === 'initializeUpload') {
    const n = Math.floor(Math.random() * 1e9);
    return Response.json({ value: { uploadUrl: `https://upload.example.org/u/${n}`, image: `urn:li:image:I${n}` } });
  }
  if (c.method === 'PUT' && c.url.host === 'upload.example.org') return new Response(null, { status: 201 });
  return undefined;
};

test('little text: reserved characters are escaped, real hashtags stay hashtags, a # inside a link does not', () => {
  assert.equal(toLittleText('Kayıt (son gün) @rsg *önemli* a_b ~x~ [1] <a> {b} | \\'),
    'Kayıt \\(son gün\\) \\@rsg \\*önemli\\* a\\_b \\~x\\~ \\[1\\] \\<a\\> \\{b\\} \\| \\\\');
  assert.equal(toLittleText('#biyoinformatik ve #bio_info'), '{hashtag|\\#|biyoinformatik} ve {hashtag|\\#|bio\\_info}');
  assert.equal(toLittleText('https://x.org/a_b#bölüm'), 'https://x.org/a\\_b\\#bölüm');
});

test('first tick uploads each image to LinkedIn as the organisation and waits', async () => {
  const { result, calls } = await run(uploads, input(multi, null));
  assert.equal(result.kind, 'pending');
  const st = JSON.parse((result as { containerId: string }).containerId);
  assert.equal(st.li, 1);
  assert.equal(st.attempt, null);
  assert.equal(st.images.length, 2);
  const inits = calls.filter((c) => c.method === 'POST');
  assert.equal(inits.length, 2);
  assert.deepEqual(inits[0].body, { initializeUploadRequest: { owner: `urn:li:organization:${ORG}` } });
  assert.equal(inits[0].headers.get('Linkedin-Version'), LI_VERSION);
  assert.equal(inits[0].headers.get('X-Restli-Protocol-Version'), '2.0.0');
  assert.equal(inits[0].headers.get('Authorization'), 'Bearer li-tok');
  const puts = calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.equal(puts[0].headers.get('Authorization'), 'Bearer li-tok');
});

test('an image still processing waits; once available the post is checkpointed, then created with alt text', async () => {
  const st = state(['urn:li:image:A'], null);
  let available = false;
  const handler = (c: HttpCall) => {
    if (c.method === 'GET' && c.url.pathname === '/rest/images') return Response.json({ results: { 'urn:li:image:A': { status: available ? 'AVAILABLE' : 'PROCESSING' } } });
    if (c.method === 'POST' && c.url.pathname === '/rest/posts') return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:99' } });
    return undefined;
  };
  const first = await run(handler, input(single, st));
  assert.deepEqual(first.result, { kind: 'pending', containerId: st });
  available = true;
  const cps: string[] = [];
  const second = await run(handler, input(single, st, cps));
  assert.deepEqual(second.result, { kind: 'done', remoteId: 'urn:li:share:99', permalink: 'https://www.linkedin.com/feed/update/urn:li:share:99/' });
  assert.equal(JSON.parse(cps[0]).attempt, 1_800_000_000, 'the attempt is recorded before the create call');
  const created = second.calls.find((c) => c.url.pathname === '/rest/posts')!;
  assert.deepEqual(created.body, {
    author: `urn:li:organization:${ORG}`,
    commentary: 'Kayıt açık \\(son gün 1 Kasım\\) {hashtag|\\#|bioinformatics}',
    visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    content: { media: { id: 'urn:li:image:A', altText: 'Alt 1' } },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  });
});

test('several images go out as a multiImage post, each with its alt text', async () => {
  const st = state(['urn:li:image:A', 'urn:li:image:B'], null);
  const { result, calls } = await run((c) => {
    if (c.method === 'GET') return Response.json({ results: { 'urn:li:image:A': { status: 'AVAILABLE' }, 'urn:li:image:B': { status: 'AVAILABLE' } } });
    if (c.url.pathname === '/rest/posts') return new Response(null, { status: 201, headers: { 'x-restli-id': 'urn:li:share:7' } });
    return undefined;
  }, input(multi, st));
  assert.equal(result.kind, 'done');
  const body = calls.find((c) => c.url.pathname === '/rest/posts')!.body as { content: unknown };
  assert.deepEqual(body.content, { multiImage: { images: [{ id: 'urn:li:image:A', altText: 'Alt 1' }, { id: 'urn:li:image:B', altText: 'Alt 2' }] } });
});

test('a lost response after the create call: the next tick finds the post by its image and records it, without posting again', async () => {
  const st = state(['urn:li:image:A'], 1_800_000_000);
  const { result, calls } = await run((c) => {
    if (c.method === 'GET' && c.url.pathname === '/rest/posts') {
      assert.equal(c.url.searchParams.get('q'), 'author');
      assert.equal(c.url.searchParams.get('author'), `urn:li:organization:${ORG}`);
      return Response.json({ elements: [{ id: 'urn:li:share:5', content: { media: { id: 'urn:li:image:OTHER' } } }, { id: 'urn:li:share:6', content: { media: { id: 'urn:li:image:A' } } }] });
    }
    return undefined;
  }, input(single, st));
  assert.deepEqual(result, { kind: 'done', remoteId: 'urn:li:share:6', permalink: 'https://www.linkedin.com/feed/update/urn:li:share:6/', notes: ['recovered_published'] });
  assert.equal(calls.some((c) => c.method === 'POST'), false);
});

test('a lost response, and the post is not there: the attempt is cleared so the next tick creates it', async () => {
  const st = state(['urn:li:image:A'], 1_800_000_000);
  const { result } = await run((c) => (c.method === 'GET' && c.url.pathname === '/rest/posts' ? Response.json({ elements: [] }) : undefined), input(single, st));
  assert.deepEqual(result, { kind: 'pending', containerId: state(['urn:li:image:A'], null) });
});

test('a create call that never answered is retried later with the attempt kept', async () => {
  const st = state(['urn:li:image:A'], null);
  const { result } = await run((c) => {
    if (c.method === 'GET') return Response.json({ results: { 'urn:li:image:A': { status: 'AVAILABLE' } } });
    if (c.url.pathname === '/rest/posts') return new Response('upstream', { status: 503 });
    return undefined;
  }, input(single, st));
  assert.equal(result.kind, 'retry');
  assert.match((result as { reason: string }).reason, /^unavailable: /);
});

test('LinkedIn refusing the post outright: failed, and the images are let go so the post can be edited', async () => {
  const st = state(['urn:li:image:A'], null);
  const { result } = await run((c) => {
    if (c.method === 'GET') return Response.json({ results: { 'urn:li:image:A': { status: 'AVAILABLE' } } });
    if (c.url.pathname === '/rest/posts') return Response.json({ message: 'FIELD_LENGTH_TOO_LONG commentary', status: 400 }, { status: 400 });
    return undefined;
  }, input(single, st));
  assert.deepEqual(result, { kind: 'fail', reason: 'caption_rejected: FIELD_LENGTH_TOO_LONG commentary', clearContainer: true });
});

test('a revoked token or a lost page role is an auth problem; a processing failure is a content one', async () => {
  const r401 = await run(() => Response.json({ message: 'Invalid access token' }, { status: 401 }), input(single, null));
  assert.equal(r401.result.kind, 'auth');
  const failed = await run((c) => (c.method === 'GET' ? Response.json({ results: { 'urn:li:image:A': { status: 'PROCESSING_FAILED' } } }) : undefined), input(single, state(['urn:li:image:A'], null)));
  assert.deepEqual(failed.result, { kind: 'fail', reason: 'image_format: LinkedIn could not process an image', clearContainer: true });
});

test('an image that cannot be read from storage is retried, not published without it', async () => {
  const post: PostForPlatform = { ...single, media: [{ ...img(1), load: async () => null }] };
  const { result } = await run(uploads, input(post, null));
  assert.equal(result.kind, 'retry');
  assert.match((result as { reason: string }).reason, /^media_unreachable: /);
});

test('the organisation is found among the pages the member administers, by its public name', async () => {
  const s = stubHttp(HOSTS, (c) => {
    if (c.url.pathname === '/rest/organizationAcls') return Response.json({ elements: [{ organization: 'urn:li:organization:1', state: 'APPROVED' }, { organizationTarget: `urn:li:organization:${ORG}`, state: 'APPROVED' }] });
    if (c.url.pathname === '/rest/organizations/1') return Response.json({ vanityName: 'other-club', localizedName: 'Other' });
    if (c.url.pathname === `/rest/organizations/${ORG}`) return Response.json({ vanityName: 'RSGTurkey', localizedName: 'ISCB-SC RSG-Türkiye' });
    return undefined;
  });
  try {
    assert.deepEqual(await findAdminOrganization('tok', 'rsgturkey'), { ok: true, id: ORG, name: 'ISCB-SC RSG-Türkiye' });
    assert.deepEqual(await findAdminOrganization('tok', 'somebody-else'), { ok: false, reason: 'not_admin', status: 200 });
  } finally { s.restore(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/linkedin-publish.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

In `functions/_lib/auth.ts` `Env`, after `INSTAGRAM_APP_SECRET`:

```ts
  /** LinkedIn app (developer.linkedin.com, Community Management API). Pages secrets. */
  LINKEDIN_CLIENT_ID?: string;
  LINKEDIN_CLIENT_SECRET?: string;
  /** The Page's public vanity name (linkedin.com/company/<this>); a [vars] entry. */
  LINKEDIN_ORGANIZATION?: string;
  /** X app (console.x.com, OAuth 2.0, confidential client). Pages secrets. */
  X_CLIENT_ID?: string;
  X_CLIENT_SECRET?: string;
```

Create `functions/_lib/social/linkedin.ts`:

```ts
/**
 * LinkedIn Community Management API: connecting a member who administers the
 * RSG Page, keeping the token alive, and publishing as the organisation
 * (Posts API with images from the Images API).
 *
 * LINKEDIN-VERSION: LinkedIn retires each monthly version about a year after
 * release. Bump LI_VERSION once a year (README, "Yearly upkeep").
 */
import type { Env } from '../auth';
import type { PublishInput, PublishStep } from './types';

export const LI_API = 'https://api.linkedin.com/rest';
export const LI_VERSION = '202609';
export const LI_SCOPES = ['w_organization_social', 'r_organization_social', 'rw_organization_admin'];

type App = Pick<Env, 'LINKEDIN_CLIENT_ID' | 'LINKEDIN_CLIENT_SECRET'>;

export const linkedinRedirectUri = (base: string) => `${base}/api/admin/connections/linkedin/callback`;

export function linkedinAuthUrl(env: App, base: string, state: string): string {
  const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.LINKEDIN_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', linkedinRedirectUri(base));
  u.searchParams.set('state', state);
  u.searchParams.set('scope', LI_SCOPES.join(' '));
  return u.toString();
}

const headers = (token: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${token}`, 'Linkedin-Version': LI_VERSION, 'X-Restli-Protocol-Version': '2.0.0', ...extra,
});

async function json(res: Response): Promise<Record<string, unknown> | null> {
  return res.json().then((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)).catch(() => null);
}

type TokenOk = { ok: true; accessToken: string; expiresIn: number; refreshToken: string | null; refreshExpiresIn: number | null; scopes: string[] };

async function tokenCall(params: Record<string, string>): Promise<TokenOk | { ok: false; status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString(),
    });
  } catch { return { ok: false, status: 0, body: null }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') return { ok: false, status: res.status, body };
  return {
    ok: true, accessToken: body.access_token, expiresIn: Number(body.expires_in) || 60 * 86400,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    refreshExpiresIn: typeof body.refresh_token_expires_in === 'number' ? body.refresh_token_expires_in : null,
    scopes: typeof body.scope === 'string' ? body.scope.split(/[ ,]+/).filter(Boolean) : [],
  };
}

export async function exchangeLinkedinCode(env: App, base: string, code: string): Promise<TokenOk | { ok: false; status: number }> {
  const r = await tokenCall({
    grant_type: 'authorization_code', code, redirect_uri: linkedinRedirectUri(base),
    client_id: env.LINKEDIN_CLIENT_ID ?? '', client_secret: env.LINKEDIN_CLIENT_SECRET ?? '',
  });
  return r.ok ? r : { ok: false, status: r.status };
}

/** Only apps approved for programmatic refresh tokens get one; the refresh token keeps its original expiry. */
export async function refreshLinkedinToken(env: App, refreshToken: string):
  Promise<TokenOk | { ok: false; status: number; auth: boolean; reason: string }> {
  const r = await tokenCall({
    grant_type: 'refresh_token', refresh_token: refreshToken, client_id: env.LINKEDIN_CLIENT_ID ?? '', client_secret: env.LINKEDIN_CLIENT_SECRET ?? '',
  });
  if (r.ok) return r;
  const reason = String(r.body?.error_description ?? r.body?.error ?? `HTTP ${r.status}`).slice(0, 200);
  return { ok: false, status: r.status, auth: r.status === 400 || r.status === 401, reason };
}

/** The Page the member administers whose vanity name is `vanityName` (case-insensitive). */
export async function findAdminOrganization(token: string, vanityName: string):
  Promise<{ ok: true; id: string; name: string } | { ok: false; reason: 'not_admin' | 'lookup_failed'; status: number }> {
  let res: Response;
  try {
    res = await fetch(`${LI_API}/organizationAcls?q=roleAssignee&role=ADMINISTRATOR&state=APPROVED&count=100`, { headers: headers(token) });
  } catch { return { ok: false, reason: 'lookup_failed', status: 0 }; }
  const body = await json(res);
  if (!res.ok || !Array.isArray(body?.elements)) return { ok: false, reason: 'lookup_failed', status: res.status };
  const ids = (body!.elements as Record<string, unknown>[])
    .map((e) => String(e.organization ?? e.organizationTarget ?? ''))
    .map((urn) => /^urn:li:organization:(\d+)$/.exec(urn)?.[1])
    .filter((id): id is string => Boolean(id));
  for (const id of ids) {
    let org: Response;
    try { org = await fetch(`${LI_API}/organizations/${id}`, { headers: headers(token) }); } catch { return { ok: false, reason: 'lookup_failed', status: 0 }; }
    const o = await json(org);
    if (!org.ok) return { ok: false, reason: 'lookup_failed', status: org.status };
    if (String(o?.vanityName ?? '').toLowerCase() === vanityName.toLowerCase()) return { ok: true, id, name: String(o?.localizedName ?? vanityName) };
  }
  return { ok: false, reason: 'not_admin', status: res.status };
}

const RESERVED = /[|{}@[\]()<>#\\*_~]/g;
const escapeLittle = (s: string) => s.replace(RESERVED, (c) => `\\${c}`);

/**
 * Commentary is LinkedIn's "little" format: every reserved character is
 * escaped so the text appears as typed. A hashtag (a # at the start or after
 * whitespace, then letters, digits or _) becomes the hashtag template so it
 * stays clickable; a # anywhere else (inside a link) is plain text.
 */
export function toLittleText(text: string): string {
  let out = '';
  let last = 0;
  for (const m of text.matchAll(/(^|\s)#([\p{L}\p{N}_]+)/gu)) {
    const start = m.index! + m[1].length;
    out += escapeLittle(text.slice(last, start)) + `{hashtag|\\#|${escapeLittle(m[2])}}`;
    last = start + 1 + m[2].length;
  }
  return out + escapeLittle(text.slice(last));
}

interface LiState { li: 1; images: string[]; attempt: number | null }
const encodeState = (s: LiState) => JSON.stringify({ li: 1, images: s.images, attempt: s.attempt });
function decodeState(raw: string | null): LiState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as LiState;
    return v && v.li === 1 && Array.isArray(v.images) ? { li: 1, images: v.images.map(String), attempt: typeof v.attempt === 'number' ? v.attempt : null } : null;
  } catch { return null; }
}

const message = (body: Record<string, unknown> | null, status: number) => String(body?.message ?? `HTTP ${status}`).slice(0, 250);

/**
 * What a non-2xx answer means. `sent` is true for the create call: a timeout
 * or 5xx there may still have created the post, so it is retried with the
 * attempt kept and the next tick looks before creating again.
 */
function fromFailure(status: number, body: Record<string, unknown> | null): PublishStep {
  const m = message(body, status);
  if (status === 401 || status === 403) return { kind: 'auth', reason: `auth: ${m}` };
  if (status === 429) return { kind: 'retry', reason: `rate_limited: ${m}` };
  if (status === 0 || status >= 500 || status === 409) return { kind: 'retry', reason: `unavailable: ${m}` };
  if (/FIELD_LENGTH_TOO_LONG/.test(m)) return { kind: 'fail', reason: `caption_rejected: ${m}`, clearContainer: true };
  return { kind: 'fail', reason: `unknown: ${m}`, clearContainer: true };
}

async function call(url: string, init: RequestInit): Promise<{ res: Response | null; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, init);
    return { res, body: await json(res.clone()) };
  } catch { return { res: null, body: null }; }
}

const permalink = (urn: string) => `https://www.linkedin.com/feed/update/${urn}/`;
const usesImage = (post: Record<string, unknown>, image: string) => {
  const content = post.content as { media?: { id?: string }; multiImage?: { images?: { id?: string }[] } } | undefined;
  return content?.media?.id === image || Boolean(content?.multiImage?.images?.some((i) => i.id === image));
};

/**
 * One step for one target. Tick 1 uploads the images (pending). Later ticks
 * wait until every image is AVAILABLE, record the attempt with checkpoint,
 * and create the post. A tick that finds an attempt already recorded did not
 * see that create call answer: it reads the Page's recent posts and records
 * the one using this post's first image, or clears the attempt and lets the
 * next tick create it.
 */
export async function linkedinPublishStep(input: PublishInput): Promise<PublishStep> {
  const { account, token, post, now, checkpoint } = input;
  const org = `urn:li:organization:${account.id}`;
  const st = decodeState(input.state.containerId);
  if (input.state.containerId && !st) return { kind: 'fail', reason: 'unknown: unreadable LinkedIn state', clearContainer: true };
  if (post.type === 'story') return { kind: 'fail', reason: 'not_available: LinkedIn has no stories' };
  if (post.media.length === 0) return { kind: 'fail', reason: 'unknown: post has no images' };

  if (!st) {
    const images: string[] = [];
    for (const m of post.media) {
      const data = m.load ? await m.load() : null;
      if (!data) return { kind: 'retry', reason: `media_unreachable: ${m.key}` };
      const init = await call(`${LI_API}/images?action=initializeUpload`, {
        method: 'POST', headers: headers(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ initializeUploadRequest: { owner: org } }),
      });
      if (!init.res?.ok) return fromFailure(init.res?.status ?? 0, init.body);
      const value = init.body?.value as { uploadUrl?: string; image?: string } | undefined;
      if (!value?.uploadUrl || !value.image) return { kind: 'retry', reason: 'unavailable: upload without url' };
      const put = await call(value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' }, body: data });
      if (!put.res?.ok) return fromFailure(put.res?.status ?? 0, put.body);
      images.push(value.image);
    }
    return { kind: 'pending', containerId: encodeState({ li: 1, images, attempt: null }) };
  }

  if (st.attempt !== null) {
    const q = new URLSearchParams({ q: 'author', author: org, count: '20', sortBy: 'CREATED', viewContext: 'AUTHOR' });
    const found = await call(`${LI_API}/posts?${q}`, { headers: headers(token, { 'X-RestLi-Method': 'FINDER' }) });
    if (!found.res?.ok || !Array.isArray(found.body?.elements)) return fromFailure(found.res?.status ?? 0, found.body);
    const mine = (found.body!.elements as Record<string, unknown>[]).find((p) => usesImage(p, st.images[0]));
    if (mine && typeof mine.id === 'string') return { kind: 'done', remoteId: mine.id, permalink: permalink(mine.id), notes: ['recovered_published'] };
    return { kind: 'pending', containerId: encodeState({ ...st, attempt: null }) };
  }

  const ids = st.images.map(encodeURIComponent).join(',');
  // The Posts docs require BATCH_GET for ids=List(...); the Images sample omits it. Sending it is harmless either way.
  const status = await call(`${LI_API}/images?ids=List(${ids})`, { headers: headers(token, { 'X-RestLi-Method': 'BATCH_GET' }) });
  if (!status.res?.ok) return fromFailure(status.res?.status ?? 0, status.body);
  const results = (status.body?.results ?? {}) as Record<string, { status?: string }>;
  const states = st.images.map((id) => results[id]?.status);
  if (states.includes('PROCESSING_FAILED')) return { kind: 'fail', reason: 'image_format: LinkedIn could not process an image', clearContainer: true };
  if (!states.every((s) => s === 'AVAILABLE')) return { kind: 'pending', containerId: input.state.containerId! };

  if (!await checkpoint(encodeState({ ...st, attempt: now }))) return { kind: 'pending', containerId: input.state.containerId! };
  const content = st.images.length === 1
    ? { media: { id: st.images[0], altText: post.media[0].alt } }
    : { multiImage: { images: st.images.map((id, i) => ({ id, altText: post.media[i]?.alt ?? '' })) } };
  const created = await call(`${LI_API}/posts`, {
    method: 'POST', headers: headers(token, { 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      author: org, commentary: toLittleText(post.caption), visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    }),
  });
  if (created.res?.status === 201) {
    const urn = created.res.headers.get('x-restli-id');
    return urn ? { kind: 'done', remoteId: urn, permalink: permalink(urn) } : { kind: 'done', remoteId: null, permalink: null };
  }
  return fromFailure(created.res?.status ?? 0, created.body);
}
```

Note: a `fail` returned here before the create call (`fromFailure` from the upload or status read) also sets `clearContainer`, which is right: nothing was posted.

In `functions/_lib/social/registry.ts` add the import and entry:

```ts
import { linkedinPublishStep } from './linkedin';
// in PUBLISHERS:
  linkedin: linkedinPublishStep,
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/linkedin-publish.test.ts`
Expected: PASS. Then `npm test` (the Task 2 test "a platform never connected ... is skipped" still passes: LinkedIn now has a publisher but no connection) and `npx astro check`.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/social/linkedin.ts functions/_lib/social/registry.ts functions/_lib/auth.ts tests/lib/http.ts tests/linkedin-publish.test.ts
git commit -m "Social: LinkedIn adapter (organisation posts with images and alt text, little text, crash recovery by image)"
```

---

### Task 4: Connect LinkedIn, keep it alive, show it in Connections

**Files:**
- Create: `functions/api/admin/connections/linkedin/start.ts`, `functions/api/admin/connections/linkedin/callback.ts`, `tests/linkedin-connect.test.ts`
- Modify: `functions/api/admin/social/refresh-tokens.ts`, `src/scripts/admin-connections.ts`, `src/scripts/admin-panel.ts`, `src/i18n/ui.ts`, `wrangler.toml`, `tests/social-requeue-refresh.test.ts`

**Interfaces:**
- Consumes: `linkedinAuthUrl`, `exchangeLinkedinCode`, `findAdminOrganization`, `refreshLinkedinToken`, `LI_SCOPES` (Task 3); `requeueWaitingStatement(db, platform)`, `notificationText(... platform)` and `'connection_expiring'` (Task 2).
- Produces: `GET /api/admin/connections/linkedin/start`, `GET /api/admin/connections/linkedin/callback`; refresh endpoint response `{ ok: true, refreshed: boolean, linkedin: 'refreshed' | 'reminded' | 'none', x: 'refreshed' | 'none' }` (`x` is always `'none'` until Task 6); connection error codes `not_page_admin`, `lookup_failed`.

- [ ] **Step 1: Write the failing tests**

Create `tests/linkedin-connect.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { stubHttp } from './lib/http';
import { onRequestGet as start } from '../functions/api/admin/connections/linkedin/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/linkedin/callback';
import { createState } from '../functions/_lib/oauth-state';
import { getConnection, readAccessToken, readRefreshToken } from '../functions/_lib/connections';

const KEY = Buffer.alloc(32, 1).toString('base64');
const HOSTS = ['www.linkedin.com', 'api.linkedin.com'];
const ORG = '424242';

function world() {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, LINKEDIN_CLIENT_ID: 'cid', LINKEDIN_CLIENT_SECRET: 'csecret', LINKEDIN_ORGANIZATION: 'rsgturkey' };
  return { ...s, env };
}
const linkedin = (scope = 'w_organization_social,r_organization_social,rw_organization_admin', refresh = true) => stubHttp(HOSTS, (c) => {
  if (c.url.pathname === '/oauth/v2/accessToken') {
    return Response.json({ access_token: 'li-access', expires_in: 5184000, scope, ...(refresh ? { refresh_token: 'li-refresh', refresh_token_expires_in: 31536000 } : {}) });
  }
  if (c.url.pathname === '/rest/organizationAcls') return Response.json({ elements: [{ organization: `urn:li:organization:${ORG}`, state: 'APPROVED' }] });
  if (c.url.pathname === `/rest/organizations/${ORG}`) return Response.json({ vanityName: 'rsgturkey', localizedName: 'ISCB-SC RSG-Türkiye' });
  return undefined;
});

test('start: admins only, and it sends the browser to LinkedIn with a state and every scope', async () => {
  const { env } = world();
  assert.equal((await call(start, 'GET', '/api/admin/connections/linkedin/start', { env, as: 'pub' })).status, 403);
  const res = await call(start, 'GET', '/api/admin/connections/linkedin/start?lang=tr', { env, as: 'admin' });
  const to = new URL(res.headers.get('Location')!);
  assert.equal(to.origin + to.pathname, 'https://www.linkedin.com/oauth/v2/authorization');
  assert.equal(to.searchParams.get('scope'), 'w_organization_social r_organization_social rw_organization_admin');
  assert.ok(to.searchParams.get('state'));
});

test('start without the app configured says so instead of failing at LinkedIn', async () => {
  const { env } = world();
  const res = await call(start, 'GET', '/api/admin/connections/linkedin/start', { env: { ...env, LINKEDIN_CLIENT_SECRET: undefined }, as: 'admin' });
  assert.match(res.headers.get('Location')!, /connection_error=not_configured/);
});

test('callback stores the Page, both tokens sealed, and re-queues waiting LinkedIn targets', async () => {
  const { env, db } = world();
  db.prepare(`INSERT INTO social_posts (id, type, caption, media, platforms, scheduled_at, status, revision, created_by, created_at, updated_at) VALUES ('p1','image','x','[]','["linkedin"]',1,'scheduled',1,'ed',1,1)`).run();
  db.prepare(`INSERT INTO social_post_targets (post_id, platform, status) VALUES ('p1','linkedin','waiting_connection')`).run();
  const state = await createState((env as { DB: D1Database }).DB, 'linkedin', 'admin', '/admin', Math.floor(Date.now() / 1000));
  const g = linkedin();
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/linkedin/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connected=linkedin$/);
  const row = (await getConnection((env as { DB: D1Database }).DB, 'linkedin'))!;
  assert.equal(row.account_id, ORG);
  assert.equal(row.account_name, 'ISCB-SC RSG-Türkiye');
  assert.equal(await readAccessToken(env, row), 'li-access');
  assert.equal(await readRefreshToken(env, row), 'li-refresh');
  assert.ok(row.refresh_expires_at! > row.expires_at!);
  assert.equal((db.prepare(`SELECT status FROM social_post_targets`).get() as { status: string }).status, 'queued');
});

test('callback refuses a member who does not administer the configured Page, and stores nothing', async () => {
  const { env } = world();
  const state = await createState((env as { DB: D1Database }).DB, 'linkedin', 'admin', '/admin', Math.floor(Date.now() / 1000));
  const g = linkedin();
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/linkedin/callback?code=abc&state=${state}`, { env: { ...env, LINKEDIN_ORGANIZATION: 'another-page' }, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connection_error=not_page_admin/);
  assert.equal(await getConnection((env as { DB: D1Database }).DB, 'linkedin'), null);
});

test('callback refuses a token missing a scope', async () => {
  const { env } = world();
  const state = await createState((env as { DB: D1Database }).DB, 'linkedin', 'admin', '/admin', Math.floor(Date.now() / 1000));
  const g = linkedin('w_organization_social');
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/linkedin/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connection_error=missing_scope/);
});
```

In `tests/social-requeue-refresh.test.ts`, change the three exact-shape assertions to include the new keys (`{ ok: true, refreshed: true, linkedin: 'none', x: 'none' }` and likewise for `false`), and add:

```ts
test('daily: a LinkedIn token with a refresh token is renewed inside 20 days; without one, admins are reminded at 14, 7, 3 and 1 days', async () => {
  const { env, db } = world();
  const now = Math.floor(Date.now() / 1000);
  const li = await connectionUpsert(env as never, 'linkedin', {
    accountId: '424242', accountName: 'RSG', accessToken: 'old', refreshToken: 'li-refresh', scopes: 'x', expiresAt: now + 10 * 86400, refreshExpiresAt: now + 300 * 86400,
  }, 'admin', now - 50 * 86400);
  await li.run();
  const g = stubHttp(['www.linkedin.com'], (c) => (c.url.pathname === '/oauth/v2/accessToken' ? Response.json({ access_token: 'new', expires_in: 5184000, refresh_token: 'li-refresh', refresh_token_expires_in: 25920000 }) : undefined));
  let body: Record<string, unknown>;
  try { body = await (await cron(env)).json(); } finally { g.restore(); }
  assert.equal(body!.linkedin, 'refreshed');
  assert.equal(await readAccessToken(env as never, (await getConnection((env as { DB: D1Database }).DB, 'linkedin'))!), 'new');

  db.prepare(`UPDATE platform_connections SET refresh_token_enc = NULL, refresh_expires_at = NULL, expires_at = ? WHERE platform = 'linkedin'`).run(now + 7 * 86400 - 60);
  const sentBefore = mail.sent.length;
  assert.equal((await (await cron(env)).json() as Record<string, unknown>).linkedin, 'reminded');
  assert.ok(mail.sent.length > sentBefore, 'admins were mailed');
  db.prepare(`UPDATE platform_connections SET expires_at = ? WHERE platform = 'linkedin'`).run(now + 9 * 86400);
  assert.equal((await (await cron(env)).json() as Record<string, unknown>).linkedin, 'none', 'no mail on other days');
});
```

(Use the file's existing `world`, `cron` and `mail` helpers; add the imports `stubHttp` from `./lib/http`, `connectionUpsert`, `getConnection`, `readAccessToken` from the connections module if not already imported. If the file has no `mail` stub, wrap with `stubMail()` from `./lib/social` as `tests/social-dispatcher.test.ts` does.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/linkedin-connect.test.ts tests/social-requeue-refresh.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`functions/api/admin/connections/linkedin/start.ts`:

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { createState } from '../../../../_lib/oauth-state';
import { appendAudit } from '../../../../_lib/audit';
import { linkedinAuthUrl } from '../../../../_lib/social/linkedin';

/** "Connect LinkedIn": admin only, a one-use state, then LinkedIn's consent screen. The member must administer the RSG Page. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const returnTo = new URL(request.url).searchParams.get('lang') === 'tr' ? '/tr/admin' : '/admin';
  if (!env.LINKEDIN_CLIENT_ID || !env.LINKEDIN_CLIENT_SECRET || !env.LINKEDIN_ORGANIZATION || !env.TOKEN_ENC_KEY) {
    return redirectResponse(`${getBaseUrl(request)}${returnTo}?connection_error=not_configured`);
  }
  const state = await createState(env.DB, 'linkedin', user.id, returnTo, now);
  await appendAudit(env.DB, { userId: user.id, action: 'connection.start', targetType: 'connection', targetId: 'linkedin' }, now);
  return redirectResponse(linkedinAuthUrl(env, getBaseUrl(request), state));
};
```

`functions/api/admin/connections/linkedin/callback.ts`:

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { connectionUpsert, requeueWaitingStatement } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { exchangeLinkedinCode, findAdminOrganization, LI_SCOPES } from '../../../../_lib/social/linkedin';

/**
 * Finishes "Connect LinkedIn". Every way out is a redirect back to the panel
 * with ?connected=linkedin or ?connection_error=<code>; nothing is stored
 * unless every check passes, including that the member administers the Page
 * named by LINKEDIN_ORGANIZATION. A successful connect re-queues waiting
 * LinkedIn targets with a clean retry clock (see requeueWaitingStatement).
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!consumed || consumed.platform !== 'linkedin') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'linkedin', details }, now);

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }
  const tokens = await exchangeLinkedinCode(env, base, code);
  if (!tokens.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: tokens.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!LI_SCOPES.every((s) => tokens.scopes.includes(s))) {
    await audit('connection.rejected', { reason: 'missing_scope', scopes: tokens.scopes });
    return back(returnTo, 'connection_error=missing_scope');
  }
  const org = await findAdminOrganization(tokens.accessToken, env.LINKEDIN_ORGANIZATION ?? '');
  if (!org.ok) {
    await audit('connection.rejected', { reason: org.reason, status: org.status });
    return back(returnTo, `connection_error=${org.reason === 'not_admin' ? 'not_page_admin' : 'lookup_failed'}`);
  }

  try {
    const upsert = await connectionUpsert(env, 'linkedin', {
      accountId: org.id, accountName: org.name, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      scopes: tokens.scopes.join(','), expiresAt: now + tokens.expiresIn,
      refreshExpiresAt: tokens.refreshToken && tokens.refreshExpiresIn ? now + tokens.refreshExpiresIn : null,
    }, user.id, now);
    await runWithAudit(env.DB, [upsert, requeueWaitingStatement(env.DB, 'linkedin')], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'linkedin',
      details: { account: org.name, scopes: tokens.scopes, refreshToken: Boolean(tokens.refreshToken) },
    }, now);
  } catch (err) {
    console.error('linkedin connection store failed', err);
    try { await audit('connection.rejected', { reason: 'store_failed' }); } catch { /* the redirect matters more */ }
    return back(returnTo, 'connection_error=store_failed');
  }
  return back(returnTo, 'connected=linkedin');
};
```

`functions/api/admin/social/refresh-tokens.ts`: move the current body after the secret check into `async function refreshInstagram(env: Env, now: number, panelUrl: string): Promise<boolean>` (returning the old `refreshed` value; its early `return jsonResponse(...)` lines become `return false` / `return true`), then add `refreshLinkedin` and the new handler:

```ts
import { refreshLinkedinToken } from '../../../_lib/social/linkedin';
import { readRefreshToken } from '../../../_lib/connections';

const LINKEDIN_REFRESH_BEFORE = 20 * 86400;
const REMIND_DAYS = [14, 7, 3, 1];

/**
 * LinkedIn: with a refresh token, the access token (60 days) is renewed
 * inside its last 20 days; the refresh token itself lasts a year from the
 * first connect, and the admins are reminded before it ends. Without one
 * (the app was not granted programmatic refresh), only the reminders.
 */
async function refreshLinkedin(env: Env, now: number, panelUrl: string): Promise<'refreshed' | 'reminded' | 'none'> {
  const row = await getConnection(env.DB, 'linkedin');
  if (!row?.access_token_enc || row.expires_at === null) return 'none';
  const mailAdmins = async (kind: 'connection_expiring' | 'connection_broken', note: string) =>
    notifyEach(env, await adminEmails(env.DB), notificationText(kind, { label: 'LinkedIn', when: null, note, panelUrl, platform: 'LinkedIn' }));

  if (row.refresh_token_enc && row.expires_at - now < LINKEDIN_REFRESH_BEFORE) {
    let refresh: string | null = null;
    try { refresh = await readRefreshToken(env, row); } catch { refresh = null; }
    const result = refresh ? await refreshLinkedinToken(env, refresh) : { ok: false as const, status: 0, auth: true, reason: 'stored token unreadable' };
    if (result.ok) {
      const access = await seal(env.TOKEN_ENC_KEY, result.accessToken, tokenContext('linkedin', 'access'));
      const newRefresh = result.refreshToken ? await seal(env.TOKEN_ENC_KEY, result.refreshToken, tokenContext('linkedin', 'refresh')) : row.refresh_token_enc;
      await env.DB.prepare(
        `UPDATE platform_connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, refresh_expires_at = COALESCE(?, refresh_expires_at),
                last_ok_at = ?, last_error = NULL, last_error_at = NULL WHERE platform = 'linkedin'`,
      ).bind(access, newRefresh, now + result.expiresIn, result.refreshExpiresIn ? now + result.refreshExpiresIn : null, now).run();
      await requeueWaitingStatement(env.DB, 'linkedin').run();
      await appendAudit(env.DB, { userId: null, action: 'connection.refresh', targetType: 'connection', targetId: 'linkedin', details: { expiresAt: now + result.expiresIn } }, now);
      return 'refreshed';
    }
    await appendAudit(env.DB, { userId: null, action: 'connection.refresh_failed', targetType: 'connection', targetId: 'linkedin', details: { status: result.status, reason: result.reason, transient: !result.auth } }, now);
    if (result.auth || row.expires_at - now < 3 * 86400) {
      const wasBroken = connectionStatus(row, now) === 'broken';
      await markBroken(env.DB, 'linkedin', `refresh: ${result.reason}`, now);
      if (!wasBroken) await mailAdmins('connection_broken', result.reason);
    }
    return 'none';
  }

  const end = row.refresh_token_enc ? row.refresh_expires_at : row.expires_at;
  if (end === null) return 'none';
  const daysLeft = Math.ceil((end - now) / 86400);
  if (!REMIND_DAYS.includes(daysLeft)) return 'none';
  await mailAdmins('connection_expiring', String(daysLeft));
  await appendAudit(env.DB, { userId: null, action: 'connection.expiry_reminder', targetType: 'connection', targetId: 'linkedin', details: { daysLeft } }, now);
  return 'reminded';
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!safeEqual(request.headers.get('X-Archive-Secret'), env.SYMPOSIUM_ARCHIVE_SECRET)) {
    return jsonResponse({ error: 'Forbidden', code: 'forbidden' }, 403);
  }
  const now = Math.floor(Date.now() / 1000);
  const panelUrl = `${new URL(request.url).origin}/admin`;
  const refreshed = await refreshInstagram(env, now, panelUrl);
  const linkedin = await refreshLinkedin(env, now, panelUrl);
  return jsonResponse({ ok: true, refreshed, linkedin, x: 'none' });
};
```

Update the file's header comment to say it covers Instagram and LinkedIn (and, from Task 6, X).

`src/scripts/admin-connections.ts`:
- header comment: "Gmail, Instagram, LinkedIn and X can be connected."
- in `actions`, delete the first line (the `later` early return).
- in `row`, show the account as `@name` for Instagram and X: `c.platform === 'instagram' || c.platform === 'x' ? \`@${c.accountName}\` : c.accountName`.

`src/scripts/admin-panel.ts`: add `'not_page_admin', 'lookup_failed'` to `known`.

`src/i18n/ui.ts` (both languages):

```ts
    'admin.connections.error.not_configured': 'This platform\'s app is not set up on the site yet (its Pages secrets or TOKEN_ENC_KEY). See the README.',
    'admin.connections.error.not_page_admin': 'That LinkedIn account does not administer the RSG Page. Sign in as a Page Super admin and connect again.',
    'admin.connections.error.lookup_failed': 'LinkedIn did not say which Pages this account administers. Try again in a minute.',
    'admin.connections.error.no_refresh_token': 'The provider did not grant lasting access. Try again and approve every permission.',
```

```ts
    'admin.connections.error.not_configured': "Bu platformun uygulaması sitede henüz ayarlanmamış (Pages secret'ları ya da TOKEN_ENC_KEY). README'ye bak.",
    'admin.connections.error.not_page_admin': 'Bu LinkedIn hesabı RSG sayfasının yöneticisi değil. Sayfanın Super admin hesabıyla giriş yapıp yeniden bağla.',
    'admin.connections.error.lookup_failed': 'LinkedIn bu hesabın yönettiği sayfaları söylemedi. Bir dakika sonra yeniden dene.',
    'admin.connections.error.no_refresh_token': 'Sağlayıcı kalıcı erişim vermedi. Tekrar dene ve bütün izinleri onayla.',
```

(the `not_configured` and `no_refresh_token` lines replace the existing ones). `admin.connections.later` is now unused: delete it in both languages.

`wrangler.toml`, under `[vars]` after `PUBLIC_BLOG_IMAGES_URL`:

```toml
# The LinkedIn Page the site posts as, by its public vanity name
# (linkedin.com/company/<this>). Connecting LinkedIn checks the signing-in
# member administers this Page. See README, "Social media and connections".
LINKEDIN_ORGANIZATION = "rsgturkey"
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/linkedin-connect.test.ts tests/social-requeue-refresh.test.ts tests/connections-api.test.ts`
Expected: PASS. Then `npm test` and `npx astro check`.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/connections/linkedin functions/api/admin/social/refresh-tokens.ts src/scripts/admin-connections.ts src/scripts/admin-panel.ts src/i18n/ui.ts wrangler.toml tests/linkedin-connect.test.ts tests/social-requeue-refresh.test.ts
git commit -m "Connections: connect the LinkedIn Page; daily LinkedIn refresh or expiry reminders"
```

---

### Task 5: X adapter and token renewal on use

**Files:**
- Create: `functions/_lib/social/x.ts`, `tests/x-publish.test.ts`
- Modify: `functions/_lib/social/registry.ts`, `functions/_lib/social/tokens.ts`

**Interfaces:**
- Consumes: `PublishInput`, `PublishStep`, `REFRESH_ON_USE`, `Usable`, `TokenEnv` (Task 2); `stubHttp` (Task 3).
- Produces (in `x.ts`): `X_API`, `X_SCOPES`, `xRedirectUri(base)`, `pkceVerifier(secret, state)`, `pkceChallenge(verifier)`, `xAuthUrl(env, base, state)`, `exchangeXCode(env, base, code, verifier)`, `refreshXToken(env, refreshToken)`, `xMe(token)`, `refreshXOnUse(env, row, now)`, `xPublishStep(input)`. `tokens.ts` registers `REFRESH_ON_USE.x = { within: 300, refresh: refreshXOnUse }`.

- [ ] **Step 1: Write the failing tests**

Create `tests/x-publish.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stubHttp, type HttpCall } from './lib/http';
import { setupSocial } from './lib/social';
import { xPublishStep, pkceVerifier, pkceChallenge } from '../functions/_lib/social/x';
import { usableToken } from '../functions/_lib/social/tokens';
import { connectionUpsert, getConnection, readRefreshToken } from '../functions/_lib/connections';
import type { PostForPlatform, PublishInput } from '../functions/_lib/social/types';

const KEY = Buffer.alloc(32, 1).toString('base64');
const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const img = (n: number) => ({ key: `k${n}.jpg`, url: `https://example.org/k${n}.jpg`, alt: `Alt ${n}`, load: async () => bytes });
const single: PostForPlatform = { type: 'image', caption: 'Kayıt açık https://rsg-turkiye.iscbsc.org/', media: [img(1)] };
const state = (media: string[], attempt: number | null) => JSON.stringify({ x: 1, media, attempt });
const input = (post: PostForPlatform, containerId: string | null, cps: string[] = []): PublishInput => ({
  account: { id: '77', name: 'rsgturkey' }, token: 'x-tok', post, state: { containerId }, now: 1_800_000_000,
  checkpoint: async (c) => { cps.push(c); return true; },
});
async function run(h: (c: HttpCall) => Response | undefined, i: PublishInput) {
  const s = stubHttp(['api.x.com'], h);
  try { return { result: await xPublishStep(i), calls: s.calls }; } finally { s.restore(); }
}

test('PKCE: the verifier is derived from the state with the app secret, and the challenge is its S256 hash', async () => {
  const v = await pkceVerifier('secret', 'state-1');
  assert.match(v, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(await pkceVerifier('secret', 'state-1'), v, 'the callback derives the same verifier');
  assert.notEqual(await pkceVerifier('secret', 'state-2'), v);
  assert.match(await pkceChallenge(v), /^[A-Za-z0-9_-]{43}$/);
});

test('first tick uploads each image with its alt text and waits', async () => {
  let n = 0;
  const { result, calls } = await run((c) => {
    if (c.url.pathname === '/2/media/upload') return Response.json({ data: { id: String(++n), media_key: `3_${n}` } });
    if (c.url.pathname === '/2/media/metadata') return Response.json({ data: { id: '1' } });
    return undefined;
  }, input({ ...single, type: 'carousel', media: [img(1), img(2)] }, null));
  assert.deepEqual(result, { kind: 'pending', containerId: state(['1', '2'], null), notes: [] });
  const up = calls.find((c) => c.url.pathname === '/2/media/upload')!;
  assert.ok(up.body instanceof FormData);
  assert.equal((up.body as FormData).get('media_category'), 'tweet_image');
  assert.equal(up.headers.get('Authorization'), 'Bearer x-tok');
  assert.deepEqual(calls.filter((c) => c.url.pathname === '/2/media/metadata').map((c) => c.body), [
    { id: '1', metadata: { alt_text: { text: 'Alt 1' } } }, { id: '2', metadata: { alt_text: { text: 'Alt 2' } } },
  ]);
});

test('alt text refused: the image still goes, and the gap is noted', async () => {
  const { result } = await run((c) => {
    if (c.url.pathname === '/2/media/upload') return Response.json({ data: { id: '1' } });
    if (c.url.pathname === '/2/media/metadata') return Response.json({ title: 'Invalid Request' }, { status: 400 });
    return undefined;
  }, input(single, null));
  assert.deepEqual(result, { kind: 'pending', containerId: state(['1'], null), notes: ['alt_text_dropped'] });
});

test('second tick checkpoints, then posts the text with the media', async () => {
  const cps: string[] = [];
  const { result, calls } = await run((c) => (c.url.pathname === '/2/tweets' ? Response.json({ data: { id: '1900', text: 'x' } }, { status: 201 }) : undefined), input(single, state(['1'], null), cps));
  assert.deepEqual(result, { kind: 'done', remoteId: '1900', permalink: 'https://x.com/rsgturkey/status/1900' });
  assert.deepEqual(cps, [state(['1'], 1_800_000_000)]);
  assert.deepEqual(calls[0].body, { text: single.caption, media: { media_ids: ['1'] } });
});

test('after a lost answer, X calling the retry a duplicate proves the first one went out', async () => {
  const { result } = await run((c) => (c.url.pathname === '/2/tweets'
    ? Response.json({ title: 'Forbidden', detail: 'You are not allowed to create a Tweet with duplicate content.', status: 403 }, { status: 403 })
    : undefined), input(single, state(['1'], 1_800_000_000)));
  assert.deepEqual(result, { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_duplicate'] });
});

test('a duplicate on a first attempt is the team repeating an old text: failed, with the reason', async () => {
  const { result } = await run(() => Response.json({ detail: 'You are not allowed to create a Tweet with duplicate content.', status: 403 }, { status: 403 }), input(single, state(['1'], null)));
  assert.equal(result.kind, 'fail');
  assert.match((result as { reason: string }).reason, /^duplicate: /);
});

test('no credits, a revoked token, a timeout', async () => {
  const pay = await run(() => Response.json({ title: 'Payment Required', detail: 'no credits', status: 402 }, { status: 402 }), input(single, state(['1'], null)));
  assert.match((pay.result as { reason: string }).reason, /^no_api_access: /);
  const auth = await run(() => Response.json({ title: 'Unauthorized', status: 401 }, { status: 401 }), input(single, state(['1'], null)));
  assert.equal(auth.result.kind, 'auth');
  const down = await run(() => new Response('', { status: 503 }), input(single, state(['1'], null)));
  assert.equal(down.result.kind, 'retry');
});

function xWorld() {
  const s = setupSocial();
  const env = { ...(s.env as object), TOKEN_ENC_KEY: KEY, X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsecret' } as never as { DB: D1Database; TOKEN_ENC_KEY: string; X_CLIENT_ID: string; X_CLIENT_SECRET: string };
  return { ...s, env };
}
async function connectX(env: { DB: D1Database; TOKEN_ENC_KEY: string }, expiresAt: number) {
  await (await connectionUpsert(env as never, 'x', { accountId: '77', accountName: 'rsgturkey', accessToken: 'old-access', refreshToken: 'rt-1', scopes: 'x', expiresAt, refreshExpiresAt: null }, 'admin', 1)).run();
}

test('an X access token about to expire is renewed on use, and the rotated refresh token is stored', async () => {
  const { env } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const g = stubHttp(['api.x.com'], (c) => {
    if (c.url.pathname !== '/2/oauth2/token') return undefined;
    assert.equal(c.headers.get('Authorization'), `Basic ${btoa('xid:xsecret')}`);
    assert.equal((c.body as URLSearchParams).get('refresh_token'), 'rt-1');
    return Response.json({ access_token: 'new-access', refresh_token: 'rt-2', expires_in: 7200, scope: 'tweet.write' });
  });
  let u;
  try { u = await usableToken(env, 'x', now); } finally { g.restore(); }
  assert.deepEqual(u, { ok: true, token: 'new-access', account: { id: '77', name: 'rsgturkey' } });
  const row = (await getConnection(env.DB, 'x'))!;
  assert.equal(await readRefreshToken(env, row), 'rt-2');
  assert.equal(row.expires_at, now + 7200);
});

test('two renewals racing: the one that loses uses the winner\'s token and does not mark X broken', async () => {
  const { env, db } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const stale = (await getConnection(env.DB, 'x'))!;
  // The other side renews first: a new access token and a rotated refresh token are already stored.
  const g1 = stubHttp(['api.x.com'], () => Response.json({ access_token: 'winner-access', refresh_token: 'rt-2', expires_in: 7200 }));
  try { await usableToken(env, 'x', now); } finally { g1.restore(); }
  // This side read the row before that and now tries the spent refresh token.
  const { refreshXOnUse } = await import('../functions/_lib/social/x');
  const g2 = stubHttp(['api.x.com'], () => Response.json({ error: 'invalid_request', error_description: 'Value passed for the token was invalid.' }, { status: 400 }));
  let u;
  try { u = await refreshXOnUse(env, stale, now); } finally { g2.restore(); }
  assert.deepEqual(u, { ok: true, token: 'winner-access', account: { id: '77', name: 'rsgturkey' } });
  assert.equal((db.prepare(`SELECT last_error FROM platform_connections WHERE platform = 'x'`).get() as { last_error: string | null }).last_error, null);
});

test('a refresh token X no longer accepts, with nobody else having renewed: broken, and the caller is told it just broke', async () => {
  const { env } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const g = stubHttp(['api.x.com'], () => Response.json({ error: 'invalid_request' }, { status: 400 }));
  let u;
  try { u = await usableToken(env, 'x', now); } finally { g.restore(); }
  assert.equal(u!.ok, false);
  assert.equal((u as { why: string }).why, 'broken');
  assert.equal((u as { justBroke?: boolean }).justBroke, true);
});

test('X unreachable while renewing, old token still valid: it is used; already expired: try again next tick', async () => {
  const { env } = xWorld();
  const now = 1_800_000_000;
  await connectX(env, now + 60);
  const g = stubHttp(['api.x.com'], () => new Response('', { status: 503 }));
  try {
    assert.deepEqual(await usableToken(env, 'x', now), { ok: true, token: 'old-access', account: { id: '77', name: 'rsgturkey' } });
    assert.equal((await usableToken(env, 'x', now + 120) as { why: string }).why, 'transient');
  } finally { g.restore(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/x-publish.test.ts`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement**

Create `functions/_lib/social/x.ts`:

```ts
/**
 * X API v2 (pay per use): connecting @rsgturkey with OAuth 2.0 and PKCE,
 * renewing its two-hour access token on use (refresh tokens rotate: each
 * renewal spends the old one), and publishing image posts.
 *
 * The PKCE verifier is not stored: it is an HMAC of the one-use OAuth state
 * under the app secret, so start and callback derive the same value and
 * nothing new goes into D1.
 */
import type { Env } from '../auth';
import type { ConnectionRow } from '../connections';
import { getConnection, readAccessToken, readRefreshToken, markBroken, tokenContext } from '../connections';
import { seal } from '../token-vault';
import type { PublishInput, PublishStep } from './types';
import type { TokenEnv, Usable } from './tokens';

export const X_API = 'https://api.x.com/2';
export const X_SCOPES = ['tweet.read', 'tweet.write', 'users.read', 'media.write', 'offline.access'];
type App = Pick<Env, 'X_CLIENT_ID' | 'X_CLIENT_SECRET'>;

export const xRedirectUri = (base: string) => `${base}/api/admin/connections/x/callback`;

const b64url = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function pkceVerifier(secret: string, state: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`x-pkce:${state}`)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
}

export async function xAuthUrl(env: App, base: string, state: string): Promise<string> {
  const u = new URL('https://x.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', env.X_CLIENT_ID ?? '');
  u.searchParams.set('redirect_uri', xRedirectUri(base));
  u.searchParams.set('scope', X_SCOPES.join(' '));
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', await pkceChallenge(await pkceVerifier(env.X_CLIENT_SECRET ?? '', state)));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

async function json(res: Response): Promise<Record<string, unknown> | null> {
  return res.json().then((v) => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null)).catch(() => null);
}

type Tokens = { ok: true; accessToken: string; refreshToken: string | null; expiresIn: number; scopes: string[] };

async function tokenCall(env: App, params: Record<string, string>): Promise<Tokens | { ok: false; status: number; body: Record<string, unknown> | null }> {
  let res: Response;
  try {
    res = await fetch(`${X_API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${env.X_CLIENT_ID ?? ''}:${env.X_CLIENT_SECRET ?? ''}`)}` },
      body: new URLSearchParams(params).toString(),
    });
  } catch { return { ok: false, status: 0, body: null }; }
  const body = await json(res);
  if (!res.ok || typeof body?.access_token !== 'string') return { ok: false, status: res.status, body };
  return {
    ok: true, accessToken: body.access_token, refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : null,
    expiresIn: Number(body.expires_in) || 7200, scopes: typeof body.scope === 'string' ? body.scope.split(' ').filter(Boolean) : [],
  };
}

export async function exchangeXCode(env: App, base: string, code: string, verifier: string): Promise<Tokens | { ok: false; status: number }> {
  const r = await tokenCall(env, { grant_type: 'authorization_code', code, redirect_uri: xRedirectUri(base), code_verifier: verifier });
  return r.ok ? r : { ok: false, status: r.status };
}

export async function refreshXToken(env: App, refreshToken: string): Promise<Tokens | { ok: false; status: number; auth: boolean; reason: string }> {
  const r = await tokenCall(env, { grant_type: 'refresh_token', refresh_token: refreshToken });
  if (r.ok) return r;
  const reason = String(r.body?.error_description ?? r.body?.error ?? `HTTP ${r.status}`).slice(0, 200);
  return { ok: false, status: r.status, auth: r.status === 400 || r.status === 401, reason };
}

export async function xMe(token: string): Promise<{ ok: true; id: string; username: string } | { ok: false; status: number }> {
  let res: Response;
  try { res = await fetch(`${X_API}/users/me?user.fields=username`, { headers: { Authorization: `Bearer ${token}` } }); } catch { return { ok: false, status: 0 }; }
  const data = (await json(res))?.data as { id?: string; username?: string } | undefined;
  if (!res.ok || !data?.id) return { ok: false, status: res.status };
  return { ok: true, id: String(data.id), username: String(data.username ?? '') };
}

async function fromStored(env: TokenEnv, now: number, row?: ConnectionRow | null): Promise<Usable> {
  const current = row ?? await getConnection(env.DB, 'x');
  const token = current?.account_id && current.expires_at !== null && current.expires_at > now ? await readAccessToken(env, current) : null;
  return token ? { ok: true, token, account: { id: current!.account_id!, name: current!.account_name } } : { ok: false, why: 'transient', reason: 'unavailable: X token renewal did not finish' };
}

/**
 * Renews X's access token. Stored with a compare-and-set on the refresh token
 * it spent: if another caller rotated it first, theirs is the live pair and
 * is used instead, and a refusal of the spent token is not a broken connection.
 */
export async function refreshXOnUse(env: TokenEnv, row: ConnectionRow, now: number): Promise<Usable> {
  let refresh: string | null = null;
  try { refresh = await readRefreshToken(env, row); } catch { refresh = null; }
  if (!refresh) return { ok: false, why: 'unreadable' };
  const r = await refreshXToken(env, refresh);
  if (r.ok) {
    const access = await seal(env.TOKEN_ENC_KEY, r.accessToken, tokenContext('x', 'access'));
    const nextRefresh = r.refreshToken ? await seal(env.TOKEN_ENC_KEY, r.refreshToken, tokenContext('x', 'refresh')) : row.refresh_token_enc;
    const res = await env.DB.prepare(
      `UPDATE platform_connections SET access_token_enc = ?, refresh_token_enc = ?, expires_at = ?, last_ok_at = ?, last_error = NULL, last_error_at = NULL
        WHERE platform = 'x' AND refresh_token_enc = ?`,
    ).bind(access, nextRefresh, now + r.expiresIn, now, row.refresh_token_enc).run();
    if (res.meta.changes === 1) return { ok: true, token: r.accessToken, account: { id: row.account_id!, name: row.account_name } };
    return fromStored(env, now);
  }
  const current = await getConnection(env.DB, 'x');
  if (current && current.refresh_token_enc !== row.refresh_token_enc) return fromStored(env, now, current);
  if (r.auth) {
    await markBroken(env.DB, 'x', `refresh: ${r.reason}`, now);
    return { ok: false, why: 'broken', justBroke: true, reason: r.reason };
  }
  if (row.expires_at !== null && row.expires_at > now) return fromStored(env, now, row);
  return { ok: false, why: 'transient', reason: `unavailable: ${r.reason}` };
}

interface XState { x: 1; media: string[]; attempt: number | null }
const encodeState = (s: XState) => JSON.stringify({ x: 1, media: s.media, attempt: s.attempt });
function decodeState(raw: string | null): XState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as XState;
    return v && v.x === 1 && Array.isArray(v.media) ? { x: 1, media: v.media.map(String), attempt: typeof v.attempt === 'number' ? v.attempt : null } : null;
  } catch { return null; }
}

const detail = (body: Record<string, unknown> | null, status: number) =>
  String(body?.detail ?? body?.title ?? (body?.errors as { message?: string }[] | undefined)?.[0]?.message ?? `HTTP ${status}`).slice(0, 250);

function fromFailure(status: number, body: Record<string, unknown> | null): PublishStep {
  const d = detail(body, status);
  if (status === 401) return { kind: 'auth', reason: `auth: ${d}` };
  if (status === 402 || /client-not-enrolled|client-forbidden|credits/i.test(`${body?.type ?? ''} ${d}`)) return { kind: 'fail', reason: `no_api_access: ${d}`, clearContainer: true };
  if (status === 429) return { kind: 'retry', reason: `rate_limited: ${d}` };
  if (status === 0 || status >= 500) return { kind: 'retry', reason: `unavailable: ${d}` };
  if (status === 403) return { kind: 'auth', reason: `auth: ${d}` };
  if (/too long|exceeds/i.test(d)) return { kind: 'fail', reason: `caption_rejected: ${d}`, clearContainer: true };
  return { kind: 'fail', reason: `unknown: ${d}`, clearContainer: true };
}

const isDuplicate = (status: number, body: Record<string, unknown> | null) => status === 403 && /duplicate/i.test(detail(body, status));

async function call(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> | null }> {
  try {
    const res = await fetch(url, init);
    return { status: res.status, body: await json(res) };
  } catch { return { status: 0, body: null }; }
}

/**
 * Tick 1 uploads the images (with alt text) and waits. The next tick records
 * the attempt with checkpoint and creates the post. If a tick finds an
 * attempt already recorded, the create call it made was never answered: it
 * creates again, and X answering "duplicate content" proves the first one
 * went out. (The cost: a post whose text repeats an older one exactly, and
 * whose first create was lost, is recorded as published. Both together are
 * rare enough.)
 */
export async function xPublishStep(input: PublishInput): Promise<PublishStep> {
  const { account, token, post, now, checkpoint } = input;
  const st = decodeState(input.state.containerId);
  if (input.state.containerId && !st) return { kind: 'fail', reason: 'unknown: unreadable X state', clearContainer: true };
  if (post.type === 'story') return { kind: 'fail', reason: 'not_available: X has no stories' };
  const auth = { Authorization: `Bearer ${token}` };

  if (!st) {
    const media: string[] = [];
    const notes: string[] = [];
    for (const m of post.media) {
      const data = m.load ? await m.load() : null;
      if (!data) return { kind: 'retry', reason: `media_unreachable: ${m.key}` };
      const form = new FormData();
      form.set('media', new Blob([data], { type: 'image/jpeg' }), m.key);
      form.set('media_category', 'tweet_image');
      const up = await call(`${X_API}/media/upload`, { method: 'POST', headers: auth, body: form });
      const id = (up.body?.data as { id?: string } | undefined)?.id;
      if (up.status !== 200 && up.status !== 201) return fromFailure(up.status, up.body);
      if (!id) return { kind: 'retry', reason: 'unavailable: upload without id' };
      if (m.alt) {
        const meta = await call(`${X_API}/media/metadata`, {
          method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ id, metadata: { alt_text: { text: m.alt.slice(0, 1000) } } }),
        });
        if (meta.status === 401) return fromFailure(401, meta.body);
        if (meta.status < 200 || meta.status >= 300) { if (!notes.includes('alt_text_dropped')) notes.push('alt_text_dropped'); }
      }
      media.push(id);
    }
    return { kind: 'pending', containerId: encodeState({ x: 1, media, attempt: null }), notes };
  }

  const recovering = st.attempt !== null;
  if (!recovering && !await checkpoint(encodeState({ ...st, attempt: now }))) return { kind: 'pending', containerId: input.state.containerId! };
  const created = await call(`${X_API}/tweets`, {
    method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: post.caption, ...(st.media.length ? { media: { media_ids: st.media } } : {}) }),
  });
  if (created.status === 201 || created.status === 200) {
    const id = (created.body?.data as { id?: string } | undefined)?.id;
    if (!id) return { kind: 'done', remoteId: null, permalink: null };
    return { kind: 'done', remoteId: id, permalink: `https://x.com/${account.name || 'i/web'}/status/${id}` };
  }
  if (isDuplicate(created.status, created.body)) {
    return recovering
      ? { kind: 'done', remoteId: null, permalink: null, notes: ['recovered_duplicate'] }
      : { kind: 'fail', reason: `duplicate: ${detail(created.body, created.status)}`, clearContainer: true };
  }
  return fromFailure(created.status, created.body);
}
```

In `functions/_lib/social/tokens.ts`, register X after the `REFRESH_ON_USE` declaration:

```ts
import { refreshXOnUse } from './x';
// after `export const REFRESH_ON_USE ... = {};`
/** X access tokens last two hours; renew one that has under five minutes left. */
REFRESH_ON_USE.x = { within: 300, refresh: refreshXOnUse };
```

(`x.ts` imports only types from `tokens.ts`, so there is no runtime cycle.)

In `functions/_lib/social/registry.ts`:

```ts
import { xPublishStep } from './x';
// in PUBLISHERS:
  x: xPublishStep,
```

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/x-publish.test.ts`
Expected: PASS. Then `npm test` and `npx astro check`.

- [ ] **Step 5: Commit**

```bash
git add functions/_lib/social/x.ts functions/_lib/social/tokens.ts functions/_lib/social/registry.ts tests/x-publish.test.ts
git commit -m "Social: X adapter (images with alt text, duplicate-based crash recovery) and token renewal on use with rotation-safe storage"
```

---

### Task 6: Connect X, keep it alive daily, preview X in the composer

**Files:**
- Create: `functions/api/admin/connections/x/start.ts`, `functions/api/admin/connections/x/callback.ts`, `tests/x-connect.test.ts`
- Modify: `functions/api/admin/social/refresh-tokens.ts`, `src/scripts/social/preview.ts`, `src/scripts/social/composer.ts`, `src/i18n/ui.ts`, `tests/social-requeue-refresh.test.ts`

**Interfaces:**
- Consumes: `xAuthUrl`, `pkceVerifier`, `exchangeXCode`, `xMe`, `X_SCOPES` (Task 5); `usableToken` (Task 2).
- Produces: `GET /api/admin/connections/x/start`, `GET /api/admin/connections/x/callback`; the daily endpoint's `x` field becomes `'refreshed' | 'none'`; `PreviewKind` gains `'x'`.

- [ ] **Step 1: Write the failing tests**

Create `tests/x-connect.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupSocial, call } from './lib/social';
import { stubHttp } from './lib/http';
import { onRequestGet as start } from '../functions/api/admin/connections/x/start';
import { onRequestGet as callback } from '../functions/api/admin/connections/x/callback';
import { pkceVerifier, pkceChallenge } from '../functions/_lib/social/x';
import { getConnection, readAccessToken, readRefreshToken } from '../functions/_lib/connections';

const KEY = Buffer.alloc(32, 1).toString('base64');
function world() {
  const s = setupSocial();
  return { ...s, env: { ...(s.env as object), TOKEN_ENC_KEY: KEY, X_CLIENT_ID: 'xid', X_CLIENT_SECRET: 'xsecret' } };
}

test('start sends the admin to X with a PKCE challenge derived from the state', async () => {
  const { env } = world();
  const res = await call(start, 'GET', '/api/admin/connections/x/start', { env, as: 'admin' });
  const to = new URL(res.headers.get('Location')!);
  assert.equal(to.origin + to.pathname, 'https://x.com/i/oauth2/authorize');
  assert.equal(to.searchParams.get('code_challenge_method'), 'S256');
  const state = to.searchParams.get('state')!;
  assert.equal(to.searchParams.get('code_challenge'), await pkceChallenge(await pkceVerifier('xsecret', state)));
  assert.equal(to.searchParams.get('scope'), 'tweet.read tweet.write users.read media.write offline.access');
});

test('callback exchanges the code with the same verifier and stores the account with both tokens', async () => {
  const { env } = world();
  const res0 = await call(start, 'GET', '/api/admin/connections/x/start', { env, as: 'admin' });
  const state = new URL(res0.headers.get('Location')!).searchParams.get('state')!;
  const g = stubHttp(['api.x.com'], (c) => {
    if (c.url.pathname === '/2/oauth2/token') {
      return Response.json({ access_token: 'xa', refresh_token: 'xr', expires_in: 7200, scope: 'tweet.read tweet.write users.read media.write offline.access' });
    }
    if (c.url.pathname === '/2/users/me') return Response.json({ data: { id: '77', username: 'rsgturkey', name: 'RSG' } });
    return undefined;
  });
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/x/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connected=x$/);
  const tokenCall = g.calls.find((c) => c.url.pathname === '/2/oauth2/token')!;
  assert.equal((tokenCall.body as URLSearchParams).get('code_verifier'), await pkceVerifier('xsecret', state));
  const row = (await getConnection((env as { DB: D1Database }).DB, 'x'))!;
  assert.deepEqual([row.account_id, row.account_name], ['77', 'rsgturkey']);
  assert.equal(await readAccessToken(env, row), 'xa');
  assert.equal(await readRefreshToken(env, row), 'xr');
});

test('callback without a refresh token is refused: X would stop working in two hours', async () => {
  const { env } = world();
  const res0 = await call(start, 'GET', '/api/admin/connections/x/start', { env, as: 'admin' });
  const state = new URL(res0.headers.get('Location')!).searchParams.get('state')!;
  const g = stubHttp(['api.x.com'], (c) => (c.url.pathname === '/2/oauth2/token'
    ? Response.json({ access_token: 'xa', expires_in: 7200, scope: 'tweet.read tweet.write users.read media.write offline.access' })
    : Response.json({ data: { id: '77', username: 'rsgturkey' } })));
  let res: Response;
  try { res = await call(callback, 'GET', `/api/admin/connections/x/callback?code=abc&state=${state}`, { env, as: 'admin' }); } finally { g.restore(); }
  assert.match(res!.headers.get('Location')!, /connection_error=no_refresh_token/);
});
```

In `tests/social-requeue-refresh.test.ts` add:

```ts
test('daily: a connected X account is renewed so its refresh token never goes idle', async () => {
  const { env } = world();
  const now = Math.floor(Date.now() / 1000);
  await (await connectionUpsert(env as never, 'x', { accountId: '77', accountName: 'rsgturkey', accessToken: 'a', refreshToken: 'r', scopes: 'x', expiresAt: now - 60, refreshExpiresAt: null }, 'admin', now - 86400)).run();
  const g = stubHttp(['api.x.com'], () => Response.json({ access_token: 'a2', refresh_token: 'r2', expires_in: 7200 }));
  try { assert.equal((await (await cron(env)).json() as Record<string, unknown>).x, 'refreshed'); } finally { g.restore(); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --import tsx --test tests/x-connect.test.ts tests/social-requeue-refresh.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`functions/api/admin/connections/x/start.ts`:

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, jsonResponse, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { createState } from '../../../../_lib/oauth-state';
import { appendAudit } from '../../../../_lib/audit';
import { xAuthUrl } from '../../../../_lib/social/x';

/** "Connect X": admin only, a one-use state (which also fixes the PKCE verifier), then X's consent screen. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const user = await getSessionUser(request, env);
  if (!user) return jsonResponse({ error: 'Not authenticated' }, 401);
  if (user.is_admin !== 1) return jsonResponse({ error: 'Forbidden' }, 403);
  const now = Math.floor(Date.now() / 1000);
  const returnTo = new URL(request.url).searchParams.get('lang') === 'tr' ? '/tr/admin' : '/admin';
  if (!env.X_CLIENT_ID || !env.X_CLIENT_SECRET || !env.TOKEN_ENC_KEY) {
    return redirectResponse(`${getBaseUrl(request)}${returnTo}?connection_error=not_configured`);
  }
  const state = await createState(env.DB, 'x', user.id, returnTo, now);
  await appendAudit(env.DB, { userId: user.id, action: 'connection.start', targetType: 'connection', targetId: 'x' }, now);
  return redirectResponse(await xAuthUrl(env, getBaseUrl(request), state));
};
```

`functions/api/admin/connections/x/callback.ts`:

```ts
import type { Env } from '../../../../_lib/auth';
import { getSessionUser, redirectResponse, getBaseUrl } from '../../../../_lib/auth';
import { consumeState } from '../../../../_lib/oauth-state';
import { connectionUpsert, requeueWaitingStatement } from '../../../../_lib/connections';
import { runWithAudit, appendAudit } from '../../../../_lib/audit';
import { exchangeXCode, pkceVerifier, xMe, X_SCOPES } from '../../../../_lib/social/x';

/** Finishes "Connect X". Same shape as Instagram's and LinkedIn's: a redirect with ?connected=x or ?connection_error=<code>, nothing stored unless every check passes. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const base = getBaseUrl(request);
  const url = new URL(request.url);
  const now = Math.floor(Date.now() / 1000);
  const back = (returnTo: string, query: string) => redirectResponse(`${base}${returnTo}?${query}`);

  const state = url.searchParams.get('state');
  const consumed = state ? await consumeState(env.DB, state, now) : null;
  if (!state || !consumed || consumed.platform !== 'x') return back('/admin', 'connection_error=bad_state');
  const returnTo = consumed.return_to;

  const user = await getSessionUser(request, env);
  if (!user || user.id !== consumed.user_id || user.is_admin !== 1) return back(returnTo, 'connection_error=not_admin');
  const audit = (action: string, details: Record<string, unknown> = {}) =>
    appendAudit(env.DB, { userId: user.id, action, targetType: 'connection', targetId: 'x', details }, now);

  const code = url.searchParams.get('code');
  if (url.searchParams.get('error') || !code) {
    await audit('connection.cancelled', { error: url.searchParams.get('error') });
    return back(returnTo, 'connection_error=cancelled');
  }
  const tokens = await exchangeXCode(env, base, code, await pkceVerifier(env.X_CLIENT_SECRET ?? '', state));
  if (!tokens.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', status: tokens.status });
    return back(returnTo, 'connection_error=token_exchange');
  }
  if (!X_SCOPES.every((s) => tokens.scopes.includes(s))) {
    await audit('connection.rejected', { reason: 'missing_scope', scopes: tokens.scopes });
    return back(returnTo, 'connection_error=missing_scope');
  }
  if (!tokens.refreshToken) {
    await audit('connection.rejected', { reason: 'no_refresh_token' });
    return back(returnTo, 'connection_error=no_refresh_token');
  }
  const me = await xMe(tokens.accessToken);
  if (!me.ok) {
    await audit('connection.rejected', { reason: 'token_exchange', step: 'me', status: me.status });
    return back(returnTo, 'connection_error=token_exchange');
  }

  try {
    const upsert = await connectionUpsert(env, 'x', {
      accountId: me.id, accountName: me.username, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken,
      scopes: tokens.scopes.join(','), expiresAt: now + tokens.expiresIn, refreshExpiresAt: null,
    }, user.id, now);
    await runWithAudit(env.DB, [upsert, requeueWaitingStatement(env.DB, 'x')], {
      userId: user.id, action: 'connection.connect', targetType: 'connection', targetId: 'x', details: { account: me.username, scopes: tokens.scopes },
    }, now);
  } catch (err) {
    console.error('x connection store failed', err);
    try { await audit('connection.rejected', { reason: 'store_failed' }); } catch { /* the redirect matters more */ }
    return back(returnTo, 'connection_error=store_failed');
  }
  return back(returnTo, 'connected=x');
};
```

In `functions/api/admin/social/refresh-tokens.ts` add, and use it in the handler (`x: await keepXAlive(env, now, panelUrl)`):

```ts
import { refreshXOnUse } from '../../../_lib/social/x';

/**
 * X: renew the access token every day, even when it is still fresh, so the
 * refresh token stays in use on days nothing is posted. A refusal marks X
 * broken (refreshXOnUse does that) and mails the admins.
 */
async function keepXAlive(env: Env, now: number, panelUrl: string): Promise<'refreshed' | 'none'> {
  const row = await getConnection(env.DB, 'x');
  if (!row?.refresh_token_enc || !row.account_id || connectionStatus(row, now) === 'broken') return 'none';
  const u = await refreshXOnUse(env, row, now);
  if (u.ok) {
    await requeueWaitingStatement(env.DB, 'x').run();
    return 'refreshed';
  }
  if (u.why === 'broken' && u.justBroke) {
    await notifyEach(env, await adminEmails(env.DB), notificationText('connection_broken', { label: 'X', when: null, note: u.reason ?? '', panelUrl, platform: 'X' }));
  }
  return 'none';
}
```

`src/scripts/social/preview.ts`:
- `export type PreviewKind = 'instagram' | 'story' | 'linkedin' | 'x';`
- import `countFor, CAPTION_LIMITS` from social-limits alongside `captionFor`.
- before the `linkedin` branch:

```ts
  if (which === 'x') {
    const text = captionFor(source(s), 'x');
    const grid = s.media.slice(0, 4).map((m) => `<div class="aspect-square bg-gray-200 bg-center bg-cover" style="${bgImage(m.url)}" role="img" aria-label="${esc(m.alt)}"></div>`).join('');
    return `<div class="rounded-2xl border border-gray-200 bg-white text-sm p-3">
      <div class="font-semibold text-navy">RSG-Türkiye <span class="font-normal text-gray-500">@rsgturkey</span></div>
      <div class="mt-1 whitespace-pre-wrap break-words">${esc(text)}</div>
      ${grid ? `<div class="mt-2 grid ${s.media.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-0.5 rounded-xl overflow-hidden">${grid}</div>` : picture('aspect-[16/9]')}
      <p class="text-xs text-gray-500 mt-1">${esc(`${countFor('x', text)} / ${CAPTION_LIMITS.x}`)}</p></div>`;
  }
```

`src/scripts/social/composer.ts`, the preview tab row:

```ts
        <div class="flex gap-1 mb-2">${(['instagram', 'story', 'linkedin', 'x'] as const).map((k) => `<button type="button" data-pv="${k}" class="flex-1 px-2 py-1 rounded-lg border text-xs ${previewKind === k ? 'border-navy text-navy font-semibold' : 'border-border text-gray-500'}">${esc(t(`admin.social.composer.preview${k === 'instagram' ? 'Instagram' : k === 'story' ? 'Story' : k === 'linkedin' ? 'Linkedin' : 'X'}`))}</button>`).join('')}</div>
```

`src/i18n/ui.ts`: `'admin.social.composer.previewX': 'X',` in both languages.

- [ ] **Step 4: Run tests**

Run: `node --import tsx --test tests/x-connect.test.ts tests/social-requeue-refresh.test.ts tests/admin-social-i18n.test.ts`
Expected: PASS. Then `npm test`, `npx astro check`, `npm run build`.

- [ ] **Step 5: Commit**

```bash
git add functions/api/admin/connections/x functions/api/admin/social/refresh-tokens.ts src/scripts/social/preview.ts src/scripts/social/composer.ts src/i18n/ui.ts tests/x-connect.test.ts tests/social-requeue-refresh.test.ts
git commit -m "Connections: connect X with PKCE; daily X renewal; X preview in the composer"
```

---

### Task 7: README, setup and yearly upkeep

**Files:**
- Modify: `README.md`, `src/components/admin/panes/*` only if a pane's intro text says LinkedIn or X "comes later" (search `later` and `sonra` in the social and connections panes and the social intro string in `src/i18n/ui.ts`).

**Interfaces:** none.

- [ ] **Step 1: Find stale "later" wording**

Run: `grep -rn -i "later\|sonra gel\|not connected\|bağlı değil" src/components/admin src/i18n/ui.ts | grep -i -E "linkedin|x \(|twitter|platform"`
Change any sentence that says LinkedIn or X publishing comes later so it says they publish once connected (both languages).

- [ ] **Step 2: Write the README section**

In `README.md`, inside the existing "Social media and connections" section (find it with `grep -n "Social media and connections" README.md`), add after the Instagram setup paragraph:

```markdown
#### LinkedIn

Posts go out as the RSG Page through LinkedIn's Community Management API.
Access is granted per app on application; the app is "RSG-Turkiye Social"
at developer.linkedin.com, verified by the Page.

Setup, once access is approved:

1. Products tab: Community Management API shows as granted. Auth tab: the
   redirect URL `https://rsg-turkiye.iscbsc.org/api/admin/connections/linkedin/callback`
   is listed, and the scopes `w_organization_social`, `r_organization_social`
   and `rw_organization_admin` appear under "OAuth 2.0 scopes". If LinkedIn
   names them differently, change `LI_SCOPES` in `functions/_lib/social/linkedin.ts`.
2. Pages secrets, entered in a separate terminal so they never reach a
   transcript: `npx wrangler pages secret put LINKEDIN_CLIENT_ID --project-name website`
   and the same for `LINKEDIN_CLIENT_SECRET`. Then redeploy (Pages secrets
   apply only to new deployments).
3. `LINKEDIN_ORGANIZATION` in `wrangler.toml` is the Page's vanity name
   (`linkedin.com/company/<this>`).
4. Connections, Connect LinkedIn, signed in as a Page Super admin.

Tokens last 60 days. If LinkedIn issued a refresh token the daily job renews
the access token on its own and the refresh token lasts a year from the
connect; either way the admins get a mail 14, 7, 3 and 1 days before a
reconnect is needed.

#### X

Posts go out as @rsgturkey through the X API, which is pay per use: about
$0.015 per post, $0.20 for a post with a link (October 2026 prices). Credits
are bought in advance at console.x.com; saving a card there gives a one-off
credit, and a spending limit per billing cycle can be set.

Setup:

1. console.x.com, the project's app, "User authentication settings": OAuth
   2.0, type "Web App" (confidential client), permissions "Read and write",
   callback URL `https://rsg-turkiye.iscbsc.org/api/admin/connections/x/callback`,
   website `https://rsg-turkiye.iscbsc.org`.
2. Pages secrets `X_CLIENT_ID` and `X_CLIENT_SECRET` (OAuth 2.0 Client ID
   and Secret, not the API key pair), entered as above; redeploy.
3. Connections, Connect X, signed in as @rsgturkey.

The access token lasts two hours and is renewed when a post needs it and
once a day; each renewal replaces the refresh token. "No API credits" on a
failed post means the balance ran out.

#### Yearly upkeep

- LinkedIn retires each API version about a year after release: bump
  `LI_VERSION` in `functions/_lib/social/linkedin.ts` to a current `YYYYMM`
  once a year.
- At handover: reconnect LinkedIn as one of the incoming Page Super admins,
  reconnect X if the account's password changed, and keep the X card or
  credits with the incoming lead.
```

- [ ] **Step 3: Run the full checks**

Run: `npm test`, `npx astro check`, `npm run build`
Expected: all pass, 0 errors, build OK.

- [ ] **Step 4: Commit**

```bash
git add README.md src
git commit -m "README: LinkedIn and X setup, costs and yearly upkeep"
```

---

## Self-review notes (for the controller)

- Spec §5 LinkedIn step (upload images, post as organisation with alt text): Task 3. Daily LinkedIn warnings at 14/7/3/1 days: Task 4. Pluggable platforms: Task 2 registry. X (spec phase 6): Tasks 5 and 6, at the user's request.
- The `x` field of the daily endpoint is `'none'` after Task 4 and becomes live in Task 6; Task 4's tests assert `x: 'none'`, Task 6 adds the live case.
- `requeueWaitingStatement` gains a required `platform` argument in Task 2; Tasks 4 and 6 call it with `'linkedin'` and `'x'`.
- `publishErrorText` gains a required `platform` argument in Task 1; its only caller is `side-panel.ts`.
