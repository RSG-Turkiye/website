import type { Lang, UIKey } from "../i18n/ui";

export interface NavState {
  hasSchedule: boolean;
  hasSpeakers: boolean;
  hasCommittee: boolean;
  /** Whether the upcoming edition has written guidelines. Same rule as the
   * three above: the item appears when there is something behind it. */
  hasGuidelines: boolean;
}

export interface NavItem {
  href: string;
  labelKey: UIKey;
}

/**
 * The header links, derived from what actually has content.
 *
 * /schedule and /speakers were built but never linked, so they were
 * reachable only by typing the URL. Listing them unconditionally would
 * swap that for three nav items leading to empty pages, which is worse.
 * Deriving from content means the item appears by itself the moment the
 * first speaker or session lands -- the same "derive, don't flag" rule
 * the edition lifecycle follows.
 */
export function navItemsFor(state: NavState, lang: Lang): NavItem[] {
  const items: NavItem[] = [
    { href: "/", labelKey: "nav.home" },
    { href: "/editions/", labelKey: "nav.editions" },
  ];
  if (state.hasSchedule) items.push({ href: "/schedule/", labelKey: "nav.schedule" });
  if (state.hasSpeakers) items.push({ href: "/speakers/", labelKey: "nav.speakers" });
  // Before /venue: somebody deciding whether to submit reads this, and they
  // do that before they care where the building is.
  if (state.hasGuidelines) items.push({ href: "/abstracts/", labelKey: "nav.abstracts" });
  items.push({ href: "/venue/", labelKey: "nav.venue" });
  if (state.hasCommittee) items.push({ href: "/committee/", labelKey: "nav.committee" });
  items.push({ href: "/sponsors/", labelKey: "nav.sponsors" });

  if (lang === "tr") {
    return items.map((i) => ({ ...i, href: i.href === "/" ? "/tr/" : "/tr" + i.href }));
  }
  return items;
}
