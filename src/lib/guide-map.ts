/**
 * The graduate guide's city map: an outline of Türkiye and one marker per
 * city that has a university in the guide. Drawn at build time as inline SVG
 * (src/components/guide/GuideMap.astro). There are no map tiles, no library
 * and nothing fetched: tile hosts are a blocking risk in Türkiye, and a
 * picture of eleven cities does not need them.
 *
 * Markers are cities, never people, and every marker is the same size: a
 * bigger İstanbul would read as a better İstanbul.
 */

/** A plain equirectangular projection, x shrunk by cos(39°) so the country keeps its shape. */
export const MAP = { west: 25.6, north: 42.2, k: 40, cosLat: Math.cos((39 * Math.PI) / 180), width: 600, height: 266 } as const;

export function project(lat: number, lon: number): { x: number; y: number } {
  return { x: (lon - MAP.west) * MAP.cosLat * MAP.k, y: (MAP.north - lat) * MAP.k };
}

/** Where a city's name sits relative to its dot; set by hand where neighbours crowd (Marmara). */
export type LabelSide = 'e' | 'w' | 'n' | 's' | 'nw' | 'sw' | 'se';

/**
 * Province centres, a little wider than the guide's cities today so a new
 * university in a common university city needs no code change. A city
 * missing here is simply not drawn; tests/guide-map.test.ts names it.
 */
export const CITY_COORDS: Record<string, { lat: number; lon: number; side?: LabelSide }> = {
  'Adana': { lat: 37.0, lon: 35.32 },
  'Afyonkarahisar': { lat: 38.76, lon: 30.54 },
  'Ankara': { lat: 39.93, lon: 32.86 },
  'Antalya': { lat: 36.9, lon: 30.7 },
  'Aydın': { lat: 37.85, lon: 27.84, side: 's' },
  'Balıkesir': { lat: 39.65, lon: 27.88 },
  'Bolu': { lat: 40.74, lon: 31.61 },
  'Bursa': { lat: 40.19, lon: 29.06 },
  'Çanakkale': { lat: 40.15, lon: 26.41, side: 'se' },
  'Denizli': { lat: 37.78, lon: 29.09 },
  'Diyarbakır': { lat: 37.91, lon: 40.24 },
  'Düzce': { lat: 40.84, lon: 31.16 },
  'Edirne': { lat: 41.68, lon: 26.56, side: 'n' },
  'Elazığ': { lat: 38.67, lon: 39.22, side: 'n' },
  'Erzurum': { lat: 39.9, lon: 41.27 },
  'Eskişehir': { lat: 39.78, lon: 30.52 },
  'Gaziantep': { lat: 37.07, lon: 37.38 },
  'Hatay': { lat: 36.2, lon: 36.16 },
  'Isparta': { lat: 37.76, lon: 30.55 },
  'İstanbul': { lat: 41.01, lon: 28.98, side: 'n' },
  'İzmir': { lat: 38.42, lon: 27.14 },
  'Kastamonu': { lat: 41.38, lon: 33.78 },
  'Kayseri': { lat: 38.73, lon: 35.49 },
  'Kocaeli': { lat: 40.77, lon: 29.94 },
  'Konya': { lat: 37.87, lon: 32.48 },
  'Malatya': { lat: 38.35, lon: 38.31 },
  'Manisa': { lat: 38.61, lon: 27.43 },
  'Mersin': { lat: 36.8, lon: 34.63, side: 's' },
  'Muğla': { lat: 37.22, lon: 28.36, side: 's' },
  'Niğde': { lat: 37.97, lon: 34.68 },
  'Sakarya': { lat: 40.69, lon: 30.44 },
  'Samsun': { lat: 41.29, lon: 36.33 },
  'Sivas': { lat: 39.75, lon: 37.02 },
  'Tekirdağ': { lat: 40.98, lon: 27.51 },
  'Trabzon': { lat: 41.0, lon: 39.72 },
  'Van': { lat: 38.5, lon: 43.38 },
};

export interface MapCity {
  name: string;
  x: number;
  y: number;
  side: LabelSide;
  universities: number;
  /** No university in this city has an MSc programme in the guide yet: drawn faded, not hidden. */
  faded: boolean;
}

/** The markers for these universities: one per known city, sorted by name. */
export function mapCities(universities: { id: string; city: string }[], programmes: { universityId: string }[]): MapCity[] {
  const withProgramme = new Set(programmes.map((p) => p.universityId));
  const byCity = new Map<string, { id: string }[]>();
  for (const u of universities) byCity.set(u.city, [...(byCity.get(u.city) ?? []), u]);
  return [...byCity]
    .filter(([city]) => CITY_COORDS[city])
    .map(([city, us]) => {
      const c = CITY_COORDS[city];
      const { x, y } = project(c.lat, c.lon);
      return { name: city, x, y, side: c.side ?? 'e', universities: us.length, faded: !us.some((u) => withProgramme.has(u.id)) };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
