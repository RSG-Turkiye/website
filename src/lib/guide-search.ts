/**
 * The graduate guide's search, run in the browser over the search index
 * (professors, from /api/guide/index.json) and the catalog (universities,
 * programmes and related terms, from /guide/catalog.json). No server call
 * per keystroke.
 *
 * Turkish text: fold() maps İ/I correctly and strips diacritics, so
 * "İSTANBUL", "istanbul" and "Istanbul" meet, and "ş" typed as "s" still
 * matches. Endings ("biyoloji" / "biyolojisi") are met by prefix matching
 * rather than a suffix list, which would mangle English topics.
 */
import type { GuideIndex, IndexProfessor } from '../../functions/_lib/guide-index';
import type { GuideCatalog, CatalogProgramme } from './guide-catalog';
import type { RelatedTerm, University } from '../data/guide';

const DIACRITIC: Record<string, string> = { ı: 'i', ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u', â: 'a', î: 'i', û: 'u' };

export function fold(s: string): string {
  return s
    .normalize('NFC')
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[ışçğöüâîû]/g, (c) => DIACRITIC[c] ?? c);
}

export function tokens(s: string): string[] {
  return fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Equal, or one a prefix of the other with the shorter at least five letters. */
const tokenMatch = (a: string, b: string) => a === b || (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a)));
/** Every token of `need` meets some token of `have`. */
const covers = (need: string[], have: string[]) => need.length > 0 && need.every((n) => have.some((h) => tokenMatch(n, h)));
/** A text names a term spelling when it holds every word of the spelling.
 * One direction only: "Biyoinformatik" alone must not name "yapısal
 * biyoinformatik", and "protein" alone must not name "protein structure". */
const names = (text: string[], spelling: string[]) => covers(spelling, text);

/** The term groups the query names, and the groups they point at. */
function groupsFor(q: string[], terms: RelatedTerm[]): { direct: RelatedTerm[]; related: RelatedTerm[] } {
  const direct = terms.filter((g) => g.terms.some((t) => names(q, tokens(t))));
  const ids = new Set(direct.map((g) => g.id));
  const related = terms.filter((g) => !ids.has(g.id) && direct.some((d) => d.related.includes(g.id)));
  return { direct, related };
}

export function expandQuery(q: string, terms: RelatedTerm[]): { tokens: string[]; alsoSearched: string[] } {
  const qt = tokens(q);
  const { direct, related } = groupsFor(qt, terms);
  const own = fold(q.trim());
  const alsoSearched = [...new Set([...direct, ...related].flatMap((g) => g.terms))].filter((t) => fold(t) !== own);
  return { tokens: qt, alsoSearched };
}

export interface SearchResult { professor: IndexProfessor; matched: string[]; score: number }

const byName = (a: IndexProfessor, b: IndexProfessor) => a.name.localeCompare(b.name, 'tr');

export function search(q: string, city: string | null, index: GuideIndex, catalog: GuideCatalog): SearchResult[] {
  const cityOf = new Map(catalog.universities.map((u) => [u.id, fold(u.city)]));
  const inCity = (p: IndexProfessor) => !city || cityOf.get(p.universityId) === fold(city);
  const pool = index.professors.filter(inCity);
  const qt = tokens(q);
  if (qt.length === 0) return [...pool].sort(byName).map((professor) => ({ professor, matched: [], score: 0 }));
  const { direct, related } = groupsFor(qt, catalog.terms);
  const inGroups = (topic: string[], groups: RelatedTerm[]) => groups.some((g) => g.terms.some((t) => names(topic, tokens(t))));
  const results: SearchResult[] = [];
  for (const professor of pool) {
    let score = covers(qt, tokens(professor.name)) ? 3 : 0;
    const matched: string[] = [];
    for (const topic of professor.topics) {
      const tt = tokens(topic);
      const s = covers(qt, tt) ? 3 : inGroups(tt, direct) ? 2 : inGroups(tt, related) ? 1 : 0;
      if (s === 0) continue;
      if (s > score) { score = s; matched.length = 0; }
      if (s === score) matched.push(topic);
    }
    if (score > 0) results.push({ professor, matched, score });
  }
  return results.sort((a, b) => b.score - a.score || byName(a.professor, b.professor));
}

/** Unverified: never confirmed on an official page (checkedAt before 2000; see guide-text checkedLabel). */
export const isUnverified = (p: IndexProfessor) => p.checkedAt < '2000-01-01';

export interface GroupProfessor extends SearchResult {
  /** The programmes this professor is known to supervise in, when known; empty means not known. */
  programmeIds: string[];
}
export interface ResultGroup {
  university: University;
  programmes: (CatalogProgramme & { pageChangedSince?: string })[];
  professors: GroupProfessor[];
  best: number;
}

/**
 * Search results as the page shows them: one group per university, the
 * programme told once. Groups follow their best match; inside a group the
 * order is verified first, then by name, never by score: an automatic topic
 * match is not a ranking of people. Universities with no programme in the
 * guide come last, in their own list.
 */
export function groupResults(results: SearchResult[], catalog: GuideCatalog, pageChanged: Record<string, string> = {}): { groups: ResultGroup[]; withoutProgramme: ResultGroup[] } {
  const byUni = new Map<string, ResultGroup>();
  for (const r of results) {
    const university = catalog.universities.find((u) => u.id === r.professor.universityId);
    if (!university) continue;
    let g = byUni.get(university.id);
    if (!g) {
      const programmes = catalog.programmes
        .filter((p) => p.universityId === university.id)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((p) => (pageChanged[p.id] ? { ...p, pageChangedSince: pageChanged[p.id] } : p));
      g = { university, programmes, professors: [], best: 0 };
      byUni.set(university.id, g);
    }
    const own = new Set(g.programmes.map((p) => p.id));
    g.professors.push({ ...r, programmeIds: r.professor.programmeIds.filter((id) => own.has(id)) });
    g.best = Math.max(g.best, r.score);
  }
  const all = [...byUni.values()];
  // When every professor's programme is known, show only those; one unknown and all the university's are shown.
  // A PhD shows after the MSc it continues, and only when that MSc shows.
  for (const g of all) {
    let msc = g.programmes.filter((p) => p.type !== 'phd');
    if (g.professors.every((p) => p.programmeIds.length)) {
      const used = new Set(g.professors.flatMap((p) => p.programmeIds));
      msc = msc.filter((p) => used.has(p.id));
    }
    const shown = new Set(msc.map((p) => p.id));
    g.programmes = [...msc, ...g.programmes.filter((p) => p.type === 'phd' && p.mscId && shown.has(p.mscId))];
  }
  for (const g of all) g.professors.sort((a, b) => Number(isUnverified(a.professor)) - Number(isUnverified(b.professor)) || byName(a.professor, b.professor));
  all.sort((a, b) => b.best - a.best || a.university.name.tr.localeCompare(b.university.name.tr, 'tr'));
  return { groups: all.filter((g) => g.programmes.length), withoutProgramme: all.filter((g) => !g.programmes.length) };
}

/** A topic as a chip: lower case, except words written with two or more capitals (HLA, RNA-seq). */
function chipCase(t: string): string {
  return t.trim().split(/\s+/).map((w) => ((w.match(/[A-ZÇĞİÖŞÜ]/g) ?? []).length >= 2 ? w : w.toLocaleLowerCase('tr'))).join(' ');
}

/** At most `max` topic chips: the matched ones first, one per spelling. */
export function chipsFor(topics: string[], matched: string[], max = 5): { text: string; hit: boolean }[] {
  const hit = new Set(matched.map(fold));
  const seen = new Set<string>();
  const out: { text: string; hit: boolean }[] = [];
  for (const t of topics) {
    const k = fold(t);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ text: chipCase(t), hit: hit.has(k) });
  }
  return [...out.filter((c) => c.hit), ...out.filter((c) => !c.hit)].slice(0, max);
}

/** The ?city= of a URL as one of the known city names ('' if none), however it was typed or encoded. */
export function cityFromParams(search: string, cities: string[]): string {
  const want = fold(new URLSearchParams(search).get('city') ?? '');
  return want ? cities.find((c) => fold(c) === want) ?? '' : '';
}

/** "Çanakkale" → "canakkale": the universities page's section anchors. */
export const citySlug = (city: string) => fold(city).replace(/[^a-z0-9]+/g, '-');
