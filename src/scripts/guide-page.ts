/**
 * The graduate guide's pages in the browser: loads the search index
 * (/api/guide/index.json, professors from D1) and the catalog
 * (/guide/catalog.json, built from git), then renders professor cards for
 * the search page or one university's page. Searching never calls the server.
 */
import { escapeHtml } from './escape-html';
import { search, joinCard, expandQuery, fold } from '../lib/guide-search';
import { fill, suggestUrl, monthNames, dayLabel, type GuideText, type Lang } from '../lib/guide-text';
import { epochToIstanbulInput } from '../lib/istanbul-time';
import type { GuideIndex, IndexProfessor } from '../../functions/_lib/guide-index';
import type { GuideCatalog } from '../lib/guide-catalog';

const KEY = 'rsg-guide-index';

async function loadIndex(): Promise<GuideIndex> {
  try {
    const cached = sessionStorage.getItem(KEY);
    if (cached) return JSON.parse(cached) as GuideIndex;
  } catch { /* private mode: fetch below */ }
  const res = await fetch('/api/guide/index.json');
  if (!res.ok) throw new Error(String(res.status));
  const index = (await res.json()) as GuideIndex;
  try { sessionStorage.setItem(KEY, JSON.stringify(index)); } catch { /* full or blocked: fine */ }
  return index;
}

function card(p: IndexProfessor, matched: string[], c: GuideCatalog, idx: GuideIndex, T: GuideText, lang: Lang, prefix: string, today: string, withApply: boolean): string {
  const j = joinCard(p, c, today, idx.labs);
  const hit = new Set(matched.map(fold));
  const name = `${p.title} ${p.name}`.trim();
  const uni = j.university;
  const where = [
    j.lab ? (j.lab.url ? `<a href="${escapeHtml(j.lab.url)}" rel="noopener" class="text-navy-mid hover:text-navy">${escapeHtml(j.lab.name)} ↗</a>` : escapeHtml(j.lab.name)) : '',
    uni ? `<a href="${prefix}/guide/${escapeHtml(uni.id)}/" class="text-navy-mid hover:text-navy">${escapeHtml(uni.name[lang])}</a>` : '',
    uni ? escapeHtml(uni.city) : '',
  ].filter(Boolean).join(' · ');
  const topics = p.topics.slice(0, 8).map((t) => `<li class="px-2 py-0.5 rounded-full text-xs ${hit.has(fold(t)) ? 'bg-navy text-white' : 'bg-gray-100 text-gray-700'}">${escapeHtml(t)}</li>`).join('');
  const apply = !withApply ? '' : j.programmeUnknown
    ? `<p class="text-sm text-gray-600">${escapeHtml(T.noProgramme)} <a href="${escapeHtml(suggestUrl(p.id, lang))}" class="text-navy-mid hover:text-navy">${escapeHtml(T.suggestProgramme)}</a></p>`
    : j.programmes.map((x) => {
      const months = x.usualMonths.length ? fill(T.usually, { months: monthNames(x.usualMonths, lang) }) : T.monthsUnknown;
      const win = x.showWindow ? ` · ${fill(T.reported, { from: dayLabel(x.windowOpens!, lang), to: dayLabel(x.windowCloses!, lang) })}` : '';
      const link = x.announcementUrl ? ` · <a href="${escapeHtml(x.announcementUrl)}" rel="noopener" class="text-navy-mid hover:text-navy">${escapeHtml(T.announcement)} ↗</a>` : '';
      return `<p class="text-sm text-gray-700"><span class="font-medium text-navy">${escapeHtml(T.applyTo)}: ${escapeHtml(x.name[lang])}</span> <span class="text-gray-500">(${escapeHtml(x.institute[lang])})</span><br>${escapeHtml(months)}${win}${link}</p>`;
    }).join('');
  return `<li class="py-5 border-b border-border">
    <div class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h3 class="text-base font-semibold text-navy">${p.profileUrl ? `<a href="${escapeHtml(p.profileUrl)}" rel="noopener" class="hover:underline">${escapeHtml(name)}</a>` : escapeHtml(name)}</h3>
      <p class="text-xs text-gray-500">${escapeHtml(p.department)}</p>
    </div>
    <p class="text-sm mt-0.5">${where}</p>
    ${topics ? `<ul class="flex flex-wrap gap-1.5 mt-2">${topics}</ul>` : ''}
    ${apply ? `<div class="mt-3 pl-3 border-l-2 border-navy-mid flex flex-col gap-1">${apply}</div>` : ''}
    <p class="mt-2 text-xs text-gray-500">${escapeHtml(fill(T.checked, { date: dayLabel(p.checkedAt, lang) }))}${p.source ? ` · <a href="${escapeHtml(p.source)}" rel="noopener" class="hover:text-navy">${escapeHtml(T.source)}</a>` : ''} · <a href="${escapeHtml(suggestUrl(p.id, lang))}" class="hover:text-navy">${escapeHtml(T.suggest)}</a></p>
  </li>`;
}

export async function startGuide(root: HTMLElement): Promise<void> {
  const T = JSON.parse(root.dataset.text!) as GuideText;
  const lang = (root.dataset.lang === 'tr' ? 'tr' : 'en') as Lang;
  const prefix = lang === 'tr' ? '/tr' : '';
  const university = root.dataset.university ?? '';
  const list = root.querySelector<HTMLOListElement>('[data-results]')!;
  const status = root.querySelector<HTMLElement>('[data-status]')!;
  const today = epochToIstanbulInput(Math.floor(Date.now() / 1000)).slice(0, 10);
  status.textContent = T.loading;
  let index: GuideIndex, catalog: GuideCatalog;
  try {
    const [i, c] = await Promise.all([loadIndex(), fetch('/guide/catalog.json').then((r) => r.json() as Promise<GuideCatalog>)]);
    index = i; catalog = c;
  } catch {
    status.textContent = T.loadFailed;
    return;
  }

  if (university) {
    const profs = index.professors.filter((p) => p.universityId === university).sort((a, b) => a.name.localeCompare(b.name, 'tr'));
    list.innerHTML = profs.map((p) => card(p, [], catalog, index, T, lang, prefix, today, false)).join('');
    status.textContent = fill(T.results, { n: profs.length });
    return;
  }

  const input = root.querySelector<HTMLInputElement>('[data-q]')!;
  const city = root.querySelector('[data-city]') as unknown as HTMLSelectElement;
  const also = root.querySelector<HTMLElement>('[data-also]')!;
  const params = new URLSearchParams(location.search);
  input.value = params.get('q') ?? '';
  city.value = params.get('city') ?? '';
  const run = () => {
    const q = input.value;
    const results = search(q, city.value || null, index, catalog);
    list.innerHTML = results.map((r) => card(r.professor, r.matched, catalog, index, T, lang, prefix, today, true)).join('');
    status.textContent = results.length ? fill(T.results, { n: results.length }) : T.noResults;
    const extra = q.trim() ? expandQuery(q, catalog.terms).alsoSearched.slice(0, 8) : [];
    also.textContent = extra.length ? `${T.alsoSearched} ${extra.join(', ')}` : '';
    const u = new URL(location.href);
    if (q.trim()) u.searchParams.set('q', q.trim()); else u.searchParams.delete('q');
    if (city.value) u.searchParams.set('city', city.value); else u.searchParams.delete('city');
    history.replaceState(null, '', u);
  };
  let timer = 0;
  input.addEventListener('input', () => { clearTimeout(timer); timer = window.setTimeout(run, 120); });
  city.addEventListener('change', run);
  root.querySelector('[data-guide-form]')?.addEventListener('submit', (e) => { e.preventDefault(); run(); });
  run();
}
