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
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Apply the file rather than a copy of the statement: this note used to
--    carry its own CREATE TABLE, it was written before the `site` column
--    existed, and an operator following the note on a fresh database got a
--    nine-column table that item 7b then refuses to alter. Every statement in
--    the body is IF NOT EXISTS, so running the whole file is safe.
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
--     IF NOT EXISTS, so unlike the ALTERs in 7g and 7i they are ordinary
--     statements in this file
--     and re-running the schema applies them. Neither table has been written
--     to yet, so there are no duplicates to clean up first. If that ever
--     stops being true, the CREATE fails loudly rather than silently
--     dropping a row -- deduplicate by hand, then re-run.
--
-- 7f. Granting is_symposium used to have no UI, so the symposium pane was
--     reachable by is_admin accounts and by nobody else unless the role was
--     granted by hand. The admin user list can now show and set it like any
--     other role, and the hand-written form is kept only for a database with
--     no admin account to do it from. Since 8i the is_* columns are a cache
--     of role_grants, and a column set without a grant is wiped by the next
--     role change for that user, so the hand recovery writes a permanent
--     grant first and then the column:
--       wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at, note) SELECT lower(hex(randomblob(16))), id, 'symposium', NULL, NULL, unixepoch(), 'manual recovery' FROM users WHERE email = 'someone@example.com'"
--       wrangler d1 execute rsg-members --remote --command="UPDATE users SET is_symposium = 1 WHERE email = 'someone@example.com'"
--     The same two commands, with role 'admin' and is_admin, recover an
--     admin account if every admin grant has lapsed.
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

-- 7j. Committee members carry team labels (social media, graphic design and
--     so on) and the symposium's /committee page groups by them. The column
--     is additive with a default, so existing rows read as "no team" and
--     keep rendering exactly as they did -- but three routes SELECT it by
--     name, and the reach of that is wider than the committee: the admin
--     list 500s, the archive run 500s, and so does /api/symposium, which is
--     the public overlay. A failed overlay fetch is not an error on the
--     symposium site -- it falls back to the repo's own content -- so the
--     next build there would quietly drop every speaker and session that
--     lives only in D1. Run this BEFORE the code deploys. ALTER TABLE ADD
--     COLUMN is NOT idempotent -- do not re-run this one:
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_committee ADD COLUMN teams TEXT NOT NULL DEFAULT '[]'"
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_sessions ADD COLUMN day INTEGER NOT NULL DEFAULT 1"
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_sessions ADD COLUMN title_tr TEXT NOT NULL DEFAULT ''"
--       wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_sessions ADD COLUMN description_tr TEXT NOT NULL DEFAULT ''"
--
-- 7k. functions/api/symposium.ts and the two admin symposium routes now
--    filter on archived_at; deploying without this first makes every one of
--    them 500 with D1 "no such column: archived_at". ALTER TABLE ADD COLUMN
--    is not idempotent, so this is a note rather than a statement below:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_edition ADD COLUMN archived_at INTEGER"
--    Then backfill, so that an edition already archived and merged stays
--    retired rather than reappearing on the public endpoint:
--      wrangler d1 execute rsg-members --remote --command="UPDATE symposium_edition SET archived_at = updated_at WHERE archived_pr_url IS NOT NULL AND archived_at IS NULL"
--    The backfill deliberately assumes an already-stamped edition was
--    merged. That is what today's behaviour already asserts -- such a row is
--    retired right now -- so this preserves it exactly rather than making
--    finished editions public again.
--
--    That assumption has a deadline: 2026-10-11. The 2026 symposium ends
--    2026-10-10, and the code deployed before this migration stamps
--    archived_pr_url the moment the archive pull request OPENS, not when it
--    merges -- the exact bug this branch exists to fix. Run the backfill
--    before 2026-10-11 and it is safe, because no row can carry an
--    archived_pr_url yet. Run it later, and 2026's row may already carry one
--    from an unmerged pull request, and the backfill would stamp archived_at
--    for it anyway and permanently retire 2026 with its content sitting only
--    in a branch. If you are running this after 2026-10-11, first run:
--      wrangler d1 execute rsg-members --remote --command="SELECT year, archived_pr_url FROM symposium_edition WHERE archived_pr_url IS NOT NULL"
--    and confirm on GitHub that each listed pull request actually merged
--    before running the backfill above.
--
-- 7l. Symposium certificates. Two new tables, both CREATE IF NOT EXISTS, so
--    re-applying the whole file is safe:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Without it /api/certificates/* and /api/admin/certificates* answer 500
--    with "no such table". Files live in the MAIL_ATTACHMENTS bucket under
--    certificates/; add the R2 lifecycle rule described in README.md.
--
-- 8a. The audit log (audit_log, below). New table, IF NOT EXISTS, so
--    re-applying the file is safe:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Run it BEFORE deploying. Role changes are written together with their
--    audit row and fail closed: without the table, granting or removing any
--    role answers 500 instead of happening unlogged.
--
-- 8b. Social media roles. Deploying without these does NOT throw --
--    getSessionUser does SELECT *, so the columns are simply absent and both
--    roles read as false -- but functions/api/admin/users.ts SELECTs them by
--    name and the admin user list 500s. ALTER TABLE ADD COLUMN is NOT
--    idempotent -- do not re-run:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_social INTEGER NOT NULL DEFAULT 0"
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE users ADD COLUMN is_social_publisher INTEGER NOT NULL DEFAULT 0"
--
-- 8c. platform_connections and oauth_states (below). New tables, IF NOT
--    EXISTS: re-apply the file before deploying:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Without them mail is unaffected (the Gmail path falls back to the
--    GMAIL_REFRESH_TOKEN secret), but the Connections pane and the status
--    banner have nothing to read, and "Reconnect Gmail" answers 500.
--

-- 8d. Social media content tables (social_media, social_plans, social_posts,
--    social_post_targets, social_event_modes). New tables, IF NOT EXISTS:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Run it before deploying. Without social_media, image uploads still work
--    (the insert is wrapped) but every social post reads as unknown_media;
--    without the others, /api/social/* answers 500.
--

-- 8e. Instagram publishing (phase 3a). Two columns on existing tables and an
--    index. ALTER TABLE ADD COLUMN is NOT idempotent -- run each once:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE social_post_targets ADD COLUMN confirmed_at INTEGER"
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE dispatch_runs ADD COLUMN kind TEXT NOT NULL DEFAULT 'mail'"
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS idx_social_targets_status ON social_post_targets(status)"
--    Run them BEFORE deploying: the dispatcher writes confirmed_at and the
--    banner reads dispatch_runs.kind (it falls back to the old query, but the
--    social tick's run rows would fail to insert).
--

-- 8f. An index on dispatch_runs(kind, started_at). The Instagram DM poll asks
--    for the newest 'social_dm' row on every one-minute tick; with only the
--    started_at index that walked the whole table, and on 2026-10-18 it used
--    up the free plan's 5M daily row reads and blocked every D1 read until
--    midnight UTC. IF NOT EXISTS, so it is safe to re-run:
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS idx_dispatch_runs_kind_started ON dispatch_runs(kind, started_at)"
--    Order against the deploy does not matter; the queries are correct
--    without it, only expensive.
--

-- 8g. Three more indexes for queries that would otherwise walk a table that
--    keeps growing: the mail queue's lookup of what a claimed row already
--    sent (sent_emails is never pruned), the DM tick's read of open threads,
--    and its two-day prune of the digest log. All IF NOT EXISTS, so safe to
--    re-run, and order against the deploy does not matter:
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS idx_sent_emails_scheduled ON sent_emails(scheduled_id)"
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS social_dm_threads_inbound ON social_dm_threads(platform, last_inbound_at)"
--      wrangler d1 execute rsg-members --remote --command="CREATE INDEX IF NOT EXISTS social_dm_digest_log_sent ON social_dm_digest_log(sent_at)"
--

-- 8h. Certificate view and download counter. Two columns on
--    symposium_certificates and a new table, certificate_stats, that keeps
--    the counts after the 30-day purge deletes the certificates. ALTER TABLE
--    ADD COLUMN is NOT idempotent -- run each once, then re-apply the file
--    for the table:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_certificates ADD COLUMN views INTEGER NOT NULL DEFAULT 0"
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE symposium_certificates ADD COLUMN downloads INTEGER NOT NULL DEFAULT 0"
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Run them BEFORE deploying: the admin list reads the columns, and the
--    nightly purge writes certificate_stats before it deletes anything (it
--    fails, and keeps the certificates, until the table exists). Serving a
--    certificate never fails on the counter; it only stops counting.
--

-- 8i. Roles with an end date. role_grants (below) records who holds which
--    role, until when, and who granted or took it away; the users.is_*
--    columns stay, as a cache of it that every permission check reads. New
--    table, IF NOT EXISTS, so re-applying the file is safe:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Then backfill one permanent grant for every role someone already holds.
--    Each statement skips a user who already has a live grant of that role,
--    so running them twice adds nothing:
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, 'admin', NULL, NULL, unixepoch() FROM users WHERE is_admin = 1 AND NOT EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'admin' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch()))"
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, 'announcer', NULL, NULL, unixepoch() FROM users WHERE is_announcer = 1 AND NOT EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'announcer' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch()))"
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, 'symposium', NULL, NULL, unixepoch() FROM users WHERE is_symposium = 1 AND NOT EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'symposium' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch()))"
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, 'social_publisher', NULL, NULL, unixepoch() FROM users WHERE is_social_publisher = 1 AND NOT EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'social_publisher' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch()))"
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, 'writer', NULL, NULL, unixepoch() FROM users WHERE is_writer = 1 AND NOT EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'writer' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch()))"
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, 'sender', NULL, NULL, unixepoch() FROM users WHERE is_sender = 1 AND NOT EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'sender' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch()))"
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at) SELECT lower(hex(randomblob(16))), id, 'social', NULL, NULL, unixepoch() FROM users WHERE is_social = 1 AND NOT EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'social' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch()))"
--    Then reconcile: end any backfilled grant whose column has since gone
--    back to 0. Also idempotent:
--      wrangler d1 execute rsg-members --remote --command="UPDATE role_grants SET revoked_at = unixepoch() WHERE granted_by IS NULL AND revoked_at IS NULL AND role = 'admin' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = role_grants.user_id AND u.is_admin = 1)"
--      wrangler d1 execute rsg-members --remote --command="UPDATE role_grants SET revoked_at = unixepoch() WHERE granted_by IS NULL AND revoked_at IS NULL AND role = 'announcer' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = role_grants.user_id AND u.is_announcer = 1)"
--      wrangler d1 execute rsg-members --remote --command="UPDATE role_grants SET revoked_at = unixepoch() WHERE granted_by IS NULL AND revoked_at IS NULL AND role = 'symposium' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = role_grants.user_id AND u.is_symposium = 1)"
--      wrangler d1 execute rsg-members --remote --command="UPDATE role_grants SET revoked_at = unixepoch() WHERE granted_by IS NULL AND revoked_at IS NULL AND role = 'social_publisher' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = role_grants.user_id AND u.is_social_publisher = 1)"
--      wrangler d1 execute rsg-members --remote --command="UPDATE role_grants SET revoked_at = unixepoch() WHERE granted_by IS NULL AND revoked_at IS NULL AND role = 'writer' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = role_grants.user_id AND u.is_writer = 1)"
--      wrangler d1 execute rsg-members --remote --command="UPDATE role_grants SET revoked_at = unixepoch() WHERE granted_by IS NULL AND revoked_at IS NULL AND role = 'sender' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = role_grants.user_id AND u.is_sender = 1)"
--      wrangler d1 execute rsg-members --remote --command="UPDATE role_grants SET revoked_at = unixepoch() WHERE granted_by IS NULL AND revoked_at IS NULL AND role = 'social' AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = role_grants.user_id AND u.is_social = 1)"
--    Why both: the code that grants and removes roles through role_grants
--    (functions/_lib/role-grants.ts, wired into the admin panel by the
--    roles-with-expiry branch) recomputes every is_* column of a user from
--    their live grants whenever one of their roles changes. Until it is
--    deployed, the old panel still writes the columns directly, so a role
--    added after the backfill has no grant (and would be silently taken away
--    by the first change to that user's roles), and a role removed after it
--    still has a live grant (and would come back).
--    Order: apply the file and run the backfill. Then, immediately before
--    the code deploys, run the backfill AND the reconcile again, and change
--    no roles in the admin panel between that and the deploy.
--
-- 8j. Panel CMS drafts. content_drafts (below, at the end of the file)
--    holds drafts and their review state; published content lives only in
--    git. New table and indexes, all IF NOT EXISTS, so re-applying the file
--    is safe:
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    Run it BEFORE deploying: every /api/cms/drafts call reads the table and
--    fails with "no such table: content_drafts" until it exists. The table
--    was never released with an older shape, so its columns (last_checked_at)
--    and statuses ('merged') live in the CREATE itself, not in an ALTER. A
--    local database that already has an earlier copy of the table needs it
--    dropped and re-created:
--      wrangler d1 execute rsg-members --local --command="DROP TABLE content_drafts"
--      wrangler d1 execute rsg-members --local --file=db/schema.sql
--
-- 8k. The retired writer role moves to the Yazılar group. Blog posts are
--    written in the panel CMS now, and the old member submission form and its
--    admin section are gone, so a live `writer` grant no longer lets anyone do
--    anything. AFTER this branch is deployed (not before: until then the live
--    panel knows no content.yazilar.edit, so nothing is done before the
--    merge), in the panel, Users and roles > Roles:
--      1. grant "Posts editor" (Yazılar düzenleyici) to each person who holds
--         "Blog writer" (Blog yazarı), ending at the earlier of their writer
--         grant's end and one month from today;
--      2. then take away their "Blog writer" role on the same page.
--    Both steps are in the activity log (role.grant, role.revoke). At the
--    time of writing there is one such grant.
--    Look at what is live first and again afterwards (counts and dates only;
--    afterwards `writer` should be gone and `content.yazilar.edit` there):
--      wrangler d1 execute rsg-members --remote --command="SELECT role, COUNT(*) AS live, MIN(expires_at) AS ends_first, SUM(expires_at IS NULL) AS permanent FROM role_grants WHERE role IN ('writer', 'content.yazilar.edit') AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > unixepoch()) GROUP BY role"
--    Fallback, only if the panel route is not possible, and also only after
--    the deploy. It writes NO activity-log row: each audit row carries a
--    SHA-256 hash of the row before it (functions/_lib/audit.ts), which SQL
--    cannot compute, and a hand-written row would break the chain for a
--    year. The move is recorded only in role_grants (granted_by and
--    revoked_by NULL, with a note). One command, four statements: a Yazılar
--    grant ending at the earlier of the writer grant's end and 30 days from
--    now, for anyone without a live one; a live Yazılar grant ending sooner
--    than that is extended to it; the writer grant is ended (only for
--    someone who now holds Yazılar); the users.is_writer cache is rewritten
--    from the live grants, as syncColumnsStatement does (CLAUDE.md: the
--    is_* columns are a cache of role_grants). Every statement is guarded,
--    so running it twice changes nothing and a run cut off half way is
--    finished by running it again:
--      wrangler d1 execute rsg-members --remote --command="INSERT INTO role_grants (id, user_id, role, expires_at, granted_by, granted_at, note) SELECT lower(hex(randomblob(16))), w.user_id, 'content.yazilar.edit', MIN(CASE WHEN COUNT(*) > COUNT(w.expires_at) THEN unixepoch() + 2592000 ELSE MAX(w.expires_at) END, unixepoch() + 2592000), NULL, unixepoch(), 'migration 8k: moved from writer' FROM role_grants w WHERE w.role = 'writer' AND w.revoked_at IS NULL AND (w.expires_at IS NULL OR w.expires_at > unixepoch()) AND NOT EXISTS (SELECT 1 FROM role_grants y WHERE y.user_id = w.user_id AND y.role = 'content.yazilar.edit' AND y.revoked_at IS NULL AND (y.expires_at IS NULL OR y.expires_at > unixepoch())) GROUP BY w.user_id; UPDATE role_grants SET expires_at = (SELECT MIN(CASE WHEN COUNT(*) > COUNT(w.expires_at) THEN unixepoch() + 2592000 ELSE MAX(w.expires_at) END, unixepoch() + 2592000) FROM role_grants w WHERE w.user_id = role_grants.user_id AND w.role = 'writer' AND w.revoked_at IS NULL AND (w.expires_at IS NULL OR w.expires_at > unixepoch())), note = COALESCE(note || '; ', '') || 'migration 8k: extended for writer' WHERE role = 'content.yazilar.edit' AND revoked_at IS NULL AND expires_at > unixepoch() AND (SELECT MIN(CASE WHEN COUNT(*) > COUNT(w.expires_at) THEN unixepoch() + 2592000 ELSE MAX(w.expires_at) END, unixepoch() + 2592000) FROM role_grants w WHERE w.user_id = role_grants.user_id AND w.role = 'writer' AND w.revoked_at IS NULL AND (w.expires_at IS NULL OR w.expires_at > unixepoch())) > expires_at; UPDATE role_grants SET revoked_at = unixepoch(), note = COALESCE(note || '; ', '') || CASE WHEN EXISTS (SELECT 1 FROM role_grants y WHERE y.user_id = role_grants.user_id AND y.role = 'content.yazilar.edit' AND y.revoked_at IS NULL AND (y.expires_at IS NULL OR y.expires_at > unixepoch()) AND y.note LIKE '%migration 8k:%') THEN 'migration 8k: moved to content.yazilar.edit' ELSE 'migration 8k: ended, content.yazilar.edit already held' END WHERE role = 'writer' AND role_grants.revoked_at IS NULL AND (role_grants.expires_at IS NULL OR role_grants.expires_at > unixepoch()) AND EXISTS (SELECT 1 FROM role_grants y WHERE y.user_id = role_grants.user_id AND y.role = 'content.yazilar.edit' AND y.revoked_at IS NULL AND (y.expires_at IS NULL OR y.expires_at > unixepoch())); UPDATE users SET is_writer = EXISTS (SELECT 1 FROM role_grants g WHERE g.user_id = users.id AND g.role = 'writer' AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > unixepoch())) WHERE is_writer = 1"
--
-- 8l. Personal agent tokens (functions/_lib/agent-tokens.ts). Two columns
--    on existing tables, then two new tables: agent_tokens with its index,
--    and agent_counters. Run both commands, in this order, BEFORE deploying:
--    the CMS and social endpoints write agent_token_id on every draft save,
--    so without the columns every save fails with "no such column:
--    agent_token_id", and every request with an agent token fails on "no
--    such table: agent_tokens". ALTER TABLE ADD COLUMN is NOT idempotent, so
--    it stays a note here and errors rather than no-ops on a rerun: do not
--    re-run the first command. The second is all IF NOT EXISTS and safe to
--    repeat:
--      wrangler d1 execute rsg-members --remote --command="ALTER TABLE content_drafts ADD COLUMN agent_token_id TEXT; ALTER TABLE social_posts ADD COLUMN agent_token_id TEXT"
--      wrangler d1 execute rsg-members --remote --file=db/schema.sql
--    An earlier draft of this migration made a table agent_rate, now
--    replaced by agent_counters. If production has it, drop it (safe to
--    run either way):
--      wrangler d1 execute rsg-members --remote --command="DROP TABLE IF EXISTS agent_rate"
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
  is_social           INTEGER NOT NULL DEFAULT 0,
  is_social_publisher INTEGER NOT NULL DEFAULT 0,
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

-- Member blog submissions, from the retired /account form: a member with
-- is_writer submitted, an admin approved (opening a GitHub PR) or rejected.
-- Blog posts are panel CMS drafts now (content_drafts, type 'blog'); nothing
-- writes this table any more. It is kept, read only, for the statistics of
-- that history (functions/_lib/stats.ts).
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
  sent_at           INTEGER NOT NULL,
  -- The queue row this came from, when it came from the queue. It is what the
  -- dispatcher reads to tell, after an invocation was killed mid-send, which
  -- recipients already had their mail. Added by migration 7g; folded in here
  -- because a fresh database built from this file needs it too, and for three
  -- weeks this was the one migration column that had not been.
  scheduled_id      TEXT
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
-- The queue's reconciler asks what a claimed row already delivered.
CREATE INDEX IF NOT EXISTS idx_sent_emails_scheduled ON sent_emails(scheduled_id);
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
  phase         TEXT,
  kind          TEXT NOT NULL DEFAULT 'mail'
);
CREATE INDEX IF NOT EXISTS idx_dispatch_runs_started ON dispatch_runs(started_at);
-- Each kind's latest run (DM pacing, the health banner) in one index lookup.
CREATE INDEX IF NOT EXISTS idx_dispatch_runs_kind_started ON dispatch_runs(kind, started_at);

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
  -- When the archive pull request was *merged*, as a unix timestamp. NULL
  -- while it is unopened or open. This, not archived_pr_url, is what retires
  -- an edition from the public endpoint: stamping on the pull request being
  -- opened meant a pull request nobody merged emptied the programme, on a
  -- build that stayed green because a year mismatch is the same ordinary
  -- state as an edition nobody has programmed yet.
  archived_at           INTEGER,
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
  -- Which day of the symposium, 1-based. The schedule page derives the
  -- heading's date from the edition's startDate, so this is never a date.
  day           INTEGER NOT NULL DEFAULT 1,
  -- Turkish translations. title/description are English and canonical; an
  -- empty translation falls back to English on the Turkish pages.
  title_tr      TEXT NOT NULL DEFAULT '',
  description_tr TEXT NOT NULL DEFAULT '',
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
  -- A JSON array of team names, e.g. ["Sosyal Medya","Grafik Tasarim"]. A
  -- member can be on several teams and is listed under each. Free text, so
  -- the same label is written once per member and never centrally: the
  -- grouping matches case-insensitively for that reason. '[]' -- not '' --
  -- is the empty value, so every row parses as JSON.
  teams       TEXT NOT NULL DEFAULT '[]',
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

-- One row per certificate. Deleted 30 days after upload by
-- /api/admin/certificates/purge, which the symposium-cron Worker calls
-- nightly; the email address goes with it.
CREATE TABLE IF NOT EXISTS symposium_certificates (
  id          TEXT PRIMARY KEY,
  year        INTEGER NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('participation','workshop','presentation','appreciation')),
  size_bytes  INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  views       INTEGER NOT NULL DEFAULT 0,  -- times the PDF was opened in the page
  downloads   INTEGER NOT NULL DEFAULT 0   -- times "Download" was used
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_cert_year_email_kind ON symposium_certificates(year, email, kind);
CREATE INDEX IF NOT EXISTS idx_cert_email ON symposium_certificates(email);
CREATE INDEX IF NOT EXISTS idx_cert_expires ON symposium_certificates(expires_at);

-- Public lookups, for the rate limit only. ip_hash is SHA-256 of the
-- connecting IP; rows older than a day are purged with the certificates.
CREATE TABLE IF NOT EXISTS certificate_lookups (
  ip_hash TEXT NOT NULL,
  at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cert_lookups ON certificate_lookups(ip_hash, at);

-- What became of a year's purged certificates, as counts only: no names,
-- no addresses, so it can be kept for good. The purge adds to it in the
-- same batch that deletes the rows. People are counted per purge night, so
-- someone whose certificates were uploaded on two different days is counted
-- twice; uploads for a year normally go up together.
CREATE TABLE IF NOT EXISTS certificate_stats (
  year         INTEGER PRIMARY KEY,
  certificates INTEGER NOT NULL,
  people       INTEGER NOT NULL,
  viewed       INTEGER NOT NULL,  -- people who opened at least one certificate in the page
  downloaded   INTEGER NOT NULL   -- people who downloaded at least one
);

-- Who did what in the admin panel, kept a year. Each row carries the hash of
-- the row before it, so a row changed or removed after the fact breaks the
-- chain and /api/admin/audit/verify says where. prev_hash is UNIQUE: two
-- writers that read the same last row cannot both append after it, so the
-- chain cannot fork -- the loser retries (functions/_lib/audit.ts).
-- user_id has no foreign key on purpose: system rows have none, and deleting
-- a user must not delete the record of what they did.
CREATE TABLE IF NOT EXISTS audit_log (
  seq          INTEGER PRIMARY KEY AUTOINCREMENT,
  at           INTEGER NOT NULL,
  user_id      TEXT,
  action       TEXT NOT NULL,
  target_type  TEXT,
  target_id    TEXT,
  details      TEXT NOT NULL DEFAULT '{}',
  prev_hash    TEXT NOT NULL UNIQUE,
  hash         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id, at);

-- Who holds which role, and until when. users.is_* mirror the live rows
-- (functions/_lib/role-grants.ts). Revoked and expired rows are kept: they
-- are the history. A live grant: revoked_at IS NULL AND (expires_at IS NULL
-- OR expires_at > now).
CREATE TABLE IF NOT EXISTS role_grants (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  expires_at INTEGER,            -- NULL: permanent
  granted_by TEXT,               -- NULL: the 8i backfill
  granted_at INTEGER NOT NULL,
  revoked_by TEXT,
  revoked_at INTEGER,
  note       TEXT
);
CREATE INDEX IF NOT EXISTS idx_role_grants_user ON role_grants(user_id, revoked_at);
CREATE INDEX IF NOT EXISTS idx_role_grants_expiry ON role_grants(revoked_at, expires_at);

-- One row per external account the site talks to. Tokens are AES-GCM
-- ciphertext (functions/_lib/token-vault.ts), never plaintext. A row may
-- exist with no tokens at all: Gmail's health (last_ok_at / last_error) is
-- recorded here even while the refresh token still comes from the
-- GMAIL_REFRESH_TOKEN secret. Status is derived on read, never stored.
CREATE TABLE IF NOT EXISTS platform_connections (
  platform            TEXT PRIMARY KEY CHECK (platform IN ('gmail','instagram','linkedin','x')),
  account_id          TEXT,
  account_name        TEXT,
  access_token_enc    TEXT,
  refresh_token_enc   TEXT,
  scopes              TEXT,
  expires_at          INTEGER,
  refresh_expires_at  INTEGER,
  connected_by        TEXT,
  connected_at        INTEGER,
  last_ok_at          INTEGER,
  last_error          TEXT,
  last_error_at       INTEGER
);

-- Single-use OAuth state, ten minutes. Consumed with DELETE ... RETURNING so
-- a reloaded or replayed callback finds nothing.
CREATE TABLE IF NOT EXISTS oauth_states (
  state       TEXT PRIMARY KEY,
  platform    TEXT NOT NULL,
  user_id     TEXT NOT NULL,
  return_to   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

-- Social media content (spec §3). Dimensions of every uploaded image are
-- recorded here by /api/blog-submissions/upload-image, so a post's ratio
-- check reads the server's own measurement, never the browser's claim.
CREATE TABLE IF NOT EXISTS social_media (
  key           TEXT PRIMARY KEY,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  content_type  TEXT NOT NULL,
  size_bytes    INTEGER NOT NULL,
  uploaded_by   TEXT NOT NULL,
  uploaded_at   INTEGER NOT NULL
);

-- A slot on the calendar before its content exists. post_id is set when a
-- post is attached, and cleared again if that post is deleted or cancelled.
CREATE TABLE IF NOT EXISTS social_plans (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  scheduled_at  INTEGER NOT NULL,
  platforms     TEXT NOT NULL DEFAULT '["instagram"]',
  post_type     TEXT NOT NULL DEFAULT 'image' CHECK (post_type IN ('image','carousel','story')),
  assignee_id   TEXT,
  note          TEXT NOT NULL DEFAULT '',
  post_id       TEXT,
  reminded_at   INTEGER,
  created_by    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_plans_at ON social_plans(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_plans_post ON social_plans(post_id);

-- revision rises on every change; each write names the revision it read, so
-- two people acting at once cannot both win. write_nonce is a random value each
-- write stores, so the statements that follow a write can prove that THIS
-- write landed (functions/_lib/social-posts.ts).
CREATE TABLE IF NOT EXISTS social_posts (
  id                 TEXT PRIMARY KEY,
  type               TEXT NOT NULL CHECK (type IN ('image','carousel','story')),
  caption            TEXT NOT NULL DEFAULT '',
  caption_overrides  TEXT NOT NULL DEFAULT '{}',
  link               TEXT,
  media              TEXT NOT NULL DEFAULT '[]',
  platforms          TEXT NOT NULL DEFAULT '[]',
  scheduled_at       INTEGER,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','scheduled','published','partially_published','failed','rejected','cancelled')),
  revision           INTEGER NOT NULL DEFAULT 0,
  write_nonce        TEXT,
  created_by         TEXT NOT NULL,
  approved_by        TEXT,
  approved_at        INTEGER,
  review_note        TEXT,
  event_mode_id      TEXT,
  agent_token_id     TEXT,             -- set when an agent token wrote it (migration 8l); never cleared
  created_at         INTEGER NOT NULL,
  updated_at         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_social_posts_at ON social_posts(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status);

-- One row per post per platform: the unit phase 3's dispatcher publishes.
CREATE TABLE IF NOT EXISTS social_post_targets (
  post_id         TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK (platform IN ('instagram','linkedin','x')),
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','waiting_connection','needs_confirmation','publishing','published','failed','skipped')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  first_tried_at  INTEGER,
  claimed_at      INTEGER,
  last_error      TEXT,
  container_id    TEXT,
  remote_id       TEXT,
  permalink       TEXT,
  published_at    INTEGER,
  confirmed_at    INTEGER,
  PRIMARY KEY (post_id, platform)
);
CREATE INDEX IF NOT EXISTS idx_social_targets_status ON social_post_targets(status);

-- A time-boxed window in which named editors' stories skip approval (spec §1).
CREATE TABLE IF NOT EXISTS social_event_modes (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  starts_at   INTEGER NOT NULL,
  ends_at     INTEGER NOT NULL,
  editor_ids  TEXT NOT NULL DEFAULT '[]',
  opened_by   TEXT NOT NULL,
  closed_by   TEXT,
  closed_at   INTEGER,
  created_at  INTEGER NOT NULL
);

-- Social DM inbox (docs/superpowers/specs/2026-10-15-social-dm-inbox-design.md).
-- One row per conversation the poll has seen. No message text is stored: the
-- panel fetches messages live. id is our own random id, used in URLs, so the
-- platform's conversation id never appears in a link. updated_at is the
-- platform's updated_time for the conversation when we last read it.
CREATE TABLE IF NOT EXISTS social_dm_threads (
  id                TEXT PRIMARY KEY,
  platform          TEXT NOT NULL CHECK (platform IN ('instagram','x')),
  conversation_id   TEXT NOT NULL,
  peer_id           TEXT NOT NULL,
  peer_username     TEXT,
  last_inbound_at   INTEGER,
  last_outbound_at  INTEGER,
  read_at           INTEGER,
  read_by           TEXT,
  digested_at       INTEGER,
  final_warned_at   INTEGER,
  updated_at        INTEGER NOT NULL,
  UNIQUE (platform, conversation_id)
);
-- The DM tick reads only threads still inside the 24-hour reply window.
CREATE INDEX IF NOT EXISTS social_dm_threads_inbound ON social_dm_threads (platform, last_inbound_at);

-- Per-person digest pacing; pruned to two days by each poll.
CREATE TABLE IF NOT EXISTS social_dm_digest_log (
  user_id   TEXT NOT NULL,
  sent_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS social_dm_digest_log_user ON social_dm_digest_log (user_id, sent_at);
-- The per-minute prune by age.
CREATE INDEX IF NOT EXISTS social_dm_digest_log_sent ON social_dm_digest_log (sent_at);

-- Panel CMS drafts (functions/_lib/cms-drafts.ts). One row per draft of a
-- content entry; the pull request carries it into git. base_shas maps every
-- path the draft writes to its blob sha on main when the draft started (null
-- for a new file), so approval can refuse when main moved.
CREATE TABLE IF NOT EXISTS content_drafts (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,          -- CmsType.key
  entry_id    TEXT NOT NULL,          -- the file id (new or existing)
  action      TEXT NOT NULL CHECK (action IN ('create','update','delete')),
  data        TEXT NOT NULL,          -- JSON: the entry (or {en:{frontmatter,body}, tr:{...}} for markdown pairs)
  base_shas   TEXT NOT NULL DEFAULT '{}', -- JSON: path -> blob sha on main when the draft started (null = new file)
  status      TEXT NOT NULL CHECK (status IN ('draft','submitted','approved','pr_open','pr_failed','merged','published','rejected','discarded')),
  author_id   TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT,
  review_note TEXT,
  pr_url      TEXT,
  pr_number   INTEGER,
  failure     TEXT,                   -- short reason shown in the panel
  write_nonce TEXT,                   -- random per write: a guarded write proves it landed (audit.ts AuditProof)
  last_checked_at INTEGER,            -- when the PR shepherd last looked (cms-shepherd.ts); oldest first, NULL first
  agent_token_id TEXT,                -- set when an agent token wrote it (migration 8l); never cleared
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_content_drafts_status ON content_drafts(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_content_drafts_author ON content_drafts(author_id, status);
CREATE INDEX IF NOT EXISTS idx_content_drafts_entry ON content_drafts(type, entry_id);

-- Personal agent tokens (functions/_lib/agent-tokens.ts). The value is shown
-- once and never stored: token_hash is its SHA-256 hex, looked up through the
-- UNIQUE index. scopes is a JSON array such as ["cms.etkinlikler:draft"]; what
-- a token may do is that scope intersected with its member's live grants, read
-- on every request. hint is the value's last 4 characters, for the lists.
CREATE TABLE IF NOT EXISTS agent_tokens (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token_hash    TEXT NOT NULL UNIQUE,
  hint          TEXT NOT NULL,
  label         TEXT NOT NULL,
  scopes        TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_used_at  INTEGER,
  revoked_at    INTEGER,
  revoked_by    TEXT,
  revoke_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_tokens_user ON agent_tokens(user_id, revoked_at);

-- Agent request counters (functions/_lib/agent-limits.ts): one row per UTC
-- day and subject (a token, an IP, or the day's failures), holding every
-- counter of that subject.
-- The key starts with the day, zero-padded, so a day's token rows are one
-- primary-key range (the per-request sums read only today's rows) and the
-- nightly audit prune deletes earlier days by the same range. WITHOUT ROWID
-- and no other index: a bump is one row written (D1's free plan allows
-- 100,000 rows written a day for the whole site).
CREATE TABLE IF NOT EXISTS agent_counters (
  bucket      TEXT PRIMARY KEY,           -- '<day>:t:<token id>', '<day>:i:<sha-256 of the IP or /64>' or '<day>:g:failures'
  user_id     TEXT,                       -- token rows: the token's member, for the member's daily cap
  general     INTEGER NOT NULL DEFAULT 0, -- token rows: requests from the agents' general pool
  reserve     INTEGER NOT NULL DEFAULT 0, -- token rows: requests from the social reserve
  writes      INTEGER NOT NULL DEFAULT 0, -- token rows: daily quotas
  submits     INTEGER NOT NULL DEFAULT 0,
  uploads     INTEGER NOT NULL DEFAULT 0,
  quota_reserve INTEGER NOT NULL DEFAULT 0, -- token rows: of those, spent from the agents' social write reserve
  refusals    INTEGER NOT NULL DEFAULT 0, -- token rows: human_only refusals
  requests    INTEGER NOT NULL DEFAULT 0, -- IP rows: failed bearer requests today; the failures row: all of them
  minute      INTEGER NOT NULL DEFAULT 0, -- the minute (Unix seconds / 60) that minute_n counts
  minute_n    INTEGER NOT NULL DEFAULT 0,
  fail_window INTEGER NOT NULL DEFAULT 0, -- IP rows: the 10-minute window that fail_n counts
  fail_n      INTEGER NOT NULL DEFAULT 0  -- IP rows: failed authentications in it
) WITHOUT ROWID;
