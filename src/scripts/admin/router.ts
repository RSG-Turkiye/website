/**
 * Where the panel is, kept in the address (`#section/sub`), so a refresh stays
 * put and a link opens the same page. On a phone a section with sub-pages and
 * no sub shows the list of sub-pages first.
 */
import { SECTIONS, visibleSections, subsFor, landing, type RoleFlags, type SectionId } from './sections';

export interface Route { section: SectionId; sub: string | null; item: string | null }
type Raw = { section: string; sub: string | null; item: string | null };

/**
 * Sections that moved, by their old id: the rest of the address is the same.
 * The Etkinlikler section became İçerik; pull requests opened before that
 * (PR #325's body, say) link to the old address. The admin "Blog" section
 * (member submissions) became İçerik's Blog tab.
 */
const ALIASES: Record<string, string> = { 'icerik-etkinlikler': 'icerik', blog: 'icerik/blog' };

// The item is a mail thread id: the shape the server accepts (gmail-read.ts).
export function parseHash(hash: string): Raw | null {
  const raw = hash.replace(/^#/, '').trim();
  if (!raw) return null;
  const [head, ...rest] = raw.split('/');
  const [section, sub, item] = [...(Object.hasOwn(ALIASES, head) ? ALIASES[head].split('/') : [head]), ...rest];
  return section ? { section, sub: sub || null, item: sub && item && /^[A-Za-z0-9_-]{1,128}$/.test(item) ? item : null } : null;
}

export function toHash(r: Route): string {
  return `#${r.section}${r.sub ? `/${r.sub}` : ''}${r.sub && r.item ? `/${r.item}` : ''}`;
}

export function resolveRoute(
  raw: Raw | null,
  roles: RoleFlags,
  phone: boolean,
  oauthReturn: boolean,
): Route {
  const visible = visibleSections(roles);
  const want = oauthReturn && visible.some((s) => s.id === 'baglantilar') ? { section: 'baglantilar', sub: null, item: null } : raw;
  const section = visible.find((s) => s.id === want?.section) ?? SECTIONS.find((s) => s.id === landing(roles))!;
  const subs = subsFor(section, roles);
  if (subs.length === 0) return { section: section.id, sub: null, item: null };
  const sub = subs.find((s) => s.id === want?.sub && section.id === want?.section);
  if (sub) return { section: section.id, sub: sub.id, item: want?.item ?? null };
  return { section: section.id, sub: phone ? null : subs[0].id, item: null };
}
