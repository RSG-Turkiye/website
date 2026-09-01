-- RSG Turkey Member Platform Schema
-- Apply with: wrangler d1 execute rsg-members --file=db/schema.sql
-- REQUIRED: run ALL THREE of the following against production BEFORE
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

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  is_member     INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_announcer  INTEGER NOT NULL DEFAULT 0,
  is_writer     INTEGER NOT NULL DEFAULT 0,
  is_sender     INTEGER NOT NULL DEFAULT 0,
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
  created_at    INTEGER NOT NULL
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
  recipient_name    TEXT,
  subject           TEXT NOT NULL,
  body_snapshot     TEXT NOT NULL,
  attachment_ids    TEXT NOT NULL DEFAULT '[]',
  gmail_message_id  TEXT,
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
  recipient_name  TEXT,
  subject         TEXT NOT NULL,
  body            TEXT NOT NULL,
  attachment_ids  TEXT NOT NULL DEFAULT '[]',
  scheduled_at    INTEGER NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  first_tried_at  INTEGER,
  last_error      TEXT,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_scheduled_emails_due ON scheduled_emails(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_scheduled_emails_sender ON scheduled_emails(sender_user_id);
