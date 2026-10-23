import { getEntry } from 'astro:content';
import { textLookup, type Lang } from '../data/page-text';

/**
 * The text of one page (src/content/pages/<page>.json) in one language, as a
 * `(key) => string`. A missing page or an unknown key throws at build time.
 */
export const pageText = async (page: string, lang: Lang): Promise<(key: string) => string> => {
  const entry = await getEntry('pages', page);
  if (!entry) throw new Error(`no page text for "${page}" in src/content/pages`);
  return textLookup(page, entry.data, lang);
};
