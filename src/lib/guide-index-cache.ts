import type { GuideIndex } from '../../functions/_lib/guide-index';

/**
 * The browser keeps the guide's search index for five minutes, so moving
 * between guide pages does not refetch it, and a removal still reaches an
 * open tab within minutes, as the privacy notice says.
 */
export const INDEX_TTL_SECONDS = 300;

/** The stored copy if it is younger than the TTL, else null (refetch). */
export function readCachedIndex(stored: string | null, now: number): GuideIndex | null {
  if (!stored) return null;
  try {
    const v = JSON.parse(stored) as { at?: unknown; index?: GuideIndex };
    if (typeof v.at !== 'number' || !v.index || now - v.at > INDEX_TTL_SECONDS) return null;
    return v.index;
  } catch {
    return null;
  }
}

export const writeCachedIndex = (index: GuideIndex, now: number): string => JSON.stringify({ at: now, index });
