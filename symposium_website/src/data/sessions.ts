export type SessionType =
  | "opening"
  | "keynote"
  | "workshop"
  | "panel"
  | "talk"
  | "company"
  | "poster"
  | "networking"
  | "break"
  | "closing";

export interface Session {
  slug: string;
  title: string;
  type: SessionType;
  speakerSlugs: string[];
  description: string;
  /** Edition year */
  edition: number;
  /** Display order within the day */
  order: number;
}

export const sessions: Session[] = [
  // ── 2024 Edition Schedule ─────────────────────────────────────
  { slug: "opening", title: "Opening Remarks", type: "opening", speakerSlugs: [], description: "", edition: 2024, order: 1 },
  { slug: "keynote-i-2024", title: "Keynote I", type: "keynote", speakerSlugs: ["prof-dr-gokhan-kacar"], description: "Molecular Dynamics Simulations of Nanoscale Drug Carrier Systems", edition: 2024, order: 2 },
  { slug: "coffee-break-1", title: "Coffee Break", type: "break", speakerSlugs: [], description: "", edition: 2024, order: 3 },
  { slug: "keynote-ii-2024", title: "Keynote II", type: "keynote", speakerSlugs: ["mehmet-baysan"], description: "Data Science and Clinical Bioinformatics", edition: 2024, order: 4 },
  { slug: "student-talk-2024", title: "Student Talk", type: "talk", speakerSlugs: [], description: "", edition: 2024, order: 5 },
  { slug: "lunch-2024", title: "Lunch", type: "break", speakerSlugs: [], description: "", edition: 2024, order: 6 },
  {
    slug: "panel-discussion-2024",
    title: "Panel Discussion: Clinical Bioinformatics Startups — From Idea to Market",
    type: "panel",
    speakerSlugs: [],
    description: "A panel exploring the journey from research idea to market-ready bioinformatics product.",
    edition: 2024,
    order: 7,
  },
  { slug: "company-presentation-i", title: "Company Presentation I", type: "company", speakerSlugs: [], description: "", edition: 2024, order: 8 },
  { slug: "career-session-2024", title: "Round Table Meetings — Career Session", type: "networking", speakerSlugs: [], description: "", edition: 2024, order: 9 },
  { slug: "poster-session-2024", title: "Poster Session & Networking", type: "poster", speakerSlugs: [], description: "", edition: 2024, order: 10 },
  { slug: "closing-day1", title: "Closing Remarks for Day 1", type: "closing", speakerSlugs: [], description: "", edition: 2024, order: 11 },
  {
    slug: "workshop-kubra-narci",
    title: "Workshop: Nextflow and nf-core",
    type: "workshop",
    speakerSlugs: ["kubra-narci"],
    description: "Hands-on workshop on building reproducible bioinformatics pipelines with Nextflow and nf-core.",
    edition: 2024,
    order: 12,
  },
  { slug: "company-presentation-ii", title: "Company Presentation II", type: "company", speakerSlugs: [], description: "", edition: 2024, order: 13 },
  { slug: "company-presentation-iii", title: "Company Presentation III", type: "company", speakerSlugs: [], description: "", edition: 2024, order: 14 },
  { slug: "student-talks-2024", title: "Student Talks (×3)", type: "talk", speakerSlugs: [], description: "", edition: 2024, order: 15 },
  { slug: "closing-2024", title: "Closing", type: "closing", speakerSlugs: [], description: "", edition: 2024, order: 16 },
];

export const sessionTypeColors: Record<SessionType, string> = {
  opening: "bg-navy text-white",
  keynote: "bg-red text-white",
  workshop: "bg-[#0E7490] text-white",
  panel: "bg-[#7C3AED] text-white",
  talk: "bg-navy-mid text-white",
  company: "bg-[#92400E] text-white",
  poster: "bg-[#065F46] text-white",
  networking: "bg-[#1D4ED8] text-white",
  break: "bg-border text-navy",
  closing: "bg-navy text-white",
};

export function getSessionsByEdition(year: number): Session[] {
  return sessions
    .filter((s) => s.edition === year)
    .sort((a, b) => a.order - b.order);
}
