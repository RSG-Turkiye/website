-- RSG Turkey Member Platform Schema
-- Apply with: wrangler d1 execute rsg-members --file=db/schema.sql
-- REQUIRED: run ALL of the numbered migrations below against production BEFORE
-- deploying this branch:
--
-- 1. functions/api/admin/users.ts unconditionally SELECTs is_announcer;
--    deploying without this first will break the existing admin user list
--    (D1 "no such column: is_announcer" error). ALTER TABLE ADD COLUMN is
--    not idempotent, so this intentionally lives here as a note rather
--    than as a statement in this file:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_announcer INTEGER NOT NULL DEFAULT 0"
--
-- 2. This file's `CREATE TABLE IF NOT EXISTS announcements` statement
--    below is NOT applied to production automatically by any deploy step
--    -- it must be run by hand (`IF NOT EXISTS` makes it safe to re-run):
--      wrangler d1 execute rsg-members --remote --command="CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL, button_text TEXT NOT NULL, button_url TEXT NOT NULL, show_as_popup INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), created_at INTEGER NOT NULL)"
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON announcements(expires_at)"
--    Without this, every write to /api/admin/announcements (create/edit)
--    500s with a raw Cloudflare "Worker threw exception" error page
--    instead of a JSON error -- which surfaces client-side as the Save
--    button silently doing nothing (the client's error handler calls
--    res.json() on a non-JSON error body and throws uncaught).
--
-- 3a. functions/api/admin/users.ts ALSO now unconditionally SELECTs
--     is_writer; skipping just this line while running 3b below breaks
--     the existing admin user list the same way item 1 describes.
--     ALTER TABLE ADD COLUMN is NOT idempotent -- do not re-run this one:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_writer INTEGER NOT NULL DEFAULT 0"
--
-- 3b. This file's `CREATE TABLE IF NOT EXISTS blog_submissions` statement
--     below is NOT applied to production automatically -- it must be run
--     by hand (`IF NOT EXISTS` makes these two safe to re-run):
--       wrangler d1 execute rsg-members --remote --command="CREATE TABLE IF NOT EXISTS blog_submissions (id TEXT PRIMARY KEY, submitted_by TEXT NOT NULL REFERENCES users(id), lang TEXT NOT NULL CHECK (lang IN ('en', 'tr')), title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]', author TEXT NOT NULL, image_url TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, slug TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')), rejection_reason TEXT, pr_url TEXT, paired_submission_id TEXT REFERENCES blog_submissions(id), created_at INTEGER NOT NULL, reviewed_at INTEGER, reviewed_by TEXT REFERENCES users(id))"
--       wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS idx_blog_submissions_status ON blog_submissions(status)"
--     Without 3b, /api/blog-submissions and /api/admin/blog-submissions
--     500 with "no such table: blog_submissions".
--
-- 4a. functions/api/admin/users.ts (Task 6) unconditionally SELECTs
--     is_sender; deploying that without this first breaks the admin user
--     list with D1 "no such column: is_sender". ALTER TABLE ADD COLUMN is
--     NOT idempotent -- do not re-run this one:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_sender INTEGER NOT NULL DEFAULT 0"
--
-- 4b. This file's sender_grants / sent_emails / mail_attachments tables
--     below are NOT applied by any deploy step -- run them by hand
--     (`IF NOT EXISTS` makes these safe to re-run):
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     Without this, every /api/mail/* and /api/admin/senders request 500s
--     with "no such table: sent_emails".
--
-- 5.  This file's `scheduled_emails` table below is NOT applied by any deploy
--     step -- run it by hand before deploying (`IF NOT EXISTS` makes it safe
--     to re-run):
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     Without this, /api/mail/scheduled and /api/mail/dispatch 500 with
--     "no such table: scheduled_emails".
--
-- 6a. functions/_lib/compose.ts now writes sent_emails.gmail_thread_id on
--     every send. Deploying that without this column first does NOT fail the
--     send: sendAndLog catches the D1 "no such column: gmail_thread_id" error
--     from insertLog on its own, so the mail still goes out -- but the catch
--     is silent, so the sent_emails row for that recipient is simply never
--     written, with no error surfaced anywhere. ALTER TABLE ADD COLUMN is NOT
--     idempotent -- do not re-run this one:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE sent_emails ADD COLUMN gmail_thread_id TEXT"
--
-- 6b. This file's mail_threads / mail_messages / mail_sync_state tables below
--     are NOT applied by any deploy step -- run them by hand (`IF NOT EXISTS`
--     and `INSERT OR IGNORE` make this safe to re-run):
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     Without this, /api/mail/sync and /api/mail/conversations 500 with
--     "no such table: mail_threads". Sending mail still succeeds, though:
--     compose.ts's attempt to register the thread hits the same missing
--     table, but that catch is silent too, so the conversation is simply
--     never registered with no error surfaced anywhere.
--
-- 7a. functions/api/admin/symposium routes unconditionally SELECT is_symposium;
--     deploying without this first does NOT throw -- getSessionUser does
--     SELECT * FROM users, so the column is simply absent and
--     canManageSymposium reads false for every non-admin. The symptom is a
--     pane that never appears for the person you granted the role to, which
--     is far harder to diagnose than a 500. ALTER TABLE ADD COLUMN is NOT idempotent --
--     do not re-run this one:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_symposium INTEGER NOT NULL DEFAULT 0"
--
-- 7b. The announcements table needs a site column. This is NOT optional and
--     NOT only a CMS nicety: functions/api/announcements.ts -- the public
--     main-site endpoint every visitor hits -- now filters
--     `WHERE expires_at > ? AND site = 'main'`. Skip this and announcements
--     break for everyone, not just for editors.
--     Run it if the announcements table already exists and has no site
--     column; skip it only on a database where announcements was created
--     fresh from this file (which declares the column). ALTER TABLE ADD
--     COLUMN is NOT idempotent, so it errors rather than no-ops on a rerun:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE announcements ADD COLUMN site TEXT NOT NULL DEFAULT 'main'"
--
-- 7c. This file's four symposium tables below are NOT applied by any deploy
--     step -- run them by hand (`IF NOT EXISTS` makes these safe to re-run):
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     Without 7c, every /api/admin/symposium route 500s with a raw "Worker
--     threw exception" page rather than JSON, which surfaces in the panel as
--     a Save button that does nothing. (7a fails differently -- see above.)
--
-- 7e. The two symposium slug indexes below are UNIQUE and created with
--     IF NOT EXISTS, so unlike 7d they are ordinary statements in this file
--     and re-running the schema applies them. Neither table has been written
--     to yet, so there are no duplicates to clean up first. If that ever
--     stops being true, the CREATE fails loudly rather than silently
--     dropping a row -- deduplicate by hand, then re-run.
--
-- 7f. Granting is_symposium has no UI: functions/api/admin/users.ts knows
--     about is_announcer, is_writer and is_sender only, so the admin user
--     list can neither show nor set this role. Until that is added, the
--     symposium pane is reachable by is_admin accounts and by nobody else
--     unless you grant it by hand:
--       wrangler d1 execute rsg-members --remote --command="UPDATE users SET is_symposium = 1 WHERE email = 'someone@example.com'"
--
-- 7g. The mail queue's exactly-once columns. Both are nullable and additive,
--     so existing rows keep working; a queue row with no claimed_at is simply
--     unclaimed, and a sent_emails row with no scheduled_id predates this.
--     ALTER TABLE ADD COLUMN is NOT idempotent -- do not re-run:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE scheduled_emails ADD COLUMN claimed_at INTEGER"
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE sent_emails ADD COLUMN scheduled_id TEXT"
--
-- 7h. The dispatch_runs table below is new and created with IF NOT EXISTS, so
--     re-running this file applies it and nothing else has to change. It must
--     exist before the dispatch code that writes to it deploys, or every tick
--     logs nothing -- the writes are wrapped and swallowed, so mail still
--     goes out, but the diagnostics the table exists for are silently absent:
--       wrangler d1 execute rsg-members --remote --file=db/schema.sql
--     or, to add just this table:
--       wrangler d1 execute rsg-members --remote --command="CREATE TABLE IF NOT EXISTS dispatch_runs (id TEXT PRIMARY KEY, started_at INTEGER NOT NULL, finished_at INTEGER, candidates INTEGER, planned INTEGER, sent INTEGER, failed INTEGER, retried INTEGER, already_sent INTEGER, held TEXT, error TEXT, phase TEXT)"
--
-- 7i. `phase` was added to dispatch_runs the same evening, once the table had
--     shown that ticks were dying but not where. On a database that already
--     has the table from 7h, ADD COLUMN is the migration -- and it is NOT
--     idempotent, so do not re-run it:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE dispatch_runs ADD COLUMN phase TEXT"
--

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  is_member     INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_announcer  INTEGER NOT NULL DEFAULT 0,
  is_writer     INTEGER NOT NULL DEFAULT 0,
  is_sender     INTEGER NOT NULL DEFAULT 0,
  is_symposium  INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  last_login    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  username      TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  institution   TEXT,
  card_template TEXT NOT NULL DEFAULT 'default',
  bio           TEXT,
  is_public     INTEGER NOT NULL DEFAULT 1,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS user_badges (
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge    TEXT NOT NULL CHECK (badge IN (
    'open_to_work',
    'open_to_collaborate',
    'open_to_mentor',
    'seeking_mentor',
    'open_to_review'
  )),
  PRIMARY KEY (user_id, badge)
);

CREATE TABLE IF NOT EXISTS user_interests (
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest  TEXT NOT NULL CHECK (interest IN (
    'Genomics',
    'Transcriptomics',
    'Single-cell Analysis',
    'Spatial Transcriptomics',
    'Metagenomics',
    'Microbiome',
    'Structural Biology',
    'Proteomics',
    'ML & AI',
    'Drug Discovery',
    'Evolutionary Biology',
    'Phylogenetics',
    'Epigenetics',
    'Variant Analysis',
    'Bioinformatics Education'
  )),
  PRIMARY KEY (user_id, interest)
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS progress (
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resource_id  TEXT NOT NULL,
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER,
  PRIMARY KEY (user_id, resource_id)
);

-- Growth rank: Tohum/Seed -> Filiz/Sprout -> Fidan/Sapling -> Çınar/Legacy Tree.
-- Insert-only log, never updated or deleted. A user's current rank is always
-- the highest rank_ordinal ever recorded for them (see idx below) -- this is
-- what makes rank a high-water mark: a later drop in activity can only add a
-- lower-ordinal row, which never changes the MAX(), so rank can't regress.
-- The score behind each entry is computed in application code from a blend
-- of learning-path progress, event/project participation, and community
-- contribution; the weighting between those is intentionally not encoded
-- here so it stays tunable without a schema change.
CREATE TABLE IF NOT EXISTS rank_history (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rank         TEXT NOT NULL CHECK (rank IN ('seed', 'sprout', 'sapling', 'legacy_tree')),
  rank_ordinal INTEGER NOT NULL CHECK (rank_ordinal BETWEEN 1 AND 4),
  reason       TEXT,
  computed_at  INTEGER NOT NULL
);

-- Pipeline: rare, unordered specialty badges for demonstrated bioinformatics
-- skills. Independent of Growth rank -- earning one has no bearing on rank,
-- and they aren't earned in any particular sequence. Catalog is meant to
-- grow (RNA-seq, metagenomics, phylogenetics, ...) without implying an order.
CREATE TABLE IF NOT EXISTS achievement_badges (
  code        TEXT PRIMARY KEY,
  name_en     TEXT NOT NULL,
  name_tr     TEXT NOT NULL,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_achievement_badges (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code TEXT NOT NULL REFERENCES achievement_badges(code),
  awarded_at INTEGER NOT NULL,
  awarded_by TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, badge_code)
);

INSERT OR IGNORE INTO achievement_badges (code, name_en, name_tr, description) VALUES
  ('variant_analysis', 'Variant Analysis', 'Varyant Analizi', 'Identifying and interpreting variants from aligned sequencing data.'),
  ('read_qc',          'Read QC',          'Okuma QC',        'Assessing and cleaning raw sequencing reads before downstream analysis.'),
  ('read_alignment',   'Read Alignment',   'Okuma Hizalama',  'Mapping sequencing reads to a reference.'),
  ('genome_assembly',  'Genome Assembly',  'Genom Montajı',   'Assembling a genome from sequencing reads without a reference.');

-- Community announcements: social-media-team-managed homepage cards.
-- "Active" is derived purely from expires_at > now — there is no is_active
-- flag. Editing (PATCH) never changes created_at, so an edit can't change
-- an announcement's position among other active announcements.
CREATE TABLE IF NOT EXISTS announcements (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  description   TEXT NOT NULL,
  button_text   TEXT NOT NULL,
  button_url    TEXT NOT NULL,
  show_as_popup INTEGER NOT NULL DEFAULT 0,
  expires_at    INTEGER NOT NULL,
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  site          TEXT NOT NULL DEFAULT 'main'
);

-- Member blog submissions: a member with is_writer submits through the
-- website; an admin approves or rejects. Approval opens a real GitHub PR
-- (see functions/_lib/github.ts) -- git remains the single source of
-- truth for published posts, this table only holds the pending/rejected
-- work-in-progress state before that PR exists.
CREATE TABLE IF NOT EXISTS blog_submissions (
  id                   TEXT PRIMARY KEY,
  submitted_by         TEXT NOT NULL REFERENCES users(id),
  lang                 TEXT NOT NULL CHECK (lang IN ('en', 'tr')),
  title                TEXT NOT NULL,
  description          TEXT NOT NULL,
  category             TEXT NOT NULL,
  tags                 TEXT NOT NULL DEFAULT '[]',
  author               TEXT NOT NULL,
  image_url            TEXT NOT NULL DEFAULT '',
  body                 TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  rejection_reason     TEXT,
  pr_url               TEXT,
  paired_submission_id TEXT REFERENCES blog_submissions(id),
  created_at           INTEGER NOT NULL,
  reviewed_at          INTEGER,
  reviewed_by          TEXT REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON announcements(expires_at);
CREATE INDEX IF NOT EXISTS idx_blog_submissions_status ON blog_submissions(status);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

CREATE INDEX IF NOT EXISTS idx_progress_user_id ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_rank_history_user_ordinal ON rank_history(user_id, rank_ordinal);
CREATE INDEX IF NOT EXISTS idx_user_achievement_badges_user_id ON user_achievement_badges(user_id);

-- Send-as-RSG: which members may send mail from the organisation's address.
-- users.is_sender is the authority for "may this user send" (checked on every
-- request); this table is the record of how they came to be allowed. Granting
-- inserts a row; revoking stamps revoked_by/revoked_at on the newest unrevoked
-- row, so a granted -> revoked -> granted user has a readable three-row history.
CREATE TABLE IF NOT EXISTS sender_grants (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team        TEXT,
  granted_by  TEXT NOT NULL REFERENCES users(id),
  granted_at  INTEGER NOT NULL,
  revoked_by  TEXT REFERENCES users(id),
  revoked_at  INTEGER
);

-- One row per RECIPIENT, not per composed message: a compose addressed to
-- three people writes three rows, because each recipient genuinely receives
-- its own Gmail message. This is what makes the per-user rate limit and
-- "has anyone written to this professor?" a plain COUNT(*).
-- body_snapshot is deliberately a copy, not a reference -- the log has to stay
-- true after everything else changes.
CREATE TABLE IF NOT EXISTS sent_emails (
  id                TEXT PRIMARY KEY,
  sender_user_id    TEXT NOT NULL REFERENCES users(id),
  recipient_email   TEXT NOT NULL,
  -- Historical only. The compose form used to ask for the recipient's name;
  -- it no longer does, so nothing writes this and new rows leave it NULL.
  -- Kept so the send log still shows the names captured before the change.
  recipient_name    TEXT,
  subject           TEXT NOT NULL,
  body_snapshot     TEXT NOT NULL,
  attachment_ids    TEXT NOT NULL DEFAULT '[]',
  gmail_message_id  TEXT,
  gmail_thread_id   TEXT,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed')),
  error_message     TEXT,
  sent_at           INTEGER NOT NULL
);

-- Admin-curated attachment library (sponsorship pack, invitation letter).
-- Members pick from this list; members never upload. Bytes live in the
-- non-public R2 bucket bound as MAIL_ATTACHMENTS and are read server-side
-- into the MIME message -- no URL is ever exposed.
CREATE TABLE IF NOT EXISTS mail_attachments (
  id            TEXT PRIMARY KEY,
  filename      TEXT NOT NULL,
  r2_key        TEXT NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL REFERENCES users(id),
  uploaded_at   INTEGER NOT NULL,
  is_active     INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_sent_emails_sender_sent_at ON sent_emails(sender_user_id, sent_at);
CREATE INDEX IF NOT EXISTS idx_sent_emails_sent_at ON sent_emails(sent_at);
CREATE INDEX IF NOT EXISTS idx_sender_grants_user_id ON sender_grants(user_id);

-- Mail composed now and sent later. Deliberately NOT a new status on
-- sent_emails: SQLite cannot alter that table's CHECK constraint, and a queued
-- message is a different thing anyway -- one row holding a recipient list, no
-- sent_at, no gmail_message_id, and cancellable. It fans out into one
-- sent_emails row per recipient only when it actually goes.
--
-- Cancelling deletes the row. The queue is transient; sent_emails is the
-- permanent record, and a message cancelled before sending was never sent.
CREATE TABLE IF NOT EXISTS scheduled_emails (
  id              TEXT PRIMARY KEY,
  sender_user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipients      TEXT NOT NULL,
  -- Unused; see sent_emails.recipient_name. The queue is transient, so every
  -- row still carrying a value drains within days and none replace them.
  recipient_name  TEXT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  attachment_ids  TEXT NOT NULL DEFAULT '[]',
  scheduled_at    INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  first_tried_at  INTEGER,
  -- When a dispatch took this row to send it. Written and committed BEFORE
  -- the send, so a row whose invocation was killed mid-send is visibly
  -- in-flight rather than looking untouched. Rows claimed within the lease
  -- are skipped; past it they are reconsidered, and the dispatcher then
  -- checks sent_emails.scheduled_id before sending again. Without this a
  -- crash between Gmail accepting the message and the row being deleted
  -- delivered it twice, which happened on 2026-09-04.
  claimed_at      INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_due ON scheduled_emails(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_sender ON scheduled_emails(sender_user_id);

-- What each dispatch tick did. Written by functions/api/mail/dispatch.ts and
-- read by nothing -- it exists to be queried by hand when the queue misbehaves.
--
-- Two-phase on purpose: the row is inserted when the tick starts and updated
-- when it ends, so `finished_at IS NULL` marks an invocation that began and
-- never came back. On 2026-09-05 the queue stalled for six and a half hours
-- and there was no way to tell that case apart from "the cron never fired",
-- which needs the opposite fix. Rows older than a week are deleted by the
-- tick itself, once an hour.
CREATE TABLE IF NOT EXISTS dispatch_runs (
  id            TEXT PRIMARY KEY,
  started_at    INTEGER NOT NULL,
  finished_at   INTEGER,
  candidates    INTEGER,
  planned       INTEGER,
  sent          INTEGER,
  failed        INTEGER,
  retried       INTEGER,
  already_sent  INTEGER,
  held          TEXT,
  error         TEXT,
  phase         TEXT
);
CREATE INDEX IF NOT EXISTS idx_dispatch_runs_started ON dispatch_runs(started_at);

-- Conversations: the threads the site started, and their messages.
--
-- These two tables are a rebuildable cache of Gmail, not a record. Dropping
-- and resyncing them loses nothing: sent_emails remains the audit log of what
-- the site sent, including the failures Gmail never saw.
--
-- A row appears in mail_threads only when the site sends a message. That set
-- is the complete list of threads the system is permitted to read; nothing
-- else can add to it.
CREATE TABLE IF NOT EXISTS mail_threads (
  id                TEXT PRIMARY KEY,
  sender_user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipient_email   TEXT NOT NULL,
  -- Historical only; see sent_emails.recipient_name. The conversations page
  -- falls back to recipient_email, which is what every new thread shows.
  recipient_name    TEXT,
  subject           TEXT NOT NULL,
  last_message_at   INTEGER NOT NULL,
  last_direction    TEXT NOT NULL CHECK (last_direction IN ('out', 'in')),
  unread            INTEGER NOT NULL DEFAULT 0,
  last_notified_at  INTEGER,
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_threads_sender
  ON mail_threads(sender_user_id, last_message_at DESC);

-- The primary key is Gmail's own message id, which is what makes ingest
-- idempotent: re-syncing a thread re-inserts the same ids and INSERT OR
-- IGNORE discards them. Idempotency is a schema guarantee here, not something
-- the sync code has to get right.
CREATE TABLE IF NOT EXISTS mail_messages (
  id                 TEXT PRIMARY KEY,
  thread_id          TEXT NOT NULL REFERENCES mail_threads(id) ON DELETE CASCADE,
  direction          TEXT NOT NULL CHECK (direction IN ('out', 'in')),
  rfc822_message_id  TEXT,
  from_email         TEXT NOT NULL,
  from_name          TEXT,
  subject            TEXT,
  body_text          TEXT NOT NULL,
  attachment_count   INTEGER NOT NULL DEFAULT 0,
  sent_at            INTEGER NOT NULL,
  created_at         INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mail_messages_thread
  ON mail_messages(thread_id, sent_at);

-- Single-row store for the Gmail history cursor.
CREATE TABLE IF NOT EXISTS mail_sync_state (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  history_id      TEXT,
  last_synced_at  INTEGER,
  backfill_cursor TEXT
);

INSERT OR IGNORE INTO mail_sync_state (id, history_id, last_synced_at, backfill_cursor)
VALUES (1, NULL, NULL, NULL);

-- The edition's volatile settings. At most one row: the upcoming edition.
CREATE TABLE IF NOT EXISTS symposium_edition (
  year                  INTEGER PRIMARY KEY,
  registration_url      TEXT NOT NULL DEFAULT '',
  registration_deadline INTEGER,
  abstract_url          TEXT NOT NULL DEFAULT '',
  abstract_deadline     INTEGER,
  -- Nullable on purpose: NULL means "no opinion, use the repo's flag", the same
  -- rule the three lists follow. Only an explicit 0 or 1 overrides 2026.md.
  venue_public          INTEGER,
  city_public           INTEGER,
  archived_pr_url       TEXT,
  updated_by            TEXT NOT NULL REFERENCES users(id),
  updated_at            INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS symposium_speakers (
  id       TEXT PRIMARY KEY,
  -- The stable identifier sessions point at, and what the archived JSON keeps.
  -- Sessions reference speakers by slug today; the CMS must not break that link.
  slug     TEXT NOT NULL,
  year     INTEGER NOT NULL,
  name     TEXT NOT NULL,
  position TEXT NOT NULL DEFAULT '',
  company  TEXT NOT NULL DEFAULT '',
  bio      TEXT NOT NULL DEFAULT '',
  photo    TEXT NOT NULL DEFAULT '',
  linkedin TEXT NOT NULL DEFAULT '',
  sort     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS symposium_sessions (
  id            TEXT PRIMARY KEY,
  -- The stable identifier the symposium site's session content schema
  -- requires and what the archived JSON keeps. Distinct from speaker_slugs
  -- below, which points at speakers, not at this session itself.
  slug          TEXT NOT NULL,
  year          INTEGER NOT NULL,
  title         TEXT NOT NULL,
  type          TEXT NOT NULL,
  time          TEXT NOT NULL DEFAULT '',
  end_time      TEXT NOT NULL DEFAULT '',
  description   TEXT NOT NULL DEFAULT '',
  -- JSON array of speaker *slugs*, matching src/data/sessions.ts's speakerSlugs.
  speaker_slugs TEXT NOT NULL DEFAULT '[]',
  sort          INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS symposium_committee (
  id          TEXT PRIMARY KEY,
  year        INTEGER NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT '',
  role_tr     TEXT NOT NULL DEFAULT '',
  affiliation TEXT NOT NULL DEFAULT '',
  photo       TEXT NOT NULL DEFAULT '',
  linkedin    TEXT NOT NULL DEFAULT '',
  sort        INTEGER NOT NULL DEFAULT 0
);

-- Sessions point at speakers by slug, so a duplicate slug within one year
-- makes that link resolve to whichever row sorts first -- silently, with no
-- error the editor ever sees. The admin routes reject a duplicate before
-- writing and name the offender; these indexes are what make it impossible
-- rather than merely unlikely, closing the gap between the check and the
-- write. Scoped per year: the same speaker recurring in a later edition is
-- a different row and keeps its slug.
CREATE UNIQUE INDEX IF NOT EXISTS idx_symposium_speakers_year_slug ON symposium_speakers(year, slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_symposium_sessions_year_slug ON symposium_sessions(year, slug);
