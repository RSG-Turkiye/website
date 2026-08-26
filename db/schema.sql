-- RSG Turkey Member Platform Schema
-- Apply with: wrangler d1 execute rsg-members --file=db/schema.sql
-- REQUIRED: run BOTH of the following against production BEFORE deploying
-- this branch (both are idempotent/safe to re-run):
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

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  google_id     TEXT UNIQUE NOT NULL,
  email         TEXT UNIQUE NOT NULL,
  is_member     INTEGER NOT NULL DEFAULT 0,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  is_announcer  INTEGER NOT NULL DEFAULT 0,
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

CREATE INDEX IF NOT EXISTS idx_announcements_expires_at ON announcements(expires_at);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_progress_user_id ON progress(user_id);
CREATE INDEX IF NOT EXISTS idx_rank_history_user_ordinal ON rank_history(user_id, rank_ordinal);
CREATE INDEX IF NOT EXISTS idx_user_achievement_badges_user_id ON user_achievement_badges(user_id);
