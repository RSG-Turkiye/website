import { readdirSync, readFileSync } from 'node:fs';
import { eventSchema, sortEvents, type CommunityEvent } from '../../src/data/events';

/**
 * The events collection read straight from src/content/events, for tests that
 * run under node and so cannot call astro:content. Parsed with the same schema
 * and sorted with the same helper as src/lib/get-events.ts, so a test sees
 * what the pages see. Not a test file: npm test globs tests/*.test.ts only.
 */
export const EVENTS_DIR = new URL('../../src/content/events/', import.meta.url).pathname;

export const eventFiles = () =>
  readdirSync(EVENTS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ file: f, raw: JSON.parse(readFileSync(EVENTS_DIR + f, 'utf8')) as unknown }));

export const readEvents = (): CommunityEvent[] =>
  sortEvents(eventFiles().map(({ raw }) => eventSchema.parse(raw)));
