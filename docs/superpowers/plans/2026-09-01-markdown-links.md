# Links in Outreach Mail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member put a labelled hyperlink in outreach mail by writing a small fixed subset of Markdown, without ever accepting HTML from the browser.

**Architecture:** A new pure module converts Markdown to `{ text, html }`. Its safety rests entirely on order of operations: the member's input is HTML-escaped before any pattern runs, so the only tags in the output are ones the module inserted. `buildMime` gains a `multipart/alternative` level so both halves ship. The endpoint passes the converter's output straight through and still stores the Markdown source in the log.

**Tech Stack:** TypeScript, Cloudflare Pages Functions, Astro 5 pages with inline scripts. Tests: Node's built-in `node --test` through the existing `tsx` loader. No new runtime dependency.

**Spec:** `docs/superpowers/specs/2026-09-01-rich-text-links-design.md`

## Global Constraints

- **We never accept HTML; we generate it.** Escape the entire input first, then insert only tags this code produced. No HTML parser, no sanitiser, no library that renders untrusted markup.
- Link URLs must match `https?://`. Anything else (`javascript:`, `data:`, `mailto:`, a relative path) renders as literal text, never as an anchor. This is an allowlist, not a denylist.
- The Markdown subset is exactly: `[text](url)`, bare URLs, `**bold**`, `*italic*`, `- ` bullet lists, blank-line paragraphs, single-newline line breaks. Nothing else.
- Mail goes out as `multipart/alternative` with `text/plain` first and `text/html` **last** — clients render the last part they understand.
- `sent_emails.body_snapshot` stores the **Markdown source**, not the generated HTML.
- Nested MIME boundaries must be distinct strings; a boundary reused at both levels makes the message unparseable.
- No new npm dependency.
- Every user-facing string exists in both `src/pages/account/mail.astro` and `src/pages/tr/account/mail.astro`.

## File Structure

**Create:**
- `functions/_lib/markdown.ts` — the converter. Pure, no I/O, no Workers types. Content only; transport stays in `gmail.ts`.
- `tests/markdown.test.ts`

**Modify:**
- `functions/_lib/gmail.ts` — `MimeMessage.body` becomes `{ text, html }`; `buildMime` gains the `multipart/alternative` level.
- `tests/gmail.test.ts` — fixtures updated for the new body shape; two structural tests added.
- `functions/api/mail/send.ts` — call `renderBody`, pass the result to `buildMime`.
- `src/pages/account/mail.astro`, `src/pages/tr/account/mail.astro` — a syntax hint under the body field.

---

### Task 1: The Markdown converter

**Files:**
- Create: `functions/_lib/markdown.ts`
- Create: `tests/markdown.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface RenderedBody { text: string; html: string }` and `renderBody(markdown: string): RenderedBody`.

This task is **TDD**: write the tests, watch them fail for the right reason, then implement.

- [ ] **Step 1: Write the failing test**

Create `tests/markdown.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderBody } from '../functions/_lib/markdown';

test('a labelled link becomes an anchor in html and "text (url)" in plain text', () => {
  const r = renderBody('See the [programme](https://rsg-turkiye.iscbsc.org/events) for details.');
  assert.match(r.html, /<a href="https:\/\/rsg-turkiye\.iscbsc\.org\/events">programme<\/a>/);
  assert.equal(r.text, 'See the programme (https://rsg-turkiye.iscbsc.org/events) for details.');
});

test('a bare url is linkified with itself as the label', () => {
  const r = renderBody('Details: https://example.org/x');
  assert.match(r.html, /<a href="https:\/\/example\.org\/x">https:\/\/example\.org\/x<\/a>/);
  assert.equal(r.text, 'Details: https://example.org/x');
});

test('a labelled link is not double-linkified by the bare-url pass', () => {
  const r = renderBody('[site](https://example.org)');
  assert.equal((r.html.match(/<a /g) ?? []).length, 1, 'expected exactly one anchor');
});

test('only http and https urls become links', () => {
  for (const bad of ['[x](javascript:alert(1))', '[x](mailto:a@b.com)', '[x](/relative/path)']) {
    assert.doesNotMatch(renderBody(bad).html, /<a /, bad + ' must not produce an anchor');
  }
});

test('html typed by the member is escaped, never emitted as markup', () => {
  const r = renderBody('<script>alert(1)</script> & <b>bold</b>');
  assert.doesNotMatch(r.html, /<script|<b>/);
  assert.match(r.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(r.html, /&amp;/);
});

test('a link label is escaped independently of its url', () => {
  const r = renderBody('[<b>x</b>](https://example.org)');
  assert.match(r.html, /<a href="https:\/\/example\.org">&lt;b&gt;x&lt;\/b&gt;<\/a>/);
});

test('an ampersand in a url survives into the href as an entity', () => {
  const r = renderBody('[q](https://example.org/s?a=1&b=2)');
  assert.match(r.html, /href="https:\/\/example\.org\/s\?a=1&amp;b=2"/);
  assert.equal(r.text, 'q (https://example.org/s?a=1&b=2)');
});

test('bold and italic render, and their markers are stripped from plain text', () => {
  const r = renderBody('**Sayın** *Hocam*');
  assert.match(r.html, /<strong>Sayın<\/strong>/);
  assert.match(r.html, /<em>Hocam<\/em>/);
  assert.equal(r.text, 'Sayın Hocam');
});

test('dash lines become a single list, and stay as written in plain text', () => {
  const r = renderBody('Program:\n\n- Açılış\n- Panel\n- Kapanış');
  assert.match(r.html, /<ul><li>Açılış<\/li><li>Panel<\/li><li>Kapanış<\/li><\/ul>/);
  assert.equal(r.text, 'Program:\n\n- Açılış\n- Panel\n- Kapanış');
});

test('blank lines separate paragraphs and single newlines are line breaks', () => {
  const r = renderBody('Bir\niki\n\nüç');
  assert.match(r.html, /<p>Bir<br>iki<\/p>/);
  assert.match(r.html, /<p>üç<\/p>/);
});

test('a body with no markdown at all is unchanged in the plain-text half', () => {
  const src = 'Sayın Hocam,\n\nSizi sempozyumumuza davet etmek isteriz.\n\nSaygılarımla';
  assert.equal(renderBody(src).text, src);
});

test('control characters are stripped so member input cannot forge the placeholder', () => {
  const r = renderBody('a \u00000\u0000 b [x](https://example.org)');
  assert.doesNotMatch(r.html, /\u0000/);
  assert.match(r.html, /<a href="https:\/\/example\.org">x<\/a>/);
});

test('the html half is wrapped in an html document', () => {
  const r = renderBody('hello');
  assert.match(r.html, /^<html><body>/);
  assert.match(r.html, /<\/body><\/html>$/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — `Cannot find module '../functions/_lib/markdown'`.

- [ ] **Step 3: Write the implementation**

Create `functions/_lib/markdown.ts`:

```ts
/**
 * The small Markdown subset outreach mail may use.
 *
 * The safety argument is the order of operations, not a sanitiser: every
 * character of the member's input is HTML-escaped BEFORE any pattern runs, so
 * nothing they type can become markup. The only tags in the output are ones
 * this module inserted, and the only place member input reaches an attribute
 * is an href whose value had to match an https?:// allowlist to get there.
 *
 * Deliberately no dependency and no HTML parsing — the subset is small enough
 * that a parser would be more surface than the feature.
 */

export interface RenderedBody {
  text: string;
  html: string;
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};

const MD_LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
const BARE_URL = /(^|[\s(])(https?:\/\/[^\s<)]+)/g;
const BOLD = /\*\*([^*\n]+)\*\*/g;
const ITALIC = /\*([^*\n]+)\*/g;
const PLACEHOLDER = /\u0000(\d+)\u0000/g;

/**
 * Control characters have no place in mail, and NUL in particular is the
 * marker this module parks anchors behind — stripping it means member input
 * cannot forge a placeholder.
 */
function stripControls(s: string): string {
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, c => HTML_ESCAPES[c]);
}

export function renderBody(markdown: string): RenderedBody {
  const src = stripControls(markdown);
  return { text: toPlainText(src), html: toHtml(src) };
}

/** Flatten links to "label (url)" and drop emphasis markers, leaving readable prose. */
function toPlainText(src: string): string {
  return src
    .replace(MD_LINK, (_m, label: string, url: string) => label + ' (' + url + ')')
    .replace(BOLD, '$1')
    .replace(ITALIC, '$1');
}

function toHtml(src: string): string {
  let s = escapeHtml(src);

  // Anchors are built first and parked behind placeholders so the bare-URL
  // pass below cannot reach inside an href this pass just created.
  const anchors: string[] = [];
  const park = (html: string) => {
    anchors.push(html);
    return '\u0000' + (anchors.length - 1) + '\u0000';
  };

  s = s.replace(MD_LINK, (_m, label: string, url: string) =>
    park('<a href="' + url + '">' + label + '</a>'));

  s = s.replace(BARE_URL, (_m, lead: string, url: string) =>
    lead + park('<a href="' + url + '">' + url + '</a>'));

  s = s.replace(BOLD, '<strong>$1</strong>');
  s = s.replace(ITALIC, '<em>$1</em>');

  s = blocksToHtml(s);

  s = s.replace(PLACEHOLDER, (_m, i: string) => anchors[Number(i)]);

  return '<html><body>' + s + '</body></html>';
}

function blocksToHtml(s: string): string {
  const out: string[] = [];

  for (const block of s.split(/\n{2,}/)) {
    const lines = block.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) continue;

    if (lines.every(l => l.trimStart().startsWith('- '))) {
      const items = lines.map(l => '<li>' + l.trimStart().slice(2).trim() + '</li>').join('');
      out.push('<ul>' + items + '</ul>');
    } else {
      out.push('<p>' + lines.join('<br>') + '</p>');
    }
  }

  return out.join('');
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the 26 pre-existing tests plus 13 here.

- [ ] **Step 5: Verify it type-checks**

Run: `npx astro check`
Expected: 0 errors, 0 warnings, 21 hints (the baseline).

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/markdown.ts tests/markdown.test.ts
git commit -m "Add a Markdown subset converter for mail bodies"
```

---

### Task 2: multipart/alternative in the MIME builder

**Files:**
- Modify: `functions/_lib/gmail.ts` (the `MimeMessage` interface and `buildMime`)
- Modify: `tests/gmail.test.ts`

**Interfaces:**
- Consumes: the shape of `RenderedBody` only — `gmail.ts` must NOT import from `markdown.ts`; transport does not depend on content.
- Produces: `MimeMessage.body: { text: string; html: string }`. Otherwise `buildMime`'s signature is unchanged.

This task is **TDD**: update the fixtures and add the structural tests first, watch them fail, then change `buildMime`.

- [ ] **Step 1: Update the existing fixtures and add the structural tests**

In `tests/gmail.test.ts`, the shared `base` fixture has a `body` string property. Replace that one property with:

```ts
  body: {
    text: 'Sayın Hocam,\n\nSizi davet etmek isteriz.\n',
    html: '<html><body><p>Sayın Hocam,</p><p>Sizi davet etmek isteriz.</p></body></html>',
  },
```

Add this helper immediately after the existing `decode` helper at the top of the file:

```ts
/** Pull one part's base64 payload out of a multipart message by its Content-Type. */
function partByType(mime: string, contentType: string): string {
  const marker = 'Content-Type: ' + contentType + '; charset="UTF-8"';
  const start = mime.indexOf(marker);
  assert.notEqual(start, -1, 'no ' + contentType + ' part found');
  const afterHeaders = mime.indexOf('\r\n\r\n', start) + 4;
  const end = mime.indexOf('\r\n--', afterHeaders);
  return mime.slice(afterHeaders, end === -1 ? undefined : end).trim();
}
```

Two existing tests read the body back out and must now target the plain-text part. Replace the body of `'round-trips a UTF-8 body through base64 without corruption'` with:

```ts
test('round-trips a UTF-8 body through base64 without corruption', () => {
  const mime = decode(buildMime(base));
  const part = partByType(mime, 'text/plain');
  assert.equal(Buffer.from(part, 'base64').toString('utf8'), base.body.text);
});
```

and the body of `'wraps base64 payload lines at 76 characters'` with:

```ts
test('wraps base64 payload lines at 76 characters', () => {
  const long = {
    ...base,
    body: { text: 'x'.repeat(5000), html: '<html><body><p>x</p></body></html>' },
  };
  const mime = decode(buildMime(long));
  for (const line of partByType(mime, 'text/plain').split('\r\n')) {
    assert.ok(line.length <= 76, 'line of ' + line.length + ' chars exceeds 76');
  }
});
```

Then add two new tests at the end of the file:

```ts
test('a message with no attachments is multipart/alternative, html last', () => {
  const mime = decode(buildMime(base));
  const boundary = mime.match(/multipart\/alternative; boundary="([^"]+)"/)![1];
  assert.match(mime, /^Content-Type: multipart\/alternative; boundary="/m);

  const plainAt = mime.indexOf('Content-Type: text/plain');
  const htmlAt = mime.indexOf('Content-Type: text/html');
  assert.ok(plainAt !== -1 && htmlAt !== -1, 'both parts must be present');
  assert.ok(htmlAt > plainAt, 'text/html must come after text/plain');

  assert.ok(mime.includes('--' + boundary + '--'), 'missing closing boundary');
  assert.equal(mime.split('--' + boundary).length - 1, 3, 'expected two parts plus the close');

  assert.equal(
    Buffer.from(partByType(mime, 'text/html'), 'base64').toString('utf8'),
    base.body.html,
  );
});

test('with an attachment the alternative nests inside mixed, with distinct boundaries', () => {
  const mime = decode(buildMime({
    ...base,
    attachments: [{
      filename: 'sponsorluk.pdf',
      contentType: 'application/pdf',
      base64Body: encodeAttachmentBody(new Uint8Array([1, 2, 3, 4])),
    }],
  }));

  const mixed = mime.match(/multipart\/mixed; boundary="([^"]+)"/)![1];
  const alt = mime.match(/multipart\/alternative; boundary="([^"]+)"/)![1];
  assert.notEqual(mixed, alt, 'nested boundaries must differ');

  assert.ok(mime.includes('--' + mixed + '--'), 'mixed not closed');
  assert.ok(mime.includes('--' + alt + '--'), 'alternative not closed');
  assert.equal(mime.split('--' + mixed).length - 1, 3, 'mixed: alternative + attachment + close');
  assert.equal(mime.split('--' + alt).length - 1, 3, 'alternative: plain + html + close');

  assert.match(mime, /^Content-Disposition: attachment; filename="sponsorluk\.pdf"$/m);
});
```

The second test uses `encodeAttachmentBody`; make sure it is in the file's import list from `'../functions/_lib/gmail'`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — the gmail tests now pass an object where the current `buildMime` reads a string, and there is no `multipart/alternative` in the output.

- [ ] **Step 3: Change the `MimeMessage` interface**

In `functions/_lib/gmail.ts`, in `interface MimeMessage`, replace the `body: string;` line with:

```ts
  /** Both halves of the message; see functions/_lib/markdown.ts. */
  body: { text: string; html: string };
```

- [ ] **Step 4: Rewrite `buildMime`**

Replace the whole `buildMime` function with:

```ts
export function buildMime(msg: MimeMessage): string {
  const encoder = new TextEncoder();
  const textB64 = wrap76(base64(encoder.encode(msg.body.text)));
  const htmlB64 = wrap76(base64(encoder.encode(msg.body.html)));

  const headers = [
    `From: ${safeDisplayName(msg.fromName)} <${msg.fromAddress}>`,
    `To: ${headerSafe(msg.to)}`,
    `Reply-To: ${headerSafe(msg.replyTo)}`,
    `Subject: ${encodeHeader(headerSafe(msg.subject))}`,
    'MIME-Version: 1.0',
  ];

  // Distinct prefixes guarantee the nested boundaries differ; one boundary
  // reused at both levels makes the message unparseable.
  const altBoundary = `rsg_alt_${crypto.randomUUID()}`;
  const altBody = [
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    textB64,
    `--${altBoundary}`,
    // Last wins: clients render the last part they understand.
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    htmlB64,
    `--${altBoundary}--`,
  ];

  let mime: string;

  if (msg.attachments.length === 0) {
    mime = [
      ...headers,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altBody,
      '',
    ].join('\r\n');
  } else {
    const mixedBoundary = `rsg_mix_${crypto.randomUUID()}`;
    const parts = [
      `--${mixedBoundary}`,
      `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
      '',
      ...altBody,
    ];
    for (const a of msg.attachments) {
      parts.push(
        `--${mixedBoundary}`,
        `Content-Type: ${headerSafe(a.contentType)}`,
        'Content-Transfer-Encoding: base64',
        `Content-Disposition: attachment; filename="${headerSafe(a.filename).replace(/"/g, '')}"`,
        '',
        a.base64Body,
      );
    }
    parts.push(`--${mixedBoundary}--`, '');

    mime = [
      ...headers,
      `Content-Type: multipart/mixed; boundary="${mixedBoundary}"`,
      '',
      ...parts,
    ].join('\r\n');
  }

  return base64Url(encoder.encode(mime));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, all of them.

Run: `npx astro check`
Expected: exactly one error, in `functions/api/mail/send.ts`, because it still passes a string as `body`. That error is **expected here** and Task 3 removes it. Any other error means stop and report.

- [ ] **Step 6: Commit**

```bash
git add functions/_lib/gmail.ts tests/gmail.test.ts
git commit -m "Send mail as multipart/alternative with a text and an html part"
```

---

### Task 3: Wire the converter into the send endpoint

**Files:**
- Modify: `functions/api/mail/send.ts`

**Interfaces:**
- Consumes: `renderBody` from Task 1; `buildMime`'s new `body` shape from Task 2.
- Produces: no new exports.

- [ ] **Step 1: Import the converter**

In `functions/api/mail/send.ts`, add to the imports:

```ts
import { renderBody } from '../../_lib/markdown';
```

- [ ] **Step 2: Pass both halves to `buildMime`**

Find the `buildMime({ ... })` call and change the line `body,` to:

```ts
        body: renderBody(body),
```

Leave the `sent_emails` INSERT alone. `body_snapshot` must keep storing the raw Markdown source, which is what the `body` variable still holds.

- [ ] **Step 3: Verify it type-checks and the suite passes**

Run: `npx astro check` — expected 0 errors, 0 warnings, 21 hints, back to the baseline.
Run: `npm test` — passes.
Run: `npm run build` — succeeds.

- [ ] **Step 4: Read the generated message by hand**

The endpoint cannot be sent end to end here, but the MIME it produces can be inspected. From the repo root:

```bash
npx tsx -e "
import { renderBody } from './functions/_lib/markdown';
import { buildMime } from './functions/_lib/gmail';
const raw = buildMime({
  fromAddress: 'turkey.rsg@gmail.com',
  fromName: 'RSG Türkiye',
  to: 'hoca@uni.edu.tr',
  replyTo: 'turkey.rsg@gmail.com',
  subject: 'Sempozyum daveti',
  body: renderBody('Sayın Hocam,\n\n[Programı buradan](https://rsg-turkiye.iscbsc.org) inceleyebilirsiniz.\n\n- Açılış\n- Panel'),
  attachments: [],
});
console.log(Buffer.from(raw.replace(/-/g,'+').replace(/_/g,'/'), 'base64').toString('utf8'));
"
```

Confirm in the output: one `multipart/alternative` header; a `text/plain` part before a `text/html` part; a closing boundary; and that base64-decoding the html part yields an `<a href="https://rsg-turkiye.iscbsc.org">Programı buradan</a>` and a `<ul>`. Paste what you saw into your report.

- [ ] **Step 5: Commit**

```bash
git add functions/api/mail/send.ts
git commit -m "Render mail bodies through the Markdown converter"
```

---

### Task 4: Tell members the syntax exists (EN + TR)

**Files:**
- Modify: `src/pages/account/mail.astro`
- Modify: `src/pages/tr/account/mail.astro`

**Interfaces:**
- Consumes: nothing.
- Produces: no exports.

A member who does not know the field accepts Markdown will paste a bare URL, and the feature may as well not exist.

- [ ] **Step 1: Add the hint to the English page**

In `src/pages/account/mail.astro`, find the paragraph beginning `The recipient sees only`. Immediately **before** that `<p>`, insert:

```html
          <p class="text-xs text-gray-400 -mt-1">
            Links: <code class="text-navy">[text](https://address)</code> &middot;
            bold: <code class="text-navy">**word**</code> &middot;
            bullet list: lines starting with <code class="text-navy">-</code>
          </p>
```

- [ ] **Step 2: Add the hint to the Turkish page**

In `src/pages/tr/account/mail.astro`, find the paragraph beginning `Alıcı gönderen olarak yalnızca`. Immediately **before** that `<p>`, insert:

```html
          <p class="text-xs text-gray-400 -mt-1">
            Bağlantı: <code class="text-navy">[metin](https://adres)</code> &middot;
            kalın: <code class="text-navy">**kelime**</code> &middot;
            madde listesi: <code class="text-navy">-</code> ile başlayan satırlar
          </p>
```

- [ ] **Step 3: Verify the build and EN/TR parity**

Run: `npx astro check` — 0 errors, 0 warnings, 21 hints.
Run: `npm test` — passes.
Run: `npm run build` — succeeds.

Confirm both pages gained the same number of hint paragraphs:

```bash
diff <(grep -c 'text-xs text-gray-400 -mt-1' src/pages/account/mail.astro) \
     <(grep -c 'text-xs text-gray-400 -mt-1' src/pages/tr/account/mail.astro)
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add src/pages/account/mail.astro src/pages/tr/account/mail.astro
git commit -m "Show the Markdown syntax hint on the compose page (EN + TR)"
```

---

## Final verification

- [ ] `npm test` passes, output pristine.
- [ ] `npx astro check` reports 0 errors, 0 warnings, 21 hints.
- [ ] `npm run build` succeeds.
- [ ] Task 3's hand-run MIME dump shows `multipart/alternative`, `text/plain` before `text/html`, and a working anchor in the html half.
- [ ] After deploying: send one real mail containing `[test](https://rsg-turkiye.iscbsc.org)` to a mailbox you control. Confirm the link is clickable and labelled, that the plain-text fallback (Gmail: "Show original") reads sensibly, and that `sent_emails.body_snapshot` holds the Markdown source rather than HTML.
