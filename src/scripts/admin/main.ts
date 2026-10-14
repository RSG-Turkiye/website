// Shared client-side logic for the admin panel, used by both the English
// (/admin) and Turkish (/tr/admin) pages via AdminShell.astro. This used to
// be two 900-line near-clones of this file, one per language, with every
// user-facing string duplicated and hand-translated in place. All of that
// copy now lives in src/i18n/ui.ts under the `admin.*` keys; this module
// looks up the current page's language from the <html lang> attribute that
// BaseLayout already sets, and renders the same markup either way.
//
// Two behavioural differences between the two languages predate this
// refactor and are reproduced here exactly rather than resolved one way or
// the other:
//
import { loadHealth } from '../admin-health';
import { setupConnections, loadConnections } from '../admin-connections';
import { setupAudit, loadAudit } from '../admin-audit';
import { setupSocial, loadSocial } from '../social';
import { lang, t, tf, showToast } from './context';
import { loadUsers, setupUsersFilters } from './sections/users';
import { loadAnnouncements, setupAnnouncementForm, setCanManageAnnouncements } from './sections/announcements';
import { loadBlogSubmissions } from './sections/blog';
import { loadSenders, setupBulkGrant, loadAdminAttachments, setupAttachmentUpload, loadAllSends } from './sections/mail';
import { setupSymposium, loadSymposium } from './sections/symposium';

// Init

/**
 * Which panes this admin may open, and which one opens first.
 *
 * This replaces three `classList.toggle('hidden', !isFullAdmin)` calls on
 * whole sections. The sections are panes now, so a role decides which nav
 * entries exist rather than which blocks are stacked on the page -- but the
 * rule itself is unchanged: an announcer gets announcements and nothing
 * else, and (now) a symposium-only user gets the symposium pane and
 * nothing else. Each flag comes straight from what /api/me returned, not
 * from a boolean this module re-derives.
 *
 * The nav is hidden entirely when only one pane is available, since a
 * switcher with one option is furniture.
 */
function applyRoleVisibility(roles: { isFullAdmin: boolean; isAnnouncer: boolean; isSymposium: boolean; isSocial: boolean }, preferred?: string): void {
  const allowed = roles.isFullAdmin
    ? ['members', 'announcements', 'blog', 'symposium', 'social', 'connections', 'audit', 'mail-grant', 'mail-senders', 'mail-files', 'mail-sent']
    : [
        ...(roles.isAnnouncer ? ['announcements'] : []),
        ...(roles.isSymposium ? ['symposium'] : []),
        ...(roles.isSocial ? ['social'] : []),
      ];

  document.querySelectorAll<HTMLElement>('[data-pane]').forEach((pane) => {
    if (!allowed.includes(pane.dataset.pane!)) pane.remove();
  });

  document.querySelectorAll<HTMLElement>('.admin-nav-item').forEach((item) => {
    if (!allowed.includes(item.dataset.target!)) item.remove();
  });

  // A group heading with nothing left under it is noise.
  document.querySelectorAll<HTMLElement>('[data-nav-group]').forEach((group) => {
    if (!group.querySelector('.admin-nav-item')) group.remove();
  });

  const nav = document.getElementById('adminNav');
  if (nav && allowed.length < 2) nav.classList.add('hidden');

  setupPaneSwitching(preferred && allowed.includes(preferred) ? preferred : allowed[0]);
}

/**
 * Data that should load the first time a pane is shown, not on every page
 * load: each load is a read the audit log records, so loading unseen panes
 * would fill the log with reads nobody asked for.
 */
const paneLoaders = new Map<string, () => Promise<void>>();
const paneLoaded = new Set<string>();
let currentPane = '';

const LOAD_FAILED: Record<string, string> = {
  audit: 'admin.audit.loadFailed',
  connections: 'admin.connections.loadFailed',
  social: 'admin.social.loadFailed',
};

function runPaneLoader(pane: string): void {
  const loader = paneLoaders.get(pane);
  if (!loader || paneLoaded.has(pane)) return;
  paneLoaded.add(pane);
  loader().catch(() => showToast(t((Object.hasOwn(LOAD_FAILED, pane) ? LOAD_FAILED[pane] : 'admin.social.loadFailed') as never), true));
}

/** Registers a loader; runs it now if its pane is already the one on screen. */
function registerPaneLoader(pane: string, loader: () => Promise<void>): void {
  paneLoaders.set(pane, loader);
  if (currentPane === pane) runPaneLoader(pane);
}

/** Shows one pane at a time and marks its nav entry as current. */
function setupPaneSwitching(initial: string): void {
  const items = document.querySelectorAll<HTMLButtonElement>('.admin-nav-item');
  const panes = document.querySelectorAll<HTMLElement>('[data-pane]');

  function show(target: string): void {
    currentPane = target;
    runPaneLoader(target);
    panes.forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== target));
    items.forEach((i) => {
      const current = i.dataset.target === target;
      i.classList.toggle('bg-navy-light', current);
      i.classList.toggle('text-navy', current);
      i.classList.toggle('font-medium', current);
      i.setAttribute('aria-current', current ? 'page' : 'false');
    });
    // The audit log records which panes each person opened (spec §6).
    // keepalive so a view right before leaving the page is still sent.
    void fetch('/api/audit/view', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pane: target }), keepalive: true,
    }).catch(() => {});
  }

  items.forEach((i) => i.addEventListener('click', () => show(i.dataset.target!)));
  show(initial);
}

(async () => {
  const res = await fetch('/api/me');
  const data = await res.json() as { user: any };

  document.getElementById('loadingState')!.classList.add('hidden');

  if (!data.user || (!data.user.is_admin && !data.user.is_announcer && !data.user.is_symposium && !data.user.is_social && !data.user.is_social_publisher)) {
    document.getElementById('notAuth')!.classList.remove('hidden');
    return;
  }

  document.getElementById('adminContent')!.classList.remove('hidden');
  const isFullAdmin = data.user.is_admin === true;
  const isAnnouncer = data.user.is_announcer === true;
  const isSymposium = data.user.is_symposium === true;
  const isSocial = data.user.is_social === true || data.user.is_social_publisher === true;
  const isSocialPublisher = isFullAdmin || data.user.is_social_publisher === true;
  const canManageAnnouncements = isFullAdmin || isAnnouncer;
  setCanManageAnnouncements(canManageAnnouncements);
  const canEditSymposium = isFullAdmin || isSymposium;
  // Back from a Gmail reconnect: open Connections and say how it went.
  const params = new URLSearchParams(location.search);
  const connected = params.get('connected');
  const connectionError = params.get('connection_error');
  applyRoleVisibility({ isFullAdmin, isAnnouncer, isSymposium, isSocial }, connected || connectionError ? 'connections' : undefined);
  void loadHealth({ t: t as (k: string) => string, tf: tf as (k: string, v: Record<string, string | number>) => string, lang });
  if (canManageAnnouncements) {
    await loadAnnouncements();
    setupAnnouncementForm();
  }
  if (isFullAdmin) await loadUsers();
  if (isFullAdmin) await loadBlogSubmissions();
  if (isFullAdmin) {
    setupBulkGrant();
    setupAttachmentUpload();
    await Promise.all([loadSenders(), loadAdminAttachments(), loadAllSends()]);
  }
  if (isFullAdmin) {
    setupConnections({ t: t as (k: string) => string, showToast, lang });
    setupAudit({ t: t as (k: string) => string, tf: tf as (k: string, v: Record<string, string | number>) => string, showToast, lang });
    registerPaneLoader('connections', loadConnections);
    registerPaneLoader('audit', () => loadAudit());
  }
  if (isFullAdmin || isSocial) {
    setupSocial({
      t: t as (k: string) => string,
      tf: tf as (k: string, v: Record<string, string | number>) => string,
      showToast, lang, me: { id: data.user.id, isPublisher: isSocialPublisher },
    });
    registerPaneLoader('social', loadSocial);
  }
  if (connected || connectionError) {
    const known = ['bad_state', 'not_admin', 'cancelled', 'token_exchange', 'no_refresh_token', 'missing_scope', 'wrong_account', 'store_failed', 'not_configured', 'not_professional', 'not_page_admin', 'lookup_failed'];
    if (connected) showToast(tf('admin.connections.connected', { platform: t(`admin.connections.platform.${connected}` as never) }));
    else showToast(t(`admin.connections.error.${known.includes(connectionError!) ? connectionError : 'unknown'}` as never), true);
    history.replaceState(null, '', location.pathname);
  }
  if (canEditSymposium) {
    setupSymposium();
    await loadSymposium();
  }

  // The filter buttons and the search box belong to the users pane, which
  // only a full admin's panel renders. The `!` below said otherwise, and for
  // a symposium organiser -- the account this panel's committee section is
  // for -- getElementById returned null and the bootstrap threw. It is the
  // last statement in this function, so nothing was lost, but every one of
  // those visits logged an error and the next line added here would have
  // been.
  if (isFullAdmin) {
    setupUsersFilters();
  }
})();
