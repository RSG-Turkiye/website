import { z } from 'astro/zod';

/**
 * RSG-Türkiye's hands-on workshops whose materials are public on GitHub
 * (github.com/RSG-Turkiye). One file per workshop in src/content/workshops,
 * named after its repo in lower case. Listed in /llms.txt and beside /workshops; the
 * learning paths link the ones that fit a level. A workshop whose materials
 * are not public does not belong here: this is a list of things a reader can
 * open.
 */
export const workshopSchema = z.object({
  year: z.number(),
  title: z.string(),
  /** What a reader can learn from the materials, in a few words. */
  topics: z.string(),
  /** The repository under github.com/RSG-Turkiye, with its real case; the
   * file name is the same name in lower case (src/content file names are
   * lowercase slugs). */
  repo: z.string(),
}).strict();

export type Workshop = z.infer<typeof workshopSchema>;

/**
 * Newest first. Ties on the year go by repo: that is today's order (the
 * structural-biology workshop before the command-line one), which a title
 * sort would reverse.
 */
export const sortWorkshops = (list: Workshop[]) =>
  [...list].sort((a, b) => b.year - a.year || a.repo.localeCompare(b.repo, 'en'));

export const workshopUrl = (w: Workshop) => `https://github.com/RSG-Turkiye/${w.repo}`;
