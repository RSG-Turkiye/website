/** Month grid and board for plans and posts (spec §2: calendar first, board toggle remembered per viewer). */
import { api, type Plan, type Post } from './api';
import { deps } from './context';
import { esc, statusClass } from './ui';
import { monthGrid, gridRange, bucketByDay, dayKey, timeOf, shiftMonth, monthOf, planDue } from '../../lib/social-calendar';
import { showSide, refreshSide } from './side-panel';
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
  document.getElementById('socialCalendar')!.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-entry]');
    if (target) { showSide(target.dataset.entry as 'plan' | 'post', target.dataset.id!); return; }
    const day = (e.target as HTMLElement).closest<HTMLElement>('[data-day]');
    if (day && (e.target as HTMLElement).closest('[data-add]')) void openPlanDialog({ date: day.dataset.day! });
  });
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
  return `<button type="button" data-entry="${kind}" data-id="${esc(id)}" class="block w-full text-left mt-1 px-1.5 py-0.5 rounded text-xs truncate ${cls}">${esc(label)}</button>`;
}
const postLabel = (p: Post) => p.planTitle || p.caption.trim().split('\n')[0] || deps().t(`admin.social.type.${p.type}`);

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
  refreshSide();

  function grid(): string {
    const days = monthGrid(year, month);
    const today = dayKey(now());
    const byDayPlans = bucketByDay(emptyPlans(), (p) => p.scheduledAt);
    const byDayPosts = bucketByDay(posts, (p) => p.scheduledAt);
    const head = Array.from({ length: 7 }, (_, i) => new Date(Date.UTC(2024, 0, 1 + i))
      .toLocaleDateString(lang === 'tr' ? 'tr-TR' : 'en-GB', { weekday: 'short', timeZone: 'UTC' }));
    const cells = days.map((d) => {
      const items = [
        ...(byDayPlans.get(d.key) ?? []).map((p) => entry('plan', p.id, statusClass(planDue(p, now()) ? 'due' : 'plan'), `${timeOf(p.scheduledAt)} ${p.title}`)),
        ...(byDayPosts.get(d.key) ?? []).map((p) => entry('post', p.id, statusClass(p.status), `${p.scheduledAt ? timeOf(p.scheduledAt) : ''} ${postLabel(p)}`)),
      ].join('');
      return `<div data-day="${d.key}" class="group min-h-24 rounded-lg border p-1 text-xs ${d.inMonth ? 'bg-white border-border' : 'bg-[#fafbfd] border-border text-gray-500'} ${d.key === today ? 'ring-2 ring-navy' : ''}">
        <div class="flex justify-between"><span>${d.day}</span><button type="button" data-add aria-label="${esc(t('admin.social.newPlan'))}" class="hidden group-hover:inline text-gray-500 hover:text-navy">+</button></div>${items}</div>`;
    }).join('');
    const legend = `<div class="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
      ${(['plan', 'due', 'pending_approval', 'scheduled', 'rejected'] as const).map((s) => `<span class="inline-flex items-center gap-1"><span class="inline-block w-3 h-3 rounded ${statusClass(s)}"></span>${esc(s === 'plan' ? t('admin.social.legend.plan') : s === 'due' ? t('admin.social.legend.due') : t(`admin.social.status.${s}`))}</span>`).join('')}
    </div>`;
    return `<div class="min-w-[640px]"><div class="grid grid-cols-7 gap-1 mb-1 text-xs text-gray-500 text-center">${head.map((h) => `<div>${esc(h)}</div>`).join('')}</div>
      <div class="grid grid-cols-7 gap-1">${cells}</div></div>${legend}`;
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
    return `<div class="grid grid-cols-1 md:grid-cols-5 gap-3">${cols.map(([key, label]) => {
      const items = key === 'plan'
        ? emptyPlans().map((p) => card('plan', p.id, statusClass(planDue(p, now()) ? 'due' : 'plan'), p.title, `${when(p.scheduledAt)} ${p.assigneeEmail ?? ''}`))
        : posts.filter((p) => bucket(p) === key).map((p) => card('post', p.id, statusClass(p.status), postLabel(p), `${when(p.scheduledAt)} ${t(`admin.social.status.${p.status}`)}`));
      return `<div class="bg-[#f4f6fa] rounded-xl p-2"><h3 class="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-2">${esc(label)} · ${items.length}</h3>${items.join('') || `<p class="text-xs text-gray-500">${esc(t('admin.social.empty'))}</p>`}</div>`;
    }).join('')}</div>`;
  }
}

/** For side-panel lookups without a refetch. */
export const findPlan = (id: string) => plans.find((p) => p.id === id);
export const findPost = (id: string) => posts.find((p) => p.id === id);
