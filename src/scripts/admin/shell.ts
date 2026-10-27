/**
 * Shows one section (and one sub-page) at a time, from the address. Prunes
 * what the roles do not grant, fills the menu counts, and runs the phone
 * drawer and the phone's list-then-page sub-navigation.
 */
import { escapeHtml } from '../escape-html';
import { SECTIONS, visibleSections, menuSections, subsFor, tabHeadings, tabRuns, type RoleFlags, type SectionId, type SubPage } from './sections';
import { parseHash, toHash, resolveRoute, type Route } from './router';
import { t } from './context';
import { navigationAllowed } from './nav-guard';

export { registerNavigationGuard } from './nav-guard';

type Hooks = {
  onShow?: Partial<Record<SectionId, () => Promise<void>>>;
  onSub?: Partial<Record<SectionId, (sub: string, item: string | null) => void>>;
  /** Every time the section is shown, with or without a sub (Help's list or one guide). */
  onEnter?: Partial<Record<SectionId, (sub: string | null) => void>>;
};
const PHONE = window.matchMedia('(max-width: 1023px)');
let roles: RoleFlags;
let hooks: Hooks;
let oauthReturn = false;
// Whether the Agent tokens and Help links are offered (startShell); each hidden while its section is open.
let tokensLink = false;
let helpLink = false;
const loaded = new Set<SectionId>();
// The route shown before this one. On a phone, when a sub-page was opened
// from its section's list, ‹ steps back in history instead of pushing the
// list again, so the browser's back button then leaves the section.
let previous: Route | null = null;
let backPops = false;
// The hash of the route last shown; a vetoed move restores it.
let shownHash = '';
// The last counts fetched, for sub-page tabs drawn after the fetch.
let counts: Record<string, number> = {};

export function startShell(r: RoleFlags, h: Hooks): void {
  roles = r;
  hooks = h;
  const visible = new Set(visibleSections(r).map((s) => s.id));
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => { if (!visible.has(el.dataset.section as SectionId)) el.remove(); });
  for (const s of SECTIONS) {
    for (const sub of s.subs) {
      if (!subsFor(s, r).some((x) => x.id === sub.id)) document.querySelectorAll(`[data-section="${s.id}"] [data-sub="${sub.id}"]`).forEach((el) => el.remove());
    }
  }
  const menu = new Set(menuSections(r).map((s) => s.id));
  pruneNav(document.getElementById('sectionNav')!, menu);
  // Agent tokens has its own small link next to the title for a one-section
  // editor, who has no menu; whoever has the menu entry does not need it.
  tokensLink = visible.has('anahtarlar') && !menu.has('anahtarlar');
  if (!tokensLink) document.querySelectorAll('[data-tokens-link]').forEach((a) => a.remove());
  // Help is the same: a link for whoever has no menu entry for it.
  helpLink = visible.has('yardim') && !menu.has('yardim');
  if (!helpLink) document.querySelectorAll('[data-help-link]').forEach((a) => a.remove());
  const panel = document.querySelector<HTMLElement>('[data-drawer-panel]')!;
  panel.replaceChildren(document.getElementById('sectionNav')!.cloneNode(true));
  panel.querySelector('nav')!.id = 'drawerNav';
  wireDrawer();
  const params = new URLSearchParams(location.search);
  oauthReturn = params.has('connected') || params.has('connection_error');
  window.addEventListener('hashchange', () => go());
  PHONE.addEventListener('change', () => go());
  go();
  void refreshCounts();
}

function pruneNav(nav: HTMLElement, visible: Set<SectionId>): void {
  nav.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => { if (!visible.has(a.dataset.nav as SectionId)) a.remove(); });
  nav.querySelectorAll<HTMLElement>('[data-nav-group]').forEach((g) => { if (!g.querySelector('[data-nav]')) g.remove(); });
  if (visible.size <= 1) document.querySelectorAll('#navToggle, aside:has(#sectionNav)').forEach((el) => el.classList.add('!hidden'));
}

function go(): void {
  if (shownHash && !navigationAllowed(shownHash, location.hash)) {
    history.replaceState(null, '', `${location.pathname}${location.search}${shownHash}`);
    return;
  }
  const route = resolveRoute(parseHash(location.hash), roles, PHONE.matches, oauthReturn);
  oauthReturn = false;
  const wanted = toHash(route);
  if (location.hash !== wanted) history.replaceState(null, '', `${location.pathname}${location.search}${wanted}`);
  // An item (a thread) opened from its sub-page's list pops back the same way.
  backPops = !!(route.sub && previous && previous.section === route.section && (route.item
    ? previous.sub === route.sub && previous.item === null
    : previous.sub === null));
  const moved = !previous || previous.section !== route.section || previous.sub !== route.sub;
  previous = route;
  shownHash = wanted;
  show(route);
  // From lg up one box scrolls every section: a new page starts at its top,
  // not where the last one was left. (Not a scroll box on a phone: a no-op.)
  if (moved) document.getElementById('sectionBody')?.scrollTo(0, 0);
}

function show(route: Route): void {
  const section = SECTIONS.find((s) => s.id === route.section)!;
  document.querySelectorAll<HTMLElement>('[data-section]').forEach((el) => el.classList.toggle('hidden', el.dataset.section !== route.section));
  document.querySelectorAll<HTMLElement>('[data-nav]').forEach((a) => {
    const on = a.dataset.nav === route.section;
    a.classList.toggle('bg-navy-light', on);
    a.classList.toggle('font-semibold', on);
    a.setAttribute('aria-current', on ? 'page' : 'false');
  });
  const subs = subsFor(section, roles);
  const host = document.querySelector<HTMLElement>(`[data-section="${route.section}"]`)!;
  host.querySelectorAll<HTMLElement>('[data-sub]').forEach((el) => el.classList.toggle('hidden', el.dataset.sub !== route.sub));
  const title = t(section.label as never) as string;
  renderSubNav(route, subs, title);
  document.getElementById('sectionTitle')!.textContent = title;
  document.querySelectorAll<HTMLElement>('[data-tokens-link]').forEach((a) => a.classList.toggle('hidden', !tokensLink || route.section === 'anahtarlar'));
  document.querySelectorAll<HTMLElement>('[data-help-link]').forEach((a) => a.classList.toggle('hidden', !helpLink || route.section === 'yardim'));
  const sub = route.sub ? subs.find((s) => s.id === route.sub) : undefined;
  document.getElementById('phoneTitle')!.textContent = sub ? (t(sub.label as never) as string) : title;
  // An item carries its own ‹ inside its card (the inbox's thread), so the
  // bar's would be a second back control beside it.
  const back = PHONE.matches && !!route.sub && subs.length > 0 && !route.item;
  const backBtn = document.getElementById('phoneBack')!;
  backBtn.classList.toggle('hidden', !back);
  backBtn.classList.toggle('inline-flex', back);
  closeDrawer();
  if (!loaded.has(route.section)) {
    loaded.add(route.section);
    const load = hooks.onShow?.[route.section];
    if (load) void load().catch(() => {});
  }
  if (route.sub) hooks.onSub?.[route.section]?.(route.sub, route.item);
  hooks.onEnter?.[route.section]?.(route.sub);
  void fetch('/api/audit/view', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pane: route.section }), keepalive: true,
  }).catch(() => {});
}

/** A sub-page's count badge, filled from the last fetch (refreshCounts updates it after). */
function countBadge(s: SubPage): string {
  if (!s.count) return '';
  const n = counts[s.count] ?? 0;
  return `<span data-count="${s.count}" class="${n === 0 ? 'hidden ' : ''}min-w-5 px-1.5 rounded-full bg-red text-white text-xs text-center">${n}</span>`;
}

function renderSubNav(route: Route, subs: SubPage[], sectionLabel: string): void {
  const nav = document.getElementById('subNav')!;
  if (subs.length === 0) { nav.replaceChildren(); return; }
  // A content group's name before its first tab, when there are several groups: quiet text, not a control.
  const headings = tabHeadings(subs);
  if (PHONE.matches) {
    // Phone: the list of sub-pages first; a sub-page hides the list.
    nav.innerHTML = route.sub ? '' : `<div class="flex flex-col gap-2">${subs.map((s, i) => `${headings[i] ? `
      <p data-tab-heading class="mt-2 first:mt-0 px-1 text-xs text-gray-500">${t(headings[i] as never)}</p>` : ''}
      <a href="${toHash({ section: route.section, sub: s.id, item: null })}" data-sub-link="${s.id}" class="flex items-center justify-between min-h-14 px-4 rounded-xl border border-border bg-white text-navy text-base">
        <span class="flex items-center gap-2 min-w-0">${t(s.label as never)}${countBadge(s)}</span><span aria-hidden="true">›</span></a>`).join('')}</div>`;
    return;
  }
  // One tab list per content group, named by it; the visible group name sits
  // beside its list, outside it (only tabs belong in a tablist).
  const tab = (s: SubPage) => `<a role="tab" aria-selected="${s.id === route.sub}" href="${toHash({ section: route.section, sub: s.id, item: null })}" data-sub-link="${s.id}"
      class="px-3 min-h-8 inline-flex items-center gap-2 rounded-full border text-sm ${s.id === route.sub ? 'bg-navy-light border-navy-mid text-navy font-semibold' : 'border-border text-gray-500 hover:text-navy'}">
      ${t(s.label as never)}${countBadge(s)}</a>`;
  const runs = tabRuns(subs);
  if (runs.length === 1) {
    nav.innerHTML = `<div role="tablist" aria-label="${escapeHtml(sectionLabel)}" class="flex flex-wrap items-center gap-1.5 mb-3">${runs[0].subs.map(tab).join('')}</div>`;
    return;
  }
  nav.innerHTML = `<div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 mb-3">${runs.map((r) => {
    const name = r.heading ? (t(r.heading as never) as string) : sectionLabel;
    return `<div data-tab-group class="flex flex-wrap items-center gap-1.5">${r.heading ? `<span data-tab-heading aria-hidden="true" class="text-xs text-gray-500">${escapeHtml(name)}</span>` : ''}
      <div role="tablist" aria-label="${escapeHtml(name)}" class="flex flex-wrap items-center gap-1.5">${r.subs.map(tab).join('')}</div></div>`;
  }).join('')}</div>`;
}

function wireDrawer(): void {
  const toggle = document.getElementById('navToggle')!;
  const drawer = document.getElementById('navDrawer')!;
  toggle.addEventListener('click', () => {
    const open = drawer.classList.toggle('hidden') === false;
    toggle.setAttribute('aria-expanded', String(open));
  });
  // Choosing the section already on screen changes no hash, so close here too.
  drawer.addEventListener('click', (e) => { if (e.target === drawer || (e.target as HTMLElement).closest('a')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });
  document.getElementById('phoneBack')!.addEventListener('click', goBack);
}

/**
 * Phone back, one level up: to the sub-page's list from an item, to the
 * section's list from a sub-page. When the page was opened from that list,
 * this steps back in history instead of pushing the list a second time.
 */
export function goBack(): void {
  if (backPops) { history.back(); return; }
  const r = parseHash(location.hash);
  if (!r) return;
  location.hash = r.item && r.sub ? `#${r.section}/${r.sub}` : `#${r.section}`;
}

function closeDrawer(): void {
  document.getElementById('navDrawer')?.classList.add('hidden');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
}

/**
 * A section that moved the address itself (history.replaceState, without a
 * reroute) tells the shell, so a refused move later comes back to it.
 */
export function noteAddress(hash: string): void {
  shownHash = hash;
  const r = parseHash(hash);
  if (r && previous) previous = { ...previous, sub: r.sub, item: r.item };
}

export async function refreshCounts(): Promise<void> {
  let fresh: Record<string, number> = {};
  try {
    const res = await fetch('/api/admin/counts');
    if (res.ok) fresh = await res.json();
  } catch { /* the menu works without numbers */ }
  counts = fresh;
  document.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const n = counts[el.dataset.count!] ?? 0;
    el.textContent = String(n);
    el.classList.toggle('hidden', n === 0);
  });
}
