/**
 * The home page's numbers: what the group has produced, never how many people
 * signed up. Each is counted from the data that records it.
 */

export interface EditionDates { year: number; startDate?: Date }

/**
 * Symposiums that have started by `now`. Older edition pages carry only a
 * year; one of those counts once its year is over, so a page added ahead of a
 * symposium never raises the count before the event.
 */
export function symposiumCount(editions: EditionDates[], now: Date): number {
  return editions.filter((e) => {
    const started = e.startDate ?? new Date(Date.UTC(e.year, 11, 31));
    return started.getTime() <= now.getTime();
  }).length;
}

/** The symposium site's edition pages (one per year), read at build time. */
export function symposiumEditions(): EditionDates[] {
  const pages = import.meta.glob<{ year: number; startDate?: Date | string }>('../../symposium_website/src/content/editions/*.md', {
    eager: true, import: 'frontmatter',
  });
  return Object.values(pages).map((f) => ({ year: Number(f.year), startDate: f.startDate ? new Date(f.startDate) : undefined }));
}
