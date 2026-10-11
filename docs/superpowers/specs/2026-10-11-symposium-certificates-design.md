# Symposium certificates: design

Date: 2026-10-11. Status: awaiting review.

## Purpose

After a symposium, participants open the symposium site, enter their email
address, and see their certificates in a viewer they can download from as a
PDF. Today certificates are made by hand (one PNG per person, filed by name in
the org Drive) and mailed out one by one.

Success means: the organisers upload one batch after the event; every
participant whose email is on the list can open and download their
certificates for 30 days; after that both the files and the email addresses
are gone, and late requests go to turkey.rsg@gmail.com.

## Decisions taken with the organisers

- The organisers produce the certificates. The site stores and serves them;
  it does not generate them. **PDF only.**
- The upload is the PDFs plus a CSV mapping email -> file.
- **Email alone opens a certificate.** No code or link is mailed. Accepted
  knowingly: anyone who knows a participant's email can see their name and
  certificates. A rate limit slows bulk probing; it does not prevent it.
- Four kinds: participation, workshop, presentation (poster / oral),
  appreciation (speakers, organising team).
- **Kept for 30 days, then deleted** (file and email). The viewer says so
  before opening a certificate.
- PDFs are made smaller before upload, so storage stays well inside the
  Cloudflare free plan.
- The page is part of the symposium site, with a button on its home page. No
  new nav item.

## Architecture

Data, files and logic stay on the main site (`rsg-turkiye.iscbsc.org`), which
already has D1, R2, admin auth and the symposium admin pane. The symposium
site is static and gains one page that calls the main site's API from the
browser. That is the only cross-origin call the symposium site makes, so CORS
is added for exactly these endpoints and nothing else.

Rejected: giving the symposium Pages project its own Functions and bindings
(splits admin logic across two projects), and publishing the email -> file
mapping as a static file (publishes the attendee list).

```
symposium site (static)                      main site (Pages Functions)
/certificates  --POST lookup {email}------>  /api/certificates/lookup     D1
               <--[{id, kind, name, ...}]--
<iframe>       --GET-------------------->   /api/certificates/<id>.pdf   R2
build time     --GET-------------------->   /api/certificates/status     D1
admin pane     --POST pdf + headers----->   /api/admin/symposium/certificates
cron worker    --POST (secret)---------->   /api/admin/symposium/certificates/purge
```

## Data

New R2 bucket `rsg-symposium-certificates`, binding `CERTIFICATES`, private
(no r2.dev, no custom domain: r2.dev is blocked in Türkiye anyway). Object key
`<uuid>.pdf`.

D1, added to `db/schema.sql` with migration note 7l:

```sql
CREATE TABLE IF NOT EXISTS symposium_certificates (
  id TEXT PRIMARY KEY,            -- v4 UUID, also the R2 key stem
  year INTEGER NOT NULL,
  email TEXT NOT NULL,            -- trimmed, lowercased
  name TEXT NOT NULL,             -- as printed, for the result card
  kind TEXT NOT NULL CHECK (kind IN ('participation','workshop','presentation','appreciation')),
  size_bytes INTEGER NOT NULL,
  uploaded_by INTEGER NOT NULL,
  uploaded_at INTEGER NOT NULL,   -- epoch seconds
  expires_at INTEGER NOT NULL     -- uploaded_at + 30 days
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_year_email_kind ON symposium_certificates(year, email, kind);
CREATE INDEX IF NOT EXISTS idx_cert_email ON symposium_certificates(email);
CREATE INDEX IF NOT EXISTS idx_cert_expires ON symposium_certificates(expires_at);

CREATE TABLE IF NOT EXISTS certificate_lookups (
  ip_hash TEXT NOT NULL,          -- SHA-256 of CF-Connecting-IP
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cert_lookups ON certificate_lookups(ip_hash, at);
```

One certificate per (year, email, kind). Uploading the same triple again
replaces the row and deletes the old R2 object, so a corrected name is a
re-upload, and its 30 days start again.

## Admin pane

A fifth section, "Certificates", in `SymposiumPane.astro`, visible to
whoever `canManageSymposium` allows. Strings in EN and TR.

1. **Year**: defaults to the most recent edition with a start date.
2. **CSV**: header row required; columns `email,name,type,file`. Comma or
   semicolon (Excel in Turkish locale writes `;`); UTF-8, BOM tolerated.
   `type` accepts `participation|workshop|presentation|appreciation` and the
   Turkish `katılım|workshop|sunum|teşekkür`, case-insensitively.
3. **PDFs**: a multi-file input.
4. **Preview table**, one row per CSV line: email, name, kind, file,
   original size -> compressed size, status. A row is rejected, with the
   reason shown, when: the email is malformed; the type is unknown; the file
   is not among the selected PDFs; the file does not start with `%PDF-`; the
   (email, type) pair repeats in the CSV; the result is over 10 MB. Selected
   PDFs not named in the CSV are listed as unused. Rejected rows are not
   uploaded; the others can be.
5. **Upload**: one request per certificate, sequential, with a progress
   count. A failed row stays in the table with its error and can be retried.
   When the batch ends the pane calls the rebuild endpoint once.
6. **List** of stored certificates for the year: email, name, kind, size,
   deletion date, delete button. "Delete all for <year>" with a typed
   confirmation (not `confirm()`). Totals: count and MB.

### Compression (in the uploader's browser)

Workers on the free plan get 10 ms CPU per request, so PDFs cannot be
recompressed server-side. The pane does it before upload, with `pdf-lib` and
`pdfjs-dist`, both loaded by dynamic import only in this section:

1. Lossless: load and re-save with object streams.
2. If still over 1 MB and "rasterise large files" is on (default on): render
   each page with pdf.js at 200 DPI, encode JPEG at quality 0.85, and build a
   new PDF with the same page sizes. Text stops being selectable text; print
   quality is kept.
3. Keep whichever is smallest, original included. If compression throws, the
   original is used and the row says so.

## Public API (main site)

All three set `Access-Control-Allow-Origin` to the symposium origin (plus
localhost in dev) and answer `OPTIONS` preflight. They do not go through
`checkCsrf`: they are unauthenticated and the global `ALLOWED_ORIGINS` stays
as it is.

**`POST /api/certificates/lookup`** body `{email}`.
- Rate limit: 20 lookups per 10 minutes per IP hash, counted in
  `certificate_lookups`; over it -> 429 `{error:'rate_limited'}`. Rows older
  than a day are deleted by the purge.
- Malformed email -> 400. No match -> 200 `{certificates: []}`.
- Match -> `{certificates: [{id, year, kind, name, expiresAt, url}]}`,
  newest year first. Only rows with `expires_at > now`.

**`GET /api/certificates/<uuid>.pdf`**, also `HEAD`.
- Strict UUID regex; unknown or expired -> 404. The UUID is the
  authorisation, as for `/api/images`.
- `Content-Type: application/pdf`; `Content-Disposition: inline`, or
  `attachment` with `?download=1`; filename
  `RSG-<year>-<kind>-<name-slug>.pdf`.
- `Content-Security-Policy: frame-ancestors https://symposium.rsg-turkiye.iscbsc.org`
  so only the symposium page can frame it; `X-Robots-Tag: noindex`;
  `Cache-Control: private, max-age=3600`. Range requests passed through.

**`GET /api/certificates/status`**, read at build time by the symposium
site: `{years: [{year, count, expiresAt}]}` for unexpired certificates,
`expiresAt` being the latest in that year. No emails, no names.

## Admin API (main site)

Under `functions/api/admin/symposium/certificates*`, with the usual prologue
(`checkCsrf` -> `getSessionUser` -> `canManageSymposium`).

- `POST` raw PDF body; headers `X-Cert-Year`, `X-Cert-Email`,
  `X-Cert-Name` (URI-encoded), `X-Cert-Type`. Re-validates everything the
  pane checked, including `%PDF-` and the 10 MB cap.
- `GET ?year=` the list. `DELETE /<id>` one. `DELETE ?year=` all of a year.
- `POST .../rebuild` fires `triggerRebuild` once after a batch or a
  delete-all, so the home page button appears and disappears.

## Retention

`POST /api/admin/symposium/certificates/purge`, authorised by the
`X-Archive-Secret` header (same secret the archive endpoint uses). Deletes
every row with `expires_at <= now` and its R2 object, and lookup rows older
than a day; returns counts. R2 is deleted first, then the row, so a failure
leaves a row that the next run retries rather than an orphaned file.

`workers/symposium-cron` runs it every night: archive -> purge -> rebuild
symposium site -> rebuild main site. (Builds on the `WEBSITE_DEPLOY_HOOK`
change in PR #252.) The rebuild after the purge is what removes the home
page button on the day the last certificate goes.

## Symposium site

**`/certificates/` and `/tr/certificates/`.** A plain Astro page with a
`<script>`, no framework, no inline handlers.
- An email field and a button. On submit: POST lookup. Results are cards:
  year, kind, name. 429, network failure and no match each have a message;
  no match and expiry both point to turkey.rsg@gmail.com.
- Opening a card shows a `<dialog>`: "This certificate and your email
  address will be deleted from our system on <date>. Please download the
  PDF. After that date, write to turkey.rsg@gmail.com if you need it." Only
  "I understand" opens the viewer.
- Viewer: an `<iframe>` of the PDF URL, and a "Download PDF" link
  (`?download=1`) that is always visible, because Android Chrome and some
  iOS views do not render a PDF in a frame. No pdf.js on this page.
- The API base comes from `PUBLIC_API_BASE`, as the build-time overlay does.

**Home page button.** At build time the site reads
`/api/certificates/status`. If any year has certificates, a band under the
hero says "<year> certificates are ready" with a "View your certificate"
button. It does not depend on the hero's edition state, because the
edition's own CTA disappears the night it ends. If the status call fails,
the build logs a warning and shows no band.

## Free plan

- Static pages never count against the 100 000/day Functions quota
  (`_routes.json` routes only `/api/*` and `/auth/*`). When the quota runs out
  the API stops for the rest of the UTC day; nothing is billed.
- R2 reads only happen through the Function, so the daily Functions cap
  bounds them at about 3 M/month, under the 10 M free.
- Storage: a year's batch is tens of MB and lives 30 days, against 10 GB.
- **Setup step:** the free plan's one WAF rate-limiting rule goes on path
  starts with `/api/certificates/`, per IP, so floods are throttled at the
  edge before they reach the Function. Documented in the README with the
  bucket, migration and secret steps.

## Testing

- Unit (`node:test`, sqlite from `schema.sql`): CSV parsing (both
  delimiters, BOM, Turkish types, duplicates); lookup (normalisation, expiry,
  ordering, rate limit, 400/429); file route (regex, 404 on expired,
  headers, download disposition); admin upload (auth gates, `%PDF-`, size,
  replace deletes the old object); purge (secret, R2-before-row, counts);
  cron tick order; schema test passes with the new tables.
- Symposium site: route parity EN/TR, translations test, home band shown
  only with a non-empty status.
- Browser (Playwright, API stubbed): admin preview/upload/delete flow with a
  real PDF through compression; certificate page lookup -> dialog -> viewer
  -> download link, at phone and desktop width.
- By hand before release: a real upload and lookup on production with the
  organisers' own addresses, signed in, in a browser.

## Out of scope

Generating certificates; mailing them; verifying a certificate's
authenticity (QR codes); certificates for webinars or other events; any
retention period other than 30 days.
