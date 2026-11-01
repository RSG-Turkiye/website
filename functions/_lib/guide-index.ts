import { listProfessors, listLabs, type ProfessorRow, type LabRow } from './guide-db';

/**
 * The graduate guide's search index: professors and labs from D1, published
 * as one JSON object in R2 and served through the site's own domain
 * (functions/api/guide/index.json.ts). The browser joins it with
 * /guide/catalog.json and searches locally (src/lib/guide-search.ts).
 *
 * Only PROFESSOR_FIELDS ever leave D1. A publish that cannot read D1 writes
 * nothing, so the last good index keeps serving; every outcome is recorded
 * in guide_index_state for the panel.
 */

export const INDEX_KEY = 'guide/index.json';

export const PROFESSOR_FIELDS = [
  'id', 'title', 'name', 'universityId', 'department', 'labId', 'profileUrl', 'openalexId', 'topics', 'programmeIds', 'checkedAt', 'source',
] as const;

export interface IndexProfessor {
  id: string;
  title: string;
  name: string;
  universityId: string;
  department: string;
  labId: string | null;
  profileUrl: string;
  openalexId: string | null;
  topics: string[];
  programmeIds: string[];
  checkedAt: string;
  source: string;
}
export interface IndexLab { id: string; name: string; universityId: string; url: string }
/**
 * Programme id → the day its announcement page was seen to change, for a
 * change nobody has handled in STALE_PAGE_DAYS: the page tells the reader not
 * to rely on that programme's entry (owner, 2026-11-01: if nobody maintains
 * the guide, it should say so rather than be quietly wrong).
 */
export type PageChanged = Record<string, string>;
export interface GuideIndex { generatedAt: string; professors: IndexProfessor[]; labs: IndexLab[]; pageChanged: PageChanged }

export const STALE_PAGE_DAYS = 10;

const day = (s: number) => new Date(s * 1000).toISOString().slice(0, 10);
const key = (t: string) => t.trim().toLocaleLowerCase('tr');

/** Hand topics first, then OpenAlex topics not hidden, deduplicated ignoring case. */
function topicsOf(p: ProfessorRow): string[] {
  const hidden = new Set(p.hiddenTopics.map(key));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...p.handTopics, ...p.openalexTopics.filter((t) => !hidden.has(key(t)))]) {
    if (!t.trim() || seen.has(key(t))) continue;
    seen.add(key(t));
    out.push(t.trim());
  }
  return out;
}

/**
 * Open "page changed" rows older than STALE_PAGE_DAYS, spread over every
 * programme that uses the page. A muted page's alarms are noise by the
 * approver's judgment, so it never warns.
 */
export async function listChangedPages(db: D1Database, now: number): Promise<PageChanged> {
  const { results } = await db.prepare(
    `SELECT j.value AS id, MIN(r.created_at) AS since
     FROM intake_rows r
     JOIN guide_page_watch w ON w.url = json_extract(r.payload, '$.link') AND w.muted = 0
     JOIN json_each(w.programme_ids) j
     WHERE r.source = 'guide' AND r.kind = 'page_changed' AND r.status = 'new' AND r.created_at <= ?
     GROUP BY j.value ORDER BY j.value`,
  ).bind(now - STALE_PAGE_DAYS * 86400).all<{ id: string; since: number }>();
  return Object.fromEntries((results ?? []).map((r) => [r.id, day(r.since)]));
}

export function buildGuideIndex(profs: ProfessorRow[], labs: LabRow[], now: number, pageChanged: PageChanged = {}): GuideIndex {
  const professors: IndexProfessor[] = profs.map((p) => ({
    id: p.id, title: p.title, name: p.name, universityId: p.universityId, department: p.department, labId: p.labId,
    profileUrl: p.profileUrl, openalexId: p.openalexId, topics: topicsOf(p), programmeIds: p.programmeIds,
    checkedAt: day(p.checkedAt), source: p.source,
  }));
  const used = new Set(professors.map((p) => p.labId).filter(Boolean));
  return {
    generatedAt: new Date(now * 1000).toISOString(),
    professors,
    // A lab is often named after a person: one with no professor left goes.
    labs: labs.filter((l) => used.has(l.id)).map((l) => ({ id: l.id, name: l.name, universityId: l.universityId, url: l.url })),
    pageChanged,
  };
}

interface Catalog { universities: { id: string }[]; programmes: { id: string }[] }

/** References the browser could not resolve: programme, university or lab ids. */
export function countUnresolved(index: GuideIndex, catalog: Catalog): number {
  const unis = new Set(catalog.universities.map((u) => u.id));
  const progs = new Set(catalog.programmes.map((p) => p.id));
  const labs = new Set(index.labs.map((l) => l.id));
  let n = 0;
  for (const p of index.professors) {
    if (!unis.has(p.universityId)) n++;
    if (p.labId && !labs.has(p.labId)) n++;
    for (const id of p.programmeIds) if (!progs.has(id)) n++;
  }
  return n;
}

export interface PublishEnv {
  DB: D1Database;
  BLOG_IMAGES: R2Bucket;
  ASSETS?: { fetch: (input: RequestInfo) => Promise<Response> };
}

async function readCatalog(env: PublishEnv): Promise<Catalog | null> {
  try {
    const res = await env.ASSETS?.fetch(new Request('https://assets.local/guide/catalog.json'));
    if (!res || !res.ok) return null;
    return (await res.json()) as Catalog;
  } catch {
    return null;
  }
}

export type PublishResult = { ok: true; count: number; unresolved: number | null } | { ok: false; reason: string };

export async function publishGuideIndex(env: PublishEnv, now: number): Promise<PublishResult> {
  let index: GuideIndex;
  try {
    index = buildGuideIndex(await listProfessors(env.DB), await listLabs(env.DB), now, await listChangedPages(env.DB, now));
  } catch (err) {
    const reason = String((err as Error)?.message ?? err).slice(0, 300);
    await recordState(env.DB, { error: reason });
    return { ok: false, reason };
  }
  const catalog = await readCatalog(env);
  const unresolved = catalog ? countUnresolved(index, catalog) : null;
  try {
    await env.BLOG_IMAGES.put(INDEX_KEY, new TextEncoder().encode(JSON.stringify(index)), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
    });
  } catch (err) {
    const reason = String((err as Error)?.message ?? err).slice(0, 300);
    await recordState(env.DB, { error: reason });
    return { ok: false, reason };
  }
  await recordState(env.DB, { publishedAt: now, count: index.professors.length, unresolved, error: null });
  return { ok: true, count: index.professors.length, unresolved };
}

async function recordState(db: D1Database, s: { publishedAt?: number; count?: number; unresolved?: number | null; error: string | null }): Promise<void> {
  try {
    if (s.publishedAt === undefined) {
      await db.prepare('UPDATE guide_index_state SET error = ? WHERE id = 1').bind(s.error).run();
    } else {
      await db.prepare('UPDATE guide_index_state SET published_at = ?, count = ?, unresolved = ?, error = NULL WHERE id = 1')
        .bind(s.publishedAt, s.count ?? 0, s.unresolved ?? null).run();
    }
  } catch {
    // D1 is what failed; the result returned to the caller still says so.
  }
}
