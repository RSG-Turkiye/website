/**
 * The Help section (HelpPane.astro): the role guides of src/content/help,
 * rendered at build time, one article per guide. This file only decides which
 * the signed-in person sees and shows the list or one article, from the
 * address (`#yardim/<slug>`). The filter is for relevance: the guides are
 * public in the repo, so nothing here is a right.
 */
import { ROLES } from '../../../../functions/_lib/roles';

/**
 * The slugs of the guides this person should see, in input order, each once.
 * A guide matches when it is for `all`, when the person is an admin, or when
 * a role they hold, or one that role implies, is among its roles. Implied:
 * `social_publisher` holds `social`, and a content group's approver holds
 * that group's editor role.
 */
export function guidesFor(guides: { slug: string; roles: string[] }[], held: readonly string[], admin: boolean): string[] {
  const have = new Set(held);
  for (const def of ROLES) {
    if (have.has(def.key)) def.implies?.forEach((r) => have.add(r));
    if (def.approverRole && have.has(def.approverRole)) have.add(def.key);
  }
  const seen = new Set<string>();
  return guides
    .filter((g) => admin || g.roles.includes('all') || g.roles.some((r) => have.has(r)))
    .map((g) => g.slug)
    .filter((slug) => !seen.has(slug) && !!seen.add(slug));
}

/** The `admin.help.for.*` key for a guide's "for whom" line, from its first role. */
export function audienceKey(roles: readonly string[]): string {
  const r = roles[0] ?? 'all';
  if (r === 'all') return 'admin.help.for.all';
  if (/^content\..+\.edit$/.test(r)) return 'admin.help.for.contentEdit';
  if (/^content\..+\.approve$/.test(r)) return 'admin.help.for.contentApprove';
  return `admin.help.for.${r}`;
}

/** The role keys /api/me says a person holds: the `is_*` columns and the live grants (the content roles have no column). */
export function heldRolesFromMe(u: Record<string, unknown>): string[] {
  const held = new Set<string>();
  for (const def of ROLES) if (def.column && (u[def.column] === true || u[def.column] === 1)) held.add(def.key);
  if (Array.isArray(u.grants)) for (const g of u.grants) { const r = (g as { role?: unknown })?.role; if (typeof r === 'string') held.add(r); }
  return [...held];
}

let visibleSlugs = new Set<string>();
// What the pane showed last (undefined: nothing yet), so a move between the list and a guide, and only that, resets scroll and focus.
let shown: string | null | undefined;

/** Hides the guides this person has no use for. Call once, before the shell shows the section. */
export function setupHelp(me: Record<string, unknown>): void {
  const guides = [...document.querySelectorAll<HTMLElement>('[data-section="yardim"] [data-guide]')]
    .map((el) => ({ slug: el.dataset.guide!, roles: (el.dataset.roles ?? '').split(' ').filter(Boolean) }));
  visibleSlugs = new Set(guidesFor(guides, heldRolesFromMe(me), me.is_admin === true));
  document.querySelectorAll<HTMLElement>('[data-section="yardim"] [data-guide], [data-section="yardim"] [data-guide-link]').forEach((el) => {
    if (!visibleSlugs.has((el.dataset.guide ?? el.dataset.guideLink)!)) el.remove();
  });
}

/** `slug`: the address's guide. One that is not shown to this person (or does not exist) shows the list. */
export function showHelp(slug: string | null): void {
  const open = slug && visibleSlugs.has(slug) ? slug : null;
  const root = document.querySelector<HTMLElement>('[data-section="yardim"]')!;
  root.querySelector('[data-help-list]')!.classList.toggle('hidden', open !== null);
  root.querySelector('[data-help-heading]')!.classList.toggle('hidden', open !== null);
  root.querySelectorAll<HTMLElement>('[data-guide]').forEach((a) => a.classList.toggle('hidden', a.dataset.guide !== open));
  root.querySelector('[data-help-back]')!.classList.toggle('hidden', open === null);
  if (shown !== undefined && shown !== open) {
    // The new view starts at its top, and a keyboard or screen reader user lands on its title.
    document.getElementById('sectionBody')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
    (open ? root.querySelector<HTMLElement>(`[data-guide="${open}"] [data-guide-title]`) : root.querySelector<HTMLElement>('[data-help-heading]'))?.focus({ preventScroll: true });
  }
  shown = open;
}
