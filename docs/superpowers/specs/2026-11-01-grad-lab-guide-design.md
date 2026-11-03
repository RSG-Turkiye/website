# Graduate programme and lab guide (Türkiye, MSc first)

Roadmap item 8. Brainstormed with the owner on 2026-11-01.

## Why

A final-year undergraduate or a new graduate who wants an MSc in
bioinformatics or computational biology has no single place to look. In
Türkiye people do not shop for a programme first. They become interested in a
professor or a lab, then apply to the programme at that professor's
university. The answer a student needs is: "the person working on what you
like is at this university; to get there, apply to this programme, in this
window."

Today that answer comes from asking around. The guide makes it searchable.

## Who it is for

A final-year undergraduate, or a recent graduate, choosing where to do an MSc
in Türkiye. Not PIs, not recruiters, not sponsors.

## Goals

- A student types a topic in Turkish or English ("protein structure",
  "sistem biyolojisi", "single cell") or a professor's name and gets the
  professors who work on it. Each result shows the lab, the university, the
  city, the matching topics, and the programme to apply to with its
  application window and the official announcement link.
- Related topics are searched too: "protein structure" also finds
  "structural bioinformatics", "docking", "AlphaFold". The page says what
  else it searched ("şunları da aradık: …").
- A city filter.
- One page per university: its programme(s) and application windows at the
  top, its labs and professors below. Clicking the university on a result
  card goes there. A university list is the second way in.
- Anyone can suggest a correction or an addition on any card or page. An
  approver accepts it in the panel and the site updates. This is also how
  application dates stay current: the first student who sees the new window
  reports it.
- A professor can ask to be removed, and is removed promptly, without
  conditions.
- Bilingual (TR/EN), like the rest of the site.

## Non-goals (first version)

- PhD programmes in the first version (added 2026-11-03; see "PhD
  programmes" at the end).
- Universities outside Türkiye.
- A visual graph or map of topics. The topic graph is the engine behind the
  search, not something drawn on the page. A map may come later.
- A page per professor. Professors appear on result cards and university
  pages only.
- Rankings, ratings, reviews, "best lab" lists, or any judgement of a
  professor or programme.
- Applying through RSG. The guide links to the official announcement; RSG
  stores nothing about applicants.

## Anti-goals (would be a failure even if it works)

- Mailing professors automatically. (The one courtesy mail at launch is not
  automatic: a person presses send on a mail merge; see Owner's answers.) A courtesy
  "you are listed" e-mail, if sent, is drafted by the site and sent by a
  person (CLAUDE.md rule 5).
- Publishing contact data. No e-mail address, phone number or photo of a
  professor appears on the site or in the repository. Contact goes through
  the professor's own official profile or lab page.
- Using the guide's data for anything except helping students find
  supervisors and programmes. Never for bulk e-mail, newsletters, sponsorship
  outreach or event invitations. (See "Legal basis" below: using publicly
  available professional data outside the purpose it was made public for is
  exactly what KVKK decision 2022/861 found unlawful.)
- Leaking the private source sheet. The Drive sheet the first list comes from
  also holds e-mail addresses, phone numbers, notes and an internal "RSG
  interest level" column. None of these ever reach the public repository, a
  pull request, a commit message or an issue.
- Stale information presented as current. Every record shows where it came
  from and when it was last checked.
- Search that depends on the server or D1. It must work from a static file in
  the browser.

## Legal basis (research notes, not legal advice)

The owner accepted the risk with the measures below, without a separate legal
review (2026-11-01).

- KVKK art. 5(2)(d): data the person has made public themselves may be
  processed without explicit consent. Name, title, university, department and
  research topics are published by the professors and their universities for
  academic visibility.
- KVKK Board decision 2022/861 (kvkk.gov.tr/Icerik/7580/2022-861): public data
  may be processed only in connection with, and limited to, the purpose for
  which it was made public. Helping students find supervisors fits that
  purpose; harvesting addresses for marketing did not.
- KVKK principle decision 2026/1301 (RG 28.07.2026/33323), addressed to public
  bodies but stating the general principles: a valid processing condition,
  the minimum data needed for the purpose, a defined retention period, an
  information notice under art. 10, and security measures.
- Constitutional Court 2020/32193 (27.01.2026) found a violation of the
  legality principle in a KVKK fine in a similar fact pattern; it concerns
  the fine's legal basis, not a licence to use public data for other
  purposes.

The measures that follow from this:

1. **Purpose** stated at the top of the guide and in the privacy notice: the
   guide exists so students can find supervisors and programmes.
2. **Minimum data**: title, name, university, department, topics, lab name,
   lab link, official profile link (university page, ORCID or OpenAlex).
3. **Source and date** on every professor record.
4. **Retention**: a record whose source has gone (the professor left or
   retired) is removed. A yearly check finds them (see Upkeep).
5. **Information notice**: a paragraph in `src/data/privacy.ts` (the privacy
   notice is admin-approved in the CMS), linked from the guide.
6. **Removal on request**, unconditional and quick.

## Decided

### How a student uses it

- **Search page** (the main way in): one search box and a city filter.
  Results are **professor cards**, best match first (the owner chose this
  over grouping by university, so the most relevant professor is never
  buried under a second university). A card shows: title and name, lab name
  (linked to the lab site), university and city (linked to the university
  page), the topics that matched, and a box with the programme to apply to,
  its application window and the announcement link. If the window is
  unknown, the box says so and invites a correction.
- **University page**: programme(s) with windows and announcement links on
  top; labs and professors with their topics below.
- **University list**: by city, linking to the university pages.
- Every card and page has "Düzeltme öner / Suggest a correction" and the
  guide has "Listeden çıkmak istiyorum / Remove me".

### The data

Three linked kinds of record: **university → programme**, **university →
lab → professor**. A professor belongs to a university and usually to a lab;
a programme belongs to a university. The card's "apply here" box shows the
programme(s) of the professor's university that a professor in that
department would supervise in.

Programme fields (minimum): name (TR/EN), institute (enstitü), university,
type (MSc now; PhD later), usual application months, announcement URL,
academic calendar URL (optional), last checked date, source URL, and an
exact window only when someone reported it.

**No maintained exact dates (owner, 2026-11-01).** The card shows "usually
takes applications in <months>" plus the official announcement link; the
student reads the exact dates there. An exact window reported through the
form is shown until its closing date, then hidden automatically.

### Change watch (owner, 2026-11-01)

Parsing 40 universities' calendars is too fragile, so the site does not try
to read dates. Instead a weekly watch fetches each programme's announcement
page and calendar page, reduces it to its main text, and compares a
fingerprint with last week's. When it changed, a queue item appears: "<the
programme>'s page changed; a new window may be open." A person opens the
link and enters what they see. A page that keeps raising false alarms can be
muted from the panel. (Later, optionally: a model drafts the new dates from
the changed page, still for a person to approve. Not in the first version.)

If nobody handles a change for 10 days, the guide says so in public (owner,
2026-11-01): every programme using that page shows "this page changed around
<date> and this entry has not been updated; do not rely on it, check the
announcement yourself" on the search cards and the university page. The
nightly watch republishes the index, so the warning appears without anyone
acting; marking the queue row done or discarded lifts it at once. A muted
page never warns.

Lab fields: name, university, URL, professors.

Professor fields: title, name, university, department, lab, official profile
URL, OpenAlex author id (if matched), hand-entered topics, last checked date,
source.

### Topics and search

- **Base topics come from OpenAlex** (the free scholarly index) for each
  matched professor, from their publications.
- **Hand-entered topics** (from the source sheet's research-area column, the
  professor, or an approver) are added on top and **always win**: they are
  shown first, and an approver can hide a wrong OpenAlex topic.
- **Related topics** come from a synonym/related-terms table (TR and EN), so a
  query expands before matching. It is data, editable like the rest.
- The professor list, their topics and the related-terms table are published
  as **one static JSON file** (see "Where the records live"). The search runs
  entirely in the browser. No D1, no Function call per keystroke.

### Where the records live (CLAUDE.md rules 3 and 4)

Professor names are personal data, and a removed professor's name must not
survive anywhere. Git history cannot be deleted, so **professor and lab
records never go into git**, not as content files, not in PRs, not in
fixtures. Programmes are institutional, not personal.

- **Programmes** (university, programme, institute, windows, links) are an
  ordinary CMS content collection in git, edited through the Rehber group
  like any other type.
- **Professors and labs** live in D1, edited and approved in the panel
  (Rehber group), with every change audited. Deleting a record deletes the
  row.
- After an approved professor/lab change, a scheduled job rebuilds the
  **search index JSON** (professors, labs, topics, related terms, and the
  programme data it needs) and writes it to R2. The site serves it through
  its own domain with caching (never an `r2.dev` URL). Pages read it in the
  browser; university pages fetch the same file. If D1 is over its daily
  limit, the last published index keeps serving.
- The one-off seed from the Drive sheet is converted outside the repository
  and loaded straight into D1 by the owner (a remote D1 write), never
  committed.
- University pages therefore render their professor/lab list from the index
  in the browser, not at build time. Programme content still renders at
  build time from git.

### Where the first data comes from

- **Professors**: the Drive sheet
  `RSG_Turkey/Chair/RSG_Turkey_Akademisyenler_Kapsamli` (97 people, 40
  universities on 2026-11-01). Only title, name, university, department and
  research areas are carried over. E-mail, phone, notes and the RSG interest
  column are dropped in the conversion, which runs outside the repository.
- **Programmes, labs and lab links**: a one-off web research pass, done by the
  agent before launch: for each of the 40 universities, the bioinformatics or
  closely related MSc programme(s), their institute, announcement page and
  usual application months; for each professor, lab name, lab URL and
  OpenAlex match. Anything uncertain (no programme found, ambiguous OpenAlex
  match, no lab page) goes to the owner as a list to decide, not guessed.

### Corrections, additions and removal

- **Intake is a Google Form** (owner rule: all intake is Google Forms → a
  Sheet owned by turkey.rsg is the source of truth → scheduled import into
  the admin queue; never a D1-only form). One form covers: correct a record,
  add a professor or lab, add or update a programme or window, remove me.
  The link from a card or page pre-fills which record it is about.
- **Import**: a scheduled job reads new Sheet rows (nightly, idempotent,
  keyed by response timestamp and row) into the panel's approval queue.
  Removal requests are marked urgent in the queue.
- **Approval**: programme changes go through the existing CMS flow
  (approve → pull request → auto-merge on green checks). Professor and lab
  changes are approved in the same panel queue but written to D1, then the
  index is republished (no PR). Both sit in a **new CMS group, "Rehber"**,
  with edit and approve rights given like the other groups (expirable roles).
- **Removal** deletes the professor's D1 row (not a hidden flag) and
  republishes the index. Their name must not remain on the site, in R2, or in
  the import queue; the Form response row in the Sheet is deleted by the
  approver after handling. The audit row keeps only an id and the action.

### Upkeep

- OpenAlex topics are refreshed on a schedule (a Worker cron, never a
  GitHub `schedule:`), written to D1, and the index is republished.
- **Every September** the panel lists records not checked for a year.
  Records whose source no longer exists are removed.
- Exact dates are not maintained (see "No maintained exact dates"); the
  weekly change watch tells a person when an announcement page changed.

## Constraints

- Public repository. Nothing from the private sheet beyond the five public
  columns; no personal data in PR bodies or commit messages (CMS rule).
- Cloudflare free tier: D1 5M row reads a day; Pages builds run one at a
  time. The search must be static. A build must **not fail** because
  OpenAlex is slow or down.
- `pages.dev`, `r2.dev`, `workers.dev` are blocked in Türkiye; never link
  them.
- Forms stay Google Forms (see above).
- Bilingual UI strings in `src/i18n/ui.ts`; content with TR/EN pairs follows
  the existing translation rules.
- Visual work is shown to the owner (live local preview link, several window
  sizes, no inner scrollbars) before any push; no generic "AI-looking"
  design.
- Every admin-panel action writes an audit row with a label in
  `src/lib/audit-labels.ts`.

- Professor records are invisible to search engines by construction (they
  load in the browser from the index, never from git). This is deliberate
  (rule 4); do not "fix" it by committing the data.

## Calls made while writing this (check these)

- **MSc only** in the first version; PhD added 2026-11-03 via the programme `type` field (see "PhD programmes").
- **No professor pages.**
- **Professors and labs in D1 + a published R2 index, not in git** (forced
  by CLAUDE.md rule 4; in conversation I had said "compiled at build time").
- **OpenAlex topics refreshed by a Worker cron into D1**, not fetched during
  Pages builds, so builds never depend on OpenAlex.
- **Removal deletes the record** rather than hiding it.
- **"Rehber"** as the CMS group name.
- The Google Sheet → admin-queue import does not exist yet. It is the same
  primitive the membership application, speaker form and event-submission
  form need (roadmap). It should be built once, generically, here.

## Left to the builder

- The programme collection's file layout and zod schema; the D1 tables for
  professors and labs (with the migration note in `db/schema.sql`); the
  index file's shape and when exactly it is republished.
- The search algorithm (token matching, Turkish case folding, stemming,
  ranking) and the shape of the static index, within "runs in the browser
  from one file".
- How the related-terms table is seeded (from OpenAlex's topic hierarchy,
  by hand, or both).
- Which Worker cron runs the Sheet import, the OpenAlex refresh and the
  index publish (nightly `symposium-cron` is the natural home; the per-minute
  tick must not gain D1 scans).
- How the form's pre-filled link identifies a record.
- Page URLs (`/guide`, `/rehber`, …) consistent with the site's TR/EN
  routing.

## Builder check answers (2026-11-01, my calls unless marked)

- **Professor → programme link.** Each professor stores an explicit list
  of programme ids (the seed research proposes it; an approver can change
  it). If the list is empty, the card shows all of that university's guide
  programmes with "which programme? suggest a correction".
- **Universities are their own git collection** (institutional data, rule 4
  allows it): slug, TR/EN name, city, official URL. Programmes reference a
  university. A university with no programme found still gets a page:
  "no bioinformatics MSc found yet — suggest one", with its labs and
  professors.
- **Programme data reaches the browser from the build, not the index.** The
  Pages build emits a static universities+programmes JSON. The R2 index
  holds only professors, labs, topics and related terms, with university and
  programme ids. The browser joins the two. A programme PR is live after its
  deploy; the index never needs a programme refresh.
- **Sheet access**: a Google service account with read access to the
  response Sheets; its key is a secret the owner sets (rule 7). The reader is
  one generic module that takes a Sheet id and a column mapping, so the
  membership and speaker forms reuse it. The owner creates the Form and Sheet
  under turkey.rsg from a field list in the plan.
- **The seed is part of the plan**, as its first task: the research pass
  produces a file outside the repository in the D1 tables' shape plus the
  programme/university JSON for git, and a list of open questions for the
  owner. The owner loads the D1 part with a remote write.

## Owner's answers (2026-11-01)

- **Courtesy e-mail: yes.** Once, at launch, to each listed professor. The
  tone: "you are listed like this; if anything is wrong, correct it here; if
  you want to be removed, we remove you." Sent with a Gmail mail merge from
  a Drive sheet (addresses come from the private Drive sheet, never from the
  site); a person presses send once (rule 5). The site stores no address.
- **Applying suggestions: the simple way. Human approval matters.** The
  queue shows the suggestion next to the record's editor; the approver makes
  the change and saves. A removal request is one click to apply. Nothing is
  applied from a form row automatically.
- **Backups (owner raised it).** D1 Time Travel covers the last 7 days with
  no work. In addition, the nightly cron writes the professor and lab tables
  to a file in a **private R2 bucket** (changed from a Drive folder after
  review: a service account cannot own files in a personal Google Drive,
  and turkey.rsg is not a Workspace account) and keeps the **last 30 nights**,
  deleting older files, so a removed professor leaves the backups within 30
  days. The privacy paragraph says so. These backups never go to git or the
  private archive repo.

## Page design and city map (owner, 2026-11-01)

The owner asked for a map of where the universities are, and a page that is
"simple and usable, and excellent". The design was argued out by a small
review panel (an undergraduate, a new graduate, a listed professor and an
outside designer). These are its decisions.

- **Results are grouped by university.** The programme, its status and any
  page-changed warning are told once per group, not on every professor.
  Groups follow their best topic match; inside a group professors are
  verified first, then by name. Never by score: an automatic topic match is
  not a ranking of people.
- **Universities with no programme in the guide come last**, under their own
  heading, so the first thing a reader sees is never an empty apply block.
- **Unverified professors stay visible**, last in their group, with a plain
  "not confirmed on an official page" tag. Whether to list them at all is a
  data decision for the owner.
- **A status is claimed only from an exact window** entered in the CMS
  ("Applications open, closing 15 December"; "Applications open on 3
  January"). Otherwise the block says "No exact date yet; usually takes
  applications in October, November" and when it was last checked. The
  programme's real name is the link to its announcement. One renderer
  (`src/lib/guide-apply.ts`) draws this on every page, in the browser, so the
  status follows today's date rather than the build's.
- **One line above the results** says that applications go to the programme,
  not the professor, and that the order comes from automatic topic matching,
  not an assessment. Chips say they are derived from publications
  (OpenAlex), at most five, matched first, one per spelling.
- **"Before you write to a professor"**: a short static note under the
  results (apply to the programme first; read their recent work; say which
  work and why).
- **The city map** is inline SVG drawn at build time from a Natural Earth
  outline (`scripts/guide-map-outline.ts`), with no tiles, library or fetch.
  One marker per city, all the same size, no numbers on the map; a city
  whose universities have no programme yet is drawn faded, not hidden.
  Tapping a city sets the city filter (it is a link to `?city=`, so it works
  without JavaScript); while a search is active, cities with no match fade.
  On a phone the map shows only while nothing is searched. The universities
  page uses the same map to jump to its city sections, with counts in the
  headings there.
- The podcast bar is hidden on guide pages: it covered the apply blocks on
  phones.
- Not now: reminders or calendar files, an "open this month" view, paper
  lists, ALES or language requirements, housing and scholarships, professor
  self-descriptions, counts or clustering on the map.

## PhD programmes (owner, 2026-11-03)

- A programme's `type` is `msc` or `phd`. A PhD names the MSc it continues
  (`mscId`, same university); a PhD is not added without one.
- Programme level only. The guide never marks a professor as a PhD
  supervisor: under YÖK rules that depends on conditions the guide cannot
  check (for example having supervised an MSc thesis). Every PhD apply block
  says so: "PhD supervision has its own conditions."
- Not every professor takes students every term, at MSc or PhD level. This
  is said once, not on every card: in the note above the results ("ask
  before you write") and as the first "before you write" step ("ask whether
  they are taking students this term").
- A PhD shows in a result group right after its MSc, and only when that MSc
  shows. The university page lists each MSc followed by its PhD.
- Same evidence rule as everything else: a PhD is listed only when an
  official page shows it admits students today.
- The nav link is "Lisansüstü Rehberi" / "Graduate Guide" (was "YL Rehberi"
  / "MSc Guide"); the URL stays `/guide`.
