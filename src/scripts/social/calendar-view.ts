/** Month grid and board for plans and posts (spec §2: calendar first, board toggle remembered per viewer). */
import { api, type Plan, type Post } from './api';
import { deps } from './context';
import { esc, statusClass } from './ui';
import { monthGrid, gridRange, dayKey, timeOf, shiftMonth, monthOf, planDue } from '../../lib/social-calendar';
import { showSide, showDay, refreshSide } from './side-panel';
import { openPlanDialog } from './plan-dialog';
import { openComposer } from './composer';

const VIEW_KEY = 'rsg.social.view';
let year = 0;
let month = 0;
let view: 'calendar' | 'board' = 'calendar';
let plans: Plan[] = [];
let posts: Post[] = [];
let wired = false;

function readView(): 'calendar' | 'board' {
  try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'calendar'; } catch { return 'calendar'; }
}
function writeView(v: 'calendar' | 'board'): void {
  try { localStorage.setItem(VIEW_KEY, v); } catch { /* private mode: not remembered */ }
}
const now = () => Math.floor(Date.now() / 1000);
/** User-triggered reloads: a failed fetch becomes a toast, not an unhandled rejection. */
const reload = () => loadCalendar().catch(() => deps().showToast(deps().t('admin.social.loadFailed'), true));

function wire(): void {
  if (wired) return;
  wired = true;
  ({ year, month } = monthOf(now()));
  view = readView();
  const go = (delta: number) => { ({ year, month } = shiftMonth(year, month, delta)); void reload(); };
  document.getElementById('socialPrev')!.addEventListener('click', () => go(-1));
  document.getElementById('socialNext')!.addEventListener('click', () => go(1));
  document.getElementById('socialToday')!.addEventListener('click', () => { ({ year, month } = monthOf(now())); void reload(); });
  document.getElementById('socialViewCalendar')!.addEventListener('click', () => { view = 'calendar'; writeView(view); render(); });
  document.getElementById('socialViewBoard')!.addEventListener('click', () => { view = 'board'; writeView(view); render(); });
  document.getElementById('socialNewPlan')!.addEventListener('click', () => void openPlanDialog({}));
  document.getElementById('socialNewPost')!.addEventListener('click', () => void openComposer({}));
  const cal = document.getElementById('socialCalendar')!;
  cal.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-entry]');
    if (target) { showSide(target.dataset.entry as 'plan' | 'post', target.dataset.id!); return; }
    const day = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (day && (e.target as HTMLElement).closest('[data-more]')) { showDay(day.dataset.day!); return; }
    if (day && (e.target as HTMLElement).closest('[data-add]')) void openPlanDialog({ date: day.dataset.day! });
  });
  // The cells' height comes from the window, so a resize can change how many fit.
  let queued = false;
  new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fitDays(); });
  }).observe(cal);
}

export async function loadCalendar(): Promise<void> {
  wire();
  const { from, to } = gridRange(monthGrid(year, month));
  [plans, posts] = await Promise.all([api.plans(from, to), api.posts(from, to)]);
  render();
}

/** Plans that already have a post are shown as that post, never twice. */
const emptyPlans = () => plans.filter((p) => p.postId === null);

function entry(kind: 'plan' | 'post', id: string, cls: string, label: string): string {
  return `<button type="button" data-entry="${kind}" data-id="${esc(id)}" class="block w-full text-left mt-1 lg:mt-0.5 px-1.5 py-0.5 min-h-11 lg:min-h-0 rounded text-xs truncate ${cls}">${esc(label)}</button>`;
}
const postLabel = (p: Post) => p.planTitle || p.caption.trim().split('\n')[0] || deps().t(`admin.social.type.${p.type}`);

/** One day's plans and posts, in time order: the calendar cell and the side panel's day list draw the same buttons. */
function dayEntries(key: string): string[] {
  const dayPlans = emptyPlans().filter((p) => dayKey(p.scheduledAt) === key).sort((a, b) => a.scheduledAt - b.scheduledAt);
  const dayPosts = posts.filter((p) => p.scheduledAt !== null && dayKey(p.scheduledAt) === key).sort((a, b) => a.scheduledAt! - b.scheduledAt!);
  return [
    ...dayPlans.map((p) => entry('plan', p.id, statusClass(planDue(p, now()) ? 'due' : 'plan'), `${timeOf(p.scheduledAt)} ${p.title}`)),
    ...dayPosts.map((p) => entry('post', p.id, statusClass(p.status), `${p.scheduledAt ? timeOf(p.scheduledAt) : ''} ${postLabel(p)}`)),
  ];
}
export const dayItems = (key: string) => dayEntries(key).join('');

/**
 * From lg up a day cell is as tall as the window allows, never taller: the
 * entries that do not fit are hidden from the end and a "+N more" button
 * opens the whole day in the side panel. Phones show every entry.
 */
function fitDays(): void {
  const { t } = deps();
  const cal = document.getElementById('socialCalendar');
  if (!cal || cal.clientHeight === 0) return;
  const wide = matchMedia('(min-width: 1024px)').matches;
  cal.querySelectorAll<HTMLElement>('[data-day]').forEach((cell) => {
    const box = cell.querySelector<HTMLElement>('[data-entries]');
    const more = cell.querySelector<HTMLButtonElement>('[data-more]');
    if (!box || !more) return;
    const items = [...box.children] as HTMLElement[];
    for (const i of items) i.hidden = false;
    more.hidden = true;
    if (!wide || box.scrollHeight <= box.clientHeight + 1) return;
    more.hidden = false;
    let hidden = 0;
    for (let i = items.length - 1; i >= 0 && box.scrollHeight > box.clientHeight + 1; i--) { items[i].hidden = true; hidden++; }
    more.textContent = t('admin.social.calendar.more').replace('{n}', String(hidden));
    more.setAttribute('aria-label', t('admin.social.calendar.moreLabel').replace('{total}', String(items.length)).replace('{day}', cell.dataset.day!));
  });
}

function render(): void {
  const { t, lang } = deps();
  const el = document.getElementById('socialCalendar')!;
  document.getElementById('socialMonth')!.textContent = new Date(Date.UTC(year, month - 1, 15))
    .toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  for (const [id, on] of [['socialViewCalendar', view === 'calendar'], ['socialViewBoard', view === 'board']] as const) {
    const b = document.getElementById(id)!;
    b.classList.toggle('bg-navy-light', on);
    b.classList.toggle('font-medium', on);
    b.setAttribute('aria-pressed', String(on));
  }
  el.innerHTML = view === 'calendar' ? grid() : board();
  if (view === 'calendar') fitDays();
  refreshSide();

  function grid(): string {
    const days = monthGrid(year, month);
    const today = dayKey(now());
    const byDay = new Map(days.map((d) => [d.key, dayEntries(d.key)]));
    const head = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i))
      .toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }));
    const cells = days.map((d) => {
      const items = (byDay.get(d.key) ?? []).join('');
      return `<div data-day="${d.key}" class="group min-h-24 lg:min-h-0 lg:flex lg:flex-col lg:overflow-hidden rounded-lg border p-1 text-xs ${d.inMonth ? 'bg-white border-border' : 'bg-[#fafbfd] border-border text-gray-500'} ${d.key === today ? 'ring-2 ring-inset ring-navy' : ''}">
        <div class="shrink-0 flex items-center justify-between gap-1 min-w-0"><span>${d.day}</span><span class="flex items-center gap-1 min-w-0">
          <button type="button" data-more hidden class="min-w-0 truncate px-1 rounded bg-navy-light text-[11px] leading-4 font-medium text-navy hover:underline"></button>
          <button type="button" data-add aria-label="${esc(t('admin.social.newPlan'))}" class="hidden group-hover:inline text-gray-500 hover:text-navy">+</button></span></div>
        <div data-entries class="lg:flex-1 lg:min-h-0 lg:overflow-hidden">${items}</div></div>`;
    }).join('');
    const legend = `<div class="shrink-0 flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs text-gray-500">
      ${(['plan', 'due', 'pending_approval', 'scheduled', 'rejected'] as const).map((s) => `<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded ${statusClass(s)}"></span>${esc(s === 'plan' ? t('admin.social.legend.plan') : s === 'due' ? t('admin.social.legend.due') : t(`admin.social.status.${s}`))}</span>`).join('')}
    </div>`;
    return `<div class="min-w-[640px] lg:min-w-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col"><div class="shrink-0 grid grid-cols-7 gap-1 mb-1 text-xs text-gray-500 text-center">${head.map((h) => `<div>${esc(h)}</div>`).join('')}</div>
      <div data-month-grid class="grid grid-cols-7 gap-1 lg:grid-rows-6 lg:flex-1 lg:min-h-0">${cells}</div></div>${legend}`;
  }

  function board(): string {
    const cols: [string, string][] = [
      ['plan', t('admin.social.board.plan')], ['draft', t('admin.social.board.draft')], ['pending_approval', t('admin.social.board.pending')],
      ['scheduled', t('admin.social.board.scheduled')], ['done', t('admin.social.board.done')],
    ];
    const bucket = (p: Post) => (p.status === 'draft' || p.status === 'rejected' ? 'draft'
      : p.status === 'pending_approval' || p.status === 'scheduled' ? p.status : 'done');
    const card = (kind: 'plan' | 'post', id: string, cls: string, title: string, sub: string) =>
      `<button type="button" data-entry="${kind}" data-id="${esc(id)}" class="block w-full text-left mb-2 p-2 rounded-lg bg-white border border-border text-xs">
        <span class="inline-block px-1.5 rounded ${cls}">&nbsp;</span> <strong class="text-navy">${esc(title)}</strong><br><span class="text-gray-500">${esc(sub)}</span></button>`;
    const when = (e: number | null) => (e ? `${dayKey(e)} ${timeOf(e)}` : '');
    return `<div class="grid grid-cols-1 md:grid-cols-5 gap-3 lg:flex-1 lg:min-h-0 lg:grid-rows-[minmax(0,1fr)]">${cols.map(([key, label]) => {
      const items = key === 'plan'
        ? emptyPlans().map((p) => card('plan', p.id, statusClass(planDue(p, now()) ? 'due' : 'plan'), p.title, `${when(p.scheduledAt)} ${p.assigneeEmail ?? ''}`))
        : posts.filter((p) => bucket(p) === key).map((p) => card('post', p.id, statusClass(p.status), postLabel(p), `${when(p.scheduledAt)} ${t(`admin.social.status.${p.status}`)}`));
      return `<div class="bg-[#f4f6fa] rounded-xl p-2 lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain"><h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">${esc(label)} · ${items.length}</h3>${items.join('') || `<p class="text-xs text-gray-500">${esc(t('admin.social.empty'))}</p>`}</div>`;
    }).join('')}</div>`;
  }
}

/** For side-panel lookups without a refetch. */
export const findPlan = (id: string) => plans.find((p) => p.id === id);
export const findPost = (id: string) => posts.find((p) => p.id === id);
