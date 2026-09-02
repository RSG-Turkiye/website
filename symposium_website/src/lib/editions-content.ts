import { getCollection, type CollectionEntry } from "astro:content";
import { splitEditions } from "./editions";

export type EditionEntry = CollectionEntry<"editions">;

export async function getUpcomingEdition(now = new Date()): Promise<EditionEntry | null> {
  const entries = await getCollection("editions");
  const { upcoming } = splitEditions(entries.map((e) => e.data), now);
  return upcoming ? entries.find((e) => e.data.year === upcoming.year) ?? null : null;
}

export async function getPastEditions(now = new Date()): Promise<EditionEntry[]> {
  const entries = await getCollection("editions");
  const { past } = splitEditions(entries.map((e) => e.data), now);
  return past.map((d) => entries.find((e) => e.data.year === d.year)!);
}

export async function getEditionByYear(year: number): Promise<EditionEntry | undefined> {
  const entries = await getCollection("editions");
  return entries.find((e) => e.data.year === year);
}
