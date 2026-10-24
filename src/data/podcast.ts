/**
 * The podcast data, src/data/podcast.json: written from the show's RSS feed
 * by the panel's "Yeni bölümleri çek" or `npm run podcast:sync`
 * (src/lib/podcast-feed.ts), never typed by hand.
 *
 * The schema holds what tests/podcast.test.ts checks (audio, guid, a
 * readable date, newest first, no shared guid or audio URL), so a pulled
 * feed that passes it cannot fail that test. Keys are in the file's order:
 * the CMS writes them in this order.
 *
 * No astro:content import here, so node tests and the Functions can use it.
 */

import { z } from "astro/zod";

const https = z.string().regex(/^https:\/\//, "Must be an https:// address");
/** Artwork may be missing (an episode without its own); when given, https only. */
const httpsOrEmpty = z.string().regex(/^(https:\/\/.+)?$/, "Must be empty or an https:// address");
const readableDate = z.string().refine((s) => Number.isFinite(Date.parse(s)), "Not a readable date");

export const episodeSchema = z
  .object({
    guid: z.string().trim().min(1),
    title: z.string().trim().min(1),
    pubDate: readableDate,
    durationSeconds: z.number().int().min(0),
    audioUrl: https,
    audioBytes: z.number().int().min(0),
    image: httpsOrEmpty,
    description: z.string(),
  })
  .strict();

export const podcastSchema = z
  .object({
    syncedAt: readableDate,
    title: z.string().trim().min(1),
    description: z.string(),
    image: https,
    platforms: z
      .object({ spotify: https, apple: https, castbox: https, rss: https })
      .strict(),
    episodes: z.array(episodeSchema).min(1),
  })
  .strict()
  .superRefine((show, ctx) => {
    const seen = { guid: new Set<string>(), audioUrl: new Set<string>() };
    show.episodes.forEach((e, i) => {
      for (const key of ["guid", "audioUrl"] as const) {
        if (seen[key].has(e[key])) ctx.addIssue({ code: "custom", path: ["episodes", i, key], message: "Two episodes share this" });
        seen[key].add(e[key]);
      }
      if (i > 0 && Date.parse(e.pubDate) > Date.parse(show.episodes[i - 1].pubDate)) {
        ctx.addIssue({ code: "custom", path: ["episodes", i, "pubDate"], message: "Episodes must be newest first" });
      }
    });
  });

export type PodcastShow = z.input<typeof podcastSchema>;
