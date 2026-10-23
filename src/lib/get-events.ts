import { getCollection } from 'astro:content';
import { sortEvents, type CommunityEvent } from '../data/events';

/** Every event in the collection, newest start first (ties by id). */
export const loadEvents = async (): Promise<CommunityEvent[]> =>
  sortEvents((await getCollection('events')).map((e) => e.data));
