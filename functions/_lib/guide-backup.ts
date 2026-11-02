import { listProfessors, listLabs, type ProfessorRow, type LabRow } from './guide-db';

/**
 * Nightly backups of the guide's professors and labs to a private R2 bucket
 * (GUIDE_BACKUPS), the last 30 kept. A removed professor is gone from every
 * backup within 30 days, as the privacy notice says. Never git, never the
 * public BLOG_IMAGES bucket. Restore: docs/handover/guide-restore.md.
 */

export const BACKUP_KEEP = 30;
const PREFIX = 'guide-backup-';
const MAX_DELETES = 20;

export interface BackupFile { takenAt: string; professors: ProfessorRow[]; labs: LabRow[] }

export async function backupGuide(env: { DB: D1Database; GUIDE_BACKUPS: R2Bucket }, now: number): Promise<{ key: string; kept: number; deleted: number }> {
  const file: BackupFile = { takenAt: new Date(now * 1000).toISOString(), professors: await listProfessors(env.DB), labs: await listLabs(env.DB) };
  const key = `${PREFIX}${file.takenAt.slice(0, 10)}.json`;
  await env.GUIDE_BACKUPS.put(key, new TextEncoder().encode(JSON.stringify(file)), { httpMetadata: { contentType: 'application/json' } });
  const listed = await env.GUIDE_BACKUPS.list({ prefix: PREFIX, limit: 1000 });
  const keys = listed.objects.map((o) => o.key).sort().reverse();
  const old = keys.slice(BACKUP_KEEP).slice(0, MAX_DELETES);
  if (old.length) await env.GUIDE_BACKUPS.delete(old);
  return { key, kept: Math.min(keys.length, BACKUP_KEEP), deleted: old.length };
}

const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

/** The SQL that puts a backup back into empty guide tables (docs/handover/guide-restore.md). */
export function backupToSql(file: BackupFile): string {
  const labs = file.labs.map((l) =>
    `INSERT OR REPLACE INTO guide_labs (id, name, university_id, url, checked_at) VALUES (${[l.id, l.name, l.universityId, l.url, l.checkedAt].map(q).join(', ')});`);
  const profs = file.professors.map((p) =>
    `INSERT OR REPLACE INTO guide_professors (id, title, name, university_id, department, lab_id, profile_url, openalex_id, hand_topics, hidden_topics, openalex_topics, topics_refreshed_at, topics_failures, programme_ids, source, checked_at) VALUES (${[
      p.id, p.title, p.name, p.universityId, p.department, p.labId, p.profileUrl, p.openalexId,
      JSON.stringify(p.handTopics), JSON.stringify(p.hiddenTopics), JSON.stringify(p.openalexTopics), p.topicsRefreshedAt, p.topicsFailures,
      JSON.stringify(p.programmeIds), p.source, p.checkedAt,
    ].map(q).join(', ')});`);
  return [...labs, ...profs].join('\n') + '\n';
}
