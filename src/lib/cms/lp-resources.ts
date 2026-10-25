/**
 * The resource cards of a learning-path entry, walked the same way by the
 * server (functions/_lib/cms-lp.ts: ids, rule 8) and the panel
 * (src/scripts/admin/cms-form.ts: a rebase, the approver's removed ids).
 * Pure, no schemas, so the admin bundle can import it.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/** One resource in file order: its path under the frontmatter (`sections.0.resources.2`) and the object itself. */
export interface PlacedResource { at: string; r: Obj }

/** Every resource list of one side's frontmatter, in file order, by path: a level's per section, a stage's one. */
export function resourceLists(fm: unknown): { at: string; list: unknown[] }[] {
  if (!isObj(fm)) return [];
  if (Array.isArray(fm.sections)) {
    return fm.sections.map((s, i) => ({ at: `sections.${i}.resources`, list: isObj(s) && Array.isArray(s.resources) ? s.resources : [] }));
  }
  return Array.isArray(fm.resources) ? [{ at: 'resources', list: fm.resources }] : [];
}

/** Every resource of one side, in file order (the order progress is read in). */
export function resourcesOf(fm: unknown): PlacedResource[] {
  return resourceLists(fm).flatMap(({ at, list }) => list.map((r, j) => ({ at: `${at}.${j}`, r: isObj(r) ? r : {} })));
}

/** A resource's id, '' when it has none. */
export const resourceId = (r: Obj): string => (typeof r.id === 'string' ? r.id : '');

/** One side's frontmatter of pair data (`{ en: { frontmatter }, tr: ... }`), or null. */
export function sideFrontmatter(data: unknown, lang: 'en' | 'tr'): unknown {
  const s = isObj(data) ? data[lang] : null;
  return isObj(s) ? s.frontmatter : null;
}

/** Every non-empty resource id of pair data, both sides. */
export function resourceIdsOf(data: unknown): Set<string> {
  const out = new Set<string>();
  for (const lang of ['en', 'tr'] as const) for (const { r } of resourcesOf(sideFrontmatter(data, lang))) if (resourceId(r)) out.add(resourceId(r));
  return out;
}
