import { getCollection } from 'astro:content';
import { sortWorkshops, type Workshop } from '../data/workshops';

/** Every workshop in the collection, newest first. */
export const getWorkshops = async (): Promise<Workshop[]> =>
  sortWorkshops((await getCollection('workshops')).map((e) => e.data));
