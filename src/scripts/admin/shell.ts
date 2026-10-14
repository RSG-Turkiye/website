/**
 * Shows one section (and one sub-page) at a time, from the address. Prunes
 * what the roles do not grant, fills the menu counts, and runs the phone
 * drawer and the phone's list-then-page sub-navigation.
 */
import { SECTIONS, visibleSections, subsFor, type RoleFlags, type SectionId } from './sections';
import { parseHash, toHash, resolveRoute, type Route } from './router';
import { t } from './context';

type Hooks = { onShow?: Partial<Record<SectionId, () => Promise<void>>>; onSub?: Partial<Record<SectionId, (sub: string) => void>> };
const PHONE = window.matchMedia('(max-width: 1023px)');
let roles: RoleFlags;
let hooks: Hooks;
let oauthReturn = false;
const loaded = new Set<SectionId>();
// The route shown before this one. On a phone, when a sub-page was opened
// from its section's list, ‹ steps back in history instead of pushing the
// list again, so the browser's back button then leaves the section.
let previous: Route | null = null;
let backPops = false;

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
  pruneNav(document.getElementById('sectionNav')!, visible);
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
  const route = resolveRoute(parseHash(location.hash), roles, PHONE.matches, oauthReturn);
  oauthReturn = false;
  const wanted = toHash(route);
  if (location.hash !== wanted) history.replaceState(null, '', `${location.pathname}${location.search}${wanted}`);
  backPops = !!(route.sub && previous && previous.section === route.section && previous.sub === null);
  previous = route;
  show(route);
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
  renderSubNav(route, subs);
  const title = t(section.label as never) as string;
  document.getElementById('sectionTitle')!.textContent = title;
  const sub = route.sub ? subs.find((s) => s.id === route.sub) : undefined;
  document.getElementById('phoneTitle')!.textContent = sub ? (t(sub.label as never) as string) : title;
  const back = PHONE.matches && !!route.sub && subs.length > 0;
  const backBtn = document.getElementById('phoneBack')!;
  backBtn.classList.toggle('hidden', !back);
  backBtn.classList.toggle('inline-flex', back);
  closeDrawer();
  if (!loaded.has(route.section)) {
    loaded.add(route.section);
    const load = hooks.onShow?.[route.section];
    if (load) void load().catch(() => {});
  }
  if (route.sub) hooks.onSub?.[route.section]?.(route.sub);
  void fetch('/api/audit/view', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pane: route.section }), keepalive: true,
  }).catch(() => {});
}

function renderSubNav(route: Route, subs: { id: string; label: string }[]): void {
  const nav = document.getElementById('subNav')!;
  if (subs.length === 0) { nav.replaceChildren(); return; }
  if (PHONE.matches) {
    // Phone: the list of sub-pages first; a sub-page hides the list.
    nav.innerHTML = route.sub ? '' : `<div class="flex flex-col gap-2">${subs.map((s) => `
      <a href="${toHash({ section: route.section, sub: s.id })}" data-sub-link="${s.id}" class="flex items-center justify-between min-h-14 px-4 rounded-xl border border-border bg-white text-navy text-base">
        <span>${t(s.label as never)}</span><span aria-hidden="true">›</span></a>`).join('')}</div>`;
    return;
  }
  nav.innerHTML = `<div role="tablist" class="flex flex-wrap gap-2 mb-4">${subs.map((s) => `
    <a role="tab" aria-selected="${s.id === route.sub}" href="${toHash({ section: route.section, sub: s.id })}" data-sub-link="${s.id}"
      class="px-3 min-h-9 inline-flex items-center rounded-full border text-sm ${s.id === route.sub ? 'bg-navy-light border-navy-mid text-navy font-semibold' : 'border-border text-gray-500 hover:text-navy'}">
      ${t(s.label as never)}</a>`).join('')}</div>`;
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
  document.getElementById('phoneBack')!.addEventListener('click', () => {
    if (backPops) { history.back(); return; }
    const r = parseHash(location.hash);
    if (r) location.hash = `#${r.section}`;
  });
}

function closeDrawer(): void {
  document.getElementById('navDrawer')?.classList.add('hidden');
  document.getElementById('navToggle')?.setAttribute('aria-expanded', 'false');
}

export async function refreshCounts(): Promise<void> {
  let counts: Record<string, number> = {};
  try {
    const res = await fetch('/api/admin/counts');
    if (res.ok) counts = await res.json();
  } catch { /* the menu works without numbers */ }
  document.querySelectorAll<HTMLElement>('[data-count]').forEach((el) => {
    const n = counts[el.dataset.count!] ?? 0;
    el.textContent = String(n);
    el.classList.toggle('hidden', n === 0);
  });
}
