import { getCollection } from 'astro:content';
import { committeesFor, type Committee } from '../data/committees';

/** The committees in one language, in page order. */
export const getCommittees = async (lang: 'en' | 'tr'): Promise<Committee[]> =>
  committeesFor((await getCollection('committees')).map((e) => e.data), lang);
