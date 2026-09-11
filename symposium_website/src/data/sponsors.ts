export interface Sponsor {
  name: string;
  url: string;
  logo: string;
  description: string;
  tier: "gold" | "silver" | "supporter";
  editions: number[];
}

export const sponsors: Sponsor[] = [
  {
    name: "PhiTech",
    url: "https://phitech.bio/",
    logo: "https://res.cloudinary.com/dyuf14ra5/image/upload/f_auto,q_auto,c_limit,w_1600/v1774606578/rsgturkey/symposium/2023/08/logov2retina.png",
    description: "More Omics into Clinics",
    tier: "gold",
    editions: [2023, 2024],
  },
  {
    name: "Genomize",
    url: "https://genomize.com/",
    logo: "https://res.cloudinary.com/dyuf14ra5/image/upload/f_auto,q_auto,c_limit,w_1600/v1774606578/rsgturkey/symposium/2023/08/image.png",
    description: "Turning Genomic Data Into Actionable Insights",
    tier: "gold",
    editions: [2023, 2024],
  },
  {
    name: "ERES Biyoteknoloji",
    url: "https://tr.eresbiotech.com/",
    logo: "https://res.cloudinary.com/dyuf14ra5/image/upload/f_auto,q_auto,c_limit,w_1600/v1774606579/rsgturkey/symposium/2023/08/10878861_739905599412429_1738250842_o.jpg",
    description: "Bioteknoloji çözümleri",
    tier: "silver",
    editions: [2023, 2024],
  },
  {
    name: "Ankara Chamber of Commerce",
    url: "https://www.atonet.org.tr/",
    logo: "",
    description: "",
    tier: "supporter",
    editions: [2023, 2024],
  },
];

export function getSponsorsByEdition(year: number): Sponsor[] {
  return sponsors.filter((s) => s.editions.includes(year));
}

/**
 * The sponsors of editions before `year`, and which years each supported.
 *
 * There used to be a `getSponsorsForOrLatest` that answered "this edition's
 * sponsors, or the last edition that had any". The fallback was meant to
 * save a code change when 2026's sponsors arrived. What it actually did was
 * put 2023 and 2024's companies under a heading that reads "Our Sponsors"
 * on a page about the 2026 symposium -- naming firms as backers of an event
 * they have not agreed to back. Nobody reading it could tell.
 *
 * So the two questions are now asked separately and answered honestly:
 * `getSponsorsByEdition` for who is sponsoring this one, this for who has
 * before. Nothing still has to change when 2026's sponsors are added -- add
 * 2026 to a sponsor's `editions` and it moves from one list to the other by
 * itself.
 */
export function getPastSponsors(year: number): { sponsor: Sponsor; years: number[] }[] {
  return sponsors
    .filter((s) => !s.editions.includes(year) && s.editions.some((y) => y < year))
    .map((s) => ({ sponsor: s, years: s.editions.filter((y) => y < year).sort((a, b) => b - a) }))
    // Most recent supporter first, then alphabetically so the order never
    // depends on the order of the array above.
    .sort((a, b) => b.years[0] - a.years[0] || a.sponsor.name.localeCompare(b.sponsor.name));
}
