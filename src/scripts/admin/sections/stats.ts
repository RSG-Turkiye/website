/**
 * The Statistics section: plain tables, one per subject, with the periods as
 * columns. Counts only; the server never sends who did anything. Tables are
 * fixed-layout with short numeric columns so nothing scrolls sideways on a
 * phone.
 */
import { lang, t, tf } from '../context';
import { escapeHtml } from '../../escape-html';

interface Period { key: string; from: number; to: number }
interface Row { key: string; values: number[] }
interface Totals { views: number; visits: number }
interface TopItem { name: string; views: number }
interface SiteVisits {
  totals: (Totals | null)[];
  top: { pages: TopItem[]; referrers: TopItem[]; countries: TopItem[]; devices: TopItem[] } | null;
}
interface CertYear { year: number; certificates: number; people: number; viewed: number; downloaded: number }
export interface Stats {
  year: number;
  periods: Period[];
  snapshot: { accounts: number; members: number };
  membership: Row[];
  learning: Row[];
  submissions: Row[];
  mail: Row[];
  social: Row[];
  certificates: CertYear[];
  visits: { main: SiteVisits; symposium: SiteVisits } | null;
}
interface Content { blog: number[]; webinars: number[]; areas: Record<string, string> }

const tt = (key: string) => t(key as never);
const num = (n: number | null) => (n === null ? '—' : n.toLocaleString(lang === 'tr' ? 'tr-TR' : 'en-GB'));

function columnLabel(p: Period, year: number): string {
  if (p.key === 'year') return String(year);
  if (p.key === 'previousYear') return String(year - 1);
  return tt(`admin.stats.col.${p.key}`);
}

const CELL = 'pb-2 sm:py-2 text-right tabular-nums text-navy';

/**
 * On a phone the measure's name gets its own line above its numbers, so the
 * numbers have the full width; from sm up it is the first column.
 */
function table(head: string[], rows: { label: string; values: (number | null)[] }[], firstWidth = 'sm:w-[40%]'): string {
  return `<table class="w-full table-fixed text-sm">
    <thead><tr>
      <th scope="col" class="w-0 ${firstWidth} p-0 sm:pb-1"><span class="sr-only">${escapeHtml(tt('admin.stats.measure'))}</span></th>
      ${head.map((h) => `<th scope="col" class="pb-1 text-right text-xs font-normal text-gray-500">${escapeHtml(h)}</th>`).join('')}
    </tr></thead>
    <tbody>${rows.map((r) => `<tr class="sm:hidden border-t border-border" aria-hidden="true">
      <td colspan="${head.length + 1}" class="pt-2 pb-0.5 text-gray-700">${escapeHtml(r.label)}</td>
    </tr><tr class="sm:border-t border-border">
      <th scope="row" class="sr-only sm:not-sr-only sm:py-2 sm:pr-2 text-left font-normal text-gray-700 break-words">${escapeHtml(r.label)}</th>
      ${r.values.map((v) => `<td class="${CELL}">${num(v)}</td>`).join('')}
    </tr>`).join('')}</tbody>
  </table>`;
}

function block(heading: string, body: string, note = ''): string {
  return `<section class="mb-6 lg:mb-4">
    <h2 class="text-sm font-semibold text-navy mb-2">${escapeHtml(heading)}</h2>
    ${note ? `<p class="text-xs text-gray-500 mb-2 max-w-prose">${note}</p>` : ''}
    <div class="bg-white rounded-2xl border border-border px-4 py-2 lg:px-3">${body}</div>
  </section>`;
}

function list(heading: string, items: TopItem[], name: (s: string) => string = (s) => s): string {
  const rows = items.length
    ? items.map((i) => `<li class="flex items-baseline gap-3 py-1.5 border-t border-border first:border-t-0">
        <span class="flex-1 min-w-0 break-all text-gray-700">${escapeHtml(name(i.name))}</span>
        <span class="tabular-nums text-navy">${num(i.views)}</span></li>`).join('')
    : `<li class="py-1.5 text-gray-500">${escapeHtml(tt('admin.stats.none'))}</li>`;
  return `<div class="min-w-0">
    <h3 class="text-xs text-gray-500 mb-1">${escapeHtml(heading)}</h3>
    <ol class="text-sm">${rows}</ol>
  </div>`;
}

function inPeriods(times: number[], periods: Period[]): number[] {
  return periods.map((p) => times.filter((at) => at >= p.from && at < p.to).length);
}

function visitsBlock(s: Stats, head: string[]): string {
  if (!s.visits) return block(tt('admin.stats.visits.heading'), `<p class="py-2 text-sm text-gray-500">${escapeHtml(tt('admin.stats.visits.notSetUp'))}</p>`);
  const { main, symposium } = s.visits;
  const rows = [
    { label: tt('admin.stats.visits.mainViews'), values: main.totals.map((x) => x?.views ?? null) },
    { label: tt('admin.stats.visits.mainVisits'), values: main.totals.map((x) => x?.visits ?? null) },
    { label: tt('admin.stats.visits.symposiumViews'), values: symposium.totals.map((x) => x?.views ?? null) },
    { label: tt('admin.stats.visits.symposiumVisits'), values: symposium.totals.map((x) => x?.visits ?? null) },
  ];
  const device = (d: string) => (['desktop', 'mobile', 'tablet'].includes(d) ? tt(`admin.stats.device.${d}`) : d);
  const top = main.top
    ? `<div class="grid gap-x-6 gap-y-4 sm:grid-cols-2 py-2">
        ${list(tt('admin.stats.visits.pages'), main.top.pages)}
        ${list(tt('admin.stats.visits.symposiumPages'), symposium.top?.pages ?? [])}
        ${list(tt('admin.stats.visits.referrers'), main.top.referrers)}
        ${list(tt('admin.stats.visits.countries'), main.top.countries)}
        ${list(tt('admin.stats.visits.devices'), main.top.devices, device)}
      </div>`
    : `<p class="py-2 text-sm text-gray-500">${escapeHtml(tt('admin.stats.visits.topFailed'))}</p>`;
  return block(tt('admin.stats.visits.heading'), table(head, rows), escapeHtml(tt('admin.stats.visits.note')))
    + block(tt('admin.stats.visits.last30'), top);
}

export function renderStats(s: Stats, content: Content): string {
  const head = s.periods.map((p) => columnLabel(p, s.year));
  const rows = (prefix: string, list: Row[]) => list.map((r) => ({ label: tt(`${prefix}.${r.key}`), values: r.values }));
  const area = (key: string) => {
    const id = key.replace(/^area:/, '');
    return content.areas[id] ?? (id === 'roadmap' ? tt('admin.stats.learning.roadmap') : id);
  };

  const learning = s.learning.map((r) => ({
    label: r.key.startsWith('area:') ? `· ${area(r.key)}` : tt(`admin.stats.learning.${r.key}`),
    values: r.values,
  }));
  const contentRows = [
    { label: tt('admin.stats.content.blog'), values: inPeriods(content.blog, s.periods) },
    { label: tt('admin.stats.content.webinars'), values: inPeriods(content.webinars, s.periods) },
    ...rows('admin.stats.submissions', s.submissions),
  ];
  const certs = s.certificates.length
    ? table(
        [tt('admin.stats.certs.certificates'), tt('admin.stats.certs.people'), tt('admin.stats.certs.viewed'), tt('admin.stats.certs.downloaded')],
        s.certificates.map((c) => ({ label: String(c.year), values: [c.certificates, c.people, c.viewed, c.downloaded] })),
        'sm:w-[20%]',
      )
    : `<p class="py-2 text-sm text-gray-500">${escapeHtml(tt('admin.stats.none'))}</p>`;

  return [
    visitsBlock(s, head),
    block(tt('admin.stats.membership.heading'), table(head, rows('admin.stats.membership', s.membership)),
      escapeHtml(tf('admin.stats.membership.now' as never, { accounts: num(s.snapshot.accounts), members: num(s.snapshot.members) }))),
    block(tt('admin.stats.learning.heading'), table(head, learning)),
    block(tt('admin.stats.content.heading'), table(head, contentRows)),
    block(tt('admin.stats.mail.heading'), table(head, rows('admin.stats.mail', s.mail))),
    block(tt('admin.stats.social.heading'), table(head, rows('admin.stats.social', s.social))),
    block(tt('admin.stats.certs.heading'), certs, escapeHtml(tt('admin.stats.certs.note'))),
  ].join('');
}

let content: Content = { blog: [], webinars: [], areas: {} };

export async function loadStats(): Promise<void> {
  const body = document.getElementById('statsBody');
  const select = document.getElementById('statsYear') as HTMLSelectElement | null;
  if (!body || !select) return;
  if (!select.options.length) {
    try { content = JSON.parse(body.dataset.content ?? '{}') as Content; } catch { /* published counts stay empty */ }
    const now = new Date().getFullYear();
    for (let y = now; y >= 2024; y--) select.add(new Option(String(y), String(y)));
    select.addEventListener('change', () => void loadStats());
  }
  body.setAttribute('aria-busy', 'true');
  body.innerHTML = `<p class="text-sm text-gray-500">${escapeHtml(tt('admin.stats.loading'))}</p>`;
  const res = await fetch(`/api/admin/stats?year=${select.value}`);
  body.removeAttribute('aria-busy');
  if (!res.ok) {
    body.innerHTML = `<p class="text-sm text-red">${escapeHtml(tt('admin.stats.loadFailed'))}</p>`;
    return;
  }
  body.innerHTML = renderStats(await res.json() as Stats, content);
}
