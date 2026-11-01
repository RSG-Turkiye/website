# Restoring the graduate guide

The guide's professor and lab records live only in D1, never in git
(CLAUDE.md rule 4). If records were deleted or damaged by mistake, there are
two ways back.

## 1. Within 7 days: D1 Time Travel (try this first)

D1 can rewind the database to any moment in the last 7 days. This rewinds
**the whole database** (sessions, the mail queue, everything), so use it only
for a large breakage.

```
! npx wrangler d1 time-travel info rsg-members
! npx wrangler d1 time-travel restore rsg-members --timestamp=<UNIX seconds>
```

## 2. The guide only: from a nightly backup

Every night `guide-backup-YYYY-MM-DD.json` is written to the
`rsg-guide-backups` R2 bucket, and the last 30 are kept. The file holds
names: keep wherever you download it outside the repository, and delete it
when you are done.

1. Download the backup (change the date):

   ```
   ! npx wrangler r2 object get rsg-guide-backups/guide-backup-2026-11-01.json --file=/tmp/guide-backup.json --remote
   ```

2. Turn it into SQL (absolute path to the script in your checkout):

   ```
   ! npx tsx /absolute/path/to/website/scripts/guide-restore-sql.ts /tmp/guide-backup.json > /tmp/guide-restore.sql
   ```

3. Write it to D1. It uses `INSERT OR REPLACE`: it overwrites records that
   exist and leaves records added after the backup alone. Give the absolute
   path (CLAUDE.md, "Working with a non-terminal maintainer").

   ```
   ! npx wrangler d1 execute rsg-members --remote --file=/tmp/guide-restore.sql
   ```

4. In the panel, press **Guide → Republish search index**.

5. Delete `/tmp/guide-backup.json` and `/tmp/guide-restore.sql`.

**Careful:** the backup may hold a professor who asked to be removed after
that night. After restoring, check **Suggestions** in the panel and the
removal-request mails to the admins, and never bring back someone who was
removed on request.
