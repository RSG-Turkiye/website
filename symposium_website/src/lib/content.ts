import { getCollection } from "astro:content";

export type SessionType =
  | "opening" | "keynote" | "workshop" | "panel" | "talk"
  | "company" | "poster" | "networking" | "break" | "closing";

export interface Speaker {
  slug: string; name: string; position: string; company: string;
  bio: string; photo: string;
  linkedin?: string; twitter?: string; website?: string;
}

export interface Session {
  slug: string; title: string; type: SessionType; speakerSlugs: string[];
  description: string; time: string; endTime?: string; order: number;
}

export interface CommitteeMember {
  name: string; role: string; roleTr: string;
  affiliation: string; photo: string; linkedin?: string;
}

async function forYear<T>(collection: "speakers" | "sessions" | "committee", year: number, key: "people" | "items"): Promise<T[]> {
  const entries = await getCollection(collection);
  const entry = entries.find((e: { data: { year: number } }) => e.data.year === year);
  return entry ? ((entry.data as Record<string, unknown>)[key] as T[]) : [];
}

export const getSpeakers = (year: number) => forYear<Speaker>("speakers", year, "people");
export const getCommittee = (year: number) => forYear<CommitteeMember>("committee", year, "people");

export async function getSessions(year: number): Promise<Session[]> {
  const items = await forYear<Session>("sessions", year, "items");
  return [...items].sort((a, b) => a.order - b.order);
}

export async function getSpeakerBySlug(year: number, slug: string): Promise<Speaker | undefined> {
  return (await getSpeakers(year)).find((s) => s.slug === slug);
}
