/**
 * Where the panel is, kept in the address (`#section/sub`), so a refresh stays
 * put and a link opens the same page. On a phone a section with sub-pages and
 * no sub shows the list of sub-pages first.
 */
import { SECTIONS, visibleSections, subsFor, landing, type RoleFlags, type SectionId } from './sections';

export interface Route { section: SectionId; sub: string | null }

export function parseHash(hash: string): { section: string; sub: string | null } | null {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return null;
  const [section, sub] = raw.split('/');
  return section ? { section, sub: sub || null } : null;
}

export function toHash(r: Route): string {
  return `#${r.section}${r.sub ? `/${r.sub}` : ''}`;
}

export function resolveRoute(
  raw: { section: string; sub: string | null } | null,
  roles: RoleFlags,
  phone: boolean,
  oauthReturn: boolean,
): Route {
  const visible = visibleSections(roles);
  const want = oauthReturn && visible.some((s) => s.id === 'baglantilar') ? { section: 'baglantilar', sub: null } : raw;
  const section = visible.find((s) => s.id === want?.section) ?? SECTIONS.find((s) => s.id === landing(roles))!;
  const subs = subsFor(section, roles);
  if (subs.length === 0) return { section: section.id, sub: null };
  const sub = subs.find((s) => s.id === want?.sub && section.id === want?.section);
  if (sub) return { section: section.id, sub: sub.id };
  return { section: section.id, sub: phone ? null : subs[0].id };
}
