import { getCollection } from 'astro:content';
import { sortResources, type ResourceEntry } from '../data/resources';

/** Every resource in the collection, by section then position. */
export const loadResources = async (): Promise<ResourceEntry[]> =>
  sortResources((await getCollection('resources')).map((e) => e.data));
