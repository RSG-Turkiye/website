import { getCollection, type CollectionEntry } from "astro:content";
import { splitEditions, currentEditionOf, type CurrentEdition } from "./editions";

export type EditionEntry = CollectionEntry<"editions">;

export async function getUpcomingEdition(now = new Date()): Promise<EditionEntry | null> {
  const entries = await getCollection("editions");
  const { upcoming } = splitEditions(entries.map((e) => e.data), now);
  return upcoming ? entries.find((e) => e.data.year === upcoming.year) ?? null : null;
}

export async function getPastEditions(now = new Date()): Promise<EditionEntry[]> {
  // Returns only the archive: editions that have finished, and undated editions.
  // Future editions not yet announced stay hidden — the site should not render
  // draft markdown ahead of announcement time.
  const entries = await getCollection("editions");
  const { past } = splitEditions(entries.map((e) => e.data), now);
  return past.map((d) => entries.find((e) => e.data.year === d.year)!);
}

export async function getEditionByYear(year: number): Promise<EditionEntry | undefined> {
  const entries = await getCollection("editions");
  return entries.find((e) => e.data.year === year);
}

/**
 * The edition the programme pages present, with the state that decides how.
 * Unlike `getUpcomingEdition`, this keeps returning the symposium that just
 * finished, so /schedule, /speakers and /committee hold its programme as a
 * record instead of announcing it as forthcoming the morning after.
 */
export async function getCurrentEdition(
  now = new Date()
): Promise<{ state: CurrentEdition["state"]; entry: EditionEntry | null }> {
  const entries = await getCollection("editions");
  const { state, edition } = currentEditionOf(entries.map((e) => e.data), now);
  if (!edition) return { state, entry: null };
  return { state, entry: entries.find((e) => e.data.year === edition.year) ?? null };
}
