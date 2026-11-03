/**
 * A programme's "how to apply" block, the same everywhere: the search page's
 * groups (src/scripts/guide-page.ts, in the browser) and the university page
 * (built by Astro with set:html). One renderer, so a status or a warning
 * never looks different on two pages.
 *
 * A status is claimed only from an exact window a person entered in the CMS.
 * The usual months are history, so they are said as history: "no exact
 * date; usually October, November", with the day it was last checked.
 */
import { escapeHtml } from '../scripts/escape-html';
import { GUIDE_TEXT, fill, monthNames, dayLabel, pageChangedLabel, type Lang } from './guide-text';
import type { CatalogProgramme } from './guide-catalog';

export type ProgrammeStatus =
  | { kind: 'open'; closes: string }
  | { kind: 'upcoming'; opens: string }
  | { kind: 'months'; months: string[] }
  | { kind: 'unknown' };

/** `today` is the Istanbul date, YYYY-MM-DD. */
export function programmeStatus(p: CatalogProgramme, today: string): ProgrammeStatus {
  if (p.windowOpens && p.windowCloses && p.windowCloses >= today) {
    return p.windowOpens <= today ? { kind: 'open', closes: p.windowCloses } : { kind: 'upcoming', opens: p.windowOpens };
  }
  return p.usualMonths.length ? { kind: 'months', months: [...p.usualMonths] } : { kind: 'unknown' };
}

export const WARN_CLASS = 'block mt-2 text-[13px] leading-snug text-amber-900 bg-amber-50 border-l-2 border-amber-500 px-2.5 py-1.5';

export function applyBlockHtml(p: CatalogProgramme, lang: Lang, today: string, pageChangedSince?: string, phdLine = ''): string {
  const T = GUIDE_TEXT[lang];
  const s = programmeStatus(p, today);
  const href = p.announcementUrl ?? p.sourceUrl;
  const checked = fill(T.checkedShort, { date: dayLabel(p.checkedAt, lang) });
  const status = s.kind === 'open'
    ? `<span class="font-semibold text-navy">${escapeHtml(fill(T.statusOpen, { date: dayLabel(s.closes, lang) }))}</span>`
    : s.kind === 'upcoming'
      ? `<span class="font-semibold text-navy">${escapeHtml(fill(T.statusUpcoming, { date: dayLabel(s.opens, lang) }))}</span>`
      : `${escapeHtml(T.noExactDate)}; ${escapeHtml(s.kind === 'months' ? fill(T.usually, { months: monthNames(s.months, lang) }) : T.monthsUnknown)}.`;
  const warn = pageChangedSince ? `<span role="note" class="${WARN_CLASS}">${escapeHtml(pageChangedLabel(pageChangedSince, lang))}</span>` : '';
  return `<div class="border-l-2 border-navy-mid pl-3">`
    + `<a href="${escapeHtml(href)}" rel="noopener" class="block text-[15px] font-medium leading-snug text-navy hover:text-navy-mid underline decoration-navy-mid/30 underline-offset-2">${escapeHtml(p.name[lang])}</a>`
    + `<span class="block text-[13px] text-gray-500 mt-0.5">${escapeHtml(p.institute[lang])}</span>`
    + `<span class="block text-sm text-gray-700 mt-1.5 leading-snug">${status}</span>`
    + `<span class="block text-xs text-gray-500 mt-1">${escapeHtml(checked)}</span>`
    + (p.type === 'phd' ? `<span class="block text-xs text-gray-600 mt-1">${escapeHtml(T.phdNote)}</span>` : '')
    + warn
    + phdLine
    + `</div>`;
}

/** Each MSc by name, each followed by the PhD that continues it (a PhD whose MSc is missing goes last). */
export function orderProgrammes<P extends Pick<CatalogProgramme, 'id' | 'type' | 'mscId' | 'name'>>(list: P[], lang: Lang): P[] {
  const msc = list.filter((p) => p.type !== 'phd').sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang));
  const phd = list.filter((p) => p.type === 'phd');
  const out = msc.flatMap((m) => [m, ...phd.filter((d) => d.mscId === m.id)]);
  return [...out, ...phd.filter((d) => !out.includes(d))];
}

/** A PhD that adds nothing to its MSc's block but its name: same institute, same months, no window of its own. */
function sameAsMsc(phd: CatalogProgramme, msc: CatalogProgramme): boolean {
  return phd.institute.tr === msc.institute.tr && phd.institute.en === msc.institute.en
    && phd.usualMonths.join() === msc.usualMonths.join() && !phd.windowOpens && !phd.windowCloses;
}

/**
 * A group's apply blocks, in the order given: each MSc, and a PhD that only
 * differs by name as one line inside its MSc's block ("Doktora: ..."), so a
 * university with three programmes does not grow to six blocks. Any other PhD
 * gets a block of its own.
 */
export function applyBlocksHtml(programmes: CatalogProgramme[], lang: Lang, today: string, pageChanged: Record<string, string | undefined>): string {
  const T = GUIDE_TEXT[lang];
  const inline = new Set<string>();
  const out: string[] = [];
  for (const p of programmes) {
    if (inline.has(p.id)) continue;
    let line = '';
    if (p.type !== 'phd') {
      const phd = programmes.find((d) => d.type === 'phd' && d.mscId === p.id && sameAsMsc(d, p) && !pageChanged[d.id]);
      if (phd) {
        inline.add(phd.id);
        line = `<span class="block text-sm text-gray-700 mt-2">${escapeHtml(T.phdLabel)}: <a href="${escapeHtml(phd.announcementUrl ?? phd.sourceUrl)}" rel="noopener" class="font-medium text-navy hover:text-navy-mid underline decoration-navy-mid/30 underline-offset-2">${escapeHtml(phd.name[lang])}</a></span>`
          + `<span class="block text-xs text-gray-600 mt-0.5">${escapeHtml(T.phdNote)}</span>`;
      }
    }
    out.push(applyBlockHtml(p, lang, today, pageChanged[p.id], line));
  }
  return out.join('');
}
