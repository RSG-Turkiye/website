/**
 * Learning-path facts other pages need: which paths a webinar belongs to, and
 * how far a member has got along each path. Pure functions over content that
 * the callers load, so both are testable without Astro.
 */

export const LEVEL_ORDER = ['explorer', 'practitioner', 'researcher', 'specialist'] as const;
export type LevelId = (typeof LEVEL_ORDER)[number];
export type Lang = 'en' | 'tr';

export const LEVEL_LABELS: Record<Lang, Record<LevelId, string>> = {
  en: { explorer: 'Explorer', practitioner: 'Practitioner', researcher: 'Researcher', specialist: 'Specialist' },
  tr: { explorer: 'Keşifçi', practitioner: 'Uygulayıcı', researcher: 'Araştırmacı', specialist: 'Uzman' },
};

interface Resource { id: string; webinarSlug?: string }
export interface LevelEntry { domain: string; level: LevelId; sections: { resources: Resource[] }[] }
export interface StageEntry { id: string; number: number; title: string; resources: Resource[] }
export interface DomainEntry { slug: string; name: string; emoji: string; order: number }

const base = (lang: Lang) => (lang === 'tr' ? '/tr/learning-paths' : '/learning-paths');

/** One place on a path: a domain's level, or a roadmap stage. */
export interface PathUnit {
  key: string;
  label: string;
  href: string;
  /** Progress keys, without the "tr-" prefix Turkish pages add. */
  ids: string[];
}

/**
 * Every level and roadmap stage in one language, in reading order: the
 * roadmap first, then domains by their `order`, levels from Explorer up.
 */
export function pathUnits(lang: Lang, domains: DomainEntry[], levels: LevelEntry[], stages: StageEntry[]): PathUnit[] {
  const roadmapLabel = lang === 'tr' ? 'Başlangıç Yol Haritası' : 'Beginner Roadmap';
  const sortedStages = [...stages].sort((a, b) => a.number - b.number);
  const units: PathUnit[] = sortedStages.length
    ? [{
        key: 'roadmap',
        label: `🗺️ ${roadmapLabel}`,
        href: `${base(lang)}/roadmap/`,
        ids: sortedStages.flatMap((s) => s.resources.map((r) => r.id)),
      }]
    : [];
  for (const d of [...domains].sort((a, b) => a.order - b.order)) {
    for (const level of LEVEL_ORDER) {
      const entry = levels.find((l) => l.domain === d.slug && l.level === level);
      if (!entry) continue;
      units.push({
        key: `${d.slug}/${level}`,
        label: `${d.emoji} ${d.name} · ${LEVEL_LABELS[lang][level]}`,
        href: `${base(lang)}/${d.slug}/?level=${level}`,
        ids: entry.sections.flatMap((s) => s.resources.map((r) => r.id)),
      });
    }
  }
  return units;
}

/** Where a webinar is on the paths: each level or roadmap stage that lists it, once. */
export function pathsForWebinar(
  webinarSlug: string, lang: Lang, domains: DomainEntry[], levels: LevelEntry[], stages: StageEntry[],
): { label: string; href: string }[] {
  const lists = (rs: Resource[]) => rs.some((r) => r.webinarSlug === webinarSlug);
  const out: { label: string; href: string }[] = [];
  const stageWord = lang === 'tr' ? 'Aşama' : 'Stage';
  const roadmapLabel = lang === 'tr' ? 'Başlangıç Yol Haritası' : 'Beginner Roadmap';
  for (const s of [...stages].sort((a, b) => a.number - b.number)) {
    if (lists(s.resources)) {
      out.push({ label: `🗺️ ${roadmapLabel} · ${stageWord} ${s.number}: ${s.title}`, href: `${base(lang)}/roadmap/#${s.id}` });
    }
  }
  for (const unit of pathUnits(lang, domains, levels, [])) {
    const [domain, level] = unit.key.split('/');
    const entry = levels.find((l) => l.domain === domain && l.level === level)!;
    if (entry.sections.some((s) => lists(s.resources))) out.push({ label: unit.label, href: unit.href });
  }
  return out;
}

export interface UnitProgress { key: string; label: string; href: string; done: number; total: number }

/**
 * A member's progress per unit, from the ids /api/progress returns. A resource
 * ticked on either the English or the Turkish page counts: the two store their
 * keys apart ("x" and "tr-x") but it is the same resource. Only units with at
 * least one tick are returned: unfinished ones first, most advanced first,
 * then finished ones.
 */
export function progressByUnit(units: PathUnit[], completedIds: string[]): UnitProgress[] {
  const done = new Set(completedIds.map((id) => (id.startsWith('tr-') ? id.slice(3) : id)));
  return units
    .map((u) => ({ key: u.key, label: u.label, href: u.href, done: u.ids.filter((id) => done.has(id)).length, total: u.ids.length }))
    .filter((u) => u.done > 0 && u.total > 0)
    .sort((a, b) => {
      const af = a.done === a.total, bf = b.done === b.total;
      if (af !== bf) return af ? 1 : -1;
      return b.done / b.total - a.done / a.total;
    });
}
