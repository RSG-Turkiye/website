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
import type { GuideIndex, IndexProfessor, IndexLab } from '../../functions/_lib/guide-index';
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

export interface Card {
  university: University | undefined;
  lab?: IndexLab;
  programmes: (CatalogProgramme & { showWindow: boolean })[];
  programmeUnknown: boolean;
  /** No programme was chosen for this professor: these are all of the
   * university's programmes, a guess the card must say is one. */
  fallback: boolean;
}

/** `today` is the Istanbul date, YYYY-MM-DD (src/lib/istanbul-time.ts). */
export function joinCard(p: IndexProfessor, catalog: GuideCatalog, today: string, labs: IndexLab[] = []): Card {
  const own = catalog.programmes.filter((x) => x.universityId === p.universityId);
  const listed = p.programmeIds.map((id) => catalog.programmes.find((x) => x.id === id)).filter((x): x is CatalogProgramme => Boolean(x));
  const chosen = listed.length ? listed : own;
  return {
    university: catalog.universities.find((u) => u.id === p.universityId),
    lab: p.labId ? labs.find((l) => l.id === p.labId) : undefined,
    programmes: chosen.map((x) => ({ ...x, showWindow: Boolean(x.windowOpens && x.windowCloses && x.windowCloses >= today) })),
    programmeUnknown: chosen.length === 0,
    fallback: listed.length === 0,
  };
}
