/**
 * Turns one guide backup file (from the rsg-guide-backups R2 bucket) into the
 * SQL that puts its professors and labs back into D1. See
 * docs/handover/guide-restore.md. The output holds names: write it outside
 * the repository and delete it after the restore (CLAUDE.md rule 4).
 *
 *   npx tsx scripts/guide-restore-sql.ts <backup.json> > /tmp/guide-restore.sql
 */
import { readFileSync } from 'node:fs';
import { backupToSql, type BackupFile } from '../functions/_lib/guide-backup';

const file = process.argv[2];
if (!file) {
  console.error('usage: npx tsx scripts/guide-restore-sql.ts <backup.json>');
  process.exit(2);
}
process.stdout.write(backupToSql(JSON.parse(readFileSync(file, 'utf8')) as BackupFile));
