/**
 * The webinar list's filters: search, "only with a recording" and year, all
 * applied together and kept in the address (?video=1&year=2025) so a filtered
 * list can be shared. Pure, so the pages' scripts and the tests share it.
 */

export interface WebinarFacts { title: string; speaker: string; description: string; year: string; hasVideo: boolean }
export interface FilterState { term: string; year: string | null; videoOnly: boolean }

const YEAR = /^\d{4}$/;

export function matches(w: WebinarFacts, s: FilterState): boolean {
  if (s.videoOnly && !w.hasVideo) return false;
  if (s.year && w.year !== s.year) return false;
  const term = s.term.trim().toLocaleLowerCase('tr');
  if (!term) return true;
  return [w.title, w.speaker, w.description].some((f) => f.toLocaleLowerCase('tr').includes(term));
}

/** The filter an address asks for. The search term is never in the address, so it starts empty. Older links named a year as #2025. */
export function stateFromUrl(url: URL): FilterState {
  const fromQuery = url.searchParams.get('year');
  const fromHash = url.hash.replace('#', '');
  const year = fromQuery && YEAR.test(fromQuery) ? fromQuery : YEAR.test(fromHash) ? fromHash : null;
  return { term: '', year, videoOnly: url.searchParams.get('video') === '1' };
}

/** Writes the filter into `url` in place, leaving other parameters (page) alone. */
export function applyStateToUrl(url: URL, s: FilterState): void {
  if (s.videoOnly) url.searchParams.set('video', '1'); else url.searchParams.delete('video');
  if (s.year) url.searchParams.set('year', s.year); else url.searchParams.delete('year');
  if (YEAR.test(url.hash.replace('#', ''))) url.hash = '';
}
