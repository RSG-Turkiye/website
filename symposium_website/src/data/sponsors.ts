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
    logo: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606578/rsgturkey/symposium/2023/08/logov2retina.png",
    description: "More Omics into Clinics",
    tier: "gold",
    editions: [2023, 2024],
  },
  {
    name: "Genomize",
    url: "https://genomize.com/",
    logo: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606578/rsgturkey/symposium/2023/08/image.png",
    description: "Turning Genomic Data Into Actionable Insights",
    tier: "gold",
    editions: [2023, 2024],
  },
  {
    name: "ERES Biyoteknoloji",
    url: "https://tr.eresbiotech.com/",
    logo: "https://res.cloudinary.com/dyuf14ra5/image/upload/v1774606579/rsgturkey/symposium/2023/08/10878861_739905599412429_1738250842_o.jpg",
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
