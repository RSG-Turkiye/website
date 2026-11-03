/**
 * The graduate guide's pages in the browser: loads the search index
 * (/api/guide/index.json, professors from D1) and the catalog
 * (/guide/catalog.json, built from git), then draws the results grouped by
 * university, or one university's programmes and professors. Searching never
 * calls the server. The apply block comes from src/lib/guide-apply.ts, so it
 * reads today's date here rather than the build's.
 */
import { escapeHtml } from './escape-html';
import { search, expandQuery, groupResults, chipsFor, cityFromParams, isUnverified, type ResultGroup, type GroupProfessor } from '../lib/guide-search';
import { applyBlockHtml, orderProgrammes } from '../lib/guide-apply';
import { fill, suggestUrl, checkedLabel, type GuideText, type Lang } from '../lib/guide-text';
import { epochToIstanbulInput } from '../lib/istanbul-time';
import { readCachedIndex, writeCachedIndex } from '../lib/guide-index-cache';
import type { GuideIndex } from '../../functions/_lib/guide-index';
import type { GuideCatalog } from '../lib/guide-catalog';

const KEY = 'rsg-guide-index';
const LINK = 'text-navy-mid hover:text-navy underline decoration-navy-mid/30 underline-offset-2';

async function loadIndex(): Promise<GuideIndex> {
  const now = Math.floor(Date.now() / 1000);
  try {
    const cached = readCachedIndex(sessionStorage.getItem(KEY), now);
    if (cached) return cached;
  } catch { /* private mode: fetch below */ }
  const res = await fetch('/api/guide/index.json');
  if (!res.ok) throw new Error(String(res.status));
  const index = (await res.json()) as GuideIndex;
  try { sessionStorage.setItem(KEY, writeCachedIndex(index, now)); } catch { /* full or blocked: fine */ }
  return index;
}

interface Ctx { T: GuideText; lang: Lang; prefix: string; today: string; idx: GuideIndex }

function professorRow(gp: GroupProfessor, g: ResultGroup, x: Ctx): string {
  const { T, lang } = x;
  const p = gp.professor;
  const name = `${p.title} ${p.name}`.trim();
  const lab = p.labId ? x.idx.labs.find((l) => l.id === p.labId) : undefined;
  const chips = chipsFor(p.topics, gp.matched)
    .map((c) => `<li class="px-2 py-0.5 rounded text-[13px] leading-5 ${c.hit ? 'bg-navy text-white' : 'bg-navy-light text-navy'}">${escapeHtml(c.text)}</li>`).join('');
  const programme = g.programmes.filter((q) => q.type !== 'phd').length > 1 && gp.programmeIds.length
    ? `<p class="text-[13px] text-gray-600 mt-1">${escapeHtml(fill(T.programmeLine, { name: gp.programmeIds.map((id) => g.programmes.find((q) => q.id === id)!.name[lang]).join(', ') }))}</p>`
    : '';
  return `<li class="py-4 first:pt-0 lg:first:pt-1">
    <h3 class="text-base font-semibold text-navy leading-snug">${p.profileUrl ? `<a href="${escapeHtml(p.profileUrl)}" rel="noopener" class="hover:underline underline-offset-2">${escapeHtml(name)}</a>` : escapeHtml(name)}</h3>
    ${p.department ? `<p class="text-[13px] text-gray-500 mt-0.5">${escapeHtml(p.department)}</p>` : ''}
    ${lab ? `<p class="text-sm mt-1">${lab.url ? `<a href="${escapeHtml(lab.url)}" rel="noopener" class="${LINK}">${escapeHtml(lab.name)}</a>` : escapeHtml(lab.name)}</p>` : ''}
    ${programme}
    ${chips ? `<ul class="flex flex-wrap gap-1.5 mt-2">${chips}</ul>` : ''}
    ${isUnverified(p) ? `<p class="mt-2"><span class="inline-block text-xs text-gray-600 border border-gray-300 rounded px-1.5 py-0.5">${escapeHtml(T.unverifiedTag)}</span></p>` : ''}
    <p class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-500">
      ${isUnverified(p) ? '' : `<span>${escapeHtml(checkedLabel(p.checkedAt, lang))}</span>`}
      ${p.source ? `<a href="${escapeHtml(p.source)}" rel="noopener" class="hover:text-navy underline underline-offset-2">${escapeHtml(T.source)}</a>` : ''}
      <a href="${escapeHtml(suggestUrl(p.id, lang))}" class="hover:text-navy underline underline-offset-2">${escapeHtml(T.suggest)}</a>
    </p>
  </li>`;
}

function groupHtml(g: ResultGroup, x: Ctx): string {
  const { T, lang, prefix, today } = x;
  const known = g.professors.some((p) => p.programmeIds.length);
  const apply = g.programmes.length
    ? g.programmes.map((p) => applyBlockHtml(p, lang, today, p.pageChangedSince)).join('')
      + (g.programmes.filter((p) => p.type !== 'phd').length > 1 && !known ? `<p class="text-xs text-gray-500">${escapeHtml(T.whichProgrammeShort)}</p>` : '')
    : '';
  return `<section class="grid gap-x-10 gap-y-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.9fr)] py-7 border-t border-gray-300 first:border-t-0">
    <div>
      <h2 class="text-lg font-semibold text-navy leading-snug"><a href="${prefix}/guide/${escapeHtml(g.university.id)}/" class="hover:underline underline-offset-2">${escapeHtml(g.university.name[lang])}</a></h2>
      <p class="text-[13px] text-gray-500">${escapeHtml(g.university.city)}</p>
      ${apply ? `<div class="mt-4 flex flex-col gap-4">${apply}</div>` : ''}
    </div>
    <ol class="divide-y divide-border">${g.professors.map((p) => professorRow(p, g, x)).join('')}</ol>
  </section>`;
}

function alsoHtml(terms: string[], T: GuideText): string {
  if (!terms.length) return '';
  const head = escapeHtml(terms.slice(0, 3).join(', '));
  const rest = terms.slice(3);
  return `${escapeHtml(T.alsoSearched)} ${head}${rest.length
    ? ` <details class="inline"><summary class="inline cursor-pointer text-navy-mid hover:text-navy underline underline-offset-2">${escapeHtml(fill(T.moreTerms, { n: rest.length }))}</summary><span class="block mt-1">${escapeHtml(rest.join(', '))}</span></details>`
    : ''}`;
}

export async function startGuide(root: HTMLElement): Promise<void> {
  const T = JSON.parse(root.dataset.text!) as GuideText;
  const lang = (root.dataset.lang === 'tr' ? 'tr' : 'en') as Lang;
  const prefix = lang === 'tr' ? '/tr' : '';
  const university = root.dataset.university ?? '';
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const today = epochToIstanbulInput(Math.floor(Date.now() / 1000)).slice(0, 10);
  status.textContent = T.loading;
  let idx: GuideIndex, catalog: GuideCatalog;
  try {
    const [i, c] = await Promise.all([loadIndex(), fetch('/guide/catalog.json').then((r) => r.json() as Promise<GuideCatalog>)]);
    idx = i; catalog = c;
  } catch {
    status.textContent = T.loadFailed;
    return;
  }
  // An index cached before pageChanged existed has none: no warning, not an error.
  const pageChanged = idx.pageChanged ?? {};
  const x: Ctx = { T, lang, prefix, today, idx };

  if (university) {
    // The programmes were drawn at build time; redraw them for today's date and any page-changed warning.
    const box = document.querySelector<HTMLElement>('[data-programmes]');
    if (box) {
      const own = orderProgrammes(catalog.programmes.filter((p) => p.universityId === university), lang);
      if (own.length) box.innerHTML = own.map((p) => applyBlockHtml(p, lang, today, pageChanged[p.id])).join('');
    }
    const mine = idx.professors.filter((p) => p.universityId === university).map((professor) => ({ professor, matched: [], score: 0 }));
    const g = groupResults(mine, catalog, pageChanged);
    const group = g.groups[0] ?? g.withoutProgramme[0];
    root.querySelector('[data-results]')!.innerHTML = group ? group.professors.map((p) => professorRow(p, group, x)).join('') : '';
    status.textContent = fill(T.results, { n: mine.length });
    return;
  }

  const input = root.querySelector<HTMLInputElement>('[data-q]')!;
  const city = root.querySelector('[data-city]') as unknown as HTMLSelectElement;
  const also = root.querySelector<HTMLElement>('[data-also]')!;
  const results = root.querySelector<HTMLElement>('[data-results]')!;
  const without = root.querySelector<HTMLElement>('[data-without]')!;
  const withoutResults = root.querySelector<HTMLElement>('[data-without-results]')!;
  const mapWrap = root.querySelector<HTMLElement>('[data-map-wrap]');
  const mapCities = [...root.querySelectorAll<SVGAElement>('[data-map-city]')];
  const cities = JSON.parse(root.dataset.cities ?? '[]') as string[];
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') ?? '';
  city.value = cityFromParams(location.search, cities);

  const run = () => {
    const q = input.value;
    const found = search(q, city.value || null, idx, catalog);
    const { groups, withoutProgramme } = groupResults(found, catalog, pageChanged);
    results.innerHTML = groups.map((g) => groupHtml(g, x)).join('');
    withoutResults.innerHTML = withoutProgramme.map((g) => groupHtml(g, x)).join('');
    without.classList.toggle('hidden', withoutProgramme.length === 0);
    const unis = groups.length + withoutProgramme.length;
    status.textContent = found.length ? fill(T.counts, { n: found.length, u: unis }) : T.noResults;
    also.innerHTML = q.trim() ? alsoHtml(expandQuery(q, catalog.terms).alsoSearched, T) : '';

    // The map shows where the topic is found anywhere, whatever city is chosen.
    const cityOf = new Map(catalog.universities.map((u) => [u.id, u.city]));
    const hits = q.trim() ? new Set(search(q, null, idx, catalog).map((r) => cityOf.get(r.professor.universityId))) : null;
    for (const a of mapCities) {
      const name = a.dataset.mapCity!;
      a.classList.toggle('is-selected', name === city.value);
      a.classList.toggle('is-nomatch', Boolean(hits && !hits.has(name)));
      if (name === city.value) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
    }
    // On a phone the map is for starting out; once something is chosen, the results move up.
    mapWrap?.classList.toggle('max-sm:hidden', Boolean(q.trim() || city.value));

    const u = new URL(location.href);
    if (q.trim()) u.searchParams.set('q', q.trim()); else u.searchParams.delete('q');
    if (city.value) u.searchParams.set('city', city.value); else u.searchParams.delete('city');
    history.replaceState(null, '', u);
  };
  for (const a of mapCities) {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const name = a.dataset.mapCity!;
      city.value = city.value === name ? '' : name;
      run();
    });
  }
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(run, 120); });
  city.addEventListener('change', run);
  root.querySelector('[data-guide-form]')?.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  run();
}
