/**
 * Entry point for the social pane. setupSocial wires the views once;
 * loadSocial runs the first time the pane is shown (admin/shell.ts onShow),
 * and the shell picks the tab from the address via showSocialTab. Every
 * changed() signal reloads the open tab and the menu's counts.
 */
import { setDeps, deps, onChange, type SocialDeps } from './context';
import { loadCalendar } from './calendar-view';
import { loadPending, loadDrafts, loadPublished, refreshPendingCount as refreshPendingCountView } from './lists';
import { loadEvents } from './events';

export type Tab = 'calendar' | 'pending' | 'drafts' | 'published' | 'events';
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

/** Shows one tab; the shell calls this with the sub-page from the address. */
export function showSocialTab(tab: Tab): void {
  if (!(tab in loaders)) return;
  current = tab;
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
  if (!d.me.isPublisher) document.querySelectorAll('[data-section="sosyal"] [data-publisher-only]').forEach((el) => el.remove());
  onChange(() => {
    void reloadCurrent();
    void refreshPendingCount().catch(() => {});
    void d.refreshCounts().catch(() => {});
  });
  registerView('calendar', loadCalendar);
  registerView('pending', loadPending);
  registerView('drafts', loadDrafts);
  registerView('published', loadPublished);
  registerView('events', loadEvents);
  registerPendingCount(refreshPendingCountView);
}

export async function loadSocial(): Promise<void> {
  await refreshPendingCount().catch(() => {});
}
