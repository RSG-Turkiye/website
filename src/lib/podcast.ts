/**
 * The podcast, as the pages need it.
 *
 * Episodes come from src/data/podcast.json, written by scripts/sync-podcast.ts
 * from the show's RSS feed. Nothing here touches the network: see that script
 * for why the feed is not read at build time.
 */
import data from '../data/podcast.json';

export interface Episode {
  guid: string;
  title: string;
  /** ISO 8601, so each language can format it its own way. */
  pubDate: string;
  durationSeconds: number;
  audioUrl: string;
  audioBytes: number;
  image: string;
  description: string;
}

export interface Show {
  syncedAt: string;
  title: string;
  description: string;
  image: string;
  platforms: { spotify: string; apple: string; castbox: string; rss: string };
  episodes: Episode[];
}

export const show: Show = data as Show;

/** Newest first, which is how a podcast is read. */
export const episodes: Episode[] = [...show.episodes].sort(
  (a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate),
);

export const latest: Episode | undefined = episodes[0];

/**
 * "51 dk" / "51 min" -- the useful unit for an hour-long interview. Under a
 * minute would read as "0 dk", so those get seconds; no episode is that short
 * today, but a trailer would be.
 */
export function formatDuration(seconds: number, lang: 'en' | 'tr'): string {
  if (seconds <= 0) return '';
  if (seconds < 60) return lang === 'tr' ? `${seconds} sn` : `${seconds} sec`;
  const minutes = Math.round(seconds / 60);
  return lang === 'tr' ? `${minutes} dk` : `${minutes} min`;
}

/** The published date in the reader's language. */
export function formatDate(iso: string, lang: 'en' | 'tr'): string {
  return new Date(iso).toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** Trimmed to fit a card without a wall of text, on a word boundary. */
export function summarise(description: string, limit = 260): string {
  if (description.length <= limit) return description;
  const cut = description.slice(0, limit);
  const lastSpace = cut.lastIndexOf(' ');
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : limit).trimEnd()}…`;
}
