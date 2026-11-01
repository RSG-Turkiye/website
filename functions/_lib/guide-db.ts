import { runWithAudit } from './audit';

/**
 * The graduate guide's professors and labs. They live only in D1: names are
 * personal data and git history cannot be deleted (CLAUDE.md rule 4). Every
 * change is one batch with its audit row, whose details carry the opaque id
 * and nothing else (rule 9: audit rows outlive a removal by up to a year).
 */

export interface LabRow {
  id: string;
  name: string;
  universityId: string;
  url: string;
  checkedAt: number;
}

export interface ProfessorRow {
  id: string;
  title: string;
  name: string;
  universityId: string;
  department: string;
  labId: string | null;
  profileUrl: string;
  openalexId: string | null;
  handTopics: string[];
  hiddenTopics: string[];
  openalexTopics: string[];
  topicsRefreshedAt: number | null;
  topicsFailures: number;
  programmeIds: string[];
  source: string;
  checkedAt: number;
}

const YEAR = 365 * 86400;

const hex12 = (): string => {
  const b = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
};
export const newProfessorId = (): string => `p_${hex12()}`;
export const newLabId = (): string => `l_${hex12()}`;

const list = (s: unknown): string[] => {
  try {
    const v = JSON.parse(String(s ?? '[]'));
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
};

interface ProfessorDb {
  id: string; title: string; name: string; university_id: string; department: string; lab_id: string | null;
  profile_url: string; openalex_id: string | null; hand_topics: string; hidden_topics: string; openalex_topics: string;
  topics_refreshed_at: number | null; topics_failures: number; programme_ids: string; source: string; checked_at: number;
}

const toProfessor = (r: ProfessorDb): ProfessorRow => ({
  id: r.id, title: r.title, name: r.name, universityId: r.university_id, department: r.department, labId: r.lab_id ?? null,
  profileUrl: r.profile_url, openalexId: r.openalex_id ?? null, handTopics: list(r.hand_topics), hiddenTopics: list(r.hidden_topics),
  openalexTopics: list(r.openalex_topics), topicsRefreshedAt: r.topics_refreshed_at ?? null, topicsFailures: Number(r.topics_failures ?? 0),
  programmeIds: list(r.programme_ids), source: r.source, checkedAt: Number(r.checked_at),
});

export async function listProfessors(db: D1Database): Promise<ProfessorRow[]> {
  const { results } = await db.prepare('SELECT * FROM guide_professors ORDER BY name').all<ProfessorDb>();
  return (results ?? []).map(toProfessor);
}

export async function listLabs(db: D1Database): Promise<LabRow[]> {
  const { results } = await db.prepare('SELECT id, name, university_id, url, checked_at FROM guide_labs ORDER BY name')
    .all<{ id: string; name: string; university_id: string; url: string; checked_at: number }>();
  return (results ?? []).map((r) => ({ id: r.id, name: r.name, universityId: r.university_id, url: r.url, checkedAt: Number(r.checked_at) }));
}

export function upsertProfessor(db: D1Database, p: ProfessorRow, actorId: string | null, now: number): Promise<void> {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO guide_professors (id, title, name, university_id, department, lab_id, profile_url, openalex_id,
       hand_topics, hidden_topics, openalex_topics, topics_refreshed_at, topics_failures, programme_ids, source, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    p.id, p.title, p.name, p.universityId, p.department, p.labId, p.profileUrl, p.openalexId,
    JSON.stringify(p.handTopics), JSON.stringify(p.hiddenTopics), JSON.stringify(p.openalexTopics),
    p.topicsRefreshedAt, p.topicsFailures, JSON.stringify(p.programmeIds), p.source, p.checkedAt,
  );
  return runWithAudit(db, [stmt], { userId: actorId, action: 'guide.professor.save', targetType: 'guide_professor', targetId: p.id }, now);
}

export function upsertLab(db: D1Database, l: LabRow, actorId: string | null, now: number): Promise<void> {
  const stmt = db.prepare('INSERT OR REPLACE INTO guide_labs (id, name, university_id, url, checked_at) VALUES (?, ?, ?, ?, ?)')
    .bind(l.id, l.name, l.universityId, l.url, l.checkedAt);
  return runWithAudit(db, [stmt], { userId: actorId, action: 'guide.lab.save', targetType: 'guide_lab', targetId: l.id }, now);
}

export function deleteProfessor(db: D1Database, id: string, actorId: string | null, now: number): Promise<void> {
  return runWithAudit(db, [db.prepare('DELETE FROM guide_professors WHERE id = ?').bind(id)],
    { userId: actorId, action: 'guide.professor.delete', targetType: 'guide_professor', targetId: id }, now);
}

export async function deleteLab(db: D1Database, id: string, actorId: string | null, now: number): Promise<{ ok: true } | { ok: false; code: 'lab_in_use' }> {
  const used = await db.prepare('SELECT 1 FROM guide_professors WHERE lab_id = ? LIMIT 1').bind(id).first();
  if (used) return { ok: false, code: 'lab_in_use' };
  await runWithAudit(db, [db.prepare('DELETE FROM guide_labs WHERE id = ?').bind(id)],
    { userId: actorId, action: 'guide.lab.delete', targetType: 'guide_lab', targetId: id }, now);
  return { ok: true };
}

/** Records nobody has confirmed against their source for a year. */
export async function staleRecords(db: D1Database, now: number): Promise<{ professors: string[]; labs: string[] }> {
  const cutoff = now - YEAR;
  const p = await db.prepare('SELECT id FROM guide_professors WHERE checked_at < ? ORDER BY id').bind(cutoff).all<{ id: string }>();
  const l = await db.prepare('SELECT id FROM guide_labs WHERE checked_at < ? ORDER BY id').bind(cutoff).all<{ id: string }>();
  return { professors: (p.results ?? []).map((r) => r.id), labs: (l.results ?? []).map((r) => r.id) };
}
