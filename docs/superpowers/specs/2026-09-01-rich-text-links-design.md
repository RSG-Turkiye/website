# Links in outreach mail — Design

## Problem

Mail sent through `/account/mail` is plain text. The original design chose that
deliberately: accepting HTML from a browser form and sending it under RSG's name
means owning an HTML sanitisation problem, and the outreach did not obviously
need one.

It does. An invitation to a symposium carries a link to the programme, a
sponsorship approach carries a link to the prospectus. Pasting a bare URL works
but reads badly and cannot label what it points at — "the programme is here:
https://rsg-turkiye.iscbsc.org/events/…" instead of a link on the word
*programme*. This reverses the plain-text decision for links specifically, and
does it in a way that does not reintroduce the sanitisation problem.

## The key idea

**We never accept HTML. We generate it.**

The member writes a small, fixed subset of Markdown. The server escapes the
input completely, then inserts only tags it produced itself. There is no path
by which a character the member typed becomes markup — so there is no
sanitisation to get wrong, and no dependency whose escaping behaviour we would
have to audit.

## Goals

1. Let a member write a link with its own anchor text, plus light emphasis and
   lists, using Markdown in the same body field they already use.
2. Send `multipart/alternative`, so a recipient whose client shows plain text
   gets a readable message with the URLs visible.
3. Keep the stored `body_snapshot` the Markdown source — what the member wrote,
   not what we generated.
4. Add no runtime dependency and no HTML parsing.

## Out of scope

- **A rich-text (WYSIWYG) editor.** It would mean accepting HTML from the
  browser, which is exactly what this design avoids.
- **Images in the body.** Inline images need CID attachments or remote hosting;
  outreach mail does not need them, and remote images trip spam filters.
- **Tables, headings, blockquotes, code blocks.** Not what outreach mail is.
  The subset stays small on purpose — every construct is one more thing that can
  render wrongly in a recipient's client.
- **A live preview.** Genuinely useful and deliberately deferred; see
  "Follow-ups".
- **Markdown in the subject.** Subjects are plain text in every mail client.

## 1. The Markdown subset

Exactly these, and nothing else:

| Written | Becomes |
|---|---|
| `[text](https://url)` | a link labelled *text* |
| `**bold**` | bold |
| `*italic*` | italic |
| lines starting `- ` | a bullet list |
| blank line | a paragraph break |
| single newline | a line break |

A bare URL on its own is also linkified, since members will paste them out of
habit and a dead-looking URL in an otherwise-linked message is worse than
either extreme.

Anything else the member types — including `<`, `>`, `&`, and any HTML they
paste — is escaped and appears literally. `<b>hello</b>` arrives as the text
`<b>hello</b>`, which is the correct and predictable outcome.

**Link URLs are restricted to `http://` and `https://`.** A `[click](javascript:…)`
or `data:` URL is rendered as plain text, not as a link. This is the one place
member input reaches an HTML attribute, so it gets an explicit allowlist rather
than a denylist.

## 2. The converter — `functions/_lib/markdown.ts`

A new module, roughly sixty lines, exporting one function:

```ts
export function renderBody(markdown: string): { text: string; html: string }
```

It is a separate module from `gmail.ts` for the same reason `mail.ts` is:
`gmail.ts` is transport, this is content, and a pure string-to-string function
is the easiest thing in the system to test exhaustively.

Order of operations, which is the whole safety argument:

1. Escape `&`, `<`, `>`, `"` in the entire input. After this step no character
   in the string can be interpreted as markup.
2. Apply the subset's patterns, inserting tags. Each pattern validates its own
   capture — a link's URL must match `^https?://` or the pattern does not fire.
3. Wrap paragraphs.

The `text` half is the Markdown source with links flattened to
`text (https://url)` and `**`/`*` markers stripped, so the plain-text
alternative reads as prose rather than as source code.

## 3. MIME structure — `functions/_lib/gmail.ts`

`buildMime` currently emits either a bare `text/plain` part or a
`multipart/mixed` of `text/plain` plus attachments. Both grow one level:

```
no attachments:     multipart/alternative
                      ├── text/plain
                      └── text/html

with attachments:   multipart/mixed
                      ├── multipart/alternative
                      │     ├── text/plain
                      │     └── text/html
                      └── attachment…
```

`text/html` comes last inside `alternative` — the order is significant, clients
display the last part they can render.

`MimeMessage.body: string` becomes `body: { text: string; html: string }`,
which is what `renderBody` returns, so the endpoint passes it straight through.
Nested boundaries get distinct random strings; a boundary that appears in both
levels makes the message unparseable.

## 4. Compose page — both languages

The body field gets a one-line hint under it naming the three things worth
knowing: `[metin](https://adres)` for links, `**kalın**`, and `- ` for lists.
Not a syntax reference — the aim is that someone who has never written Markdown
can still put a link in, and everyone else already knows the rest.

The existing sign-off hint stays; the two lines sit together.

## 5. What is stored

`sent_emails.body_snapshot` keeps the **Markdown source**. It is what the member
wrote and what they would recognise; the HTML is a derived artifact we can
regenerate. This also means the log stays readable in a terminal.

## Testing

`tests/markdown.test.ts`, run by the existing `npm test`:

- each construct in the subset renders, with the exact expected HTML
- `<script>alert(1)</script>` in the body appears escaped in the HTML output and
  produces no tag
- `[x](javascript:alert(1))` and `[x](data:text/html,…)` render as text, not links
- a link's anchor text is escaped independently of its URL
- the `text` half flattens a link to `text (url)` and strips emphasis markers
- a body with no Markdown at all round-trips unchanged into both halves

`tests/gmail.test.ts` gains:

- `multipart/alternative` structure with no attachments: both parts present,
  `text/html` last
- nested `multipart/mixed` → `multipart/alternative` with an attachment, with
  distinct boundaries at each level and every boundary correctly closed

## Follow-ups, deliberately not in this change

- **A preview.** Sending a professor a malformed link is a real failure and a
  preview would catch it. It needs either a client-side renderer (a second
  implementation of the subset, which would drift from the server's) or a
  round-trip endpoint. Worth doing; worth doing separately, and with the server
  as the single renderer.
- Existing rows keep plain-text bodies. Nothing migrates; old sends are simply
  not links.
