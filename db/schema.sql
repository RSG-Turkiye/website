-- RSG Turkey Member Platform Schema
-- Apply with: wrangler d1 execute rsg-members --file=db/schema.sql

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  google_id   TEXT UNIQUE NOT NULL,
  email       TEXT UNIQUE NOT NULL,
  is_member   INTEGER NOT NULL DEFAULT 0,
  is_admin    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  last_login  INTEGER NOT NULL
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

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_profiles_username ON profiles(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_progress_user_id ON progress(user_id);
