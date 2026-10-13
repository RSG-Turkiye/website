/**
 * Entry point for the social pane. setupSocial wires tabs and toolbar once;
 * loadSocial runs the first time the pane is shown (admin-panel.ts pane
 * loaders), and again on every changed() signal.
 */
import { setDeps, deps, onChange, type SocialDeps } from './context';
import { loadCalendar } from './calendar-view';
import { loadPending, loadDrafts, loadPublished, refreshPendingCount as refreshPendingCountView } from './lists';
import { loadEvents } from './events';

type Tab = 'calendar' | 'pending' | 'drafts' | 'published' | 'events';
const TABS: Tab[] = ['calendar', 'pending', 'drafts', 'published', 'events'];
const loaders: Record<Tab, () => Promise<void>> = {
  calendar: async () => {},
  pending: async () => {},
  drafts: async () => {},
  published: async () => {},
  events: async () => {},
};
let current: Tab = 'calendar';

/** Tasks 3 to 5 register their view loaders here. */
export function registerView(tab: Tab, load: () => Promise<void>): void {
  loaders[tab] = load;
}

/** Runs on setup and on every change, for publishers only: the count beside "Awaiting approval". */
let refreshPendingCount: () => Promise<void> = async () => {};
export function registerPendingCount(fn: () => Promise<void>): void { refreshPendingCount = fn; }

function showTab(tab: Tab): void {
  current = tab;
  document.querySelectorAll<HTMLButtonElement>('[data-social-tab]').forEach((b) => {
    const on = b.dataset.socialTab === tab;
    b.classList.toggle('border-red', on);
    b.classList.toggle('text-navy', on);
    b.classList.toggle('font-medium', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll<HTMLElement>('[data-social-view]').forEach((v) => v.classList.toggle('hidden', v.dataset.socialView !== tab));
  void reloadCurrent();
}

async function reloadCurrent(): Promise<void> {
  try {
    await loaders[current]();
  } catch {
    deps().showToast(deps().t('admin.social.loadFailed'), true);
  }
}

export function setupSocial(d: SocialDeps): void {
  setDeps(d);
  if (!d.me.isPublisher) document.querySelectorAll('[data-pane="social"] [data-publisher-only]').forEach((el) => el.remove());
  document.querySelectorAll<HTMLButtonElement>('[data-social-tab]').forEach((b) => {
    b.addEventListener('click', () => {
      const tab = b.dataset.socialTab as Tab;
      if (TABS.includes(tab)) showTab(tab);
    });
  });
  onChange(() => { void reloadCurrent(); void refreshPendingCount().catch(() => {}); });
  registerView('calendar', loadCalendar);
  registerView('pending', loadPending);
  registerView('drafts', loadDrafts);
  registerView('published', loadPublished);
  registerView('events', loadEvents);
  registerPendingCount(refreshPendingCountView);
}

export async function loadSocial(): Promise<void> {
  showTab('calendar');
  await refreshPendingCount().catch(() => {});
}
