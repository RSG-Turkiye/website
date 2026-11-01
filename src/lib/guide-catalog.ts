import type { University, Programme, RelatedTerm } from '../data/guide';

/**
 * The institutional half of the graduate guide, published at
 * /guide/catalog.json at build time. The browser joins it with the search
 * index (professors and labs, from D1 via R2), so a programme change is live
 * after its deploy and never needs the index republished.
 */
export type CatalogProgramme = Omit<Programme, 'note'>;
export interface GuideCatalog {
  universities: University[];
  programmes: CatalogProgramme[];
  terms: RelatedTerm[];
}

const byId = <T extends { id: string }>(a: T, b: T) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Sorted by id; a programme's internal `note` is dropped. */
export function buildCatalog(universities: University[], programmes: Programme[], terms: RelatedTerm[]): GuideCatalog {
  return {
    universities: [...universities].sort(byId),
    programmes: programmes.map(({ note: _note, ...p }) => p).sort(byId),
    terms: [...terms].sort(byId),
  };
}
