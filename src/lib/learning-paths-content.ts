/**
 * Loads the learning-path collections for one language in the shapes
 * src/lib/learning-paths.ts works on. Kept apart from that file so its pure
 * functions can be tested without astro:content.
 */
import { getCollection } from 'astro:content';
import type { DomainEntry, Lang, LevelEntry, StageEntry } from './learning-paths';

export async function loadPaths(lang: Lang): Promise<{ domains: DomainEntry[]; levels: LevelEntry[]; stages: StageEntry[] }> {
  const prefix = `${lang}/`;
  const domains = (await getCollection('lpDomains', (e) => e.id.startsWith(prefix))).map((e) => ({
    slug: e.id.slice(prefix.length), name: e.data.name, emoji: e.data.emoji, order: e.data.order,
  }));
  const levels = (await getCollection('lpLevels', (e) => e.id.startsWith(prefix))).map((e) => ({
    domain: e.data.domain, level: e.data.level, sections: e.data.sections,
  }));
  const stages = (await getCollection('lpRoadmap', (e) => e.id.startsWith(prefix))).map((e) => ({
    id: e.id, number: e.data.number, title: e.data.title, resources: e.data.resources,
  }));
  return { domains, levels, stages };
}
